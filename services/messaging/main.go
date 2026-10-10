// messaging: realtime pushes over plain WebSocket (later: direct messages, group chat, notifications). See Plan/messaging.md.
//
//	messaging               serve HTTP on :PORT (default 8080)
//	messaging healthcheck   exit 0 when the local server answers /health (Docker healthcheck)
//	messaging loadtest N url [hold]   N fake sockets + one push to all (see loadtest.go)
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
)

// rtChannel: every process that has something to push PUBLISHes {users, type, data} here (backend API, worker, ...).
const rtChannel = "rt:events"

type config struct {
	Port     string
	SigKey   []byte // USER_SIG_KEY_MESSAGING: identity signs the gateway's X-User-* for us alone
	RedisURL string
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://127.0.0.1:" + env("PORT", "8080") + "/health")
		if err != nil || res.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "loadtest" {
		if err := loadTest(ctx, os.Args[2:]); err != nil {
			logError(ctx, "loadtest: "+err.Error())
			os.Exit(1)
		}
		return
	}
	cfg := config{Port: env("PORT", "8080"), SigKey: []byte(os.Getenv("USER_SIG_KEY_MESSAGING")), RedisURL: os.Getenv("REDIS_URL")}
	if len(cfg.SigKey) < 32 || cfg.RedisURL == "" {
		logError(ctx, "USER_SIG_KEY_MESSAGING (>= 32 chars) and REDIS_URL are required")
		os.Exit(1)
	}
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logError(ctx, "REDIS_URL: "+err.Error())
		os.Exit(1)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()

	h := newHub()
	go subscribeLoop(ctx, rdb, h)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           withRequestLog(routes(cfg, rdb, h)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.closeAll() // browsers reconnect to another copy (or this one after the restart)
		srv.Shutdown(shutdown)
	}()
	logInfo(ctx, "messaging listening on :"+cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logError(ctx, err.Error())
		os.Exit(1)
	}
}

// Paths are what the gateway forwards after stripping /api/msg.
func routes(cfg config, rdb *redis.Client, h *hub) http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"success": true}) })
	m.HandleFunc("GET /ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := rdb.Ping(ctx).Err(); err != nil {
			writeJSON(w, 503, map[string]any{"success": false, "data": map[string]string{"redis": "down"}})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"redis": "ok", "connections": h.count()}})
	})
	m.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		user := userFrom(cfg.SigKey, r, time.Now())
		if user == "" {
			writeJSON(w, 401, map[string]any{"success": false, "message": "Bạn chưa đăng nhập."})
			return
		}
		h.serve(w, r, user, r.URL.Query().Get("tab"))
	})
	return m
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// userFrom: the gateway's signed identity headers (same check as the backend's auth.middleware). "" = guest.
func userFrom(key []byte, r *http.Request, now time.Time) string {
	id, roles, exp, sig := r.Header.Get("X-User-Id"), r.Header.Get("X-User-Roles"), r.Header.Get("X-User-Exp"), r.Header.Get("X-User-Sig")
	n, err := strconv.ParseInt(exp, 10, 64)
	if id == "" || err != nil || now.Unix() > n {
		return ""
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte(id + "|" + roles + "|" + exp))
	if !hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(strings.ToLower(sig))) {
		return ""
	}
	return id
}

// event: what publishers send on rtChannel. Type "_disconnect" closes the users' sockets (banned, sessions revoked).
type event struct {
	Users []string        `json:"users"`
	Type  string          `json:"type"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// subscribeLoop listens on rtChannel forever, resubscribing after Redis outages (clients keep their sockets meanwhile).
func subscribeLoop(ctx context.Context, rdb *redis.Client, h *hub) {
	backoff := time.Second
	for ctx.Err() == nil {
		sub := rdb.Subscribe(ctx, rtChannel)
		if _, err := sub.Receive(ctx); err == nil {
			backoff = time.Second
			logInfo(ctx, "subscribed to "+rtChannel)
			for msg := range sub.Channel() {
				var e event
				if json.Unmarshal([]byte(msg.Payload), &e) != nil || e.Type == "" {
					continue
				}
				if e.Type == "_disconnect" {
					h.disconnect(e.Users)
					continue
				}
				h.push(e)
			}
		} else if !errors.Is(err, context.Canceled) {
			logf(ctx, "warn", "redis subscribe failed, retrying: "+err.Error())
		}
		sub.Close()
		select {
		case <-ctx.Done():
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}
