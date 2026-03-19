import assert from 'node:assert/strict';
import test from 'node:test';

import {
  profileResolverInternals,
  resolvePersonalizationProfile,
} from './core/profileResolver';

test('resolvePersonalizationProfile normalizes declared and observed signals from onboarding draft', () => {
  const profile = resolvePersonalizationProfile({
    computedAt: '2026-03-18T10:00:00.000Z',
    draft: {
      goals: ['Sleep', 'Energy', 'Sleep'],
      preferredTypes: ['Vitamin', 'Protein', 'Unknown'],
      adherenceBlocker: 'I forget when my day gets busy',
      supplementExperience: 'Brand new',
      diets: ['Vegetarian', 'Low sugar', 'Vegetarian'],
      activity: 'Running',
      ageRange: '25-34',
      sex: 'Female',
    },
    observed: {
      currentStreak: 3,
      consistencyLevel: 'medium',
      missedPattern: 'weekends',
      savedStackCount: 1,
      duplicateRiskLevel: 'high',
      duplicateIngredientKeys: ['magnesium', 'magnesium', 'vitamin_d'],
    },
  });

  assert.deepEqual(profile, {
    declared: {
      goals: [
        { key: 'sleep', priority: 20 },
        { key: 'energy', priority: 10 },
      ],
      preferredTypes: ['vitamin', 'protein'],
      adherenceBlocker: 'busy_day_forgetfulness',
      supplementExperience: 'brand_new',
      diets: ['Vegetarian', 'Low sugar'],
      activity: ['Running'],
      ageRange: '25-34',
      sex: 'Female',
    },
    observed: {
      currentStreak: 3,
      consistencyLevel: 'medium',
      missedPattern: 'weekends',
      savedStackCount: 1,
      duplicateRisk: {
        level: 'high',
        ingredientKeys: ['magnesium', 'vitamin_d'],
      },
    },
    derived: {
      dietReviewLanes: ['diet_vegetarian_support', 'diet_low_sugar_review'],
      activityPlanKeys: ['activity_endurance_support'],
      blockerMode: 'reminder_first',
    },
    meta: {
      profileVersion: 'personalization-profile/v1-phase1',
      computedAt: '2026-03-18T10:00:00.000Z',
    },
  });
});

test('resolvePersonalizationProfile accepts explicit declared overrides and deterministic defaults', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [
        { key: 'focus', priority: 90 },
        { key: 'energy', priority: 70 },
      ],
      preferredTypes: ['herb'],
      adherenceBlocker: 'already_consistent',
      supplementExperience: 'structured_stack',
      diets: ['Kosher'],
      activity: ['Strength training'],
      ageRange: '35-44',
      sex: 'Male',
    },
    observed: {
      savedStackCount: 5,
    },
  });

  assert.deepEqual(profile, {
    declared: {
      goals: [
        { key: 'focus', priority: 90 },
        { key: 'energy', priority: 70 },
      ],
      preferredTypes: ['herb'],
      adherenceBlocker: 'already_consistent',
      supplementExperience: 'structured_stack',
      diets: ['Kosher'],
      activity: ['Strength training'],
      ageRange: '35-44',
      sex: 'Male',
    },
    observed: {
      currentStreak: undefined,
      consistencyLevel: 'unknown',
      missedPattern: undefined,
      savedStackCount: 5,
      duplicateRisk: {
        level: 'none',
        ingredientKeys: [],
      },
    },
    derived: {
      dietReviewLanes: ['diet_kosher_review'],
      activityPlanKeys: ['activity_strength_support'],
      blockerMode: 'optimization_first',
    },
    meta: {
      profileVersion: 'personalization-profile/v1-phase1',
      computedAt: '1970-01-01T00:00:00.000Z',
    },
  });
});

test('resolvePersonalizationProfile preserves unknown derived state when optional signals are missing', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [{ key: 'sleep', priority: 60 }],
      diets: ['Unmapped diet'],
      activity: ['Casual walking'],
    },
  });

  assert.deepEqual(profile.observed, {
    currentStreak: undefined,
    consistencyLevel: 'unknown',
    missedPattern: undefined,
    savedStackCount: 0,
    duplicateRisk: {
      level: 'none',
      ingredientKeys: [],
    },
  });
  assert.deepEqual(profile.derived, {
    dietReviewLanes: [],
    activityPlanKeys: [],
    blockerMode: undefined,
  });
});

test('profileResolver internals map common aliases into stable keys', () => {
  assert.equal(profileResolverInternals.toGoalKey('Stress Support'), 'stress_support');
  assert.equal(profileResolverInternals.toSupplementTypeKey('Powder'), 'protein');
  assert.equal(
    profileResolverInternals.toBlockerKey('Labels and dosage are confusing'),
    'label_and_dosage_confusion',
  );
  assert.equal(profileResolverInternals.toExperienceLevel('Tried a few'), 'tried_a_few');
});
