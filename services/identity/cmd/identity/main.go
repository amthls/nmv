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

	"nmv/identity/internal/app"
	"nmv/identity/internal/config"
	"nmv/identity/internal/demo"
	"nmv/identity/internal/platform/db"
	"nmv/identity/internal/platform/events"
	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/platform/redis"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := ""
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	if cmd == "healthcheck" {
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://127.0.0.1:" + config.Env("PORT", "8080") + "/health")
		if err != nil || res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error(ctx, err.Error())
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

	if cmd == "republish" {
		if err := events.Republish(ctx, pool, strings.Join(os.Args[2:], "")); err != nil {
			logger.Error(ctx, "republish: "+err.Error())
			os.Exit(1)
		}
		return
	}
	if cmd == "seed-demo" {
		if err := demo.Seed(ctx, pool); err != nil {
			logger.Error(ctx, "seed-demo: "+err.Error())
			os.Exit(1)
		}
		return
	}

	rdb, err := redis.Connect(cfg.RedisURL)
	if err != nil {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
	if rdb != nil {
		defer rdb.Close()
	}
	a := app.New(cfg, pool, rdb, time.Now)
	a.Start(ctx)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           a.Handler(),
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
	logger.Info(ctx, "identity listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
}
