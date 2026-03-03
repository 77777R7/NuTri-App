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

const asRate = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const main = async () => {
  const baselinePath = resolvePath(getArg("baseline-report-json"));
  const currentPath = resolvePath(getArg("current-report-json"));
  const outDir = resolvePath(getArg("out-dir")) ?? path.join(ROOT_DIR, "output");

  if (!baselinePath || !currentPath) {
    console.error("[evaluate-stage-e-ux-nonregression] missing --baseline-report-json or --current-report-json");
    process.exit(1);
  }

  const baseline = await readJson(baselinePath);
  const current = await readJson(currentPath);

  const baselineFormula = asRate(baseline?.rates?.formula_explainability_rate);
  const baselineBeforeBuy = asRate(baseline?.rates?.before_you_buy_completeness_rate);
  const currentFormula = asRate(current?.rates?.formula_explainability_rate);
  const currentBeforeBuy = asRate(current?.rates?.before_you_buy_completeness_rate);

  const checks = {
    formula_explainability_non_regression: currentFormula >= baselineFormula,
    before_you_buy_non_regression: currentBeforeBuy >= baselineBeforeBuy,
  };

  const pass = Object.values(checks).every(Boolean);
  const report = {
    generatedAt: new Date().toISOString(),
    baselinePath,
    currentPath,
    pass,
    nonRegressionPass: pass,
    checks,
    baselineRates: {
      formula_explainability_rate: baselineFormula,
      before_you_buy_completeness_rate: baselineBeforeBuy,
    },
    currentRates: {
      formula_explainability_rate: currentFormula,
      before_you_buy_completeness_rate: currentBeforeBuy,
    },
    blockingReasons: Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => key),
  };

  await writeJson(path.join(outDir, "ux_nonregression_report.json"), report);
  await writeText(
    path.join(outDir, "ux_nonregression_report.md"),
    [
      "# UX Non-Regression Report",
      "",
      `- pass: ${report.pass}`,
      `- formula_explainability_non_regression: ${checks.formula_explainability_non_regression}`,
      `- before_you_buy_non_regression: ${checks.before_you_buy_non_regression}`,
      `- baseline_formula: ${(baselineFormula * 100).toFixed(2)}%`,
      `- current_formula: ${(currentFormula * 100).toFixed(2)}%`,
      `- baseline_before_buy: ${(baselineBeforeBuy * 100).toFixed(2)}%`,
      `- current_before_buy: ${(currentBeforeBuy * 100).toFixed(2)}%`,
      `- blockingReasons: ${report.blockingReasons.length > 0 ? report.blockingReasons.join(", ") : "none"}`,
      "",
    ].join("\n"),
  );

  console.log("[evaluate-stage-e-ux-nonregression] completed");
  console.log(JSON.stringify({ outDir, pass }, null, 2));
  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[evaluate-stage-e-ux-nonregression] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
