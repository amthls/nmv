// Package chapters is the official line of every chapter: numbered revisions, comparing them, rewinding to an old one,
// and the internal calls the backend makes to create, edit and delete chapters.
package chapters

import (
	"time"

	"nmv/workspace/internal/platform/blocks"
)

// Meta is the chapter fields (title, number, volume, notes) every revision carries.
type Meta = blocks.Meta

// Revision is what the backend applies to its reading copy (also the workspace.revision.merged event data).
type Revision struct {
	ChapterID  string         `json:"chapter_id"`
	StoryID    string         `json:"story_id"`
	Version    int            `json:"version"`
	Deleted    bool           `json:"deleted"`
	Source     string         `json:"source"`
	BasedOn    *int           `json:"based_on"`
	Meta       Meta           `json:"meta"`
	Blocks     []blocks.Block `json:"blocks"`
	AuthorID   *string        `json:"author_id"`
	AuthorName *string        `json:"author_name"`
	CreatedAt  time.Time      `json:"created_at"`
}

// Head is the state of a chapter line: its story, current version and whether it was deleted.
type Head struct {
	StoryID string
	Version int
	Deleted bool
}

// WriteBody is what the backend sends to create or edit a chapter (content already validated and sanitized there).
type WriteBody struct {
	StoryID         string         `json:"story_id"`
	Meta            Meta           `json:"meta"`
	Blocks          []blocks.Block `json:"blocks"`
	ExpectedVersion int            `json:"expected_version"`
	AuthorID        *string        `json:"author_id"`
	AuthorName      *string        `json:"author_name"`
}

// RevisionItem is one line of the history list (no blocks).
type RevisionItem struct {
	Version    int       `json:"version"`
	Source     string    `json:"source"`
	Deleted    bool      `json:"deleted"`
	BasedOn    *int      `json:"based_on"`
	AuthorID   *string   `json:"author_id"`
	AuthorName *string   `json:"author_name"`
	CreatedAt  time.Time `json:"created_at"`
	Title      string    `json:"title"`
	Number     float64   `json:"chapter_number"`
	Blocks     int       `json:"block_count"`
}
