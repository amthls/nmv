// Package email: account mail (outbox + SMTP sender), change of email address, and the optional Turnstile bot check.
package email

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/identity/internal/platform/db"
	"nmv/identity/internal/platform/events"
	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/seclog"
	"nmv/identity/internal/sessions"
	"nmv/identity/internal/tokens"
)

// EmailRe is the shape an address must have.
var EmailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// VNTime is the zone mails quote times in.
var VNTime = time.FixedZone("ICT", 7*3600)

// PasswordChecker compares a password with a stored hash (auth.CheckPassword).
type PasswordChecker func(pw, hash string) bool

// Handler serves the change-of-email routes.
type Handler struct {
	db            *pgxpool.Pool
	siteURL       string
	checkPassword PasswordChecker
}

// NewHandler wires the handler.
func NewHandler(db *pgxpool.Pool, siteURL string, check PasswordChecker) *Handler {
	return &Handler{db: db, siteURL: siteURL, checkPassword: check}
}

// ---- change of email ------------------------------------------------------------------------------------

// POST /change-email {new_email, password}: mails a link to the new address (it must prove it is theirs) and warns
// the old one. Nothing changes until the link is opened.
// ChangeEmail handles POST /change-email.
func (h *Handler) ChangeEmail(w http.ResponseWriter, r *http.Request, c sessions.Caller) {
	var b struct {
		NewEmail string `json:"new_email"`
		Password string `json:"password"`
	}
	httpx.ReadJSON(w, r, &b)
	newEmail := strings.ToLower(strings.TrimSpace(b.NewEmail))
	if len(newEmail) > 255 || !EmailRe.MatchString(newEmail) {
		httpx.Fail(w, 400, "Email mới không đúng định dạng.")
		return
	}
	ctx := r.Context()
	var hash, oldEmail string
	if err := h.db.QueryRow(ctx, `SELECT password_hash, email::text FROM users WHERE id = $1`, c.ID).Scan(&hash, &oldEmail); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !h.checkPassword(b.Password, hash) {
		seclog.Log(ctx, h.db, c.ID, "", "email_change_failed", r, nil)
		httpx.Fail(w, 400, "Mật khẩu không đúng.")
		return
	}
	if newEmail == strings.ToLower(oldEmail) {
		httpx.Fail(w, 400, "Đây đã là email hiện tại của bạn.")
		return
	}
	var taken bool
	if err := h.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`, newEmail).Scan(&taken); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if taken {
		httpx.Fail(w, 409, "Email này đã được một tài khoản khác dùng.")
		return
	}
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		token, err := tokens.CreateAccount(ctx, tx, c.ID, "change_email")
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE account_tokens SET new_email = $2 WHERE token_hash = $1`, tokens.SHA256Hex(token), newEmail); err != nil {
			return err
		}
		if err := seclog.Log(ctx, tx, c.ID, "", "email_change_requested", r, map[string]any{"new_email": newEmail}); err != nil {
			return err
		}
		if err := Enqueue(ctx, tx, newEmail, "Xác nhận email mới cho NovelHub",
			"Có người (hy vọng là bạn) muốn dùng email này cho tài khoản NovelHub. Liên kết có hiệu lực 24 giờ và chỉ dùng được một lần.",
			"Xác nhận email mới", h.siteURL+"/xac-thuc-email?doi=1&token="+token); err != nil {
			return err
		}
		return Enqueue(ctx, tx, oldEmail, "Yêu cầu đổi email NovelHub",
			"Có yêu cầu đổi email tài khoản NovelHub của bạn sang "+newEmail+" lúc "+time.Now().In(VNTime).Format("15:04 02/01/2006")+
				" (giờ Việt Nam). Email chỉ đổi khi liên kết gửi tới địa chỉ mới được mở. Nếu không phải bạn, hãy đổi mật khẩu ngay.", "", "")
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, "Đã gửi liên kết xác nhận tới "+newEmail+". Email chỉ đổi khi bạn mở liên kết đó (hiệu lực 24 giờ).", nil)
}

// POST /confirm-email-change {token}: no sign-in needed (the link may be opened on another device).
// ConfirmEmailChange handles POST /confirm-email-change.
func (h *Handler) ConfirmEmailChange(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Token string `json:"token"`
	}
	httpx.ReadJSON(w, r, &b)
	ctx := r.Context()
	var newEmail, problem string
	err := pgx.BeginFunc(ctx, h.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT COALESCE(new_email::text, '') FROM account_tokens WHERE token_hash = $1`, tokens.SHA256Hex(b.Token)).Scan(&newEmail)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		uid, err := tokens.ConsumeAccount(ctx, tx, b.Token, "change_email")
		if err != nil {
			return err
		}
		if uid == "" || newEmail == "" {
			problem = "Liên kết không hợp lệ, đã hết hạn hoặc đã được dùng."
			return db.ErrRollback
		}
		var oldEmail string
		if err := tx.QueryRow(ctx, `SELECT email::text FROM users WHERE id = $1`, uid).Scan(&oldEmail); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE users SET email = $2, email_verified = TRUE, updated_at = NOW() WHERE id = $1`, uid, newEmail)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			problem = "Email này vừa được một tài khoản khác dùng."
			return db.ErrRollback
		}
		if err != nil {
			return err
		}
		// Links already mailed to the old address stop working
		if _, err := tx.Exec(ctx, `DELETE FROM account_tokens WHERE user_id = $1 AND used_at IS NULL`, uid); err != nil {
			return err
		}
		if err := events.UserEvent(ctx, tx, uid, "updated", nil); err != nil { // email_verified
			return err
		}
		if err := seclog.Log(ctx, tx, uid, "", "email_changed", r, map[string]any{"from": oldEmail, "to": newEmail}); err != nil {
			return err
		}
		return Enqueue(ctx, tx, oldEmail, "Email NovelHub đã được đổi",
			"Email tài khoản NovelHub của bạn vừa được đổi sang "+newEmail+". Nếu không phải bạn, hãy liên hệ quản trị viên ngay.", "", "")
	})
	switch {
	case problem != "":
		httpx.Fail(w, 400, problem)
	case err != nil:
		httpx.InternalError(w, r, err)
	default:
		httpx.OK(w, "Đã đổi email thành "+newEmail+".", nil)
	}
}
