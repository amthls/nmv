"""Configuration, JSON logs, the database and signed calls to other services (same rules as the Go services)."""
import contextvars
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

request_id = contextvars.ContextVar("request_id", default="")


class Config:
    def __init__(self, env=os.environ):
        self.database_url = env.get("RECOMMENDER_DATABASE_URL", "")
        self.sig_key = env.get("USER_SIG_KEY_RECOMMENDER", "").encode()
        self.backend_key = env.get("INTERNAL_KEY_BACKEND", "").encode()
        self.library_key = env.get("INTERNAL_KEY_LIBRARY", "").encode()
        self.backend_url = env.get("BACKEND_INTERNAL_URL", "http://backend:5000").rstrip("/")
        self.library_url = env.get("LIBRARY_INTERNAL_URL", "http://library:8080").rstrip("/")
        self.rabbit_url = env.get("RABBITMQ_URL", "")
        self.legacy_url = env.get("LEGACY_DATABASE_URL", "")
        self.train_minutes = max(1, int(env.get("REC_TRAIN_INTERVAL_MIN", "30") or 30))
        self.training = env.get("REC_TRAINING", "on") != "off"
        self.port = int(env.get("PORT", "8080"))

    def check(self):
        keys = (self.sig_key, self.backend_key, self.library_key)
        if not self.database_url or any(len(k) < 32 for k in keys):
            log("error", "RECOMMENDER_DATABASE_URL, USER_SIG_KEY_RECOMMENDER, INTERNAL_KEY_BACKEND and INTERNAL_KEY_LIBRARY (>= 32 chars) are required")
            sys.exit(1)


def log(level, msg, **fields):
    line = {"level": level, "msg": msg, "service": "recommender", "time": datetime.now(timezone.utc).isoformat()}
    if request_id.get():
        line["request_id"] = request_id.get()
    line.update(fields)
    print(json.dumps(line, ensure_ascii=False, default=str), file=sys.stderr if level == "error" else sys.stdout, flush=True)


# ---- database ------------------------------------------------------------------------------------------------------

def make_pool(url, size=8):
    # check: a connection killed meanwhile (Postgres restarted) is replaced instead of failing the request
    pool = ConnectionPool(url, min_size=1, max_size=size, kwargs={"row_factory": dict_row, "autocommit": True},
                          check=ConnectionPool.check_connection, open=True)
    pool.wait(timeout=30)
    return pool


def migrate(conn):
    """Applies rec/migrations/*.sql not yet recorded, in name order, under a transaction-scoped lock."""
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(74201002)")
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())")
        for f in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
            if conn.execute("SELECT 1 FROM schema_migrations WHERE name = %s", (f.name,)).fetchone():
                continue
            conn.execute(f.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
            log("info", f"applied migration {f.name}")


# ---- signed headers ------------------------------------------------------------------------------------------------

def internal_header(key: bytes, exp: int) -> str:
    """X-Internal-Auth for a call to another service: "<exp>.<hex hmac('internal|<exp>')>"."""
    return f"{exp}." + hmac.new(key, f"internal|{exp}".encode(), hashlib.sha256).hexdigest()


def user_from(key: bytes, headers, now=None):
    """The gateway's signed identity (X-User-Id/Roles/Exp/Sig, signed by identity with our key): (id, roles) or (None, [])."""
    uid, roles, exp, sig = (headers.get(h, "") for h in ("x-user-id", "x-user-roles", "x-user-exp", "x-user-sig"))
    try:
        if not uid or int(exp) < (now or time.time()):
            return None, []
    except ValueError:
        return None, []
    want = hmac.new(key, f"{uid}|{roles}|{exp}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, sig.lower()):
        return None, []
    return uid, [r for r in roles.split(",") if r]


def call(base: str, key: bytes, method: str, path: str, body=None, timeout=5.0):
    """A signed internal call; returns (status, json). Network errors raise."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={
        "Content-Type": "application/json", "X-Internal-Auth": internal_header(key, int(time.time()) + 120),
        **({"X-Request-Id": request_id.get()} if request_id.get() else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def data_of(base, key, path, timeout=5.0):
    """GET an internal path's {data}; raises unless 200."""
    status, js = call(base, key, "GET", path, timeout=timeout)
    if status != 200:
        raise RuntimeError(f"{base}{path}: HTTP {status}")
    return js.get("data")


def connect(url):
    return psycopg.connect(url, row_factory=dict_row, autocommit=True)
