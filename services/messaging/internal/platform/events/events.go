// Package events: the realtime channel every process publishes pushes on.
package events

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"

	"nmv/messaging/internal/platform/logger"
)

// RTChannel: every process that has something to push PUBLISHes {users, type, data} here (backend API, worker, ...).
const RTChannel = "rt:events"

// Event is what publishers send on RTChannel. Type "_disconnect" closes the users' sockets (banned, sessions revoked).
type Event struct {
	Users []string        `json:"users"`
	Type  string          `json:"type"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// Publisher sends realtime pings through Redis, so every messaging copy delivers them.
type Publisher struct {
	rdb *redis.Client // nil in tests: nothing is pushed
}

// NewPublisher wraps the Redis client (nil = push nothing).
func NewPublisher(rdb *redis.Client) *Publisher { return &Publisher{rdb: rdb} }

// Publish pings users with a typed event.
func (p *Publisher) Publish(ctx context.Context, users []string, typ string, data map[string]any) {
	if p == nil || p.rdb == nil || len(users) == 0 {
		return
	}
	b, _ := json.Marshal(map[string]any{"users": users, "type": typ, "data": data})
	if err := p.rdb.Publish(ctx, RTChannel, b).Err(); err != nil {
		logger.Logf(ctx, "warn", "realtime publish failed: "+err.Error())
	}
}
