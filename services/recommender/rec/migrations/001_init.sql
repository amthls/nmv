-- recommender_db (Plan/recommender.md). Signals arrive as events; the training job writes the rec_* results the API reads.

-- Read copy of the backend's stories (story cards + the content model), synced by updated_at like library's ext_stories
CREATE TABLE ext_stories (
    id               UUID PRIMARY KEY,
    title            TEXT NOT NULL,
    slug             TEXT NOT NULL,
    cover_image_url  TEXT,
    story_type       TEXT,
    status           TEXT,
    approval_status  TEXT,
    author_name      TEXT,
    group_id         UUID,
    synopsis         TEXT,
    tags             JSONB NOT NULL DEFAULT '[]',
    total_chapters   INT NOT NULL DEFAULT 0,
    total_views      BIGINT NOT NULL DEFAULT 0,
    total_favorites  BIGINT NOT NULL DEFAULT 0,
    last_chapter_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE sync_state (name TEXT PRIMARY KEY, last_ts TIMESTAMPTZ NOT NULL, last_id UUID NOT NULL);

-- Behaviour: story page views and chapter reads (catalog.* events, signed in or guest by the nh_vid cookie),
-- impressions/clicks on the recommendation rows (POST /events)
CREATE TABLE events (
    id          BIGSERIAL PRIMARY KEY,
    event_id    UUID UNIQUE,              -- the bus event (redelivery is ignored); NULL for rows/legacy
    user_id     UUID,
    visitor_id  VARCHAR(40),
    story_id    UUID NOT NULL,
    chapter_id  UUID,
    kind        VARCHAR(20) NOT NULL,     -- view | read | impression | click
    source      VARCHAR(30),              -- home_rec | related (impression/click only)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);
CREATE INDEX idx_events_user ON events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_events_visitor ON events(visitor_id, created_at DESC) WHERE visitor_id IS NOT NULL;
CREATE INDEX idx_events_created ON events(created_at);
-- one read per chapter per person per day
CREATE UNIQUE INDEX idx_events_read_once ON events (COALESCE(user_id::text, visitor_id), chapter_id, ((created_at AT TIME ZONE 'UTC')::date))
    WHERE kind = 'read';

-- library.* events: the latest state of each row with when it happened (an older event never overwrites a newer one)
CREATE TABLE favorites (
    user_id    UUID NOT NULL,
    story_id   UUID NOT NULL,
    following  BOOLEAN NOT NULL,
    at         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, story_id)
);
CREATE TABLE album_stories (
    album_id  UUID NOT NULL,
    story_id  UUID NOT NULL,
    user_id   UUID NOT NULL,
    present   BOOLEAN NOT NULL,
    at        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (album_id, story_id)
);
CREATE TABLE bookmarks (
    id        UUID PRIMARY KEY,
    user_id   UUID NOT NULL,
    story_id  UUID NOT NULL,
    present   BOOLEAN NOT NULL,
    at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

CREATE TABLE legacy_imports (part TEXT PRIMARY KEY, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Results of the training job (same columns as the backend's former tables)
CREATE TABLE rec_item_similar (
    story_id    UUID NOT NULL,
    similar_id  UUID NOT NULL,
    score       REAL NOT NULL,
    co_readers  INT NOT NULL DEFAULT 0,
    pct_readers REAL NOT NULL DEFAULT 0,
    covisit     REAL NOT NULL DEFAULT 0,
    content     REAL NOT NULL DEFAULT 0,
    reason      VARCHAR(20) NOT NULL,     -- co_read | next_read | same_author | content
    reason_tag  VARCHAR(100),
    PRIMARY KEY (story_id, similar_id)
);
CREATE TABLE rec_user_scores (
    user_id     UUID NOT NULL,
    story_id    UUID NOT NULL,
    score       REAL NOT NULL,
    reason      VARCHAR(20) NOT NULL,     -- because_read | taste | similar_users | popular
    reason_story_id UUID,
    reason_tag  VARCHAR(100),
    pct         REAL,
    PRIMARY KEY (user_id, story_id)
);
CREATE TABLE rec_user_factors (user_id UUID PRIMARY KEY, factors REAL[] NOT NULL);
CREATE TABLE rec_item_factors (story_id UUID PRIMARY KEY, factors REAL[] NOT NULL, popularity REAL NOT NULL DEFAULT 0);
CREATE TABLE rec_model_runs (
    id            BIGSERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms   INT,
    users         INT,
    stories       INT,
    interactions  INT,
    metrics       JSONB,
    status        VARCHAR(20) NOT NULL DEFAULT 'ok',
    error         TEXT
);
