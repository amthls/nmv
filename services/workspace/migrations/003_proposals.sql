-- ws_db, stage 3: proposals (Plan/chapter-workspace.md). A contributor submits a draft; story keepers merge it or
-- return it with comments. Every submission is a round: a frozen copy (hash array) so "changes since last time"
-- and comments keep pointing at what was actually sent.

ALTER TABLE chapter_drafts DROP CONSTRAINT chapter_drafts_status_check;
ALTER TABLE chapter_drafts ADD CONSTRAINT chapter_drafts_status_check CHECK (status IN ('open', 'submitted', 'published', 'discarded'));
ALTER TABLE chapter_drafts ADD COLUMN last_round INT NOT NULL DEFAULT 0;
DROP INDEX chapter_drafts_owner;
CREATE INDEX chapter_drafts_owner ON chapter_drafts(owner_id, updated_at DESC) WHERE status IN ('open', 'submitted');
DROP INDEX chapter_drafts_one_open;
CREATE UNIQUE INDEX chapter_drafts_one_open ON chapter_drafts(owner_id, chapter_id) WHERE status IN ('open', 'submitted') AND chapter_id IS NOT NULL;

CREATE TABLE draft_rounds (
    draft_id        UUID NOT NULL REFERENCES chapter_drafts(id),
    round           INT NOT NULL,
    base_version    INT,                          -- official version the proposal was made against (NULL: new chapter)
    meta            JSONB NOT NULL,
    blocks          TEXT[] NOT NULL,
    note            TEXT,                         -- the author's message to the reviewers
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decision        TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'returned', 'merged', 'withdrawn')),
    decided_by      UUID,
    decided_name    TEXT,
    decision_note   TEXT,
    decided_at      TIMESTAMPTZ,
    merged_version  INT,
    PRIMARY KEY (draft_id, round)
);

CREATE TABLE draft_comments (
    id           BIGSERIAL PRIMARY KEY,
    draft_id     UUID NOT NULL REFERENCES chapter_drafts(id),
    round        INT NOT NULL,
    block_hash   TEXT,                            -- the paragraph it is about (NULL: the whole proposal)
    body         TEXT NOT NULL,                   -- plain text (shown escaped)
    author_id    UUID NOT NULL,
    author_name  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX draft_comments_draft ON draft_comments(draft_id, id);
