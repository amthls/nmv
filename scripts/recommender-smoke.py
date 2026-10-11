#!/usr/bin/env python3
"""Smoke test of the recommender service through the real gateway (Plan/recommender.md).

    python scripts/recommender-smoke.py --admin admin --reader reader_yuki --password ... --story berserker-of-gluttony [--base http://127.0.0.1:3000]

--admin must be a site admin, --reader an ordinary account (same password). A fresh guest opens --story: its page view
reaches the recommender as an event and the guest's home row is then built around it. Also checks related stories,
feedback events, the reader's personal row, admin-only status, and "train now". Exit code 1 on any failure.
"""
import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://127.0.0.1:3000")  # not localhost: Windows tries ::1 first
p.add_argument("--admin", required=True)
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

    def req(self, method, path, body=None, timeout=20):
        h = {"Content-Type": "application/json"}
        csrf = next((c.value for c in self.jar if c.name == "nh_csrf"), "")
        if method != "GET" and csrf:
            h["X-CSRF-Token"] = csrf
        r = urllib.request.Request(args.base + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.op.open(r, timeout=timeout) as res:
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
        time.sleep(0.4)
    return fn()


R = "/api/rec"
guest = Client()
st, js = guest.req("GET", f"/api/v1/stories/{args.story}")  # also sets the nh_vid cookie
check("guest opens the story", st == 200, str(st))
sid = js["data"]["id"]

st, js = guest.req("GET", f"{R}/related/{sid}?limit=6")
rel = js.get("data", {}).get("stories", [])
check("related stories", st == 200 and len(rel) > 0 and all(s.get("rec_label") for s in rel), f"{st} {len(rel)}")
check("related never lists the story itself", all(s["id"] != sid for s in rel))
check("unknown story -> 404", guest.req("GET", f"{R}/related/not-a-uuid")[0] == 404)


def guest_row_follows_view():
    st, js = guest.req("GET", f"{R}/home?limit=6")
    stories = js.get("data", {}).get("stories", [])
    return st == 200 and any(s.get("rec_reason") == "because_read" for s in stories)


check("guest's home row built around what they just opened (view event arrived)", eventually(guest_row_follows_view))

st, _ = guest.req("POST", f"{R}/events", {"kind": "impression", "source": "related", "story_ids": [s["id"] for s in rel]})
check("feedback events accepted", st == 202, str(st))
check("bad feedback refused", guest.req("POST", f"{R}/events", {"kind": "buy"})[0] == 400)

reader = Client(args.reader)
st, js = reader.req("GET", f"{R}/home?limit=8")
check("reader's home row", st == 200 and len(js["data"]["stories"]) == 8, str(st))
check("admin status refused to guests and readers", guest.req("GET", f"{R}/status")[0] == 401 and reader.req("GET", f"{R}/status")[0] == 403)

admin = Client(args.admin)
st, js = admin.req("POST", f"{R}/train", timeout=600)
check("train now", st == 200 and js["data"]["stories"] > 0, f"{st} {js.get('message')}")
st, js = admin.req("GET", f"{R}/status")
check("status lists the run with offline scores", st == 200 and js["data"][0]["status"] == "ok"
      and "home" in (js["data"][0]["metrics"] or {}).get("offline", {"home": 1}), str(st))

print("FAILED" if failures else "ALL OK", f"({failures} failure(s))" if failures else "")
sys.exit(1 if failures else 0)
