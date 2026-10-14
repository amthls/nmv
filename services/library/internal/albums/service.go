package main

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Albums: named story lists, moved from the backend's album.controller.ts with the same JSON. A story may sit in any
// number of a user's albums. Private albums open only for the owner or with the share link (?key=token); public ones
// also show up under the stories they contain. Others can save an album (live) or copy its stories into their own.

const (
	maxAlbumsPerUser   = 100
	maxStoriesPerAlbum = 1000
)

// summaryColumns: the album card. excludeStory (a $n placeholder) leaves that story out of the cover preview, so
// "other albums with this story" previews what else is inside. Owner fields are added by withOwners.
func summaryColumns(excludeStory string) string {
	ex := ""
	if excludeStory != "" {
		ex = " AND s.id <> " + excludeStory
	}
	return `a.id, a.code, a.name, a.description, a.is_public, a.copied_from, a.created_at, a.updated_at, a.user_id AS owner_id,
	  (SELECT count(*)::int FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
	    WHERE x.album_id = a.id AND s.approval_status = 'approved') AS story_count,
	  (SELECT count(*)::int FROM album_saves sv WHERE sv.album_id = a.id) AS save_count,
	  COALESCE((
	    SELECT json_agg(p) FROM (
	      SELECT s.id, s.slug, s.title, s.cover_image_url
	      FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
	      WHERE x.album_id = a.id AND s.approval_status = 'approved'` + ex + `
	      ORDER BY x.added_at DESC LIMIT 4
	    ) p
	  ), '[]'::json) AS preview`
}

// withOwners adds owner_username, owner_name, owner_avatar (from the backend) and drops albums whose owner is banned
// or deleted when activeOnly.
func (s *server) withOwners(ctx context.Context, rows []map[string]any, activeOnly bool) ([]map[string]any, error) {
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r["owner_id"].(string))
	}
	people, err := s.be.profiles(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := rows[:0]
	for _, r := range rows {
		p, known := people[r["owner_id"].(string)]
		if activeOnly && (!known || p.IsBanned || p.Deleted) {
			continue
		}
		r["owner_username"], r["owner_name"], r["owner_avatar"] = nil, nil, nil
		if known {
			r["owner_username"], r["owner_name"], r["owner_avatar"] = p.Username, p.DisplayName, p.AvatarURL
		}
		out = append(out, r)
	}
	return out, nil
}

// text: the body field as the backend's optionalText read it. sent = the field was there.
func text(body map[string]any, key string, max int, label string) (val *string, sent bool, err error) {
	raw, sent := body[key]
	if !sent || raw == nil {
		return nil, sent, nil
	}
	str, isStr := raw.(string)
	if !isStr {
		return nil, true, bad(label + " không hợp lệ.")
	}
	str = strings.TrimSpace(str)
	if len([]rune(str)) > max {
		return nil, true, bad(fmt.Sprintf("%s tối đa %d ký tự.", label, max))
	}
	if str == "" {
		return nil, true, nil
	}
	return &str, true, nil
}

func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	body := map[string]any{}
	if r.ContentLength == 0 {
		return body, nil
	}
	if err := readJSON(w, r, &body); err != nil {
		return nil, err
	}
	return body, nil
}

// ownAlbum: an album the user owns, or 404 (never reveals someone else's private album).
func (s *server) ownAlbum(ctx context.Context, albumID, me string) (name string, err error) {
	if !isUUID(albumID) {
		return "", notFound("Album không tồn tại.")
	}
	err = s.db.QueryRow(ctx, `SELECT name FROM albums WHERE id = $1 AND user_id = $2`, albumID, me).Scan(&name)
	if err == pgx.ErrNoRows {
		return "", notFound("Album không tồn tại hoặc không thuộc về bạn.")
	}
	return name, err
}

type viewable struct {
	ownerID, name, shareToken string
	public                    bool
}

// viewableAlbum: an album the viewer may open: owner, public album, or private album with the right share key.
func (s *server) viewableAlbum(ctx context.Context, albumID, me string, key any) (*viewable, error) {
	if !isUUID(albumID) {
		return nil, notFound("Album không tồn tại.")
	}
	var v viewable
	err := s.db.QueryRow(ctx, `SELECT user_id::text, name, is_public, share_token FROM albums WHERE id = $1`, albumID).
		Scan(&v.ownerID, &v.name, &v.public, &v.shareToken)
	k, _ := key.(string)
	if err == pgx.ErrNoRows || (err == nil && !(v.ownerID == me || v.public || (k != "" && k == v.shareToken))) {
		return nil, notFound("Album không tồn tại hoặc là album riêng tư.")
	}
	return &v, err
}

func (s *server) albumCount(ctx context.Context, me string) (int, error) {
	var n int
	return n, s.db.QueryRow(ctx, `SELECT count(*) FROM albums WHERE user_id = $1`, me).Scan(&n)
}

// GET /albums/me?story_id=: my albums; with story_id each one says whether it holds that story.
func (s *server) handleMyAlbums(w http.ResponseWriter, r *http.Request, me string) error {
	story := r.URL.Query().Get("story_id")
	if !isUUID(story) {
		story = ""
	}
	rows, err := s.maps(r.Context(), nil, `SELECT `+summaryColumns("")+`, a.share_token,
		  ($2 <> '' AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id::text = $2)) AS has_story
		FROM albums a WHERE a.user_id = $1 ORDER BY a.updated_at DESC`, me, story)
	if err == nil {
		rows, err = s.withOwners(r.Context(), rows, false)
	}
	if err != nil {
		return err
	}
	ok(w, rows)
	return nil
}

// GET /albums/saved: other people's albums I saved, still viewable to me (saved through a share link: while it matches).
func (s *server) handleSavedAlbums(w http.ResponseWriter, r *http.Request, me string) error {
	rows, err := s.maps(r.Context(), nil, `SELECT `+summaryColumns("")+`, sv.created_at AS saved_at,
		  CASE WHEN a.is_public THEN NULL ELSE sv.share_token END AS share_key
		FROM album_saves sv JOIN albums a ON a.id = sv.album_id
		WHERE sv.user_id = $1 AND (a.is_public OR sv.share_token = a.share_token)
		ORDER BY sv.created_at DESC`, me)
	if err == nil {
		rows, err = s.withOwners(r.Context(), rows, false)
	}
	if err != nil {
		return err
	}
	ok(w, rows)
	return nil
}

// GET /albums/by-story/{storyId}: mine = my albums holding the story; others = public albums of active users holding it,
// random order, those holding more than this story first.
func (s *server) handleAlbumsByStory(w http.ResponseWriter, r *http.Request, me string) error {
	story := r.PathValue("storyId")
	if !isUUID(story) {
		return notFound("Truyện không tồn tại.")
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 12
	}
	limit = min(limit, 30)
	mine := []map[string]any{}
	var err error
	if me != "" {
		mine, err = s.maps(r.Context(), nil, `SELECT `+summaryColumns("$2")+`, a.share_token
			FROM albums a WHERE a.user_id = $1 AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $2)
			ORDER BY a.updated_at DESC`, me, story)
		if err == nil {
			mine, err = s.withOwners(r.Context(), mine, false)
		}
		if err != nil {
			return err
		}
	}
	// a few extra: albums of banned/deleted owners are dropped after asking the backend
	others, err := s.maps(r.Context(), nil, `SELECT * FROM (
		  SELECT `+summaryColumns("$1")+`,
		    ($2 <> '' AND EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id::text = $2)) AS is_saved
		  FROM albums a
		  WHERE a.is_public AND a.user_id::text <> $2
		    AND EXISTS (SELECT 1 FROM album_stories x WHERE x.album_id = a.id AND x.story_id = $1)
		) t ORDER BY (t.story_count > 1) DESC, random() LIMIT $3`, story, me, limit*3)
	if err == nil {
		others, err = s.withOwners(r.Context(), others, true)
	}
	if err != nil {
		return err
	}
	if len(others) > limit {
		others = others[:limit]
	}
	ok(w, map[string]any{"mine": mine, "others": others})
	return nil
}

// GET /albums/{id}?key=: the album page with its stories.
func (s *server) handleAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	if _, err := s.viewableAlbum(r.Context(), id, me, r.URL.Query().Get("key")); err != nil {
		return err
	}
	rows, err := s.maps(r.Context(), nil, `SELECT `+summaryColumns("")+`, a.share_token,
		  ($2 <> '' AND EXISTS (SELECT 1 FROM album_saves sv WHERE sv.album_id = a.id AND sv.user_id::text = $2)) AS is_saved,
		  src.name AS copied_from_name, src.is_public AS copied_from_public
		FROM albums a LEFT JOIN albums src ON src.id = a.copied_from WHERE a.id = $1`, id, me)
	if err == nil {
		rows, err = s.withOwners(r.Context(), rows, false)
	}
	if err != nil {
		return err
	}
	album := rows[0]
	album["is_owner"] = album["owner_id"] == me
	if album["is_owner"] != true {
		delete(album, "share_token") // only the owner may hand out the link
	}
	if album["copied_from_public"] != true {
		album["copied_from"], album["copied_from_name"] = nil, nil // don't link to a private source album
	}
	delete(album, "copied_from_public")
	stories, err := s.maps(r.Context(), nil, `
		SELECT s.id, s.title, s.slug, s.cover_image_url, s.author_name, s.story_type, s.status, s.total_chapters, s.total_views, x.added_at
		FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
		WHERE x.album_id = $1 AND s.approval_status = 'approved' ORDER BY x.added_at DESC`, id)
	if err != nil {
		return err
	}
	album["stories"] = stories
	ok(w, album)
	return nil
}

// POST /albums {name, description?, is_public?, story_id?}
func (s *server) handleCreateAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	name, _, err := text(body, "name", 100, "Tên album")
	if err == nil && name == nil {
		err = bad("Tên album không được để trống.")
	}
	if err != nil {
		return err
	}
	desc, _, err := text(body, "description", 500, "Mô tả")
	if err != nil {
		return err
	}
	story, _ := body["story_id"].(string)
	if body["story_id"] != nil && !isUUID(story) {
		return bad("Truyện không hợp lệ.")
	}
	if n, err := s.albumCount(r.Context(), me); err != nil {
		return err
	} else if n >= maxAlbumsPerUser {
		return bad(fmt.Sprintf("Mỗi tài khoản tạo tối đa %d album.", maxAlbumsPerUser))
	}
	codeNo, err := s.ownerCodeNo(r.Context(), me)
	if err != nil {
		return err
	}
	var album map[string]any
	err = pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		rows, err := s.maps(r.Context(), tx, `INSERT INTO albums (user_id, owner_code_no, name, description, is_public)
			VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, is_public, share_token, created_at, updated_at`,
			me, codeNo, *name, desc, body["is_public"] == true)
		if err != nil {
			return err
		}
		album = rows[0]
		if story != "" {
			_, err = tx.Exec(r.Context(), `INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2)`, album["id"], story)
		}
		return err
	})
	if err != nil {
		return err
	}
	album["has_story"] = story != ""
	writeJSON(w, 201, map[string]any{"success": true, "data": album, "message": "Đã tạo album."})
	return nil
}

// ownerCodeNo: the account number in the AL- code (null if the backend doesn't know it yet).
func (s *server) ownerCodeNo(ctx context.Context, me string) (*int64, error) {
	people, err := s.be.profiles(ctx, []string{me})
	if err != nil {
		return nil, err
	}
	return people[me].CodeNo, nil
}

// PUT /albums/{id} {name?, description?, is_public?}
func (s *server) handleUpdateAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	if _, err := s.ownAlbum(r.Context(), id, me); err != nil {
		return err
	}
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	name, nameSent, err := text(body, "name", 100, "Tên album")
	if err == nil && nameSent && name == nil {
		err = bad("Tên album không được để trống.")
	}
	if err != nil {
		return err
	}
	desc, descSent, err := text(body, "description", 500, "Mô tả")
	if err != nil {
		return err
	}
	var public *bool
	if v, sent := body["is_public"]; sent {
		b := v == true
		public = &b
	}
	rows, err := s.maps(r.Context(), nil, `UPDATE albums SET name = COALESCE($2, name),
		  description = CASE WHEN $3::boolean THEN $4 ELSE description END, is_public = COALESCE($5, is_public), updated_at = NOW()
		WHERE id = $1 RETURNING id, name, description, is_public, share_token, updated_at`, id, name, descSent, desc, public)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": rows[0], "message": "Đã cập nhật album."})
	return nil
}

// PUT /albums/me/visibility {is_public}: every album of mine public, or every one private.
func (s *server) handleAllAlbumsVisibility(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	public, isBool := body["is_public"].(bool)
	if !isBool {
		return bad("Thiếu chế độ công khai/riêng tư.")
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE albums SET is_public = $2, updated_at = NOW() WHERE user_id = $1 AND is_public <> $2`, me, public)
	if err != nil {
		return err
	}
	msg := "Đã chuyển tất cả album sang riêng tư."
	if public {
		msg = "Đã công khai tất cả album."
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"changed": tag.RowsAffected()}, "message": msg})
	return nil
}

func (s *server) handleDeleteAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	if _, err := s.ownAlbum(r.Context(), id, me); err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM albums WHERE id = $1`, id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa album."})
	return nil
}

// POST /albums/{id}/share-link/reset: a new share key; old private links stop working.
func (s *server) handleResetShareLink(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	if _, err := s.ownAlbum(r.Context(), id, me); err != nil {
		return err
	}
	rows, err := s.maps(r.Context(), nil, `UPDATE albums SET share_token = replace(gen_random_uuid()::text, '-', '') WHERE id = $1 RETURNING share_token`, id)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "data": rows[0], "message": "Đã tạo link chia sẻ mới, link cũ không còn dùng được."})
	return nil
}

// POST /albums/{id}/stories {story_id}
func (s *server) handleAddToAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	story, _ := body["story_id"].(string)
	if !isUUID(story) {
		return bad("Truyện không hợp lệ.")
	}
	name, err := s.ownAlbum(r.Context(), id, me)
	if err != nil {
		return err
	}
	var n int
	if err := s.db.QueryRow(r.Context(), `SELECT count(*) FROM album_stories WHERE album_id = $1`, id).Scan(&n); err != nil {
		return err
	}
	if n >= maxStoriesPerAlbum {
		return bad(fmt.Sprintf("Mỗi album chứa tối đa %d truyện.", maxStoriesPerAlbum))
	}
	var exists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM ext_stories WHERE id = $1)`, story).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return notFound("Truyện hoặc chương không tồn tại.")
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO album_stories (album_id, story_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, story); err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE albums SET updated_at = NOW() WHERE id = $1`, id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "action": "added", "message": fmt.Sprintf("Đã lưu vào album \"%s\".", name)})
	return nil
}

// DELETE /albums/{id}/stories/{storyId}
func (s *server) handleRemoveFromAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id, story := r.PathValue("id"), r.PathValue("storyId")
	if !isUUID(story) {
		return bad("Truyện không hợp lệ.")
	}
	name, err := s.ownAlbum(r.Context(), id, me)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM album_stories WHERE album_id = $1 AND story_id = $2`, id, story); err != nil {
		return err
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE albums SET updated_at = NOW() WHERE id = $1`, id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": fmt.Sprintf("Đã bỏ truyện khỏi album \"%s\".", name)})
	return nil
}

// POST /albums/{id}/save {key?}: save / unsave someone else's album (toggle).
func (s *server) handleSaveAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	album, err := s.viewableAlbum(r.Context(), id, me, body["key"])
	if err != nil {
		return err
	}
	if album.ownerID == me {
		return bad("Đây là album của bạn.")
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM album_saves WHERE user_id = $1 AND album_id = $2`, me, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		writeJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": "Đã bỏ lưu album."})
		return nil
	}
	var token *string
	if !album.public {
		token = &album.shareToken
	}
	if _, err := s.db.Exec(r.Context(), `INSERT INTO album_saves (user_id, album_id, share_token) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		me, id, token); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"success": true, "action": "added", "message": "Đã lưu album vào mục \"Album đã lưu\"."})
	return nil
}

// POST /albums/{id}/copy {key?, target_album_id?, name?}: copy the album's stories into one of my albums or a new one.
func (s *server) handleCopyAlbum(w http.ResponseWriter, r *http.Request, me string) error {
	id := r.PathValue("id")
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	source, err := s.viewableAlbum(r.Context(), id, me, body["key"])
	if err != nil {
		return err
	}
	targetID, _ := body["target_album_id"].(string)
	var target struct{ id, name string }
	if targetID != "" {
		if !isUUID(targetID) {
			return bad("Album đích không hợp lệ.")
		}
		if targetID == id {
			return bad("Không thể sao chép album vào chính nó.")
		}
		name, err := s.ownAlbum(r.Context(), targetID, me)
		if err != nil {
			return err
		}
		target.id, target.name = targetID, name
	} else {
		if n, err := s.albumCount(r.Context(), me); err != nil {
			return err
		} else if n >= maxAlbumsPerUser {
			return bad(fmt.Sprintf("Mỗi tài khoản tạo tối đa %d album.", maxAlbumsPerUser))
		}
	}
	name, _, err := text(body, "name", 100, "Tên album")
	if err != nil {
		return err
	}
	codeNo, err := s.ownerCodeNo(r.Context(), me)
	if err != nil {
		return err
	}
	var added int64
	err = pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if target.id == "" {
			newName := source.name
			if name != nil {
				newName = *name
			}
			if err := tx.QueryRow(r.Context(), `INSERT INTO albums (user_id, owner_code_no, name, description, copied_from)
				SELECT $1, $2, $3, description, id FROM albums WHERE id = $4 RETURNING id::text, name`,
				me, codeNo, newName, id).Scan(&target.id, &target.name); err != nil {
				return err
			}
		}
		var have int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM album_stories WHERE album_id = $1`, target.id).Scan(&have); err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(), `INSERT INTO album_stories (album_id, story_id)
			SELECT $1, x.story_id FROM album_stories x JOIN ext_stories s ON s.id = x.story_id
			WHERE x.album_id = $2 AND s.approval_status = 'approved'
			  AND NOT EXISTS (SELECT 1 FROM album_stories y WHERE y.album_id = $1 AND y.story_id = x.story_id)
			ORDER BY x.added_at LIMIT $3
			ON CONFLICT DO NOTHING`, target.id, id, max(0, maxStoriesPerAlbum-have))
		if err != nil {
			return err
		}
		added = tag.RowsAffected()
		_, err = tx.Exec(r.Context(), `UPDATE albums SET updated_at = NOW() WHERE id = $1`, target.id)
		return err
	})
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("Album \"%s\" đã có đủ các truyện này.", target.name)
	if added > 0 {
		msg = fmt.Sprintf("Đã sao chép %d truyện vào album \"%s\".", added, target.name)
	}
	writeJSON(w, 201, map[string]any{"success": true, "message": msg,
		"data": map[string]any{"album_id": target.id, "album_name": target.name, "added": added}})
	return nil
}
