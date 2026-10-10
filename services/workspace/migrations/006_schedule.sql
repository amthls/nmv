-- ws_db, stage 4c: scheduled publishing (Plan/chapter-workspace.md). A scheduled draft waits locked until publish_at;
-- schedule_prev is the state it goes back to when the schedule is cancelled or cannot be carried out.
ALTER TABLE chapter_drafts DROP CONSTRAINT chapter_drafts_status_check;
ALTER TABLE chapter_drafts ADD CONSTRAINT chapter_drafts_status_check
    CHECK (status IN ('open', 'submitted', 'offered', 'accepted', 'scheduled', 'published', 'discarded'));
ALTER TABLE chapter_drafts ADD COLUMN publish_at TIMESTAMPTZ;
ALTER TABLE chapter_drafts ADD COLUMN scheduled_by UUID;
ALTER TABLE chapter_drafts ADD COLUMN scheduled_name TEXT;
ALTER TABLE chapter_drafts ADD COLUMN schedule_prev TEXT CHECK (schedule_prev IN ('open', 'submitted'));
ALTER TABLE chapter_drafts ADD COLUMN schedule_error TEXT;    -- why the last scheduled publish could not happen
CREATE INDEX chapter_drafts_due ON chapter_drafts(publish_at) WHERE status = 'scheduled';
