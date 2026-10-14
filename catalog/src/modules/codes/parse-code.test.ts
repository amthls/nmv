import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode } from './parse-code';

test('each kind is found by its fixed number only', () => {
  assert.deepEqual(parseCode('U-AD-26-0007'), { kind: 'user', no: 7 });
  assert.deepEqual(parseCode('G03'), { kind: 'group', no: 3 });
  assert.deepEqual(parseCode('LN-JA-G03-0042'), { kind: 'story', no: 42 });
  assert.deepEqual(parseCode('P-RV-26-0015'), { kind: 'post', no: 15 });
  assert.deepEqual(parseCode('AL-0007-26-0184'), { kind: 'album', no: 184 });
  assert.deepEqual(parseCode('RP-CM-26-0001'), { kind: 'report', no: 1 });
});

test('chapters keep the chapter number, half chapters included', () => {
  assert.deepEqual(parseCode('MG-KO-G00-0002-C12'), { kind: 'chapter', no: 2, chapter: '12' });
  assert.deepEqual(parseCode('LN-JA-G01-0001-C12.5'), { kind: 'chapter', no: 1, chapter: '12.5' });
});

test('lower case, spaces and numbers past 9999 are accepted', () => {
  assert.deepEqual(parseCode('  u-rd-26-12345 '), { kind: 'user', no: 12345 });
});

test('an outdated role or group part still resolves (only the number counts)', () => {
  assert.deepEqual(parseCode('U-RD-26-0007'), parseCode('U-TR-26-0007'));
  assert.deepEqual(parseCode('LN-JA-G00-0042'), parseCode('LN-JA-G03-0042'));
});

test('garbage is rejected', () => {
  for (const bad of ['', 'U-AD-0007', 'X-AD-26-0007', 'LN-JA-0042', "G1'; DROP", 'LN-JA-G03-0042-C']) {
    assert.equal(parseCode(bad), null, bad);
  }
});
