import { internalAuthHeader } from '../../middlewares/auth.middleware';
import { currentRequestId } from '../../utils/logger';

/** Posts, comments and reports live in the community service (Plan/community.md); the backend asks its internal API. */
const COMMUNITY_URL = (process.env.COMMUNITY_INTERNAL_URL || 'http://community:8080').replace(/\/+$/, '');

export async function callCommunity(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${COMMUNITY_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Auth': internalAuthHeader('community'),
      ...(currentRequestId() ? { 'X-Request-Id': currentRequestId()! } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Someone's posts and comments for their profile; zeros (logged) when community does not answer. */
export async function communityStats(userId: string): Promise<{ posts: number; approved_posts: number; comments: number; comment_likes: number }> {
  try {
    const r = await callCommunity('GET', `/internal/users/${userId}/stats`);
    if (r.status === 200) return r.json.data;
    throw new Error(`HTTP ${r.status}`);
  } catch (err: any) {
    console.warn(`[community] stats of ${userId} unavailable: ${err.message}`);
    return { posts: 0, approved_posts: 0, comments: 0, comment_likes: 0 };
  }
}
