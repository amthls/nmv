// Package legacy is the one-time copy of the backend's old tables (`library import-legacy`).
package legacy

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/logger"
)

// Import copies follows, bookmarks, reading history, albums and user follows from the backend's database
// (novel_platform) into library_db, keeping ids and AL- codes. Runs once (legacy_imports): what people delete here
// later must not come back from the old tables. The story/chapter copies come right after through syncOnce.
//
//	docker compose run --rm -e LEGACY_DATABASE_URL=... library import-legacy
func Import(ctx context.Context, db *pgxpool.Pool, legacyURL string) error {
	if legacyURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL is required")
	}
	var done bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'all')`).Scan(&done); err != nil || done {
		if done {
			logger.Info(ctx, "import-legacy: already imported")
		}
		return err
	}
	old, err := pgx.Connect(ctx, legacyURL)
	if err != nil {
		return err
	}
	defer old.Close(ctx)
	var exists bool
	if err := old.QueryRow(ctx, `SELECT to_regclass('reading_history') IS NOT NULL`).Scan(&exists); err != nil {
		return err
	}

	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if exists {
			for _, p := range parts {
				rows, err := old.Query(ctx, p.read)
				if err != nil {
					return fmt.Errorf("%s: %w", p.name, err)
				}
				all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) ([]any, error) { return r.Values() })
				if err != nil {
					return fmt.Errorf("%s: %w", p.name, err)
				}
				var added int64
				for _, v := range all {
					tag, err := tx.Exec(ctx, p.write, v...)
					if err != nil {
						return fmt.Errorf("%s: %w", p.name, err)
					}
					added += tag.RowsAffected()
				}
				logger.Info(ctx, fmt.Sprintf("import-legacy: %s %d/%d", p.name, added, len(all)))
			}
			// new album codes continue after the old ones
			if _, err := tx.Exec(ctx, `SELECT setval('albums_code_seq', COALESCE((SELECT max(code_no) FROM albums), 0) + 1, false)`); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `INSERT INTO legacy_imports (part) VALUES ('all')`)
		return err
	})
	return err
}
