-- ws_db, stage 1: the official line of every chapter and its full history (Plan/chapter-workspace.md).
-- Content is stored per block, addressed by hash: a revision is an ordered array of hashes, so copying or rewinding
-- a chapter costs a few bytes, and an unchanged paragraph is stored once however many versions contain it.

CREATE TABLE content_blocks (
    hash  TEXT PRIMARY KEY,               -- sha256 of the block's canonical JSON (without its positional id)
    data  JSONB NOT NULL
);

-- Current state of each chapter (catalog.chapters uses the same UUID). Locked FOR UPDATE by every write.
CREATE TABLE chapter_heads (
    chapter_id       UUID PRIMARY KEY,
    story_id         UUID NOT NULL,
    chapter_number   NUMERIC(10,2) NOT NULL,
    current_version  INT NOT NULL,
    deleted          BOOLEAN NOT NULL DEFAULT FALSE
);
-- Two live chapters of a story never share a number (the catalog has the same rule)
CREATE UNIQUE INDEX chapter_heads_number ON chapter_heads(story_id, chapter_number) WHERE NOT deleted;
CREATE INDEX chapter_heads_story ON chapter_heads(story_id);

-- Never updated or deleted: editing, rewinding, deleting and restoring all append a version.
CREATE TABLE chapter_revisions (
    chapter_id   UUID NOT NULL REFERENCES chapter_heads(chapter_id),
    version      INT NOT NULL,
    story_id     UUID NOT NULL,
    meta         JSONB NOT NULL,              -- title, chapter_number, volume_id, intro_note, outro_note
    blocks       TEXT[] NOT NULL,             -- content_blocks hashes, in reading order
    deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    source       TEXT NOT NULL CHECK (source IN ('import', 'create', 'edit', 'rewind', 'delete', 'restore')),
    based_on     INT,                         -- the version it was made from (rewind: the version brought back)
    author_id    UUID,
    author_name  TEXT,                        -- display name at the time (workspace keeps no user table)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chapter_id, version)
);

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
