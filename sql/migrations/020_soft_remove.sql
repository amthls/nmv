-- Admin/Mod only take content down (soft): who and when, for the "Đã gỡ" page (owner's decision 2026-10-09).
-- A removed story has approval_status = 'rejected', a removed post approval_status = 'rejected'; the reason is in rejection_reason.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_stories_removed ON stories(removed_at DESC) WHERE approval_status = 'rejected';
-- posts moved to the community service (027 drops the table): skipped once it is gone
DO $$
BEGIN
  IF to_regclass('public.posts') IS NOT NULL THEN
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES users(id) ON DELETE SET NULL,
                      ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_posts_removed ON posts(removed_at DESC) WHERE approval_status = 'rejected';
  END IF;
END $$;
