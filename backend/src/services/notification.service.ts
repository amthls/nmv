import { pool } from '../config/db';

/**
 * Notification writes. Called by the queue worker (normal path) and, when RabbitMQ is unreachable,
 * directly by the API (fallback), so both paths behave identically.
 *
 * Every row carries a `dedupe_key` with a unique index: re-delivered queue messages, retries and
 * re-approved chapters can never create the same notification twice.
 */

export interface NotifyItem {
  userId: string;
  type: 'system' | 'chapter_update' | 'comment_reply' | 'post_reaction' | 'post_comment';
  title: string;
  message: string | null;
  referenceType: 'chapter' | 'post' | 'story' | null;
  referenceId: string | null;
  senderId: string | null;
  dedupeKey: string;
}

export interface ChapterPublishedJob {
  kind: 'chapter_published';
  storyId: string;
  chapterId: string;
  chapterTitle: string;
  uploaderId: string | null;
}

export interface NotifyJob {
  kind: 'notify';
  items: NotifyItem[];
}

export type NotificationJob = ChapterPublishedJob | NotifyJob;

const FANOUT_CHUNK = Number(process.env.NOTIFY_FANOUT_CHUNK || 1000);
const FANOUT_PAUSE_MS = Number(process.env.NOTIFY_FANOUT_PAUSE_MS || 25);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One multi-row INSERT for any number of single notifications. Returns how many were new. */
export async function insertNotifications(items: NotifyItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const cols = 8;
  const values: any[] = [];
  const tuples = items.map((it, i) => {
    values.push(it.userId, it.type, it.title.slice(0, 300), it.message, it.referenceType, it.referenceId, it.senderId, it.dedupeKey);
    const b = i * cols;
    return `($${b + 1}::uuid, $${b + 2}::notification_type, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::uuid, $${b + 7}::uuid, false, $${b + 8})`;
  });
  const res = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, sender_id, is_read, dedupe_key)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    values
  );
  return res.rowCount || 0;
}

/**
 * Notify every follower of a story about a new chapter, in keyset-paginated chunks so a story with
 * a huge following never becomes one giant statement/transaction, with a short pause between chunks
 * so live traffic keeps its share of the database.
 */
export async function fanOutChapterNotifications(job: ChapterPublishedJob): Promise<number> {
  let lastUserId = '00000000-0000-0000-0000-000000000000';
  let created = 0;
  for (;;) {
    const res = await pool.query(
      `WITH batch AS (
         SELECT uf.user_id
         FROM user_favorites uf
         LEFT JOIN user_settings us ON us.user_id = uf.user_id
         WHERE uf.story_id = $1::uuid
           AND uf.user_id > $2::uuid
           AND uf.user_id IS DISTINCT FROM $3::uuid
           AND (uf.notify_updates IS NOT FALSE)
           AND COALESCE(us.notify_chapter_update, TRUE)
         ORDER BY uf.user_id
         LIMIT $4
       ), ins AS (
         INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id, sender_id, is_read, dedupe_key)
         SELECT b.user_id, 'chapter_update'::notification_type,
                left('Chương mới: ' || s.title, 300),
                'Bộ truyện "' || s.title || '" vừa có chương mới: ' || $5,
                'chapter', $6::uuid, $3::uuid, false,
                'chapter:' || $6::text || ':' || b.user_id::text
         FROM batch b CROSS JOIN stories s WHERE s.id = $1::uuid
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING 1
       )
       SELECT (SELECT user_id FROM batch ORDER BY user_id DESC LIMIT 1) AS last_id,
              (SELECT count(*)::int FROM batch) AS batch_size,
              (SELECT count(*)::int FROM ins) AS inserted`,
      [job.storyId, lastUserId, job.uploaderId, FANOUT_CHUNK, job.chapterTitle, job.chapterId]
    );
    const row = res.rows[0];
    created += row.inserted;
    if (!row.last_id || row.batch_size < FANOUT_CHUNK) break;
    lastUserId = row.last_id;
    await sleep(FANOUT_PAUSE_MS);
  }
  return created;
}

/** Run one job to completion (shared by worker and API fallback). */
export async function processNotificationJob(job: NotificationJob): Promise<number> {
  if (job.kind === 'chapter_published') return fanOutChapterNotifications(job);
  if (job.kind === 'notify') return insertNotifications(job.items);
  throw new Error(`Unknown notification job kind: ${(job as any)?.kind}`);
}

// ---------------------------------------------------------------------------
// Builders used by controllers: describe *what happened*; delivery is the queue's business.
// ---------------------------------------------------------------------------

const snippet = (text: string, n = 80) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function commentNotifications(input: {
  commentId: string;
  actorId: string;
  actorName: string;
  content: string;
  targetType: 'chapter' | 'post' | 'story';
  targetId: string;
  postOwnerId?: string | null;
  postTitle?: string | null;
  parentAuthorId?: string | null;
}): NotifyItem[] {
  const items: NotifyItem[] = [];
  const seen = new Set<string>([input.actorId]); // never notify yourself, never twice
  const ref = { referenceType: input.targetType, referenceId: input.targetId, senderId: input.actorId } as const;

  if (input.parentAuthorId && !seen.has(input.parentAuthorId)) {
    seen.add(input.parentAuthorId);
    items.push({
      userId: input.parentAuthorId, type: 'comment_reply', ...ref,
      title: `${input.actorName} đã trả lời bình luận của bạn`,
      message: snippet(input.content),
      dedupeKey: `comment:${input.commentId}:${input.parentAuthorId}`,
    });
  }
  if (input.targetType === 'post' && input.postOwnerId && !seen.has(input.postOwnerId)) {
    seen.add(input.postOwnerId);
    items.push({
      userId: input.postOwnerId, type: 'post_comment', ...ref,
      title: `${input.actorName} đã bình luận bài viết của bạn`,
      message: `${input.postTitle ? `"${snippet(input.postTitle, 60)}": ` : ''}${snippet(input.content)}`,
      dedupeKey: `comment:${input.commentId}:${input.postOwnerId}`,
    });
  }
  return items;
}

export function postReactionNotification(input: {
  postId: string; postTitle: string; postOwnerId: string; actorId: string; actorName: string; reaction: string;
}): NotifyItem[] {
  if (input.postOwnerId === input.actorId) return [];
  return [{
    userId: input.postOwnerId, type: 'post_reaction',
    title: `${input.actorName} đã bày tỏ cảm xúc về bài viết của bạn`,
    message: `"${snippet(input.postTitle, 80)}" (${input.reaction})`,
    referenceType: 'post', referenceId: input.postId, senderId: input.actorId,
    // one notification per person per post, however often they change or toggle the reaction
    dedupeKey: `reaction:${input.postId}:${input.actorId}`,
  }];
}

export function postReviewNotifications(posts: { id: string; user_id: string; title: string }[], approved: boolean, moderatorId: string): NotifyItem[] {
  return posts
    .filter((p) => p.user_id && p.user_id !== moderatorId)
    .map((p) => ({
      userId: p.user_id, type: 'system' as const,
      title: approved ? 'Bài viết của bạn đã được duyệt' : 'Bài viết của bạn không được duyệt',
      message: `"${snippet(p.title, 100)}"`,
      referenceType: 'post' as const, referenceId: p.id, senderId: moderatorId,
      dedupeKey: `post-review:${p.id}:${approved ? 'approved' : 'rejected'}`,
    }));
}
