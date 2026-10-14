package tokens

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestAccessToken(t *testing.T) {
	secret := []byte(strings.Repeat("s", 32))
	now := time.Now()
	tok, _ := SignAccess(secret, "u1", "s1", now)
	if uid, sid, err := ParseAccess(secret, tok); err != nil || uid != "u1" || sid != "s1" {
		t.Fatalf("round trip: %v %v %v", uid, sid, err)
	}
	if _, _, err := ParseAccess([]byte(strings.Repeat("x", 32)), tok); err == nil {
		t.Fatal("other secret accepted")
	}
	old, _ := SignAccess(secret, "u1", "s1", now.Add(-AccessTTL-time.Minute))
	if _, _, err := ParseAccess(secret, old); err == nil {
		t.Fatal("expired token accepted")
	}
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, AccessClaims{SID: "s1", RegisteredClaims: jwt.RegisteredClaims{
		Subject: "u1", Issuer: "identity", ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))}}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, _, err := ParseAccess(secret, none); err == nil {
		t.Fatal("alg=none accepted")
	}
}

func TestSignedHeaders(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	now := time.Now()
	exp := now.Add(HeaderTTL).Unix()
	sig := SignUserHeaders(key, "u1", "admin,reader", exp)
	expS := strconv.FormatInt(exp, 10)
	if !VerifyUserHeaders(key, "u1", "admin,reader", expS, sig, now) {
		t.Fatal("valid signature rejected")
	}
	if VerifyUserHeaders(key, "u2", "admin,reader", expS, sig, now) || VerifyUserHeaders(key, "u1", "admin,mod,reader", expS, sig, now) {
		t.Fatal("tampered id/roles accepted")
	}
	if VerifyUserHeaders(key, "u1", "admin,reader", expS, sig, now.Add(HeaderTTL+time.Second)) {
		t.Fatal("expired signature accepted")
	}
	if !InternalAuthOK(key, InternalAuth(key, now), now) || InternalAuthOK(key, InternalAuth([]byte(strings.Repeat("z", 32)), now), now) {
		t.Fatal("internal auth")
	}
}
