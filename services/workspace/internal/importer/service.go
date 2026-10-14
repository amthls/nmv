// Package importer makes v1 of every chapter the catalog already has (run once by scripts/migrate.sh and launch.py:
// `workspace import`).
package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/chapters"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/logger"
)

// Service reads the backend's chapter export and stores what workspace does not know yet.
type Service struct {
	db       *pgxpool.Pool
	chapters *chapters.Repository
	backend  *catalog.Client
}

// NewService wires the service.
func NewService(db *pgxpool.Pool, ch *chapters.Repository, backend *catalog.Client) *Service {
	return &Service{db: db, chapters: ch, backend: backend}
}

type exported struct {
	ID         string         `json:"id"`
	StoryID    string         `json:"story_id"`
	Meta       blocks.Meta    `json:"meta"`
	Blocks     []blocks.Block `json:"blocks"`
	AuthorID   *string        `json:"author_id"`
	AuthorName *string        `json:"author_name"`
	CreatedAt  time.Time      `json:"created_at"`
}

// Import makes v1 (source "import") of every catalog chapter workspace does not know yet, paging through
// GET backend /internal/chapters/export. Safe to re-run: chapters with a head are skipped. Imports publish no
// event (the reading copy already has them).
func (s *Service) Import(ctx context.Context) error {
	after, added, seen := "", 0, 0
	for {
		res, err := s.backend.ExportPage(ctx, after)
		if err != nil {
			return err
		}
		var page struct {
			Data []exported `json:"data"`
		}
		err = json.NewDecoder(res.Body).Decode(&page)
		res.Body.Close()
		if res.StatusCode != 200 || err != nil {
			return fmt.Errorf("backend export: %s %v", res.Status, err)
		}
		if len(page.Data) == 0 {
			break
		}
		for _, c := range page.Data {
			seen++
			after = c.ID
			err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
				exists, err := s.chapters.HasHead(ctx, tx, c.ID)
				if err != nil || exists {
					return err
				}
				rev := &chapters.Revision{ChapterID: c.ID, StoryID: c.StoryID, Source: "import", Meta: c.Meta, Blocks: c.Blocks,
					AuthorID: c.AuthorID, AuthorName: c.AuthorName, CreatedAt: c.CreatedAt}
				if err := s.chapters.CreateChapter(ctx, tx, rev); err != nil {
					return err
				}
				added++
				// The catalog already shows imported chapters: drop the event CreateChapter queued
				return s.chapters.DropImportEvent(ctx, tx, c.ID)
			})
			if err != nil {
				return fmt.Errorf("chapter %s: %w", c.ID, err)
			}
		}
	}
	logger.Info(ctx, fmt.Sprintf("import: %d/%d chapters added as v1", added, seen))
	return nil
}
