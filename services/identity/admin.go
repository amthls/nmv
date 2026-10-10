package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Same rules as the backend's moderationRights:
//   - nobody acts on themselves or on an admin;
//   - admins act on everyone else, mods only on regular users (not on other mods);
//   - admins and mods may make a regular user a mod; only admins take the mod role away.
type target struct {
	ID       string
	Username string
	Roles    []string
	Banned   bool
	Deleted  bool
}

func (t target) has(role string) bool {
	for _, r := range t.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type rights struct{ Ban, Unban, Delete, GrantMod, RevokeMod bool }

func moderationRights(actor caller, t target) rights {
	actorAdmin, actorMod := actor.has("admin"), actor.has("mod")
	self := actor.ID == t.ID
	outranks := !self && !t.has("admin") && (actorAdmin || (actorMod && !t.has("mod")))
	alive := !t.Deleted
	return rights{
		Ban:       alive && outranks && !t.Banned,
		Unban:     alive && outranks && t.Banned,
		Delete:    alive && outranks,
		GrantMod:  alive && !self && !t.Banned && !t.has("admin") && !t.has("mod") && (actorAdmin || actorMod),
		RevokeMod: alive && !self && actorAdmin && t.has("mod"),
	}
}

func loadTarget(ctx context.Context, q pgx.Tx, id string) (target, error) {
	t := target{ID: id}
	err := q.QueryRow(ctx, `SELECT username::text, is_banned, deleted_at IS NOT NULL,
		COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = users.id), '{}')
		FROM users WHERE id = $1 FOR UPDATE`, id).Scan(&t.Username, &t.Banned, &t.Deleted, &t.Roles)
	return t, err
}

// confirmPassword: dangerous actions ask the actor for their password again (a stolen session alone isn't enough).
func (s *server) confirmPassword(ctx context.Context, r *http.Request, c caller, pw string) bool {
	var hash string
	if pw == "" || s.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, c.ID).Scan(&hash) != nil || !checkPassword(pw, hash) {
		securityLog(ctx, s.db, c.ID, "", "reauth_failed", r, map[string]any{"path": r.URL.Path})
		return false
	}
	return true
}

const msgReauth = "Mật khẩu xác nhận không đúng."

var roleNameVi = map[string]string{"admin": "Quản trị viên (Admin)", "mod": "Kiểm duyệt viên (Mod)", "translator": "Dịch giả", "author": "Tác giả", "reader": "Độc giả"}

// POST /users/{id}/roles {role, action: grant|revoke, password}
func (s *server) handleRoles(w http.ResponseWriter, r *http.Request, c caller) {
	var b struct {
		Role, Action, Password string
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "Dữ liệu gửi lên không hợp lệ.")
		return
	}
	id := r.PathValue("id")
	if _, okRole := roleNameVi[b.Role]; !okRole {
		fail(w, 400, "Vai trò không hợp lệ. Các vai trò hợp lệ: admin, mod, translator, author, reader")
		return
	}
	if b.Action != "grant" && b.Action != "revoke" {
		fail(w, 400, "Hành động không hợp lệ. Vui lòng chọn 'grant' hoặc 'revoke'.")
		return
	}
	if !isUUID(id) {
		fail(w, 404, "Người dùng không tồn tại.")
		return
	}
	if !c.has("admin") && !(c.has("mod") && b.Role == "mod" && b.Action == "grant") {
		fail(w, 403, "Chỉ Quản trị viên (Admin) mới có quyền phân quyền người dùng này.")
		return
	}
	ctx := r.Context()
	if !s.confirmPassword(ctx, r, c, b.Password) {
		fail(w, 403, msgReauth)
		return
	}
	var status int
	var msg string
	var roles []roleView
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		t, err := loadTarget(ctx, tx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && t.Deleted) {
			status, msg = 404, "Người dùng không tồn tại."
			return errRollback
		}
		if err != nil {
			return err
		}
		switch {
		case !c.has("admin") && !moderationRights(c, t).GrantMod:
			status, msg = 403, "Chỉ Quản trị viên (Admin) mới có quyền phân quyền người dùng này."
		case b.Action == "grant" && t.Banned:
			status, msg = 400, "Không thể cấp quyền cho tài khoản đang bị khóa."
		case id == c.ID && b.Role == "admin" && b.Action == "revoke":
			status, msg = 400, "Bạn không thể tự gỡ bỏ quyền Admin của chính mình."
		}
		if status != 0 {
			return errRollback
		}
		if b.Action == "grant" {
			_, err = tx.Exec(ctx, `INSERT INTO user_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
				ON CONFLICT (user_id, role) DO UPDATE SET is_visible = TRUE`, id, b.Role, c.ID)
		} else {
			_, err = tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1 AND role = $2`, id, b.Role)
		}
		if err != nil {
			return err
		}
		if err = securityLog(ctx, tx, id, c.ID, "role_"+b.Action, r, map[string]any{"role": b.Role}); err != nil {
			return err
		}
		if err = userEvent(ctx, tx, id, "updated", nil); err != nil {
			return err
		}
		if b.Action == "grant" {
			msg = "Đã cấp quyền " + roleNameVi[b.Role] + " cho người dùng " + t.Username + " thành công!"
		} else {
			msg = "Đã thu hồi quyền " + roleNameVi[b.Role] + " của người dùng " + t.Username + "!"
		}
		u, err := loadUserView(ctx, tx, id)
		roles = u.Roles
		return err
	})
	if status != 0 {
		fail(w, status, msg)
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	s.forgetRoles(ctx, id)
	ok(w, msg, map[string]any{"userId": id, "roles": roles})
}

// POST /users/{id}/ban {reason, password} and /unban {password}. A ban ends every session at once.
func (s *server) handleBan(ban bool) func(http.ResponseWriter, *http.Request, caller) {
	return func(w http.ResponseWriter, r *http.Request, c caller) {
		var b struct{ Reason, Password string }
		readJSON(w, r, &b)
		id := r.PathValue("id")
		if !isUUID(id) {
			fail(w, 404, "Người dùng không tồn tại.")
			return
		}
		if !c.has("admin") && !c.has("mod") {
			fail(w, 403, "Bạn không có quyền thực hiện thao tác này.")
			return
		}
		reason := strings.TrimSpace(b.Reason)
		if len([]rune(reason)) > 500 {
			fail(w, 400, "Lý do tối đa 500 ký tự.")
			return
		}
		if reason == "" {
			reason = "Vi phạm điều khoản cộng đồng"
		}
		ctx := r.Context()
		if !s.confirmPassword(ctx, r, c, b.Password) {
			fail(w, 403, msgReauth)
			return
		}
		var status int
		var msg string
		var sids []string
		err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
			t, err := loadTarget(ctx, tx, id)
			if errors.Is(err, pgx.ErrNoRows) {
				status, msg = 404, "Người dùng không tồn tại."
				return errRollback
			}
			if err != nil {
				return err
			}
			can := moderationRights(c, t)
			if (ban && !can.Ban) || (!ban && !can.Unban) {
				already := (ban && t.Banned) || (!ban && !t.Banned)
				status, msg = 403, "Bạn không có quyền thực hiện thao tác này với tài khoản này."
				if already && !t.Deleted {
					status = 409
					msg = map[bool]string{true: "Tài khoản này đã bị khóa.", false: "Tài khoản này không bị khóa."}[ban]
				}
				return errRollback
			}
			if ban {
				_, err = tx.Exec(ctx, `UPDATE users SET is_banned = TRUE, ban_reason = $2, banned_at = NOW(), banned_by = $3 WHERE id = $1`, id, reason, c.ID)
				if err == nil {
					sids, err = revokeUserSessions(ctx, tx, id, "", "banned")
				}
				msg = "Đã khóa tài khoản " + t.Username + "."
			} else {
				_, err = tx.Exec(ctx, `UPDATE users SET is_banned = FALSE, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE id = $1`, id)
				msg = "Đã mở khóa tài khoản " + t.Username + "."
			}
			if err != nil {
				return err
			}
			if err = securityLog(ctx, tx, id, c.ID, map[bool]string{true: "banned", false: "unbanned"}[ban], r, map[string]any{"reason": reason}); err != nil {
				return err
			}
			return userEvent(ctx, tx, id, "updated", nil)
		})
		if status != 0 {
			fail(w, status, msg)
			return
		}
		if err != nil {
			internalError(w, r, err)
			return
		}
		s.markRevoked(ctx, sids...)
		ok(w, msg, nil)
	}
}

// DELETE /users/{id} {purge_content, password}: anonymise and lock the account. Content stays (the backend hides
// posts/comments when purge_content). The backend is asked first whether it can let the user go (sole group leader).
func (s *server) handleDeleteUser(w http.ResponseWriter, r *http.Request, c caller) {
	var b struct {
		PurgeContent bool   `json:"purge_content"`
		Password     string `json:"password"`
	}
	readJSON(w, r, &b)
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Người dùng không tồn tại.")
		return
	}
	if !c.has("admin") && !c.has("mod") {
		fail(w, 403, "Bạn không có quyền xóa tài khoản này.")
		return
	}
	ctx := r.Context()
	if !s.confirmPassword(ctx, r, c, b.Password) {
		fail(w, 403, msgReauth)
		return
	}
	if blocked, err := s.backendDeleteCheck(ctx, c, id); err != nil {
		internalError(w, r, err)
		return
	} else if blocked != "" {
		fail(w, 409, blocked)
		return
	}
	var status int
	var msg string
	var sids []string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		t, err := loadTarget(ctx, tx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			status, msg = 404, "Người dùng không tồn tại."
			return errRollback
		}
		if err != nil {
			return err
		}
		if !moderationRights(c, t).Delete {
			status, msg = 403, "Bạn không có quyền xóa tài khoản này."
			if t.Deleted {
				status, msg = 409, "Tài khoản này đã bị xóa."
			}
			return errRollback
		}
		short := strings.ReplaceAll(id, "-", "")[:12]
		if _, err = tx.Exec(ctx, `UPDATE users SET username = $2, email = $3, password_hash = '!', display_name = 'Người dùng đã xóa',
			email_verified = FALSE, is_banned = TRUE, ban_reason = 'Tài khoản đã bị xóa', banned_at = NOW(), banned_by = $4,
			deleted_at = NOW(), deleted_by = $4 WHERE id = $1`, id, "deleted_"+short, "deleted+"+id+"@deleted.invalid", c.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1`, id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM account_tokens WHERE user_id = $1`, id); err != nil {
			return err
		}
		if sids, err = revokeUserSessions(ctx, tx, id, "", "deleted"); err != nil {
			return err
		}
		if err = securityLog(ctx, tx, id, c.ID, "deleted", r, map[string]any{"purge_content": b.PurgeContent}); err != nil {
			return err
		}
		msg = "Đã xóa tài khoản " + t.Username
		if b.PurgeContent {
			msg += " cùng các bài viết và bình luận"
		}
		msg += "."
		return userEvent(ctx, tx, id, "deleted", map[string]any{"purge_content": b.PurgeContent})
	})
	if status != 0 {
		fail(w, status, msg)
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	s.markRevoked(ctx, sids...)
	s.forgetRoles(ctx, id)
	ok(w, msg, nil)
}

// backendDeleteCheck asks the backend (it owns groups) whether deleting the user would leave a group without a
// leader. The request carries the actor's signed identity headers, like a request coming through the gateway.
func (s *server) backendDeleteCheck(ctx context.Context, c caller, id string) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", s.cfg.BackendURL+"/internal/users/"+id+"/delete-check", nil)
	s.signHeaders(req.Header, c.ID, strings.Join(c.Roles, ","))
	if rid, _ := ctx.Value(requestIDKey).(string); rid != "" {
		req.Header.Set("X-Request-Id", rid)
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	var body struct {
		OK      bool   `json:"ok"`
		Message string `json:"message"`
	}
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&body) != nil {
		return "", errors.New("backend delete-check: status " + res.Status)
	}
	if !body.OK {
		return body.Message, nil
	}
	return "", nil
}

// GET /admin/users?q= (Admin/Mod): find accounts by username or email; the only place emails are listed.
func (s *server) handleLookup(w http.ResponseWriter, r *http.Request, c caller) {
	if !c.has("admin") && !c.has("mod") {
		fail(w, 403, "Bạn không có quyền xem danh sách này.")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) > 100 {
		q = string([]rune(q)[:100])
	}
	like := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
	rows, err := s.db.Query(r.Context(), `SELECT id::text, username::text, email::text, email_verified, is_banned, deleted_at IS NOT NULL, last_login_at, created_at,
		COALESCE((SELECT array_agg(role ORDER BY role) FROM user_roles WHERE user_id = users.id), '{}')
		FROM users WHERE $1 = '' OR username ILIKE $2 OR email ILIKE $2 ORDER BY created_at DESC LIMIT 50`, q, like)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type item struct {
		ID            string     `json:"id"`
		Username      string     `json:"username"`
		Email         string     `json:"email"`
		EmailVerified bool       `json:"email_verified"`
		IsBanned      bool       `json:"is_banned"`
		Deleted       bool       `json:"deleted"`
		LastLogin     *time.Time `json:"last_login_at"`
		Created       time.Time  `json:"created_at"`
		Roles         []string   `json:"roles"`
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (item, error) {
		var x item
		return x, row.Scan(&x.ID, &x.Username, &x.Email, &x.EmailVerified, &x.IsBanned, &x.Deleted, &x.LastLogin, &x.Created, &x.Roles)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "", list)
}

// GET /users/{id}/private (Admin/Mod): email and login facts for the moderation block on a profile page.
func (s *server) handlePrivate(w http.ResponseWriter, r *http.Request, c caller) {
	if !c.has("admin") && !c.has("mod") {
		fail(w, 403, "Bạn không có quyền xem thông tin này.")
		return
	}
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Người dùng không tồn tại.")
		return
	}
	var email string
	var verified bool
	var lastLogin, lockedUntil *time.Time
	err := s.db.QueryRow(r.Context(), `SELECT email::text, email_verified, last_login_at, locked_until FROM users WHERE id = $1`, id).
		Scan(&email, &verified, &lastLogin, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "Người dùng không tồn tại.")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "", map[string]any{"email": email, "email_verified": verified, "last_login_at": lastLogin, "locked_until": lockedUntil})
}

// POST /admin/revoke-all-sessions {password} (Admin): everyone signs in again (e.g. after a suspected breach).
func (s *server) handleRevokeAll(w http.ResponseWriter, r *http.Request, c caller) {
	var b struct{ Password string }
	readJSON(w, r, &b)
	if !c.has("admin") {
		fail(w, 403, "Chỉ Quản trị viên (Admin) mới làm được việc này.")
		return
	}
	ctx := r.Context()
	if !s.confirmPassword(ctx, r, c, b.Password) {
		fail(w, 403, msgReauth)
		return
	}
	var sids []string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'revoke_all' WHERE revoked_at IS NULL RETURNING id::text`)
		if err != nil {
			return err
		}
		if sids, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		return securityLog(ctx, tx, "", c.ID, "revoke_all_sessions", r, map[string]any{"sessions": len(sids)})
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	s.markRevoked(ctx, sids...)
	s.clearSessionCookies(w, r)
	ok(w, "Đã đăng xuất mọi tài khoản trên mọi thiết bị ("+itoa(len(sids))+" phiên).", nil)
}
