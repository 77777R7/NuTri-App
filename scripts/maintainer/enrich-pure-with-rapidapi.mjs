#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import {
  buildOverlayRecordKey,
  classifyOverlayStatus,
  deriveCompleteness,
  extractVariationText,
  extractOverlayRecordFromSeedRow,
  extractOverlayRecordFromZipRow,
  mergeOverlayRecords,
  normalizeLower,
  normalizeText,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
dotenv.config();
dotenv.config({ path: path.join(ROOT, "backend", ".env") });

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const SEED_JSON_PATH = getArg(
  "seed-json",
  "/Users/howard07/Downloads/pure_encapsulations_catalog_us_iherb_enriched.json",
);
const BRAND_SLUG = getArg("brand-slug", "pure-encapsulations");
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "pure_rapidapi_enriched"));
const RAPIDAPI_KEY =
  process.env.IHERB_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.X_RAPIDAPI_KEY ||
  process.env.RAPID_API_KEY ||
  getArg("rapidapi-key");

if (!RAPIDAPI_KEY) {
  throw new Error("Missing RapidAPI key. Set RAPIDAPI_KEY or pass --rapidapi-key.");
}

const API_HOST = "iherb-product-data-api.p.rapidapi.com";
const BRAND_PREFIX_RE = /^\s*pure encapsulations\s*,?\s*/i;

const nowIso = () => new Date().toISOString();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const stripBrandPrefix = (value) =>
  normalizeLower(value)
    .replace(BRAND_PREFIX_RE, "")
    .replace(/\bby pure encapsulations\b/g, "")
    .replace(/[™®]/g, "")
    .replace(/\bo\.n\.e\.?\b/g, "one")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalTitle = (value) =>
  stripBrandPrefix(value)
    .replace(/[(),/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalCoreTitle = (value) =>
  canonicalTitle(value)
    .replace(/\b\d+\s*(mg|mcg|g|iu|cfu|billion|million)\b/g, " ")
    .replace(
      /\b\d+\s*(capsules?|caps?|tablets?|softgels?|chewables?|gummies|count|packets?|sachets?|sticks?|servings?)\b/g,
      " ",
    )
    .replace(/\b(per|each)\s+[a-z0-9 ]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const alphaKey = (value) => canonicalCoreTitle(value).replace(/[^a-z0-9]/g, "");

const normalizeCount = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  const m = text.match(/(\d+)/);
  return m ? m[1] : text;
};

const normalizeDosageForm = (value) => {
  const text = stripBrandPrefix(extractVariationText(value) ?? value);
  if (!text) return null;
  if (text.includes("capsule")) return "capsules";
  if (text.includes("softgel")) return "softgels";
  if (text.includes("tablet")) return "tablets";
  if (text.includes("powder")) return "powder";
  if (text.includes("liquid")) return "liquid";
  return text;
};

const inferCountFromTitle = (value) => {
  const text = stripBrandPrefix(value);
  if (!text) return null;
  const m = text.match(/\b(\d+)\s*(capsules?|caps?|tablets?|softgels?|count|chewables?|gummies)\b/i);
  return m ? m[1] : null;
};

const inferFormFromTitle = (value) => {
  const text = stripBrandPrefix(value);
  if (!text) return null;
  if (/\bcapsules?\b/i.test(text)) return "capsules";
  if (/\bsoftgels?\b/i.test(text)) return "softgels";
  if (/\btablets?\b/i.test(text)) return "tablets";
  if (/\bpowder\b/i.test(text)) return "powder";
  if (/\bliquid\b/i.test(text)) return "liquid";
  return null;
};

const normalizeStrengthUnit = (unit) => {
  const normalized = normalizeLower(unit);
  if (!normalized) return null;
  if (normalized === "μg") return "mcg";
  return normalized;
};

const extractStrengthsFromTitle = (value) => {
  const text = normalizeText(value);
  if (!text) return [];
  const strengths = new Set();
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|μg|g|iu|cfu|billion|million)\b/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const amount = normalizeText(match[1]).replace(/,/g, "");
    const unit = normalizeStrengthUnit(match[2]);
    if (!amount || !unit) continue;
    strengths.add(`${amount}${unit}`);
  }
  return [...strengths].sort();
};

const buildStrengthKey = (value) => {
  const strengths = extractStrengthsFromTitle(value);
  return strengths.length > 0 ? strengths.join("|") : null;
};

const titleTokens = (value) =>
  canonicalCoreTitle(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 1);

const buildSeedTitleProfile = (seedRow, record) => {
  const titles = new Set([
    seedRow?.title,
    seedRow?.normalizedTitle,
    ...(Array.isArray(seedRow?.titleVariants) ? seedRow.titleVariants : []),
  ]);
  const title = [...titles].find(Boolean) ?? record?.title ?? null;
  const count = normalizeCount(seedRow?.count ?? seedRow?.packageQuantity ?? seedRow?.netContent) ??
    normalizeCount(record?.count) ??
    inferCountFromTitle(title);
  const dosageForm =
    normalizeDosageForm(seedRow?.dosageForm ?? seedRow?.variation) ??
    normalizeDosageForm(record?.dosageForm) ??
    inferFormFromTitle(title);
  return {
    title,
    canonicalTitle: canonicalTitle(title),
    canonicalCoreTitle: canonicalCoreTitle(title),
    alphaKey: alphaKey(title),
    tokens: titleTokens(title),
    count,
    dosageForm,
    strengthKey: buildStrengthKey(title),
  };
};

const buildApiTitleProfile = (apiRow, record) => {
  const title = apiRow?.title ?? record?.title ?? null;
  const count =
    normalizeCount(apiRow?.packageQuantity) ?? normalizeCount(record?.count) ?? inferCountFromTitle(title);
  const dosageForm =
    normalizeDosageForm(extractVariationText(apiRow?.variation) ?? apiRow?.variation) ??
    normalizeDosageForm(record?.dosageForm) ??
    inferFormFromTitle(title);
  return {
    title,
    canonicalTitle: canonicalTitle(title),
    canonicalCoreTitle: canonicalCoreTitle(title),
    alphaKey: alphaKey(title),
    tokens: titleTokens(title),
    count,
    dosageForm,
    strengthKey: buildStrengthKey(title),
  };
};

const buildStrongMatchKeys = (record) => {
  const keys = new Set();
  if (record.barcode_gtin14) keys.add(`gtin14:${record.barcode_gtin14}`);
  if (record.upcCode) keys.add(`upc:${record.upcCode.replace(/\D/g, "")}`);
  if (record.productId) keys.add(`product:${record.productId}`);
  return [...keys];
};

const buildSoftMatchKeys = (profile) => {
  const keys = new Set();
  const title = profile.canonicalTitle;
  const core = profile.canonicalCoreTitle;
  const alpha = profile.alphaKey;
  const count = profile.count;
  const dosageForm = profile.dosageForm;
  const strengthKey = profile.strengthKey;
  for (const normalized of [title, core]) {
    if (!normalized) continue;
    keys.add(`title:${normalized}`);
    if (count) keys.add(`title:${normalized}|count:${count}`);
    if (dosageForm) keys.add(`title:${normalized}|form:${dosageForm}`);
    if (count && dosageForm) keys.add(`title:${normalized}|count:${count}|form:${dosageForm}`);
    if (strengthKey) keys.add(`title:${normalized}|strength:${strengthKey}`);
    if (count && strengthKey) keys.add(`title:${normalized}|count:${count}|strength:${strengthKey}`);
  }
  if (alpha) {
    keys.add(`alpha:${alpha}`);
    if (count) keys.add(`alpha:${alpha}|count:${count}`);
    if (dosageForm) keys.add(`alpha:${alpha}|form:${dosageForm}`);
    if (count && dosageForm) keys.add(`alpha:${alpha}|count:${count}|form:${dosageForm}`);
    if (strengthKey) keys.add(`alpha:${alpha}|strength:${strengthKey}`);
  }
  return [...keys];
};

const buildSeedMatchKeys = (profile, record) => [
  ...buildStrongMatchKeys(record),
  ...buildSoftMatchKeys(profile),
];

const buildApiMatchKeys = (profile, record) => [
  ...buildStrongMatchKeys(record),
  ...buildSoftMatchKeys(profile),
];

const scoreCandidate = (apiProfile, entry) => {
  const seedProfile = entry.seedTitleProfile;
  let score = 0;
  if (apiProfile.canonicalTitle && apiProfile.canonicalTitle === seedProfile.canonicalTitle) score += 90;
  if (apiProfile.canonicalCoreTitle && apiProfile.canonicalCoreTitle === seedProfile.canonicalCoreTitle) score += 110;
  if (apiProfile.alphaKey && apiProfile.alphaKey === seedProfile.alphaKey) score += 70;
  const tokenSet = new Set(seedProfile.tokens);
  const overlap = apiProfile.tokens.filter((token) => tokenSet.has(token)).length;
  if (apiProfile.tokens.length > 0) {
    score += Math.round((overlap / apiProfile.tokens.length) * 40);
  }
  if (apiProfile.count && seedProfile.count) {
    score += apiProfile.count === seedProfile.count ? 18 : -18;
  }
  if (apiProfile.dosageForm && seedProfile.dosageForm) {
    score += apiProfile.dosageForm === seedProfile.dosageForm ? 8 : -8;
  }
  if (apiProfile.strengthKey && seedProfile.strengthKey) {
    score += apiProfile.strengthKey === seedProfile.strengthKey ? 35 : -45;
  }
  if (entry.matchedApiRows.length > 0 && !entry.mergedRecord?.barcode_gtin14 && !entry.mergedRecord?.productId) {
    score -= 35;
  }
  return score;
};

const isUsRescuableApiRecord = (record) =>
  Boolean(record?.sourceSummary?.hasUsIherbPage) && !Boolean(record?.sourceSummary?.npnIgnored);

const isHighReturnSeedCandidate = (entry) => {
  const row = entry?.seedRow ?? {};
  const status = row?.completeness?.status ?? classifyOverlayStatus(entry?.mergedRecord, deriveCompleteness(entry?.mergedRecord));
  if (status !== "partial_overlay") return false;
  if (row?.sourceSummary?.hasUsIherbPage) return false;
  if (row?.sourceSummary?.npnIgnored) return false;
  if (entry?.matchedApiRows?.length > 0) return false;
  const hasStableIdentity =
    Boolean(entry?.mergedRecord?.barcode_gtin14) || Boolean(entry?.mergedRecord?.productId) || Boolean(entry?.mergedRecord?.upcCode);
  const hasStrongSoftIdentity = Boolean(entry?.seedTitleProfile?.canonicalCoreTitle) && Boolean(entry?.seedTitleProfile?.count) && Boolean(entry?.seedTitleProfile?.dosageForm);
  return hasStableIdentity || hasStrongSoftIdentity;
};

const pickApiVariantForSeed = (entry, apiVariantEntries) => {
  const candidates = apiVariantEntries
    .filter((variant) => !variant.consumed && isUsRescuableApiRecord(variant.record))
    .map((variant) => ({ variant, score: scoreCandidate(variant.apiTitleProfile, entry) }))
    .filter((row) => row.score >= 135)
    .sort((left, right) => right.score - left.score);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < 12) return null;
  return candidates[0].variant;
};

const pickFuzzyEntry = (apiProfile, seedRows) => {
  const scored = seedRows
    .map((entry) => ({ entry, score: scoreCandidate(apiProfile, entry) }))
    .filter((row) => row.score >= 95)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 12) return null;
  return scored[0].entry;
};

const toOutputRow = (merged, seedRow = {}, extras = {}) => {
  const completeness = deriveCompleteness(merged);
  const status = classifyOverlayStatus(merged, completeness);
  return {
    ...(seedRow ?? {}),
    brandName: merged.brandName,
    title: merged.title,
    normalizedTitle: merged.normalizedTitle,
    productId: merged.productId,
    upcCode: merged.upcCode,
    barcode_gtin14: merged.barcode_gtin14,
    link: merged.link,
    sourceTypes: merged.sourceSummary?.sourceTypes ?? [],
    marketSources: merged.sourceSummary?.marketSources ?? [],
    sourceUrls: merged.sourceSummary?.sourceUrls ?? [],
    sourceNotes: merged.sourceSummary?.sourceNotes ?? [],
    productCatalogImage: merged.productCatalogImage,
    productImages: merged.productImages,
    categories: merged.categories,
    count: merged.count,
    dosageForm: merged.dosageForm,
    serving: merged.serving,
    supplementFacts: merged.supplementFacts,
    sections: merged.descriptionSections,
    allDescription: Object.entries(merged.descriptionSections ?? {})
      .map(([key, value]) => `${key}\n${value}`)
      .join("\n\n"),
    overlayRecordKey: buildOverlayRecordKey(merged),
    overlaySha256: stableHash({
      brandName: merged.brandName,
      title: merged.title,
      barcode_gtin14: merged.barcode_gtin14,
      productId: merged.productId,
      categories: merged.categories,
      supplementFacts: merged.supplementFacts,
      descriptionSections: merged.descriptionSections,
      sourceSummary: merged.sourceSummary,
    }),
    completeness: {
      ...completeness,
      status,
    },
    ...extras,
  };
};

const fetchBrandProducts = async (brandSlug, page) => {
  const url = `https://${API_HOST}/api/IHerb/brands/${brandSlug}/products?page=${page}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": API_HOST,
      "x-rapidapi-key": RAPIDAPI_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RapidAPI request failed (${res.status}) for page ${page}: ${body.slice(0, 500)}`);
  }
  return res.json();
};

const summarizeStatus = (products) => {
  const summary = {
    total: products.length,
    full_overlay_ready: 0,
    partial_overlay: 0,
    catalog_only: 0,
    conflicted_or_non_us: 0,
    hasUsIherb: 0,
  };
  for (const row of products) {
    const status = row?.completeness?.status ?? "catalog_only";
    if (summary[status] != null) summary[status] += 1;
    if (row?.sourceSummary?.hasUsIherbPage) summary.hasUsIherb += 1;
  }
  return summary;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const seed = await readJson(SEED_JSON_PATH);
  const seedProducts = Array.isArray(seed?.products) ? seed.products : [];

  const seedRows = [];
  const index = new Map();
  for (const seedRow of seedProducts) {
    const record = extractOverlayRecordFromSeedRow(seedRow, {
      seedName: path.basename(SEED_JSON_PATH),
    });
    const seedTitleProfile = buildSeedTitleProfile(seedRow, record);
    const entry = {
      key: buildOverlayRecordKey(record),
      seedRow,
      mergedRecord: record,
      matchedApiRows: [],
      seedTitleProfile,
    };
    seedRows.push(entry);
    for (const key of buildSeedMatchKeys(seedTitleProfile, record)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(entry);
    }
  }

  const pages = [];
  const page1 = await fetchBrandProducts(BRAND_SLUG, 1);
  pages.push(page1);
  const totalPages = Number(page1?.totalPages ?? 1);
  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(await fetchBrandProducts(BRAND_SLUG, page));
  }

  const apiProducts = pages.flatMap((page) => (Array.isArray(page?.products) ? page.products : []));
  const appendedApiEntries = [];
  const unmatchedApiProducts = [];

  for (const apiRow of apiProducts) {
    const record = extractOverlayRecordFromZipRow(apiRow, {
      entryName: `rapidapi:${BRAND_SLUG}`,
      marketSource: "US",
    });
    const apiTitleProfile = buildApiTitleProfile(apiRow, record);
    const strongMatches = new Set();
    for (const key of buildStrongMatchKeys(record)) {
      for (const entry of index.get(key) ?? []) strongMatches.add(entry);
    }
    const softMatches = new Set();
    for (const key of buildApiMatchKeys(apiTitleProfile, record)) {
      for (const entry of index.get(key) ?? []) softMatches.add(entry);
    }

    const mergeTargets =
      strongMatches.size > 0
        ? [...strongMatches]
        : (() => {
            const fuzzy = pickFuzzyEntry(apiTitleProfile, [...softMatches.size > 0 ? softMatches : seedRows]);
            return fuzzy ? [fuzzy] : [];
          })();

    const shouldAppend =
      mergeTargets.length === 0 ||
      mergeTargets.some(
        (entry) =>
          entry.matchedApiRows.length > 0 &&
          !entry.mergedRecord?.barcode_gtin14 &&
          !entry.mergedRecord?.productId &&
          !entry.mergedRecord?.upcCode,
      );

    if (shouldAppend) {
      appendedApiEntries.push({
        record,
        apiRow,
        apiTitleProfile,
        consumed: false,
        outputRow: toOutputRow(
          record,
          {},
          {
            rapidapiMatchCount: 1,
            rapidapiMatches: [
              {
                title: apiRow?.title ?? null,
                productId: normalizeText(apiRow?.productId) || null,
                upcCode: normalizeText(apiRow?.upcCode) || null,
              },
            ],
            rapidapiDerivedVariant: true,
          },
        ),
      });
      unmatchedApiProducts.push({
        title: apiRow?.title ?? null,
        productId: normalizeText(apiRow?.productId) || null,
        upcCode: normalizeText(apiRow?.upcCode) || null,
        link: normalizeText(apiRow?.link) || null,
      });
      continue;
    }
    for (const entry of mergeTargets) {
      entry.mergedRecord = mergeOverlayRecords(entry.mergedRecord, record);
      entry.matchedApiRows.push({
        title: apiRow?.title ?? null,
        productId: normalizeText(apiRow?.productId) || null,
        upcCode: normalizeText(apiRow?.upcCode) || null,
      });
    }
  }

  const rescueCandidates = seedRows.filter((entry) => isHighReturnSeedCandidate(entry));
  let secondPassRescuedSeedProducts = 0;
  let secondPassConsumedApiVariants = 0;
  for (const entry of rescueCandidates) {
    const variant = pickApiVariantForSeed(entry, appendedApiEntries);
    if (!variant) continue;
    entry.mergedRecord = mergeOverlayRecords(entry.mergedRecord, variant.record);
    entry.matchedApiRows.push({
      title: variant.apiRow?.title ?? null,
      productId: normalizeText(variant.apiRow?.productId) || null,
      upcCode: normalizeText(variant.apiRow?.upcCode) || null,
      rescuedFromApiVariant: true,
    });
    variant.consumed = true;
    secondPassRescuedSeedProducts += 1;
    secondPassConsumedApiVariants += 1;
  }

  const enrichedProducts = [
    ...seedRows.map((entry) =>
      toOutputRow(entry.mergedRecord, entry.seedRow, {
        rapidapiMatchCount: entry.matchedApiRows.length,
        rapidapiMatches: entry.matchedApiRows,
        }),
    ),
    ...appendedApiEntries.filter((entry) => !entry.consumed).map((entry) => entry.outputRow),
  ];

  const report = {
    generatedAt: nowIso(),
    seedPath: SEED_JSON_PATH,
    brandSlug: BRAND_SLUG,
    summary: {
      seedProducts: seedProducts.length,
      apiProducts: apiProducts.length,
      totalPages,
      matchedSeedProducts: enrichedProducts.filter((row) => row.rapidapiMatchCount > 0).length,
      unmatchedSeedProducts: enrichedProducts.filter((row) => row.rapidapiMatchCount === 0).length,
      appendedApiProducts: appendedApiEntries.filter((entry) => !entry.consumed).length,
      unmatchedApiProducts: unmatchedApiProducts.length,
      highReturnSeedCandidates: rescueCandidates.length,
      secondPassRescuedSeedProducts,
      secondPassConsumedApiVariants,
      sourceSummary: summarizeStatus(
        enrichedProducts.map((row) => ({
          completeness: row.completeness,
          sourceSummary: {
            hasUsIherbPage: Boolean(row?.sourceTypes?.includes?.("iherb_us_product_page")),
          },
        })),
      ),
    },
    unmatchedSeedProducts: enrichedProducts
      .filter((row) => row.rapidapiMatchCount === 0)
      .map((row) => ({
        title: row.title,
        productId: row.productId,
        barcode_gtin14: row.barcode_gtin14,
        sourceTypes: row.sourceTypes,
      })),
    unmatchedApiProducts,
  };

  await fs.writeFile(
    path.join(OUT_DIR, "pure_encapsulations_catalog_us_iherb_enriched.patched.json"),
    `${JSON.stringify(
      {
        brand: seed.brand ?? "Pure Encapsulations",
        generatedAt: nowIso(),
        mergeLog: seed.mergeLog ?? [],
        products: enrichedProducts,
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(path.join(OUT_DIR, "rapidapi_enrichment_report.json"), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        seedProducts: report.summary.seedProducts,
        apiProducts: report.summary.apiProducts,
        totalPages: report.summary.totalPages,
        matchedSeedProducts: report.summary.matchedSeedProducts,
        unmatchedSeedProducts: report.summary.unmatchedSeedProducts,
        unmatchedApiProducts: report.summary.unmatchedApiProducts,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
