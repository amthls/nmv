-- messaging_db: notifications (Plan/messaging.md, E3). type is a string registered in notify.go (no enum).

CREATE TABLE notifications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    type         TEXT NOT NULL,
    category     TEXT NOT NULL,              -- read | interaction | group | workspace | moderation | system
    title        TEXT NOT NULL,              -- of the newest event; grouped rows get their title when read
    message      TEXT,
    link         TEXT,                       -- where a click goes (snapshot taken by the sender)
    image        TEXT,
    actors       JSONB NOT NULL DEFAULT '[]', -- newest first, at most 3: [{id, name}]
    actor_count  INT NOT NULL DEFAULT 0,
    count        INT NOT NULL DEFAULT 1,     -- events merged into this row
    data         JSONB NOT NULL DEFAULT '{}', -- story_title, group_name... for grouped titles
    group_key    TEXT,                       -- unread rows with the same key merge
    seen_at      TIMESTAMPTZ,                -- the bell was opened after it arrived
    read_at      TIMESTAMPTZ,                -- clicked / marked read
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_user ON notifications(user_id, updated_at DESC);
CREATE INDEX notifications_unseen ON notifications(user_id) WHERE seen_at IS NULL;
CREATE UNIQUE INDEX notifications_group ON notifications(user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL;

-- Keys already delivered: a re-delivered job never notifies twice (kept 60 days, like unread notifications)
CREATE TABLE notification_dedupe (
    key         TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A row = that category is switched off on the web for that person (no row = on)
CREATE TABLE notification_settings (
    user_id   UUID NOT NULL,
    category  TEXT NOT NULL,
    web       BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, category)
);

-- Site-wide announcements by an admin: one row for everybody, shown 30 days
CREATE TABLE broadcasts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    message     TEXT,
    link        TEXT,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE broadcast_reads (
    broadcast_id  UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL,
    seen_at       TIMESTAMPTZ,
    read_at       TIMESTAMPTZ,
    PRIMARY KEY (broadcast_id, user_id)
);

-- import-legacy parts already done: each runs once, so what people delete here never comes back from the old tables
CREATE TABLE legacy_imports (
    part     TEXT PRIMARY KEY,
    done_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
