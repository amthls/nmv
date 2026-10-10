package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

// importChapters makes v1 (source "import") of every catalog chapter workspace does not know yet, paging through
// GET backend /internal/chapters/export. Safe to re-run: chapters with a head are skipped. Imports publish no
// event (the reading copy already has them). Run by scripts/migrate.sh and launch.py: `workspace import`.
func (s *server) importChapters(ctx context.Context) error {
	after, added, seen := "", 0, 0
	for {
		req, _ := http.NewRequestWithContext(ctx, "GET", s.cfg.BackendURL+"/internal/chapters/export?limit=100&after="+url.QueryEscape(after), nil)
		req.Header.Set("X-Internal-Auth", internalAuth(s.cfg.HeaderKey, s.now()))
		res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
		if err != nil {
			return err
		}
		var page struct {
			Data []struct {
				ID         string      `json:"id"`
				StoryID    string      `json:"story_id"`
				Meta       chapterMeta `json:"meta"`
				Blocks     []block     `json:"blocks"`
				AuthorID   *string     `json:"author_id"`
				AuthorName *string     `json:"author_name"`
				CreatedAt  time.Time   `json:"created_at"`
			} `json:"data"`
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
				var exists bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chapter_heads WHERE chapter_id = $1)`, c.ID).Scan(&exists); err != nil || exists {
					return err
				}
				rev := &revision{ChapterID: c.ID, StoryID: c.StoryID, Source: "import", Meta: c.Meta, Blocks: c.Blocks,
					AuthorID: c.AuthorID, AuthorName: c.AuthorName, CreatedAt: c.CreatedAt}
				if err := createChapter(ctx, tx, rev); err != nil {
					return err
				}
				added++
				// The catalog already shows imported chapters: drop the event createChapter queued
				_, err := tx.Exec(ctx, `DELETE FROM outbox WHERE published_at IS NULL AND payload->'data'->>'chapter_id' = $1 AND payload->'data'->>'source' = 'import'`, c.ID)
				return err
			})
			if err != nil {
				return fmt.Errorf("chapter %s: %w", c.ID, err)
			}
		}
	}
	logInfo(ctx, fmt.Sprintf("import: %d/%d chapters added as v1", added, seen))
	return nil
}
