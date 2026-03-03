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

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const parsePlanSeeds = (plan) => {
  const us = Array.isArray(plan?.brand_priority_lists?.us?.brands) ? plan.brand_priority_lists.us.brands : [];
  const ca = Array.isArray(plan?.brand_priority_lists?.canada?.brands) ? plan.brand_priority_lists.canada.brands : [];
  const byKey = new Map();
  for (const item of us) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    const key = `US:${normalizeBrand(brand)}`;
    byKey.set(key, {
      market: "US",
      seedBrand: brand,
      seedBrandNorm: normalizeBrand(brand),
      seedRank: asNumber(item?.rank, 0),
      patchPriorityScore: asNumber(item?.patch_priority_score, 0),
    });
  }
  for (const item of ca) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    const key = `CA:${normalizeBrand(brand)}`;
    byKey.set(key, {
      market: "CA",
      seedBrand: brand,
      seedBrandNorm: normalizeBrand(brand),
      seedRank: asNumber(item?.rank, 0),
      patchPriorityScore: asNumber(item?.patch_priority_score, 0),
    });
  }
  return byKey;
};

const main = async () => {
  const baselineScopePath = resolvePath(getArg("baseline-scope-json"))
    ?? path.join(
      ROOT_DIR,
      "output",
      "v1.6.12-stage-c-20260301T195500Z",
      "c1a_top100_census",
      "brand_scope_products_top100.json",
    );
  const matchablePath = resolvePath(getArg("matchable-jsonl"))
    ?? path.join(
      ROOT_DIR,
      "output",
      "v1.6.14-e-plus-20260302T074048Z",
      "coverage",
      "coverage_gap_matchable_candidates.jsonl",
    );
  const planJsonPath = resolvePath(getArg("plan-json"))
    ?? "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json";
  const outDir = resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "step0_to_step2_rerun");

  const baselinePayload = await readJson(baselineScopePath);
  const baselineRows = Array.isArray(baselinePayload?.rows) ? baselinePayload.rows : [];
  if (baselineRows.length === 0) {
    console.error("[build-merged-top100-scope-from-gap-matrix] baseline scope rows empty");
    process.exit(1);
  }
  const matchableRows = await readJsonl(matchablePath);
  if (matchableRows.length === 0) {
    console.error("[build-merged-top100-scope-from-gap-matrix] no matchable candidates");
    process.exit(1);
  }
  const plan = await readJson(planJsonPath);
  const seedByKey = parsePlanSeeds(plan);

  const existingIdentity = new Set(
    baselineRows.map((row) => String(row?.identityKey ?? "").trim()).filter(Boolean),
  );
  const existingSeedKeys = new Set(
    baselineRows.map((row) => `${String(row?.seedMarket ?? "").toUpperCase()}:${normalizeBrand(row?.seedBrand)}`),
  );

  const additions = [];
  const skipped = [];
  for (const row of matchableRows) {
    const market = String(row?.market ?? "").toUpperCase();
    const brand = String(row?.brand ?? "").trim();
    const seedKey = `${market}:${normalizeBrand(brand)}`;
    const seed = seedByKey.get(seedKey);
    if (!seed) {
      skipped.push({ market, brand, reason: "seed_not_found" });
      continue;
    }
    if (existingSeedKeys.has(seedKey)) {
      skipped.push({ market, brand, reason: "already_present_in_scope" });
      continue;
    }
    if (existingIdentity.has(String(row?.identityKey ?? ""))) {
      skipped.push({ market, brand, reason: "identity_already_present" });
      continue;
    }
    if (!row?.identityKey || !row?.sourceId || !row?.sourceType) {
      skipped.push({ market, brand, reason: "missing_identity_source" });
      continue;
    }
    additions.push({
      seedMarket: seed.market,
      seedBrand: seed.seedBrand,
      seedBrandNorm: seed.seedBrandNorm,
      seedRank: seed.seedRank,
      patchPriorityScore: seed.patchPriorityScore,
      sourceType: row.sourceType,
      identityKey: row.identityKey,
      sourceId: row.sourceId,
      barcodeGtIn14: null,
      brandName: row.brandName || null,
      productName: row.productName || null,
      categoryName: null,
      formText: null,
      factsJson: {},
      scannedLabelEvidenceAvailable: false,
      category_assignment_method: "coverage_gap_title_led",
      category_assignment_confidence: "medium",
      categoryBucket: "other",
      hasDirectionsText: false,
      hasFishOilBreakdown: false,
      hasVitaminDForm: false,
      hasMagnesiumFormOrElemental: false,
      hasProbioticStrainCfu: false,
      hasLabelWarnings: false,
      matchedBy: row.matchedBy || "coverage_term",
      matchedTerm: row.matchedTerm || seed.seedBrand,
      matchSignals: Array.isArray(row.matchSignals) ? row.matchSignals : ["product_title_token_overlap", "distributor_or_manufacturer_signal"],
      confidenceBucket: row.confidenceBucket || "medium",
    });
  }

  const mergedRows = [...baselineRows, ...additions];
  const mergedPayload = {
    generatedAt: new Date().toISOString(),
    totalBrandsInPlan: baselinePayload?.totalBrandsInPlan ?? 100,
    totalRows: mergedRows.length,
    baselineScopePath,
    matchablePath,
    addedRows: additions.length,
    rows: mergedRows,
  };

  await writeJson(path.join(outDir, "merged_scope", "brand_scope_products_top100.merged.json"), mergedPayload);
  await writeJsonl(path.join(outDir, "merged_scope", "coverage_gap_scope_additions.jsonl"), additions);
  await writeJson(path.join(outDir, "merged_scope", "coverage_gap_scope_merge_audit.json"), {
    generatedAt: mergedPayload.generatedAt,
    baselineRows: baselineRows.length,
    additions: additions.length,
    skipped: skipped.length,
    skippedRows: skipped,
    uniqueSeedKeysBefore: existingSeedKeys.size,
    uniqueSeedKeysAfter: new Set(mergedRows.map((row) => `${String(row?.seedMarket ?? "").toUpperCase()}:${normalizeBrand(row?.seedBrand)}`)).size,
  });

  console.log("[build-merged-top100-scope-from-gap-matrix] completed");
  console.log(
    JSON.stringify(
      {
        outDir,
        baselineRows: baselineRows.length,
        additions: additions.length,
        mergedRows: mergedRows.length,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-merged-top100-scope-from-gap-matrix] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

