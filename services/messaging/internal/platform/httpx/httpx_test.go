package httpx

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testKey = "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"

func signed(user string) http.Header {
	exp := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	roles := "reader"
	m := hmac.New(sha256.New, []byte(testKey))
	m.Write([]byte(user + "|" + roles + "|" + exp))
	return http.Header{"X-User-Id": {user}, "X-User-Roles": {roles}, "X-User-Exp": {exp}, "X-User-Sig": {hex.EncodeToString(m.Sum(nil))}}
}

func TestUserFrom(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header = signed("u1")
	if UserFrom([]byte(testKey), r, time.Now()) != "u1" {
		t.Fatal("signed headers must be accepted")
	}
	r.Header.Set("X-User-Roles", "admin")
	if UserFrom([]byte(testKey), r, time.Now()) != "" {
		t.Fatal("tampered roles must be refused")
	}
	r.Header = signed("u1")
	if UserFrom([]byte(strings.Repeat("k", 32)), r, time.Now()) != "" || UserFrom([]byte(testKey), r, time.Now().Add(5*time.Minute)) != "" {
		t.Fatal("another service's key or an expired signature must be refused")
	}
}
