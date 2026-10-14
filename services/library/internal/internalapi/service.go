// Package internalapi: other services' calls (X-Internal-Auth with INTERNAL_KEY_LIBRARY): the backend (profile, story
// page, AL- codes, deleted stories/chapters, recommendations) and messaging (who follows a story).
package internalapi

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nmv/library/internal/platform/httpx"
)

// PositionFlusher writes the buffered reading positions (user "" = all) before a person's numbers are read.
type PositionFlusher interface {
	FlushPositions(ctx context.Context, user string) error
}

// Service answers the internal calls.
type Service struct {
	repo  *Repository
	flush PositionFlusher
}

// NewService wires the internal API service.
func NewService(repo *Repository, flush PositionFlusher) *Service {
	return &Service{repo: repo, flush: flush}
}

// recoExportQueries: what the recommender imports once, by key.
var recoExportQueries = map[string]string{
	"reads": `SELECT user_id, story_id, chapter_id, read_at FROM reading_history
			WHERE read_at > NOW() - make_interval(days => $1)`,
	"favorites": `SELECT user_id, story_id, created_at FROM user_favorites WHERE $1 > 0`,
	"albums":    `SELECT a.user_id, x.album_id, x.story_id, x.added_at FROM album_stories x JOIN albums a ON a.id = x.album_id WHERE $1 > 0`,
	"bookmarks": `SELECT id, user_id, story_id, created_at FROM bookmarks WHERE $1 > 0`,
}

// Purge: the backend deleted these. Their reading history, bookmarks, follows and album places go too (the old
// foreign keys' ON DELETE CASCADE), and the copies.
func (s *Service) Purge(ctx context.Context, b purgeRequest) error {
	for _, id := range append(append([]string{}, b.Stories...), b.Chapters...) {
		if !httpx.IsUUID(id) {
			return httpx.Bad("ids")
		}
	}
	if err := s.repo.purge(ctx, b.Stories, b.Chapters); err != nil {
		return fmt.Errorf("purge: %w", err)
	}
	return nil
}

// UserOverview: the account page's library part (numbers, last reads, albums, genres read most).
func (s *Service) UserOverview(ctx context.Context, id string) (map[string]any, error) {
	if !httpx.IsUUID(id) {
		return nil, httpx.NotFound("no such user")
	}
	if err := s.flush.FlushPositions(ctx, id); err != nil {
		return nil, err
	}
	stats, err := s.repo.overviewStats(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("overview stats: %w", err)
	}
	recent, err := s.repo.overviewRecent(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("overview recent reads: %w", err)
	}
	albums, err := s.repo.overviewAlbums(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("overview albums: %w", err)
	}
	tags, err := s.repo.overviewTags(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("overview tags: %w", err)
	}
	return map[string]any{"stats": stats, "recent_reads": recent, "albums": albums, "tags": tags}, nil
}

// Favorite -> {is_favorite, category} (the story page).
func (s *Service) Favorite(ctx context.Context, user, story string) (map[string]any, error) {
	category, found, err := s.repo.favorite(ctx, user, story)
	if err != nil {
		return nil, fmt.Errorf("favorite status: %w", err)
	}
	return map[string]any{"is_favorite": found, "category": category}, nil
}

// AlbumPath -> {path} of an AL- code: private albums only for their owner (a code carries no key).
func (s *Service) AlbumPath(ctx context.Context, no int64, me string) (map[string]any, error) {
	path, err := s.repo.albumPath(ctx, no, me)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("no such album")
	}
	if err != nil {
		return nil, fmt.Errorf("album code: %w", err)
	}
	return map[string]any{"path": path}, nil
}

// Followers -> [user_id] by id: who wants new-chapter notifications (messaging).
func (s *Service) Followers(ctx context.Context, story, after string, limit int) ([]string, error) {
	if !httpx.IsUUID(story) {
		return nil, httpx.NotFound("no such story")
	}
	if !httpx.IsUUID(after) {
		after = "00000000-0000-0000-0000-000000000000"
	}
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	ids, err := s.repo.followers(ctx, story, after, limit)
	if err != nil {
		return nil, fmt.Errorf("followers: %w", err)
	}
	return ids, nil
}

// RecoExport: the recommender's one-time import (python -m rec import-legacy); afterwards it keeps its copy from the
// library.* events (migrations/002_outbox.sql). Reads of the last `days` days, one row per chapter.
func (s *Service) RecoExport(ctx context.Context, days int) (map[string]any, error) {
	if days < 1 || days > 3650 {
		days = 180
	}
	out := map[string]any{}
	for key, q := range recoExportQueries {
		rows, err := s.repo.recoExport(ctx, key, q, days)
		if err != nil {
			return nil, fmt.Errorf("reco export %s: %w", key, err)
		}
		out[key] = rows
	}
	return out, nil
}

// RecoUser: one reader's history for the recommender's live picks: every story read, reads of the last 60 days, and
// stories started but not finished ("continue reading").
func (s *Service) RecoUser(ctx context.Context, id string) (map[string]any, error) {
	if !httpx.IsUUID(id) {
		return nil, httpx.NotFound("no such user")
	}
	read, err := s.repo.recoReadStories(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("reco read stories: %w", err)
	}
	recent, err := s.repo.recoRecent(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("reco recent reads: %w", err)
	}
	cont, err := s.repo.recoContinue(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("reco continue reading: %w", err)
	}
	return map[string]any{"read_story_ids": read, "recent": recent, "continue": cont}, nil
}
