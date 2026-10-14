package app

import (
	"context"
	"net/http"
	"time"

	"nmv/messaging/internal/platform/httpx"
)

// Routes lists every route, grouped by what it does. Paths are what the gateway forwards after stripping /api/msg.
func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	au := a.auth

	// health
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, 200, map[string]any{"success": true}) })
	m.HandleFunc("GET /ready", a.ready)

	// realtime pushes
	m.HandleFunc("GET /ws", a.wsH.Serve)

	// Direct messages (same paths and JSON as the backend's former /api/v1/messages)
	m.HandleFunc("GET /messages", au.Authed(a.dmH.Inbox))
	m.HandleFunc("GET /messages/labels", au.Authed(a.dmH.Labels))
	m.HandleFunc("POST /messages/labels", au.Authed(a.dmH.CreateLabel))
	m.HandleFunc("PATCH /messages/labels/{id}", au.Authed(a.dmH.UpdateLabel))
	m.HandleFunc("GET /messages/{username}", au.Authed(a.dmH.Thread))
	m.HandleFunc("POST /messages/{username}", au.Authed(a.dmH.Send))
	m.HandleFunc("PUT /messages/{username}/labels", au.Authed(a.dmH.SetLabels))
	m.HandleFunc("POST /messages/{username}/block", au.Authed(a.dmH.Block(true)))
	// One pattern for both: ServeMux can't rank "labels/{id}" against "{username}/block" ("labels" was never a username:
	// the backend's route order made it a label too)
	m.HandleFunc("DELETE /messages/{username}/{what}", au.Authed(func(w http.ResponseWriter, r *http.Request, me string) {
		switch {
		case r.PathValue("username") == "labels":
			r.SetPathValue("id", r.PathValue("what"))
			a.dmH.DeleteLabel(w, r, me)
		case r.PathValue("what") == "block":
			a.dmH.Block(false)(w, r, me)
		default:
			httpx.Fail(w, 404, "Không tìm thấy.")
		}
	}))
	m.HandleFunc("POST /messages/{username}/pins/{messageId}", au.Authed(a.dmH.Pin(true)))
	m.HandleFunc("DELETE /messages/{username}/pins/{messageId}", au.Authed(a.dmH.Pin(false)))

	// Translation group chat (members only)
	m.HandleFunc("GET /groups/{id}/messages", au.Authed(a.groupH.Messages))
	m.HandleFunc("POST /groups/{id}/messages", au.Authed(a.groupH.Send))
	m.HandleFunc("DELETE /groups/{id}/messages/{messageId}", au.Authed(a.groupH.Delete))

	// Notifications (the bell, /thong-bao) and site-wide announcements
	m.HandleFunc("GET /notifications", au.Authed(a.notifH.List))
	m.HandleFunc("POST /notifications/seen", au.Authed(a.notifH.Seen))
	m.HandleFunc("PUT /notifications/read-all", au.Authed(a.notifH.ReadAll))
	m.HandleFunc("GET /notifications/settings", au.Authed(a.notifH.Settings))
	m.HandleFunc("PUT /notifications/settings", au.Authed(a.notifH.PutSettings))
	m.HandleFunc("PUT /notifications/{id}/read", au.Authed(a.notifH.Read))
	m.HandleFunc("DELETE /notifications/{id}", au.Authed(a.notifH.Delete))
	m.HandleFunc("GET /admin/broadcasts", au.AdminOnly(a.notifH.Broadcasts))
	m.HandleFunc("POST /admin/broadcasts", au.AdminOnly(a.notifH.CreateBroadcast))
	m.HandleFunc("DELETE /admin/broadcasts/{id}", au.AdminOnly(a.notifH.DeleteBroadcast))

	// other services' calls (internal key)
	m.HandleFunc("POST /internal/notifications/jobs", au.Internal(a.notifH.InternalJob))
	m.HandleFunc("POST /internal/dm", au.Internal(a.dmH.InternalSend))
	m.HandleFunc("GET /internal/blocked", au.Internal(a.dmH.Blocked))
	return m
}

func (a *App) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	checks := map[string]any{"database": "ok", "redis": "ok", "connections": a.hub.Count()}
	status := 200
	if err := a.db.Ping(ctx); err != nil {
		checks["database"], status = "down", 503
	}
	if a.rdb == nil || a.rdb.Ping(ctx).Err() != nil {
		checks["redis"], status = "down", 503
	}
	httpx.WriteJSON(w, status, map[string]any{"success": status == 200, "data": checks})
}
