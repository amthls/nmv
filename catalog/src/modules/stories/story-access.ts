import type { Response } from 'express';
import { pool } from '../../config/db';
import { internalAuthHeader } from '../../middlewares/auth.middleware';
import { clientDbError } from '../../utils/dbErrors';
import { InputError, isUuid } from '../../utils/validation';
import type { StoryInput } from './dto/story-input';

// Plain functions (not Nest providers): the legacy chapter/draft code and the workspace sync use them too.

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

/**
 * Check if a user is authorized to manage (edit, add chapters) a story: the story uploader,
 * a member of the assigned translation group, or an assigned collaborator.
 * Site admin/mod are not included: they only delete content (see deleteStory / deleteChapter).
 */
export async function canUserManageStory(userId: string, storyId: string): Promise<boolean> {
  if (!isUuid(storyId)) return false;
  const storyRes = await pool.query(`SELECT id, uploader_id, group_id FROM stories WHERE id = $1`, [storyId]);
  if (storyRes.rows.length === 0) return false;
  const story = storyRes.rows[0];

  if (story.uploader_id === userId) return true;

  if (story.group_id) {
    const memRes = await pool.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [story.group_id, userId]
    );
    if (memRes.rows.length > 0) return true;
  }

  const collabRes = await pool.query(
    `SELECT 1 FROM story_collaborators WHERE story_id = $1 AND user_id = $2`,
    [storyId, userId]
  );
  if (collabRes.rows.length > 0) return true;

  return false;
}

/**
 * Someone with a published story becomes an author (own story) or a translator (group story). Roles are the
 * identity service's (user_roles here is a copy): ask it, the copy follows through identity.user.updated.
 * shortcut: fire-and-forget (a story rolled back afterwards still leaves the badge; identity down = no badge, logged);
 * move to the outbox when stories become the catalog service.
 */
export async function grantPublisherRole(_db: Queryable, userId: string, groupId: string | null) {
  fetch(`${IDENTITY_URL}/internal/users/${userId}/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': internalAuthHeader('identity') },
    body: JSON.stringify({ role: groupId ? 'translator' : 'author' }),
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => { if (!r.ok) console.warn(`[roles] identity refused the ${groupId ? 'translator' : 'author'} badge: ${r.status}`); })
    .catch((err) => console.warn(`[roles] could not reach identity for a badge: ${err.message}`));
}

const IDENTITY_URL = (process.env.IDENTITY_INTERNAL_URL || 'http://identity:8080').replace(/\/+$/, '');

/** Checks that the tags exist and that the user may publish under the chosen group. */
export async function checkStoryReferences(db: { query: (text: string, params?: any[]) => Promise<any> }, input: StoryInput, userId: string) {
  if (input.tags && input.tags.length > 0) {
    const tagRes = await db.query(`SELECT count(*)::int AS n FROM tags WHERE id = ANY($1::uuid[])`, [input.tags]);
    if (tagRes.rows[0].n !== input.tags.length) throw new InputError('Có thẻ tag không tồn tại.');
  }
  if (input.group_id) {
    const groupRes = await db.query(`SELECT 1 FROM translation_groups WHERE id = $1`, [input.group_id]);
    if (groupRes.rows.length === 0) throw new InputError('Nhóm dịch không tồn tại.', 404);
    const memRes = await db.query(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [input.group_id, userId]);
    if (memRes.rows.length === 0) throw new InputError('Bạn không phải thành viên của nhóm dịch này nên không thể đăng truyện dưới tên nhóm.', 403);
  }
}

/** Sends the right status for an InputError or a client-caused DB error; returns false otherwise. */
export function sendClientError(res: Response, error: any): boolean {
  if (error instanceof InputError) {
    res.status(error.status).json({ success: false, message: error.message });
    return true;
  }
  const dbErr = clientDbError(error);
  if (dbErr) {
    res.status(dbErr.status).json({ success: false, message: dbErr.message });
    return true;
  }
  return false;
}

/** Runs `fn`; a client-caused DB error (bad uuid, too long text, unique/foreign key violation) becomes the same 4xx InputError sendClientError answers. */
export async function clientErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const dbErr = error instanceof InputError ? null : clientDbError(error);
    if (dbErr) throw new InputError(dbErr.message, dbErr.status);
    throw error;
  }
}

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
