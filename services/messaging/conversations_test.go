package main

// End-to-end tests against a real Postgres (they wipe the database they get):
//   MESSAGING_TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/messaging_test go test ./...

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	hana  = "11111111-1111-1111-1111-111111111111"
	yuki  = "22222222-2222-2222-2222-222222222222"
	kai   = "33333333-3333-3333-3333-333333333333"
	group = "44444444-4444-4444-4444-444444444444"
	boss  = "55555555-5555-5555-5555-555555555555" // signed as an admin
	story = "66666666-6666-6666-6666-666666666666"
)

type convHarness struct {
	t   *testing.T
	s   *server
	srv *httptest.Server
}

func newConv(t *testing.T) *convHarness {
	dbURL := os.Getenv("MESSAGING_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("MESSAGING_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := db.Exec(ctx, `DROP SCHEMA IF EXISTS legacy CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	names := map[string]string{hana: "hana", yuki: "yuki", kai: "kai"}
	// The backend's internal API: profiles and the group (hana leader, yuki member; kai outside)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK([]byte(strings.Repeat("b", 32)), r.Header.Get("X-Internal-Auth"), time.Now()) {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/internal/users/profiles":
			var b struct{ IDs, Usernames []string }
			json.NewDecoder(r.Body).Decode(&b)
			out := []profile{}
			for id, n := range names {
				for _, want := range append(b.IDs, b.Usernames...) {
					if want == id || want == n {
						dn := strings.ToUpper(n)
						out = append(out, profile{ID: id, Username: n, DisplayName: &dn})
					}
				}
			}
			json.NewEncoder(w).Encode(map[string]any{"data": out})
		case "/internal/groups/" + group + "/members":
			json.NewEncoder(w).Encode(map[string]any{"data": []member{{hana, "leader"}, {yuki, "member"}}})
		case "/internal/stories/" + story + "/followers": // one page: hana and yuki follow the story
			page := []string{hana, yuki}
			if r.URL.Query().Get("after") != "" {
				page = []string{}
			}
			json.NewEncoder(w).Encode(map[string]any{"data": page})
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(backend.Close)
	s := &server{cfg: config{SigKey: []byte(testKey), InternalKey: []byte(strings.Repeat("i", 32))}, db: db,
		be: newBackend(backend.URL, []byte(strings.Repeat("b", 32))), hub: newHub(), now: time.Now,
		rate: &rateLimiter{limit: 30, hits: map[string][]time.Time{}}}
	srv := httptest.NewServer(withRequestLog(s.routes()))
	t.Cleanup(srv.Close)
	return &convHarness{t, s, srv}
}

func (h *convHarness) call(user, method, path string, body any) (int, map[string]any) {
	h.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, &buf)
	if user != "" {
		req.Header = signed(user)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (h *convHarness) want(status int, user, method, path string, body any) map[string]any {
	h.t.Helper()
	got, out := h.call(user, method, path, body)
	if got != status {
		h.t.Fatalf("%s %s: %d, want %d (%v)", method, path, got, status, out["message"])
	}
	return out
}

func data(m map[string]any) map[string]any { d, _ := m["data"].(map[string]any); return d }

func TestDirectMessages(t *testing.T) {
	h := newConv(t)
	h.want(401, "", "GET", "/messages", nil)
	h.want(400, hana, "POST", "/messages/yuki", map[string]any{"message": "  "})
	h.want(404, hana, "POST", "/messages/nobody", map[string]any{"message": "hi"})
	h.want(400, hana, "POST", "/messages/hana", map[string]any{"message": "hi"})
	first := data(h.want(201, hana, "POST", "/messages/yuki", map[string]any{"message": "chào yuki"}))
	h.want(201, hana, "POST", "/messages/yuki", map[string]any{"message": "có rảnh không"})

	inbox := data(h.want(200, yuki, "GET", "/messages", nil))
	convs := inbox["conversations"].([]any)
	if inbox["unread_count"].(float64) != 2 || len(convs) != 1 || convs[0].(map[string]any)["username"] != "hana" ||
		convs[0].(map[string]any)["last_message"] != "có rảnh không" {
		t.Fatalf("yuki's inbox: %v", inbox)
	}
	if data(h.want(200, hana, "GET", "/messages", nil))["unread_count"].(float64) != 0 {
		t.Fatal("own messages are read")
	}
	// yuki opens the thread: read; hana then sees read_at on her messages
	thread := data(h.want(200, yuki, "GET", "/messages/hana", nil))
	if len(thread["messages"].([]any)) != 2 || thread["can_message"] != true || thread["partner"].(map[string]any)["display_name"] != "HANA" {
		t.Fatalf("thread: %v", thread)
	}
	if data(h.want(200, yuki, "GET", "/messages", nil))["unread_count"].(float64) != 0 {
		t.Fatal("opening the thread marks it read")
	}
	msgs := data(h.want(200, hana, "GET", "/messages/yuki", nil))["messages"].([]any)
	if msgs[0].(map[string]any)["read_at"] == nil || msgs[0].(map[string]any)["recipient_id"] != yuki {
		t.Fatalf("read_at for the sender: %v", msgs[0])
	}
	// search by text and by name
	if n := len(data(h.want(200, yuki, "GET", "/messages?q=r%E1%BA%A3nh", nil))["conversations"].([]any)); n != 1 {
		t.Fatalf("search text: %d", n)
	}
	if n := len(data(h.want(200, yuki, "GET", "/messages?q=zzz", nil))["conversations"].([]any)); n != 0 {
		t.Fatalf("search miss: %d", n)
	}

	// labels
	label := data(h.want(201, yuki, "POST", "/messages/labels", map[string]any{"name": "Bạn", "color": "rose"}))
	h.want(400, yuki, "POST", "/messages/labels", map[string]any{"name": "bạn"})
	h.want(400, yuki, "POST", "/messages/labels", map[string]any{"name": "x", "color": "indigo"})
	h.want(200, yuki, "PUT", "/messages/hana/labels", map[string]any{"label_ids": []string{label["id"].(string)}})
	h.want(400, hana, "PUT", "/messages/yuki/labels", map[string]any{"label_ids": []string{label["id"].(string)}}) // not hana's
	if n := len(data(h.want(200, yuki, "GET", "/messages?label="+label["id"].(string), nil))["conversations"].([]any)); n != 1 {
		t.Fatalf("label filter: %d", n)
	}
	h.want(200, yuki, "PATCH", "/messages/labels/"+label["id"].(string), map[string]any{"color": "teal"})
	h.want(200, yuki, "DELETE", "/messages/labels/"+label["id"].(string), nil)
	h.want(404, yuki, "DELETE", "/messages/labels/"+label["id"].(string), nil)

	// pins: both see them
	h.want(200, yuki, "POST", "/messages/hana/pins/"+first["id"].(string), nil)
	if p := data(h.want(200, hana, "GET", "/messages/yuki", nil))["pinned"].([]any); len(p) != 1 {
		t.Fatalf("pinned: %v", p)
	}
	h.want(200, hana, "DELETE", "/messages/yuki/pins/"+first["id"].(string), nil)
	h.want(404, kai, "POST", "/messages/hana/pins/"+first["id"].(string), nil) // not kai's conversation

	// block: nobody can send either way; unblock restores
	h.want(200, yuki, "POST", "/messages/hana/block", nil)
	h.want(403, hana, "POST", "/messages/yuki", map[string]any{"message": "?"})
	h.want(403, yuki, "POST", "/messages/hana", map[string]any{"message": "?"})
	if data(h.want(200, yuki, "GET", "/messages/hana", nil))["blocked_by_me"] != true {
		t.Fatal("blocked_by_me")
	}
	h.want(200, yuki, "DELETE", "/messages/hana/block", nil)
	h.want(201, yuki, "POST", "/messages/hana", map[string]any{"message": "ok"})

	// the backend's draft card
	h.want(401, "", "POST", "/internal/dm", map[string]any{"from": hana, "to": kai, "message": "nháp"})
	req, _ := http.NewRequest("POST", h.srv.URL+"/internal/dm", strings.NewReader(`{"from":"`+hana+`","to":"`+kai+`","message":"xem nháp","draft_id":"`+group+`"}`))
	req.Header.Set("X-Internal-Auth", signInternal(strings.Repeat("i", 32)))
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 201 {
		t.Fatalf("internal dm: %v %v", res.StatusCode, err)
	}
	if m := data(h.want(200, kai, "GET", "/messages/hana", nil))["messages"].([]any); len(m) != 1 || m[0].(map[string]any)["draft_id"] != group {
		t.Fatalf("draft card: %v", m)
	}
}

func TestGroupChat(t *testing.T) {
	h := newConv(t)
	h.want(403, kai, "POST", "/groups/"+group+"/messages", map[string]any{"message": "xin vào"})
	h.want(403, kai, "GET", "/groups/"+group+"/messages", nil)
	h.want(404, hana, "GET", "/groups/55555555-5555-5555-5555-555555555555/messages", nil)
	mine := data(h.want(201, yuki, "POST", "/groups/"+group+"/messages", map[string]any{"message": "chào nhóm"}))
	theirs := data(h.want(201, hana, "POST", "/groups/"+group+"/messages", map[string]any{"message": "chào em"}))
	if mine["member_role"] != "member" || theirs["username"] != "hana" {
		t.Fatalf("group message shape: %v %v", mine, theirs)
	}
	_, out := h.call(hana, "GET", "/groups/"+group+"/messages", nil)
	if list := out["data"].([]any); len(list) != 2 || list[0].(map[string]any)["message"] != "chào nhóm" {
		t.Fatalf("group history: %v", out)
	}
	h.want(403, yuki, "DELETE", "/groups/"+group+"/messages/"+theirs["id"].(string), nil) // a member can't delete others'
	h.want(200, hana, "DELETE", "/groups/"+group+"/messages/"+mine["id"].(string), nil)   // the leader can
	h.want(200, hana, "DELETE", "/groups/"+group+"/messages/"+theirs["id"].(string), nil)
	h.want(404, hana, "DELETE", "/groups/"+group+"/messages/"+theirs["id"].(string), nil)
}

// The one-time move from the backend's tables (a "legacy" schema stands in for novel_platform).
func TestImportLegacy(t *testing.T) {
	h := newConv(t)
	ctx := context.Background()
	if _, err := h.s.db.Exec(ctx, `CREATE SCHEMA legacy;
		CREATE TABLE legacy.direct_messages (id UUID PRIMARY KEY, sender_id UUID, recipient_id UUID, message TEXT, read_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ, pinned_at TIMESTAMPTZ, pinned_by UUID, draft_id UUID);
		CREATE TABLE legacy.group_messages (id UUID PRIMARY KEY, group_id UUID, user_id UUID, message TEXT, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.user_blocks (blocker_id UUID, blocked_id UUID, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.dm_labels (id UUID, user_id UUID, name TEXT, color TEXT, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.dm_label_conversations (label_id UUID, partner_id UUID, created_at TIMESTAMPTZ);
		INSERT INTO legacy.direct_messages VALUES
			('a0000000-0000-0000-0000-000000000001', '`+hana+`', '`+yuki+`', 'cũ 1', NOW() - interval '1 hour', NOW() - interval '2 hours', NULL, NULL, NULL),
			('a0000000-0000-0000-0000-000000000002', '`+hana+`', '`+yuki+`', 'cũ 2', NULL, NOW() - interval '1 hour', NOW(), '`+yuki+`', NULL);
		INSERT INTO legacy.group_messages VALUES ('b0000000-0000-0000-0000-000000000001', '`+group+`', '`+yuki+`', 'nhóm cũ', NOW());
		INSERT INTO legacy.user_blocks VALUES ('`+kai+`', '`+hana+`', NOW());
		INSERT INTO legacy.dm_labels VALUES ('c0000000-0000-0000-0000-000000000001', '`+yuki+`', 'Cũ', 'sky', NOW());
		INSERT INTO legacy.dm_label_conversations VALUES ('c0000000-0000-0000-0000-000000000001', '`+hana+`', NOW());
		CREATE TABLE legacy.users (id UUID, username TEXT, display_name TEXT);
		CREATE TABLE legacy.stories (id UUID, slug TEXT, cover_image_url TEXT);
		CREATE TABLE legacy.chapters (id UUID, story_id UUID, slug TEXT);
		CREATE TABLE legacy.posts (id UUID, slug TEXT);
		CREATE TABLE legacy.translation_groups (id UUID, slug TEXT);
		CREATE TABLE legacy.user_settings (user_id UUID, notify_chapter_update BOOLEAN, notify_group_events BOOLEAN, notify_comments BOOLEAN,
			notify_post_comments BOOLEAN, notify_post_reactions BOOLEAN);
		CREATE TABLE legacy.notifications (id UUID, user_id UUID, type TEXT, title TEXT, message TEXT, reference_type TEXT, reference_id UUID,
			sender_id UUID, is_read BOOLEAN, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ, dedupe_key TEXT);
		INSERT INTO legacy.users VALUES ('`+yuki+`', 'yuki', 'Yuki');
		INSERT INTO legacy.stories VALUES ('`+story+`', 'truyen-a', '/c.jpg');
		INSERT INTO legacy.chapters VALUES ('d0000000-0000-0000-0000-000000000001', '`+story+`', 'chuong-1');
		INSERT INTO legacy.user_settings VALUES ('`+hana+`', false, true, false, false, false), ('`+yuki+`', true, true, true, false, false);
		INSERT INTO legacy.notifications VALUES
			('e0000000-0000-0000-0000-000000000001', '`+hana+`', 'chapter_update', 'Chương mới: A', 'x', 'chapter', 'd0000000-0000-0000-0000-000000000001',
			 '`+yuki+`', false, NULL, NOW(), 'chapter:d0000000-0000-0000-0000-000000000001:`+hana+`'),
			('e0000000-0000-0000-0000-000000000002', '`+hana+`', 'system', 'Đề xuất', NULL, 'draft', 'f0000000-0000-0000-0000-000000000001',
			 NULL, true, NULL, NOW() - interval '1 hour', NULL);`); err != nil {
		t.Fatal(err)
	}
	legacyURL := os.Getenv("MESSAGING_TEST_DATABASE_URL") + "?search_path=legacy"
	if strings.Contains(os.Getenv("MESSAGING_TEST_DATABASE_URL"), "?") {
		legacyURL = os.Getenv("MESSAGING_TEST_DATABASE_URL") + "&search_path=legacy"
	}
	for range 2 { // re-runs add nothing
		if err := importLegacy(ctx, h.s.db, legacyURL); err != nil {
			t.Fatal(err)
		}
	}
	inbox := data(h.want(200, yuki, "GET", "/messages", nil))
	if inbox["unread_count"].(float64) != 1 || len(inbox["conversations"].([]any)) != 1 {
		t.Fatalf("imported inbox: %v", inbox)
	}
	thread := data(h.want(200, hana, "GET", "/messages/yuki", nil))
	if len(thread["messages"].([]any)) != 2 || len(thread["pinned"].([]any)) != 1 {
		t.Fatalf("imported thread: %v", thread)
	}
	h.want(403, kai, "POST", "/messages/hana", map[string]any{"message": "x"})
	if n := len(data(h.want(200, yuki, "GET", "/messages?label=c0000000-0000-0000-0000-000000000001", nil))["conversations"].([]any)); n != 1 {
		t.Fatalf("imported label: %d", n)
	}
	_, out := h.call(yuki, "GET", "/groups/"+group+"/messages", nil)
	if list := out["data"].([]any); len(list) != 1 {
		t.Fatalf("imported group chat: %v", out)
	}

	inbox = data(h.want(200, hana, "GET", "/notifications", nil))
	list := inbox["notifications"].([]any)
	if len(list) != 2 || inbox["unread_count"].(float64) != 1 || inbox["unseen_count"].(float64) != 1 {
		t.Fatalf("imported notifications: %v", inbox)
	}
	first, second := list[0].(map[string]any), list[1].(map[string]any)
	if first["link"] != "/truyen/truyen-a/chuong-1" || first["image"] != "/c.jpg" || first["category"] != "read" ||
		second["link"] != "/ws/de-xuat/f0000000-0000-0000-0000-000000000001" || second["category"] != "workspace" || second["is_read"] != true {
		t.Fatalf("imported notification fields: %v", list)
	}
	// hana switched off chapters and every interaction kind; yuki only two of the three interaction switches
	for user, want := range map[string]map[string]bool{hana: {"read": true, "interaction": true}, yuki: {}} {
		for _, c := range h.want(200, user, "GET", "/notifications/settings", nil)["data"].([]any) {
			c := c.(map[string]any)
			if off := !c["web"].(bool); off != want[c["category"].(string)] {
				t.Fatalf("imported settings of %s: %v", user, c)
			}
		}
	}
	// the imported dedupe key still guards against a re-delivered job
	if n, _ := h.s.deliver(ctx, []notifyItem{{UserID: hana, Type: "group_member_add", Title: "x", DedupeKey: "chapter:d0000000-0000-0000-0000-000000000001:" + hana}}); n != 0 {
		t.Fatal("dedupe key from the old table must hold")
	}
	// done once: what was deleted here does not come back
	h.want(200, hana, "DELETE", "/notifications/e0000000-0000-0000-0000-000000000001", nil)
	if err := importLegacy(ctx, h.s.db, legacyURL); err != nil {
		t.Fatal(err)
	}
	if n := len(data(h.want(200, hana, "GET", "/notifications", nil))["notifications"].([]any)); n != 1 {
		t.Fatalf("a deleted notification came back: %d", n)
	}
}

func TestNotifications(t *testing.T) {
	h := newConv(t)
	key := strings.Repeat("i", 32)
	job := func(j map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		json.NewEncoder(&buf).Encode(j)
		req, _ := http.NewRequest("POST", h.srv.URL+"/internal/notifications/jobs", &buf)
		req.Header.Set("X-Internal-Auth", signInternal(key))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("job: HTTP %d", res.StatusCode)
		}
	}
	reaction := func(from, name string) map[string]any {
		return map[string]any{"userId": hana, "type": "post_reaction", "title": name + " đã bày tỏ cảm xúc về bài viết của bạn",
			"message": "\"Bài\" (like)", "referenceType": "post", "referenceId": "p1", "senderId": from, "actorName": name,
			"link": "/fandom/bai", "dedupeKey": "reaction:p1:" + from}
	}
	inbox := func(user, query string) map[string]any {
		return data(h.want(200, user, "GET", "/notifications"+query, nil))
	}
	h.want(401, "", "GET", "/notifications", nil)

	// two people react, one twice (same dedupe key): one row, 2 people, unseen
	job(map[string]any{"kind": "notify", "items": []any{reaction(yuki, "Yuki")}})
	job(map[string]any{"kind": "notify", "items": []any{reaction(kai, "Kai"), reaction(yuki, "Yuki")}})
	got := inbox(hana, "")
	list := got["notifications"].([]any)
	if len(list) != 1 || got["unseen_count"].(float64) != 1 || got["unread_count"].(float64) != 1 {
		t.Fatalf("grouped: %v", got)
	}
	n := list[0].(map[string]any)
	if n["title"] != "Kai và 1 người khác đã bày tỏ cảm xúc về bài viết của bạn" || n["count"].(float64) != 2 || n["link"] != "/fandom/bai" {
		t.Fatalf("grouped row: %v", n)
	}
	// opening the bell clears the number, the row stays unread until clicked
	h.want(200, hana, "POST", "/notifications/seen", nil)
	if got := inbox(hana, ""); got["unseen_count"].(float64) != 0 || got["unread_count"].(float64) != 1 {
		t.Fatalf("seen: %v", got)
	}
	h.want(404, yuki, "PUT", "/notifications/"+n["id"].(string)+"/read", nil) // not yours
	h.want(200, hana, "PUT", "/notifications/"+n["id"].(string)+"/read", nil)
	// a read row no longer merges: the next reaction starts a new one
	job(map[string]any{"kind": "notify", "items": []any{reaction(boss, "Boss")}})
	if got := inbox(hana, "?unread=1"); len(got["notifications"].([]any)) != 1 || got["unread_count"].(float64) != 1 {
		t.Fatalf("after read: %v", got)
	}

	// switched off: interaction no longer arrives; a take-down (locked) still does
	h.want(400, hana, "PUT", "/notifications/settings", map[string]any{"nope": map[string]any{"web": false}})
	h.want(200, hana, "PUT", "/notifications/settings", map[string]any{"interaction": map[string]any{"web": false}})
	job(map[string]any{"kind": "notify", "items": []any{
		map[string]any{"userId": hana, "type": "comment_reply", "title": "Yuki đã trả lời", "senderId": yuki, "dedupeKey": "c1"},
		map[string]any{"userId": hana, "type": "post_removed", "title": "Bài viết của bạn đã bị gỡ", "dedupeKey": "r1"},
	}})
	if got := inbox(hana, "?category=interaction&unread=1"); len(got["notifications"].([]any)) != 1 {
		t.Fatalf("interaction switched off: %v", got)
	}
	if got := inbox(hana, "?category=moderation"); len(got["notifications"].([]any)) != 1 {
		t.Fatalf("locked kind: %v", got)
	}
	h.want(400, hana, "GET", "/notifications?category=nope", nil)

	// new chapters: every follower but the uploader; unread ones merge per story
	for _, ch := range []string{"d0000000-0000-0000-0000-000000000001", "d0000000-0000-0000-0000-000000000002"} {
		job(map[string]any{"kind": "chapter_published", "storyId": story, "chapterId": ch, "chapterTitle": "Chương", "storyTitle": "Truyện A",
			"uploaderId": yuki, "link": "/truyen/a/" + ch})
	}
	reads := inbox(hana, "?category=read")["notifications"].([]any)
	if len(reads) != 1 || reads[0].(map[string]any)["title"] != "Truyện \"Truyện A\" có 2 chương mới" {
		t.Fatalf("chapter fan-out: %v", reads)
	}
	if got := inbox(yuki, "?category=read"); len(got["notifications"].([]any)) != 0 {
		t.Fatalf("the uploader got a notification: %v", got)
	}

	// site-wide announcement: admins only, everybody sees it once
	h.want(403, hana, "POST", "/admin/broadcasts", map[string]any{"title": "x"})
	h.want(400, boss, "POST", "/admin/broadcasts", map[string]any{"title": "Bảo trì", "link": "https://evil.example"})
	b := data(h.want(200, boss, "POST", "/admin/broadcasts", map[string]any{"title": "Bảo trì tối nay", "message": "22h–23h"}))
	got = inbox(kai, "")
	if l := got["notifications"].([]any); len(l) != 1 || l[0].(map[string]any)["type"] != "broadcast" || got["unseen_count"].(float64) != 1 {
		t.Fatalf("broadcast: %v", got)
	}
	h.want(200, kai, "PUT", "/notifications/"+b["id"].(string)+"/read", nil)
	if got := inbox(kai, ""); got["unread_count"].(float64) != 0 {
		t.Fatalf("broadcast read: %v", got)
	}
	if l := h.want(200, boss, "GET", "/admin/broadcasts", nil)["data"].([]any); len(l) != 1 || l[0].(map[string]any)["read_count"].(float64) != 1 {
		t.Fatalf("broadcast list: %v", l)
	}

	h.want(200, hana, "PUT", "/notifications/read-all", nil)
	if got := inbox(hana, ""); got["unread_count"].(float64) != 0 {
		t.Fatalf("read-all: %v", got)
	}
	h.want(200, boss, "DELETE", "/admin/broadcasts/"+b["id"].(string), nil)
	if got := inbox(kai, ""); len(got["notifications"].([]any)) != 0 {
		t.Fatalf("deleted broadcast: %v", got)
	}
}

func signInternal(key string) string {
	exp := time.Now().Add(time.Minute).Unix()
	return internalHeader([]byte(key), exp)
}
