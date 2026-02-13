import assert from "node:assert/strict";
import test from "node:test";

import { resolveRoutineTimeUserSet } from "./routineIntent";

test("resolveRoutineTimeUserSet: false when routine time is empty", () => {
  assert.equal(resolveRoutineTimeUserSet({ time: "" }), false);
  assert.equal(resolveRoutineTimeUserSet({}), false);
});

test("resolveRoutineTimeUserSet: respects explicit timeUserSet flag", () => {
  assert.equal(resolveRoutineTimeUserSet({ time: "09:00", timeUserSet: true }), true);
  assert.equal(resolveRoutineTimeUserSet({ time: "09:00", timeUserSet: false }), false);
});

test("resolveRoutineTimeUserSet: legacy grandfather rule treats undefined flag + time as user-set", () => {
  assert.equal(
    resolveRoutineTimeUserSet({
      time: "09:00",
      timeUserSet: undefined,
    }),
    true,
  );
  assert.equal(
    resolveRoutineTimeUserSet({
      time: "09:00",
      timeUserSet: undefined,
      whenToTake: undefined,
      howToTake: undefined,
    }),
    true,
  );
});
