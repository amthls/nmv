package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestPasswordHashing(t *testing.T) {
	h := hashPassword("correct horse battery")
	if !strings.HasPrefix(h, "$argon2id$") || !checkPassword("correct horse battery", h) || checkPassword("wrong", h) {
		t.Fatal("argon2id round trip")
	}
	if needsRehash(h) {
		t.Fatal("fresh argon2id hash should not need a rehash")
	}
	legacy, _ := bcrypt.GenerateFromPassword([]byte("password123"), 10)
	if !checkPassword("password123", string(legacy)) || !needsRehash(string(legacy)) {
		t.Fatal("legacy bcrypt must verify and be flagged for rehash")
	}
	for _, bad := range []string{"!", "", "$argon2id$garbage", "plain"} {
		if checkPassword("!", bad) || checkPassword("", bad) {
			t.Fatalf("hash %q must never match", bad)
		}
	}
}

func TestPasswordProblem(t *testing.T) {
	cases := map[string]bool{ // password -> acceptable (user "yuki", email yuki.chan@mail.vn)
		"short":                  false,
		"password123":            false, // common
		"PASSWORD123":            false, // common, case-insensitive
		"myname-yuki-2026":       false, // contains username
		"yuki.chan.reads.books":  false, // contains the email's local part
		"        ":               false,
		"Tôi đọc truyện mỗi tối": true,
		"x7#Lp2!qRs":             true,
	}
	for pw, want := range cases {
		if got := passwordProblem(pw, "yuki", "yuki.chan@mail.vn") == ""; got != want {
			t.Errorf("%q: acceptable=%v, want %v", pw, got, want)
		}
	}
}

func TestAccessToken(t *testing.T) {
	secret := []byte(strings.Repeat("s", 32))
	now := time.Now()
	tok, _ := signAccess(secret, "u1", "s1", now)
	if uid, sid, err := parseAccess(secret, tok); err != nil || uid != "u1" || sid != "s1" {
		t.Fatalf("round trip: %v %v %v", uid, sid, err)
	}
	if _, _, err := parseAccess([]byte(strings.Repeat("x", 32)), tok); err == nil {
		t.Fatal("other secret accepted")
	}
	old, _ := signAccess(secret, "u1", "s1", now.Add(-accessTTL-time.Minute))
	if _, _, err := parseAccess(secret, old); err == nil {
		t.Fatal("expired token accepted")
	}
	none, _ := jwt.NewWithClaims(jwt.SigningMethodNone, accessClaims{SID: "s1", RegisteredClaims: jwt.RegisteredClaims{
		Subject: "u1", Issuer: "identity", ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour))}}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if _, _, err := parseAccess(secret, none); err == nil {
		t.Fatal("alg=none accepted")
	}
}

func TestSignedHeaders(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	now := time.Now()
	exp := now.Add(headerTTL).Unix()
	sig := signUserHeaders(key, "u1", "admin,reader", exp)
	expS := itoa(int(exp))
	if !verifyUserHeaders(key, "u1", "admin,reader", expS, sig, now) {
		t.Fatal("valid signature rejected")
	}
	if verifyUserHeaders(key, "u2", "admin,reader", expS, sig, now) || verifyUserHeaders(key, "u1", "admin,mod,reader", expS, sig, now) {
		t.Fatal("tampered id/roles accepted")
	}
	if verifyUserHeaders(key, "u1", "admin,reader", expS, sig, now.Add(headerTTL+time.Second)) {
		t.Fatal("expired signature accepted")
	}
	if !internalAuthOK(key, internalAuth(key, now), now) || internalAuthOK(key, internalAuth([]byte(strings.Repeat("z", 32)), now), now) {
		t.Fatal("internal auth")
	}
}

func TestCSRF(t *testing.T) {
	r := httptest.NewRequest("POST", "/x", nil)
	if !csrfOK(r, "GET") {
		t.Fatal("reads need no CSRF token")
	}
	if csrfOK(r, "POST") {
		t.Fatal("write without token accepted")
	}
	r.Header.Set("Cookie", cookieCSRF+"=abc")
	r.Header.Set("X-CSRF-Token", "abd")
	if csrfOK(r, "POST") {
		t.Fatal("mismatched token accepted")
	}
	r.Header.Set("X-CSRF-Token", "abc")
	if !csrfOK(r, "DELETE") {
		t.Fatal("matching token rejected")
	}
}

func TestModerationRights(t *testing.T) {
	admin := caller{ID: "a", Roles: []string{"admin"}}
	mod := caller{ID: "m", Roles: []string{"mod"}}
	reader := target{ID: "r", Roles: []string{"reader"}}
	otherMod := target{ID: "m2", Roles: []string{"mod"}}
	otherAdmin := target{ID: "a2", Roles: []string{"admin"}}
	if r := moderationRights(mod, reader); !r.Ban || !r.Delete || !r.GrantMod || r.RevokeMod {
		t.Errorf("mod on reader: %+v", r)
	}
	if r := moderationRights(mod, otherMod); r.Ban || r.Delete || r.RevokeMod {
		t.Errorf("mod on mod: %+v", r)
	}
	if r := moderationRights(admin, otherMod); !r.Ban || !r.RevokeMod {
		t.Errorf("admin on mod: %+v", r)
	}
	if r := moderationRights(admin, otherAdmin); r.Ban || r.Delete {
		t.Errorf("admin on admin: %+v", r)
	}
	if r := moderationRights(admin, target{ID: "a", Roles: []string{"admin"}}); r.Ban || r.Delete || r.GrantMod {
		t.Errorf("self: %+v", r)
	}
	if r := moderationRights(admin, target{ID: "r", Roles: []string{"reader"}, Deleted: true}); r.Ban || r.Delete {
		t.Errorf("deleted: %+v", r)
	}
}

func TestRedact(t *testing.T) {
	out := redact(`login a.b@mail.vn Bearer abc password=hunter2 postgres://identity:s3cret@postgres/x eyJa.eyJb.c`)
	for _, leak := range []string{"a.b@mail.vn", "abc", "hunter2", "s3cret", "eyJa"} {
		if strings.Contains(out, leak) {
			t.Errorf("leaked %q: %s", leak, out)
		}
	}
}
