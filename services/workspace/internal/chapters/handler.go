package chapters

import (
	"errors"
	"net/http"
	"strconv"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// Handler serves the chapter routes: /internal for the backend, /chapters/... for contributors.
type Handler struct {
	svc   *Service
	auth  httpx.Auth
	perms *catalog.Client
}

// NewHandler wires the handler.
func NewHandler(svc *Service, auth httpx.Auth, perms *catalog.Client) *Handler {
	return &Handler{svc: svc, auth: auth, perms: perms}
}

// ---- internal API (backend → workspace; content already validated and sanitized by the backend) ----------

// Stats: GET /internal/stats
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	out, err := h.svc.Stats(r.Context())
	if err != nil {
		httpx.Fail(w, 500, err.Error())
		return
	}
	httpx.OK(w, out)
}

// Create: POST /internal/chapters
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var b WriteBody
	if httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.StoryID) || b.Meta.Title == "" {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	rev, err := h.svc.Create(r.Context(), b)
	if err != nil {
		domain.ChapterError(w, r, err, b.Meta.ChapterNumber)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": rev})
}

// Edit: POST /internal/chapters/{id}/revisions
func (h *Handler) Edit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b WriteBody
	if !ids.IsUUID(id) || httpx.ReadJSON(w, r, &b) != nil || b.Meta.Title == "" {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	rev, err := h.svc.Edit(r.Context(), id, b)
	if err != nil {
		domain.ChapterError(w, r, err, b.Meta.ChapterNumber)
		return
	}
	httpx.OK(w, rev)
}

// Delete: POST /internal/chapters/{id}/delete
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b WriteBody
	httpx.ReadJSON(w, r, &b)
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Chương không tồn tại.")
		return
	}
	rev, err := h.svc.Delete(r.Context(), id, b.AuthorID, b.AuthorName)
	if err != nil {
		domain.ChapterError(w, r, err, 0)
		return
	}
	httpx.OK(w, rev)
}

// Current: GET /internal/chapters/{id}
func (h *Handler) Current(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Chương không tồn tại.")
		return
	}
	rev, err := h.svc.Current(r.Context(), id)
	if err != nil {
		domain.ChapterError(w, r, err, 0)
		return
	}
	httpx.OK(w, rev)
}

// ---- public API (/api/ws/*, signed user headers) ------------------------------------------------------------

// access: the caller and their rights on the chapter's story; writes the error response itself.
func (h *Handler) access(w http.ResponseWriter, r *http.Request, needKeeper bool) (string, string, catalog.Perm, bool) {
	id := r.PathValue("id")
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return "", "", catalog.Perm{}, false
	}
	story, err := h.svc.StoryOf(r.Context(), id)
	if !ids.IsUUID(id) || errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Chương không tồn tại.")
		return "", "", catalog.Perm{}, false
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return "", "", catalog.Perm{}, false
	}
	p, err := h.perms.Permission(r.Context(), user, story)
	if err != nil {
		httpx.InternalError(w, r, err)
		return "", "", catalog.Perm{}, false
	}
	if needKeeper && !p.Keeper {
		httpx.Fail(w, 403, "Chỉ người giữ truyện (chủ truyện, Trưởng nhóm/Mod của nhóm) mới khôi phục được phiên bản.")
		return "", "", catalog.Perm{}, false
	}
	if !p.Contributor {
		httpx.Fail(w, 403, "Bạn không tham gia truyện này nên không xem được lịch sử chương.")
		return "", "", catalog.Perm{}, false
	}
	return id, user, p, true
}

// Revisions: GET /chapters/{id}/revisions
func (h *Handler) Revisions(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := h.access(w, r, false)
	if !allowed {
		return
	}
	list, err := h.svc.List(r.Context(), id)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}

// Revision: GET /chapters/{id}/revisions/{version}
func (h *Handler) Revision(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := h.access(w, r, false)
	if !allowed {
		return
	}
	v, _ := strconv.Atoi(r.PathValue("version"))
	rev, err := h.svc.Revision(r.Context(), id, v)
	if errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Không có phiên bản này.")
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, rev)
}

// Compare: GET /chapters/{id}/compare?from=&to=
func (h *Handler) Compare(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := h.access(w, r, false)
	if !allowed {
		return
	}
	from, _ := strconv.Atoi(r.URL.Query().Get("from"))
	to, _ := strconv.Atoi(r.URL.Query().Get("to"))
	out, err := h.svc.Compare(r.Context(), id, from, to)
	if errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Không có phiên bản này.")
		return
	}
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, out)
}

// Rewind: POST /chapters/{id}/rewind {to_version}: keepers bring back an old version as a new one (also undeletes).
func (h *Handler) Rewind(w http.ResponseWriter, r *http.Request) {
	id, user, p, allowed := h.access(w, r, true)
	if !allowed {
		return
	}
	if p.Removed {
		httpx.Fail(w, 409, "Truyện đang bị gỡ: chưa thể thay đổi bản chính thức cho tới khi được khôi phục.")
		return
	}
	var b struct {
		To int `json:"to_version"`
	}
	if httpx.ReadJSON(w, r, &b) != nil || b.To < 1 {
		httpx.Fail(w, 400, "Thiếu phiên bản cần khôi phục.")
		return
	}
	rev, number, err := h.svc.Rewind(r.Context(), id, b.To, user, p.Name)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			httpx.Fail(w, 404, "Không có phiên bản này (hoặc đó là bản đã xóa).")
			return
		}
		domain.ChapterError(w, r, err, number)
		return
	}
	httpx.OK(w, rev)
}
