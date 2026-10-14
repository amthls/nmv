package tasks

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/activity"
	"nmv/workspace/internal/chapters"
	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/blocks"
)

// Drafts is what tasks need from drafts (declared here, implemented by drafts.Service): a job's steps share one draft.
type Drafts interface {
	// New makes a draft for owner (see drafts.Service.NewDraft).
	New(ctx context.Context, tx pgx.Tx, ownerID string, ownerName *string, storyID string, chapterID *string, meta *blocks.Meta, bl []blocks.Block) (id string, reused bool, err error)
	// SubmitFinished sends the job's draft for review when it is still open (the last text step is done) and returns
	// what the story feed says about it.
	SubmitFinished(ctx context.Context, tx pgx.Tx, draftID, note string) (detail map[string]any, err error)
}

// Service is the business of tasks.
type Service struct {
	db       *pgxpool.Pool
	chapters *chapters.Repository
	drafts   Drafts
}

// NewService wires the service.
func NewService(db *pgxpool.Pool, ch *chapters.Repository, drafts Drafts) *Service {
	return &Service{db: db, chapters: ch, drafts: drafts}
}

// Get reads a task (locked only for the short transaction).
func (s *Service) Get(ctx context.Context, id string) (*Task, error) {
	var t *Task
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) { t, err = Load(ctx, tx, id); return })
	return t, err
}

// Create stores the first step of a new job. t is prepared by the caller (steps, kind, status, assignee); the chapter
// is looked up here. assignee == user: the caller claims it for themselves (no event).
func (s *Service) Create(ctx context.Context, t *Task, req CreateRequest, user, actorName, assignee string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if req.ChapterID != nil {
			h, err := s.chapters.ReadHead(ctx, tx, *req.ChapterID)
			if err != nil || h.StoryID != req.StoryID || h.Deleted {
				return domain.ErrNotFound
			}
			m, _, err := s.chapters.RevisionContent(ctx, tx, *req.ChapterID, h.Version)
			if err != nil {
				return err
			}
			t.ChapterID, t.ChapterNumber, t.Title = req.ChapterID, m.ChapterNumber, &m.Title
		} else {
			t.ChapterNumber = float64(int(*req.ChapterNumber*100)) / 100
		}
		if err := insertTask(ctx, tx, t, user); err != nil {
			return err
		}
		action := "task_created"
		if assignee == user {
			action = "task_claimed"
		}
		if err := logActivity(ctx, tx, user, &actorName, action, t); err != nil {
			return err
		}
		if assignee == user {
			return nil
		}
		return taskOpened(ctx, tx, t, user)
	})
}

// update locks the task, lets change() edit it, stores it and returns it.
func (s *Service) update(ctx context.Context, id string, change func(*Task, pgx.Tx) error) (*Task, error) {
	var t *Task
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) {
		if t, err = Load(ctx, tx, id); err != nil {
			return err
		}
		if err := change(t, tx); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `UPDATE chapter_tasks SET status = $2, assignee_id = $3, assignee_name = $4, due_at = $5, note = $6, draft_id = $7,
				done_at = CASE WHEN $2 = 'done' THEN NOW() ELSE done_at END, updated_at = NOW()
			WHERE id = $1 RETURNING updated_at, done_at`, t.ID, t.Status, t.AssigneeID, t.AssigneeName, t.DueAt, t.Note, t.DraftID).Scan(&t.UpdatedAt, &t.DoneAt)
	})
	return t, err
}

// Claim: take an open step.
func (s *Service) Claim(ctx context.Context, id, user, name string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "open" || t.Kind == "merge" {
			return domain.ErrTaskState
		}
		t.Status, t.AssigneeID, t.AssigneeName = "claimed", &user, &name
		if err := shareForTask(ctx, tx, t); err != nil {
			return err
		}
		return logActivity(ctx, tx, user, &name, "task_claimed", t)
	})
}

// Unclaim: the assignee (or a keeper) gives a step back to its role.
func (s *Service) Unclaim(ctx context.Context, id, user, name string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "claimed" {
			return domain.ErrTaskState
		}
		t.Status, t.AssigneeID, t.AssigneeName = "open", nil, nil
		if err := logActivity(ctx, tx, user, &name, "task_unclaimed", t); err != nil {
			return err
		}
		return taskOpened(ctx, tx, t, user)
	})
}

// Edit: keepers reassign ("" = open to the role), change the deadline or the note. newName is the new assignee's name.
func (s *Service) Edit(ctx context.Context, id, user, name string, b EditRequest, newName *string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "open" && t.Status != "claimed" {
			return domain.ErrTaskState
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
		if err := logActivity(ctx, tx, user, &name, "task_assigned", t); err != nil {
			return err
		}
		return taskOpened(ctx, tx, t, user)
	})
}

// Cancel: keepers stop a job (its active step).
func (s *Service) Cancel(ctx context.Context, id, user, name string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "open" && t.Status != "claimed" {
			return domain.ErrTaskState
		}
		t.Status = "cancelled"
		return logActivity(ctx, tx, user, &name, "task_cancelled", t)
	})
}

// Start: the assignee opens the job's draft (made for them on the first text step).
func (s *Service) Start(ctx context.Context, id, user, name string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "claimed" {
			return domain.ErrTaskState
		}
		if t.DraftID == nil { // a later step reuses the job's draft
			tx.QueryRow(ctx, `SELECT draft_id::text FROM chapter_tasks WHERE job_id = $1 AND draft_id IS NOT NULL ORDER BY step DESC LIMIT 1`, t.JobID).Scan(&t.DraftID)
		}
		if t.DraftID == nil {
			meta := blocks.Meta{ChapterNumber: t.ChapterNumber}
			if t.Title != nil {
				meta.Title = *t.Title
			}
			id, _, err := s.drafts.New(ctx, tx, user, &name, t.StoryID, t.ChapterID, &meta, nil)
			if err != nil {
				return err
			}
			t.DraftID = &id
		}
		return shareForTask(ctx, tx, t)
	})
}

// Done: the step is finished. The next step opens; after the last one the draft is proposed to the keepers (merge
// step). A job of a raw step only simply ends.
func (s *Service) Done(ctx context.Context, id, user, name, note string) (*Task, error) {
	return s.update(ctx, id, func(t *Task, tx pgx.Tx) error {
		if t.Status != "claimed" || t.Kind == "merge" {
			return domain.ErrTaskState
		}
		t.Status = "done"
		if note = strings.TrimSpace(note); note != "" {
			t.Note = &note
		}
		if err := logActivity(ctx, tx, user, &name, "task_done", t); err != nil {
			return err
		}
		next := &Task{JobID: t.JobID, StoryID: t.StoryID, ChapterID: t.ChapterID, ChapterNumber: t.ChapterNumber, Title: t.Title, Steps: t.Steps,
			Step: t.Step + 1, Status: "open", DraftID: t.DraftID, CreatedName: &name}
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
		detail, err := s.drafts.SubmitFinished(ctx, tx, *t.DraftID, "Xong quy trình ("+strings.Join(t.Steps, " → ")+"), chờ gộp.")
		if err != nil {
			return err
		}
		next.Kind = "merge"
		if err := insertTask(ctx, tx, next, user); err != nil {
			return err
		}
		return activity.Log(ctx, tx, t.StoryID, user, &name, "proposal_submitted", detail)
	})
}

// List: my active tasks everywhere (story == ""), or a story's tasks (active + done in the last 30 days).
func (s *Service) List(ctx context.Context, user, story string) ([]*Task, error) {
	if story != "" {
		return Query(ctx, s.db, `story_id = $1 AND (status IN ('open', 'claimed') OR updated_at > NOW() - INTERVAL '30 days')
			ORDER BY status IN ('open', 'claimed') DESC, chapter_number, updated_at DESC LIMIT 300`, story)
	}
	return Query(ctx, s.db, `assignee_id = $1 AND status = 'claimed' ORDER BY due_at NULLS LAST, updated_at DESC LIMIT 200`, user)
}
