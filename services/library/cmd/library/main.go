// library: follows, line bookmarks, reading history, albums (Plan/library.md).
//
//	library                 serve HTTP on :PORT (default 8080)
//	library healthcheck     exit 0 when the local server answers /health (Docker healthcheck)
//	library import-legacy   copy the backend's tables once (LEGACY_DATABASE_URL), then sync the story copies
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/app"
	"nmv/library/internal/config"
	"nmv/library/internal/legacy"
	"nmv/library/internal/platform/db"
	"nmv/library/internal/platform/logger"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://127.0.0.1:" + config.Env("PORT", "8080") + "/health")
		if err != nil || res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	cfg := config.Load()
	if !cfg.Valid() {
		logger.Error(ctx, "USER_SIG_KEY_LIBRARY, INTERNAL_KEY_LIBRARY, INTERNAL_KEY_CATALOG (>= 32 chars) and LIBRARY_DATABASE_URL are required")
		os.Exit(1)
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error(ctx, "database: "+err.Error())
		os.Exit(1)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		logger.Error(ctx, "migrate: "+err.Error())
		os.Exit(1)
	}
	a := app.New(cfg, pool, time.Now)
	if len(os.Args) > 1 && os.Args[1] == "import-legacy" {
		err := legacy.Import(ctx, pool, cfg.LegacyURL)
		if err == nil {
			err = a.Sync.SyncOnce(ctx) // the story/chapter copies the imported rows point at
		}
		if err != nil {
			logger.Error(ctx, "import-legacy: "+err.Error())
			os.Exit(1)
		}
		return
	}

	flushed := a.Start(ctx)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	logger.Info(ctx, "library listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
	<-flushed // the last reading positions are written before exiting
}
