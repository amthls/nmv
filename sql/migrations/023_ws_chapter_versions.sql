-- 023: chapter content moves to the workspace service (Plan/chapter-workspace.md). chapters is the reading copy,
-- rebuilt from workspace revisions. This remembers the last version applied per chapter, deleted ones included,
-- so a late or repeated workspace.revision.merged event is ignored (no FK: the chapter row may be gone).
CREATE TABLE IF NOT EXISTS ws_chapter_versions (
    chapter_id  UUID PRIMARY KEY,
    version     INT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
