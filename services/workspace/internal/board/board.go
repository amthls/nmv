// Package board is a group's workspace over the stories the caller takes part in: tasks, proposals waiting and recent
// activity, in one answer.
package board

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nmv/workspace/internal/drafts"
	"nmv/workspace/internal/platform/catalog"
	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/proposals"
	"nmv/workspace/internal/tasks"
)

// Handler serves GET /board.
type Handler struct {
	db    *pgxpool.Pool
	auth  httpx.Auth
	perms *catalog.Client
}

// NewHandler wires the handler.
func NewHandler(db *pgxpool.Pool, auth httpx.Auth, perms *catalog.Client) *Handler {
	return &Handler{db: db, auth: auth, perms: perms}
}

type event struct {
	ID        int64           `json:"id"`
	StoryID   string          `json:"story_id"`
	ActorName *string         `json:"actor_name"`
	Action    string          `json:"action"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt time.Time       `json:"created_at"`
}

// Get: GET /board?story_id=…&story_id=…: tasks (active and done in the last 14 days), proposals waiting (keepers see
// all, others their own), recent activity.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	user := h.auth.UserFrom(r)
	if user == "" {
		httpx.Fail(w, 401, "Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.")
		return
	}
	storyIDs := r.URL.Query()["story_id"]
	if len(storyIDs) > 100 {
		storyIDs = storyIDs[:100]
	}
	var stories, kept []string
	for _, id := range storyIDs {
		if !ids.IsUUID(id) || slices.Contains(stories, id) {
			continue
		}
		p, err := h.perms.Permission(r.Context(), user, id)
		if err != nil {
			httpx.InternalError(w, r, err)
			return
		}
		if p.Contributor {
			stories = append(stories, id)
			if p.Keeper {
				kept = append(kept, id)
			}
		}
	}
	out, err := h.load(r.Context(), user, stories, kept)
	if err != nil {
		httpx.InternalError(w, r, err)
		return
	}
	httpx.OK(w, out)
}

func (h *Handler) load(ctx context.Context, user string, stories, kept []string) (map[string]any, error) {
	list, err := tasks.Query(ctx, h.db, `story_id = ANY($1) AND (status IN ('open', 'claimed') OR updated_at > NOW() - INTERVAL '14 days')
		ORDER BY updated_at DESC LIMIT 500`, stories)
	if err != nil {
		return nil, err
	}
	rows, err := h.db.Query(ctx, `SELECT `+drafts.Columns+`, dr.note, dr.submitted_at
		FROM chapter_drafts d LEFT JOIN chapter_heads h ON h.chapter_id = d.chapter_id
		JOIN draft_rounds dr ON dr.draft_id = d.id AND dr.round = d.last_round
		WHERE d.story_id = ANY($1) AND d.status IN ('submitted', 'scheduled') AND (d.story_id = ANY($2) OR d.owner_id = $3) ORDER BY dr.submitted_at`, stories, kept, user)
	if err != nil {
		return nil, err
	}
	props := []proposals.Item{}
	for rows.Next() {
		var it proposals.Item
		d, _, err := drafts.Scan(rows, &it.Note, &it.SubmittedAt)
		if err != nil {
			rows.Close()
			return nil, err
		}
		it.Draft = d
		props = append(props, it)
	}
	rows.Close()
	arows, err := h.db.Query(ctx, `SELECT id, story_id::text, actor_name, action, detail, created_at FROM ws_activity WHERE story_id = ANY($1) ORDER BY id DESC LIMIT 60`, stories)
	if err != nil {
		return nil, err
	}
	activity, err := pgx.CollectRows(arows, func(row pgx.CollectableRow) (event, error) {
		var e event
		return e, row.Scan(&e.ID, &e.StoryID, &e.ActorName, &e.Action, &e.Detail, &e.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"stories": stories, "keeper_of": kept, "tasks": list, "proposals": props, "activity": activity}, nil
}
