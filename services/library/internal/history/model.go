package history

import (
	"sync"
	"time"
)

// saveRequest is the body of POST /history. Numbers arrive as numbers or strings, so they stay untyped until clamped.
type saveRequest struct {
	ChapterID string `json:"chapter_id"`
	Scroll    any    `json:"scroll_position"`
	Page      any    `json:"page_number"`
	Seconds   any    `json:"time_spent_seconds"`
}

// openRequest is the body of POST /internal/history.
type openRequest struct {
	UserID    string `json:"user_id"`
	ChapterID string `json:"chapter_id"`
}

// mergeRequest is the body of POST /history/merge.
type mergeRequest struct {
	Items []struct {
		ChapterID string  `json:"chapter_id"`
		ReadAt    string  `json:"read_at"`
		Scroll    float64 `json:"scroll_position"`
	} `json:"items"`
}

// mergeItem is one guest read, as the SQL takes it.
type mergeItem struct {
	ChapterID string    `json:"chapter_id"`
	ReadAt    time.Time `json:"read_at"`
	Scroll    float64   `json:"scroll_position"`
}

// pendingRead is a reading position waiting in memory to be written.
type pendingRead struct {
	StoryID   string    `json:"story_id"`
	ChapterID string    `json:"chapter_id"`
	Scroll    float64   `json:"scroll_position"`
	Page      int       `json:"page_number"`
	Seconds   int       `json:"time_spent_seconds"`
	ReadAt    time.Time `json:"read_at"`
	UserID    string    `json:"user_id"`
}

// positionBuffer holds the pending positions of every user.
type positionBuffer struct {
	mu     sync.Mutex
	byUser map[string]map[string]*pendingRead // user -> chapter -> latest position
}
