package main

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
	accessTTL  = 15 * time.Minute
	refreshTTL = 30 * 24 * time.Hour
	headerTTL  = 2 * time.Minute // signed X-User-* headers are only good for this long
)

func randomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// Access token: only the user id and session id (no email, no roles: they change, and the token is in a cookie).
type accessClaims struct {
	SID string `json:"sid"`
	jwt.RegisteredClaims
}

func signAccess(secret []byte, userID, sid string, now time.Time) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims{
		SID: sid,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTTL)),
			Issuer:    "identity",
		},
	}).SignedString(secret)
}

func parseAccess(secret []byte, token string) (userID, sid string, err error) {
	var c accessClaims
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
func signUserHeaders(key []byte, userID, roles string, exp int64) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(userID + "|" + roles + "|" + strconv.FormatInt(exp, 10)))
	return hex.EncodeToString(m.Sum(nil))
}

func verifyUserHeaders(key []byte, userID, roles, expStr, sig string, now time.Time) bool {
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || now.Unix() > exp || userID == "" {
		return false
	}
	want := signUserHeaders(key, userID, roles, exp)
	return hmac.Equal([]byte(want), []byte(strings.ToLower(sig)))
}
