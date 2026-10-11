import { internalAuthHeader } from '../middlewares/auth.middleware';
import { currentRequestId } from '../utils/logger';

/** Follows, bookmarks, reading history, albums live in the library service (Plan/library.md); the backend asks it. */
const LIBRARY_URL = (process.env.LIBRARY_INTERNAL_URL || 'http://library:8080').replace(/\/+$/, '');

export async function callLibrary(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<{ status: number; json: any }> {
  const res = await fetch(`${LIBRARY_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalAuthHeader('library'),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** GET a library internal path's {data}; throws unless 200. */
export async function libraryData<T = any>(path: string, timeoutMs?: number): Promise<T> {
  const r = await callLibrary('GET', path, undefined, timeoutMs);
  if (r.status !== 200) throw new Error(`library ${path}: HTTP ${r.status}`);
  return r.json.data as T;
}

/** The backend deleted stories/chapters: their history, bookmarks, follows, album places go too. Never throws. */
export async function purgeLibrary(ids: { story_ids?: string[]; chapter_ids?: string[] }) {
  try {
    const r = await callLibrary('POST', '/internal/purge', ids);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  } catch (err: any) {
    console.error(`[library] purge of ${JSON.stringify(ids)} failed (the nightly reconcile drops the copies): ${err.message}`);
  }
}
