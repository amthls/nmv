export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
export { IDENTITY_URL } from './session';
export const MESSAGING_URL = '/api/msg'; // direct messages and group chat (messaging service)
export const COMMUNITY_URL = '/api/community'; // Fandom posts, comments, reports, removed content (community service)
export const LIBRARY_URL = '/api/library'; // reading history, follows, bookmarks, albums (library service)
export const REC_URL = '/api/rec'; // "Đề xuất cho bạn", "Truyện liên quan" (recommender service)

/**
 * Call the API with an optional JSON body. `ok` is false on HTTP errors and on `{ success: false }`.
 * Pass `authFetch` for signed-in calls, plain `fetch` otherwise. Throws only on network errors.
 * `base` is the backend API by default; pass IDENTITY_URL for account calls.
 */
export async function apiJson(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  path: string,
  init?: RequestInit & { json?: unknown },
  base: string = API_BASE_URL
): Promise<{ ok: boolean; json: any }> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetchFn(`${base}${path}`, {
    ...rest,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : rest.headers,
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, json };
}
