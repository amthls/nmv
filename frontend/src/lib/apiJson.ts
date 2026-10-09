export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/**
 * Call the API with an optional JSON body. `ok` is false on HTTP errors and on `{ success: false }`.
 * Pass `authFetch` for signed-in calls, plain `fetch` otherwise. Throws only on network errors.
 */
export async function apiJson(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<{ ok: boolean; json: any }> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetchFn(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : rest.headers,
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, json };
}
