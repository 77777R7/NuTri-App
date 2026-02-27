import assert from 'node:assert/strict';
import test from 'node:test';

import { computeScienceDisplayStatus, computeScienceInsightCoverage } from '../../lib/scan/scienceInsightCoverage';

test('computeScienceInsightCoverage: allMissing=true when module2 signals are absent', () => {
  const coverage = computeScienceInsightCoverage({
    insights: [],
    ingredientDetails: [
      {
        chemicalFormExplain: {
          text: 'Not provided by source',
          basisTags: ['not_provided'],
        },
      },
    ],
  });

  assert.equal(coverage.hasFormSignal, false);
  assert.equal(coverage.hasRbfSignal, false);
  assert.equal(coverage.hasDoseSignal, false);
  assert.equal(coverage.allMissing, true);
});

test('computeScienceDisplayStatus: complete + allMissing => limited (display override only)', () => {
  const coverage = computeScienceInsightCoverage({
    insights: [],
    ingredientDetails: [],
  });

  assert.equal(computeScienceDisplayStatus('complete', coverage), 'limited');
  assert.equal(computeScienceDisplayStatus('limited', coverage), 'limited');
  assert.equal(computeScienceDisplayStatus('pending', coverage), 'pending');
});

test('computeScienceInsightCoverage: form/rbf/dose signals produce non-missing coverage', () => {
  const coverage = computeScienceInsightCoverage({
    insights: [
      {
        formLabel: 'Bisglycinate',
        matchScore: 0.58,
        confidenceTier: 'high',
        effectiveFactor: 1.14,
        rbfBand: 'high',
        doseSignal: { status: 'within_typical' },
      },
    ],
    ingredientDetails: [],
  });

  assert.equal(coverage.hasFormSignal, true);
  assert.equal(coverage.hasRbfSignal, true);
  assert.equal(coverage.hasDoseSignal, true);
  assert.equal(coverage.allMissing, false);
  assert.equal(computeScienceDisplayStatus('complete', coverage), 'complete');
});
