package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Profiles (names, avatars) and translation groups live in the backend; messaging asks its internal API and keeps the
// answers a minute. shortcut: API + small cache instead of an ext_ copy kept by events (the backend has no outbox for
// profiles/groups yet); switch when the backend becomes `catalog` (stage I).

const cacheFor = 60 * time.Second

type profile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	IsBanned    bool    `json:"is_banned"`
	Deleted     bool    `json:"deleted"`
}

type member struct {
	UserID string `json:"user_id"`
	Role   string `json:"role"`
}

type cached[T any] struct {
	v   T
	exp time.Time
}

type backendClient struct {
	url    string
	key    []byte // INTERNAL_KEY_BACKEND
	hc     *http.Client
	mu     sync.Mutex
	byID   map[string]cached[profile]
	groups map[string]cached[[]member] // nil slice = no such group
}

func newBackend(url string, key []byte) *backendClient {
	return &backendClient{url: url, key: key, hc: &http.Client{Timeout: 5 * time.Second},
		byID: map[string]cached[profile]{}, groups: map[string]cached[[]member]{}}
}

var errNoGroup = errors.New("no such group")

func (b *backendClient) call(ctx context.Context, method, path string, body any, out any) (int, error) {
	var rd *bytes.Reader
	if body != nil {
		j, _ := json.Marshal(body)
		rd = bytes.NewReader(j)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequestWithContext(ctx, method, b.url+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Auth", internalHeader(b.key, time.Now().Add(2*time.Minute).Unix()))
	if rid, _ := ctx.Value(requestIDKey).(string); rid != "" {
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

// profiles returns the known profiles of ids (missing ids = no such user), from the cache when fresh.
func (b *backendClient) profiles(ctx context.Context, ids []string) (map[string]profile, error) {
	out := map[string]profile{}
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
	var got []profile
	status, err := b.call(ctx, "POST", "/internal/users/profiles", map[string]any{"ids": ask}, &got)
	if err == nil && status != 200 {
		err = fmt.Errorf("backend profiles: HTTP %d", status)
	}
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	for _, p := range got {
		out[p.ID] = p
		b.byID[p.ID] = cached[profile]{p, now.Add(cacheFor)}
	}
	b.mu.Unlock()
	return out, nil
}

// byUsername looks a person up by username (not cached: usernames can be renamed). nil = no such user.
func (b *backendClient) byUsername(ctx context.Context, username string) (*profile, error) {
	var got []profile
	status, err := b.call(ctx, "POST", "/internal/users/profiles", map[string]any{"usernames": []string{username}}, &got)
	if err == nil && status != 200 {
		err = fmt.Errorf("backend profiles: HTTP %d", status)
	}
	if err != nil || len(got) == 0 {
		return nil, err
	}
	b.mu.Lock()
	b.byID[got[0].ID] = cached[profile]{got[0], time.Now().Add(cacheFor)}
	b.mu.Unlock()
	return &got[0], nil
}

// members of a translation group (who may use its chat); errNoGroup when it does not exist.
func (b *backendClient) members(ctx context.Context, groupID string) ([]member, error) {
	now := time.Now()
	b.mu.Lock()
	c, ok := b.groups[groupID]
	b.mu.Unlock()
	if ok && now.Before(c.exp) {
		if c.v == nil {
			return nil, errNoGroup
		}
		return c.v, nil
	}
	got := []member{}
	status, err := b.call(ctx, "GET", "/internal/groups/"+groupID+"/members", nil, &got)
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
	b.groups[groupID] = cached[[]member]{got, now.Add(30 * time.Second)} // membership changes show within half a minute
	b.mu.Unlock()
	if got == nil {
		return nil, errNoGroup
	}
	return got, nil
}

func (b *backendClient) forgetGroup(groupID string) {
	b.mu.Lock()
	delete(b.groups, groupID)
	b.mu.Unlock()
}

// internalAuthOK checks X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>" (key = INTERNAL_KEY_MESSAGING).
func internalAuthOK(key []byte, v string, now time.Time) bool {
	exp, sig, found := strings.Cut(v, ".")
	n, err := strconv.ParseInt(exp, 10, 64)
	if !found || err != nil || now.Unix() > n || len(key) == 0 {
		return false
	}
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + exp))
	return hmac.Equal([]byte(hex.EncodeToString(m.Sum(nil))), []byte(sig))
}

// internalHeader signs a service-to-service call valid until exp (unix seconds).
func internalHeader(key []byte, exp int64) string {
	e := strconv.FormatInt(exp, 10)
	m := hmac.New(sha256.New, key)
	m.Write([]byte("internal|" + e))
	return e + "." + hex.EncodeToString(m.Sum(nil))
}
