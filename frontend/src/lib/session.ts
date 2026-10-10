/**
 * Session plumbing shared by every API call. Sign-in lives in the identity service: it keeps the session in
 * httpOnly cookies (nh_access 15 min, nh_refresh 30 days), so no token ever touches JS or localStorage.
 *  - writes (POST/PUT/PATCH/DELETE) echo the readable nh_csrf cookie in X-CSRF-Token;
 *  - a 401 means the 15-minute access cookie ran out: refresh once (shared by concurrent calls) and retry.
 */

export const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL || '/api/identity';

export function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)nh_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let refreshing: Promise<boolean> | null = null;

/** Rotate the session cookies; false when there is no session to refresh (signed out). */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${IDENTITY_URL}/refresh`, { method: 'POST', credentials: 'include' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => { refreshing = null; }, 0);
      });
  }
  return refreshing;
}

function withSession(options: RequestInit): RequestInit {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (UNSAFE.has(method) && csrfToken()) headers.set('X-CSRF-Token', csrfToken());
  return { ...options, headers, credentials: 'include' };
}

/** fetch for our own APIs: cookies, CSRF header, one refresh-and-retry on 401. */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, withSession(options));
  if (res.status !== 401 || url.startsWith(`${IDENTITY_URL}/refresh`) || url.startsWith(`${IDENTITY_URL}/login`)) return res;
  if (!(await refreshSession())) return res;
  return fetch(url, withSession(options)); // a FormData/string body can be sent again; streams are not used here
}
