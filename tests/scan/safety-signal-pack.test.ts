import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSafetySignalPack } from '@/lib/scan/safetySignalPack';

const makeBundle = () =>
  ({
    sections: {
      ingredients: {
        cover: {
          items: [{ name: 'Biotin' }],
        },
      },
      safety: {
        detail: {
          warnings: [],
          consultDoctorIf: [],
          redFlags: [],
        },
        signals: null,
      },
    },
  }) as any;

test('buildSafetySignalPack merges and dedupes label warnings from bundle detail and facts', () => {
  const bundle = makeBundle();
  bundle.sections.ingredients.cover.items = [];
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [
      {
        id: 'label:1',
        text: 'Do not exceed suggested use.',
        scope: 'label_specific',
        source: 'label_record',
      },
    ],
    ulEntries: [],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [],
  };
  bundle.sections.safety.detail.warnings = [
    { text: 'Do not exceed suggested use.' },
    { text: 'Keep out of reach of children.' },
  ];

  const pack = buildSafetySignalPack({
    bundle,
    facts: {
      safety: {
        labelWarnings: ['Keep out of reach of children.', 'Consult clinician when pregnant.'],
      },
    } as any,
    ingredientNames: [],
  });

  const texts = pack.labelWarnings.map((item) => item.text);
  assert.equal(texts.includes('Do not exceed suggested use.'), true);
  assert.equal(texts.includes('Keep out of reach of children.'), true);
  assert.equal(texts.includes('Consult clinician when pregnant.'), true);
  assert.equal(new Set(texts).size, texts.length);
});

test('buildSafetySignalPack normalizes structured UL entries from bundle safety signals', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [
      {
        id: 'ul:zinc',
        ingredientCanonicalKey: 'zinc',
        displayName: 'Zinc',
        currentDose: '50 mg',
        ulLimit: '40 mg',
        scope: 'total_intake',
        riskLevel: 'high',
        reasonCode: 'ODS_UL_MATCHED',
        sourceUrl: 'https://ods.od.nih.gov',
      },
    ],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [],
  };

  const pack = buildSafetySignalPack({
    bundle,
    facts: null,
    ingredientNames: ['Zinc'],
  });

  assert.equal(Array.isArray(pack.ulEntries), true);
  assert.equal(pack.ulEntries?.length, 1);
  assert.equal(pack.ulEntries?.[0]?.nutrientKey, 'zinc');
  assert.equal(pack.ulEntries?.[0]?.currentDailyAmount.value, 50);
  assert.equal(pack.ulEntries?.[0]?.ulDailyAmount.value, 40);
  assert.equal(pack.ulSignals.length >= 1, true);
  assert.equal(pack.ulSignals[0]?.source, 'ul_reference');
});

test('buildSafetySignalPack dedupes repeated UL entries from the bundle', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [
      {
        ingredientCanonicalKey: 'zinc',
        displayName: 'Zinc',
        currentDose: '50 mg',
        ulLimit: '40 mg',
        scope: 'total_intake',
        riskLevel: 'high',
        reasonCode: 'ODS_UL_MATCHED',
      },
      {
        ingredientCanonicalKey: 'zinc',
        displayName: 'Zinc',
        currentDose: '50 mg',
        ulLimit: '40 mg',
        scope: 'total_intake',
        riskLevel: 'high',
        reasonCode: 'ODS_UL_MATCHED',
      },
    ],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [],
  };

  const pack = buildSafetySignalPack({
    bundle,
    facts: null,
    ingredientNames: [],
  });

  assert.equal(Array.isArray(pack.ulEntries), true);
  assert.equal(pack.ulEntries?.length, 1);
});

test('buildSafetySignalPack emits quality note when label warnings are missing', () => {
  const pack = buildSafetySignalPack({
    bundle: makeBundle(),
    facts: null,
    ingredientNames: [],
  });

  assert.equal(pack.labelWarnings.length, 0);
  assert.equal(pack.qualityNotes.length >= 1, true);
  assert.match(pack.qualityNotes[0]?.text ?? '', /did not provide label-specific warnings/i);
});

test('buildSafetySignalPack promotes one ODS watchout into interaction when label and UL signals are missing', () => {
  const bundle = makeBundle();
  bundle.sections.ingredients.cover.items = [];
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [
      {
        id: 'ods-watch-vitamin-c',
        text: 'Vitamin C: high doses may cause GI discomfort.',
        scope: 'ods_general',
        source: 'ods_watchout',
      },
    ],
    qualityNotes: [],
  };

  const pack = buildSafetySignalPack({
    bundle,
    facts: null,
    ingredientNames: [],
  });

  assert.equal(pack.odsInteractions.length >= 1, true);
  assert.equal(pack.odsInteractions[0]?.reasonCode, 'ODS_WATCHOUT_PROMOTED');
});
