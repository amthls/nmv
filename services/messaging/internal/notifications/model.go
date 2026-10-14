package notifications

import (
	"encoding/json"
	"fmt"
	"time"
)

// Notifications (Plan/messaging.md, E3). The backend decides who gets what and queues jobs on novel.notifications
// (RabbitMQ); this package turns them into rows: drop what people switched off, never twice (dedupe keys), merge
// same-kind unread ones (group keys), then ping the people over the realtime channel.

// notifyType: what a type string means. locked = can't be switched off; grouped = unread ones on the same target merge.
type notifyType struct {
	category string
	locked   bool
	grouped  bool
}

var notifyTypes = map[string]notifyType{
	"chapter_update":      {"read", false, true}, // grouped per story
	"comment_reply":       {"interaction", false, false},
	"post_comment":        {"interaction", false, true},
	"post_reaction":       {"interaction", false, true},
	"group_join_request":  {"group", false, true},
	"group_member_add":    {"group", true, false},
	"group_join_rejected": {"group", true, false},
	"draft_submitted":     {"workspace", false, false},
	"draft_returned":      {"workspace", true, false},
	"draft_merged":        {"workspace", true, false},
	"draft_offered":       {"workspace", false, false},
	"draft_transferred":   {"workspace", false, false},
	"task_opened":         {"workspace", false, false},
	"story_removed":       {"moderation", true, false},
	"story_restored":      {"moderation", true, false},
	"post_removed":        {"moderation", true, false},
	"post_restored":       {"moderation", true, false},
	"admin_alert":         {"system", true, false},
}

// category is one notification category, as the settings page names it.
type category struct{ ID, Label string }

// categories in display order, with what the settings page calls them.
var categories = []category{
	{"read", "Đọc truyện"}, {"interaction", "Tương tác"}, {"group", "Nhóm dịch"},
	{"workspace", "Workspace"}, {"moderation", "Kiểm duyệt"}, {"system", "Hệ thống"},
}

func typeInfo(t string) notifyType {
	if nt, ok := notifyTypes[t]; ok {
		return nt
	}
	return notifyType{category: "system"} // unknown (e.g. a newer backend): still delivered
}

// notifyItem: one notification for one person, as the backend's NotifyItem (queue.service.ts) sends it.
type notifyItem struct {
	UserID        string         `json:"userId"`
	Type          string         `json:"type"`
	Title         string         `json:"title"`
	Message       *string        `json:"message"`
	ReferenceType *string        `json:"referenceType"`
	ReferenceID   *string        `json:"referenceId"` // the target grouped rows share
	SenderID      *string        `json:"senderId"`
	ActorName     string         `json:"actorName"`
	DedupeKey     string         `json:"dedupeKey"`
	Link          *string        `json:"link"`
	Image         *string        `json:"image"`
	Data          map[string]any `json:"data"`
}

// notifyJob: {kind: "notify", items} or {kind: "chapter_published", ...} (fan-out to the story's followers).
type notifyJob struct {
	Kind         string       `json:"kind"`
	Items        []notifyItem `json:"items"`
	StoryID      string       `json:"storyId"`
	ChapterID    string       `json:"chapterId"`
	ChapterTitle string       `json:"chapterTitle"`
	StoryTitle   string       `json:"storyTitle"`
	UploaderID   *string      `json:"uploaderId"`
	Link         *string      `json:"link"`
	Image        *string      `json:"image"`
}

// envelope is a queue message: the job with its retry count.
type envelope struct {
	ID       string          `json:"id"`
	Attempts int             `json:"attempts"`
	Job      json.RawMessage `json:"job"`
}

type actor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type notificationOut struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Category   string         `json:"category"`
	Title      string         `json:"title"`
	Message    *string        `json:"message"`
	Link       *string        `json:"link"`
	Image      *string        `json:"image"`
	Actors     []actor        `json:"actors"`
	ActorCount int            `json:"actor_count"`
	Count      int            `json:"count"`
	Data       map[string]any `json:"-"`
	Seen       bool           `json:"is_seen"`
	ReadAt     *time.Time     `json:"read_at"`
	IsRead     bool           `json:"is_read"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

// groupedTitle: the title of a row that merged several events ("Yuki và 12 người khác…"); one event keeps its own.
func groupedTitle(n notificationOut) string {
	if n.Count <= 1 {
		return n.Title
	}
	who := "Ai đó"
	if len(n.Actors) > 0 && n.Actors[0].Name != "" {
		who = n.Actors[0].Name
	}
	if n.ActorCount > 1 {
		who += fmt.Sprintf(" và %d người khác", n.ActorCount-1)
	}
	str := func(k string) string { v, _ := n.Data[k].(string); return v }
	switch n.Type {
	case "chapter_update":
		return fmt.Sprintf("Truyện \"%s\" có %d chương mới", str("story_title"), n.Count)
	case "post_reaction":
		return who + " đã bày tỏ cảm xúc về bài viết của bạn"
	case "post_comment":
		return who + " đã bình luận bài viết của bạn"
	case "group_join_request":
		return who + " muốn gia nhập nhóm " + str("group_name")
	}
	return n.Title
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// unseenCounts is what the bell shows.
type unseenCounts struct{ unseen, unread int }

// settingsBody is the body of PUT /notifications/settings: {"<category>": {"web": bool}}.
type settingsBody map[string]struct {
	Web *bool `json:"web"`
}

// broadcastBody is the body of POST /admin/broadcasts.
type broadcastBody struct {
	Title   string `json:"title"`
	Message string `json:"message"`
	Link    string `json:"link"`
}
