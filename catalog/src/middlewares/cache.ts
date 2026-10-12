import { Request, Response, NextFunction } from 'express';
import { redis, redisReady } from '../config/redis';

/**
 * Caches a public GET endpoint's JSON in Redis for `ttlSeconds`. Only for responses that are the
 * same for every visitor (no auth). Without Redis it does nothing. Header X-Cache: HIT | MISS.
 */
export const cacheJson = (ttlSeconds: number) => async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' || !redis || !redisReady()) return next();
  const key = `cache:${req.originalUrl}`;
  try {
    const hit = await redis.get(key);
    if (hit) {
      res.set('X-Cache', 'HIT').type('json').send(hit);
      return;
    }
  } catch {
    return next();
  }
  res.set('X-Cache', 'MISS');
  const send = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode === 200 && body?.success !== false) {
      redis!.set(key, JSON.stringify(body), 'EX', ttlSeconds).catch(() => {});
    }
    return send(body);
  }) as typeof res.json;
  next();
};

/*
 * The shared part of the story and chapter pages (Plan/load.md A5): what every reader sees the same, kept up to
 * `ttlSeconds`. Every key carries a generation number; any change to stories or chapters bumps it, so all of them go
 * stale at once and an author sees their own change on the very next page load.
 */
const GEN_KEY = 'pubcache:gen';

export async function bumpPublicCache() {
  if (!redis || !redisReady()) return;
  await redis.incr(GEN_KEY).catch(() => {});
}

/** `load` returning null (not found) is not kept. */
export async function cachedPublic<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  if (!redis || !redisReady()) return load();
  let full: string;
  try {
    full = `pub:${(await redis.get(GEN_KEY)) || '0'}:${key}`;
    const hit = await redis.get(full);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return load();
  }
  const value = await load();
  if (value !== null) redis.set(full, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
  return value;
}

/**
 * Any successful write request (on /api/v1 and /internal) bumps the generation before its answer leaves, so the
 * redirect that follows (e.g. to the chapter just published) already reads fresh data.
 */
export const bumpOnWrite = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode >= 400) return json(body);
    bumpPublicCache().finally(() => json(body));
    return res;
  }) as typeof res.json;
  res.on('finish', () => { if (res.statusCode < 400) bumpPublicCache(); }); // answers sent without res.json
  next();
};
