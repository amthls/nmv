-- ws_db, stage 4a: working on drafts together (Plan/chapter-workspace.md).

-- offered: a helper's copy sent back to the owner of the draft it was copied from; accepted: taken in by that owner
ALTER TABLE chapter_drafts DROP CONSTRAINT chapter_drafts_status_check;
ALTER TABLE chapter_drafts ADD CONSTRAINT chapter_drafts_status_check
    CHECK (status IN ('open', 'submitted', 'offered', 'accepted', 'published', 'discarded'));
ALTER TABLE chapter_drafts ADD COLUMN copied_from UUID REFERENCES chapter_drafts(id);
ALTER TABLE chapter_drafts ADD COLUMN copy_base TEXT[];          -- the original's blocks when copied (diff3 base)
ALTER TABLE chapter_drafts ADD COLUMN copy_base_meta JSONB;
-- one editor at a time: the holder keeps the lock while saving / sending heartbeats; it lapses on its own
ALTER TABLE chapter_drafts ADD COLUMN lock_user UUID;
ALTER TABLE chapter_drafts ADD COLUMN lock_name TEXT;
ALTER TABLE chapter_drafts ADD COLUMN lock_until TIMESTAMPTZ;
CREATE INDEX chapter_drafts_copied_from ON chapter_drafts(copied_from) WHERE copied_from IS NOT NULL;
-- a helper's copy of a chapter draft must not block the helper's own draft of that chapter: copies are exempt
DROP INDEX chapter_drafts_one_open;
CREATE UNIQUE INDEX chapter_drafts_one_open ON chapter_drafts(owner_id, chapter_id)
    WHERE status IN ('open', 'submitted') AND chapter_id IS NOT NULL AND copied_from IS NULL;

-- who the owner shared a draft with (they can view it and make their own copy; can_edit: edit it in turn)
CREATE TABLE draft_shares (
    draft_id    UUID NOT NULL REFERENCES chapter_drafts(id),
    user_id     UUID NOT NULL,
    user_name   TEXT,                       -- shown to the owner (the workspace keeps no user table)
    can_edit    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (draft_id, user_id)
);
CREATE INDEX draft_shares_user ON draft_shares(user_id);

-- who saved each version of a draft
CREATE TABLE draft_edits (
    draft_id    UUID NOT NULL REFERENCES chapter_drafts(id),
    version     INT NOT NULL,
    user_id     UUID NOT NULL,
    user_name   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (draft_id, version)
);
