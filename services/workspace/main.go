// workspace: chapter versions (and later drafts, proposals, tasks) for NovelHub. See Plan/chapter-workspace.md.
//
//	workspace               serve HTTP on :PORT (default 8080)
//	workspace import        make v1 of every catalog chapter not imported yet (safe to re-run)
//	workspace healthcheck   exit 0 when the local server answers /health (Docker healthcheck)
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
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
	s := &server{cfg: cfg, db: db, now: time.Now, perms: &permCache{m: map[string]permEntry{}}}

	if cmd == "import" {
		if err := s.importChapters(ctx); err != nil {
			logError(ctx, "import: "+err.Error())
			os.Exit(1)
		}
		return
	}

	go s.publishLoop(ctx)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withRequestLog(s.routes()),
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
	logInfo(ctx, "workspace listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logError(ctx, err.Error())
		os.Exit(1)
	}
}

// Public paths are what the gateway forwards after stripping /api/ws; /internal is for the backend only.
func (s *server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { ok(w, nil) })
	m.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.Ping(r.Context()); err != nil {
			writeJSON(w, 503, map[string]any{"success": false, "data": map[string]string{"database": "down"}})
			return
		}
		ok(w, map[string]string{"database": "ok"})
	})

	m.HandleFunc("GET /chapters/{id}/revisions", s.handleRevisions)
	m.HandleFunc("GET /chapters/{id}/revisions/{version}", s.handleRevision)
	m.HandleFunc("GET /chapters/{id}/compare", s.handleCompare)
	m.HandleFunc("POST /chapters/{id}/rewind", s.handleRewind)
	m.HandleFunc("GET /drafts", s.handleDraftList)
	m.HandleFunc("GET /drafts/{id}", s.handleDraftGet)
	m.HandleFunc("DELETE /drafts/{id}", s.handleDraftDiscard)
	m.HandleFunc("GET /drafts/{id}/pull", s.handlePullPreview)
	m.HandleFunc("POST /drafts/{id}/pull", s.handlePullApply)
	m.HandleFunc("GET /proposals", s.handleProposals)
	m.HandleFunc("GET /drafts/{id}/review", s.handleReview)
	m.HandleFunc("POST /drafts/{id}/comments", s.handleComment)
	m.HandleFunc("POST /drafts/{id}/lock", s.handleLock)
	m.HandleFunc("DELETE /drafts/{id}/lock", s.handleUnlock)
	m.HandleFunc("DELETE /drafts/{id}/shares/{user}", s.handleUnshare)
	m.HandleFunc("POST /drafts/{id}/copy", s.handleCopy)
	m.HandleFunc("GET /drafts/{id}/offers/{copy}", s.handleOfferPreview)
	m.HandleFunc("POST /drafts/{id}/offers/{copy}", s.handleOfferAccept)
	m.HandleFunc("DELETE /drafts/{id}/offers/{copy}", s.handleOfferDecline)
	m.HandleFunc("GET /drafts/orphans", s.handleOrphans)
	m.HandleFunc("GET /drafts/shared", s.handleSharedWithMe)
	m.HandleFunc("POST /drafts/{id}/reclaim", s.handleReclaim)
	m.HandleFunc("GET /drafts/{id}/card", s.handleCard)
	m.HandleFunc("POST /tasks", s.handleTaskCreate)
	m.HandleFunc("GET /tasks", s.handleTaskList)
	m.HandleFunc("PATCH /tasks/{id}", s.handleTaskEdit)
	m.HandleFunc("POST /tasks/{id}/claim", s.handleTaskClaim)
	m.HandleFunc("POST /tasks/{id}/unclaim", s.handleTaskUnclaim)
	m.HandleFunc("POST /tasks/{id}/start", s.handleTaskStart)
	m.HandleFunc("POST /tasks/{id}/done", s.handleTaskDone)
	m.HandleFunc("POST /tasks/{id}/cancel", s.handleTaskCancel)
	m.HandleFunc("GET /board", s.handleBoard)

	m.HandleFunc("POST /internal/chapters", s.internal(s.handleCreate))
	m.HandleFunc("GET /internal/chapters/{id}", s.internal(s.handleCurrent))
	m.HandleFunc("POST /internal/chapters/{id}/revisions", s.internal(s.handleEdit))
	m.HandleFunc("POST /internal/chapters/{id}/delete", s.internal(s.handleDelete))
	m.HandleFunc("POST /internal/drafts", s.internal(s.handleDraftCreate))
	m.HandleFunc("GET /internal/drafts/{id}", s.internal(s.handleDraftInternal))
	m.HandleFunc("PUT /internal/drafts/{id}", s.internal(s.handleDraftSave))
	m.HandleFunc("POST /internal/drafts/{id}/publish", s.internal(s.handleDraftPublish))
	m.HandleFunc("POST /internal/drafts/{id}/submit", s.internal(s.handleSubmit))
	m.HandleFunc("POST /internal/drafts/{id}/withdraw", s.internal(s.handleWithdraw))
	m.HandleFunc("POST /internal/drafts/{id}/return", s.internal(s.handleReturn))
	m.HandleFunc("POST /internal/drafts/{id}/shares", s.internal(s.handleShare))
	m.HandleFunc("POST /internal/drafts/{id}/offer", s.internal(s.handleOffer))
	m.HandleFunc("POST /internal/drafts/{id}/transfer", s.internal(s.handleTransfer))
	return m
}
