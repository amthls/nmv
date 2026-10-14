package history

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"nmv/library/internal/platform/logger"
)

// Reading positions: the reader page sends its scroll % every ~15 s, so POST /history only updates memory and the rows
// are written once a minute (one statement), at shutdown, and just before a person's own history is read.
// shortcut: in-process memory instead of Redis (one library instance; a crash loses up to a minute of positions),
// move to Redis when library runs more than one instance.

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

// PendingPositions drains the buffer and returns how many positions were waiting (tests).
func (s *Service) PendingPositions() int { return len(s.pos.take("")) }

// FlushPositions writes the pending rows (user "" = all). On a database error they go back into the buffer.
func (s *Service) FlushPositions(ctx context.Context, user string) error {
	rows := s.pos.take(user)
	if len(rows) == 0 {
		return nil
	}
	body, _ := json.Marshal(rows)
	if err := s.repo.writePositions(ctx, string(body)); err != nil {
		for _, p := range rows {
			s.pos.add(*p)
		}
		return fmt.Errorf("write reading positions: %w", err)
	}
	return nil
}

// FlushLoop writes the buffer every minute and once more when ctx ends (shutdown).
func (s *Service) FlushLoop(ctx context.Context, done chan<- struct{}) {
	defer close(done)
	for {
		select {
		case <-ctx.Done():
			final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := s.FlushPositions(final, ""); err != nil {
				logger.Logf(final, "error", "reading positions lost at shutdown: "+err.Error())
			}
			cancel()
			return
		case <-time.After(time.Minute):
			if err := s.FlushPositions(ctx, ""); err != nil && ctx.Err() == nil {
				logger.Logf(ctx, "warn", "reading positions flush (kept for the next try): "+err.Error())
			}
		}
	}
}
