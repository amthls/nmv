import { pool } from '../config/db';
import { startEventConsumer } from './eventConsumer';
import { internalAuthHeader } from '../middlewares/auth.middleware';
import { disconnectUser } from './realtime';
import { enqueueNotificationJob } from './queue.service';

/**
 * The backend's `users` / `user_roles` are a copy of identity's accounts (public fields only), kept in step by
 * identity.user.* events on the novelhub.events exchange (schemas: events/). Each event is applied once
 * (processed_events) and only if its version is newer than the copy's (users.identity_version), so duplicates
 * and reordering are harmless. The profile (display name, avatar, bio, banner) stays owned here: identity's
 * display_name only seeds a new row. See Plan/identity.md.
 */

const IDENTITY_URL = (process.env.IDENTITY_INTERNAL_URL || 'http://identity:8080').replace(/\/+$/, '');

export interface UserSnapshot {
  id: string;
  version: number;
  username: string;
  display_name: string | null;
  email_verified?: boolean;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  banned_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  roles: { role: string; is_visible: boolean }[];
  purge_content?: boolean;
}

const ROLES = new Set(['admin', 'mod', 'translator', 'author', 'reader']);

/** Write a snapshot into the copy (inside the caller's transaction). Returns false if it was not newer. */
export async function applyUserSnapshot(client: any, u: UserSnapshot, deleted = false): Promise<boolean> {
  if (!u?.id || typeof u.version !== 'number' || typeof u.username !== 'string') throw new Error('invalid user snapshot');
  const r = await client.query(
    `INSERT INTO users (id, username, display_name, email_verified, is_banned, ban_reason, banned_at, banned_by,
                        deleted_at, deleted_by, created_at, identity_version)
     VALUES ($1, $2, $3, COALESCE($4, false), $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username, email_verified = EXCLUDED.email_verified, is_banned = EXCLUDED.is_banned,
       ban_reason = EXCLUDED.ban_reason, banned_at = EXCLUDED.banned_at, banned_by = EXCLUDED.banned_by,
       deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by,
       identity_version = EXCLUDED.identity_version, updated_at = NOW()
     WHERE users.identity_version < EXCLUDED.identity_version
     RETURNING (xmax = 0) AS inserted`,
    [u.id, u.username, u.display_name, u.email_verified ?? null, u.is_banned, u.ban_reason, u.banned_at,
      u.banned_by, u.deleted_at, u.deleted_by, u.created_at, u.version]
  );
  if (r.rowCount === 0) return false;
  if (r.rows[0].inserted) {
    await client.query(`INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
  }

  const roles = (u.roles || []).filter((x) => ROLES.has(x.role));
  await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND NOT (role::text = ANY($2::text[]))`, [u.id, roles.map((x) => x.role)]);
  for (const x of roles) {
    await client.query(
      `INSERT INTO user_roles (user_id, role, is_visible) VALUES ($1, $2::user_role, $3)
       ON CONFLICT (user_id, role) DO UPDATE SET is_visible = EXCLUDED.is_visible`,
      [u.id, x.role, x.is_visible]
    );
  }

  if (deleted && u.deleted_at) {
    // Content stays (stories, chapters reference the author); everything personal goes
    await client.query(
      `UPDATE users SET display_name = 'Người dùng đã xóa', avatar_url = NULL, banner_url = NULL, bio = NULL WHERE id = $1`, [u.id]);
    await client.query(`DELETE FROM user_settings WHERE user_id = $1`, [u.id]);
    await client.query(`DELETE FROM group_members WHERE user_id = $1`, [u.id]);
    await client.query(`DELETE FROM group_join_requests WHERE user_id = $1 AND status = 'pending'`, [u.id]);
    await client.query(`DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1`, [u.id]);
    // purge_content (posts, comments): the community service applies the same event
  }
  return true;
}

/** Signed up a moment ago and the event is late: fetch the snapshot from identity directly. Never throws. */
export async function readThroughUser(id: string): Promise<void> {
  try {
    const res = await fetch(`${IDENTITY_URL}/internal/users/${encodeURIComponent(id)}`, {
      headers: { 'X-Internal-Auth': internalAuthHeader('identity') },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const { data } = (await res.json()) as { data: UserSnapshot };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await applyUserSnapshot(client, data, Boolean(data?.deleted_at));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn(`[identity] read-through for ${id} failed: ${err.message}`);
  }
}

/** Site notification to every admin, once per key (the site has no external alerting). */
export async function notifyAdmins(key: string, title: string, message: string) {
  const admins = await pool.query(`SELECT DISTINCT user_id FROM user_roles WHERE role = 'admin'`);
  await enqueueNotificationJob({
    kind: 'notify',
    items: admins.rows.map((r: any) => ({
      userId: r.user_id, type: 'admin_alert' as const, title: String(title).slice(0, 300), message: String(message),
      referenceType: null, referenceId: null, senderId: null, dedupeKey: `${key}:${r.user_id}`,
    })),
  });
}

/** Apply one event exactly once. Throws to have it retried. */
export async function handleIdentityEvent(evt: any): Promise<string> {
  if (!evt?.event_id || typeof evt.type !== 'string' || typeof evt.data !== 'object') throw new Error('malformed event');
  const client = await pool.connect();
  let outcome = 'skipped';
  const sideEffects: Array<() => void> = [];
  try {
    await client.query('BEGIN');
    const seen = await client.query(
      `INSERT INTO processed_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`, [evt.event_id, evt.type]);
    if (seen.rowCount === 0) {
      outcome = 'duplicate';
    } else if (evt.type.startsWith('identity.user.')) {
      const deleted = evt.type === 'identity.user.deleted';
      if (await applyUserSnapshot(client, evt.data, deleted)) {
        outcome = 'applied';
        if (evt.data.is_banned || evt.data.deleted_at) sideEffects.push(() => disconnectUser(evt.data.id));
      } else {
        outcome = 'stale';
      }
    } else if (evt.type === 'identity.alert') {
      const { key, title, message } = evt.data;
      sideEffects.push(() => notifyAdmins(`identity:${key}`, title, message).catch((e) => console.error('[identity] alert:', e.message)));
      outcome = 'applied';
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  sideEffects.forEach((f) => f());
  return outcome;
}

/** Worker: identity.user.* -> the users/user_roles copy, identity.alert -> admin notifications. */
export const startIdentityConsumer = (onClose: () => void) =>
  startEventConsumer({ queue: 'backend.identity', bindings: ['identity.user.*', 'identity.alert'], label: 'identity-sync', handle: handleIdentityEvent, onClose });
