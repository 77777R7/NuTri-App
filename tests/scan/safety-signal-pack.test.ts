import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSafetySignalPack, extractUlEntriesFromScore } from '@/lib/scan/safetySignalPack';

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

test('buildSafetySignalPack merges and dedupes label warnings from pack/detail/facts', () => {
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
  bundle.sections.safety.detail.warnings = [{ text: 'Do not exceed suggested use.' }, { text: 'Keep out of reach of children.' }];

  const pack = buildSafetySignalPack({
    bundle,
    scoreBundle: null,
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

test('buildSafetySignalPack slices ODS interaction lines by keyword', () => {
  const pack = buildSafetySignalPack({
    bundle: makeBundle(),
    scoreBundle: null,
    facts: null,
    ingredientNames: ['Biotin'],
  });

  assert.equal(Array.isArray(pack.odsInteractions), true);
  assert.equal(pack.odsInteractions.length >= 1, true);
  assert.equal(
    pack.odsInteractions.some((item) => /interact|medication|medicine/i.test(item.text)),
    true,
  );
});

test('extractUlEntriesFromScore maps structured UL entries', () => {
  const ulEntries = extractUlEntriesFromScore({
    explain: {
      ulWarnings: {
        entries: [
          {
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
      },
    },
  } as any);

  assert.equal(ulEntries.length, 1);
  assert.equal(ulEntries[0]?.nutrientKey, 'zinc');
  assert.equal(ulEntries[0]?.currentDailyAmount.value, 50);
  assert.equal(ulEntries[0]?.ulDailyAmount.value, 40);
  assert.equal(ulEntries[0]?.evidenceSource, 'NIH_ODS_UL');
  assert.match(ulEntries[0]?.explainLine ?? '', /Zinc: current 50 mg \| UL 40 mg/i);
});

test('extractUlEntriesFromScore supports wrapped score response payload', () => {
  const ulEntries = extractUlEntriesFromScore({
    status: 'ok',
    source: 'dsld',
    sourceId: 'x',
    bundle: {
      explain: {
        ulWarnings: {
          entries: [
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
        },
      },
    },
  } as any);

  assert.equal(ulEntries.length, 1);
  assert.equal(ulEntries[0]?.nutrientKey, 'zinc');
  assert.equal(ulEntries[0]?.currentDailyAmount.value, 50);
});

test('extractUlEntriesFromScore skips rows without parseable daily amount', () => {
  const ulEntries = extractUlEntriesFromScore({
    explain: {
      ulWarnings: {
        entries: [
          {
            ingredientCanonicalKey: 'vitamin_c',
            displayName: 'Vitamin C',
            currentDose: null,
            ulLimit: '2000 mg',
            scope: 'total_intake',
            riskLevel: 'moderate',
            reasonCode: 'ODS_UL_MATCHED',
          },
        ],
      },
    },
  } as any);

  assert.equal(ulEntries.length, 0);
});

test('buildSafetySignalPack emits UL reference line when UL exists but current dose is missing', () => {
  const pack = buildSafetySignalPack({
    bundle: makeBundle(),
    scoreBundle: {
      explain: {
        ulWarnings: {
          entries: [
            {
              ingredientCanonicalKey: 'vitamin_c',
              displayName: 'Vitamin C',
              currentDose: null,
              ulLimit: '2000 mg',
              scope: 'total_intake',
              riskLevel: 'unknown',
              reasonCode: 'ODS_UL_MATCHED',
            },
          ],
        },
      },
    } as any,
    facts: null,
    ingredientNames: ['Vitamin C'],
  });

  const ulReferenceLine = pack.ulSignals.find((item) => /Upper limit \(UL\):/i.test(item.text));
  assert.ok(ulReferenceLine, 'expected UL reference line');
  assert.match(ulReferenceLine?.text ?? '', /2000 mg\/day/i);
  assert.equal(ulReferenceLine?.reasonCode, 'UL_REFERENCE_ONLY');
});

test('extractUlEntriesFromScore uses lower bound when dose text is a range', () => {
  const ulEntries = extractUlEntriesFromScore({
    explain: {
      ulWarnings: {
        entries: [
          {
            ingredientCanonicalKey: 'vitamin_c',
            displayName: 'Vitamin C',
            currentDose: '1-2 mg',
            ulLimit: '10 mg',
            scope: 'total_intake',
            riskLevel: 'low',
            reasonCode: 'ODS_UL_MATCHED',
          },
        ],
      },
    },
  } as any);

  assert.equal(ulEntries.length, 1);
  assert.equal(ulEntries[0]?.currentDailyAmount.value, 1);
  assert.match(ulEntries[0]?.explainLine ?? '', /current 1-2 mg/i);
});

test('buildSafetySignalPack dedupes UL entries by nutrient and explain line', () => {
  const pack = buildSafetySignalPack({
    bundle: makeBundle(),
    scoreBundle: {
      explain: {
        ulWarnings: {
          entries: [
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
        },
      },
    } as any,
    facts: null,
    ingredientNames: [],
  });

  assert.equal(Array.isArray(pack.ulEntries), true);
  assert.equal(pack.ulEntries?.length, 1);
  assert.equal(pack.ulSignals.length >= 1, true);
});

test('buildSafetySignalPack emits quality note when label warnings are missing', () => {
  const pack = buildSafetySignalPack({
    bundle: makeBundle(),
    scoreBundle: null,
    facts: null,
    ingredientNames: [],
  });

  assert.equal(pack.labelWarnings.length, 0);
  assert.equal(pack.qualityNotes.length >= 1, true);
  assert.match(pack.qualityNotes[0]?.text ?? '', /did not provide label-specific warnings/i);
});

test('buildSafetySignalPack promotes one ODS watchout into interaction when label/UL are missing', () => {
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
    scoreBundle: null,
    facts: null,
    ingredientNames: [],
  });

  assert.equal(pack.labelWarnings.length, 0);
  assert.equal((pack.ulEntries ?? []).length, 0);
  assert.equal(pack.odsInteractions.length >= 1, true);
  assert.equal(pack.odsInteractions[0]?.reasonCode, 'ODS_WATCHOUT_PROMOTED');
});
