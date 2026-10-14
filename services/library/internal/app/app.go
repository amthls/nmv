// Package app wires the services together and serves them.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/albums"
	"nmv/library/internal/bookmarks"
	"nmv/library/internal/config"
	"nmv/library/internal/follows"
	"nmv/library/internal/history"
	"nmv/library/internal/internalapi"
	"nmv/library/internal/platform/catalog"
	"nmv/library/internal/platform/events"
	"nmv/library/internal/platform/httpx"
	"nmv/library/internal/platform/logger"
	"nmv/library/internal/platform/outbox"
	syncer "nmv/library/internal/sync"
)

// App holds every handler and service of library.
type App struct {
	cfg  config.Config
	db   *pgxpool.Pool
	auth httpx.Auth

	// Sync is exported for `library import-legacy`, which copies the story rows once the old tables are in.
	Sync *syncer.Service

	history   *history.Service
	follows   *follows.Service
	outbox    *outbox.Publisher
	albumsH   *albums.Handler
	historyH  *history.Handler
	bookmarkH *bookmarks.Handler
	followsH  *follows.Handler
	internalH *internalapi.Handler
}

// New builds the app: repositories, then services, then handlers. now is time.Now outside tests.
func New(cfg config.Config, db *pgxpool.Pool, now func() time.Time) *App {
	cat := catalog.New(cfg.BackendURL, cfg.BackendKey)

	histRepo := history.NewRepository(db)
	// history needs chapter copies; sync needs history's pruning: the two meet through small interfaces
	var histSvc *history.Service
	syncSvc := syncer.NewService(syncer.NewRepository(db), cat, lazyPruner{func(ctx context.Context) error { return histSvc.PruneHistory(ctx) }})
	histSvc = history.NewService(histRepo, syncSvc, now)
	followSvc := follows.NewService(follows.NewRepository(db), cat)

	return &App{
		cfg:       cfg,
		db:        db,
		auth:      httpx.Auth{SigKey: cfg.SigKey, InternalKey: cfg.InternalKey, Now: now},
		Sync:      syncSvc,
		history:   histSvc,
		follows:   followSvc,
		outbox:    &outbox.Publisher{DB: db, RabbitURL: cfg.RabbitURL},
		albumsH:   albums.NewHandler(albums.NewService(albums.NewRepository(db), cat)),
		historyH:  history.NewHandler(histSvc),
		bookmarkH: bookmarks.NewHandler(bookmarks.NewService(bookmarks.NewRepository(db))),
		followsH:  follows.NewHandler(followSvc),
		internalH: internalapi.NewHandler(internalapi.NewService(internalapi.NewRepository(db), histSvc)),
	}
}

// lazyPruner hands sync the history pruning before the history service exists.
type lazyPruner struct {
	prune func(ctx context.Context) error
}

func (l lazyPruner) PruneHistory(ctx context.Context) error { return l.prune(ctx) }

// Handler is the whole HTTP service with its request log.
func (a *App) Handler() http.Handler { return logger.WithRequestLog(a.Routes()) }

// Start runs the background loops (story sync, event publisher, position flush, identity consumer). The returned
// channel closes once the last reading positions are written, after ctx ends.
func (a *App) Start(ctx context.Context) <-chan struct{} {
	go a.Sync.Loop(ctx)
	go a.outbox.Run(ctx)
	flushed := make(chan struct{})
	go a.history.FlushLoop(ctx, flushed)
	go events.ConsumeIdentity(ctx, a.cfg.RabbitURL, a.follows.ApplyIdentityEvent)
	return flushed
}
