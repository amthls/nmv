package schedule

import (
	"errors"
	"net/http"
	"time"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// Handler serves the schedule routes.
type Handler struct {
	svc    *Service
	drafts *drafts.Service
	auth   httpx.Auth
	perms  *catalog.Client
	now    func() time.Time
}

// NewHandler wires the handler.
func NewHandler(svc *Service, d *drafts.Service, auth httpx.Auth, perms *catalog.Client, now func() time.Time) *Handler {
	return &Handler{svc: svc, drafts: d, auth: auth, perms: perms, now: now}
}

// Schedule: POST /internal/drafts/{id}/schedule {owner_id = the caller, owner_name, publish_at}.
func (h *Handler) Schedule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b Request
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.OwnerID) {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	if b.PublishAt.Before(h.now().Add(time.Minute)) || b.PublishAt.After(h.now().AddDate(1, 0, 0)) {
		httpx.Fail(w, 400, "Giờ đăng phải từ 1 phút tới 1 năm nữa.")
		return
	}
	if err := h.svc.Schedule(r.Context(), id, b); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	drafts.WriteDraft(w, r, h.drafts, id, 200)
}

// Unschedule: DELETE /drafts/{id}/schedule: a keeper (or whoever scheduled it) calls it off; the draft goes back as it was.
func (h *Handler) Unschedule(w http.ResponseWriter, r *http.Request) {
	user, id := h.auth.UserFrom(r), r.PathValue("id")
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	ctx := r.Context()
	d, err := h.drafts.Get(ctx, id)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	p, err := h.perms.Permission(ctx, user, d.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !p.Keeper {
		httpx.Fail(w, 403, "Chỉ người giữ truyện hủy được hẹn đăng.")
		return
	}
	err = h.svc.Unschedule(ctx, id, d, user, &p.Name)
	if errors.Is(err, domain.ErrNotScheduled) {
		httpx.Fail(w, 409, "Bản nháp này không còn hẹn giờ (có thể vừa được đăng).")
		return
	}
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	drafts.WriteDraft(w, r, h.drafts, id, 200)
}
