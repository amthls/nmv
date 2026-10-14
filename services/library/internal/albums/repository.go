package albums

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/library/internal/platform/db"
)

// Repository is the SQL of albums.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wraps the pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{db: pool} }

// ownName returns the name of an album the user owns; pgx.ErrNoRows when it is not theirs.
func (r *Repository) ownName(ctx context.Context, albumID, me string) (name string, err error) {
	err = r.db.QueryRow(ctx, `SELECT name FROM albums WHERE id = $1 AND user_id = $2`, albumID, me).Scan(&name)
	return name, err
}

// viewableRow reads who owns an album and how it is shared; pgx.ErrNoRows when there is none.
func (r *Repository) viewableRow(ctx context.Context, albumID string) (viewable, error) {
	var v viewable
	err := r.db.QueryRow(ctx, `SELECT user_id::text, name, is_public, share_token FROM albums WHERE id = $1`, albumID).
		Scan(&v.ownerID, &v.name, &v.public, &v.shareToken)
	return v, err
}

func (r *Repository) count(ctx context.Context, me string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM albums WHERE user_id = $1`, me).Scan(&n)
	return n, err
}

func (r *Repository) mine(ctx context.Context, me, story string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT `+summaryColumns("")+`, a.share_token,
		  ($2 <> '' AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id::text = $2)) AS has_story
		FROM albums a WHERE a.user_id = $1 ORDER BY a.updated_at DESC`, me, story)
}

func (r *Repository) saved(ctx context.Context, me string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT `+summaryColumns("")+`, sv.created_at AS saved_at,
		  CASE WHEN a.is_public THEN NULL ELSE sv.share_token END AS share_key
		FROM album_saves sv JOIN albums a ON a.id = sv.album_id
		WHERE sv.user_id = $1 AND (a.is_public OR sv.share_token = a.share_token)
		ORDER BY sv.created_at DESC`, me)
}

func (r *Repository) mineWithStory(ctx context.Context, me, story string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT `+summaryColumns("$2")+`, a.share_token
			FROM albums a WHERE a.user_id = $1 AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $2)
			ORDER BY a.updated_at DESC`, me, story)
}

func (r *Repository) othersWithStory(ctx context.Context, story, me string, limit int) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT * FROM (
		  SELECT `+summaryColumns("$1")+`,
		    ($2 <> '' AND EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id::text = $2)) AS is_saved
		  FROM albums a
		  WHERE a.is_public AND a.user_id::text <> $2
		    AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $1)
		) t ORDER BY (t.story_count > 1) DESC, random() LIMIT $3`, story, me, limit)
}

func (r *Repository) page(ctx context.Context, id, me string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `SELECT `+summaryColumns("")+`, a.share_token,
		  ($2 <> '' AND EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id::text = $2)) AS is_saved,
		  src.name AS copied_from_name, src.is_public AS copied_from_public
		FROM albums a LEFT JOIN albums src ON src.id = a.copied_from WHERE a.id = $1`, id, me)
}

func (r *Repository) stories(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `
		SELECT s.id, s.title, s.slug, s.cover_image_url, s.author_name, s.story_type, s.status, s.total_chapters, s.total_views, x.added_at
		FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
		WHERE x.album_id = $1 AND s.approval_status = 'approved' ORDER BY x.added_at DESC`, id)
}

// create inserts an album (with its first story when given) in one transaction.
func (r *Repository) create(ctx context.Context, me string, codeNo *int64, name string, desc *string, public bool, story string) (map[string]any, error) {
	var album map[string]any
	err := pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		rows, err := db.Maps(ctx, r.db, tx, `INSERT INTO albums (user_id, owner_code_no, name, description, is_public)
			VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, is_public, share_token, created_at, updated_at`,
			me, codeNo, name, desc, public)
		if err != nil {
			return err
		}
		album = rows[0]
		if story != "" {
			_, err = tx.Exec(ctx, `INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2)`, album["id"], story)
		}
		return err
	})
	return album, err
}

func (r *Repository) update(ctx context.Context, id string, name *string, descSent bool, desc *string, public *bool) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `UPDATE albums SET name = COALESCE($2, name),
		  description = CASE WHEN $3::boolean THEN $4 ELSE description END, is_public = COALESCE($5, is_public), updated_at = NOW()
		WHERE id = $1 RETURNING id, name, description, is_public, share_token, updated_at`, id, name, descSent, desc, public)
}

func (r *Repository) setAllVisibility(ctx context.Context, me string, public bool) (int64, error) {
	tag, err := r.db.Exec(ctx, `UPDATE albums SET is_public = $2, updated_at = NOW() WHERE user_id = $1 AND is_public <> $2`, me, public)
	return tag.RowsAffected(), err
}

func (r *Repository) remove(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM albums WHERE id = $1`, id)
	return err
}

func (r *Repository) resetShareToken(ctx context.Context, id string) ([]map[string]any, error) {
	return db.Maps(ctx, r.db, nil, `UPDATE albums SET share_token = replace(gen_random_uuid()::text, '-', '') WHERE id = $1 RETURNING share_token`, id)
}

func (r *Repository) storyCount(ctx context.Context, id string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM album_stories WHERE album_id = $1`, id).Scan(&n)
	return n, err
}

func (r *Repository) storyExists(ctx context.Context, story string) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ext_stories WHERE id = $1)`, story).Scan(&exists)
	return exists, err
}

func (r *Repository) addStory(ctx context.Context, id, story string) error {
	_, err := r.db.Exec(ctx, `INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, story)
	return err
}

func (r *Repository) removeStory(ctx context.Context, id, story string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM album_stories WHERE album_id = $1 AND story_id = $2`, id, story)
	return err
}

func (r *Repository) touch(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `UPDATE albums SET updated_at = NOW() WHERE id = $1`, id)
	return err
}

// deleteSave removes the person's save; returns whether there was one.
func (r *Repository) deleteSave(ctx context.Context, me, id string) (bool, error) {
	tag, err := r.db.Exec(ctx, `DELETE FROM album_saves WHERE user_id = $1 AND album_id = $2`, me, id)
	return tag.RowsAffected() > 0, err
}

func (r *Repository) addSave(ctx context.Context, me, id string, token *string) error {
	_, err := r.db.Exec(ctx, `INSERT INTO album_saves (user_id, album_id, share_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		me, id, token)
	return err
}

// copyStories copies the approved stories of album id into target (a new album named newName when target.id is empty),
// up to the album limit, in one transaction. Returns the target and how many stories were added.
func (r *Repository) copyStories(ctx context.Context, me string, codeNo *int64, id, newName string, target copyTarget) (copyTarget, int64, error) {
	var added int64
	err := pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		if target.id == "" {
			if err := tx.QueryRow(ctx, `INSERT INTO albums (user_id, owner_code_no, name, description, copied_from)
				SELECT $1, $2, $3, description, id FROM albums WHERE id = $4 RETURNING id::text, name`,
				me, codeNo, newName, id).Scan(&target.id, &target.name); err != nil {
				return err
			}
		}
		var have int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM album_stories WHERE album_id = $1`, target.id).Scan(&have); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO album_stories (album_id, story_id)
			SELECT $1, x.story_id FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
			WHERE x.album_id = $2 AND s.approval_status = 'approved'
			  AND NOT EXISTS (SELECT 1 FROM album_stories y WHERE y.album_id = $1 AND y.story_id = x.story_id)
			ORDER BY x.added_at LIMIT $3
			ON CONFLICT DO NOTHING`, target.id, id, max(0, maxStoriesPerAlbum-have))
		if err != nil {
			return err
		}
		added = tag.RowsAffected()
		_, err = tx.Exec(ctx, `UPDATE albums SET updated_at = NOW() WHERE id = $1`, target.id)
		return err
	})
	return target, added, err
}
