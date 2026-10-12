import './config/env';
import { pool } from './config/db';
import { connectQueue, closeQueue } from './services/queue.service';
import { flushViews } from './services/viewCounter';
import { startIdentityConsumer } from './services/identitySync';
import { startWorkspaceConsumer } from './services/workspaceSync';
import { scheduleReconcile } from './services/reconcile';
import { scheduleHotShelf } from './services/hotShelf';
import { scheduleRemovedPurge } from './services/storyPurge';

/**
 * Background worker: `node dist/worker.js` (its own container in docker-compose, same image as the API).
 *
 * - identity.* / workspace.* events -> the users/user_roles copy, the chapters reading copy, admin alerts.
 * - Buffered views (Redis) -> Postgres, recommendation training, the 6-hourly reconcile job.
 * Notifications it raises go to the queue like the API's; the messaging service delivers them (Plan/messaging.md, E3).
 */

let shuttingDown = false;

async function main() {
  connectQueue();

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

  // Copies of identity/workspace data and the event pipeline checked every 6 hours (admin notification if off)
  scheduleReconcile();
  // "Đang hot" shelf precomputed into Redis every 2 minutes
  scheduleHotShelf();
  // Stories taken down by Admin/Mod and not restored within 60 days are deleted for good
  scheduleRemovedPurge();

  console.log('[Worker] running');

  // Buffered chapter/story views (Redis) -> Postgres, once a minute
  const flushViewCounts = () => flushViews().catch((err) => console.error('[Worker] view flush failed:', err.message));
  setInterval(flushViewCounts, Number(process.env.VIEW_FLUSH_MS || 60_000)).unref();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] ${signal}: draining...`);
    for (const c of eventConsumers) await c.close();
    await flushViewCounts();
    await closeQueue();
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
