-- Recommendations ("Đề xuất cho bạn" on the home page, "Truyện liên quan" on a story page).
-- rec_events is the raw signal (also for guests, keyed by the anonymous `vid` cookie); the
-- worker trains on it plus reading_history / favorites / albums / ratings and writes the
-- precomputed results into the rec_* tables below, which the API only reads.

-- Behaviour log: story page views, chapter reads, and impressions/clicks on recommendation rows
CREATE TABLE IF NOT EXISTS rec_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    visitor_id  VARCHAR(40),
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id  UUID REFERENCES chapters(id) ON DELETE SET NULL,
    kind        VARCHAR(20) NOT NULL,   -- view | read | impression | click
    source      VARCHAR(30),            -- home_rec | related (impression/click only)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_rec_events_user ON rec_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rec_events_visitor ON rec_events(visitor_id, created_at DESC) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rec_events_created ON rec_events(created_at);

-- "Truyện liên quan": top neighbours of each story, with the parts of the score for the label
CREATE TABLE IF NOT EXISTS rec_item_similar (
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    similar_id  UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    score       REAL NOT NULL,
    co_readers  INT NOT NULL DEFAULT 0,   -- readers of both
    pct_readers REAL NOT NULL DEFAULT 0,  -- co_readers / readers of story_id
    covisit     REAL NOT NULL DEFAULT 0,  -- how often similar_id is read right after story_id
    content     REAL NOT NULL DEFAULT 0,  -- genre/author/synopsis similarity
    reason      VARCHAR(20) NOT NULL,     -- co_read | next_read | same_author | content
    reason_tag  VARCHAR(100),             -- shared genre shown in the label
    PRIMARY KEY (story_id, similar_id)
);

-- "Đề xuất cho bạn": precomputed top stories per signed-in user
CREATE TABLE IF NOT EXISTS rec_user_scores (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    score       REAL NOT NULL,
    reason      VARCHAR(20) NOT NULL,     -- because_read | taste | similar_users | popular
    reason_story_id UUID REFERENCES stories(id) ON DELETE SET NULL,
    reason_tag  VARCHAR(100),
    pct         REAL,                     -- share of similar readers who read it
    PRIMARY KEY (user_id, story_id)
);

-- Latent vectors from matrix factorization, used to re-rank related stories per user
CREATE TABLE IF NOT EXISTS rec_user_factors (
    user_id  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    factors  REAL[] NOT NULL
);
CREATE TABLE IF NOT EXISTS rec_item_factors (
    story_id    UUID PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
    factors     REAL[] NOT NULL,
    popularity  REAL NOT NULL DEFAULT 0
);

-- One row per training run: data size, time taken and offline quality vs. a popularity baseline
CREATE TABLE IF NOT EXISTS rec_model_runs (
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
