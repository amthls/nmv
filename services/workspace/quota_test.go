package main

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestWriteQuota(t *testing.T) {
	q := newWriteQuota()
	limits := []quota{{time.Minute, 3}, {time.Hour, 5}}
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if w := q.take("u", limits, now); w != 0 {
			t.Fatalf("write %d refused", i)
		}
	}
	if w := q.take("u", limits, now.Add(10*time.Second)); w != 50*time.Second {
		t.Fatalf("4th write in the minute: wait %v, want 50s", w)
	}
	if w := q.take("other", limits, now); w != 0 {
		t.Fatal("another user shares the counter")
	}
	// the minute window frees up, the hour one does not after 5
	q.take("u", limits, now.Add(61*time.Second))
	q.take("u", limits, now.Add(62*time.Second))
	if w := q.take("u", limits, now.Add(63*time.Second)); w != time.Hour-63*time.Second {
		t.Fatalf("6th write in the hour: wait %v", w)
	}
}

func TestQuotaClass(t *testing.T) {
	cases := map[string]string{
		"GET /drafts":               "",
		"POST /drafts/x/lock":       "",
		"POST /internal/drafts":     "",
		"POST /drafts/x/copy":       "copy",
		"POST /chapters/x/rewind":   "heavy",
		"POST /drafts/x/offers/y":   "heavy",
		"DELETE /drafts/x/offers/y": "normal",
		"POST /tasks/x/claim":       "normal",
		"POST /drafts/x/comments":   "normal",
	}
	for in, want := range cases {
		var method, path string
		for i := range in {
			if in[i] == ' ' {
				method, path = in[:i], in[i+1:]
				break
			}
		}
		if got, _ := quotaClass(httptest.NewRequest(method, path, nil)); got != want {
			t.Errorf("%s: class %q, want %q", in, got, want)
		}
	}
}
