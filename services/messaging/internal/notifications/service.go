// Package notifications: the bell and /thong-bao, settings, site-wide announcements, and the jobs the backend queues
// (RabbitMQ novel.notifications) that turn into rows.
package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/messaging/internal/platform/httpx"
)

// Library is the part of the library client notifications need (who follows a story).
type Library interface {
	Call(ctx context.Context, method, path string, body any, out any) (int, error)
}

// Publisher pings people over the realtime channel.
type Publisher interface {
	Publish(ctx context.Context, users []string, typ string, data map[string]any)
}

// Service holds the notification rules.
type Service struct {
	repo *Repository
	lib  Library
	pub  Publisher
}

// NewService wires the notification service.
func NewService(repo *Repository, lib Library, pub Publisher) *Service {
	return &Service{repo: repo, lib: lib, pub: pub}
}

func validCategory(id string) bool {
	return slices.ContainsFunc(categories, func(c category) bool { return c.ID == id })
}

// RunJob turns one queued job into rows; returns how many were created or merged into.
func (s *Service) RunJob(ctx context.Context, job notifyJob) (int, error) {
	switch job.Kind {
	case "notify":
		return s.deliver(ctx, job.Items)
	case "chapter_published":
		return s.fanOutChapter(ctx, job)
	}
	return 0, fmt.Errorf("unknown notification job kind %q", job.Kind)
}

// deliver writes items (one transaction) and pings their recipients. Returns how many rows were created or merged into.
func (s *Service) deliver(ctx context.Context, items []notifyItem) (int, error) {
	users := map[string]bool{}
	for _, it := range items {
		if httpx.IsUUID(it.UserID) {
			users[it.UserID] = true
		}
	}
	if len(users) == 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(users))
	for u := range users {
		ids = append(ids, u)
	}
	off := map[string]bool{} // "<user>|<category>" switched off
	keys, err := s.repo.switchedOff(ctx, ids)
	if err != nil {
		return 0, fmt.Errorf("read settings: %w", err)
	}
	for _, k := range keys {
		off[k] = true
	}

	b := &pgx.Batch{}
	for _, it := range items {
		nt := typeInfo(it.Type)
		if !httpx.IsUUID(it.UserID) || it.Title == "" || (!nt.locked && off[it.UserID+"|"+nt.category]) {
			continue
		}
		actors := "[]"
		if it.SenderID != nil && httpx.IsUUID(*it.SenderID) {
			a, _ := json.Marshal([]map[string]string{{"id": *it.SenderID, "name": it.ActorName}})
			actors = string(a)
		}
		data, _ := json.Marshal(it.Data)
		if it.Data == nil {
			data = []byte("{}")
		}
		groupKey := ""
		if nt.grouped && it.ReferenceID != nil {
			groupKey = it.Type + ":" + *it.ReferenceID
		}
		b.Queue(upsertNotification, it.DedupeKey, it.UserID, it.Type, nt.category, truncate(it.Title, 300), it.Message,
			it.Link, it.Image, actors, string(data), groupKey)
	}
	if b.Len() == 0 {
		return 0, nil
	}
	got, n, err := s.repo.upsertBatch(ctx, b)
	if err != nil {
		return 0, fmt.Errorf("store notifications: %w", err)
	}
	recipients := make([]string, 0, len(got))
	for u := range got {
		recipients = append(recipients, u)
	}
	s.pub.Publish(ctx, recipients, "notification", nil)
	return n, nil
}

// fanOutChapter tells every follower of the story (asked from the library service, 1,000 at a time) about a new chapter;
// unread ones merge per story ("Truyện X có 3 chương mới").
func (s *Service) fanOutChapter(ctx context.Context, job notifyJob) (int, error) {
	if !httpx.IsUUID(job.StoryID) || !httpx.IsUUID(job.ChapterID) {
		return 0, fmt.Errorf("chapter_published: bad ids")
	}
	msg := fmt.Sprintf("Bộ truyện \"%s\" vừa có chương mới: %s", job.StoryTitle, job.ChapterTitle)
	story := job.StoryID
	total, after := 0, ""
	for {
		var page []string
		q := url.Values{"limit": {"1000"}}
		if after != "" {
			q.Set("after", after)
		}
		status, err := s.lib.Call(ctx, "GET", "/internal/stories/"+job.StoryID+"/followers?"+q.Encode(), nil, &page)
		if err == nil && status != 200 {
			err = fmt.Errorf("library followers: HTTP %d", status)
		}
		if err != nil {
			return total, err
		}
		items := make([]notifyItem, 0, len(page))
		for _, u := range page {
			if job.UploaderID != nil && u == *job.UploaderID {
				continue
			}
			items = append(items, notifyItem{
				UserID: u, Type: "chapter_update", Title: truncate("Chương mới: "+job.StoryTitle, 300), Message: &msg,
				ReferenceID: &story, SenderID: job.UploaderID, Link: job.Link, Image: job.Image,
				Data: map[string]any{"story_title": job.StoryTitle}, DedupeKey: "chapter:" + job.ChapterID + ":" + u,
			})
		}
		n, err := s.deliver(ctx, items)
		total += n
		if err != nil {
			return total, err
		}
		if len(page) < 1000 {
			return total, nil
		}
		after = page[len(page)-1]
		time.Sleep(25 * time.Millisecond) // live traffic keeps its share of the database
	}
}

// List: newest first (own rows + live announcements), with unseen_count (the bell's number) and unread_count.
func (s *Service) List(ctx context.Context, me, cat, limitStr, beforeStr, unreadStr, qStr string) (map[string]any, error) {
	if cat != "" && !validCategory(cat) {
		return nil, httpx.Bad("Nhóm thông báo không hợp lệ.")
	}
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	var before *time.Time
	if beforeStr != "" {
		t, err := time.Parse(time.RFC3339Nano, beforeStr)
		if err != nil {
			return nil, httpx.Bad("before không hợp lệ.")
		}
		before = &t
	}
	unread := unreadStr == "1"
	pattern := ""
	if v := strings.TrimSpace(qStr); v != "" {
		if len(v) > 100 {
			v = v[:100]
		}
		pattern = "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(v) + "%"
	}
	list, err := s.repo.list(ctx, me, cat, unread, before, limit, pattern)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	c, err := s.repo.counts(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("count notifications: %w", err)
	}
	return map[string]any{"notifications": list, "unseen_count": c.unseen, "unread_count": c.unread}, nil
}

// Seen: the bell was opened, its number goes back to 0 (items stay unread until clicked).
func (s *Service) Seen(ctx context.Context, me string) error {
	if err := s.repo.markSeen(ctx, me); err != nil {
		return fmt.Errorf("mark seen: %w", err)
	}
	return nil
}

// Read marks a notification or an announcement read.
func (s *Service) Read(ctx context.Context, me, id string) error {
	if !httpx.IsUUID(id) {
		return httpx.NotFound("Thông báo không tồn tại.")
	}
	n, err := s.repo.markRead(ctx, id, me)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if n == 0 {
		return httpx.NotFound("Thông báo không tồn tại.")
	}
	return nil
}

// ReadAll marks everything (of a category) read.
func (s *Service) ReadAll(ctx context.Context, me, cat string) error {
	if err := s.repo.markAllRead(ctx, me, cat); err != nil {
		return fmt.Errorf("mark all read: %w", err)
	}
	return nil
}

// Delete removes a notification of mine; deleted = false means it was not one (an announcement: mark it read instead).
func (s *Service) Delete(ctx context.Context, me, id string) (deleted bool, err error) {
	if !httpx.IsUUID(id) {
		return false, httpx.NotFound("Thông báo không tồn tại.")
	}
	n, err := s.repo.deleteNotification(ctx, id, me)
	if err != nil {
		return false, fmt.Errorf("delete notification: %w", err)
	}
	return n > 0, nil
}

// Settings -> [{category, label, web}]
func (s *Service) Settings(ctx context.Context, me string) ([]map[string]any, error) {
	off, err := s.repo.disabledCategories(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("read settings: %w", err)
	}
	out := make([]map[string]any, 0, len(categories))
	for _, c := range categories {
		out = append(out, map[string]any{"category": c.ID, "label": c.Label, "web": !slices.Contains(off, c.ID)})
	}
	return out, nil
}

// PutSettings: only the categories sent change.
func (s *Service) PutSettings(ctx context.Context, me string, body settingsBody) error {
	b := &pgx.Batch{}
	for cat, v := range body {
		if v.Web == nil || !validCategory(cat) {
			return httpx.Bad("Cài đặt không hợp lệ.")
		}
		if *v.Web {
			b.Queue(`DELETE FROM notification_settings WHERE user_id = $1 AND category = $2`, me, cat)
		} else {
			b.Queue(`INSERT INTO notification_settings (user_id, category, web) VALUES ($1, $2, false)
				ON CONFLICT (user_id, category) DO UPDATE SET web = false`, me, cat)
		}
	}
	if err := s.repo.applySettings(ctx, b); err != nil {
		return fmt.Errorf("save settings: %w", err)
	}
	return nil
}

// Broadcasts: the live ones, newest first, with how many people read each.
func (s *Service) Broadcasts(ctx context.Context) ([]map[string]any, error) {
	list, err := s.repo.broadcasts(ctx)
	if err != nil {
		return nil, fmt.Errorf("list broadcasts: %w", err)
	}
	return list, nil
}

// CreateBroadcast: everybody sees it in the bell for 30 days.
func (s *Service) CreateBroadcast(ctx context.Context, me string, body broadcastBody) (string, error) {
	title, msg, link := strings.TrimSpace(body.Title), strings.TrimSpace(body.Message), strings.TrimSpace(body.Link)
	switch {
	case title == "" || len([]rune(title)) > 200:
		return "", httpx.Bad("Tiêu đề cần 1–200 ký tự.")
	case len([]rune(msg)) > 1000:
		return "", httpx.Bad("Nội dung tối đa 1000 ký tự.")
	case link != "" && (!strings.HasPrefix(link, "/") || strings.HasPrefix(link, "//") || len(link) > 300):
		return "", httpx.Bad("Liên kết phải là đường dẫn trong trang, bắt đầu bằng /.")
	}
	id, err := s.repo.createBroadcast(ctx, title, msg, link, me)
	if err != nil {
		return "", fmt.Errorf("create broadcast: %w", err)
	}
	s.pub.Publish(ctx, []string{"*"}, "notification", nil)
	return id, nil
}

// DeleteBroadcast removes an announcement.
func (s *Service) DeleteBroadcast(ctx context.Context, id string) error {
	if !httpx.IsUUID(id) {
		return httpx.NotFound("Không tìm thấy.")
	}
	if err := s.repo.deleteBroadcast(ctx, id); err != nil {
		return fmt.Errorf("delete broadcast: %w", err)
	}
	return nil
}
