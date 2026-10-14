// Package sync keeps the read copies of the backend's stories and chapters.
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"nmv/library/internal/platform/catalog"
	"nmv/library/internal/platform/logger"
)

// HistoryPruner trims old reading history (run by the nightly reconcile).
type HistoryPruner interface {
	PruneHistory(ctx context.Context) error
}

// Service copies stories and chapters from the backend.
type Service struct {
	repo   *Repository
	cat    *catalog.Client
	pruner HistoryPruner
}

// NewService wires the copy service.
func NewService(repo *Repository, cat *catalog.Client, pruner HistoryPruner) *Service {
	return &Service{repo: repo, cat: cat, pruner: pruner}
}

// SyncChapter copies one chapter and its story right now. The cursor sync skips rows changed in the last 2 s, so a
// chapter published a moment ago would not be found by SyncOnce yet.
func (s *Service) SyncChapter(ctx context.Context, chapterID string) error {
	storyID := ""
	for i, id := range []*string{&chapterID, &storyID} {
		t := tables[1-i] // chapters first, then the story it belongs to
		var page []json.RawMessage
		status, err := s.cat.Call(ctx, "GET", t.path+"?ids="+url.QueryEscape(*id), nil, &page)
		if err == nil && status != 200 {
			err = fmt.Errorf("backend %s: HTTP %d", t.path, status)
		}
		if err != nil || len(page) == 0 {
			return err
		}
		if i == 0 {
			var c struct {
				StoryID string `json:"story_id"`
			}
			json.Unmarshal(page[0], &c)
			storyID = c.StoryID
		}
		body, _ := json.Marshal(page)
		if err := s.repo.upsertPage(ctx, t, string(body)); err != nil {
			return fmt.Errorf("copy %s: %w", t.name, err)
		}
	}
	return nil
}

// SyncOnce copies every row changed since the cursor of each table.
func (s *Service) SyncOnce(ctx context.Context) error {
	for _, t := range tables {
		for {
			since, after, err := s.repo.cursor(ctx, t.name)
			if err != nil {
				return fmt.Errorf("cursor %s: %w", t.name, err)
			}
			var page []json.RawMessage
			q := url.Values{"since": {since}, "after": {after}, "limit": {fmt.Sprint(syncPage)}}
			status, err := s.cat.Call(ctx, "GET", t.path+"?"+q.Encode(), nil, &page)
			if err == nil && status != 200 {
				err = fmt.Errorf("backend %s: HTTP %d", t.path, status)
			}
			if err != nil {
				return err
			}
			if len(page) == 0 {
				break
			}
			var last struct {
				ID        string `json:"id"`
				UpdatedAt string `json:"updated_at"`
			}
			json.Unmarshal(page[len(page)-1], &last)
			body, _ := json.Marshal(page)
			if err := s.repo.savePage(ctx, t, string(body), last.UpdatedAt, last.ID); err != nil {
				return fmt.Errorf("save %s page: %w", t.name, err)
			}
			if len(page) < syncPage {
				break
			}
		}
	}
	return nil
}

// Reconcile drops copies of stories/chapters the backend no longer has (a purge call that never arrived) and restarts the
// cursors, so the next sync copies everything again (catches an update a long transaction committed behind the cursor).
func (s *Service) Reconcile(ctx context.Context) error {
	if err := s.repo.resetCursors(ctx); err != nil {
		return fmt.Errorf("reset cursors: %w", err)
	}
	for _, t := range []struct{ kind, table string }{{"story", "ext_stories"}, {"chapter", "ext_chapters"}} {
		var ids []string
		status, err := s.cat.Call(ctx, "GET", "/internal/library/ids?type="+t.kind, nil, &ids)
		if err == nil && status != 200 {
			err = fmt.Errorf("backend ids: HTTP %d", status)
		}
		if err != nil {
			return err
		}
		n, err := s.repo.dropMissing(ctx, t.table, ids)
		if err != nil {
			return fmt.Errorf("drop %s copies: %w", t.kind, err)
		}
		if n > 0 {
			logger.Info(ctx, fmt.Sprintf("reconcile: dropped %d %s copies", n, t.kind))
		}
	}
	return s.pruner.PruneHistory(ctx)
}

// Loop syncs every 30 s and reconciles once a day (the first time 5 minutes after start) until ctx ends.
func (s *Service) Loop(ctx context.Context) {
	nextReconcile := time.Now().Add(5 * time.Minute)
	for ctx.Err() == nil {
		if err := s.SyncOnce(ctx); err != nil && ctx.Err() == nil {
			logger.Logf(ctx, "warn", "story sync: "+err.Error())
		}
		if time.Now().After(nextReconcile) {
			if err := s.Reconcile(ctx); err != nil && ctx.Err() == nil {
				logger.Logf(ctx, "warn", "story reconcile: "+err.Error())
			}
			nextReconcile = time.Now().Add(24 * time.Hour)
		}
		select {
		case <-ctx.Done():
		case <-time.After(30 * time.Second):
		}
	}
}
