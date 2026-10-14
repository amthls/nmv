// Package events is the RabbitMQ consumer of identity.user.deleted (own queue, retry, dead-letter).
package events

import (
	"context"
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"nmv/library/internal/platform/logger"
)

// identity.user.deleted on the novelhub.events exchange: a deleted account follows and is followed by nobody (as the
// backend did). Own queue library.identity, retried through .retry (10 s), parked in .dlq after 5 attempts.

const (
	// Exchange is the topic exchange every service publishes to.
	Exchange = "novelhub.events"
	// IdentityQueue is library's own queue for identity.user.deleted.
	IdentityQueue = "library.identity"
)

// Handler applies one event body; an error sends it to the retry queue.
type Handler func(ctx context.Context, body []byte) error

// ConsumeIdentity runs the consumer until ctx ends, reconnecting with backoff.
func ConsumeIdentity(ctx context.Context, rabbitURL string, apply Handler) {
	if rabbitURL == "" {
		logger.Logf(ctx, "warn", "RABBITMQ_URL empty: account deletions are not applied")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := identitySession(ctx, rabbitURL, apply)
		if ctx.Err() != nil {
			return
		}
		logger.Logf(ctx, "warn", "identity consumer stopped, retrying: "+fmt.Sprint(err))
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

func identitySession(ctx context.Context, rabbitURL string, apply Handler) error {
	conn, err := amqp.DialConfig(rabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	retry, dlq := IdentityQueue+".retry", IdentityQueue+".dlq"
	steps := []func() error{
		func() error { return ch.ExchangeDeclare(Exchange, "topic", true, false, false, false, nil) },
		func() error { _, err := ch.QueueDeclare(dlq, true, false, false, false, nil); return err },
		func() error {
			_, err := ch.QueueDeclare(retry, true, false, false, false, amqp.Table{
				"x-message-ttl": int32(10000), "x-dead-letter-exchange": "", "x-dead-letter-routing-key": IdentityQueue})
			return err
		},
		func() error {
			_, err := ch.QueueDeclare(IdentityQueue, true, false, false, false, amqp.Table{
				"x-dead-letter-exchange": "", "x-dead-letter-routing-key": retry})
			return err
		},
		func() error { return ch.QueueBind(IdentityQueue, "identity.user.deleted", Exchange, false, nil) },
		func() error { return ch.Qos(20, 0, false) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	deliveries, err := ch.Consume(IdentityQueue, "", false, false, false, false, nil)
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
			if err := apply(ctx, d.Body); err == nil {
				d.Ack(false)
			} else if attempts(d, IdentityQueue) >= 5 {
				logger.Error(ctx, "identity event parked in "+dlq+": "+err.Error())
				ch.PublishWithContext(ctx, "", dlq, false, false, amqp.Publishing{DeliveryMode: amqp.Persistent, Body: d.Body})
				d.Ack(false)
			} else {
				logger.Logf(ctx, "warn", "identity event failed, retrying: "+err.Error())
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
