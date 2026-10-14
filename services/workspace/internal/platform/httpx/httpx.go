// Package httpx holds what every handler needs: JSON answers, the signed-header checks and the /internal guard.
package httpx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nmv/workspace/internal/platform/logger"
)

// WriteJSON answers with status and v as JSON (never cached).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// OK answers 200 {success: true, data}.
func OK(w http.ResponseWriter, data any) {
	WriteJSON(w, 200, map[string]any{"success": true, "data": data})
}

// Fail answers status {success: false, message}.
func Fail(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"success": false, "message": msg})
}

// InternalError logs err and answers 500 with the request id the user can quote.
func InternalError(w http.ResponseWriter, r *http.Request, err error) {
	logger.Error(r.Context(), err.Error(), "path", r.URL.Path)
	Fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+logger.RequestID(r.Context())+")")
}

// ReadJSON decodes the request body (at most 8 MiB) into dst.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20) // a chapter is at most ~100 KB of blocks today
	return json.NewDecoder(r.Body).Decode(dst)
}

// Auth checks who is calling: the gateway's signed user headers, and the backend's signed internal calls.
type Auth struct {
	SigKey      []byte // USER_SIG_KEY_WORKSPACE
	InternalKey []byte // INTERNAL_KEY_WORKSPACE
	Now         func() time.Time
}

// UserFrom: the gateway's signed identity headers (same check as the backend's auth.middleware). "" = guest.
func (a Auth) UserFrom(r *http.Request) string {
	id, roles, exp, sig := r.Header.Get("X-User-Id"), r.Header.Get("X-User-Roles"), r.Header.Get("X-User-Exp"), r.Header.Get("X-User-Sig")
	n, err := strconv.ParseInt(exp, 10, 64)
	if id == "" || err != nil || a.Now().Unix() > n {
		return ""
	}
	m := hmac.New(sha256.New, a.SigKey)
	m.Write([]byte(id + "|" + roles + "|" + exp))
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(sig))) {
		return ""
	}
	return id
}

// User is UserFrom that answers 401 itself when nobody is signed in.
func (a Auth) User(w http.ResponseWriter, r *http.Request) (string, bool) {
	user := a.UserFrom(r)
	if user == "" {
		Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return "", false
	}
	return user, true
}

// Internal guards the backend-only endpoints (the gateway also answers 404 for /internal from outside).
func (a Auth) Internal(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !InternalAuthOK(a.InternalKey, r.Header.Get("X-Internal-Auth"), a.Now()) {
			Fail(w, 401, "unauthorized")
			return
		}
		h(w, r)
	}
}

// InternalAuth signs a call to another service (valid two minutes).
func InternalAuth(key []byte, now time.Time) string {
	exp := strconv.FormatInt(now.Add(2*time.Minute).Unix(), 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return exp + "." + hex.EncodeToString(m.Sum(nil))
}

// InternalAuthOK checks an X-Internal-Auth value.
func InternalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}

// HMACHex is the hex HMAC-SHA256 of msg (tests sign headers with it).
func HMACHex(key, msg string) string {
	m := hmac.New(sha256.New, []byte(key))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}
