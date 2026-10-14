package app

import (
	"context"
	"net/http"
	"time"

	"nmv/library/internal/platform/httpx"
)

// Routes lists every route, grouped by what it does. Paths are what the gateway forwards after stripping /api/library
// (same as the backend's former /api/v1 ones).
func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	au := a.auth

	// health
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { httpx.WriteJSON(w, 200, map[string]any{"success": true}) })
	m.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := a.db.Ping(ctx); err != nil {
			httpx.WriteJSON(w, 503, map[string]any{"success": false, "data": map[string]any{"database": "down"}})
			return
		}
		httpx.WriteJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"database": "ok"}})
	})

	// reading history
	m.HandleFunc("GET /history", au.Authed(a.historyH.List))
	m.HandleFunc("POST /history", au.Authed(a.historyH.Save))
	m.HandleFunc("DELETE /history/{id}", au.Authed(a.historyH.Delete))
	m.HandleFunc("DELETE /history", au.Authed(a.historyH.Clear))
	m.HandleFunc("POST /history/merge", au.Authed(a.historyH.Merge))

	// line bookmarks
	m.HandleFunc("GET /bookmarks", au.Authed(a.bookmarkH.List))
	m.HandleFunc("POST /bookmarks", au.Authed(a.bookmarkH.Create))
	m.HandleFunc("DELETE /bookmarks/{id}", au.Authed(a.bookmarkH.Delete))

	// follows
	m.HandleFunc("GET /favorites", au.Authed(a.followsH.List))
	m.HandleFunc("POST /favorites/toggle", au.Authed(a.followsH.Toggle))
	m.HandleFunc("GET /favorites/status/{storyId}", au.Maybe(a.followsH.Status))

	// albums
	m.HandleFunc("GET /albums/me", au.Authed(a.albumsH.Mine))
	m.HandleFunc("GET /albums/saved", au.Authed(a.albumsH.Saved))
	m.HandleFunc("GET /albums/by-story/{storyId}", au.Maybe(a.albumsH.ByStory))
	m.HandleFunc("POST /albums", au.Authed(a.albumsH.Create))
	m.HandleFunc("PUT /albums/me/visibility", au.Authed(a.albumsH.AllVisibility))
	m.HandleFunc("GET /albums/{id}", au.Maybe(a.albumsH.Get))
	m.HandleFunc("PUT /albums/{id}", au.Authed(a.albumsH.Update))
	m.HandleFunc("DELETE /albums/{id}", au.Authed(a.albumsH.Delete))
	m.HandleFunc("POST /albums/{id}/share-link/reset", au.Authed(a.albumsH.ResetShareLink))
	m.HandleFunc("POST /albums/{id}/stories", au.Authed(a.albumsH.AddStory))
	m.HandleFunc("DELETE /albums/{id}/stories/{storyId}", au.Authed(a.albumsH.RemoveStory))
	m.HandleFunc("POST /albums/{id}/save", au.Authed(a.albumsH.Save))
	m.HandleFunc("POST /albums/{id}/copy", au.Authed(a.albumsH.Copy))

	// other services' calls (internal key)
	m.HandleFunc("POST /internal/purge", au.Internal(a.internalH.Purge))
	m.HandleFunc("POST /internal/history", au.Internal(a.historyH.Open))
	m.HandleFunc("GET /internal/users/{id}/overview", au.Internal(a.internalH.UserOverview))
	m.HandleFunc("GET /internal/favorites/{user}/{story}", au.Internal(a.internalH.Favorite))
	m.HandleFunc("GET /internal/codes/album/{no}", au.Internal(a.internalH.AlbumCode))
	m.HandleFunc("GET /internal/stories/{id}/followers", au.Internal(a.internalH.Followers))
	m.HandleFunc("GET /internal/reco/export", au.Internal(a.internalH.RecoExport))
	m.HandleFunc("GET /internal/reco/user/{id}", au.Internal(a.internalH.RecoUser))
	return m
}
