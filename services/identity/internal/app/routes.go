package app

import (
	"context"
	"net/http"
	"time"

	"nmv/identity/internal/platform/httpx"
)

// Routes lists every route, grouped by what it does. Paths are what the gateway forwards after stripping
// /api/identity (internal ones are never routed from outside).
func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	authed := a.sess.Authed

	// health
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { httpx.OK(w, "", nil) })
	m.HandleFunc("GET /ready", a.ready)

	// sign-up, sign-in, passwords, email verification (no session needed)
	m.HandleFunc("POST /register", a.authH.Register)
	m.HandleFunc("POST /login", a.authH.Login)
	m.HandleFunc("POST /logout", a.authH.Logout)
	m.HandleFunc("POST /refresh", a.sess.Refresh)
	m.HandleFunc("POST /forgot-password", a.authH.Forgot)
	m.HandleFunc("POST /reset-password", a.authH.Reset)
	m.HandleFunc("POST /verify-email", a.authH.VerifyEmail)
	m.HandleFunc("POST /confirm-email-change", a.emailH.ConfirmEmailChange)

	// the signed-in user's own account
	m.HandleFunc("GET /me", authed(a.authH.Me))
	m.HandleFunc("GET /sessions", authed(a.sess.List))
	m.HandleFunc("DELETE /sessions/{id}", authed(a.sess.Revoke))
	m.HandleFunc("POST /logout-all", authed(a.authH.LogoutAll))
	m.HandleFunc("POST /change-password", authed(a.authH.ChangePassword))
	m.HandleFunc("POST /change-email", authed(a.emailH.ChangeEmail))
	m.HandleFunc("POST /resend-verification", authed(a.authH.ResendVerification))

	// moderation
	m.HandleFunc("POST /users/{id}/roles", authed(a.adminH.Roles))
	m.HandleFunc("POST /users/{id}/ban", authed(a.adminH.Ban(true)))
	m.HandleFunc("POST /users/{id}/unban", authed(a.adminH.Ban(false)))
	m.HandleFunc("DELETE /users/{id}", authed(a.adminH.DeleteUser))
	m.HandleFunc("GET /users/{id}/private", authed(a.adminH.Private))
	m.HandleFunc("GET /admin/users", authed(a.adminH.Lookup))
	m.HandleFunc("POST /admin/revoke-all-sessions", authed(a.adminH.RevokeAll))

	// nginx auth_request and other services' calls
	m.HandleFunc("GET /internal/verify", a.internalH.Verify)
	m.HandleFunc("GET /internal/users/{id}", a.internalH.Internal(a.internalH.User))
	m.HandleFunc("GET /internal/stats", a.internalH.Internal(a.internalH.Stats))
	m.HandleFunc("POST /internal/users/{id}/roles", a.internalH.Internal(a.internalH.Grant))
	return m
}

func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	checks := map[string]string{"database": "ok", "redis": "ok"}
	status := 200
	if err := a.db.Ping(ctx); err != nil {
		checks["database"], status = "down", 503
	}
	if a.rdb == nil {
		checks["redis"] = "disabled"
	} else if err := a.rdb.Ping(ctx).Err(); err != nil {
		checks["redis"] = "down" // degraded only: revocation falls back to the database
	}
	httpx.WriteJSON(w, status, map[string]any{"success": status == 200, "data": checks})
}
