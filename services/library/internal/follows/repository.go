package follows

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/db"
)

// Repository is the SQL of follows ("Tủ truyện", user_favorites).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

func (r *Repository) list(ctx context.Context, me, category string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `
		SELECT uf.id, uf.story_id, uf.category, uf.notify_updates, uf.created_at,
		  s.title, s.slug, s.cover_image_url, s.author_name, s.status, s.story_type, s.total_chapters, s.total_views, s.total_favorites,
		  lc.title AS latest_chapter_title, lc.slug AS latest_chapter_slug, lc.chapter_number AS latest_chapter_number
		FROM user_favorites uf
		JOIN ext_stories s ON uf.story_id = s.id
		LEFT JOIN LATERAL (
		  SELECT title, slug, chapter_number FROM ext_chapters WHERE story_id = s.id ORDER BY chapter_number DESC LIMIT 1
		) lc ON true
		WHERE uf.user_id = $1 AND ($2 = '' OR uf.category = $2)
		ORDER BY uf.created_at DESC`, me, category)
}

// find returns the follow row of a person and story; pgx.ErrNoRows when there is none.
func (r *Repository) find(ctx context.Context, me, story string) (id, category string, err error) {
	err = r.db.QueryRow(ctx, `SELECT id::text, COALESCE(category, '') FROM user_favorites WHERE user_id = $1 AND story_id = $2`,
		me, story).Scan(&id, &category)
	return id, category, err
}

func (r *Repository) setCategory(ctx context.Context, id, category string) error {
	_, err := r.db.Exec(ctx, `UPDATE user_favorites SET category = $1 WHERE id = $2`, category, id)
	return err
}

func (r *Repository) remove(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM user_favorites WHERE id = $1`, id)
	return err
}

func (r *Repository) storyExists(ctx context.Context, story string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ext_stories WHERE id = $1)`, story).Scan(&exists)
	return exists, err
}

func (r *Repository) add(ctx context.Context, me, story, category string, notify bool) error {
	_, err := r.db.Exec(ctx, `INSERT INTO user_favorites (user_id, story_id, category, notify_updates) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, story_id) DO NOTHING`, me, story, category, notify)
	return err
}

func (r *Repository) count(ctx context.Context, story string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM user_favorites WHERE story_id = $1`, story).Scan(&n)
	return n, err
}

// status returns whether me follows story, and the category.
func (r *Repository) status(ctx context.Context, me, story string) (category *string, found bool, err error) {
	err = r.db.QueryRow(ctx, `SELECT category FROM user_favorites WHERE user_id = $1 AND story_id = $2`, me, story).Scan(&category)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	return category, err == nil, nil
}

// applyDeleted records the event and, for a deleted account, drops its follows both ways, in one transaction.
func (r *Repository) applyDeleted(ctx context.Context, evt identityEvent, deleted bool) error {
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING`, evt.EventID, evt.Type)
		if err != nil || tag.RowsAffected() == 0 {
			return err // seen before: nothing to do
		}
		if deleted {
			_, err = tx.Exec(ctx, `DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1`, evt.Data.ID)
		}
		return err
	})
}
