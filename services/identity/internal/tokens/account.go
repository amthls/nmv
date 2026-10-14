package tokens

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

var tokenTTL = map[string]time.Duration{"reset_password": time.Hour, "verify_email": 24 * time.Hour, "change_email": 24 * time.Hour}

// CreateAccount: a new one-time token (only its hash is stored); unused older ones for the purpose stop working.
func CreateAccount(ctx context.Context, tx pgx.Tx, uid, purpose string) (string, error) {
	token := RandomToken()
	if _, err := tx.Exec(ctx, `DELETE FROM account_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, uid, purpose); err != nil {
		return "", err
	}
	_, err := tx.Exec(ctx, `INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, NOW() + $4::interval)`,
		SHA256Hex(token), uid, purpose, tokenTTL[purpose].String())
	return token, err
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ConsumeAccount uses a token once; returns the user id, or "" when it is unknown, used, expired or of another purpose.
func ConsumeAccount(ctx context.Context, tx pgx.Tx, token, purpose string) (string, error) {
	if !hex64.MatchString(token) {
		return "", nil
	}
	var uid string
	err := tx.QueryRow(ctx, `UPDATE account_tokens SET used_at = NOW() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
		RETURNING user_id::text`, SHA256Hex(token), purpose).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return uid, err
}
