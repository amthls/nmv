package internalapi

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/db"
)

// Repository is the SQL of the calls other services make.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

// purge deletes everything that points at the removed stories and chapters, in one transaction.
func (r *Repository) purge(ctx context.Context, stories, chapters []string) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		both := []any{stories, chapters}
		for _, q := range []struct {
			sql  string
			args []any
		}{
			{`DELETE FROM reading_history WHERE story_id = ANY($1::uuid[]) OR chapter_id = ANY($2::uuid[])`, both},
			{`DELETE FROM bookmarks WHERE story_id = ANY($1::uuid[]) OR chapter_id = ANY($2::uuid[])`, both},
			{`DELETE FROM user_favorites WHERE story_id = ANY($1::uuid[])`, both[:1]},
			{`DELETE FROM album_stories WHERE story_id = ANY($1::uuid[])`, both[:1]},
			{`DELETE FROM ext_chapters WHERE story_id = ANY($1::uuid[]) OR id = ANY($2::uuid[])`, both},
			{`DELETE FROM ext_stories WHERE id = ANY($1::uuid[])`, both[:1]},
		} {
			if _, err := tx.Exec(ctx, q.sql, q.args...); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) overviewStats(ctx context.Context, id string) (map[string]any, error) {
	return db.One(ctx, r.db, `SELECT
		  (SELECT count(DISTINCT story_id) FROM reading_history WHERE user_id = $1)::int AS stories_read,
		  (SELECT count(*) FROM reading_history WHERE user_id = $1)::int AS chapters_read,
		  (SELECT COALESCE(sum(time_spent_seconds), 0) FROM reading_history WHERE user_id = $1)::bigint AS reading_seconds,
		  (SELECT count(*) FROM user_favorites WHERE user_id = $1)::int AS favorites,
		  (SELECT count(*) FROM bookmarks WHERE user_id = $1)::int AS bookmarks,
		  (SELECT count(*) FROM albums WHERE user_id = $1)::int AS albums,
		  (SELECT count(*) FROM album_saves WHERE user_id = $1)::int AS saved_albums,
		  (SELECT count(*) FROM album_saves sv JOIN albums a ON a.id = sv.album_id WHERE a.user_id = $1)::int AS album_saves_received,
		  (SELECT count(*) FROM user_follows WHERE following_id = $1)::int AS followers,
		  (SELECT count(*) FROM user_follows WHERE follower_id = $1)::int AS following`, id)
}

func (r *Repository) overviewRecent(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT * FROM (
		  SELECT DISTINCT ON (rh.story_id)
		    s.id AS story_id, s.title, s.slug, s.cover_image_url, s.story_type, s.total_chapters,
		    c.title AS chapter_title, c.slug AS chapter_slug, c.chapter_number, rh.read_at
		  FROM reading_history rh JOIN ext_stories s ON s.id = rh.story_id JOIN ext_chapters c ON c.id = rh.chapter_id
		  WHERE rh.user_id = $1 ORDER BY rh.story_id, rh.read_at DESC
		) t ORDER BY read_at DESC LIMIT 6`, id)
}

func (r *Repository) overviewAlbums(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT a.id, a.name, a.is_public, a.share_token, a.updated_at,
		  (SELECT count(*)::int FROM album_stories x WHERE x.album_id = a.id) AS story_count,
		  (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
		  COALESCE((SELECT json_agg(p) FROM (
		    SELECT s.id, s.cover_image_url, s.title FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
		    WHERE x.album_id = a.id ORDER BY x.added_at DESC LIMIT 4) p), '[]'::json) AS preview
		FROM albums a WHERE a.user_id = $1 ORDER BY a.updated_at DESC LIMIT 6`, id)
}

func (r *Repository) overviewTags(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT t->>'name' AS name, t->>'slug' AS slug, count(DISTINCT rh.story_id)::int AS n
		FROM reading_history rh JOIN ext_stories s ON s.id = rh.story_id, jsonb_array_elements(s.tags) t
		WHERE rh.user_id = $1 GROUP BY 1, 2 ORDER BY n DESC, 1 LIMIT 8`, id)
}

// favorite returns the category of the follow; found = false when the person does not follow the story.
func (r *Repository) favorite(ctx context.Context, user, story string) (category *string, found bool, err error) {
	err = r.db.QueryRow(ctx, `SELECT category FROM user_favorites WHERE user_id = $1 AND story_id = $2`, user, story).Scan(&category)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	return category, err == nil, nil
}

// albumPath returns the path of an AL- code's album; pgx.ErrNoRows when private to someone else or unknown.
func (r *Repository) albumPath(ctx context.Context, no int64, me string) (string, error) {
	var path string
	err := r.db.QueryRow(ctx, `SELECT '/album/' || id FROM albums WHERE code_no = $1 AND (is_public OR user_id::text = $2)`, no, me).Scan(&path)
	return path, err
}

func (r *Repository) followers(ctx context.Context, story, after string, limit int) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT user_id::text FROM user_favorites
		WHERE story_id = $1 AND user_id > $2 AND notify_updates IS NOT FALSE ORDER BY user_id LIMIT $3`, story, after, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (r *Repository) recoExport(ctx context.Context, key, sql string, days int) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, sql, days)
}

func (r *Repository) recoReadStories(ctx context.Context, id string) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT story_id::text FROM reading_history WHERE user_id = $1`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (r *Repository) recoRecent(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT story_id, read_at AS t FROM reading_history
		WHERE user_id = $1 AND read_at > NOW() - INTERVAL '60 days'`, id)
}

func (r *Repository) recoContinue(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT * FROM (
		  SELECT DISTINCT ON (rh.story_id) rh.story_id, c.chapter_number, c.slug AS chapter_slug, rh.read_at,
		    (SELECT max(c2.chapter_number) FROM ext_chapters c2 WHERE c2.story_id = rh.story_id AND c2.is_published) AS last_number,
		    (SELECT count(*) FROM reading_history r2 WHERE r2.user_id = rh.user_id AND r2.story_id = rh.story_id)::int AS chapters_read
		  FROM reading_history rh JOIN ext_chapters c ON c.id = rh.chapter_id
		  WHERE rh.user_id = $1 ORDER BY rh.story_id, c.chapter_number DESC
		) t WHERE t.chapter_number < t.last_number ORDER BY t.read_at DESC`, id)
}
