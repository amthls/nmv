// node --experimental-strip-types --test src/lib/coalesce.test.ts (no test framework in the frontend)
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { coalesce } from './coalesce.ts';

test('a burst runs once now and once after the window, a single trailing push keeps its data', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const calls: unknown[] = [];
  const c = coalesce<string>((a) => calls.push(a), 1500);
  c.push('a');
  assert.deepEqual(calls, ['a']);
  for (let i = 0; i < 100; i++) c.push('x' + i);
  assert.equal(calls.length, 1);
  mock.timers.tick(1500);
  assert.deepEqual(calls, ['a', undefined]); // 100 folded -> no data
  c.push('only');
  mock.timers.tick(1500);
  assert.deepEqual(calls, ['a', undefined, 'only']);
  mock.timers.tick(1500); // quiet: nothing more, the next push runs at once again
  c.push('b');
  assert.deepEqual(calls, ['a', undefined, 'only', 'b']);
  c.cancel();
  mock.timers.reset();
});
