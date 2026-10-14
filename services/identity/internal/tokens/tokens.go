// Package tokens: the access JWT, the signed X-User-* headers, X-Internal-Auth and one-time account tokens.
package tokens

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	// AccessTTL: lifetime of the access cookie.
	AccessTTL = 15 * time.Minute
	// RefreshTTL: lifetime of a session.
	RefreshTTL = 30 * 24 * time.Hour
	// HeaderTTL: signed X-User-* headers are only good for this long.
	HeaderTTL = 2 * time.Minute // signed X-User-* headers are only good for this long
)

// RandomToken is 32 random bytes as 64 hex characters.
func RandomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// SHA256Hex is the hex SHA-256 of s (the only form of a token that is stored).
func SHA256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// NewUUID makes a random version 4 uuid.
func NewUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// Access token: only the user id and session id (no email, no roles: they change, and the token is in a cookie).
// AccessClaims is the access token payload.
type AccessClaims struct {
	SID string `json:"sid"`
	jwt.RegisteredClaims
}

// SignAccess signs an access token for the user and session.
func SignAccess(secret []byte, userID, sid string, now time.Time) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, AccessClaims{
		SID: sid,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTTL)),
			Issuer:    "identity",
		},
	}).SignedString(secret)
}

// ParseAccess checks an access token and returns its user and session ids.
func ParseAccess(secret []byte, token string) (userID, sid string, err error) {
	var c AccessClaims
	_, err = jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("identity"), jwt.WithExpirationRequired())
	if err != nil {
		return "", "", err
	}
	if c.Subject == "" || c.SID == "" {
		return "", "", errors.New("incomplete token")
	}
	return c.Subject, c.SID, nil
}

// Signed identity headers for the backend: it trusts X-User-Id/X-User-Roles only with a valid, fresh signature,
// so a request that reaches it some other way than through the gateway can't claim to be anyone.
// SignUserHeaders signs id, roles and expiry for one receiving service.
func SignUserHeaders(key []byte, userID, roles string, exp int64) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(userID + "|" + roles + "|" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(m.Sum(nil))
}

// VerifyUserHeaders checks a signature made by SignUserHeaders.
func VerifyUserHeaders(key []byte, userID, roles, expStr, sig string, now time.Time) bool {
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || now.Unix() > exp || userID == "" {
		return false
	}
	want := SignUserHeaders(key, userID, roles, exp)
	return hmac.Equal([]byte(want), []byte(strings.ToLower(sig)))
}
