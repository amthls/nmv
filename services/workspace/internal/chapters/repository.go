package chapters

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/platform/outbox"
)

// Repository is all the SQL of the chapter line. Drafts, tasks and the importer share it: they write revisions in
// their own transactions.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository returns the repository over db.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// LockHead reads the head of chapter id, locked for the rest of tx.
func (r *Repository) LockHead(ctx context.Context, tx pgx.Tx, id string) (Head, error) {
	var h Head
	err := tx.QueryRow(ctx, `SELECT story_id::text, current_version, deleted FROM chapter_heads WHERE chapter_id = $1 FOR UPDATE`, id).
		Scan(&h.StoryID, &h.Version, &h.Deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return h, domain.ErrNotFound
	}
	return h, err
}

// ReadHead reads the head of chapter id (not locked); ErrNotFound when there is none.
func (r *Repository) ReadHead(ctx context.Context, tx pgx.Tx, id string) (Head, error) {
	var h Head
	err := tx.QueryRow(ctx, `SELECT story_id::text, current_version, deleted FROM chapter_heads WHERE chapter_id = $1`, id).
		Scan(&h.StoryID, &h.Version, &h.Deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return h, domain.ErrNotFound
	}
	return h, err
}

// AppendRevision stores version rev.Version (blocks already hashed), moves the head and queues the event.
func (r *Repository) AppendRevision(ctx context.Context, tx pgx.Tx, rev *Revision, hashes []string) error {
	_, err := tx.Exec(ctx, `UPDATE chapter_heads SET current_version = $2, deleted = $3, chapter_number = $4 WHERE chapter_id = $1`,
		rev.ChapterID, rev.Version, rev.Deleted, rev.Meta.ChapterNumber)
	if domain.IsNumberTaken(err) {
		return domain.ErrNumberTaken
	}
	if err != nil {
		return err
	}
	meta, _ := json.Marshal(rev.Meta)
	err = tx.QueryRow(ctx, `INSERT INTO chapter_revisions (chapter_id, version, story_id, meta, blocks, deleted, source, based_on, author_id, author_name, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW())) RETURNING created_at`,
		rev.ChapterID, rev.Version, rev.StoryID, meta, hashes, rev.Deleted, rev.Source, rev.BasedOn, rev.AuthorID, rev.AuthorName,
		nullTime(rev.CreatedAt)).Scan(&rev.CreatedAt)
	if err != nil {
		return err
	}
	return outbox.Enqueue(ctx, tx, "workspace.revision.merged", rev.Version, rev)
}

func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// CreateChapter makes v1 of a new chapter (id given by the importer; otherwise a new UUID).
func (r *Repository) CreateChapter(ctx context.Context, tx pgx.Tx, rev *Revision) error {
	if rev.ChapterID == "" {
		rev.ChapterID = ids.New()
	}
	rev.Version = 1
	// current_version 0 until AppendRevision stores v1 (revisions reference the head)
	_, err := tx.Exec(ctx, `INSERT INTO chapter_heads (chapter_id, story_id, chapter_number, current_version, deleted) VALUES ($1, $2, $3, 0, FALSE)`,
		rev.ChapterID, rev.StoryID, rev.Meta.ChapterNumber)
	if domain.IsNumberTaken(err) {
		return domain.ErrNumberTaken
	}
	if err != nil {
		return err
	}
	hashes, err := blocks.Store(ctx, tx, rev.Blocks)
	if err != nil {
		return err
	}
	return r.AppendRevision(ctx, tx, rev, hashes)
}

// LoadRevision reads one stored version with its blocks.
func (r *Repository) LoadRevision(ctx context.Context, tx pgx.Tx, id string, version int) (*Revision, []string, error) {
	rev := &Revision{ChapterID: id, Version: version}
	var meta []byte
	var hashes []string
	err := tx.QueryRow(ctx, `SELECT story_id::text, meta, blocks, deleted, source, based_on, author_id::text, author_name, created_at
		FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`, id, version).
		Scan(&rev.StoryID, &meta, &hashes, &rev.Deleted, &rev.Source, &rev.BasedOn, &rev.AuthorID, &rev.AuthorName, &rev.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if err := json.Unmarshal(meta, &rev.Meta); err != nil {
		return nil, nil, err
	}
	if rev.Blocks, err = blocks.Load(ctx, tx, hashes); err != nil {
		return nil, nil, err
	}
	return rev, hashes, nil
}

// RevisionContent reads the meta and block hashes of one stored version (no blocks).
func (r *Repository) RevisionContent(ctx context.Context, tx pgx.Tx, id string, version int) (Meta, []string, error) {
	var raw []byte
	var hashes []string
	if err := tx.QueryRow(ctx, `SELECT meta, blocks FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`, id, version).Scan(&raw, &hashes); err != nil {
		return Meta{}, nil, err
	}
	var meta Meta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return Meta{}, nil, err
	}
	return meta, hashes, nil
}

// CopyVersion appends a version that equals `from` (rewind, restore) or the current one marked deleted (delete).
func (r *Repository) CopyVersion(ctx context.Context, tx pgx.Tx, id string, h Head, from int, source string, deleted bool, authorID, authorName *string) (*Revision, error) {
	rev, hashes, err := r.LoadRevision(ctx, tx, id, from)
	if err != nil {
		return nil, err
	}
	based := from
	rev.Version, rev.Deleted, rev.Source, rev.BasedOn = h.Version+1, deleted, source, &based
	rev.AuthorID, rev.AuthorName, rev.CreatedAt = authorID, authorName, time.Time{}
	if deleted {
		rev.Blocks = []blocks.Block{} // the reader copy only needs to know it is gone; history keeps the content
	}
	if err := r.AppendRevision(ctx, tx, rev, hashes); err != nil {
		return nil, err
	}
	return rev, nil
}

// CurrentVersion is the current version number of chapter id.
func (r *Repository) CurrentVersion(ctx context.Context, tx pgx.Tx, id string) (int, error) {
	var v int
	if err := tx.QueryRow(ctx, `SELECT current_version FROM chapter_heads WHERE chapter_id = $1`, id).Scan(&v); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, domain.ErrNotFound
		}
		return 0, err
	}
	return v, nil
}

// StoryOf is the story chapter id belongs to; ErrNotFound when the chapter is unknown.
func (r *Repository) StoryOf(ctx context.Context, id string) (string, error) {
	var story string
	err := r.db.QueryRow(ctx, `SELECT story_id::text FROM chapter_heads WHERE chapter_id = $1`, id).Scan(&story)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return story, err
}

// List is the history of chapter id, newest first.
func (r *Repository) List(ctx context.Context, id string) ([]RevisionItem, error) {
	rows, err := r.db.Query(ctx, `SELECT version, source, deleted, based_on, author_id::text, author_name, created_at,
			meta->>'title', (meta->>'chapter_number')::numeric::float8, cardinality(blocks)
		FROM chapter_revisions WHERE chapter_id = $1 ORDER BY version DESC`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RevisionItem, error) {
		var x RevisionItem
		return x, row.Scan(&x.Version, &x.Source, &x.Deleted, &x.BasedOn, &x.AuthorID, &x.AuthorName, &x.CreatedAt, &x.Title, &x.Number, &x.Blocks)
	})
}

// RewindTarget: whether version `to` is a deletion, and the chapter number it carries; ErrNotFound when it does not exist.
func (r *Repository) RewindTarget(ctx context.Context, tx pgx.Tx, id string, to int) (deleted bool, number float64, err error) {
	err = tx.QueryRow(ctx, `SELECT deleted, (meta->>'chapter_number')::numeric::float8 FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`,
		id, to).Scan(&deleted, &number)
	if errors.Is(err, pgx.ErrNoRows) {
		err = domain.ErrNotFound
	}
	return deleted, number, err
}

// Heads lists chapter id and current version of one chapter (id) or all of them.
func (r *Repository) Heads(ctx context.Context, id string) ([]HeadRow, error) {
	rows, err := r.db.Query(ctx, `SELECT chapter_id::text, current_version FROM chapter_heads WHERE $1 = '' OR chapter_id::text = $1 ORDER BY chapter_id`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[HeadRow])
}

// HeadRow is a chapter id and its current version.
type HeadRow struct {
	ID      string
	Version int
}

// Stats: totals the backend reconcile job compares with ws_chapter_versions, and the outbox backlog.
func (r *Repository) Stats(ctx context.Context) (chapters, versionSum, pending int64, oldest float64, err error) {
	err = r.db.QueryRow(ctx, `SELECT (SELECT count(*) FROM chapter_heads), (SELECT COALESCE(sum(current_version), 0) FROM chapter_heads),
		(SELECT count(*) FROM outbox WHERE published_at IS NULL),
		(SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - min(created_at)), 0) FROM outbox WHERE published_at IS NULL)`).
		Scan(&chapters, &versionSum, &pending, &oldest)
	return
}

// HasHead: whether chapter id is already known (the importer skips those).
func (r *Repository) HasHead(ctx context.Context, tx pgx.Tx, id string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM chapter_heads WHERE chapter_id = $1)`, id).Scan(&exists)
	return exists, err
}

// DropImportEvent removes the event CreateChapter queued for an imported chapter (the catalog already shows it).
func (r *Repository) DropImportEvent(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `DELETE FROM outbox WHERE published_at IS NULL AND payload->'data'->>'chapter_id' = $1 AND payload->'data'->>'source' = 'import'`, id)
	return err
}
