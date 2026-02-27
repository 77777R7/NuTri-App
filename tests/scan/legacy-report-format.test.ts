import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisBundleViewModel } from '@/lib/scan/useAnalysisBundleViewModel';

const makeBundle = () => ({
  meta: {
    schemaVersion: 4,
    promptVersion: 'test',
    sourceType: 'lnhpd',
    sourceTypeFinal: true,
    scoreAvailable: true,
    authoritativeIdentity: { type: 'npn', value: '80000436' },
    locale: 'en',
    phase: 'fast_ai',
    bundleId: 'bundle-test',
    revision: 1,
    factsDigestHash: 'digest',
    factsSourceVersion: 'v1',
  },
  sections: {
    overview: {
      layout: 'overview_card',
      dataStatus: 'limited',
      cover: {
        summary: 'Supports daily wellness.',
        bullets: [
          { text: 'Contains key vitamins.', basisTags: ['label_fact'] },
          { text: 'Labeled for daily use.', basisTags: ['label_fact'] },
        ],
      },
      detail: {
        summary: 'Overview detail summary',
        bullets: [{ text: 'Detail bullet', basisTags: ['label_fact'] }],
      },
    },
    ingredients: {
      layout: 'ingredients_list',
      dataStatus: 'limited',
      cover: {
        items: [
          { name: 'Vitamin D', dose: '25 mcg', basisTags: ['label_fact'] },
          { name: 'Calcium', dose: '200 mg', basisTags: ['label_fact'] },
        ],
      },
      detail: {
        items: [
          {
            name: 'Vitamin D',
            whatItDoes: { text: 'Supports bone and immune health.', basisTags: ['general_advice'] },
            doseContext: { text: 'Dose based on label.', basisTags: ['label_fact'] },
            chemicalFormExplain: { text: 'Cholecalciferol form.', basisTags: ['label_fact'] },
            deliveryFormExplain: null,
          },
        ],
        overallSummary: { text: 'Includes daily label amounts.', basisTags: ['label_fact'] },
        overlapNotes: null,
      },
    },
    usage: {
      layout: 'usage_bullets',
      dataStatus: 'limited',
      cover: {
        bullets: [
          { text: 'Take once daily.', basisTags: ['label_fact'] },
          { text: 'Use the label first.', basisTags: ['general_advice'] },
        ],
        bestTimeToTake: { text: 'Once daily with food', basisTags: ['label_fact'] },
        withFood: null,
        dosage: { text: 'Adults: 1 capsule daily', basisTags: ['label_fact'] },
      },
      detail: {
        timingRationale: { text: 'Consistency helps adherence.', basisTags: ['general_advice'] },
        withFoodRationale: null,
        scheduleFromLabel: [
          {
            population: 'Adults',
            age: null,
            dose: '1 capsule',
            frequency: 'once daily',
            rawText: null,
            basisTags: ['label_fact'],
          },
        ],
      },
    },
    safety: {
      layout: 'safety_bullets',
      dataStatus: 'not_provided',
      cover: {
        verdict: 'Safety details are not included in this source record.',
        bullets: [{ text: 'Consult clinician if needed.', basisTags: ['general_advice'] }],
      },
      detail: {
        warnings: [],
        consultDoctorIf: [],
        redFlags: [],
      },
    },
  },
});

test('legacy report view model emits five readable sections', () => {
  const vm = buildAnalysisBundleViewModel({
    bundle: makeBundle() as any,
    facts: {
      meta: { source: 'lnhpd', sourceId: '80000436', fetchedAt: new Date().toISOString() },
      identity: { kind: 'npn', value: '80000436' },
      product: { name: 'Vitamin D', brand: 'Laboratories Nutri', category: 'Vitamin D', imageUrl: null },
      serving: {},
      ingredients: {
        actives: [{ name: 'Vitamin D', amount: 25, unit: 'mcg', per: 'serving' }],
      },
      usage: { route: 'oral', directionsText: 'Adults: 1 capsule daily' },
      safety: { labelWarnings: [] },
      provenance: { source: 'lnhpd' },
      sources: [],
      dataQuality: { overallStatus: 'limited', missingReasons: ['missing_warnings'], notes: [] },
    } as any,
    scoreBundle: null,
    score: {
      mode: 'not_scored',
      overall: null,
      effectiveness: null,
      safety: null,
      integrity: null,
      confidence: null,
      metaLines: ['Score unavailable in current dataset.'],
    },
    productTitle: 'Vitamin D 1000IU',
    productSubtitle: 'Laboratories Nutri',
    keyIngredientsForIngredients: ['Vitamin D'],
    keyIngredientsForSafety: ['Vitamin D'],
    assembledInsights: null,
  });

  assert.ok(vm.overview.summary.length > 0);
  assert.ok(vm.overview.detail.length >= 2);
  assert.ok(vm.science.coverIngredients.length >= 1);
  assert.ok(vm.science.detail.length >= 2);
  assert.ok(vm.usage.detail.length >= 2);
  assert.ok(vm.safety.detail.length >= 2);
});
