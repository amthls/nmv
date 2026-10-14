// Package domain holds what chapters, drafts, proposals, tasks and schedule all talk about: the errors a step can end
// with, and the one place that turns them into the Vietnamese answers the clients show. It keeps those packages from
// importing each other in circles.
package domain

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgconn"

	"nmv/workspace/internal/platform/httpx"
)

// Errors of the chapter line (revisions).
var (
	ErrNumberTaken = errors.New("number taken")
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("version conflict")
	ErrDeleted     = errors.New("chapter deleted")
)

// Errors of drafts, proposals and scheduling.
var (
	ErrDraftClosed     = errors.New("draft closed")
	ErrNotOwner        = errors.New("not the owner")
	ErrBehind          = errors.New("official line moved")
	ErrTooMany         = errors.New("too many drafts")
	ErrNotSubmitted    = errors.New("not submitted")
	ErrMergeConflict   = errors.New("proposal conflicts with the official line")
	ErrScheduled       = errors.New("draft is scheduled")
	ErrEmptyTitle      = errors.New("empty title")
	ErrAlreadyHasDraft = errors.New("recipient already has a draft of this chapter")
	ErrNotCopy         = errors.New("not a copy")
	ErrNotScheduled    = errors.New("not scheduled")
	ErrStoryRemoved    = errors.New("story removed")
)

// Errors of tasks.
var (
	ErrTaskBusy  = errors.New("chapter already has an active task")
	ErrTaskState = errors.New("task is not in that state")
)

// LockedError: somebody else holds the edit lock of a draft.
type LockedError struct{ Name string }

func (e *LockedError) Error() string { return "locked by " + e.Name }

// HTTPError is a refusal that already knows its answer (a permission check, a bad value): status and message.
type HTTPError struct {
	Status int
	Msg    string
}

func (e *HTTPError) Error() string { return e.Msg }

// Fail makes an HTTPError.
func Fail(status int, msg string) error { return &HTTPError{status, msg} }

// IsUniqueViolation: Postgres refused a duplicate key.
func IsUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// IsNumberTaken: a chapter number already used in the story.
func IsNumberTaken(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505" && pg.ConstraintName == "chapter_heads_number"
}

// ChapterError answers the errors of the chapter line; anything else is a 500. number is the chapter number the
// caller tried (for the "already taken" message).
func ChapterError(w http.ResponseWriter, r *http.Request, err error, number float64) {
	var he *HTTPError
	switch {
	case errors.As(err, &he):
		httpx.Fail(w, he.Status, he.Msg)
	case errors.Is(err, ErrNumberTaken):
		httpx.Fail(w, 409, "Chương "+strconv.FormatFloat(number, 'f', -1, 64)+" đã có trong bộ truyện này.")
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, 404, "Chương không tồn tại.")
	case errors.Is(err, ErrConflict):
		httpx.Fail(w, 409, "Chương vừa được người khác sửa. Hãy tải lại để xem bản mới nhất rồi sửa tiếp.")
	case errors.Is(err, ErrDeleted):
		httpx.Fail(w, 409, "Chương này đã bị xóa.")
	default:
		httpx.InternalError(w, r, err)
	}
}

// DraftError answers the errors of drafts, proposals and scheduling; anything else is a 500.
func DraftError(w http.ResponseWriter, r *http.Request, err error) {
	var locked *LockedError
	var he *HTTPError
	switch {
	case errors.As(err, &he):
		httpx.Fail(w, he.Status, he.Msg)
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, 404, "Bản nháp không tồn tại.")
	case errors.Is(err, ErrNotOwner):
		httpx.Fail(w, 403, "Đây không phải bản nháp của bạn.")
	case errors.Is(err, ErrDraftClosed):
		httpx.Fail(w, 409, "Bản nháp này đã gửi đề xuất, đã đăng hoặc đã bỏ nên không sửa được. Đã gửi thì rút lại để sửa tiếp.")
	case errors.Is(err, ErrScheduled):
		httpx.Fail(w, 409, "Bản nháp đang hẹn giờ đăng: hủy hẹn trước nếu muốn sửa hay đăng ngay.")
	case errors.Is(err, ErrNotSubmitted):
		httpx.Fail(w, 409, "Bản nháp này không ở trạng thái chờ duyệt.")
	case errors.Is(err, ErrMergeConflict):
		httpx.Fail(w, 409, "Đề xuất sửa trùng chỗ với bản chính thức đã thay đổi. Hãy trả lại để người viết cập nhật theo bản chính.")
	case errors.Is(err, ErrConflict):
		httpx.Fail(w, 409, "Bản nháp vừa được lưu ở nơi khác (tab hoặc máy khác). Hãy tải lại để xem bản mới nhất.")
	case errors.Is(err, ErrBehind):
		httpx.Fail(w, 409, "Bản chính thức đã thay đổi từ khi bạn mở nháp. Hãy bấm \"Cập nhật theo bản chính\" trước khi đăng.")
	case errors.Is(err, ErrDeleted):
		httpx.Fail(w, 409, "Chương này đã bị xóa khỏi bản chính thức.")
	case errors.As(err, &locked):
		httpx.Fail(w, 409, locked.Name+" đang sửa bản nháp này. Bạn chỉ xem được cho tới khi họ rời đi (khóa tự nhả sau 2 phút không gõ).")
	case errors.Is(err, ErrAlreadyHasDraft):
		httpx.Fail(w, 409, "Người này đã có một bản nháp đang mở của chương này.")
	case errors.Is(err, ErrTooMany):
		httpx.Fail(w, 409, "Bạn đang có 50 bản nháp đang mở. Hãy đăng hoặc bỏ bớt nháp cũ trước.")
	default:
		httpx.InternalError(w, r, err)
	}
}

// TaskError answers the errors of tasks, then those of drafts.
func TaskError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrTaskBusy):
		httpx.Fail(w, 409, "Chương này đang có việc chưa xong (đang chờ nhận, đang làm hoặc chờ gộp).")
	case errors.Is(err, ErrTaskState):
		httpx.Fail(w, 409, "Việc này không còn ở trạng thái đó (có người vừa nhận, đã xong hoặc đã hủy).")
	case errors.Is(err, ErrNotFound):
		httpx.Fail(w, 404, "Không có việc này.")
	default:
		DraftError(w, r, err)
	}
}
