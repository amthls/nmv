-- Direct messages: personal labels for conversations, blocking, pinned messages.

-- A user's own labels ("Nhóm dịch", "Bạn bè"...). The other person never sees them.
CREATE TABLE IF NOT EXISTS dm_labels (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(30) NOT NULL,
    color      VARCHAR(20) NOT NULL DEFAULT 'sky',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dm_labels_user_name ON dm_labels(user_id, LOWER(name));

-- A conversation is (label owner, partner); one conversation can carry several labels.
CREATE TABLE IF NOT EXISTS dm_label_conversations (
    label_id   UUID NOT NULL REFERENCES dm_labels(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (label_id, partner_id)
);

-- blocker no longer receives messages from blocked, and cannot send to them either.
CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- Pinned messages are shared: both people in the conversation see them.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_direct_messages_pinned ON direct_messages(sender_id, recipient_id) WHERE pinned_at IS NOT NULL;
