import assert from 'node:assert/strict';
import test from 'node:test';

import {
  goalMatchScoringInternals,
  scoreProductGoalMatches,
} from './core/goalMatchScoring';
import {
  getDefaultGoalKeys,
  getGoalCatalogEntry,
  normalizeGoalKey,
} from './core/goalCatalog';

test('goal catalog normalizes V1 labels and onboarding aliases into GoalKey values', () => {
  assert.equal(normalizeGoalKey('Boost Energy'), 'energy');
  assert.equal(normalizeGoalKey('general wellness'), 'recovery');
  assert.equal(normalizeGoalKey('Libido Enhancement'), 'libido_enhancement');
  assert.equal(getGoalCatalogEntry('Stress Support')?.goalKey, 'stress_support');
  assert.deepEqual(getDefaultGoalKeys(), ['sleep', 'energy', 'immunity', 'recovery', 'focus']);
});

test('scoreProductGoalMatches yields a strong match when a mapped ingredient has verified goal evidence and meets dose floor', () => {
  const matches = scoreProductGoalMatches({
    goals: ['energy'],
    ingredients: [
      {
        ingredientLabel: 'Vitamin B12',
        amount: 500,
        unit: 'mcg',
        evidence: [
          {
            goal: 'Energy',
            evidence_grade: 'A',
            min_effective_dose: 250,
            unit: 'mcg',
            audit_status: 'verified',
          },
        ],
      },
    ],
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.goalKey, 'energy');
  assert.equal(matches[0]?.tier, 'strong_match');
  assert.ok((matches[0]?.score ?? 0) >= 95);
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'goal_supported_by_ingredient'));
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'dose_meets_effective_floor'));
});

test('scoreProductGoalMatches can keep a mapped magnesium lane related from catalog evidence when dose and form are supportive', () => {
  const matches = scoreProductGoalMatches({
    goals: ['stress_support'],
    ingredients: [
      {
        ingredientLabel: 'Magnesium Glycinate',
        amount: 200,
        unit: 'mg',
        formLabel: 'Glycinate',
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'related');
  assert.ok((matches[0]?.score ?? 0) >= 80);
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'goal_specific_evidence_present'));
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'ingredient_form_preferred'));
});

test('scoreProductGoalMatches downgrades below-floor evidence conservatively', () => {
  const matches = scoreProductGoalMatches({
    goals: ['sleep'],
    ingredients: [
      {
        ingredientKey: 'magnesium',
        ingredientLabel: 'Magnesium Glycinate',
        amount: 50,
        unit: 'mg',
        evidence: [
          {
            goalKey: 'sleep',
            evidenceGrade: 'B',
            minEffectiveDose: 200,
            unit: 'mg',
          },
        ],
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'weak_match');
  assert.ok((matches[0]?.score ?? 0) < 70);
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'dose_below_effective_floor'));
});

test('scoreProductGoalMatches treats explicit zero dose as below floor, not missing detail', () => {
  const matches = scoreProductGoalMatches({
    goals: ['energy'],
    ingredients: [
      {
        ingredientLabel: 'Vitamin B12',
        amount: 0,
        unit: 'mcg',
        evidence: [
          {
            goal: 'Energy',
            evidence_grade: 'A',
            min_effective_dose: 250,
            unit: 'mcg',
            audit_status: 'verified',
          },
        ],
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'weak_match');
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'dose_below_effective_floor'));
  assert.ok(!matches[0]?.reasons.some((reason) => reason.code === 'dose_not_disclosed'));
  assert.ok(
    !matches[0]?.reasons.some((reason) => reason.code === 'goal_support_not_enough_label_detail'),
  );
  assert.equal(
    goalMatchScoringInternals.normalizeGoalNarrativeFitLevel({
      tier: matches[0]?.tier ?? 'no_match',
      reasonCodes: matches[0]?.reasons.map((reason) => reason.code) ?? [],
      coverageStatus: 'coverage_ready',
      labelCompleteness: 'full',
    }),
    'limited',
  );
});

test('scoreProductGoalMatches does not turn unrelated missing doses into broad unknown lanes', () => {
  const matches = scoreProductGoalMatches({
    goals: ['focus'],
    ingredients: [
      {
        ingredientLabel: 'Vitamin D3',
        amount: null,
        amountUnknown: true,
        unit: 'mcg',
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'no_match');
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'no_goal_support_detected'));
  assert.ok(
    !matches[0]?.reasons.some((reason) => reason.code === 'goal_support_not_enough_label_detail'),
  );
  assert.equal(
    goalMatchScoringInternals.normalizeGoalNarrativeFitLevel({
      tier: matches[0]?.tier ?? 'no_match',
      reasonCodes: matches[0]?.reasons.map((reason) => reason.code) ?? [],
      coverageStatus: 'coverage_ready',
      labelCompleteness: 'partial',
    }),
    'none',
  );
});

test('scoreProductGoalMatches caps strong matches when disclosure is low or proprietary blend detail is weak', () => {
  const matches = scoreProductGoalMatches({
    goals: ['focus'],
    disclosureQuality: 'low',
    proprietaryBlendWithoutClearActives: true,
    ingredients: [
      {
        ingredientKey: 'l_theanine',
        amount: 200,
        unit: 'mg',
        evidence: [
          {
            goalKey: 'focus',
            evidenceGrade: 'A',
            minEffectiveDose: 100,
            unit: 'mg',
          },
        ],
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'weak_match');
  assert.deepEqual(matches[0]?.caps, ['low_disclosure', 'proprietary_blend']);
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'low_disclosure_caps_strong_match'));
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'proprietary_blend_caps_goal_match'));
});

test('scoreProductGoalMatches carries a generic safety cap for starter ingredients that require extra review', () => {
  const matches = scoreProductGoalMatches({
    goals: ['weight management'],
    ingredients: [
      {
        ingredientLabel: 'Green Tea Extract',
        amount: 300,
        unit: 'mg',
      },
    ],
  });

  assert.equal(matches[0]?.goalKey, 'weight_management');
  assert.equal(matches[0]?.tier, 'weak_match');
  assert.ok(matches[0]?.caps?.includes('generic_safety_path'));
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'ingredient_requires_generic_safety_path'));
});

test('scoreProductGoalMatches recognizes the expanded core-goal evidence map with conservative tiers', () => {
  const scenarios = [
    {
      goalKey: 'sleep',
      ingredient: {
        ingredientKey: 'glycine',
        amount: 3000,
        unit: 'mg',
      },
      expectedTier: 'related',
      expectedMinScore: 70,
    },
    {
      goalKey: 'energy',
      ingredient: {
        ingredientKey: 'caffeine',
        amount: 50,
        unit: 'mg',
        evidence: [
          {
            goalKey: 'energy',
            evidenceGrade: 'A',
            minEffectiveDose: 50,
            unit: 'mg',
            audit_status: 'verified',
          },
        ],
      },
      expectedTier: 'strong_match',
      expectedMinScore: 90,
    },
    {
      goalKey: 'immunity',
      ingredient: {
        ingredientKey: 'elderberry',
        amount: 300,
        unit: 'mg',
        formLabel: 'Extract',
      },
      expectedTier: 'related',
      expectedMinScore: 70,
    },
    {
      goalKey: 'recovery',
      ingredient: {
        ingredientKey: 'tart_cherry',
        amount: 480,
        unit: 'mg',
        formKey: 'extract',
      },
      expectedTier: 'related',
      expectedMinScore: 70,
    },
    {
      goalKey: 'focus',
      ingredient: {
        ingredientKey: 'citicoline',
        amount: 250,
        unit: 'mg',
        formLabel: 'CDP Choline',
      },
      expectedTier: 'related',
      expectedMinScore: 70,
    },
  ];

  for (const scenario of scenarios) {
    const matches = scoreProductGoalMatches({
      goals: [scenario.goalKey],
      ingredients: [scenario.ingredient],
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.goalKey, scenario.goalKey);
    assert.equal(matches[0]?.tier, scenario.expectedTier);
    assert.ok((matches[0]?.score ?? 0) >= scenario.expectedMinScore);
    assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'goal_supported_by_ingredient'));
    assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'dose_meets_effective_floor'));
  }
});

test('goalMatchScoring internals normalize ingredient keys and units consistently', () => {
  assert.equal(
    goalMatchScoringInternals.normalizeIngredientKey({ ingredientLabel: 'Vitamin B12' }),
    'vitamin_b12',
  );
  assert.deepEqual(goalMatchScoringInternals.evaluateDose(1, 'g', 500, 'mg'), { status: 'within' });
});

test('scoreProductGoalMatches keeps vitamin C dominant for immunity while exposing only limited secondary support lanes', () => {
  const matches = scoreProductGoalMatches({
    goals: ['immunity', 'recovery', 'stress_support'],
    ingredients: [
      {
        ingredientLabel: 'Vitamin C',
        amount: 1000,
        unit: 'mg',
      },
    ],
  });

  const immunity = matches.find((match) => match.goalKey === 'immunity');
  const recovery = matches.find((match) => match.goalKey === 'recovery');
  const stress = matches.find((match) => match.goalKey === 'stress_support');

  assert.equal(immunity?.tier, 'strong_match');
  assert.ok((immunity?.score ?? 0) >= 95);
  assert.ok(immunity?.reasons.some((reason) => reason.code === 'goal_specific_evidence_present'));

  assert.equal(recovery?.tier, 'weak_match');
  assert.ok((recovery?.score ?? 0) >= 30);
  assert.equal(stress?.tier, 'weak_match');
  assert.ok((stress?.score ?? 0) >= 30);
  assert.ok((immunity?.score ?? 0) > (recovery?.score ?? 0));
});

test('scoreProductGoalMatches strengthens omega-3 recovery without creating a false energy lane', () => {
  const matches = scoreProductGoalMatches({
    goals: ['recovery', 'energy'],
    ingredients: [
      {
        ingredientLabel: 'Omega-3 Fish Oil',
        amount: 1200,
        unit: 'mg',
        formLabel: 'Triglyceride',
      },
    ],
  });

  const recovery = matches.find((match) => match.goalKey === 'recovery');
  const energy = matches.find((match) => match.goalKey === 'energy');

  assert.equal(recovery?.tier, 'related');
  assert.ok((recovery?.score ?? 0) >= 80);
  assert.ok(recovery?.reasons.some((reason) => reason.code === 'ingredient_form_preferred'));
  assert.equal(energy?.tier, 'no_match');
});

test('preferred magnesium forms now separate sleep and stress support more clearly than generic forms', () => {
  const glycinateMatches = scoreProductGoalMatches({
    goals: ['sleep', 'stress_support'],
    ingredients: [
      {
        ingredientLabel: 'Magnesium Glycinate',
        amount: 200,
        unit: 'mg',
        formLabel: 'Glycinate',
      },
    ],
  });

  const oxideMatches = scoreProductGoalMatches({
    goals: ['sleep', 'stress_support'],
    ingredients: [
      {
        ingredientLabel: 'Magnesium Oxide',
        amount: 200,
        unit: 'mg',
        formLabel: 'Oxide',
      },
    ],
  });

  const glycinateSleep = glycinateMatches.find((match) => match.goalKey === 'sleep');
  const oxideSleep = oxideMatches.find((match) => match.goalKey === 'sleep');
  const glycinateStress = glycinateMatches.find((match) => match.goalKey === 'stress_support');
  const oxideStress = oxideMatches.find((match) => match.goalKey === 'stress_support');

  assert.equal(glycinateSleep?.tier, 'related');
  assert.equal(glycinateStress?.tier, 'related');
  assert.ok((glycinateSleep?.score ?? 0) > (oxideSleep?.score ?? 0));
  assert.ok((glycinateStress?.score ?? 0) > (oxideStress?.score ?? 0));
  assert.ok(glycinateSleep?.reasons.some((reason) => reason.code === 'ingredient_form_preferred'));
  assert.ok(glycinateStress?.reasons.some((reason) => reason.code === 'ingredient_form_preferred'));
});

test('zinc keeps a strong immunity lane when the preferred form and dose are disclosed', () => {
  const matches = scoreProductGoalMatches({
    goals: ['immunity', 'recovery'],
    ingredients: [
      {
        ingredientLabel: 'Zinc Picolinate',
        amount: 15,
        unit: 'mg',
        formLabel: 'Picolinate',
      },
    ],
  });

  const immunity = matches.find((match) => match.goalKey === 'immunity');
  const recovery = matches.find((match) => match.goalKey === 'recovery');

  assert.equal(immunity?.tier, 'strong_match');
  assert.ok((immunity?.score ?? 0) >= 95);
  assert.ok(immunity?.reasons.some((reason) => reason.code === 'ingredient_form_preferred'));
  assert.equal(recovery?.tier, 'no_match');
});

test('formula patterns strengthen immunity and sleep combinations without changing the lead goal family', () => {
  const immunityMatches = scoreProductGoalMatches({
    goals: ['immunity'],
    ingredients: [
      { ingredientLabel: 'Vitamin C', amount: 1000, unit: 'mg' },
      { ingredientLabel: 'Zinc Picolinate', amount: 15, unit: 'mg', formLabel: 'Picolinate' },
      { ingredientLabel: 'Vitamin D3', amount: 25, unit: 'mcg', formLabel: 'D3' },
    ],
  });
  const sleepMatches = scoreProductGoalMatches({
    goals: ['sleep'],
    ingredients: [
      { ingredientLabel: 'Magnesium Glycinate', amount: 200, unit: 'mg', formLabel: 'Glycinate' },
      { ingredientLabel: 'L-Theanine', amount: 200, unit: 'mg' },
    ],
  });

  assert.equal(immunityMatches[0]?.tier, 'strong_match');
  assert.ok((immunityMatches[0]?.score ?? 0) > 95);
  assert.ok(immunityMatches[0]?.reasons.some((reason) => reason.code === 'formula_pattern_immunity_vitamin_c_zinc'));

  assert.ok((sleepMatches[0]?.score ?? 0) >= 80);
  assert.ok(sleepMatches[0]?.reasons.some((reason) => reason.code === 'formula_pattern_sleep_magnesium_theanine'));
});

test('missing dose on a mapped lane now preserves an uncertainty reason instead of pretending to be cleanly unsupported', () => {
  const matches = scoreProductGoalMatches({
    goals: ['sleep'],
    ingredients: [
      {
        ingredientLabel: 'Magnesium Glycinate',
        amountUnknown: true,
        formLabel: 'Glycinate',
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'weak_match');
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'goal_support_not_enough_label_detail'));
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'dose_not_disclosed'));
});
