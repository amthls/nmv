package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// The bell and /thong-bao (gateway /api/msg/notifications*), the settings table, admins' site-wide announcements.

type actor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type notificationOut struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Category   string         `json:"category"`
	Title      string         `json:"title"`
	Message    *string        `json:"message"`
	Link       *string        `json:"link"`
	Image      *string        `json:"image"`
	Actors     []actor        `json:"actors"`
	ActorCount int            `json:"actor_count"`
	Count      int            `json:"count"`
	Data       map[string]any `json:"-"`
	Seen       bool           `json:"is_seen"`
	ReadAt     *time.Time     `json:"read_at"`
	IsRead     bool           `json:"is_read"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

// groupedTitle: the title of a row that merged several events ("Yuki và 12 người khác…"); one event keeps its own.
func groupedTitle(n notificationOut) string {
	if n.Count <= 1 {
		return n.Title
	}
	who := "Ai đó"
	if len(n.Actors) > 0 && n.Actors[0].Name != "" {
		who = n.Actors[0].Name
	}
	if n.ActorCount > 1 {
		who += fmt.Sprintf(" và %d người khác", n.ActorCount-1)
	}
	str := func(k string) string { v, _ := n.Data[k].(string); return v }
	switch n.Type {
	case "chapter_update":
		return fmt.Sprintf("Truyện \"%s\" có %d chương mới", str("story_title"), n.Count)
	case "post_reaction":
		return who + " đã bày tỏ cảm xúc về bài viết của bạn"
	case "post_comment":
		return who + " đã bình luận bài viết của bạn"
	case "group_join_request":
		return who + " muốn gia nhập nhóm " + str("group_name")
	}
	return n.Title
}

func isAdmin(r *http.Request) bool { // X-User-Roles is covered by the signature authed() checked
	return slices.Contains(strings.Split(r.Header.Get("X-User-Roles"), ","), "admin")
}

const broadcastDays = "30 days"

// GET /notifications?category=&unread=1&q=&before=<updated_at RFC3339>&limit=30: newest first (own rows + live announcements),
// with unseen_count (the bell's number) and unread_count.
func (s *server) handleNotifications(w http.ResponseWriter, r *http.Request, me string) {
	q := r.URL.Query()
	cat := q.Get("category")
	if cat != "" && !slices.ContainsFunc(categories, func(c struct{ ID, Label string }) bool { return c.ID == cat }) {
		fail(w, 400, "Nhóm thông báo không hợp lệ.")
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	var before *time.Time
	if v := q.Get("before"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			fail(w, 400, "before không hợp lệ.")
			return
		}
		before = &t
	}
	unread := q.Get("unread") == "1"
	pattern := ""
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		if len(v) > 100 {
			v = v[:100]
		}
		pattern = "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(v) + "%"
	}
	rows, err := s.db.Query(r.Context(), `
		SELECT id::text, type, category, title, message, link, image, actors, actor_count, count, data, seen_at IS NOT NULL, read_at, created_at, updated_at
		FROM notifications WHERE user_id = $1 AND ($2 = '' OR category = $2) AND (NOT $3 OR read_at IS NULL)
		  AND ($4::timestamptz IS NULL OR updated_at < $4) AND ($6 = '' OR title ILIKE $6 OR message ILIKE $6)
		UNION ALL
		SELECT b.id::text, 'broadcast', 'system', b.title, b.message, b.link, NULL, '[]', 0, 1, '{}', r.seen_at IS NOT NULL, r.read_at, b.created_at, b.created_at
		FROM broadcasts b LEFT JOIN broadcast_reads r ON r.broadcast_id = b.id AND r.user_id = $1
		WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`' AND $2 IN ('', 'system') AND (NOT $3 OR r.read_at IS NULL)
		  AND ($4::timestamptz IS NULL OR b.created_at < $4) AND ($6 = '' OR b.title ILIKE $6 OR b.message ILIKE $6)
		ORDER BY 15 DESC LIMIT $5`, me, cat, unread, before, limit, pattern)
	if err != nil {
		internalError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (notificationOut, error) {
		var n notificationOut
		err := row.Scan(&n.ID, &n.Type, &n.Category, &n.Title, &n.Message, &n.Link, &n.Image, &n.Actors, &n.ActorCount, &n.Count,
			&n.Data, &n.Seen, &n.ReadAt, &n.CreatedAt, &n.UpdatedAt)
		n.IsRead = n.ReadAt != nil
		n.Title = groupedTitle(n)
		return n, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	var unseen, unreadCount int
	if err := s.db.QueryRow(r.Context(), `
		SELECT (SELECT count(*) FROM notifications WHERE user_id = $1 AND seen_at IS NULL)
		     + (SELECT count(*) FROM broadcasts b WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`'
		        AND NOT EXISTS (SELECT 1 FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.user_id = $1 AND r.seen_at IS NOT NULL)),
		       (SELECT count(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL)
		     + (SELECT count(*) FROM broadcasts b WHERE b.created_at > NOW() - INTERVAL '`+broadcastDays+`'
		        AND NOT EXISTS (SELECT 1 FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.user_id = $1 AND r.read_at IS NOT NULL))`,
		me).Scan(&unseen, &unreadCount); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"notifications": list, "unseen_count": unseen, "unread_count": unreadCount})
}

// POST /notifications/seen: the bell was opened, its number goes back to 0 (items stay unread until clicked).
func (s *server) handleSeen(w http.ResponseWriter, r *http.Request, me string) {
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `UPDATE notifications SET seen_at = NOW() WHERE user_id = $1 AND seen_at IS NULL`, me); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at)
			SELECT id, $1, NOW() FROM broadcasts WHERE created_at > NOW() - INTERVAL '`+broadcastDays+`'
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, me)
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, nil)
}

// PUT /notifications/{id}/read (a notification or an announcement)
func (s *server) handleRead(w http.ResponseWriter, r *http.Request, me string) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Thông báo không tồn tại.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE notifications SET read_at = COALESCE(read_at, NOW()), seen_at = COALESCE(seen_at, NOW())
		WHERE id = $1 AND user_id = $2`, id, me)
	if err == nil && tag.RowsAffected() == 0 {
		tag, err = s.db.Exec(r.Context(), `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at, read_at)
			SELECT id, $2, NOW(), NOW() FROM broadcasts WHERE id = $1
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET read_at = COALESCE(broadcast_reads.read_at, NOW()),
			  seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, id, me)
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Thông báo không tồn tại.")
		return
	}
	okMsg(w, "Đã đánh dấu thông báo là đã đọc.", nil)
}

// PUT /notifications/read-all?category=
func (s *server) handleReadAll(w http.ResponseWriter, r *http.Request, me string) {
	cat := r.URL.Query().Get("category")
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `UPDATE notifications SET read_at = NOW(), seen_at = COALESCE(seen_at, NOW())
			WHERE user_id = $1 AND read_at IS NULL AND ($2 = '' OR category = $2)`, me, cat); err != nil {
			return err
		}
		if cat != "" && cat != "system" {
			return nil
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO broadcast_reads (broadcast_id, user_id, seen_at, read_at)
			SELECT id, $1, NOW(), NOW() FROM broadcasts WHERE created_at > NOW() - INTERVAL '`+broadcastDays+`'
			ON CONFLICT (broadcast_id, user_id) DO UPDATE SET read_at = COALESCE(broadcast_reads.read_at, NOW()),
			  seen_at = COALESCE(broadcast_reads.seen_at, NOW())`, me)
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	okMsg(w, "Đã đánh dấu tất cả thông báo là đã đọc.", nil)
}

// DELETE /notifications/{id} (an announcement can't be deleted for one person: it is marked read instead)
func (s *server) handleDeleteNotification(w http.ResponseWriter, r *http.Request, me string) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Thông báo không tồn tại.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM notifications WHERE id = $1 AND user_id = $2`, id, me)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		s.handleRead(w, r, me)
		return
	}
	okMsg(w, "Đã xóa thông báo.", nil)
}

// GET /notifications/settings -> [{category, label, web}]
func (s *server) handleNotifySettings(w http.ResponseWriter, r *http.Request, me string) {
	rows, err := s.db.Query(r.Context(), `SELECT category FROM notification_settings WHERE user_id = $1 AND NOT web`, me)
	if err != nil {
		internalError(w, r, err)
		return
	}
	off, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		internalError(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(categories))
	for _, c := range categories {
		out = append(out, map[string]any{"category": c.ID, "label": c.Label, "web": !slices.Contains(off, c.ID)})
	}
	ok(w, out)
}

// PUT /notifications/settings {"<category>": {"web": bool}, ...}: only the categories sent change.
func (s *server) handlePutNotifySettings(w http.ResponseWriter, r *http.Request, me string) {
	var body map[string]struct {
		Web *bool `json:"web"`
	}
	if err := readJSON(w, r, &body); err != nil {
		fail(w, 400, "Cài đặt không hợp lệ.")
		return
	}
	b := &pgx.Batch{}
	for cat, v := range body {
		if v.Web == nil || !slices.ContainsFunc(categories, func(c struct{ ID, Label string }) bool { return c.ID == cat }) {
			fail(w, 400, "Cài đặt không hợp lệ.")
			return
		}
		if *v.Web {
			b.Queue(`DELETE FROM notification_settings WHERE user_id = $1 AND category = $2`, me, cat)
		} else {
			b.Queue(`INSERT INTO notification_settings (user_id, category, web) VALUES ($1, $2, false)
				ON CONFLICT (user_id, category) DO UPDATE SET web = false`, me, cat)
		}
	}
	if err := s.db.SendBatch(r.Context(), b).Close(); err != nil {
		internalError(w, r, err)
		return
	}
	s.handleNotifySettings(w, r, me)
}

// --- site-wide announcements (admins) -----------------------------------------------------------------------------

func (s *server) adminOnly(h func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return s.authed(func(w http.ResponseWriter, r *http.Request, me string) {
		if !isAdmin(r) {
			fail(w, 403, "Chỉ Admin.")
			return
		}
		h(w, r, me)
	})
}

// GET /admin/broadcasts: the live ones, newest first, with how many people read each
func (s *server) handleBroadcasts(w http.ResponseWriter, r *http.Request, _ string) {
	rows, err := s.db.Query(r.Context(), `SELECT b.id::text, b.title, b.message, b.link, b.created_at,
		(SELECT count(*) FROM broadcast_reads r WHERE r.broadcast_id = b.id AND r.read_at IS NOT NULL)
		FROM broadcasts b ORDER BY b.created_at DESC`)
	if err != nil {
		internalError(w, r, err)
		return
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (map[string]any, error) {
		var id, title string
		var msg, link *string
		var at time.Time
		var reads int
		err := row.Scan(&id, &title, &msg, &link, &at, &reads)
		return map[string]any{"id": id, "title": title, "message": msg, "link": link, "created_at": at, "read_count": reads}, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, list)
}

// POST /admin/broadcasts {title, message?, link?}: everybody sees it in the bell for 30 days
func (s *server) handleCreateBroadcast(w http.ResponseWriter, r *http.Request, me string) {
	var body struct {
		Title   string `json:"title"`
		Message string `json:"message"`
		Link    string `json:"link"`
	}
	if err := readJSON(w, r, &body); err != nil {
		fail(w, 400, "Dữ liệu không hợp lệ.")
		return
	}
	title, msg, link := strings.TrimSpace(body.Title), strings.TrimSpace(body.Message), strings.TrimSpace(body.Link)
	switch {
	case title == "" || len([]rune(title)) > 200:
		fail(w, 400, "Tiêu đề cần 1–200 ký tự.")
		return
	case len([]rune(msg)) > 1000:
		fail(w, 400, "Nội dung tối đa 1000 ký tự.")
		return
	case link != "" && (!strings.HasPrefix(link, "/") || strings.HasPrefix(link, "//") || len(link) > 300):
		fail(w, 400, "Liên kết phải là đường dẫn trong trang, bắt đầu bằng /.")
		return
	}
	var id string
	if err := s.db.QueryRow(r.Context(), `INSERT INTO broadcasts (title, message, link, created_by) VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4)
		RETURNING id::text`, title, msg, link, me).Scan(&id); err != nil {
		internalError(w, r, err)
		return
	}
	s.publish(r.Context(), []string{"*"}, "notification", nil)
	okMsg(w, "Đã gửi thông báo toàn site.", map[string]any{"id": id})
}

// DELETE /admin/broadcasts/{id}
func (s *server) handleDeleteBroadcast(w http.ResponseWriter, r *http.Request, _ string) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Không tìm thấy.")
		return
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM broadcasts WHERE id = $1`, id); err != nil {
		internalError(w, r, err)
		return
	}
	okMsg(w, "Đã xóa thông báo toàn site.", nil)
}

// POST /internal/notifications/jobs: the backend's fallback when RabbitMQ is unreachable (same job body as the queue)
func (s *server) handleInternalJob(w http.ResponseWriter, r *http.Request) {
	var job notifyJob
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		fail(w, 400, "bad job")
		return
	}
	n, err := s.runJob(r.Context(), job)
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"created": n})
}
