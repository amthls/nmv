import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { format } from 'util';
import type { Request, Response, NextFunction } from 'express';

/**
 * One JSON line per log entry: {time, level, service, request_id, msg, ...fields}. Importing this module
 * reroutes console.* through it, so existing console.log/error calls get the same format, the current
 * request_id and redaction for free. Loaded first by config.ts. (Copy of backend/src/utils/logger.ts.)
 */
const SERVICE = process.env.SERVICE_NAME || 'community';
const ctx = new AsyncLocalStorage<string>();

export const currentRequestId = () => ctx.getStore();

/** Never let secrets or personal data reach the logs, whatever a caller passes in. */
export function redact(text: string): string {
  return text
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\b(Bearer|Basic)\s+[^\s"',]+/gi, '$1 [redacted]')
    .replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, '$1[redacted]@') // passwords in connection URLs
    .replace(/((?:password|passwd|token|secret|cookie|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, '$1[redacted]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
}

const original = { log: console.log, error: console.error };

export function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}, unredacted = false) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, request_id: ctx.getStore(), msg: unredacted ? msg : redact(msg), ...fields });
  (level === 'error' || level === 'warn' ? original.error : original.log)(line);
}

console.log = (...a: unknown[]) => log('info', format(...a));
console.info = (...a: unknown[]) => log('info', format(...a));
console.debug = (...a: unknown[]) => log('debug', format(...a));
console.warn = (...a: unknown[]) => log('warn', format(...a));
console.error = (...a: unknown[]) => log('error', format(...a));

/**
 * Express: adopt the gateway's X-Request-Id (or make one, e.g. for Next.js server-side calls that skip the
 * gateway), echo it back, run the rest of the request inside its context and log one line when it ends.
 * Only the path is logged: query strings can carry reset/verify tokens.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomBytes(16).toString('hex');
  res.setHeader('X-Request-Id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    ctx.run(id, () =>
      log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
        method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms),
      })
    );
  });
  ctx.run(id, next);
}
