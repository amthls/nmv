import { IS_PROD, PORT, migrate, pool } from './config';
import express, { NextFunction, Request, Response } from 'express';
import { requestContext } from './logger';
import { commentLimiter, internalAuthOK, optionalAuth, postLimiter, reactLimiter, reportLimiter, requireAuth } from './auth';
import {
  approvePost, createPost, deletePost, getFandomSidebar, getPostBySlug, getPosts, reactToPost, rejectPost, togglePinPost, togglePostMute, updatePost,
} from './posts';
import { createComment, deleteComment, getComments, likeComment, updateComment } from './comments';
import { createReport, getReports, resolveReport } from './reports';
import { getRemovedContent, handleIdentityEvent, purgeStoryComments, resolveCode, userStats } from './moderation';
import { connectQueue } from './notify';
import { startEventConsumer } from './events';
import { importLegacy } from './importLegacy';

/**
 * community: Fandom posts, comments (stories, chapters, posts), reactions, reports, removed content. See Plan/community.md.
 *   gateway /api/community/*  -> here without the prefix (same paths and JSON the backend's /api/v1 had)
 *   backend -> /internal/*    (smart codes, profile stats, comments of a deleted story)
 */

for (const k of ['COMMUNITY_DATABASE_URL', 'USER_SIG_KEY_COMMUNITY', 'INTERNAL_KEY_COMMUNITY', 'INTERNAL_KEY_CATALOG', 'INTERNAL_KEY_MESSAGING']) {
  if (IS_PROD && (process.env[k] || '').length < (k === 'COMMUNITY_DATABASE_URL' ? 1 : 32)) throw new Error(`${k} is missing`);
}

// Express 4 does not catch async handlers' errors
const wrap = (fn: (req: any, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
const internal = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  if (!internalAuthOK(req.get('x-internal-auth'))) return res.status(401).json({ success: false });
  fn(req, res).catch(next);
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false); // only the gateway talks to us; it sends X-Real-IP
app.use(requestContext);
app.use(express.json({ limit: '1mb' })); // post bodies are rich HTML (sanitized, at most 100k characters)

app.get('/health', (_req, res) => res.json({ success: true }));
app.get('/ready', async (_req, res) => {
  const ok = await pool.query('SELECT 1').then(() => true, () => false);
  res.status(ok ? 200 : 503).json({ success: ok, data: { database: ok ? 'ok' : 'down' } });
});

app.get('/comments', wrap(getComments));
app.post('/comments', requireAuth, commentLimiter, wrap(createComment));
app.post('/comments/:id/like', requireAuth, wrap(likeComment));
app.put('/comments/:id', requireAuth, wrap(updateComment));
app.delete('/comments/:id', requireAuth, wrap(deleteComment));

app.post('/reports', requireAuth, reportLimiter, wrap(createReport));
app.get('/reports', requireAuth, wrap(getReports));
app.put('/reports/:id/resolve', requireAuth, wrap(resolveReport));
app.get('/moderation/removed', requireAuth, wrap(getRemovedContent));

app.get('/posts', optionalAuth, wrap(getPosts));
app.get('/posts/sidebar', optionalAuth, wrap(getFandomSidebar));
app.get('/posts/:slug', optionalAuth, wrap(getPostBySlug));
app.post('/posts', requireAuth, postLimiter, wrap(createPost));
app.put('/posts/:id', requireAuth, wrap(updatePost));
app.delete('/posts/:id', requireAuth, wrap(deletePost));
app.post('/posts/:id/approve', requireAuth, wrap(approvePost));
app.post('/posts/:id/reject', requireAuth, wrap(rejectPost));
app.post('/posts/:id/react', requireAuth, reactLimiter, wrap(reactToPost));
app.post('/posts/:id/pin', requireAuth, wrap(togglePinPost));
app.post('/posts/:id/mute', requireAuth, wrap(togglePostMute));

app.get('/internal/codes/:kind/:no', internal(resolveCode));
app.get('/internal/users/:id/stats', internal(userStats));
app.post('/internal/comments/purge', internal(purgeStoryComments));

app.use((_req, res) => res.status(404).json({ success: false, message: 'Không tìm thấy.' }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Nội dung quá lớn.' });
  console.error('[community] request failed:', err?.stack || err);
  res.status(500).json({ success: false, message: 'Lỗi hệ thống.' });
});

async function main() {
  await migrate();
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
  const server = app.listen(PORT, () => console.log(`community listening on :${PORT}`));
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
