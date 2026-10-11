package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type server struct {
	cfg  config
	db   *pgxpool.Pool
	rdb  *redis.Client // nil in tests: nothing is pushed
	be   *backendClient
	hub  *hub
	now  func() time.Time
	rate *rateLimiter
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, 200, map[string]any{"success": true, "data": data})
}

func okMsg(w http.ResponseWriter, msg string, data any) {
	writeJSON(w, 200, map[string]any{"success": true, "message": msg, "data": data})
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
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
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

// authed: signed-in callers only (the gateway's X-User-* signed for messaging).
func (s *server) authed(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := userFrom(s.cfg.SigKey, r, s.now())
		if me == "" {
			fail(w, 401, "Bạn chưa đăng nhập.")
			return
		}
		h(w, r, me)
	}
}

// internal: the backend's service-to-service calls (X-Internal-Auth signed with INTERNAL_KEY_MESSAGING).
func (s *server) internal(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK(s.cfg.InternalKey, r.Header.Get("X-Internal-Auth"), s.now()) {
			fail(w, 401, "unauthorized")
			return
		}
		h(w, r)
	}
}

// publish sends a realtime ping through Redis, so every messaging copy delivers it (same channel the backend uses).
func (s *server) publish(ctx context.Context, users []string, typ string, data map[string]any) {
	if s.rdb == nil || len(users) == 0 {
		return
	}
	b, _ := json.Marshal(map[string]any{"users": users, "type": typ, "data": data})
	if err := s.rdb.Publish(ctx, rtChannel, b).Err(); err != nil {
		logf(ctx, "warn", "realtime publish failed: "+err.Error())
	}
}

// rateLimiter: at most `limit` actions a minute per user (sending messages). In memory, per process.
// shortcut: per-copy counters; share them through Redis when several messaging copies run.
type rateLimiter struct {
	mu    sync.Mutex
	limit int
	hits  map[string][]time.Time
}

func (l *rateLimiter) allow(user string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.hits[user][:0]
	for _, t := range l.hits[user] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.limit {
		l.hits[user] = recent
		return false
	}
	l.hits[user] = append(recent, now)
	if len(l.hits) > 50000 { // forget idle users now and then
		for u, ts := range l.hits {
			if len(ts) == 0 || now.Sub(ts[len(ts)-1]) > time.Minute {
				delete(l.hits, u)
			}
		}
	}
	return true
}

// inputError: a message for the caller (400 unless status is set).
type inputError struct {
	status int
	msg    string
}

func (e *inputError) Error() string { return e.msg }

func bad(msg string) error { return &inputError{400, msg} }

// answer writes err: an inputError as is, anything else as 500.
func answer(w http.ResponseWriter, r *http.Request, err error) {
	var ie *inputError
	if errors.As(err, &ie) {
		fail(w, ie.status, ie.msg)
		return
	}
	internalError(w, r, err)
}

// Paths are what the gateway forwards after stripping /api/msg.
func (s *server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"success": true}) })
	m.HandleFunc("GET /ready", s.handleReady)
	m.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		user := userFrom(s.cfg.SigKey, r, s.now())
		if user == "" {
			writeJSON(w, 401, map[string]any{"success": false, "message": "Bạn chưa đăng nhập."})
			return
		}
		s.hub.serve(w, r, user, r.URL.Query().Get("tab"))
	})

	// Direct messages (same paths and JSON as the backend's former /api/v1/messages)
	m.HandleFunc("GET /messages", s.authed(s.handleInbox))
	m.HandleFunc("GET /messages/labels", s.authed(s.handleLabels))
	m.HandleFunc("POST /messages/labels", s.authed(s.handleCreateLabel))
	m.HandleFunc("PATCH /messages/labels/{id}", s.authed(s.handleUpdateLabel))
	m.HandleFunc("GET /messages/{username}", s.authed(s.handleThread))
	m.HandleFunc("POST /messages/{username}", s.authed(s.handleSend))
	m.HandleFunc("PUT /messages/{username}/labels", s.authed(s.handleSetLabels))
	m.HandleFunc("POST /messages/{username}/block", s.authed(s.handleBlock(true)))
	// One pattern for both: ServeMux can't rank "labels/{id}" against "{username}/block" ("labels" was never a username:
	// the backend's route order made it a label too)
	m.HandleFunc("DELETE /messages/{username}/{what}", s.authed(func(w http.ResponseWriter, r *http.Request, me string) {
		switch {
		case r.PathValue("username") == "labels":
			r.SetPathValue("id", r.PathValue("what"))
			s.handleDeleteLabel(w, r, me)
		case r.PathValue("what") == "block":
			s.handleBlock(false)(w, r, me)
		default:
			fail(w, 404, "Không tìm thấy.")
		}
	}))
	m.HandleFunc("POST /messages/{username}/pins/{messageId}", s.authed(s.handlePin(true)))
	m.HandleFunc("DELETE /messages/{username}/pins/{messageId}", s.authed(s.handlePin(false)))

	// Translation group chat (members only)
	m.HandleFunc("GET /groups/{id}/messages", s.authed(s.handleGroupMessages))
	m.HandleFunc("POST /groups/{id}/messages", s.authed(s.handleGroupSend))
	m.HandleFunc("DELETE /groups/{id}/messages/{messageId}", s.authed(s.handleGroupDelete))

	m.HandleFunc("POST /internal/dm", s.internal(s.handleInternalDM))
	m.HandleFunc("GET /internal/blocked", s.internal(func(w http.ResponseWriter, r *http.Request) {
		a, b := r.URL.Query().Get("a"), r.URL.Query().Get("b")
		if !isUUID(a) || !isUUID(b) {
			fail(w, 400, "a, b")
			return
		}
		byA, byB, err := s.blockState(r.Context(), a, b)
		if err != nil {
			internalError(w, r, err)
			return
		}
		ok(w, map[string]any{"blocked": byA || byB}) // either way: they can't message each other
	}))
	return m
}

func (s *server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	checks := map[string]any{"database": "ok", "redis": "ok", "connections": s.hub.count()}
	status := 200
	if err := s.db.Ping(ctx); err != nil {
		checks["database"], status = "down", 503
	}
	if s.rdb == nil || s.rdb.Ping(ctx).Err() != nil {
		checks["redis"], status = "down", 503
	}
	writeJSON(w, status, map[string]any{"success": status == 200, "data": checks})
}
