import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileIngredientSummary } from '../dist/insights/summaryCompiler.js';

test('summary compiler returns deterministic non-empty response for v1.1 packet', () => {
  const result = compileIngredientSummary({
    locale: 'en',
    ingredientName: 'Vitamin D',
    facts: {
      amount: 25,
      unit: 'mcg',
      formText: null,
    },
    insight: {
      rbfBand: 'normal',
      rbfFactor: 1.0,
      confidenceTier: 'medium',
      whyBullets: ['Dataset shows near-baseline absorption for this form'],
      doseStatus: 'unknown',
      dailyAmount: null,
      dailyUnit: null,
    },
    reviewedKbBullets: [],
  });

  assert.equal(typeof result.tldr, 'string');
  assert.ok(result.tldr.length > 20);
  assert.ok(Array.isArray(result.highlights));
  assert.ok(result.highlights.length >= 1);
  assert.equal(result.fallbackUsed, true);
});
