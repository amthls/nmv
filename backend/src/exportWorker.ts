import './config/env';
import { pool } from './config/db';
import { queueEnabled, startExportConsumer } from './services/queue.service';
import { cleanupExports, processExport, recoverExports } from './services/export';

/**
 * EPUB/PDF export worker: `node dist/exportWorker.js` (container `export-worker`, same image as the API).
 *
 * Builds are CPU and disk heavy, so they run here and not in the API or the notification worker.
 * EXPORT_CONCURRENCY builds run at once (default 1); every hour old files are deleted.
 */

const CONCURRENCY = Math.max(1, Number(process.env.EXPORT_CONCURRENCY || 1));
let active = 0;
let shuttingDown = false;

async function main() {
  if (!queueEnabled()) {
    console.error('[ExportWorker] RABBITMQ_URL is not set; nothing to consume. Exiting.');
    process.exit(1);
  }

  let consumer: Awaited<ReturnType<typeof startExportConsumer>> | null = null;
  for (let attempt = 1; !consumer; attempt++) {
    try {
      consumer = await startExportConsumer(
        CONCURRENCY,
        async (id) => {
          active++;
          try {
            await processExport(id);
          } finally {
            active--;
          }
        },
        () => {
          if (!shuttingDown) {
            console.error('[ExportWorker] RabbitMQ connection lost, exiting so the container restarts');
            process.exit(1);
          }
        }
      );
    } catch (err: any) {
      console.warn(`[ExportWorker] cannot start consumer (attempt ${attempt}): ${err.message}`);
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
    }
  }
  console.log(`[ExportWorker] consuming novel.exports (concurrency ${CONCURRENCY})`);

  // Jobs a previous run did not finish (container restarted mid-build, message lost)
  for (const id of await recoverExports().catch(() => [] as string[])) consumer.requeue(id);

  const cleanup = () => cleanupExports().catch((e) => console.error('[ExportWorker] cleanup failed:', e.message));
  void cleanup();
  setInterval(cleanup, 60 * 60_000).unref();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ExportWorker] ${signal}: finishing the current build...`);
    // Give a running build a few seconds (Docker waits 10s); anything cut short is requeued on restart
    for (let waited = 0; active > 0 && waited < 8000; waited += 200) await new Promise((r) => setTimeout(r, 200));
    await consumer?.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (r) => console.error('[ExportWorker] unhandled rejection:', r));
main().catch((err) => {
  console.error('[ExportWorker] fatal:', err);
  process.exit(1);
});
