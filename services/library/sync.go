package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

// Read copies of the backend's stories and chapters (ext_stories, ext_chapters). Every 30 s library asks the backend for
// rows changed since its cursor ((updated_at, id) of the last row taken; every update bumps updated_at by trigger), and
// once a day it drops copies whose row is gone. Deletions also come straight away through POST /internal/purge.
// shortcut: polling instead of catalog events (the backend has no outbox yet); change at stage I.

const syncPage = 500

var syncTables = []struct {
	name, path, upsert string
}{
	{"stories", "/internal/library/stories", `
		INSERT INTO ext_stories (id, title, slug, cover_image_url, author_name, story_type, status, approval_status, total_chapters,
		  total_views, total_favorites, group_name, tags, updated_at, synced_at)
		SELECT id, title, slug, cover_image_url, author_name, story_type, status, approval_status, total_chapters,
		  total_views, total_favorites, group_name, COALESCE(tags, '[]'), updated_at, NOW()
		FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, title text, slug text, cover_image_url text, author_name text, story_type text,
		  status text, approval_status text, total_chapters int, total_views bigint, total_favorites bigint, group_name text, tags jsonb,
		  updated_at timestamptz)
		ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, cover_image_url = EXCLUDED.cover_image_url,
		  author_name = EXCLUDED.author_name, story_type = EXCLUDED.story_type, status = EXCLUDED.status,
		  approval_status = EXCLUDED.approval_status, total_chapters = EXCLUDED.total_chapters, total_views = EXCLUDED.total_views,
		  total_favorites = EXCLUDED.total_favorites, group_name = EXCLUDED.group_name, tags = EXCLUDED.tags,
		  updated_at = EXCLUDED.updated_at, synced_at = NOW()`},
	{"chapters", "/internal/library/chapters", `
		INSERT INTO ext_chapters (id, story_id, title, slug, chapter_number, is_published, updated_at, synced_at)
		SELECT id, story_id, title, slug, chapter_number, is_published, updated_at, NOW()
		FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, story_id uuid, title text, slug text, chapter_number numeric,
		  is_published boolean, updated_at timestamptz)
		ON CONFLICT (id) DO UPDATE SET story_id = EXCLUDED.story_id, title = EXCLUDED.title, slug = EXCLUDED.slug,
		  chapter_number = EXCLUDED.chapter_number, is_published = EXCLUDED.is_published, updated_at = EXCLUDED.updated_at,
		  synced_at = NOW()`},
}

// syncChapter copies one chapter and its story right now. The cursor sync skips rows changed in the last 2 s, so a
// chapter published a moment ago would not be found by syncOnce yet.
func (s *server) syncChapter(ctx context.Context, chapterID string) error {
	storyID := ""
	for i, id := range []*string{&chapterID, &storyID} {
		t := syncTables[1-i] // chapters first, then the story it belongs to
		var page []json.RawMessage
		status, err := s.be.call(ctx, "GET", t.path+"?ids="+url.QueryEscape(*id), nil, &page)
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
		if _, err := s.db.Exec(ctx, t.upsert, string(body)); err != nil {
			return err
		}
	}
	return nil
}

// syncOnce copies every row changed since the cursor of each table. Returns how many came.
func (s *server) syncOnce(ctx context.Context) error {
	for _, t := range syncTables {
		for {
			var since, after string
			err := s.db.QueryRow(ctx, `SELECT last_ts::text, last_id::text FROM sync_state WHERE name = $1`, t.name).Scan(&since, &after)
			if err == pgx.ErrNoRows {
				since, after = "1970-01-01T00:00:00Z", "00000000-0000-0000-0000-000000000000"
			} else if err != nil {
				return err
			}
			var page []json.RawMessage
			q := url.Values{"since": {since}, "after": {after}, "limit": {fmt.Sprint(syncPage)}}
			status, err := s.be.call(ctx, "GET", t.path+"?"+q.Encode(), nil, &page)
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
			err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, t.upsert, string(body)); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `INSERT INTO sync_state (name, last_ts, last_id) VALUES ($1, $2::timestamptz, $3)
					ON CONFLICT (name) DO UPDATE SET last_ts = EXCLUDED.last_ts, last_id = EXCLUDED.last_id`, t.name, last.UpdatedAt, last.ID)
				return err
			})
			if err != nil {
				return err
			}
			if len(page) < syncPage {
				break
			}
		}
	}
	return nil
}

// reconcile drops copies of stories/chapters the backend no longer has (a purge call that never arrived) and restarts the
// cursors, so the next sync copies everything again (catches an update a long transaction committed behind the cursor).
func (s *server) reconcile(ctx context.Context) error {
	if _, err := s.db.Exec(ctx, `DELETE FROM sync_state`); err != nil {
		return err
	}
	for _, t := range []struct{ kind, table string }{{"story", "ext_stories"}, {"chapter", "ext_chapters"}} {
		var ids []string
		status, err := s.be.call(ctx, "GET", "/internal/library/ids?type="+t.kind, nil, &ids)
		if err == nil && status != 200 {
			err = fmt.Errorf("backend ids: HTTP %d", status)
		}
		if err != nil {
			return err
		}
		tag, err := s.db.Exec(ctx, `DELETE FROM `+t.table+` WHERE NOT (id = ANY($1::uuid[]))`, ids)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			logInfo(ctx, fmt.Sprintf("reconcile: dropped %d %s copies", tag.RowsAffected(), t.kind))
		}
	}
	return s.pruneHistory(ctx)
}

func (s *server) syncLoop(ctx context.Context) {
	nextReconcile := time.Now().Add(5 * time.Minute)
	for ctx.Err() == nil {
		if err := s.syncOnce(ctx); err != nil && ctx.Err() == nil {
			logf(ctx, "warn", "story sync: "+err.Error())
		}
		if time.Now().After(nextReconcile) {
			if err := s.reconcile(ctx); err != nil && ctx.Err() == nil {
				logf(ctx, "warn", "story reconcile: "+err.Error())
			}
			nextReconcile = time.Now().Add(24 * time.Hour)
		}
		select {
		case <-ctx.Done():
		case <-time.After(30 * time.Second):
		}
	}
}
