import amqp from 'amqplib';
import crypto from 'crypto';
import { RABBITMQ_URL } from '../config/env';
import type { NotificationJob } from './notification.service';
import { processNotificationJob } from './notification.service';

/**
 * RabbitMQ producer/consumer plumbing for notification work.
 *
 *   API  --publish-->  novel.notifications  --consume-->  worker  -->  PostgreSQL
 *                          |  (failure)
 *                          +--> novel.notifications.retry (10s TTL) --> back to the main queue
 *                                  after MAX_ATTEMPTS --> novel.notifications.dlq (kept for inspection)
 *
 * If RabbitMQ is not configured or unreachable the API never fails the user's request and never
 * loses the notification: the job simply runs in-process (bounded concurrency) instead.
 */

export const QUEUE = 'novel.notifications';
export const RETRY_QUEUE = 'novel.notifications.retry';
export const DLQ = 'novel.notifications.dlq';
export const MAX_ATTEMPTS = Number(process.env.NOTIFY_MAX_ATTEMPTS || 5);
const RETRY_DELAY_MS = Number(process.env.NOTIFY_RETRY_DELAY_MS || 10_000);

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

// --- in-process fallback -----------------------------------------------------------------------

const MAX_INLINE = 2;
let inlineActive = 0;
const inlineWaiting: Array<() => void> = [];
async function runInline(job: NotificationJob) {
  if (inlineActive >= MAX_INLINE) await new Promise<void>((r) => inlineWaiting.push(r));
  inlineActive += 1;
  try {
    const n = await processNotificationJob(job);
    console.log(`[Queue] processed ${job.kind} inline (broker unavailable), ${n} new notifications`);
  } catch (err: any) {
    console.error('[Queue] inline notification job failed:', err.message);
  } finally {
    inlineActive -= 1;
    inlineWaiting.shift()?.();
  }
}

/**
 * Hand a notification job to the queue. Never throws and never blocks the request for long.
 * Returns 'queued' when RabbitMQ accepted (and persisted) it, 'inline' when it fell back.
 */
export async function enqueueNotificationJob(job: NotificationJob): Promise<'queued' | 'inline'> {
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
      console.warn('[Queue] publish failed, running inline instead:', err.message);
    }
  }
  void runInline(job);
  return 'inline';
}

// --- consumer (worker process) -----------------------------------------------------------------

/** Send a failed message to the retry queue, or to the DLQ once it has used up its attempts. */
export function retryOrDeadLetter(ch: any, env: Envelope, reason: string) {
  const next: Envelope = { ...env, attempts: env.attempts + 1 };
  if (next.attempts >= MAX_ATTEMPTS) {
    console.error(`[Queue] job ${env.id} (${env.job.kind}) failed ${next.attempts}x, moving to DLQ: ${reason}`);
    ch.sendToQueue(DLQ, Buffer.from(JSON.stringify({ ...next, lastError: reason })), { persistent: true });
  } else {
    console.warn(`[Queue] job ${env.id} (${env.job.kind}) failed (attempt ${next.attempts}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS / 1000}s: ${reason}`);
    ch.sendToQueue(RETRY_QUEUE, Buffer.from(JSON.stringify(next)), { persistent: true });
  }
}

/** Open a dedicated consumer channel. `handler` receives every message; it must ack/nack. */
export async function startConsumer(
  prefetch: number,
  handler: (ch: any, msg: any, env: Envelope | null) => void,
  onClose: () => void
): Promise<{ close: () => Promise<void> }> {
  if (!queueEnabled()) throw new Error('RABBITMQ_URL is not set');
  const conn: any = await amqp.connect(brokerUrl());
  conn.on('error', (e: Error) => console.error('[Worker] connection error:', e.message));
  conn.on('close', onClose);
  const ch: any = await conn.createChannel();
  await assertTopology(ch);
  await ch.prefetch(prefetch);
  const { consumerTag } = await ch.consume(QUEUE, (msg: any) => {
    if (!msg) return;
    let env: Envelope | null = null;
    try { env = JSON.parse(msg.content.toString()); } catch {}
    handler(ch, msg, env);
  });
  return {
    close: async () => {
      try { await ch.cancel(consumerTag); } catch {}
      try { await ch.close(); } catch {}
      try { await conn.close(); } catch {}
    },
  };
}
