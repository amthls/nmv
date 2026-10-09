import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { JWT_SECRET } from '../config/env';
import { redis, redisReady, newRedisConnection } from '../config/redis';

/**
 * Realtime "something changed" pings (Socket.IO). The server only pushes; browsers then refetch
 * through the normal REST API, so permissions stay in one place. Each signed-in socket joins the
 * room `user:<id>`. Through Redis, any process (API copies, worker) can emit to any socket.
 * Events: `notification`, `dm`, `group_message`.
 */

const room = (userId: string) => `user:${userId}`;
const emitter = redis ? new Emitter(redis) : null;
let localIo: Server | null = null; // used when there is no Redis (single process, local dev)

function tokenFromCookie(header?: string): string | undefined {
  const match = header?.match(/(?:^|;\s*)(?:token|auth_token)=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket'], // no long-polling: works across backend copies without sticky sessions
    cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true },
  });
  const subscriber = newRedisConnection('socket-sub');
  if (redis && subscriber) io.adapter(createAdapter(redis, subscriber));

  // Same rules as requireAuth: valid token, account exists, not banned or deleted
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || tokenFromCookie(socket.handshake.headers.cookie);
      const decoded: any = jwt.verify(String(token || ''), JWT_SECRET);
      const userRes = await pool.query(`SELECT is_banned, deleted_at FROM users WHERE id = $1::uuid`, [decoded?.id]);
      const user = userRes.rows[0];
      if (!user || user.is_banned || user.deleted_at) return next(new Error('unauthorized'));
      socket.join(room(decoded.id));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  localIo = io;
  return io;
}

/** Fire-and-forget push to the given users' open tabs. Never throws. */
export function emitToUsers(userIds: Iterable<string | null | undefined>, event: string, payload: Record<string, unknown> = {}) {
  const rooms = Array.from(new Set(Array.from(userIds).filter(Boolean) as string[])).map(room);
  if (rooms.length === 0) return;
  try {
    if (emitter && redisReady()) emitter.to(rooms).emit(event, payload);
    else localIo?.to(rooms).emit(event, payload);
  } catch (err: any) {
    console.warn('[Realtime] emit failed:', err.message);
  }
}
