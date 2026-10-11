import express from 'express';
import cors from 'cors';
import './config/env'; // loads .env and validates required secrets first
import apiRoutes from './routes/api.routes';
import { applySecurity, globalApiLimiter, writeLimiter } from './middlewares/security';
import { connectQueue } from './services/queue.service';
import { startSearchSync } from './services/search.service';
import { visitorCookie } from './services/recommender/events';
import { requestContext } from './utils/logger';
import { identityFromHeaders, internalAuthOK } from './middlewares/auth.middleware';
import {
  permissions, exportChapters, exportSource, exportBook, userProfiles, groupMembers, storiesBrief, removedStories, commentCounts, librarySync, libraryIds, favoriteCounts,
} from './controllers/internal.controller';
import { deleteCheck } from './controllers/user.controller';

// Without the keys that verify the gateway's identity headers and internal calls nobody is ever signed in: refuse to start
for (const k of ['USER_SIG_KEY_BACKEND', 'INTERNAL_KEY_BACKEND', 'INTERNAL_KEY_IDENTITY', 'INTERNAL_KEY_WORKSPACE', 'INTERNAL_KEY_MESSAGING', 'INTERNAL_KEY_COMMUNITY', 'INTERNAL_KEY_LIBRARY']) {
  if (process.env.NODE_ENV === 'production' && (process.env[k] || '').length < 32) {
    throw new Error(`${k} is missing or shorter than 32 characters (launch.py generates it).`);
  }
}

const app = express();
const PORT = process.env.PORT || 5000;

// High concurrency crash guards
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

app.use(requestContext); // before everything else, so every log line and error carries the request_id
applySecurity(app);

// CORS Configuration with Credentials for Persistent Cookies
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Express Cookie Parser Middleware (Native, zero dependency)
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie;
  (req as any).cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach((c) => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        (req as any).cookies[key] = decodeURIComponent(val);
      }
    });
  }
  next();
});

// Anonymous visitor id for guest recommendations (API only, not static files)
app.use('/api/v1', visitorCookie);

// JSON bodies never need to be big (uploads go to the media service)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// RESTful API V1
app.use('/api/v1', globalApiLimiter, writeLimiter, apiRoutes);

// Service-to-service calls (identity -> backend), signed like the gateway's headers. The gateway answers 404 for
// /internal from outside, so only containers on the Docker networks reach these.
app.get('/internal/users/:id/delete-check', (req, res, next) => {
  if (!identityFromHeaders(req.headers)) return res.status(401).json({ ok: false });
  deleteCheck(req, res).catch(next);
});
// Workspace -> backend (X-Internal-Auth): story rights and the one-time chapter import
const internal = (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler => (req, res, next) => {
  if (!internalAuthOK(req.get('x-internal-auth'))) return res.status(401).json({ success: false });
  fn(req, res).catch(next);
};
app.get('/internal/permissions', internal(permissions));
app.get('/internal/chapters/export', internal(exportChapters));
// Media -> backend: what an EPUB/PDF may contain, and the content itself
app.post('/internal/exports/source', internal(exportSource));
app.post('/internal/exports/book', internal(exportBook));
// Messaging -> backend: names/avatars to show, and who is in a group (its chat)
app.post('/internal/users/profiles', internal(userProfiles));
app.get('/internal/groups/:id/members', internal(groupMembers));
// Community -> backend: stories/chapters it shows or links, removed stories for /da-go, comment counts it keeps fresh
app.post('/internal/stories/brief', internal(storiesBrief));
app.get('/internal/stories/removed', internal(removedStories));
app.post('/internal/comment-counts', internal(commentCounts));
// Library -> backend: changed stories/chapters for its read copies, every id (nightly reconcile), follower counts
app.get('/internal/library/stories', internal(librarySync('stories')));
app.get('/internal/library/chapters', internal(librarySync('chapters')));
app.get('/internal/library/ids', internal(libraryIds));
app.post('/internal/favorite-counts', internal(favoriteCounts));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to NovelHub API',
    docs: '/api/v1/health',
    uploads: '/uploads',
    version: '1.0.0',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Express Global Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Lỗi hệ thống máy chủ nội bộ',
  });
});

const server = app.listen(PORT, () => {
  console.log(`NovelHub API Server is running on http://localhost:${PORT}`);
  console.log(`Healthcheck: http://localhost:${PORT}/api/v1/health`);
  startSearchSync();
  connectQueue();
});


// Slow-connection (slowloris) protection: never wait forever for headers or a request body
server.headersTimeout = 15_000;
server.requestTimeout = 60_000; // JSON only (uploads go to the media service)
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 60;
