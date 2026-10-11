#!/usr/bin/env python3
"""Smoke test of the library service through the real gateway (Plan/library.md).

    python scripts/library-smoke.py --keeper admin --reader reader_yuki --password ... --story berserker-of-gluttony [--base http://127.0.0.1:3000]

--keeper must be able to publish chapters of --story; --reader an ordinary account (same password).
The reader follows the story, the keeper publishes a throwaway chapter (the reader must be notified), the reader
reads it (history), bookmarks a line, makes an album with the story, resolves its AL- code; then the chapter is
deleted (history + bookmark must go), the album deleted and the follow put back as it was. Exit code 1 on any failure.
"""
import argparse
import http.cookiejar
import json
import secrets
import sys
import time
import urllib.error
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://127.0.0.1:3000")  # not localhost: Windows tries ::1 first
p.add_argument("--keeper", required=True)
p.add_argument("--reader", required=True)
p.add_argument("--password", required=True)
p.add_argument("--story", required=True)
args = p.parse_args()
sys.stdout.reconfigure(encoding="utf-8")
failures = 0


def check(name, ok, detail=""):
    global failures
    print(("  [OK]   " if ok else "  [FAIL] ") + name + (f"  ({detail})" if detail and not ok else ""))
    failures += 0 if ok else 1


class Client:
    def __init__(self, user=None):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        if user:
            st, _ = self.req("POST", "/api/identity/login", {"identifier": user, "password": args.password})
            check(f"login {user}", st == 200, str(st))

    def req(self, method, path, body=None):
        h = {"Content-Type": "application/json"}
        csrf = next((c.value for c in self.jar if c.name == "nh_csrf"), "")
        if method != "GET" and csrf:
            h["X-CSRF-Token"] = csrf
        r = urllib.request.Request(args.base + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.op.open(r, timeout=20) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                return e.code, {}


def eventually(fn, seconds=8):
    end = time.time() + seconds
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.3)
    return fn()


L = "/api/library"
keeper, reader = Client(args.keeper), Client(args.reader)
st, js = reader.req("GET", f"/api/v1/stories/{args.story}")
check("story page", st == 200, str(st))
story = js["data"]
sid = story["id"]
was_following = story["is_favorite"]
favs0 = int(story["total_favorites"])

# Follow (start from "not following" so the toggle is predictable)
if was_following:
    reader.req("POST", f"{L}/favorites/toggle", {"story_id": sid})
    favs0 -= 1
st, js = reader.req("POST", f"{L}/favorites/toggle", {"story_id": sid})
check("follow", st == 200 and js.get("action") == "added", f"{st} {js}")
st, js = reader.req("GET", f"{L}/favorites/status/{sid}")
check("follow status", st == 200 and js.get("is_favorite") is True, f"{st} {js}")
st, js = reader.req("GET", f"{L}/favorites")
check("follow list has the story", st == 200 and sid in json.dumps(js), str(st))
check("story page says following", reader.req("GET", f"/api/v1/stories/{args.story}")[1]["data"]["is_favorite"] is True)
check("backend follower count +1", eventually(lambda: int(Client().req("GET", f"/api/v1/stories/{args.story}")[1]["data"]["total_favorites"]) == favs0 + 1))

# New chapter -> the follower is told (messaging asks library who follows)
num = 9000 + secrets.randbelow(900)
st, js = keeper.req("POST", "/api/v1/chapters/submissions", {"story_id": sid, "title": "Chương thử library", "chapter_number": num,
                                                              "is_draft": False, "content_blocks": [{"type": "paragraph", "text": "Nội dung thử."}]})
check("publish a throwaway chapter", st == 201, f"{st} {js.get('message')}")
cid, cslug = js["data"]["id"], js["data"]["slug"]
check("follower notified of the new chapter", eventually(lambda: any(
    n.get("type") == "chapter_update" and cslug in json.dumps(n, ensure_ascii=False)
    for n in reader.req("GET", "/api/msg/notifications?limit=10")[1].get("data", {}).get("notifications", [])), 15))

# Reading -> history (the backend reports the read to library)
st, _ = reader.req("GET", f"/api/v1/stories/{args.story}/chapters/{cslug}")
check("read the chapter", st == 200, str(st))
check("history has it", eventually(lambda: cid in json.dumps(reader.req("GET", f"{L}/history")[1])))
st, js = reader.req("POST", f"{L}/history", {"chapter_id": cid, "scroll_position": 40})
check("save history (scroll)", st == 200, f"{st} {js}")

# Line bookmark
st, js = reader.req("POST", f"{L}/bookmarks", {"story_id": sid, "chapter_id": cid, "line_index": 0, "line_text": "Nội dung thử."})
check("bookmark a line", st == 201, f"{st} {js}")
check("bookmark listed", cid in json.dumps(reader.req("GET", f"{L}/bookmarks")[1]))

# Album with the story + AL- code
st, js = reader.req("POST", f"{L}/albums", {"name": f"Thử {secrets.token_hex(3)}", "is_public": True, "story_id": sid})
check("create album with the story", st == 201, f"{st} {js}")
aid = js["data"]["id"]
st, js = Client().req("GET", f"{L}/albums/{aid}")
check("public album readable by guests, has the story", st == 200 and sid in json.dumps(js), str(st))
code = js.get("data", {}).get("code") or (js.get("data", {}).get("album") or {}).get("code")
check("album has an AL- code", bool(code) and code.startswith("AL-"), str(code))
if code:
    st, js = Client().req("GET", f"/api/v1/codes/{code}")
    check("AL- code resolves", st == 200 and aid in json.dumps(js), f"{st} {js}")
st, js = reader.req("GET", f"{L}/albums/by-story/{sid}")
check("album listed under the story", st == 200 and aid in json.dumps(js), str(st))
st, js = keeper.req("POST", f"{L}/albums/{aid}/save")
check("someone else saves it", st == 200 and js.get("action") == "added", f"{st} {js}")
keeper.req("POST", f"{L}/albums/{aid}/save")

# Profile overview comes from library
st, js = reader.req("GET", "/api/v1/profile/me")
check("profile has library stats", st == 200 and aid in json.dumps(js), str(st))
st, _ = Client().req("GET", "/api/v1/recommendations/home")
check("recommendations still answer", st == 200, str(st))

# Deleting the chapter purges its history + bookmark
st, js = keeper.req("DELETE", f"/api/v1/chapters/{cid}")
check("delete the chapter", st == 200, f"{st} {js.get('message')}")
check("history row gone", eventually(lambda: cid not in json.dumps(reader.req("GET", f"{L}/history")[1])))
check("bookmark gone", cid not in json.dumps(reader.req("GET", f"{L}/bookmarks")[1]))

# Clean up: album, follow back as it was
st, _ = keeper.req("DELETE", f"{L}/albums/{aid}")
check("outsider can't delete albums", st in (403, 404), str(st))
st, _ = reader.req("DELETE", f"{L}/albums/{aid}")
check("delete album", st == 200, str(st))
st, _ = Client().req("GET", f"{L}/history")
check("guests refused", st == 401, str(st))
if not was_following:
    reader.req("POST", f"{L}/favorites/toggle", {"story_id": sid})
check("follower count back", eventually(lambda: int(Client().req("GET", f"/api/v1/stories/{args.story}")[1]["data"]["total_favorites"]) == favs0 + (1 if was_following else 0)))

print("FAILED" if failures else "ALL OK", f"({failures} failure(s))" if failures else "")
sys.exit(1 if failures else 0)
