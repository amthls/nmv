package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Tasks along a group's workflow (stage 4b, Plan/chapter-workspace.md). A job takes one chapter through the group's
// steps (raw, translate, edit, proofread), one task row per step, then the keepers' merge (a proposal). The steps
// that edit text share one draft: whoever takes a later step may edit it. Finishing a step opens the next one.

var stepRole = map[string]string{"raw": "raw_provider", "translate": "translator", "edit": "editor", "proofread": "proofreader"}

// eligible: who may take a step. Owners, leaders/mods, plain members and collaborators take any step; the
// specialised roles take their own. The merge step is the keepers' review, never "taken".
func eligible(role, kind string) bool {
	if kind == "merge" {
		return false
	}
	switch role {
	case "owner", "leader", "mod", "member", "collaborator":
		return true
	}
	return stepRole[kind] == role
}

var (
	errTaskBusy  = errors.New("chapter already has an active task")
	errTaskState = errors.New("task is not in that state")
)

type task struct {
	ID            string     `json:"id"`
	JobID         string     `json:"job_id"`
	StoryID       string     `json:"story_id"`
	ChapterID     *string    `json:"chapter_id"`
	ChapterNumber float64    `json:"chapter_number"`
	Title         *string    `json:"title"`
	Steps         []string   `json:"steps"`
	Step          int        `json:"step"`
	Kind          string     `json:"kind"`
	Status        string     `json:"status"`
	AssigneeID    *string    `json:"assignee_id"`
	AssigneeName  *string    `json:"assignee_name"`
	CreatedName   *string    `json:"created_name"`
	DueAt         *time.Time `json:"due_at"`
	Note          *string    `json:"note"`
	DraftID       *string    `json:"draft_id"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	DoneAt        *time.Time `json:"done_at"`
}

const taskColumns = `id::text, job_id::text, story_id::text, chapter_id::text, chapter_number::float8, title, steps, step, kind, status,
	assignee_id::text, assignee_name, created_name, due_at, note, draft_id::text, created_at, updated_at, done_at`

func scanTask(row pgx.Row) (*task, error) {
	t := &task{}
	err := row.Scan(&t.ID, &t.JobID, &t.StoryID, &t.ChapterID, &t.ChapterNumber, &t.Title, &t.Steps, &t.Step, &t.Kind, &t.Status,
		&t.AssigneeID, &t.AssigneeName, &t.CreatedName, &t.DueAt, &t.Note, &t.DraftID, &t.CreatedAt, &t.UpdatedAt, &t.DoneAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	return t, err
}

func loadTask(ctx context.Context, tx pgx.Tx, id string) (*task, error) {
	return scanTask(tx.QueryRow(ctx, `SELECT `+taskColumns+` FROM chapter_tasks WHERE id = $1 FOR UPDATE`, id))
}

func queryTasks(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, where string, args ...any) ([]*task, error) {
	rows, err := q.Query(ctx, `SELECT `+taskColumns+` FROM chapter_tasks WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []*task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

// logActivity adds a line to the story's feed. ref: a draft or a task the line is about (its chapter, step...).
func logActivity(ctx context.Context, tx pgx.Tx, story, actorID string, actorName *string, action string, d *draft, t *task) error {
	detail := map[string]any{}
	if d != nil {
		detail["draft_id"], detail["chapter_number"], detail["title"] = d.ID, d.Meta.ChapterNumber, d.Meta.Title
	}
	if t != nil {
		detail["task_id"], detail["chapter_number"], detail["kind"], detail["assignee_name"] = t.ID, t.ChapterNumber, t.Kind, t.AssigneeName
		if t.Title != nil {
			detail["title"] = *t.Title
		}
	}
	body, _ := json.Marshal(detail)
	var actor *string
	if actorID != "" {
		actor = &actorID
	}
	_, err := tx.Exec(ctx, `INSERT INTO ws_activity (story_id, actor_id, actor_name, action, detail) VALUES ($1, $2, $3, $4, $5)`, story, actor, actorName, action, body)
	return err
}

func taskOpened(ctx context.Context, tx pgx.Tx, t *task, actor string) error {
	var due *string
	if t.DueAt != nil {
		v := t.DueAt.UTC().Format(time.RFC3339)
		due = &v
	}
	return enqueueEvent(ctx, tx, "workspace.task.opened", 1, map[string]any{
		"task_id": t.ID, "job_id": t.JobID, "story_id": t.StoryID, "kind": t.Kind, "chapter_number": t.ChapterNumber,
		"assignee_id": t.AssigneeID, "actor_id": actor, "note": t.Note, "due_at": due,
	})
}

func insertTask(ctx context.Context, tx pgx.Tx, t *task, createdBy string) error {
	t.ID = newUUID()
	err := tx.QueryRow(ctx, `INSERT INTO chapter_tasks (id, job_id, story_id, chapter_id, chapter_number, title, steps, step, kind, status,
			assignee_id, assignee_name, created_by, created_name, due_at, note, draft_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING created_at, updated_at`,
		t.ID, t.JobID, t.StoryID, t.ChapterID, t.ChapterNumber, t.Title, t.Steps, t.Step, t.Kind, t.Status,
		t.AssigneeID, t.AssigneeName, nilIfEmpty(createdBy), t.CreatedName, t.DueAt, t.Note, t.DraftID).Scan(&t.CreatedAt, &t.UpdatedAt)
	if isUniqueViolation(err) {
		return errTaskBusy
	}
	return err
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// shareForTask lets whoever takes a later step edit the job's draft.
func shareForTask(ctx context.Context, tx pgx.Tx, t *task) error {
	if t.DraftID == nil || t.AssigneeID == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO draft_shares (draft_id, user_id, user_name, can_edit)
		SELECT $1, $2, $3, TRUE FROM chapter_drafts WHERE id = $1 AND owner_id <> $2
		ON CONFLICT (draft_id, user_id) DO UPDATE SET can_edit = TRUE`, *t.DraftID, *t.AssigneeID, t.AssigneeName)
	return err
}

func (s *server) taskError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errTaskBusy):
		fail(w, 409, "Chương này đang có việc chưa xong (đang chờ nhận, đang làm hoặc chờ gộp).")
	case errors.Is(err, errTaskState):
		fail(w, 409, "Việc này không còn ở trạng thái đó (có người vừa nhận, đã xong hoặc đã hủy).")
	case errors.Is(err, errNotFound):
		fail(w, 404, "Không có việc này.")
	default:
		s.draftError(w, r, err)
	}
}

// taskCaller: the signed-in caller and their rights on the task's story; writes the error response otherwise.
func (s *server) taskCaller(w http.ResponseWriter, r *http.Request) (*task, string, perm, bool) {
	user, id := s.userFrom(r), r.PathValue("id")
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return nil, "", perm{}, false
	}
	if !isUUID(id) {
		fail(w, 404, "Không có việc này.")
		return nil, "", perm{}, false
	}
	var t *task
	if err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) { t, err = loadTask(r.Context(), tx, id); return }); err != nil {
		s.taskError(w, r, err)
		return nil, "", perm{}, false
	}
	p, err := s.permission(r.Context(), user, t.StoryID)
	if err != nil {
		internalError(w, r, err)
		return nil, "", perm{}, false
	}
	if !p.Contributor {
		fail(w, 403, "Bạn không tham gia truyện này.")
		return nil, "", perm{}, false
	}
	return t, user, p, true
}

// POST /tasks {story_id, chapter_id | chapter_number, title?, assignee_id?, due_at?, note?}: a keeper assigns a chapter
// (to someone, or open to the step's role); anyone else in the story claims a chapter for themselves.
func (s *server) handleTaskCreate(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	var b struct {
		StoryID       string     `json:"story_id"`
		ChapterID     *string    `json:"chapter_id"`
		ChapterNumber *float64   `json:"chapter_number"`
		Title         string     `json:"title"`
		AssigneeID    string     `json:"assignee_id"`
		DueAt         *time.Time `json:"due_at"`
		Note          string     `json:"note"`
	}
	if readJSON(w, r, &b) != nil || !isUUID(b.StoryID) || (b.ChapterID != nil && !isUUID(*b.ChapterID)) || (b.ChapterID == nil && (b.ChapterNumber == nil || *b.ChapterNumber < 0)) ||
		len(b.Note) > 2000 || len(b.Title) > 500 {
		fail(w, 400, "Thiếu chương (chương có sẵn hoặc số chương mới) hoặc dữ liệu không hợp lệ.")
		return
	}
	ctx := r.Context()
	p, err := s.permission(ctx, user, b.StoryID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if !p.Contributor {
		fail(w, 403, "Bạn không tham gia truyện này.")
		return
	}
	steps := p.Workflow
	if len(steps) == 0 {
		steps = []string{"translate"}
	}
	t := &task{JobID: newUUID(), StoryID: b.StoryID, Steps: steps, Kind: steps[0], Status: "open", CreatedName: &p.Name, DueAt: b.DueAt,
		Note: nilIfEmpty(strings.TrimSpace(b.Note)), Title: nilIfEmpty(strings.TrimSpace(b.Title))}
	assignee := b.AssigneeID
	if !p.Keeper {
		assignee = user // contributors only claim chapters for themselves
		if !eligible(p.Role, t.Kind) {
			fail(w, 403, "Vai trò của bạn trong nhóm không nhận được bước đầu của quy trình ("+t.Kind+").")
			return
		}
	}
	if assignee != "" {
		if !isUUID(assignee) {
			fail(w, 400, "Người nhận không hợp lệ.")
			return
		}
		ap, err := s.permission(ctx, assignee, b.StoryID)
		if err != nil {
			internalError(w, r, err)
			return
		}
		if !ap.Contributor {
			fail(w, 400, "Người được giao không tham gia truyện này.")
			return
		}
		t.AssigneeID, t.AssigneeName, t.Status = &assignee, &ap.Name, "claimed"
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if b.ChapterID != nil {
			var h head
			if err := tx.QueryRow(ctx, `SELECT story_id::text, current_version, deleted FROM chapter_heads WHERE chapter_id = $1`, *b.ChapterID).
				Scan(&h.StoryID, &h.Version, &h.Deleted); err != nil || h.StoryID != b.StoryID || h.Deleted {
				return errNotFound
			}
			var meta []byte
			if err := tx.QueryRow(ctx, `SELECT meta FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`, *b.ChapterID, h.Version).Scan(&meta); err != nil {
				return err
			}
			var m chapterMeta
			json.Unmarshal(meta, &m)
			t.ChapterID, t.ChapterNumber, t.Title = b.ChapterID, m.ChapterNumber, &m.Title
		} else {
			t.ChapterNumber = float64(int(*b.ChapterNumber*100)) / 100
		}
		if err := insertTask(ctx, tx, t, user); err != nil {
			return err
		}
		action := "task_created"
		if assignee == user {
			action = "task_claimed"
		}
		if err := logActivity(ctx, tx, t.StoryID, user, &p.Name, action, nil, t); err != nil {
			return err
		}
		if assignee == user {
			return nil
		}
		return taskOpened(ctx, tx, t, user)
	})
	if errors.Is(err, errNotFound) {
		fail(w, 404, "Chương không tồn tại.")
		return
	}
	if err != nil {
		s.taskError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": t})
}

// POST /tasks/{id}/claim: take an open step (by role).
func (s *server) handleTaskClaim(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && !eligible(p.Role, t.Kind) {
		fail(w, 403, "Vai trò của bạn trong nhóm không nhận được bước này.")
		return
	}
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "open" || t.Kind == "merge" {
			return errTaskState
		}
		t.Status, t.AssigneeID, t.AssigneeName = "claimed", &user, &p.Name
		if err := shareForTask(ctx, tx, t); err != nil {
			return err
		}
		return logActivity(ctx, tx, t.StoryID, user, &p.Name, "task_claimed", nil, t)
	})
}

// POST /tasks/{id}/unclaim: the assignee (or a keeper) gives a step back to its role.
func (s *server) handleTaskUnclaim(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && (t.AssigneeID == nil || *t.AssigneeID != user) {
		fail(w, 403, "Đây không phải việc của bạn.")
		return
	}
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "claimed" {
			return errTaskState
		}
		t.Status, t.AssigneeID, t.AssigneeName = "open", nil, nil
		if err := logActivity(ctx, tx, t.StoryID, user, &p.Name, "task_unclaimed", nil, t); err != nil {
			return err
		}
		return taskOpened(ctx, tx, t, user)
	})
}

// PATCH /tasks/{id} {assignee_id?, due_at?, note?}: keepers reassign ("" = open to the role) or change the deadline.
func (s *server) handleTaskEdit(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper {
		fail(w, 403, "Chỉ người giữ truyện giao lại việc hoặc đổi hạn.")
		return
	}
	var b struct {
		AssigneeID *string    `json:"assignee_id"`
		DueAt      *time.Time `json:"due_at"`
		ClearDue   bool       `json:"clear_due"`
		Note       *string    `json:"note"`
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "invalid body")
		return
	}
	var newName *string
	if b.AssigneeID != nil && *b.AssigneeID != "" {
		ap, err := s.permission(r.Context(), *b.AssigneeID, t.StoryID)
		if err != nil || !isUUID(*b.AssigneeID) || !ap.Contributor {
			fail(w, 400, "Người được giao không tham gia truyện này.")
			return
		}
		newName = &ap.Name
	}
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "open" && t.Status != "claimed" {
			return errTaskState
		}
		if b.DueAt != nil || b.ClearDue {
			t.DueAt = b.DueAt
		}
		if b.Note != nil {
			t.Note = nilIfEmpty(strings.TrimSpace(*b.Note))
		}
		if b.AssigneeID == nil || t.Kind == "merge" {
			return nil
		}
		if *b.AssigneeID == "" {
			t.Status, t.AssigneeID, t.AssigneeName = "open", nil, nil
		} else {
			t.Status, t.AssigneeID, t.AssigneeName = "claimed", b.AssigneeID, newName
			if err := shareForTask(ctx, tx, t); err != nil {
				return err
			}
		}
		if err := logActivity(ctx, tx, t.StoryID, user, &p.Name, "task_assigned", nil, t); err != nil {
			return err
		}
		return taskOpened(ctx, tx, t, user)
	})
}

// POST /tasks/{id}/cancel: keepers stop a job (its active step).
func (s *server) handleTaskCancel(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper {
		fail(w, 403, "Chỉ người giữ truyện hủy được việc.")
		return
	}
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "open" && t.Status != "claimed" {
			return errTaskState
		}
		t.Status = "cancelled"
		return logActivity(ctx, tx, t.StoryID, user, &p.Name, "task_cancelled", nil, t)
	})
}

// updateTask locks the task, lets change() edit it, stores it and answers with it.
func (s *server) updateTask(w http.ResponseWriter, r *http.Request, id string, change func(context.Context, pgx.Tx, *task) error) {
	var t *task
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) {
		ctx := r.Context()
		if t, err = loadTask(ctx, tx, id); err != nil {
			return err
		}
		if err := change(ctx, tx, t); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `UPDATE chapter_tasks SET status = $2, assignee_id = $3, assignee_name = $4, due_at = $5, note = $6, draft_id = $7,
				done_at = CASE WHEN $2 = 'done' THEN NOW() ELSE done_at END, updated_at = NOW()
			WHERE id = $1 RETURNING updated_at, done_at`, t.ID, t.Status, t.AssigneeID, t.AssigneeName, t.DueAt, t.Note, t.DraftID).Scan(&t.UpdatedAt, &t.DoneAt)
	})
	if err != nil {
		s.taskError(w, r, err)
		return
	}
	ok(w, t)
}

// POST /tasks/{id}/start: the assignee opens the job's draft (made for them on the first text step).
func (s *server) handleTaskStart(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if t.AssigneeID == nil || *t.AssigneeID != user {
		fail(w, 403, "Hãy nhận việc trước.")
		return
	}
	if t.Kind == "raw" || t.Kind == "merge" {
		fail(w, 400, "Bước này không làm trên bản nháp.")
		return
	}
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "claimed" {
			return errTaskState
		}
		if t.DraftID == nil { // a later step reuses the job's draft
			tx.QueryRow(ctx, `SELECT draft_id::text FROM chapter_tasks WHERE job_id = $1 AND draft_id IS NOT NULL ORDER BY step DESC LIMIT 1`, t.JobID).Scan(&t.DraftID)
		}
		if t.DraftID == nil {
			meta := chapterMeta{ChapterNumber: t.ChapterNumber}
			if t.Title != nil {
				meta.Title = *t.Title
			}
			id, _, err := insertDraft(ctx, tx, user, &p.Name, t.StoryID, t.ChapterID, &meta, nil)
			if err != nil {
				return err
			}
			t.DraftID = &id
		}
		return shareForTask(ctx, tx, t)
	})
}

// POST /tasks/{id}/done: the step is finished. The next step opens; after the last one the draft is proposed to the
// keepers (merge step). A job of a raw step only simply ends.
func (s *server) handleTaskDone(w http.ResponseWriter, r *http.Request) {
	t, user, p, allowed := s.taskCaller(w, r)
	if !allowed {
		return
	}
	if !p.Keeper && (t.AssigneeID == nil || *t.AssigneeID != user) {
		fail(w, 403, "Đây không phải việc của bạn.")
		return
	}
	var b struct {
		Note string `json:"note"`
	}
	readJSON(w, r, &b)
	s.updateTask(w, r, t.ID, func(ctx context.Context, tx pgx.Tx, t *task) error {
		if t.Status != "claimed" || t.Kind == "merge" {
			return errTaskState
		}
		t.Status = "done"
		if b.Note = strings.TrimSpace(b.Note); b.Note != "" {
			t.Note = &b.Note
		}
		if err := logActivity(ctx, tx, t.StoryID, user, &p.Name, "task_done", nil, t); err != nil {
			return err
		}
		next := &task{JobID: t.JobID, StoryID: t.StoryID, ChapterID: t.ChapterID, ChapterNumber: t.ChapterNumber, Title: t.Title, Steps: t.Steps,
			Step: t.Step + 1, Status: "open", DraftID: t.DraftID, CreatedName: &p.Name}
		// the active task moves on: free the "one active task per chapter" slot first
		if _, err := tx.Exec(ctx, `UPDATE chapter_tasks SET status = 'done', done_at = NOW() WHERE id = $1`, t.ID); err != nil {
			return err
		}
		if t.DraftID != nil { // the next step's editor must not wait for this one's edit lock
			if _, err := tx.Exec(ctx, `UPDATE chapter_drafts SET lock_user = NULL WHERE id = $1`, *t.DraftID); err != nil {
				return err
			}
		}
		if next.Step < len(t.Steps) {
			next.Kind = t.Steps[next.Step]
			if err := insertTask(ctx, tx, next, user); err != nil {
				return err
			}
			return taskOpened(ctx, tx, next, user)
		}
		if t.DraftID == nil {
			return nil
		}
		d, hashes, err := loadDraft(ctx, tx, *t.DraftID, true)
		if err != nil {
			return err
		}
		if d.Status == "open" {
			if err := submitRound(ctx, tx, d, hashes, "Xong quy trình ("+strings.Join(t.Steps, " → ")+"), chờ gộp."); err != nil {
				return err
			}
		}
		next.Kind = "merge"
		if err := insertTask(ctx, tx, next, user); err != nil {
			return err
		}
		return logActivity(ctx, tx, t.StoryID, user, &p.Name, "proposal_submitted", d, nil)
	})
}

// afterDecision keeps a job in step with its proposal: merged -> the merge step is done; returned or withdrawn ->
// the merge step is cancelled and the last text step opens again for whoever did it.
func afterDecision(ctx context.Context, tx pgx.Tx, draftID, decision, actorID string, actorName *string) error {
	merges, err := queryTasks(ctx, tx, `draft_id = $1 AND kind = 'merge' AND status = 'open'`, draftID)
	if err != nil || len(merges) == 0 {
		return err
	}
	m := merges[0]
	if decision == "merged" {
		_, err := tx.Exec(ctx, `UPDATE chapter_tasks SET status = 'done', done_at = NOW(), assignee_id = $2, assignee_name = $3, updated_at = NOW() WHERE id = $1`,
			m.ID, nilIfEmpty(actorID), actorName)
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE chapter_tasks SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, m.ID); err != nil {
		return err
	}
	prev, err := queryTasks(ctx, tx, `job_id = $1 AND step = $2 AND status = 'done' ORDER BY done_at DESC LIMIT 1`, m.JobID, m.Step-1)
	if err != nil || len(prev) == 0 {
		return err
	}
	again := *prev[0]
	again.Status, again.Note = "claimed", nil
	if again.AssigneeID == nil {
		again.Status = "open"
	}
	if err := insertTask(ctx, tx, &again, actorID); err != nil {
		return err
	}
	return taskOpened(ctx, tx, &again, actorID)
}

// GET /tasks?mine=1 | ?story_id=: my active tasks everywhere, or a story's tasks (active + done in the last 30 days).
func (s *server) handleTaskList(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	var list []*task
	var err error
	if story := r.URL.Query().Get("story_id"); story != "" {
		p, perr := s.permission(r.Context(), user, story)
		if perr != nil || !isUUID(story) || !p.Contributor {
			fail(w, 403, "Bạn không tham gia truyện này.")
			return
		}
		list, err = queryTasks(r.Context(), s.db, `story_id = $1 AND (status IN ('open', 'claimed') OR updated_at > NOW() - INTERVAL '30 days')
			ORDER BY status IN ('open', 'claimed') DESC, chapter_number, updated_at DESC LIMIT 300`, story)
	} else {
		list, err = queryTasks(r.Context(), s.db, `assignee_id = $1 AND status = 'claimed' ORDER BY due_at NULLS LAST, updated_at DESC LIMIT 200`, user)
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, list)
}

// GET /board?story_id=…&story_id=…: a group's workspace over the stories the caller takes part in: tasks (active and
// done in the last 14 days), proposals waiting (keepers see all, others their own), recent activity.
func (s *server) handleBoard(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	ids := r.URL.Query()["story_id"]
	if len(ids) > 100 {
		ids = ids[:100]
	}
	var stories, kept []string
	for _, id := range ids {
		if !isUUID(id) || slices.Contains(stories, id) {
			continue
		}
		p, err := s.permission(r.Context(), user, id)
		if err != nil {
			internalError(w, r, err)
			return
		}
		if p.Contributor {
			stories = append(stories, id)
			if p.Keeper {
				kept = append(kept, id)
			}
		}
	}
	ctx := r.Context()
	tasks, err := queryTasks(ctx, s.db, `story_id = ANY($1) AND (status IN ('open', 'claimed') OR updated_at > NOW() - INTERVAL '14 days')
		ORDER BY updated_at DESC LIMIT 500`, stories)
	if err != nil {
		internalError(w, r, err)
		return
	}
	rows, err := s.db.Query(ctx, `SELECT `+draftColumns+`, dr.note, dr.submitted_at
		FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		JOIN draft_rounds dr ON dr.draft_id = d.id AND dr.round = d.last_round
		WHERE d.story_id = ANY($1) AND d.status = 'submitted' AND (d.story_id = ANY($2) OR d.owner_id = $3) ORDER BY dr.submitted_at`, stories, kept, user)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type proposal struct {
		*draft
		Note        *string   `json:"note"`
		SubmittedAt time.Time `json:"submitted_at"`
	}
	proposals := []proposal{}
	for rows.Next() {
		var it proposal
		d, _, err := scanDraft(rows, &it.Note, &it.SubmittedAt)
		if err != nil {
			rows.Close()
			internalError(w, r, err)
			return
		}
		it.draft = d
		proposals = append(proposals, it)
	}
	rows.Close()
	type event struct {
		ID        int64           `json:"id"`
		StoryID   string          `json:"story_id"`
		ActorName *string         `json:"actor_name"`
		Action    string          `json:"action"`
		Detail    json.RawMessage `json:"detail"`
		CreatedAt time.Time       `json:"created_at"`
	}
	arows, err := s.db.Query(ctx, `SELECT id, story_id::text, actor_name, action, detail, created_at FROM ws_activity WHERE story_id = ANY($1) ORDER BY id DESC LIMIT 60`, stories)
	if err != nil {
		internalError(w, r, err)
		return
	}
	activity, err := pgx.CollectRows(arows, func(row pgx.CollectableRow) (event, error) {
		var e event
		return e, row.Scan(&e.ID, &e.StoryID, &e.ActorName, &e.Action, &e.Detail, &e.CreatedAt)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, map[string]any{"stories": stories, "keeper_of": kept, "tasks": tasks, "proposals": proposals, "activity": activity})
}
