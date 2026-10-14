package proposals

import (
	"errors"
	"net/http"
	"strings"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// Handler serves the proposal routes.
type Handler struct {
	svc    *Service
	drafts *drafts.Service
	auth   httpx.Auth
	perms  *catalog.Client
}

// NewHandler wires the handler.
func NewHandler(svc *Service, d *drafts.Service, auth httpx.Auth, perms *catalog.Client) *Handler {
	return &Handler{svc: svc, drafts: d, auth: auth, perms: perms}
}

// Submit: POST /internal/drafts/{id}/submit {owner_id, note}: the owner sends the draft for review (a new round).
func (h *Handler) Submit(w http.ResponseWriter, r *http.Request) {
	id, b, valid := drafts.ReadDecision(w, r)
	if !valid {
		return
	}
	err := h.svc.Submit(r.Context(), id, b)
	if errors.Is(err, domain.ErrEmptyTitle) {
		httpx.Fail(w, 400, "Chương cần có tiêu đề trước khi gửi đề xuất.")
		return
	}
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	drafts.WriteDraft(w, r, h.drafts, id, 200)
}

func (h *Handler) decide(w http.ResponseWriter, r *http.Request, decision string) {
	id, b, valid := drafts.ReadDecision(w, r)
	if !valid {
		return
	}
	if err := h.svc.Decide(r.Context(), id, decision, b); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	drafts.WriteDraft(w, r, h.drafts, id, 200)
}

// Withdraw: POST /internal/drafts/{id}/withdraw
func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) { h.decide(w, r, "withdrawn") }

// Return: POST /internal/drafts/{id}/return
func (h *Handler) Return(w http.ResponseWriter, r *http.Request) { h.decide(w, r, "returned") }

// ---- public ----------------------------------------------------------------------------------------------

// List: GET /proposals?story_id=: drafts waiting for review in a story (keepers see all of them, others their own).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	story := r.URL.Query().Get("story_id")
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !ids.IsUUID(story) {
		httpx.Fail(w, 400, "Thiếu story_id.")
		return
	}
	p, err := h.perms.Permission(r.Context(), user, story)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !p.Contributor {
		httpx.Fail(w, 403, "Bạn không tham gia truyện này.")
		return
	}
	list, err := h.svc.List(r.Context(), story, p.Keeper, user)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}

// viewer: the caller and their rights when they own draft {id} or keep its story; writes the error otherwise.
func (h *Handler) viewer(w http.ResponseWriter, r *http.Request) (*drafts.Draft, string, catalog.Perm, bool) {
	id, user := r.PathValue("id"), h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return nil, "", catalog.Perm{}, false
	}
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return nil, "", catalog.Perm{}, false
	}
	d, err := h.drafts.Get(r.Context(), id)
	if err != nil {
		domain.DraftError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	p, err := h.perms.Permission(r.Context(), user, d.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	if d.OwnerID != user && !(p.Keeper && d.LastRound > 0) {
		httpx.Fail(w, 403, "Chỉ người viết và người giữ truyện xem được đề xuất này.")
		return nil, "", catalog.Perm{}, false
	}
	return d, user, p, true
}

// Review: GET /drafts/{id}/review
func (h *Handler) Review(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := h.viewer(w, r)
	if !allowed {
		return
	}
	out, err := h.svc.Review(r.Context(), d, user, p.Keeper, p.Removed)
	if errors.Is(err, domain.ErrNotSubmitted) {
		httpx.Fail(w, 404, "Bản nháp này chưa gửi đề xuất lần nào.")
		return
	}
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// Comment: POST /drafts/{id}/comments {body, block_hash?}: the author and the keepers talk about the latest round.
func (h *Handler) Comment(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := h.viewer(w, r)
	if !allowed {
		return
	}
	var b struct {
		Body      string  `json:"body"`
		BlockHash *string `json:"block_hash"`
	}
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	body := strings.TrimSpace(b.Body)
	if body == "" || len([]rune(body)) > 2000 {
		httpx.Fail(w, 400, "Góp ý cần có nội dung (tối đa 2000 ký tự).")
		return
	}
	if d.LastRound == 0 {
		httpx.Fail(w, 404, "Bản nháp này chưa gửi đề xuất lần nào.")
		return
	}
	if b.BlockHash != nil && !h.svc.BlockExists(r.Context(), *b.BlockHash) {
		httpx.Fail(w, 400, "Đoạn được góp ý không tồn tại.")
		return
	}
	id, err := h.svc.Comment(r.Context(), d.ID, d.LastRound, b.BlockHash, body, user, p.Name)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": map[string]any{"id": id}})
}
