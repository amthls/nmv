import 'reflect-metadata';
import './config/env';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { WorkerService } from './worker/worker.service';

/** Background worker: `node dist/worker.js` (its own container in docker-compose, same image as the API). */
async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  const worker = app.get(WorkerService);
  await worker.start();
  process.on('SIGTERM', () => void worker.shutdown('SIGTERM'));
  process.on('SIGINT', () => void worker.shutdown('SIGINT'));
}

process.on('unhandledRejection', (r) => console.error('[Worker] unhandled rejection:', r));
main().catch((err) => {
  console.error('[Worker] fatal:', err);
  process.exit(1);
});
