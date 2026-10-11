package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

const testKey = "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"

func signed(user string) http.Header {
	exp := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	m := hmac.New(sha256.New, []byte(testKey))
	m.Write([]byte(user + "|reader|" + exp))
	return http.Header{"X-User-Id": {user}, "X-User-Roles": {"reader"}, "X-User-Exp": {exp}, "X-User-Sig": {hex.EncodeToString(m.Sum(nil))}}
}

func TestUserFrom(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header = signed("u1")
	if userFrom([]byte(testKey), r, time.Now()) != "u1" {
		t.Fatal("signed headers must be accepted")
	}
	r.Header.Set("X-User-Roles", "admin")
	if userFrom([]byte(testKey), r, time.Now()) != "" {
		t.Fatal("tampered roles must be refused")
	}
	r.Header = signed("u1")
	if userFrom([]byte(strings.Repeat("k", 32)), r, time.Now()) != "" || userFrom([]byte(testKey), r, time.Now().Add(5*time.Minute)) != "" {
		t.Fatal("another service's key or an expired signature must be refused")
	}
}

// A real socket through the hub: guests refused, pushes reach every tab of the user, the same tab replaces its old
// socket, _disconnect closes them all.
func TestHub(t *testing.T) {
	h := newHub()
	srv := httptest.NewServer(withRequestLog((&server{cfg: config{SigKey: []byte(testKey)}, hub: h, now: time.Now}).routes())) // as in main: the upgrade must get through the log wrapper
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?tab="
	dial := func(user, tab string) (*websocket.Conn, *http.Response, error) {
		return websocket.Dial(ctx, url+tab, &websocket.DialOptions{HTTPHeader: signed(user)})
	}
	if _, res, err := websocket.Dial(ctx, url+"x", nil); err == nil || res.StatusCode != 401 {
		t.Fatal("a guest must get 401")
	}
	a, _, err := dial("u1", "A")
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := dial("u1", "B")
	if err != nil {
		t.Fatal(err)
	}
	other, _, _ := dial("u2", "A")
	waitCount(t, h, 3)

	h.push(event{Users: []string{"u1"}, Type: "dm", Data: json.RawMessage(`{"from":"yuki"}`)})
	for _, c := range []*websocket.Conn{a, b} {
		_, msg, err := c.Read(ctx)
		if err != nil || !strings.Contains(string(msg), `"type":"dm"`) || !strings.Contains(string(msg), "yuki") {
			t.Fatalf("push: %s %v", msg, err)
		}
	}

	// Tab A reconnects: its old socket is closed with closeReplace
	a2, _, err := dial("u1", "A")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.Read(ctx); websocket.CloseStatus(err) != closeReplace {
		t.Fatalf("old socket of the tab: %v", err)
	}
	waitCount(t, h, 3)

	h.disconnect([]string{"u1"})
	for _, c := range []*websocket.Conn{a2, b} {
		if _, _, err := c.Read(ctx); websocket.CloseStatus(err) != closeKicked {
			t.Fatalf("disconnect: %v", err)
		}
	}
	waitCount(t, h, 1) // u2 stays
	other.Close(websocket.StatusNormalClosure, "")
	waitCount(t, h, 0)
}

func waitCount(t *testing.T, h *hub, n int) {
	t.Helper()
	for i := 0; i < 100 && h.count() != n; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if h.count() != n {
		t.Fatalf("open sockets: %d, want %d", h.count(), n)
	}
}
