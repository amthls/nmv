-- Allow comments directly on a story (the story detail page already has a comment box).
-- Idempotent. Apply to an existing database with:
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/001_story_comments.sql
-- ALTER TYPE ... ADD VALUE must not run inside a transaction block, so run this file as-is (no BEGIN/COMMIT).

ALTER TYPE comment_target_type ADD VALUE IF NOT EXISTS 'story';

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
