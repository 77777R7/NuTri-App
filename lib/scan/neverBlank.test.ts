import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeScanDisplayText } from '@/lib/scan/neverBlank';

test('sanitizeScanDisplayText trims usable copy', () => {
  assert.equal(sanitizeScanDisplayText('  Supports your immunity goal  '), 'Supports your immunity goal');
});

test('sanitizeScanDisplayText hides placeholder-like copy', () => {
  assert.equal(sanitizeScanDisplayText('undefined'), null);
  assert.equal(sanitizeScanDisplayText('  not available.  '), null);
  assert.equal(sanitizeScanDisplayText(null), null);
});
