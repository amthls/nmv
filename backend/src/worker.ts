import './config/env';
import { pool } from './config/db';
import { startConsumer, retryOrDeadLetter, DLQ, Envelope, queueEnabled } from './services/queue.service';
import { insertNotifications, processNotificationJob, NotifyItem } from './services/notification.service';
import { scheduleRecommender } from './services/recommender/train';
import { flushViews } from './services/viewCounter';
import { startIdentityConsumer } from './services/identitySync';
import { startWorkspaceConsumer } from './services/workspaceSync';

/**
 * Queue worker: `node dist/worker.js` (its own container in docker-compose, same image as the API).
 *
 * - `notify` jobs (single comments/reactions/reviews) are micro-batched: everything that arrives
 *   within FLUSH_MS (or BATCH_MAX messages) becomes ONE multi-row INSERT, however busy the site is.
 * - `chapter_published` jobs fan out to followers in chunks, at most MAX_HEAVY at a time.
 * - Failures go to a retry queue, then to the dead-letter queue after MAX_ATTEMPTS.
 * - Messages are acked only after the database write, so a crash re-delivers them (writes are idempotent).
 */

const PREFETCH = Number(process.env.WORKER_PREFETCH || 50);
const BATCH_MAX = Number(process.env.WORKER_BATCH_MAX || 100);
const FLUSH_MS = Number(process.env.WORKER_FLUSH_MS || 200);
const MAX_HEAVY = Number(process.env.WORKER_MAX_HEAVY || 2);

type Pending = { ch: any; msg: any; env: Envelope };

let buffer: Pending[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let heavyActive = 0;
const heavyWaiting: Array<() => void> = [];
const stats = { notify: 0, chapters: 0, inserted: 0, failed: 0 };
let shuttingDown = false;

function fail(p: Pending, err: any) {
  stats.failed += 1;
  retryOrDeadLetter(p.ch, p.env, err?.message || String(err));
  p.ch.ack(p.msg);
}

async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const batch = buffer;
  buffer = [];
  if (batch.length === 0) return;
  const items: NotifyItem[] = batch.flatMap((p) => (p.env.job.kind === 'notify' ? p.env.job.items : []));
  try {
    stats.inserted += await insertNotifications(items);
    stats.notify += batch.length;
    batch.forEach((p) => p.ch.ack(p.msg));
  } catch (err: any) {
    // One bad message must not sink the others: retry the batch message by message
    console.warn(`[Worker] batch insert failed (${err.message}); falling back to one by one`);
    for (const p of batch) {
      try {
        stats.inserted += await insertNotifications(p.env.job.kind === 'notify' ? p.env.job.items : []);
        stats.notify += 1;
        p.ch.ack(p.msg);
      } catch (e: any) {
        fail(p, e);
      }
    }
  }
}

async function runHeavy(p: Pending) {
  if (heavyActive >= MAX_HEAVY) await new Promise<void>((r) => heavyWaiting.push(r));
  heavyActive += 1;
  try {
    const started = Date.now();
    const created = await processNotificationJob(p.env.job);
    stats.chapters += 1;
    stats.inserted += created;
    console.log(`[Worker] ${p.env.job.kind} ${p.env.id}: ${created} notifications in ${Date.now() - started}ms`);
    p.ch.ack(p.msg);
  } catch (err: any) {
    fail(p, err);
  } finally {
    heavyActive -= 1;
    heavyWaiting.shift()?.();
  }
}

async function main() {
  if (!queueEnabled()) {
    console.error('[Worker] RABBITMQ_URL is not set; nothing to consume. Exiting.');
    process.exit(1);
  }

  let consumer: { close: () => Promise<void> } | null = null;
  // Retry the initial connection: RabbitMQ may still be starting when this container comes up
  for (let attempt = 1; !consumer; attempt++) {
    try {
      consumer = await startConsumer(
        PREFETCH,
        (ch, msg, env) => {
          if (!env || !env.job) {
            // Unparseable: keep it for inspection instead of retrying forever
            ch.sendToQueue(DLQ, msg.content, { persistent: true });
            ch.ack(msg);
            return;
          }
          const pending = { ch, msg, env };
          if (env.job.kind === 'notify') {
            buffer.push(pending);
            if (buffer.length >= BATCH_MAX) void flush();
            else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_MS);
          } else {
            void runHeavy(pending);
          }
        },
        () => {
          if (!shuttingDown) {
            console.error('[Worker] RabbitMQ connection lost, exiting so the container restarts');
            process.exit(1);
          }
        }
      );
    } catch (err: any) {
      console.warn(`[Worker] cannot start consumer (attempt ${attempt}): ${err.message}`);
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
    }
  }
  // Other services' events: identity.* -> users/user_roles copy + admin alerts, workspace.* -> chapters reading copy
  const eventConsumers: { close: () => Promise<void> }[] = [];
  const lost = (what: string) => () => {
    if (!shuttingDown) {
      console.error(`[Worker] ${what} event connection lost, exiting so the container restarts`);
      process.exit(1);
    }
  };
  for (const [name, start] of [['identity', startIdentityConsumer], ['workspace', startWorkspaceConsumer]] as const) {
    for (let attempt = 1; ; attempt++) {
      try {
        eventConsumers.push(await start(lost(name)));
        break;
      } catch (err: any) {
        console.warn(`[Worker] cannot start ${name} consumer (attempt ${attempt}): ${err.message}`);
        await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
      }
    }
  }

  // Recommendation models: retrained on a timer in this process, not in the API
  if (process.env.REC_TRAINING !== 'off') scheduleRecommender();

  console.log(`[Worker] consuming (prefetch ${PREFETCH}, batch ${BATCH_MAX}/${FLUSH_MS}ms, heavy ${MAX_HEAVY})`);

  // Buffered chapter/story views (Redis) -> Postgres, once a minute
  const flushViewCounts = () => flushViews().catch((err) => console.error('[Worker] view flush failed:', err.message));
  setInterval(flushViewCounts, Number(process.env.VIEW_FLUSH_MS || 60_000)).unref();

  setInterval(() => {
    if (stats.notify || stats.chapters || stats.failed) {
      console.log(`[Worker] stats: notify msgs ${stats.notify}, chapter jobs ${stats.chapters}, rows inserted ${stats.inserted}, failures ${stats.failed}`);
    }
  }, 60_000).unref();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] ${signal}: draining...`);
    await consumer?.close();
    for (const c of eventConsumers) await c.close();
    await flush();
    await flushViewCounts();
    while (heavyActive > 0) await new Promise((r) => setTimeout(r, 200));
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (r) => console.error('[Worker] unhandled rejection:', r));
main().catch((err) => {
  console.error('[Worker] fatal:', err);
  process.exit(1);
});
