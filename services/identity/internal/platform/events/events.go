// Package events: the identity.user.* and identity.alert events (what they carry, how they are queued).
package events

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/platform/outbox"
)

// UserSnapshotSQL: the public view of a user published in events and served to the backend (no email, no hash).
const UserSnapshotSQL = `json_build_object(
	'id', id, 'version', version, 'username', username::text, 'display_name', display_name,
	'email_verified', email_verified, 'is_banned', is_banned, 'ban_reason', ban_reason, 'banned_at', banned_at,
	'banned_by', banned_by, 'deleted_at', deleted_at, 'deleted_by', deleted_by, 'created_at', created_at,
	'roles', COALESCE((SELECT json_agg(json_build_object('role', role, 'is_visible', is_visible) ORDER BY role)
	                   FROM user_roles WHERE user_id = users.id), '[]'))`

// UserEvent bumps the user's version and queues identity.user.<kind> with the public snapshot (never the email).
func UserEvent(ctx context.Context, tx pgx.Tx, uid, kind string, extra map[string]any) error {
	var data map[string]any
	err := tx.QueryRow(ctx, `UPDATE users SET version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING `+UserSnapshotSQL, uid).Scan(&data)
	if err != nil {
		return fmt.Errorf("user snapshot: %w", err)
	}
	for k, v := range extra {
		data[k] = v
	}
	return outbox.Enqueue(ctx, tx, "identity.user."+kind, data["version"], data)
}

// Alert asks the backend to notify every admin (the site has no external alerting). key dedupes per hour.
func Alert(ctx context.Context, db *pgxpool.Pool, key, title, message string) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		return outbox.Enqueue(ctx, tx, "identity.alert", 1, map[string]any{
			"key": key + ":" + time.Now().UTC().Format("2006-01-02T15"), "title": title, "message": message,
		})
	})
}

// Republish queues identity.user.* with the current snapshot of one user (uid) or all of them, without bumping the
// version: a copy that is missing or behind applies it, an up-to-date one skips it. Rebuilds a lost or drifted copy.
func Republish(ctx context.Context, db *pgxpool.Pool, uid string) error {
	rows, err := db.Query(ctx, `SELECT `+UserSnapshotSQL+` FROM users WHERE $1 = '' OR id::text = $1 ORDER BY created_at`, uid)
	if err != nil {
		return err
	}
	snaps, err := pgx.CollectRows(rows, pgx.RowTo[map[string]any])
	if err != nil {
		return err
	}
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		for _, d := range snaps {
			kind := "updated"
			if d["deleted_at"] != nil {
				kind = "deleted"
			}
			if err := outbox.Enqueue(ctx, tx, "identity.user."+kind, d["version"], d); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		logger.Info(ctx, fmt.Sprintf("republish: %d user events queued", len(snaps)))
	}
	return err
}
