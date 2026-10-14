// Package app wires the features together and serves them.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/board"
	"nmv/workspace/internal/chapters"
	"nmv/workspace/internal/config"
	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/importer"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/logger"
	"nmv/workspace/internal/platform/outbox"
	"nmv/workspace/internal/proposals"
	"nmv/workspace/internal/quota"
	"nmv/workspace/internal/schedule"
	"nmv/workspace/internal/tasks"
)

// App holds every handler and background loop of workspace.
type App struct {
	cfg   config.Config
	db    *pgxpool.Pool
	now   func() time.Time // tests move the clock
	auth  httpx.Auth
	perms *catalog.Client
	quota *quota.Writes // nil: no write quotas (tests)

	chaptersSvc *chapters.Service
	scheduleSvc *schedule.Service
	importSvc   *importer.Service

	chaptersH  *chapters.Handler
	draftsH    *drafts.Handler
	proposalsH *proposals.Handler
	tasksH     *tasks.Handler
	scheduleH  *schedule.Handler
	boardH     *board.Handler
}

// New builds the app: repositories, then services, then handlers. now is time.Now outside tests; q may be nil.
func New(cfg config.Config, db *pgxpool.Pool, now func() time.Time, q *quota.Writes) *App {
	a := &App{cfg: cfg, db: db, now: now, quota: q}
	clock := func() time.Time { return a.now() }
	a.auth = httpx.Auth{SigKey: cfg.SigKey, InternalKey: cfg.InternalKey, Now: clock}
	a.perms = catalog.New(cfg.BackendURL, cfg.BackendKey, clock)

	chRepo := chapters.NewRepository(db)
	a.chaptersSvc = chapters.NewService(db, chRepo)
	draftsSvc := drafts.NewService(db, clock, chRepo, a.perms)
	tasksSvc := tasks.NewService(db, chRepo, draftsSvc)
	proposalsSvc := proposals.NewService(db, draftsSvc, chRepo)
	a.scheduleSvc = schedule.NewService(db, clock, draftsSvc, a.perms)
	a.importSvc = importer.NewService(db, chRepo, a.perms)

	a.chaptersH = chapters.NewHandler(a.chaptersSvc, a.auth, a.perms)
	a.draftsH = drafts.NewHandler(draftsSvc, a.auth, a.perms)
	a.proposalsH = proposals.NewHandler(proposalsSvc, draftsSvc, a.auth, a.perms)
	a.tasksH = tasks.NewHandler(tasksSvc, a.auth, a.perms)
	a.scheduleH = schedule.NewHandler(a.scheduleSvc, draftsSvc, a.auth, a.perms, clock)
	a.boardH = board.NewHandler(db, a.auth, a.perms)
	return a
}

// Handler is the whole HTTP service: request log, write quotas, routes.
func (a *App) Handler() http.Handler {
	return logger.WithRequestLog(quota.Limit(a.quota, a.auth, a.Routes()))
}

// Start runs the background loops (publishing the outbox to RabbitMQ, scheduled publishing).
func (a *App) Start(ctx context.Context) {
	pub := &outbox.Publisher{DB: a.db, RabbitURL: a.cfg.RabbitURL}
	go pub.Run(ctx)
	go a.scheduleSvc.Loop(ctx)
}

// Import makes v1 of every catalog chapter not imported yet (`workspace import`).
func (a *App) Import(ctx context.Context) error { return a.importSvc.Import(ctx) }

// Republish re-sends workspace.revision.merged for every chapter (or one) to rebuild the reading copy.
func (a *App) Republish(ctx context.Context, id string) error {
	return a.chaptersSvc.Republish(ctx, id)
}
