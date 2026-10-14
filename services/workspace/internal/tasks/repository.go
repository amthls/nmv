package tasks

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/workspace/internal/activity"
	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/platform/outbox"
)

const taskColumns = `id::text, job_id::text, story_id::text, chapter_id::text, chapter_number::float8, title, steps, step, kind, status,
	assignee_id::text, assignee_name, created_name, due_at, note, draft_id::text, created_at, updated_at, done_at`

func scanTask(row pgx.Row) (*Task, error) {
	t := &Task{}
	err := row.Scan(&t.ID, &t.JobID, &t.StoryID, &t.ChapterID, &t.ChapterNumber, &t.Title, &t.Steps, &t.Step, &t.Kind, &t.Status,
		&t.AssigneeID, &t.AssigneeName, &t.CreatedName, &t.DueAt, &t.Note, &t.DraftID, &t.CreatedAt, &t.UpdatedAt, &t.DoneAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return t, err
}

// Load reads a task, locked for the rest of tx.
func Load(ctx context.Context, tx pgx.Tx, id string) (*Task, error) {
	return scanTask(tx.QueryRow(ctx, `SELECT `+taskColumns+` FROM chapter_tasks WHERE id = $1 FOR UPDATE`, id))
}

// Query lists tasks matching `where` (a SQL condition, with its ORDER BY / LIMIT) in a transaction or the pool.
func Query(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, where string, args ...any) ([]*Task, error) {
	rows, err := q.Query(ctx, `SELECT `+taskColumns+` FROM chapter_tasks WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []*Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func taskOpened(ctx context.Context, tx pgx.Tx, t *Task, actor string) error {
	var due *string
	if t.DueAt != nil {
		v := t.DueAt.UTC().Format(time.RFC3339)
		due = &v
	}
	return outbox.Enqueue(ctx, tx, "workspace.task.opened", 1, map[string]any{
		"task_id": t.ID, "job_id": t.JobID, "story_id": t.StoryID, "kind": t.Kind, "chapter_number": t.ChapterNumber,
		"assignee_id": t.AssigneeID, "actor_id": actor, "note": t.Note, "due_at": due,
	})
}

func insertTask(ctx context.Context, tx pgx.Tx, t *Task, createdBy string) error {
	t.ID = ids.New()
	err := tx.QueryRow(ctx, `INSERT INTO chapter_tasks (id, job_id, story_id, chapter_id, chapter_number, title, steps, step, kind, status,
			assignee_id, assignee_name, created_by, created_name, due_at, note, draft_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING created_at, updated_at`,
		t.ID, t.JobID, t.StoryID, t.ChapterID, t.ChapterNumber, t.Title, t.Steps, t.Step, t.Kind, t.Status,
		t.AssigneeID, t.AssigneeName, nilIfEmpty(createdBy), t.CreatedName, t.DueAt, t.Note, t.DraftID).Scan(&t.CreatedAt, &t.UpdatedAt)
	if domain.IsUniqueViolation(err) {
		return domain.ErrTaskBusy
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
func shareForTask(ctx context.Context, tx pgx.Tx, t *Task) error {
	if t.DraftID == nil || t.AssigneeID == nil {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO draft_shares (draft_id, user_id, user_name, can_edit)
		SELECT $1, $2, $3, TRUE FROM chapter_drafts WHERE id = $1 AND owner_id <> $2
		ON CONFLICT (draft_id, user_id) DO UPDATE SET can_edit = TRUE`, *t.DraftID, *t.AssigneeID, t.AssigneeName)
	return err
}

// logActivity adds a line about a task to the story's feed.
func logActivity(ctx context.Context, tx pgx.Tx, actorID string, actorName *string, action string, t *Task) error {
	detail := map[string]any{"task_id": t.ID, "chapter_number": t.ChapterNumber, "kind": t.Kind, "assignee_name": t.AssigneeName}
	if t.Title != nil {
		detail["title"] = *t.Title
	}
	return activity.Log(ctx, tx, t.StoryID, actorID, actorName, action, detail)
}

// AfterDecision keeps a job in step with its proposal: merged -> the merge step is done; returned or withdrawn ->
// the merge step is cancelled and the last text step opens again for whoever did it.
func AfterDecision(ctx context.Context, tx pgx.Tx, draftID, decision, actorID string, actorName *string) error {
	merges, err := Query(ctx, tx, `draft_id = $1 AND kind = 'merge' AND status = 'open'`, draftID)
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
	prev, err := Query(ctx, tx, `job_id = $1 AND step = $2 AND status = 'done' ORDER BY done_at DESC LIMIT 1`, m.JobID, m.Step-1)
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
