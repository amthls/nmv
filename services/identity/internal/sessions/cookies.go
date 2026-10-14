package sessions

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"

	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/tokens"
)

// ---- cookies ------------------------------------------------------------------------------------------

const (
	CookieAccess  = "nh_access"
	CookieRefresh = "nh_refresh"
	CookieCSRF    = "nh_csrf"
	refreshPath   = "/api/identity" // the refresh cookie is sent only to identity, never to the rest of the API
)

func (s *Service) secure(r *http.Request) bool {
	return s.cookieSecure || r.Header.Get("X-Forwarded-Proto") == "https"
}

// SetSessionCookies sets the access cookie, the refresh cookie when rotated, and the CSRF cookie.
func (s *Service) SetSessionCookies(w http.ResponseWriter, r *http.Request, access, refresh string) {
	sec := s.secure(r)
	http.SetCookie(w, &http.Cookie{Name: CookieAccess, Value: access, Path: "/", MaxAge: int(tokens.AccessTTL.Seconds()), HttpOnly: true, Secure: sec, SameSite: http.SameSiteLaxMode})
	if refresh != "" {
		http.SetCookie(w, &http.Cookie{Name: CookieRefresh, Value: refresh, Path: refreshPath, MaxAge: int(tokens.RefreshTTL.Seconds()), HttpOnly: true, Secure: sec, SameSite: http.SameSiteStrictMode})
	}
	// Double-submit CSRF token: readable by the site's JS, echoed in X-CSRF-Token on every write
	if c, err := r.Cookie(CookieCSRF); err != nil || len(c.Value) != 64 || refresh != "" {
		http.SetCookie(w, &http.Cookie{Name: CookieCSRF, Value: tokens.RandomToken(), Path: "/", MaxAge: int(tokens.RefreshTTL.Seconds()), Secure: sec, SameSite: http.SameSiteLaxMode})
	}
}

// ClearSessionCookies expires every session cookie.
func (s *Service) ClearSessionCookies(w http.ResponseWriter, r *http.Request) {
	sec := s.secure(r)
	for _, c := range []struct{ name, path string }{{CookieAccess, "/"}, {CookieRefresh, refreshPath}, {CookieCSRF, "/"}, {"token", "/"}, {"auth_token", "/"}} {
		http.SetCookie(w, &http.Cookie{Name: c.name, Value: "", Path: c.path, MaxAge: -1, HttpOnly: c.name != CookieCSRF, Secure: sec})
	}
}

// CSRFOK: reads need no token; writes need the cookie echoed in X-CSRF-Token.
func CSRFOK(r *http.Request, method string) bool {
	switch method {
	case "GET", "HEAD", "OPTIONS":
		return true
	}
	c, err := r.Cookie(CookieCSRF)
	h := r.Header.Get("X-CSRF-Token")
	return err == nil && c.Value != "" && h != "" && subtle.ConstantTimeCompare([]byte(c.Value), []byte(h)) == 1
}

// ---- the signed-in user of a request to identity itself --------------------------------------------------

// Caller is the signed-in user of a request to identity itself.
type Caller struct {
	ID    string
	SID   string
	Roles []string
}

// Has reports whether the caller holds the role.
func (c Caller) Has(role string) bool {
	for _, r := range c.Roles {
		if r == role {
			return true
		}
	}
	return false
}

// Authed wraps endpoints that need a session: valid access cookie, session alive, CSRF on writes.
func (s *Service) Authed(h func(http.ResponseWriter, *http.Request, Caller)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, status := s.CallerOf(r.Context(), r, r.Method)
		switch status {
		case 401:
			httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		case 403:
			httpx.Fail(w, 403, "Yêu cầu bị từ chối (thiếu mã chống giả mạo). Hãy tải lại trang.")
		case 500:
			httpx.InternalError(w, r, errors.New("session check failed"))
		default:
			h(w, r, c)
		}
	}
}

// CallerOf resolves the access cookie. 200 = signed in, 401 = not (or expired/revoked), 403 = CSRF missing.
func (s *Service) CallerOf(ctx context.Context, r *http.Request, method string) (Caller, int) {
	ck, err := r.Cookie(CookieAccess)
	if err != nil || ck.Value == "" {
		return Caller{}, 401
	}
	uid, sid, err := tokens.ParseAccess(s.jwtSecret, ck.Value)
	if err != nil {
		return Caller{}, 401
	}
	revoked, err := s.SessionRevoked(ctx, sid)
	if err != nil {
		logger.Error(ctx, "revocation check: "+err.Error())
		return Caller{}, 500
	}
	if revoked {
		return Caller{}, 401
	}
	if !CSRFOK(r, method) {
		return Caller{}, 403
	}
	roles, err := s.RolesOf(ctx, uid)
	if err != nil {
		logger.Error(ctx, "roles: "+err.Error())
		return Caller{}, 500
	}
	return Caller{ID: uid, SID: sid, Roles: roles}, 200
}
