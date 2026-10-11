import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.USER_SIG_KEY_CATALOG = 'k'.repeat(32);
process.env.INTERNAL_KEY_CATALOG = 'b'.repeat(32);
process.env.INTERNAL_KEY_WORKSPACE = 'w'.repeat(32);
// Loaded after the key is set (the module reads it once)
const auth = import('./auth.middleware');

test('signed identity headers are accepted, with roles', async () => {
  const { identityFromHeaders, signIdentityHeaders } = await auth;
  const h = Object.fromEntries(Object.entries(signIdentityHeaders('u1', ['admin', 'reader'])).map(([k, v]) => [k.toLowerCase(), v]));
  assert.deepEqual(identityFromHeaders(h), { id: 'u1', roles: ['admin', 'reader'] });
});

test('tampered, expired, unsigned or foreign-key headers are a guest', async () => {
  const { identityFromHeaders, signIdentityHeaders } = await auth;
  const h = Object.fromEntries(Object.entries(signIdentityHeaders('u1', ['reader'])).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(identityFromHeaders({ ...h, 'x-user-roles': 'admin' }), null);
  assert.equal(identityFromHeaders({ ...h, 'x-user-id': 'u2' }), null);
  assert.equal(identityFromHeaders({ 'x-user-id': 'u1', 'x-user-roles': 'admin' }), null);
  assert.equal(identityFromHeaders(h, Date.now() + 5 * 60_000), null);
  assert.equal(identityFromHeaders({ ...h, 'x-user-sig': 'zz' }), null);
});

test('internal service auth', async () => {
  const { internalAuthOK, internalAuthHeader } = await auth;
  const crypto = await import('crypto');
  const exp = String(Math.floor(Date.now() / 1000) + 120);
  const fromWorkspace = `${exp}.${crypto.createHmac('sha256', 'b'.repeat(32)).update(`internal|${exp}`).digest('hex')}`;
  assert.equal(internalAuthOK(fromWorkspace), true);
  assert.equal(internalAuthOK(fromWorkspace, Date.now() + 5 * 60_000), false);
  // what the backend sends to the workspace is signed with the workspace's key: no good here
  assert.equal(internalAuthOK(internalAuthHeader('workspace')), false);
  assert.equal(internalAuthOK('123.abc'), false);
  assert.equal(internalAuthOK(undefined), false);
});
