package auth

import "time"

// UserView is the account as the login/register/me answers show it.
type UserView struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	Email         string     `json:"email"`
	DisplayName   *string    `json:"display_name"`
	EmailVerified bool       `json:"email_verified"`
	Roles         []RoleView `json:"roles"`
	CreatedAt     time.Time  `json:"created_at"`
}

// RoleView is one role of an account.
type RoleView struct {
	Role      string `json:"role"`
	IsVisible bool   `json:"is_visible"`
}

const (
	// LockAfter wrong passwords inside lockWindow lock the account for lockWindow.
	LockAfter   = 5
	lockWindow  = 15 * time.Minute
	msgBadLogin = "Tài khoản hoặc mật khẩu không chính xác."
)
