import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisBundleViewModel } from '@/lib/scan/useAnalysisBundleViewModel';

const makeWebBundle = () =>
  ({
    meta: {
      sourceType: 'web',
      sourceTypeFinal: true,
      revision: 1,
      authoritativeIdentity: { type: 'gtin14', value: '00000000000000' },
    },
    sections: {
      overview: {
        cover: {
          summary: 'This analysis is based on verified record data.',
          bullets: [{ text: 'Built from verified source records for this product.' }],
        },
        detail: { summary: 'Based on verified record data.', bullets: [] },
      },
      ingredients: {
        cover: { items: [] },
        detail: null,
      },
      usage: {
        cover: {
          bestTimeToTake: { text: 'Use label timing.' },
          dosage: { text: 'Follow label dose.' },
          bullets: [{ text: 'Use the product label first.' }],
        },
        detail: null,
      },
      safety: {
        cover: {
          verdict: 'Safety details are not included in this source record.',
          bullets: [{ text: 'Consult clinician if needed.' }],
        },
        dataStatus: 'limited',
      },
    },
  }) as any;

test('web hint title safety downgrades suspicious titles and keeps unverified wording', () => {
  const vm = buildAnalysisBundleViewModel({
    bundle: makeWebBundle(),
    facts: {
      meta: { source: 'web', sourceId: '00000000000000', fetchedAt: new Date().toISOString() },
      identity: { kind: 'gtin14', value: '00000000000000' },
      product: { name: 'Getting error 00000000-0000-0000-0000-000000000000 from YouTube Forums', brand: null, category: null, imageUrl: null },
      serving: {},
      ingredients: { actives: [] },
      usage: { route: 'unknown' },
      safety: { labelWarnings: [] },
      provenance: { source: 'web' },
      sources: [{ kind: 'web', domain: 'youtube.com', url: 'https://www.youtube.com/watch?v=abc' }],
      dataQuality: { overallStatus: 'limited', missingReasons: [], notes: [] },
    } as any,
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
    productTitle: 'Getting error 00000000-0000-0000-0000-000000000000 from YouTube Forums',
    productSubtitle: 'Forums',
    keyIngredientsForIngredients: [],
    keyIngredientsForSafety: [],
    assembledInsights: null,
  });

  assert.equal(vm.sourceAttribution, 'web_hint_unverified');
  assert.equal(vm.productTitle, 'Unverified barcode');
  assert.match(vm.productSubtitle, /UPC:\s*00000000000000 \(unverified\)|Web hint from youtube\.com \(unverified\)|Web hint \(unverified\)/i);

  const joined = [
    vm.overview.summary,
    ...vm.overview.bullets,
    ...vm.overview.detail,
    ...vm.usage.detail,
    ...vm.safety.detail,
  ].join('\n');
  assert.ok(!/\bverified record\b/i.test(joined));
  assert.ok(!/\bverified source\b/i.test(joined));
});
