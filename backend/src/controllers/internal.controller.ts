import { Request, Response } from 'express';
import { pool } from '../config/db';
import { isUuid } from '../utils/validation';

// Service-to-service endpoints (X-Internal-Auth, mounted under /internal in server.ts; the gateway answers 404
// for /internal from outside). Stories and groups live here, so the workspace asks.

export interface StoryRole { keeper: boolean; contributor: boolean; removed: boolean; name: string; keeperIds: string[] }

/**
 * A user's place in a story's workspace. keeper: story owner, or leader/mod of the story's group (merges, rewinds);
 * contributor: keeper, any member of that group or a collaborator (drafts, proposals, history).
 * keeperIds: everyone who keeps the story (who to tell about a proposal).
 */
export async function storyRole(user: string, story: string): Promise<StoryRole> {
  const none = { keeper: false, contributor: false, removed: false, name: '', keeperIds: [] };
  if (!isUuid(user) || !isUuid(story)) return none;
  const r = await pool.query(`
    SELECT s.uploader_id = $1 AS owner,
           s.approval_status = 'rejected' AS removed,
           (SELECT role FROM group_members WHERE group_id = s.group_id AND user_id = $1) AS group_role,
           EXISTS (SELECT 1 FROM story_collaborators WHERE story_id = s.id AND user_id = $1) AS collaborator,
           (SELECT COALESCE(display_name, username) FROM users WHERE id = $1) AS name,
           ARRAY(SELECT s.uploader_id UNION SELECT user_id FROM group_members WHERE group_id = s.group_id AND role IN ('leader', 'mod'))::text[] AS keepers
    FROM stories s WHERE s.id = $2`, [user, story]);
  const row = r.rows[0];
  if (!row) return none;
  const keeper = row.owner || ['leader', 'mod'].includes(row.group_role);
  return {
    keeper, contributor: keeper || Boolean(row.group_role) || row.collaborator, removed: row.removed, name: row.name || '',
    keeperIds: (row.keepers || []).filter(Boolean),
  };
}

/** GET /internal/permissions?user=&story= -> {keeper, contributor, removed, name} (the workspace caches it 30 s). */
export const permissions = async (req: Request, res: Response) => {
  const { keeper, contributor, removed, name } = await storyRole(String(req.query.user || ''), String(req.query.story || ''));
  res.json({ success: true, data: { keeper, contributor, removed, name } });
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
