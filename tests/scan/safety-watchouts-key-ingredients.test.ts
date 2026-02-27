import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOdsPanelSections } from '@/lib/scan/odsPanelMode';
import { buildSafetyWatchouts } from '@/lib/scan/useAnalysisBundleViewModel';

test('buildSafetyWatchouts returns foundation watch-outs when available', () => {
  const rows = buildSafetyWatchouts(['Vitamin D', 'Calcium']);
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((line) => /vitamin d|calcium/i.test(line)));
});

test('buildSafetyWatchouts returns fallback sentence for unknown ingredients', () => {
  const rows = buildSafetyWatchouts(['MadeUpIngredientXYZ']);
  assert.equal(rows.length, 1);
  assert.match(rows[0] ?? '', /No ODS watch-outs were matched/i);
});

test('science mode hides watch-outs section while safety mode shows it', () => {
  const science = resolveOdsPanelSections({
    mode: 'science',
    hasOverview: true,
    whatItDoesCount: 2,
    watchOutsCount: 2,
    interactionCount: 1,
    ulCount: 1,
  });
  const safety = resolveOdsPanelSections({
    mode: 'safety',
    hasOverview: true,
    whatItDoesCount: 2,
    watchOutsCount: 2,
    interactionCount: 1,
    ulCount: 1,
  });

  assert.equal(science.showWatchOuts, false);
  assert.equal(science.showWhatItDoes, true);
  assert.equal(safety.showWatchOuts, true);
  assert.equal(safety.showWhatItDoes, false);
});
