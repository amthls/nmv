package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

// Redis keys (prefix "identity:"): revoked:{sid} for 16 min (outlives any access token of that session),
// sess:{sid} = known-good for 30 s, roles:{uid} for 60 s. Redis is only a cache: without it, everything reads Postgres.
const (
	keyRevoked = "identity:revoked:"
	keySess    = "identity:sess:"
	keyRoles   = "identity:roles:"
)

func (s *server) sessionRevoked(ctx context.Context, sid string) (bool, error) {
	if s.rdb != nil {
		vals, err := s.rdb.MGet(ctx, keyRevoked+sid, keySess+sid).Result()
		if err == nil {
			if vals[0] != nil {
				return true, nil
			}
			if vals[1] != nil {
				return false, nil
			}
		} else {
			logError(ctx, "redis: "+err.Error())
		}
	}
	var alive bool
	err := s.db.QueryRow(ctx, `SELECT revoked_at IS NULL AND expires_at > NOW() FROM sessions WHERE id = $1`, sid).Scan(&alive)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if alive && s.rdb != nil {
		s.rdb.Set(ctx, keySess+sid, "1", 30*time.Second)
	}
	return !alive, nil
}

func (s *server) rolesOf(ctx context.Context, uid string) ([]string, error) {
	if s.rdb != nil {
		if b, err := s.rdb.Get(ctx, keyRoles+uid).Bytes(); err == nil {
			var roles []string
			if json.Unmarshal(b, &roles) == nil {
				return roles, nil
			}
		}
	}
	rows, err := s.db.Query(ctx, `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, uid)
	if err != nil {
		return nil, err
	}
	roles, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	if roles == nil {
		roles = []string{}
	}
	if s.rdb != nil {
		b, _ := json.Marshal(roles)
		s.rdb.Set(ctx, keyRoles+uid, b, 60*time.Second)
	}
	return roles, nil
}

func (s *server) forgetRoles(ctx context.Context, uid string) {
	if s.rdb != nil {
		s.rdb.Del(ctx, keyRoles+uid)
	}
}

// markRevoked must run after the revoking transaction committed.
func (s *server) markRevoked(ctx context.Context, sids ...string) {
	if s.rdb == nil || len(sids) == 0 {
		return
	}
	_, err := s.rdb.Pipelined(ctx, func(p redis.Pipeliner) error {
		for _, sid := range sids {
			p.Set(ctx, keyRevoked+sid, "1", accessTTL+time.Minute)
			p.Del(ctx, keySess+sid)
		}
		return nil
	})
	if err != nil {
		// The session row is already revoked; the 30 s sess: cache is the worst case
		logError(ctx, "redis revoke: "+err.Error())
	}
}

// createSession inserts a session and returns its id and the (only ever plain here) refresh token.
func createSession(ctx context.Context, tx pgx.Tx, uid string, r *http.Request, now time.Time) (sid, refresh string, err error) {
	sid, refresh = newUUID(), randomToken()
	_, err = tx.Exec(ctx, `INSERT INTO sessions (id, user_id, refresh_hash, device, created_ip, last_ip, created_at, last_used_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7)`,
		sid, uid, sha256hex(refresh), userAgent(r), clientIP(r), now, now.Add(refreshTTL))
	return
}

// revokeUserSessions ends every live session of a user (except keepSID) inside tx; call markRevoked after commit.
func revokeUserSessions(ctx context.Context, tx pgx.Tx, uid, keepSID, reason string) ([]string, error) {
	rows, err := tx.Query(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = $3
		WHERE user_id = $1 AND revoked_at IS NULL AND id::text <> $2 RETURNING id::text`, uid, keepSID, reason)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// issue signs a fresh access token for the session and sets the cookies (refresh only when it was rotated).
func (s *server) issue(w http.ResponseWriter, r *http.Request, uid, sid, refresh string) error {
	access, err := signAccess(s.cfg.JWTSecret, uid, sid, s.now())
	if err != nil {
		return err
	}
	s.setSessionCookies(w, r, access, refresh)
	return nil
}

const refreshGrace = 30 * time.Second // several tabs refreshing at once all present the same old token

// POST /refresh: rotate the refresh token. A token that was already rotated away (outside the grace period)
// means it was copied: the whole session is revoked.
func (s *server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	ck, err := r.Cookie(cookieRefresh)
	if err != nil || len(ck.Value) != 64 {
		fail(w, 401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
		return
	}
	ctx, hash, now := r.Context(), sha256hex(ck.Value), s.now()

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
				err = securityLog(ctx, tx, uid, "", "refresh_reuse", r, map[string]any{"session": sid})
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
		newRefresh = randomToken()
		if _, err := tx.Exec(ctx, `INSERT INTO refresh_tokens_used (hash, session_id) VALUES ($1, $2)`, hash, sid); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE sessions SET refresh_hash = $2, last_used_at = NOW(), last_ip = $3 WHERE id = $1`, sid, sha256hex(newRefresh), clientIP(r))
		return err
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	if reused {
		s.markRevoked(ctx, sid)
		logf(ctx, "warn", "refresh token reuse: session revoked", "session", sid)
	}
	if sid == "" || reused {
		s.clearSessionCookies(w, r)
		fail(w, 401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
		return
	}
	if err := s.issue(w, r, uid, sid, newRefresh); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, "", map[string]any{"expires_in": int(accessTTL.Seconds())})
}
