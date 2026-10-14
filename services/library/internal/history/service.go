// Package history: reading history and reading positions, moved from the backend's history.controller.ts and
// readingHistory.model.ts with the same JSON. Stories and chapters come from the ext_ copies.
package history

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/library/internal/platform/httpx"
	"nmv/library/internal/platform/logger"
)

// ChapterSyncer copies one chapter (and its story) from the backend right now.
type ChapterSyncer interface {
	SyncChapter(ctx context.Context, chapterID string) error
}

// Service holds the reading-history rules and the position buffer.
type Service struct {
	repo *Repository
	sync ChapterSyncer
	now  func() time.Time
	pos  positionBuffer
}

// NewService wires the history service.
func NewService(repo *Repository, sync ChapterSyncer, now func() time.Time) *Service {
	return &Service{repo: repo, sync: sync, now: now}
}

// List: one row per story (its latest chapter read), newest first.
func (s *Service) List(ctx context.Context, me string, limit int) ([]map[string]any, error) {
	if limit < 1 {
		limit = 100
	}
	if err := s.FlushPositions(ctx, me); err != nil {
		return nil, err
	}
	rows, err := s.repo.latestPerStory(ctx, me, min(limit, 200))
	if err != nil {
		return nil, fmt.Errorf("list history: %w", err)
	}
	return rows, nil
}

// chapterStory: the published chapter's story, from the copy (a chapter published seconds ago: sync first).
func (s *Service) chapterStory(ctx context.Context, chapterID string) (string, error) {
	for attempt := 0; attempt < 2; attempt++ {
		story, err := s.repo.storyOfChapter(ctx, chapterID)
		if err == nil {
			return story, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("find chapter: %w", err)
		}
		if attempt == 0 {
			if err := s.sync.SyncChapter(ctx, chapterID); err != nil {
				logger.Logf(ctx, "warn", "history: sync before retry failed: "+err.Error())
			}
		}
	}
	return "", httpx.NotFound("Chương không tồn tại.")
}

// Save notes a reading position: one row per person and chapter (reading it again updates it). The story always comes
// from the chapter, never from the client. The row is written later (positions.go).
func (s *Service) Save(ctx context.Context, me string, b saveRequest) (pendingRead, error) {
	if !httpx.IsUUID(b.ChapterID) {
		return pendingRead{}, httpx.Bad("Thiếu hoặc sai chapter_id")
	}
	story, err := s.chapterStory(ctx, b.ChapterID)
	if err != nil {
		return pendingRead{}, err
	}
	p := pendingRead{UserID: me, StoryID: story, ChapterID: b.ChapterID, Scroll: math.Round(httpx.Clamp(b.Scroll, 0, 100, 0)*100) / 100,
		Page: int(math.Round(httpx.Clamp(b.Page, 1, 100000, 1))), Seconds: int(math.Round(httpx.Clamp(b.Seconds, 0, 86400, 0))), ReadAt: s.now()}
	return s.pos.add(p), nil
}

// RecordOpen: the backend saw this person open the chapter (as the old UserReadingLog.recordLog did when serving it):
// touch the row, keep its position and time.
func (s *Service) RecordOpen(ctx context.Context, b openRequest) error {
	if !httpx.IsUUID(b.UserID) || !httpx.IsUUID(b.ChapterID) {
		return httpx.Bad("user_id, chapter_id")
	}
	story, err := s.chapterStory(ctx, b.ChapterID)
	if err != nil {
		return err
	}
	if err := s.repo.touch(ctx, b.UserID, story, b.ChapterID); err != nil {
		return fmt.Errorf("touch history: %w", err)
	}
	return nil
}

// Delete removes one row, or (a story id) every row of that story.
func (s *Service) Delete(ctx context.Context, me, id string) error {
	if err := s.FlushPositions(ctx, me); err != nil { // else a pending position would bring the row back
		return err
	}
	if httpx.IsUUID(id) {
		n, err := s.repo.deleteRows(ctx, id, me)
		if err != nil {
			return fmt.Errorf("delete history: %w", err)
		}
		if n > 0 {
			return nil
		}
	}
	return httpx.NotFound("Bản ghi không tồn tại hoặc bạn không có quyền xóa.")
}

// Clear removes the person's whole history.
func (s *Service) Clear(ctx context.Context, me string) error {
	if err := s.FlushPositions(ctx, me); err != nil { // else a pending position would bring the row back
		return err
	}
	if err := s.repo.clear(ctx, me); err != nil {
		return fmt.Errorf("clear history: %w", err)
	}
	return nil
}

// Merge: a signed-out visitor's history on this browser, sent once after signing in. Only published chapters; a row
// is only overwritten by a newer read. Returns how many rows changed.
func (s *Service) Merge(ctx context.Context, me string, b mergeRequest) (int64, error) {
	if len(b.Items) > 200 {
		b.Items = b.Items[:200]
	}
	now := s.now()
	var items []mergeItem
	for _, it := range b.Items {
		at, err := time.Parse(time.RFC3339, it.ReadAt)
		if !httpx.IsUUID(it.ChapterID) || err != nil {
			continue
		}
		if at.After(now) {
			at = now
		}
		items = append(items, mergeItem{it.ChapterID, at, math.Min(math.Max(it.Scroll, 0), 100)})
	}
	if len(items) == 0 {
		return 0, nil
	}
	n, err := s.repo.merge(ctx, me, marshal(items))
	if err != nil {
		return 0, fmt.Errorf("merge history: %w", err)
	}
	return n, nil
}

// PruneHistory keeps the history of each person's 1,000 most recently read stories (run by the nightly reconcile).
func (s *Service) PruneHistory(ctx context.Context) error {
	n, err := s.repo.prune(ctx)
	if err != nil {
		return fmt.Errorf("prune history: %w", err)
	}
	if n > 0 {
		logger.Info(ctx, "history: dropped rows of stories beyond the newest 1000 per person")
	}
	return nil
}
