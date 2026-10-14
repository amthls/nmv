package albums

import (
	"fmt"
	"net/http"
	"strconv"

	"nmv/library/internal/platform/httpx"
)

// Handler serves the album routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// readBody reads an optional JSON object body (no body = empty object).
func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	body := map[string]any{}
	if r.ContentLength == 0 {
		return body, nil
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		return nil, err
	}
	return body, nil
}

// Mine: GET /albums/me?story_id=
func (h *Handler) Mine(w http.ResponseWriter, r *http.Request, me string) error {
	rows, err := h.svc.Mine(r.Context(), me, r.URL.Query().Get("story_id"))
	if err != nil {
		return err
	}
	httpx.OK(w, rows)
	return nil
}

// Saved: GET /albums/saved
func (h *Handler) Saved(w http.ResponseWriter, r *http.Request, me string) error {
	rows, err := h.svc.Saved(r.Context(), me)
	if err != nil {
		return err
	}
	httpx.OK(w, rows)
	return nil
}

// ByStory: GET /albums/by-story/{storyId}
func (h *Handler) ByStory(w http.ResponseWriter, r *http.Request, me string) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	data, err := h.svc.ByStory(r.Context(), me, r.PathValue("storyId"), limit)
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}

// Get: GET /albums/{id}?key=
func (h *Handler) Get(w http.ResponseWriter, r *http.Request, me string) error {
	album, err := h.svc.Get(r.Context(), r.PathValue("id"), me, r.URL.Query().Get("key"))
	if err != nil {
		return err
	}
	httpx.OK(w, album)
	return nil
}

// Create: POST /albums {name, description?, is_public?, story_id?}
func (h *Handler) Create(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	album, err := h.svc.Create(r.Context(), me, body)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": album, "message": "Đã tạo album."})
	return nil
}

// Update: PUT /albums/{id} {name?, description?, is_public?}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request, me string) error {
	row, err := h.svc.Update(r.Context(), me, r.PathValue("id"), func() (map[string]any, error) { return readBody(w, r) })
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "data": row, "message": "Đã cập nhật album."})
	return nil
}

// AllVisibility: PUT /albums/me/visibility {is_public}
func (h *Handler) AllVisibility(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	changed, public, err := h.svc.SetAllVisibility(r.Context(), me, body)
	if err != nil {
		return err
	}
	msg := "Đã chuyển tất cả album sang riêng tư."
	if public {
		msg = "Đã công khai tất cả album."
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"changed": changed}, "message": msg})
	return nil
}

// Delete: DELETE /albums/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, me string) error {
	if err := h.svc.Delete(r.Context(), me, r.PathValue("id")); err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "message": "Đã xóa album."})
	return nil
}

// ResetShareLink: POST /albums/{id}/share-link/reset
func (h *Handler) ResetShareLink(w http.ResponseWriter, r *http.Request, me string) error {
	row, err := h.svc.ResetShareLink(r.Context(), me, r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "data": row, "message": "Đã tạo link chia sẻ mới, link cũ không còn dùng được."})
	return nil
}

// AddStory: POST /albums/{id}/stories {story_id}
func (h *Handler) AddStory(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	name, err := h.svc.AddStory(r.Context(), me, r.PathValue("id"), body)
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": "added", "message": fmt.Sprintf("Đã lưu vào album \"%s\".", name)})
	return nil
}

// RemoveStory: DELETE /albums/{id}/stories/{storyId}
func (h *Handler) RemoveStory(w http.ResponseWriter, r *http.Request, me string) error {
	name, err := h.svc.RemoveStory(r.Context(), me, r.PathValue("id"), r.PathValue("storyId"))
	if err != nil {
		return err
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": fmt.Sprintf("Đã bỏ truyện khỏi album \"%s\".", name)})
	return nil
}

// Save: POST /albums/{id}/save {key?}
func (h *Handler) Save(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	saved, err := h.svc.ToggleSave(r.Context(), me, r.PathValue("id"), body)
	if err != nil {
		return err
	}
	if !saved {
		httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": "removed", "message": "Đã bỏ lưu album."})
		return nil
	}
	httpx.WriteJSON(w, 200, map[string]any{"success": true, "action": "added", "message": "Đã lưu album vào mục \"Album đã lưu\"."})
	return nil
}

// Copy: POST /albums/{id}/copy {key?, target_album_id?, name?}
func (h *Handler) Copy(w http.ResponseWriter, r *http.Request, me string) error {
	body, err := readBody(w, r)
	if err != nil {
		return err
	}
	res, err := h.svc.Copy(r.Context(), me, r.PathValue("id"), body)
	if err != nil {
		return err
	}
	msg := fmt.Sprintf("Album \"%s\" đã có đủ các truyện này.", res.AlbumName)
	if res.Added > 0 {
		msg = fmt.Sprintf("Đã sao chép %d truyện vào album \"%s\".", res.Added, res.AlbumName)
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "message": msg,
		"data": map[string]any{"album_id": res.AlbumID, "album_name": res.AlbumName, "added": res.Added}})
	return nil
}
