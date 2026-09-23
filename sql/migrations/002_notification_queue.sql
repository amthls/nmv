-- Idempotent notification writes for the queue worker (RabbitMQ can re-deliver a message).
-- Apply to an existing database with:
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/002_notification_queue.sql

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key varchar(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe
    ON notifications (dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Deleting a user must null out notifications.sender_id (FK ON DELETE SET NULL). Without this index
-- that is a full scan of the notifications table per deleted user, which gets very slow once the
-- queue has produced hundreds of thousands of rows.
CREATE INDEX IF NOT EXISTS idx_notifications_sender
    ON notifications (sender_id)
    WHERE sender_id IS NOT NULL;
