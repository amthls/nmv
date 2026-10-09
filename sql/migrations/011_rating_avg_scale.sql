-- Ratings are 1..10 but stories.rating_avg was DECIMAL(3,2) (max 9.99): a story whose ratings
-- average exactly 10 (e.g. its first rating is a 10) made the rating trigger fail with
-- "numeric field overflow". Widen it; v_trending_stories reads the column, so rebuild it.
-- Skipped once 018_drop_ratings.sql has removed ratings (launch.py re-runs every migration).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'stories' AND column_name = 'rating_avg') THEN
    RETURN;
  END IF;
  DROP VIEW IF EXISTS v_trending_stories;
  ALTER TABLE stories ALTER COLUMN rating_avg TYPE DECIMAL(4,2);
  CREATE VIEW v_trending_stories AS
  SELECT s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status, s.rating_avg,
         s.total_views, s.total_favorites, COALESCE(recent.weekly_views, 0) AS weekly_views, s.last_chapter_at
  FROM stories s
  LEFT JOIN (
      SELECT story_id, count(*) AS weekly_views
      FROM story_views
      WHERE viewed_at >= NOW() - INTERVAL '7 days'
      GROUP BY story_id
  ) recent ON s.id = recent.story_id
  WHERE s.approval_status = 'approved'
  ORDER BY COALESCE(recent.weekly_views, 0) DESC, s.rating_avg DESC;
END $$;
