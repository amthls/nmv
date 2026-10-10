package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

// Drafts (stage 2): private to their owner. New content still arrives through the backend (/internal: it sanitizes
// HTML); reading, discarding and pulling carry no new content and are public on /api/ws.

const maxOpenDrafts = 50

var (
	errDraftClosed   = errors.New("draft closed")
	errNotOwner      = errors.New("not the owner")
	errBehind        = errors.New("official line moved")
	errTooMany       = errors.New("too many drafts")
	errNotSubmitted  = errors.New("not submitted")
	errMergeConflict = errors.New("proposal conflicts with the official line")
)

type draft struct {
	ID               string      `json:"id"`
	OwnerID          string      `json:"owner_id"`
	OwnerName        *string     `json:"owner_name"`
	StoryID          string      `json:"story_id"`
	ChapterID        *string     `json:"chapter_id"`
	BaseVersion      *int        `json:"base_version"`
	Meta             chapterMeta `json:"meta"`
	Blocks           []block     `json:"blocks,omitempty"`
	Status           string      `json:"status"`
	Version          int         `json:"version"`
	PublishedVersion *int        `json:"published_version"`
	LastRound        int         `json:"last_round"`          // proposals sent so far (stage 3)
	CanMerge         *bool       `json:"can_merge,omitempty"` // GET /drafts/{id}: the caller keeps the story (publishes directly)
	CopiedFrom       *string     `json:"copied_from"`         // a helper's copy of another draft (stage 4)
	LockUser         *string     `json:"lock_user"`           // who is editing right now (until lock_until)
	LockName         *string     `json:"lock_name"`
	LockUntil        *time.Time  `json:"lock_until"`
	Access           string      `json:"access,omitempty"` // GET /drafts/{id}: owner | editor | viewer
	Shares           any         `json:"shares,omitempty"` // owner only: who it is shared with
	Offers           any         `json:"offers,omitempty"` // owner only: helpers' copies sent back
	Others           any         `json:"others,omitempty"` // GET /drafts/{id}: other open drafts of the same chapter
	Claims           any         `json:"claims,omitempty"` // GET /drafts/{id}: tasks on the same chapter (not this draft's)
	PublishAt        *time.Time  `json:"publish_at"`       // stage 4c: scheduled to go official then
	ScheduledName    *string     `json:"scheduled_name"`
	SchedulePrev     *string     `json:"schedule_prev"` // the state it returns to if the schedule is cancelled or fails
	ScheduleError    *string     `json:"schedule_error"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
	// the official line now: a draft opened from an older version shows "the official version changed"
	CurrentVersion *int `json:"current_version"`
	ChapterDeleted bool `json:"chapter_deleted"`
}

const draftColumns = `d.id::text, d.owner_id::text, d.owner_name, d.story_id::text, d.chapter_id::text, d.base_version, d.meta, d.blocks,
	d.status, d.version, d.published_version, d.created_at, d.updated_at, h.current_version, COALESCE(h.deleted, FALSE), d.last_round,
	d.copied_from::text, d.lock_user::text, d.lock_name, d.lock_until, d.publish_at, d.scheduled_name, d.schedule_prev, d.schedule_error`

// scanDraft reads draftColumns, then `extra` columns a query adds after them.
func scanDraft(row pgx.Row, extra ...any) (*draft, []string, error) {
	d := &draft{}
	var meta []byte
	var hashes []string
	err := row.Scan(append([]any{&d.ID, &d.OwnerID, &d.OwnerName, &d.StoryID, &d.ChapterID, &d.BaseVersion, &meta, &hashes,
		&d.Status, &d.Version, &d.PublishedVersion, &d.CreatedAt, &d.UpdatedAt, &d.CurrentVersion, &d.ChapterDeleted, &d.LastRound,
		&d.CopiedFrom, &d.LockUser, &d.LockName, &d.LockUntil, &d.PublishAt, &d.ScheduledName, &d.SchedulePrev, &d.ScheduleError}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, errNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return d, hashes, json.Unmarshal(meta, &d.Meta)
}

// loadDraft reads a draft (locked for the rest of tx when forUpdate) with its block hashes, not the blocks.
func loadDraft(ctx context.Context, tx pgx.Tx, id string, forUpdate bool) (*draft, []string, error) {
	q := `SELECT ` + draftColumns + ` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id WHERE d.id = $1`
	if forUpdate {
		q += ` FOR UPDATE OF d`
	}
	return scanDraft(tx.QueryRow(ctx, q, id))
}

// openOwnDraft: the caller's open draft, locked; the error says why not otherwise.
func openOwnDraft(ctx context.Context, tx pgx.Tx, id, user string) (*draft, []string, error) {
	d, hashes, err := loadDraft(ctx, tx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if d.OwnerID != user {
		return nil, nil, errNotOwner
	}
	if d.Status != "open" {
		return nil, nil, errDraftClosed
	}
	return d, hashes, nil
}

func (s *server) draftError(w http.ResponseWriter, r *http.Request, err error) {
	var locked *lockedError
	switch {
	case errors.Is(err, errNotFound):
		fail(w, 404, "Bản nháp không tồn tại.")
	case errors.Is(err, errNotOwner):
		fail(w, 403, "Đây không phải bản nháp của bạn.")
	case errors.Is(err, errDraftClosed):
		fail(w, 409, "Bản nháp này đã gửi đề xuất, đã đăng hoặc đã bỏ nên không sửa được. Đã gửi thì rút lại để sửa tiếp.")
	case errors.Is(err, errScheduled):
		fail(w, 409, "Bản nháp đang hẹn giờ đăng: hủy hẹn trước nếu muốn sửa hay đăng ngay.")
	case errors.Is(err, errNotSubmitted):
		fail(w, 409, "Bản nháp này không ở trạng thái chờ duyệt.")
	case errors.Is(err, errMergeConflict):
		fail(w, 409, "Đề xuất sửa trùng chỗ với bản chính thức đã thay đổi. Hãy trả lại để người viết cập nhật theo bản chính.")
	case errors.Is(err, errConflict):
		fail(w, 409, "Bản nháp vừa được lưu ở nơi khác (tab hoặc máy khác). Hãy tải lại để xem bản mới nhất.")
	case errors.Is(err, errBehind):
		fail(w, 409, "Bản chính thức đã thay đổi từ khi bạn mở nháp. Hãy bấm \"Cập nhật theo bản chính\" trước khi đăng.")
	case errors.Is(err, errDeleted):
		fail(w, 409, "Chương này đã bị xóa khỏi bản chính thức.")
	case errors.As(err, &locked):
		fail(w, 409, locked.name+" đang sửa bản nháp này. Bạn chỉ xem được cho tới khi họ rời đi (khóa tự nhả sau 2 phút không gõ).")
	case errors.Is(err, errAlreadyHasDraft):
		fail(w, 409, "Người này đã có một bản nháp đang mở của chương này.")
	case errors.Is(err, errTooMany):
		fail(w, 409, "Bạn đang có 50 bản nháp đang mở. Hãy đăng hoặc bỏ bớt nháp cũ trước.")
	default:
		internalError(w, r, err)
	}
}

// ---- internal (backend → workspace) ----------------------------------------------------------------------

type draftBody struct {
	OwnerID         string       `json:"owner_id"` // the caller (create: owner; save/publish: must be the owner)
	OwnerName       *string      `json:"owner_name"`
	StoryID         string       `json:"story_id"`
	ChapterID       *string      `json:"chapter_id"`
	Meta            *chapterMeta `json:"meta"`
	Blocks          []block      `json:"blocks"`
	ExpectedVersion int          `json:"expected_version"`
}

// POST /internal/drafts: a new chapter (meta + blocks), or a copy of a chapter's official version (chapter_id);
// the caller's open draft of that chapter is returned instead of a second one.
func (s *server) handleDraftCreate(w http.ResponseWriter, r *http.Request) {
	var b draftBody
	if readJSON(w, r, &b) != nil || !isUUID(b.OwnerID) || !isUUID(b.StoryID) || (b.ChapterID != nil && !isUUID(*b.ChapterID)) ||
		(b.ChapterID == nil && b.Meta == nil) {
		fail(w, 400, "invalid body")
		return
	}
	ctx := r.Context()
	var id string
	var reused bool
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) (err error) {
		id, reused, err = insertDraft(ctx, tx, b.OwnerID, b.OwnerName, b.StoryID, b.ChapterID, b.Meta, b.Blocks)
		return err
	})
	status := 201
	if reused {
		status = 200
	}
	if err != nil {
		if errors.Is(err, errNotFound) {
			fail(w, 404, "Chương không tồn tại.")
			return
		}
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, status)
}

// insertDraft makes a draft for owner: a copy of chapter's official version (the owner's open draft of that chapter
// is returned instead, reused = true), or a new chapter from meta + blocks.
func insertDraft(ctx context.Context, tx pgx.Tx, ownerID string, ownerName *string, storyID string, chapterID *string, newMeta *chapterMeta, newBlocks []block) (string, bool, error) {
	var open int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM chapter_drafts WHERE owner_id = $1 AND status IN ('open', 'submitted', 'offered', 'scheduled')`, ownerID).Scan(&open); err != nil {
		return "", false, err
	}
	var meta chapterMeta
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
		var h head
		if err := tx.QueryRow(ctx, `SELECT story_id::text, current_version, deleted FROM chapter_heads WHERE chapter_id = $1`, *chapterID).
			Scan(&h.StoryID, &h.Version, &h.Deleted); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", false, errNotFound
			}
			return "", false, err
		}
		if h.StoryID != storyID {
			return "", false, errNotFound
		}
		if h.Deleted {
			return "", false, errDeleted
		}
		var raw []byte
		if err := tx.QueryRow(ctx, `SELECT meta, blocks FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`, *chapterID, h.Version).
			Scan(&raw, &hashes); err != nil {
			return "", false, err
		}
		if err := json.Unmarshal(raw, &meta); err != nil {
			return "", false, err
		}
		base = &h.Version
	} else {
		meta = *newMeta
		var err error
		if hashes, err = storeBlocks(ctx, tx, newBlocks); err != nil {
			return "", false, err
		}
	}
	if open >= maxOpenDrafts {
		return "", false, errTooMany
	}
	id := newUUID()
	metaJSON, _ := json.Marshal(meta)
	_, err := tx.Exec(ctx, `INSERT INTO chapter_drafts (id, owner_id, owner_name, story_id, chapter_id, base_version, meta, blocks)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, ownerID, ownerName, storyID, chapterID, base, metaJSON, hashes)
	return id, false, err
}

// writeDraft answers with the full draft (blocks included).
func (s *server) writeDraft(w http.ResponseWriter, r *http.Request, id string, status int) {
	var d *draft
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		var hashes []string
		var err error
		if d, hashes, err = loadDraft(r.Context(), tx, id, false); err != nil {
			return err
		}
		d.Blocks, err = loadBlocks(r.Context(), tx, hashes)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	writeJSON(w, status, map[string]any{"success": true, "data": d})
}

// PUT /internal/drafts/{id}: autosave (owner only, expected_version stops two tabs overwriting each other).
func (s *server) handleDraftSave(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b draftBody
	if !isUUID(id) || readJSON(w, r, &b) != nil || b.Meta == nil {
		fail(w, 400, "invalid body")
		return
	}
	ctx := r.Context()
	var version int
	var updated time.Time
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := s.editableDraft(ctx, tx, id, b.OwnerID, b.OwnerName)
		if err != nil {
			return err
		}
		if b.ExpectedVersion != d.Version {
			return errConflict
		}
		hashes, err := storeBlocks(ctx, tx, b.Blocks)
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
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, map[string]any{"id": id, "version": version, "updated_at": updated})
}

// GET /internal/drafts/{id}: what the backend checks permissions on before publishing.
func (s *server) handleDraftInternal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Bản nháp không tồn tại.")
		return
	}
	s.writeDraft(w, r, id, 200)
}

// POST /internal/drafts/{id}/publish {owner_id = the caller}: the caller's own open draft, or a submitted proposal
// (the backend has checked the caller is a story keeper), becomes the next official version (or v1 of a new chapter).
// An own draft must be based on the current version (pull first); a proposal behind it is merged when diff3 is clean.
func (s *server) handleDraftPublish(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b draftBody
	if !isUUID(id) || readJSON(w, r, &b) != nil || !isUUID(b.OwnerID) {
		fail(w, 400, "invalid body")
		return
	}
	var rev *revision
	var number float64
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) {
		rev, number, err = publishTx(r.Context(), tx, id, b.OwnerID, b.OwnerName, false)
		return err
	})
	switch {
	case errors.Is(err, errEmptyTitle):
		fail(w, 400, "Chương cần có tiêu đề trước khi đăng.")
	case errors.Is(err, errNumberTaken):
		s.writeError(w, r, err, number)
	case err != nil:
		s.draftError(w, r, err)
	default:
		ok(w, rev)
	}
}

// publishTx puts draft {id} into the official line in tx. scheduled: the scheduler publishing a draft whose time has
// come (rights were checked when it was scheduled; it publishes as the state it was scheduled from).
func publishTx(ctx context.Context, tx pgx.Tx, id, actorID string, actorName *string, scheduled bool) (*revision, float64, error) {
	d, hashes, err := loadDraft(ctx, tx, id, true)
	if err != nil {
		return nil, 0, err
	}
	state := d.Status
	if state == "scheduled" {
		if !scheduled || d.SchedulePrev == nil {
			return nil, 0, errScheduled
		}
		state = *d.SchedulePrev
	}
	switch {
	case state == "submitted":
	case state != "open":
		return nil, 0, errDraftClosed
	case d.OwnerID != actorID && !scheduled:
		return nil, 0, errNotOwner
	}
	number := d.Meta.ChapterNumber
	meta := d.Meta
	if meta.Title == "" {
		return nil, number, errEmptyTitle
	}
	var rev *revision
	if d.ChapterID != nil {
		h, err := lockHead(ctx, tx, *d.ChapterID)
		if err != nil {
			return nil, number, err
		}
		if h.Deleted {
			return nil, number, errDeleted
		}
		if d.BaseVersion == nil || *d.BaseVersion != h.Version {
			if state != "submitted" || d.BaseVersion == nil {
				return nil, number, errBehind
			}
			d.CurrentVersion = &h.Version
			p, err := planPull(ctx, tx, d, hashes)
			if err != nil {
				return nil, number, err
			}
			if len(p.MetaConflicts) > 0 || slices.ContainsFunc(p.Chunks, func(c mergeChunk) bool { return c.Conflict != nil }) {
				return nil, number, errMergeConflict
			}
			if hashes, meta, err = resolve(p.Chunks, p.Meta, nil, p.theirs, nil); err != nil {
				return nil, number, err
			}
		}
		based := h.Version
		blocks, err := loadBlocks(ctx, tx, hashes)
		if err != nil {
			return nil, number, err
		}
		rev = &revision{ChapterID: *d.ChapterID, StoryID: d.StoryID, Version: h.Version + 1, Source: "edit", BasedOn: &based,
			Meta: meta, Blocks: blocks, AuthorID: &d.OwnerID, AuthorName: d.OwnerName}
		if err := appendRevision(ctx, tx, rev, hashes); err != nil {
			return nil, number, err
		}
	} else {
		blocks, err := loadBlocks(ctx, tx, hashes)
		if err != nil {
			return nil, number, err
		}
		rev = &revision{StoryID: d.StoryID, Source: "create", Meta: meta, Blocks: blocks, AuthorID: &d.OwnerID, AuthorName: d.OwnerName}
		if err := createChapter(ctx, tx, rev); err != nil {
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
		if err := afterDecision(ctx, tx, id, "merged", actorID, actorName); err != nil {
			return nil, number, err
		}
	}
	if err := logActivity(ctx, tx, d.StoryID, actorID, actorName, action, d, nil); err != nil {
		return nil, number, err
	}
	_, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'published', chapter_id = $2, published_version = $3, schedule_error = NULL, updated_at = NOW() WHERE id = $1`,
		id, rev.ChapterID, rev.Version)
	return rev, number, err
}

var errEmptyTitle = errors.New("empty title")

// ---- public (/api/ws, the owner) ------------------------------------------------------------------------

// GET /drafts?story_id=: the caller's open drafts, newest first (no blocks).
func (s *server) handleDraftList(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	story := r.URL.Query().Get("story_id")
	if story != "" && !isUUID(story) {
		story = ""
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+draftColumns+` FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		WHERE d.owner_id = $1 AND d.status IN ('open', 'submitted', 'offered', 'scheduled') AND ($2 = '' OR d.story_id::text = $2) ORDER BY d.updated_at DESC LIMIT 100`, user, story)
	if err != nil {
		internalError(w, r, err)
		return
	}
	defer rows.Close()
	type item struct {
		*draft
		BlockCount int `json:"block_count"`
	}
	list := []item{}
	for rows.Next() {
		d, hashes, err := scanDraft(rows)
		if err != nil {
			internalError(w, r, err)
			return
		}
		list = append(list, item{d, len(hashes)})
	}
	if err := rows.Err(); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, list)
}

// draftOwner: the signed-in caller, when they own draft {id}; writes the error response otherwise.
func (s *server) draftOwner(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	id, user := r.PathValue("id"), s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return "", "", false
	}
	var owner string
	err := s.db.QueryRow(r.Context(), `SELECT owner_id::text FROM chapter_drafts WHERE id = $1`, id).Scan(&owner)
	if !isUUID(id) || errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "Bản nháp không tồn tại.")
		return "", "", false
	}
	if err != nil {
		internalError(w, r, err)
		return "", "", false
	}
	if owner != user {
		fail(w, 403, "Đây không phải bản nháp của bạn.")
		return "", "", false
	}
	return id, user, true
}

// DELETE /drafts/{id}: discard (kept in the database, no longer listed or editable).
func (s *server) handleDraftDiscard(w http.ResponseWriter, r *http.Request) {
	id, user, allowed := s.draftOwner(w, r)
	if !allowed {
		return
	}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if _, _, err := openOwnDraft(r.Context(), tx, id, user); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `UPDATE chapter_drafts SET status = 'discarded', updated_at = NOW() WHERE id = $1`, id)
		return err
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, map[string]any{"id": id})
}

// pullPlan: the three-way merge of the draft with the current official version.
type pullPlan struct {
	From          int            `json:"from"`
	To            int            `json:"to"`
	Chunks        []mergeChunk   `json:"chunks"`
	MetaConflicts []metaConflict `json:"meta_conflicts"`
	Meta          chapterMeta    `json:"meta"` // merged fields (a conflicting one shows ours)
	theirs        chapterMeta
}

func planPull(ctx context.Context, tx pgx.Tx, d *draft, ours []string) (*pullPlan, error) {
	if d.ChapterID == nil || d.BaseVersion == nil {
		return nil, errNotFound
	}
	if d.ChapterDeleted {
		return nil, errDeleted
	}
	base, baseHashes, err := loadRevision(ctx, tx, *d.ChapterID, *d.BaseVersion)
	if err != nil {
		return nil, err
	}
	cur, curHashes, err := loadRevision(ctx, tx, *d.ChapterID, *d.CurrentVersion)
	if err != nil {
		return nil, err
	}
	p := &pullPlan{From: *d.BaseVersion, To: *d.CurrentVersion, Chunks: merge3(baseHashes, ours, curHashes), theirs: cur.Meta}
	p.Meta, p.MetaConflicts = mergeMeta(base.Meta, d.Meta, cur.Meta)
	if p.MetaConflicts == nil {
		p.MetaConflicts = []metaConflict{}
	}
	if p.Chunks == nil {
		p.Chunks = []mergeChunk{}
	}
	return p, nil
}

// GET /drafts/{id}/pull: what updating from the official version would do, with the data of every block involved.
func (s *server) handlePullPreview(w http.ResponseWriter, r *http.Request) {
	acc, _, _, allowed := s.accessDraft(w, r, "owner", "editor")
	if !allowed {
		return
	}
	id := acc.ID
	var out map[string]any
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		d, ours, err := loadDraft(r.Context(), tx, id, false)
		if err != nil {
			return err
		}
		if d.Status != "open" {
			return errDraftClosed
		}
		p, err := planPull(r.Context(), tx, d, ours)
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
		out = map[string]any{"plan": p, "blocks": blocks, "draft_version": d.Version}
		return nil
	})
	if err != nil {
		if errors.Is(err, errNotFound) {
			fail(w, 400, "Nháp chương mới không có bản chính để cập nhật theo.")
			return
		}
		s.draftError(w, r, err)
		return
	}
	ok(w, out)
}

// POST /drafts/{id}/pull {expected_version, to_version, choices}: apply the merge; the draft is then based on to_version.
func (s *server) handlePullApply(w http.ResponseWriter, r *http.Request) {
	acc, user, p, allowed := s.accessDraft(w, r, "owner", "editor")
	if !allowed {
		return
	}
	id := acc.ID
	var b struct {
		ExpectedVersion int               `json:"expected_version"`
		ToVersion       int               `json:"to_version"`
		Choices         map[string]string `json:"choices"`
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "invalid body")
		return
	}
	var choiceErr error
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		d, ours, err := s.editableDraft(r.Context(), tx, id, user, &p.Name)
		if err != nil {
			return err
		}
		if d.Version != b.ExpectedVersion {
			return errConflict
		}
		p, err := planPull(r.Context(), tx, d, ours)
		if err != nil {
			return err
		}
		if p.To != b.ToVersion { // the official line moved again since the preview: choices may not fit any more
			return errBehind
		}
		hashes, meta, err := resolve(p.Chunks, p.Meta, p.MetaConflicts, p.theirs, b.Choices)
		if err != nil {
			choiceErr = err
			return err
		}
		metaJSON, _ := json.Marshal(meta)
		_, err = tx.Exec(r.Context(), `UPDATE chapter_drafts SET meta = $2, blocks = $3, base_version = $4, version = version + 1, updated_at = NOW()
			WHERE id = $1`, id, metaJSON, hashes, p.To)
		return err
	})
	switch {
	case choiceErr != nil:
		fail(w, 400, choiceErr.Error())
	case errors.Is(err, errBehind):
		fail(w, 409, "Bản chính thức vừa thay đổi thêm lần nữa. Hãy xem lại phần cập nhật.")
	case errors.Is(err, errNotFound):
		fail(w, 400, "Nháp chương mới không có bản chính để cập nhật theo.")
	case err != nil:
		s.draftError(w, r, err)
	default:
		s.writeDraft(w, r, id, 200)
	}
}
