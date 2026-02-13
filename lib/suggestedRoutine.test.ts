import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoutineTimeUserSet } from './routineIntent';
import { buildSuggestedRoutineV0 } from './suggestedRoutine';

test('buildSuggestedRoutineV0: timesPerDay=1 defaults to Dinner', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 1,
      withMeals: true,
      timingHints: ['with_meals'],
    },
    parseConfidence: 0.9,
    rawDirectionsText: 'Take once daily with meals.',
    withFoodFallback: true,
  });

  assert.equal(out.slots[0]?.label, 'Dinner');
  assert.equal(out.applyAnchor.label, 'Dinner');
});

test('buildSuggestedRoutineV0: timesPerDay=2 yields Breakfast + Dinner', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: [],
    },
    parseConfidence: 0.8,
    rawDirectionsText: 'Take 1 tablet twice daily.',
    withFoodFallback: true,
  });

  assert.deepEqual(out.slots.map((slot) => slot.label), ['Breakfast', 'Dinner']);
});

test('buildSuggestedRoutineV0: maps slots to user meal-time preferences when provided', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: [],
    },
    parseConfidence: 0.8,
    rawDirectionsText: 'Take 1 tablet twice daily.',
    withFoodFallback: true,
    mealTimePrefs: {
      breakfast: '09:45',
      lunch: '13:15',
      dinner: '20:10',
      bedtime: '23:15',
      updatedAt: new Date().toISOString(),
    },
  });

  assert.deepEqual(out.slots.map((slot) => slot.time), ['09:45', '20:10']);
});

test('buildSuggestedRoutineV0: post-workout timing uses flexible slot and does not force Dinner', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 1,
      withMeals: null,
      timingHints: [],
    },
    parseConfidence: 0.3,
    rawDirectionsText: null,
    withFoodFallback: false,
    timingKind: 'post_workout',
  });

  assert.equal(out.requiresManualTime, true);
  assert.equal(out.slots[0]?.label, 'Flexible');
  assert.equal(out.applyAnchor.label, 'Flexible');
});

test('buildSuggestedRoutineV0: anchor picks nearest slot when existing time is user-set', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: [],
    },
    parseConfidence: 0.8,
    rawDirectionsText: 'Take 2 times daily with meals.',
    withFoodFallback: true,
    existingRoutineTime: '09:00',
    existingTimeUserSet: true,
  });

  assert.equal(out.applyAnchor.label, 'Breakfast');
});

test('buildSuggestedRoutineV0: legacy routine time-only records still keep nearest-slot anchor', () => {
  const existingTimeUserSet = resolveRoutineTimeUserSet({
    time: '09:00',
    timeUserSet: undefined,
  });

  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: [],
    },
    parseConfidence: 0.8,
    rawDirectionsText: 'Take 2 times daily with meals.',
    withFoodFallback: true,
    existingRoutineTime: '09:00',
    existingTimeUserSet,
  });

  assert.equal(out.applyAnchor.label, 'Breakfast');
});

test('buildSuggestedRoutineV0: anchor uses Dinner-first when existing time is not user-set', () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: [],
    },
    parseConfidence: 0.8,
    rawDirectionsText: 'Take 2 times daily with meals.',
    withFoodFallback: true,
    existingRoutineTime: '09:00',
    existingTimeUserSet: false,
  });

  assert.equal(out.applyAnchor.label, 'Dinner');
});

test('buildSuggestedRoutineV0: applyNotice wording is source-aware', () => {
  const labelBacked = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: true,
      timingHints: ['with_meals'],
    },
    parseConfidence: 0.9,
    rawDirectionsText: 'Adults: 1 tablet, 2 times daily with meals.',
    withFoodFallback: true,
  });
  assert.match(labelBacked.applyNotice ?? '', /Label suggests 2x daily/i);
  assert.equal(labelBacked.timesPerDaySuggested, 2);

  const heuristic = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: 2,
      withMeals: null,
      timingHints: [],
    },
    parseConfidence: 0.2,
    rawDirectionsText: null,
    withFoodFallback: true,
  });
  assert.equal(heuristic.timesPerDaySource, "heuristic");
  assert.equal(heuristic.timesPerDaySuggested, 1);
  assert.doesNotMatch(heuristic.applyNotice ?? "", /2x daily/i);
  assert.doesNotMatch(heuristic.applyNotice ?? "", /Label suggests/i);
  assert.match(heuristic.applyNotice ?? "", /We'll save one reminder/i);
});

test("buildSuggestedRoutineV0: non-label meal-based suggestions use choice display mode and single reminder", () => {
  const out = buildSuggestedRoutineV0({
    parsed: {
      timesPerDay: null,
      withMeals: null,
      timingHints: [],
    },
    parseConfidence: 0.2,
    rawDirectionsText: null,
    withFoodFallback: true,
    timingKind: "meal_based",
  });

  assert.equal(out.displayMode, "choice_slots");
  assert.equal(out.timesPerDaySource, "unknown");
  assert.equal(out.timesPerDaySuggested, 1);
  assert.match(out.applyNotice ?? "", /Choose breakfast or dinner/i);
});
