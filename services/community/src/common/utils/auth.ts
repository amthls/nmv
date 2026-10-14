import crypto from 'crypto';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { INTERNAL_KEY, USER_SIG_KEY } from '../../config';

export interface Viewer {
  id: string;
  roles: string[];
}
export type AuthedRequest = Request & { user?: Viewer };

/**
 * The caller, from the gateway's X-User-* headers signed by identity with USER_SIG_KEY_COMMUNITY (same check as the
 * backend's auth.middleware). No or bad signature = guest.
 */
export function userFromHeaders(req: Request, now = Date.now()): Viewer | null {
  const id = req.get('x-user-id') || '';
  const roles = req.get('x-user-roles') || '';
  const exp = req.get('x-user-exp') || '';
  const sig = req.get('x-user-sig') || '';
  if (!USER_SIG_KEY || !id || !/^\d+$/.test(exp) || Number(exp) * 1000 < now || !/^[0-9a-f]{64}$/i.test(sig)) return null;
  const want = crypto.createHmac('sha256', USER_SIG_KEY).update(`${id}|${roles}|${exp}`).digest();
  return crypto.timingSafeEqual(want, Buffer.from(sig, 'hex')) ? { id, roles: roles ? roles.split(',') : [] } : null;
}

export const isStaff = (req: AuthedRequest) => Boolean(req.user?.roles.some((r) => r === 'admin' || r === 'mod'));

/** X-Internal-Auth "<exp>.<hmac(key, 'internal|'+exp)>" signed with `key` (two minutes). */
export function internalHeader(key: string, now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + 120);
  return `${exp}.${crypto.createHmac('sha256', key).update(`internal|${exp}`).digest('hex')}`;
}

/** Calls to our /internal API (the backend's), signed with INTERNAL_KEY_COMMUNITY. */
export function internalAuthOK(value: string | undefined, now = Date.now()): boolean {
  const [exp, sig] = String(value || '').split('.');
  if (!INTERNAL_KEY || !/^\d+$/.test(exp || '') || Number(exp) * 1000 < now || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  const want = crypto.createHmac('sha256', INTERNAL_KEY).update(`internal|${exp}`).digest();
  return crypto.timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

// ---- rate limits (moved from the backend; per signed-in user, else per address the gateway verified) -----------

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => userFromHeaders(req)?.id || req.get('x-real-ip') || req.socket.remoteAddress || 'unknown',
    handler: (req, res) => {
      // how long to wait, so the page can count down instead of failing (Plan/load.md A6)
      const resetTime: Date | undefined = (req as any).rateLimit?.resetTime;
      const retryAfter = Math.max(1, Math.ceil((resetTime ? resetTime.getTime() - Date.now() : windowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ success: false, message, retry_after_seconds: retryAfter });
    },
  });
}
// shortcut: in-memory counters, fine for one community container; move to Redis when running several
export const commentLimiter = limiter(5 * 60_000, 30, 'Bạn bình luận quá nhanh. Vui lòng chờ một chút.');
export const postLimiter = limiter(60 * 60_000, 20, 'Bạn đăng bài quá nhiều. Vui lòng thử lại sau.');
export const reactLimiter = limiter(60_000, 60, 'Bạn thả cảm xúc quá nhanh.');
export const reportLimiter = limiter(60 * 60_000, 10, 'Bạn gửi quá nhiều báo cáo. Vui lòng thử lại sau.');
