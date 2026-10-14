// Package app wires the services together and serves them.
package app

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"nmv/identity/internal/admin"
	"nmv/identity/internal/auth"
	"nmv/identity/internal/config"
	"nmv/identity/internal/email"
	"nmv/identity/internal/internalapi"
	"nmv/identity/internal/platform/events"
	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/platform/outbox"
	"nmv/identity/internal/seclog"
	"nmv/identity/internal/sessions"
	"nmv/identity/internal/tokens"
)

// App holds every handler and background worker of identity.
type App struct {
	cfg config.Config
	db  *pgxpool.Pool
	rdb *redis.Client // nil when REDIS_URL is empty

	sess      *sessions.Service
	turnstile *email.Turnstile
	authH     *auth.Handler
	emailH    *email.Handler
	adminH    *admin.Handler
	internalH *internalapi.Handler
	publisher *outbox.Publisher
	mailer    *email.Mailer
	housekeep *seclog.Housekeeper
}

// New builds the app. rdb may be nil; now is time.Now outside tests.
func New(cfg config.Config, db *pgxpool.Pool, rdb *redis.Client, now func() time.Time) *App {
	alert := func(ctx context.Context, key, title, message string) error {
		return events.Alert(ctx, db, key, title, message)
	}
	signer := tokens.NewSigner(tokens.Keys{Backend: cfg.SigKeyBackend, Workspace: cfg.SigKeyWorkspace, Media: cfg.SigKeyMedia,
		Msg: cfg.SigKeyMsg, Community: cfg.SigKeyCommunity, Library: cfg.SigKeyLibrary, Rec: cfg.SigKeyRec}, now)
	sess := sessions.NewService(db, rdb, cfg.JWTSecret, cfg.CookieSecure, now)
	turnstile := &email.Turnstile{Secret: cfg.TurnstileSecret, URL: email.DefaultTurnstileURL}
	return &App{
		cfg: cfg, db: db, rdb: rdb,
		sess:      sess,
		turnstile: turnstile,
		authH:     auth.NewHandler(db, sess, turnstile, cfg.SiteURL, cfg.JWTSecret, now),
		emailH:    email.NewHandler(db, cfg.SiteURL, auth.CheckPassword),
		adminH:    admin.NewHandler(db, sess, signer, cfg.BackendURL),
		internalH: internalapi.NewHandler(db, sess, signer, cfg.InternalKey, now),
		publisher: &outbox.Publisher{DB: db, RabbitURL: cfg.RabbitURL},
		mailer:    &email.Mailer{DB: db, SMTPURL: cfg.SMTPURL, From: cfg.MailFrom, Alert: alert},
		housekeep: &seclog.Housekeeper{DB: db, Alert: alert},
	}
}

// Handler is the whole HTTP service with its request log.
func (a *App) Handler() http.Handler { return logger.WithRequestLog(a.Routes()) }

// Start runs the background loops (event publisher, account mail, housekeeping).
func (a *App) Start(ctx context.Context) {
	go a.publisher.Run(ctx)
	go a.mailer.Run(ctx)
	go a.housekeep.Run(ctx)
}
