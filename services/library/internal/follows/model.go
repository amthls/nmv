package follows

// toggleRequest is the body of POST /favorites/toggle.
type toggleRequest struct {
	StoryID  string `json:"story_id"`
	Category string `json:"category"`
	Notify   *bool  `json:"notify_updates"`
}

// Outcome of a toggle: what happened to the follow.
const (
	ActionUpdated = "updated"
	ActionRemoved = "removed"
	ActionAdded   = "added"
)

// identityEvent is an identity.user.deleted message.
type identityEvent struct {
	EventID string `json:"event_id"`
	Type    string `json:"type"`
	Data    struct {
		ID        string  `json:"id"`
		DeletedAt *string `json:"deleted_at"`
	} `json:"data"`
}
