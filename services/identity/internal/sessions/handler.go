package sessions

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/seclog"
	"nmv/identity/internal/tokens"
)

const refreshGrace = 30 * time.Second // several tabs refreshing at once all present the same old token

// POST /refresh: rotate the refresh token. A token that was already rotated away (outside the grace period)
// means it was copied: the whole session is revoked.
// Refresh handles POST /refresh.
func (s *Service) Refresh(w http.ResponseWriter, r *http.Request) {
	ck, err := r.Cookie(CookieRefresh)
	if err != nil || len(ck.Value) != 64 {
		httpx.Fail(w, 401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
		return
	}
	ctx, hash, now := r.Context(), tokens.SHA256Hex(ck.Value), s.now()

	var uid, sid, newRefresh string
	var reused bool
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var revoked, expired, blocked bool
		err := tx.QueryRow(ctx, `SELECT s.id::text, s.user_id::text, s.revoked_at IS NOT NULL, s.expires_at <= NOW(), u.is_banned OR u.deleted_at IS NOT NULL
			FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = $1 FOR UPDATE OF s`, hash).
			Scan(&sid, &uid, &revoked, &expired, &blocked)
		if errors.Is(err, pgx.ErrNoRows) {
			var replacedAt time.Time
			err = tx.QueryRow(ctx, `SELECT t.session_id::text, s.user_id::text, t.replaced_at, s.revoked_at IS NOT NULL
				FROM refresh_tokens_used t JOIN sessions s ON s.id = t.session_id WHERE t.hash = $1`, hash).
				Scan(&sid, &uid, &replacedAt, &revoked)
			if errors.Is(err, pgx.ErrNoRows) {
				sid = ""
				return nil
			}
			if err != nil {
				return err
			}
			if revoked {
				sid = ""
				return nil
			}
			if now.Sub(replacedAt) <= refreshGrace {
				return nil // another tab rotated a moment ago: same session, new access token, keep its refresh cookie
			}
			reused = true
			_, err = tx.Exec(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'refresh_reuse' WHERE id = $1`, sid)
			if err == nil {
				err = seclog.Log(ctx, tx, uid, "", "refresh_reuse", r, map[string]any{"session": sid})
			}
			return err
		}
		if err != nil {
			return err
		}
		if revoked || expired || blocked {
			sid = ""
			return nil
		}
		newRefresh = tokens.RandomToken()
		if _, err := tx.Exec(ctx, `INSERT INTO refresh_tokens_used (hash, session_id) VALUES ($1, $2)`, hash, sid); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE sessions SET refresh_hash = $2, last_used_at = NOW(), last_ip = $3 WHERE id = $1`, sid, tokens.SHA256Hex(newRefresh), httpx.ClientIP(r))
		return err
	})
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if reused {
		s.MarkRevoked(ctx, sid)
		logger.Logf(ctx, "warn", "refresh token reuse: session revoked", "session", sid)
	}
	if sid == "" || reused {
		s.ClearSessionCookies(w, r)
		httpx.Fail(w, 401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
		return
	}
	if err := s.Issue(w, r, uid, sid, newRefresh); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, "", map[string]any{"expires_in": int(tokens.AccessTTL.Seconds())})
}

// ---- devices ------------------------------------------------------------------------------------------

// List handles GET /sessions.
func (s *Service) List(w http.ResponseWriter, r *http.Request, c Caller) {
	rows, err := s.db.Query(r.Context(), `SELECT id::text, COALESCE(device, ''), COALESCE(last_ip, ''), created_at, last_used_at
		FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY last_used_at DESC`, c.ID)
	if err != nil {
		httpx.InternalError(w, r, err)
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
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, "", list)
}

// Revoke handles DELETE /sessions/{id}.
func (s *Service) Revoke(w http.ResponseWriter, r *http.Request, c Caller) {
	sid := r.PathValue("id")
	if !httpx.IsUUID(sid) {
		httpx.Fail(w, 404, "Không tìm thấy phiên đăng nhập.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'revoked_by_user' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, sid, c.ID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Fail(w, 404, "Không tìm thấy phiên đăng nhập.")
		return
	}
	s.MarkRevoked(r.Context(), sid)
	seclog.Log(r.Context(), s.db, c.ID, "", "session_revoked", r, map[string]any{"session": sid})
	httpx.OK(w, "Đã đăng xuất thiết bị.", nil)
}
