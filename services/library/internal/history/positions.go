package main

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"sync"
	"time"
)

// Reading positions: the reader page sends its scroll % every ~15 s, so POST /history only updates memory and the rows
// are written once a minute (one statement), at shutdown, and just before a person's own history is read.
// shortcut: in-process memory instead of Redis (one library instance; a crash loses up to a minute of positions),
// move to Redis when library runs more than one instance.

type pendingRead struct {
	StoryID   string    `json:"story_id"`
	ChapterID string    `json:"chapter_id"`
	Scroll    float64   `json:"scroll_position"`
	Page      int       `json:"page_number"`
	Seconds   int       `json:"time_spent_seconds"`
	ReadAt    time.Time `json:"read_at"`
	UserID    string    `json:"user_id"`
}

type positionBuffer struct {
	mu     sync.Mutex
	byUser map[string]map[string]*pendingRead // user -> chapter -> latest position
}

// add records a position (seconds add up) and returns the merged pending row.
func (b *positionBuffer) add(p pendingRead) pendingRead {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.byUser == nil {
		b.byUser = map[string]map[string]*pendingRead{}
	}
	chapters := b.byUser[p.UserID]
	if chapters == nil {
		chapters = map[string]*pendingRead{}
		b.byUser[p.UserID] = chapters
	}
	if old := chapters[p.ChapterID]; old != nil {
		p.Seconds += old.Seconds
	}
	chapters[p.ChapterID] = &p
	return p
}

// take removes and returns the pending rows: of one user, or of everyone when user is "".
func (b *positionBuffer) take(user string) []*pendingRead {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []*pendingRead
	for u, chapters := range b.byUser {
		if user != "" && u != user {
			continue
		}
		for _, p := range chapters {
			out = append(out, p)
		}
		delete(b.byUser, u)
	}
	return out
}

// flushPositions writes the pending rows (user "" = all). On a database error they go back into the buffer.
func (s *server) flushPositions(ctx context.Context, user string) error {
	rows := s.pos.take(user)
	if len(rows) == 0 {
		return nil
	}
	body, _ := json.Marshal(rows)
	_, err := s.db.Exec(ctx, `
		INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
		SELECT x.user_id, x.story_id, x.chapter_id, x.scroll_position, x.page_number, x.read_at, x.time_spent_seconds
		FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid, story_id uuid, chapter_id uuid, scroll_position real, page_number int,
		  read_at timestamptz, time_spent_seconds int)
		JOIN ext_chapters c ON c.id = x.chapter_id -- deleted meanwhile: dropped
		ON CONFLICT (user_id, chapter_id) DO UPDATE
		SET scroll_position = EXCLUDED.scroll_position, page_number = EXCLUDED.page_number, story_id = EXCLUDED.story_id,
		    read_at = GREATEST(reading_history.read_at, EXCLUDED.read_at),
		    time_spent_seconds = reading_history.time_spent_seconds + EXCLUDED.time_spent_seconds`, string(body))
	if err != nil {
		for _, p := range rows {
			s.pos.add(*p)
		}
	}
	return err
}

// flushLoop writes the buffer every minute and once more when ctx ends (shutdown).
func (s *server) flushLoop(ctx context.Context, done chan<- struct{}) {
	defer close(done)
	for {
		select {
		case <-ctx.Done():
			final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := s.flushPositions(final, ""); err != nil {
				logf(final, "error", "reading positions lost at shutdown: "+err.Error())
			}
			cancel()
			return
		case <-time.After(time.Minute):
			if err := s.flushPositions(ctx, ""); err != nil && ctx.Err() == nil {
				logf(ctx, "warn", "reading positions flush (kept for the next try): "+err.Error())
			}
		}
	}
}

// POST /history/merge {items: [{chapter_id, read_at, scroll_position}]}: a signed-out visitor's history on this browser,
// sent once after signing in. Only published chapters; a row is only overwritten by a newer read.
func (s *server) handleMergeHistory(w http.ResponseWriter, r *http.Request, me string) error {
	var body struct {
		Items []struct {
			ChapterID string  `json:"chapter_id"`
			ReadAt    string  `json:"read_at"`
			Scroll    float64 `json:"scroll_position"`
		} `json:"items"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	if len(body.Items) > 200 {
		body.Items = body.Items[:200]
	}
	type item struct {
		ChapterID string    `json:"chapter_id"`
		ReadAt    time.Time `json:"read_at"`
		Scroll    float64   `json:"scroll_position"`
	}
	now := s.now()
	var items []item
	for _, it := range body.Items {
		at, err := time.Parse(time.RFC3339, it.ReadAt)
		if !isUUID(it.ChapterID) || err != nil {
			continue
		}
		if at.After(now) {
			at = now
		}
		items = append(items, item{it.ChapterID, at, math.Min(math.Max(it.Scroll, 0), 100)})
	}
	n := int64(0)
	if len(items) > 0 {
		js, _ := json.Marshal(items)
		tag, err := s.db.Exec(r.Context(), `
			INSERT INTO reading_history (user_id, story_id, chapter_id, scroll_position, page_number, read_at, time_spent_seconds)
			SELECT $1::uuid, c.story_id, c.id, x.scroll_position, 1, x.read_at, 0
			FROM jsonb_to_recordset($2::jsonb) AS x(chapter_id uuid, read_at timestamptz, scroll_position real)
			JOIN ext_chapters c ON c.id = x.chapter_id AND c.is_published
			ON CONFLICT (user_id, chapter_id) DO UPDATE
			SET scroll_position = EXCLUDED.scroll_position, read_at = EXCLUDED.read_at
			WHERE reading_history.read_at < EXCLUDED.read_at`, me, string(js))
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"merged": n}})
	return nil
}

// pruneHistory keeps the history of each person's 1,000 most recently read stories (run by the nightly reconcile).
func (s *server) pruneHistory(ctx context.Context) error {
	tag, err := s.db.Exec(ctx, `
		DELETE FROM reading_history h USING (
		  SELECT user_id, story_id FROM (
		    SELECT user_id, story_id, row_number() OVER (PARTITION BY user_id ORDER BY max(read_at) DESC) AS n
		    FROM reading_history GROUP BY user_id, story_id) ranked
		  WHERE n > 1000) old
		WHERE h.user_id = old.user_id AND h.story_id = old.story_id`)
	if err == nil && tag.RowsAffected() > 0 {
		logInfo(ctx, "history: dropped rows of stories beyond the newest 1000 per person")
	}
	return err
}
