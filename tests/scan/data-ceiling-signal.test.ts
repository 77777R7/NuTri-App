import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDataCeilingSignal } from '@/lib/scan/dataCeiling';
import type { AnalysisBundle, AnalysisBundleV4 } from '@/types/analysisBundle';

const makeBundle = (overrides: Partial<AnalysisBundleV4['meta']> = {}): AnalysisBundle => ({
  meta: {
    schemaVersion: 4,
    promptVersion: 'test',
    sourceType: 'lnhpd',
    sourceTypeFinal: true,
    authoritativeIdentity: { type: 'npn', value: '80029183' },
    locale: 'en',
    phase: 'fast_ai',
    bundleId: 'bundle',
    revision: 1,
    factsDigestHash: 'hash',
    factsSourceVersion: 'v1',
    deterministicSignals: {
      schemaVersion: 1,
      ingredientCount: 0,
      doseCount: 0,
      usageStructuredCount: 0,
      safetySignalCount: 0,
      parserDiagnosticsTop: ['MISSING_MEDICINAL_INGREDIENTS'],
    },
    ...overrides,
  },
  sections: {
    overview: { layout: 'overview_card', cover: { summary: '', bullets: [] }, detail: { summary: '', bullets: [] }, dataStatus: 'limited' },
    ingredients: { layout: 'ingredients_list', cover: { items: [], totalCount: 0 }, detail: { items: [], overallSummary: null, overlapNotes: null }, dataStatus: 'limited' },
    usage: { layout: 'usage_bullets', cover: { bullets: [], bestTimeToTake: null, withFood: null, dosage: null }, detail: { timingRationale: null, withFoodRationale: null, scheduleFromLabel: [] }, dataStatus: 'limited' },
    safety: { layout: 'safety_bullets', cover: { verdict: '', bullets: [] }, detail: { warnings: [], consultDoctorIf: [], redFlags: [] }, dataStatus: 'limited' },
  },
});

test('resolves data ceiling reason from deterministic diagnostics', () => {
  const signal = resolveDataCeilingSignal({ bundle: makeBundle() });
  assert.equal(signal.isDataCeiling, true);
  assert.equal(signal.reason, 'MISSING_MEDICINAL_INGREDIENTS');
  assert.equal(signal.dataQualityFlags.includes('DATA_CEILING'), true);
});

test('does not mark data ceiling when sourceTypeFinal is false', () => {
  const signal = resolveDataCeilingSignal({
    bundle: makeBundle({ sourceTypeFinal: false }),
  });
  assert.equal(signal.isDataCeiling, false);
  assert.equal(signal.reason, null);
});
