import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import './config/env'; // loads .env and validates required secrets first
import path from 'path';
import apiRoutes from './routes/api.routes';
import { applySecurity, globalApiLimiter, writeLimiter, imageResizeLimiter } from './middlewares/security';
import { connectQueue } from './services/queue.service';
import { startSearchSync } from './services/search.service';
import { resizeUploadedImage } from './services/image.service';

const app = express();
const PORT = process.env.PORT || 5000;

// High concurrency crash guards
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

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

// Uploads go through multer (multipart) with their own limits; JSON bodies never need to be big
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('dev'));

// Static Uploads Folder (Serve stored image assets); ?w=<width> serves a resized copy
// Only resized variants cost CPU, so only they are rate limited
app.use('/uploads', (req, res, next) => (req.query.w !== undefined ? imageResizeLimiter(req, res, next) : next()), resizeUploadedImage);
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads'), { maxAge: '5m' }));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), { maxAge: '5m' }));
app.use('/uploads', express.static(path.resolve(__dirname, './uploads'), { maxAge: '5m' }));

// RESTful API V1
app.use('/api/v1', globalApiLimiter, writeLimiter, apiRoutes);

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
const UPLOAD_ERRORS: Record<string, string> = {
  LIMIT_FILE_SIZE: 'Có ảnh nặng quá 25 MB. Hãy giảm dung lượng ảnh rồi tải lại.',
  LIMIT_FILE_COUNT: 'Gửi quá nhiều ảnh trong một lần.',
  LIMIT_UNEXPECTED_FILE: 'Trường tải lên không hợp lệ.',
  LIMIT_PART_COUNT: 'Yêu cầu tải lên có quá nhiều phần.',
};

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Upload problems are the client's to fix: answer 400 with a message they can act on
  if (err?.name === 'MulterError' || /^Chỉ chấp nhận/.test(err?.message || '')) {
    return res.status(400).json({ success: false, message: UPLOAD_ERRORS[err.code] || err.message });
  }
  console.error('[Express Global Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Lỗi hệ thống máy chủ nội bộ',
  });
});

const server = app.listen(PORT, () => {
  console.log(`NovelHub API Server is running on http://localhost:${PORT}`);
  console.log(`Uploads served on http://localhost:${PORT}/uploads`);
  console.log(`Healthcheck: http://localhost:${PORT}/api/v1/health`);
  startSearchSync();
  connectQueue();
});

// Slow-connection (slowloris) protection: never wait forever for headers or a request body
server.headersTimeout = 15_000;
server.requestTimeout = 120_000; // uploads of 25MB on a slow line still fit
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 60;
