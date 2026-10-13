-- Repair: fresh installs from sql/database.sql had no stories.allow_download yet 007 was recorded as applied, so reading
-- a chapter, creating a story and EPUB/PDF downloads failed there. Idempotent.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT false;
