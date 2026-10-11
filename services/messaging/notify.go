package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Notifications (Plan/messaging.md, E3). The backend decides who gets what and queues jobs on novel.notifications
// (RabbitMQ); this file turns them into rows: drop what people switched off, never twice (dedupe keys), merge
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

// categories in display order, with what the settings page calls them.
var categories = []struct{ ID, Label string }{
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

func (s *server) runJob(ctx context.Context, job notifyJob) (int, error) {
	switch job.Kind {
	case "notify":
		return s.deliver(ctx, job.Items)
	case "chapter_published":
		return s.fanOutChapter(ctx, job)
	}
	return 0, fmt.Errorf("unknown notification job kind %q", job.Kind)
}

// deliver writes items (one transaction) and pings their recipients. Returns how many rows were created or merged into.
func (s *server) deliver(ctx context.Context, items []notifyItem) (int, error) {
	users := map[string]bool{}
	for _, it := range items {
		if isUUID(it.UserID) {
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
	rows, err := s.db.Query(ctx, `SELECT user_id::text || '|' || category FROM notification_settings WHERE user_id = ANY($1) AND NOT web`, ids)
	if err != nil {
		return 0, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	for _, k := range keys {
		off[k] = true
	}

	b := &pgx.Batch{}
	for _, it := range items {
		nt := typeInfo(it.Type)
		if !isUUID(it.UserID) || it.Title == "" || (!nt.locked && off[it.UserID+"|"+nt.category]) {
			continue
		}
		actors := "[]"
		if it.SenderID != nil && isUUID(*it.SenderID) {
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
	got := map[string]bool{}
	n := 0
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		br := tx.SendBatch(ctx, b)
		for i := 0; i < b.Len(); i++ {
			var u string
			err := br.QueryRow().Scan(&u)
			if err == pgx.ErrNoRows {
				continue // delivered before
			}
			if err != nil {
				br.Close()
				return err
			}
			got[u] = true
			n++
		}
		return br.Close()
	})
	if err != nil {
		return 0, err
	}
	recipients := make([]string, 0, len(got))
	for u := range got {
		recipients = append(recipients, u)
	}
	s.publish(ctx, recipients, "notification", nil)
	return n, nil
}

// upsertNotification: skip a dedupe key seen before; otherwise insert, or merge into the person's unread row with the
// same group key (newest actor first, at most 3 kept, count + 1, unseen again, moves to the top).
// shortcut: actor_count grows unless the actor is among the 3 kept, so one person commenting often counts more than once;
// keep every actor id if that matters.
const upsertNotification = `
WITH d AS (
  INSERT INTO notification_dedupe (key) SELECT $1 WHERE $1 <> '' ON CONFLICT DO NOTHING RETURNING 1
)
INSERT INTO notifications AS n (user_id, type, category, title, message, link, image, actors, actor_count, data, group_key)
SELECT $2, $3, $4, $5, $6, $7, $8, $9::jsonb, jsonb_array_length($9::jsonb), $10::jsonb, NULLIF($11, '')
WHERE $1 = '' OR EXISTS (SELECT 1 FROM d)
ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL DO UPDATE SET
  title = EXCLUDED.title, message = EXCLUDED.message, link = EXCLUDED.link, image = COALESCE(EXCLUDED.image, n.image),
  actors = (SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]') FROM (
    SELECT e, o FROM (
      SELECT DISTINCT ON (e->>'id') e, o FROM jsonb_array_elements(EXCLUDED.actors || n.actors) WITH ORDINALITY x(e, o) ORDER BY e->>'id', o
    ) u ORDER BY o LIMIT 3) k),
  actor_count = n.actor_count + CASE WHEN EXCLUDED.actors = '[]'::jsonb
    OR n.actors @> jsonb_build_array(jsonb_build_object('id', EXCLUDED.actors->0->'id')) THEN 0 ELSE 1 END,
  count = n.count + 1, data = n.data || EXCLUDED.data, seen_at = NULL, updated_at = NOW()
RETURNING user_id::text`

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// fanOutChapter tells every follower of the story (asked from the library service, 1,000 at a time) about a new chapter;
// unread ones merge per story ("Truyện X có 3 chương mới").
func (s *server) fanOutChapter(ctx context.Context, job notifyJob) (int, error) {
	if !isUUID(job.StoryID) || !isUUID(job.ChapterID) {
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
		status, err := s.lib.call(ctx, "GET", "/internal/stories/"+job.StoryID+"/followers?"+q.Encode(), nil, &page)
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

// --- RabbitMQ: novel.notifications (the backend's queue.service.ts declares the same topology) ---------------------

const (
	notifyQueue       = "novel.notifications"
	notifyRetryQueue  = "novel.notifications.retry"
	notifyDLQ         = "novel.notifications.dlq"
	notifyMaxAttempts = 5
)

type envelope struct {
	ID       string          `json:"id"`
	Attempts int             `json:"attempts"`
	Job      json.RawMessage `json:"job"`
}

// consumeLoop runs jobs from the queue forever (reconnecting with backoff). Several messaging copies share the queue.
func (s *server) consumeLoop(ctx context.Context, rabbitURL string) {
	if rabbitURL == "" {
		logf(ctx, "warn", "RABBITMQ_URL empty: notifications only arrive through /internal/notifications/jobs")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.consumeSession(ctx, rabbitURL)
		if ctx.Err() != nil {
			return
		}
		logf(ctx, "warn", "notification consumer stopped, retrying: "+fmt.Sprint(err))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (s *server) consumeSession(ctx context.Context, rabbitURL string) error {
	conn, err := amqp.DialConfig(rabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	// Arguments must match the backend's declaration exactly (amqplib sends 10000 as a short)
	if _, err := ch.QueueDeclare(notifyDLQ, true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(notifyRetryQueue, true, false, false, false, amqp.Table{
		"x-message-ttl": int16(10000), "x-dead-letter-exchange": "", "x-dead-letter-routing-key": notifyQueue}); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(notifyQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.Qos(20, 0, false); err != nil {
		return err
	}
	deliveries, err := ch.Consume(notifyQueue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	logInfo(ctx, "consuming "+notifyQueue)
	closed := conn.NotifyClose(make(chan *amqp.Error, 1))
	sem := make(chan struct{}, 4) // a big fan-out must not hold up everything else
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e := <-closed:
			return e
		case d, open := <-deliveries:
			if !open {
				return fmt.Errorf("deliveries closed")
			}
			sem <- struct{}{}
			go func() {
				defer func() { <-sem }()
				s.handleDelivery(ctx, ch, d)
			}()
		}
	}
}

// handleDelivery runs one job; a failure goes to the retry queue (10 s later) or, after 5 attempts, to the DLQ.
// Acked only after that, so a crash re-delivers it (deliveries are idempotent thanks to dedupe keys).
func (s *server) handleDelivery(ctx context.Context, ch *amqp.Channel, d amqp.Delivery) {
	var env envelope
	var job notifyJob
	if json.Unmarshal(d.Body, &env) != nil || json.Unmarshal(env.Job, &job) != nil {
		ch.PublishWithContext(ctx, "", notifyDLQ, false, false, amqp.Publishing{DeliveryMode: amqp.Persistent, Body: d.Body})
		d.Ack(false)
		return
	}
	start := time.Now()
	n, err := s.runJob(ctx, job)
	if err == nil {
		if job.Kind == "chapter_published" {
			logInfo(ctx, "chapter_published "+env.ID+": "+strconv.Itoa(n)+" notifications in "+time.Since(start).Round(time.Millisecond).String())
		}
		d.Ack(false)
		return
	}
	env.Attempts++
	to := notifyRetryQueue
	if env.Attempts >= notifyMaxAttempts {
		to = notifyDLQ
	}
	logf(ctx, "warn", fmt.Sprintf("notification job %s (%s) failed (attempt %d): %v, to %s", env.ID, job.Kind, env.Attempts, err, to))
	body, _ := json.Marshal(env)
	if perr := ch.PublishWithContext(ctx, "", to, false, false, amqp.Publishing{
		ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: body}); perr != nil {
		d.Nack(false, true) // could not park it: let the broker give it back
		return
	}
	d.Ack(false)
}

// cleanupLoop keeps the inbox small: read > 30 days, unread > 60 days, dedupe keys > 60 days, announcements > 30 days.
func (s *server) cleanupLoop(ctx context.Context) {
	for {
		for _, q := range []string{
			`DELETE FROM notifications WHERE read_at < NOW() - INTERVAL '30 days'`,
			`DELETE FROM notifications WHERE read_at IS NULL AND updated_at < NOW() - INTERVAL '60 days'`,
			`DELETE FROM notification_dedupe WHERE created_at < NOW() - INTERVAL '60 days'`,
			`DELETE FROM broadcasts WHERE created_at < NOW() - INTERVAL '30 days'`,
		} {
			if _, err := s.db.Exec(ctx, q); err != nil && ctx.Err() == nil {
				logf(ctx, "warn", "notification cleanup: "+err.Error())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}
