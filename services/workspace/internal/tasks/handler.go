package tasks

import (
	"errors"
	"net/http"
	"strings"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
)

// Handler serves /tasks.
type Handler struct {
	svc   *Service
	auth  httpx.Auth
	perms *catalog.Client
}

// NewHandler wires the handler.
func NewHandler(svc *Service, auth httpx.Auth, perms *catalog.Client) *Handler {
	return &Handler{svc: svc, auth: auth, perms: perms}
}

// caller: the signed-in caller and their rights on the task's story; writes the error response otherwise.
func (h *Handler) caller(w http.ResponseWriter, r *http.Request) (*Task, string, catalog.Perm, bool) {
	user, id := h.auth.UserFrom(r), r.PathValue("id")
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return nil, "", catalog.Perm{}, false
	}
	if !ids.IsUUID(id) {
		httpx.Fail(w, 404, "Không có việc này.")
		return nil, "", catalog.Perm{}, false
	}
	t, err := h.svc.Get(r.Context(), id)
	if err != nil {
		domain.TaskError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	p, err := h.perms.Permission(r.Context(), user, t.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return nil, "", catalog.Perm{}, false
	}
	if !p.Contributor {
		httpx.Fail(w, 403, "Bạn không tham gia truyện này.")
		return nil, "", catalog.Perm{}, false
	}
	return t, user, p, true
}

func answer(w http.ResponseWriter, r *http.Request, t *Task, err error) {
	if err != nil {
		domain.TaskError(w, r, err)
		return
	}
	httpx.OK(w, t)
}

// Create: POST /tasks {story_id, chapter_id | chapter_number, title?, assignee_id?, due_at?, note?}: a keeper assigns a
// chapter (to someone, or open to the step's role); anyone else in the story claims a chapter for themselves.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	var b CreateRequest
	if httpx.ReadJSON(w, r, &b) != nil || !ids.IsUUID(b.StoryID) || (b.ChapterID != nil && !ids.IsUUID(*b.ChapterID)) || (b.ChapterID == nil && (b.ChapterNumber == nil || *b.ChapterNumber < 0)) ||
		len(b.Note) > 2000 || len(b.Title) > 500 {
		httpx.Fail(w, 400, "Thiếu chương (chương có sẵn hoặc số chương mới) hoặc dữ liệu không hợp lệ.")
		return
	}
	ctx := r.Context()
	p, err := h.perms.Permission(ctx, user, b.StoryID)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	if !p.Contributor {
		httpx.Fail(w, 403, "Bạn không tham gia truyện này.")
		return
	}
	steps := p.Workflow
	if len(steps) == 0 {
		steps = []string{"translate"}
	}
	t := &Task{JobID: ids.New(), StoryID: b.StoryID, Steps: steps, Kind: steps[0], Status: "open", CreatedName: &p.Name, DueAt: b.DueAt,
		Note: nilIfEmpty(strings.TrimSpace(b.Note)), Title: nilIfEmpty(strings.TrimSpace(b.Title))}
	assignee := b.AssigneeID
	if !p.Keeper {
		assignee = user // contributors only claim chapters for themselves
		if !Eligible(p.Role, t.Kind) {
			httpx.Fail(w, 403, "Vai trò của bạn trong nhóm không nhận được bước đầu của quy trình ("+t.Kind+").")
			return
		}
	}
	if assignee != "" {
		if !ids.IsUUID(assignee) {
			httpx.Fail(w, 400, "Người nhận không hợp lệ.")
			return
		}
		ap, err := h.perms.Permission(ctx, assignee, b.StoryID)
		if err != nil {
			httpx.InternalError(w, r, err)
			return
		}
		if !ap.Contributor {
			httpx.Fail(w, 400, "Người được giao không tham gia truyện này.")
			return
		}
		t.AssigneeID, t.AssigneeName, t.Status = &assignee, &ap.Name, "claimed"
	}
	err = h.svc.Create(ctx, t, b, user, p.Name, assignee)
	if errors.Is(err, domain.ErrNotFound) {
		httpx.Fail(w, 404, "Chương không tồn tại.")
		return
	}
	if err != nil {
		domain.TaskError(w, r, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]any{"success": true, "data": t})
}

// Claim: POST /tasks/{id}/claim: take an open step (by role).
func (h *Handler) Claim(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && !Eligible(p.Role, t.Kind) {
		httpx.Fail(w, 403, "Vai trò của bạn trong nhóm không nhận được bước này.")
		return
	}
	t, err := h.svc.Claim(r.Context(), t.ID, user, p.Name)
	answer(w, r, t, err)
}

// Unclaim: POST /tasks/{id}/unclaim: the assignee (or a keeper) gives a step back to its role.
func (h *Handler) Unclaim(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && (t.AssigneeID == nil || *t.AssigneeID != user) {
		httpx.Fail(w, 403, "Đây không phải việc của bạn.")
		return
	}
	t, err := h.svc.Unclaim(r.Context(), t.ID, user, p.Name)
	answer(w, r, t, err)
}

// Edit: PATCH /tasks/{id} {assignee_id?, due_at?, note?}: keepers reassign ("" = open to the role) or change the deadline.
func (h *Handler) Edit(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper {
		httpx.Fail(w, 403, "Chỉ người giữ truyện giao lại việc hoặc đổi hạn.")
		return
	}
	var b EditRequest
	if httpx.ReadJSON(w, r, &b) != nil {
		httpx.Fail(w, 400, "invalid body")
		return
	}
	var newName *string
	if b.AssigneeID != nil && *b.AssigneeID != "" {
		ap, err := h.perms.Permission(r.Context(), *b.AssigneeID, t.StoryID)
		if err != nil || !ids.IsUUID(*b.AssigneeID) || !ap.Contributor {
			httpx.Fail(w, 400, "Người được giao không tham gia truyện này.")
			return
		}
		newName = &ap.Name
	}
	t, err := h.svc.Edit(r.Context(), t.ID, user, p.Name, b, newName)
	answer(w, r, t, err)
}

// Cancel: POST /tasks/{id}/cancel: keepers stop a job (its active step).
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper {
		httpx.Fail(w, 403, "Chỉ người giữ truyện hủy được việc.")
		return
	}
	t, err := h.svc.Cancel(r.Context(), t.ID, user, p.Name)
	answer(w, r, t, err)
}

// Start: POST /tasks/{id}/start: the assignee opens the job's draft (made for them on the first text step).
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if t.AssigneeID == nil || *t.AssigneeID != user {
		httpx.Fail(w, 403, "Hãy nhận việc trước.")
		return
	}
	if t.Kind == "raw" || t.Kind == "merge" {
		httpx.Fail(w, 400, "Bước này không làm trên bản nháp.")
		return
	}
	t, err := h.svc.Start(r.Context(), t.ID, user, p.Name)
	answer(w, r, t, err)
}

// Done: POST /tasks/{id}/done: the step is finished. The next step opens; after the last one the draft is proposed to
// the keepers (merge step). A job of a raw step only simply ends.
func (h *Handler) Done(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := h.caller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && (t.AssigneeID == nil || *t.AssigneeID != user) {
		httpx.Fail(w, 403, "Đây không phải việc của bạn.")
		return
	}
	var b struct {
		Note string `json:"note"`
	}
	httpx.ReadJSON(w, r, &b)
	t, err := h.svc.Done(r.Context(), t.ID, user, p.Name, b.Note)
	answer(w, r, t, err)
}

// List: GET /tasks?mine=1 | ?story_id=: my active tasks everywhere, or a story's tasks (active + done in the last 30 days).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	story := r.URL.Query().Get("story_id")
	if story != "" {
		p, perr := h.perms.Permission(r.Context(), user, story)
		if perr != nil || !ids.IsUUID(story) || !p.Contributor {
			httpx.Fail(w, 403, "Bạn không tham gia truyện này.")
			return
		}
	}
	list, err := h.svc.List(r.Context(), user, story)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, list)
}
