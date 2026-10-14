import { BACKEND_KEY, BACKEND_URL } from './config';
import { internalHeader } from './auth';
import { currentRequestId } from './logger';

/**
 * People (names, avatars, roles) and stories/chapters live in the backend; community asks its internal API and keeps the
 * answers a minute. shortcut: API + small cache instead of ext_ copies kept by events (the backend has no outbox for
 * profiles/stories yet); switch when the backend becomes `catalog` (stage I).
 */

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
  is_banned: boolean;
  deleted: boolean;
}

export interface StoryBrief {
  id: string;
  title: string;
  slug: string;
  cover_image_url: string | null;
  story_type: string;
  author_name: string | null;
  code: string;
  approval_status: string;
}

export interface ChapterBrief {
  id: string;
  story_id: string;
  title: string;
  slug: string;
  chapter_number: string;
}

export async function callBackend(method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalHeader(BACKEND_KEY),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const TTL = 60_000;
const MAX_CACHED = 20_000;

/** A per-process cache of backend answers by id; missing ids are asked in one call. */
function cachedLookup<T extends { id: string }>(ask: (ids: string[]) => Promise<T[]>) {
  const cache = new Map<string, { v: T | null; exp: number }>();
  return async (ids: (string | null | undefined)[]): Promise<Map<string, T>> => {
    const now = Date.now();
    const out = new Map<string, T>();
    const missing = new Set<string>();
    for (const id of ids) {
      if (!id) continue;
      const hit = cache.get(id);
      if (hit && hit.exp > now) {
        if (hit.v) out.set(id, hit.v);
      } else missing.add(id);
    }
    if (missing.size > 0) {
      const got = await ask([...missing]);
      if (cache.size > MAX_CACHED) cache.clear();
      for (const v of got) {
        cache.set(v.id, { v, exp: now + TTL });
        out.set(v.id, v);
      }
      for (const id of missing) if (!out.has(id)) cache.set(id, { v: null, exp: now + TTL }); // no such row
    }
    return out;
  };
}

async function askOrThrow(path: string, body: unknown): Promise<any> {
  const r = await callBackend('POST', path, body);
  if (r.status !== 200) throw new Error(`backend ${path}: HTTP ${r.status}`);
  return r.json.data;
}

/** Profiles by user id (deleted and banned accounts come back flagged; unknown ids are left out). */
export const profiles = cachedLookup<Profile>(async (ids) => {
  const out: Profile[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...(await askOrThrow('/internal/users/profiles', { ids: ids.slice(i, i + 500) })));
  return out;
});

export const stories = cachedLookup<StoryBrief>(async (ids) => (await askOrThrow('/internal/stories/brief', { story_ids: ids })).stories);
export const chapters = cachedLookup<ChapterBrief>(async (ids) => (await askOrThrow('/internal/stories/brief', { chapter_ids: ids })).chapters);

/** A person by exact username (not cached: usernames can be renamed). */
export async function profileByUsername(username: string): Promise<Profile | null> {
  const got: Profile[] = await askOrThrow('/internal/users/profiles', { usernames: [username] });
  return got[0] || null;
}

/** The author fields every post / comment row carries, from a profile (unknown: a deleted account). */
export function authorFields(p: Profile | undefined) {
  return {
    username: p?.username ?? null,
    display_name: p ? p.display_name : 'Người dùng đã xóa',
    avatar_url: p?.avatar_url ?? null,
    roles: p?.roles ?? [],
  };
}
