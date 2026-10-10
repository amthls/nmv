package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	Port        string
	DatabaseURL string
	RabbitURL   string
	HeaderKey   []byte // AUTH_HEADER_KEY: verifies the gateway's X-User-* headers and signs/verifies X-Internal-Auth
	BackendURL  string
}

func loadConfig() (config, error) {
	c := config{
		Port:        env("PORT", "8080"),
		DatabaseURL: os.Getenv("WORKSPACE_DATABASE_URL"),
		RabbitURL:   os.Getenv("RABBITMQ_URL"),
		HeaderKey:   []byte(os.Getenv("AUTH_HEADER_KEY")),
		BackendURL:  strings.TrimRight(env("BACKEND_INTERNAL_URL", "http://backend:5000"), "/"),
	}
	if c.DatabaseURL == "" || len(c.HeaderKey) < 32 {
		return c, errors.New("WORKSPACE_DATABASE_URL and AUTH_HEADER_KEY (>= 32 chars) are required")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type server struct {
	cfg   config
	db    *pgxpool.Pool
	now   func() time.Time
	perms *permCache
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, 200, map[string]any{"success": true, "data": data})
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"success": false, "message": msg})
}

func internalError(w http.ResponseWriter, r *http.Request, err error) {
	logError(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(requestIDKey).(string)
	fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20) // a chapter is at most ~100 KB of blocks today
	return json.NewDecoder(r.Body).Decode(dst)
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

// ---- who is calling ---------------------------------------------------------------------------------------

// userFrom: the gateway's signed identity headers (same check as the backend's auth.middleware). "" = guest.
func (s *server) userFrom(r *http.Request) string {
	id, roles, exp, sig := r.Header.Get("X-User-Id"), r.Header.Get("X-User-Roles"), r.Header.Get("X-User-Exp"), r.Header.Get("X-User-Sig")
	n, err := strconv.ParseInt(exp, 10, 64)
	if id == "" || err != nil || s.now().Unix() > n {
		return ""
	}
	m := hmac.New(sha256.New, s.cfg.HeaderKey)
	m.Write([]byte(id + "|" + roles + "|" + exp))
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(sig))) {
		return ""
	}
	return id
}

func internalAuth(key []byte, now time.Time) string {
	exp := strconv.FormatInt(now.Add(2*time.Minute).Unix(), 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return exp + "." + hex.EncodeToString(m.Sum(nil))
}

func internalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}

// internal guards the backend-only endpoints (the gateway also answers 404 for /internal from outside).
func (s *server) internal(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK(s.cfg.HeaderKey, r.Header.Get("X-Internal-Auth"), s.now()) {
			fail(w, 401, "unauthorized")
			return
		}
		h(w, r)
	}
}

// ---- permissions (the backend owns stories and groups) -----------------------------------------------------

type perm struct {
	Keeper      bool   `json:"keeper"`      // story owner, or leader/mod of its group: rewinds, merges
	Contributor bool   `json:"contributor"` // keeper, group member or collaborator: reads history
	Removed     bool   `json:"removed"`     // story taken down by Admin/Mod: nothing is merged until restored
	Name        string `json:"name"`        // caller's display name, kept on the revisions they make
}

type permCache struct {
	mu sync.Mutex
	m  map[string]permEntry
}

type permEntry struct {
	p   perm
	exp time.Time
}

// permission asks the backend (cached 30 s per user+story when the user takes part).
func (s *server) permission(ctx context.Context, user, story string) (perm, error) {
	key := user + "|" + story
	s.perms.mu.Lock()
	if e, found := s.perms.m[key]; found && s.now().Before(e.exp) {
		s.perms.mu.Unlock()
		return e.p, nil
	}
	s.perms.mu.Unlock()

	req, _ := http.NewRequestWithContext(ctx, "GET", s.cfg.BackendURL+"/internal/permissions?user="+url.QueryEscape(user)+"&story="+url.QueryEscape(story), nil)
	req.Header.Set("X-Internal-Auth", internalAuth(s.cfg.HeaderKey, s.now()))
	if rid, _ := ctx.Value(requestIDKey).(string); rid != "" {
		req.Header.Set("X-Request-Id", rid)
	}
	res, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return perm{}, err
	}
	defer res.Body.Close()
	var body struct {
		Data perm `json:"data"`
	}
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&body) != nil {
		return perm{}, fmt.Errorf("backend permissions: %s", res.Status)
	}
	// Only "takes part" is cached: someone just added to a story or group gets in at once, while a removal
	// can lag up to 30 s.
	if body.Data.Contributor {
		s.perms.mu.Lock()
		if len(s.perms.m) > 10000 {
			s.perms.m = map[string]permEntry{}
		}
		s.perms.m[key] = permEntry{body.Data, s.now().Add(30 * time.Second)}
		s.perms.mu.Unlock()
	}
	return body.Data, nil
}

func hmacHex(key, msg string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}
