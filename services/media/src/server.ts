import { IS_PROD, PORT, UPLOAD_DIR, migrate, pool } from './config';
import 'reflect-metadata';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { requestContext } from './common/utils/logger';
import { imageResizeLimiter } from './common/utils/auth';
import { resizeUploadedImage } from './common/middleware/image-resize';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { cleanupExports, exportLoop, recoverExports } from './modules/exports/builder';
import { AppModule } from './app.module';

/**
 * media: image uploads, resized images (/uploads/...?w=), EPUB/PDF downloads. See Plan/media.md.
 *   gateway /uploads/*    -> here as is (public files, cached by the gateway)
 *   gateway /api/media/*  -> here without the prefix
 * One process serves the API and builds the EPUB/PDF files (EXPORT_CONCURRENCY at a time).
 */

for (const k of ['MEDIA_DATABASE_URL', 'USER_SIG_KEY_MEDIA', 'INTERNAL_KEY_CATALOG']) {
  if (IS_PROD && (process.env[k] || '').length < (k === 'MEDIA_DATABASE_URL' ? 1 : 32)) throw new Error(`${k} is missing`);
}

async function bootstrap() {
  // Nest on Express with its own body parser off: the Express middleware below keeps the old order and limits
  const nest = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  const app: express.Express = nest.getHttpAdapter().getInstance();
  app.disable('x-powered-by');
  app.set('trust proxy', false); // only the gateway talks to us; it sends X-Real-IP
  nest.useGlobalFilters(new HttpExceptionFilter());
  app.use(requestContext);

  // Uploaded images; ?w=<width> serves a resized copy (only that costs CPU, so only that is rate limited)
  app.use('/uploads', (req, res, next) => (req.query.w !== undefined ? imageResizeLimiter(req, res, next) : next()), resizeUploadedImage);
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '5m' }));

  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => json(req, res, (err?: any) => {
    if (!err) return next();
    console.error('[media] request failed:', err?.stack || err);
    res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
  }));
  return nest;
}

let stopping = false;
async function main() {
  await migrate();
  const nest = await bootstrap();
  await recoverExports();
  const loop = exportLoop(() => stopping);
  const cleanup = () => cleanupExports().catch((e) => console.error('[media] export cleanup failed:', e.message));
  void cleanup();
  setInterval(cleanup, 60 * 60_000).unref();

  await nest.listen(PORT);
  console.log(`media listening on :${PORT}`);
  const server = nest.getHttpServer();
  server.requestTimeout = 120_000; // 25MB uploads on a slow line
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[media] ${signal}: finishing...`);
    server.close();
    // a running build gets a few seconds (Docker waits 10); one cut short is marked failed at the next start
    await Promise.race([loop, new Promise((r) => setTimeout(r, 8000))]);
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (r) => console.error('[media] unhandled rejection:', r));
if (process.argv[2] === 'healthcheck') {
  fetch(`http://127.0.0.1:${PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1));
} else {
  main().catch((err) => {
    console.error('[media] fatal:', err);
    process.exit(1);
  });
}
