-- Who approved a translation group and when (approveGroup writes these; they were missing from the schema,
-- so approving any pending group failed). Idempotent; apply to an existing database with:
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/004_group_approval_audit.sql

ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE translation_groups ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
