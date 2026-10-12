import { Request, Response } from 'express';
import { pool } from '../config/db';
import { isUuid } from '../utils/validation';
import { REMOVED_PURGE_DAYS } from '../services/storyPurge';
import { listExportableChapters, loadBook, storyFingerprint } from '../services/exportSource';

// Service-to-service endpoints (X-Internal-Auth, mounted under /internal in server.ts; the gateway answers 404
// for /internal from outside). Stories and groups live here, so the workspace and the media service ask.

export interface StoryRole {
  keeper: boolean; contributor: boolean; removed: boolean; name: string; keeperIds: string[];
  role: string;       // owner | the group role (leader, mod, member, translator, editor, raw_provider, proofreader) | collaborator | ''
  workflow: string[]; // the group's steps before a merge (stage 4b); a story without a group: translate only
  groupId: string | null;
}

/**
 * A user's place in a story's workspace. keeper: story owner, the leader of the story's group, or a member whose role
 * the group lets merge (translation_groups.mergers, default mod) (merges, rewinds);
 * contributor: keeper, any member of that group or a collaborator (drafts, proposals, history).
 * keeperIds: everyone who keeps the story (who to tell about a proposal).
 */
export async function storyRole(user: string, story: string): Promise<StoryRole> {
  const none = { keeper: false, contributor: false, removed: false, name: '', keeperIds: [], role: '', workflow: ['translate'], groupId: null };
  if (!isUuid(user) || !isUuid(story)) return none;
  const r = await pool.query(`
    SELECT s.uploader_id = $1 AS owner,
           s.approval_status = 'rejected' AS removed,
           (SELECT role FROM group_members WHERE group_id = s.group_id AND user_id = $1) AS group_role,
           EXISTS (SELECT 1 FROM story_collaborators WHERE story_id = s.id AND user_id = $1) AS collaborator,
           (SELECT COALESCE(display_name, username) FROM users WHERE id = $1) AS name,
           ARRAY(SELECT s.uploader_id UNION SELECT user_id FROM group_members
                 WHERE group_id = s.group_id AND (role = 'leader' OR role::text = ANY(g.mergers)))::text[] AS keepers,
           g.workflow, g.mergers, s.group_id
    FROM stories s LEFT JOIN translation_groups g ON g.id = s.group_id WHERE s.id = $2`, [user, story]);
  const row = r.rows[0];
  if (!row) return none;
  const keeper = row.owner || row.group_role === 'leader' || (row.mergers || []).includes(row.group_role);
  return {
    keeper, contributor: keeper || Boolean(row.group_role) || row.collaborator, removed: row.removed, name: row.name || '',
    keeperIds: (row.keepers || []).filter(Boolean),
    role: row.owner ? 'owner' : row.group_role || (row.collaborator ? 'collaborator' : ''),
    workflow: row.workflow || ['translate'],
    groupId: row.group_id,
  };
}

/** GET /internal/permissions?user=&story= -> {keeper, contributor, removed, name, role, workflow} (cached 30 s by the workspace). */
export const permissions = async (req: Request, res: Response) => {
  const { keeper, contributor, removed, name, role, workflow } = await storyRole(String(req.query.user || ''), String(req.query.story || ''));
  res.json({ success: true, data: { keeper, contributor, removed, name, role, workflow } });
};

/**
 * GET /internal/chapters/export?after=<id>&limit=100: every published chapter with its content, in id order,
 * for the workspace's one-time import (each becomes version 1, recorded in ws_chapter_versions).
 */
export const exportChapters = async (req: Request, res: Response) => {
  const after = isUuid(String(req.query.after || '')) ? String(req.query.after) : '00000000-0000-0000-0000-000000000000';
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit)) || 100));
  const r = await pool.query(`
    SELECT c.id, c.story_id, c.title, c.chapter_number, c.volume_id, c.intro_note, c.outro_note, c.content, c.content_blocks,
           c.uploader_id, COALESCE(u.display_name, u.username) AS author_name, COALESCE(c.updated_at, c.created_at) AS created_at,
           (SELECT json_agg(json_build_object('image_url', p.image_url, 'width', p.width, 'height', p.height) ORDER BY p.page_number)
              FROM chapter_pages p WHERE p.chapter_id = c.id) AS pages
    FROM chapters c LEFT JOIN users u ON u.id = c.uploader_id
    WHERE c.id > $1 ORDER BY c.id LIMIT $2`, [after, limit]);
  // Each exported chapter becomes (or already is) version 1 in the workspace: record it, so the edit form's
  // expected_version protects the very first edit too
  if (r.rows.length > 0) {
    await pool.query(`INSERT INTO ws_chapter_versions (chapter_id, version) SELECT unnest($1::uuid[]), 1 ON CONFLICT DO NOTHING`, [r.rows.map((c: any) => c.id)]);
  }
  res.json({
    success: true,
    data: r.rows.map((c: any) => {
      let blocks: any[] = Array.isArray(c.content_blocks) ? c.content_blocks : [];
      // Older chapters: manga pages only in chapter_pages, or plain text only in `content`
      if (blocks.length === 0 && c.pages) {
        blocks = c.pages.map((p: any, i: number) => ({ id: `b${i + 1}`, type: 'image', image_url: p.image_url, ...(p.width && p.height ? { width: p.width, height: p.height } : {}) }));
      } else if (blocks.length === 0 && c.content) {
        blocks = String(c.content).split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((t, i) => ({ id: `b${i + 1}`, type: 'paragraph', text: t }));
      }
      return {
        id: c.id,
        story_id: c.story_id,
        meta: { title: c.title, chapter_number: Number(c.chapter_number), volume_id: c.volume_id, intro_note: c.intro_note, outro_note: c.outro_note },
        blocks,
        author_id: c.uploader_id,
        author_name: c.author_name,
        created_at: c.created_at,
      };
    }),
  });
};

/**
 * POST /internal/exports/source {slug | story_id, chapter_ids: uuid[] | null}: what the media service needs to accept an
 * EPUB/PDF request (may the story be downloaded, which chapters, their fingerprints). chapter_ids [] = the story only
 * (checked again before a file is handed out).
 */
export const exportSource = async (req: Request, res: Response) => {
  const { slug, story_id, chapter_ids } = req.body || {};
  const ids: string[] | null = Array.isArray(chapter_ids) ? chapter_ids.filter(isUuid) : null;
  const r = isUuid(story_id)
    ? await pool.query(`SELECT id, allow_download, approval_status FROM stories WHERE id = $1`, [story_id])
    : await pool.query(`SELECT id, allow_download, approval_status FROM stories WHERE slug = $1`, [String(slug || '')]);
  const s = r.rows[0];
  if (!s) return res.status(404).json({ success: false, message: 'Không tìm thấy truyện.' });
  const open = s.approval_status === 'approved' && s.allow_download;
  res.json({
    success: true,
    data: {
      story_id: s.id,
      approved: s.approval_status === 'approved',
      allow_download: Boolean(s.allow_download),
      fingerprint: open ? await storyFingerprint(s.id) : '',
      chapters: open && !(ids && ids.length === 0) ? await listExportableChapters(s.id, ids) : [],
    },
  });
};

/** POST /internal/exports/book {story_id, chapter_ids}: the chapters' content, normalised for the EPUB/PDF writers. */
export const exportBook = async (req: Request, res: Response) => {
  const { story_id, chapter_ids } = req.body || {};
  if (!isUuid(story_id) || !Array.isArray(chapter_ids) || !chapter_ids.every(isUuid)) {
    return res.status(400).json({ success: false, message: 'story_id, chapter_ids' });
  }
  res.json({ success: true, data: await loadBook(story_id, chapter_ids) });
};

/**
 * POST /internal/users/profiles {ids?: uuid[], usernames?: string[]} (at most 500): what other services show for a
 * person (messaging: inbox, threads, group chat). Deleted accounts come back flagged, banned ones too.
 */
export const userProfiles = async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isUuid).slice(0, 500) : [];
  const names = Array.isArray(req.body?.usernames) ? req.body.usernames.filter((u: unknown) => typeof u === 'string').slice(0, 500) : [];
  const r = await pool.query(
    `SELECT id, username, display_name, avatar_url, COALESCE(is_banned, false) AS is_banned, deleted_at IS NOT NULL AS deleted, code_no::int AS code_no,
       COALESCE((SELECT array_agg(role::text) FROM user_roles r WHERE r.user_id = users.id), '{}') AS roles
     FROM users WHERE id = ANY($1::uuid[]) OR username = ANY($2::text[])`,
    [ids, names]
  );
  res.json({ success: true, data: r.rows });
};

/**
 * POST /internal/stories/brief {story_ids?, chapter_ids?} (at most 1000 each) -> {stories, chapters}: what community shows
 * or links for a story/chapter (any status: approval_status tells whether it was taken down).
 */
export const storiesBrief = async (req: Request, res: Response) => {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isUuid).slice(0, 1000) : []);
  const [stories, chapters] = await Promise.all([
    pool.query(`SELECT id, title, slug, cover_image_url, story_type, author_name, code, approval_status FROM stories WHERE id = ANY($1::uuid[])`,
      [ids(req.body?.story_ids)]),
    pool.query(`SELECT id, story_id, title, slug, trim_scale(chapter_number)::text AS chapter_number FROM chapters WHERE id = ANY($1::uuid[])`,
      [ids(req.body?.chapter_ids)]),
  ]);
  res.json({ success: true, data: { stories: stories.rows, chapters: chapters.rows } });
};

/**
 * GET /internal/stories/removed?q=&limit= -> {total, rows}: stories taken down by Admin/Mod (purge_at: deleted for good then), newest first, in the row
 * shape of the "Đã gỡ" page (community merges them with removed posts). `q` matches code, titles, author, synopsis, uploader.
 */
export const removedStories = async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 3000);
  const where = `s.approval_status = 'rejected'
    AND ($1::text IS NULL OR s.code ILIKE $1 OR s.title ILIKE $1 OR s.original_title ILIKE $1
         OR s.author_name ILIKE $1 OR s.synopsis ILIKE $1 OR u.username ILIKE $1)`;
  const [total, rows] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM stories s JOIN users u ON u.id = s.uploader_id WHERE ${where}`, [pattern]),
    pool.query(`
      SELECT 'story' AS type, s.id, s.code, s.title, s.slug, s.cover_image_url AS image,
             u.username AS author_username, u.display_name AS author_name,
             s.rejection_reason AS reason, s.removed_at, s.removed_at + make_interval(days => $3) AS purge_at,
             r.username AS removed_by_username, r.display_name AS removed_by_name
      FROM stories s JOIN users u ON u.id = s.uploader_id LEFT JOIN users r ON r.id = s.removed_by
      WHERE ${where} ORDER BY s.removed_at DESC NULLS LAST LIMIT $2`, [pattern, limit, REMOVED_PURGE_DAYS]),
  ]);
  res.json({ success: true, data: { total: total.rows[0].n, rows: rows.rows } });
};

/**
 * POST /internal/comment-counts {chapters: [{id, count}], stories: [{id, page_count}]}: fresh comment counts from
 * community. chapters.total_comments = count; stories.total_comments = comments on the story page + on all its chapters.
 */
export const commentCounts = async (req: Request, res: Response) => {
  const chapters = Array.isArray(req.body?.chapters) ? req.body.chapters.filter((c: any) => isUuid(c?.id) && Number.isInteger(c.count)) : [];
  const stories = Array.isArray(req.body?.stories) ? req.body.stories.filter((s: any) => isUuid(s?.id) && Number.isInteger(s.page_count)) : [];
  if (chapters.length) {
    await pool.query(`UPDATE chapters c SET total_comments = x.n FROM unnest($1::uuid[], $2::int[]) AS x(id, n) WHERE c.id = x.id`,
      [chapters.map((c: any) => c.id), chapters.map((c: any) => c.count)]);
  }
  if (stories.length) {
    await pool.query(`
      UPDATE stories s SET total_comments = x.n + COALESCE((SELECT sum(total_comments) FROM chapters WHERE story_id = s.id), 0)
      FROM unnest($1::uuid[], $2::int[]) AS x(id, n) WHERE s.id = x.id`,
      [stories.map((s: any) => s.id), stories.map((s: any) => s.page_count)]);
  }
  res.json({ success: true });
};

/** GET /internal/groups/:id/members -> [{user_id, role}] (404 when the group does not exist): who may use the group's chat. */
export const groupMembers = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ success: false });
  const g = await pool.query(`SELECT 1 FROM translation_groups WHERE id = $1`, [id]);
  if (!g.rowCount) return res.status(404).json({ success: false });
  const r = await pool.query(`SELECT user_id, role FROM group_members WHERE group_id = $1`, [id]);
  res.json({ success: true, data: r.rows });
};

/**
 * GET /internal/library/{stories|chapters}?since=&after=&limit= -> rows changed since (updated_at, id), oldest first: the
 * library service's read copies (Plan/library.md). updated_at comes back as Postgres text (microseconds kept) and is
 * handed back as `since`. Rows from the last 2 seconds wait for the next call (a transaction still open could commit
 * with an older time).
 */
const LIBRARY_ROWS = {
  stories: `SELECT s.id, s.title, s.slug, s.cover_image_url, s.author_name, s.story_type::text, s.status::text, s.approval_status::text,
      s.total_chapters, s.total_views, s.total_favorites, g.name AS group_name,
      COALESCE((SELECT json_agg(json_build_object('name', t.name, 'slug', t.slug)) FROM story_tags st JOIN tags t ON t.id = st.tag_id
                WHERE st.story_id = s.id), '[]') AS tags,
      s.group_id, s.synopsis, s.last_chapter_at, s.created_at, -- the recommender's copy (library ignores them)
      s.updated_at::text AS updated_at
    FROM stories s LEFT JOIN translation_groups g ON g.id = s.group_id`,
  chapters: `SELECT c.id, c.story_id, c.title, c.slug, c.chapter_number::text, c.is_published, c.updated_at::text AS updated_at
    FROM chapters c`,
};
export const librarySync = (kind: 'stories' | 'chapters') => async (req: Request, res: Response) => {
  const since = typeof req.query.since === 'string' && req.query.since ? req.query.since : '1970-01-01T00:00:00Z';
  const after = isUuid(req.query.after) ? req.query.after : '00000000-0000-0000-0000-000000000000';
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const t = kind === 'stories' ? 's' : 'c';
  if (typeof req.query.ids === 'string') { // exact rows (a chapter published a moment ago), the cursor is not involved
    const ids = req.query.ids.split(',').filter(isUuid).slice(0, 100);
    const r = await pool.query(`${LIBRARY_ROWS[kind]} WHERE ${t}.id = ANY($1::uuid[])`, [ids]);
    return res.json({ success: true, data: r.rows });
  }
  const r = await pool.query(
    `${LIBRARY_ROWS[kind]} WHERE (${t}.updated_at, ${t}.id) > ($1::timestamptz, $2::uuid) AND ${t}.updated_at < NOW() - INTERVAL '2 seconds'
     ORDER BY ${t}.updated_at, ${t}.id LIMIT $3`, [since, after, limit]);
  res.json({ success: true, data: r.rows });
};

/** GET /internal/library/ids?type=story|chapter -> every id (the library drops copies of rows that are gone). */
export const libraryIds = async (req: Request, res: Response) => {
  const table = req.query.type === 'chapter' ? 'chapters' : 'stories';
  const r = await pool.query(`SELECT id FROM ${table}`);
  res.json({ success: true, data: r.rows.map((row: any) => row.id) });
};

/** POST /internal/favorite-counts {stories: [{id, count}]}: fresh follower counts from the library (stories.total_favorites). */
export const favoriteCounts = async (req: Request, res: Response) => {
  const list = Array.isArray(req.body?.stories) ? req.body.stories.filter((s: any) => isUuid(s?.id) && Number.isInteger(s.count)) : [];
  if (list.length) {
    await pool.query(`UPDATE stories s SET total_favorites = x.n FROM unnest($1::uuid[], $2::int[]) AS x(id, n) WHERE s.id = x.id`,
      [list.map((s: any) => s.id), list.map((s: any) => s.count)]);
  }
  res.json({ success: true });
};
