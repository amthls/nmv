#!/usr/bin/env python3
"""Launch NovelHub with Docker Compose and verify that every service works.

Usage:
    python3 launch.py            # create .env if needed, build + start, then run checks
    python3 launch.py check      # only run the health checks against a running stack
    python3 launch.py status     # docker compose ps
    python3 launch.py logs [svc] # follow logs (all services or one)
    python3 launch.py down       # stop containers (data volumes are kept)
    python3 launch.py crawl      # run the MangaDex importer now, in the foreground
    python3 launch.py update     # git pull, then rebuild only if this machine runs an old build

Old-build detection: after each build a fingerprint of the source (backend/, frontend/, nginx/,
docker-compose.yml) is saved in .build-stamp.json. "up" and "update" compare it with the code on
disk and report when the running images are older than the code. "update" first pulls the latest
commits (fast-forward only, skipped when there are local changes) and rebuilds only when needed.

Options for "up": --no-build (reuse existing images), --timeout SECONDS (default 600),
                  --seed (always run the sample-data seeders), --no-seed (never run them),
                  --crawl-target N (default 100), --no-crawl (don't start scripts/crawler.py),
                  --download-ratio R (default 0.3: after crawling, EPUB/PDF downloads are turned on
                  for a random 30% of the imported stories; 0 = off).
After a successful start, scripts/crawler.py runs in the background (log: logs/crawler.log) and
imports stories (MangaDex, TopTruyen, NetTruyen, Valvrare) until the site has --crawl-target stories; it exits at once
when there are already enough.
By default the seeders run only when the database has no stories yet (fresh install).
Sample accounts (password123) are created by `identity seed-demo`, only into an empty identity_db.
Only the Python standard library is used.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(ROOT, ".env")
ENV_EXAMPLE = os.path.join(ROOT, ".env.example")
MIGRATIONS_DIR = os.path.join(ROOT, "sql", "migrations")
CRAWLER = os.path.join(ROOT, "scripts", "crawler.py")
CRAWLER_LOG = os.path.join(ROOT, "logs", "crawler.log")
MANGA_DIR = os.path.join(ROOT, "uploads", "manga")
BUILD_STAMP = os.path.join(ROOT, ".build-stamp.json")
# What goes into the Docker images; generated folders are skipped
BUILD_INPUTS = ["backend", "frontend", "nginx", "docker-compose.yml"]
SKIP_DIRS = {"node_modules", ".next", "dist", "build", "__pycache__", ".git"}
SKIP_FILES = {"tsconfig.tsbuildinfo"}

SERVICES = ["postgres", "search", "rabbitmq", "backend", "worker", "media", "frontend", "gateway"]

GREEN, RED, YELLOW, BOLD, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[1m", "\033[0m"
if not sys.stdout.isatty():
    GREEN = RED = YELLOW = BOLD = RESET = ""


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
        if not env.get("RABBITMQ_PASSWORD") or env["RABBITMQ_PASSWORD"] == "change-me":
            problems.append("RABBITMQ_PASSWORD")
        if not env.get("REDIS_PASSWORD") or env["REDIS_PASSWORD"] == "change-me":
            # Added after many installs already had a .env: fill it in instead of refusing to start
            with open(ENV_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n# Redis (cache, view counters, shared rate limits, realtime)\nREDIS_PASSWORD={secrets.token_hex(24)}\n")
            info("Added a random REDIS_PASSWORD to .env")
            env = read_env(ENV_FILE)
        # identity service secrets: added to older .env files instead of refusing to start
        added = {k: secrets.token_hex(32) for k in ("IDENTITY_DB_PASSWORD", "IDENTITY_JWT_SECRET", "WORKSPACE_DB_PASSWORD", "MEDIA_DB_PASSWORD", "MESSAGING_DB_PASSWORD", "COMMUNITY_DB_PASSWORD",
                                                         "USER_SIG_KEY_BACKEND", "USER_SIG_KEY_WORKSPACE", "USER_SIG_KEY_MEDIA", "USER_SIG_KEY_MESSAGING", "USER_SIG_KEY_COMMUNITY",
                                                         "INTERNAL_KEY_BACKEND", "INTERNAL_KEY_IDENTITY", "INTERNAL_KEY_WORKSPACE", "INTERNAL_KEY_MESSAGING", "INTERNAL_KEY_COMMUNITY")
                 if not env.get(k) or env[k] == "change-me"}
        if added:
            set_env_values(added)
            info(f"Added random {', '.join(added)} to .env")
            env = read_env(ENV_FILE)
        if not env.get("ELASTIC_PASSWORD") or env["ELASTIC_PASSWORD"] == "change-me":
            set_env_values({"ELASTIC_PASSWORD": secrets.token_hex(24)})
            info("Added a random ELASTIC_PASSWORD to .env")
            env = read_env(ENV_FILE)
        if not env.get("RESTIC_PASSWORD") or env["RESTIC_PASSWORD"] == "change-me":
            # Only ever added, never replaced: a new password can't open the existing backups
            set_env_values({"RESTIC_PASSWORD": secrets.token_hex(24)})
            warn("Added RESTIC_PASSWORD to .env: keep a copy outside this machine, backups are unreadable without it")
            env = read_env(ENV_FILE)
        # Old installs used the public defaults postgres/admin: replace them (sync_postgres_password
        # then applies the new Postgres password to the existing volume)
        weak = {"POSTGRES_PASSWORD": ("", "postgres", "change-me"), "PGADMIN_DEFAULT_PASSWORD": ("", "admin", "change-me")}
        changed = [k for k, bad in weak.items() if env.get(k, "") in bad or env.get(k, "").startswith("change-me")]
        if changed:
            set_env_values({k: secrets.token_hex(24) for k in changed})
            info(f"Replaced default {', '.join(changed)} in .env with random values")
            env = read_env(ENV_FILE)
        if problems:
            die(f".env exists but these values are missing/placeholder: {', '.join(problems)}.\n"
                f"       Fix them, or delete .env and rerun to generate a fresh one.")
        info(".env found, keeping it")
        return env

    if not os.path.exists(ENV_EXAMPLE):
        die(".env.example not found; cannot create .env")

    rabbit_pw = secrets.token_hex(24)
    pg_pw = secrets.token_hex(24)
    overrides = {
        "RABBITMQ_PASSWORD": rabbit_pw,
        "RABBITMQ_URL": f"amqp://novel:{rabbit_pw}@localhost:5672",
        "REDIS_PASSWORD": secrets.token_hex(24),
        "RESTIC_PASSWORD": secrets.token_hex(24),
        "ELASTIC_PASSWORD": secrets.token_hex(24),
        "IDENTITY_DB_PASSWORD": secrets.token_hex(32),
        "IDENTITY_JWT_SECRET": secrets.token_hex(32),
        "USER_SIG_KEY_BACKEND": secrets.token_hex(32),
        "USER_SIG_KEY_WORKSPACE": secrets.token_hex(32),
        "USER_SIG_KEY_MEDIA": secrets.token_hex(32),
        "USER_SIG_KEY_MESSAGING": secrets.token_hex(32),
        "INTERNAL_KEY_BACKEND": secrets.token_hex(32),
        "INTERNAL_KEY_IDENTITY": secrets.token_hex(32),
        "INTERNAL_KEY_WORKSPACE": secrets.token_hex(32),
        "INTERNAL_KEY_MESSAGING": secrets.token_hex(32),
        "INTERNAL_KEY_COMMUNITY": secrets.token_hex(32),
        "WORKSPACE_DB_PASSWORD": secrets.token_hex(32),
        "MEDIA_DB_PASSWORD": secrets.token_hex(32),
        "MESSAGING_DB_PASSWORD": secrets.token_hex(32),
        "COMMUNITY_DB_PASSWORD": secrets.token_hex(32),
        "POSTGRES_PASSWORD": pg_pw,
        "DATABASE_URL": f"postgresql://postgres:{pg_pw}@localhost:5432/novel_platform?schema=public",
        "PGADMIN_DEFAULT_PASSWORD": secrets.token_hex(16),
    }
    seen = set()
    out = []
    with open(ENV_EXAMPLE, encoding="utf-8") as f:
        for line in f:
            key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
            if key in overrides:
                if key in seen:  # keep the first definition of a key
                    continue
                seen.add(key)
                out.append(f"{key}={overrides[key]}\n")
            else:
                out.append(line)
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(out)
    os.chmod(ENV_FILE, 0o600)
    info("Created .env with random identity keys and Postgres/RabbitMQ/Redis/pgAdmin passwords")
    return read_env(ENV_FILE)


def set_env_values(values):
    """Set KEY=value lines in .env (replacing existing ones, appending missing ones)."""
    if "POSTGRES_PASSWORD" in values:  # keep the host-side connection string in step
        old = read_env(ENV_FILE).get("DATABASE_URL", "")
        if old:
            new_url = re.sub(r"(://[^:/@]+:)[^@]*@", lambda m: m.group(1) + values["POSTGRES_PASSWORD"] + "@", old)
            values = {**values, "DATABASE_URL": new_url}
    with open(ENV_FILE, encoding="utf-8") as f:
        lines = f.readlines()
    todo = dict(values)
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
        if key in todo:
            out.append(f"{key}={todo.pop(key)}\n")
        elif key in values:
            continue  # later duplicate of a key we already set
        else:
            out.append(line)
    out += [f"{k}={v}\n" for k, v in todo.items()]
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(out)


# ------------------------------------------------------------------------ docker

def compose(*args, capture=False, check=True):
    cmd = ["docker", "compose", *args]
    if capture:
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
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


def sync_postgres_password(env, timeout):
    """Make the Postgres volume use the password in .env. A volume keeps the password it was created
    with, so changing .env alone would lock the app out. psql over the container's local socket needs
    no password, so this works whatever the old password was."""
    compose("up", "-d", "postgres")
    healthy, last = wait_until("postgres", lambda: (container_states().get("postgres", ("", ""))[1] == "healthy", None), timeout)
    if not healthy:
        die(last)
    user = env.get("POSTGRES_USER", "postgres")
    pw = env["POSTGRES_PASSWORD"].replace("'", "''")
    res = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-q", "-U", user,
         "-d", env.get("POSTGRES_DB", "novel_platform"), "-c", f"ALTER USER \"{user}\" PASSWORD '{pw}'"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if res.returncode != 0:
        die(f"could not set the Postgres password: {res.stderr.strip()[:300]}")


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


# ------------------------------------------------------------------ build updates

def source_fingerprint():
    """Hash of every file the images are built from (paths + contents)."""
    h = hashlib.sha256()
    for item in BUILD_INPUTS:
        top = os.path.join(ROOT, item)
        if os.path.isfile(top):
            files = [top]
        else:
            files = []
            for dirpath, dirnames, filenames in os.walk(top):
                dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
                files += [os.path.join(dirpath, f) for f in sorted(filenames) if f not in SKIP_FILES]
        for path in files:
            h.update(os.path.relpath(path, ROOT).replace(os.sep, "/").encode())
            with open(path, "rb") as f:
                # Normalise line endings so a CRLF checkout matches an LF one
                h.update(f.read().replace(b"\r\n", b"\n"))
    return h.hexdigest()[:16]


def read_stamp():
    try:
        with open(BUILD_STAMP, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def write_stamp(fingerprint):
    with open(BUILD_STAMP, "w", encoding="utf-8") as f:
        json.dump({"fingerprint": fingerprint, "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "commit": git("rev-parse", "--short", "HEAD").stdout.strip()}, f, indent=2)


def build_state(fingerprint):
    """('none' | 'old' | 'current', reason) for the images on this machine vs the code on disk."""
    images = compose("images", "-q", capture=True, check=False).stdout.strip()
    if not images:
        return "none", "no build on this machine yet"
    stamp = read_stamp()
    if not stamp:
        return "old", "the build has no stamp (made by an older launch.py)"
    if stamp.get("fingerprint") != fingerprint:
        return "old", f"the code changed since the build of {stamp.get('built_at', '?')}"
    return "current", f"built {stamp.get('built_at', '?')}"


def git(*args):
    if not shutil.which("git"):
        return subprocess.CompletedProcess(args, 1, "", "git not installed")
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def pull_latest():
    """Fast-forward to the latest commits of the current branch. Never touches local changes."""
    if git("rev-parse", "--is-inside-work-tree").returncode != 0:
        warn("not a git checkout, skipping 'git pull'")
        return
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if git("rev-parse", "--abbrev-ref", "@{u}").returncode != 0:
        warn(f"branch '{branch}' has no upstream, skipping 'git pull'")
        return
    info("Checking for new code (git fetch)...")
    if git("fetch", "--quiet").returncode != 0:
        warn("could not reach the git remote, using the code already on this machine")
        return
    behind = int(git("rev-list", "--count", "HEAD..@{u}").stdout.strip() or 0)
    if behind == 0:
        ok(f"code is up to date with the remote ({branch})")
        return
    if git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        warn(f"{behind} new commit(s) on the remote, but this machine has local changes: commit/stash them, then run update again")
        return
    res = git("pull", "--ff-only", "--quiet")
    if res.returncode != 0:
        warn("git pull failed: " + (res.stderr.strip() or "branch has diverged from the remote"))
        return
    ok(f"pulled {behind} new commit(s) on {branch}")


def apply_migrations(env):
    """Migrations are idempotent; run them so an older Postgres volume gets the new columns too."""
    if not os.path.isdir(MIGRATIONS_DIR):
        return True
    user = env.get("POSTGRES_USER", "postgres")
    db = env.get("POSTGRES_DB", "novel_platform")
    snap = subprocess.run(["docker", "compose", "exec", "-T", "backup", "backup.sh", "run", "pre-migrate"],
                          cwd=ROOT, capture_output=True)
    if snap.returncode == 0:
        ok("backup snapshot before migrations")
    else:
        warn(f"no backup snapshot before migrations: {snap.stdout.decode(errors='replace').strip()[-300:]}")
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


def seed_accounts():
    """Accounts live in identity: a fresh install gets the sample accounts there (only into an empty identity_db)."""
    res = subprocess.run(["docker", "compose", "run", "--rm", "--no-deps", "identity", "seed-demo"], cwd=ROOT, capture_output=True)
    out = (res.stdout + res.stderr).decode(errors="replace")
    summary = next((l for l in out.splitlines() if "seed-demo" in l), out.strip()[-300:])
    return res.returncode == 0, summary


# Sample-data seeders from backend/scripts, run in order inside a one-off backend container.
SEEDERS = [
    ("sample stories, volumes, chapters", ["npx", "tsx", "scripts/seed-stories.ts"]),
    ("fandom posts", ["npx", "tsx", "scripts/seed-fandom.ts"]),
]


def story_count(env):
    res = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-tA",
         "-U", env.get("POSTGRES_USER", "postgres"), "-d", env.get("POSTGRES_DB", "novel_platform"),
         "-c", "SELECT count(*) FROM stories"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return int(res.stdout.strip()) if res.returncode == 0 and res.stdout.strip().isdigit() else None


def run_seeders():
    """The runtime image only ships dist/, so mount the scripts (and src/, which seed-fandom imports)."""
    backend = os.path.join(ROOT, "backend")
    all_ok = True
    for desc, cmd in SEEDERS:
        res = subprocess.run(
            ["docker", "compose", "run", "--rm", "--no-deps", "-T",
             "-v", f"{backend}/scripts:/app/scripts:ro", "-v", f"{backend}/src:/app/src:ro",
             "backend", *cmd],
            cwd=ROOT, capture_output=True, text=True,
        )
        if res.returncode == 0:
            ok(f"seed {desc}")
        else:
            all_ok = False
            fail(f"seed {desc}: {(res.stderr or res.stdout).strip()[-400:]}")
    # novelsearch is fully re-synced only when the backend starts
    compose("restart", "backend", capture=True, check=False)
    return all_ok


# ------------------------------------------------------------------------- http

def http(method, url, body=None, timeout=10, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
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

def run_checks(env, timeout, seed=None):
    # 127.0.0.1, not localhost: the gateway listens on IPv4 loopback only, and Python tries ::1 first (seconds lost per call)
    gw = f"http://127.0.0.1:{env.get('GATEWAY_PORT', 3000)}"
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
        record("backend  RabbitMQ connection", False, f"queue={queue}; notification jobs go straight to messaging", soft=True)

    # Migrations need Postgres up; run them once we know the DB is reachable
    if st.get("postgres", ("",))[0] == "running":
        info("Applying idempotent SQL migrations...")
        record("database migrations", apply_migrations(env))

        count = story_count(env)
        if seed is True or (seed is None and count == 0):
            info(f"Seeding sample data ({count} stories in DB)...")
            record("sample data seeded", run_seeders())
            passed, detail = wait_until("backend restart", backend_up, timeout)
            record("backend  healthy after seeding", passed, "" if passed else detail)
        elif seed is None:
            info(f"Database already has {count} stories, skipping seeders (use --seed to force)")

        passed, detail = seed_accounts()
        record("accounts in identity (seed-demo)", passed, detail)

        url = (f"postgres://{env.get('POSTGRES_USER', 'postgres')}:{env['POSTGRES_PASSWORD']}@postgres:5432/"
               f"{env.get('POSTGRES_DB', 'novel_platform')}")
        res = subprocess.run(["docker", "compose", "run", "--rm", "--no-deps", "-e", f"LEGACY_DATABASE_URL={url}", "messaging", "import-legacy"],
                             cwd=ROOT, capture_output=True)
        out = (res.stdout + res.stderr).decode(errors="replace")
        record("messages in messaging (import-legacy)", res.returncode == 0,
               next((l for l in out.splitlines() if "import-legacy" in l), out.strip()[-300:]))

        res = subprocess.run(["docker", "compose", "run", "--rm", "--no-deps", "-e", f"LEGACY_DATABASE_URL={url}", "community",
                              "node", "dist/server.js", "import-legacy"], cwd=ROOT, capture_output=True)
        out = (res.stdout + res.stderr).decode(errors="replace")
        record("posts and comments in community (import-legacy)", res.returncode == 0,
               next((l for l in out.splitlines() if "import-legacy" in l), out.strip()[-300:]))

        res = subprocess.run(["docker", "compose", "run", "--rm", "workspace", "import"], cwd=ROOT, capture_output=True)
        out = (res.stdout + res.stderr).decode(errors="replace")
        record("chapters in workspace (import)", res.returncode == 0,
               next((l for l in out.splitlines() if "import:" in l), out.strip()[-300:]))

    # Search service
    es_auth = base64.b64encode(f"elastic:{env.get('ELASTIC_PASSWORD', '')}".encode()).decode()
    code, body = http("GET", f"{search}/_cluster/health", headers={"Authorization": f"Basic {es_auth}"})
    status = ""
    try:
        status = json.loads(body).get("status", "")
    except Exception:
        pass
    record("search   GET /_cluster/health", code == 200 and status in ("green", "yellow"), f"({code} {status})".rstrip())

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
    code, body = http("POST", f"{gw}/api/identity/login", {"identifier": "admin", "password": "password123"})
    record("api      POST /api/identity/login (sample admin)", code == 200,
           f"({code})" if code == 200 else f"({code}: admin is not 'password123' or was changed; see identity seed-demo)",
           soft=code in (400, 401))

    # Pages that exercise server-side rendering
    for path in ("/kham-pha", "/nhom-dich", "/fandom"):
        code, _ = http("GET", f"{gw}{path}", timeout=30)
        record(f"gateway  GET {path}", code == 200, f"({code})", soft=True)

    hard_fail = [n for n, p, soft in results if not p and not soft]
    print()
    if hard_fail:
        print(f"{RED}{BOLD}{len(hard_fail)} check(s) failed.{RESET} Inspect with: python3 launch.py logs <service>")
        for svc in SERVICES:
            if st.get(svc, ("missing",))[0] != "running":
                print(f"\n--- last logs of {svc} ---", flush=True)
                compose("logs", "--tail", "30", svc, check=False)
        return False
    print(f"{GREEN}{BOLD}All checks passed. NovelHub is running at {gw}{RESET}")
    print(f"  API health:      {be}/api/v1/health")
    print(f"  RabbitMQ UI:     http://127.0.0.1:{env.get('RABBITMQ_MANAGEMENT_PORT', 15673)}  (user {env.get('RABBITMQ_USER', 'novel')}, password in .env)")
    return True


# ---------------------------------------------------------------------- crawler

def ensure_manga_dir():
    if os.path.isdir(MANGA_DIR):
        ok(f"manga image folder {os.path.relpath(MANGA_DIR, ROOT)}")
    else:
        os.makedirs(MANGA_DIR, exist_ok=True)
        ok(f"created manga image folder {os.path.relpath(MANGA_DIR, ROOT)}")


def start_crawler(target, foreground=False, download_ratio=0.3):
    """Run scripts/crawler.py; it checks the story count itself and exits when the target is met."""
    if not os.path.exists(CRAWLER):
        warn("scripts/crawler.py not found, skipping the importer")
        return
    cmd = [sys.executable, CRAWLER, "--target", str(target), "--download-ratio", str(download_ratio)]
    if foreground:
        subprocess.run(cmd, cwd=ROOT)
        return
    os.makedirs(os.path.dirname(CRAWLER_LOG), exist_ok=True)
    log = open(CRAWLER_LOG, "a", encoding="utf-8")
    log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} launch.py =====\n")
    log.flush()
    kwargs = {"cwd": ROOT, "stdout": log, "stderr": subprocess.STDOUT, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(cmd, **kwargs)
    info(f"Manga importer started in the background (target {target} stories). Log: {os.path.relpath(CRAWLER_LOG, ROOT)}")


# ------------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description="Launch and verify NovelHub with Docker Compose")
    p.add_argument("command", nargs="?", default="up", choices=["up", "update", "check", "status", "logs", "down", "crawl"])
    p.add_argument("service", nargs="?", help="service name for 'logs'")
    p.add_argument("--no-build", action="store_true", help="don't rebuild images on 'up'")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--seed", dest="seed", action="store_true", default=None,
                   help="run the sample-data seeders even if the DB already has stories (resets all passwords!)")
    g.add_argument("--no-seed", dest="seed", action="store_false", help="never run the seeders")
    p.add_argument("--timeout", type=int, default=600, help="seconds to wait for services (default 600)")
    p.add_argument("--crawl-target", type=int, default=100, help="import manga until the site has this many stories")
    p.add_argument("--no-crawl", action="store_true", help="don't start the MangaDex importer after 'up'")
    p.add_argument("--download-ratio", type=float, default=0.3,
                   help="after crawling, turn on EPUB/PDF downloads for this share of imported stories at random (0 = off)")
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

    if a.command == "crawl":
        ensure_manga_dir()
        start_crawler(a.crawl_target, foreground=True, download_ratio=a.download_ratio)
        return

    env = ensure_env()
    starting = a.command in ("up", "update")
    if starting:
        check_ports(env)
        os.makedirs(os.path.join(ROOT, "uploads"), exist_ok=True)
        ensure_manga_dir()
        if a.command == "update":
            pull_latest()
        sync_postgres_password(env, a.timeout)
        fingerprint = source_fingerprint()
        state, reason = build_state(fingerprint)
        if state == "old":
            warn(f"Old build detected: {reason}")
        if a.no_build:
            if state != "current":
                warn("--no-build: keeping the old images, the site will not have the latest changes")
            compose("up", "-d")
        elif a.command == "update" and state == "current":
            ok(f"build is already the latest ({reason}), no rebuild needed")
            compose("up", "-d")
        else:
            info("Building and starting containers with the latest code (first build can take several minutes)...")
            compose("up", "-d", "--build")
            write_stamp(fingerprint)
            ok("build updated to the current code")
    elif a.command == "check":
        state, reason = build_state(source_fingerprint())
        if state == "old":
            warn(f"Running an old build: {reason}. Run 'python launch.py update' to update")

    # Seeding only happens when starting; "check" stays read-only apart from the idempotent migrations
    seed = a.seed if starting else False
    passed = run_checks(env, a.timeout, seed)
    if passed and starting and not a.no_crawl:
        start_crawler(a.crawl_target, download_ratio=a.download_ratio)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
