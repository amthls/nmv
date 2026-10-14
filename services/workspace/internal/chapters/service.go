package chapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/platform/logger"
	"nmv/workspace/internal/platform/outbox"
)

// Service is the business of the chapter line: every change is one transaction that moves the head, stores the
// revision and queues the event.
type Service struct {
	db   *pgxpool.Pool
	repo *Repository
}

// NewService returns the service over db and repo.
func NewService(db *pgxpool.Pool, repo *Repository) *Service { return &Service{db: db, repo: repo} }

// Create makes v1 of a new chapter (the backend validated and sanitized the content).
func (s *Service) Create(ctx context.Context, b WriteBody) (*Revision, error) {
	rev := &Revision{StoryID: b.StoryID, Source: "create", Meta: b.Meta, Blocks: b.Blocks, AuthorID: b.AuthorID, AuthorName: b.AuthorName}
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error { return s.repo.CreateChapter(ctx, tx, rev) })
	if err != nil {
		return nil, err
	}
	return rev, nil
}

// Edit appends the next version of chapter id; b.ExpectedVersion (when not 0) stops two editors overwriting each other.
func (s *Service) Edit(ctx context.Context, id string, b WriteBody) (*Revision, error) {
	var rev *Revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := s.repo.LockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		if h.Deleted {
			return domain.ErrDeleted
		}
		if b.ExpectedVersion != 0 && b.ExpectedVersion != h.Version {
			return domain.ErrConflict
		}
		hashes, err := blocks.Store(ctx, tx, b.Blocks)
		if err != nil {
			return err
		}
		based := h.Version
		rev = &Revision{ChapterID: id, StoryID: h.StoryID, Version: h.Version + 1, Source: "edit", BasedOn: &based,
			Meta: b.Meta, Blocks: b.Blocks, AuthorID: b.AuthorID, AuthorName: b.AuthorName}
		if err := s.repo.AppendRevision(ctx, tx, rev, hashes); err != nil {
			return err
		}
		rev.Blocks, err = blocks.Load(ctx, tx, hashes) // positional ids as stored
		return err
	})
	return rev, err
}

// Delete appends a version marked deleted (history keeps the content).
func (s *Service) Delete(ctx context.Context, id string, authorID, authorName *string) (*Revision, error) {
	var rev *Revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := s.repo.LockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		if h.Deleted {
			return domain.ErrDeleted
		}
		rev, err = s.repo.CopyVersion(ctx, tx, id, h, h.Version, "delete", true, authorID, authorName)
		return err
	})
	return rev, err
}

// Current is the official version of chapter id.
func (s *Service) Current(ctx context.Context, id string) (*Revision, error) {
	var rev *Revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		v, err := s.repo.CurrentVersion(ctx, tx, id)
		if err != nil {
			return err
		}
		rev, _, err = s.repo.LoadRevision(ctx, tx, id, v)
		return err
	})
	return rev, err
}

// StoryOf is the story chapter id belongs to (ErrNotFound when unknown).
func (s *Service) StoryOf(ctx context.Context, id string) (string, error) {
	return s.repo.StoryOf(ctx, id)
}

// List is the history of chapter id, newest first.
func (s *Service) List(ctx context.Context, id string) ([]RevisionItem, error) {
	return s.repo.List(ctx, id)
}

// Revision is one stored version with its blocks.
func (s *Service) Revision(ctx context.Context, id string, version int) (*Revision, error) {
	var rev *Revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) { rev, _, err = s.repo.LoadRevision(ctx, tx, id, version); return })
	return rev, err
}

// Compare: block-level diff (by hash) of two versions plus the data of every block involved.
func (s *Service) Compare(ctx context.Context, id string, from, to int) (map[string]any, error) {
	var out map[string]any
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		a, ha, err := s.repo.LoadRevision(ctx, tx, id, from)
		if err != nil {
			return err
		}
		b, hb, err := s.repo.LoadRevision(ctx, tx, id, to)
		if err != nil {
			return err
		}
		data, err := blocks.Data(ctx, tx, append(append([]string{}, ha...), hb...))
		if err != nil {
			return err
		}
		bl := map[string]json.RawMessage{}
		for h, d := range data {
			bl[h] = d
		}
		out = map[string]any{"from": revisionHeader(a), "to": revisionHeader(b), "ops": blocks.Diff(ha, hb), "blocks": bl}
		return nil
	})
	return out, err
}

func revisionHeader(r *Revision) map[string]any {
	return map[string]any{"version": r.Version, "meta": r.Meta, "deleted": r.Deleted, "source": r.Source,
		"author_name": r.AuthorName, "created_at": r.CreatedAt}
}

// Rewind brings version `to` back as a new one (also undeletes). number is the chapter number the old version carries
// (for the "already taken" message).
func (s *Service) Rewind(ctx context.Context, id string, to int, user, name string) (rev *Revision, number float64, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := s.repo.LockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		targetDeleted, n, err := s.repo.RewindTarget(ctx, tx, id, to)
		number = n
		if err != nil {
			return err
		}
		if targetDeleted {
			return fmt.Errorf("%w: target is a deletion", domain.ErrNotFound)
		}
		source := "rewind"
		if h.Deleted {
			source = "restore"
		}
		rev, err = s.repo.CopyVersion(ctx, tx, id, h, to, source, false, &user, &name)
		return err
	})
	return rev, number, err
}

// Stats: totals the backend's reconcile job compares with ws_chapter_versions, and the outbox backlog.
func (s *Service) Stats(ctx context.Context) (map[string]any, error) {
	chapters, versionSum, pending, oldest, err := s.repo.Stats(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"chapters": chapters, "version_sum": versionSum, "outbox_pending": pending, "outbox_oldest_seconds": int64(oldest)}, nil
}

// Republish queues workspace.revision.merged with the current version of one chapter (id) or all of them, so a
// missing or drifted reading copy is rebuilt; the backend ignores versions it already has.
func (s *Service) Republish(ctx context.Context, id string) error {
	heads, err := s.repo.Heads(ctx, id)
	if err != nil {
		return err
	}
	for _, h := range heads {
		err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
			rev, _, err := s.repo.LoadRevision(ctx, tx, h.ID, h.Version)
			if err != nil {
				return err
			}
			return outbox.Enqueue(ctx, tx, "workspace.revision.merged", rev.Version, rev)
		})
		if err != nil {
			return fmt.Errorf("chapter %s: %w", h.ID, err)
		}
	}
	logger.Info(ctx, fmt.Sprintf("republish: %d chapter events queued", len(heads)))
	return nil
}
