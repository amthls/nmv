import Redis from 'ioredis';
import './env';

/**
 * Shared Redis client, or null when REDIS_URL is not set (local `yarn dev` without Docker).
 * Every user of it must keep working without Redis: cache misses, direct DB writes, in-memory
 * rate limits, polling instead of realtime.
 */
export const REDIS_URL = process.env.REDIS_URL || '';

function connect(name: string) {
  const client = new Redis(REDIS_URL, {
    connectionName: name,
    maxRetriesPerRequest: 2, // a request waits at most a couple of reconnects, then the caller falls back
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  let down = false;
  client.on('error', (err) => {
    if (!down) console.warn(`[Redis:${name}] ${err.message}`);
    down = true;
  });
  client.on('ready', () => {
    if (down) console.log(`[Redis:${name}] reconnected`);
    down = false;
  });
  return client;
}

export const redis: Redis | null = REDIS_URL ? connect('main') : null;

/** True when commands will run now (not queued behind a reconnect). */
export const redisReady = () => redis?.status === 'ready';

/** A second connection for pub/sub (a subscribed connection can't run normal commands). */
export const newRedisConnection = (name: string) => (REDIS_URL ? connect(name) : null);
