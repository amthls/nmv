import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import { pool } from '../config/db';
import { redis, redisReady, newRedisConnection } from '../config/redis';
import { identityFromHeaders } from '../middlewares/auth.middleware';

/**
 * Realtime "something changed" pings (Socket.IO). The server only pushes; browsers then refetch
 * through the normal REST API, so permissions stay in one place. Each signed-in socket joins the
 * room `user:<id>`. Through Redis, any process (API copies, worker) can emit to any socket.
 * Events: `notification`, `dm`, `group_message`.
 */

const room = (userId: string) => `user:${userId}`;
const emitter = redis ? new Emitter(redis) : null;
let localIo: Server | null = null; // used when there is no Redis (single process, local dev)

export function attachRealtime(server: HttpServer) {
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    transports: ['websocket'], // no long-polling: works across backend copies without sticky sessions
    cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true },
  });
  const subscriber = newRedisConnection('socket-sub');
  if (redis && subscriber) io.adapter(createAdapter(redis, subscriber));

  // Same rules as requireAuth: the gateway's signed identity headers on the handshake (the browser's
  // session cookie went through auth_request), account not banned or deleted
  io.use(async (socket, next) => {
    try {
      const ident = identityFromHeaders(socket.handshake.headers);
      if (!ident) return next(new Error('unauthorized'));
      const userRes = await pool.query(`SELECT is_banned, deleted_at FROM users WHERE id = $1::uuid`, [ident.id]);
      const user = userRes.rows[0];
      if (!user || user.is_banned || user.deleted_at) return next(new Error('unauthorized'));
      socket.join(room(ident.id));
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

/** Close every open socket of a user (their tokens were just revoked). Never throws. */
export function disconnectUser(userId: string) {
  try {
    if (emitter && redisReady()) emitter.in(room(userId)).disconnectSockets(true);
    else localIo?.in(room(userId)).disconnectSockets(true);
  } catch (err: any) {
    console.warn('[Realtime] disconnect failed:', err.message);
  }
}
