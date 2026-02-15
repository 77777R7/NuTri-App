import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApplyCopy,
  buildAutosyncPatch,
  isAnchorSlotActive,
  shouldShowSuggestedPlanCard,
  shouldShowScheduleTimeCategoryPill,
} from "../../lib/schedulePresentation";

test("schedule presentation: choice mode updates button/notice with selected anchor", () => {
  const breakfastCopy = buildApplyCopy({
    requiresManualTime: false,
    timesPerDaySource: "heuristic",
    timesPerDaySuggested: 1,
    displayMode: "choice_slots",
    anchor: { label: "Breakfast", time: "08:00", withFood: true },
  });
  const dinnerCopy = buildApplyCopy({
    requiresManualTime: false,
    timesPerDaySource: "heuristic",
    timesPerDaySuggested: 1,
    displayMode: "choice_slots",
    anchor: { label: "Dinner", time: "18:30", withFood: true },
  });

  assert.equal(breakfastCopy.buttonText, "Save Breakfast reminder");
  assert.match(breakfastCopy.notice ?? "", /Breakfast \(08:00\)/);
  assert.equal(dinnerCopy.buttonText, "Save Dinner reminder");
  assert.match(dinnerCopy.notice ?? "", /Dinner \(18:30\)/);
  assert.equal(
    isAnchorSlotActive(
      { label: "Dinner", time: "18:30", withFood: true },
      { label: "Dinner", time: "18:30", withFood: false },
    ),
    true,
  );
});

test("schedule presentation: autosync patch only updates time and withFood", () => {
  const before = {
    time: "11:02",
    withFood: false,
    timeTouched: false,
    timeUserSet: false,
  };
  const patch = buildAutosyncPatch({ label: "Breakfast", time: "08:00", withFood: true });
  const after = { ...before, ...patch };

  assert.equal(after.time, "08:00");
  assert.equal(after.withFood, true);
  assert.equal(after.timeTouched, false);
  assert.equal(after.timeUserSet, false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "timeTouched"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "timeUserSet"), false);
});

test("schedule presentation: not-set state never shows morning pill", () => {
  assert.equal(shouldShowScheduleTimeCategoryPill(null, true), false);
  assert.equal(shouldShowScheduleTimeCategoryPill("", true), false);
  assert.equal(shouldShowScheduleTimeCategoryPill("08:00", true), true);
});

test("schedule presentation: saved schedules hide suggested card", () => {
  assert.equal(shouldShowSuggestedPlanCard(null), true);
  assert.equal(shouldShowSuggestedPlanCard(""), true);
  assert.equal(shouldShowSuggestedPlanCard("08:00"), false);
});
