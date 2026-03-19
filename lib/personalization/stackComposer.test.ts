import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductGoalMatch } from '@/types/personalization';
import { composeFirstStackPlan } from './core/stackComposer';

const goalMatch = (
  goalKey: ProductGoalMatch['goalKey'],
  score: number,
  tier: ProductGoalMatch['tier'],
): ProductGoalMatch => ({
  goalKey,
  score,
  tier,
  reasons: [],
  caps: [],
});

test('composeFirstStackPlan builds a coverage-oriented stack instead of pure score sorting', () => {
  const plan = composeFirstStackPlan({
    prioritizedGoals: ['recovery', 'energy', 'focus'],
    blockerStrategy: {
      reminderPriority: 'medium',
      scheduleComplexity: 'guided',
      notificationBudget: 'standard',
      emphasizeHomeCheckIn: true,
      emphasizeScheduleSetup: true,
      emphasizeExplanation: false,
    },
    experienceMode: {
      explanationDepth: 'guided',
      uiDensity: 'standard',
      showAdvancedSafety: false,
      showDetailedForms: false,
    },
    activityPlan: {
      suggestedGoals: ['recovery', 'energy'],
      suggestedTypes: ['protein', 'mineral'],
      suggestedTimingAnchors: ['post_workout'],
      reasons: [],
    },
    productGoalMatches: {
      product_a: [
        goalMatch('recovery', 95, 'strong_match'),
        goalMatch('energy', 20, 'no_match'),
        goalMatch('focus', 0, 'no_match'),
      ],
      product_b: [
        goalMatch('recovery', 10, 'no_match'),
        goalMatch('energy', 88, 'strong_match'),
        goalMatch('focus', 0, 'no_match'),
      ],
      product_c: [
        goalMatch('recovery', 0, 'no_match'),
        goalMatch('energy', 34, 'weak_match'),
        goalMatch('focus', 75, 'related'),
      ],
    },
    eligibility: {
      product_a: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      product_b: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      product_c: { eligible: true, rankEligible: true, caps: [], reasons: [] },
    },
  });

  assert.deepEqual(
    plan.items.map((item) => [item.productId, item.role]),
    [
      ['product_a', 'foundation'],
      ['product_b', 'goal_support'],
      ['product_c', 'goal_support'],
    ],
  );
  assert.equal(plan.scheduleTemplateKey, 'phase3_guided_template');
});

test('composeFirstStackPlan excludes rank-ineligible products and records the filter', () => {
  const plan = composeFirstStackPlan({
    prioritizedGoals: ['immunity'],
    blockerStrategy: {
      reminderPriority: 'low',
      scheduleComplexity: 'simple',
      notificationBudget: 'light',
      emphasizeHomeCheckIn: false,
      emphasizeScheduleSetup: false,
      emphasizeExplanation: false,
    },
    experienceMode: {
      explanationDepth: 'guided',
      uiDensity: 'standard',
      showAdvancedSafety: false,
      showDetailedForms: false,
    },
    activityPlan: {
      suggestedGoals: [],
      suggestedTypes: [],
      suggestedTimingAnchors: [],
      reasons: [],
    },
    productGoalMatches: {
      blocked_product: [goalMatch('immunity', 92, 'strong_match')],
      allowed_product: [goalMatch('immunity', 74, 'related')],
    },
    eligibility: {
      blocked_product: {
        eligible: true,
        rankEligible: false,
        caps: ['duplicate_overlap_high'],
        reasons: [],
      },
      allowed_product: { eligible: true, rankEligible: true, caps: [], reasons: [] },
    },
  });

  assert.deepEqual(
    plan.items.map((item) => item.productId),
    ['allowed_product'],
  );
  assert.ok(
    plan.explanationFacts.some((reason) => reason.code === 'personalization.first_stack.filtered_ineligible'),
  );
});

test('composeFirstStackPlan trims stack size when duplicate risk is high', () => {
  const plan = composeFirstStackPlan({
    prioritizedGoals: ['immunity', 'energy', 'focus'],
    blockerStrategy: {
      reminderPriority: 'medium',
      scheduleComplexity: 'advanced',
      notificationBudget: 'standard',
      emphasizeHomeCheckIn: false,
      emphasizeScheduleSetup: true,
      emphasizeExplanation: false,
    },
    experienceMode: {
      explanationDepth: 'advanced',
      uiDensity: 'advanced',
      showAdvancedSafety: true,
      showDetailedForms: true,
    },
    activityPlan: {
      suggestedGoals: ['immunity'],
      suggestedTypes: ['vitamin'],
      suggestedTimingAnchors: ['breakfast', 'dinner'],
      reasons: [],
    },
    duplicateRiskLevel: 'high',
    productGoalMatches: {
      product_a: [goalMatch('immunity', 90, 'strong_match')],
      product_b: [goalMatch('energy', 82, 'strong_match')],
      product_c: [goalMatch('focus', 74, 'related')],
      product_d: [goalMatch('focus', 40, 'weak_match')],
    },
    eligibility: {
      product_a: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      product_b: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      product_c: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      product_d: { eligible: true, rankEligible: true, caps: [], reasons: [] },
    },
  });

  assert.equal(plan.items.length, 3);
  assert.ok(plan.explanationFacts.some((reason) => reason.code === 'duplicate_overlap_high'));
});

test('composeFirstStackPlan prefers evaluated candidate bundles over stale legacy maps', () => {
  const plan = composeFirstStackPlan({
    prioritizedGoals: ['immunity'],
    blockerStrategy: {
      reminderPriority: 'medium',
      scheduleComplexity: 'guided',
      notificationBudget: 'standard',
      emphasizeHomeCheckIn: true,
      emphasizeScheduleSetup: true,
      emphasizeExplanation: false,
    },
    experienceMode: {
      explanationDepth: 'guided',
      uiDensity: 'standard',
      showAdvancedSafety: false,
      showDetailedForms: false,
    },
    activityPlan: {
      suggestedGoals: [],
      suggestedTypes: [],
      suggestedTimingAnchors: [],
      reasons: [],
    },
    productGoalMatches: {
      stale_product: [goalMatch('immunity', 99, 'strong_match')],
    },
    eligibility: {
      stale_product: { eligible: true, rankEligible: true, caps: [], reasons: [] },
    },
    savedProductEvaluations: {
      ready_product: {
        productId: 'ready_product',
        factsStatus: 'full',
        coverage: {
          factsStatus: 'full',
          status: 'coverage_ready',
          reasons: [],
        },
        productGoalMatches: [goalMatch('immunity', 81, 'strong_match')],
        eligibility: { eligible: true, rankEligible: true, caps: [], reasons: [] },
        firstStackEligible: true,
        smartFilterMembership: {
          productId: 'ready_product',
          factsStatus: 'full',
          coverageStatus: 'coverage_ready',
          bucket: 'strong_match',
          goalTiers: { immunity: 'strong_match' },
          reasons: [],
        },
        reasons: [],
        display: {
          title: 'Immune Support Complex',
          brandName: 'NuTri Labs',
          dosageText: '500 mg',
        },
      },
      partial_product: {
        productId: 'partial_product',
        factsStatus: 'partial',
        coverage: {
          factsStatus: 'partial',
          status: 'not_enough_structured_data',
          reasons: [],
        },
        productGoalMatches: [goalMatch('immunity', 95, 'strong_match')],
        firstStackEligible: false,
        smartFilterMembership: {
          productId: 'partial_product',
          factsStatus: 'partial',
          coverageStatus: 'not_enough_structured_data',
          bucket: 'not_enough_structured_data',
          goalTiers: {},
          reasons: [],
        },
        reasons: [],
        display: {
          title: 'Partial Product Should Not Enter',
        },
      },
    },
  });

  assert.deepEqual(
    plan.items.map((item) => item.productId),
    ['ready_product'],
  );
  assert.deepEqual(plan.items[0]?.display, {
    title: 'Immune Support Complex',
    brandName: 'NuTri Labs',
    dosageText: '500 mg',
  });
});
