import { Request, Response } from 'express';
import { pool } from '../config/db';
import { isUuid } from '../utils/validation';
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
 * A user's place in a story's workspace. keeper: story owner, or leader/mod of the story's group (merges, rewinds);
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
           ARRAY(SELECT s.uploader_id UNION SELECT user_id FROM group_members WHERE group_id = s.group_id AND role IN ('leader', 'mod'))::text[] AS keepers,
           (SELECT workflow FROM translation_groups WHERE id = s.group_id) AS workflow, s.group_id
    FROM stories s WHERE s.id = $2`, [user, story]);
  const row = r.rows[0];
  if (!row) return none;
  const keeper = row.owner || ['leader', 'mod'].includes(row.group_role);
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
    `SELECT id, username, display_name, avatar_url, COALESCE(is_banned, false) AS is_banned, deleted_at IS NOT NULL AS deleted
     FROM users WHERE id = ANY($1::uuid[]) OR username = ANY($2::text[])`,
    [ids, names]
  );
  res.json({ success: true, data: r.rows });
};

/**
 * GET /internal/stories/:id/followers?after=<user uuid>&limit=<=1000 -> [user_id] in id order: who wants new-chapter
 * notifications for the story (messaging pages through it; its own settings decide the rest).
 */
export const storyFollowers = async (req: Request, res: Response) => {
  const { id } = req.params;
  const after = typeof req.query.after === 'string' && isUuid(req.query.after) ? req.query.after : '00000000-0000-0000-0000-000000000000';
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000);
  if (!isUuid(id)) return res.status(404).json({ success: false });
  const r = await pool.query(
    `SELECT user_id FROM user_favorites WHERE story_id = $1 AND user_id > $2 AND notify_updates IS NOT FALSE ORDER BY user_id LIMIT $3`,
    [id, after, limit]
  );
  res.json({ success: true, data: r.rows.map((row: any) => row.user_id) });
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
