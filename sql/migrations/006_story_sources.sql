-- Where an imported story came from (scripts/crawler.py), so it is never imported twice
-- and the original source / scanlation group can be credited on the site.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS source_name VARCHAR(50);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS source_id VARCHAR(100);
ALTER TABLE stories ADD COLUMN IF NOT EXISTS source_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stories_source
    ON stories(source_name, source_id) WHERE source_id IS NOT NULL;

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS source_group VARCHAR(200);
