package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type server struct {
	cfg config
	db  *pgxpool.Pool
	be  *backendClient
	now func() time.Time
	pos positionBuffer
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, 200, map[string]any{"success": true, "data": data})
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]any{"success": false, "message": msg})
}

// inputError: a message for the caller (400 unless status is set).
type inputError struct {
	status int
	msg    string
}

func (e *inputError) Error() string { return e.msg }

func bad(msg string) error                { return &inputError{400, msg} }
func notFound(msg string) error           { return &inputError{404, msg} }
func failWith(status int, m string) error { return &inputError{status, m} }

// answer writes err: an inputError as is, a malformed id from Postgres as 400, anything else as 500.
func answer(w http.ResponseWriter, r *http.Request, err error) {
	var ie *inputError
	if errors.As(err, &ie) {
		fail(w, ie.status, ie.msg)
		return
	}
	if strings.Contains(err.Error(), "SQLSTATE 22P02") { // invalid uuid / number from the client
		fail(w, 400, "Dữ liệu không hợp lệ.")
		return
	}
	logError(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(requestIDKey).(string)
	fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return bad("Dữ liệu không hợp lệ.")
	}
	return nil
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

// rowMaps reads every row as {column: value}, the shape node-pg gave the old backend handlers (uuid as text,
// numeric as a number, json decoded), so the moved SQL keeps its JSON.
func rowMaps(rows pgx.Rows, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	out := []map[string]any{}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		m := make(map[string]any, len(vals))
		for i, v := range vals {
			m[fields[i].Name] = jsonValue(v)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func jsonValue(v any) any {
	switch x := v.(type) {
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case pgtype.Numeric:
		f, err := x.Float64Value()
		if err != nil || !f.Valid {
			return nil
		}
		return f.Float64
	case *big.Int:
		return x.String()
	case []any:
		for i := range x {
			x[i] = jsonValue(x[i])
		}
	}
	return v
}

func (s *server) maps(ctx context.Context, q pgx.Tx, sql string, args ...any) ([]map[string]any, error) {
	if q != nil {
		return rowMaps(q.Query(ctx, sql, args...))
	}
	return rowMaps(s.db.Query(ctx, sql, args...))
}

func (s *server) one(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	rows, err := rowMaps(s.db.Query(ctx, sql, args...))
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// authed: signed-in callers only. maybe: guests too (me = "").
func (s *server) authed(h func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me := userFrom(s.cfg.SigKey, r, s.now())
		if me == "" {
			fail(w, 401, "Chưa đăng nhập.")
			return
		}
		if err := h(w, r, me); err != nil {
			answer(w, r, err)
		}
	}
}

func (s *server) maybe(h func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r, userFrom(s.cfg.SigKey, r, s.now())); err != nil {
			answer(w, r, err)
		}
	}
}

// internal: other services' calls (X-Internal-Auth signed with INTERNAL_KEY_LIBRARY).
func (s *server) internal(h func(http.ResponseWriter, *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !internalAuthOK(s.cfg.InternalKey, r.Header.Get("X-Internal-Auth"), s.now()) {
			fail(w, 401, "unauthorized")
			return
		}
		if err := h(w, r); err != nil {
			answer(w, r, err)
		}
	}
}

// Paths are what the gateway forwards after stripping /api/library (same as the backend's former /api/v1 ones).
func (s *server) routes() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"success": true}) })
	m.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.db.Ping(ctx); err != nil {
			writeJSON(w, 503, map[string]any{"success": false, "data": map[string]any{"database": "down"}})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"database": "ok"}})
	})

	m.HandleFunc("GET /history", s.authed(s.handleHistory))
	m.HandleFunc("POST /history", s.authed(s.handleSaveHistory))
	m.HandleFunc("DELETE /history/{id}", s.authed(s.handleDeleteHistory))
	m.HandleFunc("DELETE /history", s.authed(s.handleClearHistory))
	m.HandleFunc("POST /history/merge", s.authed(s.handleMergeHistory))

	m.HandleFunc("GET /bookmarks", s.authed(s.handleBookmarks))
	m.HandleFunc("POST /bookmarks", s.authed(s.handleCreateBookmark))
	m.HandleFunc("DELETE /bookmarks/{id}", s.authed(s.handleDeleteBookmark))
	m.HandleFunc("GET /favorites", s.authed(s.handleFavorites))
	m.HandleFunc("POST /favorites/toggle", s.authed(s.handleToggleFavorite))
	m.HandleFunc("GET /favorites/status/{storyId}", s.maybe(s.handleFavoriteStatus))

	m.HandleFunc("GET /albums/me", s.authed(s.handleMyAlbums))
	m.HandleFunc("GET /albums/saved", s.authed(s.handleSavedAlbums))
	m.HandleFunc("GET /albums/by-story/{storyId}", s.maybe(s.handleAlbumsByStory))
	m.HandleFunc("POST /albums", s.authed(s.handleCreateAlbum))
	m.HandleFunc("PUT /albums/me/visibility", s.authed(s.handleAllAlbumsVisibility))
	m.HandleFunc("GET /albums/{id}", s.maybe(s.handleAlbum))
	m.HandleFunc("PUT /albums/{id}", s.authed(s.handleUpdateAlbum))
	m.HandleFunc("DELETE /albums/{id}", s.authed(s.handleDeleteAlbum))
	m.HandleFunc("POST /albums/{id}/share-link/reset", s.authed(s.handleResetShareLink))
	m.HandleFunc("POST /albums/{id}/stories", s.authed(s.handleAddToAlbum))
	m.HandleFunc("DELETE /albums/{id}/stories/{storyId}", s.authed(s.handleRemoveFromAlbum))
	m.HandleFunc("POST /albums/{id}/save", s.authed(s.handleSaveAlbum))
	m.HandleFunc("POST /albums/{id}/copy", s.authed(s.handleCopyAlbum))

	m.HandleFunc("POST /internal/purge", s.internal(s.handlePurge))
	m.HandleFunc("POST /internal/history", s.internal(s.handleInternalHistory))
	m.HandleFunc("GET /internal/users/{id}/overview", s.internal(s.handleUserOverview))
	m.HandleFunc("GET /internal/favorites/{user}/{story}", s.internal(s.handleInternalFavorite))
	m.HandleFunc("GET /internal/codes/album/{no}", s.internal(s.handleAlbumCode))
	m.HandleFunc("GET /internal/stories/{id}/followers", s.internal(s.handleFollowers))
	m.HandleFunc("GET /internal/reco/export", s.internal(s.handleRecoExport))
	m.HandleFunc("GET /internal/reco/user/{id}", s.internal(s.handleRecoUser))
	return m
}
