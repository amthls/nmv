import crypto from 'crypto';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { USER_SIG_KEY } from '../../config';

/**
 * The caller, from the gateway's X-User-* headers signed by identity with USER_SIG_KEY_MEDIA (same check as the
 * backend's auth.middleware). No or bad signature = guest.
 */
export function userFromHeaders(req: Request, now = Date.now()): string | null {
  const id = req.get('x-user-id') || '';
  const roles = req.get('x-user-roles') || '';
  const exp = req.get('x-user-exp') || '';
  const sig = req.get('x-user-sig') || '';
  if (!USER_SIG_KEY || !id || !/^\d+$/.test(exp) || Number(exp) * 1000 < now || !/^[0-9a-f]{64}$/i.test(sig)) return null;
  const want = crypto.createHmac('sha256', USER_SIG_KEY).update(`${id}|${roles}|${exp}`).digest();
  return crypto.timingSafeEqual(want, Buffer.from(sig, 'hex')) ? id : null;
}

// ---- rate limits (moved from the backend; per signed-in user, else per address the gateway verified) -----------

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => userFromHeaders(req) || req.get('x-real-ip') || req.socket.remoteAddress || 'unknown',
    handler: (_req, res) => res.status(429).json({ success: false, message }),
  });
}
// shortcut: in-memory counters, fine for one media container; use the backend's Redis store when running several
export const uploadLimiter = limiter(10 * 60_000, 30, 'Bạn tải ảnh lên quá nhiều. Vui lòng thử lại sau ít phút.');
export const mangaUploadLimiter = limiter(10 * 60_000, 120, 'Bạn tải trang truyện lên quá nhiều. Vui lòng thử lại sau ít phút.');
export const imageResizeLimiter = limiter(60_000, 300, 'Quá nhiều yêu cầu tải ảnh. Vui lòng thử lại sau.');
export const exportLimiter = limiter(10 * 60_000, 30, 'Bạn yêu cầu tải quá nhiều lần. Vui lòng thử lại sau ít phút.');
