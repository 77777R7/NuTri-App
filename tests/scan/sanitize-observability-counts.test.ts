import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisBundleViewModel } from '@/lib/scan/useAnalysisBundleViewModel';

const buildBundle = () =>
  ({
    meta: {
      sourceType: 'lnhpd',
    },
    sections: {
      overview: {
        cover: {
          summary: 'Not provided by source.',
          bullets: [{ text: 'Not provided.' }],
        },
        detail: {
          summary: 'Not provided.',
          bullets: [{ text: 'N/A' }],
        },
      },
      ingredients: {
        cover: {
          items: [],
        },
        detail: {
          items: [{ name: 'Vitamin D', whatItDoes: { text: 'Not provided.' } }],
          overallSummary: 'Not provided.',
        },
      },
      usage: {
        cover: {
          bestTimeToTake: { text: 'Not provided.' },
          dosage: { text: 'Not provided by source.' },
          bullets: [{ text: 'Not provided.' }],
        },
        detail: null,
      },
      safety: {
        cover: {
          verdict: 'Not provided by source.',
          bullets: [{ text: 'Not provided.' }],
        },
        dataStatus: 'limited',
      },
    },
  }) as any;

test('sanitize observability counters track raw and sanitized placeholder hits', () => {
  const vm = buildAnalysisBundleViewModel({
    bundle: buildBundle(),
    facts: null,
    scoreBundle: null,
    score: {
      mode: 'not_scored',
      overall: null,
      effectiveness: null,
      safety: null,
      integrity: null,
      confidence: null,
      metaLines: [],
    },
    productTitle: 'Test Product',
    productSubtitle: '',
    keyIngredientsForIngredients: [],
    keyIngredientsForSafety: [],
    assembledInsights: null,
  });

  assert.ok(vm.debug.rawPlaceholderCount.total > 0);
  assert.equal(vm.debug.rawPlaceholderCount.total, vm.debug.sanitizedPlaceholderCount.total);
  assert.ok(
    vm.debug.rawPlaceholderCount.overview > 0 ||
      vm.debug.rawPlaceholderCount.usage > 0 ||
      vm.debug.rawPlaceholderCount.safety > 0,
  );
});
