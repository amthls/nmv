-- Soft-deleted accounts: the row stays (stories/chapters/groups still reference it) but it is
-- anonymized and locked. Idempotent; apply to an existing database with:
--   docker exec -i novel_postgres psql -U postgres -d novel_platform < sql/migrations/005_user_soft_delete.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
