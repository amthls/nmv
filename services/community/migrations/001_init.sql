-- community_db (Plan/community.md): Fandom posts, comments (stories, chapters, posts), reactions, reports.
-- Users and stories live elsewhere (identity / backend): plain UUIDs here, no foreign keys to them.

CREATE EXTENSION IF NOT EXISTS pg_trgm; -- trusted: the database owner may create it

-- Smart codes, same as the backend's 017_smart_codes.sql: P-<category>-<YY>-<no>, RP-<target>-<YY>-<no>
CREATE FUNCTION code_year(t TIMESTAMPTZ) RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT to_char(COALESCE(t, NOW()), 'YY') $$;
CREATE FUNCTION code_num(n BIGINT, width INT DEFAULT 4) RETURNS TEXT LANGUAGE sql IMMUTABLE
  AS $$ SELECT lpad(n::text, GREATEST(width, length(n::text)), '0') $$;
CREATE FUNCTION set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;

CREATE SEQUENCE posts_code_seq;
CREATE TABLE posts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL,
    title             VARCHAR(500) NOT NULL,
    slug              VARCHAR(500) NOT NULL UNIQUE,
    content           TEXT NOT NULL,
    cover_image_url   TEXT,
    images            JSONB DEFAULT '[]',
    story_id          UUID,                       -- a story in the backend (catalog)
    is_published      BOOLEAN DEFAULT TRUE,
    is_draft          BOOLEAN DEFAULT FALSE,
    is_deleted        BOOLEAN DEFAULT FALSE,
    approval_status   VARCHAR(20) DEFAULT 'approved',
    approved_by       UUID,
    approved_at       TIMESTAMPTZ,
    view_count        BIGINT DEFAULT 0,
    comment_count     INT DEFAULT 0,
    reaction_count    INT DEFAULT 0,
    published_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    category          VARCHAR(20) NOT NULL DEFAULT 'discussion',
    is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
    rejection_reason  TEXT,
    code_no           BIGINT NOT NULL UNIQUE,
    code              VARCHAR(40) NOT NULL,
    removed_by        UUID,
    removed_at        TIMESTAMPTZ
);
CREATE INDEX idx_posts_feed ON posts(approval_status, is_published, published_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_posts_removed ON posts(removed_at DESC) WHERE approval_status = 'rejected';
CREATE INDEX idx_posts_story ON posts(story_id);
CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_posts_title_trgm ON posts USING gin (title gin_trgm_ops);

CREATE FUNCTION posts_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('posts_code_seq'));
  NEW.code := 'P-' || CASE NEW.category WHEN 'review' THEN 'RV' WHEN 'fanart' THEN 'FA' WHEN 'theory' THEN 'TH'
                                        WHEN 'news' THEN 'NW' WHEN 'question' THEN 'QA' ELSE 'DS' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_posts_code BEFORE INSERT OR UPDATE OF code_no, category ON posts FOR EACH ROW EXECUTE FUNCTION posts_set_code();
CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE post_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    reaction    VARCHAR(10) NOT NULL CHECK (reaction IN ('like', 'love', 'haha', 'wow', 'sad', 'angry')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (post_id, user_id)
);

-- "Tắt thông báo bài viết này"
CREATE TABLE post_notification_mutes (
    user_id     UUID NOT NULL,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

CREATE TABLE comments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL,
    target_type  VARCHAR(10) NOT NULL CHECK (target_type IN ('chapter', 'post', 'story')),
    target_id    UUID NOT NULL,
    parent_id    UUID REFERENCES comments(id) ON DELETE CASCADE,
    root_id      UUID REFERENCES comments(id) ON DELETE CASCADE,
    depth        INT DEFAULT 0,
    content      TEXT NOT NULL,
    is_edited    BOOLEAN DEFAULT FALSE,
    is_deleted   BOOLEAN DEFAULT FALSE,
    quoted_text  TEXT,
    like_count   INT DEFAULT 0,
    reply_count  INT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_comments_target ON comments(target_type, target_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE TRIGGER trg_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE comment_likes (
    user_id     UUID NOT NULL,
    comment_id  UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, comment_id)
);

CREATE SEQUENCE reports_code_seq;
CREATE TABLE reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id      UUID NOT NULL,
    target_type      VARCHAR(50) NOT NULL,
    target_id        UUID NOT NULL,
    reason           VARCHAR(100) NOT NULL,
    description      TEXT,
    status           VARCHAR(20) DEFAULT 'pending',
    resolved_by      UUID,
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    code_no          BIGINT NOT NULL UNIQUE,
    code             VARCHAR(40) NOT NULL,
    -- What was reported, as it was then (stories/chapters live in the backend): searchable, linkable
    target_preview   TEXT,
    target_code      VARCHAR(60),
    target_path      TEXT
);
CREATE INDEX idx_reports_reporter_time ON reports(reporter_id, created_at DESC);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);
CREATE UNIQUE INDEX uq_reports_pending ON reports(reporter_id, target_type, target_id) WHERE status = 'pending';

CREATE FUNCTION reports_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('reports_code_seq'));
  NEW.code := 'RP-' || CASE NEW.target_type WHEN 'story' THEN 'ST' WHEN 'chapter' THEN 'CH'
                                            WHEN 'comment' THEN 'CM' WHEN 'post' THEN 'PO' ELSE 'XX' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_reports_code BEFORE INSERT OR UPDATE OF code_no ON reports FOR EACH ROW EXECUTE FUNCTION reports_set_code();

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
