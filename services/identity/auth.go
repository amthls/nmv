package main

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,30}$`) // usernames appear in profile URLs
	emailRe    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

const (
	lockAfter   = 5
	lockWindow  = 15 * time.Minute
	msgBadLogin = "Tài khoản hoặc mật khẩu không chính xác."
)

type userView struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	DisplayName   *string    `json:"display_name"`
	EmailVerified bool       `json:"email_verified"`
	Roles         []roleView `json:"roles"`
	CreatedAt     time.Time  `json:"created_at"`
}

type roleView struct {
	Role      string `json:"role"`
	IsVisible bool   `json:"is_visible"`
}

func loadUserView(ctx context.Context, q pgx.Tx, uid string) (userView, error) {
	var u userView
	err := q.QueryRow(ctx, `SELECT id::text, username::text, email::text, display_name, email_verified, created_at,
		COALESCE((SELECT json_agg(json_build_object('role', role, 'is_visible', is_visible) ORDER BY role) FROM user_roles WHERE user_id = users.id), '[]')
		FROM users WHERE id = $1`, uid).Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.EmailVerified, &u.CreatedAt, &u.Roles)
	return u, err
}

// ---- register / login / logout ------------------------------------------------------------------------

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Username    string  `json:"username"`
		Email       string  `json:"email"`
		Password    string  `json:"password"`
		DisplayName *string `json:"display_name"`
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "Dữ liệu gửi lên không hợp lệ.")
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
		fail(w, 400, "Vui lòng điền đầy đủ username, email và mật khẩu.")
		return
	case !usernameRe.MatchString(username):
		fail(w, 400, "Tên đăng nhập phải từ 3 đến 30 ký tự, chỉ gồm chữ không dấu, số và dấu _ . -")
		return
	case len(email) > 255 || !emailRe.MatchString(email):
		fail(w, 400, "Email không đúng định dạng.")
		return
	case len([]rune(display)) > 100:
		fail(w, 400, "Tên hiển thị tối đa 100 ký tự.")
		return
	}
	if p := passwordProblem(b.Password, username, email); p != "" {
		fail(w, 400, p)
		return
	}

	ctx, now := r.Context(), s.now()
	uid := newUUID()
	var sid, refresh string
	var user userView
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO users (id, username, email, password_hash, display_name, last_login_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
			uid, username, email, hashPassword(b.Password), display)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO user_roles (user_id, role) VALUES ($1, 'reader')`, uid); err != nil {
			return err
		}
		if sid, refresh, err = createSession(ctx, tx, uid, r, now); err != nil {
			return err
		}
		token, err := createAccountToken(ctx, tx, uid, "verify_email")
		if err == nil {
			err = enqueueMail(ctx, tx, email, "Xác thực email NovelHub",
				"Nhấn vào liên kết dưới đây để xác thực email cho tài khoản NovelHub của bạn (hiệu lực 24 giờ).",
				"Xác thực email", s.cfg.SiteURL+"/xac-thuc-email?token="+token)
		}
		if err == nil {
			err = securityLog(ctx, tx, uid, "", "register", r, nil)
		}
		if err == nil {
			err = userEvent(ctx, tx, uid, "created", nil)
		}
		if err == nil {
			user, err = loadUserView(ctx, tx, uid)
		}
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		if strings.Contains(pgErr.ConstraintName, "username") {
			fail(w, 400, "Tên đăng nhập này đã được sử dụng.")
		} else {
			fail(w, 400, "Email này đã được sử dụng.")
		}
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if err := s.issue(w, r, uid, sid, refresh); err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "message": "Đăng ký tài khoản thành công! Bạn đã tự động đăng nhập.", "data": map[string]any{"user": user}})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Identifier string `json:"identifier"`
		Password   string `json:"password"`
	}
	if readJSON(w, r, &b) != nil || strings.TrimSpace(b.Identifier) == "" || b.Password == "" {
		fail(w, 400, "Vui lòng nhập tên đăng nhập/email và mật khẩu.")
		return
	}
	ctx, now := r.Context(), s.now()
	var uid, hash string
	var banned, deleted bool
	var banReason *string
	var lockedUntil *time.Time
	err := s.db.QueryRow(ctx, `SELECT id::text, password_hash, is_banned, deleted_at IS NOT NULL, ban_reason, locked_until
		FROM users WHERE username = $1 OR email = $1 LIMIT 1`, strings.TrimSpace(b.Identifier)).
		Scan(&uid, &hash, &banned, &deleted, &banReason, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) || deleted {
		checkPassword(b.Password, dummyHash) // same time as a wrong password
		fail(w, 400, msgBadLogin)
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	if lockedUntil != nil && lockedUntil.After(now) {
		mins := int(lockedUntil.Sub(now).Minutes()) + 1
		fail(w, 429, "Tài khoản tạm khóa do nhập sai mật khẩu nhiều lần. Thử lại sau "+itoa(mins)+" phút hoặc dùng \"Quên mật khẩu\".")
		return
	}
	if !checkPassword(b.Password, hash) {
		err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
			if err := securityLog(ctx, tx, uid, "", "login_failed", r, nil); err != nil {
				return err
			}
			var recent int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM security_log WHERE user_id = $1 AND event = 'login_failed'
				AND created_at > GREATEST(NOW() - $2::interval, COALESCE((SELECT last_login_at FROM users WHERE id = $1), 'epoch'),
				                         COALESCE((SELECT MAX(created_at) FROM security_log WHERE user_id = $1 AND event = 'locked'), 'epoch'))`,
				uid, lockWindow.String()).Scan(&recent); err != nil {
				return err
			}
			if recent >= lockAfter {
				if _, err := tx.Exec(ctx, `UPDATE users SET locked_until = NOW() + $2::interval WHERE id = $1`, uid, lockWindow.String()); err != nil {
					return err
				}
				return securityLog(ctx, tx, uid, "", "locked", r, nil)
			}
			return nil
		})
		if err != nil {
			internalError(w, r, err)
			return
		}
		fail(w, 400, msgBadLogin)
		return
	}
	if banned { // only after the right password: a ban is not revealed to someone guessing
		reason := "Vi phạm điều khoản cộng đồng"
		if banReason != nil && *banReason != "" {
			reason = *banReason
		}
		fail(w, 403, "Tài khoản đã bị khóa. Lý do: "+reason)
		return
	}

	var sid, refresh string
	var user userView
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		if needsRehash(hash) {
			if _, err = tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, uid, hashPassword(b.Password)); err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, `UPDATE users SET last_login_at = NOW(), locked_until = NULL WHERE id = $1`, uid); err != nil {
			return err
		}
		if sid, refresh, err = createSession(ctx, tx, uid, r, now); err != nil {
			return err
		}
		if err = securityLog(ctx, tx, uid, "", "login_ok", r, map[string]any{"session": sid}); err != nil {
			return err
		}
		user, err = loadUserView(ctx, tx, uid)
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	if err := s.issue(w, r, uid, sid, refresh); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "Đăng nhập thành công! Phiên đăng nhập lưu 30 ngày.", map[string]any{"user": user})
}

// POST /logout ends this device's session (works even with an expired access token, via the refresh cookie).
func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var sid string
	if ck, err := r.Cookie(cookieAccess); err == nil {
		_, sid, _ = parseAccess(s.cfg.JWTSecret, ck.Value)
	}
	if sid == "" {
		if ck, err := r.Cookie(cookieRefresh); err == nil {
			s.db.QueryRow(ctx, `SELECT id::text FROM sessions WHERE refresh_hash = $1`, sha256hex(ck.Value)).Scan(&sid)
		}
	}
	if sid != "" {
		var uid string
		err := s.db.QueryRow(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL RETURNING user_id::text`, sid).Scan(&uid)
		if err == nil {
			s.markRevoked(ctx, sid)
			securityLog(ctx, s.db, uid, "", "logout", r, map[string]any{"session": sid})
		}
	}
	s.clearSessionCookies(w, r)
	ok(w, "Đăng xuất thành công!", nil)
}

func (s *server) handleLogoutAll(w http.ResponseWriter, r *http.Request, c caller) {
	ctx := r.Context()
	var sids []string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		if sids, err = revokeUserSessions(ctx, tx, c.ID, "", "logout_all"); err != nil {
			return err
		}
		return securityLog(ctx, tx, c.ID, "", "logout_all", r, map[string]any{"sessions": len(sids)})
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	s.markRevoked(ctx, sids...)
	s.clearSessionCookies(w, r)
	ok(w, "Đã đăng xuất khỏi mọi thiết bị.", nil)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request, c caller) {
	var u userView
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) { u, err = loadUserView(r.Context(), tx, c.ID); return })
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "", u)
}

// ---- devices ------------------------------------------------------------------------------------------

func (s *server) handleSessions(w http.ResponseWriter, r *http.Request, c caller) {
	rows, err := s.db.Query(r.Context(), `SELECT id::text, COALESCE(device, ''), COALESCE(last_ip, ''), created_at, last_used_at
		FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_used_at DESC`, c.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type session struct {
		ID       string    `json:"id"`
		Device   string    `json:"device"`
		IP       string    `json:"ip"`
		Created  time.Time `json:"created_at"`
		LastUsed time.Time `json:"last_used_at"`
		Current  bool      `json:"current"`
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (session, error) {
		var x session
		err := row.Scan(&x.ID, &x.Device, &x.IP, &x.Created, &x.LastUsed)
		x.Current = x.ID == c.SID
		return x, err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "", list)
}

func (s *server) handleRevokeSession(w http.ResponseWriter, r *http.Request, c caller) {
	sid := r.PathValue("id")
	if !isUUID(sid) {
		fail(w, 404, "Không tìm thấy phiên đăng nhập.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'revoked_by_user' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, sid, c.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Không tìm thấy phiên đăng nhập.")
		return
	}
	s.markRevoked(r.Context(), sid)
	securityLog(r.Context(), s.db, c.ID, "", "session_revoked", r, map[string]any{"session": sid})
	ok(w, "Đã đăng xuất thiết bị.", nil)
}

// ---- passwords and email ------------------------------------------------------------------------------

var tokenTTL = map[string]time.Duration{"reset_password": time.Hour, "verify_email": 24 * time.Hour}

// createAccountToken: a new one-time token (only its hash is stored); unused older ones for the purpose stop working.
func createAccountToken(ctx context.Context, tx pgx.Tx, uid, purpose string) (string, error) {
	token := randomToken()
	if _, err := tx.Exec(ctx, `DELETE FROM account_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, uid, purpose); err != nil {
		return "", err
	}
	_, err := tx.Exec(ctx, `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, NOW() + $4::interval)`,
		sha256hex(token), uid, purpose, tokenTTL[purpose].String())
	return token, err
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func consumeAccountToken(ctx context.Context, tx pgx.Tx, token, purpose string) (string, error) {
	if !hex64.MatchString(token) {
		return "", nil
	}
	var uid string
	err := tx.QueryRow(ctx, `UPDATE account_tokens SET used_at = NOW() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
		RETURNING user_id::text`, sha256hex(token), purpose).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return uid, err
}

// Change password while signed in: needs the current one; every other device is logged out, this one stays.
func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request, c caller) {
	var b struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if readJSON(w, r, &b) != nil || b.Current == "" {
		fail(w, 400, "Vui lòng nhập mật khẩu hiện tại.")
		return
	}
	ctx := r.Context()
	var hash, username, email string
	if err := s.db.QueryRow(ctx, `SELECT password_hash, username::text, email::text FROM users WHERE id = $1`, c.ID).Scan(&hash, &username, &email); err != nil {
		internalError(w, r, err)
		return
	}
	if p := passwordProblem(b.New, username, email); p != "" {
		fail(w, 400, p)
		return
	}
	if b.New == b.Current {
		fail(w, 400, "Mật khẩu mới phải khác mật khẩu hiện tại.")
		return
	}
	if !checkPassword(b.Current, hash) {
		securityLog(ctx, s.db, c.ID, "", "password_change_failed", r, nil)
		fail(w, 400, "Mật khẩu hiện tại không đúng.")
		return
	}
	var sids []string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		if _, err = tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, c.ID, hashPassword(b.New)); err != nil {
			return err
		}
		if sids, err = revokeUserSessions(ctx, tx, c.ID, c.SID, "password_changed"); err != nil {
			return err
		}
		if err = s.passwordChangedMail(ctx, tx, email); err != nil {
			return err
		}
		return securityLog(ctx, tx, c.ID, "", "password_changed", r, nil)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	s.markRevoked(ctx, sids...)
	ok(w, "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.", nil)
}

func (s *server) passwordChangedMail(ctx context.Context, tx pgx.Tx, email string) error {
	return enqueueMail(ctx, tx, email, "Mật khẩu NovelHub vừa được đổi",
		"Mật khẩu tài khoản NovelHub của bạn vừa được đổi lúc "+time.Now().In(vnTime).Format("15:04 02/01/2006")+
			" (giờ Việt Nam). Nếu không phải bạn, hãy đặt lại mật khẩu ngay bằng \"Quên mật khẩu\" và báo cho quản trị viên.",
		"Đặt lại mật khẩu", s.cfg.SiteURL+"/quen-mat-khau")
}

var vnTime = time.FixedZone("ICT", 7*3600)

const forgotReply = "Nếu email này có tài khoản, chúng tôi đã gửi liên kết đặt lại mật khẩu (hiệu lực 1 giờ). Hãy kiểm tra hộp thư, kể cả mục spam."

// Always the same answer (and the same work), so the form can't tell which emails have accounts.
func (s *server) handleForgot(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email string `json:"email"`
	}
	readJSON(w, r, &b)
	email := strings.ToLower(strings.TrimSpace(b.Email))
	if len(email) > 255 || !emailRe.MatchString(email) {
		fail(w, 400, "Email không đúng định dạng.")
		return
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
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
		token, err := createAccountToken(ctx, tx, uid, "reset_password")
		if err != nil {
			return err
		}
		if err := securityLog(ctx, tx, uid, "", "reset_requested", r, nil); err != nil {
			return err
		}
		return enqueueMail(ctx, tx, email, "Đặt lại mật khẩu NovelHub",
			"Có người (hy vọng là bạn) vừa yêu cầu đặt lại mật khẩu NovelHub. Liên kết có hiệu lực 1 giờ và chỉ dùng được một lần.",
			"Đặt mật khẩu mới", s.cfg.SiteURL+"/dat-lai-mat-khau?token="+token)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, forgotReply, nil)
}

// Set a new password from the mailed link: logs out every device; also proves the address is theirs.
func (s *server) handleReset(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
		New   string `json:"new_password"`
	}
	readJSON(w, r, &b)
	ctx := r.Context()
	var sids []string
	var problem string
	var found bool
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		uid, err := consumeAccountToken(ctx, tx, b.Token, "reset_password")
		if err != nil || uid == "" {
			return err
		}
		found = true
		var username, email string
		if err := tx.QueryRow(ctx, `SELECT username::text, email::text FROM users WHERE id = $1`, uid).Scan(&username, &email); err != nil {
			return err
		}
		if problem = passwordProblem(b.New, username, email); problem != "" {
			return errRollback
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, email_verified = TRUE, locked_until = NULL WHERE id = $1`, uid, hashPassword(b.New)); err != nil {
			return err
		}
		if sids, err = revokeUserSessions(ctx, tx, uid, "", "password_reset"); err != nil {
			return err
		}
		if err := s.passwordChangedMail(ctx, tx, email); err != nil {
			return err
		}
		if err := userEvent(ctx, tx, uid, "updated", nil); err != nil { // email_verified changed
			return err
		}
		return securityLog(ctx, tx, uid, "", "password_reset", r, nil)
	})
	switch {
	case problem != "":
		fail(w, 400, problem)
	case err != nil:
		internalError(w, r, err)
	case !found:
		fail(w, 400, "Liên kết không hợp lệ, đã hết hạn hoặc đã được dùng. Hãy yêu cầu liên kết mới.")
	default:
		s.markRevoked(ctx, sids...)
		ok(w, "Đã đặt mật khẩu mới. Hãy đăng nhập lại.", nil)
	}
}

// errRollback aborts a transaction on purpose (the handler already knows what to answer).
var errRollback = errors.New("rollback")

func (s *server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	readJSON(w, r, &b)
	ctx := r.Context()
	found := false
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		uid, err := consumeAccountToken(ctx, tx, b.Token, "verify_email")
		if err != nil || uid == "" {
			return err
		}
		found = true
		if _, err := tx.Exec(ctx, `UPDATE users SET email_verified = TRUE WHERE id = $1`, uid); err != nil {
			return err
		}
		return userEvent(ctx, tx, uid, "updated", nil)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	if !found {
		fail(w, 400, "Liên kết xác thực không hợp lệ, đã hết hạn hoặc đã được dùng.")
		return
	}
	ok(w, "Email đã được xác thực.", nil)
}

func (s *server) handleResendVerification(w http.ResponseWriter, r *http.Request, c caller) {
	ctx := r.Context()
	msg := ""
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
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
		token, err := createAccountToken(ctx, tx, c.ID, "verify_email")
		if err != nil {
			return err
		}
		return enqueueMail(ctx, tx, email, "Xác thực email NovelHub",
			"Nhấn vào liên kết dưới đây để xác thực email cho tài khoản NovelHub của bạn (hiệu lực 24 giờ).",
			"Xác thực email", s.cfg.SiteURL+"/xac-thuc-email?token="+token)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, msg, nil)
}
