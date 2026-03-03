#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/run-stage-c-final.mjs [options]

Options:
  --plan-json <path>                          Top100 priority plan JSON (required unless default path exists)
  --brand-alias-map-json <path>               Optional brand alias resolution map JSON
  --brand-coverage-terms-json <path>          Optional coverage terms map JSON
  --out-dir <path>                            Output dir (default: output/v1.6.12-stage-c-<timestamp>)
  --stage-b-seq-dir <path>                    R2D seq dir with stable/b2-pass-run1+run2 compare reports
  --max-records-per-brand <number>            Per-brand fetch cap (default: 400)
  --min-brand-normalization-hit-rate <num>    C1A gate (default: 0.95)
  --market-floor-us <number>                  Dynamic Top30 floor for US (default: 10)
  --market-floor-ca <number>                  Dynamic Top30 floor for CA (default: 10)
  --min-candidate-count <number>              C1.5 threshold (default: 20)
  --min-evidence-availability-rate <num>      C1.5 threshold (default: 0.60)
  --max-conflict-risk-estimate <num>          C1.5 threshold (default: 0.05)
  --min-expected-missing-reduction <num>      C1.5 threshold (default: 0.15)
  --min-brand-count-covered <number>          C1.5 threshold (default: 8)
  --min-product-count-covered <number>        C1.5 threshold (default: 40)
  --target-top30-count <number>               Execution slice size (default: 30)
  --skip-c2-c3                                Only run C0/C1A/C1.5/C1B
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};
const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};
const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));
const toRate = (count, total) => (total > 0 ? Number((count / total).toFixed(6)) : 0);
const toPercent = (value) => Number((clamp01(value) * 100).toFixed(2));
const STAGE_C_QUERY_TIMEOUT_MS = Math.max(
  2000,
  asNumber(getArg("query-timeout-ms"), asNumber(process.env.STAGE_C_QUERY_TIMEOUT_MS, 15000)),
);

const withQueryTimeout = async (promise, label) => {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        data: [],
        error: {
          message: `query_timeout:${label}`,
          code: "QUERY_TIMEOUT",
        },
      });
    }, STAGE_C_QUERY_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

let BRAND_ALIAS_INDEX = new Map();
let BRAND_COVERAGE_TERMS_INDEX = new Map();

const resolveBrandAliasNorm = (market, brand) => {
  const norm = normalizeBrand(brand);
  if (!norm) return norm;
  const marketKey = String(market ?? "").trim().toUpperCase();
  const direct = BRAND_ALIAS_INDEX.get(`${marketKey}:${norm}`);
  if (direct) return direct;
  const wildcard = BRAND_ALIAS_INDEX.get(`*:${norm}`);
  if (wildcard) return wildcard;
  return norm;
};

const toAliasIndexFromMappings = (mappings) => {
  const index = new Map();
  for (const row of Array.isArray(mappings) ? mappings : []) {
    const market = String(row?.market ?? "").trim().toUpperCase();
    const aliasNorm = normalizeBrand(row?.aliasNorm ?? row?.alias);
    const canonicalNorm = normalizeBrand(row?.canonicalBrandNorm ?? row?.canonicalBrand);
    if (!aliasNorm || !canonicalNorm) continue;
    if (market) index.set(`${market}:${aliasNorm}`, canonicalNorm);
    index.set(`*:${aliasNorm}`, canonicalNorm);
  }
  return index;
};

const loadBrandAliasIndex = async (filePath) => {
  if (!filePath) {
    BRAND_ALIAS_INDEX = new Map();
    return { path: null, entries: 0 };
  }
  const payload = await readJson(filePath);
  let indexObj = payload?.index;
  if (!indexObj || typeof indexObj !== "object") {
    const derived = toAliasIndexFromMappings(payload?.mappings);
    BRAND_ALIAS_INDEX = derived;
    return { path: filePath, entries: derived.size };
  }
  const index = new Map();
  for (const [keyRaw, valueRaw] of Object.entries(indexObj)) {
    const key = String(keyRaw ?? "").trim().toUpperCase();
    const value = normalizeBrand(valueRaw);
    if (!key || !value) continue;
    index.set(key, value);
  }
  BRAND_ALIAS_INDEX = index;
  return { path: filePath, entries: index.size };
};

const loadBrandCoverageTermsIndex = async (filePath) => {
  if (!filePath) {
    BRAND_COVERAGE_TERMS_INDEX = new Map();
    return { path: null, entries: 0, terms: 0 };
  }
  const payload = await readJson(filePath);
  const index = new Map();
  let termCount = 0;
  if (payload?.index && typeof payload.index === "object") {
    for (const [keyRaw, valueRaw] of Object.entries(payload.index)) {
      const key = String(keyRaw ?? "").trim().toUpperCase();
      const terms = Array.isArray(valueRaw?.terms)
        ? valueRaw.terms.map((term) => String(term ?? "").trim().toLowerCase()).filter(Boolean)
        : [];
      const termMetadata = Array.isArray(valueRaw?.termMetadata)
        ? valueRaw.termMetadata
          .map((row) => ({
            term: String(row?.term ?? "").trim().toLowerCase(),
            origin: String(row?.origin ?? "coverage_term"),
            confidenceBucket: String(row?.confidenceBucket ?? "medium"),
          }))
          .filter((row) => Boolean(row.term))
        : terms.map((term) => ({ term, origin: "coverage_term", confidenceBucket: "medium" }));
      const signalTokens = Array.isArray(valueRaw?.secondarySignals?.seedBrandTokens)
        ? valueRaw.secondarySignals.seedBrandTokens.map((token) => String(token ?? "").trim().toLowerCase()).filter(Boolean)
        : [];
      const familyTokens = Array.isArray(valueRaw?.secondarySignals?.familyTokens)
        ? valueRaw.secondarySignals.familyTokens.map((token) => String(token ?? "").trim().toLowerCase()).filter(Boolean)
        : [];
      if (!key || termMetadata.length === 0) continue;
      termCount += termMetadata.length;
      index.set(key, {
        terms,
        termMetadata,
        seedBrandTokens: signalTokens,
        familyTokens,
      });
    }
  }
  BRAND_COVERAGE_TERMS_INDEX = index;
  return { path: filePath, entries: index.size, terms: termCount };
};

const envCandidates = [
  path.join(ROOT_DIR, ".env"),
  path.join(ROOT_DIR, "backend/.env"),
  path.join(path.dirname(ROOT_DIR), ".env"),
];
for (const candidate of envCandidates) {
  dotenv.config({ path: candidate, override: false });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[stage-c-final] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const listOutputDirsByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_ROOT);
    return names.filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return [];
  }
};

const newestOutputDirByPrefix = async (prefix) => {
  const dirs = await listOutputDirsByPrefix(prefix);
  if (dirs.length === 0) return null;
  return path.join(OUTPUT_ROOT, dirs[dirs.length - 1]);
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => normalizeBrand(value).split(" ").filter(Boolean);

const tokenJaccard = (a, b) => {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const token of sa) {
    if (sb.has(token)) inter += 1;
  }
  const union = new Set([...sa, ...sb]).size;
  return union > 0 ? inter / union : 0;
};

const getCoverageTermsForSeed = (market, seedBrandNorm, seedBrand) => {
  const marketKey = String(market ?? "").trim().toUpperCase();
  const normalizedSeed = normalizeBrand(seedBrandNorm || seedBrand);
  const direct = BRAND_COVERAGE_TERMS_INDEX.get(`${marketKey}:${normalizedSeed}`);
  if (direct) return direct;
  return {
    terms: [normalizeBrand(seedBrand), normalizeBrand(seedBrand).replace(/\s+/g, "")].filter(Boolean),
    termMetadata: [
      { term: normalizeBrand(seedBrand), origin: "seed_fallback", confidenceBucket: "medium" },
    ],
    seedBrandTokens: tokenize(seedBrand),
    familyTokens: [],
  };
};

const coverageTermPriorityScore = (termMeta) => {
  const bucket = String(termMeta?.confidenceBucket ?? "medium").toLowerCase();
  const origin = String(termMeta?.origin ?? "coverage_term");
  const bucketScore = bucket === "high" ? 3 : bucket === "medium" ? 2 : 1;
  const originScore = origin === "alias_map"
    ? 4
    : origin === "canonical" || origin === "canonical_norm"
      ? 3
      : origin === "legal_suffix_stripped"
        ? 2
        : 1;
  return bucketScore * 10 + originScore;
};

const pickCoverageTermCandidates = (coverage, maxCount = 3) => {
  const rows = Array.isArray(coverage?.termMetadata) ? coverage.termMetadata : [];
  return rows
    .slice()
    .sort((a, b) => coverageTermPriorityScore(b) - coverageTermPriorityScore(a))
    .slice(0, Math.max(1, maxCount));
};

const inferMatchSignals = ({ rowBrand, productName, categoryText, seedBrandTokens, familyTokens, matchedTerm }) => {
  const signals = [];
  const brandTokens = tokenize(rowBrand);
  const productTokens = tokenize(productName);
  const categoryTokens = tokenize(categoryText);
  const matchedTokens = tokenize(matchedTerm);

  if (matchedTokens.some((token) => brandTokens.includes(token))) {
    signals.push("brand_token_overlap");
  }
  if (matchedTokens.some((token) => productTokens.includes(token))) {
    signals.push("product_title_token_overlap");
  }
  if (seedBrandTokens.some((token) => productTokens.includes(token) || categoryTokens.includes(token))) {
    signals.push("seed_brand_context_overlap");
  }
  if (familyTokens.some((token) => productTokens.includes(token) || categoryTokens.includes(token))) {
    signals.push("known_family_token_signal");
  }
  if (brandTokens.some((token) => /(labs?|laborator|international|pharma|nutrition)/.test(token))) {
    signals.push("distributor_or_manufacturer_signal");
  }
  return Array.from(new Set(signals));
};

const isCoverageTermConfirmed = (signals) => {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  const set = new Set(signals);
  // Locked strict policy: title token overlap is mandatory, plus one
  // provenance-strengthening signal (manufacturer or known family token).
  const hasTitleOverlap = set.has("product_title_token_overlap");
  const hasSecondary =
    set.has("distributor_or_manufacturer_signal")
    || set.has("known_family_token_signal");
  return hasTitleOverlap && hasSecondary;
};

const brandMatchesSeed = (rowBrand, seedBrand, seedMarket) => {
  const rb = resolveBrandAliasNorm(seedMarket, rowBrand);
  const sb = resolveBrandAliasNorm(seedMarket, seedBrand);
  if (!rb || !sb) return false;
  if (rb === sb) return true;
  if (rb.includes(sb) || sb.includes(rb)) return true;
  return tokenJaccard(rb, sb) >= 0.6;
};

const parsePlanBrands = (plan) => {
  const us = Array.isArray(plan?.brand_priority_lists?.us?.brands) ? plan.brand_priority_lists.us.brands : [];
  const ca = Array.isArray(plan?.brand_priority_lists?.canada?.brands) ? plan.brand_priority_lists.canada.brands : [];
  const out = [];
  for (const item of us) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    out.push({
      market: "US",
      brand,
      rank: asNumber(item?.rank, 0),
      patchPriorityScore: asNumber(item?.patch_priority_score, 0),
      brandNorm: resolveBrandAliasNorm("US", brand),
    });
  }
  for (const item of ca) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    out.push({
      market: "CA",
      brand,
      rank: asNumber(item?.rank, 0),
      patchPriorityScore: asNumber(item?.patch_priority_score, 0),
      brandNorm: resolveBrandAliasNorm("CA", brand),
    });
  }
  return out;
};

const categoryRegex = {
  fishOil: /\b(fish oil|omega[\s-]?3|epa|dha|krill|cod liver|salmon oil|algal oil)\b/i,
  vitaminD: /\b(vitamin[\s-]?d|cholecalciferol|ergocalciferol|vitamin d2|vitamin d3)\b/i,
  magnesium: /\bmagnesium\b/i,
  probiotics: /\b(probiotic|lactobacillus|bifidobacterium|cfu)\b/i,
};

const formRegex = {
  vitaminD: /\b(vitamin d2|vitamin d3|d2\b|d3\b|cholecalciferol|ergocalciferol)\b/i,
  magnesium: /\b(glycinate|bisglycinate|citrate|oxide|malate|taurate|threonate|chloride|elemental)\b/i,
  probioticStrain: /\b([a-z]\.[a-z]+|atcc|gg\b|bb[-\s]?\d+|ncfm|rosell|rhamnosus|longum|acidophilus)\b/i,
  cfu: /\bcfu\b/i,
  omegaBreakdown: /\b(epa|dha|omega[\s-]?3|eicosapentaenoic|docosahexaenoic)\b/i,
};

const flattenText = (value, out = []) => {
  if (value == null) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) flattenText(v, out);
  }
  return out;
};

const hasAnyKeyWithDirectionHint = (factsJson) => {
  if (!factsJson || typeof factsJson !== "object") return false;
  const keys = Object.keys(factsJson).map((k) => k.toLowerCase());
  return keys.some((key) =>
    key.includes("direction")
    || key.includes("dosage")
    || key.includes("suggesteduse")
    || key.includes("recommendeduse")
    || key.includes("usage"),
  );
};

const extractSignals = ({ sourceType, factsJson, categoryText, productName, formText }) => {
  const flattened = flattenText([
    factsJson,
    categoryText,
    productName,
    formText,
  ]).join(" | ");
  const lower = flattened.toLowerCase();
  const categoryBucket = categoryRegex.fishOil.test(lower)
    ? "fish_oil"
    : categoryRegex.vitaminD.test(lower)
      ? "vitamin_d"
      : categoryRegex.magnesium.test(lower)
        ? "magnesium"
        : categoryRegex.probiotics.test(lower)
          ? "probiotics"
          : "other";

  const hasDirectionsText = sourceType === "lnhpd"
    ? Array.isArray(factsJson?.doses) && factsJson.doses.length > 0
    : hasAnyKeyWithDirectionHint(factsJson);

  const hasFishOilBreakdown = formRegex.omegaBreakdown.test(lower);
  const hasVitaminDForm = formRegex.vitaminD.test(lower);
  const hasMagnesiumFormOrElemental = categoryRegex.magnesium.test(lower) && formRegex.magnesium.test(lower);
  const hasProbioticStrainCfu = categoryRegex.probiotics.test(lower) && (formRegex.probioticStrain.test(lower) || formRegex.cfu.test(lower));
  const hasLabelWarnings = /\bwarning|warnings|caution|contraindication\b/i.test(lower);

  return {
    categoryBucket,
    hasDirectionsText,
    hasFishOilBreakdown,
    hasVitaminDForm,
    hasMagnesiumFormOrElemental,
    hasProbioticStrainCfu,
    hasLabelWarnings,
  };
};

const isFishOilCategory = (row) => row.categoryBucket === "fish_oil";
const isVitaminDCategory = (row) => row.categoryBucket === "vitamin_d";
const isMagnesiumCategory = (row) => row.categoryBucket === "magnesium";
const isProbioticsCategory = (row) => row.categoryBucket === "probiotics";

const laneDefs = [
  {
    laneId: "patch_directions_text_v1",
    laneGroup: "lane1_fixed",
    targetFields: ["directions_text"],
    impactWeight: 0.4,
    isCandidate: (row) => row.sourceType === "dsld" && !row.hasDirectionsText,
    reasonCode: "missing_directions",
  },
  {
    laneId: "patch_fish_oil_breakdown_v1",
    laneGroup: "lane2_candidate",
    targetFields: ["epa_mg", "dha_mg", "total_omega3_mg"],
    impactWeight: 0.35,
    isCandidate: (row) => isFishOilCategory(row) && !row.hasFishOilBreakdown,
    reasonCode: "missing_active_breakdown",
  },
  {
    laneId: "patch_vitamin_d_form_v1",
    laneGroup: "lane2_candidate",
    targetFields: ["form_text"],
    impactWeight: 0.3,
    isCandidate: (row) => isVitaminDCategory(row) && !row.hasVitaminDForm,
    reasonCode: "missing_vitamin_d_form",
  },
  {
    laneId: "patch_magnesium_elemental_form_v1",
    laneGroup: "lane2_candidate",
    targetFields: ["form_text", "elemental_magnesium_mg"],
    impactWeight: 0.25,
    isCandidate: (row) => isMagnesiumCategory(row) && !row.hasMagnesiumFormOrElemental,
    reasonCode: "missing_magnesium_form_or_elemental",
  },
  {
    laneId: "patch_probiotics_strain_cfu_v1",
    laneGroup: "lane2_candidate",
    targetFields: ["strain_text", "cfu_text"],
    impactWeight: 0.2,
    isCandidate: (row) => isProbioticsCategory(row) && !row.hasProbioticStrainCfu,
    reasonCode: "missing_probiotics_strain_or_cfu",
  },
];

const laneById = Object.fromEntries(laneDefs.map((lane) => [lane.laneId, lane]));
const lane2PreferenceOrder = [
  "patch_fish_oil_breakdown_v1",
  "patch_vitamin_d_form_v1",
  "patch_magnesium_elemental_form_v1",
  "patch_probiotics_strain_cfu_v1",
];

const WRITABLE_SOURCE_TIERS = new Set(["scanned_label"]);
const NON_WRITABLE_SOURCE_TIERS = ["official_record", "general_science", "inferred"];
const FISH_OIL_REVERSE_INFERENCE_FORBIDDEN = true;

const buildHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

const fetchDsldRowsForBrand = async ({ seedBrand, seedBrandNorm, maxRows }) => {
  const selectCols = [
    "dsld_label_id",
    "brand",
    "brand_norm",
    "product_name",
    "category",
    "category_raw",
    "form",
    "serving_size_raw",
    "active_ingredients_summary",
    "dsld_pdf",
    "dsld_thumbnail",
    "barcode_normalized_gtin14",
  ].join(",");

  const dedup = new Map();
  const reviewRows = [];
  const addRows = (rows, sourceKind, sourceTerm = null, coverageSignals = { seedBrandTokens: [], familyTokens: [] }) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = Number(row?.dsld_label_id);
      if (!Number.isFinite(id)) continue;
      const key = String(id);

      const aliasMatch = brandMatchesSeed(row?.brand, seedBrand, "US");
      const signals = inferMatchSignals({
        rowBrand: row?.brand,
        productName: row?.product_name,
        categoryText: row?.category || row?.category_raw || row?.active_ingredients_summary || null,
        seedBrandTokens: coverageSignals.seedBrandTokens,
        familyTokens: coverageSignals.familyTokens,
        matchedTerm: sourceTerm,
      });
      const hasConfirmedCoverageSignal = isCoverageTermConfirmed(signals);

      let matchedBy = "fuzzy";
      let confidenceBucket = "review";
      if (sourceKind === "canonical") {
        matchedBy = "canonical";
        confidenceBucket = "high";
      } else if (sourceKind === "alias" && aliasMatch) {
        matchedBy = "alias";
        confidenceBucket = "high";
      } else if (sourceKind === "coverage_term" && hasConfirmedCoverageSignal) {
        matchedBy = "coverage_term";
        confidenceBucket = signals.length >= 2 ? "high" : "medium";
      }

      if (matchedBy === "fuzzy" || (sourceKind === "coverage_term" && !hasConfirmedCoverageSignal)) {
        reviewRows.push({
          sourceType: "dsld",
          market: "US",
          seedBrand,
          seedBrandNorm,
          rowBrand: row?.brand ?? null,
          productName: row?.product_name ?? null,
          identityKey: `dsldLabelId:${id}`,
          matchedBy: sourceKind === "coverage_term" ? "coverage_term_unconfirmed" : "fuzzy",
          matchedTerm: sourceTerm ?? seedBrand,
          matchSignals: signals,
          confidenceBucket: "review",
        });
        continue;
      }

      const payload = {
        ...row,
        __matchMeta: {
          matchedBy,
          matchedTerm: sourceTerm ?? seedBrand,
          matchSignals: signals,
          confidenceBucket,
        },
      };

      const current = dedup.get(key);
      if (!current) {
        dedup.set(key, payload);
      } else {
        const rank = { canonical: 4, alias: 3, coverage_term: 2 };
        const currentRank = rank[current.__matchMeta?.matchedBy] ?? 0;
        const nextRank = rank[payload.__matchMeta?.matchedBy] ?? 0;
        if (nextRank > currentRank) dedup.set(key, payload);
      }
      if (dedup.size >= maxRows) break;
    }
  };

  const exact = await withQueryTimeout(
    supabase
      .from("dsld_labels_meta")
      .select(selectCols)
      .eq("brand_norm", seedBrandNorm)
      .limit(maxRows),
    "dsld_exact",
  );
  if (!exact.error) addRows(exact.data, "canonical", seedBrand);

  const coverage = getCoverageTermsForSeed("US", seedBrandNorm, seedBrand);
  if (dedup.size < Math.min(maxRows, 5)) {
    for (const termMeta of pickCoverageTermCandidates(coverage, 3)) {
      if (dedup.size >= maxRows) break;
      const term = String(termMeta?.term ?? "").trim();
      if (!term) continue;
      const broadBrand = await withQueryTimeout(
        supabase
          .from("dsld_labels_meta")
          .select(selectCols)
          .ilike("brand", `%${term}%`)
          .limit(Math.max(40, Math.floor(maxRows / 2))),
        "dsld_coverage_brand",
      );
      if (!broadBrand.error) addRows(broadBrand.data, "coverage_term", term, coverage);

      if (dedup.size < Math.min(maxRows, 20)) {
        const broadTitle = await withQueryTimeout(
          supabase
            .from("dsld_labels_meta")
            .select(selectCols)
            .ilike("product_name", `%${term}%`)
            .limit(Math.max(40, Math.floor(maxRows / 2))),
          "dsld_coverage_title",
        );
        if (!broadTitle.error) addRows(broadTitle.data, "coverage_term", term, coverage);
      }
    }
  }

  if (dedup.size < Math.min(maxRows, 20)) {
    const broad = await withQueryTimeout(
      supabase
        .from("dsld_labels_meta")
        .select(selectCols)
        .ilike("brand", `%${seedBrand}%`)
        .limit(maxRows),
      "dsld_alias_broad",
    );
    if (!broad.error) addRows(broad.data, "alias", seedBrand, coverage);
  }

  return {
    rows: [...dedup.values()].slice(0, maxRows),
    reviewRows,
  };
};

const fetchDsldFactsByIds = async (ids) => {
  const map = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += 250) chunks.push(ids.slice(i, i + 250));
  for (const chunk of chunks) {
    const { data, error } = await withQueryTimeout(
      supabase
        .from("dsld_label_facts")
        .select("dsld_label_id,facts_json,brand_name,product_name")
        .in("dsld_label_id", chunk),
      "dsld_facts_batch",
    );
    if (error) continue;
    for (const row of data ?? []) {
      map.set(String(row.dsld_label_id), row);
    }
  }
  return map;
};

const fetchLnhpdRowsForBrand = async ({ seedBrand, seedBrandNorm, maxRows }) => {
  const dedup = new Map();
  const reviewRows = [];
  const selectCols = "lnhpd_id,npn,brand_name,product_name,facts_json,missing_fields";
  const coverage = getCoverageTermsForSeed("CA", seedBrandNorm, seedBrand);

  const addRows = (rows, sourceKind, sourceTerm = null) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const npn = String(row?.npn ?? row?.lnhpd_id ?? "").trim();
      if (!npn) continue;
      const key = npn;

      const aliasMatch = brandMatchesSeed(row?.brand_name, seedBrand, "CA");
      const signals = inferMatchSignals({
        rowBrand: row?.brand_name,
        productName: row?.product_name,
        categoryText: null,
        seedBrandTokens: coverage.seedBrandTokens,
        familyTokens: coverage.familyTokens,
        matchedTerm: sourceTerm,
      });
      const hasConfirmedCoverageSignal = isCoverageTermConfirmed(signals);

      let matchedBy = "fuzzy";
      let confidenceBucket = "review";
      if (sourceKind === "canonical") {
        matchedBy = "canonical";
        confidenceBucket = "high";
      } else if (sourceKind === "alias" && aliasMatch) {
        matchedBy = "alias";
        confidenceBucket = "high";
      } else if (sourceKind === "coverage_term" && hasConfirmedCoverageSignal) {
        matchedBy = "coverage_term";
        confidenceBucket = signals.length >= 2 ? "high" : "medium";
      }

      if (matchedBy === "fuzzy" || (sourceKind === "coverage_term" && !hasConfirmedCoverageSignal)) {
        reviewRows.push({
          sourceType: "lnhpd",
          market: "CA",
          seedBrand,
          seedBrandNorm,
          rowBrand: row?.brand_name ?? null,
          productName: row?.product_name ?? null,
          identityKey: `npn:${npn}`,
          matchedBy: sourceKind === "coverage_term" ? "coverage_term_unconfirmed" : "fuzzy",
          matchedTerm: sourceTerm ?? seedBrand,
          matchSignals: signals,
          confidenceBucket: "review",
        });
        continue;
      }

      const payload = {
        ...row,
        __matchMeta: {
          matchedBy,
          matchedTerm: sourceTerm ?? seedBrand,
          matchSignals: signals,
          confidenceBucket,
        },
      };

      const current = dedup.get(key);
      if (!current) {
        dedup.set(key, payload);
      } else {
        const rank = { canonical: 4, alias: 3, coverage_term: 2 };
        const currentRank = rank[current.__matchMeta?.matchedBy] ?? 0;
        const nextRank = rank[payload.__matchMeta?.matchedBy] ?? 0;
        if (nextRank > currentRank) dedup.set(key, payload);
      }
      if (dedup.size >= maxRows) break;
    }
  };

  const canonical = await withQueryTimeout(
    supabase
      .from("lnhpd_facts_complete")
      .select(selectCols)
      .eq("brand_norm", seedBrandNorm)
      .limit(maxRows),
    "lnhpd_exact",
  );
  if (!canonical.error) addRows(canonical.data, "canonical", seedBrand);

  if (dedup.size < Math.min(maxRows, 5)) {
    for (const termMeta of pickCoverageTermCandidates(coverage, 3)) {
      if (dedup.size >= maxRows) break;
      const term = String(termMeta?.term ?? "").trim();
      if (!term) continue;
      const byBrand = await withQueryTimeout(
        supabase
          .from("lnhpd_facts_complete")
          .select(selectCols)
          .ilike("brand_name", `%${term}%`)
          .limit(Math.max(40, Math.floor(maxRows / 2))),
        "lnhpd_coverage_brand",
      );
      if (!byBrand.error) addRows(byBrand.data, "coverage_term", term);

      if (dedup.size < Math.min(maxRows, 20)) {
        const byTitle = await withQueryTimeout(
          supabase
            .from("lnhpd_facts_complete")
            .select(selectCols)
            .ilike("product_name", `%${term}%`)
            .limit(Math.max(40, Math.floor(maxRows / 2))),
          "lnhpd_coverage_title",
        );
        if (!byTitle.error) addRows(byTitle.data, "coverage_term", term);
      }
    }
  }

  if (dedup.size < Math.min(maxRows, 20)) {
    const broad = await withQueryTimeout(
      supabase
        .from("lnhpd_facts_complete")
        .select(selectCols)
        .ilike("brand_name", `%${seedBrand}%`)
        .limit(maxRows),
      "lnhpd_alias_broad",
    );
    if (!broad.error) addRows(broad.data, "alias", seedBrand);
  }

  return {
    rows: [...dedup.values()].slice(0, maxRows),
    reviewRows,
  };
};

const fetchBarcodeMapForNpns = async (npns) => {
  const dedup = new Map();
  const chunks = [];
  for (let i = 0; i < npns.length; i += 300) chunks.push(npns.slice(i, i + 300));
  for (const chunk of chunks) {
    const { data, error } = await withQueryTimeout(
      supabase
        .from("barcode_regulatory_map")
        .select("npn,barcode_gtin14,confidence,source,updated_at")
        .in("npn", chunk)
        .limit(6000),
      "barcode_regulatory_map",
    );
    if (error) continue;
    for (const row of data ?? []) {
      const npn = String(row?.npn ?? "").trim();
      if (!npn) continue;
      const prev = dedup.get(npn);
      const currConf = asNumber(row?.confidence, 0);
      const prevConf = asNumber(prev?.confidence, -1);
      if (!prev || currConf > prevConf) dedup.set(npn, row);
    }
  }
  return dedup;
};

const buildScopeRows = async ({ seeds, maxRowsPerBrand }) => {
  const scopeRows = [];
  const matchAuditRows = [];
  const reviewAuditRows = [];
  const bySeedKey = new Map();

  for (const seed of seeds) {
    const seedKey = `${seed.market}:${seed.brandNorm}`;
    bySeedKey.set(seedKey, {
      ...seed,
      matched: 0,
      reviewOnly: 0,
      sourceTypes: new Set(),
    });

    if (seed.market === "US") {
      const dsldFetch = await fetchDsldRowsForBrand({
        seedBrand: seed.brand,
        seedBrandNorm: seed.brandNorm,
        maxRows: maxRowsPerBrand,
      });
      const dsldRows = dsldFetch.rows;
      const ids = dsldRows.map((row) => Number(row.dsld_label_id)).filter(Number.isFinite);
      const factsMap = await fetchDsldFactsByIds(ids);
      for (const row of dsldRows) {
        const facts = factsMap.get(String(row.dsld_label_id))?.facts_json ?? null;
        const signals = extractSignals({
          sourceType: "dsld",
          factsJson: facts,
          categoryText: row?.category || row?.category_raw || row?.active_ingredients_summary || null,
          productName: row?.product_name || null,
          formText: row?.form || null,
        });
        const scannedLabelEvidenceAvailable = Boolean(
          (Array.isArray(facts?.actives) && facts.actives.length > 0)
          || row?.dsld_pdf
          || row?.dsld_thumbnail
          || row?.serving_size_raw,
        );
        scopeRows.push({
          seedMarket: seed.market,
          seedBrand: seed.brand,
          seedBrandNorm: seed.brandNorm,
          seedRank: seed.rank,
          patchPriorityScore: seed.patchPriorityScore,
          sourceType: "dsld",
          identityKey: `dsldLabelId:${row.dsld_label_id}`,
          sourceId: String(row.dsld_label_id),
          barcodeGtIn14: row?.barcode_normalized_gtin14 ?? null,
          brandName: row?.brand ?? null,
          productName: row?.product_name ?? null,
          categoryName: row?.category ?? row?.category_raw ?? null,
          formText: row?.form ?? null,
          factsJson: facts,
          scannedLabelEvidenceAvailable,
          category_assignment_method: row?.category ? "profile" : "keyword",
          category_assignment_confidence: row?.category ? 0.9 : 0.65,
          matchedBy: row?.__matchMeta?.matchedBy ?? "canonical",
          matchedTerm: row?.__matchMeta?.matchedTerm ?? seed.brand,
          matchSignals: row?.__matchMeta?.matchSignals ?? [],
          confidenceBucket: row?.__matchMeta?.confidenceBucket ?? "high",
          ...signals,
        });
        matchAuditRows.push({
          sourceType: "dsld",
          market: seed.market,
          seedBrand: seed.brand,
          seedBrandNorm: seed.brandNorm,
          identityKey: `dsldLabelId:${row.dsld_label_id}`,
          matchedBy: row?.__matchMeta?.matchedBy ?? "canonical",
          matchedTerm: row?.__matchMeta?.matchedTerm ?? seed.brand,
          matchSignals: row?.__matchMeta?.matchSignals ?? [],
          confidenceBucket: row?.__matchMeta?.confidenceBucket ?? "high",
        });
      }
      reviewAuditRows.push(...(dsldFetch.reviewRows ?? []));
      bySeedKey.get(seedKey).matched += dsldRows.length;
      bySeedKey.get(seedKey).reviewOnly += (dsldFetch.reviewRows ?? []).length;
      bySeedKey.get(seedKey).sourceTypes.add("dsld");
      continue;
    }

    const lnhpdFetch = await fetchLnhpdRowsForBrand({
      seedBrand: seed.brand,
      seedBrandNorm: seed.brandNorm,
      maxRows: maxRowsPerBrand,
    });
    const lnhpdRows = lnhpdFetch.rows;
    const npns = [...new Set(lnhpdRows.map((row) => String(row?.npn ?? "").trim()).filter(Boolean))];
    const mapByNpn = await fetchBarcodeMapForNpns(npns);
    for (const row of lnhpdRows) {
      const npn = String(row?.npn ?? "").trim();
      const mapRow = npn ? mapByNpn.get(npn) : null;
      const signals = extractSignals({
        sourceType: "lnhpd",
        factsJson: row?.facts_json ?? null,
        categoryText: null,
        productName: row?.product_name ?? null,
        formText: null,
      });
      scopeRows.push({
        seedMarket: seed.market,
        seedBrand: seed.brand,
        seedBrandNorm: seed.brandNorm,
        seedRank: seed.rank,
        patchPriorityScore: seed.patchPriorityScore,
        sourceType: "lnhpd",
        identityKey: `npn:${npn || row?.lnhpd_id}`,
        sourceId: npn || String(row?.lnhpd_id ?? ""),
        barcodeGtIn14: mapRow?.barcode_gtin14 ?? null,
        brandName: row?.brand_name ?? null,
        productName: row?.product_name ?? null,
        categoryName: null,
        formText: null,
        factsJson: row?.facts_json ?? null,
        scannedLabelEvidenceAvailable: false,
        category_assignment_method: "keyword",
        category_assignment_confidence: 0.6,
        matchedBy: row?.__matchMeta?.matchedBy ?? "canonical",
        matchedTerm: row?.__matchMeta?.matchedTerm ?? seed.brand,
        matchSignals: row?.__matchMeta?.matchSignals ?? [],
        confidenceBucket: row?.__matchMeta?.confidenceBucket ?? "high",
        ...signals,
      });
      matchAuditRows.push({
        sourceType: "lnhpd",
        market: seed.market,
        seedBrand: seed.brand,
        seedBrandNorm: seed.brandNorm,
        identityKey: `npn:${npn || row?.lnhpd_id}`,
        matchedBy: row?.__matchMeta?.matchedBy ?? "canonical",
        matchedTerm: row?.__matchMeta?.matchedTerm ?? seed.brand,
        matchSignals: row?.__matchMeta?.matchSignals ?? [],
        confidenceBucket: row?.__matchMeta?.confidenceBucket ?? "high",
      });
    }
    reviewAuditRows.push(...(lnhpdFetch.reviewRows ?? []));
    bySeedKey.get(seedKey).matched += lnhpdRows.length;
    bySeedKey.get(seedKey).reviewOnly += (lnhpdFetch.reviewRows ?? []).length;
    bySeedKey.get(seedKey).sourceTypes.add("lnhpd");
  }

  return {
    scopeRows,
    bySeedKey,
    matchAuditRows,
    reviewAuditRows,
  };
};

const laneCandidatesFor = (rows, laneId) => {
  const lane = laneById[laneId];
  if (!lane) return [];
  return rows.filter((row) => lane.isCandidate(row));
};

const buildCoverageSummary = ({ seeds, scopeRows, bySeedKey }) => {
  const rows = [];
  for (const seed of seeds) {
    const seedKey = `${seed.market}:${seed.brandNorm}`;
    const stats = bySeedKey.get(seedKey);
    const products = scopeRows.filter(
      (row) => row.seedMarket === seed.market && row.seedBrandNorm === seed.brandNorm,
    );
    const productCount = products.length;
    const regulatorySourceCount = products.filter((row) => row.sourceType === "dsld" || row.sourceType === "lnhpd").length;
    const matchedByCounts = products.reduce((acc, row) => {
      const key = String(row?.matchedBy ?? "canonical");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    rows.push({
      market: seed.market,
      brand: seed.brand,
      rank: seed.rank,
      patchPriorityScore: seed.patchPriorityScore,
      product_count: productCount,
      regulatory_source_count: regulatorySourceCount,
      web_count: 0,
      unknown_count: 0,
      regulatory_coverage_rate: toRate(regulatorySourceCount, productCount),
      matched: Boolean(stats?.matched > 0),
      review_only_count: stats?.reviewOnly ?? 0,
      matched_by_counts: matchedByCounts,
      source_types: [...(stats?.sourceTypes ?? [])],
    });
  }
  return rows;
};

const buildMissingDistribution = ({ seeds, scopeRows }) => {
  const rows = [];
  for (const seed of seeds) {
    const products = scopeRows.filter(
      (row) => row.seedMarket === seed.market && row.seedBrandNorm === seed.brandNorm,
    );
    const total = products.length;
    const missingDirections = products.filter(
      (row) => row.sourceType === "dsld" && !row.hasDirectionsText,
    ).length;
    const missingWarnings = products.filter((row) => !row.hasLabelWarnings).length;
    const missingForm = products.filter((row) =>
      (isVitaminDCategory(row) && !row.hasVitaminDForm)
      || (isMagnesiumCategory(row) && !row.hasMagnesiumFormOrElemental),
    ).length;
    const missingActiveBreakdown = products.filter(
      (row) => isFishOilCategory(row) && !row.hasFishOilBreakdown,
    ).length;
    const missingServingBasis = products.filter((row) => {
      if (row.sourceType === "dsld") {
        return !String(row?.factsJson?.servingSize ?? "").trim();
      }
      return !(Array.isArray(row?.factsJson?.doses) && row.factsJson.doses.length > 0);
    }).length;
    rows.push({
      market: seed.market,
      brand: seed.brand,
      total_products: total,
      missing_directions_count: missingDirections,
      missing_label_warnings_count: missingWarnings,
      missing_form_count: missingForm,
      missing_active_breakdown_count: missingActiveBreakdown,
      missing_serving_basis_count: missingServingBasis,
    });
  }
  return rows;
};

const buildCategoryDistribution = ({ scopeRows }) => {
  const byCategory = new Map();
  for (const row of scopeRows) {
    const key = row.categoryBucket || "other";
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        category: key,
        product_count: 0,
        us_count: 0,
        ca_count: 0,
        profile_assigned_count: 0,
        keyword_assigned_count: 0,
      });
    }
    const bucket = byCategory.get(key);
    bucket.product_count += 1;
    if (row.seedMarket === "US") bucket.us_count += 1;
    if (row.seedMarket === "CA") bucket.ca_count += 1;
    if (row.category_assignment_method === "profile") bucket.profile_assigned_count += 1;
    if (row.category_assignment_method === "keyword") bucket.keyword_assigned_count += 1;
  }
  const total = scopeRows.length;
  return [...byCategory.values()]
    .sort((a, b) => b.product_count - a.product_count)
    .map((row) => ({
      ...row,
      share: toRate(row.product_count, total),
    }));
};

const buildNormalizationHitRate = ({ seeds, bySeedKey }) => {
  const total = seeds.length;
  const matched = seeds.filter((seed) => (bySeedKey.get(`${seed.market}:${seed.brandNorm}`)?.matched ?? 0) > 0);
  const exploratoryMatched = seeds.filter((seed) => {
    const stats = bySeedKey.get(`${seed.market}:${seed.brandNorm}`);
    return (stats?.matched ?? 0) > 0 || (stats?.reviewOnly ?? 0) > 0;
  });
  const byMarket = {};
  for (const market of ["US", "CA"]) {
    const marketSeeds = seeds.filter((seed) => seed.market === market);
    const marketMatched = marketSeeds.filter(
      (seed) => (bySeedKey.get(`${seed.market}:${seed.brandNorm}`)?.matched ?? 0) > 0,
    );
    const marketExploratoryMatched = marketSeeds.filter((seed) => {
      const stats = bySeedKey.get(`${seed.market}:${seed.brandNorm}`);
      return (stats?.matched ?? 0) > 0 || (stats?.reviewOnly ?? 0) > 0;
    });
    byMarket[market] = {
      total: marketSeeds.length,
      matched: marketMatched.length,
      rate: toRate(marketMatched.length, marketSeeds.length),
      exploratory_matched: marketExploratoryMatched.length,
      exploratory_rate: toRate(marketExploratoryMatched.length, marketSeeds.length),
      unmatched_brands: marketSeeds
        .filter((seed) => !marketMatched.find((hit) => hit.brandNorm === seed.brandNorm))
        .map((seed) => seed.brand),
    };
  }
  return {
    total,
    matched: matched.length,
    rate: toRate(matched.length, total),
    strict_kpi_rate: toRate(matched.length, total),
    exploratory_matched: exploratoryMatched.length,
    exploratory_rate: toRate(exploratoryMatched.length, total),
    byMarket,
  };
};

const summarizeLaneReadiness = ({ scopeRows, laneThresholds }) => {
  const totalProducts = Math.max(1, scopeRows.length);
  const matrix = [];
  for (const lane of laneDefs) {
    const candidates = laneCandidatesFor(scopeRows, lane.laneId);
    const candidateCount = candidates.length;
    const evidenceAvailable = candidates.filter((row) => row.scannedLabelEvidenceAvailable).length;
    const evidenceAvailabilityRate = toRate(evidenceAvailable, candidateCount);
    const productCountCovered = evidenceAvailable;
    const brandCountCovered = new Set(
      candidates
        .filter((row) => row.scannedLabelEvidenceAvailable)
        .map((row) => `${row.seedMarket}:${row.seedBrandNorm}`),
    ).size;
    const projectedExecutionReach = toRate(productCountCovered, totalProducts);
    const conflictRiskEstimate = Number((0.02 + (1 - evidenceAvailabilityRate) * 0.03).toFixed(6));
    const expectedMissingReduction = Number((evidenceAvailabilityRate * (1 - conflictRiskEstimate)).toFixed(6));
    const expectedVerdictLift = Number((expectedMissingReduction * lane.impactWeight * (1 + projectedExecutionReach)).toFixed(6));
    const score = Number((
      expectedMissingReduction * 0.45
      + evidenceAvailabilityRate * 0.2
      + projectedExecutionReach * 0.2
      + (1 - conflictRiskEstimate) * 0.15
    ).toFixed(6));
    const selectionPass = lane.laneGroup !== "lane2_candidate"
      ? true
      : (
        candidateCount >= laneThresholds.minCandidateCount
        && evidenceAvailabilityRate >= laneThresholds.minEvidenceAvailabilityRate
        && conflictRiskEstimate <= laneThresholds.maxConflictRiskEstimate
        && expectedMissingReduction >= laneThresholds.minExpectedMissingReduction
        && brandCountCovered >= laneThresholds.minBrandCountCovered
        && productCountCovered >= laneThresholds.minProductCountCovered
      );

    matrix.push({
      lane_id: lane.laneId,
      lane_group: lane.laneGroup,
      target_fields: lane.targetFields,
      candidate_count: candidateCount,
      evidence_availability_rate: evidenceAvailabilityRate,
      conflict_risk_estimate: conflictRiskEstimate,
      expected_missing_reduction: expectedMissingReduction,
      expected_verdict_lift: expectedVerdictLift,
      projected_execution_reach: projectedExecutionReach,
      brand_count_covered: brandCountCovered,
      product_count_covered: productCountCovered,
      score,
      recommended_rank: 0,
      selection_pass: selectionPass,
    });
  }

  const ranked = [...matrix]
    .sort((a, b) => b.score - a.score || b.expected_verdict_lift - a.expected_verdict_lift || b.product_count_covered - a.product_count_covered)
    .map((row, idx) => ({ ...row, recommended_rank: idx + 1 }));
  return ranked;
};

const pickLane2 = ({ matrix }) => {
  const laneRows = matrix.filter((row) => row.lane_group === "lane2_candidate");
  const byId = Object.fromEntries(laneRows.map((row) => [row.lane_id, row]));
  const passed = lane2PreferenceOrder
    .map((laneId) => byId[laneId])
    .filter((row) => row && row.selection_pass)
    .sort((a, b) => a.recommended_rank - b.recommended_rank);

  if (passed.length === 0) {
    return {
      lane_selection_decision: "single_lane_only",
      selected_lane_1: "patch_directions_text_v1",
      selected_lane_2: null,
      fallback_to_single_lane: true,
      selection_reason: "no_lane2_candidate_passed_thresholds",
      lane_selection_reason: "no_lane2_candidate_passed_thresholds",
      threshold_check_snapshot: laneRows,
    };
  }

  return {
    lane_selection_decision: "dual_lane",
    selected_lane_1: "patch_directions_text_v1",
    selected_lane_2: passed[0].lane_id,
    fallback_to_single_lane: false,
    selection_reason: "selected_best_lane2_by_threshold_and_rank",
    lane_selection_reason: "selected_best_lane2_by_threshold_and_rank",
    threshold_check_snapshot: laneRows,
  };
};

const buildPriorityRows = ({ seeds, scopeRows, laneSelection }) => {
  const selectedLanes = [laneSelection.selected_lane_1];
  if (laneSelection.selected_lane_2) selectedLanes.push(laneSelection.selected_lane_2);
  const maxHeat = Math.max(...seeds.map((seed) => seed.patchPriorityScore), 1);

  const rows = [];
  for (const seed of seeds) {
    const brandKey = `${seed.market}:${seed.brandNorm}`;
    const brandProducts = scopeRows.filter((row) => `${row.seedMarket}:${row.seedBrandNorm}` === brandKey);
    const candidateProducts = brandProducts.filter((row) => selectedLanes.some((laneId) => laneById[laneId].isCandidate(row)));
    const evidenceReady = candidateProducts.filter((row) => row.scannedLabelEvidenceAvailable).length;
    const brandHeat = clamp01(seed.patchPriorityScore / maxHeat);
    const candidateDensity = toRate(candidateProducts.length, Math.max(brandProducts.length, 1));
    const evidenceAvailability = toRate(evidenceReady, Math.max(candidateProducts.length, 1));
    const conflictRisk = Number((0.02 + (1 - evidenceAvailability) * 0.03).toFixed(6));
    const lowConflictFactor = clamp01(1 - conflictRisk);
    const priorityScore = Number((
      0.35 * brandHeat
      + 0.30 * candidateDensity
      + 0.20 * evidenceAvailability
      + 0.15 * lowConflictFactor
    ).toFixed(6));

    rows.push({
      market: seed.market,
      brand: seed.brand,
      brandNorm: seed.brandNorm,
      rank: seed.rank,
      patchPriorityScore: seed.patchPriorityScore,
      brand_heat: brandHeat,
      candidate_density: candidateDensity,
      evidence_availability: evidenceAvailability,
      low_conflict_factor: lowConflictFactor,
      candidate_count: candidateProducts.length,
      product_count: brandProducts.length,
      priority_score: priorityScore,
      selected_lanes: selectedLanes,
    });
  }
  return rows.sort((a, b) => b.priority_score - a.priority_score || a.rank - b.rank || a.brand.localeCompare(b.brand));
};

const pickTop30 = ({
  priorityRows,
  normalizationHitRate,
  marketFloorUs,
  marketFloorCa,
  targetTop30Count,
}) => {
  const usRows = priorityRows.filter((row) => row.market === "US");
  const caRows = priorityRows.filter((row) => row.market === "CA");
  const usHit = normalizationHitRate?.byMarket?.US?.rate ?? 0;
  const caHit = normalizationHitRate?.byMarket?.CA?.rate ?? 0;
  const usReady = usRows.filter((row) => row.candidate_count > 0).length;
  const caReady = caRows.filter((row) => row.candidate_count > 0).length;

  const overrideReasons = [];
  if (usHit < 0.95) overrideReasons.push("us_brand_normalization_hit_rate_below_95");
  if (caHit < 0.95) overrideReasons.push("ca_brand_normalization_hit_rate_below_95");
  if (usReady < marketFloorUs) overrideReasons.push("us_lane_readiness_below_floor");
  if (caReady < marketFloorCa) overrideReasons.push("ca_lane_readiness_below_floor");
  const allowOverride = overrideReasons.length > 0;

  const selected = [];
  if (!allowOverride) {
    const pickByMarket = (rows, count) => rows.slice(0, Math.min(count, rows.length));
    selected.push(...pickByMarket(usRows, marketFloorUs));
    selected.push(...pickByMarket(caRows, marketFloorCa));
    const selectedSet = new Set(selected.map((row) => `${row.market}:${row.brandNorm}`));
    for (const row of priorityRows) {
      const key = `${row.market}:${row.brandNorm}`;
      if (selectedSet.has(key)) continue;
      selected.push(row);
      selectedSet.add(key);
      if (selected.length >= targetTop30Count) break;
    }
  } else {
    selected.push(...priorityRows.slice(0, targetTop30Count));
  }

  return {
    selected: selected.slice(0, targetTop30Count).map((row, idx) => ({ ...row, selection_rank: idx + 1 })),
    allowOverride,
    overrideReasons,
    floors: {
      US: marketFloorUs,
      CA: marketFloorCa,
    },
    readiness: {
      US: usReady,
      CA: caReady,
    },
  };
};

const buildPatchCandidates = ({ scopeRows, selectedRows, laneSelection }) => {
  const selectedBrandKeys = new Set(selectedRows.map((row) => `${row.market}:${row.brandNorm}`));
  const lanes = [laneSelection.selected_lane_1];
  if (laneSelection.selected_lane_2) lanes.push(laneSelection.selected_lane_2);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

  const candidateByLane = new Map(lanes.map((laneId) => [laneId, []]));
  for (const row of scopeRows) {
    const brandKey = `${row.seedMarket}:${row.seedBrandNorm}`;
    if (!selectedBrandKeys.has(brandKey)) continue;
    for (const laneId of lanes) {
      const lane = laneById[laneId];
      if (!lane || !lane.isCandidate(row)) continue;
      const sourceTier = "scanned_label";
      if (!WRITABLE_SOURCE_TIERS.has(sourceTier)) {
        continue;
      }
      if (laneId === "patch_fish_oil_breakdown_v1" && FISH_OIL_REVERSE_INFERENCE_FORBIDDEN) {
        const lower = flattenText([row.factsJson, row.productName, row.categoryName]).join(" ").toLowerCase();
        const hasOnlyTotalFishOil = /\bfish oil\b/.test(lower) && !formRegex.omegaBreakdown.test(lower);
        if (!hasOnlyTotalFishOil) {
          continue;
        }
      }
      const candidateId = `${laneId}:${row.identityKey}:${row.barcodeGtIn14 || "nobarcode"}`;
      const candidate = {
        candidateId,
        generatedAt: nowIso,
        laneId,
        market: row.seedMarket,
        seedBrand: row.seedBrand,
        sourceType: row.sourceType,
        identityKey: row.identityKey,
        sourceId: row.sourceId,
        barcode_gtin14: row.barcodeGtIn14,
        brandName: row.brandName,
        productName: row.productName,
        categoryName: row.categoryName,
        fieldKey: lane.targetFields.length === 1 ? lane.targetFields[0] : null,
        fieldKeys: lane.targetFields,
        patchedValue: { state: "pending_scanned_label_extraction" },
        sourceTier,
        evidenceRef: {
          dsldPdf: row.factsJson?.dsldPdf ?? null,
          dsldThumbnail: row.factsJson?.dsldThumbnail ?? null,
          recordIdentity: row.identityKey,
        },
        confidence: row.scannedLabelEvidenceAvailable ? 0.7 : 0.3,
        owner: "unassigned",
        status: "candidate_open",
        expiresAt,
        reviewAfterDays: 30,
        reasonCode: lane.reasonCode,
        context: {
          scannedLabelEvidenceAvailable: row.scannedLabelEvidenceAvailable,
          hasDirectionsText: row.hasDirectionsText,
          hasFishOilBreakdown: row.hasFishOilBreakdown,
          hasVitaminDForm: row.hasVitaminDForm,
          hasMagnesiumFormOrElemental: row.hasMagnesiumFormOrElemental,
          hasProbioticStrainCfu: row.hasProbioticStrainCfu,
          fishOilReverseInferenceForbidden: laneId === "patch_fish_oil_breakdown_v1" ? true : undefined,
        },
      };
      candidateByLane.get(laneId).push(candidate);
    }
  }

  return {
    byLane: candidateByLane,
    all: lanes.flatMap((laneId) => candidateByLane.get(laneId)),
  };
};

const preFilterConflicts = ({ candidates }) => {
  const conflicts = [];
  const filtered = [];
  const requiredFields = [
    "identityKey",
    "fieldKeys",
    "patchedValue",
    "sourceTier",
    "evidenceRef",
    "confidence",
    "owner",
    "status",
    "expiresAt",
    "reviewAfterDays",
    "reasonCode",
  ];
  for (const row of candidates) {
    const missingRequired = requiredFields.filter((key) => row?.[key] == null);
    const hasEvidence = Boolean(row?.context?.scannedLabelEvidenceAvailable);
    const lowConfidence = asNumber(row?.confidence, 0) < 0.5;
    const hasInvalidSourceTier = !WRITABLE_SOURCE_TIERS.has(String(row?.sourceTier ?? ""));
    if (missingRequired.length > 0 || !hasEvidence || lowConfidence || hasInvalidSourceTier) {
      conflicts.push({
        ...row,
        status: "conflict_review_required",
        conflictReason: missingRequired.length > 0
          ? "missing_required_fields"
          : (!hasEvidence
            ? "missing_scanned_label_evidence"
            : (hasInvalidSourceTier ? "invalid_source_tier" : "low_confidence_candidate")),
        missingRequiredFields: missingRequired,
      });
      continue;
    }
    filtered.push({
      ...row,
      status: "shadow_ready",
    });
  }
  return { conflicts, filtered };
};

const discoverStageBEvidencePaths = async (stageBSeqDirArg) => {
  const seqDir = resolvePath(stageBSeqDirArg) || (await newestOutputDirByPrefix("v1.6.12-r2d-seq-"));
  if (!seqDir) return null;
  const stableDir = path.join(seqDir, "stable");
  return {
    seqDir,
    stableDir,
    compareRun1: path.join(stableDir, "b2-pass-run1", "stage_b_baseline_compare.json"),
    compareRun2: path.join(stableDir, "b2-pass-run2", "stage_b_baseline_compare.json"),
    observabilityReport: path.join(stableDir, "decision_support_observability_report.json"),
  };
};

const gitRead = (argsList) => {
  try {
    const result = spawnSync("git", argsList, { cwd: ROOT_DIR, encoding: "utf8" });
    if (result.status !== 0) return null;
    const value = String(result.stdout ?? "").trim();
    return value || null;
  } catch {
    return null;
  }
};

const discoverPreviousNormalizationRate = async () => {
  const dirs = await listOutputDirsByPrefix("v1.6.14-e-plus-");
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const decisionPath = path.join(
      OUTPUT_ROOT,
      dirs[i],
      "strict",
      "stage_e_strict_closure_decision.json",
    );
    try {
      const payload = await readJson(decisionPath);
      const rate = asNumber(payload?.metrics?.brandNormalizationRate, NaN);
      if (Number.isFinite(rate)) {
        return {
          path: decisionPath,
          rate,
        };
      }
    } catch {
      // continue
    }
  }
  return null;
};

const main = async () => {
  const defaultPlanPath = "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json";
  const planPath = resolvePath(getArg("plan-json")) || (await fs.stat(defaultPlanPath).then(() => defaultPlanPath).catch(() => null));
  if (!planPath) {
    console.error("[stage-c-final] Missing --plan-json and default plan path not found");
    process.exit(1);
  }
  const brandAliasMapPath = resolvePath(getArg("brand-alias-map-json"));
  const brandCoverageTermsPath = resolvePath(getArg("brand-coverage-terms-json"));
  const brandAliasLoad = await loadBrandAliasIndex(brandAliasMapPath);
  const coverageTermsLoad = await loadBrandCoverageTermsIndex(brandCoverageTermsPath);

  const maxRowsPerBrand = Math.max(50, asNumber(getArg("max-records-per-brand"), 400));
  const minBrandNormalizationHitRate = clamp01(getArg("min-brand-normalization-hit-rate") ?? 0.95);
  const targetTop30Count = Math.max(10, asNumber(getArg("target-top30-count"), 30));
  const marketFloorUs = Math.max(0, asNumber(getArg("market-floor-us"), 10));
  const marketFloorCa = Math.max(0, asNumber(getArg("market-floor-ca"), 10));
  const laneThresholds = {
    minCandidateCount: Math.max(1, asNumber(getArg("min-candidate-count"), 20)),
    minEvidenceAvailabilityRate: clamp01(getArg("min-evidence-availability-rate") ?? 0.6),
    maxConflictRiskEstimate: clamp01(getArg("max-conflict-risk-estimate") ?? 0.05),
    minExpectedMissingReduction: clamp01(getArg("min-expected-missing-reduction") ?? 0.15),
    minBrandCountCovered: Math.max(1, asNumber(getArg("min-brand-count-covered"), 8)),
    minProductCountCovered: Math.max(1, asNumber(getArg("min-product-count-covered"), 40)),
  };

  const outDir = resolvePath(getArg("out-dir")) || path.join(OUTPUT_ROOT, `v1.6.12-stage-c-${nowTag}`);
  const c0Dir = path.join(outDir, "c0_baseline");
  const c1aDir = path.join(outDir, "c1a_top100_census");
  const c15Dir = path.join(outDir, "c1_5_lane_selection");
  const c1bDir = path.join(outDir, "c1b_top30_execution_slice");
  const c2Dir = path.join(outDir, "c2_patch_candidates");
  const c3Dir = path.join(outDir, "c3_conflict_prefilter");

  await ensureDir(c0Dir);
  await ensureDir(c1aDir);
  await ensureDir(c15Dir);
  await ensureDir(c1bDir);
  await ensureDir(c2Dir);
  await ensureDir(c3Dir);

  const plan = await readJson(planPath);
  const seeds = parsePlanBrands(plan);
  if (seeds.length < 80) {
    console.error(`[stage-c-final] Expected Top100 seed set, got ${seeds.length}`);
    process.exit(1);
  }

  const stageBEvidence = await discoverStageBEvidencePaths(getArg("stage-b-seq-dir"));
  const b2Run1 = stageBEvidence ? await readJson(stageBEvidence.compareRun1) : null;
  const b2Run2 = stageBEvidence ? await readJson(stageBEvidence.compareRun2) : null;

  const stageCBaselineManifest = {
    generatedAt: new Date().toISOString(),
    gitCommit: gitRead(["rev-parse", "HEAD"]),
    branch: gitRead(["rev-parse", "--abbrev-ref", "HEAD"]),
    env: process.env.STAGE_ENV || "staging",
    flagsSnapshot: {
      KEY_CONTRACT_V2: process.env.KEY_CONTRACT_V2 ?? null,
      WRITE_GUARD_V2: process.env.WRITE_GUARD_V2 ?? null,
      METADATA_READONLY: process.env.METADATA_READONLY ?? null,
      STAGE0_PROTOCOL_UNIFIED: process.env.STAGE0_PROTOCOL_UNIFIED ?? null,
    },
    stageBPassEvidencePaths: stageBEvidence
      ? {
        seqDir: stageBEvidence.seqDir,
        compareRun1: stageBEvidence.compareRun1,
        compareRun2: stageBEvidence.compareRun2,
        observabilityReport: stageBEvidence.observabilityReport,
      }
      : null,
    stageBPassValidated: Boolean(b2Run1?.pass === true && b2Run2?.pass === true),
    scopePolicy: {
      decisionPool: "top100_read_only",
      executionSlice: `top${targetTop30Count}_dynamic`,
      outOfScope: ["full_library_patch", "price_value", "stage_d_enforce", "stage_e_expansion"],
    },
    lanePolicy: {
      lane1_fixed: "patch_directions_text_v1",
      lane2_dynamic_candidates: lane2PreferenceOrder,
      patchSourceTierWritable: ["scanned_label"],
      patchSourceTierNonWritable: ["official_record", "general_science", "inferred"],
    },
    brandAliasPolicy: {
      enabled: Boolean(brandAliasLoad.path),
      brandAliasMapPath: brandAliasLoad.path,
      aliasEntries: brandAliasLoad.entries,
      coverageTermsEnabled: Boolean(coverageTermsLoad.path),
      coverageTermsMapPath: coverageTermsLoad.path,
      coverageTermsEntries: coverageTermsLoad.entries,
      coverageTermsTotal: coverageTermsLoad.terms,
      matchingOrder: [
        "canonical",
        "alias_map",
        "coverage_term_confirmed",
        "fuzzy_review_only",
      ],
    },
    metricFormulaVersion: "stage-c-final-v1",
    planJsonPath: planPath,
  };

  await writeJson(path.join(c0Dir, "stage_c_baseline_manifest.json"), stageCBaselineManifest);
  await writeJson(path.join(c0Dir, "stage_c_baseline_metrics.json"), {
    generatedAt: new Date().toISOString(),
    stageBDigest409Pass: b2Run1?.digest409Metrics?.pass === true && b2Run2?.digest409Metrics?.pass === true,
    stageBNoRegressionPass: b2Run1?.noRegression?.pass === true && b2Run2?.noRegression?.pass === true,
    stageBByRolePass: b2Run1?.byRole?.pass === true && b2Run2?.byRole?.pass === true,
  });

  const { scopeRows, bySeedKey, matchAuditRows, reviewAuditRows } = await buildScopeRows({
    seeds,
    maxRowsPerBrand,
  });

  const coverageSummary = buildCoverageSummary({ seeds, scopeRows, bySeedKey });
  const missingDistribution = buildMissingDistribution({ seeds, scopeRows });
  const categoryDistribution = buildCategoryDistribution({ scopeRows });
  const normalizationHitRate = buildNormalizationHitRate({ seeds, bySeedKey });
  const laneReadinessMatrix = summarizeLaneReadiness({ scopeRows, laneThresholds });
  const previousNormalization = await discoverPreviousNormalizationRate();

  const laneCandidatesRows = [];
  for (const row of scopeRows) {
    for (const lane of laneDefs) {
      if (!lane.isCandidate(row)) continue;
      laneCandidatesRows.push({
        market: row.seedMarket,
        seed_brand: row.seedBrand,
        brand: row.brandName,
        product_name: row.productName,
        identity_key: row.identityKey,
        barcode_gtin14: row.barcodeGtIn14,
        category_bucket: row.categoryBucket,
        candidate_patch_lane: lane.laneId,
        root_cause: lane.reasonCode,
        source_type: row.sourceType,
        scanned_label_evidence_available: row.scannedLabelEvidenceAvailable,
        category_assignment_method: row.category_assignment_method,
        category_assignment_confidence: row.category_assignment_confidence,
        matched_by: row.matchedBy,
        matched_term: row.matchedTerm,
        match_signals: row.matchSignals,
        confidence_bucket: row.confidenceBucket,
      });
    }
  }

  await writeJson(path.join(c1aDir, "brand_scope_products_top100.json"), {
    generatedAt: new Date().toISOString(),
    total_rows: scopeRows.length,
    rows: scopeRows,
  });
  await writeJson(path.join(c1aDir, "brand_coverage_summary_top100.json"), coverageSummary);
  await writeJson(path.join(c1aDir, "brand_missing_field_distribution_top100.json"), missingDistribution);
  await writeJson(path.join(c1aDir, "brand_category_distribution_top100.json"), categoryDistribution);
  await writeJson(path.join(c1aDir, "brand_category_patch_candidates_top100.json"), laneCandidatesRows);
  await writeJson(path.join(c1aDir, "brand_normalization_hit_rate.json"), normalizationHitRate);
  await writeJson(path.join(c1aDir, "lane_readiness_matrix.json"), laneReadinessMatrix);
  await writeJson(path.join(c1aDir, "coverage_precision_audit.json"), {
    generatedAt: new Date().toISOString(),
    acceptedCount: matchAuditRows.length,
    reviewCount: reviewAuditRows.length,
    acceptedBy: matchAuditRows.reduce((acc, row) => {
      const key = String(row?.matchedBy ?? "canonical");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    acceptedByConfidence: matchAuditRows.reduce((acc, row) => {
      const key = String(row?.confidenceBucket ?? "medium");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    reviewBy: reviewAuditRows.reduce((acc, row) => {
      const key = String(row?.matchedBy ?? "review");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    sampleReviewRows: reviewAuditRows.slice(0, 100),
  });
  await writeJsonl(path.join(c1aDir, "coverage_review_bucket.jsonl"), reviewAuditRows);

  const coverageTermRows = scopeRows.filter((row) => row.matchedBy === "coverage_term");
  const newlyMatchedBrandCount = new Set(
    coverageTermRows.map((row) => `${row.seedMarket}:${row.seedBrandNorm}`),
  ).size;
  const newlyMatchedProductCount = coverageTermRows.length;
  const newlyVisibleBestForCount = coverageTermRows.filter((row) => row.categoryBucket !== "other").length;
  const newlyVisibleBeforeYouBuyCount = coverageTermRows.filter(
    (row) => row.hasDirectionsText === false || row.hasLabelWarnings === false,
  ).length;
  const newlyVisibleFormulaExplainabilityCount = coverageTermRows.filter((row) =>
    Boolean(
      row.hasVitaminDForm
      || row.hasMagnesiumFormOrElemental
      || row.hasProbioticStrainCfu
      || row.hasFishOilBreakdown
      || String(row?.formText ?? "").trim().length > 0,
    ),
  ).length;

  const beforeRate = previousNormalization?.rate ?? null;
  const afterRate = normalizationHitRate.rate;
  const deltaPp = beforeRate == null ? null : Number(((afterRate - beforeRate) * 100).toFixed(2));
  await writeJson(path.join(c1aDir, "coverage_uplift_report.json"), {
    generatedAt: new Date().toISOString(),
    strictKpi: {
      beforeRate,
      beforeSource: previousNormalization?.path ?? null,
      afterRate,
      deltaPp,
      threshold: minBrandNormalizationHitRate,
      pass: afterRate >= minBrandNormalizationHitRate,
    },
    matchedCounts: {
      totalBrands: normalizationHitRate.total,
      strictMatchedBrands: normalizationHitRate.matched,
      exploratoryMatchedBrands: normalizationHitRate.exploratory_matched,
    },
    matchedBy: {
      canonical: matchAuditRows.filter((row) => row.matchedBy === "canonical").length,
      alias: matchAuditRows.filter((row) => row.matchedBy === "alias").length,
      coverage_term_confirmed: matchAuditRows.filter((row) => row.matchedBy === "coverage_term").length,
      fuzzy_review: reviewAuditRows.filter((row) => String(row?.matchedBy).includes("fuzzy")).length,
    },
  });
  await writeJson(path.join(c1aDir, "visibility_delta_from_coverage.json"), {
    generatedAt: new Date().toISOString(),
    newly_matched_brand_count: newlyMatchedBrandCount,
    newly_matched_product_count: newlyMatchedProductCount,
    newly_visible_best_for_count: newlyVisibleBestForCount,
    newly_visible_before_you_buy_count: newlyVisibleBeforeYouBuyCount,
    newly_visible_formula_explainability_count: newlyVisibleFormulaExplainabilityCount,
  });

  const c1aGatePass =
    normalizationHitRate.rate >= minBrandNormalizationHitRate;
  await writeJson(path.join(c1aDir, "c1a_gate_result.json"), {
    generatedAt: new Date().toISOString(),
    pass: c1aGatePass,
    minBrandNormalizationHitRate,
    observedBrandNormalizationHitRate: normalizationHitRate.rate,
    strictKpiDefinition: {
      includedMatchTypes: ["canonical", "alias", "coverage_term_confirmed"],
      excludedMatchTypes: ["fuzzy_review"],
    },
    dbWriteCount: 0,
    sourceTierPolicy: {
      writable: [...WRITABLE_SOURCE_TIERS],
      nonWritable: NON_WRITABLE_SOURCE_TIERS,
    },
    reasons: c1aGatePass ? [] : ["brand_normalization_hit_rate_below_threshold"],
  });

  const laneSelectionDecision = pickLane2({ matrix: laneReadinessMatrix });
  await writeJson(path.join(c15Dir, "lane_selection_decision.json"), laneSelectionDecision);
  await fs.writeFile(
    path.join(c15Dir, "lane_selection_decision.md"),
    [
      "# Lane Selection Decision",
      "",
      `- selected_lane_1: ${laneSelectionDecision.selected_lane_1}`,
      `- selected_lane_2: ${laneSelectionDecision.selected_lane_2 ?? "none"}`,
      `- fallback_to_single_lane: ${laneSelectionDecision.fallback_to_single_lane}`,
      `- selection_reason: ${laneSelectionDecision.selection_reason}`,
      "",
      "## Threshold Snapshot",
      "",
      "```json",
      JSON.stringify(laneSelectionDecision.threshold_check_snapshot, null, 2),
      "```",
      "",
    ].join("\n"),
    "utf8",
  );

  const priorityRows = buildPriorityRows({ seeds, scopeRows, laneSelection: laneSelectionDecision });
  const top30Pick = pickTop30({
    priorityRows,
    normalizationHitRate,
    marketFloorUs,
    marketFloorCa,
    targetTop30Count,
  });

  await writeJson(path.join(c1bDir, "execution_slice_top30.json"), {
    generatedAt: new Date().toISOString(),
    selected_count: top30Pick.selected.length,
    selected: top30Pick.selected,
    allow_override: top30Pick.allowOverride,
    override_reason: top30Pick.allowOverride ? top30Pick.overrideReasons : [],
    market_floor: top30Pick.floors,
    market_readiness: top30Pick.readiness,
  });
  await fs.writeFile(
    path.join(c1bDir, "execution_slice_selection_report.md"),
    [
      "# Execution Slice Selection",
      "",
      `- target: Top${targetTop30Count}`,
      `- selected: ${top30Pick.selected.length}`,
      `- allow_override: ${top30Pick.allowOverride}`,
      `- override_reason: ${top30Pick.overrideReasons.join(", ") || "none"}`,
      `- market_floor_us: ${marketFloorUs}`,
      `- market_floor_ca: ${marketFloorCa}`,
      "",
      "## Selected Brands",
      "",
      ...top30Pick.selected.map(
        (row) => `- [${row.selection_rank}] ${row.market} | ${row.brand} | priority_score=${row.priority_score}`,
      ),
      "",
    ].join("\n"),
    "utf8",
  );

  if (!hasFlag("skip-c2-c3")) {
    const candidates = buildPatchCandidates({
      scopeRows,
      selectedRows: top30Pick.selected,
      laneSelection: laneSelectionDecision,
    });
    const lane1Rows = candidates.byLane.get("patch_directions_text_v1") ?? [];
    const lane2Rows = laneSelectionDecision.selected_lane_2
      ? (candidates.byLane.get(laneSelectionDecision.selected_lane_2) ?? [])
      : [];

    await writeJsonl(path.join(c2Dir, "stage_c_patch_candidates_lane1_directions.jsonl"), lane1Rows);
    await writeJsonl(path.join(c2Dir, "stage_c_patch_candidates_lane2_dynamic.jsonl"), lane2Rows);
    await writeJson(path.join(c2Dir, "stage_c_patch_candidates_summary.json"), {
      generatedAt: new Date().toISOString(),
      policy: {
        writableSourceTiers: [...WRITABLE_SOURCE_TIERS],
        nonWritableSourceTiers: NON_WRITABLE_SOURCE_TIERS,
        fishOilReverseInferenceForbidden: FISH_OIL_REVERSE_INFERENCE_FORBIDDEN,
      },
      lane1: {
        laneId: "patch_directions_text_v1",
        candidateCount: lane1Rows.length,
      },
      lane2: {
        laneId: laneSelectionDecision.selected_lane_2,
        candidateCount: lane2Rows.length,
      },
      totalCandidates: candidates.all.length,
    });

    const preFilter = preFilterConflicts({ candidates: candidates.all });
    await writeJsonl(path.join(c3Dir, "stage_c_patch_conflicts_queue.jsonl"), preFilter.conflicts);
    await writeJsonl(path.join(c3Dir, "stage_c_patch_candidates_filtered.jsonl"), preFilter.filtered);
  }

  await writeJson(path.join(outDir, "stage_c_readonly_summary.json"), {
    generatedAt: new Date().toISOString(),
    c1a_gate_pass: c1aGatePass,
    can_enter_c2: c1aGatePass,
    observed_brand_normalization_hit_rate: normalizationHitRate.rate,
    strict_brand_normalization_hit_rate: normalizationHitRate.strict_kpi_rate,
    exploratory_brand_normalization_hit_rate: normalizationHitRate.exploratory_rate,
    selected_lane_1: laneSelectionDecision.selected_lane_1,
    selected_lane_2: laneSelectionDecision.selected_lane_2,
    top30_count: top30Pick.selected.length,
    dbWriteCount: 0,
    brandAlias: {
      enabled: Boolean(brandAliasLoad.path),
      path: brandAliasLoad.path,
      entries: brandAliasLoad.entries,
    },
    brandCoverageTerms: {
      enabled: Boolean(coverageTermsLoad.path),
      path: coverageTermsLoad.path,
      entries: coverageTermsLoad.entries,
      terms: coverageTermsLoad.terms,
    },
    outputDirs: {
      c0Dir,
      c1aDir,
      c15Dir,
      c1bDir,
      c2Dir: hasFlag("skip-c2-c3") ? null : c2Dir,
      c3Dir: hasFlag("skip-c2-c3") ? null : c3Dir,
    },
  });

  console.log(`[stage-c-final] completed: ${outDir}`);
  console.log(
    JSON.stringify(
      {
        c1aGatePass,
        brandNormalizationHitRate: normalizationHitRate.rate,
        strictBrandNormalizationHitRate: normalizationHitRate.strict_kpi_rate,
        selectedLane2: laneSelectionDecision.selected_lane_2,
        top30Count: top30Pick.selected.length,
        coverageTermsEntries: coverageTermsLoad.entries,
        dbWriteCount: 0,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[stage-c-final] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
