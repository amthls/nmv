-- Finer notification switches, and muting a single post.
--   notify_comments        (existing) : someone replied to my comment
--   notify_post_comments   (new)      : someone commented on my post
--   notify_post_reactions  (new)      : someone reacted to my post
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notify_post_comments BOOLEAN DEFAULT TRUE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notify_post_reactions BOOLEAN DEFAULT TRUE;

-- "Tắt thông báo bài viết này": no comment / reply / reaction notifications about that post
CREATE TABLE IF NOT EXISTS post_notification_mutes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
