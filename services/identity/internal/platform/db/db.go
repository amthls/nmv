// Package db applies the schema (migrations).
package db

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/identity/internal/platform/logger"
	"nmv/identity/migrations"
)

// Migrate applies migrations/*.sql not yet recorded in schema_migrations, all in one transaction under a
// transaction-scoped advisory lock (two copies starting together don't race; works through PgBouncer too).
func Migrate(ctx context.Context, db *pgxpool.Pool) error {
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('identity_migrate'))`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`); err != nil {
			return err
		}
		for _, name := range names {
			var done bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&done); err != nil {
				return err
			}
			if done {
				continue
			}
			sql, _ := migrations.FS.ReadFile(name)
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
				return err
			}
			logger.Info(ctx, "applied migration "+name)
		}
		return nil
	})
}

// ErrRollback aborts a transaction on purpose (the handler already knows what to answer).
var ErrRollback = errors.New("rollback")
