import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOdsPanelSections } from '@/lib/scan/odsPanelMode';

test('science mode shows overview/what-it-does but not safety sections', () => {
  const sections = resolveOdsPanelSections({
    mode: 'science',
    hasOverview: true,
    whatItDoesCount: 2,
    watchOutsCount: 3,
    interactionCount: 1,
    ulCount: 1,
  });
  assert.equal(sections.showOverview, true);
  assert.equal(sections.showWhatItDoes, true);
  assert.equal(sections.showWatchOuts, false);
  assert.equal(sections.showInteractions, false);
  assert.equal(sections.showUl, false);
});

test('safety mode shows watch-outs/interactions/ul but not science sections', () => {
  const sections = resolveOdsPanelSections({
    mode: 'safety',
    hasOverview: true,
    whatItDoesCount: 2,
    watchOutsCount: 3,
    interactionCount: 1,
    ulCount: 1,
  });
  assert.equal(sections.showOverview, false);
  assert.equal(sections.showWhatItDoes, false);
  assert.equal(sections.showWatchOuts, true);
  assert.equal(sections.showInteractions, true);
  assert.equal(sections.showUl, true);
});
