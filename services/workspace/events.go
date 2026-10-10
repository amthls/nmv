package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
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
