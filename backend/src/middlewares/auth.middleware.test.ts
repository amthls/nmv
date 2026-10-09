import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenRevoked } from './auth.middleware';

const cutoff = new Date('2026-10-09T12:00:00Z');
const cutoffSec = cutoff.getTime() / 1000;

test('token issued before the cutoff is revoked', () => {
  assert.equal(isTokenRevoked({ iat: cutoffSec - 1 }, cutoff), true);
});

test('token issued in the cutoff second is accepted (the new login right after a password change)', () => {
  assert.equal(isTokenRevoked({ iat: cutoffSec }, cutoff), false);
  assert.equal(isTokenRevoked({ iat: cutoffSec }, new Date(cutoff.getTime() + 999)), false);
});

test('no tokens_valid_after accepts any token', () => {
  assert.equal(isTokenRevoked({ iat: 1 }, null), false);
  assert.equal(isTokenRevoked({ iat: 1 }, undefined), false);
});

test('missing iat is revoked once a cutoff exists', () => {
  assert.equal(isTokenRevoked({}, cutoff), true);
  assert.equal(isTokenRevoked({ iat: String(cutoffSec) }, cutoff), true);
});

test('cutoff given as a string (raw pg value) works', () => {
  assert.equal(isTokenRevoked({ iat: cutoffSec - 1 }, cutoff.toISOString()), true);
});
