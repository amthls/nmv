package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"html"
	"mime"
	"net"
	"net/smtp"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Account mails are written to mail_outbox in the same transaction as their token, then sent by mailLoop with
// retries (backoff, ~1 hour in total). Without SMTP_URL nothing is sent: read the mail (link included) with
//   docker compose exec postgres psql -U identity -d identity_db -c "SELECT to_addr, body_text FROM mail_outbox ORDER BY id DESC LIMIT 1"
// Links are never written to the logs (they carry tokens).

const mailsPerDay = 10

func enqueueMail(ctx context.Context, tx pgx.Tx, to, subject, intro, linkText, link string) error {
	text := intro + "\n\n" + linkText + ": " + link + "\n\nNếu bạn không yêu cầu, hãy bỏ qua email này."
	body := "<p>" + html.EscapeString(intro) + "</p><p><a href=\"" + html.EscapeString(link) + "\">" + html.EscapeString(linkText) + "</a></p>" +
		`<p style="color:#888;font-size:12px">Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`
	if link == "" { // notice only (e.g. "your password was changed")
		text = intro
		body = "<p>" + html.EscapeString(intro) + "</p>"
	}
	// A form can be used to flood someone's inbox: at most mailsPerDay per address, the rest is dropped quietly
	var sent int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM mail_outbox WHERE to_addr = $1 AND created_at > NOW() - INTERVAL '1 day'`, to).Scan(&sent); err != nil {
		return err
	}
	if sent >= mailsPerDay {
		logf(ctx, "warn", fmt.Sprintf("mail dropped: %d mails to one address in 24 hours (%q)", sent, subject))
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO mail_outbox (to_addr, subject, body_text, body_html) VALUES ($1, $2, $3, $4)`, to, subject, text, body)
	return err
}

// Retry delays after each failed attempt; after the last one the mail is marked failed and admins are alerted.
var mailBackoff = []time.Duration{time.Minute, 2 * time.Minute, 5 * time.Minute, 10 * time.Minute, 20 * time.Minute, 30 * time.Minute}

func (s *server) mailLoop(ctx context.Context) {
	if s.cfg.SMTPURL == "" {
		logf(ctx, "warn", "SMTP_URL empty: account mails stay in mail_outbox (see mail.go to read them)")
		return
	}
	for ctx.Err() == nil {
		sent, err := s.sendNextMail(ctx)
		if err != nil {
			logError(ctx, "mail: "+err.Error())
		}
		if !sent {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}

func (s *server) sendNextMail(ctx context.Context) (bool, error) {
	var id int64
	var attempts int
	var to, subject, text, body string
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `SELECT id, attempts, to_addr, subject, body_text, body_html FROM mail_outbox
		WHERE sent_at IS NULL AND failed_at IS NULL AND next_try_at <= NOW() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).
		Scan(&id, &attempts, &to, &subject, &text, &body)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sendErr := sendSMTP(s.cfg.SMTPURL, s.cfg.MailFrom, to, subject, text, body)
	if sendErr == nil {
		_, err = tx.Exec(ctx, `UPDATE mail_outbox SET sent_at = NOW(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, id)
		if err == nil {
			err = tx.Commit(ctx)
		}
		return err == nil, err
	}
	gaveUp := attempts >= len(mailBackoff)
	if gaveUp {
		_, err = tx.Exec(ctx, `UPDATE mail_outbox SET attempts = attempts + 1, last_error = $2, failed_at = NOW() WHERE id = $1`, id, sendErr.Error())
	} else {
		_, err = tx.Exec(ctx, `UPDATE mail_outbox SET attempts = attempts + 1, last_error = $2, next_try_at = NOW() + $3::interval WHERE id = $1`,
			id, sendErr.Error(), mailBackoff[attempts].String())
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if gaveUp && err == nil {
		err = s.alert(ctx, "mail-failed", "Không gửi được email tài khoản",
			"Một email \""+subject+"\" không gửi được sau ~1 giờ thử lại. Kiểm tra SMTP_URL. Lỗi: "+sendErr.Error())
	}
	return false, err
}

// sendSMTP: smtps://user:pass@host:465 (implicit TLS) or smtp://user:pass@host:587 (STARTTLS required).
func sendSMTP(rawURL, from, to, subject, text, body string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("SMTP_URL: %w", err)
	}
	host := u.Hostname()
	port := u.Port()
	if port == "" {
		port = map[bool]string{true: "465", false: "587"}[u.Scheme == "smtps"]
	}
	addr := net.JoinHostPort(host, port)
	var c *smtp.Client
	if u.Scheme == "smtps" {
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 15 * time.Second}, "tcp", addr, &tls.Config{ServerName: host})
		if err != nil {
			return err
		}
		if c, err = smtp.NewClient(conn, host); err != nil {
			return err
		}
	} else {
		conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
		if err != nil {
			return err
		}
		if c, err = smtp.NewClient(conn, host); err != nil {
			return err
		}
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	defer c.Close()
	if u.User != nil {
		pw, _ := u.User.Password()
		if err := c.Auth(smtp.PlainAuth("", u.User.Username(), pw, host)); err != nil {
			return err
		}
	}
	fromAddr := from
	if i := strings.LastIndex(from, "<"); i >= 0 {
		fromAddr = strings.Trim(from[i:], "<>")
	}
	if err := c.Mail(fromAddr); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	boundary := randomToken()[:24]
	msg := "From: " + from + "\r\nTo: " + to + "\r\nSubject: " + mime.QEncoding.Encode("utf-8", subject) +
		"\r\nMIME-Version: 1.0\r\nDate: " + time.Now().Format(time.RFC1123Z) +
		"\r\nContent-Type: multipart/alternative; boundary=" + boundary + "\r\n\r\n" +
		"--" + boundary + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + text + "\r\n" +
		"--" + boundary + "\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" + body + "\r\n" +
		"--" + boundary + "--\r\n"
	if _, err := w.Write([]byte(msg)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
