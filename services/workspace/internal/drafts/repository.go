package drafts

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"nmv/workspace/internal/activity"
	"nmv/workspace/internal/domain"
)

// Columns is the column list scanned by Scan (the query joins chapter_drafts d and chapter_heads h).
const Columns = `d.id::text, d.owner_id::text, d.owner_name, d.story_id::text, d.chapter_id::text, d.base_version, d.meta, d.blocks,
	d.status, d.version, d.published_version, d.created_at, d.updated_at, h.current_version, COALESCE(h.deleted, FALSE), d.last_round,
	d.copied_from::text, d.lock_user::text, d.lock_name, d.lock_until, d.publish_at, d.scheduled_name, d.schedule_prev, d.schedule_error`

// Scan reads Columns, then `extra` columns a query adds after them. It also returns the block hashes.
func Scan(row pgx.Row, extra ...any) (*Draft, []string, error) {
	d := &Draft{}
	var meta []byte
	var hashes []string
	err := row.Scan(append([]any{&d.ID, &d.OwnerID, &d.OwnerName, &d.StoryID, &d.ChapterID, &d.BaseVersion, &meta, &hashes,
		&d.Status, &d.Version, &d.PublishedVersion, &d.CreatedAt, &d.UpdatedAt, &d.CurrentVersion, &d.ChapterDeleted, &d.LastRound,
		&d.CopiedFrom, &d.LockUser, &d.LockName, &d.LockUntil, &d.PublishAt, &d.ScheduledName, &d.SchedulePrev, &d.ScheduleError}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return d, hashes, json.Unmarshal(meta, &d.Meta)
}

// Load reads a draft (locked for the rest of tx when forUpdate) with its block hashes, not the blocks.
func Load(ctx context.Context, tx pgx.Tx, id string, forUpdate bool) (*Draft, []string, error) {
	q := `SELECT ` + Columns + ` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id WHERE d.id = $1`
	if forUpdate {
		q += ` FOR UPDATE OF d`
	}
	return Scan(tx.QueryRow(ctx, q, id))
}

// OpenOwn: the caller's open draft, locked; the error says why not otherwise.
func OpenOwn(ctx context.Context, tx pgx.Tx, id, user string) (*Draft, []string, error) {
	d, hashes, err := Load(ctx, tx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if d.OwnerID != user {
		return nil, nil, domain.ErrNotOwner
	}
	if d.Status != "open" {
		return nil, nil, domain.ErrDraftClosed
	}
	return d, hashes, nil
}

func recordEdit(ctx context.Context, tx pgx.Tx, id string, version int, user string, name *string) error {
	_, err := tx.Exec(ctx, `INSERT INTO draft_edits (draft_id, version, user_id, user_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
		id, version, user, name)
	return err
}

// giveDraft makes {to} the owner of draft {id} (no longer shared with them, nobody holding the edit lock).
func giveDraft(ctx context.Context, tx pgx.Tx, id, to string, name *string) error {
	_, err := tx.Exec(ctx, `UPDATE chapter_drafts SET owner_id = $2, owner_name = $3, lock_user = NULL, updated_at = NOW() WHERE id = $1`, id, to, name)
	if domain.IsUniqueViolation(err) {
		return domain.ErrAlreadyHasDraft
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM draft_shares WHERE draft_id = $1 AND user_id = $2`, id, to)
	return err
}

// Detail is what the story feed says about a draft.
func Detail(d *Draft) map[string]any {
	return map[string]any{"draft_id": d.ID, "chapter_number": d.Meta.ChapterNumber, "title": d.Meta.Title}
}

// LogActivity adds a line about a draft to its story's feed, in the caller's transaction.
func LogActivity(ctx context.Context, tx pgx.Tx, actorID string, actorName *string, action string, d *Draft) error {
	return activity.Log(ctx, tx, d.StoryID, actorID, actorName, action, Detail(d))
}
