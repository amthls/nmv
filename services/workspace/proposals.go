package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Proposals (stage 3, Plan/chapter-workspace.md): a contributor submits a draft; story keepers merge it (through
// publish) or return it with comments. Each submission freezes a round. The backend drives submit / withdraw /
// return (it notifies people); reading a proposal and commenting are public on /api/ws.

type draftRound struct {
	Round         int         `json:"round"`
	BaseVersion   *int        `json:"base_version"`
	Meta          chapterMeta `json:"meta"`
	Note          *string     `json:"note"`
	SubmittedAt   time.Time   `json:"submitted_at"`
	Decision      string      `json:"decision"`
	DecidedName   *string     `json:"decided_name"`
	DecisionNote  *string     `json:"decision_note"`
	DecidedAt     *time.Time  `json:"decided_at"`
	MergedVersion *int        `json:"merged_version"`
	blocks        []string
}

func loadRounds(ctx context.Context, tx pgx.Tx, draftID string) ([]draftRound, error) {
	rows, err := tx.Query(ctx, `SELECT round, base_version, meta, blocks, note, submitted_at, decision, decided_name, decision_note, decided_at, merged_version
		FROM draft_rounds WHERE draft_id = $1 ORDER BY round`, draftID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (draftRound, error) {
		var x draftRound
		var meta []byte
		if err := row.Scan(&x.Round, &x.BaseVersion, &meta, &x.blocks, &x.Note, &x.SubmittedAt, &x.Decision, &x.DecidedName, &x.DecisionNote,
			&x.DecidedAt, &x.MergedVersion); err != nil {
			return x, err
		}
		return x, json.Unmarshal(meta, &x.Meta)
	})
}

type decisionBody struct {
	OwnerID   string  `json:"owner_id"` // the caller
	OwnerName *string `json:"owner_name"`
	Note      string  `json:"note"`
}

func (s *server) readDecision(w http.ResponseWriter, r *http.Request) (string, *decisionBody, bool) {
	id := r.PathValue("id")
	b := &decisionBody{}
	if !isUUID(id) || readJSON(w, r, b) != nil || !isUUID(b.OwnerID) || len(b.Note) > 5000 {
		fail(w, 400, "invalid body")
		return "", nil, false
	}
	b.Note = strings.TrimSpace(b.Note)
	return id, b, true
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// POST /internal/drafts/{id}/submit {owner_id, note}: the owner sends the draft for review (a new round).
func (s *server) handleSubmit(w http.ResponseWriter, r *http.Request) {
	id, b, valid := s.readDecision(w, r)
	if !valid {
		return
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, hashes, err := openOwnDraft(ctx, tx, id, b.OwnerID)
		if err != nil {
			return err
		}
		if err := submitRound(ctx, tx, d, hashes, b.Note); err != nil {
			return err
		}
		return logActivity(ctx, tx, d.StoryID, b.OwnerID, b.OwnerName, "proposal_submitted", d, nil)
	})
	if errors.Is(err, errEmptyTitle) {
		fail(w, 400, "Chương cần có tiêu đề trước khi gửi đề xuất.")
		return
	}
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

// submitRound freezes the draft as a new proposal round and locks it (status submitted).
func submitRound(ctx context.Context, tx pgx.Tx, d *draft, hashes []string, note string) error {
	if d.ChapterDeleted {
		return errDeleted
	}
	if d.Meta.Title == "" {
		return errEmptyTitle
	}
	meta, _ := json.Marshal(d.Meta)
	if _, err := tx.Exec(ctx, `INSERT INTO draft_rounds (draft_id, round, base_version, meta, blocks, note) VALUES ($1, $2, $3, $4, $5, $6)`,
		d.ID, d.LastRound+1, d.BaseVersion, meta, hashes, nullable(note)); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'submitted', last_round = last_round + 1, lock_user = NULL, updated_at = NOW() WHERE id = $1`, d.ID)
	return err
}

// decide closes the pending round of a submitted draft and opens the draft again (withdrawn by its owner, or
// returned by a keeper: the backend checked that).
func (s *server) decide(w http.ResponseWriter, r *http.Request, decision string) {
	id, b, valid := s.readDecision(w, r)
	if !valid {
		return
	}
	ctx := r.Context()
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := loadDraft(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if d.Status != "submitted" {
			return errNotSubmitted
		}
		if decision == "withdrawn" && d.OwnerID != b.OwnerID {
			return errNotOwner
		}
		if _, err := tx.Exec(ctx, `UPDATE draft_rounds SET decision = $3, decided_by = $4, decided_name = $5, decision_note = $6, decided_at = NOW()
			WHERE draft_id = $1 AND round = $2`, id, d.LastRound, decision, b.OwnerID, b.OwnerName, nullable(b.Note)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'open', updated_at = NOW() WHERE id = $1`, id); err != nil {
			return err
		}
		if err := afterDecision(ctx, tx, id, decision, b.OwnerID, b.OwnerName); err != nil {
			return err
		}
		return logActivity(ctx, tx, d.StoryID, b.OwnerID, b.OwnerName, "proposal_"+decision, d, nil)
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

func (s *server) handleWithdraw(w http.ResponseWriter, r *http.Request) { s.decide(w, r, "withdrawn") }
func (s *server) handleReturn(w http.ResponseWriter, r *http.Request)   { s.decide(w, r, "returned") }

// ---- public ----------------------------------------------------------------------------------------------

// GET /proposals?story_id=: drafts waiting for review in a story (keepers see all of them, others their own).
func (s *server) handleProposals(w http.ResponseWriter, r *http.Request) {
	user := s.userFrom(r)
	story := r.URL.Query().Get("story_id")
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
	if !p.Contributor {
		fail(w, 403, "Bạn không tham gia truyện này.")
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT `+draftColumns+`, dr.note, dr.submitted_at
		FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		JOIN draft_rounds dr ON dr.draft_id = d.id AND dr.round = d.last_round
		WHERE d.story_id = $1 AND d.status = 'submitted' AND ($2 OR d.owner_id = $3) ORDER BY dr.submitted_at`, story, p.Keeper, user)
	if err != nil {
		internalError(w, r, err)
		return
	}
	defer rows.Close()
	type item struct {
		*draft
		Note        *string   `json:"note"`
		SubmittedAt time.Time `json:"submitted_at"`
	}
	list := []item{}
	for rows.Next() {
		var it item
		d, _, err := scanDraft(rows, &it.Note, &it.SubmittedAt)
		if err != nil {
			internalError(w, r, err)
			return
		}
		it.draft = d
		list = append(list, it)
	}
	if err := rows.Err(); err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, list)
}

// draftViewer: the caller and their rights when they own draft {id} or keep its story; writes the error otherwise.
func (s *server) draftViewer(w http.ResponseWriter, r *http.Request) (*draft, string, perm, bool) {
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
	p, err := s.permission(r.Context(), user, d.StoryID)
	if err != nil {
		internalError(w, r, err)
		return nil, "", perm{}, false
	}
	if d.OwnerID != user && !(p.Keeper && d.LastRound > 0) {
		fail(w, 403, "Chỉ người viết và người giữ truyện xem được đề xuất này.")
		return nil, "", perm{}, false
	}
	return d, user, p, true
}

// GET /drafts/{id}/review: the latest round against the official version it was based on, against the round
// before, and against the official version now (merge preview), with every block involved and the comments.
func (s *server) handleReview(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := s.draftViewer(w, r)
	if !allowed {
		return
	}
	var out map[string]any
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		rounds, err := loadRounds(ctx, tx, d.ID)
		if err != nil {
			return err
		}
		if len(rounds) == 0 {
			return errNotSubmitted
		}
		last := rounds[len(rounds)-1]
		var base []string
		if d.ChapterID != nil && last.BaseVersion != nil {
			if _, base, err = loadRevision(ctx, tx, *d.ChapterID, *last.BaseVersion); err != nil {
				return err
			}
		}
		involved := append(append([]string{}, base...), last.blocks...)
		var sincePrev []diffOp
		if len(rounds) > 1 {
			prev := rounds[len(rounds)-2].blocks
			sincePrev = diffHashes(prev, last.blocks)
			involved = append(involved, prev...)
		}
		// would merging now need the author to update first?
		conflicts := 0
		if d.Status == "submitted" && d.ChapterID != nil && d.BaseVersion != nil && d.CurrentVersion != nil && *d.CurrentVersion != *d.BaseVersion && !d.ChapterDeleted {
			plan, err := planPull(ctx, tx, d, last.blocks)
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
		type comment struct {
			ID         int64     `json:"id"`
			Round      int       `json:"round"`
			BlockHash  *string   `json:"block_hash"`
			Body       string    `json:"body"`
			AuthorID   string    `json:"author_id"`
			AuthorName *string   `json:"author_name"`
			CreatedAt  time.Time `json:"created_at"`
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
		data, err := blockData(ctx, tx, involved)
		if err != nil {
			return err
		}
		blocks := map[string]json.RawMessage{}
		for h, v := range data {
			blocks[h] = v
		}
		out = map[string]any{
			"draft": d, "rounds": rounds, "round": last.Round, "meta": last.Meta,
			"changes": diffHashes(base, last.blocks), "since_previous": sincePrev,
			"blocks": blocks, "comments": comments, "merge_conflicts": conflicts,
			"is_owner": d.OwnerID == user, "can_merge": p.Keeper, "story_removed": p.Removed,
		}
		return nil
	})
	if errors.Is(err, errNotSubmitted) {
		fail(w, 404, "Bản nháp này chưa gửi đề xuất lần nào.")
		return
	}
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	ok(w, out)
}

// POST /drafts/{id}/comments {body, block_hash?}: the author and the keepers talk about the latest round.
func (s *server) handleComment(w http.ResponseWriter, r *http.Request) {
	d, user, p, allowed := s.draftViewer(w, r)
	if !allowed {
		return
	}
	var b struct {
		Body      string  `json:"body"`
		BlockHash *string `json:"block_hash"`
	}
	if readJSON(w, r, &b) != nil {
		fail(w, 400, "invalid body")
		return
	}
	body := strings.TrimSpace(b.Body)
	if body == "" || len([]rune(body)) > 2000 {
		fail(w, 400, "Góp ý cần có nội dung (tối đa 2000 ký tự).")
		return
	}
	if d.LastRound == 0 {
		fail(w, 404, "Bản nháp này chưa gửi đề xuất lần nào.")
		return
	}
	if b.BlockHash != nil {
		var exists bool
		s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM content_blocks WHERE hash = $1)`, *b.BlockHash).Scan(&exists)
		if !exists {
			fail(w, 400, "Đoạn được góp ý không tồn tại.")
			return
		}
	}
	var id int64
	if err := s.db.QueryRow(r.Context(), `INSERT INTO draft_comments (draft_id, round, block_hash, body, author_id, author_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		d.ID, d.LastRound, b.BlockHash, body, user, p.Name).Scan(&id); err != nil {
		internalError(w, r, err)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": map[string]any{"id": id}})
}
