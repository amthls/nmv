import { redis, redisReady } from '../config/redis';

/**
 * Realtime "something changed" pings. The messaging service holds the browsers' WebSockets; any process here
 * (API copies, worker) PUBLISHes `{users, type, data}` on the Redis channel `rt:events` and every messaging copy
 * pushes it to those users' open tabs. Browsers then refetch through the normal REST API, so permissions stay
 * in one place. Events: `notification`, `dm`, `group_message`. Without Redis nothing is pushed (pages poll).
 */
const CHANNEL = 'rt:events';

function publish(users: string[], type: string, data: Record<string, unknown>) {
  if (users.length === 0 || !redis || !redisReady()) return;
  redis.publish(CHANNEL, JSON.stringify({ users, type, data })).catch((err) => console.warn('[Realtime] publish failed:', err.message));
}

/** Fire-and-forget push to the given users' open tabs. Never throws. */
export function emitToUsers(userIds: Iterable<string | null | undefined>, event: string, payload: Record<string, unknown> = {}) {
  publish(Array.from(new Set(Array.from(userIds).filter(Boolean) as string[])), event, payload);
}

/** Close every open socket of a user (banned, deleted, sessions revoked). Never throws. */
export function disconnectUser(userId: string) {
  publish([userId], '_disconnect', {});
}
