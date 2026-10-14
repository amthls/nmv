// Package outbox is the transactional outbox: events are written in the change's transaction and published to RabbitMQ.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"

	"nmv/workspace/internal/platform/ids"
	"nmv/workspace/internal/platform/logger"
)

// Transactional outbox, same as services/identity/events.go: written in the change's transaction, published to the
// topic exchange novelhub.events with publisher confirms. Envelope {event_id, type, version, occurred_at, request_id, data}.
const exchange = "novelhub.events"

// Enqueue writes an event in the caller's transaction; the publisher sends it once that commits.
func Enqueue(ctx context.Context, tx pgx.Tx, routingKey string, version any, data any) error {
	reqID := logger.RequestID(ctx)
	eventID := ids.New()
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

// Publisher drains the outbox into RabbitMQ.
type Publisher struct {
	DB        *pgxpool.Pool
	RabbitURL string
}

// Run drains the outbox forever, reconnecting with backoff. Safe with several copies (SKIP LOCKED).
func (p *Publisher) Run(ctx context.Context) {
	if p.RabbitURL == "" {
		logger.Logf(ctx, "warn", "RABBITMQ_URL empty: events stay in the outbox")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := p.publishSession(ctx)
		logger.Logf(ctx, "warn", "event publisher stopped, retrying: "+fmt.Sprint(err))
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

func (p *Publisher) publishSession(ctx context.Context) error {
	conn, err := amqp.DialConfig(p.RabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
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
	logger.Info(ctx, "event publisher connected")
	for {
		n, err := p.publishBatch(ctx, ch)
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

func (p *Publisher) publishBatch(ctx context.Context, ch *amqp.Channel) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, p.DB, func(tx pgx.Tx) error {
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
