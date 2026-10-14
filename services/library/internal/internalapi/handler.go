package internalapi

import (
	"net/http"
	"strconv"

	"nmv/library/internal/platform/httpx"
)

// Handler serves the /internal routes.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Purge: POST /internal/purge {story_ids?, chapter_ids?}
func (h *Handler) Purge(w http.ResponseWriter, r *http.Request) error {
	var b purgeRequest
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		return err
	}
	if err := h.svc.Purge(r.Context(), b); err != nil {
		return err
	}
	httpx.OK(w, nil)
	return nil
}

// UserOverview: GET /internal/users/{id}/overview
func (h *Handler) UserOverview(w http.ResponseWriter, r *http.Request) error {
	data, err := h.svc.UserOverview(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}

// Favorite: GET /internal/favorites/{user}/{story}
func (h *Handler) Favorite(w http.ResponseWriter, r *http.Request) error {
	data, err := h.svc.Favorite(r.Context(), r.PathValue("user"), r.PathValue("story"))
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}

// AlbumCode: GET /internal/codes/album/{no}?me=
func (h *Handler) AlbumCode(w http.ResponseWriter, r *http.Request) error {
	no, err := strconv.ParseInt(r.PathValue("no"), 10, 64)
	if err != nil {
		return httpx.NotFound("no such album")
	}
	data, err := h.svc.AlbumPath(r.Context(), no, r.URL.Query().Get("me"))
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}

// Followers: GET /internal/stories/{id}/followers?after=&limit=<=1000
func (h *Handler) Followers(w http.ResponseWriter, r *http.Request) error {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	ids, err := h.svc.Followers(r.Context(), r.PathValue("id"), r.URL.Query().Get("after"), limit)
	if err != nil {
		return err
	}
	httpx.OK(w, ids)
	return nil
}

// RecoExport: GET /internal/reco/export?days=
func (h *Handler) RecoExport(w http.ResponseWriter, r *http.Request) error {
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	data, err := h.svc.RecoExport(r.Context(), days)
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}

// RecoUser: GET /internal/reco/user/{id}
func (h *Handler) RecoUser(w http.ResponseWriter, r *http.Request) error {
	data, err := h.svc.RecoUser(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.OK(w, data)
	return nil
}
