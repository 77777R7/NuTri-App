import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AnalysisBundleSchema,
  PipelineMetricsEventSchema,
} from "../dist/analysisBundle.js";

test("pipeline_metrics event schema accepts structured step/status/ms payload", () => {
  const payload = {
    pipelineMetricsSchemaVersion: 1,
    requestId: "req_123",
    barcode: "00012345678901",
    sourceType: "web",
    steps: [
      { step: "retrieve", status: "ok", ms: 230 },
      { step: "sanitize", status: "ok", ms: 18 },
      { step: "verify", status: "degraded", code: "verify_not_enabled", ms: 3 },
      { step: "emit", status: "ok", ms: 1 },
    ],
    totalMs: 445,
    emittedAt: "2026-02-12T12:00:00.000Z",
  };

  const parsed = PipelineMetricsEventSchema.safeParse(payload);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.pipelineMetricsSchemaVersion, 1);
  assert.equal(parsed.data.sourceType, "web");
  assert.equal(parsed.data.steps.length, 4);
  assert.equal(parsed.data.totalMs, 445);
});

test("analysis_bundle webPipeline keeps stable fields and strips volatile ms", () => {
  const candidate = {
    meta: {
      schemaVersion: 4,
      promptVersion: "reg_v4.0",
      sourceType: "web",
      sourceTypeFinal: true,
      scoreAvailable: false,
      detailReady: true,
      authoritativeIdentity: { type: "webCanonicalId", value: "web:test" },
      locale: "en",
      phase: "fast_ai",
      bundleId: "bundle-1",
      revision: 1,
      factsDigestHash: "hash-1",
      factsSourceVersion: "web:v1",
      webPipelineSchemaVersion: 1,
      webPipeline: [
        { step: "retrieve", status: "ok", ms: 120 },
        { step: "verify", status: "degraded", code: "verify_not_enabled", ms: 2 },
      ],
      webVerifyMeta: {
        verifyStatus: "degraded",
        reviseStatus: "degraded",
        revisedClaimsCount: 2,
        droppedClaimsCount: 1,
        injectionClaimDroppedCount: 0,
        budgetUsedMs: 14,
        fallbackCode: "verify_claim_without_support",
      },
    },
    sections: {
      overview: {
        layout: "overview_card",
        cover: { summary: "Not provided by source.", bullets: [{ text: "Not provided by source.", basisTags: ["not_provided"] }] },
        detail: { summary: "Not provided by source.", bullets: [{ text: "Not provided by source.", basisTags: ["not_provided"] }] },
        dataStatus: "not_provided",
      },
      ingredients: {
        layout: "ingredients_list",
        cover: { items: [], totalCount: 0 },
        detail: { items: [], overallSummary: null, overlapNotes: null },
        dataStatus: "not_provided",
      },
      usage: {
        layout: "usage_bullets",
        cover: {
          bullets: [],
          bestTimeToTake: { text: "Anytime (with meals).", basisTags: ["not_provided"] },
          withFood: { value: true, text: "Prefer with meals for tolerability.", basisTags: ["general_advice"] },
          dosage: null,
        },
        detail: { timingRationale: null, withFoodRationale: null, scheduleFromLabel: [] },
        dataStatus: "limited",
      },
      safety: {
        layout: "safety_bullets",
        cover: { verdict: "Limited source coverage.", bullets: [{ text: "Not provided by source.", basisTags: ["not_provided"] }] },
        detail: { warnings: [], consultDoctorIf: [], redFlags: [] },
        dataStatus: "limited",
      },
    },
  };

  const parsed = AnalysisBundleSchema.safeParse(candidate);
  assert.equal(parsed.success, true);
  const webPipeline = parsed.data.meta.webPipeline;
  const webVerifyMeta = parsed.data.meta.webVerifyMeta;
  assert.equal(Array.isArray(webPipeline), true);
  assert.equal(webPipeline.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(webPipeline[0], "ms"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(webPipeline[1], "ms"), false);
  assert.equal(parsed.data.meta.webPipelineSchemaVersion, 1);
  assert.equal(webVerifyMeta?.verifyStatus, "degraded");
  assert.equal(webVerifyMeta?.droppedClaimsCount, 1);
});
