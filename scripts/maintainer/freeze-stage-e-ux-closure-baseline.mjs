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

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const toRate = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const main = async () => {
  const defaultReport = path.join(
    ROOT_DIR,
    "output",
    "v1.6.14-e-plus-20260302T081059Z",
    "ux",
    "visibility",
    "ux_visibility_report.json",
  );
  const defaultFixable = path.join(
    ROOT_DIR,
    "output",
    "v1.6.14-e-plus-20260302T081059Z",
    "ux",
    "visibility",
    "ux_visibility_fixable_queue.json",
  );

  const baselineReportPath = resolvePath(getArg("baseline-report-json", defaultReport));
  const baselineFixablePath = resolvePath(getArg("baseline-fixable-json", defaultFixable));
  const outDir =
    resolvePath(getArg("out-dir")) ??
    path.join(
      ROOT_DIR,
      "output",
      `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      "ux_closure",
      "baseline",
    );

  if (!baselineReportPath || !baselineFixablePath) {
    console.error("[freeze-stage-e-ux-closure-baseline] missing baseline paths");
    process.exit(1);
  }

  const report = await readJson(baselineReportPath);
  const fixable = await readJson(baselineFixablePath);

  if (!Array.isArray(fixable)) {
    console.error("[freeze-stage-e-ux-closure-baseline] baseline fixable queue must be an array");
    process.exit(1);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    baselineReportPath,
    baselineFixablePath,
    strictState: "strict_pass",
    uxState: "half_closed",
    rates: {
      best_for_visibility_rate: toRate(report?.rates?.best_for_visibility_rate),
      science_specificity_rate: toRate(report?.rates?.science_specificity_rate),
      formula_explainability_rate: toRate(report?.rates?.formula_explainability_rate),
      before_you_buy_completeness_rate: toRate(report?.rates?.before_you_buy_completeness_rate),
    },
    counts: {
      bestForVisible: Number(report?.counts?.bestForVisible ?? 0),
      scienceSpecific: Number(report?.counts?.scienceSpecific ?? 0),
      formulaExplainable: Number(report?.counts?.formulaExplainable ?? 0),
      beforeBuyComplete: Number(report?.counts?.beforeBuyComplete ?? 0),
      fixableCount: fixable.length,
    },
    closureTargets: {
      best_for_visibility_rate: 0.7,
      science_specificity_rate: 0.65,
      formula_explainability_rate: 0.75,
      before_you_buy_completeness_rate: 0.85,
    },
  };

  await writeJson(path.join(outDir, "ux_closure_baseline.json"), snapshot);
  await writeText(
    path.join(outDir, "ux_closure_baseline.md"),
    [
      "# UX Closure Baseline",
      "",
      `- generatedAt: ${snapshot.generatedAt}`,
      `- strictState: ${snapshot.strictState}`,
      `- uxState: ${snapshot.uxState}`,
      `- baselineReportPath: ${baselineReportPath}`,
      `- baselineFixablePath: ${baselineFixablePath}`,
      "",
      "## Rates",
      `- best_for_visibility_rate: ${(snapshot.rates.best_for_visibility_rate * 100).toFixed(2)}%`,
      `- science_specificity_rate: ${(snapshot.rates.science_specificity_rate * 100).toFixed(2)}%`,
      `- formula_explainability_rate: ${(snapshot.rates.formula_explainability_rate * 100).toFixed(2)}%`,
      `- before_you_buy_completeness_rate: ${(snapshot.rates.before_you_buy_completeness_rate * 100).toFixed(2)}%`,
      "",
      "## Counts",
      `- bestForVisible: ${snapshot.counts.bestForVisible}`,
      `- scienceSpecific: ${snapshot.counts.scienceSpecific}`,
      `- formulaExplainable: ${snapshot.counts.formulaExplainable}`,
      `- beforeBuyComplete: ${snapshot.counts.beforeBuyComplete}`,
      `- fixableCount: ${snapshot.counts.fixableCount}`,
      "",
      "## Closure Targets",
      `- best_for_visibility_rate >= ${(snapshot.closureTargets.best_for_visibility_rate * 100).toFixed(0)}%`,
      `- science_specificity_rate >= ${(snapshot.closureTargets.science_specificity_rate * 100).toFixed(0)}%`,
      `- formula_explainability_rate >= ${(snapshot.closureTargets.formula_explainability_rate * 100).toFixed(0)}%`,
      `- before_you_buy_completeness_rate >= ${(snapshot.closureTargets.before_you_buy_completeness_rate * 100).toFixed(0)}%`,
      "",
    ].join("\n"),
  );

  console.log("[freeze-stage-e-ux-closure-baseline] completed");
  console.log(JSON.stringify({ outDir }, null, 2));
};

main().catch((error) => {
  console.error("[freeze-stage-e-ux-closure-baseline] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
