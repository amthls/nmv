package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// execer is a pool or a transaction.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// securityLog records an account event (kept 90 days). uid = the account concerned, actor = who did it when
// that is someone else (an admin). Full IP is allowed here and in sessions, nowhere else.
func securityLog(ctx context.Context, db execer, uid, actor, event string, r *http.Request, detail map[string]any) error {
	var d []byte
	if detail != nil {
		d, _ = json.Marshal(detail)
	}
	ip, ua := "", ""
	if r != nil {
		ip, ua = clientIP(r), userAgent(r)
	}
	_, err := db.Exec(ctx, `INSERT INTO security_log (user_id, actor_id, event, ip, user_agent, detail)
		VALUES (NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, $3, $4, $5, $6)`, uid, actor, event, ip, ua, d)
	return err
}

// Hourly housekeeping: drop old log rows and spent tokens; alert admins on a burst of failed logins.
func (s *server) housekeeping(ctx context.Context) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	var lastAlert time.Time
	for {
		_, err := s.db.Exec(ctx, `DELETE FROM security_log WHERE created_at < NOW() - INTERVAL '90 days'`)
		if err == nil {
			_, err = s.db.Exec(ctx, `DELETE FROM refresh_tokens_used WHERE replaced_at < NOW() - INTERVAL '31 days'`)
		}
		if err == nil {
			_, err = s.db.Exec(ctx, `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days' OR revoked_at < NOW() - INTERVAL '30 days'`)
		}
		if err == nil {
			_, err = s.db.Exec(ctx, `DELETE FROM account_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`)
		}
		if err == nil {
			_, err = s.db.Exec(ctx, `DELETE FROM outbox WHERE published_at < NOW() - INTERVAL '7 days'`)
		}
		if err == nil {
			_, err = s.db.Exec(ctx, `DELETE FROM mail_outbox WHERE COALESCE(sent_at, failed_at) < NOW() - INTERVAL '30 days'`)
		}
		if err != nil {
			logError(ctx, "housekeeping: "+err.Error())
		}

		var failed int
		if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM security_log WHERE event = 'login_failed' AND created_at > NOW() - INTERVAL '10 minutes'`).Scan(&failed); err == nil &&
			failed > 50 && time.Since(lastAlert) > time.Hour {
			lastAlert = time.Now()
			if err := s.alert(ctx, "login-burst", "Đăng nhập sai hàng loạt",
				"Có "+strconv.Itoa(failed)+" lần đăng nhập sai trong 10 phút qua. Có thể đang bị dò mật khẩu."); err != nil {
				logError(ctx, "alert: "+err.Error())
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
