package app

import (
	"net/http"

	"nmv/workspace/internal/platform/httpx"
)

// Routes lists every route, grouped by what it does. Public paths are what the gateway forwards after stripping
// /api/ws; /internal is for the backend only.
func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	in := a.auth.Internal

	// health
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { httpx.OK(w, nil) })
	m.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		if err := a.db.Ping(r.Context()); err != nil {
			httpx.WriteJSON(w, 503, map[string]any{"success": false, "data": map[string]string{"database": "down"}})
			return
		}
		httpx.OK(w, map[string]string{"database": "ok"})
	})

	// chapter history
	m.HandleFunc("GET /chapters/{id}/revisions", a.chaptersH.Revisions)
	m.HandleFunc("GET /chapters/{id}/revisions/{version}", a.chaptersH.Revision)
	m.HandleFunc("GET /chapters/{id}/compare", a.chaptersH.Compare)
	m.HandleFunc("POST /chapters/{id}/rewind", a.chaptersH.Rewind)

	// drafts, working together on them
	m.HandleFunc("GET /drafts", a.draftsH.List)
	m.HandleFunc("GET /drafts/{id}", a.draftsH.Get)
	m.HandleFunc("DELETE /drafts/{id}", a.draftsH.Discard)
	m.HandleFunc("GET /drafts/{id}/pull", a.draftsH.PullPreview)
	m.HandleFunc("POST /drafts/{id}/pull", a.draftsH.PullApply)
	m.HandleFunc("POST /drafts/{id}/lock", a.draftsH.Lock)
	m.HandleFunc("DELETE /drafts/{id}/lock", a.draftsH.Unlock)
	m.HandleFunc("DELETE /drafts/{id}/shares/{user}", a.draftsH.Unshare)
	m.HandleFunc("POST /drafts/{id}/copy", a.draftsH.Copy)
	m.HandleFunc("GET /drafts/{id}/offers/{copy}", a.draftsH.OfferPreview)
	m.HandleFunc("POST /drafts/{id}/offers/{copy}", a.draftsH.OfferAccept)
	m.HandleFunc("DELETE /drafts/{id}/offers/{copy}", a.draftsH.OfferDecline)
	m.HandleFunc("GET /drafts/orphans", a.draftsH.Orphans)
	m.HandleFunc("GET /drafts/shared", a.draftsH.SharedWithMe)
	m.HandleFunc("POST /drafts/{id}/reclaim", a.draftsH.Reclaim)
	m.HandleFunc("GET /drafts/{id}/card", a.draftsH.Card)

	// proposals
	m.HandleFunc("GET /proposals", a.proposalsH.List)
	m.HandleFunc("GET /drafts/{id}/review", a.proposalsH.Review)
	m.HandleFunc("POST /drafts/{id}/comments", a.proposalsH.Comment)

	// tasks and the board
	m.HandleFunc("POST /tasks", a.tasksH.Create)
	m.HandleFunc("GET /tasks", a.tasksH.List)
	m.HandleFunc("PATCH /tasks/{id}", a.tasksH.Edit)
	m.HandleFunc("POST /tasks/{id}/claim", a.tasksH.Claim)
	m.HandleFunc("POST /tasks/{id}/unclaim", a.tasksH.Unclaim)
	m.HandleFunc("POST /tasks/{id}/start", a.tasksH.Start)
	m.HandleFunc("POST /tasks/{id}/done", a.tasksH.Done)
	m.HandleFunc("POST /tasks/{id}/cancel", a.tasksH.Cancel)
	m.HandleFunc("GET /board", a.boardH.Get)

	// scheduled publishing
	m.HandleFunc("DELETE /drafts/{id}/schedule", a.scheduleH.Unschedule)

	// backend only
	m.HandleFunc("GET /internal/stats", in(a.chaptersH.Stats))
	m.HandleFunc("POST /internal/chapters", in(a.chaptersH.Create))
	m.HandleFunc("GET /internal/chapters/{id}", in(a.chaptersH.Current))
	m.HandleFunc("POST /internal/chapters/{id}/revisions", in(a.chaptersH.Edit))
	m.HandleFunc("POST /internal/chapters/{id}/delete", in(a.chaptersH.Delete))
	m.HandleFunc("POST /internal/drafts", in(a.draftsH.Create))
	m.HandleFunc("GET /internal/drafts/{id}", in(a.draftsH.Internal))
	m.HandleFunc("PUT /internal/drafts/{id}", in(a.draftsH.Save))
	m.HandleFunc("POST /internal/drafts/{id}/publish", in(a.draftsH.Publish))
	m.HandleFunc("POST /internal/drafts/{id}/submit", in(a.proposalsH.Submit))
	m.HandleFunc("POST /internal/drafts/{id}/withdraw", in(a.proposalsH.Withdraw))
	m.HandleFunc("POST /internal/drafts/{id}/return", in(a.proposalsH.Return))
	m.HandleFunc("POST /internal/drafts/{id}/shares", in(a.draftsH.Share))
	m.HandleFunc("POST /internal/drafts/{id}/offer", in(a.draftsH.Offer))
	m.HandleFunc("POST /internal/drafts/{id}/transfer", in(a.draftsH.Transfer))
	m.HandleFunc("POST /internal/drafts/{id}/schedule", in(a.scheduleH.Schedule))
	return m
}
