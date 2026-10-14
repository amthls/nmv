import 'reflect-metadata';
import express from 'express';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cors from 'cors';
import './config/env'; // loads .env and validates required secrets first
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { applySecurity, globalApiLimiter, writeLimiter, writeHourLimiter } from './middlewares/security';
import { bumpOnWrite } from './middlewares/cache';
import { connectQueue } from './infra/queue/queue.service';
import { startSearchSync } from './modules/search/search.client';
import { visitorCookie } from './infra/behavior/behavior-events';
import { requestContext } from './utils/logger';
// Without the keys that verify the gateway's identity headers and internal calls nobody is ever signed in: refuse to start
for (const k of ['USER_SIG_KEY_CATALOG', 'INTERNAL_KEY_CATALOG', 'INTERNAL_KEY_IDENTITY', 'INTERNAL_KEY_WORKSPACE', 'INTERNAL_KEY_MESSAGING', 'INTERNAL_KEY_COMMUNITY', 'INTERNAL_KEY_LIBRARY']) {
  if (process.env.NODE_ENV === 'production' && (process.env[k] || '').length < 32) {
    throw new Error(`${k} is missing or shorter than 32 characters (launch.py generates it).`);
  }
}

const PORT = process.env.PORT || 5000;

// High concurrency crash guards
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

async function bootstrap() {
// Nest on Express; its own body parser is off so the limits below (2mb JSON) stay as before.
// Middleware below is added before Nest registers its routes (at listen), so it runs first.
const nest = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
const app: express.Express = nest.getHttpAdapter().getInstance();
nest.setGlobalPrefix('api/v1', { exclude: [{ path: 'internal/{*path}', method: RequestMethod.ALL }] });
nest.useGlobalFilters(new HttpExceptionFilter());

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
// limits and cache bumps for every /api/v1 request
app.use('/api/v1', globalApiLimiter, writeLimiter, writeHourLimiter, bumpOnWrite);

// Service-to-service routes (/internal/*) are Nest modules (X-Internal-Auth). The gateway answers 404 for /internal
// from outside, so only containers on the Docker networks reach them.

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to NovelHub API',
    docs: '/api/v1/health',
    uploads: '/uploads',
    version: '1.0.0',
  });
});

await nest.listen(PORT);
console.log(`NovelHub API Server is running on http://localhost:${PORT}`);
console.log(`Healthcheck: http://localhost:${PORT}/api/v1/health`);
startSearchSync();
connectQueue();

// Slow-connection (slowloris) protection: never wait forever for headers or a request body
const server = nest.getHttpServer();
server.headersTimeout = 15_000;
server.requestTimeout = 60_000; // JSON only (uploads go to the media service)
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 60;
}

bootstrap().catch((err) => {
  console.error('[CRITICAL] catalog failed to start:', err);
  process.exit(1);
});
