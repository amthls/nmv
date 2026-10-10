package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// importLegacy copies accounts from the old backend database (novel_platform) into identity_db, keeping UUIDs and
// bcrypt hashes (upgraded to argon2id at each user's next login). Only adds what is missing, so it can be re-run
// safely but never overwrites a change made in identity after the switch. Run once at cut-over:
//
//	docker compose run --rm -e LEGACY_DATABASE_URL=... identity import-legacy
func importLegacy(ctx context.Context, db *pgxpool.Pool, legacyURL string) error {
	if legacyURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL is required")
	}
	old, err := pgx.Connect(ctx, legacyURL)
	if err != nil {
		return err
	}
	defer old.Close(ctx)

	rows, err := old.Query(ctx, `SELECT id, username, email, password_hash, display_name, COALESCE(email_verified, false),
		COALESCE(is_banned, false), ban_reason, banned_at, banned_by, deleted_at, deleted_by, last_login_at, created_at, COALESCE(updated_at, created_at)
		FROM users ORDER BY created_at`)
	if err != nil {
		return err
	}
	users, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) ([]any, error) { return r.Values() })
	if err != nil {
		return err
	}
	rows, err = old.Query(ctx, `SELECT user_id, role::text, COALESCE(is_visible, true), granted_by, COALESCE(granted_at, NOW()) FROM user_roles`)
	if err != nil {
		return err
	}
	roles, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) ([]any, error) { return r.Values() })
	if err != nil {
		return err
	}
	// Unused, unexpired reset/verify links keep working across the switch
	rows, err = old.Query(ctx, `SELECT token_hash, user_id, purpose, expires_at, created_at FROM auth_tokens WHERE used_at IS NULL AND expires_at > NOW()`)
	if err != nil {
		return err
	}
	tokens, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) ([]any, error) { return r.Values() })
	if err != nil {
		return err
	}

	var addedUsers, addedRoles, addedTokens int64
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		for _, u := range users {
			tag, err := tx.Exec(ctx, `INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_banned, ban_reason,
				banned_at, banned_by, deleted_at, deleted_by, last_login_at, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`, u...)
			if err != nil {
				return fmt.Errorf("user %v: %w", u[1], err)
			}
			addedUsers += tag.RowsAffected()
		}
		for _, r := range roles {
			tag, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role, is_visible, granted_by, granted_at) VALUES ($1,$2,$3,$4,$5)
				ON CONFLICT DO NOTHING`, r...)
			if err != nil {
				return err
			}
			addedRoles += tag.RowsAffected()
		}
		for _, t := range tokens {
			tag, err := tx.Exec(ctx, `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)
				ON CONFLICT DO NOTHING`, t...)
			if err != nil {
				return err
			}
			addedTokens += tag.RowsAffected()
		}
		return nil
	})
	if err != nil {
		return err
	}
	logInfo(ctx, fmt.Sprintf("import-legacy: %d/%d users, %d/%d roles, %d/%d account tokens added",
		addedUsers, len(users), addedRoles, len(roles), addedTokens, len(tokens)))
	return nil
}
