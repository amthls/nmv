-- library_db (Plan/library.md): follows, line bookmarks, reading history, albums, user follows.
-- Users and stories live elsewhere (identity / backend): plain UUIDs here; ext_* are read copies of the backend's
-- stories and chapters (synced by updated_at, purged when the backend deletes), so the reading lists can JOIN them.

CREATE FUNCTION code_year(t TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT to_char(COALESCE(t, NOW()), 'YY') $$;
CREATE FUNCTION code_num(n BIGINT, width INT DEFAULT 4) RETURNS TEXT LANGUAGE sql IMMUTABLE
  AS $$ SELECT lpad(n::text, GREATEST(width, length(n::text)), '0') $$;

CREATE TABLE ext_stories (
    id               UUID PRIMARY KEY,
    title            TEXT NOT NULL,
    slug             TEXT NOT NULL,
    cover_image_url  TEXT,
    author_name      TEXT,
    story_type       TEXT,
    status           TEXT,
    approval_status  TEXT,
    total_chapters   INT,
    total_views      BIGINT,
    total_favorites  BIGINT,
    group_name       TEXT,
    tags             JSONB NOT NULL DEFAULT '[]', -- [{name, slug}]
    updated_at       TIMESTAMPTZ NOT NULL,        -- the backend's, the sync cursor
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE ext_chapters (
    id              UUID PRIMARY KEY,
    story_id        UUID NOT NULL,
    title           TEXT,
    slug            TEXT NOT NULL,
    chapter_number  NUMERIC(10,2) NOT NULL,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ext_chapters_story ON ext_chapters(story_id, chapter_number DESC);
-- where each copy's sync got to: (updated_at, id) of the last row taken
CREATE TABLE sync_state (
    name     TEXT PRIMARY KEY,
    last_ts  TIMESTAMPTZ NOT NULL,
    last_id  UUID NOT NULL
);

CREATE TABLE user_favorites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    story_id        UUID NOT NULL,
    category        VARCHAR(50) DEFAULT 'default',
    notify_updates  BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, story_id)
);
CREATE INDEX idx_favorites_story ON user_favorites(story_id);
CREATE INDEX idx_favorites_user ON user_favorites(user_id);

CREATE TABLE bookmarks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    story_id         UUID NOT NULL,
    chapter_id       UUID NOT NULL,
    line_text        TEXT,
    line_index       INT,
    scroll_position  NUMERIC(5,2),
    page_number      INT,
    note             TEXT,
    color            VARCHAR(7) DEFAULT '#FFD700',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bookmarks_lookup ON bookmarks(user_id, chapter_id, line_index);
CREATE INDEX idx_bookmarks_story ON bookmarks(user_id, story_id);
CREATE INDEX idx_bookmarks_chapter ON bookmarks(chapter_id);

CREATE TABLE reading_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL,
    story_id            UUID NOT NULL,
    chapter_id          UUID NOT NULL,
    scroll_position     NUMERIC(5,2) DEFAULT 0,
    page_number         INT,
    read_at             TIMESTAMPTZ DEFAULT NOW(),
    time_spent_seconds  INT DEFAULT 0,
    UNIQUE (user_id, chapter_id)
);
CREATE INDEX idx_reading_history_story ON reading_history(story_id);
CREATE INDEX idx_reading_history_user ON reading_history(user_id, read_at DESC);

CREATE SEQUENCE albums_code_seq;
CREATE TABLE albums (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL,
    owner_code_no  BIGINT,                  -- the owner's account number, for the AL- code (taken when created)
    name           VARCHAR(100) NOT NULL,
    description    VARCHAR(500),
    is_public      BOOLEAN NOT NULL DEFAULT FALSE,
    share_token    VARCHAR(32) NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
    copied_from    UUID REFERENCES albums(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    code_no        BIGINT NOT NULL UNIQUE,
    code           VARCHAR(40) NOT NULL
);
CREATE INDEX idx_albums_user ON albums(user_id, created_at DESC);
CREATE FUNCTION albums_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('albums_code_seq'));
  NEW.code := 'AL-' || COALESCE(code_num(NEW.owner_code_no), '0000') || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_albums_code BEFORE INSERT OR UPDATE OF code_no ON albums FOR EACH ROW EXECUTE FUNCTION albums_set_code();

CREATE TABLE album_stories (
    album_id  UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    story_id  UUID NOT NULL,
    added_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (album_id, story_id)
);
CREATE INDEX idx_album_stories_story ON album_stories(story_id);

CREATE TABLE album_saves (
    user_id      UUID NOT NULL,
    album_id     UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    share_token  VARCHAR(32),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, album_id)
);
CREATE INDEX idx_album_saves_album ON album_saves(album_id);

CREATE TABLE user_follows (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id   UUID NOT NULL,
    following_id  UUID NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (follower_id, following_id),
    CHECK (follower_id <> following_id)
);
CREATE INDEX idx_follows_following ON user_follows(following_id);

-- identity.* events applied once
CREATE TABLE processed_events (
    event_id    UUID PRIMARY KEY,
    type        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- import-legacy parts already done (each runs once: what was deleted here never comes back from the old tables)
CREATE TABLE legacy_imports (
    part     TEXT PRIMARY KEY,
    done_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
