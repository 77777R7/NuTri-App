#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

const readShaFile = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return String(raw).trim().split(/\s+/)[0] || null;
  } catch {
    return null;
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

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toSlug = (value) => normalizeBrand(value).replace(/\s+/g, "-");

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

const parseBrandRows = (container, fallbackMarket) => {
  const rows = Array.isArray(container?.brands) ? container.brands : [];
  return rows
    .map((row) => {
      const market = String(row?.market ?? fallbackMarket ?? "").trim().toUpperCase();
      const brandRaw = String(row?.brand ?? row?.seedBrand ?? row?.display ?? "").trim();
      const brandNorm = normalizeBrand(row?.brand_norm ?? row?.brandNorm ?? brandRaw);
      if (!brandRaw || !brandNorm || !market) return null;
      return {
        market,
        brandRaw,
        brandRawLower: brandRaw.toLowerCase(),
        brandNorm,
        brandSlug: toSlug(brandRaw),
      };
    })
    .filter(Boolean);
};

const parsePlanSeeds = (plan) => {
  if (!plan || typeof plan !== "object") return [];
  if (plan?.brand_priority_lists?.us || plan?.brand_priority_lists?.canada) {
    return [
      ...parseBrandRows(plan.brand_priority_lists.us, "US"),
      ...parseBrandRows(plan.brand_priority_lists.canada, "CA"),
    ];
  }
  if (Array.isArray(plan?.brands)) return parseBrandRows({ brands: plan.brands }, "");
  if (plan?.us || plan?.canada) {
    return [
      ...parseBrandRows(plan.us, "US"),
      ...parseBrandRows(plan.canada, "CA"),
    ];
  }
  return [];
};

const buildSet = (rows, mapFn) => new Set(rows.map(mapFn).filter(Boolean));

const intersect = (a, b) => {
  const result = new Set();
  for (const key of a) {
    if (b.has(key)) result.add(key);
  }
  return result;
};

const median = (values) => {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2 === 0) return (list[mid - 1] + list[mid]) / 2;
  return list[mid];
};

const main = async () => {
  const latestNightlyDir = await newestDirByPrefix("v1.6.14-new-top100-nightly-");

  const oldPlanJson = resolvePath(getArg("old-plan-json"))
    ?? "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json";
  const newPlanJson = resolvePath(getArg("new-plan-json"))
    ?? (latestNightlyDir ? path.join(latestNightlyDir, "phase_b", "new_top100_plan.json") : null);
  const discoveryAnalysisJson = resolvePath(getArg("new-plan-analysis-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-brand-discovery", "new_top100_brands_analysis.json");
  const policySnapshotShaPath = resolvePath(getArg("policy-snapshot-sha-path"));
  const policyShaFromArg = String(getArg("source-diversity-policy-sha256", "")).trim() || null;

  if (!oldPlanJson || !newPlanJson || !discoveryAnalysisJson) {
    console.error("[build-seed-switch-overlap-gate] missing required plan/analysis paths");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir"))
    ?? (latestNightlyDir ? path.join(latestNightlyDir, "seed_gate") : path.join(ROOT_DIR, "output", "v1.6.15-seed-gate"));

  const maxOverlapRate = clamp01(getArg("max-overlap-rate", 0.05));
  const minNonIherbHard = clamp01(getArg("min-non-iherb-ratio-hard", 0.10));
  const minNonIherbWarn = clamp01(getArg("min-non-iherb-ratio-warn", 0.20));
  const minDiversityMedianWarn = clamp01(getArg("min-source-diversity-median-warn", 0.35));

  const oldPlanRaw = await fs.readFile(oldPlanJson, "utf8");
  const newPlanRaw = await fs.readFile(newPlanJson, "utf8");
  const discoveryRaw = await fs.readFile(discoveryAnalysisJson, "utf8");
  const oldPlan = JSON.parse(oldPlanRaw);
  const newPlan = JSON.parse(newPlanRaw);
  const discovery = JSON.parse(discoveryRaw);

  const oldSeeds = parsePlanSeeds(oldPlan);
  const newSeeds = parsePlanSeeds(newPlan);

  const oldNormKeys = buildSet(oldSeeds, (row) => `${row.market}::${row.brandNorm}`);
  const newNormKeys = buildSet(newSeeds, (row) => `${row.market}::${row.brandNorm}`);
  const oldRawOrSlugKeys = buildSet(oldSeeds, (row) => `${row.market}::${row.brandRawLower}`);
  const oldSlugKeys = buildSet(oldSeeds, (row) => `${row.market}::${row.brandSlug}`);
  for (const key of oldSlugKeys) oldRawOrSlugKeys.add(key);
  const newRawOrSlugKeys = buildSet(newSeeds, (row) => `${row.market}::${row.brandRawLower}`);
  const newSlugKeys = buildSet(newSeeds, (row) => `${row.market}::${row.brandSlug}`);
  for (const key of newSlugKeys) newRawOrSlugKeys.add(key);

  const normOverlap = intersect(oldNormKeys, newNormKeys);
  const rawOrSlugOverlap = intersect(oldRawOrSlugKeys, newRawOrSlugKeys);

  const newUniqueBrandNorms = new Set(newSeeds.map((row) => row.brandNorm));
  const oldUniqueBrandNorms = new Set(oldSeeds.map((row) => row.brandNorm));
  const newCountUnique = newUniqueBrandNorms.size;
  const oldCountUnique = oldUniqueBrandNorms.size;
  const newCountMarketKeys = newNormKeys.size;
  const oldCountMarketKeys = oldNormKeys.size;

  const newDuplicates = Math.max(0, newSeeds.length - newCountMarketKeys);

  const overlapRateNorm = newCountMarketKeys > 0 ? normOverlap.size / newCountMarketKeys : 0;
  const overlapRateRawOrSlug = newRawOrSlugKeys.size > 0 ? rawOrSlugOverlap.size / newRawOrSlugKeys.size : 0;

  const overlapExamplesNorm = [...normOverlap].slice(0, 20);
  const overlapExamplesRawOrSlug = [...rawOrSlugOverlap].slice(0, 20);

  const provenance = newPlan?.provenance ?? {};
  const newPlanSource = String(provenance?.new_plan_source || newPlan?.source?.analysisJson || "").trim();
  const newPlanSourcePath = newPlanSource ? path.resolve(newPlanSource) : null;
  const newPlanSnapshotPath = provenance?.new_plan_snapshot_path
    ? path.resolve(String(provenance.new_plan_snapshot_path))
    : null;
  const newPlanSnapshotShaPath = newPlanSnapshotPath
    ? (newPlanSnapshotPath.endsWith(".json")
      ? `${newPlanSnapshotPath.slice(0, -5)}.sha256`
      : `${newPlanSnapshotPath}.sha256`)
    : null;
  const snapshotShaFromSidecar = newPlanSnapshotPath
    ? await readShaFile(newPlanSnapshotShaPath)
    : null;
  const pathWhitelistRegex = /\/output\/[^/]*brand-discovery\/new_top100_brands_analysis\.json$/;
  const sourcePathWhitelisted = Boolean(newPlanSourcePath && pathWhitelistRegex.test(newPlanSourcePath));
  const newPlanSourceSha256 = newPlanSourcePath
    ? sha256(await fs.readFile(newPlanSourcePath, "utf8").catch(() => ""))
    : null;
  const discoverySnapshotSha256 = sha256(discoveryRaw);
  const sourceHashMatches = Boolean(newPlanSourceSha256 && newPlanSourceSha256 === discoverySnapshotSha256);
  const sourcePathOrHashVerified = sourcePathWhitelisted || sourceHashMatches;

  const policyShaFromFile = policySnapshotShaPath ? await readShaFile(policySnapshotShaPath) : null;
  const sourceDiversityPolicySha256Used = policyShaFromArg || policyShaFromFile || null;

  const finalBrands = Array.isArray(discovery?.finalBrands) ? discovery.finalBrands : [];
  const nonIherbBrands = finalBrands.filter((row) => {
    const set = Array.isArray(row?.sourceSet) ? row.sourceSet.map((s) => String(s).toLowerCase()) : [];
    return set.length > 0 && !set.every((source) => source === "iherb" || source === "iherb_ca");
  }).length;
  const nonIherbBrandRatio = finalBrands.length > 0 ? nonIherbBrands / finalBrands.length : 0;

  const diversityByBrand = new Map();
  for (const row of [...(newPlan?.brand_priority_lists?.us?.brands || []), ...(newPlan?.brand_priority_lists?.canada?.brands || [])]) {
    const key = normalizeBrand(row?.brand || row?.brand_norm || row?.brandNorm);
    if (!key) continue;
    const score = clamp01(row?.source_diversity_score ?? 0);
    const prev = diversityByBrand.get(key);
    diversityByBrand.set(key, prev == null ? score : Math.max(prev, score));
  }
  const sourceDiversityScoreMedian = median([...diversityByBrand.values()]);

  let diversityGateStatus = "pass";
  if (nonIherbBrandRatio < minNonIherbHard) diversityGateStatus = "fail";
  else if (nonIherbBrandRatio < minNonIherbWarn || sourceDiversityScoreMedian < minDiversityMedianWarn) diversityGateStatus = "warn";

  const hardPass = (
    newCountUnique === 100
    && newDuplicates === 0
    && overlapRateNorm <= maxOverlapRate
    && overlapRateRawOrSlug <= maxOverlapRate
    && sourcePathOrHashVerified
    && nonIherbBrandRatio >= minNonIherbHard
  );

  const blockingReasons = [];
  if (newCountUnique !== 100) blockingReasons.push("new_seed_count_not_100");
  if (newDuplicates !== 0) blockingReasons.push("new_seed_duplicates_detected");
  if (overlapRateNorm > maxOverlapRate) blockingReasons.push("overlap_rate_norm_exceeds_threshold");
  if (overlapRateRawOrSlug > maxOverlapRate) blockingReasons.push("overlap_rate_raw_or_slug_exceeds_threshold");
  if (!sourcePathOrHashVerified) blockingReasons.push("new_plan_source_not_verified");
  if (nonIherbBrandRatio < minNonIherbHard) blockingReasons.push("non_iherb_brand_ratio_below_hard_threshold");

  const warnings = [];
  if (diversityGateStatus === "warn") {
    if (nonIherbBrandRatio < minNonIherbWarn) warnings.push("non_iherb_brand_ratio_below_warn_threshold");
    if (sourceDiversityScoreMedian < minDiversityMedianWarn) warnings.push("source_diversity_median_below_warn_threshold");
  }

  const gate = {
    generatedAt: new Date().toISOString(),
    pass: hardPass,
    blockingReasons,
    warnings,
    thresholds: {
      maxOverlapRate,
      minNonIherbHard,
      minNonIherbWarn,
      minSourceDiversityMedianWarn: minDiversityMedianWarn,
    },
    oldSeed: {
      path: path.resolve(oldPlanJson),
      sha256: sha256(oldPlanRaw),
      rows: oldSeeds.length,
      uniqueBrandCount: oldCountUnique,
      marketBrandKeyCount: oldCountMarketKeys,
    },
    newSeed: {
      path: path.resolve(newPlanJson),
      sha256: sha256(newPlanRaw),
      rows: newSeeds.length,
      uniqueBrandCount: newCountUnique,
      marketBrandKeyCount: newCountMarketKeys,
      duplicates: newDuplicates,
      provenance: {
        new_plan_source: newPlanSourcePath,
        new_plan_snapshot_path: newPlanSnapshotPath || null,
        new_plan_snapshot_sha256: provenance?.new_plan_snapshot_sha256 || snapshotShaFromSidecar || null,
        new_plan_brand_list_sha256: provenance?.new_plan_brand_list_sha256 || null,
        new_plan_source_sites_histogram: provenance?.new_plan_source_sites_histogram || null,
        source_path_whitelisted: sourcePathWhitelisted,
        source_hash_matches: sourceHashMatches,
        source_path_or_hash_verified: sourcePathOrHashVerified,
      },
    },
    overlap: {
      overlap_count_norm: normOverlap.size,
      overlap_rate_norm: Number(overlapRateNorm.toFixed(6)),
      overlap_count_raw_or_slug: rawOrSlugOverlap.size,
      overlap_rate_raw_or_slug: Number(overlapRateRawOrSlug.toFixed(6)),
      overlap_examples_norm: overlapExamplesNorm,
      overlap_examples_raw_or_slug: overlapExamplesRawOrSlug,
    },
    diversityGate: {
      non_iherb_brand_ratio: Number(nonIherbBrandRatio.toFixed(6)),
      source_diversity_score_median: Number(sourceDiversityScoreMedian.toFixed(6)),
      status: diversityGateStatus,
      source_diversity_policy_snapshot_sha256: sourceDiversityPolicySha256Used,
      sourceDiversityPolicySha256Used,
    },
    audit: {
      new_plan_source_sha256: newPlanSourceSha256,
      discovery_snapshot_path: path.resolve(discoveryAnalysisJson),
      discovery_snapshot_sha256: discoverySnapshotSha256,
      source_path_whitelist_regex: String(pathWhitelistRegex),
    },
  };

  await writeJson(path.join(outDir, "seed_switch_gate.json"), gate);
  await writeText(
    path.join(outDir, "seed_switch_gate.md"),
    [
      "# Seed Switch Gate",
      "",
      `- pass: ${gate.pass}`,
      `- blockingReasons: ${gate.blockingReasons.length > 0 ? gate.blockingReasons.join(", ") : "none"}`,
      `- warnings: ${gate.warnings.length > 0 ? gate.warnings.join(", ") : "none"}`,
      "",
      "## Overlap",
      `- overlap_rate_norm: ${(gate.overlap.overlap_rate_norm * 100).toFixed(2)}%`,
      `- overlap_rate_raw_or_slug: ${(gate.overlap.overlap_rate_raw_or_slug * 100).toFixed(2)}%`,
      "",
      "## Diversity Gate",
      `- non_iherb_brand_ratio: ${(gate.diversityGate.non_iherb_brand_ratio * 100).toFixed(2)}%`,
      `- source_diversity_score_median: ${gate.diversityGate.source_diversity_score_median.toFixed(3)}`,
      `- status: ${gate.diversityGate.status}`,
      `- sourceDiversityPolicySha256Used: ${gate.diversityGate.sourceDiversityPolicySha256Used || "null"}`,
      "",
      "## Provenance Verification",
      `- source_path_whitelisted: ${gate.newSeed.provenance.source_path_whitelisted}`,
      `- source_hash_matches: ${gate.newSeed.provenance.source_hash_matches}`,
      `- source_path_or_hash_verified: ${gate.newSeed.provenance.source_path_or_hash_verified}`,
    ].join("\n") + "\n",
  );

  console.log("[build-seed-switch-overlap-gate] completed");
  console.log(JSON.stringify({
    outDir,
    pass: gate.pass,
    overlap_rate_norm: gate.overlap.overlap_rate_norm,
    overlap_rate_raw_or_slug: gate.overlap.overlap_rate_raw_or_slug,
    diversityGateStatus: gate.diversityGate.status,
  }, null, 2));

  if (!gate.pass) process.exit(2);
};

main().catch((error) => {
  console.error("[build-seed-switch-overlap-gate] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
