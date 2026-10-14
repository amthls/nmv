package history

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/db"
)

// Repository is the SQL of reading history. Stories and chapters come from the ext_ copies.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

// latestPerStory: one row per story (its latest chapter read), newest first.
func (r *Repository) latestPerStory(ctx context.Context, me string, limit int) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `
		SELECT * FROM (
		  SELECT DISTINCT ON (rh.story_id)
		    rh.id, rh.user_id, rh.story_id, rh.chapter_id, rh.scroll_position, rh.page_number, rh.read_at, rh.time_spent_seconds,
		    s.title AS story_title, s.slug AS story_slug, s.cover_image_url AS story_cover, s.author_name AS story_author,
		    s.story_type, s.total_chapters, c.title AS chapter_title, c.slug AS chapter_slug, c.chapter_number, s.group_name
		  FROM reading_history rh
		  JOIN ext_stories s ON rh.story_id = s.id
		  JOIN ext_chapters c ON rh.chapter_id = c.id
		  WHERE rh.user_id = $1
		  ORDER BY rh.story_id, rh.read_at DESC
		) latest_per_story
		ORDER BY read_at DESC
		LIMIT $2`, me, limit)
}

// storyOfChapter: the published chapter's story, from the copy; pgx.ErrNoRows when it is not there.
func (r *Repository) storyOfChapter(ctx context.Context, chapterID string) (string, error) {
	var story string
	err := r.db.QueryRow(ctx, `SELECT story_id::text FROM ext_chapters WHERE id = $1 AND is_published`, chapterID).Scan(&story)
	return story, err
}

// touch: the backend saw this person open the chapter: keep the row, reset its position.
func (r *Repository) touch(ctx context.Context, user, story, chapter string) error {
	_, err := r.db.Exec(ctx, `INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		VALUES ($1, $2, $3, 0, 1, NOW(), 0)
		ON CONFLICT (user_id, chapter_id) DO UPDATE SET scroll_position = 0, page_number = 1, story_id = EXCLUDED.story_id, read_at = NOW()`,
		user, story, chapter)
	return err
}

// deleteRows removes one row, or (a story id) every row of that story; returns how many went.
func (r *Repository) deleteRows(ctx context.Context, id, me string) (int64, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM reading_history WHERE (id = $1 OR story_id = $1) AND user_id = $2`, id, me)
	return tag.RowsAffected(), err
}

func (r *Repository) clear(ctx context.Context, me string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM reading_history WHERE user_id = $1`, me)
	return err
}

// writePositions upserts the buffered positions (a JSON array) in one statement.
func (r *Repository) writePositions(ctx context.Context, body string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		SELECT x.user_id, x.story_id, x.chapter_id, x.scroll_position, x.page_number, x.read_at, x.time_spent_seconds
		FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid, story_id uuid, chapter_id uuid, scroll_position real, page_number int,
		  read_at timestamptz, time_spent_seconds int)
		JOIN ext_chapters c ON c.id = x.chapter_id -- deleted meanwhile: dropped
		ON CONFLICT (user_id, chapter_id) DO UPDATE
		SET scroll_position = EXCLUDED.scroll_position, page_number = EXCLUDED.page_number, story_id = EXCLUDED.story_id,
		    read_at = GREATEST(reading_history.read_at, EXCLUDED.read_at),
		    time_spent_seconds = reading_history.time_spent_seconds + EXCLUDED.time_spent_seconds`, body)
	return err
}

// merge writes a signed-out visitor's reads (a JSON array); returns how many rows changed.
func (r *Repository) merge(ctx context.Context, me, items string) (int64, error) {
	tag, err := r.db.Exec(ctx, `
			INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
			SELECT $1::uuid, c.story_id, c.id, x.scroll_position, 1, x.read_at, 0
			FROM jsonb_to_recordset($2::jsonb) AS x(chapter_id uuid, read_at timestamptz, scroll_position real)
			JOIN ext_chapters c ON c.id = x.chapter_id AND c.is_published
			ON CONFLICT (user_id, chapter_id) DO UPDATE
			SET scroll_position = EXCLUDED.scroll_position, read_at = EXCLUDED.read_at
			WHERE reading_history.read_at < EXCLUDED.read_at`, me, items)
	return tag.RowsAffected(), err
}

// prune keeps the history of each person's 1,000 most recently read stories; returns how many rows went.
func (r *Repository) prune(ctx context.Context) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM reading_history h USING (
		  SELECT user_id, story_id FROM (
		    SELECT user_id, story_id, row_number() OVER (PARTITION BY user_id ORDER BY max(read_at) DESC) AS n
		    FROM reading_history GROUP BY user_id, story_id) ranked
		  WHERE n > 1000) old
		WHERE h.user_id = old.user_id AND h.story_id = old.story_id`)
	return tag.RowsAffected(), err
}
