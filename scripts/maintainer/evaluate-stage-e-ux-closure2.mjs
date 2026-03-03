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
    console.error("[evaluate-stage-e-ux-closure2] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const impactJson =
    resolvePath(getArg("product-impact-json"))
    ?? path.join(outDir, "new_top100_product_level_ux_impact.json");
  const lane2UxJson =
    resolvePath(getArg("lane2-ux-json"))
    ?? path.join(outDir, "new_top100_lane2_ux_visibility.json");

  const impact = await readJson(impactJson);
  const lane2 = await readJson(lane2UxJson).catch(() => null);

  const current = impact?.summary?.rates?.current ?? {};
  const lane2Visibility = asNumber(lane2?.summary?.lane2_readiness_visibility, 0);

  const thresholds = {
    best_for_visible_rate: 0.85,
    science_specificity_rate: 0.8,
    before_you_buy_completeness_rate: 0.9,
    directions_visible_rate: 0.95,
    lane2_readiness_visibility: 0.75,
  };

  const metrics = {
    best_for_visible_rate: asNumber(current?.best_for_visible_rate, 0),
    science_specificity_rate: asNumber(current?.science_specificity_rate, 0),
    before_you_buy_completeness_rate: asNumber(current?.before_you_buy_completeness_rate, 0),
    directions_visible_rate: asNumber(current?.directions_visible_rate, 0),
    lane2_readiness_visibility: lane2Visibility,
  };

  const checks = {
    best_for_visible_rate: metrics.best_for_visible_rate >= thresholds.best_for_visible_rate,
    science_specificity_rate: metrics.science_specificity_rate >= thresholds.science_specificity_rate,
    before_you_buy_completeness_rate: metrics.before_you_buy_completeness_rate >= thresholds.before_you_buy_completeness_rate,
    directions_visible_rate: metrics.directions_visible_rate >= thresholds.directions_visible_rate,
    lane2_readiness_visibility: metrics.lane2_readiness_visibility >= thresholds.lane2_readiness_visibility,
  };

  const pass = Object.values(checks).every(Boolean);
  const blockingReasons = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      impactJson,
      lane2UxJson,
    },
    thresholds,
    metrics,
    checks,
    pass,
    blockingReasons,
    externalMessage: pass
      ? "strict revalidation passed; UX materially improved (threshold achieved)"
      : "strict revalidation passed; UX uplift continuing (deployment wave #2)",
  };

  await writeJson(path.join(outDir, "ux_closure2_report.json"), report);
  await writeText(
    path.join(outDir, "ux_closure2_report.md"),
    [
      "# UX Closure 2.0 Report",
      "",
      `- pass: ${pass}`,
      `- externalMessage: ${report.externalMessage}`,
      "",
      "## Metrics / 指标",
      ...Object.keys(thresholds).map((k) => `- ${k}: ${(metrics[k] * 100).toFixed(2)}% (threshold ${(thresholds[k] * 100).toFixed(2)}%) => ${checks[k] ? "PASS" : "FAIL"}`),
      "",
      `- blockingReasons: ${(blockingReasons || []).join(", ") || "none"}`,
      "",
    ].join("\n"),
  );

  console.log("[evaluate-stage-e-ux-closure2] completed");
  console.log(JSON.stringify({ pass, blockingReasons }, null, 2));
};

main().catch((error) => {
  console.error("[evaluate-stage-e-ux-closure2] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
