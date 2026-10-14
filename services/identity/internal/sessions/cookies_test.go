package sessions

import (
	"net/http/httptest"
	"testing"
)

func TestCSRF(t *testing.T) {
	r := httptest.NewRequest("POST", "/x", nil)
	if !CSRFOK(r, "GET") {
		t.Fatal("reads need no CSRF token")
	}
	if CSRFOK(r, "POST") {
		t.Fatal("write without token accepted")
	}
	r.Header.Set("Cookie", CookieCSRF+"=abc")
	r.Header.Set("X-CSRF-Token", "abd")
	if CSRFOK(r, "POST") {
		t.Fatal("mismatched token accepted")
	}
	r.Header.Set("X-CSRF-Token", "abc")
	if !CSRFOK(r, "DELETE") {
		t.Fatal("matching token rejected")
	}
}
