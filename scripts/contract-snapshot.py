#!/usr/bin/env python3
"""Contract snapshot of every HTTP service through the real gateway (Plan/nestjs-go-layout.md, step 0).

    python scripts/contract-snapshot.py            # run and (over)write scripts/contract-baseline.json
    python scripts/contract-snapshot.py --compare  # run and diff against the baseline (exit 1 on any difference)
    python scripts/contract-snapshot.py --only catalog,community   # limit to some groups of steps

Calls ~150 endpoints as guest / reader (reader_hana) / outsider (reader_yuki) / story owner (tanuki_san) / admin,
plus signed service-to-service calls (through `docker exec novel_catalog node`, which holds every internal key).
For each call it records: HTTP status, content type, the JSON key SHAPE (types, never values) and the `message`.
The point is to prove a refactor changed no URL, status code, JSON field or Vietnamese message.

It creates throwaway data (a story, volume, chapter, drafts, post, comment, report, album, DMs) and removes what it can.
Needs the demo accounts (password `password123`) and the stack on --base.
"""
import argparse
import http.cookiejar
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINE = os.path.join(HERE, "contract-baseline.json")

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:3000")  # not localhost: Windows tries ::1 first
ap.add_argument("--compare", action="store_true")
ap.add_argument("--only", default="")
ap.add_argument("--password", default="password123")
ap.add_argument("--delay", type=float, default=0.06, help="seconds between calls (nginx limit_req allows 20 requests/s per IP)")
args = ap.parse_args()
sys.stdout.reconfigure(encoding="utf-8")
ONLY = {x for x in args.only.split(",") if x}

results = {}
queued_internal = []
ctx = {}
nogo = 0  # steps whose precondition (ids discovered earlier) was missing


# ---------------------------------------------------------------- shapes

def shape(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "bool"
    if isinstance(x, (int, float)):
        return "num"
    if isinstance(x, str):
        return "str"
    if isinstance(x, list):
        out = []
        for it in x[:30]:
            s = shape(it)
            out = [merge(out[0], s)] if out else [s]
        return out
    if isinstance(x, dict):
        return {k: shape(v) for k, v in sorted(x.items())}
    return "?"


def merge(a, b):
    if a == b:
        return a
    if isinstance(a, dict) and isinstance(b, dict):
        out = {}
        for k in sorted(set(a) | set(b)):
            out[k] = merge(a[k], b[k]) if k in a and k in b else ("?" + (json.dumps(a.get(k) if k in a else b.get(k), ensure_ascii=False, sort_keys=True)))
        return out
    if isinstance(a, list) and isinstance(b, list):
        if not a:
            return b
        if not b:
            return a
        return [merge(a[0], b[0])]
    sa, sb = json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True)
    return " | ".join(sorted({sa.strip('"'), sb.strip('"')}))


UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
TS_RE = re.compile(r"\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d(:?\d\d)?)?")
HEX_RE = re.compile(r"\b[0-9a-f]{6,}\b")


def norm_msg(m):
    if not isinstance(m, str):
        return m
    m = UUID_RE.sub("<uuid>", m)
    m = TS_RE.sub("<ts>", m)
    m = HEX_RE.sub("<hex>", m)
    return m


# ---------------------------------------------------------------- http

class Client:
    def __init__(self, name):
        self.name = name
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.id = None

    def cookie(self, n):
        return next((c.value for c in self.jar if c.name == n), "")

    def raw(self, method, path, body=None, headers=None, data=None, ctype="application/json", base=None):
        h = {"User-Agent": "nmv-contract-snapshot"}
        if data is None and body is not None:
            data = json.dumps(body).encode()
        if data is not None or method in ("POST", "PUT", "PATCH"):
            h["Content-Type"] = ctype
        if method != "GET" and self.cookie("nh_csrf"):
            h["X-CSRF-Token"] = self.cookie("nh_csrf")
        h.update(headers or {})
        r = urllib.request.Request((base or args.base) + path, method=method, headers=h, data=data)
        time.sleep(args.delay)
        try:
            with self.op.open(r, timeout=15) as res:
                return res.status, res.headers.get("Content-Type", ""), res.read()
        except urllib.error.HTTPError as e:  # 429 is recorded like any other status
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:  # connection problem: recorded, not fatal
            return 0, "", str(e).encode()
        return 0, "", b""

    def login(self, user):
        st, _, raw = self.raw("POST", "/api/identity/login", {"identifier": user, "password": args.password})
        if st != 200:
            sys.exit(f"login {user} failed: {st} {raw[:200]!r}")
        self.id = json.loads(raw)["data"]["user"]["id"]
        self.username = user


def want(group):
    return not ONLY or group in ONLY


def call(group, name, who, method, path, body=None, **kw):
    """Run one request as `who`, record its contract under `group/name`, return (status, json)."""
    if not want(group):
        return 0, {}
    key = f"{group}: {name}"
    assert key not in results, f"duplicate step {key}"
    st, ctype, raw = who.raw(method, path, body, **kw)
    js = None
    ctype = ctype.split(";")[0].strip()
    if "json" in ctype:
        try:
            js = json.loads(raw or b"null")
        except ValueError:
            js = None
    rec = {"request": norm_msg(f"{who.name} {method} {path.split('?')[0]}"), "status": st, "type": ctype}
    if js is not None:
        rec["shape"] = shape(js)
        if isinstance(js, dict) and "message" in js:
            rec["message"] = norm_msg(js["message"])
    elif ctype and not ctype.startswith("application/json"):
        rec["bytes"] = "some" if raw else "none"
    results[key] = rec
    return st, (js if js is not None else {})


def data(js, *path, default=None):
    cur = js
    for p in path:
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        elif isinstance(cur, list) and isinstance(p, int) and -len(cur) <= p < len(cur):
            cur = cur[p]
        else:
            return default
    return cur


def internal(group, name, svc, method, path, body=None, sig_user=None, host=None):
    """Queue a signed service-to-service call (run later by flush_internal)."""
    if want(group):
        queued_internal.append({"key": f"{group}: {name}", "svc": svc, "method": method, "path": path, "body": body, "sig_user": sig_user, "host": host})


NODE_INTERNAL = r"""
const crypto = require('crypto');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  const calls = JSON.parse(input);
  const hosts = { catalog: 'http://127.0.0.1:5000', identity: 'http://identity:8080', workspace: 'http://workspace:8080',
    messaging: 'http://messaging:8080', community: 'http://community:8080', library: 'http://library:8080', media: 'http://media:8080' };
  const out = [];
  for (const c of calls) {
    const headers = { 'content-type': 'application/json' };
    if (c.sig_user) {
      const exp = String(Math.floor(Date.now() / 1000) + 120);
      const id = c.sig_user.id, roles = c.sig_user.roles.join(',');
      headers['x-user-id'] = id; headers['x-user-roles'] = roles; headers['x-user-exp'] = exp;
      headers['x-user-sig'] = crypto.createHmac('sha256', process.env.USER_SIG_KEY_CATALOG).update(`${id}|${roles}|${exp}`).digest('hex');
    } else if (c.svc !== 'none') {
      const exp = String(Math.floor(Date.now() / 1000) + 120);
      const key = process.env['INTERNAL_KEY_' + c.svc.toUpperCase()];
      headers['x-internal-auth'] = `${exp}.${crypto.createHmac('sha256', key).update('internal|' + exp).digest('hex')}`;
    }
    try {
      const r = await fetch(hosts[c.svc === 'none' ? c.host : c.svc] + c.path, { method: c.method, headers, body: c.body ? JSON.stringify(c.body) : undefined });
      const text = await r.text();
      out.push({ key: c.key, status: r.status, type: (r.headers.get('content-type') || '').split(';')[0], text });
    } catch (e) { out.push({ key: c.key, status: 0, type: '', text: String(e) }); }
  }
  process.stdout.write(JSON.stringify(out));
});
"""


def flush_internal():
    if not queued_internal:
        return
    calls = []
    for c in queued_internal:
        calls.append({**c})
    p = subprocess.run(["docker", "exec", "-i", "novel_catalog", "node", "-e", NODE_INTERNAL], input=json.dumps(calls).encode(), capture_output=True)
    if p.returncode != 0:
        sys.exit("internal calls failed: " + p.stderr.decode(errors="replace")[:500])
    for c, r in zip(queued_internal, json.loads(p.stdout)):
        rec = {"request": norm_msg(f"internal({c['svc']}) {c['method']} {c['path'].split('?')[0]}"), "status": r["status"], "type": r["type"]}
        try:
            js = json.loads(r["text"])
            rec["shape"] = shape(js)
            if isinstance(js, dict) and "message" in js:
                rec["message"] = norm_msg(js["message"])
        except ValueError:
            if r["type"] and "json" not in r["type"]:
                rec["bytes"] = "some" if r["text"] else "none"
        results[c["key"]] = rec
    queued_internal.clear()


# ---------------------------------------------------------------- scenario

def blocks(*texts):
    return [{"type": "paragraph", "text": t} for t in texts]


def read_env(name):
    try:
        for line in open(os.path.join(HERE, "..", ".env"), encoding="utf-8"):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def reset_limits():
    """Clear rate-limit counters (Redis `rl:*`) and nginx limit_req zones (gateway restart) so every run starts equal."""
    pw = read_env("REDIS_PASSWORD")
    cmd = "redis-cli --no-auth-warning --scan --pattern 'rl:*' | xargs -r redis-cli --no-auth-warning DEL >/dev/null"
    subprocess.run(["docker", "exec", "-e", "REDISCLI_AUTH=" + pw, "novel_redis", "sh", "-c", cmd], capture_output=True)
    # per-user limiters of the Go/community/media services live in process memory: restart them too (never catalog)
    subprocess.run(["docker", "restart", "novel_gateway", "novel_community", "novel_media", "novel_identity",
                    "novel_library", "novel_messaging", "novel_workspace"], capture_output=True)
    for _ in range(60):
        out = subprocess.run(["docker", "ps", "--filter", "health=starting", "--format", "{{.Names}}"], capture_output=True, text=True).stdout
        if not out.strip():
            break
        time.sleep(1)
    for _ in range(40):
        try:
            if urllib.request.urlopen(args.base + "/api/v1/health", timeout=3).status == 200:
                return
        except Exception:
            time.sleep(0.5)


def clean_uploads(since):
    """Delete files the run uploaded (anything under ./uploads newer than the start of the run)."""
    root = os.path.join(HERE, "..", "uploads")
    for dp, _, fs in os.walk(root):
        for f in fs:
            fp = os.path.join(dp, f)
            try:
                if os.path.getmtime(fp) >= since:
                    os.remove(fp)
            except OSError:
                pass


def run():
    reset_limits()
    guest, reader, outsider, owner, admin = Client("guest"), Client("reader"), Client("outsider"), Client("owner"), Client("admin")
    reader.login("reader_hana")
    outsider.login("reader_yuki")
    owner.login("tanuki_san")
    admin.login("admin")
    tag = secrets.token_hex(3)
    uid_missing = "99999999-9999-4999-8999-999999999999"

    # ============================================================ catalog: read side
    G = "catalog"
    call(G, "root", guest, "GET", "/api/v1/health")
    call(G, "unknown route", guest, "GET", "/api/v1/nope")
    call(G, "tags", guest, "GET", "/api/v1/tags")
    call(G, "auth/accounts (demo list off)", guest, "GET", "/api/v1/auth/accounts")
    call(G, "auth/me guest", guest, "GET", "/api/v1/auth/me")
    call(G, "auth/me reader", reader, "GET", "/api/v1/auth/me")
    st, js = call(G, "stories list", guest, "GET", "/api/v1/stories?limit=3")
    call(G, "stories list sorted", guest, "GET", "/api/v1/stories?limit=2&sort=views&page=2")
    call(G, "stories explore", guest, "GET", "/api/v1/stories/explore?limit=3")
    call(G, "stories explore query", guest, "GET", "/api/v1/stories/explore?q=a&limit=3")
    call(G, "stories trending", guest, "GET", "/api/v1/stories/trending")
    call(G, "stories recently-updated", guest, "GET", "/api/v1/stories/recently-updated")
    call(G, "stories illustrations", guest, "GET", "/api/v1/stories/illustrations")
    call(G, "stories manageable guest", guest, "GET", "/api/v1/stories/manageable")
    call(G, "stories manageable owner", owner, "GET", "/api/v1/stories/manageable")
    story_slug = data(js, "data", 0, "slug")
    story_id = data(js, "data", 0, "id")
    st, js = call(G, "story by slug guest", guest, "GET", f"/api/v1/stories/{story_slug}")
    call(G, "story by slug reader", reader, "GET", f"/api/v1/stories/{story_slug}")
    call(G, "story missing", guest, "GET", "/api/v1/stories/khong-co-truyen-nay")
    chapters = data(js, "data", "volumes", default=[]) or []
    ch_slug = None
    for v in chapters:
        for c in v.get("chapters", []) or []:
            ch_slug = ch_slug or c.get("slug")
    if not ch_slug:
        ch_slug = data(js, "data", "latest_chapter", "slug")
    call(G, "chapter by slug", guest, "GET", f"/api/v1/stories/{story_slug}/chapters/{ch_slug}")
    call(G, "chapter missing", guest, "GET", f"/api/v1/stories/{story_slug}/chapters/khong-co")
    call(G, "story collaborators", guest, "GET", f"/api/v1/stories/{story_id}/collaborators")
    call(G, "story collaborators bad id", guest, "GET", "/api/v1/stories/khong-phai-uuid/collaborators")
    st, js = call(G, "groups list", guest, "GET", "/api/v1/groups?limit=3")
    group_slug = data(js, "data", 0, "slug")
    group_id = data(js, "data", 0, "id")
    call(G, "groups list reader", reader, "GET", "/api/v1/groups")
    call(G, "group by slug", guest, "GET", f"/api/v1/groups/{group_slug}")
    call(G, "group missing", guest, "GET", "/api/v1/groups/khong-co-nhom")
    call(G, "users list", guest, "GET", "/api/v1/users")
    call(G, "user profile", guest, "GET", "/api/v1/users/reader_hana")
    call(G, "user profile admin view", admin, "GET", "/api/v1/users/reader_hana")
    call(G, "user missing", guest, "GET", "/api/v1/users/khong_co_ai_ca")
    call(G, "profile me guest", guest, "GET", "/api/v1/profile/me")
    call(G, "profile me", reader, "GET", "/api/v1/profile/me")
    call(G, "code G01", guest, "GET", "/api/v1/codes/G01")
    call(G, "code bad", guest, "GET", "/api/v1/codes/zzzz")

    # ============================================================ catalog: writes (validation + happy path)
    call(G, "profile update bad", reader, "PUT", "/api/v1/profile/me", {"display_name": ""})
    call(G, "profile update guest", guest, "PUT", "/api/v1/profile/me", {"display_name": "x"})
    st, js = call(G, "profile me read for update", outsider, "GET", "/api/v1/profile/me")
    prof = data(js, "data", default={}) or {}
    call(G, "profile update", outsider, "PUT", "/api/v1/profile/me",
         {"display_name": prof.get("display_name") or "Reader Yuki", "bio": prof.get("bio") or None})
    call(G, "profile settings bad", outsider, "PUT", "/api/v1/profile/me/settings", {"theme": 5})
    call(G, "profile settings", outsider, "PUT", "/api/v1/profile/me/settings", {})

    call(G, "story create guest", guest, "POST", "/api/v1/stories", {"title": "x"})
    call(G, "story create no title", owner, "POST", "/api/v1/stories", {"title": ""})
    call(G, "story create bad tags", owner, "POST", "/api/v1/stories", {"title": "x", "tags": ["a"]})
    call(G, "story create bad type", owner, "POST", "/api/v1/stories", {"title": "x", "story_type": "zzz"})
    st, js = call(G, "story create", owner, "POST", "/api/v1/stories",
                  {"title": f"Contract {tag}", "synopsis": "<p>Thử hợp đồng</p>", "story_type": "novel", "status": "ongoing", "author_name": "Thử", "allow_download": True})
    sid = data(js, "data", "id")
    sslug = data(js, "data", "slug")
    ctx["sid"] = sid
    if not sid:
        print("  ! story create failed, dependent steps are skipped")
        return finish_early()
    call(G, "story update guest", guest, "PUT", f"/api/v1/stories/{sid}", {"title": "y"})
    call(G, "story update outsider", outsider, "PUT", f"/api/v1/stories/{sid}", {"title": "y"})
    call(G, "story update bad", owner, "PUT", f"/api/v1/stories/{sid}", {"title": ""})
    call(G, "story update", owner, "PUT", f"/api/v1/stories/{sid}", {"title": f"Contract {tag} v2", "status": "ongoing"})
    call(G, "story update missing", owner, "PUT", f"/api/v1/stories/{uid_missing}", {"title": "y"})
    call(G, "story read own", owner, "GET", f"/api/v1/stories/{sslug}")
    call(G, "story collaborators add outsider-denied", outsider, "POST", f"/api/v1/stories/{sid}/collaborators", {"identifier": "reader_hana"})
    call(G, "story collaborators add missing user", owner, "POST", f"/api/v1/stories/{sid}/collaborators", {"identifier": "khong_co_ai_ca"})
    call(G, "story collaborators add", owner, "POST", f"/api/v1/stories/{sid}/collaborators", {"identifier": "reader_yuki"})
    call(G, "story collaborators list", guest, "GET", f"/api/v1/stories/{sid}/collaborators")

    call(G, "volume create guest", guest, "POST", f"/api/v1/stories/{sid}/volumes", {"title": "T"})
    call(G, "volume create denied", reader, "POST", f"/api/v1/stories/{sid}/volumes", {"title": "T"})
    call(G, "volume create bad number", owner, "POST", f"/api/v1/stories/{sid}/volumes", {"volume_number": 0})
    call(G, "volume create dup", owner, "POST", f"/api/v1/stories/{sid}/volumes", {"volume_number": 1})
    st, js = call(G, "volume create", owner, "POST", f"/api/v1/stories/{sid}/volumes", {"title": "Tập thử"})
    vid = data(js, "data", "id")
    st, js = call(G, "volume create 3", owner, "POST", f"/api/v1/stories/{sid}/volumes", {"title": "Tập ba"})
    vid3 = data(js, "data", "id")
    call(G, "volume update denied", reader, "PUT", f"/api/v1/volumes/{vid}", {"title": "Z"})
    call(G, "volume update", owner, "PUT", f"/api/v1/volumes/{vid}", {"title": "Tập thử 2", "description": "mô tả"})
    call(G, "volume update missing", owner, "PUT", f"/api/v1/volumes/{uid_missing}", {"title": "Z"})
    call(G, "volume reorder bad", owner, "PUT", f"/api/v1/stories/{sid}/volumes/reorder", {"order": "x"})
    call(G, "volume reorder", owner, "PUT", f"/api/v1/stories/{sid}/volumes/reorder", {"volume_ids": [vid3, vid]})
    call(G, "volume delete denied", reader, "DELETE", f"/api/v1/volumes/{vid3}")
    call(G, "volume delete", owner, "DELETE", f"/api/v1/volumes/{vid3}")

    # chapters (publishing goes through the workspace service)
    call(G, "chapter publish guest", guest, "POST", "/api/v1/chapters/submissions", {"story_id": sid, "title": "x"})
    call(G, "chapter publish bad story", owner, "POST", "/api/v1/chapters/submissions", {"title": "x"})
    call(G, "chapter publish bad number", owner, "POST", "/api/v1/chapters/submissions",
         {"story_id": sid, "title": "x", "chapter_number": -1, "content_blocks": blocks("a")})
    call(G, "chapter publish empty", owner, "POST", "/api/v1/chapters/submissions", {"story_id": sid, "title": "x", "chapter_number": 1})
    call(G, "chapter publish denied", reader, "POST", "/api/v1/chapters/submissions",
         {"story_id": sid, "title": "x", "chapter_number": 1, "content_blocks": blocks("a")})
    st, js = call(G, "chapter publish", owner, "POST", "/api/v1/chapters/submissions",
                  {"story_id": sid, "title": f"Chương thử {tag}", "chapter_number": 1, "volume_id": vid,
                   "content_blocks": blocks("Đoạn một.", "Đoạn hai."), "intro_note": "mở đầu"})
    cid = data(js, "data", "id")
    cslug = data(js, "data", "slug")
    call(G, "chapter publish dup number", owner, "POST", "/api/v1/chapters/submissions",
         {"story_id": sid, "title": "x", "chapter_number": 1, "content_blocks": blocks("a")})
    st, js = call(G, "chapter publish auto number", owner, "POST", "/api/v1/chapters/submissions",
                  {"story_id": sid, "title": "Chương hai", "content_blocks": blocks("Nội dung hai.")})
    cid2 = data(js, "data", "id")
    st, js = call(G, "chapter legacy draft submission", owner, "POST", "/api/v1/chapters/submissions",
                  {"story_id": sid, "title": "Nháp cũ", "chapter_number": 7, "is_draft": True, "content_blocks": blocks("x")})
    time.sleep(1.5)  # the reading copy arrives through an event
    call(G, "chapter read", guest, "GET", f"/api/v1/stories/{sslug}/chapters/{cslug}")
    call(G, "chapter edit guest", guest, "GET", f"/api/v1/chapters/{cid}")
    call(G, "chapter edit denied", reader, "GET", f"/api/v1/chapters/{cid}")
    call(G, "chapter edit bad id", owner, "GET", "/api/v1/chapters/zzz")
    call(G, "chapter edit missing", owner, "GET", f"/api/v1/chapters/{uid_missing}")
    st, ed = call(G, "chapter edit load", owner, "GET", f"/api/v1/chapters/{cid}")
    ver = data(ed, "data", "version", default=1)
    base = {"title": f"Chương thử {tag}", "chapter_number": 1, "volume_id": vid}
    call(G, "chapter update denied", reader, "PUT", f"/api/v1/chapters/{cid}", {**base, "content_blocks": blocks("z"), "expected_version": ver})
    call(G, "chapter update bad", owner, "PUT", f"/api/v1/chapters/{cid}", {**base, "title": "", "content_blocks": blocks("z"), "expected_version": ver})
    st, js = call(G, "chapter update", owner, "PUT", f"/api/v1/chapters/{cid}",
                  {**base, "content_blocks": blocks("Đoạn một sửa.", "Đoạn hai."), "expected_version": ver})
    call(G, "chapter update stale", owner, "PUT", f"/api/v1/chapters/{cid}",
         {**base, "content_blocks": blocks("Cũ."), "expected_version": ver})
    call(G, "chapter delete denied", reader, "DELETE", f"/api/v1/chapters/{cid2}")

    # drafts
    call(G, "draft create guest", guest, "POST", "/api/v1/drafts", {"chapter_id": cid})
    call(G, "draft create bad", owner, "POST", "/api/v1/drafts", {})
    call(G, "draft create denied", reader, "POST", "/api/v1/drafts", {"chapter_id": cid})
    call(G, "draft create missing chapter", owner, "POST", "/api/v1/drafts", {"chapter_id": uid_missing})
    st, js = call(G, "draft create from chapter", owner, "POST", "/api/v1/drafts", {"chapter_id": cid})
    did = data(js, "data", "id")
    st, js = call(G, "draft create new", outsider, "POST", "/api/v1/drafts",
                  {"story_id": sid, "title": "Chương đề xuất", "chapter_number": 10, "content_blocks": blocks("Đề xuất.")})
    pid = data(js, "data", "id")
    call(G, "draft create new empty title", outsider, "POST", "/api/v1/drafts", {"story_id": sid, "title": "", "chapter_number": 11})
    call(G, "draft save bad id", owner, "PUT", "/api/v1/drafts/zzz", {})
    call(G, "draft save", owner, "PUT", f"/api/v1/drafts/{did}", {**base, "content_blocks": blocks("Nháp sửa.", "Đoạn hai."), "expected_version": 1})
    call(G, "draft save stale", owner, "PUT", f"/api/v1/drafts/{did}", {**base, "content_blocks": blocks("Nháp cũ."), "expected_version": 1})
    call(G, "draft save stranger", reader, "PUT", f"/api/v1/drafts/{did}", {**base, "content_blocks": blocks("x"), "expected_version": 2})
    call(G, "draft share bad", owner, "POST", f"/api/v1/drafts/{did}/share", {})
    call(G, "draft share", owner, "POST", f"/api/v1/drafts/{did}/share", {"username": "reader_yuki", "can_edit": False})
    call(G, "draft share missing user", owner, "POST", f"/api/v1/drafts/{did}/share", {"username": "khong_co_ai_ca"})
    call(G, "draft submit guest", guest, "POST", f"/api/v1/drafts/{pid}/submit")
    call(G, "draft submit", outsider, "POST", f"/api/v1/drafts/{pid}/submit", {"note": "Thêm đoạn"})
    call(G, "draft publish denied", reader, "POST", f"/api/v1/drafts/{did}/publish")
    call(G, "draft return denied", outsider, "POST", f"/api/v1/drafts/{pid}/return", {"note": "x"})
    call(G, "draft return", owner, "POST", f"/api/v1/drafts/{pid}/return", {"note": "Xem lại"})
    call(G, "draft withdraw missing", owner, "POST", f"/api/v1/drafts/{uid_missing}/withdraw")
    call(G, "draft withdraw not submitted", outsider, "POST", f"/api/v1/drafts/{pid}/withdraw")
    call(G, "draft transfer bad", owner, "POST", f"/api/v1/drafts/{did}/transfer", {})
    call(G, "draft offer not copy", owner, "POST", f"/api/v1/drafts/{did}/offer")
    call(G, "draft publish schedule bad", owner, "POST", f"/api/v1/drafts/{did}/publish", {"publish_at": "2000-01-01T00:00:00Z"})
    call(G, "draft publish", owner, "POST", f"/api/v1/drafts/{did}/publish")
    call(G, "draft publish again", owner, "POST", f"/api/v1/drafts/{did}/publish")

    # groups
    call(G, "group create guest", guest, "POST", "/api/v1/groups", {"name": "x"})
    call(G, "group create bad", reader, "POST", "/api/v1/groups", {"name": ""})
    call(G, "group update denied", reader, "PUT", f"/api/v1/groups/{group_id}", {"description": "x"})
    call(G, "group workflow denied", reader, "PUT", f"/api/v1/groups/{group_id}/workflow", {"steps": ["translate"]})
    call(G, "group member add denied", reader, "POST", f"/api/v1/groups/{group_id}/members", {"username": "reader_hana"})
    call(G, "group member role denied", reader, "PUT", f"/api/v1/groups/{group_id}/members/{reader.id}", {"role": "mod"})
    call(G, "group member remove denied", reader, "DELETE", f"/api/v1/groups/{group_id}/members/{outsider.id}")
    call(G, "group join request guest", guest, "POST", f"/api/v1/groups/{group_id}/join-requests", {"message": "x"})
    call(G, "group join requests list denied", reader, "GET", f"/api/v1/groups/{group_id}/join-requests")
    call(G, "group join request missing group", reader, "POST", f"/api/v1/groups/{uid_missing}/join-requests", {"message": "x"})
    call(G, "group join request cancel none", reader, "DELETE", f"/api/v1/groups/{group_id}/join-requests/me")
    call(G, "group join request approve denied", reader, "POST", f"/api/v1/groups/{group_id}/join-requests/{uid_missing}/approve")
    call(G, "group join request reject denied", reader, "POST", f"/api/v1/groups/{group_id}/join-requests/{uid_missing}/reject")
    st, js = call(G, "group create", outsider, "POST", "/api/v1/groups", {"name": f"Nhóm thử {tag}", "description": "Thử hợp đồng"})
    gid = data(js, "data", "id")
    gslug = data(js, "data", "slug")
    if gid:
        call(G, "group update", outsider, "PUT", f"/api/v1/groups/{gid}", {"description": "Mô tả mới"})
        call(G, "group workflow bad", outsider, "PUT", f"/api/v1/groups/{gid}/workflow", {"steps": "x"})
        call(G, "group workflow", outsider, "PUT", f"/api/v1/groups/{gid}/workflow", {"steps": ["translate", "edit"]})
        call(G, "group member add", outsider, "POST", f"/api/v1/groups/{gid}/members", {"username": "reader_hana"})
        call(G, "group member add missing", outsider, "POST", f"/api/v1/groups/{gid}/members", {"username": "khong_co_ai_ca"})
        call(G, "group member role", outsider, "PUT", f"/api/v1/groups/{gid}/members/{reader.id}", {"role": "mod"})
        call(G, "group read", guest, "GET", f"/api/v1/groups/{gslug}")
        call(G, "group member remove", outsider, "DELETE", f"/api/v1/groups/{gid}/members/{reader.id}")
        call(G, "group join request", owner, "POST", f"/api/v1/groups/{gid}/join-requests", {"message": "Cho mình vào"})
        call(G, "group join request again", owner, "POST", f"/api/v1/groups/{gid}/join-requests", {"message": "Cho mình vào"})
        st, js = call(G, "group join requests list", outsider, "GET", f"/api/v1/groups/{gid}/join-requests")
        rq = data(js, "data", 0, "id")
        call(G, "group join request reject", outsider, "POST", f"/api/v1/groups/{gid}/join-requests/{rq}/reject")
        call(G, "group join request approve again", outsider, "POST", f"/api/v1/groups/{gid}/join-requests/{rq}/approve")
        call(G, "group join request cancel", owner, "DELETE", f"/api/v1/groups/{gid}/join-requests/me")

    # moderation of the story (admin takes it down and back)
    call(G, "story remove denied", reader, "POST", f"/api/v1/stories/{sid}/remove", {"reason": "x"})
    call(G, "story remove", admin, "POST", f"/api/v1/stories/{sid}/remove", {"reason": "thử hợp đồng"})
    call(G, "story removed read", guest, "GET", f"/api/v1/stories/{sslug}")
    call(G, "story restore denied", reader, "POST", f"/api/v1/stories/{sid}/restore")
    call(G, "story restore", admin, "POST", f"/api/v1/stories/{sid}/restore")

    # ============================================================ community (via /api/community)
    G = "community"
    C = "/api/community"
    call(G, "health", guest, "GET", f"{C}/health")
    call(G, "ready", guest, "GET", f"{C}/ready")
    call(G, "unknown route", guest, "GET", f"{C}/nope")
    call(G, "posts feed", guest, "GET", f"{C}/posts?limit=5")
    call(G, "posts feed query", guest, "GET", f"{C}/posts?q=a&sort=popular&category=discussion&page=2")
    call(G, "posts sidebar", guest, "GET", f"{C}/posts/sidebar")
    call(G, "posts sidebar reader", reader, "GET", f"{C}/posts/sidebar")
    call(G, "post missing", guest, "GET", f"{C}/posts/khong-co-bai")
    call(G, "post create guest", guest, "POST", f"{C}/posts", {"title": "x", "content": "<p>x</p>"})
    call(G, "post create bad", reader, "POST", f"{C}/posts", {"title": "", "content": ""})
    st, js = call(G, "post create", reader, "POST", f"{C}/posts", {"title": f"Bài thử {tag}", "content": "<p>Nội dung thử</p>", "category": "discussion"})
    post_id, post_slug = data(js, "data", "id"), data(js, "data", "slug")
    call(G, "post read", guest, "GET", f"{C}/posts/{post_slug}")
    call(G, "post update denied", outsider, "PUT", f"{C}/posts/{post_id}", {"title": "y", "content": "<p>y</p>"})
    call(G, "post update bad", reader, "PUT", f"{C}/posts/{post_id}", {"title": "", "content": "<p>y</p>"})
    call(G, "post update", reader, "PUT", f"{C}/posts/{post_id}", {"title": f"Bài thử {tag} sửa", "content": "<p>Sửa</p>", "category": "discussion"})
    call(G, "post update missing", reader, "PUT", f"{C}/posts/{uid_missing}", {"title": "y", "content": "<p>y</p>"})
    call(G, "post react guest", guest, "POST", f"{C}/posts/{post_id}/react", {"reaction": "love"})
    call(G, "post react bad", outsider, "POST", f"{C}/posts/{post_id}/react", {"reaction": "zzz"})
    call(G, "post react", outsider, "POST", f"{C}/posts/{post_id}/react", {"reaction": "love"})
    call(G, "post react remove", outsider, "POST", f"{C}/posts/{post_id}/react", {"reaction": "love"})
    call(G, "post pin denied", reader, "POST", f"{C}/posts/{post_id}/pin")
    call(G, "post pin", admin, "POST", f"{C}/posts/{post_id}/pin")
    call(G, "post unpin", admin, "POST", f"{C}/posts/{post_id}/pin")
    call(G, "post mute", outsider, "POST", f"{C}/posts/{post_id}/mute")
    call(G, "post unmute", outsider, "POST", f"{C}/posts/{post_id}/mute")
    call(G, "post reject denied", reader, "POST", f"{C}/posts/{post_id}/reject", {"reason": "x"})
    call(G, "post reject", admin, "POST", f"{C}/posts/{post_id}/reject", {"reason": "thử"})
    call(G, "post removed read", guest, "GET", f"{C}/posts/{post_slug}")
    call(G, "post approve denied", reader, "POST", f"{C}/posts/{post_id}/approve")
    call(G, "post approve", admin, "POST", f"{C}/posts/{post_id}/approve")
    call(G, "comments list bad", guest, "GET", f"{C}/comments")
    call(G, "comments list", guest, "GET", f"{C}/comments?target_type=post&target_id={post_id}")
    call(G, "comment create guest", guest, "POST", f"{C}/comments", {"target_type": "post", "target_id": post_id, "content": "x"})
    call(G, "comment create bad", reader, "POST", f"{C}/comments", {"target_type": "post", "target_id": post_id, "content": ""})
    call(G, "comment create bad type", reader, "POST", f"{C}/comments", {"target_type": "zzz", "target_id": post_id, "content": "x"})
    call(G, "comment create missing post", reader, "POST", f"{C}/comments", {"target_type": "post", "target_id": uid_missing, "content": "x"})
    st, js = call(G, "comment create", outsider, "POST", f"{C}/comments", {"target_type": "post", "target_id": post_id, "content": f"Bình luận {tag}"})
    com = data(js, "data", "id")
    st, js = call(G, "comment reply", reader, "POST", f"{C}/comments", {"target_type": "post", "target_id": post_id, "parent_id": com, "content": "Trả lời"})
    com2 = data(js, "data", "id")
    call(G, "comment chapter", outsider, "POST", f"{C}/comments", {"target_type": "chapter", "target_id": cid, "content": f"Chương hay {tag}"})
    st, js = call(G, "comment story", outsider, "POST", f"{C}/comments", {"target_type": "story", "target_id": sid, "content": "Truyện hay"})
    com3 = data(js, "data", "id")
    call(G, "comment like", reader, "POST", f"{C}/comments/{com}/like")
    call(G, "comment unlike", reader, "POST", f"{C}/comments/{com}/like")
    call(G, "comment like guest", guest, "POST", f"{C}/comments/{com}/like")
    call(G, "comment update denied", reader, "PUT", f"{C}/comments/{com}", {"content": "x"})
    call(G, "comment update bad", outsider, "PUT", f"{C}/comments/{com}", {"content": ""})
    call(G, "comment update", outsider, "PUT", f"{C}/comments/{com}", {"content": f"Sửa {tag}"})
    call(G, "comments chapter list", guest, "GET", f"{C}/comments?target_type=chapter&target_id={cid}")
    call(G, "comments story list", guest, "GET", f"{C}/comments?target_type=story&target_id={sid}")
    call(G, "report create guest", guest, "POST", f"{C}/reports", {"target_type": "post", "target_id": post_id, "reason": "spam"})
    call(G, "report bad type", outsider, "POST", f"{C}/reports", {"target_type": "zzz", "target_id": post_id, "reason": "spam"})
    call(G, "report bad reason", outsider, "POST", f"{C}/reports", {"target_type": "post", "target_id": post_id, "reason": "zzz"})
    call(G, "report bad id", outsider, "POST", f"{C}/reports", {"target_type": "post", "target_id": "x", "reason": "spam"})
    call(G, "report missing target", outsider, "POST", f"{C}/reports", {"target_type": "post", "target_id": uid_missing, "reason": "spam"})
    st, js = call(G, "report create", outsider, "POST", f"{C}/reports", {"target_type": "comment", "target_id": com2, "reason": "spam", "description": "thử"})
    rid = data(js, "data", "id")
    call(G, "report duplicate", outsider, "POST", f"{C}/reports", {"target_type": "comment", "target_id": com2, "reason": "spam"})
    call(G, "reports list guest", guest, "GET", f"{C}/reports")
    call(G, "reports list own", outsider, "GET", f"{C}/reports")
    call(G, "reports list admin", admin, "GET", f"{C}/reports?status=pending&limit=5")
    call(G, "reports list admin filtered", admin, "GET", f"{C}/reports?status=all&type=post&q=a")
    call(G, "report resolve denied", reader, "PUT", f"{C}/reports/{rid}/resolve", {"status": "dismissed"})
    call(G, "report resolve bad", admin, "PUT", f"{C}/reports/{rid}/resolve", {"status": "zzz"})
    call(G, "report resolve", admin, "PUT", f"{C}/reports/{rid}/resolve", {"status": "dismissed", "resolution_note": "thử"})
    call(G, "report resolve missing", admin, "PUT", f"{C}/reports/{uid_missing}/resolve", {"status": "dismissed"})
    call(G, "removed guest", guest, "GET", f"{C}/moderation/removed")
    call(G, "removed denied", reader, "GET", f"{C}/moderation/removed")
    call(G, "removed admin", admin, "GET", f"{C}/moderation/removed")
    call(G, "removed admin stories", admin, "GET", f"{C}/moderation/removed?type=story&q=a")
    call(G, "comment delete denied", reader, "DELETE", f"{C}/comments/{com3}")
    call(G, "comment delete story", outsider, "DELETE", f"{C}/comments/{com3}")
    call(G, "comment delete reply", reader, "DELETE", f"{C}/comments/{com2}")
    call(G, "comment delete", outsider, "DELETE", f"{C}/comments/{com}")
    call(G, "comment delete missing", outsider, "DELETE", f"{C}/comments/{uid_missing}")
    call(G, "post delete denied", outsider, "DELETE", f"{C}/posts/{post_id}")
    call(G, "post delete", reader, "DELETE", f"{C}/posts/{post_id}")
    call(G, "post delete again", reader, "DELETE", f"{C}/posts/{post_id}")

    # ============================================================ media (via /api/media and /uploads)
    G = "media"
    M = "/api/media"
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082")

    def multipart(field, filename, payload, ctype="image/png", fields=None):
        b = "----contract" + secrets.token_hex(8)
        pre = b"".join(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in (fields or {}).items())
        body = pre + (f"--{b}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + payload + f"\r\n--{b}--\r\n".encode()
        return body, f"multipart/form-data; boundary={b}"

    call(G, "health", guest, "GET", f"{M}/health")
    call(G, "ready", guest, "GET", f"{M}/ready")
    call(G, "unknown route", guest, "GET", f"{M}/nope")
    body, ct = multipart("image", "a.png", png)
    call(G, "upload image guest", guest, "POST", f"{M}/upload/image", data=body, ctype=ct)
    call(G, "upload image", reader, "POST", f"{M}/upload/image", data=body, ctype=ct)
    body, ct = multipart("image", "a.txt", b"hello", "text/plain")
    call(G, "upload image bad type", reader, "POST", f"{M}/upload/image", data=body, ctype=ct)
    body, ct = multipart("zzz", "a.png", png)
    call(G, "upload image bad field", reader, "POST", f"{M}/upload/image", data=body, ctype=ct)
    call(G, "upload image none", reader, "POST", f"{M}/upload/image", {})
    body, ct = multipart("images", "a.png", png)
    call(G, "upload images", reader, "POST", f"{M}/upload/images", data=body, ctype=ct)
    body, ct = multipart("pages", "a.png", png, fields={"story_id": uid_missing})
    call(G, "upload manga pages missing story", reader, "POST", f"{M}/upload/manga-pages", data=body, ctype=ct)
    body, ct = multipart("pages", "a.png", png, fields={"story_id": sid})
    call(G, "upload manga pages", reader, "POST", f"{M}/upload/manga-pages", data=body, ctype=ct)
    body, ct = multipart("image", "b.png", png)
    st, js = call(G, "upload image for serving", reader, "POST", f"{M}/upload/image", data=body, ctype=ct)
    url = data(js, "data", "url") or data(js, "data", "image_url") or ""
    if isinstance(url, str) and url.startswith("/uploads/"):
        call(G, "uploads static", guest, "GET", url)
        call(G, "uploads resized", guest, "GET", url + "?w=64")
        call(G, "uploads resized bad", guest, "GET", url + "?w=abc")
    call(G, "uploads missing", guest, "GET", "/uploads/khong-co/khong-co.png")
    call(G, "export create missing story", guest, "POST", f"{M}/stories/khong-co-truyen/exports", {"format": "epub", "mode": "merged"})
    call(G, "export create bad mode", guest, "POST", f"{M}/stories/{sslug}/exports", {"format": "epub"})
    call(G, "export create bad", guest, "POST", f"{M}/stories/{sslug}/exports", {"format": "zzz"})
    st, js = call(G, "export create", reader, "POST", f"{M}/stories/{sslug}/exports", {"format": "epub", "mode": "merged", "chapter_ids": [cid]})
    eid = data(js, "data", "id")
    call(G, "export get bad", guest, "GET", f"{M}/exports/zzz")
    call(G, "export get missing", guest, "GET", f"{M}/exports/{uid_missing}")
    if eid:
        for _ in range(15):
            st, js = reader.raw("GET", f"{M}/exports/{eid}")[0], None
            s2, _, raw = reader.raw("GET", f"{M}/exports/{eid}")
            try:
                if json.loads(raw)["data"]["status"] in ("ready", "failed"):
                    break
            except Exception:
                break
            time.sleep(0.5)
        call(G, "export get", reader, "GET", f"{M}/exports/{eid}")
        call(G, "export download", reader, "GET", f"{M}/exports/{eid}/download")
    call(G, "export download missing", guest, "GET", f"{M}/exports/{uid_missing}/download")

    # ============================================================ library (via /api/library)
    G = "library"
    L = "/api/library"
    call(G, "health", guest, "GET", f"{L}/health")
    call(G, "ready", guest, "GET", f"{L}/ready")
    call(G, "unknown route", guest, "GET", f"{L}/nope")
    call(G, "history guest", guest, "GET", f"{L}/history")
    call(G, "history", reader, "GET", f"{L}/history")
    call(G, "history save bad", reader, "POST", f"{L}/history", {})
    call(G, "history save", reader, "POST", f"{L}/history", {"chapter_id": cid, "scroll_position": 40})
    call(G, "history save missing chapter", reader, "POST", f"{L}/history", {"chapter_id": uid_missing})
    call(G, "history list", reader, "GET", f"{L}/history?limit=5&page=1")
    call(G, "history merge bad", reader, "POST", f"{L}/history/merge", {"items": "x"})
    call(G, "history merge", reader, "POST", f"{L}/history/merge", {"items": [{"chapter_id": cid, "read_at": "2020-01-01T00:00:00Z", "scroll_position": 90}]})
    call(G, "bookmarks guest", guest, "GET", f"{L}/bookmarks")
    call(G, "bookmarks", reader, "GET", f"{L}/bookmarks")
    call(G, "bookmark create bad", reader, "POST", f"{L}/bookmarks", {})
    st, js = call(G, "bookmark create", reader, "POST", f"{L}/bookmarks", {"story_id": sid, "chapter_id": cid, "line_index": 0, "line_text": "Đoạn một sửa."})
    bm = data(js, "data", "id")
    call(G, "bookmark delete denied", outsider, "DELETE", f"{L}/bookmarks/{bm}")
    call(G, "bookmark delete", reader, "DELETE", f"{L}/bookmarks/{bm}")
    call(G, "bookmark delete missing", reader, "DELETE", f"{L}/bookmarks/{uid_missing}")
    call(G, "favorites guest", guest, "GET", f"{L}/favorites")
    call(G, "favorite toggle bad", reader, "POST", f"{L}/favorites/toggle", {})
    call(G, "favorite toggle", reader, "POST", f"{L}/favorites/toggle", {"story_id": sid})
    call(G, "favorite status", reader, "GET", f"{L}/favorites/status/{sid}")
    call(G, "favorite status guest", guest, "GET", f"{L}/favorites/status/{sid}")
    call(G, "favorites", reader, "GET", f"{L}/favorites")
    call(G, "favorite toggle off", reader, "POST", f"{L}/favorites/toggle", {"story_id": sid})
    call(G, "albums me guest", guest, "GET", f"{L}/albums/me")
    call(G, "albums me", reader, "GET", f"{L}/albums/me")
    call(G, "albums saved", reader, "GET", f"{L}/albums/saved")
    call(G, "albums by story", reader, "GET", f"{L}/albums/by-story/{sid}")
    call(G, "albums by story guest", guest, "GET", f"{L}/albums/by-story/{sid}")
    call(G, "album create guest", guest, "POST", f"{L}/albums", {"name": "x"})
    call(G, "album create bad", reader, "POST", f"{L}/albums", {"name": ""})
    st, js = call(G, "album create", reader, "POST", f"{L}/albums", {"name": f"Album {tag}", "is_public": True, "story_id": sid})
    aid = data(js, "data", "id")
    call(G, "album read guest", guest, "GET", f"{L}/albums/{aid}")
    call(G, "album read missing", guest, "GET", f"{L}/albums/{uid_missing}")
    call(G, "album update denied", outsider, "PUT", f"{L}/albums/{aid}", {"name": "z"})
    call(G, "album update", reader, "PUT", f"{L}/albums/{aid}", {"name": f"Album {tag} sửa", "description": "mô tả"})
    call(G, "album add story bad", reader, "POST", f"{L}/albums/{aid}/stories", {})
    call(G, "album add story", reader, "POST", f"{L}/albums/{aid}/stories", {"story_id": sid})
    call(G, "album remove story", reader, "DELETE", f"{L}/albums/{aid}/stories/{sid}")
    call(G, "album share reset", reader, "POST", f"{L}/albums/{aid}/share-link/reset")
    call(G, "album visibility all", reader, "PUT", f"{L}/albums/me/visibility", {"is_public": True})
    call(G, "album save", outsider, "POST", f"{L}/albums/{aid}/save")
    call(G, "album copy", outsider, "POST", f"{L}/albums/{aid}/copy")
    call(G, "albums saved by outsider", outsider, "GET", f"{L}/albums/saved")
    st, js = call(G, "albums me outsider", outsider, "GET", f"{L}/albums/me")
    copies = [a["id"] for a in (data(js, "data", default=[]) or []) if str(a.get("name", "")).startswith(f"Album {tag}")] if isinstance(data(js, "data"), list) else []
    call(G, "album delete denied", outsider, "DELETE", f"{L}/albums/{aid}")
    call(G, "album delete", reader, "DELETE", f"{L}/albums/{aid}")
    for c in copies:
        outsider.raw("DELETE", f"{L}/albums/{c}")
    call(G, "recommender home", guest, "GET", "/api/rec/home")

    # ============================================================ messaging (via /api/msg)
    G = "messaging"
    MS = "/api/msg"
    call(G, "health", guest, "GET", f"{MS}/health")
    call(G, "ready", guest, "GET", f"{MS}/ready")
    call(G, "unknown route", guest, "GET", f"{MS}/nope")
    call(G, "inbox guest", guest, "GET", f"{MS}/messages")
    call(G, "inbox", reader, "GET", f"{MS}/messages")
    call(G, "labels", reader, "GET", f"{MS}/messages/labels")
    call(G, "label create bad", reader, "POST", f"{MS}/messages/labels", {"name": ""})
    st, js = call(G, "label create", reader, "POST", f"{MS}/messages/labels", {"name": f"L{tag}", "color": "sky"})
    lid = data(js, "data", "id")
    call(G, "label create dup", reader, "POST", f"{MS}/messages/labels", {"name": f"L{tag}", "color": "sky"})
    call(G, "label update", reader, "PATCH", f"{MS}/messages/labels/{lid}", {"color": "rose"})
    call(G, "label update missing", reader, "PATCH", f"{MS}/messages/labels/{uid_missing}", {"color": "rose"})
    call(G, "thread guest", guest, "GET", f"{MS}/messages/reader_yuki")
    call(G, "thread missing user", reader, "GET", f"{MS}/messages/khong_co_ai_ca")
    call(G, "send bad", reader, "POST", f"{MS}/messages/reader_yuki", {"message": ""})
    call(G, "send to self", reader, "POST", f"{MS}/messages/reader_hana", {"message": "x"})
    call(G, "send", reader, "POST", f"{MS}/messages/reader_yuki", {"message": f"Chào {tag}"})
    st, js = call(G, "thread", outsider, "GET", f"{MS}/messages/reader_hana")
    mid = data(js, "data", "messages", 0, "id") or data(js, "data", 0, "id")
    call(G, "set labels bad", reader, "PUT", f"{MS}/messages/reader_yuki/labels", {})
    call(G, "set labels", reader, "PUT", f"{MS}/messages/reader_yuki/labels", {"label_ids": [lid]})
    call(G, "pin", reader, "POST", f"{MS}/messages/reader_yuki/pins/{mid}")
    call(G, "unpin", reader, "DELETE", f"{MS}/messages/reader_yuki/pins/{mid}")
    call(G, "block", outsider, "POST", f"{MS}/messages/reader_hana/block")
    call(G, "send blocked", reader, "POST", f"{MS}/messages/reader_yuki", {"message": "x"})
    call(G, "unblock", outsider, "DELETE", f"{MS}/messages/reader_hana/block")
    call(G, "delete message what bad", reader, "DELETE", f"{MS}/messages/reader_yuki/zzz")
    call(G, "label delete", reader, "DELETE", f"{MS}/messages/labels/{lid}")
    call(G, "group messages guest", guest, "GET", f"{MS}/groups/{group_id}/messages")
    call(G, "group messages denied", reader, "GET", f"{MS}/groups/{group_id}/messages")
    call(G, "group send denied", reader, "POST", f"{MS}/groups/{group_id}/messages", {"message": "x"})
    if gid:
        call(G, "group send", outsider, "POST", f"{MS}/groups/{gid}/messages", {"message": f"Chào nhóm {tag}"})
        st, js = call(G, "group messages", outsider, "GET", f"{MS}/groups/{gid}/messages")
        gm = data(js, "data", 0, "id") or data(js, "data", "messages", 0, "id")
        call(G, "group send bad", outsider, "POST", f"{MS}/groups/{gid}/messages", {"message": ""})
        call(G, "group message delete denied", reader, "DELETE", f"{MS}/groups/{gid}/messages/{gm}")
        call(G, "group message delete", outsider, "DELETE", f"{MS}/groups/{gid}/messages/{gm}")
    call(G, "notifications guest", guest, "GET", f"{MS}/notifications")
    call(G, "notifications", reader, "GET", f"{MS}/notifications?limit=5")
    call(G, "notifications unread", reader, "GET", f"{MS}/notifications?unread=1&limit=5")
    call(G, "notifications seen", reader, "POST", f"{MS}/notifications/seen")
    call(G, "notifications settings", reader, "GET", f"{MS}/notifications/settings")
    call(G, "notifications settings bad", reader, "PUT", f"{MS}/notifications/settings", {"zzz": {"web": True}})
    call(G, "notifications read missing", reader, "PUT", f"{MS}/notifications/{uid_missing}/read")
    call(G, "notifications delete missing", reader, "DELETE", f"{MS}/notifications/{uid_missing}")
    call(G, "notifications read-all", outsider, "PUT", f"{MS}/notifications/read-all")
    call(G, "broadcasts denied", reader, "GET", f"{MS}/admin/broadcasts")
    call(G, "broadcasts", admin, "GET", f"{MS}/admin/broadcasts")
    call(G, "broadcast create bad", admin, "POST", f"{MS}/admin/broadcasts", {"title": ""})
    call(G, "broadcast delete missing", admin, "DELETE", f"{MS}/admin/broadcasts/{uid_missing}")
    call(G, "ws without upgrade", guest, "GET", f"{MS}/ws")

    # ============================================================ workspace (via /api/ws)
    G = "workspace"
    W = "/api/ws"
    call(G, "health", guest, "GET", f"{W}/health")
    call(G, "ready", guest, "GET", f"{W}/ready")
    call(G, "unknown route", guest, "GET", f"{W}/nope")
    call(G, "revisions guest", guest, "GET", f"{W}/chapters/{cid}/revisions")
    call(G, "revisions denied", reader, "GET", f"{W}/chapters/{cid}/revisions")
    call(G, "revisions", owner, "GET", f"{W}/chapters/{cid}/revisions")
    call(G, "revisions bad id", owner, "GET", f"{W}/chapters/zzz/revisions")
    call(G, "revision one", owner, "GET", f"{W}/chapters/{cid}/revisions/1")
    call(G, "revision missing", owner, "GET", f"{W}/chapters/{cid}/revisions/99")
    call(G, "compare", owner, "GET", f"{W}/chapters/{cid}/compare?from=1&to=2")
    call(G, "compare bad", owner, "GET", f"{W}/chapters/{cid}/compare?from=x&to=2")
    call(G, "rewind denied", reader, "POST", f"{W}/chapters/{cid}/rewind", {"to_version": 1})
    call(G, "rewind bad", owner, "POST", f"{W}/chapters/{cid}/rewind", {"to_version": 99})
    call(G, "drafts guest", guest, "GET", f"{W}/drafts")
    call(G, "drafts", owner, "GET", f"{W}/drafts")
    call(G, "drafts shared", outsider, "GET", f"{W}/drafts/shared")
    call(G, "drafts orphans", owner, "GET", f"{W}/drafts/orphans")
    st, js = call(G, "draft create for tests", owner, "POST", "/api/v1/drafts", {"chapter_id": cid})
    kd = data(js, "data", "id")
    call(G, "draft get", owner, "GET", f"{W}/drafts/{kd}")
    call(G, "draft get denied", reader, "GET", f"{W}/drafts/{kd}")
    call(G, "draft get missing", owner, "GET", f"{W}/drafts/{uid_missing}")
    call(G, "draft card", owner, "GET", f"{W}/drafts/{kd}/card")
    call(G, "draft card denied", reader, "GET", f"{W}/drafts/{kd}/card")
    call(G, "draft pull preview", owner, "GET", f"{W}/drafts/{kd}/pull")
    call(G, "draft pull apply bad", owner, "POST", f"{W}/drafts/{kd}/pull", {})
    call(G, "draft review", owner, "GET", f"{W}/drafts/{pid}/review")
    call(G, "draft comment bad", owner, "POST", f"{W}/drafts/{pid}/comments", {})
    call(G, "draft comment", owner, "POST", f"{W}/drafts/{pid}/comments", {"body": "Góp ý thử", "block_hash": None})
    call(G, "draft lock", owner, "POST", f"{W}/drafts/{kd}/lock")
    call(G, "draft lock again", owner, "POST", f"{W}/drafts/{kd}/lock")
    call(G, "draft unlock", owner, "DELETE", f"{W}/drafts/{kd}/lock")
    call(G, "draft copy denied", reader, "POST", f"{W}/drafts/{kd}/copy")
    call(G, "draft unshare missing", owner, "DELETE", f"{W}/drafts/{kd}/shares/{uid_missing}")
    call(G, "draft reclaim denied", reader, "POST", f"{W}/drafts/{kd}/reclaim")
    call(G, "draft unschedule none", owner, "DELETE", f"{W}/drafts/{kd}/schedule")
    call(G, "offer preview missing", owner, "GET", f"{W}/drafts/{kd}/offers/{uid_missing}")
    call(G, "offer decline missing", owner, "DELETE", f"{W}/drafts/{kd}/offers/{uid_missing}")
    call(G, "proposals guest", guest, "GET", f"{W}/proposals")
    call(G, "proposals", owner, "GET", f"{W}/proposals?story_id={sid}")
    call(G, "tasks guest", guest, "GET", f"{W}/tasks")
    call(G, "tasks mine", owner, "GET", f"{W}/tasks?mine=1")
    call(G, "task create bad", owner, "POST", f"{W}/tasks", {})
    call(G, "task create denied", reader, "POST", f"{W}/tasks", {"story_id": sid, "chapter_id": cid})
    st, js = call(G, "task create", owner, "POST", f"{W}/tasks", {"story_id": sid, "chapter_id": cid, "note": "Dịch giúp"})
    tid = data(js, "data", "id") or data(js, "data", 0, "id")
    call(G, "tasks list story", owner, "GET", f"{W}/tasks?story_id={sid}")
    call(G, "task edit", owner, "PATCH", f"{W}/tasks/{tid}", {"note": "Ghi chú mới"})
    call(G, "task edit denied", reader, "PATCH", f"{W}/tasks/{tid}", {"note": "x"})
    call(G, "task claim", outsider, "POST", f"{W}/tasks/{tid}/claim")
    call(G, "task unclaim", outsider, "POST", f"{W}/tasks/{tid}/unclaim")
    call(G, "task claim again", outsider, "POST", f"{W}/tasks/{tid}/claim")
    call(G, "task start", outsider, "POST", f"{W}/tasks/{tid}/start")
    call(G, "task done early", outsider, "POST", f"{W}/tasks/{tid}/done")
    call(G, "task cancel", owner, "POST", f"{W}/tasks/{tid}/cancel")
    call(G, "task missing", owner, "POST", f"{W}/tasks/{uid_missing}/claim")
    call(G, "board", owner, "GET", f"{W}/board?story_id={sid}")
    call(G, "board guest", guest, "GET", f"{W}/board?story_id={sid}")
    call(G, "draft discard denied", reader, "DELETE", f"{W}/drafts/{kd}")
    call(G, "draft discard", owner, "DELETE", f"{W}/drafts/{kd}")
    call(G, "draft discard proposal", outsider, "DELETE", f"{W}/drafts/{pid}")

    # ============================================================ identity (via /api/identity)
    G = "identity"
    I = "/api/identity"
    call(G, "health", guest, "GET", f"{I}/health")
    call(G, "ready", guest, "GET", f"{I}/ready")
    call(G, "unknown route", guest, "GET", f"{I}/nope")
    call(G, "me guest", guest, "GET", f"{I}/me")
    call(G, "me", reader, "GET", f"{I}/me")
    call(G, "sessions", reader, "GET", f"{I}/sessions")
    call(G, "sessions guest", guest, "GET", f"{I}/sessions")
    call(G, "session revoke missing", reader, "DELETE", f"{I}/sessions/{uid_missing}")
    call(G, "login bad body", guest, "POST", f"{I}/login", {})
    call(G, "login wrong", guest, "POST", f"{I}/login", {"identifier": f"khong_co_{tag}", "password": "sai-mat-khau"})
    call(G, "register bad", guest, "POST", f"{I}/register", {"username": "a", "email": "x", "password": "1"})
    call(G, "register duplicate", guest, "POST", f"{I}/register", {"username": "admin", "email": "admin@novelhub.vn", "password": "Kiem-Tra-" + tag})
    fresh = Client("fresh")
    uname = f"contract_{tag}"
    pw = "Kiem-Tra-" + secrets.token_hex(4)
    call(G, "register", fresh, "POST", f"{I}/register", {"username": uname, "email": f"{uname}@example.invalid", "password": pw})
    call(G, "me fresh", fresh, "GET", f"{I}/me")
    call(G, "forgot bad", guest, "POST", f"{I}/forgot-password", {})
    call(G, "forgot unknown", guest, "POST", f"{I}/forgot-password", {"email": f"khong_co_{tag}@example.invalid"})
    call(G, "reset bad", guest, "POST", f"{I}/reset-password", {"token": "zzz", "password": "x"})
    call(G, "verify bad", guest, "POST", f"{I}/verify-email", {"token": "zzz"})
    call(G, "confirm email change bad", guest, "POST", f"{I}/confirm-email-change", {"token": "zzz"})
    call(G, "resend verification guest", guest, "POST", f"{I}/resend-verification")
    call(G, "change password wrong", fresh, "POST", f"{I}/change-password", {"current_password": "sai", "new_password": pw + "x"})
    call(G, "change password", fresh, "POST", f"{I}/change-password", {"current_password": pw, "new_password": pw + "x"})
    call(G, "change email wrong", fresh, "POST", f"{I}/change-email", {"password": "sai", "email": "a@example.invalid"})
    call(G, "refresh", fresh, "POST", f"{I}/refresh")
    call(G, "refresh guest", guest, "POST", f"{I}/refresh")
    call(G, "roles denied", reader, "POST", f"{I}/users/{outsider.id}/roles", {"role": "mod"})
    call(G, "ban denied", reader, "POST", f"{I}/users/{outsider.id}/ban", {"password": args.password})
    call(G, "unban denied", reader, "POST", f"{I}/users/{outsider.id}/unban", {"password": args.password})
    call(G, "delete user denied", reader, "DELETE", f"{I}/users/{outsider.id}", {"password": args.password})
    call(G, "private denied", reader, "GET", f"{I}/users/{outsider.id}/private")
    call(G, "private admin wrong pw", admin, "GET", f"{I}/users/{outsider.id}/private")
    call(G, "admin users denied", reader, "GET", f"{I}/admin/users?q=hana")
    call(G, "admin users", admin, "GET", f"{I}/admin/users?q=hana")
    call(G, "admin revoke-all denied", reader, "POST", f"{I}/admin/revoke-all-sessions")
    call(G, "ban self-protection", admin, "POST", f"{I}/users/{admin.id}/ban", {"password": args.password})
    call(G, "logout-all fresh", fresh, "POST", f"{I}/logout-all")
    call(G, "logout fresh", fresh, "POST", f"{I}/logout")
    call(G, "verify call without gateway-only path", guest, "GET", f"{I}/internal/verify")
    adm = admin.id
    # delete the throwaway account again (admin re-enters their password)
    st, js = call(G, "login fresh", fresh, "POST", f"{I}/login", {"identifier": uname, "password": pw + "x"})
    fresh_id = data(js, "data", "user", "id")
    if fresh_id:
        call(G, "delete user wrong pw", admin, "DELETE", f"{I}/users/{fresh_id}", {"password": "sai"})
        call(G, "delete user", admin, "DELETE", f"{I}/users/{fresh_id}", {"password": args.password})

    # ============================================================ internal (service-to-service)
    G = "internal"
    internal(G, "catalog permissions", "catalog", "GET", f"/internal/permissions?story_id={sid}&user_id={owner.id}")
    internal(G, "catalog permissions bad", "catalog", "GET", "/internal/permissions")
    internal(G, "catalog chapters export", "catalog", "GET", "/internal/chapters/export?after=00000000-0000-0000-0000-000000000000&limit=1")
    internal(G, "catalog exports source", "catalog", "POST", "/internal/exports/source", {"story_slug": sslug, "format": "epub"})
    internal(G, "catalog exports book", "catalog", "POST", "/internal/exports/book", {"story_slug": sslug, "format": "epub", "chapter_ids": [cid]})
    internal(G, "catalog user profiles", "catalog", "POST", "/internal/users/profiles", {"ids": [reader.id, uid_missing]})
    internal(G, "catalog group members", "catalog", "GET", f"/internal/groups/{group_id}/members")
    internal(G, "catalog stories brief", "catalog", "POST", "/internal/stories/brief", {"ids": [sid, uid_missing]})
    internal(G, "catalog stories removed", "catalog", "GET", "/internal/stories/removed")
    internal(G, "catalog comment counts", "catalog", "POST", "/internal/comment-counts", {"counts": []})
    internal(G, "catalog library stories", "catalog", "GET", "/internal/library/stories?limit=1")
    internal(G, "catalog library chapters", "catalog", "GET", "/internal/library/chapters?limit=1")
    internal(G, "catalog library ids", "catalog", "GET", "/internal/library/ids")
    internal(G, "catalog favorite counts", "catalog", "POST", "/internal/favorite-counts", {"counts": []})
    internal(G, "catalog delete-check", "catalog", "GET", f"/internal/users/{reader.id}/delete-check", sig_user={"id": adm, "roles": ["admin"]})
    internal(G, "catalog unauthorized", "none", "GET", "/internal/permissions", host="catalog")
    internal(G, "community code post", "community", "GET", "/internal/codes/post/1")
    internal(G, "community code bad", "community", "GET", "/internal/codes/zzz/x")
    internal(G, "community user stats", "community", "GET", f"/internal/users/{reader.id}/stats")
    internal(G, "community purge", "community", "POST", "/internal/comments/purge", {"story_id": uid_missing, "chapter_ids": []})
    internal(G, "library purge", "library", "POST", "/internal/purge", {"story_id": uid_missing, "chapter_ids": []})
    internal(G, "library history", "library", "POST", "/internal/history", {"user_id": reader.id, "chapter_id": uid_missing})
    internal(G, "library overview", "library", "GET", f"/internal/users/{reader.id}/overview")
    internal(G, "library favorite", "library", "GET", f"/internal/favorites/{reader.id}/{sid}")
    internal(G, "library album code", "library", "GET", "/internal/codes/album/1")
    internal(G, "library followers", "library", "GET", f"/internal/stories/{sid}/followers")
    internal(G, "library reco export", "library", "GET", "/internal/reco/export?limit=1")
    internal(G, "library reco user", "library", "GET", f"/internal/reco/user/{reader.id}")
    internal(G, "messaging job bad", "messaging", "POST", "/internal/notifications/jobs", {})
    internal(G, "messaging dm bad", "messaging", "POST", "/internal/dm", {})
    internal(G, "messaging blocked", "messaging", "GET", f"/internal/blocked?user_id={reader.id}")
    internal(G, "identity user", "identity", "GET", f"/internal/users/{reader.id}")
    internal(G, "identity user missing", "identity", "GET", f"/internal/users/{uid_missing}")
    internal(G, "identity stats", "identity", "GET", "/internal/stats")
    internal(G, "identity grant bad", "identity", "POST", f"/internal/users/{uid_missing}/roles", {"role": "reader"})
    internal(G, "workspace stats", "workspace", "GET", "/internal/stats")
    internal(G, "workspace chapter current", "workspace", "GET", f"/internal/chapters/{cid}")
    internal(G, "workspace chapter missing", "workspace", "GET", f"/internal/chapters/{uid_missing}")
    internal(G, "workspace draft missing", "workspace", "GET", f"/internal/drafts/{uid_missing}")
    internal(G, "workspace unauthorized", "none", "GET", "/internal/stats", host="workspace")
    flush_internal()

    # ============================================================ cleanup
    call("cleanup", "collaborator remove denied", reader, "DELETE", f"/api/v1/stories/{sid}/collaborators/{outsider.id}")
    call("cleanup", "collaborator remove", owner, "DELETE", f"/api/v1/stories/{sid}/collaborators/{outsider.id}")
    call("cleanup", "chapter delete", owner, "DELETE", f"/api/v1/chapters/{cid2}")
    call("cleanup", "chapter delete first", owner, "DELETE", f"/api/v1/chapters/{cid}")
    call("cleanup", "volume delete", owner, "DELETE", f"/api/v1/volumes/{vid}")
    call("cleanup", "story delete denied", reader, "DELETE", f"/api/v1/stories/{sid}")
    call("cleanup", "story delete", owner, "DELETE", f"/api/v1/stories/{sid}")
    call("cleanup", "story after delete", guest, "GET", f"/api/v1/stories/{sslug}")
    return None


def finish_early():
    return None


def diff(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(f"{path}/{k}: only in NEW  {json.dumps(b[k], ensure_ascii=False)[:160]}")
            elif k not in b:
                out.append(f"{path}/{k}: only in BASELINE  {json.dumps(a[k], ensure_ascii=False)[:160]}")
            else:
                out += diff(a[k], b[k], f"{path}/{k}")
    elif a != b:
        out.append(f"{path}: baseline={json.dumps(a, ensure_ascii=False)[:200]}  new={json.dumps(b, ensure_ascii=False)[:200]}")
    return out


def main():
    t0 = time.time()
    try:
        run()
        flush_internal()
    finally:
        clean_uploads(t0 - 1)
    print(f"run took {time.time() - t0:.0f}s")
    print(f"{len(results)} calls recorded")
    if args.compare:
        base = json.load(open(BASELINE, encoding="utf-8"))
        lines = []
        for k in sorted(set(base) | set(results)):
            if ONLY and k.split(":")[0] not in ONLY:
                continue
            if k not in base:
                lines.append(f"[NEW STEP] {k}")
            elif k not in results:
                lines.append(f"[MISSING STEP] {k}")
            else:
                d = diff(base[k], results[k])
                if d:
                    lines.append(f"[DIFF] {k}  ({results[k]['request']})")
                    lines += ["    " + x for x in d]
        if lines:
            print("\n".join(lines))
            print(f"\n{sum(1 for l in lines if l.startswith('['))} difference(s) against {os.path.basename(BASELINE)}")
            sys.exit(1)
        print("no differences against the baseline")
    else:
        if ONLY and os.path.exists(BASELINE):
            old = json.load(open(BASELINE, encoding="utf-8"))
            old = {k: v for k, v in old.items() if k.split(":")[0] not in ONLY}
            old.update(results)
            results.clear()
            results.update(old)
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(results.items())), f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        print(f"baseline written to {BASELINE}")


main()
