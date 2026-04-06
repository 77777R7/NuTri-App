import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDecisionSupport,
  type DecisionSupportAttachedPersonalizationContext,
} from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const buildOmegaDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-sr-omega-3',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Sports Research',
    name: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    route: null,
  },
  actives: [
    {
      name: 'Fish Oil',
      amount: 1250,
      unit: 'mg',
      amountText: '1250 mg',
      chemicalForm: 'Triglyceride form',
      source: 'dsld',
      confidence: 1,
    },
    {
      name: 'EPA',
      amount: 690,
      unit: 'mg',
      amountText: '690 mg',
      source: 'dsld',
      confidence: 1,
    },
    {
      name: 'DHA',
      amount: 260,
      unit: 'mg',
      amountText: '260 mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: ['Gelatin', 'Glycerin'],
  serving: {
    servingSize: '1 softgel',
    servingsPerContainer: 60,
  },
  labelDosing: [],
  warnings: {
    warnings: ['Contains fish.'],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: false,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 100,
  },
});

const buildMagnesiumTheanineDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-sleep-focus-support',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Calm Labs',
    name: 'Magnesium L-Theanine Blend',
    dosageForm: 'Capsule',
    route: null,
  },
  actives: [
    {
      name: 'Magnesium',
      amount: 200,
      unit: 'mg',
      amountText: '200 mg',
      source: 'dsld',
      confidence: 1,
    },
    {
      name: 'L-Theanine',
      amount: 200,
      unit: 'mg',
      amountText: '200 mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: [],
  serving: {
    servingSize: '2 capsules',
    servingsPerContainer: 30,
  },
  labelDosing: [],
  warnings: {
    warnings: [],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: false,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 100,
  },
});

const buildVitaminCDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-vitamin-c-1000',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Sports Research',
    name: 'Vitamin C 1000 mg',
    dosageForm: 'Capsule',
    route: null,
  },
  actives: [
    {
      name: 'Vitamin C',
      amount: 1000,
      unit: 'mg',
      amountText: '1000 mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: [],
  serving: {
    servingSize: '1 capsule',
    servingsPerContainer: 60,
  },
  labelDosing: [],
  warnings: {
    warnings: [],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: false,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 100,
  },
});

const buildPersonalizationContext = (
  overrides?: Partial<DecisionSupportAttachedPersonalizationContext>,
): DecisionSupportAttachedPersonalizationContext => ({
  prioritizedGoals: ['recovery'],
  selectedGoalKey: 'recovery',
  preferredTypes: ['vitamin'],
  supplementExperience: 'regular_user',
  ageRange: '25-34',
  adherenceBlocker: 'label_and_dosage_confusion',
  stackOverlap: {
    status: 'ok',
    savedStackCount: 0,
    overlapCount: 0,
    overlaps: [],
  },
  allergyContext: {
    userAllergyFlags: [],
    userIngredientRestrictions: [],
    productAllergyFlags: ['fish'],
    productIngredientRestrictions: ['gelatin_animal_based'],
    productCoverageStatus: 'resolved',
    productMatchEvidence: {},
  },
  ...overrides,
});

test('compileDecisionSupport uses attached Recovery goal to return a non-pending omega-3 fit', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-fit',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext(),
  });

  assert.equal(compiled.personalizedResultLane.goalFit.status, 'ready');
  assert.equal(compiled.personalizedResultLane.goalFit.selectedGoalKey, 'recovery');
  assert.notEqual(compiled.personalizedResultLane.goalFit.fitTier, 'unknown');
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'single_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, null);
  assert.notEqual(compiled.personalizedResultLane.personalInsight.status, 'pending');
  assert.ok(compiled.personalizedResultLane.personalInsight.supports.length > 0);
  assert.match(compiled.personalizedResultLane.goalFit.summary, /Recovery/i);
});

test('compileDecisionSupport returns multi-goal coverage in user-selected order with no-match states included', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-multi-goal',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['energy', 'immunity', 'recovery'],
      selectedGoalKey: 'energy',
    }),
  });

  assert.deepEqual(compiled.personalizedResultLane.goalFit.selectedGoalKeys, ['energy', 'immunity', 'recovery']);
  assert.equal(compiled.personalizedResultLane.goalFit.goalLensMode, 'multi_goal_summary');
  assert.deepEqual(
    compiled.personalizedResultLane.goalFit.goalCoverage?.map((entry) => entry.goalKey),
    ['energy', 'immunity', 'recovery'],
  );
  assert.equal(compiled.personalizedResultLane.goalFit.goalCoverage?.[0]?.state, 'none');
  assert.equal(compiled.personalizedResultLane.goalFit.goalCoverage?.[2]?.source, 'selected_goal_evaluation');
  assert.notEqual(compiled.personalizedResultLane.goalFit.goalCoverage?.[2]?.state, 'none');
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'dominant_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, 'immunity');
});

test('compileDecisionSupport preserves legacy top-3 fields while adding full multi-goal coverage metadata', () => {
  const prioritizedGoals = [
    'energy',
    'immunity',
    'recovery',
    'sleep',
    'focus',
    'stress_support',
    'weight_management',
    'libido_enhancement',
  ] as const;
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-all-goals',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: [...prioritizedGoals],
      selectedGoalKey: 'recovery',
    }),
  });

  assert.deepEqual(compiled.personalizedResultLane.goalFit.selectedGoalKeys, ['energy', 'immunity', 'recovery']);
  assert.deepEqual(compiled.personalizedResultLane.goalFit.allSelectedGoalKeys, prioritizedGoals);
  assert.equal(compiled.personalizedResultLane.goalFit.selectedGoalCount, prioritizedGoals.length);
  assert.equal(compiled.personalizedResultLane.goalFit.analyzedGoalCount, prioritizedGoals.length);
  assert.equal(compiled.personalizedResultLane.goalFit.surfacedGoalCount, 3);
  assert.equal(compiled.personalizedResultLane.goalFit.allGoalsAnalyzed, true);
  assert.equal(compiled.personalizedResultLane.goalFit.allGoalCoverage?.length, prioritizedGoals.length);
  assert.equal(compiled.personalizedResultLane.goalFit.goalCoverage?.length, 3);
  assert.deepEqual(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.map((entry) => entry.goalKey),
    prioritizedGoals,
  );
  assert.ok(compiled.personalizedResultLane.goalFit.allGoalCoverage?.some((entry) => entry.state === 'none'));
  assert.ok(compiled.personalizedResultLane.goalFit.defaultVisibleGoalKeys?.includes('recovery'));
  assert.equal(compiled.personalizedResultLane.goalFit.defaultVisibleGoalKeys?.length, 3);
  const recoveryCoverage = compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'recovery');
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'dominant_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, 'immunity');
  assert.ok((compiled.personalizedResultLane.goalFit.dominanceGap ?? 0) >= 18);
  assert.notEqual(compiled.personalizedResultLane.goalFit.goalNarrativeConfidence, 'low');
  assert.notEqual(compiled.personalizedResultLane.goalFit.labelCompleteness, 'low');
  assert.equal(recoveryCoverage?.source, 'selected_goal_evaluation');
  assert.equal(typeof recoveryCoverage?.score, 'number');
  assert.ok((recoveryCoverage?.score ?? 0) > 0);
  assert.ok(recoveryCoverage?.reasonCodes?.includes('goal_supported_by_ingredient'));
  assert.equal(recoveryCoverage?.confidenceBucket, 'high');
});

test('compileDecisionSupport falls back to original order for visible goals when every analyzed goal is limited, none, or unknown', () => {
  const compiled = compileDecisionSupport({
    digest: {
      ...buildOmegaDigest(),
      actives: [],
    },
    factsDigestHash: 'fixture-sr-all-none-goals',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['energy', 'immunity', 'sleep', 'stress_support'],
      selectedGoalKey: 'energy',
    }),
  });

  assert.deepEqual(compiled.personalizedResultLane.goalFit.allSelectedGoalKeys, ['energy', 'immunity', 'sleep', 'stress_support']);
  assert.deepEqual(
    compiled.personalizedResultLane.goalFit.defaultVisibleGoalKeys,
    ['energy', 'immunity', 'sleep'],
  );
  assert.ok(
    (compiled.personalizedResultLane.goalFit.allGoalCoverage ?? []).every(
      (entry) => entry.state === 'limited' || entry.state === 'none' || entry.state === 'unknown',
    ),
  );
  assert.ok(
    (compiled.personalizedResultLane.goalFit.goalCoverageSummary?.items ?? []).some(
      (entry) => entry.fitLevel === 'unknown',
    ),
  );
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'insufficient_signal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, null);
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, null);
  assert.equal(compiled.personalizedResultLane.goalFit.goalNarrativeConfidence, 'low');
  assert.equal(compiled.personalizedResultLane.goalFit.labelCompleteness, 'low');
});

test('compileDecisionSupport classifies mixed multi-goal coverage and exposes ranked metadata', () => {
  const compiled = compileDecisionSupport({
    digest: buildMagnesiumTheanineDigest(),
    factsDigestHash: 'fixture-sr-mixed-goal-coverage',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['sleep', 'focus', 'stress_support'],
      selectedGoalKey: 'sleep',
    }),
  });

  assert.equal(compiled.personalizedResultLane.goalFit.goalLensMode, 'multi_goal_summary');
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'mixed_goals');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'sleep');
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, 'stress_support');
  assert.ok((compiled.personalizedResultLane.goalFit.dominanceGap ?? 0) >= 0);
  assert.notEqual(compiled.personalizedResultLane.goalFit.goalNarrativeConfidence, undefined);
  assert.notEqual(compiled.personalizedResultLane.goalFit.labelCompleteness, undefined);
  assert.deepEqual(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.map((entry) => entry.goalKey),
    ['sleep', 'focus', 'stress_support'],
  );
  assert.ok(
    (compiled.personalizedResultLane.goalFit.allGoalCoverage ?? []).every(
      (entry) => typeof entry.score === 'number' && Array.isArray(entry.reasonCodes) && entry.reasonCodes.length > 0,
    ),
  );
  assert.ok(
    (compiled.personalizedResultLane.goalFit.allGoalCoverage ?? []).every(
      (entry) => ['high', 'medium', 'low'].includes(entry.confidenceBucket ?? 'low'),
    ),
  );
});

test('compileDecisionSupport keeps vitamin C in dominant-goal mode when immunity is clearly strongest', () => {
  const compiled = compileDecisionSupport({
    digest: buildVitaminCDigest(),
    factsDigestHash: 'fixture-vitamin-c-dominant-immunity',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['energy', 'immunity', 'recovery', 'stress_support'],
      selectedGoalKey: 'energy',
      allergyContext: {
        userAllergyFlags: [],
        userIngredientRestrictions: [],
        productAllergyFlags: [],
        productIngredientRestrictions: [],
        productCoverageStatus: 'resolved',
        productMatchEvidence: {},
      },
    }),
  });

  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'dominant_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'immunity');
  assert.equal(compiled.personalizedResultLane.goalFit.secondaryGoalKey, 'recovery');
  assert.ok((compiled.personalizedResultLane.goalFit.dominanceGap ?? 0) >= 18);
  assert.notEqual(compiled.personalizedResultLane.goalFit.goalNarrativeConfidence, 'low');
  assert.notEqual(compiled.personalizedResultLane.goalFit.labelCompleteness, 'low');
  assert.equal(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'immunity')?.state,
    'strong',
  );
  assert.equal(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'recovery')?.state,
    'limited',
  );
  assert.equal(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'stress_support')?.state,
    'limited',
  );
  assert.equal(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'energy')?.state,
    'none',
  );
  const immunityCoverage = compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'immunity');
  const immunitySummary = compiled.personalizedResultLane.goalFit.goalCoverageSummary?.items.find((entry) => entry.goalKey === 'immunity');
  assert.ok((immunityCoverage?.graphEvidence?.length ?? 0) > 0);
  assert.ok(
    (immunityCoverage?.graphEvidence ?? []).some((entry) =>
      entry.sourceType === 'review_article' && /Vitamin C and Immune Function/i.test(entry.title),
    ),
  );
  assert.match(
    immunityCoverage?.explanation?.provenance?.join(' ') ?? '',
    /Evidence note: Vitamin C and Immune Function/i,
  );
  assert.ok((immunitySummary?.graphEvidence?.length ?? 0) > 0);
  assert.match(
    immunitySummary?.explanation?.provenance?.join(' ') ?? '',
    /Evidence note: Vitamin C and Immune Function/i,
  );
});

test('compileDecisionSupport does not collapse omega-3 into a negative sleep verdict when recovery remains stronger', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-omega-recovery-sleep-calibrated',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['recovery', 'sleep'],
      selectedGoalKey: 'sleep',
    }),
  });

  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'dominant_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(
    compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'recovery')?.state,
    'some',
  );
  assert.ok(
    ['none', 'unknown'].includes(
      compiled.personalizedResultLane.goalFit.allGoalCoverage?.find((entry) => entry.goalKey === 'sleep')?.state ?? 'none',
    ),
  );
  assert.doesNotMatch(
    compiled.personalizedResultLane.goalFit.summary,
    /not fit your goal|not suitable for your|not a strong fit/i,
  );
});

test('compileDecisionSupport returns a neutral ready insight when saved supplements are attached but empty', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-empty-stack',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      stackOverlap: {
        status: 'ok',
        savedStackCount: 0,
        overlapCount: 0,
        overlaps: [],
      },
    }),
  });

  assert.equal(compiled.personalizedResultLane.personalInsight.status, 'ready');
  assert.equal(compiled.personalizedResultLane.personalInsight.reasonCode, null);
  assert.deepEqual(compiled.personalizedResultLane.personalInsight.conflicts, []);
  assert.equal(
    compiled.personalizedResultLane.personalInsight.conflictSummary,
    'No saved supplements to compare yet.',
  );
});

test('compileDecisionSupport turns remote omega-3 overlap into concrete personal insight conflicts', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-overlap',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      stackOverlap: {
        status: 'ok',
        savedStackCount: 2,
        overlapCount: 1,
        overlaps: [
          {
            ingredientKey: 'omega-3',
            ingredientDisplay: 'Omega-3',
            count: 2,
            supplements: [
              { supplementId: 'current-omega', productName: 'Sports Research Omega-3 1040 mg' },
              { supplementId: 'saved-omega', productName: 'Nordic Naturals Ultimate Omega' },
            ],
          },
        ],
      },
    }),
  });

  assert.equal(compiled.personalizedResultLane.personalInsight.status, 'ready');
  assert.equal(compiled.personalizedResultLane.personalInsight.conflicts.length, 1);
  assert.equal(compiled.personalizedResultLane.personalInsight.conflicts[0]?.ingredient, 'Omega-3');
  assert.match(
    compiled.personalizedResultLane.personalInsight.conflictSummary,
    /saved supplement/i,
  );
  assert.equal(compiled.personalizedResultLane.personalInsight.expandableDetailsReady, true);

  const recoveryCoverage = compiled.personalizedResultLane.goalFit.allGoalCoverage?.find(
    (entry) => entry.goalKey === 'recovery',
  );
  const recoverySummary = compiled.personalizedResultLane.goalFit.goalCoverageSummary?.items.find(
    (entry) => entry.goalKey === 'recovery',
  );
  assert.equal(compiled.personalizedResultLane.goalFit.heroMode, 'single_goal');
  assert.equal(compiled.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(recoveryCoverage?.stackAdjustment?.stackContextImpact, 'negative');
  assert.equal(recoveryCoverage?.stackAdjustment?.marginalValue, 'medium');
  assert.ok((recoveryCoverage?.stackAdjustment?.adjustedScore ?? 0) < (recoveryCoverage?.score ?? 0));
  assert.match(
    recoveryCoverage?.explanation?.action?.join(' ') ?? '',
    /review overlap/i,
  );
  assert.equal(recoverySummary?.stackAdjustment?.stackContextImpact, 'negative');
  assert.equal(recoverySummary?.stackAdjustment?.marginalValue, 'medium');
});

test('compileDecisionSupport keeps hero mode stable when stack overlap only changes marginal value', () => {
  const withoutOverlap = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-no-overlap',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['recovery'],
      selectedGoalKey: 'recovery',
      stackOverlap: {
        status: 'ok',
        savedStackCount: 0,
        overlapCount: 0,
        overlaps: [],
      },
    }),
  });

  const withOverlap = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-with-overlap',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      prioritizedGoals: ['recovery'],
      selectedGoalKey: 'recovery',
      stackOverlap: {
        status: 'ok',
        savedStackCount: 2,
        overlapCount: 1,
        overlaps: [
          {
            ingredientKey: 'omega-3',
            ingredientDisplay: 'Omega-3',
            count: 2,
            supplements: [
              { supplementId: 'current-omega', productName: 'Sports Research Omega-3 1040 mg' },
              { supplementId: 'saved-omega', productName: 'Nordic Naturals Ultimate Omega' },
            ],
          },
        ],
      },
    }),
  });

  assert.equal(withoutOverlap.personalizedResultLane.goalFit.heroMode, 'single_goal');
  assert.equal(withOverlap.personalizedResultLane.goalFit.heroMode, 'single_goal');
  assert.equal(withoutOverlap.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');
  assert.equal(withOverlap.personalizedResultLane.goalFit.dominantGoalKey, 'recovery');

  const withoutOverlapRecovery = withoutOverlap.personalizedResultLane.goalFit.allGoalCoverage?.find(
    (entry) => entry.goalKey === 'recovery',
  );
  const withOverlapRecovery = withOverlap.personalizedResultLane.goalFit.allGoalCoverage?.find(
    (entry) => entry.goalKey === 'recovery',
  );

  assert.ok((withoutOverlapRecovery?.stackAdjustment?.adjustedScore ?? withoutOverlapRecovery?.score ?? 0)
    >= (withOverlapRecovery?.stackAdjustment?.adjustedScore ?? withOverlapRecovery?.score ?? 0));
  assert.equal(withOverlapRecovery?.stackAdjustment?.stackContextImpact, 'negative');
});
