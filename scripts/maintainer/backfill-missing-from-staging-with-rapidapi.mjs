#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractVariationText,
  extractOverlayRecordFromZipRow,
  mergeOverlayRecords,
  normalizeLower,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
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

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_kpi_wave_solgar_20260313", "staging_products.official_refreshed.json"),
);
const MISSING_WAVE_PATH = getArg(
  "missing-wave-json",
  path.join(ROOT, "output", "iherb_overlay_wave_pack_20260313", "missing_from_staging_wave.json"),
);
const BRAND_MAP_PATH = getArg(
  "brand-map-json",
  path.join(ROOT, "data", "iherb_rapidapi_brand_map.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_missing_from_staging_rapidapi_wave"));
const RAPIDAPI_KEY =
  process.env.IHERB_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.X_RAPIDAPI_KEY ||
  process.env.RAPID_API_KEY ||
  getArg("rapidapi-key");
const DELAY_MS = Number(getArg("delay-ms", 500)) || 0;
const ALLOW_FUZZY_MATCH = args.includes("--allow-fuzzy-match");
const TARGET_BRANDS = (getArg("brands", "Healthy Origins,Schiff,Natrol,Centrum"))
  .split(",")
  .map((item) => normalizeText(item))
  .filter(Boolean);

if (!RAPIDAPI_KEY) {
  throw new Error("Missing RapidAPI key. Set RAPIDAPI_KEY or pass --rapidapi-key.");
}

const API_HOST = "iherb-product-data-api.p.rapidapi.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const normalizeBarcode = (value) => toGtin14(value) ?? normalizeText(value) ?? null;

const stripBrandPrefix = (title, brandName) =>
  normalizeLower(title)
    .replace(new RegExp(`^\\s*${String(brandName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*`, "i"), "")
    .replace(/[™®']/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalTitle = (title, brandName) =>
  stripBrandPrefix(title, brandName)
    .replace(/[(),/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalCoreTitle = (title, brandName) =>
  canonicalTitle(title, brandName)
    .replace(/\b\d+\s*(mg|mcg|μg|g|iu|cfu|billion|million)\b/g, " ")
    .replace(
      /\b\d+\s*(capsules?|caps?|tablets?|softgels?|chewables?|gummies|count|packets?|sachets?|sticks?|servings?)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const alphaKey = (title, brandName) => canonicalCoreTitle(title, brandName).replace(/[^a-z0-9]/g, "");

const normalizeCount = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/(\d+)/);
  return match ? match[1] : text;
};

const inferCountFromTitle = (title, brandName) => {
  const text = stripBrandPrefix(title, brandName);
  if (!text) return null;
  const match = text.match(/\b(\d+)\s*(capsules?|caps?|tablets?|softgels?|count|chewables?|gummies)\b/i);
  return match ? match[1] : null;
};

const normalizeDosageForm = (value) => {
  const text = normalizeLower(extractVariationText(value) ?? value);
  if (!text) return null;
  if (text.includes("softgel")) return "softgels";
  if (text.includes("capsule") || text.includes("caps")) return "capsules";
  if (text.includes("tablet") || text.includes("tabs")) return "tablets";
  if (text.includes("powder")) return "powder";
  if (text.includes("liquid")) return "liquid";
  if (text.includes("gummy")) return "gummies";
  if (text.includes("chewable")) return "chewables";
  return normalizeText(value) || null;
};

const inferFormFromTitle = (title, brandName) => {
  const text = stripBrandPrefix(title, brandName);
  if (!text) return null;
  if (/\bcapsules?\b/i.test(text)) return "capsules";
  if (/\bsoftgels?\b/i.test(text)) return "softgels";
  if (/\btablets?\b/i.test(text)) return "tablets";
  if (/\bpowder\b/i.test(text)) return "powder";
  if (/\bliquid\b/i.test(text)) return "liquid";
  if (/\bgummies?\b/i.test(text)) return "gummies";
  if (/\bchewables?\b/i.test(text)) return "chewables";
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

const titleTokens = (title, brandName) =>
  canonicalCoreTitle(title, brandName)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);

const buildCandidateProfile = (row) => ({
  title: row.productName,
  brandName: row.brandName,
  barcode_gtin14: normalizeBarcode(row.barcode_gtin14),
  canonicalTitle: canonicalTitle(row.productName, row.brandName),
  canonicalCoreTitle: canonicalCoreTitle(row.productName, row.brandName),
  alphaKey: alphaKey(row.productName, row.brandName),
  tokens: titleTokens(row.productName, row.brandName),
  count: inferCountFromTitle(row.productName, row.brandName),
  dosageForm: inferFormFromTitle(row.productName, row.brandName),
  strengthKey: buildStrengthKey(row.productName),
});

const buildApiProfile = (apiRow) => ({
  title: apiRow.title,
  brandName: apiRow.brandName,
  barcode_gtin14: normalizeBarcode(apiRow.barcode_gtin14 ?? apiRow.upcCode),
  canonicalTitle: canonicalTitle(apiRow.title, apiRow.brandName),
  canonicalCoreTitle: canonicalCoreTitle(apiRow.title, apiRow.brandName),
  alphaKey: alphaKey(apiRow.title, apiRow.brandName),
  tokens: titleTokens(apiRow.title, apiRow.brandName),
  count: normalizeCount(apiRow.packageQuantity) ?? inferCountFromTitle(apiRow.title, apiRow.brandName),
  dosageForm:
    normalizeDosageForm(extractVariationText(apiRow.variation) ?? apiRow.variation) ??
    inferFormFromTitle(apiRow.title, apiRow.brandName),
  strengthKey: buildStrengthKey(apiRow.title),
});

const scoreCandidate = (candidateProfile, apiProfile) => {
  let score = 0;
  if (candidateProfile.barcode_gtin14 && apiProfile.barcode_gtin14 && candidateProfile.barcode_gtin14 === apiProfile.barcode_gtin14) {
    score += 1000;
  }
  if (candidateProfile.canonicalTitle && candidateProfile.canonicalTitle === apiProfile.canonicalTitle) score += 100;
  if (candidateProfile.canonicalCoreTitle && candidateProfile.canonicalCoreTitle === apiProfile.canonicalCoreTitle) score += 120;
  if (candidateProfile.alphaKey && candidateProfile.alphaKey === apiProfile.alphaKey) score += 70;
  const tokenSet = new Set(candidateProfile.tokens);
  const overlap = apiProfile.tokens.filter((token) => tokenSet.has(token)).length;
  if (apiProfile.tokens.length > 0) score += Math.round((overlap / apiProfile.tokens.length) * 40);
  if (candidateProfile.count && apiProfile.count) score += candidateProfile.count === apiProfile.count ? 18 : -18;
  if (candidateProfile.dosageForm && apiProfile.dosageForm) {
    score += candidateProfile.dosageForm === apiProfile.dosageForm ? 8 : -8;
  }
  if (candidateProfile.strengthKey && apiProfile.strengthKey) {
    score += candidateProfile.strengthKey === apiProfile.strengthKey ? 35 : -45;
  }
  return score;
};

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);
  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: stableHash({
      brandName: mergedRecord.brandName,
      title: mergedRecord.title,
      barcode_gtin14: mergedRecord.barcode_gtin14,
      supplementFacts: mergedRecord.supplementFacts,
      descriptionSections: mergedRecord.descriptionSections,
      sourceSummary: mergedRecord.sourceSummary,
    }),
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
    throw new Error(`RapidAPI request failed (${res.status}) for ${brandSlug} page ${page}: ${body.slice(0, 500)}`);
  }
  return res.json();
};

const fetchAllBrandProducts = async (brandSlug) => {
  const page1 = await fetchBrandProducts(brandSlug, 1);
  const pages = [page1];
  const totalPages = Number(page1?.totalPages ?? 1);
  for (let page = 2; page <= totalPages; page += 1) {
    if (DELAY_MS > 0) await sleep(DELAY_MS);
    pages.push(await fetchBrandProducts(brandSlug, page));
  }
  return {
    totalPages,
    products: pages.flatMap((page) => (Array.isArray(page?.products) ? page.products : [])),
  };
};

const buildMarkdownReport = (report) => {
  const lines = [
    "# Missing From Staging RapidAPI Wave",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- missingWavePath: ${report.inputs.missingWavePath}`,
    `- brandMapPath: ${report.inputs.brandMapPath}`,
    `- allowFuzzyMatch: ${report.inputs.allowFuzzyMatch}`,
    "",
    "## Summary",
    "",
    `- requested_candidates: ${report.summary.requestedCandidates}`,
    `- matched_candidates: ${report.summary.matchedCandidates}`,
    `- unmatched_candidates: ${report.summary.unmatchedCandidates}`,
    `- appended_rows: ${report.summary.appendedRows}`,
    `- merged_existing_rows: ${report.summary.mergedExistingRows}`,
    `- blocked_brands: ${report.summary.blockedBrands}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of report.brandResults) {
    lines.push(
      `- ${brand.brandName}: status=${brand.status}, candidates=${brand.requestedCandidates}, matched=${brand.matchedCandidates}, unmatched=${brand.unmatchedCandidates}, api_products=${brand.apiProducts}, total_pages=${brand.totalPages}`,
    );
    if (brand.note) lines.push(`  - note: ${brand.note}`);
  }

  if (report.unmatchedCandidates.length > 0) {
    lines.push("", "## Unmatched Candidates", "");
    for (const row of report.unmatchedCandidates.slice(0, 80)) {
      lines.push(`- ${row.brandName} | ${row.productName} | ${row.barcode_gtin14 || "n/a"} | reason=${row.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [stagingPayload, missingWaveRows, brandMapPayload] = await Promise.all([
    readJson(STAGING_PATH),
    readJson(MISSING_WAVE_PATH),
    readJson(BRAND_MAP_PATH),
  ]);

  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const missingRows = (Array.isArray(missingWaveRows) ? missingWaveRows : []).filter((row) =>
    TARGET_BRANDS.some((brand) => normalizeLower(brand) === normalizeLower(row.brandName)),
  );
  const brandMap = new Map(
    (Array.isArray(brandMapPayload?.brands) ? brandMapPayload.brands : []).map((row) => [normalizeLower(row.brandName), row]),
  );

  const refreshedRows = [...stagingRows];
  const stagingIndexByBarcode = new Map();
  const stagingIndexByProductId = new Map();
  const stagingIndexByOverlayKey = new Map();
  refreshedRows.forEach((row, index) => {
    const barcode = normalizeBarcode(row.barcode_gtin14);
    const productId = normalizeText(row.productId);
    const overlayKey = normalizeText(row.overlayRecordKey || buildOverlayRecordKey(row));
    if (barcode) stagingIndexByBarcode.set(barcode, index);
    if (productId) stagingIndexByProductId.set(productId, index);
    if (overlayKey) stagingIndexByOverlayKey.set(overlayKey, index);
  });

  const brandResults = [];
  const matchedSeedProducts = [];
  const unmatchedCandidates = [];
  let appendedRows = 0;
  let mergedExistingRows = 0;

  const groupedCandidates = TARGET_BRANDS.map((brandName) => ({
    brandName,
    rows: missingRows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName)),
  })).filter((group) => group.rows.length > 0);

  for (const group of groupedCandidates) {
    const brandEntry = brandMap.get(normalizeLower(group.brandName)) ?? null;
    if (!brandEntry || brandEntry.status !== "available" || !brandEntry.brandSlug) {
      brandResults.push({
        brandName: group.brandName,
        brandSlug: brandEntry?.brandSlug ?? null,
        status: "blocked",
        note: brandEntry?.note ?? "No usable RapidAPI brand slug is configured.",
        requestedCandidates: group.rows.length,
        matchedCandidates: 0,
        unmatchedCandidates: group.rows.length,
        apiProducts: 0,
        totalPages: 0,
      });
      unmatchedCandidates.push(
        ...group.rows.map((row) => ({
          ...row,
          reason: brandEntry?.note ?? "rapidapi_brand_unavailable",
        })),
      );
      continue;
    }

    console.error(`[missing-wave-rapidapi] fetching ${group.brandName} via ${brandEntry.brandSlug}`);
    const { products: apiProducts, totalPages } = await fetchAllBrandProducts(brandEntry.brandSlug);
    const apiProfiles = apiProducts.map((apiRow) => ({
      apiRow,
      apiProfile: buildApiProfile(apiRow),
      record: extractOverlayRecordFromZipRow(apiRow, {
        entryName: `rapidapi:${brandEntry.brandSlug}`,
        marketSource: "US",
      }),
    }));
    const apiByBarcode = new Map();
    for (const item of apiProfiles) {
      if (item.apiProfile.barcode_gtin14) apiByBarcode.set(item.apiProfile.barcode_gtin14, item);
    }

    let matchedForBrand = 0;
    for (const row of group.rows) {
      const candidateProfile = buildCandidateProfile(row);
      let matched = candidateProfile.barcode_gtin14 ? apiByBarcode.get(candidateProfile.barcode_gtin14) ?? null : null;

      if (!matched && ALLOW_FUZZY_MATCH) {
        const ranked = apiProfiles
          .map((item) => ({ item, score: scoreCandidate(candidateProfile, item.apiProfile) }))
          .filter((item) => item.score >= 120)
          .sort((left, right) => right.score - left.score);
        if (ranked.length > 0) matched = ranked[0].item;
      }

      if (!matched) {
        unmatchedCandidates.push({
          ...row,
          reason: "rapidapi_no_match",
        });
        continue;
      }

      const barcode = normalizeBarcode(matched.record.barcode_gtin14);
      const productId = normalizeText(matched.record.productId);
      const overlayKey = normalizeText(buildOverlayRecordKey(matched.record));
      const existingIndex =
        (barcode ? stagingIndexByBarcode.get(barcode) : null) ??
        (productId ? stagingIndexByProductId.get(productId) : null) ??
        (overlayKey ? stagingIndexByOverlayKey.get(overlayKey) : null) ??
        null;

      if (existingIndex != null) {
        refreshedRows[existingIndex] = hydrateMergedRow(
          refreshedRows[existingIndex],
          mergeOverlayRecords(refreshedRows[existingIndex], matched.record),
        );
        mergedExistingRows += 1;
      } else {
        const hydrated = hydrateMergedRow({}, matched.record);
        refreshedRows.push(hydrated);
        const newIndex = refreshedRows.length - 1;
        if (barcode) stagingIndexByBarcode.set(barcode, newIndex);
        if (productId) stagingIndexByProductId.set(productId, newIndex);
        if (overlayKey) stagingIndexByOverlayKey.set(overlayKey, newIndex);
        appendedRows += 1;
      }

      matchedForBrand += 1;
      matchedSeedProducts.push({
        brandName: row.brandName,
        productName: row.productName,
        barcode_gtin14: row.barcode_gtin14,
        matchedProductId: productId || null,
        matchedTitle: matched.apiRow.title,
      });
    }

    brandResults.push({
      brandName: group.brandName,
      brandSlug: brandEntry.brandSlug,
      status: "completed",
      note: null,
      requestedCandidates: group.rows.length,
      matchedCandidates: matchedForBrand,
      unmatchedCandidates: group.rows.length - matchedForBrand,
      apiProducts: apiProducts.length,
      totalPages,
    });
  }

  const report = {
    schemaVersion: "iherb_missing_from_staging_rapidapi_wave.v1",
    generatedAt: nowIso(),
    inputs: {
      stagingPath: STAGING_PATH,
      missingWavePath: MISSING_WAVE_PATH,
      brandMapPath: BRAND_MAP_PATH,
      allowFuzzyMatch: ALLOW_FUZZY_MATCH,
    },
    summary: {
      requestedCandidates: missingRows.length,
      matchedCandidates: matchedSeedProducts.length,
      unmatchedCandidates: unmatchedCandidates.length,
      appendedRows,
      mergedExistingRows,
      blockedBrands: brandResults.filter((row) => row.status === "blocked").length,
    },
    brandResults,
    matchedSeedProducts,
    unmatchedCandidates,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.rapidapi_missing_wave.json");
  const matchedOut = path.join(OUT_DIR, "matched_missing_candidates.json");
  const reportJsonOut = path.join(OUT_DIR, "rapidapi_missing_wave_report.json");
  const reportMdOut = path.join(OUT_DIR, "rapidapi_missing_wave_report.md");

  await fs.writeFile(stagingOut, `${JSON.stringify({ products: refreshedRows }, null, 2)}\n`, "utf8");
  await fs.writeFile(matchedOut, `${JSON.stringify(matchedSeedProducts, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdOut, buildMarkdownReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          staging: stagingOut,
          matched: matchedOut,
          reportJson: reportJsonOut,
          reportMd: reportMdOut,
        },
        summary: report.summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
