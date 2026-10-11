#!/usr/bin/env python3
"""Smoke test of the community service through the real gateway (Plan/community.md).

    python scripts/community-smoke.py --admin admin --writer reader_hana --reader reader_yuki --password ... [--base http://127.0.0.1:3000]

--admin must be a site admin; --writer and --reader two ordinary accounts (same password, e.g. the demo ones).
Creates a throwaway post and comments, reacts, reports, takes the post down and restores it, then deletes everything
it made. Checks the JSON the frontend reads, counters, the backend's chapter comment counts, smart codes, profiles,
and that notifications reach the bell. Exit code 1 on any failure.
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
p.add_argument("--admin", required=True)
p.add_argument("--writer", required=True)
p.add_argument("--reader", required=True)
p.add_argument("--password", required=True)
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


def eventually(fn, seconds=6):
    end = time.time() + seconds
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.3)
    return fn()


C = "/api/community"
guest, admin, writer, reader = Client(), Client(args.admin), Client(args.writer), Client(args.reader)
tag = secrets.token_hex(3)

# --- feed and sidebar (guest) ---
st, feed = guest.req("GET", f"{C}/posts?limit=5")
row = (feed.get("data") or [{}])[0]
check("guest feed lists posts with author fields", st == 200 and feed["pagination"]["total"] > 0 and "author_name" in row and "reaction_summary" in row, str(st))
st, side = guest.req("GET", f"{C}/posts/sidebar")
check("sidebar: leaderboard, stories, counts", st == 200 and {"leaderboard", "stories", "counts"} <= set(side["data"]), str(st))

# --- a post: create, read, react, comment ---
st, js = writer.req("POST", f"{C}/posts", {"title": f"Thử community {tag}", "content": "<p>Nội dung thử</p>", "category": "discussion"})
post = js.get("data") or {}
check("writer creates a post (live, with a P- code)", st == 201 and post.get("approval_status") == "approved" and post.get("code", "").startswith("P-DS-"), f"{st} {js.get('message')}")
st, js = guest.req("GET", f"{C}/posts/{post.get('slug')}")
check("anyone reads it by slug", st == 200 and js["data"]["author_username"] == args.writer, str(st))
st, js = guest.req("POST", f"{C}/posts", {"title": "x", "content": "<p>x</p>"})
check("guests cannot post", st in (401, 403), str(st))

st, js = reader.req("POST", f"{C}/posts/{post.get('id')}/react", {"reaction": "love"})
check("reader reacts", st == 200 and js["data"]["reaction_count"] == 1 and js["data"]["my_reaction"] == "love", str(st))
st, js = reader.req("POST", f"{C}/comments", {"target_type": "post", "target_id": post.get("id"), "content": f"Bình luận {tag}"})
comment = js.get("data") or {}
check("reader comments (author fields filled)", st == 201 and comment.get("username") == args.reader, f"{st} {js.get('message')}")
st, js = writer.req("POST", f"{C}/comments", {"target_type": "post", "target_id": post.get("id"), "parent_id": comment.get("id"), "content": "Trả lời"})
reply = js.get("data") or {}
check("writer replies", st == 201 and reply.get("depth") == 1, str(st))
st, js = writer.req("POST", f"{C}/comments/{comment.get('id')}/like")
check("like a comment", st == 200 and js.get("liked") is True and js.get("like_count") == 1, str(st))
st, js = guest.req("GET", f"{C}/comments?target_type=post&target_id={post.get('id')}")
tree = js.get("data") or []
check("comment tree: one root with its reply", st == 200 and len(tree) == 1 and len(tree[0]["replies"]) == 1 and tree[0]["reply_count"] == 1, str(st))
st, js = guest.req("GET", f"{C}/posts/{post.get('slug')}")
check("post counters follow (comments, reactions)", js["data"]["comment_count"] == 2 and js["data"]["reaction_count"] == 1, json.dumps({k: js["data"][k] for k in ("comment_count", "reaction_count")}))
st, js = writer.req("PUT", f"{C}/comments/{comment.get('id')}", {"content": "sửa của người khác"})
check("nobody edits someone else's comment", st == 403, str(st))

bell = lambda c, t: any(n.get("type") == t and n.get("link") == f"/fandom/{post.get('slug')}"
                        for n in c.req("GET", "/api/msg/notifications?limit=10")[1].get("data", {}).get("notifications", []))
check("writer is notified of the reaction and the comment (queue -> messaging)",
      eventually(lambda: bell(writer, "post_reaction") and bell(writer, "post_comment")))
check("reader is notified of the reply", eventually(lambda: bell(reader, "comment_reply")))

# --- mute ---
st, js = writer.req("POST", f"{C}/posts/{post.get('id')}/mute")
check("mute the post", st == 200 and js.get("muted") is True, str(st))
st, js = writer.req("POST", f"{C}/posts/{post.get('id')}/mute")
check("unmute it", st == 200 and js.get("muted") is False, str(st))

# --- comments on a chapter: the backend's counters ---
st, stories = guest.req("GET", "/api/v1/stories?limit=1")
story = (stories.get("data") or [{}])[0]
st, full = guest.req("GET", f"/api/v1/stories/{story.get('slug')}")
first = (full.get("data") or {}).get("first_chapter") or {}
st, before = guest.req("GET", f"/api/v1/stories/{story.get('slug')}")
total0 = int(before["data"].get("total_comments") or 0)
st, js = reader.req("POST", f"{C}/comments", {"target_type": "chapter", "target_id": first.get("id"), "content": f"Chương hay {tag}"})
ch_comment = js.get("data") or {}
check("comment on a chapter", st == 201, f"{st} {js.get('message')}")
check("the story's comment count in the backend goes up",
      eventually(lambda: int(guest.req("GET", f"/api/v1/stories/{story.get('slug')}")[1]["data"].get("total_comments") or 0) == total0 + 1),
      str(total0))

# --- reports ---
st, js = reader.req("POST", f"{C}/reports", {"target_type": "chapter", "target_id": first.get("id"), "reason": "spam", "description": f"thử {tag}"})
check("report a chapter", st == 201, f"{st} {js.get('message')}")
rid = (js.get("data") or {}).get("id")
st, js = reader.req("POST", f"{C}/reports", {"target_type": "chapter", "target_id": first.get("id"), "reason": "spam"})
check("the same report twice -> 409", st == 409, str(st))
st, js = reader.req("GET", f"{C}/reports")
check("only staff list reports", st == 403, str(st))
st, js = admin.req("GET", f"{C}/reports?q={tag}")
rep = next((r for r in js.get("data") or [] if r["id"] == rid), {})
check("admin finds it: preview, code, path, reporter",
      st == 200 and "-C" in (rep.get("target_code") or "") and " · " in (rep.get("target_preview") or "")
      and rep.get("target_path") == f"{story.get('slug')}/{first.get('slug')}" and rep.get("reporter_username") == args.reader
      and rep.get("target_removed") is False,
      json.dumps(rep)[:300])
st, js = admin.req("PUT", f"{C}/reports/{rid}/resolve", {"status": "dismissed"})
check("resolve it", st == 200 and js["data"]["status"] == "dismissed", str(st))
st, js = admin.req("GET", f"/api/v1/codes/{rep.get('code')}")
check("RP- code opens /bao-cao for staff", st == 200 and js["data"]["path"] == "/bao-cao", str(st))
st, js = guest.req("GET", f"/api/v1/codes/{rep.get('code')}")
check("...and is unknown to everyone else", st == 404, str(st))

# --- take down / restore ---
st, js = admin.req("POST", f"{C}/posts/{post.get('id')}/reject", {"reason": f"thử gỡ {tag}"})
check("admin takes the post down", st == 200 and js.get("count") == 1, str(st))
st, js = guest.req("GET", f"{C}/posts/{post.get('slug')}")
check("readers no longer see it", st == 404, str(st))
st, js = admin.req("GET", f"{C}/moderation/removed?q={tag}")
check("it is in Đã gỡ (with who removed it)", st == 200 and any(r["id"] == post.get("id") and r["removed_by_username"] == args.admin for r in js["data"]), str(st))
st, js = admin.req("GET", f"{C}/moderation/removed?type=story")
check("removed stories still listed from the backend", st == 200 and isinstance(js.get("data"), list), str(st))
check("the author is told", eventually(lambda: any(n.get("type") == "post_removed" for n in writer.req("GET", "/api/msg/notifications?limit=10")[1]["data"]["notifications"])))
st, js = admin.req("POST", f"{C}/posts/{post.get('id')}/approve")
check("admin restores it", st == 200 and js.get("count") == 1, str(st))
st, js = admin.req("GET", f"/api/v1/codes/{post.get('code')}")
check("P- code opens the post", st == 200 and js["data"]["path"] == f"/fandom/{post.get('slug')}", str(st))

# --- profile counts come from community ---
st, js = guest.req("GET", f"/api/v1/users/{args.writer}")
check("profile shows the writer's posts and comments", st == 200 and js["data"]["stats"]["posts_count"] >= 1 and js["data"]["stats"]["comments_count"] >= 1, str(st))

# --- clean up ---
st, js = reader.req("DELETE", f"{C}/comments/{ch_comment.get('id')}")
check("delete the chapter comment", st == 200, str(st))
check("the story's count goes back down",
      eventually(lambda: int(guest.req("GET", f"/api/v1/stories/{story.get('slug')}")[1]["data"].get("total_comments") or 0) == total0))
st, js = reader.req("DELETE", f"{C}/comments/{comment.get('id')}")
check("delete a comment with its reply", st == 200, str(st))
st, js = guest.req("GET", f"{C}/posts/{post.get('slug')}")
check("the post's count goes back to 0", js["data"]["comment_count"] == 0, str(js["data"]["comment_count"]))
st, js = reader.req("DELETE", f"{C}/posts/{post.get('id')}")
check("only the author deletes a post", st == 403, str(st))
st, js = writer.req("DELETE", f"{C}/posts/{post.get('id')}")
check("the author deletes it", st == 200, str(st))

print("All checks passed" if failures == 0 else f"FAILED: {failures} check(s)")
sys.exit(1 if failures else 0)
