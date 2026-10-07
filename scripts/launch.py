#!/usr/bin/env python3
"""Launch NovelHub with Docker Compose and verify that every service works.

Usage (from the project root; see scripts/README.md for the full guide):
    python scripts/launch.py            # create .env if needed, build + start, seed, then run checks
    python scripts/launch.py check      # only run the health checks against a running stack
    python scripts/launch.py status     # docker compose ps
    python scripts/launch.py logs [svc] # follow logs (all services or one)
    python scripts/launch.py down       # stop containers (data volumes are kept)

Options for "up": --no-build (reuse existing images), --timeout SECONDS (default 600),
                  --no-seed (skip the sample-data seeders).
The seeders run on every "up" by default. Note that backend/scripts/seed-passwords.js resets
EVERY user's password to "password123", so use --no-seed once real users sign up.
Only the Python standard library is used.
"""
import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root (this file is in scripts/)
ENV_FILE = os.path.join(ROOT, ".env")
ENV_EXAMPLE = os.path.join(ROOT, ".env.example")
MIGRATIONS_DIR = os.path.join(ROOT, "sql", "migrations")

SERVICES = ["postgres", "search", "rabbitmq", "backend", "worker", "export-worker", "frontend", "gateway"]

GREEN, RED, YELLOW, BOLD, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[1m", "\033[0m"
if not sys.stdout.isatty():
    GREEN = RED = YELLOW = BOLD = RESET = ""
elif os.name == "nt":
    os.system("")  # enables ANSI colors in the classic Windows console

# How to re-run this script in hints: "python3" is the Microsoft Store stub on most Windows machines
PY = "python" if os.name == "nt" else "python3"


def info(msg):
    print(f"{BOLD}==>{RESET} {msg}", flush=True)


def ok(msg):
    print(f"  {GREEN}[OK]{RESET}   {msg}", flush=True)


def fail(msg):
    print(f"  {RED}[FAIL]{RESET} {msg}", flush=True)


def warn(msg):
    print(f"  {YELLOW}[WARN]{RESET} {msg}", flush=True)


def die(msg):
    print(f"{RED}error:{RESET} {msg}", file=sys.stderr)
    sys.exit(1)


# --------------------------------------------------------------------------- env

def read_env(path):
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def ensure_env():
    """Create .env from .env.example with random secrets (compose refuses to start without them)."""
    if os.path.exists(ENV_FILE):
        env = read_env(ENV_FILE)
        problems = []
        if len(env.get("JWT_SECRET", "")) < 32 or env.get("JWT_SECRET", "").startswith("change-me"):
            problems.append("JWT_SECRET (needs >= 32 random chars)")
        if not env.get("RABBITMQ_PASSWORD") or env["RABBITMQ_PASSWORD"] == "change-me":
            problems.append("RABBITMQ_PASSWORD")
        if problems:
            die(f".env exists but these values are missing/placeholder: {', '.join(problems)}.\n"
                f"       Fix them, or delete .env and rerun to generate a fresh one.")
        info(".env found, keeping it")
        return env

    if not os.path.exists(ENV_EXAMPLE):
        die(".env.example not found; cannot create .env")

    rabbit_pw = secrets.token_hex(24)
    overrides = {
        "JWT_SECRET": secrets.token_hex(32),
        "RABBITMQ_PASSWORD": rabbit_pw,
        "RABBITMQ_URL": f"amqp://novel:{rabbit_pw}@localhost:5672",
    }
    seen = set()
    out = []
    with open(ENV_EXAMPLE, encoding="utf-8") as f:
        for line in f:
            key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
            if key in overrides:
                if key in seen:  # .env.example defines JWT_SECRET twice; keep one
                    continue
                seen.add(key)
                out.append(f"{key}={overrides[key]}\n")
            else:
                out.append(line)
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(out)
    os.chmod(ENV_FILE, 0o600)
    info("Created .env with random JWT_SECRET and RABBITMQ_PASSWORD")
    return read_env(ENV_FILE)


# ------------------------------------------------------------------------ docker

def compose(*args, capture=False, check=True):
    cmd = ["docker", "compose", *args]
    if capture:
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    else:
        res = subprocess.run(cmd, cwd=ROOT)
    if check and res.returncode != 0:
        if capture:
            sys.stderr.write(res.stderr)
        die(f"command failed: {' '.join(cmd)}")
    return res


def check_docker():
    if not shutil.which("docker"):
        die("docker is not installed (https://docs.docker.com/engine/install/)")
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        die("docker daemon is not reachable (is it running? is your user in the 'docker' group?)")
    if subprocess.run(["docker", "compose", "version"], capture_output=True).returncode != 0:
        die("'docker compose' plugin is missing")


def port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def our_containers_running():
    res = compose("ps", "-q", capture=True, check=False)
    return bool(res.stdout.strip())


def check_ports(env):
    if our_containers_running():
        return  # ports are probably held by our own stack
    ports = {
        "gateway": int(env.get("GATEWAY_PORT", 3000)),
        "backend": int(env.get("PORT", 5000)),
        "postgres": int(env.get("POSTGRES_PORT", 5432)),
        "search": int(env.get("SEARCH_PORT", 9201)),
        "rabbitmq-ui": int(env.get("RABBITMQ_MANAGEMENT_PORT", 15673)),
    }
    busy = [f"{name}:{p}" for name, p in ports.items() if port_busy(p)]
    if busy:
        die(f"ports already in use: {', '.join(busy)}. Stop whatever uses them or change the port in .env")


def container_states():
    """Map compose service -> (state, health)."""
    res = compose("ps", "-a", "--format", "json", capture=True, check=False)
    states = {}
    text = res.stdout.strip()
    if not text:
        return states
    # Newer compose prints one JSON object per line; older prints a JSON array.
    items = json.loads(text) if text.startswith("[") else [json.loads(l) for l in text.splitlines() if l.strip()]
    for c in items:
        states[c.get("Service")] = (c.get("State", ""), c.get("Health", ""))
    return states


def apply_migrations(env):
    """Migrations are idempotent; run them so an older Postgres volume gets the new columns too."""
    if not os.path.isdir(MIGRATIONS_DIR):
        return True
    user = env.get("POSTGRES_USER", "postgres")
    db = env.get("POSTGRES_DB", "novel_platform")
    all_ok = True
    for name in sorted(os.listdir(MIGRATIONS_DIR)):
        if not name.endswith(".sql"):
            continue
        with open(os.path.join(MIGRATIONS_DIR, name), "rb") as f:
            res = subprocess.run(
                ["docker", "compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q",
                 "-U", user, "-d", db],
                cwd=ROOT, stdin=f, capture_output=True,
            )
        if res.returncode == 0:
            ok(f"migration {name}")
        else:
            all_ok = False
            fail(f"migration {name}: {res.stderr.decode(errors='replace').strip()[:300]}")
    return all_ok


# Sample-data seeders from backend/scripts, run in order inside a one-off backend container.
SEEDERS = [
    ("demo passwords (password123)", ["node", "scripts/seed-passwords.js"]),
    ("sample stories, volumes, chapters", ["npx", "tsx", "scripts/seed-stories.ts"]),
    ("fandom posts", ["npx", "tsx", "scripts/seed-fandom.ts"]),
]


def story_count(env):
    res = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-tA",
         "-U", env.get("POSTGRES_USER", "postgres"), "-d", env.get("POSTGRES_DB", "novel_platform"),
         "-c", "SELECT count(*) FROM stories"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return int(res.stdout.strip()) if res.returncode == 0 and res.stdout.strip().isdigit() else None


def run_seeders():
    """The runtime image only ships dist/, so mount the scripts (and src/, which seed-fandom imports)."""
    backend = os.path.join(ROOT, "backend").replace("\\", "/")  # Docker Desktop wants C:/... in -v
    all_ok = True
    for desc, cmd in SEEDERS:
        res = subprocess.run(
            ["docker", "compose", "run", "--rm", "--no-deps", "-T",
             "-v", f"{backend}/scripts:/app/scripts:ro", "-v", f"{backend}/src:/app/src:ro",
             "backend", *cmd],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if res.returncode == 0:
            ok(f"seed {desc}")
        else:
            all_ok = False
            fail(f"seed {desc}: {(res.stderr or res.stdout).strip()[-400:]}")
    # Elasticsearch is fully re-synced only when the backend starts
    compose("restart", "backend", capture=True, check=False)
    return all_ok


# ------------------------------------------------------------------------- http

def http(method, url, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError) as e:
        return None, str(e)


def wait_until(desc, fn, timeout):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            done, last = fn()
        except Exception as e:  # keep polling on transient errors
            done, last = False, str(e)
        if done:
            return True, last
        time.sleep(3)
    return False, f"timed out after {timeout}s waiting for {desc} (last: {last})"


# ----------------------------------------------------------------------- checks

def run_checks(env, timeout, seed=True):
    gw = f"http://localhost:{env.get('GATEWAY_PORT', 3000)}"
    be = f"http://127.0.0.1:{env.get('PORT', 5000)}"
    search = f"http://127.0.0.1:{env.get('SEARCH_PORT', 9201)}"
    results = []

    def record(name, passed, detail="", soft=False):
        results.append((name, passed, soft))
        if passed:
            ok(f"{name} {detail}".rstrip())
        elif soft:
            warn(f"{name} {detail}".rstrip())
        else:
            fail(f"{name} {detail}".rstrip())

    info(f"Waiting for containers (up to {timeout}s)...")

    def containers_ready():
        st = container_states()
        pending = []
        for svc in SERVICES:
            state, health = st.get(svc, ("missing", ""))
            if state in ("exited", "dead", "missing"):
                return True, st  # stop waiting, report below
            if state != "running" or health in ("starting", "unhealthy"):
                pending.append(f"{svc}={state}/{health or '-'}")
        return not pending, ", ".join(pending)

    wait_until("containers", containers_ready, timeout)
    st = container_states()
    for svc in SERVICES:
        state, health = st.get(svc, ("missing", ""))
        good = state == "running" and health in ("", "healthy")
        record(f"container {svc}", good, f"({state}{', ' + health if health else ''})")

    # Backend health (direct, loopback port)
    def backend_up():
        code, body = http("GET", f"{be}/api/v1/health")
        return code == 200, f"{code} {body[:120]}"
    passed, detail = wait_until("backend /health", backend_up, timeout)
    queue = ""
    if passed:
        queue = json.loads(detail.split(" ", 1)[1]).get("queue", "?")
    record("backend  GET /api/v1/health", passed, f"(queue={queue})" if passed else detail)
    if passed and queue != "up":
        record("backend  RabbitMQ connection", False, f"queue={queue}; notifications fall back to inline", soft=True)

    # Migrations need Postgres up; run them once we know the DB is reachable
    if st.get("postgres", ("",))[0] == "running":
        info("Applying idempotent SQL migrations...")
        record("database migrations", apply_migrations(env))

        if seed:
            info(f"Seeding sample data ({story_count(env)} stories in DB before seeding)...")
            record("sample data seeded", run_seeders())
            passed, detail = wait_until("backend restart", backend_up, timeout)
            record("backend  healthy after seeding", passed, "" if passed else detail)

    # Search service (Elasticsearch)
    code, body = http("GET", f"{search}/_cluster/health?wait_for_status=yellow&timeout=5s")
    record("search   GET /_cluster/health", code == 200, f"({code})")

    # Frontend through the gateway (Next.js can take a while on first request)
    def home_up():
        code, body = http("GET", f"{gw}/", timeout=30)
        return code == 200 and "<html" in body.lower(), f"{code}"
    passed, detail = wait_until("home page", home_up, min(timeout, 180))
    record("gateway  GET / (Next.js home page)", passed, "" if passed else detail)

    code, body = http("GET", f"{gw}/api/v1/health")
    record("gateway  GET /api/v1/health (proxy to API)", code == 200, f"({code})")

    # Real data from Postgres
    code, body = http("GET", f"{gw}/api/v1/stories?limit=5")
    count = None
    if code == 200:
        try:
            data = json.loads(body).get("data")
            count = len(data if isinstance(data, list) else data.get("stories", data.get("items", [])))
        except Exception:
            pass
    record("api      GET /api/v1/stories (DB read)", code == 200, f"({code}, {count} stories)" if count is not None else f"({code})")
    if count == 0:
        record("sample data", False, "no stories in DB (sql/database.sql seeds none; see backend/scripts/seed-stories.ts)", soft=True)

    code, body = http("GET", f"{gw}/api/v1/stories/explore?q=a")
    record("api      GET /api/v1/stories/explore?q=a (search)", code == 200, f"({code})")

    # Login with the seeded sample account (README: admin / password123)
    code, body = http("POST", f"{gw}/api/v1/auth/login", {"identifier": "admin", "password": "password123"})
    record("api      POST /api/v1/auth/login (sample admin)", code == 200,
           f"({code})" if code == 200 else f"({code}: seeded hash is not 'password123'; see backend/scripts/seed-passwords.js)",
           soft=code in (400, 401))

    # Pages that exercise server-side rendering
    for path in ("/kham-pha", "/nhom-dich", "/fandom"):
        code, _ = http("GET", f"{gw}{path}", timeout=30)
        record(f"gateway  GET {path}", code == 200, f"({code})", soft=True)

    hard_fail = [n for n, p, soft in results if not p and not soft]
    print()
    if hard_fail:
        print(f"{RED}{BOLD}{len(hard_fail)} check(s) failed.{RESET} Inspect with: {PY} scripts/launch.py logs <service>")
        for svc in SERVICES:
            if st.get(svc, ("missing",))[0] != "running":
                print(f"\n--- last logs of {svc} ---", flush=True)
                compose("logs", "--tail", "30", svc, check=False)
        return False
    print(f"{GREEN}{BOLD}All checks passed. NovelHub is running at {gw}{RESET}")
    print(f"  API health:      {be}/api/v1/health")
    print(f"  RabbitMQ UI:     http://127.0.0.1:{env.get('RABBITMQ_MANAGEMENT_PORT', 15673)}  (user {env.get('RABBITMQ_USER', 'novel')}, password in .env)")
    return True


# ------------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description="Launch and verify NovelHub with Docker Compose")
    p.add_argument("command", nargs="?", default="up", choices=["up", "check", "status", "logs", "down"])
    p.add_argument("service", nargs="?", help="service name for 'logs'")
    p.add_argument("--no-build", action="store_true", help="don't rebuild images on 'up'")
    p.add_argument("--no-seed", dest="seed", action="store_false",
                   help="skip the sample-data seeders (they run by default and reset all passwords)")
    p.add_argument("--timeout", type=int, default=600, help="seconds to wait for services (default 600)")
    a = p.parse_args()

    check_docker()

    if a.command == "down":
        compose("down")
        return
    if a.command == "status":
        compose("ps", "-a")
        return
    if a.command == "logs":
        compose("logs", "-f", "--tail", "100", *([a.service] if a.service else []), check=False)
        return

    env = ensure_env()
    if a.command == "up":
        check_ports(env)
        os.makedirs(os.path.join(ROOT, "uploads"), exist_ok=True)
        info("Building and starting containers (first build can take several minutes)...")
        compose("up", "-d", *([] if a.no_build else ["--build"]))

    # Seeding only happens as part of "up"; "check" stays read-only apart from the idempotent migrations
    seed = a.seed if a.command == "up" else False
    sys.exit(0 if run_checks(env, a.timeout, seed) else 1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
