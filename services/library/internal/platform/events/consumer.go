package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	amqp "github.com/rabbitmq/amqp091-go"
)

// identity.user.deleted on the novelhub.events exchange: a deleted account follows and is followed by nobody (as the
// backend did). Own queue library.identity, retried through .retry (10 s), parked in .dlq after 5 attempts.

const (
	eventsExchange = "novelhub.events"
	identityQueue  = "library.identity"
)

func (s *server) consumeIdentity(ctx context.Context) {
	if s.cfg.RabbitURL == "" {
		logf(ctx, "warn", "RABBITMQ_URL empty: account deletions are not applied")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.identitySession(ctx)
		if ctx.Err() != nil {
			return
		}
		logf(ctx, "warn", "identity consumer stopped, retrying: "+fmt.Sprint(err))
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

func (s *server) identitySession(ctx context.Context) error {
	conn, err := amqp.DialConfig(s.cfg.RabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	retry, dlq := identityQueue+".retry", identityQueue+".dlq"
	steps := []func() error{
		func() error { return ch.ExchangeDeclare(eventsExchange, "topic", true, false, false, false, nil) },
		func() error { _, err := ch.QueueDeclare(dlq, true, false, false, false, nil); return err },
		func() error {
			_, err := ch.QueueDeclare(retry, true, false, false, false, amqp.Table{
				"x-message-ttl": int32(10000), "x-dead-letter-exchange": "", "x-dead-letter-routing-key": identityQueue})
			return err
		},
		func() error {
			_, err := ch.QueueDeclare(identityQueue, true, false, false, false, amqp.Table{
				"x-dead-letter-exchange": "", "x-dead-letter-routing-key": retry})
			return err
		},
		func() error { return ch.QueueBind(identityQueue, "identity.user.deleted", eventsExchange, false, nil) },
		func() error { return ch.Qos(20, 0, false) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	deliveries, err := ch.Consume(identityQueue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	closed := conn.NotifyClose(make(chan *amqp.Error, 1))
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case e := <-closed:
			return e
		case d, open := <-deliveries:
			if !open {
				return fmt.Errorf("deliveries closed")
			}
			if err := s.applyIdentityEvent(ctx, d.Body); err == nil {
				d.Ack(false)
			} else if attempts(d, identityQueue) >= 5 {
				logError(ctx, "identity event parked in "+dlq+": "+err.Error())
				ch.PublishWithContext(ctx, "", dlq, false, false, amqp.Publishing{DeliveryMode: amqp.Persistent, Body: d.Body})
				d.Ack(false)
			} else {
				logf(ctx, "warn", "identity event failed, retrying: "+err.Error())
				d.Nack(false, false) // dead-letters to the retry queue, back here after 10 s
			}
		}
	}
}

// attempts: how many times this message already went round queue -> retry (RabbitMQ's x-death count) + this one.
func attempts(d amqp.Delivery, queue string) int64 {
	deaths, _ := d.Headers["x-death"].([]any)
	for _, x := range deaths {
		if t, ok := x.(amqp.Table); ok && t["queue"] == queue {
			if n, ok := t["count"].(int64); ok {
				return n + 1
			}
		}
	}
	return 1
}

func (s *server) applyIdentityEvent(ctx context.Context, body []byte) error {
	var evt struct {
		EventID string `json:"event_id"`
		Type    string `json:"type"`
		Data    struct {
			ID        string  `json:"id"`
			DeletedAt *string `json:"deleted_at"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &evt); err != nil || !isUUID(evt.EventID) {
		return fmt.Errorf("malformed event")
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING`, evt.EventID, evt.Type)
		if err != nil || tag.RowsAffected() == 0 {
			return err // seen before: nothing to do
		}
		if evt.Type == "identity.user.deleted" && evt.Data.DeletedAt != nil && isUUID(evt.Data.ID) {
			_, err = tx.Exec(ctx, `DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1`, evt.Data.ID)
		}
		return err
	})
}
