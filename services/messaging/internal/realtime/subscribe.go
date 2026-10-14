package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"nmv/messaging/internal/platform/events"
	"nmv/messaging/internal/platform/logger"
)

// SubscribeLoop listens on the realtime channel forever, resubscribing after Redis outages (clients keep their sockets
// meanwhile). Type "_disconnect" closes the users' sockets.
func SubscribeLoop(ctx context.Context, rdb *redis.Client, h *Hub) {
	backoff := time.Second
	for ctx.Err() == nil {
		sub := rdb.Subscribe(ctx, events.RTChannel)
		if _, err := sub.Receive(ctx); err == nil {
			backoff = time.Second
			logger.Info(ctx, "subscribed to "+events.RTChannel)
			for msg := range sub.Channel() {
				var e events.Event
				if json.Unmarshal([]byte(msg.Payload), &e) != nil || e.Type == "" {
					continue
				}
				if e.Type == "_disconnect" {
					h.Disconnect(e.Users)
					continue
				}
				h.Push(e)
			}
		} else if !errors.Is(err, context.Canceled) {
			logger.Logf(ctx, "warn", "redis subscribe failed, retrying: "+err.Error())
		}
		sub.Close()
		select {
		case <-ctx.Done():
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}
