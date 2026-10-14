import { Injectable } from '@nestjs/common';
import { pool } from '../config/db';
import { connectQueue, closeQueue } from '../infra/queue/queue.service';
import { flushViews } from '../modules/chapters/view-counter';
import { startIdentityConsumer } from '../modules/users/identity-sync.job';
import { startWorkspaceConsumer } from '../modules/chapters/workspace-sync.job';
import { scheduleReconcile } from '../modules/system/reconcile.job';
import { scheduleHotShelf } from '../modules/stories/hot-shelf.job';
import { scheduleRemovedPurge } from '../modules/stories/story-purge.job';

/**
 * The worker's jobs, started once by worker.ts:
 * - identity.* / workspace.* events -> the users/user_roles copy, the chapters reading copy, admin alerts.
 * - Buffered views (Redis) -> Postgres, the 6-hourly reconcile job, the hot shelf, the 60-day purge.
 * Notifications it raises go to the queue like the API's; the messaging service delivers them (Plan/messaging.md, E3).
 */
@Injectable()
export class WorkerService {
  private shuttingDown = false;
  private readonly eventConsumers: { close: () => Promise<void> }[] = [];

  private flushViewCounts = () => flushViews().catch((err) => console.error('[Worker] view flush failed:', err.message));

  async start() {
    connectQueue();

    // Other services' events: identity.* -> users/user_roles copy + admin alerts, workspace.* -> chapters reading copy
    const lost = (what: string) => () => {
      if (!this.shuttingDown) {
        console.error(`[Worker] ${what} event connection lost, exiting so the container restarts`);
        process.exit(1);
      }
    };
    for (const [name, start] of [['identity', startIdentityConsumer], ['workspace', startWorkspaceConsumer]] as const) {
      for (let attempt = 1; ; attempt++) {
        try {
          this.eventConsumers.push(await start(lost(name)));
          break;
        } catch (err: any) {
          console.warn(`[Worker] cannot start ${name} consumer (attempt ${attempt}): ${err.message}`);
          await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
        }
      }
    }

    // Copies of identity/workspace data and the event pipeline checked every 6 hours (admin notification if off)
    scheduleReconcile();
    // "Đang hot" shelf precomputed into Redis every 2 minutes
    scheduleHotShelf();
    // Stories taken down by Admin/Mod and not restored within 60 days are deleted for good
    scheduleRemovedPurge();

    console.log('[Worker] running');

    // Buffered chapter/story views (Redis) -> Postgres, once a minute
    setInterval(this.flushViewCounts, Number(process.env.VIEW_FLUSH_MS || 60_000)).unref();
  }

  async shutdown(signal: string) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log(`[Worker] ${signal}: draining...`);
    for (const c of this.eventConsumers) await c.close();
    await this.flushViewCounts();
    await closeQueue();
    await pool.end().catch(() => {});
    process.exit(0);
  }
}
