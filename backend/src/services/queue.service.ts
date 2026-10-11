import amqp from 'amqplib';
import crypto from 'crypto';
import { RABBITMQ_URL } from '../config/env';
import { pool } from '../config/db';
import { internalAuthHeader } from '../middlewares/auth.middleware';
import { currentRequestId } from '../utils/logger';
import type { NotificationJob, NotifyItem } from './notification.service';

/**
 * Notification jobs go to the messaging service (Plan/messaging.md, E3):
 *
 *   API/worker  --publish-->  novel.notifications  --consume-->  messaging  -->  messaging_db
 *                                 |  (failure, handled by messaging)
 *                                 +--> novel.notifications.retry (10s TTL) --> back to the main queue
 *                                         after 5 attempts --> novel.notifications.dlq (kept for inspection)
 *
 * If RabbitMQ is not configured or unreachable the request never fails: the job is posted straight to messaging
 * (POST /internal/notifications/jobs) instead.
 */

export const QUEUE = 'novel.notifications';
export const RETRY_QUEUE = 'novel.notifications.retry';
export const DLQ = 'novel.notifications.dlq';
// services/messaging/notify.go declares the retry queue with this exact TTL: change both together
const RETRY_DELAY_MS = 10_000;
const MESSAGING_URL = (process.env.MESSAGING_INTERNAL_URL || 'http://messaging:8080').replace(/\/+$/, '');

export interface Envelope {
  id: string;
  attempts: number;
  job: NotificationJob;
}

// heartbeat detects dead connections (e.g. broker restart) quickly
const brokerUrl = () => `${RABBITMQ_URL}${RABBITMQ_URL.includes('?') ? '&' : '?'}heartbeat=30`;

let connection: any = null;
let publishChannel: any = null;
let connecting = false;
let stopped = false;

export const queueEnabled = () => RABBITMQ_URL.length > 0;
export const queueStatus = (): 'disabled' | 'up' | 'down' => (!queueEnabled() ? 'disabled' : publishChannel ? 'up' : 'down');

async function assertTopology(ch: any) {
  await ch.assertQueue(DLQ, { durable: true });
  await ch.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: { 'x-message-ttl': RETRY_DELAY_MS, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': QUEUE },
  });
  await ch.assertQueue(QUEUE, { durable: true });
}

/** Connect in the background and keep reconnecting; safe to call once at start-up. */
export function connectQueue(): void {
  if (!queueEnabled() || connecting || stopped) return;
  connecting = true;
  (async () => {
    let delay = 1000;
    while (!stopped) {
      try {
        connection = await amqp.connect(brokerUrl());
        connection.on('error', (e: Error) => console.error('[Queue] connection error:', e.message));
        connection.on('close', () => {
          console.warn('[Queue] connection closed');
          publishChannel = null;
          connection = null;
          if (!stopped) {
            connecting = false;
            setTimeout(connectQueue, 2000).unref();
          }
        });
        publishChannel = await connection.createConfirmChannel();
        publishChannel.on('error', (e: Error) => console.error('[Queue] channel error:', e.message));
        await assertTopology(publishChannel);
        console.log('[Queue] connected to RabbitMQ');
        return;
      } catch (err: any) {
        console.warn(`[Queue] RabbitMQ unavailable (${err.message}); retrying in ${Math.round(delay / 1000)}s`);
        publishChannel = null;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  })().finally(() => {
    connecting = false;
  });
}

export async function closeQueue(): Promise<void> {
  stopped = true;
  try { await publishChannel?.close(); } catch {}
  try { await connection?.close(); } catch {}
  publishChannel = null;
  connection = null;
}

// --- what a job carries -----------------------------------------------------------------------------------------

/** Where a click on a notification goes, and the story cover to show: a snapshot taken now. */
async function attachLinks(items: NotifyItem[]) {
  const refs = items.filter((it) => it.referenceType && it.referenceId);
  if (refs.length === 0) return;
  const r = await pool.query(
    `SELECT t.i::int AS i,
       CASE t.rt WHEN 'draft' THEN '/ws/de-xuat/' || t.rid WHEN 'draft_edit' THEN '/dang-chuong?draft=' || t.rid
         WHEN 'ws_story' THEN '/ws/truyen/' || s.slug WHEN 'chapter' THEN '/truyen/' || s.slug || '/' || c.slug
         WHEN 'story' THEN '/truyen/' || s.slug WHEN 'post' THEN '/fandom/' || p.slug WHEN 'group' THEN '/nhom-dich/' || g.slug END AS link,
       s.cover_image_url AS image
     FROM unnest($1::text[], $2::uuid[]) WITH ORDINALITY AS t(rt, rid, i)
     LEFT JOIN chapters c ON t.rt = 'chapter' AND c.id = t.rid
     LEFT JOIN stories s ON s.id = CASE WHEN t.rt = 'chapter' THEN c.story_id WHEN t.rt IN ('story', 'ws_story') THEN t.rid END
     LEFT JOIN posts p ON t.rt = 'post' AND p.id = t.rid
     LEFT JOIN translation_groups g ON t.rt = 'group' AND g.id = t.rid`,
    [refs.map((it) => it.referenceType), refs.map((it) => it.referenceId)]
  );
  for (const row of r.rows) Object.assign(refs[row.i - 1], { link: row.link, image: row.image });
}

/**
 * Drop what people muted about one post ("Tắt thông báo bài viết này"); a take-down of your own post still arrives.
 * shortcut: post mutes stay in this database (the post page reads them); move them when posts go to community (stage F).
 */
async function dropMutedPosts(items: NotifyItem[]): Promise<NotifyItem[]> {
  const about = items.filter((it) => it.referenceType === 'post' && it.referenceId && it.type !== 'post_removed' && it.type !== 'post_restored');
  if (about.length === 0) return items;
  const r = await pool.query(
    `SELECT user_id || ':' || post_id AS k FROM post_notification_mutes WHERE user_id = ANY($1::uuid[]) AND post_id = ANY($2::uuid[])`,
    [about.map((it) => it.userId), about.map((it) => it.referenceId)]
  );
  const muted = new Set(r.rows.map((row: any) => row.k));
  return items.filter((it) => !about.includes(it) || !muted.has(`${it.userId}:${it.referenceId}`));
}

async function prepare(job: NotificationJob): Promise<NotificationJob> {
  if (job.kind === 'notify') {
    const items = await dropMutedPosts(job.items);
    await attachLinks(items);
    return { ...job, items };
  }
  const r = await pool.query(
    `SELECT s.title, s.cover_image_url, '/truyen/' || s.slug || '/' || c.slug AS link
     FROM chapters c JOIN stories s ON s.id = c.story_id WHERE c.id = $1`, [job.chapterId]);
  return { ...job, storyTitle: r.rows[0]?.title || '', link: r.rows[0]?.link || null, image: r.rows[0]?.cover_image_url || null };
}

/** RabbitMQ is down: hand the job to messaging over HTTP (it runs it before answering). */
async function postToMessaging(job: NotificationJob) {
  try {
    const res = await fetch(`${MESSAGING_URL}/internal/notifications/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': internalAuthHeader('messaging'),
        ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err: any) {
    console.error(`[Queue] ${job.kind} lost: broker and messaging both unavailable (${err.message})`);
  }
}

/**
 * Hand a notification job to the queue. Never throws and never blocks the request for long.
 * Returns 'queued' when RabbitMQ accepted (and persisted) it, 'inline' when it went to messaging directly.
 */
export async function enqueueNotificationJob(input: NotificationJob): Promise<'queued' | 'inline'> {
  if (input.kind === 'notify' && input.items.length === 0) return 'queued';
  let job = input;
  try {
    job = await prepare(input);
  } catch (err: any) {
    console.warn('[Queue] could not attach links:', err.message); // still deliver, just without a link
  }
  if (job.kind === 'notify' && job.items.length === 0) return 'queued';
  if (publishChannel) {
    try {
      const envelope: Envelope = { id: crypto.randomUUID(), attempts: 0, job };
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('publish confirm timeout')), 2500);
        publishChannel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(envelope)), { persistent: true, contentType: 'application/json' }, (err: Error | null) => {
          clearTimeout(timer);
          err ? reject(err) : resolve();
        });
      });
      return 'queued';
    } catch (err: any) {
      console.warn('[Queue] publish failed, sending to messaging directly:', err.message);
    }
  }
  void postToMessaging(job);
  return 'inline';
}
