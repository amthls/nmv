-- identity_db: accounts, roles, sessions, one-time account tokens, security log, event + mail outboxes.
-- Applied by the service at start-up (see migrate.go), inside one transaction.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id                UUID PRIMARY KEY,                -- same UUIDs as before the split (backend keeps them)
    username          CITEXT NOT NULL UNIQUE,
    email             CITEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,                   -- argon2id ($argon2id$...) or legacy bcrypt ($2a$/$2b$), '!' = no login
    display_name      TEXT,                            -- copy for mails/events; the backend owns the profile
    email_verified    BOOLEAN NOT NULL DEFAULT FALSE,
    is_banned         BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason        TEXT,
    banned_at         TIMESTAMPTZ,
    banned_by         UUID,
    deleted_at        TIMESTAMPTZ,
    deleted_by        UUID,
    locked_until      TIMESTAMPTZ,                     -- set after 5 wrong passwords in 15 minutes (counted in security_log)
    last_login_at     TIMESTAMPTZ,
    version           BIGINT NOT NULL DEFAULT 1,       -- bumped on every change that is published as an event
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('reader', 'author', 'translator', 'mod', 'admin')),
    is_visible  BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by  UUID,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role)
);

-- One row per signed-in device. The refresh token itself is never stored, only its SHA-256.
CREATE TABLE sessions (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash  TEXT NOT NULL UNIQUE,
    device        TEXT,                                -- trimmed User-Agent
    created_ip    TEXT,
    last_ip       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    revoke_reason TEXT
);
CREATE INDEX sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

-- Refresh tokens already rotated away: presenting one again (after a short grace) means it was stolen.
CREATE TABLE refresh_tokens_used (
    hash        TEXT PRIMARY KEY,
    session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE account_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('reset_password', 'verify_email')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX account_tokens_user ON account_tokens(user_id, purpose);

-- Kept 90 days. Full IP is allowed here (and in sessions) only.
CREATE TABLE security_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID,
    actor_id    UUID,
    event       TEXT NOT NULL,                         -- login_ok, login_failed, locked, password_changed, ...
    ip          TEXT,
    user_agent  TEXT,
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX security_log_user ON security_log(user_id, created_at DESC);
CREATE INDEX security_log_time ON security_log(created_at);

-- Transactional outbox: written in the same transaction as the change, published to RabbitMQ afterwards.
CREATE TABLE outbox (
    id            BIGSERIAL PRIMARY KEY,
    event_id      UUID NOT NULL UNIQUE,
    routing_key   TEXT NOT NULL,
    payload       JSONB NOT NULL,
    request_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at  TIMESTAMPTZ
);
CREATE INDEX outbox_pending ON outbox(id) WHERE published_at IS NULL;

CREATE TABLE mail_outbox (
    id            BIGSERIAL PRIMARY KEY,
    to_addr       TEXT NOT NULL,
    subject       TEXT NOT NULL,
    body_text     TEXT NOT NULL,
    body_html     TEXT NOT NULL,
    attempts      INT NOT NULL DEFAULT 0,
    next_try_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error    TEXT,
    sent_at       TIMESTAMPTZ,
    failed_at     TIMESTAMPTZ,                         -- gave up after the retry window
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mail_outbox_pending ON mail_outbox(next_try_at) WHERE sent_at IS NULL AND failed_at IS NULL;
