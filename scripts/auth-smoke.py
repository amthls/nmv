#!/usr/bin/env python3
"""Security smoke test of sign-in through the real gateway (identity + backend + nginx auth_request).

    python scripts/auth-smoke.py [--base http://127.0.0.1:3000] [--admin admin --admin-password ...] [--skip-slow]

Creates a throwaway account smoke_<random>. With admin credentials it is also banned and deleted at the end
(otherwise it stays). Checks: sign-up/in, CSRF on writes, forged identity headers (through the gateway and
straight at the backend), another user's private data, refresh rotation and reuse detection, logout,
lockout after wrong passwords, ban ending sessions at once. Exit code 1 on any failure.
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
p.add_argument("--base", default="http://127.0.0.1:3000")  # not localhost: Windows tries ::1 first, the gateway is IPv4-only
p.add_argument("--backend", default="http://127.0.0.1:5000", help="backend published on loopback, to try forged headers directly")
p.add_argument("--admin")
p.add_argument("--admin-password")
p.add_argument("--skip-slow", action="store_true", help="skip the 31 s wait of the refresh-reuse check")
args = p.parse_args()
sys.stdout.reconfigure(encoding="utf-8")  # Vietnamese messages on a Windows console

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("  [OK]   " if ok else "  [FAIL] ") + name + (f"  ({detail})" if detail and not ok else ""))
    failures += 0 if ok else 1


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def cookie(self, name):
        return next((c.value for c in self.jar if c.name == name), "")

    def req(self, method, path, body=None, csrf=True, headers=None, base=None):
        h = {"Content-Type": "application/json", "User-Agent": "nmv-auth-smoke"}
        if csrf and method != "GET" and self.cookie("nh_csrf"):
            h["X-CSRF-Token"] = self.cookie("nh_csrf")
        h.update(headers or {})
        r = urllib.request.Request((base or args.base) + path, method=method, headers=h,
                                   data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.opener.open(r, timeout=15) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw or b"{}")
            except ValueError:
                return e.code, {"raw": raw[:120].decode(errors="replace")}


name = "smoke_" + secrets.token_hex(3)
pw = "Kiem-Tra-" + secrets.token_hex(4)
print(f"Account {name} on {args.base}")

u = Client()
st, js = u.req("POST", "/api/identity/register", {"username": name, "email": f"{name}@example.invalid", "password": pw})
check("register", st == 201, f"{st} {js.get('message')}")
check("session cookies set (httpOnly access + refresh, readable csrf)", all(u.cookie(c) for c in ("nh_access", "nh_refresh", "nh_csrf")))
st, me = u.req("GET", "/api/identity/me")
uid = (me.get("data") or {}).get("id", "")
check("identity /me", st == 200 and me["data"]["username"] == name, str(st))
st, js = u.req("GET", "/api/v1/auth/me")
check("backend sees the user (copy + read-through)", st == 200 and js["data"]["username"] == name, f"{st} {js.get('message')}")

st, js = u.req("PUT", "/api/v1/profile/me/settings", {"theme": "dark"}, csrf=False)
check("write without CSRF header -> 403", st == 403, str(st))
st, js = u.req("PUT", "/api/v1/profile/me/settings", {"theme": "dark"})
check("write with CSRF header -> 200", st == 200, f"{st} {js.get('message')}")

guest = Client()
forged = {"X-User-Id": uid, "X-User-Roles": "admin", "X-User-Exp": str(int(time.time()) + 60), "X-User-Sig": "0" * 64}
st, _ = guest.req("GET", "/api/v1/auth/me", headers=forged)
check("forged X-User-* through the gateway -> guest (401)", st == 401, str(st))
st, _ = guest.req("GET", "/api/v1/auth/me", headers=forged, base=args.backend)
check("forged X-User-* straight at the backend -> guest (401)", st in (401, None), str(st))
st, _ = guest.req("GET", "/api/identity/internal/verify")
check("/internal not reachable from outside", st == 404, str(st))
st, _ = u.req("GET", "/api/identity/admin/users?q=admin")
check("normal user cannot list accounts/emails", st == 403, str(st))
st, _ = u.req("GET", "/api/identity/users/a0000000-0000-0000-0000-000000000001/private")
check("normal user cannot read another user's email (id in URL)", st == 403, str(st))

old_refresh = u.cookie("nh_refresh")
st, _ = u.req("POST", "/api/identity/refresh", csrf=False)
check("refresh rotates the token", st == 200 and u.cookie("nh_refresh") not in ("", old_refresh), str(st))
if not args.skip_slow:
    time.sleep(31)
    # Sent as a raw header: a cookie jar may silently drop a hand-made cookie for "localhost"
    st, _ = Client().req("POST", "/api/identity/refresh", csrf=False, headers={"Cookie": f"nh_refresh={old_refresh}"})
    check("old refresh token reused later -> 401", st == 401, str(st))
    st, _ = u.req("GET", "/api/identity/me")
    check("...and the whole session is revoked at once", st == 401, str(st))
    u = Client()
    st, _ = u.req("POST", "/api/identity/login", {"identifier": name, "password": pw})
    check("login again", st == 200, str(st))

st, _ = u.req("POST", "/api/identity/logout")
st2, _ = u.req("GET", "/api/v1/auth/me")
check("logout ends the session", st == 200 and st2 == 401, f"{st}/{st2}")

bad = Client()
for i in range(5):
    bad.req("POST", "/api/identity/login", {"identifier": name, "password": f"wrong-{i}"})
st, js = bad.req("POST", "/api/identity/login", {"identifier": name, "password": pw})
check("5 wrong passwords -> account locked for a while (429)", st == 429, f"{st} {js.get('message')}")

if args.admin and args.admin_password:
    a = Client()
    st, _ = a.req("POST", "/api/identity/login", {"identifier": args.admin, "password": args.admin_password})
    check("admin login", st == 200, str(st))
    st, js = a.req("GET", f"/api/identity/admin/users?q={name}")
    check("admin finds the account by name with email", st == 200 and any(x["email"].startswith(name) for x in js.get("data", [])), str(st))
    st, _ = a.req("POST", f"/api/identity/users/{uid}/ban", {"reason": "smoke test", "password": "wrong"})
    check("ban with a wrong confirmation password -> 403", st == 403, str(st))
    st, js = a.req("POST", f"/api/identity/users/{uid}/ban", {"reason": "smoke test", "password": args.admin_password})
    check("ban", st == 200, f"{st} {js.get('message')}")
    time.sleep(2)  # the event reaches the backend copy
    st, js = a.req("GET", f"/api/v1/users/{name}")
    check("ban reached the backend copy (event)", st == 200 and js["data"].get("moderation", {}).get("is_banned") is True, str(st))
    st, js = a.req("DELETE", f"/api/identity/users/{uid}", {"purge_content": True, "password": args.admin_password})
    check("delete (clean-up)", st == 200, f"{st} {js.get('message')}")

print("FAILED: %d check(s)" % failures if failures else "All checks passed")
sys.exit(1 if failures else 0)
