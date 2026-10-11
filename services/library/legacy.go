package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// importLegacy copies follows, bookmarks, reading history, albums and user follows from the backend's database
// (novel_platform) into library_db, keeping ids and AL- codes. Runs once (legacy_imports): what people delete here
// later must not come back from the old tables. The story/chapter copies come right after through syncOnce.
//
//	docker compose run --rm -e LEGACY_DATABASE_URL=... library import-legacy
func importLegacy(ctx context.Context, db *pgxpool.Pool, legacyURL string) error {
	if legacyURL == "" {
		return fmt.Errorf("LEGACY_DATABASE_URL is required")
	}
	var done bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM legacy_imports WHERE part = 'all')`).Scan(&done); err != nil || done {
		if done {
			logInfo(ctx, "import-legacy: already imported")
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

	// Each part: a SELECT on the old database and the INSERT its rows go through ($n in column order)
	parts := []struct{ name, read, write string }{
		{"follows", `SELECT id, user_id, story_id, category, notify_updates, created_at FROM user_favorites`,
			`INSERT INTO user_favorites (id, user_id, story_id, category, notify_updates, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`},
		{"bookmarks", `SELECT id, user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color, created_at FROM bookmarks`,
			`INSERT INTO bookmarks (id, user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`},
		{"history", `SELECT id, user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds FROM reading_history`,
			`INSERT INTO reading_history (id, user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`},
		// copied_from points at another album: insert them all first without it, then set it
		{"albums", `SELECT a.id, a.user_id, u.code_no, a.name, a.description, a.is_public, a.share_token, a.created_at, a.updated_at, a.code_no
			FROM albums a LEFT JOIN users u ON u.id = a.user_id`,
			`INSERT INTO albums (id, user_id, owner_code_no, name, description, is_public, share_token, created_at, updated_at, code_no)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`},
		{"album links", `SELECT id, copied_from FROM albums WHERE copied_from IS NOT NULL`,
			`UPDATE albums SET copied_from = $2 WHERE id = $1`},
		{"album stories", `SELECT album_id, story_id, added_at FROM album_stories`,
			`INSERT INTO album_stories (album_id, story_id, added_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`},
		{"album saves", `SELECT user_id, album_id, share_token, created_at FROM album_saves`,
			`INSERT INTO album_saves (user_id, album_id, share_token, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`},
		{"user follows", `SELECT id, follower_id, following_id, created_at FROM user_follows`,
			`INSERT INTO user_follows (id, follower_id, following_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`},
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
				logInfo(ctx, fmt.Sprintf("import-legacy: %s %d/%d", p.name, added, len(all)))
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
