import { pool } from '../../config/db';
import { callCommunity } from '../../services/communityClient';
import { purgeLibrary } from '../../services/libraryClient';
import { removeStoryFromIndex } from '../search/search.client';
import { bumpPublicCache } from '../../middlewares/cache';

/**
 * Delete a story for good: its rows here in one transaction, then its search entry, its comments (community) and its
 * history/bookmarks/follows/album places (library). Used by the owner's delete and the 60-day purge of removed stories.
 * removedDays: only if it is still taken down and was removed that many days ago (checked under a row lock, so a story
 * restored meanwhile stays). Returns false if nothing was deleted.
 */
export async function purgeStory(id: string, removedDays?: number): Promise<boolean> {
  let chapterIds: string[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (removedDays !== undefined) {
      const due = await client.query(
        `SELECT 1 FROM stories WHERE id = $1 AND approval_status = 'rejected' AND removed_at < NOW() - make_interval(days => $2) FOR UPDATE`,
        [id, removedDays],
      );
      if (due.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
    }
    // 1. Views, tags, collaborators (reading history, bookmarks, follows: the library service, after the commit)
    await client.query(`DELETE FROM story_views WHERE story_id = $1`, [id]);
    await client.query(`DELETE FROM story_tags WHERE story_id = $1`, [id]);
    await client.query(`DELETE FROM story_collaborators WHERE story_id = $1`, [id]);
    // 2. Chapter pages, chapter submissions, chapters
    await client.query(`DELETE FROM chapter_pages WHERE chapter_id IN (SELECT id FROM chapters WHERE story_id = $1)`, [id]);
    await client.query(`DELETE FROM chapter_submissions WHERE story_id = $1`, [id]);
    chapterIds = (await client.query(`DELETE FROM chapters WHERE story_id = $1 RETURNING id`, [id])).rows.map((r: any) => r.id);
    // 3. Volumes
    await client.query(`DELETE FROM volumes WHERE story_id = $1`, [id]);
    // 4. The story record (its comments and the posts about it: community, after the commit)
    const gone = await client.query(`DELETE FROM stories WHERE id = $1`, [id]);
    await client.query('COMMIT');
    if (gone.rowCount === 0) return false;
    await bumpPublicCache(); // the 60-day purge runs on a timer, not as a request
  } catch (txErr) {
    await client.query('ROLLBACK');
    throw txErr;
  } finally {
    client.release();
  }

  await removeStoryFromIndex(id);
  await callCommunity('POST', '/internal/comments/purge', { story_id: id, chapter_ids: chapterIds })
    .then((r) => { if (r.status !== 200) throw new Error(`HTTP ${r.status}`); })
    .catch((err) => console.error(`[stories] comments of deleted story ${id} not purged in community: ${err.message}`));
  await purgeLibrary({ story_ids: [id] });
  return true;
}

export const REMOVED_PURGE_DAYS = Number(process.env.REMOVED_PURGE_DAYS || 60);

/** Worker: stories taken down by Admin/Mod and not restored within REMOVED_PURGE_DAYS are deleted for good (daily + at start). */
export function scheduleRemovedPurge() {
  const run = async () => {
    try {
      const due = await pool.query(
        `SELECT id, title FROM stories WHERE approval_status = 'rejected' AND removed_at < NOW() - make_interval(days => $1)`,
        [REMOVED_PURGE_DAYS],
      );
      for (const s of due.rows) {
        if (await purgeStory(s.id, REMOVED_PURGE_DAYS)) console.log(`[Worker] removed story purged after ${REMOVED_PURGE_DAYS} days: ${s.id} "${s.title}"`);
      }
    } catch (err: any) {
      console.error('[Worker] removed-story purge failed:', err.message);
    }
  };
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
