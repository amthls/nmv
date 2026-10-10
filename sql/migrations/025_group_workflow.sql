-- 025: each translation group picks the steps a chapter goes through before a story keeper merges it
-- (Plan/chapter-workspace.md, stage 4b): raw (raw_provider) -> translate (translator) -> edit (editor) -> proofread (proofreader).
-- Default: translate only (DỊCH -> GỘP). The workspace reads it through /internal/permissions.
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS workflow TEXT[] NOT NULL DEFAULT '{translate}';
DO $$ BEGIN
  ALTER TABLE translation_groups ADD CONSTRAINT translation_groups_workflow_steps
    CHECK (cardinality(workflow) >= 1 AND workflow <@ ARRAY['raw', 'translate', 'edit', 'proofread']);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
