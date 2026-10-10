import { pool } from '../config/db';
import { internalAuthHeader } from '../middlewares/auth.middleware';
import { currentRequestId } from '../utils/logger';
import { startEventConsumer } from './eventConsumer';
import { insertNotifications } from './notification.service';
import { blocksToPlainText, slugify, notifyChapterPublished, ContentBlock } from '../controllers/chapter.controller';

/**
 * Chapter content lives in the workspace service (every version, Plan/chapter-workspace.md); `chapters` here is the
 * reading copy. Writes go: controller validates + sanitizes -> workspace stores a new version -> the returned
 * revision is applied here at once (the editor is redirected to the chapter right away), and again from the
 * workspace.revision.merged event (a no-op then: ws_chapter_versions already has that version). Rewinds from the
 * workspace UI only arrive as events.
 */

const WORKSPACE_URL = (process.env.WORKSPACE_INTERNAL_URL || 'http://workspace:8080').replace(/\/+$/, '');

export interface Revision {
  chapter_id: string;
  story_id: string;
  version: number;
  deleted: boolean;
  source: 'import' | 'create' | 'edit' | 'rewind' | 'delete' | 'restore';
  meta: { title: string; chapter_number: number; volume_id: string | null; intro_note: string | null; outro_note: string | null };
  blocks: ContentBlock[];
  author_id: string | null;
  created_at: string;
}

/** Call the workspace's internal API. Returns the HTTP status and the parsed body (never throws on 4xx). */
export async function callWorkspace(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${WORKSPACE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalAuthHeader('workspace'),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

type Db = { query: (text: string, params?: any[]) => Promise<any> };

/**
 * Make the reading copy match a revision, if it is newer than what was applied (ws_chapter_versions also remembers
 * deleted chapters, so a late older event can't bring one back). Run inside the caller's transaction.
 */
export async function applyRevision(db: Db, rev: Revision): Promise<{ applied: boolean; inserted: boolean }> {
  const newer = await db.query(
    `INSERT INTO ws_chapter_versions (chapter_id, version) VALUES ($1, $2)
     ON CONFLICT (chapter_id) DO UPDATE SET version = EXCLUDED.version, applied_at = NOW()
     WHERE ws_chapter_versions.version < EXCLUDED.version RETURNING 1`,
    [rev.chapter_id, rev.version]
  );
  if (newer.rowCount === 0) return { applied: false, inserted: false };

  const recount = (extra = '') => db.query(
    `UPDATE stories SET total_chapters = (SELECT count(*) FROM chapters WHERE story_id = $1 AND is_published = true),
       ${extra} updated_at = NOW() WHERE id = $1`, [rev.story_id]);

  if (rev.deleted) {
    // Readers lose the chapter; comments stay so a restore (same id) brings them back. History is in workspace.
    await db.query(`DELETE FROM chapter_pages WHERE chapter_id = $1`, [rev.chapter_id]);
    await db.query(`DELETE FROM reading_history WHERE chapter_id = $1`, [rev.chapter_id]);
    await db.query(`DELETE FROM story_views WHERE chapter_id = $1`, [rev.chapter_id]);
    await db.query(`DELETE FROM chapters WHERE id = $1`, [rev.chapter_id]);
    await recount();
    return { applied: true, inserted: false };
  }

  const story = (await db.query(`SELECT uploader_id, group_id FROM stories WHERE id = $1`, [rev.story_id])).rows[0];
  if (!story) throw new Error(`story ${rev.story_id} of chapter ${rev.chapter_id} not found`);
  const blocks = rev.blocks || [];
  const plain = blocksToPlainText(blocks);
  const m = rev.meta;
  const r = await db.query(`
    INSERT INTO chapters (id, story_id, volume_id, chapter_number, title, slug, content, content_blocks, word_count,
      is_published, approval_status, uploader_id, group_id, translator_notes, intro_note, outro_note, published_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, true, 'approved', $10, $11, $12::jsonb, $13, $14, NOW())
    ON CONFLICT (id) DO UPDATE SET
      volume_id = EXCLUDED.volume_id, chapter_number = EXCLUDED.chapter_number, title = EXCLUDED.title, slug = EXCLUDED.slug,
      content = EXCLUDED.content, content_blocks = EXCLUDED.content_blocks, word_count = EXCLUDED.word_count,
      translator_notes = EXCLUDED.translator_notes, intro_note = EXCLUDED.intro_note, outro_note = EXCLUDED.outro_note,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted`, [
    rev.chapter_id, rev.story_id, m.volume_id || null, m.chapter_number, m.title,
    `chuong-${m.chapter_number}-${slugify(m.title)}`.slice(0, 500), plain, JSON.stringify(blocks),
    plain.split(/\s+/).filter(Boolean).length, rev.author_id || story.uploader_id, story.group_id,
    JSON.stringify(blocks.filter((b) => b.note).map((b) => ({ text: b.text, note: b.note }))),
    m.intro_note || null, m.outro_note || null,
  ]);
  const inserted = Boolean(r.rows[0]?.inserted);

  // Inline illustrations / manga pages are rebuilt from the image blocks
  await db.query(`DELETE FROM chapter_pages WHERE chapter_id = $1`, [rev.chapter_id]);
  const images = blocks.filter((b) => b.image_url);
  for (let i = 0; i < images.length; i++) {
    await db.query(`INSERT INTO chapter_pages (chapter_id, page_number, image_url, width, height) VALUES ($1, $2, $3, $4, $5)`,
      [rev.chapter_id, i + 1, images[i].image_url, images[i].width || null, images[i].height || null]);
  }
  await recount(inserted ? 'last_chapter_at = NOW(),' : '');
  return { applied: true, inserted };
}

/** Apply a revision in its own transaction; notify followers when it created a chapter. */
export async function applyRevisionNow(rev: Revision): Promise<{ applied: boolean; inserted: boolean }> {
  const client = await pool.connect();
  let result = { applied: false, inserted: false };
  try {
    await client.query('BEGIN');
    result = await applyRevision(client, rev);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (result.inserted && rev.source === 'create') {
    notifyChapterPublished({ story_id: rev.story_id, title: rev.meta.title, uploader_id: rev.author_id }, rev.chapter_id);
  }
  return result;
}

const STEP_ROLE: Record<string, string> = { raw: 'raw_provider', translate: 'translator', edit: 'editor', proofread: 'proofreader' };
const STEP_LABEL: Record<string, string> = { raw: 'RAW', translate: 'DỊCH', edit: 'BIÊN TẬP', proofread: 'HIỆU ĐÍNH' };

/**
 * A workspace task opened (Plan/chapter-workspace.md, stage 4b): tell whoever it is assigned to, otherwise everyone in the
 * story's group with that step's role (nobody has it: the leaders/mods); a story without a group: its owner and collaborators.
 */
async function notifyTaskOpened(t: any) {
  let recipients: string[] = t.assignee_id ? [t.assignee_id] : [];
  if (recipients.length === 0) {
    const r = await pool.query(`
      SELECT COALESCE(
        NULLIF(ARRAY(SELECT user_id::text FROM group_members WHERE group_id = s.group_id AND role = $2), '{}'),
        ARRAY(SELECT user_id::text FROM group_members WHERE group_id = s.group_id AND role IN ('leader', 'mod'))
      ) AS by_role,
      ARRAY(SELECT s.uploader_id::text UNION SELECT user_id::text FROM story_collaborators WHERE story_id = s.id) AS team,
      s.group_id
      FROM stories s WHERE s.id = $1`, [t.story_id, STEP_ROLE[t.kind] || 'translator']);
    const row = r.rows[0];
    if (!row) return;
    recipients = row.group_id ? row.by_role : row.team;
  }
  const story = await pool.query(`SELECT title FROM stories WHERE id = $1`, [t.story_id]);
  const items = [...new Set(recipients)].filter((id) => id && id !== t.actor_id).map((userId) => ({
    userId, type: 'system' as const,
    title: `${t.assignee_id ? 'Bạn được giao' : 'Việc mới'}: ${STEP_LABEL[t.kind] || t.kind} chương ${Number(t.chapter_number)} (${story.rows[0]?.title || ''})`,
    message: t.note ? `"${String(t.note).slice(0, 160)}"` : t.due_at ? `Hạn: ${new Date(t.due_at).toLocaleString('vi-VN')}` : null,
    referenceType: 'ws_story' as const, referenceId: t.story_id, senderId: t.actor_id || null,
    dedupeKey: `task:${t.task_id}:${userId}`,
  }));
  if (items.length > 0) await insertNotifications(items);
}

async function handleWorkspaceEvent(evt: any): Promise<string> {
  if (!evt?.event_id || !['workspace.revision.merged', 'workspace.task.opened'].includes(evt.type) || !evt.data) throw new Error('malformed event');
  if (evt.type === 'workspace.task.opened') {
    // notifications carry a dedupe key per task and person: a redelivery inserts nothing twice
    await notifyTaskOpened(evt.data);
    return 'notified';
  }
  if (!evt.data.chapter_id) throw new Error('malformed event');
  const seen = await pool.query(`INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`, [evt.event_id, evt.type]);
  if (seen.rowCount === 0) return 'duplicate';
  try {
    const { applied } = await applyRevisionNow(evt.data);
    return applied ? 'applied' : 'stale';
  } catch (err) {
    await pool.query(`DELETE FROM processed_events WHERE event_id = $1`, [evt.event_id]); // let the retry run it again
    throw err;
  }
}

/** Worker: workspace.revision.merged -> the chapters reading copy; workspace.task.opened -> notifications. */
export const startWorkspaceConsumer = (onClose: () => void) =>
  startEventConsumer({ queue: 'backend.workspace', bindings: ['workspace.revision.merged', 'workspace.task.opened'], label: 'workspace-sync', handle: handleWorkspaceEvent, onClose });
