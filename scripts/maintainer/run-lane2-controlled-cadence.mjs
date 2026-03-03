#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[run-lane2-controlled-cadence] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const lane2UxPath =
    resolvePath(getArg("lane2-ux-json"))
    ?? path.join(outDir, "new_top100_lane2_ux_visibility.json");
  const lane2DecisionPath =
    resolvePath(getArg("lane2-enforce-decisions-json"))
    ?? path.join(outDir, "new_top100_lane2_enforce_decisions.json");

  const historyPath = path.join(outDir, "lane2_watch_history.json");

  const lane2Ux = await readJson(lane2UxPath);
  const lane2Decisions = await readJson(lane2DecisionPath).catch(() => ({ rows: [] }));
  const history = await readJson(historyPath).catch(() => ({ byLane: {} }));

  const rows = Array.isArray(lane2Ux?.rows) ? lane2Ux.rows : [];
  const decisionRows = Array.isArray(lane2Decisions?.rows) ? lane2Decisions.rows : [];

  const byLane = {};
  for (const row of rows) {
    const laneId = String(row?.laneId ?? "");
    if (!laneId) continue;
    const prev = asNumber(history?.byLane?.[laneId]?.consecutivePass, 0);
    const pass = Boolean(row?.pass);
    const nextConsecutivePass = pass ? prev + 1 : 0;
    const decision = decisionRows.find((d) => d?.laneId === laneId);

    const role = laneId === "patch_probiotics_strain_cfu_v1" ? "primary" : "watch";
    const enforceProposal =
      role === "primary"
        ? pass
        : nextConsecutivePass >= 2;

    byLane[laneId] = {
      laneId,
      role,
      pass,
      previousConsecutivePass: prev,
      nextConsecutivePass,
      scopeEvidencePass: Boolean(row?.candidateScopeEvidence?.scopeEvidencePass),
      runtimeCandidateScopeId: row?.candidateScopeEvidence?.runtimeCandidateScopeId ?? null,
      candidateScopeId: row?.candidateScopeEvidence?.candidateScopeId ?? null,
      batchCandidatesHash: row?.candidateScopeEvidence?.candidateHash ?? null,
      runtimeHitIntensityPerSampledBarcode: asNumber(row?.runtimeHitIntensityPerSampledBarcode, asNumber(row?.visibilityProxyRate, 0)),
      sampledBarcodes: asNumber(row?.sampledBarcodes, 0),
      minSampleRequired: asNumber(row?.minSampleRequired, 0),
      enforceProposal,
      decisionCode: enforceProposal ? "cadence_ready" : "shadow_watch_continue",
      latestDecision: decision?.decision ?? null,
      latestReasonCode: decision?.reasonCode ?? null,
    };
  }

  const nextHistory = {
    generatedAt: new Date().toISOString(),
    byLane: Object.fromEntries(
      Object.entries(byLane).map(([laneId, info]) => [laneId, { consecutivePass: info.nextConsecutivePass }]),
    ),
  };

  await writeJson(historyPath, nextHistory);

  const primary = byLane.patch_probiotics_strain_cfu_v1 ?? null;
  const watchLanes = Object.values(byLane).filter((l) => l.role === "watch");

  const summary = {
    lanesTested: rows.length,
    primaryLanePass: Boolean(primary?.pass),
    primaryLaneScopeEvidencePass: Boolean(primary?.scopeEvidencePass),
    watchLaneCount: watchLanes.length,
    watchLaneReadyCount: watchLanes.filter((l) => l.enforceProposal).length,
    pass: Boolean(primary?.pass) && Boolean(primary?.scopeEvidencePass),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      lane2UxPath,
      lane2DecisionPath,
      historyPath,
    },
    lanePolicy: {
      primary: "patch_probiotics_strain_cfu_v1",
      watch: [
        "patch_vitamin_d_form_v1",
        "patch_fish_oil_breakdown_v1",
      ],
      watchPromotionRule: "two_consecutive_shadow_pass",
    },
    summary,
    lanes: Object.values(byLane),
    gates: {
      primaryGatePass: summary.pass,
      watchPromotionReadyAll: watchLanes.every((l) => l.enforceProposal),
    },
  };

  const outJson = path.join(outDir, "lane2_controlled_cadence_report.json");
  const outMd = path.join(outDir, "lane2_controlled_cadence_report.md");
  await writeJson(outJson, report);
  await writeText(
    outMd,
    [
      "# Lane2 Controlled Cadence Report",
      "",
      `- primary lane pass: ${summary.primaryLanePass}`,
      `- primary scope evidence pass: ${summary.primaryLaneScopeEvidencePass}`,
      `- watch lanes ready for promote: ${summary.watchLaneReadyCount}/${summary.watchLaneCount}`,
      `- cadence pass: ${summary.pass}`,
      "",
      "## Lane Status",
      ...Object.values(byLane).map((l) => `- ${l.laneId} (${l.role}): pass=${l.pass}, consecutive=${l.nextConsecutivePass}, proposeEnforce=${l.enforceProposal}`),
      "",
    ].join("\n"),
  );

  console.log("[run-lane2-controlled-cadence] completed");
  console.log(JSON.stringify({ outJson, pass: summary.pass }, null, 2));
};

main().catch((error) => {
  console.error("[run-lane2-controlled-cadence] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
