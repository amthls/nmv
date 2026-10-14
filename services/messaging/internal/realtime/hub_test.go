package realtime

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

	"nmv/messaging/internal/platform/events"
	"nmv/messaging/internal/platform/logger"
)

const testKey = "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"

func signed(user string) http.Header {
	exp := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	roles := "reader"
	m := hmac.New(sha256.New, []byte(testKey))
	m.Write([]byte(user + "|" + roles + "|" + exp))
	return http.Header{"X-User-Id": {user}, "X-User-Roles": {roles}, "X-User-Exp": {exp}, "X-User-Sig": {hex.EncodeToString(m.Sum(nil))}}
}

// A real socket through the hub: guests refused, pushes reach every tab of the user, the same tab replaces its old
// socket, _disconnect closes them all.
func TestHub(t *testing.T) {
	h := NewHub()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", NewHandler(h, []byte(testKey), time.Now).Serve)
	srv := httptest.NewServer(logger.WithRequestLog(mux)) // as in main: the upgrade must get through the log wrapper
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

	h.Push(events.Event{Users: []string{"u1"}, Type: "dm", Data: json.RawMessage(`{"from":"yuki"}`)})
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

	h.Disconnect([]string{"u1"})
	for _, c := range []*websocket.Conn{a2, b} {
		if _, _, err := c.Read(ctx); websocket.CloseStatus(err) != closeKicked {
			t.Fatalf("disconnect: %v", err)
		}
	}
	waitCount(t, h, 1) // u2 stays
	other.Close(websocket.StatusNormalClosure, "")
	waitCount(t, h, 0)
}

func waitCount(t *testing.T, h *Hub, n int) {
	t.Helper()
	for i := 0; i < 100 && h.Count() != n; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if h.Count() != n {
		t.Fatalf("open sockets: %d, want %d", h.Count(), n)
	}
}
