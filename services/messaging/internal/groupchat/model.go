package groupchat

import (
	"time"

	"nmv/messaging/internal/platform/catalog"
)

// maxMessage is the longest chat message (same limit as direct messages).
const maxMessage = 2000

// sendRequest is the body of POST /groups/{id}/messages.
type sendRequest struct {
	Message string `json:"message"`
}

// msgRow is one stored group message.
type msgRow struct {
	id, sender, body string
	created          time.Time
}

// groupMessage renders a message with its sender's profile and role in the group.
func groupMessage(id, gid, sender, body string, created time.Time, p catalog.Profile, role string) map[string]any {
	var r *string
	if role != "" {
		r = &role
	}
	var username *string
	if p.Username != "" {
		username = &p.Username
	}
	return map[string]any{"id": id, "group_id": gid, "user_id": sender, "message": body, "attachments": []any{},
		"created_at": created, "username": username, "display_name": p.DisplayName, "avatar_url": p.AvatarURL, "member_role": r}
}
