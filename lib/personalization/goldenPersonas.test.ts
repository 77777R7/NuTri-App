import assert from 'node:assert/strict';
import test from 'node:test';

import { compilePersonalizationSnapshot } from './core/personalizationCompiler';

test('golden persona: brand-new forgetful user gets habit-first defaults', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T12:00:00.000Z',
    profileInput: {
      draft: {
        goals: ['Sleep', 'Energy'],
        preferredTypes: ['Vitamin'],
        supplementExperience: 'Brand new',
        adherenceBlocker: 'I forget when my day gets busy',
        diets: ['Vegetarian'],
      },
      observed: {
        consistencyLevel: 'low',
        savedStackCount: 0,
      },
    },
  });

  assert.deepEqual(snapshot.strategies.blocker, {
    reminderPriority: 'high',
    scheduleComplexity: 'simple',
    notificationBudget: 'heavy',
    emphasizeHomeCheckIn: true,
    emphasizeScheduleSetup: true,
    emphasizeExplanation: true,
  });
  assert.deepEqual(snapshot.surfaces.scheduleDefaults, {
    reminderPriority: 'high',
    suggestedTimingAnchors: ['breakfast'],
    preferScheduleSetup: true,
    reasons: snapshot.surfaces.scheduleDefaults.reasons,
  });
  assert.deepEqual(snapshot.surfaces.home.prioritizedGoals, ['sleep', 'energy']);
});

test('golden persona: structured stack user gets advanced density and optimization mode', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T12:05:00.000Z',
    profileInput: {
      declared: {
        goals: [
          { key: 'recovery', priority: 100 },
          { key: 'focus', priority: 80 },
        ],
        preferredTypes: ['protein', 'mineral'],
        supplementExperience: 'structured_stack',
        adherenceBlocker: 'already_consistent',
        activity: ['Strength training', 'Running'],
      },
      observed: {
        consistencyLevel: 'high',
        savedStackCount: 6,
        duplicateRiskLevel: 'high',
        duplicateIngredientKeys: ['creatine', 'magnesium'],
      },
    },
  });

  assert.deepEqual(snapshot.strategies.experience, {
    explanationDepth: 'advanced',
    uiDensity: 'advanced',
    showAdvancedSafety: true,
    showDetailedForms: true,
  });
  assert.deepEqual(snapshot.strategies.activityPlan.suggestedTimingAnchors, ['post_workout', 'morning']);
  assert.equal(snapshot.profile.derived.blockerMode, 'optimization_first');
  assert.equal(snapshot.evaluations.firstStackPlan?.scheduleTemplateKey, 'phase3_advanced_template');
});

test('golden persona: uncertain planner highlights education and safe placeholders', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T12:10:00.000Z',
    profileInput: {
      draft: {
        goals: ['Focus', 'Stress Support'],
        preferredTypes: ['Herb'],
        supplementExperience: 'Tried a few',
        adherenceBlocker: 'Labels and dosage are confusing',
        diets: ['Low sugar'],
        activity: 'Yoga',
      },
      observed: {
        currentStreak: 1,
        consistencyLevel: 'medium',
        missedPattern: 'travel_days',
        savedStackCount: 2,
      },
    },
  });

  assert.equal(snapshot.strategies.blocker.emphasizeExplanation, true);
  assert.deepEqual(snapshot.surfaces.planPreview.dietLanes, ['diet_low_sugar_review']);
  assert.deepEqual(snapshot.evaluations.productGoalMatches, {});
  assert.deepEqual(snapshot.evaluations.eligibility, {});
  assert.deepEqual(snapshot.evaluations.firstStackPlan?.items, []);
});

test('golden persona: sparse inputs stay neutral instead of inventing setup pressure', () => {
  const snapshot = compilePersonalizationSnapshot({
    computedAt: '2026-03-18T12:15:00.000Z',
    profileInput: {
      declared: {
        goals: [{ key: 'sleep', priority: 70 }],
      },
    },
  });

  assert.equal(snapshot.profile.derived.blockerMode, undefined);
  assert.deepEqual(snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors, []);
  assert.equal(snapshot.strategies.blocker.emphasizeScheduleSetup, false);
  assert.equal(snapshot.strategies.experience.uiDensity, 'standard');
});
