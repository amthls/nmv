package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Transactional outbox, same as services/identity/events.go: written in the change's transaction, published to the
// topic exchange novelhub.events with publisher confirms. Envelope {event_id, type, version, occurred_at, request_id, data}.
const exchange = "novelhub.events"

func enqueueEvent(ctx context.Context, tx pgx.Tx, routingKey string, version any, data any) error {
	reqID, _ := ctx.Value(requestIDKey).(string)
	eventID := newUUID()
	body, err := json.Marshal(map[string]any{
		"event_id": eventID, "type": routingKey, "version": version,
		"occurred_at": time.Now().UTC().Format(time.RFC3339Nano), "request_id": reqID, "data": data,
	})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO outbox (event_id, routing_key, payload, request_id) VALUES ($1, $2, $3, NULLIF($4, ''))`,
		eventID, routingKey, body, reqID)
	return err
}

// publishLoop drains the outbox forever, reconnecting with backoff. Safe with several copies (SKIP LOCKED).
func (s *server) publishLoop(ctx context.Context) {
	if s.cfg.RabbitURL == "" {
		logf(ctx, "warn", "RABBITMQ_URL empty: events stay in the outbox")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.publishSession(ctx)
		logf(ctx, "warn", "event publisher stopped, retrying: "+fmt.Sprint(err))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (s *server) publishSession(ctx context.Context) error {
	conn, err := amqp.DialConfig(s.cfg.RabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	if err := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.Confirm(false); err != nil {
		return err
	}
	closed := conn.NotifyClose(make(chan *amqp.Error, 1))
	logInfo(ctx, "event publisher connected")
	for {
		n, err := s.publishBatch(ctx, ch)
		if err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e := <-closed:
			return e
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *server) publishBatch(ctx context.Context, ch *amqp.Channel) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id, event_id::text, routing_key, payload::text, COALESCE(request_id, '') FROM outbox
			WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)
		if err != nil {
			return err
		}
		type row struct {
			id                     int64
			eventID, key, body, rq string
		}
		batch, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
			var x row
			return x, r.Scan(&x.id, &x.eventID, &x.key, &x.body, &x.rq)
		})
		if err != nil || len(batch) == 0 {
			return err
		}
		ids := make([]int64, 0, len(batch))
		for _, e := range batch {
			conf, err := ch.PublishWithDeferredConfirmWithContext(ctx, exchange, e.key, false, false, amqp.Publishing{
				ContentType: "application/json", DeliveryMode: amqp.Persistent, MessageId: e.eventID,
				Headers: amqp.Table{"request_id": e.rq}, Body: []byte(e.body), Timestamp: time.Now(),
			})
			if err != nil {
				return err
			}
			if acked, err := conf.WaitContext(ctx); err != nil || !acked {
				return fmt.Errorf("broker did not confirm event %s", e.eventID)
			}
			ids = append(ids, e.id)
		}
		_, err = tx.Exec(ctx, `UPDATE outbox SET published_at = NOW() WHERE id = ANY($1)`, ids)
		n = len(ids)
		return err
	})
	return n, err
}

// republish queues workspace.revision.merged with the current version of one chapter (id) or all of them, so a
// missing or drifted reading copy is rebuilt; the backend ignores versions it already has.
func republish(ctx context.Context, db *pgxpool.Pool, id string) error {
	rows, err := db.Query(ctx, `SELECT chapter_id::text, current_version FROM chapter_heads WHERE $1 = '' OR chapter_id::text = $1 ORDER BY chapter_id`, id)
	if err != nil {
		return err
	}
	type headRow struct {
		ID      string
		Version int
	}
	heads, err := pgx.CollectRows(rows, pgx.RowToStructByPos[headRow])
	if err != nil {
		return err
	}
	for _, h := range heads {
		err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
			rev, _, err := loadRevision(ctx, tx, h.ID, h.Version)
			if err != nil {
				return err
			}
			return enqueueEvent(ctx, tx, "workspace.revision.merged", rev.Version, rev)
		})
		if err != nil {
			return fmt.Errorf("chapter %s: %w", h.ID, err)
		}
	}
	logInfo(ctx, fmt.Sprintf("republish: %d chapter events queued", len(heads)))
	return nil
}

// GET /internal/stats: totals the backend's reconcile job compares with ws_chapter_versions, and the outbox backlog.
func (s *server) handleStats(w http.ResponseWriter, r *http.Request) {
	var chapters, versionSum, pending int64
	var oldest float64
	err := s.db.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM chapter_heads), (SELECT COALESCE(sum(current_version), 0) FROM chapter_heads),
		(SELECT count(*) FROM outbox WHERE published_at IS NULL),
		(SELECT COALESCE(EXTRACT(EPOCH FROM NOW() - min(created_at)), 0) FROM outbox WHERE published_at IS NULL)`).
		Scan(&chapters, &versionSum, &pending, &oldest)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	ok(w, map[string]any{"chapters": chapters, "version_sum": versionSum, "outbox_pending": pending, "outbox_oldest_seconds": int64(oldest)})
}
