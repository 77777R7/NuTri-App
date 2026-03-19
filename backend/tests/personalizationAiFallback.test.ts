import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExplanationPayload } from "../../types/personalization";
import { renderDeterministicExplanation } from "../src/personalization/ai";
import { createDeepSeekPersonalizationExplainer } from "../src/personalization/explainers/deepseekExplainer";

const PLAN_PREVIEW_PAYLOAD: ExplanationPayload = {
  snapshotId: "psn_plan_preview",
  rulesVersion: "personalization-rules/v1-phase3",
  surface: "plan_preview",
  selectedGoals: ["sleep", "immunity"],
  selectedTypes: ["vitamin", "mineral"],
  facts: [{ factId: "busy", code: "busy_day_blocker_mealtime_anchor" }],
};

test("renderDeterministicExplanation returns a stable plan-preview fallback from structured payload only", () => {
  const result = renderDeterministicExplanation(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.source, "deterministic");
  assert.equal(result.fallback, true);
  assert.match(result.summary, /sleep/i);
  assert.ok(result.bullets.some((bullet) => /busy days/i.test(bullet)));
});

test("DeepSeek personalization explainer falls back deterministically when no API key is available", async () => {
  const explainer = createDeepSeekPersonalizationExplainer({ apiKey: null });
  const result = await explainer.explain(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.source, "deterministic");
  assert.equal(result.fallback, true);
  assert.ok(result.bullets.length > 0);
});

test("DeepSeek personalization explainer falls back when the model response is invalid", async () => {
  const explainer = createDeepSeekPersonalizationExplainer({
    apiKey: "test-key",
    transport: async () => "not json",
  });

  const result = await explainer.explain(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.fallback, true);
  assert.equal(result.model, "deepseek-chat");
  assert.ok(result.summary.length > 0);
});
