-- messaging_db: direct messages and group chats as "conversations" (Plan/messaging.md, E2).
-- Users and groups live elsewhere (identity / backend): plain UUIDs here, no foreign keys to them.

CREATE TABLE conversations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind             TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
    dm_key           TEXT UNIQUE,                 -- dm: "<smaller user id>:<larger user id>"
    group_id         UUID UNIQUE,                 -- group: the translation group
    last_message_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((kind = 'dm') = (dm_key IS NOT NULL) AND (kind = 'group') = (group_id IS NOT NULL))
);

-- dm: both people. Groups keep no member rows here: the backend's group membership decides (asked, cached).
CREATE TABLE conversation_members (
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL,
    last_read_seq    BIGINT NOT NULL DEFAULT 0,  -- messages up to this seq are read
    last_read_at     TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members(user_id);

CREATE TABLE messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq              BIGSERIAL UNIQUE,            -- order and "read up to" marker
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id        UUID NOT NULL,
    body             TEXT NOT NULL,
    draft_id         UUID,                        -- a workspace draft card (the workspace checks who may open it)
    pinned_at        TIMESTAMPTZ,
    pinned_by        UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_conversation ON messages(conversation_id, seq DESC);
CREATE INDEX messages_pinned ON messages(conversation_id) WHERE pinned_at IS NOT NULL;

CREATE TABLE user_blocks (
    blocker_id  UUID NOT NULL,
    blocked_id  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE dm_labels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    name        VARCHAR(30) NOT NULL,
    color       VARCHAR(20) NOT NULL DEFAULT 'sky',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX dm_labels_user_name ON dm_labels(user_id, lower(name));

-- A label of mine on my conversation with partner_id
CREATE TABLE dm_label_conversations (
    label_id    UUID NOT NULL REFERENCES dm_labels(id) ON DELETE CASCADE,
    partner_id  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (label_id, partner_id)
);
