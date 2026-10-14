package proposals

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/chapters"
	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/tasks"
)

// Service is the business of proposals.
type Service struct {
	db       *pgxpool.Pool
	drafts   *drafts.Service
	chapters *chapters.Repository
}

// NewService wires the service.
func NewService(db *pgxpool.Pool, d *drafts.Service, ch *chapters.Repository) *Service {
	return &Service{db: db, drafts: d, chapters: ch}
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func loadRounds(ctx context.Context, tx pgx.Tx, draftID string) ([]Round, error) {
	rows, err := tx.Query(ctx, `SELECT round, base_version, meta, blocks, note, submitted_at, decision, decided_name, decision_note, decided_at, merged_version
		FROM draft_rounds WHERE draft_id = $1 ORDER BY round`, draftID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Round, error) {
		var x Round
		var meta []byte
		if err := row.Scan(&x.Round, &x.BaseVersion, &meta, &x.blocks, &x.Note, &x.SubmittedAt, &x.Decision, &x.DecidedName, &x.DecisionNote,
			&x.DecidedAt, &x.MergedVersion); err != nil {
			return x, err
		}
		return x, json.Unmarshal(meta, &x.Meta)
	})
}

// Submit: the owner sends the draft for review (a new round).
func (s *Service) Submit(ctx context.Context, id string, b *drafts.DecisionBody) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, hashes, err := drafts.OpenOwn(ctx, tx, id, b.OwnerID)
		if err != nil {
			return err
		}
		if err := drafts.SubmitRound(ctx, tx, d, hashes, b.Note); err != nil {
			return err
		}
		return drafts.LogActivity(ctx, tx, b.OwnerID, b.OwnerName, "proposal_submitted", d)
	})
}

// Decide closes the pending round of a submitted draft and opens the draft again (withdrawn by its owner, or
// returned by a keeper: the backend checked that).
func (s *Service) Decide(ctx context.Context, id, decision string, b *drafts.DecisionBody) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := drafts.Load(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if d.Status != "submitted" {
			return domain.ErrNotSubmitted
		}
		if decision == "withdrawn" && d.OwnerID != b.OwnerID {
			return domain.ErrNotOwner
		}
		if _, err := tx.Exec(ctx, `UPDATE draft_rounds SET decision = $3, decided_by = $4, decided_name = $5, decision_note = $6, decided_at = NOW()
			WHERE draft_id = $1 AND round = $2`, id, d.LastRound, decision, b.OwnerID, b.OwnerName, nullable(b.Note)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'open', updated_at = NOW() WHERE id = $1`, id); err != nil {
			return err
		}
		if err := tasks.AfterDecision(ctx, tx, id, decision, b.OwnerID, b.OwnerName); err != nil {
			return err
		}
		return drafts.LogActivity(ctx, tx, b.OwnerID, b.OwnerName, "proposal_"+decision, d)
	})
}

// List: drafts waiting for review in a story (keepers see all of them, others their own).
func (s *Service) List(ctx context.Context, story string, keeper bool, user string) ([]Item, error) {
	rows, err := s.db.Query(ctx, `SELECT `+drafts.Columns+`, dr.note, dr.submitted_at
		FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		JOIN draft_rounds dr ON dr.draft_id = d.id AND dr.round = d.last_round
		WHERE d.story_id = $1 AND d.status IN ('submitted', 'scheduled') AND ($2 OR d.owner_id = $3) ORDER BY dr.submitted_at`, story, keeper, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Item{}
	for rows.Next() {
		var it Item
		d, _, err := drafts.Scan(rows, &it.Note, &it.SubmittedAt)
		if err != nil {
			return nil, err
		}
		it.Draft = d
		list = append(list, it)
	}
	return list, rows.Err()
}

// Review: the latest round against the official version it was based on, against the round before, and against the
// official version now (merge preview), with every block involved and the comments.
func (s *Service) Review(ctx context.Context, d *drafts.Draft, user string, keeper, removed bool) (map[string]any, error) {
	var out map[string]any
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		rounds, err := loadRounds(ctx, tx, d.ID)
		if err != nil {
			return err
		}
		if len(rounds) == 0 {
			return domain.ErrNotSubmitted
		}
		last := rounds[len(rounds)-1]
		var base []string
		if d.ChapterID != nil && last.BaseVersion != nil {
			if _, base, err = s.chapters.LoadRevision(ctx, tx, *d.ChapterID, *last.BaseVersion); err != nil {
				return err
			}
		}
		involved := append(append([]string{}, base...), last.blocks...)
		var sincePrev []blocks.DiffOp
		if len(rounds) > 1 {
			prev := rounds[len(rounds)-2].blocks
			sincePrev = blocks.Diff(prev, last.blocks)
			involved = append(involved, prev...)
		}
		// would merging now need the author to update first?
		conflicts := 0
		if d.Status == "submitted" && d.ChapterID != nil && d.BaseVersion != nil && d.CurrentVersion != nil && *d.CurrentVersion != *d.BaseVersion && !d.ChapterDeleted {
			plan, err := s.drafts.PlanPull(ctx, tx, d, last.blocks)
			if err != nil {
				return err
			}
			conflicts = len(plan.MetaConflicts)
			for _, c := range plan.Chunks {
				if c.Conflict != nil {
					conflicts++
				}
			}
		}
		crows, err := tx.Query(ctx, `SELECT id, round, block_hash, body, author_id::text, author_name, created_at FROM draft_comments WHERE draft_id = $1 ORDER BY id`, d.ID)
		if err != nil {
			return err
		}
		comments, err := pgx.CollectRows(crows, func(row pgx.CollectableRow) (comment, error) {
			var c comment
			return c, row.Scan(&c.ID, &c.Round, &c.BlockHash, &c.Body, &c.AuthorID, &c.AuthorName, &c.CreatedAt)
		})
		if err != nil {
			return err
		}
		for _, c := range comments {
			if c.BlockHash != nil {
				involved = append(involved, *c.BlockHash)
			}
		}
		data, err := blocks.Data(ctx, tx, involved)
		if err != nil {
			return err
		}
		bl := map[string]json.RawMessage{}
		for h, v := range data {
			bl[h] = v
		}
		out = map[string]any{
			"draft": d, "rounds": rounds, "round": last.Round, "meta": last.Meta,
			"changes": blocks.Diff(base, last.blocks), "since_previous": sincePrev,
			"blocks": bl, "comments": comments, "merge_conflicts": conflicts,
			"is_owner": d.OwnerID == user, "can_merge": keeper, "story_removed": removed,
		}
		return nil
	})
	return out, err
}

// BlockExists: whether a paragraph with this hash is stored (a comment may point at it).
func (s *Service) BlockExists(ctx context.Context, hash string) bool {
	var exists bool
	s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM content_blocks WHERE hash = $1)`, hash).Scan(&exists)
	return exists
}

// Comment adds a comment on the latest round and returns its id.
func (s *Service) Comment(ctx context.Context, draftID string, round int, hash *string, body, user, name string) (int64, error) {
	var id int64
	err := s.db.QueryRow(ctx, `INSERT INTO draft_comments (draft_id, round, block_hash, body, author_id, author_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		draftID, round, hash, body, user, name).Scan(&id)
	return id, err
}
