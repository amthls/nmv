// identity: accounts, passwords, sessions, site roles and account mail for NovelHub. See Plan/identity.md.
//
//	identity                 serve HTTP on :PORT (default 8080)
//	identity seed-demo       add the sample accounts (password123), only into an empty identity_db
//	identity republish [id]  re-send identity.user.* for every user (or one) to rebuild a copy
//	identity healthcheck     exit 0 when the local server answers /health (Docker healthcheck)
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := ""
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	if cmd == "healthcheck" {
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://127.0.0.1:" + env("PORT", "8080") + "/health")
		if err != nil || res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}

	cfg, err := loadConfig()
	if err != nil {
		logError(ctx, err.Error())
		os.Exit(1)
	}
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logError(ctx, "database: "+err.Error())
		os.Exit(1)
	}
	defer db.Close()
	if err := migrate(ctx, db); err != nil {
		logError(ctx, "migrate: "+err.Error())
		os.Exit(1)
	}

	if cmd == "republish" {
		if err := republish(ctx, db, strings.Join(os.Args[2:], "")); err != nil {
			logError(ctx, "republish: "+err.Error())
			os.Exit(1)
		}
		return
	}
	if cmd == "seed-demo" {
		if err := seedDemo(ctx, db); err != nil {
			logError(ctx, "seed-demo: "+err.Error())
			os.Exit(1)
		}
		return
	}

	s := &server{cfg: cfg, db: db, now: time.Now}
	if cfg.RedisURL != "" {
		opt, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			logError(ctx, "REDIS_URL: "+err.Error())
			os.Exit(1)
		}
		s.rdb = redis.NewClient(opt)
		defer s.rdb.Close()
	}

	go s.publishLoop(ctx)
	go s.mailLoop(ctx)
	go s.housekeeping(ctx)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withRequestLog(s.routes()),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       20 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	logInfo(ctx, "identity listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logError(ctx, err.Error())
		os.Exit(1)
	}
}

// Paths are what the gateway forwards after stripping /api/identity (internal ones are never routed from outside).
func (s *server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { ok(w, "", nil) })
	m.HandleFunc("GET /ready", s.handleReady)

	m.HandleFunc("POST /register", s.handleRegister)
	m.HandleFunc("POST /login", s.handleLogin)
	m.HandleFunc("POST /logout", s.handleLogout)
	m.HandleFunc("POST /refresh", s.handleRefresh)
	m.HandleFunc("POST /forgot-password", s.handleForgot)
	m.HandleFunc("POST /reset-password", s.handleReset)
	m.HandleFunc("POST /verify-email", s.handleVerifyEmail)
	m.HandleFunc("POST /confirm-email-change", s.handleConfirmEmailChange)

	m.HandleFunc("GET /me", s.authed(s.handleMe))
	m.HandleFunc("GET /sessions", s.authed(s.handleSessions))
	m.HandleFunc("DELETE /sessions/{id}", s.authed(s.handleRevokeSession))
	m.HandleFunc("POST /logout-all", s.authed(s.handleLogoutAll))
	m.HandleFunc("POST /change-password", s.authed(s.handleChangePassword))
	m.HandleFunc("POST /change-email", s.authed(s.handleChangeEmail))
	m.HandleFunc("POST /resend-verification", s.authed(s.handleResendVerification))

	m.HandleFunc("POST /users/{id}/roles", s.authed(s.handleRoles))
	m.HandleFunc("POST /users/{id}/ban", s.authed(s.handleBan(true)))
	m.HandleFunc("POST /users/{id}/unban", s.authed(s.handleBan(false)))
	m.HandleFunc("DELETE /users/{id}", s.authed(s.handleDeleteUser))
	m.HandleFunc("GET /users/{id}/private", s.authed(s.handlePrivate))
	m.HandleFunc("GET /admin/users", s.authed(s.handleLookup))
	m.HandleFunc("POST /admin/revoke-all-sessions", s.authed(s.handleRevokeAll))

	m.HandleFunc("GET /internal/verify", s.handleVerify)
	m.HandleFunc("GET /internal/users/{id}", s.internal(s.handleInternalUser))
	m.HandleFunc("GET /internal/stats", s.internal(s.handleStats))
	m.HandleFunc("POST /internal/users/{id}/roles", s.internal(s.handleInternalGrant))
	return m
}

func (s *server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	checks := map[string]string{"database": "ok", "redis": "ok"}
	status := 200
	if err := s.db.Ping(ctx); err != nil {
		checks["database"], status = "down", 503
	}
	if s.rdb == nil {
		checks["redis"] = "disabled"
	} else if err := s.rdb.Ping(ctx).Err(); err != nil {
		checks["redis"] = "down" // degraded only: revocation falls back to the database
	}
	writeJSON(w, status, map[string]any{"success": status == 200, "data": checks})
}
