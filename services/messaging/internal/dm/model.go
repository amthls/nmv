package dm

import (
	"time"

	"nmv/messaging/internal/platform/catalog"
)

const (
	maxMessage   = 2000
	maxLabels    = 20
	maxLabelName = 30
	maxPins      = 10
	blockedMsg   = "Không thể gửi tin nhắn cho người này."
)

// Label colors the UI draws: must match LABEL_STYLES in frontend/src/components/messages/labels.ts
var labelColors = map[string]bool{"sky": true, "emerald": true, "amber": true, "rose": true, "fuchsia": true, "teal": true, "orange": true, "lime": true}

// dmKey names the conversation of two people, whoever is first.
func dmKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + ":" + b
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func profileFields(p catalog.Profile) map[string]any {
	return map[string]any{"username": p.Username, "display_name": p.DisplayName, "avatar_url": p.AvatarURL}
}

// dmConv is the pair's conversation and how far each has read.
type dmConv struct {
	id             string
	partnerReadSeq int64
	partnerReadAt  *time.Time
	myReadSeq      int64
	myReadAt       *time.Time
	exists         bool
}

// inboxRow is one conversation of the inbox as the database gives it.
type inboxRow struct {
	partner, last, lastSender string
	lastAt                    time.Time
	unread                    int
	labels                    []string
	blocked                   bool
	match                     *string
}

// msgRow is one stored message.
type msgRow struct {
	id, sender, body string
	seq              int64
	created          time.Time
	pinnedAt         *time.Time
	pinnedBy, draft  *string
}

// Inbox is the answer of GET /messages.
type Inbox struct {
	Conversations []map[string]any `json:"conversations"`
	UnreadCount   int              `json:"unread_count"`
}

// Thread is the answer of GET /messages/{username}.
type Thread struct {
	Partner     map[string]any
	Messages    []map[string]any
	Pinned      []map[string]any
	LabelIDs    []string
	BlockedByMe bool
	CanMessage  bool
}

// sendRequest is the body of POST /messages/{username}.
type sendRequest struct {
	Message string `json:"message"`
}

// internalDMRequest is the body of POST /internal/dm.
type internalDMRequest struct {
	From    string  `json:"from"`
	To      string  `json:"to"`
	Message string  `json:"message"`
	DraftID *string `json:"draft_id"`
}

// setLabelsRequest is the body of PUT /messages/{username}/labels.
type setLabelsRequest struct {
	LabelIDs []string `json:"label_ids"`
}

// labelBody is the body of label create and update.
type labelBody struct {
	Name  *string `json:"name"`
	Color *string `json:"color"`
}
