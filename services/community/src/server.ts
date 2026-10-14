import { IS_PROD, PORT, migrate, pool } from './config';
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { requestContext } from './common/utils/logger';
import { handleIdentityEvent } from './modules/moderation/moderation.service';
import { connectQueue } from './modules/notify/notify.service';
import { startEventConsumer } from './infra/queue/events';
import { importLegacy } from './modules/legacy-import/import-legacy';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppModule } from './app.module';

/**
 * community: Fandom posts, comments (stories, chapters, posts), reactions, reports, removed content. See Plan/community.md.
 *   gateway /api/community/*  -> here without the prefix (same paths and JSON the backend's /api/v1 had)
 *   backend -> /internal/*    (smart codes, profile stats, comments of a deleted story)
 */

for (const k of ['COMMUNITY_DATABASE_URL', 'USER_SIG_KEY_COMMUNITY', 'INTERNAL_KEY_COMMUNITY', 'INTERNAL_KEY_CATALOG', 'INTERNAL_KEY_MESSAGING']) {
  if (IS_PROD && (process.env[k] || '').length < (k === 'COMMUNITY_DATABASE_URL' ? 1 : 32)) throw new Error(`${k} is missing`);
}

async function bootstrap() {
  // Nest on Express with its own body parser off: express.json keeps the 1mb limit, errors answered as before
  const nest = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  const app: express.Express = nest.getHttpAdapter().getInstance();
  app.disable('x-powered-by');
  app.set('trust proxy', false); // only the gateway talks to us; it sends X-Real-IP
  nest.useGlobalFilters(new HttpExceptionFilter());
  app.use(requestContext);
  const json = express.json({ limit: '1mb' }); // post bodies are rich HTML (sanitized, at most 100k characters)
  app.use((req, res, next) => json(req, res, (err?: any) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Nội dung quá lớn.' });
    next(err);
  }));
  return nest;
}

async function main() {
  await migrate();
  const nest = await bootstrap();
  connectQueue();
  // identity.user.deleted (purge_content): hide that account's posts and comments
  const lost = () => {
    console.error('[community] identity event connection lost, exiting so the container restarts');
    process.exit(1);
  };
  if (process.env.RABBITMQ_URL) {
    for (let attempt = 1; ; attempt++) {
      try {
        await startEventConsumer({ queue: 'community.identity', bindings: ['identity.user.deleted'], label: 'identity', handle: handleIdentityEvent, onClose: lost });
        break;
      } catch (err: any) {
        console.warn(`[community] cannot start the identity consumer (attempt ${attempt}): ${err.message}`);
        await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
      }
    }
  }
  await nest.listen(PORT);
  console.log(`community listening on :${PORT}`);
  const server = nest.getHttpServer();
  const shutdown = async (signal: string) => {
    console.log(`[community] ${signal}: stopping`);
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (r) => console.error('[community] unhandled rejection:', r));
if (process.argv[2] === 'healthcheck') {
  fetch(`http://127.0.0.1:${PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1));
} else if (process.argv[2] === 'import-legacy') {
  migrate()
    .then(() => importLegacy(process.env.LEGACY_DATABASE_URL || ''))
    .then(() => pool.end())
    .then(() => process.exit(0), (err) => {
      console.error('[community] import-legacy failed:', err?.stack || err);
      process.exit(1);
    });
} else {
  main().catch((err) => {
    console.error('[community] fatal:', err);
    process.exit(1);
  });
}
