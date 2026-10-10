package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type chapterMeta struct {
	Title         string  `json:"title"`
	ChapterNumber float64 `json:"chapter_number"`
	VolumeID      *string `json:"volume_id"`
	IntroNote     *string `json:"intro_note"`
	OutroNote     *string `json:"outro_note"`
}

// revision is what the backend applies to its reading copy (also the workspace.revision.merged event data).
type revision struct {
	ChapterID  string      `json:"chapter_id"`
	StoryID    string      `json:"story_id"`
	Version    int         `json:"version"`
	Deleted    bool        `json:"deleted"`
	Source     string      `json:"source"`
	BasedOn    *int        `json:"based_on"`
	Meta       chapterMeta `json:"meta"`
	Blocks     []block     `json:"blocks"`
	AuthorID   *string     `json:"author_id"`
	AuthorName *string     `json:"author_name"`
	CreatedAt  time.Time   `json:"created_at"`
}

var (
	errNumberTaken = errors.New("number taken")
	errNotFound    = errors.New("not found")
	errConflict    = errors.New("version conflict")
	errDeleted     = errors.New("chapter deleted")
)

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

type head struct {
	StoryID string
	Version int
	Deleted bool
}

func lockHead(ctx context.Context, tx pgx.Tx, id string) (head, error) {
	var h head
	err := tx.QueryRow(ctx, `SELECT story_id::text, current_version, deleted FROM chapter_heads WHERE chapter_id = $1 FOR UPDATE`, id).
		Scan(&h.StoryID, &h.Version, &h.Deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return h, errNotFound
	}
	return h, err
}

// appendRevision stores version rev.Version (blocks already hashed), moves the head and queues the event.
func appendRevision(ctx context.Context, tx pgx.Tx, rev *revision, hashes []string) error {
	_, err := tx.Exec(ctx, `UPDATE chapter_heads SET current_version = $2, deleted = $3, chapter_number = $4 WHERE chapter_id = $1`,
		rev.ChapterID, rev.Version, rev.Deleted, rev.Meta.ChapterNumber)
	if isNumberTaken(err) {
		return errNumberTaken
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
	return enqueueEvent(ctx, tx, "workspace.revision.merged", rev.Version, rev)
}

func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

func isNumberTaken(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505" && pg.ConstraintName == "chapter_heads_number"
}

// createChapter makes v1 of a new chapter (id given by the importer; otherwise a new UUID).
func createChapter(ctx context.Context, tx pgx.Tx, rev *revision) error {
	if rev.ChapterID == "" {
		rev.ChapterID = newUUID()
	}
	rev.Version = 1
	// current_version 0 until appendRevision stores v1 (revisions reference the head)
	_, err := tx.Exec(ctx, `INSERT INTO chapter_heads (chapter_id, story_id, chapter_number, current_version, deleted) VALUES ($1, $2, $3, 0, FALSE)`,
		rev.ChapterID, rev.StoryID, rev.Meta.ChapterNumber)
	if isNumberTaken(err) {
		return errNumberTaken
	}
	if err != nil {
		return err
	}
	hashes, err := storeBlocks(ctx, tx, rev.Blocks)
	if err != nil {
		return err
	}
	return appendRevision(ctx, tx, rev, hashes)
}

// loadRevision reads one stored version with its blocks.
func loadRevision(ctx context.Context, tx pgx.Tx, id string, version int) (*revision, []string, error) {
	rev := &revision{ChapterID: id, Version: version}
	var meta []byte
	var hashes []string
	err := tx.QueryRow(ctx, `SELECT story_id::text, meta, blocks, deleted, source, based_on, author_id::text, author_name, created_at
		FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`, id, version).
		Scan(&rev.StoryID, &meta, &hashes, &rev.Deleted, &rev.Source, &rev.BasedOn, &rev.AuthorID, &rev.AuthorName, &rev.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, errNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if err := json.Unmarshal(meta, &rev.Meta); err != nil {
		return nil, nil, err
	}
	if rev.Blocks, err = loadBlocks(ctx, tx, hashes); err != nil {
		return nil, nil, err
	}
	return rev, hashes, nil
}

// copyVersion appends a version that equals `from` (rewind, restore) or the current one marked deleted (delete).
func copyVersion(ctx context.Context, tx pgx.Tx, id string, h head, from int, source string, deleted bool, authorID, authorName *string) (*revision, error) {
	rev, hashes, err := loadRevision(ctx, tx, id, from)
	if err != nil {
		return nil, err
	}
	based := from
	rev.Version, rev.Deleted, rev.Source, rev.BasedOn = h.Version+1, deleted, source, &based
	rev.AuthorID, rev.AuthorName, rev.CreatedAt = authorID, authorName, time.Time{}
	if deleted {
		rev.Blocks = []block{} // the reader copy only needs to know it is gone; history keeps the content
	}
	if err := appendRevision(ctx, tx, rev, hashes); err != nil {
		return nil, err
	}
	return rev, nil
}

// ---- internal API (backend → workspace; content already validated and sanitized by the backend) ----------

type writeBody struct {
	StoryID         string      `json:"story_id"`
	Meta            chapterMeta `json:"meta"`
	Blocks          []block     `json:"blocks"`
	ExpectedVersion int         `json:"expected_version"`
	AuthorID        *string     `json:"author_id"`
	AuthorName      *string     `json:"author_name"`
}

func (s *server) writeError(w http.ResponseWriter, r *http.Request, err error, number float64) {
	switch {
	case errors.Is(err, errNumberTaken):
		fail(w, 409, "Chương "+strconv.FormatFloat(number, 'f', -1, 64)+" đã có trong bộ truyện này.")
	case errors.Is(err, errNotFound):
		fail(w, 404, "Chương không tồn tại.")
	case errors.Is(err, errConflict):
		fail(w, 409, "Chương vừa được người khác sửa. Hãy tải lại để xem bản mới nhất rồi sửa tiếp.")
	case errors.Is(err, errDeleted):
		fail(w, 409, "Chương này đã bị xóa.")
	default:
		internalError(w, r, err)
	}
}

func (s *server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var b writeBody
	if readJSON(w, r, &b) != nil || !isUUID(b.StoryID) || b.Meta.Title == "" {
		fail(w, 400, "invalid body")
		return
	}
	rev := &revision{StoryID: b.StoryID, Source: "create", Meta: b.Meta, Blocks: b.Blocks, AuthorID: b.AuthorID, AuthorName: b.AuthorName}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error { return createChapter(r.Context(), tx, rev) })
	if err != nil {
		s.writeError(w, r, err, b.Meta.ChapterNumber)
		return
	}
	writeJSON(w, 201, map[string]any{"success": true, "data": rev})
}

func (s *server) handleEdit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b writeBody
	if !isUUID(id) || readJSON(w, r, &b) != nil || b.Meta.Title == "" {
		fail(w, 400, "invalid body")
		return
	}
	ctx := r.Context()
	var rev *revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := lockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		if h.Deleted {
			return errDeleted
		}
		if b.ExpectedVersion != 0 && b.ExpectedVersion != h.Version {
			return errConflict
		}
		hashes, err := storeBlocks(ctx, tx, b.Blocks)
		if err != nil {
			return err
		}
		based := h.Version
		rev = &revision{ChapterID: id, StoryID: h.StoryID, Version: h.Version + 1, Source: "edit", BasedOn: &based,
			Meta: b.Meta, Blocks: b.Blocks, AuthorID: b.AuthorID, AuthorName: b.AuthorName}
		if err := appendRevision(ctx, tx, rev, hashes); err != nil {
			return err
		}
		rev.Blocks, err = loadBlocks(ctx, tx, hashes) // positional ids as stored
		return err
	})
	if err != nil {
		s.writeError(w, r, err, b.Meta.ChapterNumber)
		return
	}
	ok(w, rev)
}

func (s *server) handleDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b writeBody
	readJSON(w, r, &b)
	if !isUUID(id) {
		fail(w, 404, "Chương không tồn tại.")
		return
	}
	ctx := r.Context()
	var rev *revision
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := lockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		if h.Deleted {
			return errDeleted
		}
		rev, err = copyVersion(ctx, tx, id, h, h.Version, "delete", true, b.AuthorID, b.AuthorName)
		return err
	})
	if err != nil {
		s.writeError(w, r, err, 0)
		return
	}
	ok(w, rev)
}

func (s *server) handleCurrent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !isUUID(id) {
		fail(w, 404, "Chương không tồn tại.")
		return
	}
	var rev *revision
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		var v int
		if err := tx.QueryRow(r.Context(), `SELECT current_version FROM chapter_heads WHERE chapter_id = $1`, id).Scan(&v); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNotFound
			}
			return err
		}
		var err error
		rev, _, err = loadRevision(r.Context(), tx, id, v)
		return err
	})
	if err != nil {
		s.writeError(w, r, err, 0)
		return
	}
	ok(w, rev)
}

// ---- public API (/api/ws/*, signed user headers) ------------------------------------------------------------

// chapterAccess: the caller and their rights on the chapter's story; writes the error response itself.
func (s *server) chapterAccess(w http.ResponseWriter, r *http.Request, needKeeper bool) (string, string, perm, bool) {
	id := r.PathValue("id")
	user := s.userFrom(r)
	if user == "" {
		fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return "", "", perm{}, false
	}
	var story string
	err := s.db.QueryRow(r.Context(), `SELECT story_id::text FROM chapter_heads WHERE chapter_id = $1`, id).Scan(&story)
	if !isUUID(id) || errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "Chương không tồn tại.")
		return "", "", perm{}, false
	}
	if err != nil {
		internalError(w, r, err)
		return "", "", perm{}, false
	}
	p, err := s.permission(r.Context(), user, story)
	if err != nil {
		internalError(w, r, err)
		return "", "", perm{}, false
	}
	if needKeeper && !p.Keeper {
		fail(w, 403, "Chỉ người giữ truyện (chủ truyện, Trưởng nhóm/Mod của nhóm) mới khôi phục được phiên bản.")
		return "", "", perm{}, false
	}
	if !p.Contributor {
		fail(w, 403, "Bạn không tham gia truyện này nên không xem được lịch sử chương.")
		return "", "", perm{}, false
	}
	return id, user, p, true
}

func (s *server) handleRevisions(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := s.chapterAccess(w, r, false)
	if !allowed {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT version, source, deleted, based_on, author_id::text, author_name, created_at,
			meta->>'title', (meta->>'chapter_number')::numeric::float8, cardinality(blocks)
		FROM chapter_revisions WHERE chapter_id = $1 ORDER BY version DESC`, id)
	if err != nil {
		internalError(w, r, err)
		return
	}
	type item struct {
		Version    int       `json:"version"`
		Source     string    `json:"source"`
		Deleted    bool      `json:"deleted"`
		BasedOn    *int      `json:"based_on"`
		AuthorID   *string   `json:"author_id"`
		AuthorName *string   `json:"author_name"`
		CreatedAt  time.Time `json:"created_at"`
		Title      string    `json:"title"`
		Number     float64   `json:"chapter_number"`
		Blocks     int       `json:"block_count"`
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (item, error) {
		var x item
		return x, row.Scan(&x.Version, &x.Source, &x.Deleted, &x.BasedOn, &x.AuthorID, &x.AuthorName, &x.CreatedAt, &x.Title, &x.Number, &x.Blocks)
	})
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, list)
}

func (s *server) handleRevision(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := s.chapterAccess(w, r, false)
	if !allowed {
		return
	}
	v, _ := strconv.Atoi(r.PathValue("version"))
	var rev *revision
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) (err error) { rev, _, err = loadRevision(r.Context(), tx, id, v); return })
	if errors.Is(err, errNotFound) {
		fail(w, 404, "Không có phiên bản này.")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, rev)
}

// GET /chapters/{id}/compare?from=&to=: block-level diff (by hash) plus the data of every block involved.
func (s *server) handleCompare(w http.ResponseWriter, r *http.Request) {
	id, _, _, allowed := s.chapterAccess(w, r, false)
	if !allowed {
		return
	}
	from, _ := strconv.Atoi(r.URL.Query().Get("from"))
	to, _ := strconv.Atoi(r.URL.Query().Get("to"))
	var out map[string]any
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		a, ha, err := loadRevision(r.Context(), tx, id, from)
		if err != nil {
			return err
		}
		b, hb, err := loadRevision(r.Context(), tx, id, to)
		if err != nil {
			return err
		}
		data, err := blockData(r.Context(), tx, append(append([]string{}, ha...), hb...))
		if err != nil {
			return err
		}
		blocks := map[string]json.RawMessage{}
		for h, d := range data {
			blocks[h] = d
		}
		out = map[string]any{"from": revisionHeader(a), "to": revisionHeader(b), "ops": diffHashes(ha, hb), "blocks": blocks}
		return nil
	})
	if errors.Is(err, errNotFound) {
		fail(w, 404, "Không có phiên bản này.")
		return
	}
	if err != nil {
		internalError(w, r, err)
		return
	}
	ok(w, out)
}

func revisionHeader(r *revision) map[string]any {
	return map[string]any{"version": r.Version, "meta": r.Meta, "deleted": r.Deleted, "source": r.Source,
		"author_name": r.AuthorName, "created_at": r.CreatedAt}
}

// POST /chapters/{id}/rewind {to_version}: keepers bring back an old version as a new one (also undeletes).
func (s *server) handleRewind(w http.ResponseWriter, r *http.Request) {
	id, user, p, allowed := s.chapterAccess(w, r, true)
	if !allowed {
		return
	}
	if p.Removed {
		fail(w, 409, "Truyện đang bị gỡ: chưa thể thay đổi bản chính thức cho tới khi được khôi phục.")
		return
	}
	var b struct {
		To int `json:"to_version"`
	}
	if readJSON(w, r, &b) != nil || b.To < 1 {
		fail(w, 400, "Thiếu phiên bản cần khôi phục.")
		return
	}
	ctx := r.Context()
	var rev *revision
	var number float64
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		h, err := lockHead(ctx, tx, id)
		if err != nil {
			return err
		}
		var targetDeleted bool
		if err := tx.QueryRow(ctx, `SELECT deleted, (meta->>'chapter_number')::numeric::float8 FROM chapter_revisions WHERE chapter_id = $1 AND version = $2`,
			id, b.To).Scan(&targetDeleted, &number); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errNotFound
			}
			return err
		}
		if targetDeleted {
			return fmt.Errorf("%w: target is a deletion", errNotFound)
		}
		source := "rewind"
		if h.Deleted {
			source = "restore"
		}
		name := p.Name
		rev, err = copyVersion(ctx, tx, id, h, b.To, source, false, &user, &name)
		return err
	})
	if err != nil {
		if errors.Is(err, errNotFound) {
			fail(w, 404, "Không có phiên bản này (hoặc đó là bản đã xóa).")
			return
		}
		s.writeError(w, r, err, number)
		return
	}
	ok(w, rev)
}
