#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const newestDirByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_DIR);
    const dirs = names.filter((name) => name.startsWith(prefix)).sort();
    if (dirs.length === 0) return null;
    return path.join(OUTPUT_DIR, dirs[dirs.length - 1]);
  } catch {
    return null;
  }
};

const collectFilesRecursive = async (dirPath) => {
  const output = [];
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        output.push(fullPath);
      }
    }
  };
  await walk(dirPath);
  return output;
};

const parseWaveOrder = (waveId) => {
  const match = String(waveId || "").match(/(\d+)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
};

const main = async () => {
  const latestExpansionDir = await newestDirByPrefix("v1.6.15-expansion-");
  const explicitOutDir = resolvePath(getArg("out-dir"));
  const rootDir = resolvePath(getArg("root-dir"))
    || (explicitOutDir ? path.dirname(explicitOutDir) : latestExpansionDir);
  if (!rootDir) {
    console.error("[finalize-expansion-wave-closeout] missing --root-dir and no expansion output found");
    process.exit(1);
  }

  const seedGateJson = resolvePath(getArg("seed-switch-gate-json")) || path.join(rootDir, "seed_gate", "seed_switch_gate.json");
  const waveReportsDir = resolvePath(getArg("wave-smoke-dir")) || rootDir;
  const outDir = explicitOutDir || path.join(rootDir, "closeout");

  const seedGate = await readJson(seedGateJson).catch(() => null);
  if (!seedGate) {
    console.error("[finalize-expansion-wave-closeout] seed_switch_gate.json not found");
    process.exit(1);
  }

  const allFiles = await collectFilesRecursive(waveReportsDir);
  const waveReportFiles = allFiles
    .filter((filePath) => /wave_.+_smoke_watch_report\.json$/i.test(path.basename(filePath)))
    .sort();

  const waveReports = [];
  for (const filePath of waveReportFiles) {
    const payload = await readJson(filePath).catch(() => null);
    if (!payload) continue;
    const waveId = String(payload?.waveId || path.basename(filePath).replace(/^wave_/, "").replace(/_smoke_watch_report\.json$/i, "")).trim();
    const uxSummaryPath = path.join(path.dirname(filePath), `wave_${waveId}_ux_visibility_summary.json`);
    const uxSummary = await readJson(uxSummaryPath).catch(() => null);
    const directionsVisibleRateGateBasis = Number(
      uxSummary?.rates?.current_lane1?.directions_visible_rate
      ?? uxSummary?.rates?.current?.directions_visible_rate
      ?? NaN,
    );
    const directionsVisibleRateAllProducts = Number(uxSummary?.rates?.current?.directions_visible_rate ?? NaN);
    const bestForCurrent = Number(uxSummary?.rates?.current?.best_for_visible_rate ?? NaN);
    const bestForBaseline = Number(uxSummary?.rates?.baseline?.best_for_visible_rate ?? NaN);
    const scienceCurrent = Number(uxSummary?.rates?.current?.science_specificity_rate ?? NaN);
    const scienceBaseline = Number(uxSummary?.rates?.baseline?.science_specificity_rate ?? NaN);
    const beforeBuyCurrent = Number(uxSummary?.rates?.current?.before_you_buy_completeness_rate ?? NaN);
    const beforeBuyBaseline = Number(uxSummary?.rates?.baseline?.before_you_buy_completeness_rate ?? NaN);
    const uxGate = {
      hasSummary: Boolean(uxSummary),
      directions_visible_rate_gte_0_90: Number.isFinite(directionsVisibleRateGateBasis) && directionsVisibleRateGateBasis >= 0.9,
      best_for_non_regression: Number.isFinite(bestForCurrent) && Number.isFinite(bestForBaseline) && bestForCurrent >= bestForBaseline,
      science_specificity_non_regression: Number.isFinite(scienceCurrent) && Number.isFinite(scienceBaseline) && scienceCurrent >= scienceBaseline,
      before_you_buy_non_regression: Number.isFinite(beforeBuyCurrent) && Number.isFinite(beforeBuyBaseline) && beforeBuyCurrent >= beforeBuyBaseline,
    };
    const uxGatePass = Object.values(uxGate)
      .filter((_, index) => index > 0) // skip hasSummary
      .every(Boolean);
    waveReports.push({
      path: filePath,
      waveId,
      watchWindowPass: Boolean(payload?.watchWindowPass),
      promotionDecision: String(payload?.promotionDecision || "hold").trim(),
      metricsSourceIntegrityPass: Boolean(payload?.metricsSourceIntegrityPass),
      sourceDiversityPolicySha256Used: String(payload?.sourceDiversityPolicySha256Used || "").trim() || null,
      blockingReasons: Array.isArray(payload?.blockingReasons) ? payload.blockingReasons : [],
      metricsSourcePath: payload?.metricsSourcePath || null,
      metricsSourceSha256: payload?.metricsSourceSha256 || null,
      uxSummaryPath: uxSummaryPath,
      directionsVisibleRateGateBasis: Number.isFinite(directionsVisibleRateGateBasis) ? directionsVisibleRateGateBasis : null,
      directionsVisibleRateAllProducts: Number.isFinite(directionsVisibleRateAllProducts) ? directionsVisibleRateAllProducts : null,
      uxGate,
      uxGatePass,
    });
  }

  waveReports.sort((a, b) => parseWaveOrder(a.waveId) - parseWaveOrder(b.waveId));

  const seedPolicySha = String(
    seedGate?.diversityGate?.sourceDiversityPolicySha256Used
    || seedGate?.diversityGate?.source_diversity_policy_snapshot_sha256
    || "",
  ).trim() || null;

  const blockingReasons = [];
  if (!seedGate?.pass) blockingReasons.push("seed_switch_gate_fail");
  if (waveReports.length === 0) blockingReasons.push("no_wave_smoke_reports_found");

  let policyDriftDetected = false;
  let policyHashMissing = false;

  for (const report of waveReports) {
    if (!report.watchWindowPass) blockingReasons.push(`wave_${report.waveId}_smoke_watch_fail`);
    if (!report.metricsSourceIntegrityPass) blockingReasons.push(`wave_${report.waveId}_metrics_source_unverifiable`);
    if (!report.uxGatePass) blockingReasons.push(`wave_${report.waveId}_ux_visibility_gate_fail`);
    if (!seedPolicySha || !report.sourceDiversityPolicySha256Used) {
      policyHashMissing = true;
      continue;
    }
    if (seedPolicySha !== report.sourceDiversityPolicySha256Used) {
      policyDriftDetected = true;
    }
  }

  if (policyHashMissing) blockingReasons.push("source_diversity_policy_hash_missing");
  if (policyDriftDetected) blockingReasons.push("source_diversity_policy_drift");

  const fixableRows = [];
  for (const report of waveReports) {
    if (!report.metricsSourceIntegrityPass) {
      fixableRows.push({
        queue: "fixable",
        reasonCode: "smoke_metrics_source_unverifiable",
        owner: "wave-smoke-ops",
        status: "open",
        eta: "next_cycle",
        waveId: report.waveId,
        reportPath: report.path,
        metricsSourcePath: report.metricsSourcePath,
        metricsSourceSha256: report.metricsSourceSha256,
      });
    }
  }
  if (policyDriftDetected) {
    fixableRows.push({
      queue: "fixable",
      reasonCode: "source_diversity_policy_drift",
      owner: "seed-policy-ops",
      status: "open",
      eta: "immediate",
      seedPolicySha,
      wavePolicyShas: [...new Set(waveReports.map((row) => row.sourceDiversityPolicySha256Used).filter(Boolean))],
    });
  }

  const pass = blockingReasons.length === 0;
  const lastWave = waveReports.at(-1) || null;
  const expansionReopen = pass && lastWave != null && lastWave.promotionDecision !== "hold";

  const closeout = {
    generatedAt: new Date().toISOString(),
    rootDir,
    pass,
    blockingReasons,
    summary: {
      seedSwitchGatePass: Boolean(seedGate?.pass),
      waveCount: waveReports.length,
      wavePassCount: waveReports.filter((row) => row.watchWindowPass).length,
      metricsSourceIntegrityPassCount: waveReports.filter((row) => row.metricsSourceIntegrityPass).length,
      uxGatePassCount: waveReports.filter((row) => row.uxGatePass).length,
      sourceDiversityPolicySha256Used: seedPolicySha,
      sourceDiversityPolicyDriftDetected: policyDriftDetected,
      sourceDiversityPolicyHashMissing: policyHashMissing,
      metricsSourceIntegrityPass: waveReports.every((row) => row.metricsSourceIntegrityPass),
      promotionDecision: expansionReopen ? "reopen_next_wave" : "hold",
    },
    seedGateReference: {
      path: seedGateJson,
      pass: Boolean(seedGate?.pass),
      overlap_rate_norm: seedGate?.overlap?.overlap_rate_norm ?? null,
      overlap_rate_raw_or_slug: seedGate?.overlap?.overlap_rate_raw_or_slug ?? null,
      sourceDiversityPolicySha256Used: seedPolicySha,
    },
    waveReports,
  };

  const reopenDecision = {
    generatedAt: closeout.generatedAt,
    pass,
    expansionReopen,
    decision: expansionReopen ? "reopen_next_wave" : "hold",
    blockingReasons,
    sourceDiversityPolicySha256Used: seedPolicySha,
    metricsSourceIntegrityPass: closeout.summary.metricsSourceIntegrityPass,
  };

  await writeJson(path.join(outDir, "expansion_wave_closeout.json"), closeout);
  await writeJson(path.join(outDir, "expansion_reopen_decision.json"), reopenDecision);
  await writeJsonl(path.join(outDir, "expansion_fixable_queue.jsonl"), fixableRows);
  await writeText(
    path.join(outDir, "expansion_wave_closeout.md"),
    [
      "# Expansion Wave Closeout",
      "",
      `- pass: ${closeout.pass}`,
      `- decision: ${reopenDecision.decision}`,
      `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
      "",
      `- seedSwitchGatePass: ${closeout.summary.seedSwitchGatePass}`,
      `- waveCount: ${closeout.summary.waveCount}`,
      `- wavePassCount: ${closeout.summary.wavePassCount}`,
      `- metricsSourceIntegrityPassCount: ${closeout.summary.metricsSourceIntegrityPassCount}`,
      `- sourceDiversityPolicySha256Used: ${closeout.summary.sourceDiversityPolicySha256Used || "null"}`,
      `- sourceDiversityPolicyDriftDetected: ${closeout.summary.sourceDiversityPolicyDriftDetected}`,
      `- sourceDiversityPolicyHashMissing: ${closeout.summary.sourceDiversityPolicyHashMissing}`,
      "",
      "## Wave Decisions",
      ...waveReports.map((row) =>
        `- wave_${row.waveId}: watchPass=${row.watchWindowPass}, metricsSourceIntegrityPass=${row.metricsSourceIntegrityPass}, uxGatePass=${row.uxGatePass}, promotionDecision=${row.promotionDecision}`),
    ].join("\n") + "\n",
  );
  await writeText(
    path.join(outDir, "expansion_reopen_decision.md"),
    [
      "# Expansion Reopen Decision",
      "",
      `- decision: ${reopenDecision.decision}`,
      `- expansionReopen: ${reopenDecision.expansionReopen}`,
      `- pass: ${reopenDecision.pass}`,
      `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
      `- sourceDiversityPolicySha256Used: ${reopenDecision.sourceDiversityPolicySha256Used || "null"}`,
      `- metricsSourceIntegrityPass: ${reopenDecision.metricsSourceIntegrityPass}`,
    ].join("\n") + "\n",
  );

  console.log("[finalize-expansion-wave-closeout] completed");
  console.log(JSON.stringify({
    outDir,
    pass,
    decision: reopenDecision.decision,
    waveCount: waveReports.length,
  }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[finalize-expansion-wave-closeout] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
