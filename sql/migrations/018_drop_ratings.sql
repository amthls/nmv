-- Story ratings are gone (owner's decision 2026-10-09): drop the table, its trigger and the counters.
-- v_trending_stories read stories.rating_avg, so it is rebuilt without it.

DROP TRIGGER IF EXISTS trg_rating_update ON story_ratings;
DROP FUNCTION IF EXISTS update_story_rating();
DROP TABLE IF EXISTS story_ratings;

DROP VIEW IF EXISTS v_trending_stories;
ALTER TABLE stories DROP COLUMN IF EXISTS rating_avg, DROP COLUMN IF EXISTS rating_count;

CREATE VIEW v_trending_stories AS
SELECT s.id, s.title, s.slug, s.cover_image_url, s.story_type, s.status,
       s.total_views, s.total_favorites, COALESCE(recent.weekly_views, 0) AS weekly_views, s.last_chapter_at
FROM stories s
LEFT JOIN (
    SELECT story_id, count(*) AS weekly_views
    FROM story_views
    WHERE viewed_at >= NOW() - INTERVAL '7 days'
    GROUP BY story_id
) recent ON s.id = recent.story_id
WHERE s.approval_status = 'approved'
ORDER BY COALESCE(recent.weekly_views, 0) DESC, s.total_views DESC;
