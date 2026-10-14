package internalapi

// purgeRequest is the body of POST /internal/purge.
type purgeRequest struct {
	Stories  []string `json:"story_ids"`
	Chapters []string `json:"chapter_ids"`
}
