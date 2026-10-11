package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// Translation group chat: a "group" conversation per group. Who belongs to the group (and their role) is the
// backend's: asked and cached 30 s (backend.members). Same JSON as the former /api/v1/groups/:id/messages.

// groupRole: my role in the group ("" = not a member); a miss is re-asked once, so someone who just joined is in.
func (s *server) groupRole(ctx context.Context, groupID, me string) (string, []member, error) {
	find := func(ms []member) string {
		for _, m := range ms {
			if m.UserID == me {
				return m.Role
			}
		}
		return ""
	}
	ms, err := s.be.members(ctx, groupID)
	if err != nil {
		return "", nil, err
	}
	if role := find(ms); role != "" {
		return role, ms, nil
	}
	s.be.forgetGroup(groupID)
	if ms, err = s.be.members(ctx, groupID); err != nil {
		return "", nil, err
	}
	return find(ms), ms, nil
}

func (s *server) groupAccess(w http.ResponseWriter, r *http.Request, me, forbidden string) (string, string, []member, bool) {
	gid := r.PathValue("id")
	if !isUUID(gid) {
		fail(w, 404, "Nhóm dịch không tồn tại")
		return "", "", nil, false
	}
	role, ms, err := s.groupRole(r.Context(), gid, me)
	if errors.Is(err, errNoGroup) {
		fail(w, 404, "Nhóm dịch không tồn tại")
		return "", "", nil, false
	}
	if err != nil {
		internalError(w, r, err)
		return "", "", nil, false
	}
	if role == "" {
		fail(w, 403, forbidden)
		return "", "", nil, false
	}
	return gid, role, ms, true
}

// GET /groups/{id}/messages: the latest 100 (oldest first), members only.
func (s *server) handleGroupMessages(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	gid, _, ms, okay := s.groupAccess(w, r, me, "Chỉ thành viên nhóm mới xem được chatroom nội bộ.")
	if !okay {
		return
	}
	rows, err := s.db.Query(ctx, `SELECT * FROM (SELECT m.id::text, m.seq, m.sender_id::text, m.body, m.created_at
		FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.group_id = $1
		ORDER BY m.seq DESC LIMIT 100) latest ORDER BY seq`, gid)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type row struct {
		id, sender, body string
		created          time.Time
	}
	list, err := pgx.CollectRows(rows, func(rw pgx.CollectableRow) (row, error) {
		var x row
		var seq int64
		err := rw.Scan(&x.id, &seq, &x.sender, &x.body, &x.created)
		return x, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ids := make([]string, len(list))
	for i, x := range list {
		ids[i] = x.sender
	}
	profiles, err := s.be.profiles(ctx, ids)
	if err != nil {
		internalError(w, r, err)
		return
	}
	roles := map[string]string{}
	for _, m := range ms {
		roles[m.UserID] = m.Role
	}
	out := []map[string]any{}
	for _, x := range list {
		out = append(out, groupMessage(x.id, gid, x.sender, x.body, x.created, profiles[x.sender], roles[x.sender]))
	}
	ok(w, out)
}

func groupMessage(id, gid, sender, body string, created time.Time, p profile, role string) map[string]any {
	var r *string
	if role != "" {
		r = &role
	}
	var username *string
	if p.Username != "" {
		username = &p.Username
	}
	return map[string]any{"id": id, "group_id": gid, "user_id": sender, "message": body, "attachments": []any{},
		"created_at": created, "username": username, "display_name": p.DisplayName, "avatar_url": p.AvatarURL, "member_role": r}
}

// POST /groups/{id}/messages {message}: members only; every member's tabs get `group_message`.
func (s *server) handleGroupSend(w http.ResponseWriter, r *http.Request, me string) {
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
	gid, role, ms, okay := s.groupAccess(w, r, me, "Chỉ thành viên trong nhóm mới có quyền gửi tin nhắn trong chatroom nội bộ.")
	if !okay {
		return
	}
	if !s.rate.allow(me, s.now()) {
		fail(w, 429, "Bạn nhắn quá nhanh.")
		return
	}
	var id string
	var created time.Time
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var conv string
		if err := tx.QueryRow(ctx, `INSERT INTO conversations (kind, group_id) VALUES ('group', $1)
			ON CONFLICT (group_id) DO UPDATE SET group_id = EXCLUDED.group_id RETURNING id::text`, gid).Scan(&conv); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)
			RETURNING id::text, created_at`, conv, me, body).Scan(&id, &created); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE conversations SET last_message_at = $2 WHERE id = $1`, conv, created)
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	profiles, _ := s.be.profiles(ctx, []string{me})
	users := make([]string, len(ms))
	for i, m := range ms {
		users[i] = m.UserID
	}
	s.publish(ctx, users, "group_message", map[string]any{"groupId": gid})
	writeJSON(w, 201, map[string]any{"success": true, "data": groupMessage(id, gid, me, body, created, profiles[me], role)})
}

// DELETE /groups/{id}/messages/{messageId}: my own message, or any as the group's leader/mod.
func (s *server) handleGroupDelete(w http.ResponseWriter, r *http.Request, me string) {
	ctx := r.Context()
	gid, msgID := r.PathValue("id"), r.PathValue("messageId")
	if !isUUID(gid) || !isUUID(msgID) {
		fail(w, 404, "Tin nhắn không tồn tại")
		return
	}
	var sender string
	err := s.db.QueryRow(ctx, `SELECT m.sender_id::text FROM messages m JOIN conversations c ON c.id = m.conversation_id
		WHERE m.id = $1 AND c.group_id = $2`, msgID, gid).Scan(&sender)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "Tin nhắn không tồn tại")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if sender != me {
		role, _, err := s.groupRole(ctx, gid, me)
		if err != nil && !errors.Is(err, errNoGroup) {
			internalError(w, r, err)
			return
		}
		if role != "leader" && role != "mod" {
			fail(w, 403, "Bạn chỉ có thể xóa tin nhắn của chính mình.")
			return
		}
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM messages WHERE id = $1`, msgID); err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa tin nhắn"})
}
