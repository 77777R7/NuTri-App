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

test('scoreProductGoalMatches downgrades a strong catalog hint to related when goal-specific evidence is missing', () => {
  const matches = scoreProductGoalMatches({
    goals: ['stress_support'],
    ingredients: [
      {
        ingredientLabel: 'Magnesium Glycinate',
        amount: 200,
        unit: 'mg',
      },
    ],
  });

  assert.equal(matches[0]?.tier, 'related');
  assert.ok((matches[0]?.score ?? 0) >= 60);
  assert.ok(matches[0]?.reasons.some((reason) => reason.code === 'goal_specific_evidence_missing'));
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

test('goalMatchScoring internals normalize ingredient keys and units consistently', () => {
  assert.equal(
    goalMatchScoringInternals.normalizeIngredientKey({ ingredientLabel: 'Vitamin B12' }),
    'vitamin_b12',
  );
  assert.deepEqual(goalMatchScoringInternals.evaluateDose(1, 'g', 500, 'mg'), { status: 'meets' });
});
