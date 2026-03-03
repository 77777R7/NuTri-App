#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
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

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  if (value == null) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const main = async () => {
  const rerunSummaryPath = resolvePath(getArg("step0-step2-rerun-json"));
  const e1RepeatComparePath = resolvePath(getArg("e1-repeat-compare-json"));
  const e2WatchReportPath = resolvePath(getArg("e2-watch-report-json"));
  const aliasAuditPath = resolvePath(getArg("alias-resolution-audit-json"));
  const aliasResidualPath = resolvePath(getArg("alias-residual-queue-jsonl"));
  const strictGapsPath = resolvePath(getArg("strict-gaps-json"));

  if (!rerunSummaryPath || !e1RepeatComparePath || !e2WatchReportPath || !aliasAuditPath || !aliasResidualPath) {
    console.error("[finalize-stage-e-strict-closure] missing required inputs");
    process.exit(1);
  }

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "strict");

  const rerunSummary = await readJson(rerunSummaryPath);
  const e1Repeat = await readJson(e1RepeatComparePath);
  const e2Watch = await readJson(e2WatchReportPath);
  const aliasAudit = await readJson(aliasAuditPath);
  const aliasResidual = await readJsonl(aliasResidualPath);
  const strictGaps = strictGapsPath ? await readJson(strictGapsPath).catch(() => null) : null;

  const brandNormalizationRate = asNumber(
    rerunSummary?.observed_brand_normalization_hit_rate
      ?? rerunSummary?.normalizationRate
      ?? rerunSummary?.normalization_rate
      ?? rerunSummary?.brand_normalization_hit_rate
      ?? 0,
    0,
  );
  const step0To2Pass =
    (rerunSummary?.c1a_gate_pass === true || rerunSummary?.pass === true || brandNormalizationRate >= 0.95)
    && brandNormalizationRate >= 0.95;

  const e1RepeatPass = e1Repeat?.pass === true;
  const watchPass = e2Watch?.watchWindowPass === true;

  const aliasResidualHasDangling = aliasResidual.some((row) => {
    const owner = String(row?.owner ?? "").trim();
    const status = String(row?.status ?? "").trim();
    const reasonCode = String(row?.reasonCode ?? "").trim();
    const eta = String(row?.eta ?? "").trim();
    return !owner || !status || !reasonCode || !eta;
  });

  const aliasPass = aliasAudit?.gatePass === true && !aliasResidualHasDangling;

  const strictGapsCount = Array.isArray(strictGaps?.gaps)
    ? strictGaps.gaps.length
    : Array.isArray(strictGaps)
      ? strictGaps.length
      : asNumber(strictGaps?.count, 0);
  const strictGapsEmpty = strictGapsCount === 0;

  const gateChecks = {
    step0_to_step2_rerun_pass: step0To2Pass,
    e1_repeat_pass: e1RepeatPass,
    top53_watch_clean: watchPass,
    alias_residual_clean: aliasPass,
    strict_gaps_empty: strictGapsEmpty,
  };

  const pass = Object.values(gateChecks).every(Boolean);
  const blockingReasons = Object.entries(gateChecks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const decision = {
    generatedAt: new Date().toISOString(),
    strictClosureRevalidatedAt: new Date().toISOString(),
    inputs: {
      rerunSummaryPath,
      e1RepeatComparePath,
      e2WatchReportPath,
      aliasAuditPath,
      aliasResidualPath,
      strictGapsPath: strictGapsPath || null,
    },
    pass,
    gateChecks,
    blockingReasons,
    metrics: {
      brandNormalizationRate,
      e1RepeatPreviewOverlap: asNumber(e1Repeat?.previewOverlapRate, 0),
      e2WatchPrimaryImprovement: asNumber(e2Watch?.metrics?.primaryMetricRelativeImprovement, 0),
      e2WatchConflictRate: asNumber(e2Watch?.metrics?.conflict_rate, 0),
      aliasResidualCount: aliasResidual.length,
      strictGapsCount,
    },
    statusLabel: pass ? "strict_pass" : "strict_pending",
  };

  await writeJson(path.join(outDir, "stage_e_strict_closure_decision.json"), decision);
  await writeText(
    path.join(outDir, "stage_e_strict_closure_decision.md"),
    [
      "# Stage E Strict Closure Decision",
      "",
      `- pass: ${pass}`,
      `- statusLabel: ${decision.statusLabel}`,
      `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
      "",
      `- brandNormalizationRate: ${(brandNormalizationRate * 100).toFixed(2)}%`,
      `- e1RepeatPass: ${e1RepeatPass}`,
      `- top53WatchClean: ${watchPass}`,
      `- aliasResidualClean: ${aliasPass}`,
      `- strictGapsEmpty: ${strictGapsEmpty}`,
    ].join("\n") + "\n",
  );

  console.log("[finalize-stage-e-strict-closure] completed");
  console.log(JSON.stringify({ outDir, pass, blockingReasons }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[finalize-stage-e-strict-closure] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
