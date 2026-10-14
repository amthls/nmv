package drafts

import (
	"errors"
	"net/http"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// access loads draft {id} (no blocks) and the caller's role, writing the error response when the role is not one of
// `allowed`.
func (h *Handler) access(w http.ResponseWriter, r *http.Request, allowed ...string) (*Draft, string, catalog.Perm, bool) {
	id, user := r.PathValue("id"), h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return nil, "", catalog.Perm{}, false
	}
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return nil, "", catalog.Perm{}, false
	}
	d, err := h.svc.Get(r.Context(), id)
	if err != nil {
		domain.DraftError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	role, p, err := h.svc.Role(r.Context(), d, user)
	if err != nil {
		httpx.InternalError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	for _, a := range allowed {
		if a == role {
			d.Access = role
			return d, user, p, true
		}
	}
	if role == "" {
		httpx.Fail(w, 403, "Bạn không có quyền xem bản nháp này.")
	} else {
		httpx.Fail(w, 403, "Chỉ chủ bản nháp làm được việc này.")
	}
	return nil, "", catalog.Perm{}, false
}

// Get: GET /drafts/{id}: the draft with its blocks for its owner and the people it is shared with; the owner also sees
// who it is shared with and helpers' copies sent back.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	d, _, p, allowed := h.access(w, r, "owner", "editor", "viewer")
	if !allowed {
		return
	}
	d, err := h.svc.View(r.Context(), d.ID, d.Access)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	d.CanMerge = &p.Keeper
	httpx.OK(w, d)
}

// Lock: POST /drafts/{id}/lock: take or keep the edit lock (heartbeat while the editor is open).
func (h *Handler) Lock(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := h.access(w, r, "owner", "editor")
	if !allowed {
		return
	}
	until, err := h.svc.Lock(r.Context(), d.ID, user, &p.Name)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"lock_until": until})
}

// Unlock: DELETE /drafts/{id}/lock
func (h *Handler) Unlock(w http.ResponseWriter, r *http.Request) {
	d, user, _, allowed := h.access(w, r, "owner", "editor")
	if !allowed {
		return
	}
	if err := h.svc.Unlock(r.Context(), d.ID, user); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, nil)
}

// Share: POST /internal/drafts/{id}/shares {owner_id, user_id, user_name, can_edit}: the owner shares (the backend
// checked the recipient takes part in the story and sends them the card in a direct message). Sharing again updates
// can_edit.
func (h *Handler) Share(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		OwnerID  string  `json:"owner_id"`
		UserID   string  `json:"user_id"`
		UserName *string `json:"user_name"`
		CanEdit  bool    `json:"can_edit"`
	}
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.UserID) || b.UserID == b.OwnerID {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	if err := h.svc.Share(r.Context(), id, b.OwnerID, b.UserID, b.UserName, b.CanEdit); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"draft_id": id, "user_id": b.UserID, "can_edit": b.CanEdit})
}

// Unshare: DELETE /drafts/{id}/shares/{user}: the owner stops sharing with someone.
func (h *Handler) Unshare(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := h.access(w, r, "owner")
	if !allowed {
		return
	}
	if err := h.svc.Unshare(r.Context(), d.ID, r.PathValue("user")); err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, nil)
}

// Copy: POST /drafts/{id}/copy: someone it is shared with makes their own copy to edit and send back.
func (h *Handler) Copy(w http.ResponseWriter, r *http.Request) {
	src, user, p, allowed := h.access(w, r, "editor", "viewer")
	if !allowed {
		return
	}
	newID, err := h.svc.Copy(r.Context(), src.ID, user, p.Name)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	WriteDraft(w, r, h.svc, newID, 201)
}

// Offer: POST /internal/drafts/{id}/offer {owner_id}: the helper sends their copy back (the backend tells the
// original's owner).
func (h *Handler) Offer(w http.ResponseWriter, r *http.Request) {
	id, b, valid := ReadDecision(w, r)
	if !valid {
		return
	}
	originalOwner, err := h.svc.Offer(r.Context(), id, *b)
	if errors.Is(err, domain.ErrNotCopy) {
		httpx.Fail(w, 400, "Đây không phải bản sao của nháp người khác.")
		return
	}
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"id": id, "original_owner_id": originalOwner, "status": "offered"})
}

// OfferPreview: GET /drafts/{id}/offers/{copy}: what taking a helper's copy in would change (every change of theirs to
// choose).
func (h *Handler) OfferPreview(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := h.access(w, r, "owner")
	if !allowed {
		return
	}
	out, err := h.svc.OfferPreview(r.Context(), d.ID, r.PathValue("copy"))
	if errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
		return
	}
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// OfferAccept: POST /drafts/{id}/offers/{copy} {expected_version, choices}: take the helper's changes in as chosen.
func (h *Handler) OfferAccept(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := h.access(w, r, "owner")
	if !allowed {
		return
	}
	var b OfferRequest
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	err := h.svc.OfferAccept(r.Context(), d.ID, r.PathValue("copy"), user, &p.Name, b)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		httpx.Fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
	case err != nil:
		domain.DraftError(w, r, err)
	default:
		WriteDraft(w, r, h.svc, d.ID, 200)
	}
}

// OfferDecline: DELETE /drafts/{id}/offers/{copy}: not taken in: the copy goes back to its helper (open again).
func (h *Handler) OfferDecline(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := h.access(w, r, "owner")
	if !allowed {
		return
	}
	found, err := h.svc.OfferDecline(r.Context(), d.ID, r.PathValue("copy"))
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !found {
		httpx.Fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
		return
	}
	httpx.OK(w, nil)
}

// Transfer: POST /internal/drafts/{id}/transfer {owner_id, to_id, to_name}: the owner hands an open draft over (the
// backend checked the recipient takes part in the story).
func (h *Handler) Transfer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		OwnerID string  `json:"owner_id"`
		ToID    string  `json:"to_id"`
		ToName  *string `json:"to_name"`
	}
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.ToID) || b.ToID == b.OwnerID {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	if err := h.svc.Transfer(r.Context(), id, b.OwnerID, b.ToID, b.ToName); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	WriteDraft(w, r, h.svc, id, 200)
}

// Orphans: GET /drafts/orphans?story_id=: keepers see open drafts whose owners no longer take part in the story.
func (h *Handler) Orphans(w http.ResponseWriter, r *http.Request) {
	user, story := h.auth.UserFrom(r), r.URL.Query().Get("story_id")
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
	if !p.Keeper {
		httpx.Fail(w, 403, "Chỉ người giữ truyện xem được danh sách này.")
		return
	}
	list, err := h.svc.Orphans(r.Context(), story)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}

// Reclaim: POST /drafts/{id}/reclaim: a keeper takes over the draft of someone who no longer takes part in the story,
// so their work is not lost (a waiting proposal of theirs is withdrawn and becomes the keeper's draft).
func (h *Handler) Reclaim(w http.ResponseWriter, r *http.Request) {
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
	d, err := h.svc.Get(ctx, id)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	p, err := h.perms.Permission(ctx, user, d.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	op, err := h.perms.Permission(ctx, d.OwnerID, d.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	switch {
	case !p.Keeper:
		httpx.Fail(w, 403, "Chỉ người giữ truyện nhận lại được nháp.")
		return
	case op.Contributor:
		httpx.Fail(w, 409, "Người viết vẫn đang tham gia truyện: nhờ họ giao nháp cho bạn.")
		return
	}
	if err := h.svc.Reclaim(ctx, id, user, p.Name); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	WriteDraft(w, r, h.svc, id, 200)
}

// Card: GET /drafts/{id}/card: the summary a direct message shows. Someone without access only learns that.
func (h *Handler) Card(w http.ResponseWriter, r *http.Request) {
	id, user := r.PathValue("id"), h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	d, blockCount, err := h.svc.Card(r.Context(), id)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	role, _, err := h.svc.Role(r.Context(), d, user)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if role == "" {
		httpx.OK(w, map[string]any{"id": id, "access": "none"})
		return
	}
	httpx.OK(w, map[string]any{"id": id, "access": role, "meta": d.Meta, "story_id": d.StoryID, "chapter_id": d.ChapterID, "owner_name": d.OwnerName,
		"status": d.Status, "block_count": blockCount, "updated_at": d.UpdatedAt})
}

// SharedWithMe: GET /drafts/shared: drafts shared with me ("được nhờ"), in stories I still take part in.
func (h *Handler) SharedWithMe(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	list, err := h.svc.SharedWithMe(r.Context(), user)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}
