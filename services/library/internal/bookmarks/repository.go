package bookmarks

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/db"
)

// Repository is the SQL of line bookmarks.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

func (r *Repository) list(ctx context.Context, me, chapter, story string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `
		SELECT b.id, b.user_id, b.story_id, b.chapter_id, b.line_text, b.line_index, b.scroll_position, b.page_number, b.note, b.color,
		  b.created_at, s.title AS story_title, s.slug AS story_slug, s.cover_image_url, c.title AS chapter_title, c.slug AS chapter_slug,
		  c.chapter_number
		FROM bookmarks b
		JOIN ext_stories s ON b.story_id = s.id
		JOIN ext_chapters c ON b.chapter_id = c.id
		WHERE b.user_id = $1 AND ($2 = '' OR b.chapter_id::text = $2) AND ($3 = '' OR b.story_id::text = $3)
		ORDER BY b.created_at DESC`, me, chapter, story)
}

func (r *Repository) chapterInStory(ctx context.Context, chapter, story string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ext_chapters WHERE id = $1 AND story_id = $2)`, chapter, story).Scan(&exists)
	return exists, err
}

// removeLine deletes the person's bookmark of that line; returns whether there was one.
func (r *Repository) removeLine(ctx context.Context, me, chapter string, line int) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM bookmarks WHERE id = (
			SELECT id FROM bookmarks WHERE user_id = $1 AND chapter_id = $2 AND line_index = $3 LIMIT 1)`, me, chapter, line)
	return tag.RowsAffected() > 0, err
}

func (r *Repository) insert(ctx context.Context, me string, b createRequest, scroll float64, page int, color string) (map[string]any, error) {
	return db.One(ctx, r.db, `INSERT INTO bookmarks (user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
		me, b.StoryID, b.ChapterID, b.LineText, b.LineIndex, scroll, page, b.Note, color)
}

// remove deletes one bookmark of the person; returns whether it existed.
func (r *Repository) remove(ctx context.Context, id, me string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, id, me)
	return tag.RowsAffected() > 0, err
}
