package main

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	pingEvery    = 30 * time.Second // protocol-level ping from the server: background tabs answer it without JS
	pongWait     = 45 * time.Second // no pong by then (about two missed rounds with the next ping) = dead, close it
	writeWait    = 10 * time.Second
	maxPerUser   = 10 // open sockets per account; the oldest goes when an 11th connects
	sendBuffer   = 32 // pushes waiting for a slow client; a full buffer drops the client (it reconnects and refetches)
	closeReplace = 4000
	closeTooMany = 4001
	closeKicked  = 4003
)

type client struct {
	user, tab string
	conn      *websocket.Conn
	send      chan []byte
	once      sync.Once
	opened    time.Time
}

// closeWith ends the socket once; the serve loop then removes it from the hub.
func (c *client) closeWith(code websocket.StatusCode, reason string) {
	c.once.Do(func() {
		close(c.send)
		go c.conn.Close(code, reason)
	})
}

// hub: the open sockets of this process, by user. Pushes come from Redis (any process publishes).
type hub struct {
	mu    sync.Mutex
	users map[string]map[*client]struct{}
}

func newHub() *hub { return &hub{users: map[string]map[*client]struct{}{}} }

func (h *hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, cs := range h.users {
		n += len(cs)
	}
	return n
}

// add registers c: the same tab's previous socket is replaced, and beyond maxPerUser the oldest is closed.
func (h *hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	cs := h.users[c.user]
	if cs == nil {
		cs = map[*client]struct{}{}
		h.users[c.user] = cs
	}
	var oldest *client
	for o := range cs {
		if c.tab != "" && o.tab == c.tab {
			delete(cs, o)
			o.closeWith(closeReplace, "replaced by a newer connection of this tab")
			continue
		}
		if oldest == nil || o.opened.Before(oldest.opened) {
			oldest = o
		}
	}
	if len(cs) >= maxPerUser && oldest != nil {
		delete(cs, oldest)
		oldest.closeWith(closeTooMany, "too many connections")
	}
	cs[c] = struct{}{}
}

func (h *hub) remove(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cs := h.users[c.user]; cs != nil {
		delete(cs, c)
		if len(cs) == 0 {
			delete(h.users, c.user)
		}
	}
}

// push sends {type, data} to every socket of the event's users; a client whose buffer is full is dropped.
func (h *hub) push(e event) {
	msg, _ := json.Marshal(map[string]any{"type": e.Type, "data": e.Data})
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, u := range e.Users {
		for c := range h.users[u] {
			select {
			case c.send <- msg:
			default:
				delete(h.users[u], c)
				c.closeWith(websocket.StatusTryAgainLater, "too slow")
			}
		}
	}
}

func (h *hub) disconnect(users []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, u := range users {
		for c := range h.users[u] {
			c.closeWith(closeKicked, "signed out")
		}
		delete(h.users, u)
	}
}

func (h *hub) closeAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for u, cs := range h.users {
		for c := range cs {
			c.closeWith(websocket.StatusGoingAway, "restarting")
		}
		delete(h.users, u)
	}
}

// serve upgrades the request and runs the socket until it closes: one writer loop here, the library's reader
// (CloseRead) answers control frames, and a ticker pings.
func (h *hub) serve(w http.ResponseWriter, r *http.Request, user, tab string) {
	conn, err := websocket.Accept(w, r, nil) // same origin only (the library checks Origin against Host)
	if err != nil {
		return
	}
	if len(tab) > 64 {
		tab = tab[:64]
	}
	c := &client{user: user, tab: tab, conn: conn, send: make(chan []byte, sendBuffer), opened: time.Now()}
	h.add(c)
	// out of the hub first (under its lock), then close `send`: a push can never write to a closed channel
	defer c.closeWith(websocket.StatusNormalClosure, "")
	defer h.remove(c)

	ctx := conn.CloseRead(context.Background()) // clients only listen; anything they send closes the socket
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, open := <-c.send:
			if !open {
				return
			}
			wctx, cancel := context.WithTimeout(ctx, writeWait)
			err := conn.Write(wctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-ping.C:
			pctx, cancel := context.WithTimeout(ctx, pongWait)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
