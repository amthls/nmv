-- media_db: EPUB/PDF builds (moved from the backend's story_exports; it is a cache, so no data is copied).
-- Every generated file is keyed by what it contains, so the same selection is built only once.
CREATE TABLE story_exports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id        UUID NOT NULL,                     -- the backend's story (no FK: another database)
    format          VARCHAR(10) NOT NULL CHECK (format IN ('epub', 'pdf')),
    mode            VARCHAR(10) NOT NULL CHECK (mode IN ('merged', 'single')),
    chapter_ids     UUID[] NOT NULL,
    -- hash of format + mode + the chapters' fingerprints + story metadata: any edit makes a new key
    cache_key       VARCHAR(64) NOT NULL UNIQUE,
    status          VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    progress        SMALLINT NOT NULL DEFAULT 0,
    file_name       VARCHAR(300),
    file_path       TEXT,
    file_size       BIGINT,
    error           TEXT,
    requested_by    UUID,
    download_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX story_exports_story ON story_exports(story_id);
CREATE INDEX story_exports_last_used ON story_exports(last_used_at);
CREATE INDEX story_exports_queued ON story_exports(updated_at) WHERE status = 'queued';
