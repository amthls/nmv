import { Request, Response } from 'express';
import { pool } from './config';
import { AuthedRequest, isStaff } from './auth';
import { callBackend, profileByUsername, profiles } from './backend';
import { purgeUserComments } from './comments';

const PAGE = 30;

/**
 * GET /moderation/removed?type=all|story|post&q=&page= (Admin/Mod): content taken down by Admin/Mod, newest first.
 * Posts are ours; removed stories come from the backend (GET /internal/stories/removed) and both lists are merged.
 * shortcut: merged per request (each side returns its first page*30 rows); keep a copy fed by story.removed events
 * when stories move to catalog (stage I). `q` matches code, title, text, or the author's exact username for posts.
 */
export const getRemovedContent = async (req: AuthedRequest, res: Response) => {
  try {
    if (!isStaff(req)) return res.status(403).json({ success: false, message: 'Chỉ Admin/Mod mới xem được nội dung đã gỡ.' });
    const type = req.query.type === 'story' || req.query.type === 'post' ? req.query.type : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const pageNum = Math.max(1, parseInt(req.query.page as string) || 1);
    const want = pageNum * PAGE; // enough of each side to cut this page from the merge

    const [postPart, storyPart] = await Promise.all([
      type === 'story' ? null : (async () => {
        const author = q && !/\s/.test(q) ? await profileByUsername(q).catch(() => null) : null;
        const where = `p.approval_status = 'rejected' AND p.is_deleted = false
          AND ($1::text IS NULL OR p.code ILIKE $1 OR p.title ILIKE $1 OR p.content ILIKE $1 OR p.user_id = $2::uuid)`;
        const [n, rows] = await Promise.all([
          pool.query(`SELECT count(*)::int AS n FROM posts p WHERE ${where}`, [pattern, author?.id ?? null]),
          pool.query(`SELECT 'post' AS type, p.id, p.code, p.title, p.slug, p.cover_image_url AS image, p.user_id, p.removed_by,
                        p.rejection_reason AS reason, p.removed_at
                      FROM posts p WHERE ${where} ORDER BY p.removed_at DESC NULLS LAST LIMIT $3`, [pattern, author?.id ?? null, want]),
        ]);
        const people = await profiles(rows.rows.flatMap((r) => [r.user_id, r.removed_by]));
        return {
          total: n.rows[0].n,
          rows: rows.rows.map(({ user_id, removed_by, ...r }) => ({
            ...r,
            author_username: people.get(user_id)?.username ?? null, author_name: people.get(user_id)?.display_name ?? null,
            removed_by_username: people.get(removed_by)?.username ?? null, removed_by_name: people.get(removed_by)?.display_name ?? null,
          })),
        };
      })(),
      type === 'post' ? null : (async () => {
        const r = await callBackend('GET', `/internal/stories/removed?limit=${want}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
        if (r.status !== 200) throw new Error(`backend removed stories: HTTP ${r.status}`);
        return r.json.data as { total: number; rows: any[] };
      })(),
    ]);

    const merged = [...(postPart?.rows || []), ...(storyPart?.rows || [])]
      .sort((a, b) => (b.removed_at ? new Date(b.removed_at).getTime() : 0) - (a.removed_at ? new Date(a.removed_at).getTime() : 0));
    res.json({
      success: true,
      data: merged.slice((pageNum - 1) * PAGE, pageNum * PAGE),
      pagination: { page: pageNum, limit: PAGE, total: (postPart?.total || 0) + (storyPart?.total || 0) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ---- the backend's calls (X-Internal-Auth signed with INTERNAL_KEY_COMMUNITY) ---------------------------------

/** GET /internal/codes/:kind/:no?me=<uuid>&staff=1 -> {path} of a P- / RP- smart code (hidden = 404, like unknown). */
export const resolveCode = async (req: Request, res: Response) => {
  const no = Number(req.params.no);
  const staff = req.query.staff === '1';
  const me = typeof req.query.me === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.me) ? req.query.me : null;
  let path: string | null = null;
  if (Number.isSafeInteger(no) && req.params.kind === 'post') {
    const r = await pool.query(`SELECT '/fandom/' || slug AS path FROM posts WHERE code_no = $1 AND NOT is_deleted
                                AND ((approval_status = 'approved' AND is_published) OR user_id = $2 OR $3)`, [no, me, staff]);
    path = r.rows[0]?.path ?? null;
  } else if (Number.isSafeInteger(no) && req.params.kind === 'report' && staff) {
    const r = await pool.query(`SELECT '/bao-cao' AS path FROM reports WHERE code_no = $1`, [no]);
    path = r.rows[0]?.path ?? null;
  }
  if (!path) return res.status(404).json({ success: false });
  res.json({ success: true, data: { path } });
};

/** GET /internal/users/:id/stats -> what a profile shows about someone's posts and comments. */
export const userStats = async (req: Request, res: Response) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ success: false });
  const r = await pool.query(`
    SELECT (SELECT count(*)::int FROM posts WHERE user_id = $1 AND is_deleted = false) AS posts,
           (SELECT count(*)::int FROM posts WHERE user_id = $1 AND is_deleted = false AND approval_status = 'approved') AS approved_posts,
           (SELECT count(*)::int FROM comments WHERE user_id = $1 AND is_deleted = false) AS comments,
           (SELECT COALESCE(sum(like_count), 0)::int FROM comments WHERE user_id = $1 AND is_deleted = false) AS comment_likes`,
    [req.params.id]);
  res.json({ success: true, data: r.rows[0] });
};

/**
 * POST /internal/comments/purge {story_id, chapter_ids}: a story was deleted. Its comments go with it and posts about it
 * lose the link (as the backend did in the same transaction).
 */
export const purgeStoryComments = async (req: Request, res: Response) => {
  const storyId = typeof req.body?.story_id === 'string' ? req.body.story_id : null;
  const chapterIds = Array.isArray(req.body?.chapter_ids) ? req.body.chapter_ids.filter((x: unknown) => typeof x === 'string') : [];
  const r = await pool.query(
    `DELETE FROM comments WHERE (target_type = 'story' AND target_id = $1::uuid) OR (target_type = 'chapter' AND target_id = ANY($2::uuid[]))`,
    [storyId, chapterIds]);
  await pool.query(`UPDATE posts SET story_id = NULL WHERE story_id = $1::uuid`, [storyId]);
  res.json({ success: true, data: { deleted: r.rowCount } });
};

/** identity.user.deleted with purge_content: hide the account's posts and comments. Idempotent (processed_events). */
export async function handleIdentityEvent(evt: any): Promise<string> {
  if (!evt?.event_id || typeof evt.type !== 'string' || typeof evt.data !== 'object') throw new Error('malformed event');
  const client = await pool.connect();
  let sendCounts = () => {};
  try {
    await client.query('BEGIN');
    const seen = await client.query(`INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
      [evt.event_id, evt.type]);
    if (seen.rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicate';
    }
    let outcome = 'skipped';
    if (evt.type === 'identity.user.deleted' && evt.data.deleted_at && evt.data.purge_content) {
      await client.query(`UPDATE posts SET is_deleted = true, is_pinned = false WHERE user_id = $1 AND is_deleted = false`, [evt.data.id]);
      sendCounts = await purgeUserComments(client, evt.data.id);
      outcome = 'applied';
    }
    await client.query('COMMIT');
    sendCounts();
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
