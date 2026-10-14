package drafts

import (
	"errors"
	"net/http"
	"strings"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// Handler serves the draft routes (the lifecycle here, working together in collab_handler.go).
type Handler struct {
	svc   *Service
	auth  httpx.Auth
	perms *catalog.Client
}

// NewHandler wires the handler.
func NewHandler(svc *Service, auth httpx.Auth, perms *catalog.Client) *Handler {
	return &Handler{svc: svc, auth: auth, perms: perms}
}

// WriteDraft answers with the full draft (blocks included).
func WriteDraft(w http.ResponseWriter, r *http.Request, svc *Service, id string, status int) {
	d, err := svc.Full(r.Context(), id)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.WriteJSON(w, status, map[string]any{"success": true, "data": d})
}

// ReadDecision reads {owner_id (the caller), owner_name, note} and the draft id of submit / withdraw / return / offer;
// it answers 400 itself when the body is not valid.
func ReadDecision(w http.ResponseWriter, r *http.Request) (string, *DecisionBody, bool) {
	id := r.PathValue("id")
	b := &DecisionBody{}
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, b) != nil || !ids.IsUUID(b.OwnerID) || len(b.Note) > 5000 {
		httpx.Fail(w, 400, "invalid body")
		return "", nil, false
	}
	b.Note = strings.TrimSpace(b.Note)
	return id, b, true
}

// ---- internal (backend → workspace) ----------------------------------------------------------------------

// Create: POST /internal/drafts: a new chapter (meta + blocks), or a copy of a chapter's official version (chapter_id);
// the caller's open draft of that chapter is returned instead of a second one.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var b Body
	if httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.OwnerID) || !ids.IsUUID(b.StoryID) || (b.ChapterID != nil && !ids.IsUUID(*b.ChapterID)) ||
		(b.ChapterID == nil && b.Meta == nil) {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	id, reused, err := h.svc.Create(r.Context(), b)
	status := 201
	if reused {
		status = 200
	}
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			httpx.Fail(w, 404, "Chương không tồn tại.")
			return
		}
		domain.DraftError(w, r, err)
		return
	}
	WriteDraft(w, r, h.svc, id, status)
}

// Save: PUT /internal/drafts/{id}: autosave (owner only, expected_version stops two tabs overwriting each other).
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b Body
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || b.Meta == nil {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	version, updated, err := h.svc.Save(r.Context(), id, b)
	if err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"id": id, "version": version, "updated_at": updated})
}

// Internal: GET /internal/drafts/{id}: what the backend checks permissions on before publishing.
func (h *Handler) Internal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	WriteDraft(w, r, h.svc, id, 200)
}

// Publish: POST /internal/drafts/{id}/publish {owner_id = the caller}: the caller's own open draft, or a submitted
// proposal (the backend has checked the caller is a story keeper), becomes the next official version (or v1 of a new
// chapter). An own draft must be based on the current version (pull first); a proposal behind it is merged when diff3
// is clean.
func (h *Handler) Publish(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b Body
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.OwnerID) {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	rev, number, err := h.svc.Publish(r.Context(), id, b)
	switch {
	case errors.Is(err, domain.ErrEmptyTitle):
		httpx.Fail(w, 400, "Chương cần có tiêu đề trước khi đăng.")
	case errors.Is(err, domain.ErrNumberTaken):
		domain.ChapterError(w, r, err, number)
	case err != nil:
		domain.DraftError(w, r, err)
	default:
		httpx.OK(w, rev)
	}
}

// ---- public (/api/ws, the owner) ------------------------------------------------------------------------

// List: GET /drafts?story_id=: the caller's open drafts, newest first (no blocks).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	story := r.URL.Query().Get("story_id")
	if story != "" && !ids.IsUUID(story) {
		story = ""
	}
	list, err := h.svc.List(r.Context(), user, story)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}

// owner: the signed-in caller, when they own draft {id}; writes the error response otherwise.
func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	id, user := r.PathValue("id"), h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return "", "", false
	}
	owner, err := h.svc.OwnerOf(r.Context(), id)
	if !ids.IsUUID(id) || errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
		return "", "", false
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return "", "", false
	}
	if owner != user {
		httpx.Fail(w, 403, "Đây không phải bản nháp của bạn.")
		return "", "", false
	}
	return id, user, true
}

// Discard: DELETE /drafts/{id}: kept in the database, no longer listed or editable.
func (h *Handler) Discard(w http.ResponseWriter, r *http.Request) {
	id, user, allowed := h.owner(w, r)
	if !allowed {
		return
	}
	if err := h.svc.Discard(r.Context(), id, user); err != nil {
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, map[string]any{"id": id})
}

// PullPreview: GET /drafts/{id}/pull: what updating from the official version would do, with the data of every block
// involved.
func (h *Handler) PullPreview(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := h.access(w, r, "owner", "editor")
	if !allowed {
		return
	}
	out, err := h.svc.PullPreview(r.Context(), d.ID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			httpx.Fail(w, 400, "Nháp chương mới không có bản chính để cập nhật theo.")
			return
		}
		domain.DraftError(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// PullApply: POST /drafts/{id}/pull {expected_version, to_version, choices}: apply the merge; the draft is then based
// on to_version.
func (h *Handler) PullApply(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := h.access(w, r, "owner", "editor")
	if !allowed {
		return
	}
	var b PullRequest
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	err := h.svc.PullApply(r.Context(), d.ID, user, &p.Name, b)
	switch {
	case errors.Is(err, domain.ErrBehind):
		httpx.Fail(w, 409, "Bản chính thức vừa thay đổi thêm lần nữa. Hãy xem lại phần cập nhật.")
	case errors.Is(err, domain.ErrNotFound):
		httpx.Fail(w, 400, "Nháp chương mới không có bản chính để cập nhật theo.")
	case err != nil:
		domain.DraftError(w, r, err)
	default:
		WriteDraft(w, r, h.svc, d.ID, 200)
	}
}
