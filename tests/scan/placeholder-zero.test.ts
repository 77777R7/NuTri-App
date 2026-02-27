import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisBundleViewModel } from '@/lib/scan/useAnalysisBundleViewModel';

const PLACEHOLDER_RE = /\b(not provided(?: by source)?|n\/a|null|undefined)\b/i;

const buildBundle = (sourceType: 'lnhpd' | 'web' = 'lnhpd') =>
  ({
    meta: {
      sourceType,
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
        detail: null,
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

test('view model output strips raw placeholders across cover and detail', () => {
  const vm = buildAnalysisBundleViewModel({
    bundle: buildBundle('web'),
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
    productSubtitle: 'Subtitle',
    keyIngredientsForIngredients: [],
    keyIngredientsForSafety: [],
    assembledInsights: null,
  });

  const allLines = [
    vm.overview.summary,
    ...vm.overview.bullets,
    ...vm.overview.detail,
    ...vm.science.detail,
    vm.usage.bestTime,
    vm.usage.dosage,
    ...vm.usage.bullets,
    ...vm.usage.detail,
    vm.safety.verdict,
    ...vm.safety.bullets,
    ...vm.safety.detail,
  ];

  assert.ok(allLines.length > 0);
  assert.ok(allLines.every((line) => !PLACEHOLDER_RE.test(line)));
  assert.ok(vm.overview.detail.length >= 2);
  assert.ok(vm.science.detail.length >= 2);
  assert.ok(vm.usage.detail.length >= 2);
  assert.ok(vm.safety.detail.length >= 2);
});
