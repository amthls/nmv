package httpx

import (
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestIsUUIDAndClamp(t *testing.T) {
	if !IsUUID("11111111-1111-1111-1111-111111111111") || IsUUID("x") {
		t.Fatal("IsUUID")
	}
	if Clamp(140.0, 0, 100, 0) != 100 || Clamp("40.5", 0, 100, 0) != 40.5 || Clamp(nil, 0, 100, 7) != 7 {
		t.Fatal("Clamp")
	}
}

func TestInternalHeaderRoundTrip(t *testing.T) {
	key := []byte("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
	h := InternalHeader(key, time.Now().Add(time.Minute).Unix())
	if !InternalAuthOK(key, h, time.Now()) || InternalAuthOK([]byte("other"), h, time.Now()) {
		t.Fatal("internal header")
	}
	if InternalAuthOK(key, InternalHeader(key, time.Now().Add(-time.Minute).Unix()), time.Now()) {
		t.Fatal("expired header accepted")
	}
}

func TestUserFromRejectsMissingSignature(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("X-User-Id", "u")
	r.Header.Set("X-User-Exp", strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10))
	if UserFrom([]byte("k"), r, time.Now()) != "" {
		t.Fatal("unsigned identity accepted")
	}
}
