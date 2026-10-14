// Package sessions: login sessions (refresh rotation, revocation cache), the session cookies and who a request is.
package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"nmv/identity/internal/platform/httpx"
	"nmv/identity/internal/platform/logger"
	"nmv/identity/internal/tokens"
)

// Service holds the session rules: Postgres is the truth, Redis (when given) only a cache.
type Service struct {
	db           *pgxpool.Pool
	rdb          *redis.Client // nil when REDIS_URL is empty: revocation then always reads the database
	jwtSecret    []byte
	cookieSecure bool
	now          func() time.Time
}

// NewService wires the session service.
func NewService(db *pgxpool.Pool, rdb *redis.Client, jwtSecret []byte, cookieSecure bool, now func() time.Time) *Service {
	return &Service{db: db, rdb: rdb, jwtSecret: jwtSecret, cookieSecure: cookieSecure, now: now}
}

// Redis keys (prefix "identity:"): revoked:{sid} for 16 min (outlives any access token of that session),
// sess:{sid} = known-good for 30 s, roles:{uid} for 60 s. Redis is only a cache: without it, everything reads Postgres.
const (
	keyRevoked = "identity:revoked:"
	keySess    = "identity:sess:"
	keyRoles   = "identity:roles:"
)

// SessionRevoked tells whether the session is revoked, unknown or expired.
func (s *Service) SessionRevoked(ctx context.Context, sid string) (bool, error) {
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
			logger.Error(ctx, "redis: "+err.Error())
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

// RolesOf returns the roles of a user.
func (s *Service) RolesOf(ctx context.Context, uid string) ([]string, error) {
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

// ForgetRoles drops the cached roles after they changed.
func (s *Service) ForgetRoles(ctx context.Context, uid string) {
	if s.rdb != nil {
		s.rdb.Del(ctx, keyRoles+uid)
	}
}

// MarkRevoked must run after the revoking transaction committed.
func (s *Service) MarkRevoked(ctx context.Context, sids ...string) {
	if s.rdb == nil || len(sids) == 0 {
		return
	}
	_, err := s.rdb.Pipelined(ctx, func(p redis.Pipeliner) error {
		for _, sid := range sids {
			p.Set(ctx, keyRevoked+sid, "1", tokens.AccessTTL+time.Minute)
			p.Del(ctx, keySess+sid)
		}
		return nil
	})
	if err != nil {
		// The session row is already revoked; the 30 s sess: cache is the worst case
		logger.Error(ctx, "redis revoke: "+err.Error())
	}
}

// CreateSession inserts a session and returns its id and the (only ever plain here) refresh token.
func CreateSession(ctx context.Context, tx pgx.Tx, uid string, r *http.Request, now time.Time) (sid, refresh string, err error) {
	sid, refresh = tokens.NewUUID(), tokens.RandomToken()
	_, err = tx.Exec(ctx, `INSERT INTO sessions (id, user_id, refresh_hash, device, created_ip, last_ip, created_at, last_used_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7)`,
		sid, uid, tokens.SHA256Hex(refresh), httpx.UserAgent(r), httpx.ClientIP(r), now, now.Add(tokens.RefreshTTL))
	return
}

// RevokeUserSessions ends every live session of a user (except keepSID) inside tx; call MarkRevoked after commit.
func RevokeUserSessions(ctx context.Context, tx pgx.Tx, uid, keepSID, reason string) ([]string, error) {
	rows, err := tx.Query(ctx, `UPDATE sessions SET revoked_at = NOW(), revoke_reason = $3
		WHERE user_id = $1 AND revoked_at IS NULL AND id::text <> $2 RETURNING id::text`, uid, keepSID, reason)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// Issue signs a fresh access token for the session and sets the cookies (refresh only when it was rotated).
func (s *Service) Issue(w http.ResponseWriter, r *http.Request, uid, sid, refresh string) error {
	access, err := tokens.SignAccess(s.jwtSecret, uid, sid, s.now())
	if err != nil {
		return err
	}
	s.SetSessionCookies(w, r, access, refresh)
	return nil
}
