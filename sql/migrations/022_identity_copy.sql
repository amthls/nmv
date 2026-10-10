-- 022: accounts move to the identity service (Plan/identity.md). users / user_roles become a copy kept in step
-- by identity.user.* events. 019-021 are taken by the no-approval branch.
-- The credential columns are NOT dropped yet: nothing reads or writes them any more, and they stay as a way back
-- until the switch is confirmed; a later migration drops email, password_hash, tokens_valid_after, last_login_at
-- and auth_tokens.

-- New accounts arrive from identity without these
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Version of the identity snapshot this row reflects: older or repeated events are ignored
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_version BIGINT NOT NULL DEFAULT 0;

-- Events already applied (consumer side of the outbox pattern): a redelivery is a no-op
CREATE TABLE IF NOT EXISTS processed_events (
    event_id      UUID PRIMARY KEY,
    type          TEXT NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_time ON processed_events(processed_at);

COMMENT ON COLUMN users.email IS 'Deprecated (identity owns it). Not read or written since the identity switch; to be dropped.';
COMMENT ON COLUMN users.password_hash IS 'Deprecated (identity owns it). Not read or written since the identity switch; to be dropped.';
