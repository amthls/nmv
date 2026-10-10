package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type server struct {
	cfg config
	db  *pgxpool.Pool
	rdb *redis.Client // nil when REDIS_URL is empty: revocation then always reads the database
	now func() time.Time
}

// Responses keep the backend's shape: {success, message?, data?}.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, msg string, data any) {
	body := map[string]any{"success": true}
	if msg != "" {
		body["message"] = msg
	}
	if data != nil {
		body["data"] = data
	}
	writeJSON(w, 200, body)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"success": false, "message": msg})
}

// internalError logs the real error and shows the user only the request id to quote.
func internalError(w http.ResponseWriter, r *http.Request, err error) {
	logError(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(requestIDKey).(string)
	fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

var errBadJSON = errors.New("bad json")

func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return errBadJSON
	}
	return nil
}

// The gateway overwrites X-Real-IP with the verified client address; anything else talking to us is internal.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

func userAgent(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 200 {
		ua = ua[:200]
	}
	return ua
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

// ---- cookies ------------------------------------------------------------------------------------------

const (
	cookieAccess  = "nh_access"
	cookieRefresh = "nh_refresh"
	cookieCSRF    = "nh_csrf"
	refreshPath   = "/api/identity" // the refresh cookie is sent only to identity, never to the rest of the API
)

func (s *server) secure(r *http.Request) bool {
	return s.cfg.CookieSecure || r.Header.Get("X-Forwarded-Proto") == "https"
}

func (s *server) setSessionCookies(w http.ResponseWriter, r *http.Request, access, refresh string) {
	sec := s.secure(r)
	http.SetCookie(w, &http.Cookie{Name: cookieAccess, Value: access, Path: "/", MaxAge: int(accessTTL.Seconds()), HttpOnly: true, Secure: sec, SameSite: http.SameSiteLaxMode})
	if refresh != "" {
		http.SetCookie(w, &http.Cookie{Name: cookieRefresh, Value: refresh, Path: refreshPath, MaxAge: int(refreshTTL.Seconds()), HttpOnly: true, Secure: sec, SameSite: http.SameSiteStrictMode})
	}
	// Double-submit CSRF token: readable by the site's JS, echoed in X-CSRF-Token on every write
	if c, err := r.Cookie(cookieCSRF); err != nil || len(c.Value) != 64 || refresh != "" {
		http.SetCookie(w, &http.Cookie{Name: cookieCSRF, Value: randomToken(), Path: "/", MaxAge: int(refreshTTL.Seconds()), Secure: sec, SameSite: http.SameSiteLaxMode})
	}
}

func (s *server) clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	sec := s.secure(r)
	for _, c := range []struct{ name, path string }{{cookieAccess, "/"}, {cookieRefresh, refreshPath}, {cookieCSRF, "/"}, {"token", "/"}, {"auth_token", "/"}} {
		http.SetCookie(w, &http.Cookie{Name: c.name, Value: "", Path: c.path, MaxAge: -1, HttpOnly: c.name != cookieCSRF, Secure: sec})
	}
}

func csrfOK(r *http.Request, method string) bool {
	switch method {
	case "GET", "HEAD", "OPTIONS":
		return true
	}
	c, err := r.Cookie(cookieCSRF)
	h := r.Header.Get("X-CSRF-Token")
	return err == nil && c.Value != "" && h != "" && subtle.ConstantTimeCompare([]byte(c.Value), []byte(h)) == 1
}

// ---- the signed-in user of a request to identity itself --------------------------------------------------

type caller struct {
	ID    string
	SID   string
	Roles []string
}

func (c caller) has(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// authed wraps identity's own endpoints that need a session: valid access cookie, session alive, CSRF on writes.
func (s *server) authed(h func(http.ResponseWriter, *http.Request, caller)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, status := s.callerOf(r.Context(), r, r.Method)
		switch status {
		case 401:
			fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		case 403:
			fail(w, 403, "Yêu cầu bị từ chối (thiếu mã chống giả mạo). Hãy tải lại trang.")
		case 500:
			internalError(w, r, errors.New("session check failed"))
		default:
			h(w, r, c)
		}
	}
}

// callerOf resolves the access cookie. 200 = signed in, 401 = not (or expired/revoked), 403 = CSRF missing.
func (s *server) callerOf(ctx context.Context, r *http.Request, method string) (caller, int) {
	ck, err := r.Cookie(cookieAccess)
	if err != nil || ck.Value == "" {
		return caller{}, 401
	}
	uid, sid, err := parseAccess(s.cfg.JWTSecret, ck.Value)
	if err != nil {
		return caller{}, 401
	}
	revoked, err := s.sessionRevoked(ctx, sid)
	if err != nil {
		logError(ctx, "revocation check: "+err.Error())
		return caller{}, 500
	}
	if revoked {
		return caller{}, 401
	}
	if !csrfOK(r, method) {
		return caller{}, 403
	}
	roles, err := s.rolesOf(ctx, uid)
	if err != nil {
		logError(ctx, "roles: "+err.Error())
		return caller{}, 500
	}
	return caller{ID: uid, SID: sid, Roles: roles}, 200
}

func itoa(n int) string { return strconv.Itoa(n) }
