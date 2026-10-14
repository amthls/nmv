import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

process.env.USER_SIG_KEY_MEDIA = 'm'.repeat(32);
const auth = import('./auth'); // reads the key once, at load

const headers = (key: string, id = 'u1', roles = 'reader', exp = String(Math.floor(Date.now() / 1000) + 60)) => ({
  'x-user-id': id, 'x-user-roles': roles, 'x-user-exp': exp,
  'x-user-sig': crypto.createHmac('sha256', key).update(`${id}|${roles}|${exp}`).digest('hex'),
});
const req = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] }) as any;

test('only headers identity signed for the media service are believed', async () => {
  const { userFromHeaders } = await auth;
  assert.equal(userFromHeaders(req(headers('m'.repeat(32)))), 'u1');
  assert.equal(userFromHeaders(req(headers('k'.repeat(32)))), null); // the backend's key
  assert.equal(userFromHeaders(req({ ...headers('m'.repeat(32)), 'x-user-roles': 'admin' })), null);
  assert.equal(userFromHeaders(req(headers('m'.repeat(32), 'u1', 'reader', '1'))), null); // expired
  assert.equal(userFromHeaders(req({ 'x-user-id': 'u1' })), null);
});
