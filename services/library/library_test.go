package main

// End-to-end tests against a real Postgres (they wipe the database they get):
//   LIBRARY_TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/library_test go test ./...

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	testKey = "uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu"
	hana    = "11111111-1111-1111-1111-111111111111"
	yuki    = "22222222-2222-2222-2222-222222222222"
	banned  = "33333333-3333-3333-3333-333333333333"
	storyA  = "aaaaaaaa-0000-0000-0000-000000000001"
	storyB  = "aaaaaaaa-0000-0000-0000-000000000002" // taken down
	ch1     = "cccccccc-0000-0000-0000-000000000001"
	ch2     = "cccccccc-0000-0000-0000-000000000002"
)

type harness struct {
	t      *testing.T
	s      *server
	srv    *httptest.Server
	mu     sync.Mutex
	counts []any // favorite counts the backend received
}

func signed(user string) http.Header {
	exp := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	m := hmac.New(sha256.New, []byte(testKey))
	m.Write([]byte(user + "|reader|" + exp))
	return http.Header{"X-User-Id": {user}, "X-User-Roles": {"reader"}, "X-User-Exp": {exp}, "X-User-Sig": {hex.EncodeToString(m.Sum(nil))},
		"Content-Type": {"application/json"}}
}

func newHarness(t *testing.T) *harness {
	dbURL := os.Getenv("LIBRARY_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("LIBRARY_TEST_DATABASE_URL not set")
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
	h := &harness{t: t}
	stories := `[{"id":"` + storyA + `","title":"Truyện A","slug":"truyen-a","story_type":"novel","status":"ongoing","approval_status":"approved",
		"total_chapters":2,"total_views":"10","total_favorites":"0","group_name":"Nhóm","tags":[{"name":"Hài","slug":"hai"}],"updated_at":"2026-10-01 10:00:00+00"},
		{"id":"` + storyB + `","title":"Truyện B","slug":"truyen-b","approval_status":"rejected","tags":[],"updated_at":"2026-10-01 10:00:01+00"}]`
	chapters := `[{"id":"` + ch1 + `","story_id":"` + storyA + `","title":"Một","slug":"chuong-1","chapter_number":"1","is_published":true,"updated_at":"2026-10-01 10:00:00+00"},
		{"id":"` + ch2 + `","story_id":"` + storyA + `","title":"Hai","slug":"chuong-2","chapter_number":"2","is_published":true,"updated_at":"2026-10-01 10:00:01+00"}]`
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK([]byte(strings.Repeat("b", 32)), r.Header.Get("X-Internal-Auth"), time.Now()) {
			w.WriteHeader(401)
			return
		}
		first := r.URL.Query().Get("after") == "00000000-0000-0000-0000-000000000000"
		switch r.URL.Path {
		case "/internal/library/stories":
			if first {
				w.Write([]byte(`{"data":` + stories + `}`))
			} else {
				w.Write([]byte(`{"data":[]}`))
			}
		case "/internal/library/chapters":
			if first {
				w.Write([]byte(`{"data":` + chapters + `}`))
			} else {
				w.Write([]byte(`{"data":[]}`))
			}
		case "/internal/library/ids":
			w.Write([]byte(`{"data":["` + storyA + `"]}`)) // story B and the chapters' list below
			if r.URL.Query().Get("type") == "chapter" {
				return
			}
		case "/internal/users/profiles":
			no := int64(7)
			json.NewEncoder(w).Encode(map[string]any{"data": []profile{
				{ID: hana, Username: "hana", CodeNo: &no}, {ID: yuki, Username: "yuki"}, {ID: banned, Username: "bad", IsBanned: true}}})
		case "/internal/favorite-counts":
			var b map[string]any
			json.NewDecoder(r.Body).Decode(&b)
			h.mu.Lock()
			h.counts = append(h.counts, b["stories"])
			h.mu.Unlock()
			w.Write([]byte(`{"success":true}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(backend.Close)
	h.s = &server{cfg: config{SigKey: []byte(testKey), InternalKey: []byte(strings.Repeat("i", 32))}, db: db,
		be: newBackend(backend.URL, []byte(strings.Repeat("b", 32))), now: time.Now}
	if err := h.s.syncOnce(ctx); err != nil {
		t.Fatal(err)
	}
	h.srv = httptest.NewServer(withRequestLog(h.s.routes()))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *harness) call(user, method, path string, body any) (int, map[string]any) {
	h.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, &buf)
	if user == "internal" {
		req.Header.Set("X-Internal-Auth", internalHeader([]byte(strings.Repeat("i", 32)), time.Now().Add(time.Minute).Unix()))
	} else if user != "" {
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

func (h *harness) want(status int, user, method, path string, body any) map[string]any {
	h.t.Helper()
	got, out := h.call(user, method, path, body)
	if got != status {
		h.t.Fatalf("%s %s: %d, want %d (%v)", method, path, got, status, out["message"])
	}
	return out
}

func list(m map[string]any) []any { l, _ := m["data"].([]any); return l }

func TestHistoryFollowsBookmarks(t *testing.T) {
	ctx := context.Background()
	h := newHarness(t)
	h.want(401, "", "GET", "/history", nil)
	h.want(400, hana, "POST", "/history", map[string]any{"chapter_id": "x"})
	h.want(404, hana, "POST", "/history", map[string]any{"chapter_id": "cccccccc-0000-0000-0000-00000000ffff"})
	h.want(200, hana, "POST", "/history", map[string]any{"chapter_id": ch1, "scroll_position": 140, "time_spent_seconds": 60})
	out := h.want(200, hana, "POST", "/history", map[string]any{"chapter_id": ch1, "scroll_position": "40.5", "time_spent_seconds": 30})
	if d := out["data"].(map[string]any); d["timeSpentSeconds"].(float64) != 90 || d["scrollPosition"].(float64) != 40.5 || d["storyId"] != storyA {
		t.Fatalf("history row: %v", d)
	}
	h.want(200, hana, "POST", "/history", map[string]any{"chapter_id": ch2})
	rows := list(h.want(200, hana, "GET", "/history", nil))
	if len(rows) != 1 || rows[0].(map[string]any)["chapter_slug"] != "chuong-2" || rows[0].(map[string]any)["group_name"] != "Nhóm" {
		t.Fatalf("history list (one row per story, its latest chapter): %v", rows)
	}
	// positions are buffered: reading one's own history writes them first; the seconds of both posts were added up
	var scroll float64
	var secs int
	h.s.db.QueryRow(ctx, `SELECT scroll_position, time_spent_seconds FROM reading_history WHERE user_id = $1 AND chapter_id = $2`,
		hana, ch1).Scan(&scroll, &secs)
	if scroll != 40.5 || secs != 90 {
		t.Fatalf("flushed position: %v %v", scroll, secs)
	}
	h.want(200, yuki, "POST", "/history", map[string]any{"chapter_id": ch1, "scroll_position": 12})
	if err := h.s.flushPositions(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if n := len(h.s.pos.take("")); n != 0 {
		t.Fatalf("buffer after flush: %d", n)
	}

	// guest history merged after sign-in: only newer reads overwrite, unknown chapters and bad items are skipped
	old := time.Now().Add(-time.Hour).Format(time.RFC3339)
	m := h.want(200, hana, "POST", "/history/merge", map[string]any{"items": []map[string]any{
		{"chapter_id": ch1, "read_at": old, "scroll_position": 99},
		{"chapter_id": "cccccccc-0000-0000-0000-00000000ffff", "read_at": old},
		{"chapter_id": "x", "read_at": "yesterday"}}})
	if m["data"].(map[string]any)["merged"].(float64) != 0 {
		t.Fatalf("an older guest read overwrote the account's: %v", m)
	}
	m = h.want(200, hana, "POST", "/history/merge", map[string]any{"items": []map[string]any{
		{"chapter_id": ch1, "read_at": time.Now().Add(time.Hour).Format(time.RFC3339), "scroll_position": 70}}})
	h.s.db.QueryRow(ctx, `SELECT scroll_position FROM reading_history WHERE user_id = $1 AND chapter_id = $2`, hana, ch1).Scan(&scroll)
	if m["data"].(map[string]any)["merged"].(float64) != 1 || scroll != 70 {
		t.Fatalf("newer guest read: %v %v", m, scroll)
	}

	// at most 1000 stories per person: the oldest story's rows go
	if _, err := h.s.db.Exec(ctx, `INSERT INTO reading_history (user_id, story_id, chapter_id, read_at)
		SELECT $1, gen_random_uuid(), gen_random_uuid(), NOW() FROM generate_series(1, 1000)`, yuki); err != nil {
		t.Fatal(err)
	}
	if err := h.s.pruneHistory(ctx); err != nil {
		t.Fatal(err)
	}
	var kept, keptCh1 int
	h.s.db.QueryRow(ctx, `SELECT count(DISTINCT story_id), count(*) FILTER (WHERE chapter_id = $2) FROM reading_history WHERE user_id = $1`,
		yuki, ch1).Scan(&kept, &keptCh1)
	if kept != 1000 || keptCh1 != 0 {
		t.Fatalf("prune: %d stories, ch1 rows %d", kept, keptCh1)
	}
	h.s.db.Exec(ctx, `DELETE FROM reading_history WHERE user_id = $1`, yuki)
	// deleting a story from one's history right after reading it: the pending position must not bring it back
	h.want(200, yuki, "POST", "/history", map[string]any{"chapter_id": ch1, "scroll_position": 5})
	h.want(200, yuki, "DELETE", "/history/"+storyA, nil)
	h.s.flushPositions(ctx, "")
	if l := list(h.want(200, yuki, "GET", "/history", nil)); len(l) != 0 {
		t.Fatalf("deleted history came back: %v", l)
	}

	// follow, move to another shelf, unfollow; the backend hears the counts
	h.want(400, hana, "POST", "/favorites/toggle", map[string]any{})
	if a := h.want(200, hana, "POST", "/favorites/toggle", map[string]any{"story_id": storyA})["action"]; a != "added" {
		t.Fatal(a)
	}
	if a := h.want(200, hana, "POST", "/favorites/toggle", map[string]any{"story_id": storyA, "category": "completed"})["action"]; a != "updated" {
		t.Fatal(a)
	}
	st := h.want(200, hana, "GET", "/favorites/status/"+storyA, nil)
	if st["is_favorite"] != true || st["category"] != "completed" {
		t.Fatalf("status: %v", st)
	}
	if f := list(h.want(200, hana, "GET", "/favorites?category=completed", nil)); len(f) != 1 || f[0].(map[string]any)["latest_chapter_slug"] != "chuong-2" {
		t.Fatalf("favorites: %v", f)
	}
	if ids := list(h.want(200, "internal", "GET", "/internal/stories/"+storyA+"/followers", nil)); len(ids) != 1 || ids[0] != hana {
		t.Fatalf("followers: %v", ids)
	}
	if st := h.want(200, "", "GET", "/favorites/status/"+storyA, nil); st["is_favorite"] != false {
		t.Fatalf("guest status: %v", st)
	}
	time.Sleep(200 * time.Millisecond) // counts go in the background
	h.mu.Lock()
	if len(h.counts) != 1 {
		t.Fatalf("favorite counts sent: %v", h.counts)
	}
	h.mu.Unlock()

	// line bookmarks toggle
	h.want(404, hana, "POST", "/bookmarks", map[string]any{"story_id": storyB, "chapter_id": ch1})
	b := h.want(201, hana, "POST", "/bookmarks", map[string]any{"story_id": storyA, "chapter_id": ch1, "line_index": 3, "line_text": "câu"})
	if b["action"] != "added" {
		t.Fatal(b)
	}
	if a := h.want(200, hana, "POST", "/bookmarks", map[string]any{"story_id": storyA, "chapter_id": ch1, "line_index": 3})["action"]; a != "removed" {
		t.Fatal(a)
	}
	h.want(201, hana, "POST", "/bookmarks", map[string]any{"story_id": storyA, "chapter_id": ch2, "note": "x"})
	if l := list(h.want(200, hana, "GET", "/bookmarks?story_id="+storyA, nil)); len(l) != 1 {
		t.Fatalf("bookmarks: %v", l)
	}
	h.want(404, yuki, "DELETE", "/bookmarks/"+list(h.want(200, hana, "GET", "/bookmarks", nil))[0].(map[string]any)["id"].(string), nil)

	// profile overview and recommender data
	ov := h.want(200, "internal", "GET", "/internal/users/"+hana+"/overview", nil)["data"].(map[string]any)
	stats := ov["stats"].(map[string]any)
	if stats["chapters_read"].(float64) != 2 || stats["favorites"].(float64) != 1 || len(ov["tags"].([]any)) != 1 {
		t.Fatalf("overview: %v", ov)
	}
	ru := h.want(200, "internal", "GET", "/internal/reco/user/"+hana, nil)["data"].(map[string]any)
	if len(ru["read_story_ids"].([]any)) != 1 || len(ru["continue"].([]any)) != 0 { // read the last chapter: nothing to continue
		t.Fatalf("reco user: %v", ru)
	}
	ex := h.want(200, "internal", "GET", "/internal/reco/export?days=30", nil)["data"].(map[string]any)
	if len(ex["reads"].([]any)) != 1 || len(ex["timeline"].([]any)) != 2 || len(ex["favorites"].([]any)) != 1 {
		t.Fatalf("reco export: %v", ex)
	}

	// the backend deleted the story: everything about it goes
	h.want(401, "", "POST", "/internal/purge", map[string]any{"story_ids": []string{storyA}})
	h.want(200, "internal", "POST", "/internal/purge", map[string]any{"story_ids": []string{storyA}})
	if l := list(h.want(200, hana, "GET", "/history", nil)); len(l) != 0 {
		t.Fatalf("history after purge: %v", l)
	}
	if l := list(h.want(200, hana, "GET", "/favorites", nil)); len(l) != 0 {
		t.Fatalf("favorites after purge: %v", l)
	}
}

func TestAlbums(t *testing.T) {
	h := newHarness(t)
	h.want(400, hana, "POST", "/albums", map[string]any{"name": "  "})
	a := h.want(201, hana, "POST", "/albums", map[string]any{"name": "Hay", "story_id": storyA})["data"].(map[string]any)
	id := a["id"].(string)
	var code string
	h.s.db.QueryRow(context.Background(), `SELECT code FROM albums WHERE id = $1`, id).Scan(&code)
	if !strings.HasPrefix(code, "AL-0007-") {
		t.Fatalf("code: %s", code)
	}
	h.want(200, hana, "POST", "/albums/"+id+"/stories", map[string]any{"story_id": storyB})
	// private: others need the key
	h.want(404, yuki, "GET", "/albums/"+id, nil)
	page := h.want(200, yuki, "GET", "/albums/"+id+"?key="+a["share_token"].(string), nil)["data"].(map[string]any)
	if len(page["stories"].([]any)) != 1 || page["owner_username"] != "hana" || page["share_token"] != nil || page["story_count"].(float64) != 1 {
		t.Fatalf("album page (taken-down story hidden, key not shown): %v", page)
	}
	h.want(200, yuki, "POST", "/albums/"+id+"/save", map[string]any{"key": a["share_token"]})
	if l := list(h.want(200, yuki, "GET", "/albums/saved", nil)); len(l) != 1 {
		t.Fatalf("saved: %v", l)
	}
	h.want(200, hana, "POST", "/albums/"+id+"/share-link/reset", nil)
	if l := list(h.want(200, yuki, "GET", "/albums/saved", nil)); len(l) != 0 {
		t.Fatal("a reset link must hide the saved private album")
	}
	// public: listed under the story for others, never for banned owners
	h.want(200, hana, "PUT", "/albums/"+id, map[string]any{"is_public": true, "description": "mô tả"})
	b := h.want(201, banned, "POST", "/albums", map[string]any{"name": "Xấu", "story_id": storyA, "is_public": true})
	_ = b
	by := h.want(200, yuki, "GET", "/albums/by-story/"+storyA, nil)["data"].(map[string]any)
	if others := by["others"].([]any); len(others) != 1 || others[0].(map[string]any)["owner_username"] != "hana" {
		t.Fatalf("by story: %v", by)
	}
	// copy into a new album of mine; copying again adds nothing
	c := h.want(201, yuki, "POST", "/albums/"+id+"/copy", map[string]any{})["data"].(map[string]any)
	if c["added"].(float64) != 1 {
		t.Fatalf("copy: %v", c)
	}
	h.want(201, yuki, "POST", "/albums/"+id+"/copy", map[string]any{"target_album_id": c["album_id"]})
	mine := list(h.want(200, yuki, "GET", "/albums/me?story_id="+storyA, nil))
	if len(mine) != 1 || mine[0].(map[string]any)["has_story"] != true || mine[0].(map[string]any)["copied_from"] != id {
		t.Fatalf("my albums: %v", mine)
	}
	var no int64
	h.s.db.QueryRow(context.Background(), `SELECT code_no FROM albums WHERE id = $1`, id).Scan(&no)
	if p := h.want(200, "internal", "GET", "/internal/codes/album/"+strconv.FormatInt(no, 10), nil)["data"].(map[string]any); p["path"] != "/album/"+id {
		t.Fatal(p)
	}
	h.want(404, yuki, "DELETE", "/albums/"+id, nil)
	h.want(200, hana, "DELETE", "/albums/"+id, nil)
}

// The one-time move from the backend's tables (a "legacy" schema stands in for novel_platform).
func TestImportLegacy(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	if _, err := h.s.db.Exec(ctx, `CREATE SCHEMA legacy;
		CREATE TABLE legacy.users (id UUID, code_no BIGINT);
		CREATE TABLE legacy.user_favorites (id UUID, user_id UUID, story_id UUID, category TEXT, notify_updates BOOLEAN, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.bookmarks (id UUID, user_id UUID, story_id UUID, chapter_id UUID, line_text TEXT, line_index INT, scroll_position NUMERIC,
			page_number INT, note TEXT, color TEXT, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.reading_history (id UUID, user_id UUID, story_id UUID, chapter_id UUID, scroll_position NUMERIC, page_number INT,
			read_at TIMESTAMPTZ, time_spent_seconds INT);
		CREATE TABLE legacy.albums (id UUID, user_id UUID, name TEXT, description TEXT, is_public BOOLEAN, share_token TEXT, copied_from UUID,
			created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, code_no BIGINT);
		CREATE TABLE legacy.album_stories (album_id UUID, story_id UUID, added_at TIMESTAMPTZ);
		CREATE TABLE legacy.album_saves (user_id UUID, album_id UUID, share_token TEXT, created_at TIMESTAMPTZ);
		CREATE TABLE legacy.user_follows (id UUID, follower_id UUID, following_id UUID, created_at TIMESTAMPTZ);
		INSERT INTO legacy.users VALUES ('`+hana+`', 12);
		INSERT INTO legacy.user_favorites VALUES (gen_random_uuid(), '`+hana+`', '`+storyA+`', 'reading', true, NOW());
		INSERT INTO legacy.reading_history VALUES (gen_random_uuid(), '`+hana+`', '`+storyA+`', '`+ch1+`', 10, 1, NOW(), 5);
		INSERT INTO legacy.albums VALUES ('dddddddd-0000-0000-0000-000000000001', '`+hana+`', 'Gốc', NULL, true, 'tok1', NULL, '2025-01-01', NOW(), 41),
		                                 ('dddddddd-0000-0000-0000-000000000002', '`+hana+`', 'Chép', NULL, false, 'tok2', 'dddddddd-0000-0000-0000-000000000001', NOW(), NOW(), 42);
		INSERT INTO legacy.album_stories VALUES ('dddddddd-0000-0000-0000-000000000001', '`+storyA+`', NOW());
		INSERT INTO legacy.user_follows VALUES (gen_random_uuid(), '`+yuki+`', '`+hana+`', NOW());`); err != nil {
		t.Fatal(err)
	}
	url := os.Getenv("LIBRARY_TEST_DATABASE_URL")
	if strings.Contains(url, "?") {
		url += "&search_path=legacy"
	} else {
		url += "?search_path=legacy"
	}
	for range 2 { // the second run does nothing
		if err := importLegacy(ctx, h.s.db, url); err != nil {
			t.Fatal(err)
		}
	}
	var code, copied string
	h.s.db.QueryRow(ctx, `SELECT code FROM albums WHERE code_no = 41`).Scan(&code)
	h.s.db.QueryRow(ctx, `SELECT copied_from::text FROM albums WHERE code_no = 42`).Scan(&copied)
	if code != "AL-0012-25-0041" || copied != "dddddddd-0000-0000-0000-000000000001" {
		t.Fatalf("imported albums: %q %q", code, copied)
	}
	if l := list(h.want(200, hana, "GET", "/history", nil)); len(l) != 1 {
		t.Fatalf("imported history: %v", l)
	}
	a := h.want(201, hana, "POST", "/albums", map[string]any{"name": "Mới"})["data"].(map[string]any)
	var no int64
	h.s.db.QueryRow(ctx, `SELECT code_no FROM albums WHERE id = $1`, a["id"]).Scan(&no)
	if no != 43 {
		t.Fatalf("new codes continue after the old ones: %d", no)
	}
	if ov := h.want(200, "internal", "GET", "/internal/users/"+hana+"/overview", nil)["data"].(map[string]any)["stats"].(map[string]any); ov["followers"].(float64) != 1 {
		t.Fatalf("follows: %v", ov)
	}
	// identity.user.deleted: follows go
	if err := h.s.applyIdentityEvent(ctx, []byte(`{"event_id":"eeeeeeee-0000-0000-0000-000000000001","type":"identity.user.deleted","data":{"id":"`+hana+`","deleted_at":"2026-10-11"}}`)); err != nil {
		t.Fatal(err)
	}
	if ov := h.want(200, "internal", "GET", "/internal/users/"+hana+"/overview", nil)["data"].(map[string]any)["stats"].(map[string]any); ov["followers"].(float64) != 0 {
		t.Fatalf("follows after delete: %v", ov)
	}
}

func TestReconcile(t *testing.T) {
	h := newHarness(t)
	if err := h.s.reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	var stories, chapters int
	h.s.db.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM ext_stories), (SELECT count(*) FROM ext_chapters)`).Scan(&stories, &chapters)
	if stories != 1 || chapters != 0 { // story B and both chapters are gone from the backend's lists
		t.Fatalf("after reconcile: %d stories, %d chapters", stories, chapters)
	}
}
