package main

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	maxMessage   = 2000
	maxLabels    = 20
	maxLabelName = 30
	maxPins      = 10
	blockedMsg   = "Không thể gửi tin nhắn cho người này."
)

// Label colors the UI draws: must match LABEL_STYLES in frontend/src/components/messages/labels.ts
var labelColors = map[string]bool{"sky": true, "emerald": true, "amber": true, "rose": true, "fuchsia": true, "teal": true, "orange": true, "lime": true}

func dmKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + ":" + b
}

// text trims s and checks it is 1..max characters.
func text(s string, max int, what string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", bad(what + " không được để trống.")
	}
	if utf8.RuneCountInString(s) > max {
		return "", bad(what + " quá dài.")
	}
	return s, nil
}

// partner: the other person, by username; deleted accounts can't be messaged (404).
func (s *server) partner(ctx context.Context, username string) (*profile, error) {
	username = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(username), "@"))
	if username == "" {
		return nil, &inputError{404, "Người dùng không tồn tại"}
	}
	p, err := s.be.byUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if p == nil || p.Deleted {
		return nil, &inputError{404, "Người dùng không tồn tại"}
	}
	return p, nil
}

func (s *server) blockState(ctx context.Context, me, other string) (byMe, byThem bool, err error) {
	err = s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2),
		EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $2 AND blocked_id = $1)`, me, other).Scan(&byMe, &byThem)
	return
}

func profileFields(p profile) map[string]any {
	return map[string]any{"username": p.Username, "display_name": p.DisplayName, "avatar_url": p.AvatarURL}
}

// ---- inbox ---------------------------------------------------------------------------------------------------

// GET /messages?label=&q=: one row per person I talked with (latest first) and my total unread count.
func (s *server) handleInbox(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	label := r.URL.Query().Get("label")
	if label != "" && !isUUID(label) {
		answer(w, r, bad("Nhãn không hợp lệ."))
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 100 {
		q = string([]rune(q)[:100])
	}
	var pattern *string
	if q != "" {
		p := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
		pattern = &p
	}
	rows, err := s.db.Query(ctx, `
		SELECT o.user_id::text, lm.body, lm.sender_id::text, lm.created_at,
		       (SELECT count(*) FROM messages x WHERE x.conversation_id = c.id AND x.seq > me.last_read_seq AND x.sender_id <> $1)::int,
		       COALESCE((SELECT array_agg(lc.label_id::text) FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
		                 WHERE dl.user_id = $1 AND lc.partner_id = o.user_id), '{}'),
		       EXISTS (SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = o.user_id),
		       (SELECT body FROM messages x WHERE $3::text IS NOT NULL AND x.conversation_id = c.id AND x.body ILIKE $3 ORDER BY seq DESC LIMIT 1)
		FROM conversation_members me
		JOIN conversations c ON c.id = me.conversation_id AND c.kind = 'dm' AND c.last_message_at IS NOT NULL
		JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> me.user_id
		JOIN LATERAL (SELECT body, sender_id, created_at FROM messages WHERE conversation_id = c.id ORDER BY seq DESC LIMIT 1) lm ON true
		WHERE me.user_id = $1
		  AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM dm_label_conversations lc JOIN dm_labels dl ON dl.id = lc.label_id
		                                   WHERE dl.user_id = $1 AND lc.label_id = $2 AND lc.partner_id = o.user_id))
		ORDER BY c.last_message_at DESC
		LIMIT 300`, me, nullable(label), pattern)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type row struct {
		partner, last, lastSender string
		lastAt                    time.Time
		unread                    int
		labels                    []string
		blocked                   bool
		match                     *string
	}
	list, err := pgx.CollectRows(rows, func(rw pgx.CollectableRow) (row, error) {
		var x row
		err := rw.Scan(&x.partner, &x.last, &x.lastSender, &x.lastAt, &x.unread, &x.labels, &x.blocked, &x.match)
		return x, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ids := make([]string, len(list))
	for i, x := range list {
		ids[i] = x.partner
	}
	profiles, err := s.be.profiles(ctx, ids)
	if err != nil {
		internalError(w, r, err)
		return
	}
	lq := strings.ToLower(q)
	out := []map[string]any{}
	for _, x := range list {
		p, found := profiles[x.partner]
		if !found {
			continue
		}
		if q != "" && x.match == nil && !strings.Contains(strings.ToLower(p.Username), lq) &&
			(p.DisplayName == nil || !strings.Contains(strings.ToLower(*p.DisplayName), lq)) {
			continue
		}
		item := profileFields(p)
		item["partner_id"], item["last_message"], item["last_sender_id"], item["last_at"] = x.partner, x.last, x.lastSender, x.lastAt
		item["unread"], item["label_ids"], item["blocked"], item["match_message"] = x.unread, x.labels, x.blocked, x.match
		out = append(out, item)
		if len(out) == 100 {
			break
		}
	}
	// The badge counts every unread message, whatever filter the inbox shows
	var unread int
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(sum((SELECT count(*) FROM messages x WHERE x.conversation_id = me.conversation_id
		AND x.seq > me.last_read_seq AND x.sender_id <> $1)), 0)::int
		FROM conversation_members me JOIN conversations c ON c.id = me.conversation_id AND c.kind = 'dm' WHERE me.user_id = $1`, me).Scan(&unread); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"conversations": out, "unread_count": unread})
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ---- thread ----------------------------------------------------------------------------------------------------

type dmConv struct {
	id             string
	partnerReadSeq int64
	partnerReadAt  *time.Time
	myReadSeq      int64
	myReadAt       *time.Time
	exists         bool
}

func (s *server) loadConv(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, me, other string) (dmConv, error) {
	var c dmConv
	err := q.QueryRow(ctx, `SELECT c.id::text, o.last_read_seq, o.last_read_at, m.last_read_seq, m.last_read_at
		FROM conversations c
		JOIN conversation_members m ON m.conversation_id = c.id AND m.user_id = $2
		JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id = $3
		WHERE c.dm_key = $1`, dmKey(me, other), me, other).Scan(&c.id, &c.partnerReadSeq, &c.partnerReadAt, &c.myReadSeq, &c.myReadAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, nil
	}
	c.exists = err == nil
	return c, err
}

// GET /messages/{username}: the latest 100 messages (oldest first), every pinned one, my labels on it and the
// block state. Opening the thread marks it read.
func (s *server) handleThread(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	p, err := s.partner(ctx, r.PathValue("username"))
	if err != nil {
		answer(w, r, err)
		return
	}
	// Mark read: everything there is now
	if _, err := s.db.Exec(ctx, `UPDATE conversation_members m SET last_read_seq = x.max_seq, last_read_at = NOW()
		FROM (SELECT c.id, (SELECT COALESCE(max(seq), 0) FROM messages WHERE conversation_id = c.id) AS max_seq
		      FROM conversations c WHERE c.dm_key = $1) x
		WHERE m.conversation_id = x.id AND m.user_id = $2 AND m.last_read_seq < x.max_seq`, dmKey(me, p.ID), me); err != nil {
		internalError(w, r, err)
		return
	}
	c, err := s.loadConv(ctx, s.db, me, p.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	messages, pinned := []map[string]any{}, []map[string]any{}
	if c.exists {
		if messages, err = s.dmMessages(ctx, c, me, p.ID, `SELECT * FROM (SELECT id::text, seq, sender_id::text, body, created_at, pinned_at, pinned_by::text, draft_id::text
			FROM messages WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 100) latest ORDER BY seq`); err != nil {
			internalError(w, r, err)
			return
		}
		if pinned, err = s.dmMessages(ctx, c, me, p.ID, `SELECT id::text, seq, sender_id::text, body, created_at, pinned_at, pinned_by::text, draft_id::text
			FROM messages WHERE conversation_id = $1 AND pinned_at IS NOT NULL ORDER BY pinned_at DESC`); err != nil {
			internalError(w, r, err)
			return
		}
	}
	var labels []string
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(array_agg(lc.label_id::text), '{}') FROM dm_label_conversations lc
		JOIN dm_labels dl ON dl.id = lc.label_id WHERE dl.user_id = $1 AND lc.partner_id = $2`, me, p.ID).Scan(&labels); err != nil {
		internalError(w, r, err)
		return
	}
	byMe, byThem, err := s.blockState(ctx, me, p.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	partner := profileFields(*p)
	partner["id"] = p.ID
	ok(w, map[string]any{"partner": partner, "messages": messages, "pinned": pinned, "label_ids": labels,
		"blocked_by_me": byMe, "can_message": !byMe && !byThem})
}

// dmMessages runs a message query for conversation c and shapes rows like the former direct_messages rows:
// recipient_id and read_at are derived (read_at = when the recipient last read up to that message).
func (s *server) dmMessages(ctx context.Context, c dmConv, me, other, query string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, query, c.id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(rw pgx.CollectableRow) (map[string]any, error) {
		var id, sender, body string
		var seq int64
		var created time.Time
		var pinnedAt *time.Time
		var pinnedBy, draft *string
		if err := rw.Scan(&id, &seq, &sender, &body, &created, &pinnedAt, &pinnedBy, &draft); err != nil {
			return nil, err
		}
		recipient, readSeq, readAt := other, c.partnerReadSeq, c.partnerReadAt
		if sender == other {
			recipient, readSeq, readAt = me, c.myReadSeq, c.myReadAt
		}
		var read *time.Time
		if seq <= readSeq {
			read = readAt
		}
		return map[string]any{"id": id, "sender_id": sender, "recipient_id": recipient, "message": body, "read_at": read,
			"created_at": created, "pinned_at": pinnedAt, "pinned_by": pinnedBy, "draft_id": draft}, nil
	})
}

// ---- send ------------------------------------------------------------------------------------------------------

// sendDM stores a message (optionally a draft card) in the pair's conversation, creating it the first time, and pings
// both people. Blocks are the caller's to check.
func (s *server) sendDM(ctx context.Context, me, other, body string, draftID *string) (map[string]any, error) {
	var msg map[string]any
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var conv string
		if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, dm_key) VALUES ('dm', $1)
			ON CONFLICT (dm_key) DO UPDATE SET dm_key = EXCLUDED.dm_key RETURNING id::text`, dmKey(me, other)).Scan(&conv); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)
			ON CONFLICT DO NOTHING`, conv, me, other); err != nil {
			return err
		}
		var id string
		var seq int64
		var created time.Time
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, body, draft_id) VALUES ($1, $2, $3, $4)
			RETURNING id::text, seq, created_at`, conv, me, body, draftID).Scan(&id, &seq, &created); err != nil {
			return err
		}
		// The sender has read their own message
		if _, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = $2 WHERE id = $1`, conv, created); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE conversation_members SET last_read_seq = $3, last_read_at = NOW()
			WHERE conversation_id = $1 AND user_id = $2`, conv, me, seq); err != nil {
			return err
		}
		msg = map[string]any{"id": id, "sender_id": me, "recipient_id": other, "message": body, "read_at": nil,
			"created_at": created, "pinned_at": nil, "draft_id": draftID}
		return nil
	})
	if err != nil {
		return nil, err
	}
	from := ""
	if ps, err := s.be.profiles(ctx, []string{me}); err == nil {
		from = ps[me].Username
	}
	s.publish(ctx, []string{me, other}, "dm", map[string]any{"from": from})
	return msg, nil
}

// POST /messages/{username} {message}
func (s *server) handleSend(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	var b struct {
		Message string `json:"message"`
	}
	readJSON(w, r, &b)
	body, err := text(b.Message, maxMessage, "Nội dung tin nhắn")
	if err != nil {
		answer(w, r, err)
		return
	}
	if !s.rate.allow(me, s.now()) {
		fail(w, 429, "Bạn nhắn quá nhanh.")
		return
	}
	p, err := s.partner(ctx, r.PathValue("username"))
	if err != nil {
		answer(w, r, err)
		return
	}
	if p.ID == me {
		fail(w, 400, "Bạn không thể tự nhắn tin cho mình.")
		return
	}
	byMe, byThem, err := s.blockState(ctx, me, p.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if byMe || byThem {
		fail(w, 403, blockedMsg)
		return
	}
	msg, err := s.sendDM(ctx, me, p.ID, body, nil)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": msg})
}

// POST /internal/dm {from, to, message, draft_id}: the backend sends a workspace draft card. 403 when either blocked the other.
func (s *server) handleInternalDM(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var b struct {
		From    string  `json:"from"`
		To      string  `json:"to"`
		Message string  `json:"message"`
		DraftID *string `json:"draft_id"`
	}
	if readJSON(w, r, &b) != nil || !isUUID(b.From) || !isUUID(b.To) || b.From == b.To || (b.DraftID != nil && !isUUID(*b.DraftID)) {
		fail(w, 400, "from, to, message")
		return
	}
	body, err := text(b.Message, maxMessage, "Nội dung tin nhắn")
	if err != nil {
		answer(w, r, err)
		return
	}
	byMe, byThem, err := s.blockState(ctx, b.From, b.To)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if byMe || byThem {
		fail(w, 403, blockedMsg)
		return
	}
	msg, err := s.sendDM(ctx, b.From, b.To, body, b.DraftID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": msg})
}

// ---- labels ----------------------------------------------------------------------------------------------------

func (s *server) handleLabels(w http.ResponseWriter, r *http.Request, me string) {
	rows, err := s.db.Query(r.Context(), `SELECT dl.id::text, dl.name, dl.color, count(lc.partner_id)::int
		FROM dm_labels dl LEFT JOIN dm_label_conversations lc ON lc.label_id = dl.id
		WHERE dl.user_id = $1 GROUP BY dl.id ORDER BY dl.created_at`, me)
	if err != nil {
		internalError(w, r, err)
		return
	}
	labels, err := pgx.CollectRows(rows, func(rw pgx.CollectableRow) (map[string]any, error) {
		var id, name, color string
		var n int
		err := rw.Scan(&id, &name, &color, &n)
		return map[string]any{"id": id, "name": name, "color": color, "conversation_count": n}, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"labels": labels})
}

type labelBody struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

func (lb labelBody) check(partial bool) (name, color *string, err error) {
	if !partial || lb.Name != nil {
		n := ""
		if lb.Name != nil {
			n = *lb.Name
		}
		v, err := text(n, maxLabelName, "Tên nhãn")
		if err != nil {
			return nil, nil, err
		}
		name = &v
	}
	if !partial || lb.Color != nil {
		c := "sky"
		if lb.Color != nil {
			c = *lb.Color
		}
		if !labelColors[c] {
			return nil, nil, bad("Màu nhãn không hợp lệ.")
		}
		color = &c
	}
	return name, color, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (s *server) handleCreateLabel(w http.ResponseWriter, r *http.Request, me string) {
	var b labelBody
	readJSON(w, r, &b)
	name, color, err := b.check(false)
	if err != nil {
		answer(w, r, err)
		return
	}
	ctx := r.Context()
	var n int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM dm_labels WHERE user_id = $1`, me).Scan(&n); err != nil {
		internalError(w, r, err)
		return
	}
	if n >= maxLabels {
		fail(w, 400, "Tối đa 20 nhãn.")
		return
	}
	var id string
	err = s.db.QueryRow(ctx, `INSERT INTO dm_labels (user_id, name, color) VALUES ($1, $2, $3) RETURNING id::text`, me, *name, *color).Scan(&id)
	if isUniqueViolation(err) {
		fail(w, 400, "Bạn đã có nhãn tên này.")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": map[string]any{"id": id, "name": *name, "color": *color, "conversation_count": 0}})
}

func (s *server) handleUpdateLabel(w http.ResponseWriter, r *http.Request, me string) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 400, "Nhãn không hợp lệ.")
		return
	}
	var b labelBody
	readJSON(w, r, &b)
	name, color, err := b.check(true)
	if err != nil {
		answer(w, r, err)
		return
	}
	var n, c string
	err = s.db.QueryRow(r.Context(), `UPDATE dm_labels SET name = COALESCE($3, name), color = COALESCE($4, color)
		WHERE id = $1 AND user_id = $2 RETURNING name, color`, id, me, name, color).Scan(&n, &c)
	switch {
	case isUniqueViolation(err):
		fail(w, 400, "Bạn đã có nhãn tên này.")
	case errors.Is(err, pgx.ErrNoRows):
		fail(w, 404, "Không tìm thấy nhãn.")
	case err != nil:
		internalError(w, r, err)
	default:
		ok(w, map[string]any{"id": id, "name": n, "color": c})
	}
}

func (s *server) handleDeleteLabel(w http.ResponseWriter, r *http.Request, me string) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 400, "Nhãn không hợp lệ.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM dm_labels WHERE id = $1 AND user_id = $2`, id, me)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Không tìm thấy nhãn.")
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa nhãn."})
}

// PUT /messages/{username}/labels {label_ids}: replace the labels I put on my conversation with this person.
func (s *server) handleSetLabels(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	var b struct {
		LabelIDs []string `json:"label_ids"`
	}
	if readJSON(w, r, &b) != nil || b.LabelIDs == nil || len(b.LabelIDs) > maxLabels {
		fail(w, 400, "Danh sách nhãn không hợp lệ.")
		return
	}
	set := map[string]bool{}
	for _, id := range b.LabelIDs {
		if !isUUID(id) {
			fail(w, 400, "Danh sách nhãn không hợp lệ.")
			return
		}
		set[strings.ToLower(id)] = true
	}
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	p, err := s.partner(ctx, r.PathValue("username"))
	if err != nil {
		answer(w, r, err)
		return
	}
	var owned int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM dm_labels WHERE user_id = $1 AND id = ANY($2::uuid[])`, me, ids).Scan(&owned); err != nil {
		internalError(w, r, err)
		return
	}
	if owned != len(ids) {
		fail(w, 400, "Có nhãn không thuộc về bạn.")
		return
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM dm_label_conversations lc USING dm_labels dl
			WHERE dl.id = lc.label_id AND dl.user_id = $1 AND lc.partner_id = $2`, me, p.ID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO dm_label_conversations (label_id, partner_id) SELECT unnest($1::uuid[]), $2 ON CONFLICT DO NOTHING`, ids, p.ID)
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"label_ids": ids})
}

// ---- block / pin -----------------------------------------------------------------------------------------------

func (s *server) handleBlock(block bool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, me string) {
		ctx := r.Context()
		p, err := s.partner(ctx, r.PathValue("username"))
		if err != nil {
			answer(w, r, err)
			return
		}
		if p.ID == me {
			fail(w, 400, "Bạn không thể tự chặn mình.")
			return
		}
		name := p.Username
		if p.DisplayName != nil && *p.DisplayName != "" {
			name = *p.DisplayName
		}
		msg := "Đã bỏ chặn " + name + "."
		if block {
			_, err = s.db.Exec(ctx, `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, me, p.ID)
			msg = "Đã chặn " + name + "."
		} else {
			_, err = s.db.Exec(ctx, `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`, me, p.ID)
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		s.publish(ctx, []string{me}, "dm", map[string]any{}) // only my tabs: telling them would reveal the block
		writeJSON(w, 200, map[string]any{"success": true, "message": msg})
	}
}

// Pin (POST) or unpin (DELETE) a message of my conversation with this person. Both people see pins.
func (s *server) handlePin(pin bool) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, r *http.Request, me string) {
		ctx := r.Context()
		msgID := r.PathValue("messageId")
		if !isUUID(msgID) {
			fail(w, 400, "Tin nhắn không hợp lệ.")
			return
		}
		p, err := s.partner(ctx, r.PathValue("username"))
		if err != nil {
			answer(w, r, err)
			return
		}
		key := dmKey(me, p.ID)
		if pin {
			var n int
			if err := s.db.QueryRow(ctx, `SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE c.dm_key = $1 AND m.pinned_at IS NOT NULL AND m.id <> $2`, key, msgID).Scan(&n); err != nil {
				internalError(w, r, err)
				return
			}
			if n >= maxPins {
				fail(w, 400, "Mỗi cuộc trò chuyện ghim tối đa 10 tin. Bỏ ghim bớt trước.")
				return
			}
		}
		q := `UPDATE messages m SET pinned_at = NULL, pinned_by = NULL FROM conversations c
			WHERE c.id = m.conversation_id AND c.dm_key = $1 AND m.id = $2 AND $3::uuid IS NOT NULL RETURNING m.id::text, m.pinned_at`
		if pin {
			q = `UPDATE messages m SET pinned_at = COALESCE(m.pinned_at, NOW()), pinned_by = COALESCE(m.pinned_by, $3) FROM conversations c
				WHERE c.id = m.conversation_id AND c.dm_key = $1 AND m.id = $2 RETURNING m.id::text, m.pinned_at`
		}
		var id string
		var at *time.Time
		err = s.db.QueryRow(ctx, q, key, msgID, me).Scan(&id, &at)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 404, "Không tìm thấy tin nhắn.")
			return
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		s.publish(ctx, []string{me, p.ID}, "dm", map[string]any{})
		msg := "Đã bỏ ghim."
		if pin {
			msg = "Đã ghim tin nhắn."
		}
		okMsg(w, msg, map[string]any{"id": id, "pinned_at": at})
	}
}
