package drafts

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/platform/blocks"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/tasks"
)

// Role: owner (whatever happens to their place in the story; keepers reclaim drafts of people who left),
// editor / viewer (shared with them and still taking part in the story), or "" (no access).
func (s *Service) Role(ctx context.Context, d *Draft, user string) (string, catalog.Perm, error) {
	p, err := s.perms.Permission(ctx, user, d.StoryID)
	if err != nil || d.OwnerID == user {
		return "owner", p, err
	}
	var canEdit bool
	err = s.db.QueryRow(ctx, `SELECT can_edit FROM draft_shares WHERE draft_id = $1 AND user_id = $2`, d.ID, user).Scan(&canEdit)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !p.Contributor) {
		return "", p, nil
	}
	if err != nil {
		return "", p, err
	}
	if canEdit {
		return "editor", p, nil
	}
	return "viewer", p, nil
}

// View is the draft with its blocks for its owner and the people it is shared with; the owner also sees who it is
// shared with and helpers' copies sent back.
func (s *Service) View(ctx context.Context, id, access string) (*Draft, error) {
	var d *Draft
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var hashes []string
		var err error
		if d, hashes, err = Load(ctx, tx, id, false); err != nil {
			return err
		}
		d.Access = access
		if d.Blocks, err = blocks.Load(ctx, tx, hashes); err != nil {
			return err
		}
		// someone else already on this chapter? (other open drafts, a task someone took)
		type other struct {
			Name   *string `json:"name"`
			Status string  `json:"status"`
		}
		rows, _ := tx.Query(ctx, `SELECT owner_name, status FROM chapter_drafts WHERE story_id = $1 AND id <> $2 AND copied_from IS NULL
			AND status IN ('open', 'submitted') AND ((chapter_id IS NOT NULL AND chapter_id = $3) OR (chapter_id IS NULL AND $3::uuid IS NULL AND (meta->>'chapter_number')::numeric = $4))`,
			d.StoryID, d.ID, d.ChapterID, d.Meta.ChapterNumber)
		others, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (other, error) {
			var x other
			return x, row.Scan(&x.Name, &x.Status)
		})
		if err != nil {
			return err
		}
		claims, err := tasks.Query(ctx, tx, `story_id = $1 AND chapter_number = $2 AND status IN ('open', 'claimed') AND (draft_id IS NULL OR draft_id <> $3)`,
			d.StoryID, d.Meta.ChapterNumber, d.ID)
		if err != nil {
			return err
		}
		d.Others, d.Claims = others, claims
		if access != "owner" {
			return nil
		}
		type share struct {
			UserID   string  `json:"user_id"`
			UserName *string `json:"user_name"`
			CanEdit  bool    `json:"can_edit"`
		}
		rows, _ = tx.Query(ctx, `SELECT user_id::text, user_name, can_edit FROM draft_shares WHERE draft_id = $1 ORDER BY created_at`, d.ID)
		shares, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (share, error) {
			var x share
			return x, row.Scan(&x.UserID, &x.UserName, &x.CanEdit)
		})
		if err != nil {
			return err
		}
		type offer struct {
			ID        string    `json:"id"`
			OwnerName *string   `json:"owner_name"`
			UpdatedAt time.Time `json:"updated_at"`
		}
		rows, _ = tx.Query(ctx, `SELECT id::text, owner_name, updated_at FROM chapter_drafts WHERE copied_from = $1 AND status = 'offered' ORDER BY updated_at`, d.ID)
		offers, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (offer, error) {
			var x offer
			return x, row.Scan(&x.ID, &x.OwnerName, &x.UpdatedAt)
		})
		d.Shares, d.Offers = shares, offers
		return err
	})
	return d, err
}

// Lock takes or keeps the edit lock (heartbeat while the editor is open) and returns when it runs out.
func (s *Service) Lock(ctx context.Context, id, user string, name *string) (time.Time, error) {
	var until time.Time
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		_, _, err := s.Editable(ctx, tx, id, user, name)
		until = s.now().Add(lockTTL)
		return err
	})
	return until, err
}

// Unlock releases the edit lock if the caller holds it.
func (s *Service) Unlock(ctx context.Context, id, user string) error {
	_, err := s.db.Exec(ctx, `UPDATE chapter_drafts SET lock_user = NULL, lock_name = NULL, lock_until = NULL WHERE id = $1 AND lock_user = $2`, id, user)
	return err
}

// Share: the owner shares (the backend checked the recipient takes part in the story and sends them the card in a
// direct message). Sharing again updates can_edit.
func (s *Service) Share(ctx context.Context, id, ownerID, userID string, userName *string, canEdit bool) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := Load(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if d.OwnerID != ownerID {
			return domain.ErrNotOwner
		}
		if d.Status != "open" && d.Status != "submitted" {
			return domain.ErrDraftClosed
		}
		_, err = tx.Exec(ctx, `INSERT INTO draft_shares (draft_id, user_id, user_name, can_edit) VALUES ($1, $2, $3, $4)
			ON CONFLICT (draft_id, user_id) DO UPDATE SET can_edit = EXCLUDED.can_edit, user_name = EXCLUDED.user_name`, id, userID, userName, canEdit)
		return err
	})
}

// Unshare: the owner stops sharing with someone.
func (s *Service) Unshare(ctx context.Context, id, userID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM draft_shares WHERE draft_id = $1 AND user_id::text = $2`, id, userID)
	return err
}

// Copy: someone it is shared with makes their own copy to edit and send back.
func (s *Service) Copy(ctx context.Context, srcID, user, name string) (string, error) {
	var newID string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, hashes, err := Load(ctx, tx, srcID, false)
		if err != nil {
			return err
		}
		if d.Status != "open" && d.Status != "submitted" {
			return domain.ErrDraftClosed
		}
		var open int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM chapter_drafts WHERE owner_id = $1 AND status IN ('open', 'submitted', 'offered')`, user).Scan(&open); err != nil {
			return err
		}
		if open >= maxOpenDrafts {
			return domain.ErrTooMany
		}
		newID = ids.New()
		meta, _ := json.Marshal(d.Meta)
		_, err = tx.Exec(ctx, `INSERT INTO chapter_drafts (id, owner_id, owner_name, story_id, chapter_id, base_version, meta, blocks, copied_from, copy_base, copy_base_meta)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $7)`, newID, user, name, d.StoryID, d.ChapterID, d.BaseVersion, meta, hashes, d.ID)
		return err
	})
	return newID, err
}

// Offer: the helper sends their copy back; returns the original's owner (the backend tells them).
func (s *Service) Offer(ctx context.Context, id string, b DecisionBody) (string, error) {
	var originalOwner string
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := OpenOwn(ctx, tx, id, b.OwnerID)
		if err != nil {
			return err
		}
		if d.CopiedFrom == nil {
			return domain.ErrNotCopy
		}
		if err := tx.QueryRow(ctx, `SELECT owner_id::text FROM chapter_drafts WHERE id = $1`, *d.CopiedFrom).Scan(&originalOwner); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'offered', lock_user = NULL, updated_at = NOW() WHERE id = $1`, id)
		return err
	})
	return originalOwner, err
}

// offerPlan: the owner's draft (ours) against a helper's copy (theirs), base = the original when it was copied.
// Every change the helper made is a choice.
func offerPlan(ctx context.Context, tx pgx.Tx, d *Draft, ours []string, copyID string) (*PullPlan, error) {
	var copyHashes, base []string
	var copyMeta, baseMeta []byte
	var copiedFrom *string
	var status string
	if err := tx.QueryRow(ctx, `SELECT blocks, meta, copy_base, copy_base_meta, copied_from::text, status FROM chapter_drafts WHERE id = $1`, copyID).
		Scan(&copyHashes, &copyMeta, &base, &baseMeta, &copiedFrom, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	if copiedFrom == nil || *copiedFrom != d.ID || status != "offered" {
		return nil, domain.ErrNotFound
	}
	var theirs, baseM blocks.Meta
	json.Unmarshal(copyMeta, &theirs)
	json.Unmarshal(baseMeta, &baseM)
	p := &PullPlan{Chunks: blocks.MergeOffer(base, ours, copyHashes), theirs: theirs}
	p.Meta, p.MetaConflicts = blocks.MergeMetaX(baseM, d.Meta, theirs, true)
	if p.MetaConflicts == nil {
		p.MetaConflicts = []blocks.MetaConflict{}
	}
	if p.Chunks == nil {
		p.Chunks = []blocks.Chunk{}
	}
	return p, nil
}

// OfferPreview: what taking a helper's copy in would change (every change of theirs to choose).
func (s *Service) OfferPreview(ctx context.Context, id, copyID string) (map[string]any, error) {
	var out map[string]any
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		dd, ours, err := Load(ctx, tx, id, false)
		if err != nil {
			return err
		}
		p, err := offerPlan(ctx, tx, dd, ours, copyID)
		if err != nil {
			return err
		}
		bl, err := involvedData(ctx, tx, p)
		if err != nil {
			return err
		}
		out = map[string]any{"plan": p, "blocks": bl, "draft_version": dd.Version}
		return nil
	})
	return out, err
}

// OfferRequest is POST /drafts/{id}/offers/{copy}.
type OfferRequest struct {
	ExpectedVersion int               `json:"expected_version"`
	Choices         map[string]string `json:"choices"`
}

// OfferAccept takes the helper's changes in as chosen. A bad choice comes back as a 400 HTTPError.
func (s *Service) OfferAccept(ctx context.Context, id, copyID, user string, name *string, b OfferRequest) error {
	var choiceErr error
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		dd, ours, err := s.Editable(ctx, tx, id, user, name)
		if err != nil {
			return err
		}
		if dd.Version != b.ExpectedVersion {
			return domain.ErrConflict
		}
		plan, err := offerPlan(ctx, tx, dd, ours, copyID)
		if err != nil {
			return err
		}
		hashes, meta, err := blocks.Resolve(plan.Chunks, plan.Meta, plan.MetaConflicts, plan.theirs, b.Choices)
		if err != nil {
			choiceErr = err
			return err
		}
		metaJSON, _ := json.Marshal(meta)
		var version int
		if err := tx.QueryRow(ctx, `UPDATE chapter_drafts SET meta = $2, blocks = $3, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING version`,
			id, metaJSON, hashes).Scan(&version); err != nil {
			return err
		}
		if err := recordEdit(ctx, tx, id, version, user, name); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'accepted', updated_at = NOW() WHERE id = $1`, copyID)
		return err
	})
	if choiceErr != nil {
		return domain.Fail(400, choiceErr.Error())
	}
	return err
}

// OfferDecline: not taken in: the copy goes back to its helper (open again). False when no such offer waits.
func (s *Service) OfferDecline(ctx context.Context, id, copyID string) (bool, error) {
	tag, err := s.db.Exec(ctx, `UPDATE chapter_drafts SET status = 'open', updated_at = NOW() WHERE id::text = $1 AND copied_from = $2 AND status = 'offered'`,
		copyID, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// Transfer: the owner hands an open draft over (the backend checked the recipient takes part in the story).
func (s *Service) Transfer(ctx context.Context, id, ownerID, toID string, toName *string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if _, _, err := OpenOwn(ctx, tx, id, ownerID); err != nil {
			return err
		}
		return giveDraft(ctx, tx, id, toID, toName)
	})
}

// Orphans: open drafts of a story whose owners no longer take part in it.
func (s *Service) Orphans(ctx context.Context, story string) ([]*Draft, error) {
	rows, err := s.db.Query(ctx, `SELECT `+Columns+` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE d.story_id = $1 AND d.status IN ('open', 'submitted') AND d.copied_from IS NULL ORDER BY d.updated_at DESC LIMIT 500`, story)
	if err != nil {
		return nil, err
	}
	var all []*Draft
	for rows.Next() {
		d, _, err := Scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		all = append(all, d)
	}
	rows.Close()
	list := []*Draft{}
	for _, d := range all {
		op, err := s.perms.Permission(ctx, d.OwnerID, story)
		if err != nil {
			return nil, err
		}
		if !op.Contributor {
			list = append(list, d)
		}
	}
	return list, nil
}

// Reclaim: a keeper takes over the draft of someone who no longer takes part in the story, so their work is not lost
// (a waiting proposal of theirs is withdrawn and becomes the keeper's draft).
func (s *Service) Reclaim(ctx context.Context, id, user, name string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := Load(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if d.Status == "submitted" {
			if _, err := tx.Exec(ctx, `UPDATE draft_rounds SET decision = 'withdrawn', decided_by = $3, decided_name = $4, decided_at = NOW()
				WHERE draft_id = $1 AND round = $2`, id, d.LastRound, user, name); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'open' WHERE id = $1`, id); err != nil {
				return err
			}
		} else if d.Status != "open" {
			return domain.ErrDraftClosed
		}
		return giveDraft(ctx, tx, id, user, &name)
	})
}

// Card reads the draft for the summary a direct message shows, with its block count.
func (s *Service) Card(ctx context.Context, id string) (*Draft, int, error) {
	var d *Draft
	var blockCount int
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var hashes []string
		var err error
		d, hashes, err = Load(ctx, tx, id, false)
		blockCount = len(hashes)
		return err
	})
	return d, blockCount, err
}

// SharedItem is one line of GET /drafts/shared.
type SharedItem struct {
	*Draft
	CanEdit bool `json:"can_edit"`
}

// SharedWithMe: drafts shared with the user ("được nhờ"), in stories they still take part in.
func (s *Service) SharedWithMe(ctx context.Context, user string) ([]SharedItem, error) {
	rows, err := s.db.Query(ctx, `SELECT `+Columns+`, ds.can_edit FROM draft_shares ds
		JOIN chapter_drafts d ON d.id = ds.draft_id LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE ds.user_id = $1 AND d.status IN ('open', 'submitted') ORDER BY d.updated_at DESC LIMIT 100`, user)
	if err != nil {
		return nil, err
	}
	var all []SharedItem
	for rows.Next() {
		var it SharedItem
		d, _, err := Scan(rows, &it.CanEdit)
		if err != nil {
			rows.Close()
			return nil, err
		}
		it.Draft = d
		all = append(all, it)
	}
	rows.Close()
	list := []SharedItem{}
	for _, it := range all {
		p, err := s.perms.Permission(ctx, user, it.StoryID)
		if err != nil {
			return nil, err
		}
		if p.Contributor {
			list = append(list, it)
		}
	}
	return list, nil
}
