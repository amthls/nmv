// Package schedule is scheduled publishing (stage 4c, Plan/chapter-workspace.md): a keeper picks a time instead of
// publishing now. The draft waits locked (status scheduled); a loop publishes it when the time comes exactly as a
// manual publish would, or puts it back with the reason if it no longer can (official line clashing, number taken,
// story taken down...).
package schedule

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/domain"
	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/logger"
)

// Service is the business of scheduling.
type Service struct {
	db     *pgxpool.Pool
	now    func() time.Time
	drafts *drafts.Service
	perms  *catalog.Client
}

// NewService wires the service.
func NewService(db *pgxpool.Pool, now func() time.Time, d *drafts.Service, perms *catalog.Client) *Service {
	return &Service{db: db, now: now, drafts: d, perms: perms}
}

// Request is POST /internal/drafts/{id}/schedule.
type Request struct {
	OwnerID   string    `json:"owner_id"` // the caller
	OwnerName *string   `json:"owner_name"`
	PublishAt time.Time `json:"publish_at"`
}

// Schedule schedules (or moves) a publish. The backend checked the caller keeps the story and the content is publishable.
func (s *Service) Schedule(ctx context.Context, id string, b Request) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		d, _, err := drafts.Load(ctx, tx, id, true)
		if err != nil {
			return err
		}
		prev := d.Status
		switch {
		case d.Status == "scheduled":
			prev = *d.SchedulePrev // moving the time
		case d.Status == "submitted":
		case d.Status != "open":
			return domain.ErrDraftClosed
		case d.OwnerID != b.OwnerID:
			return domain.ErrNotOwner
		}
		if d.ChapterDeleted {
			return domain.ErrDeleted
		}
		if _, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = 'scheduled', schedule_prev = $2, publish_at = $3, scheduled_by = $4, scheduled_name = $5,
				schedule_error = NULL, lock_user = NULL, updated_at = NOW() WHERE id = $1`, id, prev, b.PublishAt, b.OwnerID, b.OwnerName); err != nil {
			return err
		}
		return drafts.LogActivity(ctx, tx, b.OwnerID, b.OwnerName, "publish_scheduled", d)
	})
}

// Unschedule calls a schedule off; the draft goes back as it was. d is the draft as read before the rights check.
func (s *Service) Unschedule(ctx context.Context, id string, d *drafts.Draft, user string, name *string) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE chapter_drafts SET status = schedule_prev, publish_at = NULL, updated_at = NOW() WHERE id = $1 AND status = 'scheduled'`, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return domain.ErrNotScheduled
		}
		return drafts.LogActivity(ctx, tx, user, name, "publish_unscheduled", d)
	})
}

// PublishDue publishes every scheduled draft whose time has come; returns how many went out. Safe with several copies
// of the service: each draft is taken with FOR UPDATE SKIP LOCKED.
func (s *Service) PublishDue(ctx context.Context) (int, error) {
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
		if p, err := s.perms.Permission(ctx, x.by, x.story); err != nil {
			return published, err // backend unreachable: try again next round
		} else if p.Removed {
			failure = domain.ErrStoryRemoved
		}
		if failure == nil {
			err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
				var still bool
				if err := tx.QueryRow(ctx, `SELECT TRUE FROM chapter_drafts WHERE id = $1 AND status = 'scheduled' AND publish_at <= $2 FOR UPDATE SKIP LOCKED`,
					x.id, s.now()).Scan(&still); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return domain.ErrNotScheduled // cancelled, moved or taken by another copy meanwhile
					}
					return err
				}
				_, _, err := s.drafts.PublishTx(ctx, tx, x.id, x.by, x.name, true)
				return err
			})
			switch {
			case err == nil:
				published++
				continue
			case errors.Is(err, domain.ErrNotScheduled):
				continue
			}
			failure = err
		}
		msg := failureMessage(failure)
		logger.Logf(ctx, "warn", "scheduled publish failed: "+failure.Error(), "draft", x.id)
		if _, err := s.db.Exec(ctx, `UPDATE chapter_drafts SET status = schedule_prev, publish_at = NULL, schedule_error = $2, updated_at = NOW()
			WHERE id = $1 AND status = 'scheduled'`, x.id, msg); err != nil {
			return published, err
		}
	}
	return published, nil
}

func failureMessage(err error) string {
	switch {
	case errors.Is(err, domain.ErrStoryRemoved):
		return "Truyện đang bị gỡ nên chưa đăng được."
	case errors.Is(err, domain.ErrMergeConflict), errors.Is(err, domain.ErrBehind):
		return "Bản chính thức đã đổi trùng chỗ với bản này: cập nhật theo bản chính rồi đăng lại."
	case errors.Is(err, domain.ErrNumberTaken):
		return "Số chương đã có chương khác dùng: đổi số chương rồi đăng lại."
	case errors.Is(err, domain.ErrDeleted):
		return "Chương đã bị xóa khỏi bản chính thức."
	case errors.Is(err, domain.ErrEmptyTitle):
		return "Chương chưa có tiêu đề."
	}
	return "Lỗi hệ thống khi đăng theo giờ hẹn, hãy thử đăng lại."
}

// Loop checks every 30 s for drafts due to go out.
func (s *Service) Loop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := s.PublishDue(ctx); err != nil {
				logger.Logf(ctx, "warn", "scheduled publishing: "+err.Error())
			} else if n > 0 {
				logger.Info(ctx, "scheduled publishing: chapters published", "count", n)
			}
		}
	}
}
