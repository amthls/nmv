package main

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Per-user write quotas (Plan/load.md B1), the way GitHub limits content creation: a person may change things at
// a normal pace; a script or a stuck button gets 429 + Retry-After instead of loading the database.
// shortcut: in-memory, per process (one workspace container); move the counters to Redis when running several.

type quota struct {
	per time.Duration
	max int
}

var (
	quotaNormal = []quota{{time.Minute, 60}, {time.Hour, 600}}
	quotaHeavy  = []quota{{time.Minute, 10}, {time.Hour, 100}} // each one writes a new version or merges a draft
	quotaCopy   = []quota{{time.Hour, 20}}
)

// quotaClass: which quota a public write falls under; nil = not counted (reads, the editor's lock heartbeat).
func quotaClass(r *http.Request) (string, []quota) {
	p := r.URL.Path
	switch {
	case r.Method == http.MethodGet || r.Method == http.MethodHead || strings.HasPrefix(p, "/internal/"):
		return "", nil
	case strings.HasSuffix(p, "/lock"): // sent by the editor every 30 s, not by a click
		return "", nil
	case strings.HasSuffix(p, "/copy"):
		return "copy", quotaCopy
	case strings.HasSuffix(p, "/rewind"), strings.HasSuffix(p, "/pull"), strings.HasSuffix(p, "/reclaim"),
		r.Method == http.MethodPost && strings.Contains(p, "/offers/"):
		return "heavy", quotaHeavy
	}
	return "normal", quotaNormal
}

type writeQuota struct {
	mu   sync.Mutex
	hits map[string][]time.Time // "<class>|<user>" -> times inside the longest window
}

func newWriteQuota() *writeQuota { return &writeQuota{hits: map[string][]time.Time{}} }

// take records one write and returns 0, or how long to wait when a window is full (nothing recorded then).
func (q *writeQuota) take(key string, limits []quota, now time.Time) time.Duration {
	q.mu.Lock()
	defer q.mu.Unlock()
	longest := limits[0].per
	for _, l := range limits {
		if l.per > longest {
			longest = l.per
		}
	}
	recent := q.hits[key][:0]
	for _, t := range q.hits[key] {
		if now.Sub(t) < longest {
			recent = append(recent, t)
		}
	}
	q.hits[key] = recent
	var wait time.Duration
	for _, l := range limits {
		in := 0
		var oldest time.Time
		for _, t := range recent {
			if now.Sub(t) < l.per {
				if in == 0 {
					oldest = t
				}
				in++
			}
		}
		if in >= l.max {
			if w := l.per - now.Sub(oldest); w > wait {
				wait = w
			}
		}
	}
	if wait > 0 {
		return wait
	}
	q.hits[key] = append(recent, now)
	if len(q.hits) > 50000 { // forget idle users now and then
		for k, ts := range q.hits {
			if len(ts) == 0 || now.Sub(ts[len(ts)-1]) > time.Hour {
				delete(q.hits, k)
			}
		}
	}
	return 0
}

// limitWrites wraps the routes: signed-in public writes are counted per user (guests are refused by the handlers).
func (s *server) limitWrites(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		class, limits := quotaClass(r)
		if s.quota == nil || limits == nil {
			next.ServeHTTP(w, r)
			return
		}
		user := s.userFrom(r)
		if user == "" {
			next.ServeHTTP(w, r)
			return
		}
		if wait := s.quota.take(class+"|"+user, limits, s.now()); wait > 0 {
			secs := int(wait.Seconds() + 0.999)
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"success": false, "message": "Bạn thao tác quá nhanh, vui lòng chờ một chút.", "retry_after_seconds": secs,
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}
