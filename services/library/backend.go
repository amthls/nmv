package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Profiles (names, avatars, account numbers) live in the backend; library asks its internal API and keeps the answers
// a minute (album owners). shortcut: API + small cache instead of an ext_ copy kept by events; switch at stage I.

type profile struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	IsBanned    bool    `json:"is_banned"`
	Deleted     bool    `json:"deleted"`
	CodeNo      *int64  `json:"code_no"`
}

type backendClient struct {
	url   string
	key   []byte // INTERNAL_KEY_BACKEND
	hc    *http.Client
	mu    sync.Mutex
	cache map[string]cachedProfile
}

type cachedProfile struct {
	p   profile
	exp time.Time
}

func newBackend(url string, key []byte) *backendClient {
	return &backendClient{url: url, key: key, hc: &http.Client{Timeout: 10 * time.Second}, cache: map[string]cachedProfile{}}
}

// call sends a signed request; a 200 answer's {data} lands in out.
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

// profiles of ids (unknown ids are left out), from the cache when fresh.
func (b *backendClient) profiles(ctx context.Context, ids []string) (map[string]profile, error) {
	out := map[string]profile{}
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
	var got []profile
	status, err := b.call(ctx, "POST", "/internal/users/profiles", map[string]any{"ids": ask}, &got)
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

// internalAuthOK checks X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>".
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
