package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Working on drafts together (stage 4a, Plan/chapter-workspace.md): sharing, a helper's own copy sent back and
// taken in whole or paragraph by paragraph, handing a draft over, keepers reclaiming drafts of people who left,
// shared editing one person at a time (edit lock on the draft row), the draft card shown in direct messages.

const lockTTL = 2 * time.Minute

type lockedError struct{ name string }

func (e *lockedError) Error() string { return "locked by " + e.name }

func recordEdit(ctx context.Context, tx pgx.Tx, id string, version int, user string, name *string) error {
	_, err := tx.Exec(ctx, `INSERT INTO draft_edits (draft_id, version, user_id, user_name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
		id, version, user, name)
	return err
}

// editableDraft: open draft {id} locked for this transaction, when the caller owns it or may edit it (shared with
// can_edit; the backend checked they still take part in the story) and nobody else holds the edit lock. The caller
// takes / extends the lock.
func (s *server) editableDraft(ctx context.Context, tx pgx.Tx, id, user string, name *string) (*draft, []string, error) {
	d, hashes, err := loadDraft(ctx, tx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if d.OwnerID != user {
		var canEdit bool
		if err := tx.QueryRow(ctx, `SELECT can_edit FROM draft_shares WHERE draft_id = $1 AND user_id = $2`, id, user).Scan(&canEdit); err != nil || !canEdit {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, nil, err
			}
			return nil, nil, errNotOwner
		}
	}
	if d.Status != "open" {
		return nil, nil, errDraftClosed
	}
	if d.LockUser != nil && *d.LockUser != user && d.LockUntil != nil && s.now().Before(*d.LockUntil) {
		holder := "Người khác"
		if d.LockName != nil {
			holder = *d.LockName
		}
		return nil, nil, &lockedError{holder}
	}
	_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET lock_user = $2, lock_name = $3, lock_until = $4 WHERE id = $1`, id, user, name, s.now().Add(lockTTL))
	return d, hashes, err
}

// draftRole: owner (whatever happens to their place in the story; keepers reclaim drafts of people who left),
// editor / viewer (shared with them and still taking part in the story), or "" (no access).
func (s *server) draftRole(ctx context.Context, d *draft, user string) (string, perm, error) {
	p, err := s.permission(ctx, user, d.StoryID)
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

// accessDraft loads draft {id} (no blocks) and the caller's role, writing the error response when the role is not
// one of `allowed`.
func (s *server) accessDraft(w http.ResponseWriter, r *http.Request, allowed ...string) (*draft, string, perm, bool) {
	id, user := r.PathValue("id"), s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return nil, "", perm{}, false
	}
	if !isUUID(id) {
		fail(w, 404, "Bản nháp không tồn tại.")
		return nil, "", perm{}, false
	}
	var d *draft
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) { d, _, err = loadDraft(r.Context(), tx, id, false); return })
	if err != nil {
		s.draftError(w, r, err)
		return nil, "", perm{}, false
	}
	role, p, err := s.draftRole(r.Context(), d, user)
	if err != nil {
		internalError(w, r, err)
		return nil, "", perm{}, false
	}
	for _, a := range allowed {
		if a == role {
			d.Access = role
			return d, user, p, true
		}
	}
	if role == "" {
		fail(w, 403, "Bạn không có quyền xem bản nháp này.")
	} else {
		fail(w, 403, "Chỉ chủ bản nháp làm được việc này.")
	}
	return nil, "", perm{}, false
}

// GET /drafts/{id}: the draft with its blocks for its owner and the people it is shared with; the owner also sees
// who it is shared with and helpers' copies sent back.
func (s *server) handleDraftGet(w http.ResponseWriter, r *http.Request) {
	d, _, p, allowed := s.accessDraft(w, r, "owner", "editor", "viewer")
	if !allowed {
		return
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var hashes []string
		access := d.Access
		var err error
		if d, hashes, err = loadDraft(ctx, tx, d.ID, false); err != nil {
			return err
		}
		d.Access = access
		if d.Blocks, err = loadBlocks(ctx, tx, hashes); err != nil {
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
		claims, err := queryTasks(ctx, tx, `story_id = $1 AND chapter_number = $2 AND status IN ('open', 'claimed') AND (draft_id IS NULL OR draft_id <> $3)`,
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
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	d.CanMerge = &p.Keeper
	ok(w, d)
}

// POST /drafts/{id}/lock: take or keep the edit lock (heartbeat while the editor is open); DELETE releases it.
func (s *server) handleLock(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := s.accessDraft(w, r, "owner", "editor")
	if !allowed {
		return
	}
	var until time.Time
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		_, _, err := s.editableDraft(r.Context(), tx, d.ID, user, &p.Name)
		until = s.now().Add(lockTTL)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, map[string]any{"lock_until": until})
}

func (s *server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	d, user, _, allowed := s.accessDraft(w, r, "owner", "editor")
	if !allowed {
		return
	}
	if _, err := s.db.Exec(r.Context(), `UPDATE chapter_drafts SET lock_user = NULL, lock_name = NULL, lock_until = NULL WHERE id = $1 AND lock_user = $2`, d.ID, user); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, nil)
}

// POST /internal/drafts/{id}/shares {owner_id, user_id, user_name, can_edit}: the owner shares (the backend checked the
// recipient takes part in the story and sends them the card in a direct message). Sharing again updates can_edit.
func (s *server) handleShare(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		OwnerID  string  `json:"owner_id"`
		UserID   string  `json:"user_id"`
		UserName *string `json:"user_name"`
		CanEdit  bool    `json:"can_edit"`
	}
	if !isUUID(id) || readJSON(w, r, &b) != nil || !isUUID(b.UserID) || b.UserID == b.OwnerID {
		fail(w, 400, "invalid body")
		return
	}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		d, _, err := loadDraft(r.Context(), tx, id, true)
		if err != nil {
			return err
		}
		if d.OwnerID != b.OwnerID {
			return errNotOwner
		}
		if d.Status != "open" && d.Status != "submitted" {
			return errDraftClosed
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO draft_shares (draft_id, user_id, user_name, can_edit) VALUES ($1, $2, $3, $4)
			ON CONFLICT (draft_id, user_id) DO UPDATE SET can_edit = EXCLUDED.can_edit, user_name = EXCLUDED.user_name`, id, b.UserID, b.UserName, b.CanEdit)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, map[string]any{"draft_id": id, "user_id": b.UserID, "can_edit": b.CanEdit})
}

// DELETE /drafts/{id}/shares/{user}: the owner stops sharing with someone.
func (s *server) handleUnshare(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := s.accessDraft(w, r, "owner")
	if !allowed {
		return
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM draft_shares WHERE draft_id = $1 AND user_id::text = $2`, d.ID, r.PathValue("user")); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, nil)
}

// POST /drafts/{id}/copy: someone it is shared with makes their own copy to edit and send back.
func (s *server) handleCopy(w http.ResponseWriter, r *http.Request) {
	src, user, p, allowed := s.accessDraft(w, r, "editor", "viewer")
	if !allowed {
		return
	}
	var newID string
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		d, hashes, err := loadDraft(ctx, tx, src.ID, false)
		if err != nil {
			return err
		}
		if d.Status != "open" && d.Status != "submitted" {
			return errDraftClosed
		}
		var open int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM chapter_drafts WHERE owner_id = $1 AND status IN ('open', 'submitted', 'offered')`, user).Scan(&open); err != nil {
			return err
		}
		if open >= maxOpenDrafts {
			return errTooMany
		}
		newID = newUUID()
		meta, _ := json.Marshal(d.Meta)
		_, err = tx.Exec(ctx, `INSERT INTO chapter_drafts (id, owner_id, owner_name, story_id, chapter_id, base_version, meta, blocks, copied_from, copy_base, copy_base_meta)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $7)`, newID, user, p.Name, d.StoryID, d.ChapterID, d.BaseVersion, meta, hashes, d.ID)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, newID, 201)
}

// POST /internal/drafts/{id}/offer {owner_id}: the helper sends their copy back (the backend tells the original's owner).
func (s *server) handleOffer(w http.ResponseWriter, r *http.Request) {
	id, b, valid := s.readDecision(w, r)
	if !valid {
		return
	}
	var originalOwner string
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		d, _, err := openOwnDraft(r.Context(), tx, id, b.OwnerID)
		if err != nil {
			return err
		}
		if d.CopiedFrom == nil {
			return errNotCopy
		}
		if err := tx.QueryRow(r.Context(), `SELECT owner_id::text FROM chapter_drafts WHERE id = $1`, *d.CopiedFrom).Scan(&originalOwner); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `UPDATE chapter_drafts SET status = 'offered', lock_user = NULL, updated_at = NOW() WHERE id = $1`, id)
		return err
	})
	if errors.Is(err, errNotCopy) {
		fail(w, 400, "Đây không phải bản sao của nháp người khác.")
		return
	}
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, map[string]any{"id": id, "original_owner_id": originalOwner, "status": "offered"})
}

var errNotCopy = errors.New("not a copy")

// offerPlan: the owner's draft (ours) against a helper's copy (theirs), base = the original when it was copied.
// Every change the helper made is a choice.
func offerPlan(ctx context.Context, tx pgx.Tx, d *draft, ours []string, copyID string) (*pullPlan, error) {
	var copyHashes, base []string
	var copyMeta, baseMeta []byte
	var copiedFrom *string
	var status string
	if err := tx.QueryRow(ctx, `SELECT blocks, meta, copy_base, copy_base_meta, copied_from::text, status FROM chapter_drafts WHERE id = $1`, copyID).
		Scan(&copyHashes, &copyMeta, &base, &baseMeta, &copiedFrom, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNotFound
		}
		return nil, err
	}
	if copiedFrom == nil || *copiedFrom != d.ID || status != "offered" {
		return nil, errNotFound
	}
	var theirs, baseM chapterMeta
	json.Unmarshal(copyMeta, &theirs)
	json.Unmarshal(baseMeta, &baseM)
	p := &pullPlan{Chunks: mergeOffer(base, ours, copyHashes), theirs: theirs}
	p.Meta, p.MetaConflicts = mergeMetaX(baseM, d.Meta, theirs, true)
	if p.MetaConflicts == nil {
		p.MetaConflicts = []metaConflict{}
	}
	if p.Chunks == nil {
		p.Chunks = []mergeChunk{}
	}
	return p, nil
}

// GET /drafts/{id}/offers/{copy}: what taking a helper's copy in would change (every change of theirs to choose).
func (s *server) handleOfferPreview(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := s.accessDraft(w, r, "owner")
	if !allowed {
		return
	}
	var out map[string]any
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		dd, ours, err := loadDraft(r.Context(), tx, d.ID, false)
		if err != nil {
			return err
		}
		p, err := offerPlan(r.Context(), tx, dd, ours, r.PathValue("copy"))
		if err != nil {
			return err
		}
		var involved []string
		for _, c := range p.Chunks {
			if c.Conflict != nil {
				involved = append(append(append(involved, c.Conflict.Base...), c.Conflict.Ours...), c.Conflict.Theirs...)
			}
		}
		data, err := blockData(r.Context(), tx, involved)
		if err != nil {
			return err
		}
		blocks := map[string]json.RawMessage{}
		for h, v := range data {
			blocks[h] = v
		}
		out = map[string]any{"plan": p, "blocks": blocks, "draft_version": dd.Version}
		return nil
	})
	if errors.Is(err, errNotFound) {
		fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
		return
	}
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, out)
}

// POST /drafts/{id}/offers/{copy} {expected_version, choices}: take the helper's changes in as chosen.
func (s *server) handleOfferAccept(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := s.accessDraft(w, r, "owner")
	if !allowed {
		return
	}
	var b struct {
		ExpectedVersion int               `json:"expected_version"`
		Choices         map[string]string `json:"choices"`
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "invalid body")
		return
	}
	copyID := r.PathValue("copy")
	var choiceErr error
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		dd, ours, err := s.editableDraft(ctx, tx, d.ID, user, &p.Name)
		if err != nil {
			return err
		}
		if dd.Version != b.ExpectedVersion {
			return errConflict
		}
		plan, err := offerPlan(ctx, tx, dd, ours, copyID)
		if err != nil {
			return err
		}
		hashes, meta, err := resolve(plan.Chunks, plan.Meta, plan.MetaConflicts, plan.theirs, b.Choices)
		if err != nil {
			choiceErr = err
			return err
		}
		metaJSON, _ := json.Marshal(meta)
		var version int
		if err := tx.QueryRow(ctx, `UPDATE chapter_drafts SET meta = $2, blocks = $3, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING version`,
			d.ID, metaJSON, hashes).Scan(&version); err != nil {
			return err
		}
		if err := recordEdit(ctx, tx, d.ID, version, user, &p.Name); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'accepted', updated_at = NOW() WHERE id = $1`, copyID)
		return err
	})
	switch {
	case choiceErr != nil:
		fail(w, 400, choiceErr.Error())
	case errors.Is(err, errNotFound):
		fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
	case err != nil:
		s.draftError(w, r, err)
	default:
		s.writeDraft(w, r, d.ID, 200)
	}
}

// DELETE /drafts/{id}/offers/{copy}: not taken in: the copy goes back to its helper (open again).
func (s *server) handleOfferDecline(w http.ResponseWriter, r *http.Request) {
	d, _, _, allowed := s.accessDraft(w, r, "owner")
	if !allowed {
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE chapter_drafts SET status = 'open', updated_at = NOW() WHERE id::text = $1 AND copied_from = $2 AND status = 'offered'`,
		r.PathValue("copy"), d.ID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "Bản gửi này không còn chờ bạn nhận.")
		return
	}
	ok(w, nil)
}

// POST /internal/drafts/{id}/transfer {owner_id, to_id, to_name}: the owner hands an open draft over (the backend
// checked the recipient takes part in the story).
func (s *server) handleTransfer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		OwnerID string  `json:"owner_id"`
		ToID    string  `json:"to_id"`
		ToName  *string `json:"to_name"`
	}
	if !isUUID(id) || readJSON(w, r, &b) != nil || !isUUID(b.ToID) || b.ToID == b.OwnerID {
		fail(w, 400, "invalid body")
		return
	}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if _, _, err := openOwnDraft(r.Context(), tx, id, b.OwnerID); err != nil {
			return err
		}
		return giveDraft(r.Context(), tx, id, b.ToID, b.ToName)
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

// giveDraft makes {to} the owner of draft {id} (no longer shared with them, nobody holding the edit lock).
func giveDraft(ctx context.Context, tx pgx.Tx, id, to string, name *string) error {
	_, err := tx.Exec(ctx, `UPDATE chapter_drafts SET owner_id = $2, owner_name = $3, lock_user = NULL, updated_at = NOW() WHERE id = $1`, id, to, name)
	if isUniqueViolation(err) {
		return errAlreadyHasDraft
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM draft_shares WHERE draft_id = $1 AND user_id = $2`, id, to)
	return err
}

var errAlreadyHasDraft = errors.New("recipient already has a draft of this chapter")

func isUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// GET /drafts/orphans?story_id=: keepers see open drafts whose owners no longer take part in the story.
func (s *server) handleOrphans(w http.ResponseWriter, r *http.Request) {
	user, story := s.userFrom(r), r.URL.Query().Get("story_id")
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !isUUID(story) {
		fail(w, 400, "Thiếu story_id.")
		return
	}
	p, err := s.permission(r.Context(), user, story)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if !p.Keeper {
		fail(w, 403, "Chỉ người giữ truyện xem được danh sách này.")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+draftColumns+` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE d.story_id = $1 AND d.status IN ('open', 'submitted') AND d.copied_from IS NULL ORDER BY d.updated_at DESC LIMIT 500`, story)
	if err != nil {
		internalError(w, r, err)
		return
	}
	var all []*draft
	for rows.Next() {
		d, _, err := scanDraft(rows)
		if err != nil {
			rows.Close()
			internalError(w, r, err)
			return
		}
		all = append(all, d)
	}
	rows.Close()
	list := []*draft{}
	for _, d := range all {
		op, err := s.permission(r.Context(), d.OwnerID, story)
		if err != nil {
			internalError(w, r, err)
			return
		}
		if !op.Contributor {
			list = append(list, d)
		}
	}
	ok(w, list)
}

// POST /drafts/{id}/reclaim: a keeper takes over the draft of someone who no longer takes part in the story, so
// their work is not lost (a waiting proposal of theirs is withdrawn and becomes the keeper's draft).
func (s *server) handleReclaim(w http.ResponseWriter, r *http.Request) {
	user, id := s.userFrom(r), r.PathValue("id")
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !isUUID(id) {
		fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	ctx := r.Context()
	var d *draft
	if err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) { d, _, err = loadDraft(ctx, tx, id, false); return }); err != nil {
		s.draftError(w, r, err)
		return
	}
	p, err := s.permission(ctx, user, d.StoryID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	op, err := s.permission(ctx, d.OwnerID, d.StoryID)
	if err != nil {
		internalError(w, r, err)
		return
	}
	switch {
	case !p.Keeper:
		fail(w, 403, "Chỉ người giữ truyện nhận lại được nháp.")
		return
	case op.Contributor:
		fail(w, 409, "Người viết vẫn đang tham gia truyện: nhờ họ giao nháp cho bạn.")
		return
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := loadDraft(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if d.Status == "submitted" {
			if _, err := tx.Exec(ctx, `UPDATE draft_rounds SET decision = 'withdrawn', decided_by = $3, decided_name = $4, decided_at = NOW()
				WHERE draft_id = $1 AND round = $2`, id, d.LastRound, user, p.Name); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'open' WHERE id = $1`, id); err != nil {
				return err
			}
		} else if d.Status != "open" {
			return errDraftClosed
		}
		return giveDraft(ctx, tx, id, user, &p.Name)
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

// GET /drafts/{id}/card: the summary a direct message shows. Someone without access only learns that.
func (s *server) handleCard(w http.ResponseWriter, r *http.Request) {
	id, user := r.PathValue("id"), s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	if !isUUID(id) {
		fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	var d *draft
	var blockCount int
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		var hashes []string
		var err error
		d, hashes, err = loadDraft(r.Context(), tx, id, false)
		blockCount = len(hashes)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	role, _, err := s.draftRole(r.Context(), d, user)
	if err != nil {
		internalError(w, r, err)
		return
	}
	if role == "" {
		ok(w, map[string]any{"id": id, "access": "none"})
		return
	}
	ok(w, map[string]any{"id": id, "access": role, "meta": d.Meta, "story_id": d.StoryID, "chapter_id": d.ChapterID, "owner_name": d.OwnerName,
		"status": d.Status, "block_count": blockCount, "updated_at": d.UpdatedAt})
}

// GET /drafts/shared: drafts shared with me ("được nhờ"), in stories I still take part in.
func (s *server) handleSharedWithMe(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+draftColumns+`, ds.can_edit FROM draft_shares ds
		JOIN chapter_drafts d ON d.id = ds.draft_id LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE ds.user_id = $1 AND d.status IN ('open', 'submitted') ORDER BY d.updated_at DESC LIMIT 100`, user)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type item struct {
		*draft
		CanEdit bool `json:"can_edit"`
	}
	var all []item
	for rows.Next() {
		var it item
		d, _, err := scanDraft(rows, &it.CanEdit)
		if err != nil {
			rows.Close()
			internalError(w, r, err)
			return
		}
		it.draft = d
		all = append(all, it)
	}
	rows.Close()
	list := []item{}
	for _, it := range all {
		p, err := s.permission(r.Context(), user, it.StoryID)
		if err != nil {
			internalError(w, r, err)
			return
		}
		if p.Contributor {
			list = append(list, it)
		}
	}
	ok(w, list)
}
