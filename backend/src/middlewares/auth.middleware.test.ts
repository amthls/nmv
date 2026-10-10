import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_HEADER_KEY = 'k'.repeat(32);
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
  assert.equal(internalAuthOK(internalAuthHeader()), true);
  assert.equal(internalAuthOK(internalAuthHeader(), Date.now() + 5 * 60_000), false);
  assert.equal(internalAuthOK('123.abc'), false);
  assert.equal(internalAuthOK(undefined), false);
});
