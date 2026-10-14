package bookmarks

// createRequest is the body of POST /bookmarks.
type createRequest struct {
	StoryID   string   `json:"story_id"`
	ChapterID string   `json:"chapter_id"`
	LineText  *string  `json:"line_text"`
	LineIndex *int     `json:"line_index"`
	Scroll    *float64 `json:"scroll_position"`
	Page      *int     `json:"page_number"`
	Note      *string  `json:"note"`
	Color     *string  `json:"color"`
}
