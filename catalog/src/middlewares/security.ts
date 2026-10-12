import { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import crypto from 'crypto';
import { RedisStore } from 'rate-limit-redis';
import { IS_PROD } from '../config/env';
import { redis } from '../config/redis';
import { identityFromHeaders, type AuthenticatedRequest } from './auth.middleware';
import { currentRequestId } from '../utils/logger';

/**
 * Abuse / DDoS hardening for the API.
 *
 * Real volumetric DDoS protection has to happen at the edge (Cloudflare, firewall); what lives here
 * is what the application itself must do: identify the client correctly, throttle per client,
 * bound request size/time, and never leak internals.
 */

/**
 * Real client address. The API is only reachable through the nginx gateway, which OVERWRITES
 * X-Forwarded-For with the address it verified (see nginx/nginx.conf), and `trust proxy` below trusts
 * exactly that one hop. Do not trust any other forwarding header here: the Next.js proxy, for
 * instance, passes a client-supplied X-Forwarded-For through untouched.
 */
export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

const ipKey = (req: Request) => ipKeyGenerator(clientIp(req));

/**
 * Counters live in Redis when it is configured, so they survive restarts and are shared by every
 * backend copy. Each limiter needs its own key prefix; derive it from its settings (stable across
 * deploys and replicas). If Redis fails, requests pass instead of the whole API returning errors.
 */
function redisStore(options: Partial<Options> & { message: string }) {
  if (!redis) return {};
  const id = crypto.createHash('sha1').update(`${options.message}|${options.windowMs}|${options.limit}`).digest('hex').slice(0, 10);
  return {
    store: new RedisStore({ prefix: `rl:${id}:`, sendCommand: (command: string, ...args: string[]) => redis!.call(command, ...args) as any }),
    passOnStoreError: true,
  };
}

function limiter(options: Partial<Options> & { message: string }) {
  const { message, ...rest } = options;
  return rateLimit({
    ...redisStore(options),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: (req, res) => {
      const resetTime: Date | undefined = (req as any).rateLimit?.resetTime;
      const retryAfter = Math.max(1, Math.ceil((resetTime ? resetTime.getTime() - Date.now() : 60000) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ success: false, message, retry_after_seconds: retryAfter });
    },
    ...rest,
  });
}

/** Ceiling for any /api/v1 request from one address (page loads make many calls, so it is generous). */
export const globalApiLimiter = limiter({
  windowMs: 60_000,
  limit: 600,
  message: 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.',
  skip: (req) => req.path === '/health',
});

const isRead = (req: Request) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
// Writes are counted per account when signed in (Plan/load.md B2, like GitHub), so people sharing one network do not
// use up each other's allowance; guests per address. The signed identity headers are checked here (cheap HMAC)
// because this runs before the routes' auth.
const accountOrIpKey = (req: Request) => {
  const who = identityFromHeaders(req.headers);
  return who ? `u:${who.id}` : ipKey(req);
};

/** Anything that changes data. */
export const writeLimiter = limiter({
  windowMs: 60_000,
  limit: 120,
  message: 'Bạn thao tác quá nhanh. Vui lòng chậm lại một chút.',
  keyGenerator: accountOrIpKey,
  skip: isRead,
});

/** Hourly ceiling on writes; draft autosaves (every few seconds while typing) are not counted here. */
export const writeHourLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 600,
  message: 'Bạn đã thao tác rất nhiều trong một giờ. Vui lòng thử lại sau.',
  keyGenerator: accountOrIpKey,
  skip: (req) => isRead(req) || (req.method === 'PUT' && /^\/drafts\/[^/]+$/.test(req.path)),
});

/** Login: counts failures only, keyed by address + account so one attacker cannot lock others out. */
export const loginLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const id = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase().slice(0, 100) : '';
    return `${ipKey(req)}|${crypto.createHash('sha1').update(id).digest('hex').slice(0, 16)}`;
  },
  message: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
});

export const registerLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 5,
  message: 'Bạn tạo tài khoản quá nhiều lần. Vui lòng thử lại sau.',
});

// Forgot password / resend verification send mail: keep them rare (mail bombing, provider quota)
export const mailLimiter = limiter({
  windowMs: 60 * 60_000,
  limit: 5,
  message: 'Bạn yêu cầu gửi email quá nhiều lần. Vui lòng thử lại sau 1 giờ.',
});

// Guessing a reset/verify token or the current password on the change-password form
export const accountTokenLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: 20,
  message: 'Thử quá nhiều lần. Vui lòng thử lại sau 15 phút.',
});

export const searchLimiter = limiter({
  windowMs: 60_000,
  limit: 90,
  message: 'Bạn tìm kiếm quá nhanh. Vui lòng chậm lại.',
});

/** Per signed-in user (mount after requireAuth): spam control for user-generated content. */
export const perUserLimiter = (opts: { windowMs: number; limit: number; message: string }) =>
  limiter({
    ...opts,
    keyGenerator: (req) => {
      const uid = (req as AuthenticatedRequest).user?.id;
      return uid ? `u:${uid}` : ipKey(req);
    },
  });

/** In production, 5xx responses must not expose SQL errors, file paths or stack details. */
export function maskServerErrors(req: Request, res: Response, next: NextFunction) {
  if (!IS_PROD) return next();
  const original = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      // The code shown to the user is the request_id: search it in the logs to find the whole chain
      const errorId = currentRequestId() || crypto.randomBytes(4).toString('hex');
      console.error(`${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode}: ${body.message}`);
      return original({ success: false, message: `Lỗi hệ thống, vui lòng thử lại sau. (mã ${errorId})` });
    }
    return original(body);
  }) as typeof res.json;
  next();
}

/** Everything that must be registered before body parsing. */
export function applySecurity(app: Express) {
  app.disable('x-powered-by');
  // Exactly one proxy hop is trusted: the nginx gateway; see clientIp()
  app.set('trust proxy', 1);
  app.use(
    helmet({
      // Responses are JSON or images that the site embeds itself
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: false } : false,
      referrerPolicy: { policy: 'no-referrer' },
    })
  );
  app.use(maskServerErrors);
}
