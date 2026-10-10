import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from './logger';

test('redact hides tokens, passwords and emails', () => {
  const out = redact(
    'login a.b+c@mail.vn Authorization: Bearer abc.def password=hunter2 {"token":"t0k"} ' +
      'postgres://postgres:s3cret@pgbouncer:5432/db eyJhbGciOi.eyJpZCI6.sig'
  );
  for (const leak of ['a.b+c@mail.vn', 'abc.def', 'hunter2', 't0k', 's3cret', 'eyJhbGciOi']) {
    assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  }
  assert.ok(out.includes('postgres://postgres:[redacted]@pgbouncer'));
});

test('redact leaves ordinary text alone', () => {
  const msg = 'Story 42 published in 120 ms by user 7f3a';
  assert.equal(redact(msg), msg);
});
