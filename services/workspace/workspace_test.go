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
