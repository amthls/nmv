#!/usr/bin/env python3
"""Smoke test of chapter versions through the real gateway (backend + workspace + events).

    python scripts/workspace-smoke.py --user admin --password ... --story berserker-of-gluttony [--base http://127.0.0.1:3000]

--user must be a keeper of --story (owner, or leader/mod of its group), --story a novel with at least one chapter.
Edits that story's first chapter and puts its content back at the end (as a newer version); creates and deletes a
throwaway chapter. Checks: edit -> new version visible to readers, stale save refused, history + compare, rewind
(through the event), delete -> gone for readers but comments kept, restore, duplicate number refused, outsiders
refused. Exit code 1 on any failure.
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
p.add_argument("--user", required=True)
p.add_argument("--password", required=True)
p.add_argument("--story", required=True)
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
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

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


def eventually(fn, seconds=5):
    end = time.time() + seconds
    while time.time() < end:
        if fn():
            return True
        time.sleep(0.3)
    return fn()


k = Client()
st, _ = k.req("POST", "/api/identity/login", {"identifier": args.user, "password": args.password})
check("keeper login", st == 200, str(st))
st, story = k.req("GET", f"/api/v1/stories/{args.story}")
first = story["data"]["first_chapter"]
cid, cslug = first["id"], first["slug"]
reader = lambda: Client().req("GET", f"/api/v1/stories/{args.story}/chapters/{cslug}")

st, ed = k.req("GET", f"/api/v1/chapters/{cid}")
orig = ed["data"]
v0 = orig["ws_version"]
check("edit form carries the workspace version", st == 200 and v0 >= 1, f"{st} {v0}")
blocks = orig["content_blocks"]
marker = "Dòng thử " + secrets.token_hex(3)
edited = blocks + [{"type": "paragraph", "text": marker}]
base = {"title": orig["title"], "chapter_number": float(orig["chapter_number"]), "volume_id": orig["volume_id"]}

st, js = k.req("PUT", f"/api/v1/chapters/{cid}", {**base, "content_blocks": edited, "expected_version": v0})
check("edit -> new version", st == 200 and js["data"]["version"] == v0 + 1, f"{st} {js.get('message')}")
st, rd = reader()
check("readers see the edit at once", st == 200 and marker in json.dumps(rd, ensure_ascii=False), str(st))
st, js = k.req("PUT", f"/api/v1/chapters/{cid}", {**base, "content_blocks": blocks, "expected_version": v0})
check("save based on an old version -> 409", st == 409, f"{st} {js.get('message')}")

st, js = k.req("GET", f"/api/ws/chapters/{cid}/revisions")
check("history lists the versions", st == 200 and js["data"][0]["version"] == v0 + 1, str(st))
st, js = k.req("GET", f"/api/ws/chapters/{cid}/compare?from={v0}&to={v0 + 1}")
check("compare shows exactly one added block", st == 200 and [o["op"] for o in js["data"]["ops"]].count("ins") == 1
      and all(o["op"] in ("same", "ins") for o in js["data"]["ops"]), str(st))

st, js = k.req("POST", f"/api/ws/chapters/{cid}/rewind", {"to_version": v0})
check("rewind -> another new version", st == 200 and js["data"]["version"] == v0 + 2, f"{st} {js.get('message')}")
check("readers get the rewound text (event)", eventually(lambda: marker not in json.dumps(reader()[1], ensure_ascii=False)))

outsider = Client()
name = "ws_" + secrets.token_hex(3)
outsider.req("POST", "/api/identity/register", {"username": name, "email": f"{name}@example.invalid", "password": "Kiem-Tra-" + secrets.token_hex(4)})
st, _ = outsider.req("GET", f"/api/ws/chapters/{cid}/revisions")
check("someone outside the story cannot read the history", st == 403, str(st))
st, _ = outsider.req("POST", f"/api/ws/chapters/{cid}/rewind", {"to_version": v0})
check("...nor rewind", st == 403, str(st))
st, _ = Client().req("GET", f"/api/ws/chapters/{cid}/revisions")
check("guests are refused", st == 401, str(st))

# A throwaway chapter: create, duplicate number, comment, delete, restore, delete again
num = 9000 + secrets.randbelow(900)
new = {"story_id": story["data"]["id"], "title": "Chương thử", "chapter_number": num, "is_draft": False,
       "content_blocks": [{"type": "paragraph", "text": "Nội dung chương thử."}]}
st, js = k.req("POST", "/api/v1/chapters/submissions", new)
check("publish a new chapter -> v1", st == 201 and js["data"]["version"] == 1, f"{st} {js.get('message')}")
nid, nslug = js["data"]["id"], js["data"]["slug"]
st, js = k.req("POST", "/api/v1/chapters/submissions", new)
check("same chapter number again -> 409", st == 409, f"{st} {js.get('message')}")
st, _ = k.req("POST", "/api/v1/comments", {"target_type": "chapter", "target_id": nid, "content": "bình luận thử"})
st, js = k.req("DELETE", f"/api/v1/chapters/{nid}")
check("delete", st == 200, f"{st} {js.get('message')}")
st, _ = Client().req("GET", f"/api/v1/stories/{args.story}/chapters/{nslug}")
check("deleted chapter is gone for readers", st == 404, str(st))
st, js = k.req("GET", f"/api/ws/chapters/{nid}/revisions")
check("its history still shows it, marked deleted", st == 200 and js["data"][0]["deleted"] is True, str(st))
st, js = k.req("POST", f"/api/ws/chapters/{nid}/rewind", {"to_version": 1})
check("restore from history", st == 200 and js["data"]["source"] == "restore", f"{st} {js.get('message')}")
check("restored chapter is back for readers", eventually(lambda: Client().req("GET", f"/api/v1/stories/{args.story}/chapters/{nslug}")[0] == 200))
st, js = Client().req("GET", f"/api/v1/comments?target_type=chapter&target_id={nid}")
check("its comments came back with it", st == 200 and "bình luận thử" in json.dumps(js, ensure_ascii=False), str(st))
k.req("DELETE", f"/api/v1/chapters/{nid}")  # leave no test chapter behind (history keeps it)

# Drafts (stage 2): edit on a private draft, the official line moves meanwhile, pull, publish
for d in k.req("GET", "/api/ws/drafts")[1].get("data", []):  # left over by an interrupted earlier run
    if d.get("chapter_id") == cid:
        if d["status"] == "submitted":
            k.req("POST", f"/api/v1/drafts/{d['id']}/withdraw")
        k.req("DELETE", f"/api/ws/drafts/{d['id']}")
st, ed = k.req("GET", f"/api/v1/chapters/{cid}")
vstart = ed["data"]["ws_version"]
st, js = k.req("POST", "/api/v1/drafts", {"chapter_id": cid})
check("open a draft of a published chapter", st == 201 and js["data"]["base_version"] == vstart, f"{st} {js.get('message')}")
did = js["data"]["id"]
st, js = k.req("POST", "/api/v1/drafts", {"chapter_id": cid})
check("Edit again reopens the same draft", st == 200 and js["data"]["id"] == did, str(st))
mine = "Đoạn của nháp " + secrets.token_hex(3)
draft_blocks = js["data"]["blocks"] + [{"html": f"<p onclick=\"alert(1)\">{mine}<script>alert(1)</script></p>"}]
st, js = k.req("PUT", f"/api/v1/drafts/{did}", {**base, "content_blocks": draft_blocks, "expected_version": 1})
check("autosave", st == 200 and js["data"]["version"] == 2, f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/drafts/{did}")
saved = json.dumps(js.get("data", {}), ensure_ascii=False)
check("draft content went through the HTML filter", st == 200 and mine in saved and "script" not in saved and "onclick" not in saved, saved[-300:])
st, rd = reader()
check("readers do not see the draft", mine not in json.dumps(rd, ensure_ascii=False))
st, js = k.req("PUT", f"/api/v1/drafts/{did}", {**base, "content_blocks": blocks, "expected_version": 1})
check("save from an older tab -> 409", st == 409, str(st))
st, _ = outsider.req("GET", f"/api/ws/drafts/{did}")
check("others cannot open my draft", st == 403, str(st))
st, _ = outsider.req("POST", "/api/v1/drafts", {"chapter_id": cid})
check("someone outside the story cannot make drafts of it", st == 403, str(st))

theirs = "Đoạn bản chính " + secrets.token_hex(3)
st, js = k.req("PUT", f"/api/v1/chapters/{cid}", {**base, "content_blocks": [{"type": "paragraph", "text": theirs}] + blocks, "expected_version": vstart})
check("official line moves meanwhile", st == 200, f"{st} {js.get('message')}")
st, js = k.req("POST", f"/api/v1/drafts/{did}/publish")
check("publishing a draft behind the official version -> 409", st == 409, f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/drafts/{did}/pull")
plan = js.get("data", {}).get("plan", {})
check("pull preview: merges without conflict", st == 200 and not plan.get("meta_conflicts") and all("conflict" not in c for c in plan.get("chunks", [])), str(st))
st, js = k.req("POST", f"/api/ws/drafts/{did}/pull", {"expected_version": 2, "to_version": plan.get("to"), "choices": {}})
pulled = json.dumps(js.get("data", {}), ensure_ascii=False)
check("pull keeps both changes", st == 200 and mine in pulled and theirs in pulled, f"{st} {js.get('message')}")
st, js = k.req("POST", f"/api/v1/drafts/{did}/publish")
check("publish the draft -> next version", st == 200 and js["data"]["version"] == vstart + 2, f"{st} {js.get('message')}")
st, rd = reader()
both = json.dumps(rd, ensure_ascii=False)
check("readers see the merged chapter", mine in both and theirs in both)
st, js = k.req("POST", f"/api/ws/chapters/{cid}/rewind", {"to_version": vstart})
check("put the first chapter back as it was", st == 200, f"{st} {js.get('message')}")

# A new chapter written as a draft, and a discarded draft
num = 9000 + secrets.randbelow(900)
st, js = k.req("POST", "/api/v1/drafts", {"story_id": story["data"]["id"], "title": "Chương nháp thử", "chapter_number": num,
                                          "content_blocks": [{"type": "paragraph", "text": "Nội dung nháp."}]})
check("start a new chapter as a draft", st == 201 and js["data"]["chapter_id"] is None, f"{st} {js.get('message')}")
st, js = k.req("POST", f"/api/v1/drafts/{js['data']['id']}/publish")
check("publish it -> chapter v1", st == 200 and js["data"]["version"] == 1, f"{st} {js.get('message')}")
k.req("DELETE", f"/api/v1/chapters/{js['data']['chapter_id']}")
st, js = k.req("POST", "/api/v1/drafts", {"story_id": story["data"]["id"], "title": "", "chapter_number": num})
st, _ = k.req("DELETE", f"/api/ws/drafts/{js['data']['id']}")
st2, lst = k.req("GET", "/api/ws/drafts")
check("discard a draft", st == 200 and all(d["id"] != js["data"]["id"] for d in lst["data"]), str(st))

# Proposals (stage 3): a collaborator proposes, the keeper comments, returns, then merges
sid = story["data"]["id"]
st, me = outsider.req("GET", "/api/v1/auth/me")
helper_id = me["data"]["id"]
st, js = k.req("POST", f"/api/v1/stories/{sid}/collaborators", {"identifier": name})
check("add a collaborator (contributor, not keeper)", st in (200, 201), f"{st} {js.get('message')}")
st, ed = k.req("GET", f"/api/v1/chapters/{cid}")
vbase = ed["data"]["ws_version"]
st, js = outsider.req("PUT", f"/api/v1/chapters/{cid}", {**base, "content_blocks": blocks, "expected_version": vbase})
check("contributors cannot edit the official text directly", st == 403, str(st))
st, js = outsider.req("POST", "/api/v1/chapters/submissions", {**new, "chapter_number": 9999.5})
check("...nor publish a new chapter directly", st == 403, str(st))
st, js = outsider.req("POST", "/api/v1/drafts", {"chapter_id": cid})
pid = js.get("data", {}).get("id")
check("contributor opens a draft", st == 201 and js["data"].get("can_merge") is None, f"{st} {js.get('message')}")
st, js = outsider.req("GET", f"/api/ws/drafts/{pid}")
check("...and is told to propose (can_merge false)", st == 200 and js["data"]["can_merge"] is False, str(st))
prop = "Đoạn đề xuất " + secrets.token_hex(3)
st, js = outsider.req("PUT", f"/api/v1/drafts/{pid}", {**base, "content_blocks": blocks + [{"type": "paragraph", "text": prop}], "expected_version": 1})
st, js = outsider.req("POST", f"/api/v1/drafts/{pid}/publish")
check("contributor cannot publish their draft", st == 403, str(st))
st, js = outsider.req("POST", f"/api/v1/drafts/{pid}/submit", {"note": "Thêm một đoạn"})
check("submit a proposal", st == 200 and js["data"]["status"] == "submitted", f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/proposals?story_id={sid}")
check("keeper sees it waiting", st == 200 and any(p["id"] == pid for p in js["data"]), str(st))
notified = lambda: any(n.get("link") == f"/ws/de-xuat/{pid}"
                      for n in k.req("GET", "/api/msg/notifications")[1].get("data", {}).get("notifications", []))
check("keeper is notified (queue)", eventually(notified, 8))
st, rv = k.req("GET", f"/api/ws/drafts/{pid}/review")
ins = [o["hash"] for o in rv["data"]["changes"] if o["op"] == "ins"]
check("review shows the added paragraph", st == 200 and len(ins) == 1, str(st))
st, _ = k.req("POST", f"/api/ws/drafts/{pid}/comments", {"body": "Thêm dấu chấm cuối câu", "block_hash": ins[0] if ins else None})
check("keeper comments on the paragraph", st == 201, str(st))
st, js = k.req("POST", f"/api/v1/drafts/{pid}/return", {"note": "Xem góp ý"})
check("keeper returns it", st == 200 and js["data"]["status"] == "open", f"{st} {js.get('message')}")
st, js = outsider.req("PUT", f"/api/v1/drafts/{pid}", {**base, "content_blocks": blocks + [{"type": "paragraph", "text": prop + "."}], "expected_version": 2})
st, js = outsider.req("POST", f"/api/v1/drafts/{pid}/submit")
st, rv = k.req("GET", f"/api/ws/drafts/{pid}/review")
check("second round shows changes since the first", st == 200 and rv["data"]["round"] == 2 and any(o["op"] != "same" for o in rv["data"]["since_previous"]), str(st))
st, js = k.req("POST", f"/api/v1/drafts/{pid}/publish")
check("keeper merges -> new official version", st == 200 and js["data"]["version"] == vbase + 1, f"{st} {js.get('message')}")
st, rd = reader()
check("readers see the merged proposal", prop + "." in json.dumps(rd, ensure_ascii=False))
k.req("POST", f"/api/ws/chapters/{cid}/rewind", {"to_version": vbase})

# Working together (stage 4a): share through a direct message, helper's copy taken in, shared editing with a lock, hand-over
st, js = k.req("POST", "/api/v1/drafts", {"chapter_id": cid})
kd = js["data"]["id"]
st, js = k.req("POST", f"/api/v1/drafts/{kd}/share", {"username": name, "can_edit": False})
check("share a draft (sent as a message card)", st == 200, f"{st} {js.get('message')}")
st, js = k.req("POST", f"/api/v1/drafts/{kd}/share", {"username": "admin"})
check("cannot share with yourself", st == 400, str(st))
st, conv = outsider.req("GET", f"/api/v1/messages/{args.user}")
check("the helper's conversation carries the draft card", st == 200 and any(m.get("draft_id") == kd for m in conv["data"]["messages"]), str(st))
st, js = outsider.req("GET", f"/api/ws/drafts/{kd}/card")
check("card: the helper may view", st == 200 and js["data"]["access"] == "viewer", str(js.get("data")))
stranger = Client()
sname = "ws_" + secrets.token_hex(3)
stranger.req("POST", "/api/identity/register", {"username": sname, "email": f"{sname}@example.invalid", "password": "Kiem-Tra-" + secrets.token_hex(4)})
st, js = stranger.req("GET", f"/api/ws/drafts/{kd}/card")
check("card: someone else may not", st == 200 and js["data"]["access"] == "none" and "meta" not in js["data"], str(js.get("data")))
st, js = outsider.req("PUT", f"/api/v1/drafts/{kd}", {**base, "content_blocks": blocks, "expected_version": 1})
check("a viewer cannot save the draft", st == 403, str(st))
st, js = outsider.req("POST", f"/api/ws/drafts/{kd}/copy")
hc = js.get("data", {}).get("id")
check("the helper makes their own copy", st == 201 and js["data"]["copied_from"] == kd, f"{st} {js.get('message')}")
helped = "Đoạn sửa giúp " + secrets.token_hex(3)
outsider.req("PUT", f"/api/v1/drafts/{hc}", {**base, "content_blocks": blocks + [{"type": "paragraph", "text": helped}], "expected_version": 1})
st, js = outsider.req("POST", f"/api/v1/drafts/{hc}/offer")
check("...and sends it back", st == 200 and js["data"]["status"] == "offered", f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/drafts/{kd}")
check("the owner sees the offer", st == 200 and any(o["id"] == hc for o in js["data"].get("offers") or []), str(st))
st, js = k.req("GET", f"/api/ws/drafts/{kd}/offers/{hc}")
choices = {c["conflict"]["id"]: "theirs" for c in js["data"]["plan"]["chunks"] if c.get("conflict")}
st, js = k.req("POST", f"/api/ws/drafts/{kd}/offers/{hc}", {"expected_version": js["data"]["draft_version"], "choices": choices})
check("take the helper's changes in", st == 200 and helped in json.dumps(js.get("data", {}), ensure_ascii=False), f"{st} {js.get('message')}")
k.req("POST", f"/api/v1/drafts/{kd}/share", {"username": name, "can_edit": True})
k.req("DELETE", f"/api/ws/drafts/{kd}/lock")
st, js = outsider.req("GET", f"/api/ws/drafts/{kd}")
v = js["data"]["version"]
st, js = outsider.req("PUT", f"/api/v1/drafts/{kd}", {**base, "content_blocks": blocks + [{"type": "paragraph", "text": helped + "!"}], "expected_version": v})
check("with edit rights the helper saves the shared draft", st == 200, f"{st} {js.get('message')}")
st, js = k.req("PUT", f"/api/v1/drafts/{kd}", {**base, "content_blocks": blocks, "expected_version": v + 1})
check("the owner waits while the helper holds the edit lock", st == 409 and "đang sửa" in js.get("message", ""), f"{st} {js.get('message')}")
outsider.req("DELETE", f"/api/ws/drafts/{kd}/lock")
st, js = k.req("POST", f"/api/v1/drafts/{kd}/transfer", {"username": name})
check("hand the draft over", st == 200 and js["data"]["owner_id"] == helper_id, f"{st} {js.get('message')}")
st, js = outsider.req("DELETE", f"/api/ws/drafts/{kd}")
check("the new owner can discard it", st == 200, str(st))
# Tasks (stage 4b): the keeper assigns chapter 1 to the collaborator; done -> proposal; returned -> step reopens; merged
st, ed = k.req("GET", f"/api/v1/chapters/{cid}")
vtask = ed["data"]["ws_version"]
st, js = k.req("POST", "/api/ws/tasks", {"story_id": sid, "chapter_id": cid, "assignee_id": helper_id, "note": "Dịch giúp chương 1"})
tid = js.get("data", {}).get("id")
check("keeper assigns a chapter", st == 201 and js["data"]["status"] == "claimed" and js["data"]["kind"] == "translate", f"{st} {js.get('message')}")
st, js = k.req("POST", "/api/ws/tasks", {"story_id": sid, "chapter_id": cid})
check("a chapter with an active task cannot get another", st == 409, str(st))
tnotified = lambda: any(n.get("type") == "task_opened" for n in outsider.req("GET", "/api/msg/notifications")[1].get("data", {}).get("notifications", []))
check("the assignee is notified (event -> queue)", eventually(tnotified, 8))
st, js = outsider.req("GET", "/api/ws/tasks?mine=1")
check("it is in the assignee's tasks", st == 200 and any(t["id"] == tid for t in js["data"]), str(st))
st, js = outsider.req("POST", f"/api/ws/tasks/{tid}/start")
tdraft = js.get("data", {}).get("draft_id")
check("start -> the assignee's draft", st == 200 and tdraft, f"{st} {js.get('message')}")
tline = "Đoạn theo việc " + secrets.token_hex(3)
st, js = outsider.req("PUT", f"/api/v1/drafts/{tdraft}", {**base, "content_blocks": blocks + [{"type": "paragraph", "text": tline}], "expected_version": 1})
st, js = outsider.req("POST", f"/api/ws/tasks/{tid}/done")
check("last step done -> proposal to the keepers", st == 200 and js["data"]["status"] == "done", f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/board?story_id={sid}")
check("the board shows the proposal and the merge step", st == 200 and any(p["id"] == tdraft for p in js["data"]["proposals"])
      and any(t["kind"] == "merge" and t["status"] == "open" for t in js["data"]["tasks"]), str(st))
st, js = k.req("POST", f"/api/v1/drafts/{tdraft}/return", {"note": "Xem lại"})
st, js = outsider.req("GET", "/api/ws/tasks?mine=1")
again = [t for t in js.get("data", []) if t["kind"] == "translate" and t["status"] == "claimed"]
check("returned -> the step reopens for the assignee", st == 200 and len(again) == 1, str(js.get("data")))
outsider.req("POST", f"/api/ws/tasks/{again[0]['id'] if again else tid}/done")
st, js = k.req("POST", f"/api/v1/drafts/{tdraft}/publish")
check("keeper merges -> chapter updated", st == 200 and js["data"]["version"] == vtask + 1, f"{st} {js.get('message')}")
st, js = k.req("GET", f"/api/ws/board?story_id={sid}")
check("nothing active left, the feed has it", st == 200 and not [t for t in js["data"]["tasks"] if t["status"] in ("open", "claimed")]
      and any(a["action"] == "proposal_merged" for a in js["data"]["activity"]), str(st))
k.req("POST", f"/api/ws/chapters/{cid}/rewind", {"to_version": vtask})
st, groups = Client().req("GET", "/api/v1/groups")
glist = groups.get("data", {}).get("groups", groups.get("data")) if isinstance(groups.get("data"), dict) else groups.get("data", [])
if glist:
    st, js = outsider.req("PUT", f"/api/v1/groups/{glist[0]['id']}/workflow", {"steps": ["translate", "edit"]})
    check("only a group's leader/mod changes its workflow", st == 403, str(st))
# Scheduled publishing (stage 4c): schedule, refuse a time in the past, cancel (publishing at the time is in the Go tests)
from datetime import datetime, timedelta, timezone
st, js = k.req("POST", "/api/v1/drafts", {"chapter_id": cid})
sd = js["data"]["id"]
when = lambda minutes: (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
st, js = k.req("POST", f"/api/v1/drafts/{sd}/publish", {"publish_at": when(-5)})
check("a publish time in the past is refused", st == 400, f"{st} {js.get('message')}")
st, js = k.req("POST", f"/api/v1/drafts/{sd}/publish", {"publish_at": when(30)})
check("schedule a publish", st == 200 and js["data"]["status"] == "scheduled", f"{st} {js.get('message')}")
st, js = k.req("PUT", f"/api/v1/drafts/{sd}", {**base, "content_blocks": blocks, "expected_version": js.get("data", {}).get("version", 1)})
check("a scheduled draft is locked", st == 409, str(st))
st, js = outsider.req("DELETE", f"/api/ws/drafts/{sd}/schedule")
check("only keepers cancel a schedule", st == 403, str(st))
st, js = k.req("DELETE", f"/api/ws/drafts/{sd}/schedule")
check("cancel the schedule", st == 200 and js["data"]["status"] == "open", f"{st} {js.get('message')}")
k.req("DELETE", f"/api/ws/drafts/{sd}")
k.req("DELETE", f"/api/v1/stories/{sid}/collaborators/{helper_id}")

print("FAILED: %d check(s)" % failures if failures else "All checks passed")
sys.exit(1 if failures else 0)
