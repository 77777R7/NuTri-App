import assert from 'node:assert/strict';
import test from 'node:test';

import type { FeedbackState, PersonalizationSnapshot } from '@/types/personalization';
import { applyFeedbackStateToSnapshot } from './feedback/overrideRegistry';
import { compilePersonalizationSnapshot } from './core/personalizationCompiler';

const buildSnapshot = (): PersonalizationSnapshot =>
  compilePersonalizationSnapshot({
    computedAt: '2026-03-18T18:10:00.000Z',
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
    evaluations: {
      productGoalMatches: {
        product_a: [{ goalKey: 'sleep', score: 72, tier: 'strong_match', reasons: [], caps: [] }],
        product_b: [{ goalKey: 'energy', score: 68, tier: 'related', reasons: [], caps: [] }],
      },
      eligibility: {
        product_a: { eligible: true, rankEligible: true, caps: [], reasons: [] },
        product_b: { eligible: true, rankEligible: true, caps: [], reasons: [] },
      },
    },
  });

const feedbackState: FeedbackState = {
  version: 'personalization-feedback/v1',
  updatedAt: '2026-03-18T18:10:00.000Z',
  events: [],
  overrides: {
    scheduleDefaults: {
      reminderPriority: 'low',
      suggestedTimingAnchors: ['dinner'],
      preferScheduleSetup: false,
    },
    smartFilter: {
      visibleGoals: ['energy'],
      preselectedTypes: ['protein'],
      highlightedGoal: 'energy',
    },
    firstStack: {
      dismissedProductIds: ['product_a'],
      scheduleTemplateKey: 'manual_override_template',
    },
  },
  dismissals: {
    first_stack: ['product'],
  },
};

test('overrideRegistry applies persisted surface overrides before snapshot consumption', () => {
  const snapshot = applyFeedbackStateToSnapshot(buildSnapshot(), feedbackState);

  assert.equal(snapshot.strategies.blocker.primarySupportFocus, 'reminder');
  assert.equal(snapshot.surfaces.scheduleDefaults.reminderPriority, 'low');
  assert.deepEqual(snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors, ['dinner']);
  assert.equal(snapshot.surfaces.scheduleDefaults.preferScheduleSetup, false);
  assert.deepEqual(snapshot.surfaces.smartFilter.visibleGoals, ['energy']);
  assert.deepEqual(snapshot.surfaces.smartFilter.preselectedTypes, ['protein']);
  assert.equal(snapshot.surfaces.smartFilter.highlightedGoal, 'energy');
});

test('overrideRegistry removes dismissed first-stack products and keeps override template', () => {
  const snapshot = applyFeedbackStateToSnapshot(buildSnapshot(), feedbackState);

  assert.deepEqual(
    snapshot.evaluations.firstStackPlan?.items.map((item) => item.productId),
    ['product_b'],
  );
  assert.equal(snapshot.evaluations.firstStackPlan?.scheduleTemplateKey, 'manual_override_template');
  assert.ok(snapshot.trace.some((reason) => reason.code === 'personalization.override.applied'));
});
