// Package proposals is the review of drafts (stage 3, Plan/chapter-workspace.md): a contributor submits a draft; story
// keepers merge it (through publish) or return it with comments. Each submission freezes a round. The backend drives
// submit / withdraw / return (it notifies people); reading a proposal and commenting are public on /api/ws.
package proposals

import (
	"time"

	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/blocks"
)

// Round is one submission of a draft, frozen, with how it ended.
type Round struct {
	Round         int         `json:"round"`
	BaseVersion   *int        `json:"base_version"`
	Meta          blocks.Meta `json:"meta"`
	Note          *string     `json:"note"`
	SubmittedAt   time.Time   `json:"submitted_at"`
	Decision      string      `json:"decision"`
	DecidedName   *string     `json:"decided_name"`
	DecisionNote  *string     `json:"decision_note"`
	DecidedAt     *time.Time  `json:"decided_at"`
	MergedVersion *int        `json:"merged_version"`
	blocks        []string
}

// Item is one proposal waiting in a story.
type Item struct {
	*drafts.Draft
	Note        *string   `json:"note"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type comment struct {
	ID         int64     `json:"id"`
	Round      int       `json:"round"`
	BlockHash  *string   `json:"block_hash"`
	Body       string    `json:"body"`
	AuthorID   string    `json:"author_id"`
	AuthorName *string   `json:"author_name"`
	CreatedAt  time.Time `json:"created_at"`
}
