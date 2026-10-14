// Package catalog is the client for the backend (catalog) and library internal APIs: signed calls, cached profiles and groups.
package catalog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"nmv/messaging/internal/platform/httpx"
	"nmv/messaging/internal/platform/logger"
)

// Profiles (names, avatars) and translation groups live in the backend; messaging asks its internal API and keeps the
// answers a minute. shortcut: API + small cache instead of an ext_ copy kept by events (the backend has no outbox for
// profiles/groups yet); switch when the backend becomes `catalog` (stage I).

const cacheFor = 60 * time.Second

// Profile is a person's public data from the backend.
type Profile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	IsBanned    bool    `json:"is_banned"`
	Deleted     bool    `json:"deleted"`
}

// Member is one member of a translation group.
type Member struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

type cached[T any] struct {
	v   T
	exp time.Time
}

// Client makes signed internal calls and caches what it learns for a short while.
type Client struct {
	url    string
	key    []byte // INTERNAL_KEY_CATALOG
	hc     *http.Client
	mu     sync.Mutex
	byID   map[string]cached[Profile]
	groups map[string]cached[[]Member] // nil slice = no such group
}

// New makes a client for the service at url, signing with key.
func New(url string, key []byte) *Client {
	return &Client{url: url, key: key, hc: &http.Client{Timeout: 5 * time.Second},
		byID: map[string]cached[Profile]{}, groups: map[string]cached[[]Member]{}}
}

// ErrNoGroup: the group does not exist.
var ErrNoGroup = errors.New("no such group")

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

// Profiles returns the known profiles of ids (missing ids = no such user), from the cache when fresh.
func (b *Client) Profiles(ctx context.Context, ids []string) (map[string]Profile, error) {
	out := map[string]Profile{}
	var ask []string
	now := time.Now()
	b.mu.Lock()
	for _, id := range ids {
		if c, ok := b.byID[id]; ok && now.Before(c.exp) {
			out[id] = c.v
		} else if _, seen := out[id]; !seen {
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
	for _, p := range got {
		out[p.ID] = p
		b.byID[p.ID] = cached[Profile]{p, now.Add(cacheFor)}
	}
	b.mu.Unlock()
	return out, nil
}

// ByUsername looks a person up by username (not cached: usernames can be renamed). nil = no such user.
func (b *Client) ByUsername(ctx context.Context, username string) (*Profile, error) {
	var got []Profile
	status, err := b.Call(ctx, "POST", "/internal/users/profiles", map[string]any{"usernames": []string{username}}, &got)
	if err == nil && status != 200 {
		err = fmt.Errorf("backend profiles: HTTP %d", status)
	}
	if err != nil || len(got) == 0 {
		return nil, err
	}
	b.mu.Lock()
	b.byID[got[0].ID] = cached[Profile]{got[0], time.Now().Add(cacheFor)}
	b.mu.Unlock()
	return &got[0], nil
}

// Members of a translation group (who may use its chat); ErrNoGroup when it does not exist.
func (b *Client) Members(ctx context.Context, groupID string) ([]Member, error) {
	now := time.Now()
	b.mu.Lock()
	c, ok := b.groups[groupID]
	b.mu.Unlock()
	if ok && now.Before(c.exp) {
		if c.v == nil {
			return nil, ErrNoGroup
		}
		return c.v, nil
	}
	got := []Member{}
	status, err := b.Call(ctx, "GET", "/internal/groups/"+groupID+"/members", nil, &got)
	if err != nil {
		return nil, err
	}
	switch status {
	case 200:
	case 404:
		got = nil
	default:
		return nil, fmt.Errorf("backend group members: HTTP %d", status)
	}
	b.mu.Lock()
	b.groups[groupID] = cached[[]Member]{got, now.Add(30 * time.Second)} // membership changes show within half a minute
	b.mu.Unlock()
	if got == nil {
		return nil, ErrNoGroup
	}
	return got, nil
}

// ForgetGroup drops the cached membership.
func (b *Client) ForgetGroup(groupID string) {
	b.mu.Lock()
	delete(b.groups, groupID)
	b.mu.Unlock()
}
