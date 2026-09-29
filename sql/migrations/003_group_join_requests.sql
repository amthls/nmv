-- Join requests for translation groups: a user asks to join, a group leader/mod (or site admin)
-- approves or rejects. Idempotent; apply to an existing database with:
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/003_group_join_requests.sql

-- New notification kind for "someone asked to join your group" (the decision reuses group_member_add / system)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'group_join_request';

CREATE TABLE IF NOT EXISTS group_join_requests (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id    UUID NOT NULL REFERENCES translation_groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     VARCHAR(500),
    status      approval_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- At most one open request per user per group (history of past requests is kept)
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_join_requests_pending
    ON group_join_requests (group_id, user_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_group_join_requests_group
    ON group_join_requests (group_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_group_join_requests_user
    ON group_join_requests (user_id);
