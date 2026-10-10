package main

// End-to-end tests against a real Postgres (+ Redis when given). They wipe the database they get, so point them
// at a throwaway one:
//   IDENTITY_TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/identity_test [IDENTITY_TEST_REDIS_URL=redis://:...@127.0.0.1:6380/15] go test ./...

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/crypto/bcrypt"
)

const testPW = "Doc-Truyen-Moi-Ngay"

type harness struct {
	t   *testing.T
	s   *server
	srv *httptest.Server
}

func newHarness(t *testing.T) *harness {
	dbURL := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("IDENTITY_TEST_DATABASE_URL not set")
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
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !verifyUserHeaders([]byte(strings.Repeat("k", 32)), r.Header.Get("X-User-Id"), r.Header.Get("X-User-Roles"),
			r.Header.Get("X-User-Exp"), r.Header.Get("X-User-Sig"), time.Now()) {
			w.WriteHeader(401)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(backend.Close)
	s := &server{db: db, now: time.Now, cfg: config{
		JWTSecret: []byte(strings.Repeat("j", 32)), HeaderKey: []byte(strings.Repeat("k", 32)),
		SiteURL: "http://site", BackendURL: backend.URL,
	}}
	if rURL := os.Getenv("IDENTITY_TEST_REDIS_URL"); rURL != "" {
		opt, err := redis.ParseURL(rURL)
		if err != nil {
			t.Fatal(err)
		}
		s.rdb = redis.NewClient(opt)
		s.rdb.FlushDB(ctx)
		t.Cleanup(func() { s.rdb.Close() })
	}
	// Mounted like the gateway does it, so the refresh cookie's path matches
	mux := http.NewServeMux()
	mux.Handle("/api/identity/", http.StripPrefix("/api/identity", s.routes()))
	srv := httptest.NewServer(withRequestLog(mux))
	t.Cleanup(srv.Close)
	return &harness{t: t, s: s, srv: srv}
}

type client struct {
	h   *harness
	hc  *http.Client
	jar *cookiejar.Jar
}

func (h *harness) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{h: h, jar: jar, hc: &http.Client{Jar: jar}}
}

func (c *client) cookie(name string) string {
	u, _ := url.Parse(c.h.srv.URL + "/api/identity/refresh")
	for _, ck := range c.jar.Cookies(u) {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

// do sends JSON; csrf=true echoes the nh_csrf cookie like the site's JS does.
func (c *client) do(method, path string, body any, csrf bool) (int, map[string]any, http.Header) {
	c.h.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req, _ := http.NewRequest(method, c.h.srv.URL+"/api/identity"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if csrf {
		req.Header.Set("X-CSRF-Token", c.cookie(cookieCSRF))
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.h.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out, res.Header
}

func (c *client) want(status int, method, path string, body any, csrf bool) map[string]any {
	c.h.t.Helper()
	got, out, _ := c.do(method, path, body, csrf)
	if got != status {
		c.h.t.Fatalf("%s %s: status %d, want %d (%v)", method, path, got, status, out["message"])
	}
	return out
}

func (h *harness) register(name string) *client {
	c := h.client()
	c.want(201, "POST", "/register", map[string]any{"username": name, "email": name + "@mail.vn", "password": testPW}, false)
	return c
}

func (h *harness) userID(name string) string {
	var id string
	if err := h.s.db.QueryRow(context.Background(), `SELECT id::text FROM users WHERE username = $1`, name).Scan(&id); err != nil {
		h.t.Fatal(err)
	}
	return id
}

func TestRegisterLoginMe(t *testing.T) {
	h := newHarness(t)
	c := h.register("yuki")
	me := c.want(200, "GET", "/me", nil, false)["data"].(map[string]any)
	if me["email"] != "yuki@mail.vn" || me["username"] != "yuki" {
		t.Fatalf("me: %v", me)
	}
	h.client().want(400, "POST", "/register", map[string]any{"username": "YUKI", "email": "x@mail.vn", "password": "Sach-Hay-xyz1"}, false)
	h.client().want(400, "POST", "/register", map[string]any{"username": "weak", "email": "w@mail.vn", "password": "password123"}, false)

	var events int
	h.s.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM outbox WHERE routing_key = 'identity.user.created' AND payload->'data'->>'username' = 'yuki'
		AND NOT (payload->'data' ? 'email')`).Scan(&events)
	if events != 1 {
		t.Fatalf("user.created events without email: %d", events)
	}
	var mails int
	h.s.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM mail_outbox WHERE to_addr = 'yuki@mail.vn' AND body_text LIKE '%/xac-thuc-email?token=%'`).Scan(&mails)
	if mails != 1 {
		t.Fatal("verification mail not queued")
	}

	other := h.client()
	other.want(200, "POST", "/login", map[string]any{"identifier": "YUKI@mail.vn", "password": testPW}, false)
	other.want(200, "GET", "/me", nil, false)
}

func TestCSRFRequiredForWrites(t *testing.T) {
	h := newHarness(t)
	c := h.register("hana")
	c.want(403, "POST", "/change-password", map[string]any{"current_password": testPW, "new_password": "Truyen-Moi-2026"}, false)
	c.want(200, "POST", "/change-password", map[string]any{"current_password": testPW, "new_password": "Truyen-Moi-2026"}, true)
}

func TestRefreshRotationAndReuse(t *testing.T) {
	h := newHarness(t)
	c := h.register("ryu")
	first := c.cookie(cookieRefresh)
	c.want(200, "POST", "/refresh", nil, false)
	second := c.cookie(cookieRefresh)
	if second == "" || second == first {
		t.Fatal("refresh token not rotated")
	}

	// Another tab with the old token a moment later: tolerated, no new refresh token handed out
	tab := h.client()
	u, _ := url.Parse(h.srv.URL + "/api/identity/")
	tab.jar.SetCookies(u, []*http.Cookie{{Name: cookieRefresh, Value: first, Path: "/api/identity"}})
	tab.want(200, "POST", "/refresh", nil, false)

	// The same old token much later = it was copied: the whole session dies
	h.s.now = func() time.Time { return time.Now().Add(time.Minute) }
	thief := h.client()
	thief.jar.SetCookies(u, []*http.Cookie{{Name: cookieRefresh, Value: first, Path: "/api/identity"}})
	thief.want(401, "POST", "/refresh", nil, false)
	h.s.now = time.Now
	c.want(401, "POST", "/refresh", nil, false) // the legitimate current token is dead too
	c.want(401, "GET", "/me", nil, false)       // and so is the access token (revocation is immediate)
}

func TestLockoutAfterFailedLogins(t *testing.T) {
	h := newHarness(t)
	h.register("sakura")
	c := h.client()
	for i := 0; i < lockAfter; i++ {
		c.want(400, "POST", "/login", map[string]any{"identifier": "sakura", "password": "wrong-" + fmt.Sprint(i)}, false)
	}
	c.want(429, "POST", "/login", map[string]any{"identifier": "sakura", "password": testPW}, false)
	h.client().want(400, "POST", "/login", map[string]any{"identifier": "nobody", "password": "x"}, false)
}

func TestVerifyEndpoint(t *testing.T) {
	h := newHarness(t)
	c := h.register("kai")
	get := func(method string, csrf bool) (int, http.Header) {
		req, _ := http.NewRequest("GET", h.srv.URL+"/api/identity/internal/verify", nil)
		req.Header.Set("X-Original-Method", method)
		if csrf {
			req.Header.Set("X-CSRF-Token", c.cookie(cookieCSRF))
		}
		res, err := c.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode, res.Header
	}
	st, hd := get("GET", false)
	if st != 200 || hd.Get("X-User-Id") != h.userID("kai") || hd.Get("X-User-Roles") != "reader" ||
		!verifyUserHeaders(h.s.cfg.HeaderKey, hd.Get("X-User-Id"), hd.Get("X-User-Roles"), hd.Get("X-User-Exp"), hd.Get("X-User-Sig"), time.Now()) {
		t.Fatalf("signed-in GET: %d %v", st, hd)
	}
	if st, _ := get("POST", false); st != 403 {
		t.Fatalf("write without CSRF: %d", st)
	}
	if st, hd := get("POST", true); st != 200 || hd.Get("X-User-Id") == "" {
		t.Fatalf("write with CSRF: %d", st)
	}
	req, _ := http.NewRequest("GET", h.srv.URL+"/api/identity/internal/verify", nil)
	req.Header.Set("Cookie", cookieAccess+"=not-a-jwt; X-User-Id=x")
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 200 || res.Header.Get("X-User-Id") != "" {
		t.Fatalf("guest: %d %v", res.StatusCode, res.Header)
	}
}

func TestLogoutAllAndBan(t *testing.T) {
	h := newHarness(t)
	victim := h.register("minh")
	laptop := h.client()
	laptop.want(200, "POST", "/login", map[string]any{"identifier": "minh", "password": testPW}, false)
	sessions := victim.want(200, "GET", "/sessions", nil, false)["data"].([]any)
	if len(sessions) != 2 {
		t.Fatalf("sessions: %d", len(sessions))
	}
	victim.want(200, "POST", "/logout-all", nil, true)
	laptop.want(401, "GET", "/me", nil, false)

	admin := h.register("boss")
	h.s.db.Exec(context.Background(), `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, h.userID("boss"))
	h.s.forgetRoles(context.Background(), h.userID("boss"))
	again := h.client()
	again.want(200, "POST", "/login", map[string]any{"identifier": "minh", "password": testPW}, false)
	minh := h.userID("minh")
	admin.want(403, "POST", "/users/"+minh+"/ban", map[string]any{"reason": "spam", "password": "wrong"}, true)
	admin.want(200, "POST", "/users/"+minh+"/ban", map[string]any{"reason": "spam", "password": testPW}, true)
	again.want(401, "GET", "/me", nil, false)
	h.client().want(403, "POST", "/login", map[string]any{"identifier": "minh", "password": testPW}, false)
	admin.want(409, "POST", "/users/"+minh+"/ban", map[string]any{"password": testPW}, true)

	// a mod may not touch an admin, nor delete with a wrong password
	mod := h.register("modo")
	h.s.db.Exec(context.Background(), `INSERT INTO user_roles (user_id, role) VALUES ($1, 'mod')`, h.userID("modo"))
	h.s.forgetRoles(context.Background(), h.userID("modo"))
	mod.want(403, "POST", "/users/"+h.userID("boss")+"/ban", map[string]any{"password": testPW}, true)
	admin.want(200, "DELETE", "/users/"+minh, map[string]any{"password": testPW, "purge_content": true}, true)
	var deleted int
	h.s.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM outbox WHERE routing_key = 'identity.user.deleted' AND (payload->'data'->>'purge_content')::bool`).Scan(&deleted)
	if deleted != 1 {
		t.Fatal("user.deleted event with purge_content missing")
	}
}

func TestLegacyBcryptUpgradedOnLogin(t *testing.T) {
	h := newHarness(t)
	hash, _ := bcrypt.GenerateFromPassword([]byte("password123"), 10)
	id := newUUID()
	h.s.db.Exec(context.Background(), `INSERT INTO users (id, username, email, password_hash) VALUES ($1, 'old_user', 'old@mail.vn', $2)`, id, string(hash))
	h.client().want(200, "POST", "/login", map[string]any{"identifier": "old_user", "password": "password123"}, false)
	var now string
	h.s.db.QueryRow(context.Background(), `SELECT password_hash FROM users WHERE id = $1`, id).Scan(&now)
	if !strings.HasPrefix(now, "$argon2id$") {
		t.Fatal("bcrypt hash not upgraded")
	}
}

func TestSeedDemoOnlyIntoEmptyDB(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	if err := seedDemo(ctx, h.s.db); err != nil {
		t.Fatal(err)
	}
	h.client().want(200, "POST", "/login", map[string]any{"identifier": "admin", "password": "password123"}, false)
	h.s.db.Exec(ctx, `DELETE FROM users WHERE username = 'reader_sora'`)
	if err := seedDemo(ctx, h.s.db); err != nil {
		t.Fatal(err)
	}
	var n int
	h.s.db.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	if n != len(demoAccounts)-1 {
		t.Fatalf("seed-demo re-added accounts into a non-empty database: %d", n)
	}
	// Stats for the backend's reconcile job: 11 users, each at version 2 (insert + created event)
	rec := httptest.NewRecorder()
	h.s.handleStats(rec, httptest.NewRequest("GET", "/internal/stats", nil))
	var stats struct{ Data map[string]float64 }
	json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats.Data["users"] != 11 || stats.Data["version_sum"] != 22 || stats.Data["outbox_pending"] != 12 {
		t.Fatalf("stats: %s", rec.Body.String())
	}
}

func TestForgotAndReset(t *testing.T) {
	h := newHarness(t)
	old := h.register("lan")
	h.client().want(200, "POST", "/forgot-password", map[string]any{"email": "nobody@mail.vn"}, false)
	h.client().want(200, "POST", "/forgot-password", map[string]any{"email": "LAN@mail.vn"}, false)
	var body string
	h.s.db.QueryRow(context.Background(), `SELECT body_text FROM mail_outbox WHERE subject LIKE 'Đặt lại%' ORDER BY id DESC LIMIT 1`).Scan(&body)
	token := regexp.MustCompile(`token=([0-9a-f]{64})`).FindStringSubmatch(body)
	if token == nil {
		t.Fatalf("no reset link in %q", body)
	}
	h.client().want(400, "POST", "/reset-password", map[string]any{"token": token[1], "new_password": "12345678"}, false)
	h.client().want(200, "POST", "/reset-password", map[string]any{"token": token[1], "new_password": "Mat-Khau-Moi-2026"}, false)
	h.client().want(400, "POST", "/reset-password", map[string]any{"token": token[1], "new_password": "Mat-Khau-Khac-2026"}, false)
	old.want(401, "GET", "/me", nil, false)
	h.client().want(200, "POST", "/login", map[string]any{"identifier": "lan", "password": "Mat-Khau-Moi-2026"}, false)
}

// Every event identity writes must match its schema in events/ (the contract consumers rely on).
func TestEventContracts(t *testing.T) {
	h := newHarness(t)
	admin := h.register("chief")
	h.s.db.Exec(context.Background(), `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, h.userID("chief"))
	h.s.forgetRoles(context.Background(), h.userID("chief"))
	h.register("member")
	id := h.userID("member")
	admin.want(200, "POST", "/users/"+id+"/roles", map[string]any{"role": "translator", "action": "grant", "password": testPW}, true)
	admin.want(200, "POST", "/users/"+id+"/ban", map[string]any{"reason": "spam", "password": testPW}, true)
	admin.want(200, "DELETE", "/users/"+id, map[string]any{"password": testPW}, true)
	if err := h.s.alert(context.Background(), "test", "Tiêu đề", "Nội dung"); err != nil {
		t.Fatal(err)
	}
	if err := republish(context.Background(), h.s.db, ""); err != nil { // re-sent snapshots, the deleted user's included
		t.Fatal(err)
	}

	comp := jsonschema.NewCompiler()
	comp.AssertFormat()
	schemas := map[string]*jsonschema.Schema{}
	for prefix, file := range map[string]string{"identity.user.": "identity.user.v1.json", "identity.alert": "identity.alert.v1.json"} {
		sch, err := comp.Compile("../../events/" + file)
		if err != nil {
			t.Fatal(err)
		}
		schemas[prefix] = sch
	}
	rows, _ := h.s.db.Query(context.Background(), `SELECT routing_key, payload::text FROM outbox ORDER BY id`)
	n := 0
	for rows.Next() {
		var key, body string
		rows.Scan(&key, &body)
		var doc any
		if err := json.Unmarshal([]byte(body), &doc); err != nil {
			t.Fatal(err)
		}
		matched := false
		for prefix, sch := range schemas {
			if strings.HasPrefix(key, prefix) {
				matched = true
				if err := sch.Validate(doc); err != nil {
					t.Errorf("%s does not match its schema: %v\n%s", key, err, body)
				}
			}
		}
		if !matched {
			t.Errorf("no schema for event type %s", key)
		}
		n++
	}
	if n < 6 {
		t.Fatalf("expected at least 6 events, got %d", n)
	}
}
