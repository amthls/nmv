-- No more review (owner's decision 2026-10-09): stories, chapters, Fandom posts and groups go live at once.
-- Publish what was still waiting. Pending chapter translations become drafts (kept, not published),
-- since publishing them needs the app (pages, counters, notifications).
-- trg_auto_grant_role gives the uploaders their author/translator title.

UPDATE stories SET approval_status = 'approved', approved_at = NOW(), rejection_reason = NULL
WHERE approval_status IN ('pending', 'rejected');

UPDATE translation_groups SET approval_status = 'approved', approved_at = NOW()
WHERE approval_status = 'pending';

-- posts moved to the community service (027 drops the table): skipped once it is gone
DO $$
BEGIN
  IF to_regclass('public.posts') IS NOT NULL THEN
    UPDATE posts SET approval_status = 'approved', approved_at = NOW(), is_published = true,
                     published_at = COALESCE(published_at, NOW())
    WHERE approval_status = 'pending' AND is_deleted = false;
  END IF;
END $$;

UPDATE chapter_submissions SET approval_status = 'draft'
WHERE approval_status IN ('pending', 'rejected');
