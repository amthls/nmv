import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { pool } from '../config/db';
import { readThroughUser } from '../services/identitySync';

/**
 * Who is calling. Sign-in lives in the identity service; the gateway asks it about every request
 * (nginx auth_request) and forwards X-User-Id / X-User-Roles / X-User-Exp plus X-User-Sig, an HMAC over
 * them with USER_SIG_KEY_CATALOG (the workspace gets its own signature with its own key). They are believed only with a valid, unexpired signature, so a request that
 * reaches the backend any other way (or a client sending these headers itself) is just a guest.
 * Roles come from the headers (fresh from identity); the profile (name, avatar) from the local users copy.
 */

export interface AuthenticatedUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const HEADER_KEY = process.env.USER_SIG_KEY_CATALOG || '';
// One key per RECEIVING service: holding another service's key only lets you call that service's internal API
const INTERNAL_KEYS = {
  backend: process.env.INTERNAL_KEY_CATALOG || '',
  identity: process.env.INTERNAL_KEY_IDENTITY || '',
  workspace: process.env.INTERNAL_KEY_WORKSPACE || '',
  messaging: process.env.INTERNAL_KEY_MESSAGING || '',
  community: process.env.INTERNAL_KEY_COMMUNITY || '',
  library: process.env.INTERNAL_KEY_LIBRARY || '',
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

/** Verified identity from the gateway's signed headers, or null. */
export function identityFromHeaders(h: IncomingHttpHeaders, now = Date.now()): { id: string; roles: string[] } | null {
  const id = one(h['x-user-id']);
  const roles = one(h['x-user-roles']);
  const exp = one(h['x-user-exp']);
  const sig = one(h['x-user-sig']);
  if (!HEADER_KEY || !id || !/^\d+$/.test(exp) || Number(exp) * 1000 < now || !/^[0-9a-f]{64}$/i.test(sig)) return null;
  const want = crypto.createHmac('sha256', HEADER_KEY).update(`${id}|${roles}|${exp}`).digest();
  if (!crypto.timingSafeEqual(want, Buffer.from(sig, 'hex'))) return null;
  return { id, roles: roles ? roles.split(',') : [] };
}

/** Sign headers the same way (calls this backend makes to itself in tests, and to identity). */
export function signIdentityHeaders(id: string, roles: string[], now = Date.now()): Record<string, string> {
  const exp = String(Math.floor(now / 1000) + 120);
  const r = roles.join(',');
  return {
    'X-User-Id': id,
    'X-User-Roles': r,
    'X-User-Exp': exp,
    'X-User-Sig': crypto.createHmac('sha256', HEADER_KEY).update(`${id}|${r}|${exp}`).digest('hex'),
  };
}

async function loadUser(req: Request): Promise<{ user?: AuthenticatedUser; blocked?: boolean }> {
  const ident = identityFromHeaders(req.headers);
  if (!ident) return {};
  const q = () => pool.query(`SELECT id, username, display_name, avatar_url, is_banned, deleted_at FROM users WHERE id = $1::uuid`, [ident.id]);
  let row = (await q()).rows[0];
  if (!row) {
    // Signed up a moment ago: identity's event has not reached this copy yet
    await readThroughUser(ident.id);
    row = (await q()).rows[0];
  }
  if (!row) return {};
  if (row.is_banned || row.deleted_at) return { blocked: true };
  return { user: { id: row.id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url, roles: ident.roles } };
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { user, blocked } = await loadUser(req);
    if (blocked) {
      return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.' });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn.' });
    }
    req.user = user;
    next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ success: false, message: 'Lỗi xác thực hệ thống: ' + error.message });
  }
};

export const optionalAuth = async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  try {
    const { user } = await loadUser(req);
    if (user) req.user = user;
  } catch (err: any) {
    console.warn('optionalAuth:', err.message);
  }
  next();
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
    }
    const userRoles = req.user.roles || [];
    if (userRoles.includes('admin') || roles.some((role) => userRoles.includes(role))) return next();
    return res.status(403).json({
      success: false,
      message: 'Bạn không có quyền thực hiện hành động này. Yêu cầu quyền: ' + roles.join(', '),
    });
  };
};

/** Service-to-service calls carry X-Internal-Auth: "<exp>.<hmac(receiver's INTERNAL_KEY_*, 'internal|'+exp)>". */
export function internalAuthOK(value: string | undefined, now = Date.now()): boolean {
  const [exp, sig] = String(value || '').split('.');
  const key = INTERNAL_KEYS.backend;
  if (!key || !/^\d+$/.test(exp || '') || Number(exp) * 1000 < now || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  const want = crypto.createHmac('sha256', key).update(`internal|${exp}`).digest();
  return crypto.timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

/** X-Internal-Auth for a call to another service's internal API. */
export function internalAuthHeader(to: 'identity' | 'workspace' | 'messaging' | 'community' | 'library', now = Date.now()): string {
  const exp = String(Math.floor(now / 1000) + 120);
  return `${exp}.${crypto.createHmac('sha256', INTERNAL_KEYS[to]).update(`internal|${exp}`).digest('hex')}`;
}
