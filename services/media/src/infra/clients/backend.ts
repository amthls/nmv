import crypto from 'crypto';
import { BACKEND_KEY, BACKEND_URL } from '../../config';
import { currentRequestId } from '../../common/utils/logger';

/** Call the backend internal API (X-Internal-Auth signed with the backend key). Never throws on 4xx. */
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
