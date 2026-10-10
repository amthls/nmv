package main

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// Scheduled publishing (stage 4c, Plan/chapter-workspace.md): a keeper picks a time instead of publishing now. The
// draft waits locked (status scheduled); a loop publishes it when the time comes exactly as a manual publish would,
// or puts it back with the reason if it no longer can (official line clashing, number taken, story taken down...).

var errScheduled = errors.New("draft is scheduled")

// POST /internal/drafts/{id}/schedule {owner_id = the caller, owner_name, publish_at}: schedule (or move) a publish.
// The backend checked the caller keeps the story and the content is publishable.
func (s *server) handleSchedule(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var b struct {
		OwnerID   string    `json:"owner_id"`
		OwnerName *string   `json:"owner_name"`
		PublishAt time.Time `json:"publish_at"`
	}
	if !isUUID(id) || readJSON(w, r, &b) != nil || !isUUID(b.OwnerID) {
		fail(w, 400, "invalid body")
		return
	}
	if b.PublishAt.Before(s.now().Add(time.Minute)) || b.PublishAt.After(s.now().AddDate(1, 0, 0)) {
		fail(w, 400, "Giờ đăng phải từ 1 phút tới 1 năm nữa.")
		return
	}
	err := pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		d, _, err := loadDraft(ctx, tx, id, true)
		if err != nil {
			return err
		}
		prev := d.Status
		switch {
		case d.Status == "scheduled":
			prev = *d.SchedulePrev // moving the time
		case d.Status == "submitted":
		case d.Status != "open":
			return errDraftClosed
		case d.OwnerID != b.OwnerID:
			return errNotOwner
		}
		if d.ChapterDeleted {
			return errDeleted
		}
		if _, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'scheduled', schedule_prev = $2, publish_at = $3, scheduled_by = $4, scheduled_name = $5,
				schedule_error = NULL, lock_user = NULL, updated_at = NOW() WHERE id = $1`, id, prev, b.PublishAt, b.OwnerID, b.OwnerName); err != nil {
			return err
		}
		return logActivity(ctx, tx, d.StoryID, b.OwnerID, b.OwnerName, "publish_scheduled", d, nil)
	})
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

// DELETE /drafts/{id}/schedule: a keeper (or whoever scheduled it) calls it off; the draft goes back as it was.
func (s *server) handleUnschedule(w http.ResponseWriter, r *http.Request) {
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
	if !p.Keeper {
		fail(w, 403, "Chỉ người giữ truyện hủy được hẹn đăng.")
		return
	}
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = schedule_prev, publish_at = NULL, updated_at = NOW() WHERE id = $1 AND status = 'scheduled'`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errNotScheduled
		}
		return logActivity(ctx, tx, d.StoryID, user, &p.Name, "publish_unscheduled", d, nil)
	})
	if errors.Is(err, errNotScheduled) {
		fail(w, 409, "Bản nháp này không còn hẹn giờ (có thể vừa được đăng).")
		return
	}
	if err != nil {
		s.draftError(w, r, err)
		return
	}
	s.writeDraft(w, r, id, 200)
}

var errNotScheduled = errors.New("not scheduled")

// publishDue publishes every scheduled draft whose time has come; returns how many went out. Safe with several copies
// of the service: each draft is taken with FOR UPDATE SKIP LOCKED.
func (s *server) publishDue(ctx context.Context) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, story_id::text, scheduled_by::text, scheduled_name FROM chapter_drafts
		WHERE status = 'scheduled' AND publish_at <= $1 ORDER BY publish_at LIMIT 50`, s.now())
	if err != nil {
		return 0, err
	}
	type due struct {
		id, story, by string
		name          *string
	}
	var list []due
	for rows.Next() {
		var x due
		if err := rows.Scan(&x.id, &x.story, &x.by, &x.name); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, x)
	}
	rows.Close()
	published := 0
	for _, x := range list {
		var failure error
		if p, err := s.permission(ctx, x.by, x.story); err != nil {
			return published, err // backend unreachable: try again next round
		} else if p.Removed {
			failure = errStoryRemoved
		}
		if failure == nil {
			err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
				var still bool
				if err := tx.QueryRow(ctx, `SELECT TRUE FROM chapter_drafts WHERE id = $1 AND status = 'scheduled' AND publish_at <= $2 FOR UPDATE SKIP LOCKED`,
					x.id, s.now()).Scan(&still); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return errNotScheduled // cancelled, moved or taken by another copy meanwhile
					}
					return err
				}
				_, _, err := publishTx(ctx, tx, x.id, x.by, x.name, true)
				return err
			})
			switch {
			case err == nil:
				published++
				continue
			case errors.Is(err, errNotScheduled):
				continue
			}
			failure = err
		}
		msg := scheduleFailure(failure)
		logf(ctx, "warn", "scheduled publish failed: "+failure.Error(), "draft", x.id)
		if _, err := s.db.Exec(ctx, `UPDATE chapter_drafts SET status = schedule_prev, publish_at = NULL, schedule_error = $2, updated_at = NOW()
			WHERE id = $1 AND status = 'scheduled'`, x.id, msg); err != nil {
			return published, err
		}
	}
	return published, nil
}

var errStoryRemoved = errors.New("story removed")

func scheduleFailure(err error) string {
	switch {
	case errors.Is(err, errStoryRemoved):
		return "Truyện đang bị gỡ nên chưa đăng được."
	case errors.Is(err, errMergeConflict), errors.Is(err, errBehind):
		return "Bản chính thức đã đổi trùng chỗ với bản này: cập nhật theo bản chính rồi đăng lại."
	case errors.Is(err, errNumberTaken):
		return "Số chương đã có chương khác dùng: đổi số chương rồi đăng lại."
	case errors.Is(err, errDeleted):
		return "Chương đã bị xóa khỏi bản chính thức."
	case errors.Is(err, errEmptyTitle):
		return "Chương chưa có tiêu đề."
	}
	return "Lỗi hệ thống khi đăng theo giờ hẹn, hãy thử đăng lại."
}

// scheduleLoop checks every 30 s for drafts due to go out.
func (s *server) scheduleLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := s.publishDue(ctx); err != nil {
				logf(ctx, "warn", "scheduled publishing: "+err.Error())
			} else if n > 0 {
				logInfo(ctx, "scheduled publishing: chapters published", "count", n)
			}
		}
	}
}
