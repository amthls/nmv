// library: follows, line bookmarks, reading history, albums (Plan/library.md).
//
//	library                 serve HTTP on :PORT (default 8080)
//	library healthcheck     exit 0 when the local server answers /health (Docker healthcheck)
//	library import-legacy   copy the backend's tables once (LEGACY_DATABASE_URL), then sync the story copies
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	Port        string
	SigKey      []byte // USER_SIG_KEY_LIBRARY: identity signs the gateway's X-User-* for us alone
	InternalKey []byte // INTERNAL_KEY_LIBRARY: other services' calls to /internal
	BackendKey  []byte // INTERNAL_KEY_CATALOG: our calls to the backend
	BackendURL  string
	DatabaseURL string
	RabbitURL   string // identity.user.deleted
	LegacyURL   string // novel_platform, only for `library import-legacy`
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://127.0.0.1:" + env("PORT", "8080") + "/health")
		if err != nil || res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	cfg := config{
		Port:        env("PORT", "8080"),
		SigKey:      []byte(os.Getenv("USER_SIG_KEY_LIBRARY")),
		InternalKey: []byte(os.Getenv("INTERNAL_KEY_LIBRARY")),
		BackendKey:  []byte(os.Getenv("INTERNAL_KEY_CATALOG")),
		BackendURL:  strings.TrimRight(env("CATALOG_INTERNAL_URL", "http://catalog:5000"), "/"),
		DatabaseURL: os.Getenv("LIBRARY_DATABASE_URL"),
		RabbitURL:   os.Getenv("RABBITMQ_URL"),
		LegacyURL:   os.Getenv("LEGACY_DATABASE_URL"),
	}
	if len(cfg.SigKey) < 32 || len(cfg.InternalKey) < 32 || len(cfg.BackendKey) < 32 || cfg.DatabaseURL == "" {
		logError(ctx, "USER_SIG_KEY_LIBRARY, INTERNAL_KEY_LIBRARY, INTERNAL_KEY_CATALOG (>= 32 chars) and LIBRARY_DATABASE_URL are required")
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
	s := &server{cfg: cfg, db: db, be: newBackend(cfg.BackendURL, cfg.BackendKey), now: time.Now}
	if len(os.Args) > 1 && os.Args[1] == "import-legacy" {
		err := importLegacy(ctx, db, cfg.LegacyURL)
		if err == nil {
			err = s.syncOnce(ctx) // the story/chapter copies the imported rows point at
		}
		if err != nil {
			logError(ctx, "import-legacy: "+err.Error())
			os.Exit(1)
		}
		return
	}

	go s.syncLoop(ctx)
	go s.publishLoop(ctx)
	flushed := make(chan struct{})
	go s.flushLoop(ctx, flushed)
	go s.consumeIdentity(ctx)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withRequestLog(s.routes()),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	logInfo(ctx, "library listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logError(ctx, err.Error())
		os.Exit(1)
	}
	<-flushed // the last reading positions are written before exiting
}

// userFrom: the gateway's signed identity headers (same check as the backend's auth.middleware). "" = guest.
func userFrom(key []byte, r *http.Request, now time.Time) string {
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
