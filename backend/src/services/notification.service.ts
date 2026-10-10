import { pool } from '../config/db';
import { emitToUsers } from './realtime';

/**
 * Notification writes. Called by the queue worker (normal path) and, when RabbitMQ is unreachable,
 * directly by the API (fallback), so both paths behave identically.
 *
 * Every row carries a `dedupe_key` with a unique index: re-delivered queue messages, retries and
 * re-approved chapters can never create the same notification twice.
 */

export interface NotifyItem {
  userId: string;
  type: 'system' | 'chapter_update' | 'comment_reply' | 'post_reaction' | 'post_comment' | 'group_join_request' | 'group_member_add';
  title: string;
  message: string | null;
  // draft: a workspace proposal (/ws/de-xuat/:id); draft_edit: a draft to open in the editor (/dang-chuong?draft=:id)
  referenceType: 'chapter' | 'post' | 'story' | 'group' | 'draft' | 'draft_edit' | null;
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

/** Anything about a translation group (join requests, decisions, approval) is a "group event". */
const isGroupEvent = (it: NotifyItem) => it.type.startsWith('group_') || it.referenceType === 'group';

/** The user_settings switch that controls a kind of notification (null = always delivered). */
function settingFor(it: NotifyItem): string | null {
  if (isGroupEvent(it)) return 'notify_group_events';
  if (it.type === 'comment_reply') return 'notify_comments';
  if (it.type === 'post_comment') return 'notify_post_comments';
  if (it.type === 'post_reaction') return 'notify_post_reactions';
  return null;
}

/**
 * Drop what recipients asked not to get: kinds they switched off in their settings, and anything
 * about a post they muted ("Tắt thông báo bài viết này").
 */
async function dropMuted(items: NotifyItem[]): Promise<NotifyItem[]> {
  const userIds = [...new Set(items.map((it) => it.userId))];
  if (userIds.length === 0) return items;
  const postIds = [...new Set(items.filter((it) => it.referenceType === 'post' && it.referenceId).map((it) => it.referenceId!))];
  const [settings, mutes] = await Promise.all([
    pool.query(
      `SELECT user_id, notify_group_events, notify_comments, notify_post_comments, notify_post_reactions
       FROM user_settings WHERE user_id = ANY($1::uuid[])`, [userIds]),
    postIds.length
      ? pool.query(`SELECT user_id, post_id FROM post_notification_mutes WHERE user_id = ANY($1::uuid[]) AND post_id = ANY($2::uuid[])`, [userIds, postIds])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  const byUser = new Map(settings.rows.map((r: any) => [r.user_id, r]));
  const muted = new Set(mutes.rows.map((r: any) => `${r.user_id}:${r.post_id}`));
  return items.filter((it) => {
    const key = settingFor(it);
    if (key && byUser.get(it.userId)?.[key] === false) return false;
    // review results (approved / hidden) about your own post always get through
    if (it.referenceType === 'post' && it.type !== 'system' && muted.has(`${it.userId}:${it.referenceId}`)) return false;
    return true;
  });
}

/** One multi-row INSERT for any number of single notifications. Returns how many were new. */
export async function insertNotifications(allItems: NotifyItem[]): Promise<number> {
  const items = await dropMuted(allItems);
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
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING user_id`,
    values
  );
  emitToUsers(res.rows.map((r: any) => r.user_id), 'notification');
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
         RETURNING user_id
       )
       SELECT (SELECT user_id FROM batch ORDER BY user_id DESC LIMIT 1) AS last_id,
              (SELECT count(*)::int FROM batch) AS batch_size,
              (SELECT count(*)::int FROM ins) AS inserted,
              (SELECT array_agg(user_id) FROM ins) AS user_ids`,
      [job.storyId, lastUserId, job.uploaderId, FANOUT_CHUNK, job.chapterTitle, job.chapterId]
    );
    const row = res.rows[0];
    created += row.inserted;
    emitToUsers(row.user_ids || [], 'notification');
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

export function postReviewNotifications(
  posts: { id: string; user_id: string; title: string }[], approved: boolean, moderatorId: string, reason?: string | null,
): NotifyItem[] {
  const at = Date.now(); // a post can be taken down again after a restore: each action is its own notification
  return posts
    .filter((p) => p.user_id && p.user_id !== moderatorId)
    .map((p) => ({
      userId: p.user_id, type: 'system' as const,
      title: approved ? 'Bài viết của bạn đã được khôi phục' : 'Bài viết của bạn đã bị Ban quản trị gỡ',
      message: `"${snippet(p.title, 100)}"${!approved && reason ? ` · Lý do: ${snippet(reason, 200)}` : ''}`,
      referenceType: 'post' as const, referenceId: p.id, senderId: moderatorId,
      dedupeKey: `post-review:${p.id}:${approved ? 'approved' : 'rejected'}:${at}`,
    }));
}

/** Tell every leader/mod of a group that someone asked to join. */
export function groupJoinRequestNotifications(input: {
  requestId: string; groupId: string; groupName: string; managerIds: string[]; requesterId: string; requesterName: string; message: string | null;
}): NotifyItem[] {
  return input.managerIds
    .filter((id) => id !== input.requesterId)
    .map((managerId) => ({
      userId: managerId, type: 'group_join_request' as const,
      title: `${input.requesterName} muốn gia nhập nhóm ${input.groupName}`,
      message: input.message ? `"${snippet(input.message, 120)}"` : null,
      referenceType: 'group' as const, referenceId: input.groupId, senderId: input.requesterId,
      dedupeKey: `group-join:${input.requestId}:${managerId}`,
    }));
}

/** Tell the requester the leader's decision. */
export function groupJoinDecisionNotification(input: {
  requestId: string; groupId: string; groupName: string; requesterId: string; reviewerId: string; approved: boolean;
}): NotifyItem[] {
  return [{
    userId: input.requesterId,
    type: input.approved ? 'group_member_add' : 'system',
    title: input.approved
      ? `Bạn đã được duyệt vào nhóm ${input.groupName}`
      : `Yêu cầu gia nhập nhóm ${input.groupName} không được chấp nhận`,
    message: null,
    referenceType: 'group', referenceId: input.groupId, senderId: input.reviewerId,
    dedupeKey: `group-join-decision:${input.requestId}`,
  }];
}

/**
 * Workspace proposals (Plan/chapter-workspace.md, stage 3): a submitted draft goes to the story keepers;
 * a return or a merge goes back to its author. Opens the review page /ws/de-xuat/:draftId.
 */
export function draftNotifications(input: {
  event: 'submitted' | 'returned' | 'merged' | 'offered' | 'transferred'; draftId: string; round: number; recipientIds: string[]; actorId: string;
  actorName: string; chapterLabel: string; storyTitle: string; note?: string | null;
}): NotifyItem[] {
  const title = {
    submitted: `${input.actorName} gửi đề xuất ${input.chapterLabel} (${input.storyTitle})`,
    returned: `Đề xuất ${input.chapterLabel} được trả lại để sửa`,
    merged: `Đề xuất ${input.chapterLabel} đã được gộp vào bản chính`,
    offered: `${input.actorName} gửi lại bản sửa giúp cho nháp ${input.chapterLabel}`,
    transferred: `${input.actorName} giao cho bạn bản nháp ${input.chapterLabel} (${input.storyTitle})`,
  }[input.event];
  return [...new Set(input.recipientIds)]
    .filter((id) => id && id !== input.actorId)
    .map((userId) => ({
      userId, type: 'system' as const, title,
      message: input.note ? `"${snippet(input.note, 160)}"` : input.event === 'submitted' ? 'Mở để xem thay đổi và gộp hoặc trả lại.' : null,
      referenceType: input.event === 'offered' || input.event === 'transferred' ? 'draft_edit' as const : 'draft' as const,
      referenceId: input.draftId, senderId: input.actorId,
      // a proposal round is notified once; offers and hand-overs can repeat
      dedupeKey: `draft:${input.draftId}:${input.event === 'offered' || input.event === 'transferred' ? Date.now() : input.round}:${input.event}:${userId}`,
    }));
}
