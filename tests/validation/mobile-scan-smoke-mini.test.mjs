import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMobileScanSmokeSummary,
  loadMobileScanSmokeConfig,
  validateMobileScanSmokeConfig,
} from "../../scripts/maintainer/lib/mobile-scan-smoke-mini.mjs";

test("mobile scan smoke mini config stays schema-valid", async () => {
  const config = await loadMobileScanSmokeConfig("data/validation/mobile-scan-smoke-mini.v0.json");
  assert.deepEqual(validateMobileScanSmokeConfig(config), []);
  assert.equal(config.releaseBlocker, false);
  assert.ok(config.barcodes.length >= 8);
  assert.ok(config.repeatConsistencyRoles.includes("natures_way_algal_oil"));
});

test("mobile scan smoke mini evaluation catches threshold and repeat-consistency drift", () => {
  const config = {
    version: "mobile-scan-smoke-mini.v0",
    releaseBlocker: false,
    thresholds: {
      doneSeenRateMin: 0.8,
      scoreVisibleRateMin: 0.6,
      contentValuePassRateMin: 0.6,
      regulatoryRichRateMin: 0.2,
      killerProductClientTimeoutRateMax: 0.25,
    },
    roleExpectations: [
      { role: "not_found", doneSeenRateMax: 0, scoreVisibleRateMax: 0 },
      { role: "natures_way_algal_oil", doneSeenRateMin: 1 },
    ],
    repeatConsistencyRoles: ["natures_way_algal_oil"],
  };

  const summary = {
    stats: {
      doneSeenRate: 0.75,
      scoreVisibleRate: 0.75,
      contentValuePassRate: 0.75,
      regulatoryRichRate: 0.5,
      killerProductClientTimeoutRate: 0,
    },
    attempts: [
      {
        role: "natures_way_algal_oil",
        doneSeen: true,
        scoreVisible: true,
        contentValuePass: true,
        regulatoryRich: true,
        decisionSupportVerdict: "ok",
        rawDecisionSupport: {
          selectedIngredientName: "Omega-3 Algal Oil",
          nutriScoreCardV2: { overallBand: "Good" },
        },
      },
      {
        role: "natures_way_algal_oil",
        doneSeen: true,
        scoreVisible: true,
        contentValuePass: true,
        regulatoryRich: true,
        decisionSupportVerdict: "ok",
        rawDecisionSupport: {
          selectedIngredientName: "DHA",
          nutriScoreCardV2: { overallBand: "Good" },
        },
      },
      {
        role: "not_found",
        doneSeen: false,
        scoreVisible: false,
        contentValuePass: false,
        regulatoryRich: false,
        decisionSupportVerdict: "missing",
        rawDecisionSupport: {},
      },
      {
        role: "killer",
        doneSeen: true,
        scoreVisible: true,
        contentValuePass: true,
        regulatoryRich: false,
        decisionSupportFetchStatus: "ok",
        decisionSupportVerdict: "ok",
        rawDecisionSupport: {
          selectedIngredientName: "Vitamin C",
          nutriScoreCardV2: { overallBand: "Strong" },
        },
      },
    ],
  };

  const report = evaluateMobileScanSmokeSummary({ config, summary });
  assert.equal(report.summary.fail, 2);
  assert.ok(report.gates.some((gate) => gate.gate === "done_seen_rate" && gate.status === "fail"));
  assert.ok(report.gates.some((gate) => gate.gate === "repeat_consistency" && gate.status === "fail"));
  assert.ok(report.gates.some((gate) => gate.gate === "role_not_found" && gate.status === "pass"));
});
