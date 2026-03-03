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
    console.error("[finalize-measurement-hardening-closeout] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");

  const p0Report = await readJson(path.join(outDir, "top100_native_diagnostics_coverage_report.json"));
  const p1Runtime = await readJson(path.join(outDir, "runtime_metric_semantics_migration_report.json"));
  const p1Brand = await readJson(path.join(outDir, "brand_runtime_attribution_audit.json"));
  const p2Lane2 = await readJson(path.join(outDir, "lane2_controlled_cadence_report.json"));
  const strict = await readJson(path.join(outDir, "nightly_plus_closeout.json")).catch(() => ({ pass: false }));

  const p0Pass = Boolean(p0Report?.gates?.hard?.pass);
  const p1Pass = Boolean(p1Runtime?.pass) && Boolean(p1Brand?.summary?.pass);
  const p2Pass = Boolean(p2Lane2?.summary?.pass);
  const strictPass = Boolean(strict?.pass);

  const pass = p0Pass && p1Pass && p2Pass && strictPass;
  const blockingReasons = [];
  if (!p0Pass) blockingReasons.push("p0_diagnostics_coverage_gate");
  if (!Boolean(p1Runtime?.pass)) blockingReasons.push("p1_runtime_semantics_migration");
  if (!Boolean(p1Brand?.summary?.pass)) blockingReasons.push("p1_brand_runtime_attribution_integrity");
  if (!p2Pass) blockingReasons.push("p2_lane2_controlled_cadence");
  if (!strictPass) blockingReasons.push("strict_regression");

  const closeout = {
    generatedAt: new Date().toISOString(),
    nightlyDir,
    pass,
    blockingReasons,
    summary: {
      p0DiagnosticsCoverageRate: asNumber(p0Report?.summary?.diagnosticsCoverageRate, 0),
      p0FallbackUsageRate: asNumber(p0Report?.summary?.fallbackUsageRate, 0),
      p1BrandRuntimeAttributionIntegrity: asNumber(p1Brand?.summary?.brand_runtime_attribution_integrity, 0),
      p2PrimaryLanePass: Boolean(p2Lane2?.summary?.primaryLanePass),
      p2WatchLaneReadyCount: asNumber(p2Lane2?.summary?.watchLaneReadyCount, 0),
      strictPass,
    },
  };

  const expansion = {
    generatedAt: new Date().toISOString(),
    reopen: pass,
    blockingReasons,
    prerequisites: {
      p0_native_coverage_pass: p0Pass,
      p1_semantics_and_brand_attribution_pass: p1Pass,
      p2_lane2_cadence_pass: p2Pass,
      strict_pass: strictPass,
    },
    nextScope: pass ? "reopen_next_wave" : "hold_measurement_hardening",
    recommendation: pass
      ? "Re-open expansion window for next brand execution wave."
      : "Keep expansion closed and iterate measurement hardening blockers first.",
  };

  const closeoutJson = path.join(outDir, "measurement_hardening_closeout.json");
  const closeoutMd = path.join(outDir, "measurement_hardening_closeout.md");
  const expansionJson = path.join(outDir, "expansion_reopen_decision.json");
  const expansionMd = path.join(outDir, "expansion_reopen_decision.md");

  await writeJson(closeoutJson, closeout);
  await writeJson(expansionJson, expansion);

  await writeText(
    closeoutMd,
    [
      "# Measurement Hardening Closeout",
      "",
      `- pass: ${closeout.pass}`,
      `- blockingReasons: ${(closeout.blockingReasons || []).join(", ") || "none"}`,
      `- diagnosticsCoverageRate: ${(closeout.summary.p0DiagnosticsCoverageRate * 100).toFixed(2)}%`,
      `- fallbackUsageRate: ${(closeout.summary.p0FallbackUsageRate * 100).toFixed(2)}%`,
      `- brandRuntimeAttributionIntegrity: ${(closeout.summary.p1BrandRuntimeAttributionIntegrity * 100).toFixed(2)}%`,
      `- lane2 primary pass: ${closeout.summary.p2PrimaryLanePass}`,
      `- strict pass: ${closeout.summary.strictPass}`,
      "",
    ].join("\n"),
  );

  await writeText(
    expansionMd,
    [
      "# Expansion Re-open Decision",
      "",
      `- reopen: ${expansion.reopen}`,
      `- nextScope: ${expansion.nextScope}`,
      `- blockingReasons: ${(expansion.blockingReasons || []).join(", ") || "none"}`,
      "",
      `- recommendation: ${expansion.recommendation}`,
      "",
    ].join("\n"),
  );

  console.log("[finalize-measurement-hardening-closeout] completed");
  console.log(JSON.stringify({ pass, blockingReasons }, null, 2));
};

main().catch((error) => {
  console.error("[finalize-measurement-hardening-closeout] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
