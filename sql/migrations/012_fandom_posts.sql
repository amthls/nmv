-- Fandom: post categories, pinned posts and the reason a post was not approved
ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'discussion'; -- discussion | review | fanart | theory | news | question
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(approval_status, is_published, published_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_posts_story ON posts(story_id) WHERE is_deleted = false;
