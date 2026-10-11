-- 028: who besides the leader merges proposals into a group's stories (Plan/catalog.md, stage I3). The story owner and
-- the group leader always do; the workspace reads it through /internal/permissions (keeper).
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS mergers TEXT[] NOT NULL DEFAULT '{mod}';
DO $$ BEGIN
  ALTER TABLE translation_groups ADD CONSTRAINT translation_groups_mergers_roles
    CHECK (mergers <@ ARRAY['mod', 'translator', 'editor', 'raw_provider', 'proofreader', 'member']);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
