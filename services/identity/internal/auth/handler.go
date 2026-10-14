// Package auth: sign-up, sign-in, sign-out, passwords (argon2id, lockout), password reset and email verification.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	mail "nmv/identity/internal/email"
	"nmv/identity/internal/platform/db"
	"nmv/identity/internal/platform/events"
	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/seclog"
	"nmv/identity/internal/sessions"
	"nmv/identity/internal/tokens"
)

// Humans is the optional bot check on the public forms.
type Humans interface {
	OK(w http.ResponseWriter, r *http.Request, token string) bool
}

// Handler serves the account routes.
type Handler struct {
	db        *pgxpool.Pool
	sess      *sessions.Service
	humans    Humans
	siteURL   string
	jwtSecret []byte
	now       func() time.Time
}

// NewHandler wires the handler.
func NewHandler(db *pgxpool.Pool, sess *sessions.Service, humans Humans, siteURL string, jwtSecret []byte, now func() time.Time) *Handler {
	return &Handler{db: db, sess: sess, humans: humans, siteURL: siteURL, jwtSecret: jwtSecret, now: now}
}

// ---- register / login / logout ------------------------------------------------------------------------

// Register handles the Register route.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Username    string  `json:"username"`
		Email       string  `json:"email"`
		Password    string  `json:"password"`
		DisplayName *string `json:"display_name"`
		Turnstile   string  `json:"turnstile_token"`
	}
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "Dữ liệu gửi lên không hợp lệ.")
		return
	}
	username := strings.TrimSpace(b.Username)
	email := strings.ToLower(strings.TrimSpace(b.Email))
	display := username
	if b.DisplayName != nil && strings.TrimSpace(*b.DisplayName) != "" {
		display = strings.TrimSpace(*b.DisplayName)
	}
	switch {
	case username == "" || email == "" || b.Password == "":
		httpx.Fail(w, 400, "Vui lòng điền đầy đủ username, email và mật khẩu.")
		return
	case !usernameRe.MatchString(username):
		httpx.Fail(w, 400, "Tên đăng nhập phải từ 3 đến 30 ký tự, chỉ gồm chữ không dấu, số và dấu _ . -")
		return
	case len(email) > 255 || !mail.EmailRe.MatchString(email):
		httpx.Fail(w, 400, "Email không đúng định dạng.")
		return
	case len([]rune(display)) > 100:
		httpx.Fail(w, 400, "Tên hiển thị tối đa 100 ký tự.")
		return
	}
	if p := PasswordProblem(b.Password, username, email); p != "" {
		httpx.Fail(w, 400, p)
		return
	}
	if !h.humans.OK(w, r, b.Turnstile) {
		return
	}

	ctx, now := r.Context(), h.now()
	uid := tokens.NewUUID()
	var sid, refresh string
	var user UserView
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO users (id, username, email, password_hash, display_name, last_login_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
			uid, username, email, HashPassword(b.Password), display)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1, 'reader')`, uid); err != nil {
			return err
		}
		if sid, refresh, err = sessions.CreateSession(ctx, tx, uid, r, now); err != nil {
			return err
		}
		token, err := tokens.CreateAccount(ctx, tx, uid, "verify_email")
		if err == nil {
			err = mail.Enqueue(ctx, tx, email, "Xác thực email NovelHub",
				"Nhấn vào liên kết dưới đây để xác thực email cho tài khoản NovelHub của bạn (hiệu lực 24 giờ).",
				"Xác thực email", h.siteURL+"/xac-thuc-email?token="+token)
		}
		if err == nil {
			err = seclog.Log(ctx, tx, uid, "", "register", r, nil)
		}
		if err == nil {
			err = events.UserEvent(ctx, tx, uid, "created", nil)
		}
		if err == nil {
			user, err = LoadUserView(ctx, tx, uid)
		}
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if strings.Contains(pgErr.ConstraintName, "username") {
			httpx.Fail(w, 400, "Tên đăng nhập này đã được sử dụng.")
		} else {
			httpx.Fail(w, 400, "Email này đã được sử dụng.")
		}
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if err := h.sess.Issue(w, r, uid, sid, refresh); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "message": "Đăng ký tài khoản thành công! Bạn đã tự động đăng nhập.", "data": map[string]any{"user": user}})
}

// Login handles the Login route.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if httpx.ReadJSON(w, r, &b) != nil || strings.TrimSpace(b.Identifier) == "" || b.Password == "" {
		httpx.Fail(w, 400, "Vui lòng nhập tên đăng nhập/email và mật khẩu.")
		return
	}
	ctx, now := r.Context(), h.now()
	var uid, hash string
	var banned, deleted bool
	var banReason *string
	var lockedUntil *time.Time
	err := h.db.QueryRow(ctx, `SELECT id::text, password_hash, is_banned, deleted_at IS NOT NULL, ban_reason, locked_until
		FROM users WHERE username = $1 OR email = $1 LIMIT 1`, strings.TrimSpace(b.Identifier)).
		Scan(&uid, &hash, &banned, &deleted, &banReason, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) || deleted {
		CheckPassword(b.Password, dummyHash) // same time as a wrong password
		httpx.Fail(w, 400, msgBadLogin)
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if lockedUntil != nil && lockedUntil.After(now) {
		mins := int(lockedUntil.Sub(now).Minutes()) + 1
		httpx.Fail(w, 429, "Tài khoản tạm khóa do nhập sai mật khẩu nhiều lần. Thử lại sau "+httpx.Itoa(mins)+" phút hoặc dùng \"Quên mật khẩu\".")
		return
	}
	if !CheckPassword(b.Password, hash) {
		err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
			if err := seclog.Log(ctx, tx, uid, "", "login_failed", r, nil); err != nil {
				return err
			}
			var recent int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM security_log WHERE user_id = $1 AND event = 'login_failed'
				AND created_at > GREATEST(NOW() - $2::interval, COALESCE((SELECT last_login_at FROM users WHERE id = $1), 'epoch'),
				                         COALESCE((SELECT MAX(created_at) FROM security_log WHERE user_id = $1 AND event = 'locked'), 'epoch'))`,
				uid, lockWindow.String()).Scan(&recent); err != nil {
				return err
			}
			if recent >= LockAfter {
				if _, err := tx.Exec(ctx, `UPDATE users SET locked_until = NOW() + $2::interval WHERE id = $1`, uid, lockWindow.String()); err != nil {
					return err
				}
				return seclog.Log(ctx, tx, uid, "", "locked", r, nil)
			}
			return nil
		})
		if err != nil {
			httpx.InternalError(w, r, err)
			return
		}
		httpx.Fail(w, 400, msgBadLogin)
		return
	}
	if banned { // only after the right password: a ban is not revealed to someone guessing
		reason := "Vi phạm điều khoản cộng đồng"
		if banReason != nil && *banReason != "" {
			reason = *banReason
		}
		httpx.Fail(w, 403, "Tài khoản đã bị khóa. Lý do: "+reason)
		return
	}

	var sid, refresh string
	var user UserView
	err = pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		if NeedsRehash(hash) {
			if _, err = tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, uid, HashPassword(b.Password)); err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, `UPDATE users SET last_login_at = NOW(), locked_until = NULL WHERE id = $1`, uid); err != nil {
			return err
		}
		if sid, refresh, err = sessions.CreateSession(ctx, tx, uid, r, now); err != nil {
			return err
		}
		if err = seclog.Log(ctx, tx, uid, "", "login_ok", r, map[string]any{"session": sid}); err != nil {
			return err
		}
		user, err = LoadUserView(ctx, tx, uid)
		return err
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if err := h.sess.Issue(w, r, uid, sid, refresh); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, "Đăng nhập thành công! Phiên đăng nhập lưu 30 ngày.", map[string]any{"user": user})
}

// POST /logout ends this device's session (works even with an expired access token, via the refresh cookie).
// Logout handles the Logout route.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var sid string
	if ck, err := r.Cookie(sessions.CookieAccess); err == nil {
		_, sid, _ = tokens.ParseAccess(h.jwtSecret, ck.Value)
	}
	if sid == "" {
		if ck, err := r.Cookie(sessions.CookieRefresh); err == nil {
			h.db.QueryRow(ctx, `SELECT id::text FROM sessions WHERE refresh_hash = $1`, tokens.SHA256Hex(ck.Value)).Scan(&sid)
		}
	}
	if sid != "" {
		var uid string
		err := h.db.QueryRow(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL RETURNING user_id::text`, sid).Scan(&uid)
		if err == nil {
			h.sess.MarkRevoked(ctx, sid)
			seclog.Log(ctx, h.db, uid, "", "logout", r, map[string]any{"session": sid})
		}
	}
	h.sess.ClearSessionCookies(w, r)
	httpx.OK(w, "Đăng xuất thành công!", nil)
}

// LogoutAll handles the LogoutAll route.
func (h *Handler) LogoutAll(w http.ResponseWriter, r *http.Request, c sessions.Caller) {
	ctx := r.Context()
	var sids []string
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		if sids, err = sessions.RevokeUserSessions(ctx, tx, c.ID, "", "logout_all"); err != nil {
			return err
		}
		return seclog.Log(ctx, tx, c.ID, "", "logout_all", r, map[string]any{"sessions": len(sids)})
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	h.sess.MarkRevoked(ctx, sids...)
	h.sess.ClearSessionCookies(w, r)
	httpx.OK(w, "Đã đăng xuất khỏi mọi thiết bị.", nil)
}

// Me handles the Me route.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request, c sessions.Caller) {
	var u UserView
	err := pgx.BeginFunc(r.Context(), h.db, func(tx pgx.Tx) (err error) { u, err = LoadUserView(r.Context(), tx, c.ID); return })
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, "", u)
}

// Change password while signed in: needs the current one; every other device is logged out, this one stays.
// ChangePassword handles the ChangePassword route.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request, c sessions.Caller) {
	var b struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if httpx.ReadJSON(w, r, &b) != nil || b.Current == "" {
		httpx.Fail(w, 400, "Vui lòng nhập mật khẩu hiện tại.")
		return
	}
	ctx := r.Context()
	var hash, username, email string
	if err := h.db.QueryRow(ctx, `SELECT password_hash, username::text, email::text FROM users WHERE id = $1`, c.ID).Scan(&hash, &username, &email); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if p := PasswordProblem(b.New, username, email); p != "" {
		httpx.Fail(w, 400, p)
		return
	}
	if b.New == b.Current {
		httpx.Fail(w, 400, "Mật khẩu mới phải khác mật khẩu hiện tại.")
		return
	}
	if !CheckPassword(b.Current, hash) {
		seclog.Log(ctx, h.db, c.ID, "", "password_change_failed", r, nil)
		httpx.Fail(w, 400, "Mật khẩu hiện tại không đúng.")
		return
	}
	var sids []string
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		if _, err = tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, c.ID, HashPassword(b.New)); err != nil {
			return err
		}
		if sids, err = sessions.RevokeUserSessions(ctx, tx, c.ID, c.SID, "password_changed"); err != nil {
			return err
		}
		if err = h.passwordChangedMail(ctx, tx, email); err != nil {
			return err
		}
		return seclog.Log(ctx, tx, c.ID, "", "password_changed", r, nil)
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	h.sess.MarkRevoked(ctx, sids...)
	httpx.OK(w, "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.", nil)
}

// passwordChangedMail tells the owner the password changed.
func (h *Handler) passwordChangedMail(ctx context.Context, tx pgx.Tx, email string) error {
	return mail.Enqueue(ctx, tx, email, "Mật khẩu NovelHub vừa được đổi",
		"Mật khẩu tài khoản NovelHub của bạn vừa được đổi lúc "+time.Now().In(mail.VNTime).Format("15:04 02/01/2006")+
			" (giờ Việt Nam). Nếu không phải bạn, hãy đặt lại mật khẩu ngay bằng \"Quên mật khẩu\" và báo cho quản trị viên.",
		"Đặt lại mật khẩu", h.siteURL+"/quen-mat-khau")
}

const forgotReply = "Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu (hiệu lực 1 giờ). Hãy kiểm tra hộp thư, kể cả mục spam."

// Always the same answer (and the same work), so the form can't tell which emails have accounts.
// Forgot handles the Forgot route.
func (h *Handler) Forgot(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email     string `json:"email"`
		Turnstile string `json:"turnstile_token"`
	}
	httpx.ReadJSON(w, r, &b)
	email := strings.ToLower(strings.TrimSpace(b.Email))
	if len(email) > 255 || !mail.EmailRe.MatchString(email) {
		httpx.Fail(w, 400, "Email không đúng định dạng.")
		return
	}
	if !h.humans.OK(w, r, b.Turnstile) {
		return
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		var uid string
		var recent bool
		err := tx.QueryRow(ctx, `SELECT id::text, EXISTS (SELECT 1 FROM account_tokens t WHERE t.user_id = users.id AND t.purpose = 'reset_password'
			AND t.created_at > NOW() - INTERVAL '2 minutes') FROM users WHERE email = $1 AND deleted_at IS NULL AND NOT is_banned`, email).Scan(&uid, &recent)
		if errors.Is(err, pgx.ErrNoRows) || recent { // at most one mail per 2 minutes per account
			return nil
		}
		if err != nil {
			return err
		}
		token, err := tokens.CreateAccount(ctx, tx, uid, "reset_password")
		if err != nil {
			return err
		}
		if err := seclog.Log(ctx, tx, uid, "", "reset_requested", r, nil); err != nil {
			return err
		}
		return mail.Enqueue(ctx, tx, email, "Đặt lại mật khẩu NovelHub",
			"Có người (hy vọng là bạn) vừa yêu cầu đặt lại mật khẩu NovelHub. Liên kết có hiệu lực 1 giờ và chỉ dùng được một lần.",
			"Đặt mật khẩu mới", h.siteURL+"/dat-lai-mat-khau?token="+token)
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, forgotReply, nil)
}

// Set a new password from the mailed link: logs out every device; also proves the address is theirs.
// Reset handles the Reset route.
func (h *Handler) Reset(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
		New   string `json:"new_password"`
	}
	httpx.ReadJSON(w, r, &b)
	ctx := r.Context()
	var sids []string
	var problem string
	var found bool
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		uid, err := tokens.ConsumeAccount(ctx, tx, b.Token, "reset_password")
		if err != nil || uid == "" {
			return err
		}
		found = true
		var username, email string
		if err := tx.QueryRow(ctx, `SELECT username::text, email::text FROM users WHERE id = $1`, uid).Scan(&username, &email); err != nil {
			return err
		}
		if problem = PasswordProblem(b.New, username, email); problem != "" {
			return db.ErrRollback
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, email_verified = TRUE, locked_until = NULL WHERE id = $1`, uid, HashPassword(b.New)); err != nil {
			return err
		}
		if sids, err = sessions.RevokeUserSessions(ctx, tx, uid, "", "password_reset"); err != nil {
			return err
		}
		if err := h.passwordChangedMail(ctx, tx, email); err != nil {
			return err
		}
		if err := events.UserEvent(ctx, tx, uid, "updated", nil); err != nil { // email_verified changed
			return err
		}
		return seclog.Log(ctx, tx, uid, "", "password_reset", r, nil)
	})
	switch {
	case problem != "":
		httpx.Fail(w, 400, problem)
	case err != nil:
		httpx.InternalError(w, r, err)
	case !found:
		httpx.Fail(w, 400, "Liên kết không hợp lệ, đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.")
	default:
		h.sess.MarkRevoked(ctx, sids...)
		httpx.OK(w, "Đã đặt mật khẩu mới. Hãy đăng nhập lại.", nil)
	}
}

// VerifyEmail handles the VerifyEmail route.
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	httpx.ReadJSON(w, r, &b)
	ctx := r.Context()
	found := false
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		uid, err := tokens.ConsumeAccount(ctx, tx, b.Token, "verify_email")
		if err != nil || uid == "" {
			return err
		}
		found = true
		if _, err := tx.Exec(ctx, `UPDATE users SET email_verified = TRUE WHERE id = $1`, uid); err != nil {
			return err
		}
		return events.UserEvent(ctx, tx, uid, "updated", nil)
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !found {
		httpx.Fail(w, 400, "Liên kết xác thực không hợp lệ, đã hết hạn hoặc đã được dùng.")
		return
	}
	httpx.OK(w, "Email đã được xác thực.", nil)
}

// ResendVerification handles the ResendVerification route.
func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request, c sessions.Caller) {
	ctx := r.Context()
	msg := ""
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		var email string
		var verified, recent bool
		if err := tx.QueryRow(ctx, `SELECT email::text, email_verified, EXISTS (SELECT 1 FROM account_tokens WHERE user_id = $1 AND purpose = 'verify_email'
			AND created_at > NOW() - INTERVAL '2 minutes') FROM users WHERE id = $1`, c.ID).Scan(&email, &verified, &recent); err != nil {
			return err
		}
		if verified {
			msg = "Email của bạn đã được xác thực rồi."
			return nil
		}
		msg = "Đã gửi email xác thực tới " + email + "."
		if recent {
			return nil
		}
		token, err := tokens.CreateAccount(ctx, tx, c.ID, "verify_email")
		if err != nil {
			return err
		}
		return mail.Enqueue(ctx, tx, email, "Xác thực email NovelHub",
			"Nhấn vào liên kết dưới đây để xác thực email cho tài khoản NovelHub của bạn (hiệu lực 24 giờ).",
			"Xác thực email", h.siteURL+"/xac-thuc-email?token="+token)
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, msg, nil)
}
