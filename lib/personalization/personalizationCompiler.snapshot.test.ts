import assert from 'node:assert/strict';
import test from 'node:test';

import { compilePersonalizationSnapshot } from './core/personalizationCompiler';
import {
  selectHomePersonalization,
  selectPlanPreviewPersonalization,
  selectScheduleDefaultsPersonalization,
  selectSmartFilterPersonalization,
} from './selectors';

test('compilePersonalizationSnapshot emits a stable phase 3 snapshot with extracted strategies', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T11:00:00.000Z',
    snapshotId: 'snapshot_focus_low_phase3',
    profileInput: {
      draft: {
        goals: ['Focus', 'Energy'],
        preferredTypes: ['Herb', 'Probiotic'],
        adherenceBlocker: 'I am not sure which supplements fit my goals',
        supplementExperience: 'Tried a few',
        diets: ['Gluten free'],
        activity: 'Yoga',
      },
      observed: {
        currentStreak: 2,
        consistencyLevel: 'low',
        savedStackCount: 0,
        duplicateRiskLevel: 'medium',
        duplicateIngredientKeys: ['ashwagandha'],
      },
    },
  });

  assert.equal(snapshot.snapshotId, 'snapshot_focus_low_phase3');
  assert.equal(snapshot.rulesVersion, 'personalization-rules/v1-phase7');
  assert.equal(snapshot.profile.declared.goals[0]?.key, 'focus');
  assert.deepEqual(snapshot.strategies.blocker, {
    primarySupportFocus: 'explanation',
    reminderPriority: 'high',
    scheduleComplexity: 'simple',
    notificationBudget: 'standard',
    emphasizeHomeCheckIn: true,
    emphasizeScheduleSetup: false,
    emphasizeExplanation: true,
  });
  assert.deepEqual(snapshot.strategies.experience, {
    explanationDepth: 'guided',
    uiDensity: 'standard',
    showAdvancedSafety: false,
    showDetailedForms: false,
  });
  assert.deepEqual(snapshot.strategies.activityPlan.suggestedTimingAnchors, ['evening']);
  assert.equal(snapshot.strategies.supportState, 'choose');
  assert.deepEqual(snapshot.strategies.preferenceVector, {
    decisionMode: 'best_fit',
    explanationStyle: 'compare',
    notificationTolerance: 'high',
  });
  assert.deepEqual(snapshot.surfaces.smartFilter.visibleGoals, ['focus', 'energy']);
  assert.deepEqual(snapshot.surfaces.smartFilter.productMembershipById, {});
  assert.deepEqual(snapshot.surfaces.smartFilter.fallback?.notEnoughStructuredDataProductIds, []);
  assert.deepEqual(snapshot.surfaces.planPreview.activityAnchors, ['evening']);
  assert.deepEqual(snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors, ['evening']);
  assert.equal(snapshot.evaluations.firstStackPlan?.scheduleTemplateKey, 'phase3_simple_template');
  assert.ok(
    snapshot.trace.some(
      (reason) =>
        reason.code === 'personalization.blocker_strategy.consistency_overlay' &&
        reason.ruleId === 'personalization.strategy.blocker_consistency_overlay',
    ),
  );
  assert.ok(
    snapshot.trace.some(
      (reason) =>
        reason.code === 'personalization.schedule_defaults_surface.activity_seeded' &&
        reason.ruleId === 'personalization.surface.schedule_defaults',
    ),
  );
});

test('compilePersonalizationSnapshot composes a first stack instead of leaving placeholder-only output', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T11:15:00.000Z',
    profileInput: {
      declared: {
        goals: [
          { key: 'recovery', priority: 90 },
          { key: 'energy', priority: 80 },
          { key: 'focus', priority: 70 },
        ],
        preferredTypes: ['protein', 'mineral'],
        supplementExperience: 'structured_stack',
        adherenceBlocker: 'already_consistent',
      },
      observed: {
        savedStackCount: 5,
        consistencyLevel: 'high',
      },
    },
    evaluations: {
      productGoalMatches: {
        foundation_protein: [
          { goalKey: 'recovery', score: 92, tier: 'strong_match', reasons: [], caps: [] },
          { goalKey: 'energy', score: 18, tier: 'no_match', reasons: [], caps: [] },
          { goalKey: 'focus', score: 0, tier: 'no_match', reasons: [], caps: [] },
        ],
        energy_mineral: [
          { goalKey: 'recovery', score: 22, tier: 'weak_match', reasons: [], caps: [] },
          { goalKey: 'energy', score: 86, tier: 'strong_match', reasons: [], caps: [] },
          { goalKey: 'focus', score: 0, tier: 'no_match', reasons: [], caps: [] },
        ],
        focus_herb: [
          { goalKey: 'recovery', score: 0, tier: 'no_match', reasons: [], caps: [] },
          { goalKey: 'energy', score: 28, tier: 'weak_match', reasons: [], caps: [] },
          { goalKey: 'focus', score: 74, tier: 'related', reasons: [], caps: [] },
        ],
      },
      eligibility: {
        foundation_protein: { eligible: true, rankEligible: true, caps: [], reasons: [] },
        energy_mineral: { eligible: true, rankEligible: true, caps: [], reasons: [] },
        focus_herb: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      },
    },
  });

  assert.deepEqual(
    snapshot.evaluations.firstStackPlan?.items.map((item) => [item.productId, item.role]),
    [
      ['foundation_protein', 'foundation'],
      ['energy_mineral', 'goal_support'],
      ['focus_herb', 'goal_support'],
    ],
  );
  assert.equal(snapshot.evaluations.firstStackPlan?.scheduleTemplateKey, 'phase3_advanced_template');
  assert.ok(
    snapshot.evaluations.firstStackPlan?.explanationFacts.some(
      (reason) => reason.code === 'personalization.first_stack.schedule_template_selected',
    ),
  );
});

test('selectors consume compiled snapshot without additional logic', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T11:00:00.000Z',
    profileInput: {
      draft: {
        goals: ['Focus'],
        preferredTypes: ['Herb'],
      },
      observed: {
        savedStackCount: 0,
      },
    },
  });

  assert.equal(selectHomePersonalization(snapshot), snapshot.surfaces.home);
  assert.equal(selectSmartFilterPersonalization(snapshot), snapshot.surfaces.smartFilter);
  assert.equal(selectPlanPreviewPersonalization(snapshot), snapshot.surfaces.planPreview);
  assert.equal(selectScheduleDefaultsPersonalization(snapshot), snapshot.surfaces.scheduleDefaults);
});

test('compilePersonalizationSnapshot gates saved-product smart-filter membership by factsStatus', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-19T16:00:00.000Z',
    profileInput: {
      declared: {
        goals: [{ key: 'immunity', priority: 100 }],
      },
    },
    evaluations: {
      savedProducts: {
        ready_product: {
          productId: 'ready_product',
          factsStatus: 'full',
          typeKeys: ['vitamin'],
          display: {
            title: 'Immune Support Complex',
            brandName: 'NuTri Labs',
            dosageText: '500 mg',
          },
          productGoalMatches: [
            { goalKey: 'immunity', score: 92, tier: 'strong_match', reasons: [], caps: [] },
          ],
          eligibility: {
            eligible: true,
            rankEligible: true,
            caps: [],
            reasons: [],
          },
        },
        partial_product: {
          productId: 'partial_product',
          factsStatus: 'partial',
          typeKeys: ['protein'],
          productGoalMatches: [
            { goalKey: 'immunity', score: 88, tier: 'strong_match', reasons: [], caps: [] },
          ],
        },
      },
    },
  });

  assert.deepEqual(Object.keys(snapshot.evaluations.productGoalMatches), ['ready_product']);
  assert.equal(snapshot.evaluations.coverage?.ready_product.status, 'coverage_ready');
  assert.equal(
    snapshot.evaluations.coverage?.partial_product.status,
    'not_enough_structured_data',
  );
  assert.equal(
    snapshot.evaluations.savedProductEvaluations?.ready_product.smartFilterMembership.bucket,
    'strong_match',
  );
  assert.equal(
    snapshot.evaluations.savedProductEvaluations?.partial_product.smartFilterMembership.bucket,
    'not_enough_structured_data',
  );
  assert.deepEqual(snapshot.surfaces.smartFilter.productBuckets?.strong_match, ['ready_product']);
  assert.deepEqual(snapshot.surfaces.smartFilter.fallback?.notEnoughStructuredDataProductIds, [
    'partial_product',
  ]);
  assert.deepEqual(
    snapshot.surfaces.smartFilter.productMembershipById?.ready_product?.typeKeys,
    ['vitamin'],
  );
  assert.deepEqual(
    snapshot.surfaces.smartFilter.productMembershipById?.partial_product?.typeKeys,
    ['protein'],
  );
  assert.deepEqual(
    snapshot.evaluations.firstStackPlan?.items.map((item) => item.productId),
    ['ready_product'],
  );
  assert.equal(snapshot.evaluations.goalFitCards?.ready_product?.tier, 'strong_match');
  assert.equal(snapshot.premiumInsights?.stackAudit?.heldBack[0]?.productId, 'partial_product');
  assert.deepEqual(snapshot.evaluations.firstStackPlan?.items[0]?.display, {
    title: 'Immune Support Complex',
    brandName: 'NuTri Labs',
    dosageText: '500 mg',
  });
});

test('compilePersonalizationSnapshot prefers evaluated candidate bundles over stale base maps for first stack', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-19T16:30:00.000Z',
    profileInput: {
      declared: {
        goals: [{ key: 'immunity', priority: 100 }],
      },
    },
    evaluations: {
      productGoalMatches: {
        stale_product: [
          { goalKey: 'immunity', score: 99, tier: 'strong_match', reasons: [], caps: [] },
        ],
      },
      eligibility: {
        stale_product: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      },
      savedProductEvaluations: {
        evaluated_product: {
          productId: 'evaluated_product',
          factsStatus: 'full',
          coverage: {
            factsStatus: 'full',
            status: 'coverage_ready',
            reasons: [],
          },
          productGoalMatches: [
            { goalKey: 'immunity', score: 84, tier: 'strong_match', reasons: [], caps: [] },
          ],
          eligibility: {
            eligible: true,
            rankEligible: true,
            caps: [],
            reasons: [],
          },
          firstStackEligible: true,
          smartFilterMembership: {
            productId: 'evaluated_product',
            factsStatus: 'full',
            coverageStatus: 'coverage_ready',
            bucket: 'strong_match',
            typeKeys: ['vitamin'],
            goalTiers: { immunity: 'strong_match' },
            reasons: [],
          },
          reasons: [],
          display: {
            title: 'Evaluated Immune Product',
          },
        },
      },
    },
  });

  assert.deepEqual(
    snapshot.evaluations.firstStackPlan?.items.map((item) => item.productId),
    ['evaluated_product'],
  );
  assert.equal(snapshot.evaluations.firstStackPlan?.items[0]?.display?.title, 'Evaluated Immune Product');
});

test('compilePersonalizationSnapshot keeps neutral fallbacks when optional signals are missing', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T11:30:00.000Z',
    profileInput: {
      declared: {
        goals: [{ key: 'sleep', priority: 80 }],
      },
    },
  });

  assert.deepEqual(snapshot.profile.derived, {
    dietReviewLanes: [],
    activityPlanKeys: [],
    blockerMode: undefined,
  });
  assert.deepEqual(snapshot.strategies.blocker, {
    primarySupportFocus: 'reminder',
    reminderPriority: 'medium',
    scheduleComplexity: 'simple',
    notificationBudget: 'standard',
    emphasizeHomeCheckIn: false,
    emphasizeScheduleSetup: false,
    emphasizeExplanation: false,
  });
  assert.deepEqual(snapshot.strategies.experience, {
    explanationDepth: 'guided',
    uiDensity: 'standard',
    showAdvancedSafety: false,
    showDetailedForms: false,
  });
  assert.deepEqual(snapshot.surfaces.home.tipLaneKeys, []);
  assert.deepEqual(snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors, []);
  assert.equal(snapshot.evaluations.firstStackPlan?.scheduleTemplateKey, 'phase3_simple_template');
  assert.ok(!snapshot.trace.some((reason) => reason.code === 'personalization.saved_stack.observed'));
  assert.ok(!snapshot.trace.some((reason) => reason.code === 'personalization.consistency.observed'));
});

test('compilePersonalizationSnapshot lets current-session overrides win over persisted defaults', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T11:45:00.000Z',
    profileInput: {
      draft: {
        goals: ['Sleep', 'Energy'],
        preferredTypes: ['Vitamin'],
        adherenceBlocker: 'I forget when my day gets busy',
      },
      observed: {
        consistencyLevel: 'low',
        savedStackCount: 0,
      },
    },
    feedbackState: {
      version: 'personalization-feedback/v1',
      updatedAt: '2026-03-18T11:44:00.000Z',
      events: [],
      overrides: {
        scheduleDefaults: {
          reminderPriority: 'low',
          suggestedTimingAnchors: ['dinner'],
        },
      },
      dismissals: {},
    },
    overrideEvents: [
      {
        id: 'evt_now',
        userId: 'user_1',
        timestamp: '2026-03-18T11:45:00.000Z',
        source: 'user',
        surface: 'schedule_defaults',
        action: 'set',
        field: 'reminderPriority',
        value: 'high',
      },
    ],
  });

  assert.equal(snapshot.surfaces.scheduleDefaults.reminderPriority, 'high');
  assert.deepEqual(snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors, ['dinner']);
  assert.ok(snapshot.trace.some((reason) => reason.code === 'personalization.override.applied'));
});
