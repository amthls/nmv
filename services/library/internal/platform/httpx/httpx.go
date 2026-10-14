// Package httpx holds what every handler shares: JSON answers, input errors, request reading.
package httpx

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"nmv/library/internal/platform/logger"
)

// WriteJSON writes v as JSON with the given status (never cached).
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// OK writes {success: true, data}.
func OK(w http.ResponseWriter, data any) {
	WriteJSON(w, 200, map[string]any{"success": true, "data": data})
}

// Fail writes {success: false, message}.
func Fail(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]any{"success": false, "message": msg})
}

// InputError is a message for the caller (400 unless the status is set).
type InputError struct {
	Status int
	Msg    string
}

func (e *InputError) Error() string { return e.Msg }

// Bad is a 400 input error.
func Bad(msg string) error { return &InputError{400, msg} }

// NotFound is a 404 input error.
func NotFound(msg string) error { return &InputError{404, msg} }

// FailWith is an input error with the given status.
func FailWith(status int, m string) error { return &InputError{status, m} }

// Answer writes err: an InputError as is, a malformed id from Postgres as 400, anything else as 500.
func Answer(w http.ResponseWriter, r *http.Request, err error) {
	var ie *InputError
	if errors.As(err, &ie) {
		Fail(w, ie.Status, ie.Msg)
		return
	}
	if strings.Contains(err.Error(), "SQLSTATE 22P02") { // invalid uuid / number from the client
		Fail(w, 400, "Dữ liệu không hợp lệ.")
		return
	}
	logger.Error(r.Context(), err.Error(), "path", r.URL.Path)
	id, _ := r.Context().Value(logger.RequestIDKey).(string)
	Fail(w, 500, "Lỗi hệ thống, vui lòng thử lại sau. (mã "+id+")")
}

// ReadJSON decodes a body of at most 64 KiB into dst; anything wrong is a 400.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return Bad("Dữ liệu không hợp lệ.")
	}
	return nil
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

// Clamp: a finite number within [min, max], else the fallback (bad client values must not reach SQL).
func Clamp(v any, min, max, fallback float64) float64 {
	var n float64
	switch x := v.(type) {
	case float64:
		n = x
	case string:
		f, err := strconv.ParseFloat(x, 64)
		if err != nil {
			return fallback
		}
		n = f
	default:
		return fallback
	}
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return fallback
	}
	return math.Min(math.Max(n, min), max)
}
