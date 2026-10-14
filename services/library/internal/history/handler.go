package history

import (
	"encoding/json"
	"net/http"
	"strconv"

	"nmv/library/internal/platform/httpx"
)

func marshal(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// Handler serves the reading-history routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// List: GET /history?limit=
func (h *Handler) List(w http.ResponseWriter, r *http.Request, me string) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.svc.List(r.Context(), me, limit)
	if err != nil {
		return err
	}
	httpx.OK(w, rows)
	return nil
}

// Save: POST /history {chapter_id, scroll_position, page_number, time_spent_seconds}
func (h *Handler) Save(w http.ResponseWriter, r *http.Request, me string) error {
	var body saveRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		return err
	}
	p, err := h.svc.Save(r.Context(), me, body)
	if err != nil {
		return err
	}
	// same keys as the backend's UserReadingLog object (no row id: the row is written later)
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã ghi nhận lịch sử đọc thành công", "data": map[string]any{
		"userId": me, "storyId": p.StoryID, "chapterId": body.ChapterID, "scrollPosition": p.Scroll, "pageNumber": p.Page,
		"readAt": p.ReadAt, "timeSpentSeconds": p.Seconds,
	}})
	return nil
}

// Open: POST /internal/history {user_id, chapter_id}
func (h *Handler) Open(w http.ResponseWriter, r *http.Request) error {
	var b openRequest
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		return err
	}
	if err := h.svc.RecordOpen(r.Context(), b); err != nil {
		return err
	}
	httpx.OK(w, nil)
	return nil
}

// Delete: DELETE /history/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, me string) error {
	if err := h.svc.Delete(r.Context(), me, r.PathValue("id")); err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa khỏi lịch sử đọc"})
	return nil
}

// Clear: DELETE /history
func (h *Handler) Clear(w http.ResponseWriter, r *http.Request, me string) error {
	if err := h.svc.Clear(r.Context(), me); err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa toàn bộ lịch sử đọc của bạn"})
	return nil
}

// Merge: POST /history/merge {items: [{chapter_id, read_at, scroll_position}]}
func (h *Handler) Merge(w http.ResponseWriter, r *http.Request, me string) error {
	var body mergeRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		return err
	}
	n, err := h.svc.Merge(r.Context(), me, body)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"merged": n}})
	return nil
}
