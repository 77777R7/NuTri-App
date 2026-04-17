import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMobileScanSmokeRun,
  evaluateMobileScanSmokeSummary,
  loadMobileScanSmokeConfig,
  validateMobileScanSmokeConfig,
} from "../../scripts/maintainer/lib/mobile-scan-smoke-mini.mjs";

test("mobile scan smoke mini config stays schema-valid", async () => {
  const config = await loadMobileScanSmokeConfig("data/validation/mobile-scan-smoke-mini.v0.json");
  assert.deepEqual(validateMobileScanSmokeConfig(config), []);
  assert.equal(config.releaseBlocker, true);
  assert.ok(config.barcodes.length >= 8);
  assert.ok(config.repeatConsistencyRoles.includes("natures_way_algal_oil"));
  assert.equal(config.devicePreflight?.enabled, true);
  assert.match(String(config.devicePreflight?.appUrl ?? ""), /^nutri:\/\//);
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

test("mobile scan smoke run fails release evidence when device preflight is missing or blocked", () => {
  const config = {
    version: "mobile-scan-smoke-mini.v0",
    releaseBlocker: true,
    devicePreflight: {
      enabled: true,
      appUrl: "nutri://",
      waitSeconds: 5,
      strictPopupCheck: true,
    },
    thresholds: {
      doneSeenRateMin: 0.8,
      scoreVisibleRateMin: 0.6,
      killerProductClientTimeoutRateMax: 0.25,
    },
    roleExpectations: [],
    repeatConsistencyRoles: [],
  };

  const summary = {
    stats: {
      doneSeenRate: 1,
      scoreVisibleRate: 1,
      killerProductClientTimeoutRate: 0,
    },
    attempts: [
      {
        role: "killer",
        doneSeen: true,
        scoreVisible: true,
        decisionSupportFetchStatus: "ok",
        decisionSupportVerdict: "ok",
        rawDecisionSupport: {
          selectedIngredientName: "Vitamin C",
          nutriScoreCardV2: { overallBand: "Strong" },
        },
      },
    ],
  };

  const missingPreflightReport = evaluateMobileScanSmokeRun({ config, summary, preflight: null });
  assert.ok(missingPreflightReport.gates.some((gate) => gate.gate === "device_preflight" && gate.status === "fail"));

  const blockedPreflightReport = evaluateMobileScanSmokeRun({
    config,
    summary,
    preflight: {
      targetUdid: "SIM-123",
      appUrl: "nutri://",
      popupBlocked: true,
      popupSignals: ["expo_go_overlay"],
      screenshots: {
        launch: "/tmp/launch.png",
        preflight: "/tmp/preflight.png",
      },
    },
  });
  assert.ok(
    blockedPreflightReport.gates.some(
      (gate) => gate.gate === "device_preflight" && gate.status === "fail" && gate.reason === "device_preflight_blocked",
    ),
  );
});
