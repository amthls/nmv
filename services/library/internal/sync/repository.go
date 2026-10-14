package sync

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the SQL of the copies and their cursors.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// upsertPage stores a page of rows outside a cursor move.
func (r *Repository) upsertPage(ctx context.Context, t table, body string) error {
	_, err := r.db.Exec(ctx, t.upsert, body)
	return err
}

// cursor returns where the table's sync stopped (the epoch when it never ran).
func (r *Repository) cursor(ctx context.Context, name string) (since, after string, err error) {
	err = r.db.QueryRow(ctx, `SELECT last_ts::text, last_id::text FROM sync_state WHERE name = $1`, name).Scan(&since, &after)
	if errors.Is(err, pgx.ErrNoRows) {
		return "1970-01-01T00:00:00Z", "00000000-0000-0000-0000-000000000000", nil
	}
	return since, after, err
}

// savePage upserts a page and moves the cursor in one transaction.
func (r *Repository) savePage(ctx context.Context, t table, body, lastTS, lastID string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, t.upsert, body); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO sync_state (name, last_ts, last_id) VALUES ($1, $2::timestamptz, $3)
					ON CONFLICT (name) DO UPDATE SET last_ts = EXCLUDED.last_ts, last_id = EXCLUDED.last_id`, t.name, lastTS, lastID)
		return err
	})
}

// resetCursors restarts every table's sync from the beginning.
func (r *Repository) resetCursors(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `DELETE FROM sync_state`)
	return err
}

// dropMissing deletes the copies in table whose id is not in ids; returns how many went.
func (r *Repository) dropMissing(ctx context.Context, table string, ids []string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM `+table+` WHERE NOT (id = ANY($1::uuid[]))`, ids)
	return tag.RowsAffected(), err
}
