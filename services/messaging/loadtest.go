package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/redis/go-redis/v9"
)

// loadTest: `messaging loadtest <connections> <ws url> [hold seconds] [user prefix]`, run as its own container next to the
// real one:
//
//	docker compose run --rm --no-deps messaging loadtest 2000 ws://messaging:8080/ws 60
//
// One container reaches ~28k sockets (source ports to one address): run several with different prefixes for more.
//
// Opens N sockets as N fake users (signed with USER_SIG_KEY_MESSAGING), publishes one ping to all of them through
// Redis like the backend does, reports how many arrived and how fast, then holds the sockets (watch `docker stats`).
func loadTest(ctx context.Context, args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: messaging loadtest <connections> <ws url> [hold seconds] [user prefix]")
	}
	n, _ := strconv.Atoi(args[0])
	url := args[1]
	hold := 30
	if len(args) > 2 {
		hold, _ = strconv.Atoi(args[2])
	}
	prefix := "loadtest"
	if len(args) > 3 {
		prefix = args[3]
	}
	key := []byte(os.Getenv("USER_SIG_KEY_MESSAGING"))
	opt, err := redis.ParseURL(os.Getenv("REDIS_URL"))
	if err != nil {
		return err
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()

	users := make([]string, n)
	conns := make([]*websocket.Conn, n)
	var failed atomic.Int64
	start := time.Now()
	var wg sync.WaitGroup
	sem := make(chan struct{}, 200) // dial at most 200 at once
	for i := range n {
		users[i] = fmt.Sprintf("%s-%06d", prefix, i)
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			exp := strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10)
			m := hmac.New(sha256.New, key)
			m.Write([]byte(users[i] + "|reader|" + exp))
			h := http.Header{"X-User-Id": {users[i]}, "X-User-Roles": {"reader"}, "X-User-Exp": {exp}, "X-User-Sig": {hex.EncodeToString(m.Sum(nil))}}
			dctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			c, _, err := websocket.Dial(dctx, url+"?tab=t", &websocket.DialOptions{HTTPHeader: h})
			if err != nil {
				failed.Add(1)
				return
			}
			conns[i] = c
		}(i)
	}
	wg.Wait()
	fmt.Printf("connected %d/%d in %s (%d failed)\n", n-int(failed.Load()), n, time.Since(start).Round(time.Millisecond), failed.Load())

	// Every socket reads all the time, like a browser: the library answers the server's pings only while reading
	var (
		mu   sync.Mutex
		lat  []time.Duration
		sent time.Time
		dead atomic.Int64
	)
	for _, c := range conns {
		if c == nil {
			continue
		}
		go func(c *websocket.Conn) {
			for {
				if _, _, err := c.Read(ctx); err != nil {
					dead.Add(1)
					return
				}
				mu.Lock()
				lat = append(lat, time.Since(sent))
				mu.Unlock()
			}
		}(c)
	}
	// One push to everybody, as a single PUBLISH (the "new chapter for all followers" shape)
	push := func(label string) error {
		mu.Lock()
		lat, sent = lat[:0], time.Now()
		mu.Unlock()
		payload, _ := json.Marshal(event{Users: users, Type: "notification"})
		if err := rdb.Publish(ctx, rtChannel, payload).Err(); err != nil {
			return err
		}
		alive := n - int(failed.Load()) - int(dead.Load())
		for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
			mu.Lock()
			got := len(lat)
			mu.Unlock()
			if got >= alive {
				break
			}
		}
		mu.Lock()
		defer mu.Unlock()
		sort.Slice(lat, func(a, b int) bool { return lat[a] < lat[b] })
		if len(lat) > 0 {
			fmt.Printf("%s push delivered %d/%d (%d sockets closed): p50 %s, p95 %s, max %s\n", label, len(lat), n, dead.Load(),
				lat[len(lat)/2].Round(time.Millisecond), lat[len(lat)*95/100].Round(time.Millisecond), lat[len(lat)-1].Round(time.Millisecond))
		} else {
			fmt.Printf("%s push delivered 0/%d (%d sockets closed)\n", label, n, dead.Load())
		}
		return nil
	}
	if err := push("first"); err != nil {
		return err
	}
	fmt.Printf("holding the sockets for %ds (server pings every 30s)\n", hold)
	select {
	case <-ctx.Done():
	case <-time.After(time.Duration(hold) * time.Second):
	}
	if err := push("after hold"); err != nil { // still alive after the ping rounds?
		return err
	}
	for _, c := range conns {
		if c != nil {
			c.Close(websocket.StatusNormalClosure, "")
		}
	}
	return nil
}
