// Package internalapi: the nginx auth_request check and the calls other services make to identity.
package internalapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/identity/internal/platform/events"
	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/sessions"
	"nmv/identity/internal/tokens"
)

// Handler serves /internal/*.
type Handler struct {
	db          *pgxpool.Pool
	sess        *sessions.Service
	signer      *tokens.Signer
	internalKey []byte // INTERNAL_KEY_IDENTITY
	now         func() time.Time
}

// NewHandler wires the handler.
func NewHandler(db *pgxpool.Pool, sess *sessions.Service, signer *tokens.Signer, internalKey []byte, now func() time.Time) *Handler {
	return &Handler{db: db, sess: sess, signer: signer, internalKey: internalKey, now: now}
}

// GET /internal/verify: nginx auth_request for every /api/v1 and /socket.io request (no body; the original
// method arrives in X-Original-Method). Always 200 for "not signed in" (the API decides what guests may do),
// 403 when a signed-in write lacks the CSRF token, signed X-User-* headers when signed in.
// Verify handles GET /internal/verify (nginx auth_request).
func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	method := r.Header.Get("X-Original-Method")
	if method == "" {
		method = "GET"
	}
	c, status := h.sess.CallerOf(r.Context(), r, method)
	switch status {
	case 200:
		h.signer.SignHeaders(w.Header(), c.ID, strings.Join(c.Roles, ","))
		w.WriteHeader(200)
	case 403:
		w.WriteHeader(403)
	case 500:
		w.WriteHeader(500)
	default:
		w.WriteHeader(200) // guest
	}
}

// Internal wraps a handler that only other services may call (X-Internal-Auth).
func (h *Handler) Internal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !tokens.InternalAuthOK(h.internalKey, r.Header.Get("X-Internal-Auth"), h.now()) {
			httpx.Fail(w, 401, "unauthorized")
			return
		}
		next(w, r)
	}
}

// GET /internal/users/{id}: the public snapshot (same as identity.user.* event data) for the backend's
// read-through when an event has not arrived yet.
// User handles GET /internal/users/{id}.
func (h *Handler) User(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !httpx.IsUUID(id) {
		httpx.Fail(w, 404, "not found")
		return
	}
	var data []byte
	err := h.db.QueryRow(r.Context(), `SELECT `+events.UserSnapshotSQL+` FROM users WHERE id = $1`, id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Fail(w, 404, "not found")
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true,"data":`))
	w.Write(data)
	w.Write([]byte(`}`))
}

// POST /internal/users/{id}/roles {role}: the backend grants a publishing badge (author on a first own story,
// translator on a first group story). Grant only, idempotent; revoking stays an admin action with a password.
// Grant handles POST /internal/users/{id}/roles.
func (h *Handler) Grant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		Role string `json:"role"`
	}
	if !httpx.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || (b.Role != "author" && b.Role != "translator") {
		httpx.Fail(w, 400, "invalid")
		return
	}
	ctx := r.Context()
	granted := false
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) SELECT id, $2 FROM users WHERE id = $1 AND deleted_at IS NULL
			ON CONFLICT DO NOTHING`, id, b.Role)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		granted = true
		return events.UserEvent(ctx, tx, id, "updated", nil)
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if granted {
		h.sess.ForgetRoles(ctx, id)
	}
	httpx.OK(w, "", map[string]any{"granted": granted})
}

// GET /internal/stats: totals the backend's reconcile job compares with its copy, and the outbox backlog.
// Stats handles GET /internal/stats.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	var users, versionSum, pending int64
	var oldest float64
	err := h.db.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM users), (SELECT COALESCE(sum(version), 0) FROM users),
		(SELECT count(*) FROM outbox WHERE published_at IS NULL),
		(SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - min(created_at)), 0) FROM outbox WHERE published_at IS NULL)`).
		Scan(&users, &versionSum, &pending, &oldest)
	if err != nil {
		httpx.Fail(w, 500, err.Error())
		return
	}
	httpx.OK(w, "", map[string]any{"users": users, "version_sum": versionSum, "outbox_pending": pending, "outbox_oldest_seconds": int64(oldest)})
}
