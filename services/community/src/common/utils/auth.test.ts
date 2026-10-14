import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.USER_SIG_KEY_COMMUNITY = 'c'.repeat(32);
process.env.INTERNAL_KEY_COMMUNITY = 'i'.repeat(32);
const auth = import('./auth'); // reads the keys once, at load
const notify = import('../../modules/notify/notify.service');

const headers = (key: string, id = 'u1', roles = 'reader,mod', exp = String(Math.floor(Date.now() / 1000) + 60)) => ({
  'x-user-id': id, 'x-user-roles': roles, 'x-user-exp': exp,
  'x-user-sig': crypto.createHmac('sha256', key).update(`${id}|${roles}|${exp}`).digest('hex'),
});
const req = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as any;

test('only headers identity signed for community are believed, roles included', async () => {
  const { userFromHeaders } = await auth;
  assert.deepEqual(userFromHeaders(req(headers('c'.repeat(32)))), { id: 'u1', roles: ['reader', 'mod'] });
  assert.equal(userFromHeaders(req(headers('k'.repeat(32)))), null); // another service's key
  assert.equal(userFromHeaders(req({ ...headers('c'.repeat(32)), 'x-user-roles': 'admin' })), null); // roles not signed
  assert.equal(userFromHeaders(req(headers('c'.repeat(32), 'u1', 'reader', '1'))), null); // expired
  assert.equal(userFromHeaders(req({ 'x-user-id': 'u1' })), null);
});

test('internal calls need INTERNAL_KEY_COMMUNITY, not yet expired', async () => {
  const { internalAuthOK, internalHeader } = await auth;
  assert.equal(internalAuthOK(internalHeader('i'.repeat(32))), true);
  assert.equal(internalAuthOK(internalHeader('b'.repeat(32))), false);
  assert.equal(internalAuthOK(internalHeader('i'.repeat(32), Date.now() - 10 * 60_000)), false);
  assert.equal(internalAuthOK(undefined), false);
});

test('a comment notifies the parent author and the post owner once each, never the author', async () => {
  const { commentNotifications } = await notify;
  const base = { commentId: 'c1', actorId: 'a', actorName: 'An', content: 'hay quá', targetType: 'post' as const, targetId: 'p1' };
  const items = commentNotifications({ ...base, postOwnerId: 'o', parentAuthorId: 'o' });
  assert.deepEqual(items.map((i) => [i.userId, i.type]), [['o', 'comment_reply']]);
  assert.equal(commentNotifications({ ...base, postOwnerId: 'a', parentAuthorId: 'a' }).length, 0);
  assert.deepEqual(commentNotifications({ ...base, postOwnerId: 'o', parentAuthorId: 'r' }).map((i) => i.userId), ['r', 'o']);
});
