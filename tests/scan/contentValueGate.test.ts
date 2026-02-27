import assert from 'node:assert/strict';
import test from 'node:test';

const loadGate = async () => import('../../scripts/maintainer/lib/content-value-gate.mjs');

const makeDashboardBundle = () => ({
  sections: {
    overview: {
      cover: {
        summary: 'This supplement provides 1000 IU vitamin D per tablet for daily support.',
        bullets: [{ text: 'Contains Vitamin D 1000 IU.' }, { text: 'One tablet daily with food.' }],
      },
      detail: {
        summary: 'Built from verified record details and dosing fields.',
        bullets: [{ text: 'Evidence references include ingredient-level context.' }],
      },
    },
    ingredients: {
      cover: {
        items: [{ name: 'Vitamin D', dose: '1000 IU' }, { name: 'Calcium', dose: '120 mg' }],
      },
      detail: {
        items: [
          {
            name: 'Vitamin D',
            whatItDoes: { text: 'Supports calcium balance.' },
            doseContext: { text: '1000 IU daily on label.' },
          },
        ],
        overallSummary: { text: 'Primary active and dose are present in this record.' },
      },
    },
    usage: {
      cover: {
        bestTimeToTake: { text: 'Once daily with breakfast.' },
        dosage: { text: 'Adults: 1 tablet once daily.' },
        bullets: [
          { text: 'Follow label timing for best consistency.' },
          { text: 'UL guidance: Vitamin D upper limit 4000 IU.' },
        ],
      },
      detail: {
        scheduleFromLabel: [{ population: 'Adults', dose: '1 tablet', frequency: 'once daily' }],
      },
    },
    safety: {
      cover: {
        verdict: 'Use with clinician guidance if on medications.',
        bullets: [{ text: 'Watch for cumulative intake from fortified foods.' }],
      },
      detail: {
        warnings: [{ text: 'Do not exceed upper limit without clinical advice.' }],
        consultDoctorIf: [{ text: 'Pregnant or breastfeeding.' }],
      },
    },
  },
});

test('content value gate passes rich dashboard content with score explanation', async () => {
  const { evaluateContentValueGate } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    analysisBundle: makeDashboardBundle(),
    sourceAttribution: 'verified_regulatory',
    terminalReason: 'DONE',
    scoreInfo: {
      overallScore: 82,
      explain: {
        ulWarnings: {
          entries: [
            {
              ingredient: 'Vitamin D',
              currentDose: '1000 IU',
              ulLimit: '4000 IU',
              riskLevel: 'moderate',
            },
          ],
        },
      },
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failReasons, []);
  assert.equal(result.moduleValue?.usage?.ulRequired, true);
  assert.equal(result.moduleValue?.usage?.ulPass, true);
});

test('content value gate fails generic/placeholder-heavy module content', async () => {
  const { evaluateContentValueGate, CONTENT_VALUE_FAIL_REASONS } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    sourceAttribution: 'label_record',
    terminalReason: 'DONE',
    analysisBundle: {
      sections: {
        overview: {
          cover: { summary: 'Not provided by source.', bullets: [{ text: 'Pending.' }] },
          detail: { summary: 'Not provided.', bullets: [] },
        },
        ingredients: { cover: { items: [] }, detail: { items: [], overallSummary: { text: 'Not provided.' } } },
        usage: {
          cover: {
            bestTimeToTake: { text: 'Use the product label first.' },
            dosage: { text: 'Not provided.' },
            bullets: [{ text: 'Scan the Directions panel.' }],
          },
          detail: { scheduleFromLabel: [] },
        },
        safety: {
          cover: { verdict: 'Not provided.', bullets: [{ text: 'Consult clinician.' }] },
          detail: { warnings: [], consultDoctorIf: [] },
        },
      },
    },
    scoreInfo: {},
  });

  assert.equal(result.applied, true);
  assert.equal(result.pass, false);
  assert.ok(result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.OVERVIEW_TOO_GENERIC));
  assert.ok(result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.SCORE_NO_SCORE_AND_NO_EXPLANATION));
});

test('degraded mode requires both reason and next-step action', async () => {
  const { evaluateContentValueGate, CONTENT_VALUE_FAIL_REASONS } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    analysisBundle: makeDashboardBundle(),
    sourceAttribution: 'web_hint_unverified',
    degradedMode: true,
    terminalReason: '',
    reasonCode: '',
    scoreInfo: {
      reasonCode: 'DEGRADED_WEB_BUDGET',
      message: 'partial',
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.pass, false);
  assert.ok(result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.DEGRADED_NO_REASON));
});

test('UL entries inject fallback usage guidance when source omits explicit UL copy', async () => {
  const { evaluateContentValueGate, CONTENT_VALUE_FAIL_REASONS } = await loadGate();
  const bundle = makeDashboardBundle();
  bundle.sections.usage.cover.bestTimeToTake = { text: 'Once daily at breakfast.' };
  bundle.sections.usage.cover.dosage = { text: 'Adults: 1 tablet daily.' };
  bundle.sections.usage.cover.bullets = [{ text: 'Keep routine consistent.' }];
  bundle.sections.usage.detail.scheduleFromLabel = [{ population: 'Adults', dose: '1 tablet', frequency: 'once daily' }];

  const result = evaluateContentValueGate({
    route: 'dashboard',
    analysisBundle: bundle,
    sourceAttribution: 'verified_regulatory',
    terminalReason: 'DONE',
    scoreInfo: {
      reasonCode: 'LIMITED_SCORE',
      message: 'Limited score context.',
      explain: {
        ulWarnings: {
          entries: [
            {
              ingredient: 'Zinc',
              currentDose: '40 mg',
              ulLimit: '40 mg',
            },
          ],
        },
      },
    },
  });

  assert.equal(result.pass, true);
  assert.ok(!result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.UL_PRESENT_BUT_NOT_SHOWN));
  assert.equal(result.moduleValue?.usage?.ulRequired, true);
  assert.equal(result.moduleValue?.usage?.ulPass, true);
});

test('non-dashboard route bypasses module gate and uses fallback explanation/action gate', async () => {
  const { evaluateContentValueGate } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'not_found',
    terminalReason: 'NOT_FOUND',
    reasonCode: 'NOT_FOUND',
    errorMessage: 'Product not found. Retry scan with a clearer label.',
  });

  assert.equal(result.applied, false);
  assert.equal(result.pass, null);
  assert.equal(result.fallbackRoutePass, true);
  assert.deepEqual(result.fallbackRouteFailReasons, []);
});

test('unverified source with verified language is rejected by trust-consistency gate', async () => {
  const { evaluateContentValueGate, CONTENT_VALUE_FAIL_REASONS } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    sourceAttribution: 'web_hint_unverified',
    terminalReason: 'DONE',
    analysisBundle: {
      sections: {
        overview: {
          cover: {
            summary: 'This is based on verified record data.',
            bullets: [{ text: 'Verified source records were used.' }, { text: 'Contains Vitamin C 500 mg.' }],
          },
          detail: { summary: 'Verified evidence summary.', bullets: [] },
        },
        ingredients: {
          cover: { items: [{ name: 'Vitamin C', dose: '500 mg' }] },
          detail: { items: [{ name: 'Vitamin C', whatItDoes: { text: 'Supports immune function.' } }] },
        },
        usage: {
          cover: {
            bestTimeToTake: { text: 'Once daily.' },
            dosage: { text: 'Adults: 1 tablet once daily.' },
            bullets: [{ text: 'Follow product label instructions.' }],
          },
          detail: { scheduleFromLabel: [{ population: 'Adults', dose: '1 tablet', frequency: 'once daily' }] },
        },
        safety: {
          cover: {
            verdict: 'Watch for upper limit interactions.',
            bullets: [{ text: 'Consult clinician if you are on medication.' }],
          },
          detail: { warnings: [{ text: 'Avoid excessive total intake.' }] },
        },
      },
    },
    scoreInfo: {
      reasonCode: 'LIMITED_SCORE',
      message: 'Limited source confidence.',
    },
  });

  assert.equal(result.pass, false);
  assert.ok(result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.UNVERIFIED_HAS_VERIFIED_LANGUAGE));
});

test('unverified source can use negated verified wording without triggering trust-consistency failure', async () => {
  const { evaluateContentValueGate, CONTENT_VALUE_FAIL_REASONS } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    sourceAttribution: 'web_hint_unverified',
    terminalReason: 'DONE',
    analysisBundle: {
      sections: {
        overview: {
          cover: {
            summary: 'This result is not verified and is based on limited confidence web hints.',
            bullets: [{ text: 'Contains Vitamin C 500 mg.' }, { text: 'Unverified barcode context only.' }],
          },
          detail: { summary: 'Use package facts to confirm identity.', bullets: [] },
        },
        ingredients: {
          cover: { items: [{ name: 'Vitamin C', dose: '500 mg' }] },
          detail: { items: [{ name: 'Vitamin C', whatItDoes: { text: 'Supports immune function.' } }] },
        },
        usage: {
          cover: {
            bestTimeToTake: { text: 'Once daily.' },
            dosage: { text: 'Adults: 1 tablet once daily.' },
            bullets: [{ text: 'Follow product label instructions.' }],
          },
          detail: { scheduleFromLabel: [{ population: 'Adults', dose: '1 tablet', frequency: 'once daily' }] },
        },
        safety: {
          cover: {
            verdict: 'Watch for upper limit interactions.',
            bullets: [{ text: 'Consult clinician if you are on medication.' }],
          },
          detail: { warnings: [{ text: 'Avoid excessive total intake.' }] },
        },
      },
    },
    scoreInfo: {
      reasonCode: 'LIMITED_SCORE',
      message: 'Limited source confidence.',
    },
  });

  assert.equal(result.pass, true);
  assert.ok(!result.failReasons.includes(CONTENT_VALUE_FAIL_REASONS.UNVERIFIED_HAS_VERIFIED_LANGUAGE));
});

test('thin degraded dashboard bundle still passes when factual fallback lines are injected', async () => {
  const { evaluateContentValueGate } = await loadGate();
  const result = evaluateContentValueGate({
    route: 'dashboard',
    sourceAttribution: 'web_hint_unverified',
    terminalReason: 'DEGRADED_WEB_BUDGET',
    degradedMode: true,
    analysisBundle: {
      sections: {
        overview: { cover: { summary: '', bullets: [] }, detail: { summary: '', bullets: [] } },
        ingredients: { cover: { items: [] }, detail: { items: [] } },
        usage: { cover: { bestTimeToTake: '', dosage: '', bullets: [] }, detail: { scheduleFromLabel: [] } },
        safety: { cover: { verdict: '', bullets: [] }, detail: { warnings: [] } },
      },
    },
    scoreInfo: {
      reasonCode: 'DEGRADED_WEB_BUDGET',
      message: 'Showing partial results while web evidence budget is constrained.',
      explain: {
        ulWarnings: {
          entries: [{ ingredient: 'Vitamin C', currentDose: '500 mg', ulLimit: '2000 mg' }],
        },
      },
    },
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.failReasons, []);
});
