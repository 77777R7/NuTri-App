import assert from "node:assert/strict";
import { test } from "node:test";

import { AnalysisBundleSchema } from "../dist/analysisBundle.js";
import { applyWebBundleEvidenceGate } from "../dist/webEvidenceGate.js";

const buildWebDigest = ({ withEvidence }) => ({
  sourceType: "web",
  identity: { type: "webCanonicalId", value: "web:test", regionTags: [] },
  product: { brandDisplay: "Brand", name: "Product", dosageForm: null, route: null },
  actives: [
    {
      name: "Magnesium",
      amount: 100,
      unit: "mg",
      evidenceText: withEvidence ? "Magnesium 100 mg per serving." : null,
      source: "web",
      confidence: 0.7,
    },
  ],
  inactives: [],
  serving: { servingSize: withEvidence ? "1 capsule" : null, servingsPerContainer: null },
  labelDosing: withEvidence
    ? [{ population: null, age: null, dose: "1 capsule", frequency: "daily", rawText: "Take 1 capsule daily" }]
    : [],
  warnings: { warnings: withEvidence ? ["Do not exceed dose."] : [], consultDoctorIf: [], redFlags: [], missingFlag: true },
  claims: { labelPurposes: [], webClaims: [] },
  quality: { isComplete: false, missingFields: [], completenessScore: 0.2 },
});

const buildBundle = ({ fallbackReason = null, pipelineCode = null } = {}) => ({
  meta: {
    schemaVersion: 4,
    promptVersion: "reg_v4.0",
    sourceType: "web",
    sourceTypeFinal: true,
    scoreAvailable: true,
    detailReady: true,
    authoritativeIdentity: { type: "webCanonicalId", value: "web:test" },
    locale: "en",
    phase: "fast_ai",
    bundleId: "bundle-web-gate-1",
    revision: 1,
    factsDigestHash: "digest-web-gate-1",
    factsSourceVersion: "web:v1",
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(pipelineCode
      ? {
          webPipeline: [
            { step: "select_evidence", status: "failed", code: pipelineCode },
            { step: "draft", status: "degraded", code: `blocked_by:${pipelineCode}` },
          ],
        }
      : {}),
  },
  sections: {
    overview: {
      layout: "overview_card",
      cover: {
        summary: "Supports daily wellness.",
        bullets: [{ text: "Supports daily wellness.", basisTags: ["web_evidence"] }],
      },
      detail: {
        summary: "Supports daily wellness.",
        bullets: [{ text: "Supports daily wellness.", basisTags: ["web_evidence"] }],
      },
      dataStatus: "complete",
    },
    ingredients: {
      layout: "ingredients_list",
      cover: {
        items: [
          { name: "Magnesium", dose: "100 mg", basisTags: ["web_evidence"] },
          { name: "Vitamin D", dose: "25 mcg", basisTags: ["web_evidence"] },
        ],
        totalCount: 2,
      },
      detail: {
        items: [
          {
            name: "Magnesium",
            whatItDoes: { text: "Supports muscle function.", basisTags: ["web_evidence"] },
            doseContext: { text: "100 mg listed.", basisTags: ["web_evidence"] },
            chemicalFormExplain: { text: "Magnesium oxide.", basisTags: ["web_evidence"] },
            deliveryFormExplain: null,
          },
        ],
        overallSummary: { text: "Two actives found.", basisTags: ["web_evidence"] },
        overlapNotes: null,
      },
      dataStatus: "complete",
    },
    usage: {
      layout: "usage_bullets",
      cover: {
        bullets: [{ text: "Take once daily.", basisTags: ["web_evidence"] }],
        bestTimeToTake: { text: "Morning.", basisTags: ["web_evidence"] },
        withFood: { value: true, text: "Take with food.", basisTags: ["web_evidence"] },
        dosage: null,
      },
      detail: { timingRationale: null, withFoodRationale: null, scheduleFromLabel: [] },
      dataStatus: "complete",
    },
    safety: {
      layout: "safety_bullets",
      cover: {
        verdict: "Generally tolerated at listed dose.",
        bullets: [{ text: "Check with clinician if needed.", basisTags: ["general_advice"] }],
      },
      detail: { warnings: [], consultDoctorIf: [], redFlags: [] },
      dataStatus: "complete",
    },
  },
});

test("ownership_unverified fallback forces limited web experience and disables score", () => {
  const parsed = AnalysisBundleSchema.safeParse(buildBundle({ fallbackReason: "ownership_unverified" }));
  assert.equal(parsed.success, true);

  const result = applyWebBundleEvidenceGate(parsed.data, buildWebDigest({ withEvidence: true }));
  assert.equal(result.reasons.includes("ownership_unverified"), true);
  assert.equal(result.value.meta.scoreAvailable, false);
  assert.equal(result.value.sections.overview.dataStatus, "limited");
  assert.equal(result.value.sections.ingredients.dataStatus, "limited");
  assert.equal(result.value.sections.usage.dataStatus, "limited");
  assert.equal(result.value.sections.safety.dataStatus, "limited");
  assert.equal(result.value.sections.ingredients.detail, null);
  assert.equal(result.value.sections.ingredients.cover?.items?.length, 1);
});

test("needs_js pipeline code maps to hard not_provided overview", () => {
  const parsed = AnalysisBundleSchema.safeParse(buildBundle({ pipelineCode: "blocked_by:needs_js" }));
  assert.equal(parsed.success, true);

  const result = applyWebBundleEvidenceGate(parsed.data, buildWebDigest({ withEvidence: true }));
  assert.equal(result.reasons.includes("needs_js"), true);
  assert.equal(result.value.sections.overview.dataStatus, "not_provided");
  assert.match(result.value.sections.overview.cover?.summary ?? "", /javascript/i);
});

test("missing evidence still degrades with web_text_unusable", () => {
  const parsed = AnalysisBundleSchema.safeParse(buildBundle());
  assert.equal(parsed.success, true);

  const result = applyWebBundleEvidenceGate(parsed.data, buildWebDigest({ withEvidence: false }));
  assert.equal(result.reasons.includes("web_text_unusable"), true);
  assert.equal(result.value.meta.fallbackReason, "web_text_unusable");
  assert.equal(result.value.sections.overview.dataStatus, "not_provided");
  assert.equal(result.value.sections.usage.dataStatus, "limited");
  assert.equal(result.value.sections.safety.dataStatus, "limited");
});
