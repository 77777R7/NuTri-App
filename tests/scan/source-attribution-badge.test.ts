import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisBundleViewModel } from '@/lib/scan/useAnalysisBundleViewModel';

const baseBundle = (sourceType: string) =>
  ({
    meta: {
      sourceType,
    },
    sections: {
      overview: { cover: { summary: 'Overview text', bullets: [{ text: 'Line one' }] }, detail: { summary: 'Detail', bullets: [] } },
      ingredients: { cover: { items: [] }, detail: null },
      usage: { cover: { bestTimeToTake: { text: 'Once daily' }, dosage: { text: '1 capsule' }, bullets: [{ text: 'Use label first' }] }, detail: null },
      safety: { cover: { verdict: 'Limited record', bullets: [{ text: 'Consult clinician if needed' }] }, dataStatus: 'limited' },
    },
  }) as any;

const mkVm = (sourceType: string) =>
  buildAnalysisBundleViewModel({
    bundle: baseBundle(sourceType),
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
    productTitle: 'Product',
    productSubtitle: '',
    keyIngredientsForIngredients: [],
    keyIngredientsForSafety: [],
    assembledInsights: null,
  });

test('source attribution marks regulatory sources as verified_regulatory', () => {
  assert.equal(mkVm('lnhpd').sourceAttribution, 'verified_regulatory');
  assert.equal(mkVm('dsld').sourceAttribution, 'verified_regulatory');
});

test('source attribution marks web as unverified hint', () => {
  assert.equal(mkVm('web').sourceAttribution, 'web_hint_unverified');
});
