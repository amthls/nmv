// Package db applies the schema (migrations) and reads rows the way node-pg gave the old backend handlers.
package db

import (
	"context"
	"fmt"
	"math/big"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/logger"
	"nmv/library/migrations"
)

// Migrate applies migrations/*.sql not yet recorded in schema_migrations, all in one transaction under a
// transaction-scoped advisory lock (two copies starting together don't race). Same as the other Go services.
func Migrate(ctx context.Context, db *pgxpool.Pool) error {
	entries, err := migrations.FS.ReadDir(".")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('library_migrate'))`); err != nil {
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

// RowMaps reads every row as {column: value}, the shape node-pg gave the old backend handlers (uuid as text,
// numeric as a number, json decoded), so the moved SQL keeps its JSON.
func RowMaps(rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(vals))
		for i, v := range vals {
			m[fields[i].Name] = jsonValue(v)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func jsonValue(v any) any {
	switch x := v.(type) {
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case pgtype.Numeric:
		f, err := x.Float64Value()
		if err != nil || !f.Valid {
			return nil
		}
		return f.Float64
	case *big.Int:
		return x.String()
	case []any:
		for i := range x {
			x[i] = jsonValue(x[i])
		}
	}
	return v
}

// Maps runs a query (inside tx when given) and returns its rows as maps.
func Maps(ctx context.Context, pool *pgxpool.Pool, tx pgx.Tx, sql string, args ...any) ([]map[string]any, error) {
	if tx != nil {
		return RowMaps(tx.Query(ctx, sql, args...))
	}
	return RowMaps(pool.Query(ctx, sql, args...))
}

// One runs a query and returns its first row as a map (nil when there is none).
func One(ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) (map[string]any, error) {
	rows, err := RowMaps(pool.Query(ctx, sql, args...))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}
