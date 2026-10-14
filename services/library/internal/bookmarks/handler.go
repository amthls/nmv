package bookmarks

import (
	"net/http"

	"nmv/library/internal/platform/httpx"
)

// Handler serves the bookmark routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// List: GET /bookmarks?chapter_id=&story_id=
func (h *Handler) List(w http.ResponseWriter, r *http.Request, me string) error {
	q := r.URL.Query()
	rows, err := h.svc.List(r.Context(), me, q.Get("chapter_id"), q.Get("story_id"))
	if err != nil {
		return err
	}
	httpx.OK(w, rows)
	return nil
}

// Create: POST /bookmarks {story_id, chapter_id, line_text?, line_index?, ...}
func (h *Handler) Create(w http.ResponseWriter, r *http.Request, me string) error {
	var b createRequest
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		return err
	}
	row, removed, err := h.svc.Create(r.Context(), me, b)
	if err != nil {
		return err
	}
	if removed {
		httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": "Đã bỏ bookmark dòng này."})
		return nil
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "action": "added", "data": row, "message": "Đã tạo bookmark thành công."})
	return nil
}

// Delete: DELETE /bookmarks/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, me string) error {
	if err := h.svc.Delete(r.Context(), me, r.PathValue("id")); err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa bookmark thành công."})
	return nil
}
