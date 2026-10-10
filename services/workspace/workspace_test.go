package main

// Unit tests always run. Integration tests need a throwaway Postgres (they wipe it):
//   WORKSPACE_TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/workspace_test go test ./...

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

func TestBlockHashIgnoresPositionAndKeyOrder(t *testing.T) {
	h1, _, _ := blockHash(block{"id": "b1", "type": "paragraph", "text": "Xin chào"})
	h2, _, _ := blockHash(block{"text": "Xin chào", "type": "paragraph", "id": "b7"})
	h3, _, _ := blockHash(block{"id": "b1", "type": "paragraph", "text": "Xin chào!"})
	if h1 != h2 || h1 == h3 {
		t.Fatalf("hash: %s %s %s", h1, h2, h3)
	}
}

func TestBlockHashPlainParagraphHTML(t *testing.T) {
	// what an imported chapter stores vs what the editor sends back for the same paragraph
	plain, _, _ := blockHash(block{"type": "paragraph", "text": "A & B < C"})
	edited, _, _ := blockHash(block{"id": "b3", "type": "paragraph", "text": "A & B < C", "html": "<p>A &amp; B &lt; C</p>"})
	bold, _, _ := blockHash(block{"type": "paragraph", "text": "A & B < C", "html": "<p><strong>A</strong> &amp; B &lt; C</p>"})
	centered, _, _ := blockHash(block{"type": "paragraph", "text": "A", "html": "<p style=\"text-align:center\">A</p>"})
	alone, _, _ := blockHash(block{"type": "paragraph", "text": "A"})
	if plain != edited || plain == bold || centered == alone {
		t.Fatalf("plain %s edited %s bold %s centered %s", plain, edited, bold, centered)
	}
}

func TestDiffHashes(t *testing.T) {
	render := func(ops []diffOp) string {
		var b strings.Builder
		for _, o := range ops {
			b.WriteString(map[string]string{"same": " ", "del": "-", "ins": "+"}[o.Op] + o.Hash)
		}
		return b.String()
	}
	cases := []struct{ a, b, want string }{
		{"abc", "abc", " a b c"},
		{"abc", "abxc", " a b+x c"},      // insert
		{"abc", "ac", " a-b c"},          // delete
		{"abc", "axc", " a-b+x c"},       // changed paragraph = del + ins
		{"", "ab", "+a+b"},               // new chapter
		{"ab", "", "-a-b"},               // emptied
		{"abcd", "cdab", "-a-b c d+a+b"}, // moved block shows as delete + insert
	}
	split := func(s string) []string { return strings.Split(s, "")[:len(s)] }
	for _, c := range cases {
		a, b := split(c.a), split(c.b)
		if c.a == "" {
			a = nil
		}
		if c.b == "" {
			b = nil
		}
		if got := render(diffHashes(a, b)); got != c.want {
			t.Errorf("%q -> %q: got %q, want %q", c.a, c.b, got, c.want)
		}
	}
}

func TestMerge3(t *testing.T) {
	// one letter = one paragraph hash; conflicts render as <base|ours|theirs>
	render := func(chunks []mergeChunk) string {
		var b strings.Builder
		for _, c := range chunks {
			if c.Conflict == nil {
				b.WriteString(strings.Join(c.Ok, ""))
				continue
			}
			b.WriteString("<" + strings.Join(c.Conflict.Base, "") + "|" + strings.Join(c.Conflict.Ours, "") + "|" + strings.Join(c.Conflict.Theirs, "") + ">")
		}
		return b.String()
	}
	split := func(s string) []string {
		if s == "" {
			return nil
		}
		return strings.Split(s, "")
	}
	cases := []struct{ name, base, ours, theirs, want string }{
		{"nothing changed", "abc", "abc", "abc", "abc"},
		{"only ours changed", "abc", "aXc", "abc", "aXc"},
		{"only theirs changed", "abc", "abc", "aXc", "aXc"},
		{"different paragraphs", "abcde", "aXcde", "abcYe", "aXcYe"},
		{"both the same change", "abc", "aXc", "aXc", "aXc"},
		{"both changed one paragraph", "abc", "aXc", "aYc", "a<b|X|Y>c"},
		{"ours inserted, theirs deleted elsewhere", "abcd", "abXcd", "abc", "abXc"},
		{"theirs inserted at the end", "ab", "Ab", "abZ", "AbZ"},
		{"both inserted at the same place", "ab", "aXb", "aYb", "a<|X|Y>b"},
		{"ours deleted what theirs edited", "abc", "ac", "aYc", "a<b||Y>c"},
		{"new paragraphs both sides apart", "", "X", "", "X"},
	}
	for _, c := range cases {
		if got := render(merge3(split(c.base), split(c.ours), split(c.theirs))); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}

	// conflicts are numbered and resolved by the user's choices
	chunks := merge3(split("abc"), split("XbY"), split("ZbW"))
	if render(chunks) != "<a|X|Z>b<c|Y|W>" || chunks[0].Conflict.ID != "b0" || chunks[2].Conflict.ID != "b1" {
		t.Fatalf("ids: %s", render(chunks))
	}
	out, _, err := resolve(chunks, chapterMeta{}, nil, chapterMeta{}, map[string]string{"b0": "theirs", "b1": "both"})
	if err != nil || strings.Join(out, "") != "ZbYW" {
		t.Fatalf("resolve: %v %v", out, err)
	}
	if _, _, err := resolve(chunks, chapterMeta{}, nil, chapterMeta{}, map[string]string{"b0": "ours"}); err == nil {
		t.Fatal("an unchosen conflict must be refused")
	}
}

func TestMergeMeta(t *testing.T) {
	base := chapterMeta{Title: "Mở đầu", ChapterNumber: 1}
	ours := chapterMeta{Title: "Mở đầu (sửa)", ChapterNumber: 1}
	theirs := chapterMeta{Title: "Mở đầu", ChapterNumber: 2}
	m, conf := mergeMeta(base, ours, theirs)
	if m.Title != "Mở đầu (sửa)" || m.ChapterNumber != 2 || len(conf) != 0 {
		t.Fatalf("clean meta merge: %+v %v", m, conf)
	}
	theirs.Title = "Khởi đầu"
	m, conf = mergeMeta(base, ours, theirs)
	if len(conf) != 1 || conf[0].ID != "title" || m.Title != "Mở đầu (sửa)" {
		t.Fatalf("title conflict: %+v %v", m, conf)
	}
	_, m, err := resolve(nil, m, conf, theirs, map[string]string{"title": "theirs"})
	if err != nil || m.Title != "Khởi đầu" || m.ChapterNumber != 2 {
		t.Fatalf("resolve meta: %+v %v", m, err)
	}
}

// ---- integration ----------------------------------------------------------------------------------------

const testKey = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk"

type wsHarness struct {
	t       *testing.T
	s       *server
	srv     *httptest.Server
	story   string
	keeper  string
	member  string
	removed bool
}

func newWS(t *testing.T) *wsHarness {
	dbURL := os.Getenv("WORKSPACE_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("WORKSPACE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := db.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, db); err != nil {
		t.Fatal(err)
	}
	h := &wsHarness{t: t, story: newUUID(), keeper: newUUID(), member: newUUID()}
	// The backend's /internal/permissions: keeper owns the story, member only contributes
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK([]byte(testKey), r.Header.Get("X-Internal-Auth"), time.Now()) {
			w.WriteHeader(401)
			return
		}
		u := r.URL.Query().Get("user")
		p := perm{Keeper: u == h.keeper, Contributor: u == h.keeper || u == h.member, Removed: h.removed, Name: "Người " + u[:4]}
		json.NewEncoder(w).Encode(map[string]any{"data": p})
	}))
	t.Cleanup(backend.Close)
	h.s = &server{cfg: config{HeaderKey: []byte(testKey), BackendURL: backend.URL}, db: db, now: time.Now, perms: &permCache{m: map[string]permEntry{}}}
	h.srv = httptest.NewServer(withRequestLog(h.s.routes()))
	t.Cleanup(h.srv.Close)
	return h
}

func (h *wsHarness) call(method, path, user string, internal bool, body any) (int, map[string]any) {
	h.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, h.srv.URL+path, &buf)
	if internal {
		req.Header.Set("X-Internal-Auth", internalAuth([]byte(testKey), time.Now()))
	}
	if user != "" { // what the gateway adds after identity's verify
		exp := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
		req.Header.Set("X-User-Id", user)
		req.Header.Set("X-User-Roles", "reader")
		req.Header.Set("X-User-Exp", exp)
		req.Header.Set("X-User-Sig", hmacHex(testKey, user+"|reader|"+exp))
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

func (h *wsHarness) want(status int, method, path, user string, internal bool, body any) map[string]any {
	h.t.Helper()
	got, out := h.call(method, path, user, internal, body)
	if got != status {
		h.t.Fatalf("%s %s: %d, want %d (%v)", method, path, got, status, out["message"])
	}
	if d, isMap := out["data"].(map[string]any); isMap {
		return d
	}
	return out
}

func para(texts ...string) []block {
	out := []block{}
	for i, t := range texts {
		out = append(out, block{"id": fmt.Sprintf("b%d", i+1), "type": "paragraph", "text": t})
	}
	return out
}

func TestRevisionLifecycle(t *testing.T) {
	h := newWS(t)
	meta := map[string]any{"title": "Mở đầu", "chapter_number": 1}
	created := h.want(201, "POST", "/internal/chapters", "", true, map[string]any{"story_id": h.story, "meta": meta, "blocks": para("A", "B", "C"), "author_id": h.keeper})
	id := created["chapter_id"].(string)
	if created["version"].(float64) != 1 {
		t.Fatal("first version must be 1")
	}
	// Same number in the same story: refused
	h.want(409, "POST", "/internal/chapters", "", true, map[string]any{"story_id": h.story, "meta": meta, "blocks": para("x")})

	v2 := h.want(200, "POST", "/internal/chapters/"+id+"/revisions", "", true,
		map[string]any{"meta": meta, "blocks": para("A", "B sửa", "C", "D"), "expected_version": 1})
	if v2["version"].(float64) != 2 {
		t.Fatal("edit must make v2")
	}
	// Somebody saving on top of v1 after v2 exists: conflict, nothing written
	h.want(409, "POST", "/internal/chapters/"+id+"/revisions", "", true, map[string]any{"meta": meta, "blocks": para("old"), "expected_version": 1})

	// History and compare (contributors), not for strangers or guests
	list := h.want(200, "GET", "/chapters/"+id+"/revisions", h.member, false, nil)["data"].([]any)
	if len(list) != 2 {
		t.Fatalf("revisions: %d", len(list))
	}
	h.want(403, "GET", "/chapters/"+id+"/revisions", newUUID(), false, nil)
	h.want(401, "GET", "/chapters/"+id+"/revisions", "", false, nil)
	cmp := h.want(200, "GET", "/chapters/"+id+"/compare?from=1&to=2", h.member, false, nil)
	var ops []string
	for _, o := range cmp["ops"].([]any) {
		ops = append(ops, o.(map[string]any)["op"].(string))
	}
	if strings.Join(ops, ",") != "same,del,ins,same,ins" {
		t.Fatalf("ops: %v", ops)
	}

	// Rewind: keepers only, makes v3 equal to v1
	h.want(403, "POST", "/chapters/"+id+"/rewind", h.member, false, map[string]any{"to_version": 1})
	v3 := h.want(200, "POST", "/chapters/"+id+"/rewind", h.keeper, false, map[string]any{"to_version": 1})
	if v3["version"].(float64) != 3 || v3["source"] != "rewind" || len(v3["blocks"].([]any)) != 3 {
		t.Fatalf("rewind: %v", v3)
	}
	var blocksV1, blocksV3 []string
	h.s.db.QueryRow(context.Background(), `SELECT blocks FROM chapter_revisions WHERE chapter_id = $1 AND version = 1`, id).Scan(&blocksV1)
	h.s.db.QueryRow(context.Background(), `SELECT blocks FROM chapter_revisions WHERE chapter_id = $1 AND version = 3`, id).Scan(&blocksV3)
	if strings.Join(blocksV1, ",") != strings.Join(blocksV3, ",") {
		t.Fatal("rewind must reuse the same block hashes")
	}

	// Delete (v4), the number becomes free; restore by rewinding (v5) fails while another chapter took the number
	h.want(200, "POST", "/internal/chapters/"+id+"/delete", "", true, map[string]any{})
	h.want(409, "POST", "/internal/chapters/"+id+"/revisions", "", true, map[string]any{"meta": meta, "blocks": para("x")})
	other := h.want(201, "POST", "/internal/chapters", "", true, map[string]any{"story_id": h.story, "meta": meta, "blocks": para("khác")})
	h.want(409, "POST", "/chapters/"+id+"/rewind", h.keeper, false, map[string]any{"to_version": 3})
	h.want(200, "POST", "/internal/chapters/"+other["chapter_id"].(string)+"/delete", "", true, map[string]any{})
	restored := h.want(200, "POST", "/chapters/"+id+"/rewind", h.keeper, false, map[string]any{"to_version": 3})
	if restored["source"] != "restore" || restored["deleted"] != false {
		t.Fatalf("restore: %v", restored)
	}

	// A story taken down: no merges
	h.removed = true
	h.s.perms = &permCache{m: map[string]permEntry{}}
	h.want(409, "POST", "/chapters/"+id+"/rewind", h.keeper, false, map[string]any{"to_version": 1})

	// Every event matches its schema
	comp := jsonschema.NewCompiler()
	comp.AssertFormat()
	sch, err := comp.Compile("../../events/workspace.revision.merged.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := h.s.db.Query(context.Background(), `SELECT payload::text FROM outbox ORDER BY id`)
	n := 0
	for rows.Next() {
		var body string
		rows.Scan(&body)
		var doc any
		json.Unmarshal([]byte(body), &doc)
		if err := sch.Validate(doc); err != nil {
			t.Errorf("event does not match schema: %v\n%s", err, body)
		}
		n++
	}
	if n != 7 { // first chapter: create, edit, rewind, delete, restore; second: create, delete
		t.Fatalf("events: %d, want 7", n)
	}
}

func TestDraftLifecycle(t *testing.T) {
	h := newWS(t)
	meta := map[string]any{"title": "Mở đầu", "chapter_number": 1}
	id := h.want(201, "POST", "/internal/chapters", "", true, map[string]any{"story_id": h.story, "meta": meta, "blocks": para("A", "B", "C", "D")})["chapter_id"].(string)

	// The member opens a draft of chapter 1 (a copy of v1); opening it again gives the same draft
	d := h.want(201, "POST", "/internal/drafts", "", true, map[string]any{"owner_id": h.member, "story_id": h.story, "chapter_id": id})
	did := d["id"].(string)
	if d["base_version"].(float64) != 1 || len(d["blocks"].([]any)) != 4 {
		t.Fatalf("draft from v1: %v", d)
	}
	if again := h.want(200, "POST", "/internal/drafts", "", true, map[string]any{"owner_id": h.member, "story_id": h.story, "chapter_id": id}); again["id"] != did {
		t.Fatal("a second Edit must reopen the same draft")
	}
	// Only the owner reads it; saves need the current draft version
	h.want(403, "GET", "/drafts/"+did, h.keeper, false, nil)
	h.want(200, "GET", "/drafts/"+did, h.member, false, nil)
	saved := h.want(200, "PUT", "/internal/drafts/"+did, "", true, map[string]any{"owner_id": h.member, "meta": meta, "blocks": para("A", "B của tôi", "C", "D"), "expected_version": 1})
	h.want(409, "PUT", "/internal/drafts/"+did, "", true, map[string]any{"owner_id": h.member, "meta": meta, "blocks": para("tab cũ"), "expected_version": 1})
	h.want(403, "PUT", "/internal/drafts/"+did, "", true, map[string]any{"owner_id": h.keeper, "meta": meta, "blocks": para("x"), "expected_version": 2})

	// Meanwhile the official line moves (v2 changes D and the title): publishing the draft is refused until it pulls
	h.want(200, "POST", "/internal/chapters/"+id+"/revisions", "", true,
		map[string]any{"meta": map[string]any{"title": "Khởi đầu", "chapter_number": 1}, "blocks": para("A", "B", "C", "D mới"), "expected_version": 1})
	h.want(409, "POST", "/internal/drafts/"+did+"/publish", "", true, map[string]any{"owner_id": h.member})
	list := h.want(200, "GET", "/drafts", h.member, false, nil)["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["current_version"].(float64) != 2 {
		t.Fatalf("list shows the draft is behind: %v", list)
	}

	// Pull: no conflict (different paragraphs, title only changed upstream)
	pv := h.want(200, "GET", "/drafts/"+did+"/pull", h.member, false, nil)
	plan := pv["plan"].(map[string]any)
	if plan["to"].(float64) != 2 || len(plan["meta_conflicts"].([]any)) != 0 || len(plan["chunks"].([]any)) != 1 {
		t.Fatalf("clean pull plan: %v", plan)
	}
	pulled := h.want(200, "POST", "/drafts/"+did+"/pull", h.member, false, map[string]any{"expected_version": saved["version"], "to_version": 2})
	texts := []string{}
	for _, b := range pulled["blocks"].([]any) {
		texts = append(texts, b.(map[string]any)["text"].(string))
	}
	if strings.Join(texts, "|") != "A|B của tôi|C|D mới" || pulled["meta"].(map[string]any)["title"] != "Khởi đầu" || pulled["base_version"].(float64) != 2 {
		t.Fatalf("pulled: %v %v", texts, pulled["meta"])
	}
	pub := h.want(200, "POST", "/internal/drafts/"+did+"/publish", "", true, map[string]any{"owner_id": h.member})
	if pub["version"].(float64) != 3 || pub["source"] != "edit" {
		t.Fatalf("publish: %v", pub)
	}
	h.want(409, "PUT", "/internal/drafts/"+did, "", true, map[string]any{"owner_id": h.member, "meta": meta, "blocks": para("x"), "expected_version": 3})

	// Conflict: the keeper's draft and an official edit both change paragraph C
	k := h.want(201, "POST", "/internal/drafts", "", true, map[string]any{"owner_id": h.keeper, "story_id": h.story, "chapter_id": id})
	kid := k["id"].(string)
	h.want(200, "PUT", "/internal/drafts/"+kid, "", true, map[string]any{"owner_id": h.keeper, "meta": map[string]any{"title": "Khởi đầu", "chapter_number": 1},
		"blocks": para("A", "B của tôi", "C (keeper)", "D mới"), "expected_version": 1})
	h.want(200, "POST", "/internal/chapters/"+id+"/revisions", "", true,
		map[string]any{"meta": map[string]any{"title": "Khởi đầu", "chapter_number": 1}, "blocks": para("A", "B của tôi", "C (khác)", "D mới"), "expected_version": 3})
	plan = h.want(200, "GET", "/drafts/"+kid+"/pull", h.keeper, false, nil)["plan"].(map[string]any)
	if len(plan["chunks"].([]any)) != 3 {
		t.Fatalf("conflict plan: %v", plan["chunks"])
	}
	h.want(400, "POST", "/drafts/"+kid+"/pull", h.keeper, false, map[string]any{"expected_version": 2, "to_version": 4})
	both := h.want(200, "POST", "/drafts/"+kid+"/pull", h.keeper, false, map[string]any{"expected_version": 2, "to_version": 4, "choices": map[string]string{"b0": "both"}})
	if len(both["blocks"].([]any)) != 5 {
		t.Fatalf("both sides kept: %v", both["blocks"])
	}
	h.want(200, "DELETE", "/drafts/"+kid, h.keeper, false, nil)
	h.want(409, "POST", "/internal/drafts/"+kid+"/publish", "", true, map[string]any{"owner_id": h.keeper})

	// New chapter drafts: publishing makes v1; a number already taken is refused
	nd := h.want(201, "POST", "/internal/drafts", "", true, map[string]any{"owner_id": h.member, "story_id": h.story, "meta": map[string]any{"title": "", "chapter_number": 1}, "blocks": para("X")})
	h.want(400, "POST", "/internal/drafts/"+nd["id"].(string)+"/publish", "", true, map[string]any{"owner_id": h.member})
	h.want(400, "GET", "/drafts/"+nd["id"].(string)+"/pull", h.member, false, nil) // nothing official to pull from
	h.want(200, "PUT", "/internal/drafts/"+nd["id"].(string), "", true, map[string]any{"owner_id": h.member, "meta": map[string]any{"title": "Chương 2", "chapter_number": 1}, "blocks": para("X"), "expected_version": 1})
	h.want(409, "POST", "/internal/drafts/"+nd["id"].(string)+"/publish", "", true, map[string]any{"owner_id": h.member})
	h.want(200, "PUT", "/internal/drafts/"+nd["id"].(string), "", true, map[string]any{"owner_id": h.member, "meta": map[string]any{"title": "Chương 2", "chapter_number": 2}, "blocks": para("X"), "expected_version": 2})
	created := h.want(200, "POST", "/internal/drafts/"+nd["id"].(string)+"/publish", "", true, map[string]any{"owner_id": h.member})
	if created["version"].(float64) != 1 || created["source"] != "create" {
		t.Fatalf("new chapter: %v", created)
	}
	h.want(409, "GET", "/drafts/"+nd["id"].(string)+"/pull", h.member, false, nil) // published: closed
	h.want(401, "GET", "/drafts", "", false, nil)
}
