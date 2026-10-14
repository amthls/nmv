// Package catalog is the client of the backend (catalog service): who may do what in a story, cached 30 s.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"nmv/workspace/internal/platform/httpx"
	"nmv/workspace/internal/platform/logger"
)

// Perm is what the backend says about a user in a story.
type Perm struct {
	Keeper      bool     `json:"keeper"`      // story owner, or leader/mod of its group: rewinds, merges
	Contributor bool     `json:"contributor"` // keeper, group member or collaborator: reads history
	Removed     bool     `json:"removed"`     // story taken down by Admin/Mod: nothing is merged until restored
	Name        string   `json:"name"`        // caller's display name, kept on the revisions they make
	Role        string   `json:"role"`        // owner | group role | collaborator | "" (stage 4b: who takes which step)
	Workflow    []string `json:"workflow"`    // the group's steps before a merge
}

type entry struct {
	p   Perm
	exp time.Time
}

// Client asks the backend. Safe for concurrent use.
type Client struct {
	URL string
	Key []byte
	Now func() time.Time

	mu sync.Mutex
	m  map[string]entry
}

// New returns a client of the backend at url, signing calls with key.
func New(url string, key []byte, now func() time.Time) *Client {
	return &Client{URL: url, Key: key, Now: now, m: map[string]entry{}}
}

// Forget empties the permission cache (tests change the answers of the backend).
func (c *Client) Forget() {
	c.mu.Lock()
	c.m = map[string]entry{}
	c.mu.Unlock()
}

// Permission asks the backend (cached 30 s per user+story when the user takes part).
func (c *Client) Permission(ctx context.Context, user, story string) (Perm, error) {
	key := user + "|" + story
	c.mu.Lock()
	if e, found := c.m[key]; found && c.Now().Before(e.exp) {
		c.mu.Unlock()
		return e.p, nil
	}
	c.mu.Unlock()

	req, _ := http.NewRequestWithContext(ctx, "GET", c.URL+"/internal/permissions?user="+url.QueryEscape(user)+"&story="+url.QueryEscape(story), nil)
	req.Header.Set("X-Internal-Auth", httpx.InternalAuth(c.Key, c.Now()))
	if rid := logger.RequestID(ctx); rid != "" {
		req.Header.Set("X-Request-Id", rid)
	}
	res, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	if err != nil {
		return Perm{}, err
	}
	defer res.Body.Close()
	var body struct {
		Data Perm `json:"data"`
	}
	if res.StatusCode != 200 || json.NewDecoder(res.Body).Decode(&body) != nil {
		return Perm{}, fmt.Errorf("backend permissions: %s", res.Status)
	}
	// Only "takes part" is cached: someone just added to a story or group gets in at once, while a removal
	// can lag up to 30 s.
	if body.Data.Contributor {
		c.mu.Lock()
		if len(c.m) > 10000 {
			c.m = map[string]entry{}
		}
		c.m[key] = entry{body.Data, c.Now().Add(30 * time.Second)}
		c.mu.Unlock()
	}
	return body.Data, nil
}

// ExportPage asks the backend for a page of chapters to import (GET /internal/chapters/export).
func (c *Client) ExportPage(ctx context.Context, after string) (*http.Response, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", c.URL+"/internal/chapters/export?limit=100&after="+url.QueryEscape(after), nil)
	req.Header.Set("X-Internal-Auth", httpx.InternalAuth(c.Key, c.Now()))
	return (&http.Client{Timeout: 30 * time.Second}).Do(req)
}
