// Package httpx holds what every handler shares: JSON answers, input errors, signed-identity and internal-call checks,
// the per-user rate limit.
package httpx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"nmv/messaging/internal/platform/logger"
)

// WriteJSON writes v as JSON with the given status (never cached).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// OK writes {success: true, data}.
func OK(w http.ResponseWriter, data any) {
	WriteJSON(w, 200, map[string]any{"success": true, "data": data})
}

// OKMsg writes {success: true, message, data}.
func OKMsg(w http.ResponseWriter, msg string, data any) {
	WriteJSON(w, 200, map[string]any{"success": true, "message": msg, "data": data})
}

// Fail writes {success: false, message}.
func Fail(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"success": false, "message": msg})
}

// InternalError logs the real error and shows the user only the request id to quote.
func InternalError(w http.ResponseWriter, r *http.Request, err error) {
	logger.Error(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(logger.RequestIDKey).(string)
	Fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

// ReadJSON decodes a body of at most 64 KiB into dst.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	return json.NewDecoder(r.Body).Decode(dst)
}

// IsUUID reports whether s is a canonical 36-character uuid.
func IsUUID(s string) bool {
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

// InputError is a message for the caller (400 unless the status is set).
type InputError struct {
	Status int
	Msg    string
}

func (e *InputError) Error() string { return e.Msg }

// Bad is a 400 input error.
func Bad(msg string) error { return &InputError{400, msg} }

// NotFound is a 404 input error.
func NotFound(msg string) error { return &InputError{404, msg} }

// Answer writes err: an InputError as is, anything else as 500.
func Answer(w http.ResponseWriter, r *http.Request, err error) {
	var ie *InputError
	if errors.As(err, &ie) {
		Fail(w, ie.Status, ie.Msg)
		return
	}
	InternalError(w, r, err)
}

// Text trims s and checks it is 1..max characters.
func Text(s string, max int, what string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", Bad(what + " không được để trống.")
	}
	if utf8.RuneCountInString(s) > max {
		return "", Bad(what + " quá dài.")
	}
	return s, nil
}

// UserFrom: the gateway's signed identity headers (same check as the backend's auth.middleware). "" = guest.
func UserFrom(key []byte, r *http.Request, now time.Time) string {
	id, roles, exp, sig := r.Header.Get("X-User-Id"), r.Header.Get("X-User-Roles"), r.Header.Get("X-User-Exp"), r.Header.Get("X-User-Sig")
	n, err := strconv.ParseInt(exp, 10, 64)
	if id == "" || err != nil || now.Unix() > n {
		return ""
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte(id + "|" + roles + "|" + exp))
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(sig))) {
		return ""
	}
	return id
}

// InternalAuthOK checks X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>" (key = INTERNAL_KEY_MESSAGING).
func InternalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n || len(key) == 0 {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}

// InternalHeader signs a service-to-service call valid until exp (unix seconds).
func InternalHeader(key []byte, exp int64) string {
	e := strconv.FormatInt(exp, 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + e))
	return e + "." + hex.EncodeToString(m.Sum(nil))
}

// IsAdmin: X-User-Roles holds "admin" (covered by the signature Authed checked).
func IsAdmin(r *http.Request) bool {
	return slices.Contains(strings.Split(r.Header.Get("X-User-Roles"), ","), "admin")
}

// UserFunc is a handler that knows who calls.
type UserFunc func(w http.ResponseWriter, r *http.Request, me string)

// Auth wraps handlers with the identity and internal-call checks.
type Auth struct {
	SigKey      []byte // USER_SIG_KEY_MESSAGING
	InternalKey []byte // INTERNAL_KEY_MESSAGING
	Now         func() time.Time
}

// Authed: signed-in callers only (the gateway's X-User-* signed for messaging).
func (a Auth) Authed(h UserFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := UserFrom(a.SigKey, r, a.Now())
		if me == "" {
			Fail(w, 401, "Bạn chưa đăng nhập.")
			return
		}
		h(w, r, me)
	}
}

// Internal: the backend's service-to-service calls (X-Internal-Auth signed with INTERNAL_KEY_MESSAGING).
func (a Auth) Internal(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !InternalAuthOK(a.InternalKey, r.Header.Get("X-Internal-Auth"), a.Now()) {
			Fail(w, 401, "unauthorized")
			return
		}
		h(w, r)
	}
}

// AdminOnly: signed-in admins only.
func (a Auth) AdminOnly(h UserFunc) http.HandlerFunc {
	return a.Authed(func(w http.ResponseWriter, r *http.Request, me string) {
		if !IsAdmin(r) {
			Fail(w, 403, "Chỉ Admin.")
			return
		}
		h(w, r, me)
	})
}

// RateLimiter: at most `limit` actions a minute per user (sending messages). In memory, per process.
// shortcut: per-copy counters; share them through Redis when several messaging copies run.
type RateLimiter struct {
	mu    sync.Mutex
	limit int
	hits  map[string][]time.Time
}

// NewRateLimiter makes a limiter allowing limit actions a minute per user.
func NewRateLimiter(limit int) *RateLimiter {
	return &RateLimiter{limit: limit, hits: map[string][]time.Time{}}
}

// Allow records an action of user and tells whether it is within the limit.
func (l *RateLimiter) Allow(user string, now time.Time) bool {
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
