import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { BACKEND_KEY, BACKEND_URL, USER_SIG_KEY } from './config';
import { currentRequestId } from './logger';

export type AuthedRequest = Request & { userId?: string };

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

export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  req.userId = userFromHeaders(req) || undefined;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  req.userId = userFromHeaders(req) || undefined;
  if (!req.userId) return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
  next();
}

/** Call the backend's internal API (X-Internal-Auth signed with the backend's key). Never throws on 4xx. */
export async function callBackend(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<{ status: number; json: any }> {
  const exp = String(Math.floor(Date.now() / 1000) + 120);
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': `${exp}.${crypto.createHmac('sha256', BACKEND_KEY).update(`internal|${exp}`).digest('hex')}`,
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Owner, group member or collaborator of the story (who may upload its manga pages). */
export async function isContributor(userId: string, storyId: string): Promise<boolean> {
  const { status, json } = await callBackend('GET', `/internal/permissions?user=${encodeURIComponent(userId)}&story=${encodeURIComponent(storyId)}`);
  return status === 200 && Boolean(json.data?.contributor);
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
