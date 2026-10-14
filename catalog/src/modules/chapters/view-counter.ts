import { pool } from '../../config/db';
import { redis, redisReady } from '../../config/redis';

/**
 * Chapter/story view counters. A popular story would otherwise take a row lock on the same
 * `stories` row for every single page view, so views are added up in Redis and written to
 * Postgres once a minute by the worker (flushViews). Without Redis they go straight to the DB.
 */

const KEYS = { stories: 'views:stories', chapters: 'views:chapters' } as const;
const LOCK_KEY = 'views:flush:lock';

/** Same effect as one flushed view, in a single statement (pg rejects several commands with params). */
function writeViewDirect(storyId: string, chapterId: string) {
  return pool.query(`
    WITH c AS (UPDATE chapters SET total_views = total_views + 1 WHERE id = $1),
         s AS (UPDATE stories SET total_views = total_views + 1 WHERE id = $2)
    INSERT INTO story_views_daily (story_id, view_date, view_count) VALUES ($2, CURRENT_DATE, 1)
    ON CONFLICT (story_id, view_date) DO UPDATE SET view_count = story_views_daily.view_count + 1
  `, [chapterId, storyId]);
}

/** Fire-and-forget: a lost view must never fail or slow down reading a chapter. */
export function recordView(storyId: string, chapterId: string) {
  const direct = () => writeViewDirect(storyId, chapterId).catch((err) => console.error('[Views] write failed:', err.message));
  if (!redis || !redisReady()) return void direct();
  redis.multi().hincrby(KEYS.stories, storyId, 1).hincrby(KEYS.chapters, chapterId, 1).exec()
    .then((res) => { if (!res || res.some(([err]) => err)) direct(); })
    .catch(direct);
}

/**
 * Moves the buffered counts into Postgres. The hash is renamed first so new views keep counting
 * meanwhile; the renamed copy is deleted only after the DB write succeeded, so a failed flush is
 * retried next time instead of losing views. A short lock keeps two workers from double counting.
 */
export async function flushViews(): Promise<{ stories: number; chapters: number }> {
  const done = { stories: 0, chapters: 0 };
  if (!redis || !redisReady()) return done;
  if (!(await redis.set(LOCK_KEY, '1', 'PX', 50_000, 'NX'))) return done;
  try {
    for (const kind of ['stories', 'chapters'] as const) {
      const key = KEYS[kind];
      const pending = `${key}:flushing`;
      if (!(await redis.exists(pending))) {
        try {
          await redis.rename(key, pending);
        } catch {
          continue; // nothing counted since the last flush
        }
      }
      const counts = await redis.hgetall(pending);
      const ids = Object.keys(counts);
      const ns = ids.map((id) => Number(counts[id]));
      if (ids.length > 0) {
        if (kind === 'chapters') {
          await pool.query(
            `UPDATE chapters c SET total_views = c.total_views + v.n
             FROM unnest($1::uuid[], $2::bigint[]) AS v(id, n) WHERE c.id = v.id`,
            [ids, ns]
          );
        } else {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE stories s SET total_views = s.total_views + v.n
               FROM unnest($1::uuid[], $2::bigint[]) AS v(id, n) WHERE s.id = v.id`,
              [ids, ns]
            );
            // JOIN skips stories deleted since the view (the FK would reject the whole batch)
            await client.query(
              `INSERT INTO story_views_daily (story_id, view_date, view_count)
               SELECT v.id, CURRENT_DATE, v.n FROM unnest($1::uuid[], $2::bigint[]) AS v(id, n) JOIN stories s ON s.id = v.id
               ON CONFLICT (story_id, view_date) DO UPDATE SET view_count = story_views_daily.view_count + EXCLUDED.view_count`,
              [ids, ns]
            );
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        }
      }
      await redis.del(pending);
      done[kind] = ids.length;
    }
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }
  return done;
}
