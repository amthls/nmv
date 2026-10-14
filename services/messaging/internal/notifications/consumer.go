package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"nmv/messaging/internal/platform/logger"
)

// RabbitMQ: novel.notifications (the backend's queue.service.ts declares the same topology).
const (
	notifyQueue       = "novel.notifications"
	notifyRetryQueue  = "novel.notifications.retry"
	notifyDLQ         = "novel.notifications.dlq"
	notifyMaxAttempts = 5
)

// ConsumeLoop runs jobs from the queue forever (reconnecting with backoff). Several messaging copies share the queue.
func (s *Service) ConsumeLoop(ctx context.Context, rabbitURL string) {
	if rabbitURL == "" {
		logger.Logf(ctx, "warn", "RABBITMQ_URL empty: notifications only arrive through /internal/notifications/jobs")
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.consumeSession(ctx, rabbitURL)
		if ctx.Err() != nil {
			return
		}
		logger.Logf(ctx, "warn", "notification consumer stopped, retrying: "+fmt.Sprint(err))
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

func (s *Service) consumeSession(ctx context.Context, rabbitURL string) error {
	conn, err := amqp.DialConfig(rabbitURL, amqp.Config{Heartbeat: 30 * time.Second})
	if err != nil {
		return err
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	// Arguments must match the backend's declaration exactly (amqplib sends 10000 as a short)
	if _, err := ch.QueueDeclare(notifyDLQ, true, false, false, false, nil); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(notifyRetryQueue, true, false, false, false, amqp.Table{
		"x-message-ttl": int16(10000), "x-dead-letter-exchange": "", "x-dead-letter-routing-key": notifyQueue}); err != nil {
		return err
	}
	if _, err := ch.QueueDeclare(notifyQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.Qos(20, 0, false); err != nil {
		return err
	}
	deliveries, err := ch.Consume(notifyQueue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	logger.Info(ctx, "consuming "+notifyQueue)
	closed := conn.NotifyClose(make(chan *amqp.Error, 1))
	sem := make(chan struct{}, 4) // a big fan-out must not hold up everything else
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
			sem <- struct{}{}
			go func() {
				defer func() { <-sem }()
				s.handleDelivery(ctx, ch, d)
			}()
		}
	}
}

// handleDelivery runs one job; a failure goes to the retry queue (10 s later) or, after 5 attempts, to the DLQ.
// Acked only after that, so a crash re-delivers it (deliveries are idempotent thanks to dedupe keys).
func (s *Service) handleDelivery(ctx context.Context, ch *amqp.Channel, d amqp.Delivery) {
	var env envelope
	var job notifyJob
	if json.Unmarshal(d.Body, &env) != nil || json.Unmarshal(env.Job, &job) != nil {
		ch.PublishWithContext(ctx, "", notifyDLQ, false, false, amqp.Publishing{DeliveryMode: amqp.Persistent, Body: d.Body})
		d.Ack(false)
		return
	}
	start := time.Now()
	n, err := s.RunJob(ctx, job)
	if err == nil {
		if job.Kind == "chapter_published" {
			logger.Info(ctx, "chapter_published "+env.ID+": "+strconv.Itoa(n)+" notifications in "+time.Since(start).Round(time.Millisecond).String())
		}
		d.Ack(false)
		return
	}
	env.Attempts++
	to := notifyRetryQueue
	if env.Attempts >= notifyMaxAttempts {
		to = notifyDLQ
	}
	logger.Logf(ctx, "warn", fmt.Sprintf("notification job %s (%s) failed (attempt %d): %v, to %s", env.ID, job.Kind, env.Attempts, err, to))
	body, _ := json.Marshal(env)
	if perr := ch.PublishWithContext(ctx, "", to, false, false, amqp.Publishing{
		ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: body}); perr != nil {
		d.Nack(false, true) // could not park it: let the broker give it back
		return
	}
	d.Ack(false)
}

// CleanupLoop keeps the inbox small once an hour (see cleanupQueries).
func (s *Service) CleanupLoop(ctx context.Context) {
	for {
		for _, q := range cleanupQueries {
			if err := s.repo.cleanup(ctx, q); err != nil && ctx.Err() == nil {
				logger.Logf(ctx, "warn", "notification cleanup: "+err.Error())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Hour):
		}
	}
}
