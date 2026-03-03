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
    return raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toRate = (a, b) => (b > 0 ? a / b : 0);

const main = async () => {
  const prepDir = resolvePath(getArg("prep-dir"));
  if (!prepDir) {
    console.error("[build-new-top100-readonly-census] missing --prep-dir");
    process.exit(1);
  }
  const outDir = resolvePath(getArg("out-dir")) || path.dirname(prepDir);

  const scope = await readJson(path.join(prepDir, "step0_universe", "top100_brand_product_scope.json"));
  const coverage = await readJson(path.join(prepDir, "step0_universe", "top100_brand_coverage_summary.json"));
  const missing = await readJson(path.join(prepDir, "step0_universe", "top100_brand_missing_directions_distribution.json"));
  const availability = await readJson(path.join(prepDir, "step0_universe", "top100_brand_scanned_label_availability.json"));
  const candidates = await readJsonl(path.join(prepDir, "step1_candidates", "lane1_top100_patch_candidates.jsonl"));

  const rows = Array.isArray(scope?.rows) ? scope.rows : [];
  const missingRows = Array.isArray(missing?.rows) ? missing.rows : [];
  const availRows = Array.isArray(availability?.rows) ? availability.rows : [];

  const missingTotal = missingRows.reduce((sum, row) => sum + asNumber(row?.missing_directions, 0), 0);
  const missingDenominator = missingRows.reduce((sum, row) => sum + asNumber(row?.total, 0), 0);
  const availTotal = availRows.reduce((sum, row) => sum + asNumber(row?.total, 0), 0);
  const withLabelTotal = availRows.reduce((sum, row) => sum + asNumber(row?.with_scanned_label, 0), 0);

  const sourceTypeDistribution = rows.reduce((acc, row) => {
    const key = String(row?.sourceType || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const readiness = {
    generatedAt: new Date().toISOString(),
    summary: {
      lane1_candidate_count: candidates.length,
      lane1_candidate_density: Number(toRate(candidates.length, rows.length).toFixed(6)),
      lane1_missing_directions_rate: Number(toRate(missingTotal, missingDenominator).toFixed(6)),
      scanned_label_evidence_availability_rate: Number(toRate(withLabelTotal, availTotal).toFixed(6)),
      conflict_risk_estimate: Number((1 - toRate(withLabelTotal, availTotal)).toFixed(6)),
      dbWriteCount: 0,
    },
  };

  const census = {
    generatedAt: readiness.generatedAt,
    summary: {
      totalRows: rows.length,
      matchedBrands: asNumber(coverage?.matched_brands, 0),
      totalBrands: asNumber(coverage?.total_brands, 0),
      normalizationRate: asNumber(coverage?.normalization_rate, 0),
      sourceTypeDistribution,
      lane1CandidateCount: candidates.length,
      dbWriteCount: 0,
    },
    source: {
      prepDir,
      coverageSummaryPath: path.join(prepDir, "step0_universe", "top100_brand_coverage_summary.json"),
    },
  };

  await writeJson(path.join(outDir, "new_top100_readonly_census.json"), census);
  await writeJson(path.join(outDir, "new_top100_lane1_readiness.json"), readiness);
  await writeJson(path.join(outDir, "new_top100_brand_scope_products.json"), {
    generatedAt: readiness.generatedAt,
    totalRows: rows.length,
    rows,
  });
  await writeJson(path.join(outDir, "new_top100_sourceType_distribution.json"), {
    generatedAt: readiness.generatedAt,
    sourceTypeDistribution,
  });

  await writeText(
    path.join(outDir, "new_top100_readonly_census.md"),
    [
      "# New Top100 Read-only Census",
      "",
      `- normalizationRate: ${(census.summary.normalizationRate * 100).toFixed(2)}%`,
      `- matchedBrands: ${census.summary.matchedBrands}/${census.summary.totalBrands}`,
      `- lane1CandidateCount: ${census.summary.lane1CandidateCount}`,
      `- dbWriteCount: ${census.summary.dbWriteCount}`,
      "",
      "## sourceTypeDistribution",
      ...Object.entries(sourceTypeDistribution).map(([k, v]) => `- ${k}: ${v}`),
    ].join("\n") + "\n",
  );

  await writeText(
    path.join(outDir, "new_top100_lane1_readiness.md"),
    [
      "# New Top100 Lane1 Readiness",
      "",
      `- lane1_candidate_count: ${readiness.summary.lane1_candidate_count}`,
      `- lane1_candidate_density: ${(readiness.summary.lane1_candidate_density * 100).toFixed(2)}%`,
      `- lane1_missing_directions_rate: ${(readiness.summary.lane1_missing_directions_rate * 100).toFixed(2)}%`,
      `- scanned_label_evidence_availability_rate: ${(readiness.summary.scanned_label_evidence_availability_rate * 100).toFixed(2)}%`,
      `- conflict_risk_estimate: ${(readiness.summary.conflict_risk_estimate * 100).toFixed(2)}%`,
      `- dbWriteCount: ${readiness.summary.dbWriteCount}`,
    ].join("\n") + "\n",
  );

  console.log("[build-new-top100-readonly-census] completed");
  console.log(JSON.stringify({
    outDir,
    normalizationRate: census.summary.normalizationRate,
    lane1CandidateCount: readiness.summary.lane1_candidate_count,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-readonly-census] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
