package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrate applies migrations/*.sql not yet recorded in schema_migrations, all in one transaction under a
// transaction-scoped advisory lock (two copies starting together don't race; works through PgBouncer too).
func migrate(ctx context.Context, db *pgxpool.Pool) error {
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)

	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('workspace_migrate'))`); err != nil {
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
			sql, _ := migrationFiles.ReadFile("migrations/" + name)
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
				return err
			}
			logInfo(ctx, "applied migration "+name)
		}
		return rehashOnce(ctx, tx)
	})
}

// rehashOnce moves blocks stored before canonicalBlock dropped redundant "<p>text</p>" html to their canonical
// hash, in every revision and draft (the old block rows stay: unreferenced, harmless). Recorded like a migration.
func rehashOnce(ctx context.Context, tx pgx.Tx) error {
	const name = "go:canonical_block_hash"
	var done bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&done); err != nil || done {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT hash, data::text FROM content_blocks WHERE data ? 'html'`)
	if err != nil {
		return err
	}
	type move struct{ old, new string }
	var moves []move
	var blocks []block
	for rows.Next() {
		var h, d string
		var b block
		if err := rows.Scan(&h, &d); err != nil {
			return err
		}
		if err := json.Unmarshal([]byte(d), &b); err != nil {
			return err
		}
		if nh, _, err := blockHash(b); err == nil && nh != h {
			moves = append(moves, move{h, nh})
			blocks = append(blocks, b)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := storeBlocks(ctx, tx, blocks); err != nil {
		return err
	}
	for _, m := range moves {
		for _, table := range []string{"chapter_revisions", "chapter_drafts"} {
			if _, err := tx.Exec(ctx, `UPDATE `+table+` SET blocks = array_replace(blocks, $1, $2) WHERE $1 = ANY(blocks)`, m.old, m.new); err != nil {
				return err
			}
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name)
	logInfo(ctx, fmt.Sprintf("canonical block hashes: %d blocks moved", len(moves)))
	return err
}
