import assert from "node:assert/strict";
import { test } from "node:test";

import { finalizePipelineStepCodes } from "../dist/pipelineMetrics.js";

const STEPS = [
  "retrieve",
  "sanitize",
  "select_evidence",
  "draft",
  "verify",
  "revise",
  "emit",
];

const baseState = () => {
  const map = new Map();
  for (const step of STEPS) {
    map.set(step, { step, status: "degraded", code: "not_reached" });
  }
  return map;
};

test("pipeline normalization rewrites not_reached into blocked_by:<rootCause> after upstream failure", () => {
  const state = baseState();
  state.set("select_evidence", { step: "select_evidence", status: "failed", code: "needs_js" });

  const finalized = finalizePipelineStepCodes(STEPS, state);
  assert.equal(finalized.get("select_evidence")?.code, "needs_js");
  assert.equal(finalized.get("draft")?.code, "blocked_by:needs_js");
  assert.equal(finalized.get("verify")?.code, "blocked_by:needs_js");
  assert.equal(finalized.get("revise")?.code, "blocked_by:needs_js");
  assert.equal(finalized.get("emit")?.code, "blocked_by:needs_js");
});

test("pipeline normalization rewrites not_reached into not_run when no upstream root cause exists", () => {
  const state = baseState();
  state.set("retrieve", { step: "retrieve", status: "ok", code: undefined });

  const finalized = finalizePipelineStepCodes(STEPS, state);
  assert.equal(finalized.get("sanitize")?.code, "not_run");
  assert.equal(finalized.get("select_evidence")?.code, "not_run");
});

test("pipeline normalization omits code when status is ok even if placeholder was present", () => {
  const state = baseState();
  state.set("retrieve", { step: "retrieve", status: "ok", code: "not_reached" });

  const finalized = finalizePipelineStepCodes(STEPS, state);
  assert.equal(Object.prototype.hasOwnProperty.call(finalized.get("retrieve"), "code"), true);
  assert.equal(finalized.get("retrieve")?.code, undefined);
});

test("pipeline normalization does not nest blocked_by prefixes (root cause stays stable)", () => {
  const state = baseState();
  state.set("select_evidence", { step: "select_evidence", status: "failed", code: "blocked_by:needs_js" });

  const finalized = finalizePipelineStepCodes(STEPS, state);
  assert.equal(finalized.get("draft")?.code, "blocked_by:needs_js");
  assert.equal(finalized.get("verify")?.code, "blocked_by:needs_js");
});

