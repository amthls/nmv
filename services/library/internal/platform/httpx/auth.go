package httpx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// UserFunc is a handler that knows who calls ("" = guest where guests are allowed).
type UserFunc func(w http.ResponseWriter, r *http.Request, me string) error

// Auth wraps handlers with the identity and internal-call checks.
type Auth struct {
	SigKey      []byte // USER_SIG_KEY_LIBRARY
	InternalKey []byte // INTERNAL_KEY_LIBRARY
	Now         func() time.Time
}

// Authed: signed-in callers only.
func (a Auth) Authed(h UserFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := UserFrom(a.SigKey, r, a.Now())
		if me == "" {
			Fail(w, 401, "Chưa đăng nhập.")
			return
		}
		if err := h(w, r, me); err != nil {
			Answer(w, r, err)
		}
	}
}

// Maybe: guests too (me = "").
func (a Auth) Maybe(h UserFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r, UserFrom(a.SigKey, r, a.Now())); err != nil {
			Answer(w, r, err)
		}
	}
}

// Internal: other services' calls (X-Internal-Auth signed with INTERNAL_KEY_LIBRARY).
func (a Auth) Internal(h func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !InternalAuthOK(a.InternalKey, r.Header.Get("X-Internal-Auth"), a.Now()) {
			Fail(w, 401, "unauthorized")
			return
		}
		if err := h(w, r); err != nil {
			Answer(w, r, err)
		}
	}
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

// InternalAuthOK checks X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>".
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
