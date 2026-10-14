package realtime

import (
	"net/http"
	"time"

	"nmv/messaging/internal/platform/httpx"
)

// Handler serves GET /ws.
type Handler struct {
	hub    *Hub
	sigKey []byte // USER_SIG_KEY_MESSAGING
	now    func() time.Time
}

// NewHandler wires the handler.
func NewHandler(hub *Hub, sigKey []byte, now func() time.Time) *Handler {
	return &Handler{hub: hub, sigKey: sigKey, now: now}
}

// Serve upgrades signed-in requests to a WebSocket (?tab= names the browser tab).
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	user := httpx.UserFrom(h.sigKey, r, h.now())
	if user == "" {
		httpx.WriteJSON(w, 401, map[string]any{"success": false, "message": "Bạn chưa đăng nhập."})
		return
	}
	h.hub.Serve(w, r, user, r.URL.Query().Get("tab"))
}
