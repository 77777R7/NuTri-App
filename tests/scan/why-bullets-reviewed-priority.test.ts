import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWhyBullets } from '@/lib/scan/insightsAssembler';

test('WHY bullets prefer reviewed segment sentence over deterministic fallback copy', () => {
  const reviewedSentence = 'Reviewed absorption sentence.';

  const result = buildWhyBullets({
    ingredientName: 'Vitamin D',
    formText: null,
    formSource: 'inferred',
    formLabel: 'cholecalciferol',
    matchScore: 0.62,
    evidenceGrade: 'B',
    rbfFactor: 1.12,
    rbfBand: 'high',
    doseSignal: {
      status: 'within_typical',
      dailyAmount: 25,
      unit: 'mcg',
    },
    reviewedSegments: {
      absorption: [reviewedSentence],
      solubility: [],
      tolerability: [],
      caveats: [],
    },
  });

  assert.ok(result.bullets.length >= 3);
  assert.ok(result.bullets.some((line) => line.includes(reviewedSentence)));
  assert.ok(
    result.bullets.every(
      (line) => !line.includes('Why this band: this estimate comes from reviewed evidence for the detected form; individual response varies'),
    ),
  );
});
