import { internalAuthHeader } from '../middlewares/auth.middleware';
import { currentRequestId } from '../utils/logger';

/** Direct messages live in the messaging service (Plan/messaging.md, E2); the backend only sends workspace draft cards. */
const MESSAGING_URL = (process.env.MESSAGING_INTERNAL_URL || 'http://messaging:8080').replace(/\/+$/, '');

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${MESSAGING_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalAuthHeader('messaging'),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Either blocked the other: they can't message each other. */
export async function dmBlocked(a: string, b: string): Promise<boolean> {
  const r = await call('GET', `/internal/blocked?a=${a}&b=${b}`);
  if (r.status !== 200) throw new Error(`messaging /internal/blocked: HTTP ${r.status}`);
  return Boolean(r.json.data?.blocked);
}

/** A direct message carrying a workspace draft card. Throws unless it was stored. */
export async function sendDraftCard(from: string, to: string, message: string, draftId: string) {
  const r = await call('POST', '/internal/dm', { from, to, message, draft_id: draftId });
  if (r.status !== 201) throw new Error(`messaging /internal/dm: HTTP ${r.status} ${r.json.message || ''}`);
}
