import { IS_PROD, PORT, UPLOAD_DIR, migrate, pool } from './config';
import express, { NextFunction, Request, Response } from 'express';
import { requestContext } from './logger';
import { exportLimiter, imageResizeLimiter, mangaUploadLimiter, optionalAuth, requireAuth, uploadLimiter } from './auth';
import { uploadImages, uploadMangaPageFiles } from './uploadFiles';
import { uploadMangaPages, uploadMultipleImages, uploadSingleImage } from './upload';
import { resizeUploadedImage } from './image';
import { createExport, downloadExport, getExport } from './exportRoutes';
import { cleanupExports, exportLoop, recoverExports } from './export';

/**
 * media: image uploads, resized images (/uploads/...?w=), EPUB/PDF downloads. See Plan/media.md.
 *   gateway /uploads/*    -> here as is (public files, cached by the gateway)
 *   gateway /api/media/*  -> here without the prefix
 * One process serves the API and builds the EPUB/PDF files (EXPORT_CONCURRENCY at a time).
 */

for (const k of ['MEDIA_DATABASE_URL', 'USER_SIG_KEY_MEDIA', 'INTERNAL_KEY_CATALOG']) {
  if (IS_PROD && (process.env[k] || '').length < (k === 'MEDIA_DATABASE_URL' ? 1 : 32)) throw new Error(`${k} is missing`);
}

// Express 4 does not catch async handlers' errors
const wrap = (fn: (req: any, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false); // only the gateway talks to us; it sends X-Real-IP
app.use(requestContext);

app.get('/health', (_req, res) => res.json({ success: true }));
app.get('/ready', async (_req, res) => {
  const ok = await pool.query('SELECT 1').then(() => true, () => false);
  res.status(ok ? 200 : 503).json({ success: ok, data: { database: ok ? 'ok' : 'down' } });
});

// Uploaded images; ?w=<width> serves a resized copy (only that costs CPU, so only that is rate limited)
app.use('/uploads', (req, res, next) => (req.query.w !== undefined ? imageResizeLimiter(req, res, next) : next()), resizeUploadedImage);
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '5m' }));

app.use(express.json({ limit: '100kb' }));
app.post('/upload/images', requireAuth, uploadLimiter, uploadImages.array('images', 10) as any, wrap(uploadMultipleImages));
app.post('/upload/image', requireAuth, uploadLimiter, uploadImages.single('image') as any, wrap(uploadSingleImage));
app.post('/upload/manga-pages', requireAuth, mangaUploadLimiter, uploadMangaPageFiles.array('pages', 20) as any, wrap(uploadMangaPages));
app.post('/stories/:slug/exports', optionalAuth, exportLimiter, wrap(createExport));
app.get('/exports/:id', wrap(getExport));
app.get('/exports/:id/download', wrap(downloadExport));

app.use((_req, res) => res.status(404).json({ success: false, message: 'Không tìm thấy.' }));
const UPLOAD_ERRORS: Record<string, string> = {
  LIMIT_FILE_SIZE: 'Có ảnh nặng quá 25 MB. Hãy giảm dung lượng ảnh rồi tải lại.',
  LIMIT_FILE_COUNT: 'Gửi quá nhiều ảnh trong một lần.',
  LIMIT_UNEXPECTED_FILE: 'Trường tải lên không hợp lệ.',
  LIMIT_PART_COUNT: 'Yêu cầu tải lên có quá nhiều phần.',
};
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Upload problems are the client's to fix: answer 400 with a message they can act on
  if (err?.name === 'MulterError' || /^Chỉ chấp nhận/.test(err?.message || '')) {
    return res.status(400).json({ success: false, message: UPLOAD_ERRORS[err.code] || err.message });
  }
  console.error('[media] request failed:', err?.stack || err);
  res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
});

let stopping = false;
async function main() {
  await migrate();
  await recoverExports();
  const loop = exportLoop(() => stopping);
  const cleanup = () => cleanupExports().catch((e) => console.error('[media] export cleanup failed:', e.message));
  void cleanup();
  setInterval(cleanup, 60 * 60_000).unref();

  const server = app.listen(PORT, () => console.log(`media listening on :${PORT}`));
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
