package groupchat

import (
	"net/http"

	"nmv/messaging/internal/platform/httpx"
)

// Handler serves the group-chat routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Messages: GET /groups/{id}/messages
func (h *Handler) Messages(w http.ResponseWriter, r *http.Request, me string) {
	out, err := h.svc.Messages(r.Context(), r.PathValue("id"), me)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// Send: POST /groups/{id}/messages {message}
func (h *Handler) Send(w http.ResponseWriter, r *http.Request, me string) {
	var b sendRequest
	httpx.ReadJSON(w, r, &b)
	msg, err := h.svc.Send(r.Context(), r.PathValue("id"), me, b.Message)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": msg})
}

// Delete: DELETE /groups/{id}/messages/{messageId}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, me string) {
	if err := h.svc.Delete(r.Context(), r.PathValue("id"), r.PathValue("messageId"), me); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa tin nhắn"})
}
