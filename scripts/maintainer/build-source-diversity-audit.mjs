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

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

const main = async () => {
  const analysisJson =
    resolvePath(getArg("analysis-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-brand-discovery", "new_top100_brands_analysis.json");
  const qualityGateJson =
    resolvePath(getArg("quality-gate-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-new-top100-nightly-latest", "phase_a1", "new_top100_crossdb_quality_gate.json");
  const watchlistJson =
    resolvePath(getArg("watchlist-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-new-top100-nightly-latest", "phase_a1", "low_ca_presence_watchlist.json");

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-new-top100-nightly-${new Date().toISOString().replace(/[:.]/g, "-")}`, "phase_a2");

  const analysis = await readJson(analysisJson);
  const qualityGate = await readJson(qualityGateJson).catch(() => null);
  const watchlist = await readJson(watchlistJson).catch(() => null);

  const finalBrands = Array.isArray(analysis?.finalBrands) ? analysis.finalBrands : [];
  if (finalBrands.length === 0) {
    console.error("[build-source-diversity-audit] finalBrands empty");
    process.exit(1);
  }

  const qualityRows = new Map(
    (Array.isArray(qualityGate?.rows) ? qualityGate.rows : []).map((row) => [normalizeBrand(row?.brandName), row]),
  );
  const watchRows = new Map(
    (Array.isArray(watchlist?.rows) ? watchlist.rows : []).map((row) => [normalizeBrand(row?.brandName), row]),
  );

  const allSourceUniverse = new Set();
  for (const row of finalBrands) {
    const sourceSet = Array.isArray(row?.sourceSet) ? row.sourceSet : [];
    for (const src of sourceSet) allSourceUniverse.add(String(src).toLowerCase());
  }
  const sourceUniverseSize = Math.max(1, allSourceUniverse.size);

  const heatRaw = finalBrands.map((row) => (Number(row?.signalCount ?? 0) || 0) + (Number(row?.totalCount ?? 0) || 0));
  const heatMax = Math.max(1, ...heatRaw);

  const majorSources = ["amazon_us", "wellca", "pureformulas", "swanson", "iherb", "iherb_ca"];

  const rows = finalBrands.map((row, idx) => {
    const brandName = String(row?.display ?? row?.key ?? "").trim();
    const brandNorm = normalizeBrand(brandName);
    const sourceSet = [...new Set((Array.isArray(row?.sourceSet) ? row.sourceSet : []).map((s) => String(s).toLowerCase()))];
    const sourceCount = sourceSet.length;
    const onlyIherb = sourceSet.length > 0 && sourceSet.every((src) => ["iherb", "iherb_ca"].includes(src));

    const uniqueScore = sourceCount / sourceUniverseSize;
    const majorPresence = majorSources.filter((src) => sourceSet.includes(src)).length / majorSources.length;
    const source_diversity_score = clamp01(0.7 * uniqueScore + 0.3 * majorPresence);

    const baseHeat = ((Number(row?.signalCount ?? 0) || 0) + (Number(row?.totalCount ?? 0) || 0)) / heatMax;
    const quality = qualityRows.get(brandNorm);
    const watch = watchRows.get(brandNorm);

    const lowCaPresence = Boolean(quality?.isLowCaPresence ?? ((Number(row?.caCount ?? 0) || 0) <= 2));
    const lowCaAuditPass = lowCaPresence ? Boolean(watch?.auditPass) : true;

    let multiplier = 1;
    if (onlyIherb) multiplier *= 0.85;
    if (lowCaPresence && !lowCaAuditPass) multiplier *= 0.5;

    const weightedBrandHeat = clamp01(baseHeat * (0.7 + 0.3 * source_diversity_score) * multiplier);

    return {
      rank: idx + 1,
      brandName,
      brandNorm,
      usCount: Number(row?.usCount ?? 0) || 0,
      caCount: Number(row?.caCount ?? 0) || 0,
      totalCount: Number(row?.totalCount ?? 0) || 0,
      sourceSet,
      sourceCount,
      only_iherb: onlyIherb,
      source_diversity_score: Number(source_diversity_score.toFixed(6)),
      brand_heat_norm: Number(baseHeat.toFixed(6)),
      weighted_brand_heat: Number(weightedBrandHeat.toFixed(6)),
      low_ca_presence: lowCaPresence,
      low_ca_audit_pass: lowCaAuditPass,
      execution_eligible: lowCaPresence ? lowCaAuditPass : true,
      weightingNotes: {
        iherbPenaltyApplied: onlyIherb,
        lowCaPenaltyApplied: lowCaPresence && !lowCaAuditPass,
      },
    };
  });

  const onlyIherbCount = rows.filter((row) => row.only_iherb).length;

  const policy = {
    policyVersion: "v1.6.14-nightly-final-plus-1",
    generatedAt: new Date().toISOString(),
    rules: {
      source_diversity_score: {
        formula: "0.7*(sourceCount/sourceUniverseSize) + 0.3*(majorSourcePresence/6)",
      },
      penalties: {
        only_iherb_multiplier: 0.85,
        low_ca_presence_audit_fail_multiplier: 0.5,
      },
      execution_rules: {
        only_iherb: "downweight_not_exclude",
        low_ca_presence_audit_fail: "exclude_from_execution_slice",
        low_ca_presence_audit_pass: "allow_tier2_only",
      },
    },
  };

  const report = {
    generatedAt: policy.generatedAt,
    inputs: {
      analysisJson,
      qualityGateJson,
      watchlistJson,
    },
    summary: {
      brandCount: rows.length,
      sourceUniverseSize,
      onlyIherbCount,
      executionEligibleCount: rows.filter((row) => row.execution_eligible).length,
      executionBlockedCount: rows.filter((row) => !row.execution_eligible).length,
    },
    rows: rows.sort((a, b) => b.weighted_brand_heat - a.weighted_brand_heat || a.brandName.localeCompare(b.brandName)),
    policyRef: "brand_heat_weighting_policy.json",
  };

  await writeJson(path.join(outDir, "source_diversity_audit.json"), report);
  await writeJson(path.join(outDir, "brand_heat_weighting_policy.json"), policy);

  await writeText(
    path.join(outDir, "source_diversity_audit.md"),
    [
      "# Source Diversity Audit",
      "",
      `- brandCount: ${report.summary.brandCount}`,
      `- sourceUniverseSize: ${report.summary.sourceUniverseSize}`,
      `- onlyIherbCount: ${report.summary.onlyIherbCount}`,
      `- executionEligibleCount: ${report.summary.executionEligibleCount}`,
      `- executionBlockedCount: ${report.summary.executionBlockedCount}`,
      "",
      "## Top 20 (weighted heat)",
      ...report.rows.slice(0, 20).map((row, idx) =>
        `- #${idx + 1} ${row.brandName}: weighted=${row.weighted_brand_heat.toFixed(3)}, diversity=${row.source_diversity_score.toFixed(3)}, only_iherb=${row.only_iherb}, low_ca=${row.low_ca_presence}, eligible=${row.execution_eligible}`),
    ].join("\n") + "\n",
  );

  console.log("[build-source-diversity-audit] completed");
  console.log(JSON.stringify({
    outDir,
    brandCount: report.summary.brandCount,
    executionEligibleCount: report.summary.executionEligibleCount,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-source-diversity-audit] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
