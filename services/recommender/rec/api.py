"""HTTP API (paths after the gateway strips /api/rec), plus the background threads: story sync, event consumer, training
schedule. JSON matches the backend's former /api/v1/recommendations/*."""
import json
import re
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import ingest, serve
from .common import log, make_pool, migrate, request_id, user_from

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
VID_RE = re.compile(r"^[a-f0-9]{32}$")


class Fail(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def run_training(timeout=600):
    """One training run in its own process (the RAM goes back when it exits). Returns its result dict."""
    p = subprocess.run([sys.executable, "-m", "rec", "train"], capture_output=True, text=True, timeout=timeout)
    lines = p.stdout.strip().splitlines()
    sys.stdout.write("".join(line + "\n" for line in lines[:-1]))  # its log lines; the last one is the result
    sys.stderr.write(p.stderr)
    if p.returncode != 0 or not lines:
        raise RuntimeError(f"training failed (exit {p.returncode})")
    return json.loads(lines[-1])


def train_loop(cfg, stop):
    stop.wait(15)
    while not stop.is_set():
        try:
            run_training()
        except Exception as e:
            log("error", f"scheduled training: {e}")
        stop.wait(cfg.train_minutes * 60)


def create_app(cfg, pool=None, background=True):
    stop = threading.Event()

    @asynccontextmanager
    async def lifespan(app):
        nonlocal pool
        if pool is None:
            pool = make_pool(cfg.database_url)
            with pool.connection() as conn:
                migrate(conn)
        if background:
            for target in (ingest.sync_loop, ingest.consume_loop) + ((train_loop,) if cfg.training else ()):
                threading.Thread(target=target, args=(cfg, stop), daemon=True).start()
        log("info", f"recommender listening on :{cfg.port}")
        yield
        stop.set()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id.set(rid)
        started = time.time()
        try:
            response = await call_next(request)
        finally:
            request_id.reset(token)
        if request.url.path not in ("/health", "/ready"):
            log("info", "request", method=request.method, path=request.url.path, status=response.status_code,
                ms=int((time.time() - started) * 1000), request_id=rid)
        response.headers["X-Request-Id"] = rid
        return response

    @app.exception_handler(Fail)
    async def failed(_, e: Fail):
        return JSONResponse({"success": False, "message": e.message}, status_code=e.status)

    @app.exception_handler(Exception)
    async def crashed(request: Request, e: Exception):
        log("error", repr(e), path=request.url.path)
        return JSONResponse({"success": False, "message": "Lỗi hệ thống, vui lòng thử lại sau."}, status_code=500)

    def viewer(request: Request):
        uid, roles = user_from(cfg.sig_key, request.headers)
        vid = request.cookies.get("nh_vid", "")
        return {"user_id": uid, "roles": roles, "visitor_id": vid if VID_RE.match(vid) else None}

    def admin(request: Request):
        v = viewer(request)
        if not v["user_id"]:
            raise Fail(401, "Vui lòng đăng nhập.")
        if "admin" not in v["roles"]:
            raise Fail(403, "Bạn không có quyền.")

    def limit_of(v):
        try:
            return min(30, max(1, int(v)))
        except (TypeError, ValueError):
            return 18

    @app.get("/health")
    def health():
        return {"success": True}

    @app.get("/ready")
    def ready():
        try:
            with pool.connection() as conn:
                conn.execute("SELECT 1")
            return {"success": True, "data": {"database": "ok"}}
        except Exception:
            return JSONResponse({"success": False, "data": {"database": "down"}}, status_code=503)

    @app.get("/home")
    def home(request: Request, limit: str = "18"):
        with pool.connection() as conn:
            return {"success": True, "data": serve.home(conn, cfg, viewer(request), limit_of(limit))}

    @app.get("/related/{story_id}")
    def related(story_id: str, request: Request, limit: str = "18"):
        if not UUID_RE.match(story_id):
            raise Fail(404, "Truyện không tồn tại.")
        with pool.connection() as conn:
            return {"success": True, "data": serve.related(conn, cfg, story_id, viewer(request), limit_of(limit))}

    hits = {}  # per viewer, per minute: 120 feedback posts (as the backend's limiter did)

    @app.post("/events", status_code=202)
    async def events(request: Request):
        try:
            body = await request.json()
        except ValueError:
            body = None
        body = body if isinstance(body, dict) else {}
        kind, source, ids = body.get("kind"), body.get("source"), body.get("story_ids")
        if kind not in ("impression", "click") or source not in ("home_rec", "related") or not isinstance(ids, list):
            raise Fail(400, "Dữ liệu không hợp lệ.")
        v = viewer(request)
        who = v["user_id"] or v["visitor_id"]
        if not who:
            return {"success": True}
        minute = int(time.time() // 60)
        if len(hits) > 50000:
            hits.clear()
        n = hits[(who, minute)] = hits.get((who, minute), 0) + 1
        if n > 120:
            raise Fail(429, "Quá nhiều yêu cầu.")
        rows = [(v["user_id"], None if v["user_id"] else v["visitor_id"], s, kind, source)
                for s in ids[:30] if isinstance(s, str) and UUID_RE.match(s)]
        if rows:
            with pool.connection() as conn, conn.cursor() as cur:
                cur.executemany("INSERT INTO events (user_id, visitor_id, story_id, kind, source) VALUES (%s, %s, %s, %s, %s)", rows)
        return {"success": True}

    @app.post("/train")
    def train_now(request: Request):
        admin(request)
        result = run_training()
        if result.get("skipped"):
            raise Fail(409, "Đang có một lượt huấn luyện khác chạy.")
        return {"success": True, "data": result, "message": f"Đã huấn luyện xong trong {result['duration_ms']} ms."}

    @app.get("/status")
    def status(request: Request):
        admin(request)
        with pool.connection() as conn:
            return {"success": True, "data": conn.execute("SELECT * FROM rec_model_runs ORDER BY id DESC LIMIT 10").fetchall()}

    return app
