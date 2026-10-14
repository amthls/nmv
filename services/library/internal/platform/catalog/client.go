// Package catalog is the client for the backend (catalog service) internal API.
package catalog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"nmv/library/internal/platform/httpx"
	"nmv/library/internal/platform/logger"
)

// Profiles (names, avatars, account numbers) live in the backend; library asks its internal API and keeps the answers
// a minute (album owners). shortcut: API + small cache instead of an ext_ copy kept by events; switch at stage I.

// Profile is a person's public data from the backend.
type Profile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	IsBanned    bool    `json:"is_banned"`
	Deleted     bool    `json:"deleted"`
	CodeNo      *int64  `json:"code_no"`
}

// Client calls the backend with signed internal requests and caches profiles.
type Client struct {
	url   string
	key   []byte // INTERNAL_KEY_CATALOG
	hc    *http.Client
	mu    sync.Mutex
	cache map[string]cachedProfile
}

type cachedProfile struct {
	p   Profile
	exp time.Time
}

// New makes a client for the backend at url, signing with key (INTERNAL_KEY_CATALOG).
func New(url string, key []byte) *Client {
	return &Client{url: url, key: key, hc: &http.Client{Timeout: 10 * time.Second}, cache: map[string]cachedProfile{}}
}

// Call sends a signed request; a 200 answer's {data} lands in out.
func (b *Client) Call(ctx context.Context, method, path string, body any, out any) (int, error) {
	var rd *bytes.Reader
	if body != nil {
		j, _ := json.Marshal(body)
		rd = bytes.NewReader(j)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequestWithContext(ctx, method, b.url+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Auth", httpx.InternalHeader(b.key, time.Now().Add(2*time.Minute).Unix()))
	if rid, _ := ctx.Value(logger.RequestIDKey).(string); rid != "" {
		req.Header.Set("X-Request-Id", rid)
	}
	res, err := b.hc.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode == 200 && out != nil {
		var env struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
			return res.StatusCode, err
		}
		return 200, json.Unmarshal(env.Data, out)
	}
	return res.StatusCode, nil
}

// Profiles of ids (unknown ids are left out), from the cache when fresh.
func (b *Client) Profiles(ctx context.Context, ids []string) (map[string]Profile, error) {
	out := map[string]Profile{}
	var ask []string
	now := time.Now()
	b.mu.Lock()
	for _, id := range ids {
		if c, ok := b.cache[id]; ok && now.Before(c.exp) {
			out[id] = c.p
		} else if _, seen := out[id]; !seen && id != "" {
			ask = append(ask, id)
		}
	}
	b.mu.Unlock()
	if len(ask) == 0 {
		return out, nil
	}
	var got []Profile
	status, err := b.Call(ctx, "POST", "/internal/users/profiles", map[string]any{"ids": ask}, &got)
	if err == nil && status != 200 {
		err = fmt.Errorf("backend profiles: HTTP %d", status)
	}
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	if len(b.cache) > 20000 {
		b.cache = map[string]cachedProfile{}
	}
	for _, p := range got {
		out[p.ID] = p
		b.cache[p.ID] = cachedProfile{p, now.Add(time.Minute)}
	}
	b.mu.Unlock()
	return out, nil
}
