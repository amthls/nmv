package follows

import (
	"net/http"

	"nmv/library/internal/platform/httpx"
)

// Handler serves the follow routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// List: GET /favorites?category=
func (h *Handler) List(w http.ResponseWriter, r *http.Request, me string) error {
	rows, err := h.svc.List(r.Context(), me, r.URL.Query().Get("category"))
	if err != nil {
		return err
	}
	httpx.OK(w, rows)
	return nil
}

// Toggle: POST /favorites/toggle {story_id, category?, notify_updates?}
func (h *Handler) Toggle(w http.ResponseWriter, r *http.Request, me string) error {
	b := toggleRequest{Category: "reading"}
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		return err
	}
	action, err := h.svc.Toggle(r.Context(), me, b)
	if err != nil {
		return err
	}
	msg := map[string]string{
		ActionUpdated: "Đã cập nhật trạng thái theo dõi truyện.",
		ActionRemoved: "Đã hủy theo dõi truyện.",
		ActionAdded:   "Đã theo dõi truyện thành công.",
	}[action]
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": action, "message": msg})
	return nil
}

// Status: GET /favorites/status/{storyId} (guests: not following)
func (h *Handler) Status(w http.ResponseWriter, r *http.Request, me string) error {
	category, found, err := h.svc.Status(r.Context(), me, r.PathValue("storyId"))
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "is_favorite": found, "category": category})
	return nil
}
