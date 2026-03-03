#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from "node:crypto";
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

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => normalizeBrand(value).split(" ").filter(Boolean);

const jaccard = (a, b) => {
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

const LEGAL_TOKENS = new Set([
  "inc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "laboratories",
  "laboratory",
  "labs",
  "international",
  "holdings",
  "group",
  "pharma",
  "nutritionals",
]);

const FAMILY_TOKENS = [
  "vitamin",
  "mineral",
  "omega",
  "fish",
  "probiotic",
  "magnesium",
  "d3",
  "d2",
  "cfu",
  "dha",
  "epa",
  "gummy",
  "softgel",
  "tablet",
  "capsule",
];

const cleanTerm = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parsePlanSeeds = (plan) => {
  const rows = [];
  const us = Array.isArray(plan?.brand_priority_lists?.us?.brands) ? plan.brand_priority_lists.us.brands : [];
  const ca = Array.isArray(plan?.brand_priority_lists?.canada?.brands) ? plan.brand_priority_lists.canada.brands : [];
  for (const row of us) {
    const brand = String(row?.brand ?? "").trim();
    if (!brand) continue;
    rows.push({
      market: "US",
      brand,
      brandNorm: normalizeBrand(brand),
      rank: asNumber(row?.rank, 0),
    });
  }
  for (const row of ca) {
    const brand = String(row?.brand ?? "").trim();
    if (!brand) continue;
    rows.push({
      market: "CA",
      brand,
      brandNorm: normalizeBrand(brand),
      rank: asNumber(row?.rank, 0),
    });
  }
  return rows;
};

const classifyGap = ({ market, brand, seedsByNorm }) => {
  const raw = String(brand ?? "").trim();
  const norm = normalizeBrand(raw);
  const tokens = tokenize(raw);
  const legalCount = tokens.filter((token) => LEGAL_TOKENS.has(token)).length;

  if (legalCount > 0) return "legal_entity_variance";
  if (/[^a-zA-Z0-9\s]/.test(raw) || /\s{2,}/.test(raw) || /\b(one\s+a\s+day|one-a-day)\b/i.test(raw)) {
    return "punctuation_or_token_variance";
  }
  if (/\.com|shop|store|official|online/i.test(raw)) return "title_led_brand";

  const inOtherMarket = ["US", "CA"].some((candidateMarket) => {
    if (candidateMarket === market) return false;
    return seedsByNorm.has(`${candidateMarket}:${norm}`);
  });
  if (inOtherMarket) return "market_naming_variance";

  if (/natural|nutrition|pharma|labs|laboratories/i.test(raw)) return "distributor_or_house_brand_variance";

  return "other";
};

const buildTermsForSeed = ({ seed, aliasMappings, queueRows, minTermLength }) => {
  const terms = [];
  const seen = new Set();
  const add = (termRaw, origin, confidenceBucket = "medium") => {
    const term = cleanTerm(termRaw);
    if (!term || term.length < minTermLength) return;
    if (seen.has(term)) return;
    seen.add(term);
    terms.push({ term, origin, confidenceBucket });
  };

  add(seed.brand, "canonical", "high");
  add(seed.brandNorm, "canonical_norm", "high");
  add(seed.brandNorm.replace(/\s+/g, ""), "canonical_compact", "medium");

  const seedTokens = tokenize(seed.brand);
  const legalStripped = seedTokens.filter((token) => !LEGAL_TOKENS.has(token)).join(" ");
  if (legalStripped && legalStripped !== seed.brandNorm) {
    add(legalStripped, "legal_suffix_stripped", "medium");
  }

  if (seedTokens.length >= 3) {
    add(seedTokens.slice(0, 2).join(" "), "leading_bigram", "medium");
  }

  for (const mapping of aliasMappings) {
    const aliasMarket = String(mapping?.market ?? "").toUpperCase();
    const canonicalNorm = normalizeBrand(mapping?.canonicalBrandNorm ?? mapping?.canonicalBrand);
    if (!canonicalNorm || canonicalNorm !== seed.brandNorm) continue;
    if (aliasMarket && aliasMarket !== "*" && aliasMarket !== seed.market) continue;
    add(mapping?.aliasNorm ?? mapping?.alias, "alias_map", "high");
  }

  for (const row of queueRows) {
    const market = String(row?.market ?? "").toUpperCase();
    if (market && market !== seed.market) continue;
    const brand = String(row?.brand ?? "").trim();
    if (!brand) continue;
    const similarity = jaccard(seed.brandNorm, normalizeBrand(brand));
    if (similarity < 0.45) continue;
    const confidenceBucket = similarity >= 0.75 ? "medium" : "review";
    add(brand, "queue_suggested", confidenceBucket);
  }

  return terms;
};

const stableStringify = (value) => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => typeof key === "string")
      .sort(([a], [b]) => a.localeCompare(b));
    const parts = entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${parts.join(",")}}`;
  }
  return "null";
};

const main = async () => {
  const planPath =
    resolvePath(getArg("plan-json"))
    ?? "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json";
  const scopeSummaryPath = resolvePath(getArg("scope-summary-json"));
  const aliasMapPath = resolvePath(getArg("brand-alias-map-json"));
  const aliasQueuePath = resolvePath(getArg("alias-queue-jsonl"));
  const minTermLength = Math.max(2, asNumber(getArg("min-term-length"), 3));
  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "coverage");

  const plan = await readJson(planPath);
  const seeds = parsePlanSeeds(plan);
  if (seeds.length === 0) {
    console.error("[build-brand-coverage-terms] no seeds found in plan");
    process.exit(1);
  }

  const scopeSummaryPayload = scopeSummaryPath ? await readJson(scopeSummaryPath).catch(() => null) : null;
  const scopeSummaryRows = Array.isArray(scopeSummaryPayload)
    ? scopeSummaryPayload
    : Array.isArray(scopeSummaryPayload?.rows)
      ? scopeSummaryPayload.rows
      : [];

  const aliasMapPayload = aliasMapPath ? await readJson(aliasMapPath).catch(() => null) : null;
  const aliasMappings = Array.isArray(aliasMapPayload?.mappings) ? aliasMapPayload.mappings : [];
  const aliasQueueRows = aliasQueuePath ? await readJsonl(aliasQueuePath) : [];

  const seedsByNorm = new Map();
  for (const seed of seeds) seedsByNorm.set(`${seed.market}:${seed.brandNorm}`, seed);

  const unmatchedSet = new Set();
  for (const seed of seeds) {
    const matched = scopeSummaryRows.find((row) => {
      const market = String(row?.market ?? "").toUpperCase();
      const brandNorm = normalizeBrand(row?.brand);
      return market === seed.market && brandNorm === seed.brandNorm && asNumber(row?.product_count, 0) > 0;
    });
    if (!matched) unmatchedSet.add(`${seed.market}:${seed.brandNorm}`);
  }

  const diagnosisRows = aliasQueueRows.map((row) => {
    const market = String(row?.market ?? "").toUpperCase() || "US";
    const brand = String(row?.brand ?? "").trim();
    const brandNorm = normalizeBrand(brand);
    return {
      market,
      brand,
      brandNorm,
      issueType: classifyGap({ market, brand, seedsByNorm }),
      owner: row?.owner ?? "data-lane-ops",
      status: row?.status ?? "open",
      reasonCode: row?.reasonCode ?? "brand_normalization_miss",
      eta: row?.eta ?? "next_cycle",
    };
  });

  const mappings = seeds.map((seed) => {
    const terms = buildTermsForSeed({
      seed,
      aliasMappings,
      queueRows: diagnosisRows,
      minTermLength,
    });
    const seedTokens = tokenize(seed.brand);
    const familyTokens = FAMILY_TOKENS.filter((token) => seedTokens.includes(token));
    return {
      market: seed.market,
      seedBrand: seed.brand,
      seedBrandNorm: seed.brandNorm,
      unmatchedInCurrentScope: unmatchedSet.has(`${seed.market}:${seed.brandNorm}`),
      terms,
      secondarySignals: {
        seedBrandTokens: seedTokens,
        familyTokens,
      },
    };
  });

  const index = {};
  for (const row of mappings) {
    index[`${row.market}:${row.seedBrandNorm}`] = {
      seedBrand: row.seedBrand,
      terms: row.terms.map((item) => item.term),
      termMetadata: row.terms,
      secondarySignals: row.secondarySignals,
    };
  }

  const coverageTermsMap = {
    schemaVersion: "v1.6.14-e-plus-coverage-terms-1",
    generatedAt: new Date().toISOString(),
    inputs: {
      planPath,
      scopeSummaryPath: scopeSummaryPath ?? null,
      aliasMapPath: aliasMapPath ?? null,
      aliasQueuePath: aliasQueuePath ?? null,
    },
    mappings,
    index,
    diagnostics: {
      totalSeeds: seeds.length,
      unmatchedSeedsInScope: unmatchedSet.size,
      diagnosisRows,
      diagnosisCounts: diagnosisRows.reduce((acc, row) => {
        acc[row.issueType] = (acc[row.issueType] || 0) + 1;
        return acc;
      }, {}),
    },
  };

  const canonical = stableStringify(coverageTermsMap);
  const digest = crypto.createHash("sha256").update(canonical).digest("hex");

  await writeJson(path.join(outDir, "brand_coverage_terms_map.json"), coverageTermsMap);
  await writeText(path.join(outDir, "brand_coverage_terms_map.sha256"), `${digest}  brand_coverage_terms_map.json\n`);
  await writeJson(path.join(outDir, "brand_coverage_gap_diagnosis.json"), {
    generatedAt: coverageTermsMap.generatedAt,
    rows: diagnosisRows,
    counts: coverageTermsMap.diagnostics.diagnosisCounts,
  });

  console.log("[build-brand-coverage-terms] completed");
  console.log(
    JSON.stringify(
      {
        outDir,
        totalSeeds: seeds.length,
        unmatchedSeedsInScope: unmatchedSet.size,
        diagnosisRows: diagnosisRows.length,
        hash: digest,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-brand-coverage-terms] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
