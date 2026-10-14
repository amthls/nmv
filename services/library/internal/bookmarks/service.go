// Package bookmarks: line bookmarks, moved from the backend's bookmark.controller.ts with the same JSON.
package bookmarks

import (
	"context"
	"fmt"

	"nmv/library/internal/platform/httpx"
)

// Service holds the bookmark rules.
type Service struct {
	repo *Repository
}

// NewService wires the bookmark service.
func NewService(repo *Repository) *Service { return &Service{repo: repo} }

// List: the person's bookmarks, optionally of one chapter or story.
func (s *Service) List(ctx context.Context, me, chapter, story string) ([]map[string]any, error) {
	if (chapter != "" && !httpx.IsUUID(chapter)) || (story != "" && !httpx.IsUUID(story)) {
		return nil, httpx.Bad("Dữ liệu không hợp lệ.")
	}
	rows, err := s.repo.list(ctx, me, chapter, story)
	if err != nil {
		return nil, fmt.Errorf("list bookmarks: %w", err)
	}
	return rows, nil
}

// Create bookmarks a line; bookmarking a line twice removes it (toggle). removed tells which one happened.
func (s *Service) Create(ctx context.Context, me string, b createRequest) (row map[string]any, removed bool, err error) {
	if b.StoryID == "" || b.ChapterID == "" {
		return nil, false, httpx.Bad("story_id và chapter_id là bắt buộc.")
	}
	if !httpx.IsUUID(b.StoryID) || !httpx.IsUUID(b.ChapterID) {
		return nil, false, httpx.Bad("Dữ liệu không hợp lệ.")
	}
	exists, err := s.repo.chapterInStory(ctx, b.ChapterID, b.StoryID)
	if err != nil {
		return nil, false, fmt.Errorf("check chapter: %w", err)
	}
	if !exists {
		return nil, false, httpx.NotFound("Truyện hoặc chương không tồn tại.")
	}
	if b.LineIndex != nil {
		had, err := s.repo.removeLine(ctx, me, b.ChapterID, *b.LineIndex)
		if err != nil {
			return nil, false, fmt.Errorf("remove line bookmark: %w", err)
		}
		if had {
			return nil, true, nil
		}
	}
	scroll, page, color := 0.0, 1, "default"
	if b.Scroll != nil {
		scroll = httpx.Clamp(*b.Scroll, 0, 100, 0)
	}
	if b.Page != nil && *b.Page > 0 {
		page = *b.Page
	}
	if b.Color != nil && *b.Color != "" {
		color = *b.Color
	}
	if len([]rune(color)) > 7 {
		return nil, false, httpx.Bad("Dữ liệu không hợp lệ.")
	}
	row, err = s.repo.insert(ctx, me, b, scroll, page, color)
	if err != nil {
		return nil, false, fmt.Errorf("create bookmark: %w", err)
	}
	return row, false, nil
}

// Delete removes one bookmark of the person.
func (s *Service) Delete(ctx context.Context, me, id string) error {
	if httpx.IsUUID(id) {
		had, err := s.repo.remove(ctx, id, me)
		if err != nil {
			return fmt.Errorf("delete bookmark: %w", err)
		}
		if had {
			return nil
		}
	}
	return httpx.NotFound("Bookmark không tồn tại hoặc không thuộc về bạn.")
}
