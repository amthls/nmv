// Package httpx holds what every handler shares: JSON answers, request reading, client address.
package httpx

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"

	"nmv/identity/internal/platform/logger"
)

// Responses keep the backend's shape: {success, message?, data?}.
// WriteJSON writes v as JSON with the given status (never cached).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// OK writes {success: true, message?, data?}.
func OK(w http.ResponseWriter, msg string, data any) {
	body := map[string]any{"success": true}
	if msg != "" {
		body["message"] = msg
	}
	if data != nil {
		body["data"] = data
	}
	WriteJSON(w, 200, body)
}

// Fail writes {success: false, message}.
func Fail(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"success": false, "message": msg})
}

// InternalError logs the real error and shows the user only the request id to quote.
func InternalError(w http.ResponseWriter, r *http.Request, err error) {
	logger.Error(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(logger.RequestIDKey).(string)
	Fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

// ErrBadJSON: the body is not the JSON the handler expects.
var ErrBadJSON = errors.New("bad json")

// ReadJSON decodes a body of at most 64 KiB into dst.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return ErrBadJSON
	}
	return nil
}

// The gateway overwrites X-Real-IP with the verified client address; anything else talking to us is internal.
// ClientIP is the verified client address.
func ClientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

// UserAgent is the client user agent, cut to 200 bytes.
func UserAgent(r *http.Request) string {
	ua := r.UserAgent()
	if len(ua) > 200 {
		ua = ua[:200]
	}
	return ua
}

// IsUUID reports whether s is a canonical 36-character uuid.
func IsUUID(s string) bool {
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

// Itoa formats n.
func Itoa(n int) string { return strconv.Itoa(n) }
