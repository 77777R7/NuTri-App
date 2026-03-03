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
    console.error("[build-brand-runtime-attribution-audit] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const coverageReportJson =
    resolvePath(getArg("coverage-report-json"))
    ?? path.join(nightlyDir, "phase_f", "new_top100_patch_ux_coverage_report.json");

  const coverage = await readJson(coverageReportJson);
  const brands = Array.isArray(coverage?.brands) ? coverage.brands : [];
  const rollupRuntimeHits = asNumber(coverage?.summary?.runtime_hit_barcodes, 0);

  const withCandidates = brands.filter((b) => asNumber(b?.lane1_candidates, 0) > 0);
  const attributed = withCandidates.filter((b) => asNumber(b?.brandRuntimeHitCount ?? b?.runtimeHitCount, 0) > 0);
  const insufficient = withCandidates.filter((b) => String(b?.runtimeAttributionStatus ?? "") === "insufficient_sample");
  const mismatch = withCandidates.filter((b) => String(b?.runtimeAttributionStatus ?? "") === "scope_mismatch");
  const statusCovered = withCandidates.filter((b) =>
    ["attributed", "insufficient_sample", "scope_mismatch"].includes(String(b?.runtimeAttributionStatus ?? "")),
  );

  const integrity = withCandidates.length > 0 ? statusCovered.length / withCandidates.length : 0;
  const hitCoverage = withCandidates.length > 0 ? attributed.length / withCandidates.length : 0;
  const nonAllZeroGuardPass = rollupRuntimeHits <= 0 ? true : attributed.length > 0;
  const pass = integrity >= 0.95 && nonAllZeroGuardPass;

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      coverageReportJson,
    },
    summary: {
      brandsWithCandidates: withCandidates.length,
      brandsStatusCovered: statusCovered.length,
      brandsAttributed: attributed.length,
      brandsInsufficientSample: insufficient.length,
      brandsScopeMismatch: mismatch.length,
      brand_runtime_attribution_integrity: integrity,
      brand_runtime_hit_coverage: hitCoverage,
      nonAllZeroGuardPass,
      rollupRuntimeHits,
      pass,
      threshold: 0.95,
    },
    topIssues: {
      insufficientSample: insufficient.slice(0, 20).map((b) => ({
        market: b.market,
        brandName: b.brandName,
        lane1_candidates: b.lane1_candidates,
        lane1_enforced: b.lane1_enforced,
        runtimeAttributionStatus: b.runtimeAttributionStatus,
      })),
      scopeMismatch: mismatch.slice(0, 20).map((b) => ({
        market: b.market,
        brandName: b.brandName,
        lane1_candidates: b.lane1_candidates,
        lane1_enforced: b.lane1_enforced,
        runtimeAttributionStatus: b.runtimeAttributionStatus,
      })),
    },
  };

  const outJson = path.join(outDir, "brand_runtime_attribution_audit.json");
  const outMd = path.join(outDir, "brand_runtime_attribution_audit.md");

  await writeJson(outJson, report);
  await writeText(
    outMd,
    [
      "# Brand Runtime Attribution Audit",
      "",
      `- brandsWithCandidates: ${report.summary.brandsWithCandidates}`,
      `- brandsStatusCovered: ${report.summary.brandsStatusCovered}`,
      `- brandsAttributed: ${report.summary.brandsAttributed}`,
      `- integrity: ${(report.summary.brand_runtime_attribution_integrity * 100).toFixed(2)}%`,
      `- hitCoverage: ${(report.summary.brand_runtime_hit_coverage * 100).toFixed(2)}%`,
      `- nonAllZeroGuardPass: ${report.summary.nonAllZeroGuardPass}`,
      `- pass (>=95%): ${report.summary.pass}`,
      `- insufficientSample: ${report.summary.brandsInsufficientSample}`,
      `- scopeMismatch: ${report.summary.brandsScopeMismatch}`,
      "",
    ].join("\n"),
  );

  console.log("[build-brand-runtime-attribution-audit] completed");
  console.log(JSON.stringify({ outJson, pass, integrity }, null, 2));
};

main().catch((error) => {
  console.error("[build-brand-runtime-attribution-audit] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
