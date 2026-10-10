-- ws_db, stage 2: private drafts (Plan/chapter-workspace.md). A draft is an ordered array of block hashes like a
-- revision, so opening one from the official line copies a few bytes. Only its owner reads or writes it.

CREATE TABLE chapter_drafts (
    id                 UUID PRIMARY KEY,
    owner_id           UUID NOT NULL,
    owner_name         TEXT,
    story_id           UUID NOT NULL,
    chapter_id         UUID REFERENCES chapter_heads(chapter_id),   -- NULL: a new chapter
    base_version       INT,                         -- official version it was opened from / last pulled
    meta               JSONB NOT NULL,              -- title, chapter_number, volume_id, intro_note, outro_note
    blocks             TEXT[] NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'published', 'discarded')),
    version            INT NOT NULL DEFAULT 1,      -- bumped on every save: two tabs never overwrite each other
    published_version  INT,                         -- the official version it became
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX chapter_drafts_owner ON chapter_drafts(owner_id, updated_at DESC) WHERE status = 'open';
CREATE INDEX chapter_drafts_story ON chapter_drafts(story_id, status);
-- "Edit" on a chapter reopens the owner's open draft of it instead of making a second one
CREATE UNIQUE INDEX chapter_drafts_one_open ON chapter_drafts(owner_id, chapter_id) WHERE status = 'open' AND chapter_id IS NOT NULL;
