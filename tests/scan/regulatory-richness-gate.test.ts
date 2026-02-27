import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGULATORY_CONSISTENCY_FAIL_REASONS,
  REGULATORY_RICH_FAIL_REASONS,
  UL_CANDIDATE_SOURCES,
  UL_COVERAGE_MISS_REASONS,
  UL_COVERAGE_MISS_SUBREASONS,
  UL_NO_CANDIDATE_CLASSES,
  deriveRegulatoryRichFailure,
  deriveRegulatoryRichSignals,
  hasOnlyFallbackTemplates,
} from '../../scripts/maintainer/lib/regulatory-richness-gate.mjs';

const makeBundle = () => ({
  sections: {
    ingredients: {
      cover: {
        items: [{ name: 'Vitamin D', dose: '1000 IU' }],
      },
      detail: { items: [] },
    },
    usage: {
      cover: {
        dosage: { text: 'Adults: 1 softgel daily.' },
        bestTimeToTake: { text: 'Once daily with food.' },
        bullets: [{ text: 'Follow label timing.' }],
      },
      detail: {
        scheduleFromLabel: [{ population: 'Adults', dose: '1 softgel', frequency: 'once daily' }],
      },
    },
    safety: {
      detail: {
        warnings: [{ text: 'Do not exceed suggested use.' }],
        consultDoctorIf: [],
        redFlags: [],
      },
      signals: null,
    },
  },
});

const makeSafetySignal = (overrides: Record<string, unknown> = {}) => ({
  id: 'signal-1',
  text: 'Safety signal',
  scope: 'ods_general',
  source: 'unknown',
  ...overrides,
});

test('science passes with single ingredient plus dose signal', () => {
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: makeBundle(),
    scoreInfo: {
      reasonCode: 'LIMITED_SCORE',
      message: 'Numeric score pending.',
    },
    moduleValue: {
      science: {
        lines: ['Vitamin D: 1000 IU'],
      },
    },
  });

  assert.equal(signals.sciencePass, true);
  assert.equal(signals.ingredientCount, 1);
  assert.equal(signals.doseCount >= 1, true);
});

test('score visible passes with reason plus explanation even without numeric score', () => {
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: makeBundle(),
    scoreInfo: {
      reasonCode: 'LIMITED_SCORE',
      message: 'Score is limited right now while facts are loading.',
    },
    moduleValue: null,
  });

  assert.equal(signals.scoreAvailable, false);
  assert.equal(signals.scoreExplainabilityPresent, true);
  assert.equal(signals.scorePass, true);
});

test('safety passes when only UL entries exist in SafetySignalPack', () => {
  const bundle = makeBundle();
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [
      {
        id: 'ul-entry-zinc',
        nutrientKey: 'zinc',
        displayName: 'Zinc',
        currentDailyAmount: { value: 50, unit: 'mg', text: '50 mg' },
        ulDailyAmount: { value: 40, unit: 'mg', text: '40 mg' },
        riskBand: 'high',
        scope: 'total_intake',
        evidenceSource: 'NIH_ODS_UL',
        explainLine: 'Zinc: current 50 mg | UL 40 mg | high risk, total intake',
      },
    ],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [],
  } as any;

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.safetySignalPackPresent, true);
  assert.equal(signals.labelWarningsCount, 0);
  assert.equal(signals.ulEntriesCount, 1);
  assert.equal(signals.odsInteractionsCount, 0);
  assert.equal(signals.safetyPass, true);
});

test('safety passes when only ODS interactions exist in SafetySignalPack', () => {
  const bundle = makeBundle();
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [],
    ulSignals: [],
    odsInteractions: [
      makeSafetySignal({
        id: 'ods-int-1',
        text: 'Vitamin K: may interact with warfarin',
        source: 'ods_interaction',
      }),
    ],
    odsWatchouts: [],
    qualityNotes: [],
  } as any;

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.safetySignalPackPresent, true);
  assert.equal(signals.ulEntriesCount, 0);
  assert.equal(signals.odsInteractionsCount, 1);
  assert.equal(signals.safetyPass, true);
});

test('quality notes only does not satisfy safety pass', () => {
  const bundle = makeBundle();
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [],
    ulSignals: [],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [
      makeSafetySignal({
        id: 'quality-1',
        text: 'This regulatory record did not provide label-specific warnings.',
        scope: 'label_specific',
        source: 'quality_note',
      }),
    ],
  } as any;

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.safetySignalPackPresent, true);
  assert.equal(signals.safetyPass, false);
  assert.deepEqual(signals.missingSafetyKinds, ['label', 'ods', 'ul']);
});

test('consistency fails when deterministic ingredient signals exist but science cover items are empty', () => {
  const bundle = makeBundle();
  (bundle as any).meta = {
    deterministicSignals: {
      schemaVersion: 1,
      ingredientCount: 2,
      doseCount: 1,
      usageStructuredCount: 1,
      safetySignalCount: 1,
      parserDiagnosticsTop: [],
    },
  };
  bundle.sections.ingredients.cover.items = [];

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.coverDetailConsistencyPass, false);
  assert.equal(signals.consistencyFailReason, REGULATORY_CONSISTENCY_FAIL_REASONS.COVER_DETAIL_INCONSISTENT);
});

test('consistency fails with PARSER_GAP_VISIBLE when usage structure is expected but not visible', () => {
  const bundle = makeBundle();
  (bundle as any).meta = {
    deterministicSignals: {
      schemaVersion: 1,
      ingredientCount: 1,
      doseCount: 1,
      usageStructuredCount: 2,
      safetySignalCount: 1,
      parserDiagnosticsTop: [],
    },
  };
  bundle.sections.usage.cover = {
    dosage: { text: '' },
    bestTimeToTake: { text: '' },
    bullets: [],
  };
  bundle.sections.usage.detail = {
    scheduleFromLabel: [],
  };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.coverDetailConsistencyPass, false);
  assert.equal(signals.consistencyFailReason, REGULATORY_CONSISTENCY_FAIL_REASONS.PARSER_GAP_VISIBLE);
});

test('falls back to scoreInfo ulWarnings entries when pack is absent', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [{ displayName: 'Zinc', currentDose: '50 mg', ulLimit: '40 mg' }],
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.safetySignalPackPresent, false);
  assert.equal(signals.ulEntriesCount, 1);
  assert.equal(signals.safetyPass, true);
});

test('falls back to wrapped score bundle ulWarnings entries when pack is absent', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      status: 'ok',
      source: 'dsld',
      sourceId: 'x',
      bundle: {
        overallScore: 74,
        pillars: { effectiveness: 72, safety: 70, integrity: 80 },
        explain: {
          ulWarnings: {
            entries: [{ displayName: 'Zinc', currentDose: '50 mg', ulLimit: '40 mg' }],
          },
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.scoreAvailable, true);
  assert.equal(signals.ulEntriesCount, 1);
  assert.equal(signals.safetyPass, true);
});

test('UL miss reason maps to MISSING_CURRENT_DAILY_AMOUNT when dose signals lack daily amount', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        evidence: {
          ingredientDoseSignals: [
            {
              ingredientName: 'Zinc',
              dailyAmount: null,
            },
          ],
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.ulProducedCount, 0);
  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.MISSING_CURRENT_DAILY_AMOUNT);
});

test('UL miss reason maps to UNIT_NOT_CONVERTIBLE when score ulWarnings reports conversion uncertainty', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [
            {
              displayName: 'Vitamin A',
              reasonCode: 'UNIT_CONVERSION_UNCERTAIN',
            },
          ],
          missingReasonCounts: {
            unitConversionUncertain: 1,
          },
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.ulProducedCount, 0);
  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.UNIT_NOT_CONVERTIBLE);
});

test('UL miss reason maps to NO_UL_CANDIDATE when no UL rows and no dose signals are present', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [],
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.ulCandidateCount, 0);
  assert.equal(signals.ulProducedCount, 0);
  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
  assert.equal(signals.ulMissReasonSubTop, UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_CONFIRMED);
  assert.equal(signals.ulCandidateSource, UL_CANDIDATE_SOURCES.NONE);
  assert.equal(signals.ulNoCandidateClass, UL_NO_CANDIDATE_CLASSES.UNKNOWN);
});

test('UL alias miss is reclassified to NO_UL_CANDIDATE when candidate set is empty', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [],
          missingReasonCounts: {
            canonicalAliasMiss: 2,
            noUlEstablished: 1,
          },
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.ulCandidateCount, 0);
  assert.equal(signals.ulProducedCount, 0);
  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
  assert.equal(signals.ulMissReasonSubTop, UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_CONFIRMED);
  assert.equal(signals.ulCandidateSource, UL_CANDIDATE_SOURCES.NONE);
  assert.equal(signals.ulNoCandidateClass, UL_NO_CANDIDATE_CLASSES.NO_UL_ESTABLISHED);
});

test('UL subreason marks TRUE_ALIAS_MISS when candidate exists but alias miss remains', () => {
  const bundle = makeBundle();
  bundle.sections.safety.signals = null;
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };

  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [
            {
              displayName: 'Vitamin C',
              reasonCode: 'MISSING_CURRENT_DAILY_AMOUNT',
            },
          ],
          missingReasonCounts: {
            canonicalAliasMiss: 1,
          },
        },
      },
    },
    moduleValue: null,
  });

  assert.equal(signals.ulCandidateCount >= 1, true);
  assert.equal(signals.ulProducedCount, 0);
  assert.equal(signals.ulMissReasonSubTop, UL_COVERAGE_MISS_SUBREASONS.TRUE_ALIAS_MISS);
  assert.equal(signals.ulCandidateSource, UL_CANDIDATE_SOURCES.SCORE);
});

test('UL deterministic reference backfills candidate source when score rows are absent', () => {
  const bundle = makeBundle();
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [],
    ulSignals: [
      makeSafetySignal({
        id: 'ul-deterministic',
        text: 'Upper limit (UL): 2000 mg/day',
        source: 'ods_ul',
        nutrientKey: 'vitamin_c',
      }),
    ],
    odsInteractions: [],
    odsWatchouts: [],
    qualityNotes: [],
  } as any;
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });

  assert.equal(signals.ulCandidateCount, 1);
  assert.equal(signals.ulCandidateSource, UL_CANDIDATE_SOURCES.DETERMINISTIC);
  assert.equal(signals.ulReferenceFromDeterministic, true);
  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.MISSING_CURRENT_DAILY_AMOUNT);
});

test('safetySignalOrigin marks dominant signal source', () => {
  const bundle = makeBundle();
  bundle.sections.safety.detail = { warnings: [], consultDoctorIf: [], redFlags: [] };
  bundle.sections.safety.signals = {
    schemaVersion: 1,
    labelWarnings: [],
    ulEntries: [],
    ulSignals: [],
    odsInteractions: [
      makeSafetySignal({
        id: 'ods-int-signal',
        text: 'Vitamin C: may interact with medications.',
        source: 'ods_interaction',
      }),
    ],
    odsWatchouts: [],
    qualityNotes: [],
  } as any;
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: bundle as any,
    scoreInfo: null,
    moduleValue: null,
  });
  assert.equal(signals.safetySignalOrigin, 'ods');
});

test('regulatory rich failure primary reason follows fixed priority', () => {
  const cases = [
    {
      name: 'only fallback templates takes priority',
      signals: {
        pass: false,
        onlyFallbackTemplates: true,
        sciencePass: false,
        usagePass: false,
        safetyPass: false,
        scorePass: false,
      },
      expected: REGULATORY_RICH_FAIL_REASONS.ONLY_FALLBACK_TEMPLATES,
    },
    {
      name: 'science missing maps to dose reason',
      signals: {
        pass: false,
        onlyFallbackTemplates: false,
        sciencePass: false,
        usagePass: true,
        safetyPass: true,
        scorePass: true,
      },
      expected: REGULATORY_RICH_FAIL_REASONS.MISSING_DOSE_SIGNALS,
    },
    {
      name: 'usage missing maps correctly',
      signals: {
        pass: false,
        onlyFallbackTemplates: false,
        sciencePass: true,
        usagePass: false,
        safetyPass: true,
        scorePass: true,
      },
      expected: REGULATORY_RICH_FAIL_REASONS.MISSING_USAGE_STRUCTURE,
    },
    {
      name: 'safety missing maps correctly',
      signals: {
        pass: false,
        onlyFallbackTemplates: false,
        sciencePass: true,
        usagePass: true,
        safetyPass: false,
        scorePass: true,
      },
      expected: REGULATORY_RICH_FAIL_REASONS.MISSING_SAFETY_SIGNALS,
    },
    {
      name: 'score missing maps correctly',
      signals: {
        pass: false,
        onlyFallbackTemplates: false,
        sciencePass: true,
        usagePass: true,
        safetyPass: true,
        scorePass: false,
      },
      expected: REGULATORY_RICH_FAIL_REASONS.SCORE_NOT_VISIBLE,
    },
  ];

  for (const row of cases) {
    const failure = deriveRegulatoryRichFailure({ signals: row.signals as any });
    assert.equal(failure.primaryReason, row.expected, row.name);
  }
});

test('ONLY_FALLBACK_TEMPLATES is not triggered when real dose lines exist', () => {
  const withRealSignals = {
    overview: { lines: ['Based on verified record data.'] },
    science: { lines: ['Vitamin D: 1000 IU'] },
    usage: { lines: ['Adults: 1 softgel once daily'] },
    safety: { lines: ['Review label warnings before use.'] },
  };
  const fallbackOnly = {
    overview: { lines: ['Source fact: this identity is backed by structured label record data.'] },
    science: { lines: ['Science fact: ingredient names or dose values were limited in this record.'] },
    usage: { lines: ['Follow the product label first for dosing decisions.'] },
    safety: { lines: ['Consult a clinician if pregnant, nursing, or taking medication.'] },
  };

  assert.equal(hasOnlyFallbackTemplates(withRealSignals), false);
  assert.equal(hasOnlyFallbackTemplates(fallbackOnly), true);
});
