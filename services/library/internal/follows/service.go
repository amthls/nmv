// Package follows: the follow list ("Tủ truyện"), moved from the backend's history.controller.ts with the same JSON.
package follows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/library/internal/platform/httpx"
	"nmv/library/internal/platform/logger"
)

// Backend is the part of the catalog client follows needs.
type Backend interface {
	Call(ctx context.Context, method, path string, body any, out any) (int, error)
}

// Service holds the follow rules.
type Service struct {
	repo *Repository
	be   Backend
}

// NewService wires the follow service.
func NewService(repo *Repository, be Backend) *Service { return &Service{repo: repo, be: be} }

// List: the person's follows, optionally of one category.
func (s *Service) List(ctx context.Context, me, category string) ([]map[string]any, error) {
	if category == "all" {
		category = ""
	}
	rows, err := s.repo.list(ctx, me, category)
	if err != nil {
		return nil, fmt.Errorf("list follows: %w", err)
	}
	return rows, nil
}

// Toggle follows a story; the same category again = unfollow; another one = move. Returns the action.
func (s *Service) Toggle(ctx context.Context, me string, b toggleRequest) (string, error) {
	if b.StoryID == "" {
		return "", httpx.Bad("story_id là bắt buộc.")
	}
	if !httpx.IsUUID(b.StoryID) || len([]rune(b.Category)) > 50 {
		return "", httpx.Bad("Dữ liệu không hợp lệ.")
	}
	id, current, err := s.repo.find(ctx, me, b.StoryID)
	switch {
	case err == nil && b.Category != "" && current != b.Category:
		if err := s.repo.setCategory(ctx, id, b.Category); err != nil {
			return "", fmt.Errorf("move follow: %w", err)
		}
		return ActionUpdated, nil
	case err == nil:
		if err := s.repo.remove(ctx, id); err != nil {
			return "", fmt.Errorf("unfollow: %w", err)
		}
		s.pushFavoriteCount(b.StoryID)
		return ActionRemoved, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return "", fmt.Errorf("find follow: %w", err)
	}
	exists, err := s.repo.storyExists(ctx, b.StoryID)
	if err != nil {
		return "", fmt.Errorf("check story: %w", err)
	}
	if !exists {
		return "", httpx.NotFound("Truyện hoặc chương không tồn tại.")
	}
	notify := true
	if b.Notify != nil {
		notify = *b.Notify
	}
	if err := s.repo.add(ctx, me, b.StoryID, b.Category, notify); err != nil {
		return "", fmt.Errorf("follow: %w", err)
	}
	s.pushFavoriteCount(b.StoryID)
	return ActionAdded, nil
}

// pushFavoriteCount sends the story's fresh follower count to the backend (stories.total_favorites), in the background.
// A recount, so a repeated or lost call can not drift it.
func (s *Service) pushFavoriteCount(storyID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		n, err := s.repo.count(ctx, storyID)
		if err != nil {
			logger.Logf(ctx, "warn", "favorite count: "+err.Error())
			return
		}
		status, err := s.be.Call(ctx, "POST", "/internal/favorite-counts", map[string]any{"stories": []map[string]any{{"id": storyID, "count": n}}}, nil)
		if err != nil || status != 200 {
			logger.Logf(ctx, "warn", "favorite count not sent to the backend", "story", storyID, "status", status, "error", err)
		}
	}()
}

// Status (guests: not following).
func (s *Service) Status(ctx context.Context, me, story string) (category *string, found bool, err error) {
	if me == "" || !httpx.IsUUID(story) {
		return nil, false, nil
	}
	category, found, err = s.repo.status(ctx, me, story)
	if err != nil {
		return nil, false, fmt.Errorf("follow status: %w", err)
	}
	return category, found, nil
}

// ApplyIdentityEvent: a deleted account follows and is followed by nobody (as the backend did). Seen events are skipped.
func (s *Service) ApplyIdentityEvent(ctx context.Context, body []byte) error {
	var evt identityEvent
	if err := json.Unmarshal(body, &evt); err != nil || !httpx.IsUUID(evt.EventID) {
		return fmt.Errorf("malformed event")
	}
	deleted := evt.Type == "identity.user.deleted" && evt.Data.DeletedAt != nil && httpx.IsUUID(evt.Data.ID)
	return s.repo.applyDeleted(ctx, evt, deleted)
}
