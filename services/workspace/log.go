package main

// shortcut: copied from services/identity (log.go, db.go, parts of http.go/events.go/verify.go); move to a shared Go
// module when a third Go service needs them.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"time"
)

// JSON log lines with the same shape and redaction rules as catalog/src/utils/logger.ts:
// {time, level, service, request_id, msg, ...fields}. Never log request bodies, cookies or tokens.

type ctxKey int

const requestIDKey ctxKey = 0

var redactions = []struct {
	re   *regexp.Regexp
	with string
}{
	{regexp.MustCompile(`\beyJ[\w-]+\.[\w-]+\.[\w-]+`), "[jwt]"},
	{regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[^\s"',]+`), "$1 [redacted]"},
	{regexp.MustCompile(`(//[^:/@\s]+:)[^@\s]+@`), "$1[redacted]@"},
	{regexp.MustCompile(`(?i)((?:password|passwd|token|secret|cookie|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&}]+`), "$1[redacted]"},
	{regexp.MustCompile(`[\w.+-]+@[\w-]+(\.[\w-]+)+`), "[email]"},
}

func redact(s string) string {
	for _, r := range redactions {
		s = r.re.ReplaceAllString(s, r.with)
	}
	return s
}

func logf(ctx context.Context, level, msg string, fields ...any) {
	line := map[string]any{"time": time.Now().UTC().Format(time.RFC3339Nano), "level": level, "service": "workspace", "msg": redact(msg)}
	if ctx != nil {
		if id, ok := ctx.Value(requestIDKey).(string); ok {
			line["request_id"] = id
		}
	}
	for i := 0; i+1 < len(fields); i += 2 {
		line[fmt.Sprint(fields[i])] = fields[i+1]
	}
	b, _ := json.Marshal(line)
	out := os.Stdout
	if level == "error" || level == "warn" {
		out = os.Stderr
	}
	fmt.Fprintln(out, string(b))
}

func logInfo(ctx context.Context, msg string, f ...any)  { logf(ctx, "info", msg, f...) }
func logError(ctx context.Context, msg string, f ...any) { logf(ctx, "error", msg, f...) }

var requestIDRe = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(s int) { w.status = s; w.ResponseWriter.WriteHeader(s) }

// withRequestLog adopts the gateway's X-Request-Id (or makes one), and logs one line per request (path only).
func withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if !requestIDRe.MatchString(id) {
			b := make([]byte, 16)
			rand.Read(b)
			id = hex.EncodeToString(b)
		}
		w.Header().Set("X-Request-Id", id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		sw := &statusWriter{ResponseWriter: w, status: 200}
		start := time.Now()
		next.ServeHTTP(sw, r.WithContext(ctx))
		if r.URL.Path == "/health" {
			return // Docker healthcheck every few seconds
		}
		level := "info"
		if sw.status >= 500 {
			level = "error"
		}
		logf(ctx, level, "request", "method", r.Method, "path", r.URL.Path, "status", sw.status, "ms", time.Since(start).Milliseconds())
	})
}
