import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeDecisionSupportProfileRows,
  type DecisionSupportProfileRow,
} from '../src/decisionSupportProfileMerge';

const buildProfile = (
  overrides: Partial<DecisionSupportProfileRow> = {},
): DecisionSupportProfileRow => ({
  age: null,
  age_range: null,
  gender: null,
  sex: null,
  dietary_preference: null,
  dietary_preferences: null,
  activity_level: null,
  supplement_experience: null,
  preferred_types: null,
  adherence_blocker: null,
  location: null,
  location_country: null,
  location_city: null,
  health_goals: null,
  allergy_flags: null,
  ingredient_restrictions: null,
  ...overrides,
});

test('mergeDecisionSupportProfileRows carries local scan goals into an authenticated profile that only has allergy settings', () => {
  const merged = mergeDecisionSupportProfileRows({
    remoteProfile: buildProfile({
      allergy_flags: ['fish'],
      health_goals: null,
    }),
    localProfile: buildProfile({
      health_goals: ['immunity'],
      allergy_flags: ['fish'],
    }),
  });

  assert.deepEqual(merged?.health_goals, ['immunity']);
  assert.deepEqual(merged?.allergy_flags, ['fish']);
});

test('mergeDecisionSupportProfileRows preserves remote profile data when no local scan profile is attached', () => {
  const remoteProfile = buildProfile({
    health_goals: ['recovery'],
    allergy_flags: ['soy'],
  });

  const merged = mergeDecisionSupportProfileRows({
    remoteProfile,
    localProfile: null,
  });

  assert.deepEqual(merged, remoteProfile);
});
