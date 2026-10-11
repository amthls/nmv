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
