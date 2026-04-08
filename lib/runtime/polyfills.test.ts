import assert from 'node:assert/strict';
import test from 'node:test';

const clearPolyfills = () => {
  delete (Array.prototype as Array<unknown> & {
    at?: unknown;
    findLast?: unknown;
    findLastIndex?: unknown;
    flat?: unknown;
    flatMap?: unknown;
  }).at;
  delete (Array.prototype as Array<unknown> & {
    at?: unknown;
    findLast?: unknown;
    findLastIndex?: unknown;
    flat?: unknown;
    flatMap?: unknown;
  }).findLast;
  delete (Array.prototype as Array<unknown> & {
    at?: unknown;
    findLast?: unknown;
    findLastIndex?: unknown;
    flat?: unknown;
    flatMap?: unknown;
  }).findLastIndex;
  delete (Array.prototype as Array<unknown> & {
    at?: unknown;
    findLast?: unknown;
    findLastIndex?: unknown;
    flat?: unknown;
    flatMap?: unknown;
  }).flat;
  delete (Array.prototype as Array<unknown> & {
    at?: unknown;
    findLast?: unknown;
    findLastIndex?: unknown;
    flat?: unknown;
    flatMap?: unknown;
  }).flatMap;
  delete (Object as typeof Object & { fromEntries?: unknown; hasOwn?: unknown }).fromEntries;
  delete (Object as typeof Object & { fromEntries?: unknown; hasOwn?: unknown }).hasOwn;
  delete (String.prototype as String & { replaceAll?: unknown }).replaceAll;
};

test('runtime polyfills install missing array and object helpers', async () => {
  clearPolyfills();
  const { installRuntimePolyfills } = await import('./polyfills');
  installRuntimePolyfills();

  assert.equal([1, 2, 3].at?.(-1), 3);
  assert.equal([1, 2, 3, 4].findLast?.((value) => value % 2 === 0), 4);
  assert.equal([1, 2, 3, 4].findLastIndex?.((value) => value % 2 === 0), 3);
  assert.deepEqual([1, [2, [3]]].flat?.(2), [1, 2, 3]);
  assert.deepEqual([1, 2, 3].flatMap?.((value) => [value, value * 10]), [1, 10, 2, 20, 3, 30]);
  assert.deepEqual(Object.fromEntries?.([['a', 1], ['b', 2]]), { a: 1, b: 2 });
  assert.equal(Object.hasOwn?.({ a: 1 }, 'a'), true);
  assert.equal('a-b-a'.replaceAll?.('a', 'z'), 'z-b-z');
});
