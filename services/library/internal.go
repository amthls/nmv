package main

import (
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// Other services' calls (X-Internal-Auth with INTERNAL_KEY_LIBRARY): the backend (profile, story page, AL- codes, deleted
// stories/chapters, recommendations) and messaging (who follows a story).

// POST /internal/purge {story_ids?, chapter_ids?}: the backend deleted these. Their reading history, bookmarks, follows and
// album places go too (the old foreign keys' ON DELETE CASCADE), and the copies.
func (s *server) handlePurge(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Stories  []string `json:"story_ids"`
		Chapters []string `json:"chapter_ids"`
	}
	if err := readJSON(w, r, &b); err != nil {
		return err
	}
	for _, id := range append(append([]string{}, b.Stories...), b.Chapters...) {
		if !isUUID(id) {
			return bad("ids")
		}
	}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		both := []any{b.Stories, b.Chapters}
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
			if _, err := tx.Exec(r.Context(), q.sql, q.args...); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	ok(w, nil)
	return nil
}

// GET /internal/users/{id}/overview: the account page's library part (numbers, last reads, albums, genres read most).
func (s *server) handleUserOverview(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return notFound("no such user")
	}
	ctx := r.Context()
	stats, err := s.one(ctx, `SELECT
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
	if err != nil {
		return err
	}
	recent, err := s.maps(ctx, nil, `SELECT * FROM (
		  SELECT DISTINCT ON (rh.story_id)
		    s.id AS story_id, s.title, s.slug, s.cover_image_url, s.story_type, s.total_chapters,
		    c.title AS chapter_title, c.slug AS chapter_slug, c.chapter_number, rh.read_at
		  FROM reading_history rh JOIN ext_stories s ON s.id = rh.story_id JOIN ext_chapters c ON c.id = rh.chapter_id
		  WHERE rh.user_id = $1 ORDER BY rh.story_id, rh.read_at DESC
		) t ORDER BY read_at DESC LIMIT 6`, id)
	if err != nil {
		return err
	}
	albums, err := s.maps(ctx, nil, `SELECT a.id, a.name, a.is_public, a.share_token, a.updated_at,
		  (SELECT count(*)::int FROM album_stories x WHERE x.album_id = a.id) AS story_count,
		  (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
		  COALESCE((SELECT json_agg(p) FROM (
		    SELECT s.id, s.cover_image_url, s.title FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
		    WHERE x.album_id = a.id ORDER BY x.added_at DESC LIMIT 4) p), '[]'::json) AS preview
		FROM albums a WHERE a.user_id = $1 ORDER BY a.updated_at DESC LIMIT 6`, id)
	if err != nil {
		return err
	}
	tags, err := s.maps(ctx, nil, `SELECT t->>'name' AS name, t->>'slug' AS slug, count(DISTINCT rh.story_id)::int AS n
		FROM reading_history rh JOIN ext_stories s ON s.id = rh.story_id, jsonb_array_elements(s.tags) t
		WHERE rh.user_id = $1 GROUP BY 1, 2 ORDER BY n DESC, 1 LIMIT 8`, id)
	if err != nil {
		return err
	}
	ok(w, map[string]any{"stats": stats, "recent_reads": recent, "albums": albums, "tags": tags})
	return nil
}

// GET /internal/favorites/{user}/{story} -> {is_favorite, category} (the story page).
func (s *server) handleInternalFavorite(w http.ResponseWriter, r *http.Request) error {
	var category *string
	err := s.db.QueryRow(r.Context(), `SELECT category FROM user_favorites WHERE user_id = $1 AND story_id = $2`,
		r.PathValue("user"), r.PathValue("story")).Scan(&category)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	ok(w, map[string]any{"is_favorite": err == nil, "category": category})
	return nil
}

// GET /internal/codes/album/{no}?me= -> {path} of an AL- code: private albums only for their owner (a code carries no key).
func (s *server) handleAlbumCode(w http.ResponseWriter, r *http.Request) error {
	no, err := strconv.ParseInt(r.PathValue("no"), 10, 64)
	if err != nil {
		return notFound("no such album")
	}
	var path string
	err = s.db.QueryRow(r.Context(), `SELECT '/album/' || id FROM albums WHERE code_no = $1 AND (is_public OR user_id::text = $2)`,
		no, r.URL.Query().Get("me")).Scan(&path)
	if err == pgx.ErrNoRows {
		return notFound("no such album")
	}
	if err != nil {
		return err
	}
	ok(w, map[string]any{"path": path})
	return nil
}

// GET /internal/stories/{id}/followers?after=&limit=<=1000 -> [user_id] by id: who wants new-chapter notifications (messaging).
func (s *server) handleFollowers(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return notFound("no such story")
	}
	after := r.URL.Query().Get("after")
	if !isUUID(after) {
		after = "00000000-0000-0000-0000-000000000000"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	rows, err := s.db.Query(r.Context(), `SELECT user_id::text FROM user_favorites
		WHERE story_id = $1 AND user_id > $2 AND notify_updates IS NOT FALSE ORDER BY user_id LIMIT $3`, id, after, limit)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	ok(w, ids)
	return nil
}

// GET /internal/reco/export?days=: what the backend's recommender trains on (it used to SELECT these tables itself).
// shortcut: one big answer; at stage H the recommender reads chapter.read / story.followed events instead.
func (s *server) handleRecoExport(w http.ResponseWriter, r *http.Request) error {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days < 1 || days > 3650 {
		days = 180
	}
	ctx := r.Context()
	out := map[string]any{}
	for key, q := range map[string]string{
		"reads": `SELECT user_id, story_id, count(*)::int AS n, COALESCE(sum(time_spent_seconds), 0)::int AS secs, max(read_at) AS last
			FROM reading_history WHERE read_at > NOW() - make_interval(days => $1) GROUP BY 1, 2`,
		"favorites": `SELECT user_id, story_id, created_at FROM user_favorites WHERE $1 > 0`,
		"albums": `SELECT DISTINCT ON (a.user_id, x.story_id) a.user_id, x.story_id, x.added_at
			FROM album_stories x JOIN albums a ON a.id = x.album_id WHERE $1 > 0`,
		"bookmarks": `SELECT user_id, story_id, count(*)::int AS n, max(created_at) AS last FROM bookmarks WHERE $1 > 0 GROUP BY 1, 2`,
		"timeline":  `SELECT user_id, story_id, read_at AS t FROM reading_history WHERE read_at > NOW() - make_interval(days => $1)`,
	} {
		rows, err := s.maps(ctx, nil, q, days)
		if err != nil {
			return err
		}
		out[key] = rows
	}
	ok(w, out)
	return nil
}

// GET /internal/reco/user/{id}: one reader's history for the recommender's live picks: every story read, reads of the
// last 60 days, and stories started but not finished ("continue reading").
func (s *server) handleRecoUser(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return notFound("no such user")
	}
	ctx := r.Context()
	rows, err := s.db.Query(ctx, `SELECT DISTINCT story_id::text FROM reading_history WHERE user_id = $1`, id)
	if err != nil {
		return err
	}
	read, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	recent, err := s.maps(ctx, nil, `SELECT story_id, read_at AS t FROM reading_history
		WHERE user_id = $1 AND read_at > NOW() - INTERVAL '60 days'`, id)
	if err != nil {
		return err
	}
	cont, err := s.maps(ctx, nil, `SELECT * FROM (
		  SELECT DISTINCT ON (rh.story_id) rh.story_id, c.chapter_number, c.slug AS chapter_slug, rh.read_at,
		    (SELECT max(c2.chapter_number) FROM ext_chapters c2 WHERE c2.story_id = rh.story_id AND c2.is_published) AS last_number,
		    (SELECT count(*) FROM reading_history r2 WHERE r2.user_id = rh.user_id AND r2.story_id = rh.story_id)::int AS chapters_read
		  FROM reading_history rh JOIN ext_chapters c ON c.id = rh.chapter_id
		  WHERE rh.user_id = $1 ORDER BY rh.story_id, c.chapter_number DESC
		) t WHERE t.chapter_number < t.last_number ORDER BY t.read_at DESC`, id)
	if err != nil {
		return err
	}
	ok(w, map[string]any{"read_story_ids": read, "recent": recent, "continue": cont})
	return nil
}
