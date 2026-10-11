package main

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// Reading history, follows, line bookmarks: moved from the backend's history.controller.ts, readingHistory.model.ts and
// bookmark.controller.ts with the same JSON. Stories/chapters come from the ext_ copies.

// clamp: a finite number within [min, max], else the fallback (bad client values must not reach SQL).
func clamp(v any, min, max, fallback float64) float64 {
	var n float64
	switch x := v.(type) {
	case float64:
		n = x
	case string:
		f, err := strconv.ParseFloat(x, 64)
		if err != nil {
			return fallback
		}
		n = f
	default:
		return fallback
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return fallback
	}
	return math.Min(math.Max(n, min), max)
}

// GET /history?limit=: one row per story (its latest chapter read), newest first.
func (s *server) handleHistory(w http.ResponseWriter, r *http.Request, me string) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 100
	}
	rows, err := s.maps(r.Context(), nil, `
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
		LIMIT $2`, me, min(limit, 200))
	if err != nil {
		return err
	}
	ok(w, rows)
	return nil
}

// chapterStory: the published chapter's story, from the copy (a chapter published seconds ago: sync first).
func (s *server) chapterStory(ctx context.Context, chapterID string) (string, error) {
	var story string
	for attempt := 0; attempt < 2; attempt++ {
		err := s.db.QueryRow(ctx, `SELECT story_id::text FROM ext_chapters WHERE id = $1 AND is_published`, chapterID).Scan(&story)
		if err == nil {
			return story, nil
		}
		if err != pgx.ErrNoRows {
			return "", err
		}
		if attempt == 0 {
			if err := s.syncOnce(ctx); err != nil {
				logf(ctx, "warn", "history: sync before retry failed: "+err.Error())
			}
		}
	}
	return "", notFound("Chương không tồn tại.")
}

// POST /history {chapter_id, scroll_position, page_number, time_spent_seconds}: one row per person and chapter
// (reading it again updates it). The story always comes from the chapter, never from the client.
func (s *server) handleSaveHistory(w http.ResponseWriter, r *http.Request, me string) error {
	var body struct {
		ChapterID string `json:"chapter_id"`
		Scroll    any    `json:"scroll_position"`
		Page      any    `json:"page_number"`
		Seconds   any    `json:"time_spent_seconds"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	if !isUUID(body.ChapterID) {
		return bad("Thiếu hoặc sai chapter_id")
	}
	story, err := s.chapterStory(r.Context(), body.ChapterID)
	if err != nil {
		return err
	}
	row, err := s.one(r.Context(), `
		INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (user_id, chapter_id) DO UPDATE
		SET scroll_position = EXCLUDED.scroll_position, page_number = EXCLUDED.page_number, story_id = EXCLUDED.story_id,
		    read_at = NOW(), time_spent_seconds = reading_history.time_spent_seconds + EXCLUDED.time_spent_seconds
		RETURNING *`,
		me, story, body.ChapterID, clamp(body.Scroll, 0, 100, 0), int(math.Round(clamp(body.Page, 1, 100000, 1))),
		int(math.Round(clamp(body.Seconds, 0, 86400, 0))))
	if err != nil {
		return err
	}
	// same keys as the backend's UserReadingLog object
	writeJSON(w, 200, map[string]any{"success": true, "message": "Đã ghi nhận lịch sử đọc thành công", "data": map[string]any{
		"id": row["id"], "userId": row["user_id"], "storyId": row["story_id"], "chapterId": row["chapter_id"],
		"scrollPosition": row["scroll_position"], "pageNumber": row["page_number"], "readAt": row["read_at"],
		"timeSpentSeconds": row["time_spent_seconds"],
	}})
	return nil
}

// POST /internal/history {user_id, chapter_id}: the backend saw this person open the chapter (as the old
// UserReadingLog.recordLog did when serving it): touch the row, keep its position and time.
func (s *server) handleInternalHistory(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		UserID    string `json:"user_id"`
		ChapterID string `json:"chapter_id"`
	}
	if err := readJSON(w, r, &b); err != nil {
		return err
	}
	if !isUUID(b.UserID) || !isUUID(b.ChapterID) {
		return bad("user_id, chapter_id")
	}
	story, err := s.chapterStory(r.Context(), b.ChapterID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(r.Context(), `INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		VALUES ($1, $2, $3, 0, 1, NOW(), 0)
		ON CONFLICT (user_id, chapter_id) DO UPDATE SET scroll_position = 0, page_number = 1, story_id = EXCLUDED.story_id, read_at = NOW()`,
		b.UserID, story, b.ChapterID)
	if err != nil {
		return err
	}
	ok(w, nil)
	return nil
}

// DELETE /history/{id}: one row, or (a story id) every row of that story.
func (s *server) handleDeleteHistory(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	if isUUID(id) {
		tag, err := s.db.Exec(r.Context(), `DELETE FROM reading_history WHERE (id = $1 OR story_id = $1) AND user_id = $2`, id, me)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa khỏi lịch sử đọc"})
			return nil
		}
	}
	return notFound("Bản ghi không tồn tại hoặc bạn không có quyền xóa.")
}

func (s *server) handleClearHistory(w http.ResponseWriter, r *http.Request, me string) error {
	if _, err := s.db.Exec(r.Context(), `DELETE FROM reading_history WHERE user_id = $1`, me); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa toàn bộ lịch sử đọc của bạn"})
	return nil
}

// ---- line bookmarks ---------------------------------------------------------------------------------------------

// GET /bookmarks?chapter_id=&story_id=
func (s *server) handleBookmarks(w http.ResponseWriter, r *http.Request, me string) error {
	q := r.URL.Query()
	chapter, story := q.Get("chapter_id"), q.Get("story_id")
	if (chapter != "" && !isUUID(chapter)) || (story != "" && !isUUID(story)) {
		return bad("Dữ liệu không hợp lệ.")
	}
	rows, err := s.maps(r.Context(), nil, `
		SELECT b.id, b.user_id, b.story_id, b.chapter_id, b.line_text, b.line_index, b.scroll_position, b.page_number, b.note, b.color,
		  b.created_at, s.title AS story_title, s.slug AS story_slug, s.cover_image_url, c.title AS chapter_title, c.slug AS chapter_slug,
		  c.chapter_number
		FROM bookmarks b
		JOIN ext_stories s ON b.story_id = s.id
		JOIN ext_chapters c ON b.chapter_id = c.id
		WHERE b.user_id = $1 AND ($2 = '' OR b.chapter_id::text = $2) AND ($3 = '' OR b.story_id::text = $3)
		ORDER BY b.created_at DESC`, me, chapter, story)
	if err != nil {
		return err
	}
	ok(w, rows)
	return nil
}

// POST /bookmarks {story_id, chapter_id, line_text?, line_index?, ...}: bookmarking a line twice removes it (toggle).
func (s *server) handleCreateBookmark(w http.ResponseWriter, r *http.Request, me string) error {
	var b struct {
		StoryID   string   `json:"story_id"`
		ChapterID string   `json:"chapter_id"`
		LineText  *string  `json:"line_text"`
		LineIndex *int     `json:"line_index"`
		Scroll    *float64 `json:"scroll_position"`
		Page      *int     `json:"page_number"`
		Note      *string  `json:"note"`
		Color     *string  `json:"color"`
	}
	if err := readJSON(w, r, &b); err != nil {
		return err
	}
	if b.StoryID == "" || b.ChapterID == "" {
		return bad("story_id và chapter_id là bắt buộc.")
	}
	if !isUUID(b.StoryID) || !isUUID(b.ChapterID) {
		return bad("Dữ liệu không hợp lệ.")
	}
	var exists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM ext_chapters WHERE id = $1 AND story_id = $2)`,
		b.ChapterID, b.StoryID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return notFound("Truyện hoặc chương không tồn tại.")
	}
	if b.LineIndex != nil {
		tag, err := s.db.Exec(r.Context(), `DELETE FROM bookmarks WHERE id = (
			SELECT id FROM bookmarks WHERE user_id = $1 AND chapter_id = $2 AND line_index = $3 LIMIT 1)`, me, b.ChapterID, *b.LineIndex)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			writeJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": "Đã bỏ bookmark dòng này."})
			return nil
		}
	}
	scroll, page, color := 0.0, 1, "default"
	if b.Scroll != nil {
		scroll = clamp(*b.Scroll, 0, 100, 0)
	}
	if b.Page != nil && *b.Page > 0 {
		page = *b.Page
	}
	if b.Color != nil && *b.Color != "" {
		color = *b.Color
	}
	if len([]rune(color)) > 7 {
		return bad("Dữ liệu không hợp lệ.")
	}
	row, err := s.one(r.Context(), `INSERT INTO bookmarks (user_id, story_id, chapter_id, line_text, line_index, scroll_position, page_number, note, color)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
		me, b.StoryID, b.ChapterID, b.LineText, b.LineIndex, scroll, page, b.Note, color)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"success": true, "action": "added", "data": row, "message": "Đã tạo bookmark thành công."})
	return nil
}

func (s *server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request, me string) error {
	if id := r.PathValue("id"); isUUID(id) {
		tag, err := s.db.Exec(r.Context(), `DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, id, me)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa bookmark thành công."})
			return nil
		}
	}
	return notFound("Bookmark không tồn tại hoặc không thuộc về bạn.")
}

// ---- follows ("Tủ truyện") ----------------------------------------------------------------------------------------

// GET /favorites?category=
func (s *server) handleFavorites(w http.ResponseWriter, r *http.Request, me string) error {
	category := r.URL.Query().Get("category")
	if category == "all" {
		category = ""
	}
	rows, err := s.maps(r.Context(), nil, `
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
	if err != nil {
		return err
	}
	ok(w, rows)
	return nil
}

// POST /favorites/toggle {story_id, category?, notify_updates?}: follow; same category again = unfollow; other = move.
func (s *server) handleToggleFavorite(w http.ResponseWriter, r *http.Request, me string) error {
	b := struct {
		StoryID  string `json:"story_id"`
		Category string `json:"category"`
		Notify   *bool  `json:"notify_updates"`
	}{Category: "reading"}
	if err := readJSON(w, r, &b); err != nil {
		return err
	}
	if b.StoryID == "" {
		return bad("story_id là bắt buộc.")
	}
	if !isUUID(b.StoryID) || len([]rune(b.Category)) > 50 {
		return bad("Dữ liệu không hợp lệ.")
	}
	var id, current string
	err := s.db.QueryRow(r.Context(), `SELECT id::text, COALESCE(category, '') FROM user_favorites WHERE user_id = $1 AND story_id = $2`,
		me, b.StoryID).Scan(&id, &current)
	switch {
	case err == nil && b.Category != "" && current != b.Category:
		if _, err := s.db.Exec(r.Context(), `UPDATE user_favorites SET category = $1 WHERE id = $2`, b.Category, id); err != nil {
			return err
		}
		writeJSON(w, 200, map[string]any{"success": true, "action": "updated", "message": "Đã cập nhật trạng thái theo dõi truyện."})
		return nil
	case err == nil:
		if _, err := s.db.Exec(r.Context(), `DELETE FROM user_favorites WHERE id = $1`, id); err != nil {
			return err
		}
		s.pushFavoriteCount(b.StoryID)
		writeJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": "Đã hủy theo dõi truyện."})
		return nil
	case err != pgx.ErrNoRows:
		return err
	}
	var exists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM ext_stories WHERE id = $1)`, b.StoryID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return notFound("Truyện hoặc chương không tồn tại.")
	}
	notify := true
	if b.Notify != nil {
		notify = *b.Notify
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO user_favorites (user_id, story_id, category, notify_updates) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, story_id) DO NOTHING`, me, b.StoryID, b.Category, notify); err != nil {
		return err
	}
	s.pushFavoriteCount(b.StoryID)
	writeJSON(w, 200, map[string]any{"success": true, "action": "added", "message": "Đã theo dõi truyện thành công."})
	return nil
}

// pushFavoriteCount sends the story's fresh follower count to the backend (stories.total_favorites), in the background.
// A recount, so a repeated or lost call can't drift it.
func (s *server) pushFavoriteCount(storyID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var n int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM user_favorites WHERE story_id = $1`, storyID).Scan(&n); err != nil {
			logf(ctx, "warn", "favorite count: "+err.Error())
			return
		}
		status, err := s.be.call(ctx, "POST", "/internal/favorite-counts", map[string]any{"stories": []map[string]any{{"id": storyID, "count": n}}}, nil)
		if err != nil || status != 200 {
			logf(ctx, "warn", "favorite count not sent to the backend", "story", storyID, "status", status, "error", err)
		}
	}()
}

// GET /favorites/status/{storyId} (guests: not following)
func (s *server) handleFavoriteStatus(w http.ResponseWriter, r *http.Request, me string) error {
	story := r.PathValue("storyId")
	var category *string
	found := false
	if me != "" && isUUID(story) {
		err := s.db.QueryRow(r.Context(), `SELECT category FROM user_favorites WHERE user_id = $1 AND story_id = $2`, me, story).Scan(&category)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		found = err == nil
	}
	writeJSON(w, 200, map[string]any{"success": true, "is_favorite": found, "category": category})
	return nil
}
