import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyRiskReasons, denoiseAliasNorm, normalizeText } from "../audit-alias-plan-risk.ts";

test("D2: singleton vitamin should be risky", () => {
  const reasons = classifyRiskReasons("vitamin");
  assert.ok(reasons.includes("denylist_singleton:vitamin"));
});

test("D2: vitamin e should not be risky", () => {
  const reasons = classifyRiskReasons("vitamin e");
  assert.equal(reasons.length, 0);
});

test("D2: tokenized seed/whole should be risky; extract alone is allowed", () => {
  const reasons = classifyRiskReasons("Grape seed extract");
  assert.ok(reasons.includes("denylist_token:seed"));
  assert.ok(!reasons.includes("denylist_token:extract"));
  assert.equal(classifyRiskReasons("extract").length, 0);
});

test("D2: denoise semantics remain stable", () => {
  assert.equal(normalizeText("Vitamin-E 200mg"), "vitamin e 200mg");
  assert.equal(denoiseAliasNorm("with grape seed extract"), "grape seed extract");
});

test("D2: generic singleton token should be risky", () => {
  const reasons = classifyRiskReasons("blend");
  assert.ok(reasons.includes("denylist_singleton:blend"));
});

test("D2: short singleton token should be risky unless whitelisted vitamin token", () => {
  assert.ok(classifyRiskReasons("xr").includes("short_singleton_token"));
  assert.equal(classifyRiskReasons("b12").length, 0);
});
