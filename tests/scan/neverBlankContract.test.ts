import assert from 'node:assert/strict';
import test from 'node:test';

import { enforceNeverBlank } from '../../lib/scan/neverBlank';

test('enforceNeverBlank returns at least two sentences and avoids placeholder ending', () => {
  const lines = enforceNeverBlank({
    lines: ['Not provided by source'],
    fallback: ['Missing directions in this record', 'Add the Directions panel to improve guidance'],
  });

  assert.ok(lines.length >= 2);
  assert.ok(!/not provided/i.test(lines[lines.length - 1] ?? ''));
});

test('enforceNeverBlank preserves meaningful lines and caps to max', () => {
  const lines = enforceNeverBlank({
    lines: ['Line one', 'Line two', 'Line three', 'Line four', 'Line five', 'Line six'],
    fallback: ['fallback a', 'fallback b'],
    maxSentences: 5,
  });

  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'Line one.');
});
