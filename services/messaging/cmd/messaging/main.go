// messaging: realtime pushes over plain WebSocket, direct messages, group chat, notifications. See Plan/messaging.md.
//
//	messaging               serve HTTP on :PORT (default 8080)
//	messaging healthcheck   exit 0 when the local server answers /health (Docker healthcheck)
//	messaging loadtest N url [hold]   N fake sockets + one push to all (see internal/loadtest)
//	messaging import-legacy  copy messages, blocks, labels, notifications from the backend database (once, safe to re-run)
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/messaging/internal/app"
	"nmv/messaging/internal/config"
	"nmv/messaging/internal/legacy"
	"nmv/messaging/internal/loadtest"
	"nmv/messaging/internal/platform/db"
	"nmv/messaging/internal/platform/logger"
	"nmv/messaging/internal/platform/redis"
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
	if len(os.Args) > 1 && os.Args[1] == "loadtest" {
		if err := loadtest.Run(ctx, os.Args[2:]); err != nil {
			logger.Error(ctx, "loadtest: "+err.Error())
			os.Exit(1)
		}
		return
	}
	cfg := config.Load()
	if !cfg.Valid() {
		logger.Error(ctx, "USER_SIG_KEY_MESSAGING, INTERNAL_KEY_MESSAGING, INTERNAL_KEY_CATALOG, INTERNAL_KEY_LIBRARY (>= 32 chars), REDIS_URL and MESSAGING_DATABASE_URL are required")
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
	if len(os.Args) > 1 && os.Args[1] == "import-legacy" {
		if err := legacy.Import(ctx, pool, cfg.LegacyURL); err != nil {
			logger.Error(ctx, "import-legacy: "+err.Error())
			os.Exit(1)
		}
		return
	}
	rdb, err := redis.Connect(cfg.RedisURL)
	if err != nil {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
	defer rdb.Close()

	a := app.New(cfg, pool, rdb, time.Now)
	a.Start(ctx)
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
		a.CloseSockets() // browsers reconnect to another copy (or this one after the restart)
		srv.Shutdown(shutdown)
	}()
	logger.Info(ctx, "messaging listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
}
