import assert from 'node:assert/strict';
import test from 'node:test';

import { toConfidenceTier, toRbfBand, buildWhyBullets } from '../../lib/scan/insightsAssembler';

test('toRbfBand applies locked thresholds', () => {
  assert.equal(toRbfBand(1.1), 'high');
  assert.equal(toRbfBand(0.95), 'normal');
  assert.equal(toRbfBand(0.89), 'low');
  assert.equal(toRbfBand(null), 'unknown');
});

test('toConfidenceTier applies locked thresholds', () => {
  assert.equal(toConfidenceTier(0.56, 'A'), 'high');
  assert.equal(toConfidenceTier(0.45, null), 'medium');
  assert.equal(toConfidenceTier(0.36, null), 'low');
  assert.equal(toConfidenceTier(0.2, null), 'none');
});

test('buildWhyBullets always returns 2-4 actionable bullets', () => {
  const result = buildWhyBullets({
    ingredientName: 'Vitamin D',
    formText: null,
    formSource: 'none',
    formLabel: null,
    matchScore: 0.4,
    evidenceGrade: 'C',
    rbfFactor: null,
    rbfBand: 'unknown',
    doseSignal: null,
    reviewedSegments: null,
  });

  assert.ok(result.bullets.length >= 2 && result.bullets.length <= 4);
  assert.ok(result.layerTags.length >= 1);
});

test('buildWhyBullets keeps conservative copy for unspecified form fallback', () => {
  const result = buildWhyBullets({
    ingredientName: 'Magnesium',
    formText: null,
    formSource: 'inferred',
    formKey: 'unspecified',
    reasonCode: 'FORM_NOT_DISCLOSED',
    formLabel: 'Unspecified form',
    matchScore: 0.2,
    evidenceGrade: 'D',
    rbfFactor: 1.0,
    rbfBand: 'normal',
    doseSignal: null,
    reviewedSegments: {
      absorption: ['Should not be used when unspecified fallback is active.'],
      solubility: [],
      tolerability: [],
      caveats: [],
    },
  });

  assert.ok(result.bullets.some((line) => line.includes('Form is not disclosed')));
  assert.ok(result.bullets.some((line) => line.includes('RBF remains neutral (1.00)')));
  assert.ok(result.bullets.every((line) => !line.includes('Detected "Unspecified form"')));
  assert.ok(result.bullets.every((line) => !line.includes('Should not be used when unspecified fallback is active.')));
});
