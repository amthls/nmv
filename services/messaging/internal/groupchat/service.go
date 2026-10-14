// Package groupchat: translation group chat, a "group" conversation per group. Who belongs to the group (and their
// role) is the backend's: asked and cached 30 s. Same JSON as the former /api/v1/groups/:id/messages.
package groupchat

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/messaging/internal/platform/catalog"
	"nmv/messaging/internal/platform/httpx"
)

// Backend is the part of the catalog client group chat needs.
type Backend interface {
	Members(ctx context.Context, groupID string) ([]catalog.Member, error)
	ForgetGroup(groupID string)
	Profiles(ctx context.Context, ids []string) (map[string]catalog.Profile, error)
}

// Publisher pings people over the realtime channel.
type Publisher interface {
	Publish(ctx context.Context, users []string, typ string, data map[string]any)
}

// Limiter limits how fast a person may send.
type Limiter interface {
	Allow(user string, now time.Time) bool
}

// Service holds the group-chat rules.
type Service struct {
	repo *Repository
	be   Backend
	pub  Publisher
	rate Limiter
	now  func() time.Time
}

// NewService wires the group-chat service.
func NewService(repo *Repository, be Backend, pub Publisher, rate Limiter, now func() time.Time) *Service {
	return &Service{repo: repo, be: be, pub: pub, rate: rate, now: now}
}

// groupRole: my role in the group ("" = not a member); a miss is re-asked once, so someone who just joined is in.
func (s *Service) groupRole(ctx context.Context, groupID, me string) (string, []catalog.Member, error) {
	find := func(ms []catalog.Member) string {
		for _, m := range ms {
			if m.UserID == me {
				return m.Role
			}
		}
		return ""
	}
	ms, err := s.be.Members(ctx, groupID)
	if err != nil {
		return "", nil, err
	}
	if role := find(ms); role != "" {
		return role, ms, nil
	}
	s.be.ForgetGroup(groupID)
	if ms, err = s.be.Members(ctx, groupID); err != nil {
		return "", nil, err
	}
	return find(ms), ms, nil
}

// access: the caller's role and the members of the group; 404 for no such group, 403 (forbidden) for a non-member.
func (s *Service) access(ctx context.Context, gid, me, forbidden string) (string, []catalog.Member, error) {
	if !httpx.IsUUID(gid) {
		return "", nil, httpx.NotFound("Nhóm dịch không tồn tại")
	}
	role, ms, err := s.groupRole(ctx, gid, me)
	if errors.Is(err, catalog.ErrNoGroup) {
		return "", nil, httpx.NotFound("Nhóm dịch không tồn tại")
	}
	if err != nil {
		return "", nil, fmt.Errorf("group members: %w", err)
	}
	if role == "" {
		return "", nil, &httpx.InputError{Status: 403, Msg: forbidden}
	}
	return role, ms, nil
}

// Messages: the latest 100 (oldest first), members only.
func (s *Service) Messages(ctx context.Context, gid, me string) ([]map[string]any, error) {
	_, ms, err := s.access(ctx, gid, me, "Chỉ thành viên nhóm mới xem được chatroom nội bộ.")
	if err != nil {
		return nil, err
	}
	list, err := s.repo.latest(ctx, gid)
	if err != nil {
		return nil, fmt.Errorf("latest group messages: %w", err)
	}
	ids := make([]string, len(list))
	for i, x := range list {
		ids[i] = x.sender
	}
	profiles, err := s.be.Profiles(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("sender profiles: %w", err)
	}
	roles := map[string]string{}
	for _, m := range ms {
		roles[m.UserID] = m.Role
	}
	out := []map[string]any{}
	for _, x := range list {
		out = append(out, groupMessage(x.id, gid, x.sender, x.body, x.created, profiles[x.sender], roles[x.sender]))
	}
	return out, nil
}

// Send: members only; every member's tabs get `group_message`.
func (s *Service) Send(ctx context.Context, gid, me, message string) (map[string]any, error) {
	body, err := httpx.Text(message, maxMessage, "Nội dung tin nhắn")
	if err != nil {
		return nil, err
	}
	role, ms, err := s.access(ctx, gid, me, "Chỉ thành viên trong nhóm mới có quyền gửi tin nhắn trong chatroom nội bộ.")
	if err != nil {
		return nil, err
	}
	if !s.rate.Allow(me, s.now()) {
		return nil, &httpx.InputError{Status: 429, Msg: "Bạn nhắn quá nhanh."}
	}
	id, created, err := s.repo.insert(ctx, gid, me, body)
	if err != nil {
		return nil, fmt.Errorf("store group message: %w", err)
	}
	profiles, _ := s.be.Profiles(ctx, []string{me})
	users := make([]string, len(ms))
	for i, m := range ms {
		users[i] = m.UserID
	}
	s.pub.Publish(ctx, users, "group_message", map[string]any{"groupId": gid})
	return groupMessage(id, gid, me, body, created, profiles[me], role), nil
}

// Delete: my own message, or any as the group's leader/mod.
func (s *Service) Delete(ctx context.Context, gid, msgID, me string) error {
	if !httpx.IsUUID(gid) || !httpx.IsUUID(msgID) {
		return httpx.NotFound("Tin nhắn không tồn tại")
	}
	sender, err := s.repo.sender(ctx, msgID, gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("Tin nhắn không tồn tại")
	}
	if err != nil {
		return fmt.Errorf("find group message: %w", err)
	}
	if sender != me {
		role, _, err := s.groupRole(ctx, gid, me)
		if err != nil && !errors.Is(err, catalog.ErrNoGroup) {
			return fmt.Errorf("group members: %w", err)
		}
		if role != "leader" && role != "mod" {
			return &httpx.InputError{Status: 403, Msg: "Bạn chỉ có thể xóa tin nhắn của chính mình."}
		}
	}
	if err := s.repo.delete(ctx, msgID); err != nil {
		return fmt.Errorf("delete group message: %w", err)
	}
	return nil
}
