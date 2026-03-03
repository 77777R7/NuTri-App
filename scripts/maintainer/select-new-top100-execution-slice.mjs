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

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

const asNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const brandKey = (market, brand) => `${String(market ?? "").toUpperCase()}::${normalizeBrand(brand)}`;

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[select-new-top100-execution-slice] missing --nightly-dir");
    process.exit(1);
  }

  const diversityAuditJson =
    resolvePath(getArg("source-diversity-audit-json"))
    ?? path.join(nightlyDir, "phase_a2", "source_diversity_audit.json");
  const qualityGateJson =
    resolvePath(getArg("quality-gate-json"))
    ?? path.join(nightlyDir, "phase_a1", "new_top100_crossdb_quality_gate.json");
  const watchlistJson =
    resolvePath(getArg("watchlist-json"))
    ?? path.join(nightlyDir, "phase_a1", "low_ca_presence_watchlist.json");

  const scopeJson =
    resolvePath(getArg("scope-json"))
    ?? path.join(nightlyDir, "phase_b", "prep", "step0_universe", "top100_brand_product_scope.json");
  const availabilityJson =
    resolvePath(getArg("availability-json"))
    ?? path.join(nightlyDir, "phase_b", "prep", "step0_universe", "top100_brand_scanned_label_availability.json");
  const lane1CandidatesJsonl =
    resolvePath(getArg("lane1-candidates-jsonl"))
    ?? path.join(nightlyDir, "phase_b", "prep", "step1_candidates", "lane1_top100_patch_candidates.jsonl");

  const tier1Size = Math.max(1, asNumber(getArg("tier1-size"), 24));
  const tier2Size = Math.max(1, asNumber(getArg("tier2-size"), 24));

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(nightlyDir, "phase_c");

  const diversityAudit = await readJson(diversityAuditJson);
  const qualityGate = await readJson(qualityGateJson);
  const watchlist = await readJson(watchlistJson);
  const scope = await readJson(scopeJson);
  const availability = await readJson(availabilityJson);
  const lane1Candidates = await readJsonl(lane1CandidatesJsonl);

  const diversityRows = Array.isArray(diversityAudit?.rows) ? diversityAudit.rows : [];
  const qualityRows = new Map((Array.isArray(qualityGate?.rows) ? qualityGate.rows : []).map((row) => [normalizeBrand(row.brandName), row]));
  const watchRows = new Map((Array.isArray(watchlist?.rows) ? watchlist.rows : []).map((row) => [normalizeBrand(row.brandName), row]));

  const scopeRows = Array.isArray(scope?.rows) ? scope.rows : [];
  const productCountBySeed = new Map();
  for (const row of scopeRows) {
    const key = brandKey(row?.seedMarket, row?.seedBrand ?? row?.brandName);
    productCountBySeed.set(key, (productCountBySeed.get(key) || 0) + 1);
  }

  const availabilityRows = Array.isArray(availability?.rows) ? availability.rows : [];
  const evidenceRateBySeed = new Map();
  for (const row of availabilityRows) {
    const key = brandKey(row?.market, row?.brand);
    const total = asNumber(row?.total, 0);
    const withLabel = asNumber(row?.with_scanned_label, 0);
    evidenceRateBySeed.set(key, total > 0 ? withLabel / total : 0);
  }

  const lane1CandidateBySeed = new Map();
  const lane1WithEvidenceBySeed = new Map();
  for (const row of lane1Candidates) {
    const key = brandKey(row?.market, row?.seedBrand ?? row?.brandName);
    lane1CandidateBySeed.set(key, (lane1CandidateBySeed.get(key) || 0) + 1);
    if (row?.evidenceRef) lane1WithEvidenceBySeed.set(key, (lane1WithEvidenceBySeed.get(key) || 0) + 1);
  }

  const productCounts = [...productCountBySeed.values()];
  const maxProductCount = Math.max(1, ...productCounts);

  const rows = diversityRows.map((div) => {
    const brandNorm = normalizeBrand(div?.brandName);
    const quality = qualityRows.get(brandNorm) || {};
    const watch = watchRows.get(brandNorm) || {};
    const market = (asNumber(div?.usCount, 0) >= asNumber(div?.caCount, 0)) ? "US" : "CA";
    const key = brandKey(market, div?.brandName);
    const keyUS = brandKey("US", div?.brandName);
    const keyCA = brandKey("CA", div?.brandName);

    const productCountInDB = (productCountBySeed.get(keyUS) || 0) + (productCountBySeed.get(keyCA) || 0);
    const lane1CandidatesCount = (lane1CandidateBySeed.get(keyUS) || 0) + (lane1CandidateBySeed.get(keyCA) || 0);
    const lane1CandidatesWithEvidence = (lane1WithEvidenceBySeed.get(keyUS) || 0) + (lane1WithEvidenceBySeed.get(keyCA) || 0);
    const scannedLabelEvidenceRate = (() => {
      const usRate = evidenceRateBySeed.get(keyUS);
      const caRate = evidenceRateBySeed.get(keyCA);
      if (usRate == null && caRate == null) return 0;
      if (usRate == null) return caRate;
      if (caRate == null) return usRate;
      return (usRate + caRate) / 2;
    })();

    const brand_heat_norm = clamp01(div?.weighted_brand_heat ?? div?.brand_heat_norm ?? 0);
    const product_count_norm = clamp01(productCountInDB / maxProductCount);
    const lane1_candidate_density = productCountInDB > 0 ? lane1CandidatesCount / productCountInDB : 0;
    const lane1_fixable_coverage = productCountInDB > 0 ? lane1CandidatesWithEvidence / productCountInDB : 0;
    const low_conflict_factor = clamp01(0.7 + 0.3 * scannedLabelEvidenceRate);
    const source_diversity_score = clamp01(div?.source_diversity_score ?? 0);
    const ca_presence_strength = clamp01((asNumber(div?.caCount, 0) >= 10) ? 1 : (asNumber(div?.caCount, 0) >= 3 ? 0.7 : (asNumber(div?.caCount, 0) >= 1 ? 0.4 : 0.1)));

    const score =
      0.25 * brand_heat_norm +
      0.15 * product_count_norm +
      0.15 * lane1_candidate_density +
      0.15 * lane1_fixable_coverage +
      0.10 * scannedLabelEvidenceRate +
      0.10 * low_conflict_factor +
      0.07 * source_diversity_score +
      0.03 * ca_presence_strength;

    const lowCaPresence = Boolean(quality?.isLowCaPresence ?? div?.low_ca_presence ?? false);
    const lowCaAuditPass = lowCaPresence ? Boolean(watch?.auditPass ?? div?.low_ca_audit_pass ?? false) : true;
    const executionEligible = Boolean(quality?.execution_eligible ?? div?.execution_eligible ?? true) && (!lowCaPresence || lowCaAuditPass);

    const tier1Eligible = executionEligible && !lowCaPresence;
    const tier2Eligible = executionEligible && (!tier1Eligible);

    return {
      brandName: div?.brandName,
      brandNorm,
      usCount: asNumber(div?.usCount, 0),
      caCount: asNumber(div?.caCount, 0),
      totalCount: asNumber(div?.totalCount, 0),
      sourceSet: div?.sourceSet || [],
      source_diversity_score: Number(source_diversity_score.toFixed(6)),
      brand_heat_norm: Number(brand_heat_norm.toFixed(6)),
      productCountInDB,
      product_count_norm: Number(product_count_norm.toFixed(6)),
      lane1_candidates: lane1CandidatesCount,
      lane1_candidate_density: Number(lane1_candidate_density.toFixed(6)),
      lane1_fixable_coverage: Number(lane1_fixable_coverage.toFixed(6)),
      scanned_label_evidence_rate: Number(scannedLabelEvidenceRate.toFixed(6)),
      low_conflict_factor: Number(low_conflict_factor.toFixed(6)),
      ca_presence_strength: Number(ca_presence_strength.toFixed(6)),
      priority_score: Number(score.toFixed(6)),
      low_ca_presence: lowCaPresence,
      low_ca_audit_pass: lowCaAuditPass,
      execution_eligible: executionEligible,
      tier1_eligible: tier1Eligible,
      tier2_eligible: tier2Eligible,
      blocked_reason: executionEligible
        ? null
        : (lowCaPresence && !lowCaAuditPass ? "low_ca_audit_fail" : "quality_gate_blocked"),
    };
  }).sort((a, b) => b.priority_score - a.priority_score || b.lane1_fixable_coverage - a.lane1_fixable_coverage || a.brandName.localeCompare(b.brandName));

  const tier1 = rows.filter((row) => row.tier1_eligible).slice(0, tier1Size).map((row, idx) => ({ rank: idx + 1, ...row }));
  const tier1Norms = new Set(tier1.map((row) => row.brandNorm));
  const tier2 = rows
    .filter((row) => row.execution_eligible && !tier1Norms.has(row.brandNorm))
    .slice(0, tier2Size)
    .map((row, idx) => ({ rank: idx + 1, ...row }));

  const scoreboard = {
    generatedAt: new Date().toISOString(),
    inputs: {
      diversityAuditJson,
      qualityGateJson,
      watchlistJson,
      scopeJson,
      availabilityJson,
      lane1CandidatesJsonl,
    },
    weights: {
      brand_heat_norm: 0.25,
      product_count_norm: 0.15,
      lane1_candidate_density: 0.15,
      lane1_fixable_coverage: 0.15,
      scanned_label_evidence_rate: 0.10,
      low_conflict_factor: 0.10,
      source_diversity_score: 0.07,
      ca_presence_strength: 0.03,
    },
    summary: {
      brandCount: rows.length,
      tier1Count: tier1.length,
      tier2Count: tier2.length,
      executionEligibleCount: rows.filter((row) => row.execution_eligible).length,
      blockedCount: rows.filter((row) => !row.execution_eligible).length,
      lowCaAuditPassCount: rows.filter((row) => row.low_ca_presence && row.low_ca_audit_pass).length,
      lowCaBlockedCount: rows.filter((row) => row.low_ca_presence && !row.low_ca_audit_pass).length,
    },
    rows,
  };

  await writeJson(path.join(outDir, "new_top100_priority_scoreboard.json"), scoreboard);
  await writeJson(path.join(outDir, "new_top100_execution_slice_tier1.json"), {
    generatedAt: scoreboard.generatedAt,
    tier: "tier1",
    rules: {
      low_ca_presence: "must_be_false",
      targetCount: tier1Size,
    },
    rows: tier1,
  });
  await writeJson(path.join(outDir, "new_top100_execution_slice_tier2.json"), {
    generatedAt: scoreboard.generatedAt,
    tier: "tier2",
    rules: {
      low_ca_presence_policy: "audit_pass_allowed",
      targetCount: tier2Size,
    },
    rows: tier2,
  });

  await writeText(
    path.join(outDir, "new_top100_priority_scoreboard.md"),
    [
      "# New Top100 Priority Scoreboard",
      "",
      `- brandCount: ${scoreboard.summary.brandCount}`,
      `- tier1Count: ${scoreboard.summary.tier1Count}`,
      `- tier2Count: ${scoreboard.summary.tier2Count}`,
      `- executionEligibleCount: ${scoreboard.summary.executionEligibleCount}`,
      `- blockedCount: ${scoreboard.summary.blockedCount}`,
      `- lowCaAuditPassCount: ${scoreboard.summary.lowCaAuditPassCount}`,
      `- lowCaBlockedCount: ${scoreboard.summary.lowCaBlockedCount}`,
      "",
      "## Top 20",
      ...rows.slice(0, 20).map((row, idx) =>
        `- #${idx + 1} ${row.brandName}: score=${row.priority_score.toFixed(3)}, fixable=${row.lane1_fixable_coverage.toFixed(3)}, lowCA=${row.low_ca_presence}, eligible=${row.execution_eligible}`),
    ].join("\n") + "\n",
  );

  await writeText(
    path.join(outDir, "new_top100_execution_slice.md"),
    [
      "# New Top100 Execution Slice",
      "",
      `- tier1 size: ${tier1.length}`,
      `- tier2 size: ${tier2.length}`,
      "",
      "## Tier1 (Top 24)",
      ...tier1.map((row) => `- ${row.rank}. ${row.brandName} (${row.priority_score.toFixed(3)})`),
      "",
      "## Tier2 (Next 24)",
      ...tier2.map((row) => `- ${row.rank}. ${row.brandName} (${row.priority_score.toFixed(3)})`),
    ].join("\n") + "\n",
  );

  console.log("[select-new-top100-execution-slice] completed");
  console.log(JSON.stringify({
    outDir,
    tier1Count: tier1.length,
    tier2Count: tier2.length,
    blockedCount: scoreboard.summary.blockedCount,
  }, null, 2));
};

main().catch((error) => {
  console.error("[select-new-top100-execution-slice] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
