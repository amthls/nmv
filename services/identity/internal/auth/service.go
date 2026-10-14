package auth

import (
	"context"
	"regexp"

	"github.com/jackc/pgx/v5"
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.-]{3,30}$`) // usernames appear in profile URLs

// LoadUserView reads one account with its roles.
func LoadUserView(ctx context.Context, q pgx.Tx, uid string) (UserView, error) {
	var u UserView
	err := q.QueryRow(ctx, `SELECT id::text, username::text, email::text, display_name, email_verified, created_at,
		COALESCE((SELECT json_agg(json_build_object('role', role, 'is_visible', is_visible) ORDER BY role) FROM user_roles WHERE user_id = users.id), '[]')
		FROM users WHERE id = $1`, uid).Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.EmailVerified, &u.CreatedAt, &u.Roles)
	return u, err
}
