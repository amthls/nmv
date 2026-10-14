package drafts

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/chapters"
	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/tasks"
)

// Service is the business of drafts: each method is one transaction (or a short read).
type Service struct {
	db       *pgxpool.Pool
	now      func() time.Time
	chapters *chapters.Repository
	perms    *catalog.Client
}

// NewService wires the service.
func NewService(db *pgxpool.Pool, now func() time.Time, ch *chapters.Repository, perms *catalog.Client) *Service {
	return &Service{db: db, now: now, chapters: ch, perms: perms}
}

// Get reads draft id without its blocks.
func (s *Service) Get(ctx context.Context, id string) (*Draft, error) {
	var d *Draft
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) { d, _, err = Load(ctx, tx, id, false); return })
	return d, err
}

// Full reads draft id with its blocks.
func (s *Service) Full(ctx context.Context, id string) (*Draft, error) {
	var d *Draft
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var hashes []string
		var err error
		if d, hashes, err = Load(ctx, tx, id, false); err != nil {
			return err
		}
		d.Blocks, err = blocks.Load(ctx, tx, hashes)
		return err
	})
	return d, err
}

// New makes a draft for owner: a copy of chapter's official version (the owner's open draft of that chapter is
// returned instead, reused = true), or a new chapter from meta + blocks.
func (s *Service) New(ctx context.Context, tx pgx.Tx, ownerID string, ownerName *string, storyID string, chapterID *string, newMeta *blocks.Meta, newBlocks []blocks.Block) (string, bool, error) {
	var open int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM chapter_drafts WHERE owner_id = $1 AND status IN ('open', 'submitted', 'offered', 'scheduled')`, ownerID).Scan(&open); err != nil {
		return "", false, err
	}
	var meta blocks.Meta
	var hashes []string
	var base *int
	if chapterID != nil {
		var id string
		err := tx.QueryRow(ctx, `SELECT id::text FROM chapter_drafts WHERE owner_id = $1 AND chapter_id = $2 AND status IN ('open', 'submitted') AND copied_from IS NULL`, ownerID, *chapterID).Scan(&id)
		if err == nil {
			return id, true, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", false, err
		}
		h, err := s.chapters.ReadHead(ctx, tx, *chapterID)
		if err != nil {
			return "", false, err
		}
		if h.StoryID != storyID {
			return "", false, domain.ErrNotFound
		}
		if h.Deleted {
			return "", false, domain.ErrDeleted
		}
		if meta, hashes, err = s.chapters.RevisionContent(ctx, tx, *chapterID, h.Version); err != nil {
			return "", false, err
		}
		base = &h.Version
	} else {
		meta = *newMeta
		var err error
		if hashes, err = blocks.Store(ctx, tx, newBlocks); err != nil {
			return "", false, err
		}
	}
	if open >= maxOpenDrafts {
		return "", false, domain.ErrTooMany
	}
	id := ids.New()
	metaJSON, _ := json.Marshal(meta)
	_, err := tx.Exec(ctx, `INSERT INTO chapter_drafts (id, owner_id, owner_name, story_id, chapter_id, base_version, meta, blocks)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, ownerID, ownerName, storyID, chapterID, base, metaJSON, hashes)
	return id, false, err
}

// Create is New in its own transaction.
func (s *Service) Create(ctx context.Context, b Body) (id string, reused bool, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) {
		id, reused, err = s.New(ctx, tx, b.OwnerID, b.OwnerName, b.StoryID, b.ChapterID, b.Meta, b.Blocks)
		return err
	})
	return id, reused, err
}

// SubmitFinished sends the open draft of a finished job for review and returns what the story feed says about it
// (tasks.Drafts).
func (s *Service) SubmitFinished(ctx context.Context, tx pgx.Tx, draftID, note string) (map[string]any, error) {
	d, hashes, err := Load(ctx, tx, draftID, true)
	if err != nil {
		return nil, err
	}
	if d.Status == "open" {
		if err := SubmitRound(ctx, tx, d, hashes, note); err != nil {
			return nil, err
		}
	}
	return Detail(d), nil
}

// SubmitRound freezes the draft as a new proposal round and locks it (status submitted).
func SubmitRound(ctx context.Context, tx pgx.Tx, d *Draft, hashes []string, note string) error {
	if d.ChapterDeleted {
		return domain.ErrDeleted
	}
	if d.Meta.Title == "" {
		return domain.ErrEmptyTitle
	}
	meta, _ := json.Marshal(d.Meta)
	var n *string
	if note != "" {
		n = &note
	}
	if _, err := tx.Exec(ctx, `INSERT INTO draft_rounds (draft_id, round, base_version, meta, blocks, note) VALUES ($1, $2, $3, $4, $5, $6)`,
		d.ID, d.LastRound+1, d.BaseVersion, meta, hashes, n); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'submitted', last_round = last_round + 1, lock_user = NULL, updated_at = NOW() WHERE id = $1`, d.ID)
	return err
}

// Editable: open draft {id} locked for this transaction, when the caller owns it or may edit it (shared with
// can_edit; the backend checked they still take part in the story) and nobody else holds the edit lock. The caller
// takes / extends the lock.
func (s *Service) Editable(ctx context.Context, tx pgx.Tx, id, user string, name *string) (*Draft, []string, error) {
	d, hashes, err := Load(ctx, tx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if d.OwnerID != user {
		var canEdit bool
		if err := tx.QueryRow(ctx, `SELECT can_edit FROM draft_shares WHERE draft_id = $1 AND user_id = $2`, id, user).Scan(&canEdit); err != nil || !canEdit {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, nil, err
			}
			return nil, nil, domain.ErrNotOwner
		}
	}
	if d.Status != "open" {
		return nil, nil, domain.ErrDraftClosed
	}
	if d.LockUser != nil && *d.LockUser != user && d.LockUntil != nil && s.now().Before(*d.LockUntil) {
		holder := "Người khác"
		if d.LockName != nil {
			holder = *d.LockName
		}
		return nil, nil, &domain.LockedError{Name: holder}
	}
	_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET lock_user = $2, lock_name = $3, lock_until = $4 WHERE id = $1`, id, user, name, s.now().Add(lockTTL))
	return d, hashes, err
}

// Save is the autosave (owner or an editor it is shared with; expected_version stops two tabs overwriting each other).
func (s *Service) Save(ctx context.Context, id string, b Body) (version int, updated time.Time, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := s.Editable(ctx, tx, id, b.OwnerID, b.OwnerName)
		if err != nil {
			return err
		}
		if b.ExpectedVersion != d.Version {
			return domain.ErrConflict
		}
		hashes, err := blocks.Store(ctx, tx, b.Blocks)
		if err != nil {
			return err
		}
		meta, _ := json.Marshal(b.Meta)
		if err := tx.QueryRow(ctx, `UPDATE chapter_drafts SET meta = $2, blocks = $3, version = version + 1, updated_at = NOW()
			WHERE id = $1 RETURNING version, updated_at`, id, meta, hashes).Scan(&version, &updated); err != nil {
			return err
		}
		return recordEdit(ctx, tx, id, version, b.OwnerID, b.OwnerName)
	})
	return version, updated, err
}

// Publish puts draft {id} into the official line (see PublishTx); number is the chapter number for error messages.
func (s *Service) Publish(ctx context.Context, id string, b Body) (rev *chapters.Revision, number float64, err error) {
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) {
		rev, number, err = s.PublishTx(ctx, tx, id, b.OwnerID, b.OwnerName, false)
		return err
	})
	return rev, number, err
}

// PublishTx puts draft {id} into the official line in tx: the caller's own open draft, or a submitted proposal (the
// backend has checked the caller is a story keeper), becomes the next official version (or v1 of a new chapter). An own
// draft must be based on the current version (pull first); a proposal behind it is merged when diff3 is clean.
// scheduled: the scheduler publishing a draft whose time has come (rights were checked when it was scheduled; it
// publishes as the state it was scheduled from).
func (s *Service) PublishTx(ctx context.Context, tx pgx.Tx, id, actorID string, actorName *string, scheduled bool) (*chapters.Revision, float64, error) {
	d, hashes, err := Load(ctx, tx, id, true)
	if err != nil {
		return nil, 0, err
	}
	state := d.Status
	if state == "scheduled" {
		if !scheduled || d.SchedulePrev == nil {
			return nil, 0, domain.ErrScheduled
		}
		state = *d.SchedulePrev
	}
	switch {
	case state == "submitted":
	case state != "open":
		return nil, 0, domain.ErrDraftClosed
	case d.OwnerID != actorID && !scheduled:
		return nil, 0, domain.ErrNotOwner
	}
	number := d.Meta.ChapterNumber
	meta := d.Meta
	if meta.Title == "" {
		return nil, number, domain.ErrEmptyTitle
	}
	var rev *chapters.Revision
	if d.ChapterID != nil {
		h, err := s.chapters.LockHead(ctx, tx, *d.ChapterID)
		if err != nil {
			return nil, number, err
		}
		if h.Deleted {
			return nil, number, domain.ErrDeleted
		}
		if d.BaseVersion == nil || *d.BaseVersion != h.Version {
			if state != "submitted" || d.BaseVersion == nil {
				return nil, number, domain.ErrBehind
			}
			d.CurrentVersion = &h.Version
			p, err := s.PlanPull(ctx, tx, d, hashes)
			if err != nil {
				return nil, number, err
			}
			if len(p.MetaConflicts) > 0 || slices.ContainsFunc(p.Chunks, func(c blocks.Chunk) bool { return c.Conflict != nil }) {
				return nil, number, domain.ErrMergeConflict
			}
			if hashes, meta, err = blocks.Resolve(p.Chunks, p.Meta, nil, p.theirs, nil); err != nil {
				return nil, number, err
			}
		}
		based := h.Version
		bl, err := blocks.Load(ctx, tx, hashes)
		if err != nil {
			return nil, number, err
		}
		rev = &chapters.Revision{ChapterID: *d.ChapterID, StoryID: d.StoryID, Version: h.Version + 1, Source: "edit", BasedOn: &based,
			Meta: meta, Blocks: bl, AuthorID: &d.OwnerID, AuthorName: d.OwnerName}
		if err := s.chapters.AppendRevision(ctx, tx, rev, hashes); err != nil {
			return nil, number, err
		}
	} else {
		bl, err := blocks.Load(ctx, tx, hashes)
		if err != nil {
			return nil, number, err
		}
		rev = &chapters.Revision{StoryID: d.StoryID, Source: "create", Meta: meta, Blocks: bl, AuthorID: &d.OwnerID, AuthorName: d.OwnerName}
		if err := s.chapters.CreateChapter(ctx, tx, rev); err != nil {
			return nil, number, err
		}
	}
	action := "published"
	if state == "submitted" {
		action = "proposal_merged"
		if _, err := tx.Exec(ctx, `UPDATE draft_rounds SET decision = 'merged', decided_by = $3, decided_name = $4, decided_at = NOW(), merged_version = $5
			WHERE draft_id = $1 AND round = $2`, id, d.LastRound, actorID, actorName, rev.Version); err != nil {
			return nil, number, err
		}
		if err := tasks.AfterDecision(ctx, tx, id, "merged", actorID, actorName); err != nil {
			return nil, number, err
		}
	}
	if err := LogActivity(ctx, tx, actorID, actorName, action, d); err != nil {
		return nil, number, err
	}
	_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'published', chapter_id = $2, published_version = $3, schedule_error = NULL, updated_at = NOW() WHERE id = $1`,
		id, rev.ChapterID, rev.Version)
	return rev, number, err
}

// List is the caller's open drafts, newest first (no blocks); story "" = every story.
func (s *Service) List(ctx context.Context, user, story string) ([]ListItem, error) {
	rows, err := s.db.Query(ctx, `SELECT `+Columns+` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE d.owner_id = $1 AND d.status IN ('open', 'submitted', 'offered', 'scheduled') AND ($2 = '' OR d.story_id::text = $2) ORDER BY d.updated_at DESC LIMIT 100`, user, story)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []ListItem{}
	for rows.Next() {
		d, hashes, err := Scan(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, ListItem{d, len(hashes)})
	}
	return list, rows.Err()
}

// OwnerOf is the owner of draft id; ErrNotFound when there is none.
func (s *Service) OwnerOf(ctx context.Context, id string) (string, error) {
	var owner string
	err := s.db.QueryRow(ctx, `SELECT owner_id::text FROM chapter_drafts WHERE id = $1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	return owner, err
}

// Discard: kept in the database, no longer listed or editable.
func (s *Service) Discard(ctx context.Context, id, user string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, _, err := OpenOwn(ctx, tx, id, user); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'discarded', updated_at = NOW() WHERE id = $1`, id)
		return err
	})
}

// PlanPull is the three-way merge of the draft with the current official version.
func (s *Service) PlanPull(ctx context.Context, tx pgx.Tx, d *Draft, ours []string) (*PullPlan, error) {
	if d.ChapterID == nil || d.BaseVersion == nil {
		return nil, domain.ErrNotFound
	}
	if d.ChapterDeleted {
		return nil, domain.ErrDeleted
	}
	base, baseHashes, err := s.chapters.LoadRevision(ctx, tx, *d.ChapterID, *d.BaseVersion)
	if err != nil {
		return nil, err
	}
	cur, curHashes, err := s.chapters.LoadRevision(ctx, tx, *d.ChapterID, *d.CurrentVersion)
	if err != nil {
		return nil, err
	}
	p := &PullPlan{From: *d.BaseVersion, To: *d.CurrentVersion, Chunks: blocks.Merge3(baseHashes, ours, curHashes), theirs: cur.Meta}
	p.Meta, p.MetaConflicts = blocks.MergeMeta(base.Meta, d.Meta, cur.Meta)
	if p.MetaConflicts == nil {
		p.MetaConflicts = []blocks.MetaConflict{}
	}
	if p.Chunks == nil {
		p.Chunks = []blocks.Chunk{}
	}
	return p, nil
}

// involved collects the blocks of every conflict of the plan, with their data for the browser.
func involvedData(ctx context.Context, tx pgx.Tx, p *PullPlan) (map[string]json.RawMessage, error) {
	var involved []string
	for _, c := range p.Chunks {
		if c.Conflict != nil {
			involved = append(append(append(involved, c.Conflict.Base...), c.Conflict.Ours...), c.Conflict.Theirs...)
		}
	}
	data, err := blocks.Data(ctx, tx, involved)
	if err != nil {
		return nil, err
	}
	bl := map[string]json.RawMessage{}
	for h, v := range data {
		bl[h] = v
	}
	return bl, nil
}

// PullPreview: what updating from the official version would do, with the data of every block involved.
func (s *Service) PullPreview(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, ours, err := Load(ctx, tx, id, false)
		if err != nil {
			return err
		}
		if d.Status != "open" {
			return domain.ErrDraftClosed
		}
		p, err := s.PlanPull(ctx, tx, d, ours)
		if err != nil {
			return err
		}
		bl, err := involvedData(ctx, tx, p)
		if err != nil {
			return err
		}
		out = map[string]any{"plan": p, "blocks": bl, "draft_version": d.Version}
		return nil
	})
	return out, err
}

// PullRequest is POST /drafts/{id}/pull.
type PullRequest struct {
	ExpectedVersion int               `json:"expected_version"`
	ToVersion       int               `json:"to_version"`
	Choices         map[string]string `json:"choices"`
}

// PullApply applies the merge; the draft is then based on to_version. A bad choice comes back as a 400 HTTPError.
func (s *Service) PullApply(ctx context.Context, id, user string, name *string, b PullRequest) error {
	var choiceErr error
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, ours, err := s.Editable(ctx, tx, id, user, name)
		if err != nil {
			return err
		}
		if d.Version != b.ExpectedVersion {
			return domain.ErrConflict
		}
		p, err := s.PlanPull(ctx, tx, d, ours)
		if err != nil {
			return err
		}
		if p.To != b.ToVersion { // the official line moved again since the preview: choices may not fit any more
			return domain.ErrBehind
		}
		hashes, meta, err := blocks.Resolve(p.Chunks, p.Meta, p.MetaConflicts, p.theirs, b.Choices)
		if err != nil {
			choiceErr = err
			return err
		}
		metaJSON, _ := json.Marshal(meta)
		_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET meta = $2, blocks = $3, base_version = $4, version = version + 1, updated_at = NOW()
			WHERE id = $1`, id, metaJSON, hashes, p.To)
		return err
	})
	if choiceErr != nil {
		return domain.Fail(400, choiceErr.Error())
	}
	return err
}
