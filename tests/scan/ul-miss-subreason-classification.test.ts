import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UL_COVERAGE_MISS_REASONS,
  UL_COVERAGE_MISS_SUBREASONS,
  deriveRegulatoryRichSignals,
} from '../../scripts/maintainer/lib/regulatory-richness-gate.mjs';

const makeBundle = () =>
  ({
    sections: {
      ingredients: {
        cover: { items: [{ name: 'Vitamin C', dose: '1000 mg' }] },
        detail: { items: [] },
      },
      usage: {
        cover: { dosage: { text: 'Take 1 capsule daily.' }, bestTimeToTake: { text: 'Daily with food.' }, bullets: [] },
        detail: { scheduleFromLabel: [{ population: 'Adults', dose: '1 capsule', frequency: 'once daily' }] },
      },
      safety: {
        detail: { warnings: [], consultDoctorIf: [], redFlags: [] },
        signals: null,
      },
    },
  }) as any;

test('reclassifies alias miss into no candidate confirmed when candidate set is empty', () => {
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: makeBundle(),
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [],
          missingReasonCounts: {
            canonicalAliasMiss: 3,
            noUlEstablished: 2,
          },
        },
      },
    } as any,
    moduleValue: null,
  });

  assert.equal(signals.ulMissReasonTop, UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE);
  assert.equal(signals.ulMissReasonSubTop, UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_CONFIRMED);
});

test('marks true alias miss when UL candidate exists', () => {
  const signals = deriveRegulatoryRichSignals({
    analysisBundle: makeBundle(),
    scoreInfo: {
      explain: {
        ulWarnings: {
          entries: [{ displayName: 'Vitamin C', reasonCode: 'ALIAS_NOT_RESOLVED' }],
          missingReasonCounts: {
            canonicalAliasMiss: 1,
          },
        },
      },
    } as any,
    moduleValue: null,
  });

  assert.equal(signals.ulCandidateCount >= 1, true);
  assert.equal(signals.ulMissReasonSubTop, UL_COVERAGE_MISS_SUBREASONS.TRUE_ALIAS_MISS);
});
