package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---- change of email ------------------------------------------------------------------------------------

// POST /change-email {new_email, password}: mails a link to the new address (it must prove it is theirs) and warns
// the old one. Nothing changes until the link is opened.
func (s *server) handleChangeEmail(w http.ResponseWriter, r *http.Request, c caller) {
	var b struct {
		NewEmail string `json:"new_email"`
		Password string `json:"password"`
	}
	readJSON(w, r, &b)
	newEmail := strings.ToLower(strings.TrimSpace(b.NewEmail))
	if len(newEmail) > 255 || !emailRe.MatchString(newEmail) {
		fail(w, 400, "Email mới không đúng định dạng.")
		return
	}
	ctx := r.Context()
	var hash, oldEmail string
	if err := s.db.QueryRow(ctx, `SELECT password_hash, email::text FROM users WHERE id = $1`, c.ID).Scan(&hash, &oldEmail); err != nil {
		internalError(w, r, err)
		return
	}
	if !checkPassword(b.Password, hash) {
		securityLog(ctx, s.db, c.ID, "", "email_change_failed", r, nil)
		fail(w, 400, "Mật khẩu không đúng.")
		return
	}
	if newEmail == strings.ToLower(oldEmail) {
		fail(w, 400, "Đây đã là email hiện tại của bạn.")
		return
	}
	var taken bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`, newEmail).Scan(&taken); err != nil {
		internalError(w, r, err)
		return
	}
	if taken {
		fail(w, 409, "Email này đã được một tài khoản khác dùng.")
		return
	}
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		token, err := createAccountToken(ctx, tx, c.ID, "change_email")
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE account_tokens SET new_email = $2 WHERE token_hash = $1`, sha256hex(token), newEmail); err != nil {
			return err
		}
		if err := securityLog(ctx, tx, c.ID, "", "email_change_requested", r, map[string]any{"new_email": newEmail}); err != nil {
			return err
		}
		if err := enqueueMail(ctx, tx, newEmail, "Xác nhận email mới cho NovelHub",
			"Có người (hy vọng là bạn) muốn dùng email này cho tài khoản NovelHub. Liên kết có hiệu lực 24 giờ và chỉ dùng được một lần.",
			"Xác nhận email mới", s.cfg.SiteURL+"/xac-thuc-email?doi=1&token="+token); err != nil {
			return err
		}
		return enqueueMail(ctx, tx, oldEmail, "Yêu cầu đổi email NovelHub",
			"Có yêu cầu đổi email tài khoản NovelHub của bạn sang "+newEmail+" lúc "+time.Now().In(vnTime).Format("15:04 02/01/2006")+
				" (giờ Việt Nam). Email chỉ đổi khi liên kết gửi tới địa chỉ mới được mở. Nếu không phải bạn, hãy đổi mật khẩu ngay.", "", "")
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "Đã gửi liên kết xác nhận tới "+newEmail+". Email chỉ đổi khi bạn mở liên kết đó (hiệu lực 24 giờ).", nil)
}

// POST /confirm-email-change {token}: no sign-in needed (the link may be opened on another device).
func (s *server) handleConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	readJSON(w, r, &b)
	ctx := r.Context()
	var newEmail, problem string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT COALESCE(new_email::text, '') FROM account_tokens WHERE token_hash = $1`, sha256hex(b.Token)).Scan(&newEmail)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		uid, err := consumeAccountToken(ctx, tx, b.Token, "change_email")
		if err != nil {
			return err
		}
		if uid == "" || newEmail == "" {
			problem = "Liên kết không hợp lệ, đã hết hạn hoặc đã được dùng."
			return errRollback
		}
		var oldEmail string
		if err := tx.QueryRow(ctx, `SELECT email::text FROM users WHERE id = $1`, uid).Scan(&oldEmail); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE users SET email = $2, email_verified = TRUE, updated_at = NOW() WHERE id = $1`, uid, newEmail)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			problem = "Email này vừa được một tài khoản khác dùng."
			return errRollback
		}
		if err != nil {
			return err
		}
		// Links already mailed to the old address stop working
		if _, err := tx.Exec(ctx, `DELETE FROM account_tokens WHERE user_id = $1 AND used_at IS NULL`, uid); err != nil {
			return err
		}
		if err := userEvent(ctx, tx, uid, "updated", nil); err != nil { // email_verified
			return err
		}
		if err := securityLog(ctx, tx, uid, "", "email_changed", r, map[string]any{"from": oldEmail, "to": newEmail}); err != nil {
			return err
		}
		return enqueueMail(ctx, tx, oldEmail, "Email NovelHub đã được đổi",
			"Email tài khoản NovelHub của bạn vừa được đổi sang "+newEmail+". Nếu không phải bạn, hãy liên hệ quản trị viên ngay.", "", "")
	})
	switch {
	case problem != "":
		fail(w, 400, problem)
	case err != nil:
		internalError(w, r, err)
	default:
		ok(w, "Đã đổi email thành "+newEmail+".", nil)
	}
}

// ---- Turnstile (Cloudflare bot check), optional ------------------------------------------------------------

var turnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// humanOK: with TURNSTILE_SECRET set, the form's turnstile_token must pass Cloudflare's check. Answers itself when not.
func (s *server) humanOK(w http.ResponseWriter, r *http.Request, token string) bool {
	if s.cfg.TurnstileSecret == "" {
		return true
	}
	form := url.Values{"secret": {s.cfg.TurnstileSecret}, "response": {token}, "remoteip": {clientIP(r)}}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", turnstileURL, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var out struct {
		Success bool `json:"success"`
	}
	res, err := http.DefaultClient.Do(req)
	if err == nil {
		defer res.Body.Close()
		err = json.NewDecoder(res.Body).Decode(&out)
	}
	if err != nil {
		logf(r.Context(), "warn", "turnstile check failed: "+err.Error())
		fail(w, 503, "Không kiểm tra được chống bot, vui lòng thử lại sau ít phút.")
		return false
	}
	if !out.Success {
		fail(w, 400, "Vui lòng xác nhận bạn không phải robot.")
		return false
	}
	return true
}
