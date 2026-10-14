package notifications

import (
	"encoding/json"
	"net/http"

	"nmv/messaging/internal/platform/httpx"
)

// Handler serves the bell, the settings, the announcements and the backend's job fallback.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// List: GET /notifications?category=&unread=1&q=&before=<updated_at RFC3339>&limit=30
func (h *Handler) List(w http.ResponseWriter, r *http.Request, me string) {
	q := r.URL.Query()
	out, err := h.svc.List(r.Context(), me, q.Get("category"), q.Get("limit"), q.Get("before"), q.Get("unread"), q.Get("q"))
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// Seen: POST /notifications/seen
func (h *Handler) Seen(w http.ResponseWriter, r *http.Request, me string) {
	if err := h.svc.Seen(r.Context(), me); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, nil)
}

// Read: PUT /notifications/{id}/read (a notification or an announcement)
func (h *Handler) Read(w http.ResponseWriter, r *http.Request, me string) {
	if err := h.svc.Read(r.Context(), me, r.PathValue("id")); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OKMsg(w, "Đã đánh dấu thông báo là đã đọc.", nil)
}

// ReadAll: PUT /notifications/read-all?category=
func (h *Handler) ReadAll(w http.ResponseWriter, r *http.Request, me string) {
	if err := h.svc.ReadAll(r.Context(), me, r.URL.Query().Get("category")); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OKMsg(w, "Đã đánh dấu tất cả thông báo là đã đọc.", nil)
}

// Delete: DELETE /notifications/{id} (an announcement can't be deleted for one person: it is marked read instead)
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request, me string) {
	deleted, err := h.svc.Delete(r.Context(), me, r.PathValue("id"))
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	if !deleted {
		h.Read(w, r, me)
		return
	}
	httpx.OKMsg(w, "Đã xóa thông báo.", nil)
}

// Settings: GET /notifications/settings -> [{category, label, web}]
func (h *Handler) Settings(w http.ResponseWriter, r *http.Request, me string) {
	out, err := h.svc.Settings(r.Context(), me)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// PutSettings: PUT /notifications/settings {"<category>": {"web": bool}, ...}
func (h *Handler) PutSettings(w http.ResponseWriter, r *http.Request, me string) {
	var body settingsBody
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.Fail(w, 400, "Cài đặt không hợp lệ.")
		return
	}
	if err := h.svc.PutSettings(r.Context(), me, body); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	h.Settings(w, r, me)
}

// Broadcasts: GET /admin/broadcasts
func (h *Handler) Broadcasts(w http.ResponseWriter, r *http.Request, _ string) {
	list, err := h.svc.Broadcasts(r.Context())
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OK(w, list)
}

// CreateBroadcast: POST /admin/broadcasts {title, message?, link?}
func (h *Handler) CreateBroadcast(w http.ResponseWriter, r *http.Request, me string) {
	var body broadcastBody
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.Fail(w, 400, "Dữ liệu không hợp lệ.")
		return
	}
	id, err := h.svc.CreateBroadcast(r.Context(), me, body)
	if err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OKMsg(w, "Đã gửi thông báo toàn site.", map[string]any{"id": id})
}

// DeleteBroadcast: DELETE /admin/broadcasts/{id}
func (h *Handler) DeleteBroadcast(w http.ResponseWriter, r *http.Request, _ string) {
	if err := h.svc.DeleteBroadcast(r.Context(), r.PathValue("id")); err != nil {
		httpx.Answer(w, r, err)
		return
	}
	httpx.OKMsg(w, "Đã xóa thông báo toàn site.", nil)
}

// InternalJob: POST /internal/notifications/jobs, the backend's fallback when RabbitMQ is unreachable (same job body
// as the queue).
func (h *Handler) InternalJob(w http.ResponseWriter, r *http.Request) {
	var job notifyJob
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		httpx.Fail(w, 400, "bad job")
		return
	}
	n, err := h.svc.RunJob(r.Context(), job)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"created": n})
}
