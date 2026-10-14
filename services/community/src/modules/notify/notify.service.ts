import amqp from 'amqplib';
import crypto from 'crypto';
import { MESSAGING_KEY, MESSAGING_URL, RABBITMQ_URL, pool } from './config';
import { internalHeader } from './auth';
import { chapters, stories } from './backend';
import { currentRequestId } from './logger';

/**
 * Notifications about posts and comments. Built here (who gets what), delivered by the messaging service: jobs go on
 * the novel.notifications queue like the backend's (services/messaging/notify.go registers the types). RabbitMQ
 * down: the job is posted straight to messaging. Post mutes ("Tắt thông báo bài viết này") are applied here.
 */

export interface NotifyItem {
  userId: string;
  type: 'comment_reply' | 'post_comment' | 'post_reaction' | 'post_removed' | 'post_restored';
  title: string;
  message: string | null;
  referenceType: 'chapter' | 'post' | 'story';
  referenceId: string;
  senderId: string | null;
  actorName?: string;
  dedupeKey: string;
  link?: string | null;
  image?: string | null;
}

const QUEUE = 'novel.notifications';
const RETRY_QUEUE = 'novel.notifications.retry';
const DLQ = 'novel.notifications.dlq';

let channel: any = null;
let connecting = false;

/** Connect in the background and keep reconnecting (the same topology the backend and messaging declare). */
export function connectQueue(): void {
  if (!RABBITMQ_URL || connecting) return;
  connecting = true;
  (async () => {
    for (let delay = 1000; ; delay = Math.min(delay * 2, 30_000)) {
      try {
        const conn: any = await amqp.connect(`${RABBITMQ_URL}${RABBITMQ_URL.includes('?') ? '&' : '?'}heartbeat=30`);
        conn.on('error', (e: Error) => console.error('[queue] connection error:', e.message));
        conn.on('close', () => {
          channel = null;
          connecting = false;
          setTimeout(connectQueue, 2000).unref();
        });
        const ch = await conn.createConfirmChannel();
        await ch.assertQueue(DLQ, { durable: true });
        await ch.assertQueue(RETRY_QUEUE, {
          durable: true,
          arguments: { 'x-message-ttl': 10_000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': QUEUE },
        });
        await ch.assertQueue(QUEUE, { durable: true });
        channel = ch;
        console.log('[queue] connected to RabbitMQ');
        return;
      } catch (err: any) {
        console.warn(`[queue] RabbitMQ unavailable (${err.message}); retrying in ${Math.round(delay / 1000)}s`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  })();
}

/** Where a click goes and the cover to show: a snapshot taken now. */
async function attachLinks(items: NotifyItem[]) {
  const postIds = items.filter((it) => it.referenceType === 'post').map((it) => it.referenceId);
  const chapterIds = items.filter((it) => it.referenceType === 'chapter').map((it) => it.referenceId);
  const [posts, chs] = await Promise.all([
    postIds.length ? pool.query(`SELECT id, slug FROM posts WHERE id = ANY($1::uuid[])`, [postIds]) : Promise.resolve({ rows: [] as any[] }),
    chapters(chapterIds),
  ]);
  const sts = await stories([...items.filter((it) => it.referenceType === 'story').map((it) => it.referenceId), ...[...chs.values()].map((c) => c.story_id)]);
  const postSlug = new Map(posts.rows.map((p: any) => [p.id, p.slug]));
  for (const it of items) {
    if (it.referenceType === 'post') it.link = postSlug.has(it.referenceId) ? `/fandom/${postSlug.get(it.referenceId)}` : null;
    const ch = it.referenceType === 'chapter' ? chs.get(it.referenceId) : undefined;
    const st = it.referenceType === 'story' ? sts.get(it.referenceId) : ch ? sts.get(ch.story_id) : undefined;
    if (st) {
      it.link = ch ? `/truyen/${st.slug}/${ch.slug}` : `/truyen/${st.slug}`;
      it.image = st.cover_image_url;
    }
  }
}

/** Drop what people muted about one post; a take-down of your own post still arrives. */
async function dropMuted(items: NotifyItem[]): Promise<NotifyItem[]> {
  const about = items.filter((it) => it.referenceType === 'post' && it.type !== 'post_removed' && it.type !== 'post_restored');
  if (about.length === 0) return items;
  const r = await pool.query(
    `SELECT user_id || ':' || post_id AS k FROM post_notification_mutes WHERE user_id = ANY($1::uuid[]) AND post_id = ANY($2::uuid[])`,
    [about.map((it) => it.userId), about.map((it) => it.referenceId)]
  );
  const muted = new Set(r.rows.map((row: any) => row.k));
  return items.filter((it) => !about.includes(it) || !muted.has(`${it.userId}:${it.referenceId}`));
}

/** Queue the items. Never throws: a notification must not fail the request that caused it. */
export async function notify(input: NotifyItem[]): Promise<void> {
  try {
    const items = await dropMuted(input);
    if (items.length === 0) return;
    await attachLinks(items).catch((err) => console.warn('[notify] could not attach links:', err.message));
    const job = { kind: 'notify', items };
    if (channel) {
      try {
        const body = Buffer.from(JSON.stringify({ id: crypto.randomUUID(), attempts: 0, job }));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('publish confirm timeout')), 2500);
          channel.sendToQueue(QUEUE, body, { persistent: true, contentType: 'application/json' }, (err: Error | null) => {
            clearTimeout(timer);
            err ? reject(err) : resolve();
          });
        });
        return;
      } catch (err: any) {
        console.warn('[notify] publish failed, sending to messaging directly:', err.message);
      }
    }
    const res = await fetch(`${MESSAGING_URL}/internal/notifications/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalHeader(MESSAGING_KEY),
        ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`messaging HTTP ${res.status}`);
  } catch (err: any) {
    console.error(`[notify] ${input.length} notification(s) lost: ${err.message}`);
  }
}

// ---- who gets what (moved from the backend's notification.service.ts) ---------------------------------------------

const snippet = (text: string, n = 80) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function commentNotifications(input: {
  commentId: string; actorId: string; actorName: string; content: string; targetType: 'chapter' | 'post' | 'story'; targetId: string;
  postOwnerId?: string | null; postTitle?: string | null; parentAuthorId?: string | null;
}): NotifyItem[] {
  const items: NotifyItem[] = [];
  const seen = new Set<string>([input.actorId]); // never notify yourself, never twice
  const ref = { referenceType: input.targetType, referenceId: input.targetId, senderId: input.actorId, actorName: input.actorName };
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
    referenceType: 'post', referenceId: input.postId, senderId: input.actorId, actorName: input.actorName,
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
      userId: p.user_id, type: approved ? 'post_restored' as const : 'post_removed' as const,
      title: approved ? 'Bài viết của bạn đã được khôi phục' : 'Bài viết của bạn đã bị Ban quản trị gỡ',
      message: `"${snippet(p.title, 100)}"${!approved && reason ? ` · Lý do: ${snippet(reason, 200)}` : ''}`,
      referenceType: 'post' as const, referenceId: p.id, senderId: moderatorId,
      dedupeKey: `post-review:${p.id}:${approved ? 'approved' : 'rejected'}:${at}`,
    }));
}
