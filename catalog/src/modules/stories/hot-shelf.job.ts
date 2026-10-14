import { redis, redisReady } from '../../config/redis';
import { pool } from '../../config/db';

// Same key and body as cacheJson on GET /api/v1/stories/trending: the worker keeps it filled, so readers never wait for the
// query (a miss, e.g. the worker down, still computes it in the API)
const KEY = 'cache:/api/v1/stories/trending';
const EVERY_MS = Number(process.env.HOT_SHELF_MS || 120_000);

/** Worker: recompute the "Đang hot" shelf every 2 minutes; the key outlives two missed runs. */
export function scheduleHotShelf() {
  const run = async () => {
    if (!redis || !redisReady()) return;
    try {
      const body = JSON.stringify({ success: true, data: await trendingStories() });
      await redis.set(KEY, body, 'EX', Math.ceil((EVERY_MS * 3) / 1000));
    } catch (err: any) {
      console.error('[Worker] hot shelf failed:', err.message);
    }
  };
  setTimeout(run, 5_000).unref();
  setInterval(run, EVERY_MS).unref();
}

/** The "Đang hot" shelf (GET /stories/trending). */
export async function trendingStories() {
  const result = await pool.query(`
      SELECT
        s.id, s.title, s.slug, s.original_title, s.synopsis,
        s.cover_image_url, s.banner_image_url, s.story_type, s.status,
        s.original_language, s.translated_language, s.author_name, s.artist_name,
        s.total_chapters, s.total_volumes,
        s.total_views, s.total_favorites, s.total_bookmarks, s.total_comments,
        s.last_chapter_at, s.created_at,
        u.username as uploader_username,
        u.display_name as uploader_name,
        g.name as group_name,
        g.slug as group_slug,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug)
          ) FILTER (WHERE t.id IS NOT NULL), '[]'
        ) as tags,
        (
          SELECT json_build_object('title', c.title, 'chapter_number', c.chapter_number, 'slug', c.slug, 'published_at', c.published_at)
          FROM chapters c
          WHERE c.story_id = s.id AND c.is_published = true
          ORDER BY c.chapter_number DESC LIMIT 1
        ) as latest_chapter,
        (
          SELECT json_agg(cp.image_url ORDER BY cp.page_number ASC)
          FROM chapter_pages cp
          JOIN chapters c2 ON cp.chapter_id = c2.id
          WHERE c2.story_id = s.id
          LIMIT 6
        ) as illustrations
      FROM stories s
      JOIN users u ON s.uploader_id = u.id
      LEFT JOIN translation_groups g ON s.group_id = g.id
      LEFT JOIN story_tags st ON s.id = st.story_id
      LEFT JOIN tags t ON st.tag_id = t.id
      WHERE s.approval_status = 'approved'
      GROUP BY s.id, u.id, g.id
      ORDER BY s.total_views DESC, s.total_favorites DESC
      LIMIT 12;
    `);
  return result.rows;
}
