const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.resolve('C:/Users/Admin/Documents/doc/backend/src');

// 1. Update config/db.ts
const dbCode = `import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/novel_platform?schema=public';

// Raw PostgreSQL pool configured for high concurrency and crash prevention
export const pool = new Pool({
  connectionString,
  max: 50, // Allow up to 50 concurrent connections
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5s if acquiring connection fails
});

// Prevent unhandled error events on idle clients from crashing the process
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error] Unexpected idle client error:', err.message);
});

// Prisma ORM Client
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export default {
  pool,
  prisma,
};
`;
fs.writeFileSync(path.join(BACKEND_SRC, 'config/db.ts'), dbCode, 'utf8');
console.log('1. Updated config/db.ts');

// 2. Update server.ts
const serverCode = `import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import apiRoutes from './routes/api.routes';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// High concurrency crash guards
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

// Static Uploads Folder (Serve stored image assets)
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')));
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
app.use('/uploads', express.static(path.resolve(__dirname, './uploads')));

// RESTful API V1
app.use('/api/v1', apiRoutes);

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
    message: \`Route not found: \${req.method} \${req.originalUrl}\`,
  });
});

// Global Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Express Global Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Lỗi hệ thống máy chủ',
  });
});

app.listen(PORT, () => {
  console.log(\`NovelHub API Server is running on http://localhost:\${PORT}\`);
  console.log(\`Uploads served on http://localhost:\${PORT}/uploads\`);
  console.log(\`Healthcheck: http://localhost:\${PORT}/api/v1/health\`);
});
`;
fs.writeFileSync(path.join(BACKEND_SRC, 'server.ts'), serverCode, 'utf8');
console.log('2. Updated server.ts');

