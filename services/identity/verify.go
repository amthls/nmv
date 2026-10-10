package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *server) signHeaders(h http.Header, uid, roles string) {
	exp := s.now().Add(headerTTL).Unix()
	h.Set("X-User-Id", uid)
	h.Set("X-User-Roles", roles)
	h.Set("X-User-Exp", strconv.FormatInt(exp, 10))
	h.Set("X-User-Sig", signUserHeaders(s.cfg.SigKeyBackend, uid, roles, exp))
	h.Set("X-User-Sig-Ws", signUserHeaders(s.cfg.SigKeyWorkspace, uid, roles, exp)) // the gateway sends it to the workspace as X-User-Sig
	h.Set("X-User-Sig-Media", signUserHeaders(s.cfg.SigKeyMedia, uid, roles, exp))
	h.Set("X-User-Sig-Msg", signUserHeaders(s.cfg.SigKeyMsg, uid, roles, exp))
}

// GET /internal/verify: nginx auth_request for every /api/v1 and /socket.io request (no body; the original
// method arrives in X-Original-Method). Always 200 for "not signed in" (the API decides what guests may do),
// 403 when a signed-in write lacks the CSRF token, signed X-User-* headers when signed in.
func (s *server) handleVerify(w http.ResponseWriter, r *http.Request) {
	method := r.Header.Get("X-Original-Method")
	if method == "" {
		method = "GET"
	}
	c, status := s.callerOf(r.Context(), r, method)
	switch status {
	case 200:
		s.signHeaders(w.Header(), c.ID, strings.Join(c.Roles, ","))
		w.WriteHeader(200)
	case 403:
		w.WriteHeader(403)
	case 500:
		w.WriteHeader(500)
	default:
		w.WriteHeader(200) // guest
	}
}

// Service-to-service calls carry X-Internal-Auth: "<exp>.<hmac(key, 'internal|'+exp)>", key = the receiver's INTERNAL_KEY_*.
func internalAuth(key []byte, now time.Time) string {
	exp := strconv.FormatInt(now.Add(headerTTL).Unix(), 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return exp + "." + hex.EncodeToString(m.Sum(nil))
}

func internalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}

func (s *server) internal(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK(s.cfg.InternalKey, r.Header.Get("X-Internal-Auth"), s.now()) {
			fail(w, 401, "unauthorized")
			return
		}
		h(w, r)
	}
}

// GET /internal/users/{id}: the public snapshot (same as identity.user.* event data) for the backend's
// read-through when an event has not arrived yet.
func (s *server) handleInternalUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "not found")
		return
	}
	var data []byte
	err := s.db.QueryRow(r.Context(), `SELECT `+userSnapshotSQL+` FROM users WHERE id = $1`, id).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not found")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true,"data":`))
	w.Write(data)
	w.Write([]byte(`}`))
}

// POST /internal/users/{id}/roles {role}: the backend grants a publishing badge (author on a first own story,
// translator on a first group story). Grant only, idempotent; revoking stays an admin action with a password.
func (s *server) handleInternalGrant(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		Role string `json:"role"`
	}
	if !isUUID(id) || readJSON(w, r, &b) != nil || (b.Role != "author" && b.Role != "translator") {
		fail(w, 400, "invalid")
		return
	}
	ctx := r.Context()
	granted := false
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) SELECT id, $2 FROM users WHERE id = $1 AND deleted_at IS NULL
			ON CONFLICT DO NOTHING`, id, b.Role)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		granted = true
		return userEvent(ctx, tx, id, "updated", nil)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	if granted {
		s.forgetRoles(ctx, id)
	}
	ok(w, "", map[string]any{"granted": granted})
}
