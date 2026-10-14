// Package app wires the services together and serves them.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"nmv/messaging/internal/config"
	"nmv/messaging/internal/dm"
	"nmv/messaging/internal/groupchat"
	"nmv/messaging/internal/notifications"
	"nmv/messaging/internal/platform/catalog"
	"nmv/messaging/internal/platform/events"
	"nmv/messaging/internal/platform/httpx"
	"nmv/messaging/internal/platform/logger"
	"nmv/messaging/internal/realtime"
)

// App holds every handler and background worker of messaging.
type App struct {
	cfg  config.Config
	db   *pgxpool.Pool
	rdb  *redis.Client // nil in tests: nothing is pushed
	auth httpx.Auth

	hub      *realtime.Hub
	notifSvc *notifications.Service
	wsH      *realtime.Handler
	dmH      *dm.Handler
	groupH   *groupchat.Handler
	notifH   *notifications.Handler
}

// New builds the app: repositories, then services, then handlers. rdb may be nil; now is time.Now outside tests.
func New(cfg config.Config, db *pgxpool.Pool, rdb *redis.Client, now func() time.Time) *App {
	be := catalog.New(cfg.BackendURL, cfg.BackendKey)
	lib := catalog.New(cfg.LibraryURL, cfg.LibraryKey)
	hub := realtime.NewHub()
	pub := events.NewPublisher(rdb)
	rate := httpx.NewRateLimiter(30)

	notifSvc := notifications.NewService(notifications.NewRepository(db), lib, pub)
	return &App{
		cfg: cfg, db: db, rdb: rdb,
		auth:     httpx.Auth{SigKey: cfg.SigKey, InternalKey: cfg.InternalKey, Now: now},
		hub:      hub,
		notifSvc: notifSvc,
		wsH:      realtime.NewHandler(hub, cfg.SigKey, now),
		dmH:      dm.NewHandler(dm.NewService(dm.NewRepository(db), be, pub, rate, now)),
		groupH:   groupchat.NewHandler(groupchat.NewService(groupchat.NewRepository(db), be, pub, rate, now)),
		notifH:   notifications.NewHandler(notifSvc),
	}
}

// Handler is the whole HTTP service with its request log.
func (a *App) Handler() http.Handler { return logger.WithRequestLog(a.Routes()) }

// Start runs the background loops (realtime subscription, notification queue consumer, cleanup).
func (a *App) Start(ctx context.Context) {
	go realtime.SubscribeLoop(ctx, a.rdb, a.hub)
	go a.notifSvc.ConsumeLoop(ctx, a.cfg.RabbitURL)
	go a.notifSvc.CleanupLoop(ctx)
}

// CloseSockets closes every open WebSocket (shutdown): browsers reconnect to another copy.
func (a *App) CloseSockets() { a.hub.CloseAll() }
