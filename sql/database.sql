-- ============================================================================
-- DATABASE SCHEMA: Hệ thống đọc truyện (Light Novel / Manga Platform)
-- Database: PostgreSQL
-- Version: 1.0
-- Created: 2026-09-02
-- ============================================================================

-- Reset Schema if needed
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Full-text search support

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

-- Vai trò người dùng
CREATE TYPE user_role AS ENUM ('admin', 'mod', 'translator', 'author', 'reader');

-- Loại truyện
CREATE TYPE story_type AS ENUM ('novel', 'manga');

-- Trạng thái truyện
CREATE TYPE story_status AS ENUM ('ongoing', 'completed', 'hiatus', 'dropped');

-- Trạng thái duyệt
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

-- Vai trò trong nhóm dịch
CREATE TYPE group_role AS ENUM ('leader', 'member', 'mod', 'translator', 'editor', 'raw_provider', 'proofreader');

-- Loại thông báo
CREATE TYPE notification_type AS ENUM (
    'system',           -- Thông báo hệ thống từ admin/mod
    'chapter_update',   -- Truyện cập nhật chương mới
    'group_invite',     -- Được mời vào nhóm dịch
    'group_kick',       -- Bị loại khỏi nhóm
    'group_role_change',-- Thay đổi vai trò trong nhóm
    'group_member_add', -- Thành viên mới được thêm
    'comment_reply',    -- Ai đó reply comment
    'bookmark_update',  -- Truyện bookmark có cập nhật
    'post_reaction',    -- Ai đó react bài viết
    'post_comment',     -- Ai đó comment bài viết
    'group_join_request'-- Có người xin gia nhập nhóm (gửi tới trưởng nhóm/mod)
);

-- Loại cảm xúc (reaction)
CREATE TYPE reaction_type AS ENUM ('like', 'love', 'haha', 'wow', 'sad', 'angry');

-- Loại nội dung cho comment
CREATE TYPE comment_target_type AS ENUM ('chapter', 'post', 'story');

-- ============================================================================
-- 1. BẢNG NGƯỜI DÙNG (ACCOUNTS)
-- ============================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(50) NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(100),
    avatar_url      TEXT,
    banner_url      TEXT,
    bio             TEXT,
    is_banned       BOOLEAN DEFAULT FALSE,
    ban_reason      TEXT,
    banned_at       TIMESTAMPTZ,
    banned_by       UUID REFERENCES users(id),
    deleted_at      TIMESTAMPTZ,                  -- tài khoản đã bị xóa (ẩn danh hóa, giữ nội dung)
    deleted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    email_verified  BOOLEAN DEFAULT FALSE,
    tokens_valid_after TIMESTAMPTZ,             -- token đăng nhập cấp trước thời điểm này bị từ chối
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username_trgm ON users USING gin(username gin_trgm_ops);

-- ============================================================================
-- 2. BẢNG PHÂN QUYỀN (USER ROLES)
-- Một user có thể có nhiều role, hiển thị role bên cạnh tên
-- ============================================================================

CREATE TABLE user_roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        user_role NOT NULL DEFAULT 'reader',
    is_visible  BOOLEAN DEFAULT TRUE,  -- Cho phép hiển thị role bên cạnh tên
    granted_by  UUID REFERENCES users(id),
    granted_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- ============================================================================
-- 3. CÀI ĐẶT NGƯỜI DÙNG (USER SETTINGS)
-- ============================================================================

CREATE TABLE user_settings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- Giao diện
    theme               VARCHAR(20) DEFAULT 'dark',         -- 'dark', 'light', 'sepia', 'amoled'
    primary_color       VARCHAR(7) DEFAULT '#6C5CE7',       -- Hex color
    -- Đọc truyện
    font_family         VARCHAR(100) DEFAULT 'Inter',
    font_size           INTEGER DEFAULT 16,                 -- px
    line_height         DECIMAL(3,1) DEFAULT 1.8,
    reading_mode        VARCHAR(20) DEFAULT 'scroll',       -- 'scroll', 'paginated', 'webtoon'
    brightness          INTEGER DEFAULT 100,                -- 0-100%
    text_color          VARCHAR(7) DEFAULT '#E0E0E0',
    background_color    VARCHAR(7) DEFAULT '#1A1A2E',
    -- Thông báo
    notify_chapter_update   BOOLEAN DEFAULT TRUE,
    notify_group_events     BOOLEAN DEFAULT TRUE,
    notify_comments         BOOLEAN DEFAULT TRUE,   -- replies to my comments
    notify_post_comments    BOOLEAN DEFAULT TRUE,   -- comments on my fandom posts
    notify_post_reactions   BOOLEAN DEFAULT TRUE,   -- reactions on my fandom posts
    notify_system           BOOLEAN DEFAULT TRUE,
    -- Ngôn ngữ
    language            VARCHAR(10) DEFAULT 'vi',
    -- Khác
    show_mature_content BOOLEAN DEFAULT FALSE,
    chapters_per_page   INTEGER DEFAULT 50,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. HỆ THỐNG TAG
-- ============================================================================

CREATE TABLE tag_categories (
    id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name    VARCHAR(50) NOT NULL UNIQUE,   -- 'genre', 'theme', 'demographic', 'format', 'content_warning'
    label   VARCHAR(100) NOT NULL,         -- Tên hiển thị
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id     UUID NOT NULL REFERENCES tag_categories(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL UNIQUE,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tags_category ON tags(category_id);
CREATE INDEX idx_tags_slug ON tags(slug);
CREATE INDEX idx_tags_name_trgm ON tags USING gin(name gin_trgm_ops);

-- ============================================================================
-- 5. NHÓM DỊCH (TRANSLATION GROUPS)
-- ============================================================================

CREATE TABLE translation_groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL UNIQUE,
    slug            VARCHAR(200) NOT NULL UNIQUE,
    description     TEXT,
    avatar_url      TEXT,
    banner_url      TEXT,
    website_url     TEXT,
    discord_url     TEXT,
    rules           TEXT,
    is_active       BOOLEAN DEFAULT TRUE,
    approval_status VARCHAR(20) DEFAULT 'approved',
    approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at     TIMESTAMPTZ,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_groups_slug ON translation_groups(slug);
CREATE INDEX idx_groups_name_trgm ON translation_groups USING gin(name gin_trgm_ops);

CREATE TABLE group_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id    UUID NOT NULL REFERENCES translation_groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        group_role NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);

-- Yêu cầu gia nhập nhóm: người dùng xin vào, trưởng nhóm/mod (hoặc admin) duyệt hoặc từ chối
CREATE TABLE group_join_requests (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id    UUID NOT NULL REFERENCES translation_groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     VARCHAR(500),
    status      approval_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_group_join_requests_pending ON group_join_requests(group_id, user_id) WHERE status = 'pending';
CREATE INDEX idx_group_join_requests_group ON group_join_requests(group_id, status, created_at);
CREATE INDEX idx_group_join_requests_user ON group_join_requests(user_id);

CREATE TABLE group_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id    UUID NOT NULL REFERENCES translation_groups(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_group_messages_group ON group_messages(group_id);

-- Tin nhắn riêng giữa hai người dùng (sql/migrations/014_direct_messages.sql)
CREATE TABLE direct_messages (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message      TEXT NOT NULL,
    read_at      TIMESTAMPTZ,
    pinned_at    TIMESTAMPTZ,                  -- tin đã ghim (cả hai người đều thấy)
    pinned_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    draft_id     UUID,                         -- thẻ bản nháp workspace (migration 024)
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX idx_direct_messages_sender ON direct_messages(sender_id, created_at DESC);
CREATE INDEX idx_direct_messages_recipient ON direct_messages(recipient_id, created_at DESC);
CREATE INDEX idx_direct_messages_unread ON direct_messages(recipient_id) WHERE read_at IS NULL;
CREATE INDEX idx_direct_messages_pinned ON direct_messages(sender_id, recipient_id) WHERE pinned_at IS NOT NULL;

-- Nhãn riêng của từng người cho cuộc trò chuyện, chặn người dùng (sql/migrations/016_dm_labels_block_pin.sql)
CREATE TABLE dm_labels (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(30) NOT NULL,
    color      VARCHAR(20) NOT NULL DEFAULT 'sky',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_dm_labels_user_name ON dm_labels(user_id, LOWER(name));

CREATE TABLE dm_label_conversations (
    label_id   UUID NOT NULL REFERENCES dm_labels(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (label_id, partner_id)
);

CREATE TABLE user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_id);

-- Link một lần gửi qua email: đặt lại mật khẩu, xác thực email (sql/migrations/015_account_security.sql).
-- Chỉ lưu SHA-256 của token.
CREATE TABLE auth_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(20) NOT NULL CHECK (purpose IN ('reset_password', 'verify_email')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, purpose);

-- ============================================================================
-- 6. TRUYỆN (STORIES)
-- ============================================================================

CREATE TABLE stories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               VARCHAR(500) NOT NULL,
    slug                VARCHAR(500) NOT NULL UNIQUE,
    original_title      VARCHAR(500),
    synopsis            TEXT,
    cover_image_url     TEXT,
    banner_image_url    TEXT,
    story_type          story_type NOT NULL DEFAULT 'novel',
    status              story_status NOT NULL DEFAULT 'ongoing',
    approval_status     approval_status DEFAULT 'pending',
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    uploader_id         UUID NOT NULL REFERENCES users(id),
    group_id            UUID REFERENCES translation_groups(id) ON DELETE SET NULL,
    original_language   VARCHAR(10) DEFAULT 'ja',
    translated_language VARCHAR(10) DEFAULT 'vi',
    author_name         VARCHAR(200),
    artist_name         VARCHAR(200),
    year_published      INTEGER,
    total_chapters      INTEGER DEFAULT 0,
    total_volumes       INTEGER DEFAULT 0,
    total_views         BIGINT DEFAULT 0,
    total_favorites     BIGINT DEFAULT 0,
    total_bookmarks     BIGINT DEFAULT 0,
    total_comments      BIGINT DEFAULT 0,
    last_chapter_at     TIMESTAMPTZ,
    source_name         VARCHAR(50),    -- where an imported story came from (scripts/crawler.py)
    source_id           VARCHAR(100),
    source_url          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_stories_source ON stories(source_name, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_stories_slug ON stories(slug);
CREATE INDEX idx_stories_uploader ON stories(uploader_id);
CREATE INDEX idx_stories_group ON stories(group_id);
CREATE INDEX idx_stories_type ON stories(story_type);
CREATE INDEX idx_stories_status ON stories(status);
CREATE INDEX idx_stories_approval ON stories(approval_status);
CREATE INDEX idx_stories_views ON stories(total_views DESC);
CREATE INDEX idx_stories_favorites ON stories(total_favorites DESC);
CREATE INDEX idx_stories_last_chapter ON stories(last_chapter_at DESC NULLS LAST);
CREATE INDEX idx_stories_created ON stories(created_at DESC);
CREATE INDEX idx_stories_title_trgm ON stories USING gin(title gin_trgm_ops);

CREATE TABLE story_tags (
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, tag_id)
);

CREATE INDEX idx_story_tags_story ON story_tags(story_id);
CREATE INDEX idx_story_tags_tag ON story_tags(tag_id);

CREATE TABLE story_collaborators (
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(30) DEFAULT 'collaborator',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (story_id, user_id)
);

CREATE INDEX idx_story_collaborators_user ON story_collaborators(user_id);

-- ============================================================================
-- 7. VOLUMES (Tập truyện)
-- ============================================================================

CREATE TABLE volumes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title       VARCHAR(500) NOT NULL,
    volume_number INTEGER NOT NULL,
    cover_image_url TEXT,
    description TEXT,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(story_id, volume_number)
);

CREATE INDEX idx_volumes_story ON volumes(story_id);

-- ============================================================================
-- 8. CHƯƠNG TRUYỆN (CHAPTERS)
-- ============================================================================

CREATE TABLE chapters (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id            UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    volume_id           UUID REFERENCES volumes(id) ON DELETE SET NULL,
    title               VARCHAR(500) NOT NULL,
    chapter_number      DECIMAL(10,2) NOT NULL,
    slug                VARCHAR(500) NOT NULL,
    content             TEXT,
    content_blocks      JSONB,
    word_count          INTEGER DEFAULT 0,
    is_published        BOOLEAN DEFAULT TRUE,
    approval_status     approval_status DEFAULT 'pending',
    uploader_id         UUID NOT NULL REFERENCES users(id),
    group_id            UUID REFERENCES translation_groups(id) ON DELETE SET NULL,
    translator_notes    JSONB,
    intro_note          TEXT,           -- translator message before the chapter (sanitized rich text)
    outro_note          TEXT,           -- ...and after it
    source_group        VARCHAR(200),   -- scanlation group credited on an imported chapter
    total_views         BIGINT DEFAULT 0,
    total_comments      BIGINT DEFAULT 0,
    published_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(story_id, chapter_number)
);

CREATE INDEX idx_chapters_story ON chapters(story_id);
CREATE INDEX idx_chapters_volume ON chapters(volume_id);
CREATE INDEX idx_chapters_story_number ON chapters(story_id, chapter_number);
CREATE INDEX idx_chapters_published ON chapters(published_at DESC);
CREATE INDEX idx_chapters_slug ON chapters(slug);

-- ============================================================================
-- 9. TRANG TRUYỆN TRANH (MANGA PAGES)
-- ============================================================================

CREATE TABLE chapter_pages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chapter_id      UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    page_number     INTEGER NOT NULL,
    image_url       TEXT NOT NULL,
    width           INTEGER,
    height          INTEGER,
    file_size       BIGINT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(chapter_id, page_number)
);

CREATE INDEX idx_chapter_pages_chapter ON chapter_pages(chapter_id);

-- Hàng đợi nộp bản dịch chương (trước khi được duyệt & đồng bộ vào bảng chapters)
CREATE TABLE chapter_submissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    volume_id       UUID REFERENCES volumes(id) ON DELETE SET NULL,
    chapter_number  DECIMAL(10,2) NOT NULL,
    title           VARCHAR(500) NOT NULL,
    slug            VARCHAR(500) NOT NULL,
    content_blocks  JSONB,
    raw_content     TEXT,
    intro_note      TEXT,
    outro_note      TEXT,
    word_count      INTEGER DEFAULT 0,
    uploader_id     UUID NOT NULL REFERENCES users(id),
    group_id        UUID REFERENCES translation_groups(id) ON DELETE SET NULL,
    approval_status VARCHAR(20) DEFAULT 'pending',
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    rejection_reason TEXT,
    is_active       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chapter_submissions_story ON chapter_submissions(story_id);
CREATE INDEX idx_chapter_submissions_status ON chapter_submissions(approval_status);

-- ============================================================================
-- 10. LƯỢT XEM (VIEW TRACKING)
-- ============================================================================

CREATE TABLE story_views (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id  UUID REFERENCES chapters(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_address  INET,
    user_agent  TEXT,
    viewed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_story_views_story ON story_views(story_id);
CREATE INDEX idx_story_views_chapter ON story_views(chapter_id);
CREATE INDEX idx_story_views_user ON story_views(user_id);
CREATE INDEX idx_story_views_time ON story_views(viewed_at DESC);

CREATE TABLE story_views_daily (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    view_date   DATE NOT NULL,
    view_count  BIGINT DEFAULT 0,
    unique_viewers BIGINT DEFAULT 0,
    UNIQUE(story_id, view_date)
);

CREATE INDEX idx_views_daily_story_date ON story_views_daily(story_id, view_date DESC);

-- ============================================================================
-- 12. YÊU THÍCH TRUYỆN (FAVORITES / THƯ VIỆN)
-- ============================================================================

CREATE TABLE user_favorites (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id    UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    category    VARCHAR(50) DEFAULT 'default',
    notify_updates BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, story_id)
);

CREATE INDEX idx_favorites_user ON user_favorites(user_id);
CREATE INDEX idx_favorites_story ON user_favorites(story_id);

-- Albums (sql/migrations/009_story_albums.sql): named story lists, shareable and copyable
CREATE TABLE albums (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         VARCHAR(100) NOT NULL,
    description  VARCHAR(500),
    is_public    BOOLEAN NOT NULL DEFAULT FALSE,
    share_token  VARCHAR(32) NOT NULL UNIQUE DEFAULT replace(uuid_generate_v4()::text, '-', ''),
    copied_from  UUID REFERENCES albums(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_albums_user ON albums(user_id, created_at DESC);

CREATE TABLE album_stories (
    album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    story_id   UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (album_id, story_id)
);
CREATE INDEX idx_album_stories_story ON album_stories(story_id);

CREATE TABLE album_saves (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    album_id   UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    share_token VARCHAR(32), -- link key used to save a private album; a reset link revokes the save
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, album_id)
);
CREATE INDEX idx_album_saves_album ON album_saves(album_id);

-- ============================================================================
-- 13. LỊCH SỬ ĐỌC (READING HISTORY)
-- ============================================================================

CREATE TABLE reading_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id      UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    scroll_position DECIMAL(5,2) DEFAULT 0,
    page_number     INTEGER,
    read_at         TIMESTAMPTZ DEFAULT NOW(),
    time_spent_seconds INTEGER DEFAULT 0,
    CONSTRAINT reading_history_user_chapter_key UNIQUE (user_id, chapter_id)
);
CREATE INDEX idx_reading_history_user ON reading_history(user_id, read_at DESC);
CREATE INDEX idx_reading_history_story ON reading_history(story_id);

-- ============================================================================
-- 14. BOOKMARK (Đánh dấu chương + dòng)
-- ============================================================================

CREATE TABLE bookmarks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    chapter_id      UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    line_text       TEXT,
    line_index      INTEGER,
    scroll_position DECIMAL(5,2),
    page_number     INTEGER,
    note            TEXT,
    color           VARCHAR(7) DEFAULT '#FFD700',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_story ON bookmarks(user_id, story_id);
CREATE INDEX idx_bookmarks_chapter ON bookmarks(chapter_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_lookup ON bookmarks(user_id, chapter_id, line_index);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created ON bookmarks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_created ON user_favorites(created_at DESC);

-- ============================================================================
-- 15. THEO DÕI DỊCH GIẢ
-- ============================================================================

CREATE TABLE user_follows (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(follower_id, following_id),
    CHECK(follower_id != following_id)
);

CREATE INDEX idx_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_follows_following ON user_follows(following_id);

-- ============================================================================
-- 16. HỆ THỐNG COMMENT
-- ============================================================================

CREATE TABLE comments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type     comment_target_type NOT NULL,
    target_id       UUID NOT NULL,
    parent_id       UUID REFERENCES comments(id) ON DELETE CASCADE,
    root_id         UUID REFERENCES comments(id) ON DELETE CASCADE,
    depth           INTEGER DEFAULT 0,
    content         TEXT NOT NULL,
    is_edited       BOOLEAN DEFAULT FALSE,
    is_deleted       BOOLEAN DEFAULT FALSE,
    quoted_text     TEXT,
    like_count      INTEGER DEFAULT 0,
    reply_count     INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comments_target ON comments(target_type, target_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);
CREATE INDEX idx_comments_root ON comments(root_id);
CREATE INDEX idx_comments_created ON comments(created_at DESC);

CREATE TABLE comment_likes (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id  UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, comment_id)
);

-- ============================================================================
-- 17. HỆ THỐNG THÔNG BÁO (NOTIFICATIONS)
-- ============================================================================

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            notification_type NOT NULL,
    title           VARCHAR(300) NOT NULL,
    message         TEXT,
    reference_type  VARCHAR(50),
    reference_id    UUID,
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    is_read         BOOLEAN DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    dedupe_key      VARCHAR(160)   -- makes queue re-deliveries idempotent
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notifications_sender ON notifications(sender_id) WHERE sender_id IS NOT NULL;  -- fast user deletion (FK SET NULL)

CREATE TABLE broadcast_notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id   UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(300) NOT NULL,
    message     TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 18. FANDOM / BLOG POSTS
-- ============================================================================

CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    slug            VARCHAR(500) NOT NULL UNIQUE,
    content         TEXT NOT NULL,
    cover_image_url TEXT,
    images          JSONB DEFAULT '[]'::jsonb,
    story_id        UUID REFERENCES stories(id) ON DELETE SET NULL,
    is_published    BOOLEAN DEFAULT TRUE,
    is_draft        BOOLEAN DEFAULT FALSE,
    is_deleted      BOOLEAN DEFAULT FALSE,
    approval_status VARCHAR(20) DEFAULT 'approved',
    category        VARCHAR(20) NOT NULL DEFAULT 'discussion', -- discussion | review | fanart | theory | news | question
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    rejection_reason TEXT,
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    view_count      BIGINT DEFAULT 0,
    comment_count   INTEGER DEFAULT 0,
    reaction_count  INTEGER DEFAULT 0,
    published_at    TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_posts_story ON posts(story_id);
CREATE INDEX idx_posts_slug ON posts(slug);
CREATE INDEX idx_posts_published ON posts(published_at DESC);
CREATE INDEX idx_posts_title_trgm ON posts USING gin(title gin_trgm_ops);

CREATE TABLE post_tags (
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE post_reactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction    reaction_type NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX idx_post_reactions_post ON post_reactions(post_id);

-- ============================================================================
-- 19. BÁO CÁO (REPORTS)
-- ============================================================================

CREATE TABLE reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type     VARCHAR(50) NOT NULL,
    target_id       UUID NOT NULL,
    reason          VARCHAR(100) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'pending',
    resolved_by     UUID REFERENCES users(id),
    resolved_at     TIMESTAMPTZ,
    resolution_note TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_status ON reports(status);

-- ============================================================================
-- 20. FUNCTIONS & TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stories_updated_at
    BEFORE UPDATE ON stories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_chapters_updated_at
    BEFORE UPDATE ON chapters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_volumes_updated_at
    BEFORE UPDATE ON volumes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_translation_groups_updated_at
    BEFORE UPDATE ON translation_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION update_story_chapter_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE stories SET
            total_chapters = (SELECT COUNT(*) FROM chapters WHERE story_id = NEW.story_id AND is_published = TRUE),
            last_chapter_at = NEW.published_at
        WHERE id = NEW.story_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE stories SET
            total_chapters = (SELECT COUNT(*) FROM chapters WHERE story_id = OLD.story_id AND is_published = TRUE),
            last_chapter_at = (SELECT MAX(published_at) FROM chapters WHERE story_id = OLD.story_id AND is_published = TRUE)
        WHERE id = OLD.story_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chapter_stats
    AFTER INSERT OR DELETE ON chapters
    FOR EACH ROW EXECUTE FUNCTION update_story_chapter_stats();

CREATE OR REPLACE FUNCTION update_story_favorites_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE stories SET total_favorites = total_favorites + 1 WHERE id = NEW.story_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE stories SET total_favorites = total_favorites - 1 WHERE id = OLD.story_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_favorites_count
    AFTER INSERT OR DELETE ON user_favorites
    FOR EACH ROW EXECUTE FUNCTION update_story_favorites_count();

CREATE OR REPLACE FUNCTION update_comment_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.parent_id IS NOT NULL THEN
            UPDATE comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
        END IF;
        IF NEW.target_type = 'chapter' THEN
            UPDATE chapters SET total_comments = total_comments + 1 WHERE id = NEW.target_id;
            UPDATE stories SET total_comments = total_comments + 1
            WHERE id = (SELECT story_id FROM chapters WHERE id = NEW.target_id);
        ELSIF NEW.target_type = 'story' THEN
            UPDATE stories SET total_comments = total_comments + 1 WHERE id = NEW.target_id;
        ELSIF NEW.target_type = 'post' THEN
            UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.target_id;
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_comment_counts
    AFTER INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION update_comment_counts();

CREATE OR REPLACE FUNCTION auto_grant_author_role()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.approval_status = 'approved' THEN
        INSERT INTO user_roles (user_id, role)
        VALUES (NEW.uploader_id, CASE
            WHEN NEW.group_id IS NOT NULL THEN 'translator'::user_role
            ELSE 'author'::user_role
        END)
        ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_grant_role
    AFTER UPDATE OF approval_status ON stories
    FOR EACH ROW
    WHEN (NEW.approval_status = 'approved' AND OLD.approval_status != 'approved')
    EXECUTE FUNCTION auto_grant_author_role();

-- ============================================================================
-- 21. VIEWS
-- ============================================================================

CREATE VIEW v_trending_stories AS
SELECT
    s.id,
    s.title,
    s.slug,
    s.cover_image_url,
    s.story_type,
    s.status,
    s.total_views,
    s.total_favorites,
    COALESCE(recent.weekly_views, 0) AS weekly_views,
    s.last_chapter_at
FROM stories s
LEFT JOIN (
    SELECT story_id, COUNT(*) AS weekly_views
    FROM story_views
    WHERE viewed_at >= NOW() - INTERVAL '7 days'
    GROUP BY story_id
) recent ON s.id = recent.story_id
WHERE s.approval_status = 'approved'
ORDER BY weekly_views DESC, s.total_views DESC;

CREATE VIEW v_recently_updated_stories AS
SELECT
    s.id,
    s.title,
    s.slug,
    s.cover_image_url,
    s.story_type,
    s.status,
    s.total_chapters,
    s.last_chapter_at,
    c.title AS latest_chapter_title,
    c.chapter_number AS latest_chapter_number,
    g.name AS group_name
FROM stories s
LEFT JOIN LATERAL (
    SELECT title, chapter_number FROM chapters
    WHERE story_id = s.id AND is_published = TRUE
    ORDER BY chapter_number DESC LIMIT 1
) c ON TRUE
LEFT JOIN translation_groups g ON s.group_id = g.id
WHERE s.approval_status = 'approved'
ORDER BY s.last_chapter_at DESC NULLS LAST;


-- ============================================================================
-- ============================================================================
--                          SEED DATA (Valid Hex UUIDs)
-- ============================================================================
-- ============================================================================

-- Users (12 users)
INSERT INTO users (id, username, email, password_hash, display_name, avatar_url, bio, email_verified) VALUES
('a0000000-0000-0000-0000-000000000001', 'admin', 'admin@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Administrator', '/avatars/admin.png', 'Quản trị viên hệ thống', TRUE),
('a0000000-0000-0000-0000-000000000002', 'mod_sakura', 'sakura@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Sakura ✿', '/avatars/sakura.png', 'Moderator | Yêu light novel', TRUE),
('a0000000-0000-0000-0000-000000000003', 'mod_kaito', 'kaito@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Kaito', '/avatars/kaito.png', 'Moderator | Manga enthusiast', TRUE),
('a0000000-0000-0000-0000-000000000004', 'neko_trans', 'neko@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Neko Translation', '/avatars/neko.png', 'Nhóm dịch Neko 🐱 | Chuyên LN Nhật', TRUE),
('a0000000-0000-0000-0000-000000000005', 'tanuki_san', 'tanuki@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Tanuki-san', '/avatars/tanuki.png', 'Dịch giả tự do | Fantasy & Isekai', TRUE),
('a0000000-0000-0000-0000-000000000006', 'author_minh', 'minh@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Minh Phương', '/avatars/minh.png', 'Tác giả web novel Việt Nam 🇻🇳', TRUE),
('a0000000-0000-0000-0000-000000000007', 'kitsune_group', 'kitsune@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Kitsune Group', '/avatars/kitsune.png', 'Nhóm dịch manga chuyên nghiệp', TRUE),
('a0000000-0000-0000-0000-000000000008', 'usagi_editor', 'usagi@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Usagi Editor', '/avatars/usagi.png', 'Editor nhóm dịch | Chỉnh sửa & Proofread', TRUE),
('a0000000-0000-0000-0000-000000000009', 'reader_hana', 'hana@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Hana 🌸', '/avatars/hana.png', 'Đọc truyện mỗi ngày | Romance addict', TRUE),
('a0000000-0000-0000-0000-000000000010', 'reader_ryu', 'ryu@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Ryū Dragon', '/avatars/ryu.png', 'Action & Adventure lover 🐉', TRUE),
('a0000000-0000-0000-0000-000000000011', 'reader_yuki', 'yuki@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Yuki ❄️', '/avatars/yuki.png', 'Slice of life & Comedy fan', TRUE),
('a0000000-0000-0000-0000-000000000012', 'reader_sora', 'sora@novelhub.vn', '$2b$12$LJ3m4ys3GZvX9ETJNGrUb.Kkl6VJzN1tXNOzNPPPYH8VZF5Kq7pCq', 'Sora ☁️', '/avatars/sora.png', 'Isekai specialist', TRUE);

-- User Roles
INSERT INTO user_roles (user_id, role, is_visible, granted_by) VALUES
('a0000000-0000-0000-0000-000000000001', 'admin', TRUE, NULL),
('a0000000-0000-0000-0000-000000000001', 'reader', FALSE, NULL),
('a0000000-0000-0000-0000-000000000002', 'mod', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000002', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000003', 'mod', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000003', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000004', 'translator', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000004', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000005', 'translator', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000005', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000006', 'author', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000006', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000007', 'translator', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000007', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000008', 'translator', TRUE, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000008', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000009', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000010', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000011', 'reader', TRUE, NULL),
('a0000000-0000-0000-0000-000000000012', 'reader', TRUE, NULL);

-- User Settings
INSERT INTO user_settings (user_id, theme, font_family, font_size, line_height, reading_mode, text_color, background_color) VALUES
('a0000000-0000-0000-0000-000000000001', 'dark', 'Inter', 16, 1.8, 'scroll', '#E0E0E0', '#1A1A2E'),
('a0000000-0000-0000-0000-000000000009', 'dark', 'Noto Serif', 18, 2.0, 'scroll', '#D4D4D4', '#0F0F23'),
('a0000000-0000-0000-0000-000000000010', 'light', 'Roboto', 15, 1.6, 'paginated', '#333333', '#FFFFFF'),
('a0000000-0000-0000-0000-000000000011', 'sepia', 'Georgia', 17, 1.9, 'scroll', '#5B4636', '#F4ECD8'),
('a0000000-0000-0000-0000-000000000012', 'amoled', 'Inter', 16, 1.8, 'webtoon', '#CCCCCC', '#000000');

-- Tag Categories
INSERT INTO tag_categories (id, name, label, sort_order) VALUES
('c0000000-0000-0000-0000-000000000001', 'genre', 'Thể loại', 1),
('c0000000-0000-0000-0000-000000000002', 'theme', 'Chủ đề', 2),
('c0000000-0000-0000-0000-000000000003', 'demographic', 'Đối tượng', 3),
('c0000000-0000-0000-0000-000000000004', 'format', 'Định dạng', 4),
('c0000000-0000-0000-0000-000000000005', 'content_warning', 'Cảnh báo nội dung', 5);

-- Thể loại (Genre)
INSERT INTO tags (id, category_id, name, slug, description) VALUES
('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Action', 'action', 'Hành động, chiến đấu'),
('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Adventure', 'adventure', 'Phiêu lưu, mạo hiểm'),
('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'Comedy', 'comedy', 'Hài hước'),
('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', 'Drama', 'drama', 'Kịch tính, cảm xúc'),
('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'Fantasy', 'fantasy', 'Giả tưởng, phép thuật'),
('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001', 'Horror', 'horror', 'Kinh dị'),
('d0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000001', 'Mystery', 'mystery', 'Bí ẩn, trinh thám'),
('d0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000001', 'Romance', 'romance', 'Lãng mạn, tình cảm'),
('d0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000001', 'Sci-Fi', 'sci-fi', 'Khoa học viễn tưởng'),
('d0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'Slice of Life', 'slice-of-life', 'Đời thường'),
('d0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000001', 'Sports', 'sports', 'Thể thao'),
('d0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001', 'Thriller', 'thriller', 'Ly kỳ, hồi hộp'),
('d0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000001', 'Supernatural', 'supernatural', 'Siêu nhiên'),
('d0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000001', 'Psychological', 'psychological', 'Tâm lý'),
('d0000000-0000-0000-0000-000000000015', 'c0000000-0000-0000-0000-000000000001', 'Historical', 'historical', 'Lịch sử'),
('d0000000-0000-0000-0000-000000000016', 'c0000000-0000-0000-0000-000000000001', 'Mecha', 'mecha', 'Robot, cơ giới'),
('d0000000-0000-0000-0000-000000000017', 'c0000000-0000-0000-0000-000000000001', 'Music', 'music', 'Âm nhạc'),
('d0000000-0000-0000-0000-000000000018', 'c0000000-0000-0000-0000-000000000001', 'Ecchi', 'ecchi', 'Ecchi');

-- Chủ đề (Theme)
INSERT INTO tags (id, category_id, name, slug, description) VALUES
('d0000000-0000-0000-0000-000000000101', 'c0000000-0000-0000-0000-000000000002', 'Isekai', 'isekai', 'Chuyển sinh sang thế giới khác'),
('d0000000-0000-0000-0000-000000000102', 'c0000000-0000-0000-0000-000000000002', 'Harem', 'harem', 'Nhiều nhân vật nữ yêu nhân vật nam chính'),
('d0000000-0000-0000-0000-000000000103', 'c0000000-0000-0000-0000-000000000002', 'Reverse Harem', 'reverse-harem', 'Nhiều nhân vật nam yêu nhân vật nữ chính'),
('d0000000-0000-0000-0000-000000000104', 'c0000000-0000-0000-0000-000000000002', 'School Life', 'school-life', 'Đời sống học đường'),
('d0000000-0000-0000-0000-000000000105', 'c0000000-0000-0000-0000-000000000002', 'Magic', 'magic', 'Phép thuật'),
('d0000000-0000-0000-0000-000000000106', 'c0000000-0000-0000-0000-000000000002', 'Military', 'military', 'Quân sự'),
('d0000000-0000-0000-0000-000000000107', 'c0000000-0000-0000-0000-000000000002', 'Reincarnation', 'reincarnation', 'Tái sinh, đầu thai'),
('d0000000-0000-0000-0000-000000000108', 'c0000000-0000-0000-0000-000000000002', 'Game', 'game', 'Game, thế giới game'),
('d0000000-0000-0000-0000-000000000109', 'c0000000-0000-0000-0000-000000000002', 'Cultivation', 'cultivation', 'Tu tiên, luyện đạo'),
('d0000000-0000-0000-0000-000000000110', 'c0000000-0000-0000-0000-000000000002', 'Martial Arts', 'martial-arts', 'Võ thuật'),
('d0000000-0000-0000-0000-000000000111', 'c0000000-0000-0000-0000-000000000002', 'Survival', 'survival', 'Sinh tồn'),
('d0000000-0000-0000-0000-000000000112', 'c0000000-0000-0000-0000-000000000002', 'Overpowered MC', 'op-mc', 'Nhân vật chính mạnh vô đối'),
('d0000000-0000-0000-0000-000000000113', 'c0000000-0000-0000-0000-000000000002', 'Time Travel', 'time-travel', 'Du hành thời gian'),
('d0000000-0000-0000-0000-000000000114', 'c0000000-0000-0000-0000-000000000002', 'Villainess', 'villainess', 'Nữ chính là nhân vật phản diện'),
('d0000000-0000-0000-0000-000000000115', 'c0000000-0000-0000-0000-000000000002', 'System', 'system', 'Hệ thống game/level up'),
('d0000000-0000-0000-0000-000000000116', 'c0000000-0000-0000-0000-000000000002', 'Monsters', 'monsters', 'Quái vật'),
('d0000000-0000-0000-0000-000000000117', 'c0000000-0000-0000-0000-000000000002', 'Demons', 'demons', 'Ma quỷ, ác quỷ'),
('d0000000-0000-0000-0000-000000000118', 'c0000000-0000-0000-0000-000000000002', 'Virtual Reality', 'virtual-reality', 'Thực tế ảo');

-- Đối tượng (Demographic)
INSERT INTO tags (id, category_id, name, slug, description) VALUES
('d0000000-0000-0000-0000-000000000201', 'c0000000-0000-0000-0000-000000000003', 'Shounen', 'shounen', 'Dành cho nam thiếu niên'),
('d0000000-0000-0000-0000-000000000202', 'c0000000-0000-0000-0000-000000000003', 'Shoujo', 'shoujo', 'Dành cho nữ thiếu niên'),
('d0000000-0000-0000-0000-000000000203', 'c0000000-0000-0000-0000-000000000003', 'Seinen', 'seinen', 'Dành cho nam trưởng thành'),
('d0000000-0000-0000-0000-000000000204', 'c0000000-0000-0000-0000-000000000003', 'Josei', 'josei', 'Dành cho nữ trưởng thành'),
('d0000000-0000-0000-0000-000000000205', 'c0000000-0000-0000-0000-000000000003', 'Kodomomuke', 'kodomomuke', 'Dành cho trẻ em');

-- Định dạng (Format)
INSERT INTO tags (id, category_id, name, slug, description) VALUES
('d0000000-0000-0000-0000-000000000301', 'c0000000-0000-0000-0000-000000000004', 'Light Novel', 'light-novel', 'Tiểu thuyết nhẹ Nhật Bản'),
('d0000000-0000-0000-0000-000000000302', 'c0000000-0000-0000-0000-000000000004', 'Web Novel', 'web-novel', 'Tiểu thuyết đăng tải trực tuyến'),
('d0000000-0000-0000-0000-000000000303', 'c0000000-0000-0000-0000-000000000004', 'Manga', 'manga-format', 'Truyện tranh Nhật Bản'),
('d0000000-0000-0000-0000-000000000304', 'c0000000-0000-0000-0000-000000000004', 'Manhwa', 'manhwa', 'Truyện tranh Hàn Quốc'),
('d0000000-0000-0000-0000-000000000305', 'c0000000-0000-0000-0000-000000000004', 'Manhua', 'manhua', 'Truyện tranh Trung Quốc'),
('d0000000-0000-0000-0000-000000000306', 'c0000000-0000-0000-0000-000000000004', 'Oneshot', 'oneshot', 'Truyện một chương');

-- Cảnh báo nội dung
INSERT INTO tags (id, category_id, name, slug, description) VALUES
('d0000000-0000-0000-0000-000000000401', 'c0000000-0000-0000-0000-000000000005', 'Gore', 'gore', 'Bạo lực, máu me'),
('d0000000-0000-0000-0000-000000000402', 'c0000000-0000-0000-0000-000000000005', 'Sexual Violence', 'sexual-violence', 'Bạo lực tình dục'),
('d0000000-0000-0000-0000-000000000403', 'c0000000-0000-0000-0000-000000000005', 'Strong Language', 'strong-language', 'Ngôn ngữ mạnh');

-- Nhóm dịch (Translation Groups)
INSERT INTO translation_groups (id, name, slug, description, website_url, discord_url, created_by) VALUES
('e0000000-0000-0000-0000-000000000001', 'Neko Translation', 'neko-translation', 'Nhóm dịch chuyên Light Novel Nhật Bản. Chất lượng là trên hết! 🐱', 'https://nekotrans.vn', 'https://discord.gg/nekotrans', 'a0000000-0000-0000-0000-000000000004'),
('e0000000-0000-0000-0000-000000000002', 'Kitsune Scanlation', 'kitsune-scanlation', 'Nhóm scan manga chuyên nghiệp. Chuyên các bộ Shounen & Seinen 🦊', 'https://kitsune-scan.com', 'https://discord.gg/kitsune', 'a0000000-0000-0000-0000-000000000007'),
('e0000000-0000-0000-0000-000000000003', 'Moonlit Translations', 'moonlit-translations', 'Dịch những câu chuyện dưới ánh trăng 🌙 | Romance & Drama', NULL, 'https://discord.gg/moonlit', 'a0000000-0000-0000-0000-000000000005');

-- Thành viên nhóm dịch
INSERT INTO group_members (group_id, user_id, role) VALUES
('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'leader'),
('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 'member'),
('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'member'),
('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'leader'),
('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000008', 'member'),
('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005', 'leader');

-- Theo dõi dịch giả
INSERT INTO user_follows (follower_id, following_id) VALUES
('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000004'),
('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000005'),
('a0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000006'),
('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000007'),
('a0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000004'),
('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000005'),
('a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000006'),
('a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000004');

-- Thông báo (Notifications)
INSERT INTO notifications (user_id, type, title, message, reference_type, sender_id) VALUES
('a0000000-0000-0000-0000-000000000009', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000010', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000011', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000012', 'system', '🎉 Chào mừng đến NovelHub!', 'Cảm ơn bạn đã đăng ký tài khoản. Hãy khám phá kho truyện đồ sộ của chúng tôi!', NULL, 'a0000000-0000-0000-0000-000000000001'),
('a0000000-0000-0000-0000-000000000008', 'group_invite', 'Lời mời tham gia nhóm dịch', 'Bạn đã được mời tham gia nhóm dịch "Neko Translation"', 'group', 'a0000000-0000-0000-0000-000000000004'),
('a0000000-0000-0000-0000-000000000005', 'group_member_add', 'Thành viên mới trong nhóm', 'Usagi Editor đã tham gia nhóm "Neko Translation"', 'group', NULL);

-- Broadcast Notifications
INSERT INTO broadcast_notifications (sender_id, title, message) VALUES
('a0000000-0000-0000-0000-000000000001', '📢 Cập nhật hệ thống v2.0', 'Chúng tôi vừa cập nhật giao diện mới với nhiều tính năng hấp dẫn. Hãy trải nghiệm ngay!'),
('a0000000-0000-0000-0000-000000000001', '🎊 Sự kiện đọc truyện mùa hè', 'Tham gia sự kiện đọc truyện mùa hè để nhận badge đặc biệt! Chi tiết tại trang sự kiện.');

-- Posts (Fandom/Blog)
INSERT INTO posts (id, user_id, title, slug, content, story_id, is_published) VALUES
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000009',
    'Top 10 Light Novel Isekai hay nhất 2026 - Không thể bỏ lỡ!',
    'top-10-light-novel-isekai-2026',
    E'## Danh sách Top 10 Isekai LN hay nhất năm nay\n\nXin chào mọi người! Mình là Hana, hôm nay mình muốn chia sẻ danh sách top 10 Light Novel Isekai mà mình đã đọc trong năm 2026.\n\n### 1. Mushoku Tensei\nKinh điển không cần bàn cãi...\n\n### 2. Re:Zero\nChuyển sinh vào thế giới khác với khả năng quay về sau khi chết...\n\n### 3. Overlord\nBị kẹt trong game MMORPG với sức mạnh tối thượng...\n\nCác bạn có bộ nào muốn thêm vào danh sách không? Comment bên dưới nhé! 👇',
    NULL, TRUE),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000010',
    'Review: Solo Leveling - Từ E-rank lên Shadow Monarch',
    'review-solo-leveling',
    E'## Solo Leveling - Review chi tiết\n\n**Rating: 9/10** ⭐\n\nSolo Leveling là một trong những manhwa hay nhất mình từng đọc. Câu chuyện về Sung Jin-Woo từ một hunter E-rank yếu nhất trở thành Shadow Monarch mạnh nhất thế giới.\n\n### Điểm mạnh:\n- Artwork tuyệt đẹp\n- Power progression hợp lý\n- Action scenes đỉnh cao\n\n### Điểm yếu:\n- Side characters thiếu chiều sâu\n- Ending hơi rushed\n\nTổng kết: MUST READ! 🔥',
    NULL, TRUE),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000011',
    'Chia sẻ: Tại sao Slice of Life là thể loại tuyệt vời nhất?',
    'tai-sao-slice-of-life-tuyet-voi',
    E'## Slice of Life - Thể loại bị đánh giá thấp\n\nMọi người thường bỏ qua Slice of Life vì nghĩ nó "chán", nhưng thực tế đây là thể loại mang lại cảm giác thư giãn và healing nhất.\n\n### Vì sao mình yêu SoL:\n1. **Healing**: Sau một ngày mệt mỏi, SoL giúp mình thư giãn\n2. **Nhân vật chân thực**: Không cần super power, chỉ cần cuộc sống bình thường\n3. **Cảm xúc sâu sắc**: Những khoảnh khắc nhỏ nhưng đầy ý nghĩa\n\nCác bạn có thích SoL không? Bộ SoL yêu thích của bạn là gì? 🌸',
    NULL, TRUE);

-- Post Reactions
INSERT INTO post_reactions (post_id, user_id, reaction) VALUES
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'like'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000011', 'love'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000012', 'like'),
('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'love'),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'wow'),
('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000012', 'like'),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009', 'love'),
('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010', 'like');

-- Comments
INSERT INTO comments (id, user_id, target_type, target_id, parent_id, root_id, depth, content) VALUES
('11000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'post', 'f0000000-0000-0000-0000-000000000001', NULL, NULL, 0, 'Danh sách hay quá! Mình cũng đang đọc Mushoku Tensei, đỉnh thật 🔥'),
('11000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000012', 'post', 'f0000000-0000-0000-0000-000000000001', NULL, NULL, 0, 'Thiếu Konosuba rồi bạn ơi! Bộ đó hài vãi 😂'),
('11000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000009', 'post', 'f0000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 1, 'Ôi đúng rồi! Mình quên mất Konosuba! Sẽ update thêm 😅'),
('11000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000009', 'post', 'f0000000-0000-0000-0000-000000000002', NULL, NULL, 0, 'Mình cũng cho 9/10. Ending hơi tiếc nhưng overall vẫn là masterpiece!'),
('11000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000011', 'post', 'f0000000-0000-0000-0000-000000000002', NULL, NULL, 0, 'Artwork cũng là điểm mạnh lớn nhất. Mỗi panel đều như wallpaper 🖼️');

-- Update stats on posts
UPDATE posts SET
    reaction_count = (SELECT COUNT(*) FROM post_reactions WHERE post_id = posts.id),
    comment_count = (SELECT COUNT(*) FROM comments WHERE target_type = 'post' AND target_id = posts.id);

-- Reports
INSERT INTO reports (reporter_id, target_type, target_id, reason, description, status) VALUES
('a0000000-0000-0000-0000-000000000009', 'comment', '11000000-0000-0000-0000-000000000001', 'spam', 'Comment này có vẻ là spam', 'pending');

-- Recommendations (sql/migrations/010_recommendations.sql)
-- Recommendations ("Đề xuất cho bạn" on the home page, "Truyện liên quan" on a story page).
-- rec_events is the raw signal (also for guests, keyed by the anonymous `vid` cookie); the
-- worker trains on it plus reading_history / favorites / albums / bookmarks and writes the
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

-- Muted fandom posts (sql/migrations/013_notification_preferences.sql)
CREATE TABLE post_notification_mutes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

-- Verification block
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'DATABASE IMPORT & SEED THÀNH CÔNG!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Users: %', (SELECT COUNT(*) FROM users);
    RAISE NOTICE 'User Roles: %', (SELECT COUNT(*) FROM user_roles);
    RAISE NOTICE 'User Settings: %', (SELECT COUNT(*) FROM user_settings);
    RAISE NOTICE 'Tag Categories: %', (SELECT COUNT(*) FROM tag_categories);
    RAISE NOTICE 'Tags: %', (SELECT COUNT(*) FROM tags);
    RAISE NOTICE 'Translation Groups: %', (SELECT COUNT(*) FROM translation_groups);
    RAISE NOTICE 'Group Members: %', (SELECT COUNT(*) FROM group_members);
    RAISE NOTICE 'User Follows: %', (SELECT COUNT(*) FROM user_follows);
    RAISE NOTICE 'Notifications: %', (SELECT COUNT(*) FROM notifications);
    RAISE NOTICE 'Broadcast Notifications: %', (SELECT COUNT(*) FROM broadcast_notifications);
    RAISE NOTICE 'Posts: %', (SELECT COUNT(*) FROM posts);
    RAISE NOTICE 'Post Reactions: %', (SELECT COUNT(*) FROM post_reactions);
    RAISE NOTICE 'Comments: %', (SELECT COUNT(*) FROM comments);
    RAISE NOTICE 'Reports: %', (SELECT COUNT(*) FROM reports);
    RAISE NOTICE '========================================';
END $$;

-- ============================================================================
-- MÃ THÔNG MINH (migration 017_smart_codes.sql)
-- ============================================================================
-- Smart codes: short readable ids shown to people, next to the UUID primary keys (which stay the real keys).
-- Each code = facts that may change (role, group, category...) + a fixed number `code_no`.
-- Lookups (GET /codes/:code) use only the number, so a code printed before a change still resolves.
--   users     U-AD-26-0007        top role · year joined · number
--   groups    G03                 number (never changes)
--   stories   LN-JA-G03-0042      type · original language · group (G00 = none) · number
--   chapters  LN-JA-G03-0042-C12  story code · chapter number (built in queries, not stored)
--   posts     P-RV-26-0015        category · year · number
--   albums    AL-0007-26-0184     owner number · year · number
--   reports   RP-CM-26-0001       target type · year · number

-- At least 4 digits, longer when needed (lpad alone would cut 12345 to 1234)
CREATE OR REPLACE FUNCTION code_num(n BIGINT, width INT DEFAULT 4) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(n::text, GREATEST(width, length(n::text)), '0') $$;

CREATE OR REPLACE FUNCTION code_year(t TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql STABLE AS $$ SELECT to_char(COALESCE(t, NOW()), 'YY') $$;

CREATE SEQUENCE IF NOT EXISTS users_code_seq;
CREATE SEQUENCE IF NOT EXISTS translation_groups_code_seq;
CREATE SEQUENCE IF NOT EXISTS stories_code_seq;
CREATE SEQUENCE IF NOT EXISTS posts_code_seq;
CREATE SEQUENCE IF NOT EXISTS albums_code_seq;
CREATE SEQUENCE IF NOT EXISTS reports_code_seq;

ALTER TABLE users              ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE stories            ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE posts              ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE albums             ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);
ALTER TABLE reports            ADD COLUMN IF NOT EXISTS code_no BIGINT, ADD COLUMN IF NOT EXISTS code VARCHAR(40);

-- ---- users: role part follows user_roles (user_role enum order is admin < mod < translator < author < reader)
CREATE OR REPLACE FUNCTION user_code(no BIGINT, created TIMESTAMPTZ, top_role user_role) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT 'U-' || CASE top_role WHEN 'admin' THEN 'AD' WHEN 'mod' THEN 'MO' WHEN 'translator' THEN 'TR'
                               WHEN 'author' THEN 'AU' ELSE 'RD' END
         || '-' || code_year(created) || '-' || code_num(no)
$$;

CREATE OR REPLACE FUNCTION users_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('users_code_seq'));
  NEW.code := user_code(NEW.code_no, NEW.created_at, (SELECT min(role) FROM user_roles WHERE user_id = NEW.id));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION user_roles_refresh_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET code = user_code(code_no, created_at, (SELECT min(role) FROM user_roles WHERE user_id = users.id))
  WHERE id = COALESCE(NEW.user_id, OLD.user_id) AND code_no IS NOT NULL;
  RETURN NULL;
END $$;

-- ---- groups
CREATE OR REPLACE FUNCTION groups_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('translation_groups_code_seq'));
  NEW.code := 'G' || code_num(NEW.code_no, 2);
  RETURN NEW;
END $$;

-- ---- stories: also re-runs when the group is removed (FK ON DELETE SET NULL fires update triggers)
CREATE OR REPLACE FUNCTION stories_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('stories_code_seq'));
  NEW.code := CASE NEW.story_type WHEN 'manga' THEN 'MG' ELSE 'LN' END
    || '-' || upper(left(COALESCE(NULLIF(NEW.original_language, ''), 'xx'), 2))
    || '-' || COALESCE((SELECT code FROM translation_groups WHERE id = NEW.group_id), 'G00')
    || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- posts
CREATE OR REPLACE FUNCTION posts_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('posts_code_seq'));
  NEW.code := 'P-' || CASE NEW.category WHEN 'review' THEN 'RV' WHEN 'fanart' THEN 'FA' WHEN 'theory' THEN 'TH'
                                        WHEN 'news' THEN 'NW' WHEN 'question' THEN 'QA' ELSE 'DS' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- albums (the owner never changes: copying makes a new album)
CREATE OR REPLACE FUNCTION albums_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('albums_code_seq'));
  NEW.code := 'AL-' || COALESCE(code_num((SELECT code_no FROM users WHERE id = NEW.user_id)), '0000')
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- ---- reports
CREATE OR REPLACE FUNCTION reports_set_code() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.code_no := COALESCE(NEW.code_no, nextval('reports_code_seq'));
  NEW.code := 'RP-' || CASE NEW.target_type WHEN 'story' THEN 'ST' WHEN 'chapter' THEN 'CH'
                                            WHEN 'comment' THEN 'CM' WHEN 'post' THEN 'PO' ELSE 'XX' END
    || '-' || code_year(NEW.created_at) || '-' || code_num(NEW.code_no);
  RETURN NEW;
END $$;

-- Triggers also run on UPDATE OF code_no so the backfill below fills `code` with the same expressions
DROP TRIGGER IF EXISTS trg_users_code ON users;
CREATE TRIGGER trg_users_code BEFORE INSERT OR UPDATE OF code_no ON users FOR EACH ROW EXECUTE FUNCTION users_set_code();
DROP TRIGGER IF EXISTS trg_user_roles_code ON user_roles;
CREATE TRIGGER trg_user_roles_code AFTER INSERT OR UPDATE OF role OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION user_roles_refresh_code();
DROP TRIGGER IF EXISTS trg_groups_code ON translation_groups;
CREATE TRIGGER trg_groups_code BEFORE INSERT OR UPDATE OF code_no ON translation_groups FOR EACH ROW EXECUTE FUNCTION groups_set_code();
DROP TRIGGER IF EXISTS trg_stories_code ON stories;
CREATE TRIGGER trg_stories_code BEFORE INSERT OR UPDATE OF code_no, story_type, original_language, group_id ON stories
  FOR EACH ROW EXECUTE FUNCTION stories_set_code();
DROP TRIGGER IF EXISTS trg_posts_code ON posts;
CREATE TRIGGER trg_posts_code BEFORE INSERT OR UPDATE OF code_no, category ON posts FOR EACH ROW EXECUTE FUNCTION posts_set_code();
DROP TRIGGER IF EXISTS trg_albums_code ON albums;
CREATE TRIGGER trg_albums_code BEFORE INSERT OR UPDATE OF code_no ON albums FOR EACH ROW EXECUTE FUNCTION albums_set_code();
DROP TRIGGER IF EXISTS trg_reports_code ON reports;
CREATE TRIGGER trg_reports_code BEFORE INSERT OR UPDATE OF code_no ON reports FOR EACH ROW EXECUTE FUNCTION reports_set_code();


-- Backfill existing rows: numbers in creation order; setting code_no fires the triggers above, which fill `code`.
-- Groups and users go first: story and album codes read them.
-- The updated_at triggers are paused meanwhile: "recently updated" lists sort by that column.
DO $$
DECLARE t TEXT; tg TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['translation_groups', 'users', 'stories', 'posts', 'albums', 'reports'] LOOP
    FOR tg IN SELECT tgname FROM pg_trigger WHERE tgrelid = t::regclass AND tgfoid = 'update_updated_at_column'::regproc LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', t, tg);
    END LOOP;
    EXECUTE format(
      'UPDATE %1$I x SET code_no = n.base + n.rn
         FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn,
                      (SELECT COALESCE(max(code_no), 0) FROM %1$I) AS base
                 FROM %1$I WHERE code_no IS NULL) n
        WHERE x.id = n.id', t);
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(max(code_no), 0) FROM %I), 1), (SELECT count(*) > 0 FROM %I))',
                   t || '_code_seq', t, t);
    FOR tg IN SELECT tgname FROM pg_trigger WHERE tgrelid = t::regclass AND tgfoid = 'update_updated_at_column'::regproc LOOP
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', t, tg);
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE users              ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE translation_groups ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE stories            ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE posts              ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE albums             ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;
ALTER TABLE reports            ALTER COLUMN code_no SET NOT NULL, ALTER COLUMN code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_code_no   ON users(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_code_no  ON translation_groups(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_code_no ON stories(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_code_no   ON posts(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_albums_code_no  ON albums(code_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_code_no ON reports(code_no);

-- ============================================================================
-- BỎ KHÂU DUYỆT (migration 019_no_approval.sql)
-- ============================================================================
-- No more review (owner's decision 2026-10-09): stories, chapters, Fandom posts and groups go live at once.
-- Publish what was still waiting. Pending chapter translations become drafts (kept, not published),
-- since publishing them needs the app (pages, counters, notifications).
-- trg_auto_grant_role gives the uploaders their author/translator title.

UPDATE stories SET approval_status = 'approved', approved_at = NOW(), rejection_reason = NULL
WHERE approval_status IN ('pending', 'rejected');

UPDATE translation_groups SET approval_status = 'approved', approved_at = NOW()
WHERE approval_status = 'pending';

UPDATE posts SET approval_status = 'approved', approved_at = NOW(), is_published = true,
                 published_at = COALESCE(published_at, NOW())
WHERE approval_status = 'pending' AND is_deleted = false;

UPDATE chapter_submissions SET approval_status = 'draft'
WHERE approval_status IN ('pending', 'rejected');

-- ============================================================================
-- GỠ NỘI DUNG (migration 020_soft_remove.sql)
-- ============================================================================
-- Admin/Mod only take content down (soft): who and when, for the "Đã gỡ" page (owner's decision 2026-10-09).
-- A removed story has approval_status = 'rejected', a removed post approval_status = 'rejected'; the reason is in rejection_reason.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE posts   ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_stories_removed ON stories(removed_at DESC) WHERE approval_status = 'rejected';
CREATE INDEX IF NOT EXISTS idx_posts_removed   ON posts(removed_at DESC)   WHERE approval_status = 'rejected';

-- ============================================================================
-- CHỐNG SPAM BÁO CÁO (migration 021_report_spam.sql)
-- ============================================================================
-- Report spam guard (2026-10-09): one pending report per person per item, enforced by the database
-- (two quick clicks used to pass the app's check). Older duplicates are closed, not deleted.
UPDATE reports a SET status = 'dismissed', resolved_at = NOW(), resolution_note = 'Báo cáo trùng (tự động đóng)'
FROM reports b
WHERE a.status = 'pending' AND b.status = 'pending' AND a.id <> b.id
  AND a.reporter_id = b.reporter_id AND a.target_type = b.target_type AND a.target_id = b.target_id
  AND (a.created_at, a.id) > (b.created_at, b.id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_pending ON reports(reporter_id, target_type, target_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_time ON reports(reporter_id, created_at DESC);

-- 022: accounts move to the identity service (Plan/identity.md). users / user_roles become a copy kept in step
-- by identity.user.* events. 019-021 are taken by the no-approval branch.
-- The credential columns are NOT dropped yet: nothing reads or writes them any more, and they stay as a way back
-- until the switch is confirmed; a later migration drops email, password_hash, tokens_valid_after, last_login_at
-- and auth_tokens.

-- New accounts arrive from identity without these
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Version of the identity snapshot this row reflects: older or repeated events are ignored
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_version BIGINT NOT NULL DEFAULT 0;

-- Events already applied (consumer side of the outbox pattern): a redelivery is a no-op
CREATE TABLE IF NOT EXISTS processed_events (
    event_id      UUID PRIMARY KEY,
    type          TEXT NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_time ON processed_events(processed_at);

COMMENT ON COLUMN users.email IS 'Deprecated (identity owns it). Not read or written since the identity switch; to be dropped.';
COMMENT ON COLUMN users.password_hash IS 'Deprecated (identity owns it). Not read or written since the identity switch; to be dropped.';

-- 023: chapter content moves to the workspace service (Plan/chapter-workspace.md). chapters is the reading copy,
-- rebuilt from workspace revisions. This remembers the last version applied per chapter, deleted ones included,
-- so a late or repeated workspace.revision.merged event is ignored (no FK: the chapter row may be gone).
CREATE TABLE IF NOT EXISTS ws_chapter_versions (
    chapter_id  UUID PRIMARY KEY,
    version     INT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 025: each translation group picks the steps a chapter goes through before a story keeper merges it
-- (Plan/chapter-workspace.md, stage 4b): raw (raw_provider) -> translate (translator) -> edit (editor) -> proofread (proofreader).
-- Default: translate only (DỊCH -> GỘP). The workspace reads it through /internal/permissions.
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS workflow TEXT[] NOT NULL DEFAULT '{translate}';
DO $$ BEGIN
  ALTER TABLE translation_groups ADD CONSTRAINT translation_groups_workflow_steps
    CHECK (cardinality(workflow) >= 1 AND workflow <@ ARRAY['raw', 'translate', 'edit', 'proofread']);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 026: identity owns credentials since PR #56 (Plan/identity.md). Drop the backend's unused copies so the site
-- database no longer holds password hashes, emails or account tokens.
DROP TABLE IF EXISTS auth_tokens;
DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS tokens_valid_after;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;

-- 027: drop the tables whose data moved to other services (Plan/catalog.md, stage I1): messaging (messages,
-- notifications), community (posts, comments, reports), library (follows, bookmarks, history, albums), recommender
-- (rec_*), media (story_exports). A fresh install therefore has no sample posts, comments or notifications.
DROP TABLE IF EXISTS
  direct_messages, group_messages, user_blocks, dm_label_conversations, dm_labels, notifications, broadcast_notifications,
  post_notification_mutes, post_reactions, post_tags, comment_likes, comments, reports, posts,
  album_saves, album_stories, albums, bookmarks, reading_history, user_favorites, user_follows,
  rec_events, rec_item_factors, rec_item_similar, rec_model_runs, rec_user_factors, rec_user_scores,
  story_exports
  CASCADE;
DROP FUNCTION IF EXISTS update_story_favorites_count(), update_comment_counts(),
  posts_set_code(), albums_set_code(), reports_set_code();
DROP SEQUENCE IF EXISTS posts_code_seq, albums_code_seq, reports_code_seq;
DROP TYPE IF EXISTS notification_type, reaction_type, comment_target_type;

-- 028: who besides the leader merges proposals into a group's stories (Plan/catalog.md, stage I3). The story owner and
-- the group leader always do; the workspace reads it through /internal/permissions (keeper).
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS mergers TEXT[] NOT NULL DEFAULT '{mod}';
DO $$ BEGIN
  ALTER TABLE translation_groups ADD CONSTRAINT translation_groups_mergers_roles
    CHECK (mergers <@ ARRAY['mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member']);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
