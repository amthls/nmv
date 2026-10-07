-- EPUB / PDF downloads. The story's team opts in per story (allow_download); every generated file
-- is cached in story_exports, keyed by what it contains, so the same selection is built only once.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS story_exports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    format          VARCHAR(10) NOT NULL CHECK (format IN ('epub', 'pdf')),
    mode            VARCHAR(10) NOT NULL CHECK (mode IN ('merged', 'single')),
    chapter_ids     UUID[] NOT NULL,
    -- hash of format + mode + the chapters' ids/updated_at + story metadata: any edit makes a new key
    cache_key       VARCHAR(64) NOT NULL UNIQUE,
    status          VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    progress        SMALLINT NOT NULL DEFAULT 0,
    file_name       VARCHAR(300),
    file_path       TEXT,
    file_size       BIGINT,
    error           TEXT,
    requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    download_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_exports_story ON story_exports(story_id);
CREATE INDEX IF NOT EXISTS idx_story_exports_last_used ON story_exports(last_used_at);
