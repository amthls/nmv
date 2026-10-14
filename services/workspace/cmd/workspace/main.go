// workspace: chapter versions (and later drafts, proposals, tasks) for NovelHub. See Plan/chapter-workspace.md.
//
//	workspace               serve HTTP on :PORT (default 8080)
//	workspace import        make v1 of every catalog chapter not imported yet (safe to re-run)
//	workspace republish [id] re-send workspace.revision.merged for every chapter (or one) to rebuild the reading copy
//	workspace healthcheck   exit 0 when the local server answers /health (Docker healthcheck)
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

	"nmv/workspace/internal/app"
	"nmv/workspace/internal/config"
	"nmv/workspace/internal/platform/db"
	"nmv/workspace/internal/platform/logger"
	"nmv/workspace/internal/quota"
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
	a := app.New(cfg, pool, time.Now, quota.New())

	if cmd == "republish" {
		if err := a.Republish(ctx, strings.Join(os.Args[2:], "")); err != nil {
			logger.Error(ctx, "republish: "+err.Error())
			os.Exit(1)
		}
		return
	}
	if cmd == "import" {
		if err := a.Import(ctx); err != nil {
			logger.Error(ctx, "import: "+err.Error())
			os.Exit(1)
		}
		return
	}

	a.Start(ctx)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	logger.Info(ctx, "workspace listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error(ctx, err.Error())
		os.Exit(1)
	}
}
