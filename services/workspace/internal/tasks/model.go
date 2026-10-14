// Package tasks is the workflow of a group (stage 4b, Plan/chapter-workspace.md). A job takes one chapter through the
// group's steps (raw, translate, edit, proofread), one task row per step, then the keepers' merge (a proposal). The
// steps that edit text share one draft: whoever takes a later step may edit it. Finishing a step opens the next one.
package tasks

import "time"

var stepRole = map[string]string{"raw": "raw_provider", "translate": "translator", "edit": "editor", "proofread": "proofreader"}

// Eligible: who may take a step. Owners, leaders/mods, plain members and collaborators take any step; the
// specialised roles take their own. The merge step is the keepers' review, never "taken".
func Eligible(role, kind string) bool {
	if kind == "merge" {
		return false
	}
	switch role {
	case "owner", "leader", "mod", "member", "collaborator":
		return true
	}
	return stepRole[kind] == role
}

// Task is one step of a job.
type Task struct {
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

// CreateRequest is POST /tasks.
type CreateRequest struct {
	StoryID       string     `json:"story_id"`
	ChapterID     *string    `json:"chapter_id"`
	ChapterNumber *float64   `json:"chapter_number"`
	Title         string     `json:"title"`
	AssigneeID    string     `json:"assignee_id"`
	DueAt         *time.Time `json:"due_at"`
	Note          string     `json:"note"`
}

// EditRequest is PATCH /tasks/{id}.
type EditRequest struct {
	AssigneeID *string    `json:"assignee_id"`
	DueAt      *time.Time `json:"due_at"`
	ClearDue   bool       `json:"clear_due"`
	Note       *string    `json:"note"`
}
