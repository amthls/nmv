// Package drafts is the writing side of chapters (stages 2 and 4a, Plan/chapter-workspace.md): private drafts, pulling
// the official line into a draft, publishing, and working on drafts together (sharing, a helper's copy sent back,
// handing over, reclaiming, the shared edit lock, the card shown in direct messages).
//
// New content still arrives through the backend (/internal: it sanitizes HTML); reading, discarding and pulling carry
// no new content and are public on /api/ws.
package drafts

import (
	"time"

	"nmv/workspace/internal/platform/blocks"
)

const (
	maxOpenDrafts = 50
	lockTTL       = 2 * time.Minute
)

// Draft is a chapter being written.
type Draft struct {
	ID               string         `json:"id"`
	OwnerID          string         `json:"owner_id"`
	OwnerName        *string        `json:"owner_name"`
	StoryID          string         `json:"story_id"`
	ChapterID        *string        `json:"chapter_id"`
	BaseVersion      *int           `json:"base_version"`
	Meta             blocks.Meta    `json:"meta"`
	Blocks           []blocks.Block `json:"blocks,omitempty"`
	Status           string         `json:"status"`
	Version          int            `json:"version"`
	PublishedVersion *int           `json:"published_version"`
	LastRound        int            `json:"last_round"`          // proposals sent so far (stage 3)
	CanMerge         *bool          `json:"can_merge,omitempty"` // GET /drafts/{id}: the caller keeps the story (publishes directly)
	CopiedFrom       *string        `json:"copied_from"`         // a helper's copy of another draft (stage 4)
	LockUser         *string        `json:"lock_user"`           // who is editing right now (until lock_until)
	LockName         *string        `json:"lock_name"`
	LockUntil        *time.Time     `json:"lock_until"`
	Access           string         `json:"access,omitempty"` // GET /drafts/{id}: owner | editor | viewer
	Shares           any            `json:"shares,omitempty"` // owner only: who it is shared with
	Offers           any            `json:"offers,omitempty"` // owner only: helpers' copies sent back
	Others           any            `json:"others,omitempty"` // GET /drafts/{id}: other open drafts of the same chapter
	Claims           any            `json:"claims,omitempty"` // GET /drafts/{id}: tasks on the same chapter (not this draft's)
	PublishAt        *time.Time     `json:"publish_at"`       // stage 4c: scheduled to go official then
	ScheduledName    *string        `json:"scheduled_name"`
	SchedulePrev     *string        `json:"schedule_prev"` // the state it returns to if the schedule is cancelled or fails
	ScheduleError    *string        `json:"schedule_error"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	// the official line now: a draft opened from an older version shows "the official version changed"
	CurrentVersion *int `json:"current_version"`
	ChapterDeleted bool `json:"chapter_deleted"`
}

// Body is what the backend sends to create, save or publish a draft.
type Body struct {
	OwnerID         string         `json:"owner_id"` // the caller (create: owner; save/publish: must be the owner)
	OwnerName       *string        `json:"owner_name"`
	StoryID         string         `json:"story_id"`
	ChapterID       *string        `json:"chapter_id"`
	Meta            *blocks.Meta   `json:"meta"`
	Blocks          []blocks.Block `json:"blocks"`
	ExpectedVersion int            `json:"expected_version"`
}

// DecisionBody is the body of submit / withdraw / return / offer: the caller, and a note.
type DecisionBody struct {
	OwnerID   string  `json:"owner_id"` // the caller
	OwnerName *string `json:"owner_name"`
	Note      string  `json:"note"`
}

// ListItem is one line of GET /drafts.
type ListItem struct {
	*Draft
	BlockCount int `json:"block_count"`
}

// PullPlan: the three-way merge of the draft with the current official version.
type PullPlan struct {
	From          int                   `json:"from"`
	To            int                   `json:"to"`
	Chunks        []blocks.Chunk        `json:"chunks"`
	MetaConflicts []blocks.MetaConflict `json:"meta_conflicts"`
	Meta          blocks.Meta           `json:"meta"` // merged fields (a conflicting one shows ours)
	theirs        blocks.Meta
}
