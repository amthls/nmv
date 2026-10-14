// Package dm: direct messages, labels, blocks and pins (same paths and JSON as the backend's former /api/v1/messages).
package dm

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"nmv/messaging/internal/platform/catalog"
	"nmv/messaging/internal/platform/httpx"
)

// Profiles gives people's names and avatars (the backend's profiles).
type Profiles interface {
	Profiles(ctx context.Context, ids []string) (map[string]catalog.Profile, error)
	ByUsername(ctx context.Context, username string) (*catalog.Profile, error)
}

// Publisher pings people over the realtime channel.
type Publisher interface {
	Publish(ctx context.Context, users []string, typ string, data map[string]any)
}

// Limiter limits how fast a person may send.
type Limiter interface {
	Allow(user string, now time.Time) bool
}

// Service holds the direct-message rules.
type Service struct {
	repo     *Repository
	profiles Profiles
	pub      Publisher
	rate     Limiter
	now      func() time.Time
}

// NewService wires the direct-message service.
func NewService(repo *Repository, profiles Profiles, pub Publisher, rate Limiter, now func() time.Time) *Service {
	return &Service{repo: repo, profiles: profiles, pub: pub, rate: rate, now: now}
}

// partner: the other person, by username; deleted accounts can't be messaged (404).
func (s *Service) partner(ctx context.Context, username string) (*catalog.Profile, error) {
	username = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(username), "@"))
	if username == "" {
		return nil, httpx.NotFound("Người dùng không tồn tại")
	}
	p, err := s.profiles.ByUsername(ctx, username)
	if err != nil {
		return nil, fmt.Errorf("find partner: %w", err)
	}
	if p == nil || p.Deleted {
		return nil, httpx.NotFound("Người dùng không tồn tại")
	}
	return p, nil
}

// Blocked: either blocked the other, so they can't message each other.
func (s *Service) Blocked(ctx context.Context, a, b string) (bool, error) {
	byA, byB, err := s.repo.blockState(ctx, a, b)
	if err != nil {
		return false, fmt.Errorf("block state: %w", err)
	}
	return byA || byB, nil
}

// ---- inbox ---------------------------------------------------------------------------------------------------

// Inbox: one row per person I talked with (latest first) and my total unread count.
func (s *Service) Inbox(ctx context.Context, me, label, q string) (*Inbox, error) {
	if label != "" && !httpx.IsUUID(label) {
		return nil, httpx.Bad("Nhãn không hợp lệ.")
	}
	q = strings.TrimSpace(q)
	if utf8.RuneCountInString(q) > 100 {
		q = string([]rune(q)[:100])
	}
	var pattern *string
	if q != "" {
		p := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
		pattern = &p
	}
	list, err := s.repo.inbox(ctx, me, nullable(label), pattern)
	if err != nil {
		return nil, fmt.Errorf("read inbox: %w", err)
	}
	ids := make([]string, len(list))
	for i, x := range list {
		ids[i] = x.partner
	}
	profiles, err := s.profiles.Profiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("inbox profiles: %w", err)
	}
	lq := strings.ToLower(q)
	out := []map[string]any{}
	for _, x := range list {
		p, found := profiles[x.partner]
		if !found {
			continue
		}
		if q != "" && x.match == nil && !strings.Contains(strings.ToLower(p.Username), lq) &&
			(p.DisplayName == nil || !strings.Contains(strings.ToLower(*p.DisplayName), lq)) {
			continue
		}
		item := profileFields(p)
		item["partner_id"], item["last_message"], item["last_sender_id"], item["last_at"] = x.partner, x.last, x.lastSender, x.lastAt
		item["unread"], item["label_ids"], item["blocked"], item["match_message"] = x.unread, x.labels, x.blocked, x.match
		out = append(out, item)
		if len(out) == 100 {
			break
		}
	}
	unread, err := s.repo.unreadTotal(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("unread total: %w", err)
	}
	return &Inbox{Conversations: out, UnreadCount: unread}, nil
}

// ---- thread ----------------------------------------------------------------------------------------------------

// Thread: the latest 100 messages (oldest first), every pinned one, my labels on it and the block state. Opening the
// thread marks it read.
func (s *Service) Thread(ctx context.Context, me, username string) (*Thread, error) {
	p, err := s.partner(ctx, username)
	if err != nil {
		return nil, err
	}
	if err := s.repo.markRead(ctx, dmKey(me, p.ID), me); err != nil { // everything there is now
		return nil, fmt.Errorf("mark read: %w", err)
	}
	c, err := s.repo.loadConv(ctx, me, p.ID)
	if err != nil {
		return nil, fmt.Errorf("load conversation: %w", err)
	}
	messages, pinned := []map[string]any{}, []map[string]any{}
	if c.exists {
		rows, err := s.repo.latest(ctx, c.id)
		if err != nil {
			return nil, fmt.Errorf("latest messages: %w", err)
		}
		messages = shape(rows, c, me, p.ID)
		if rows, err = s.repo.pinned(ctx, c.id); err != nil {
			return nil, fmt.Errorf("pinned messages: %w", err)
		}
		pinned = shape(rows, c, me, p.ID)
	}
	labels, err := s.repo.labelsOf(ctx, me, p.ID)
	if err != nil {
		return nil, fmt.Errorf("thread labels: %w", err)
	}
	byMe, byThem, err := s.repo.blockState(ctx, me, p.ID)
	if err != nil {
		return nil, fmt.Errorf("block state: %w", err)
	}
	partner := profileFields(*p)
	partner["id"] = p.ID
	return &Thread{Partner: partner, Messages: messages, Pinned: pinned, LabelIDs: labels, BlockedByMe: byMe, CanMessage: !byMe && !byThem}, nil
}

// shape renders rows like the former direct_messages rows: recipient_id and read_at are derived (read_at = when the
// recipient last read up to that message).
func shape(rows []msgRow, c dmConv, me, other string) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, x := range rows {
		recipient, readSeq, readAt := other, c.partnerReadSeq, c.partnerReadAt
		if x.sender == other {
			recipient, readSeq, readAt = me, c.myReadSeq, c.myReadAt
		}
		var read *time.Time
		if x.seq <= readSeq {
			read = readAt
		}
		out = append(out, map[string]any{"id": x.id, "sender_id": x.sender, "recipient_id": recipient, "message": x.body, "read_at": read,
			"created_at": x.created, "pinned_at": x.pinnedAt, "pinned_by": x.pinnedBy, "draft_id": x.draft})
	}
	return out
}

// ---- send ------------------------------------------------------------------------------------------------------

// sendDM stores a message (optionally a draft card) in the pair's conversation, creating it the first time, and pings
// both people. Blocks are the caller's to check.
func (s *Service) sendDM(ctx context.Context, me, other, body string, draftID *string) (map[string]any, error) {
	id, created, err := s.repo.insertMessage(ctx, me, other, body, draftID)
	if err != nil {
		return nil, fmt.Errorf("store message: %w", err)
	}
	msg := map[string]any{"id": id, "sender_id": me, "recipient_id": other, "message": body, "read_at": nil,
		"created_at": created, "pinned_at": nil, "draft_id": draftID}
	from := ""
	if ps, err := s.profiles.Profiles(ctx, []string{me}); err == nil {
		from = ps[me].Username
	}
	s.pub.Publish(ctx, []string{me, other}, "dm", map[string]any{"from": from})
	return msg, nil
}

// Send: POST /messages/{username} {message}.
func (s *Service) Send(ctx context.Context, me, username, message string) (map[string]any, error) {
	body, err := httpx.Text(message, maxMessage, "Nội dung tin nhắn")
	if err != nil {
		return nil, err
	}
	if !s.rate.Allow(me, s.now()) {
		return nil, &httpx.InputError{Status: 429, Msg: "Bạn nhắn quá nhanh."}
	}
	p, err := s.partner(ctx, username)
	if err != nil {
		return nil, err
	}
	if p.ID == me {
		return nil, httpx.Bad("Bạn không thể tự nhắn tin cho mình.")
	}
	blocked, err := s.Blocked(ctx, me, p.ID)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, &httpx.InputError{Status: 403, Msg: blockedMsg}
	}
	return s.sendDM(ctx, me, p.ID, body, nil)
}

// SendInternal: the backend sends a workspace draft card. 403 when either blocked the other.
func (s *Service) SendInternal(ctx context.Context, b internalDMRequest) (map[string]any, error) {
	if !httpx.IsUUID(b.From) || !httpx.IsUUID(b.To) || b.From == b.To || (b.DraftID != nil && !httpx.IsUUID(*b.DraftID)) {
		return nil, httpx.Bad("from, to, message")
	}
	body, err := httpx.Text(b.Message, maxMessage, "Nội dung tin nhắn")
	if err != nil {
		return nil, err
	}
	blocked, err := s.Blocked(ctx, b.From, b.To)
	if err != nil {
		return nil, err
	}
	if blocked {
		return nil, &httpx.InputError{Status: 403, Msg: blockedMsg}
	}
	return s.sendDM(ctx, b.From, b.To, body, b.DraftID)
}

// ---- labels ----------------------------------------------------------------------------------------------------

// Labels lists my labels with how many conversations each holds.
func (s *Service) Labels(ctx context.Context, me string) ([]map[string]any, error) {
	labels, err := s.repo.labels(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	return labels, nil
}

func (lb labelBody) check(partial bool) (name, color *string, err error) {
	if !partial || lb.Name != nil {
		n := ""
		if lb.Name != nil {
			n = *lb.Name
		}
		v, err := httpx.Text(n, maxLabelName, "Tên nhãn")
		if err != nil {
			return nil, nil, err
		}
		name = &v
	}
	if !partial || lb.Color != nil {
		c := "sky"
		if lb.Color != nil {
			c = *lb.Color
		}
		if !labelColors[c] {
			return nil, nil, httpx.Bad("Màu nhãn không hợp lệ.")
		}
		color = &c
	}
	return name, color, nil
}

// CreateLabel adds a label of mine.
func (s *Service) CreateLabel(ctx context.Context, me string, b labelBody) (map[string]any, error) {
	name, color, err := b.check(false)
	if err != nil {
		return nil, err
	}
	n, err := s.repo.labelCount(ctx, me)
	if err != nil {
		return nil, fmt.Errorf("count labels: %w", err)
	}
	if n >= maxLabels {
		return nil, httpx.Bad("Tối đa 20 nhãn.")
	}
	id, err := s.repo.createLabel(ctx, me, *name, *color)
	if isUniqueViolation(err) {
		return nil, httpx.Bad("Bạn đã có nhãn tên này.")
	}
	if err != nil {
		return nil, fmt.Errorf("create label: %w", err)
	}
	return map[string]any{"id": id, "name": *name, "color": *color, "conversation_count": 0}, nil
}

// UpdateLabel renames or recolors a label of mine.
func (s *Service) UpdateLabel(ctx context.Context, me, id string, b labelBody) (map[string]any, error) {
	if !httpx.IsUUID(id) {
		return nil, httpx.Bad("Nhãn không hợp lệ.")
	}
	name, color, err := b.check(true)
	if err != nil {
		return nil, err
	}
	n, c, err := s.repo.updateLabel(ctx, id, me, name, color)
	switch {
	case isUniqueViolation(err):
		return nil, httpx.Bad("Bạn đã có nhãn tên này.")
	case errors.Is(err, pgx.ErrNoRows):
		return nil, httpx.NotFound("Không tìm thấy nhãn.")
	case err != nil:
		return nil, fmt.Errorf("update label: %w", err)
	}
	return map[string]any{"id": id, "name": n, "color": c}, nil
}

// DeleteLabel removes a label of mine.
func (s *Service) DeleteLabel(ctx context.Context, me, id string) error {
	if !httpx.IsUUID(id) {
		return httpx.Bad("Nhãn không hợp lệ.")
	}
	n, err := s.repo.deleteLabel(ctx, id, me)
	if err != nil {
		return fmt.Errorf("delete label: %w", err)
	}
	if n == 0 {
		return httpx.NotFound("Không tìm thấy nhãn.")
	}
	return nil
}

// SetLabels replaces the labels I put on my conversation with this person; returns the sorted ids.
func (s *Service) SetLabels(ctx context.Context, me, username string, labelIDs []string) ([]string, error) {
	set := map[string]bool{}
	for _, id := range labelIDs {
		if !httpx.IsUUID(id) {
			return nil, httpx.Bad("Danh sách nhãn không hợp lệ.")
		}
		set[strings.ToLower(id)] = true
	}
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	p, err := s.partner(ctx, username)
	if err != nil {
		return nil, err
	}
	owned, err := s.repo.ownedLabels(ctx, me, ids)
	if err != nil {
		return nil, fmt.Errorf("check labels: %w", err)
	}
	if owned != len(ids) {
		return nil, httpx.Bad("Có nhãn không thuộc về bạn.")
	}
	if err := s.repo.replaceLabels(ctx, me, p.ID, ids); err != nil {
		return nil, fmt.Errorf("set labels: %w", err)
	}
	return ids, nil
}

// ---- block / pin -----------------------------------------------------------------------------------------------

// SetBlock blocks or unblocks a person; returns the message to show.
func (s *Service) SetBlock(ctx context.Context, me, username string, block bool) (string, error) {
	p, err := s.partner(ctx, username)
	if err != nil {
		return "", err
	}
	if p.ID == me {
		return "", httpx.Bad("Bạn không thể tự chặn mình.")
	}
	name := p.Username
	if p.DisplayName != nil && *p.DisplayName != "" {
		name = *p.DisplayName
	}
	msg := "Đã bỏ chặn " + name + "."
	if block {
		err = s.repo.block(ctx, me, p.ID)
		msg = "Đã chặn " + name + "."
	} else {
		err = s.repo.unblock(ctx, me, p.ID)
	}
	if err != nil {
		return "", fmt.Errorf("set block: %w", err)
	}
	s.pub.Publish(ctx, []string{me}, "dm", map[string]any{}) // only my tabs: telling them would reveal the block
	return msg, nil
}

// SetPin pins (or unpins) a message of my conversation with this person. Both people see pins.
func (s *Service) SetPin(ctx context.Context, me, username, msgID string, pin bool) (map[string]any, error) {
	if !httpx.IsUUID(msgID) {
		return nil, httpx.Bad("Tin nhắn không hợp lệ.")
	}
	p, err := s.partner(ctx, username)
	if err != nil {
		return nil, err
	}
	key := dmKey(me, p.ID)
	if pin {
		n, err := s.repo.pinCount(ctx, key, msgID)
		if err != nil {
			return nil, fmt.Errorf("count pins: %w", err)
		}
		if n >= maxPins {
			return nil, httpx.Bad("Mỗi cuộc trò chuyện ghim tối đa 10 tin. Bỏ ghim bớt trước.")
		}
	}
	id, at, err := s.repo.setPin(ctx, pin, key, msgID, me)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("Không tìm thấy tin nhắn.")
	}
	if err != nil {
		return nil, fmt.Errorf("set pin: %w", err)
	}
	s.pub.Publish(ctx, []string{me, p.ID}, "dm", map[string]any{})
	return map[string]any{"id": id, "pinned_at": at}, nil
}
