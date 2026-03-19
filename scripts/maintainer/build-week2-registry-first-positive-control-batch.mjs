#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { compileDecisionSupport } from "../../backend/src/decisionSupport.ts";
import { buildFactsDigestFromWeb, computeFactsDigestHash } from "../../backend/src/factsDigest.ts";
import { normalizeIherbSupplementFactsRows } from "../../backend/src/iherbOverlayIngredients.ts";
import { buildQualityMarkLookupKey } from "../../backend/src/qualityMarks/cache.ts";
import { compactQualityMarkText, normalizeQualityMarkText } from "../../backend/src/qualityMarks/matchers.ts";
import { getQualityMarkProgramDefinition } from "../../backend/src/qualityMarks/programs.ts";
import {
  buildQualityMarkSourceCandidates,
  fetchQualityMarkSource,
} from "../../backend/src/qualityMarks/provider.ts";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const SEED_SELECTION_PATH = getArg(
  "seed-selection",
  path.join(ROOT, "output", "quality_marks", "week2_iherb_refresh_ifos_expanded_20260315", "week2_iherb_quality_mark_selection.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `week2_iherb_registry_first_positive_controls_${TODAY}`),
);
const SELECTION_JSON = getArg("selection-json", path.join(OUT_DIR, "week2_registry_first_positive_control_selection.json"));
const SELECTION_MD = getArg("selection-md", path.join(OUT_DIR, "week2_registry_first_positive_control_selection.md"));
const BRANDS_PER_PROGRAM = Math.max(1, Number(getArg("brands-per-program", "6")) || 6);
const MATCHES_PER_PROGRAM = Math.max(1, Number(getArg("matches-per-program", "12")) || 12);
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", "4")) || 4);
const NSF_FALLBACK_BRANDS = Math.max(0, Number(getArg("nsf-fallback-brands", "8")) || 8);
const IFOS_FALLBACK_BRANDS = Math.max(0, Number(getArg("ifos-fallback-brands", "4")) || 4);
const NSF_PREFERRED_FALLBACK_BRANDS = [
  "Sports Research",
  "Thorne",
  "Garden of Life",
  "Sun Chlorella",
  "C4 / Cellucor",
  "Optimum Nutrition",
  "Podium Nutrition",
  "Ghost",
  "Bucked Up",
  "Kaged",
  "NOW Foods",
  "Sunwarrior",
  "EFX Sports",
];
const IFOS_PREFERRED_FALLBACK_BRANDS = [
  "Sports Research",
  "Natural Factors",
  "Metagenics",
  "Nordic Naturals",
  "Garden of Life",
];

const PROGRAMS = [
  "nsf_certified_for_sport",
  "informed_choice",
  "informed_sport",
  "ifos",
];

const PROGRAM_SOURCE_FILTERS = {
  nsf_certified_for_sport: new Set(["nsf_search"]),
  informed_choice: new Set(["informed_choice_search"]),
  informed_sport: new Set(["informed_sport_search"]),
  ifos: new Set(["nutrasource_brand_search"]),
};

const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const nowIso = () => new Date().toISOString();
const OMEGA_KEYWORD_REGEX = /\b(omega|fish oil|dha|epa|cod liver|krill|algae omega|algal oil)\b/i;
const compactBrand = (value) => compactQualityMarkText(String(value ?? ""));

const toObjectRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const readSectionText = (sections, keys) => {
  for (const key of keys) {
    const value = sections[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

const readJson = async (targetPath, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
};

const toOverlayClaims = (row) => {
  const descriptionSections = toObjectRecord(row.descriptionSections);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];

  return {
    provider: "iherb",
    productId: hasText(row.productId) ? String(row.productId) : null,
    brandName: hasText(row.brandName) ? String(row.brandName) : null,
    title: hasText(row.title) ? String(row.title) : null,
    link: hasText(row.link) ? String(row.link) : null,
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => safeText(item)).filter(Boolean)
      : [],
    description: readSectionText(descriptionSections, ["Description"]),
    suggestedUse: readSectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readSectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readSectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readSectionText(descriptionSections, ["Disclaimer"]),
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: safeText(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name),
        amountPerServing: safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount),
        dailyValuePercent: safeText(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const toIngredientsText = (overlayClaims) =>
  normalizeIherbSupplementFactsRows(overlayClaims?.nutritionalFacts)
    .map((row) => [safeText(row?.name), safeText(row?.dose)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");

const toFactsDigest = (row, overlayClaims) => {
  const serving = toObjectRecord(row.serving);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: hasText(row.title) ? String(row.title) : null,
        brand: hasText(row.brandName) ? String(row.brandName) : null,
        url: hasText(row.link) ? String(row.link) : null,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: toIngredientsText(overlayClaims) || null,
        directionsText: overlayClaims?.suggestedUse ?? null,
        warningsText: overlayClaims?.warnings ?? null,
        servingSizeText:
          safeText(supplementFacts.servingSize) ||
          safeText(serving.servingSize) ||
          null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.dosageForm =
    safeText(row.dosageForm) && safeText(row.dosageForm).toLowerCase() !== "n/a"
      ? safeText(row.dosageForm)
      : digest.product.dosageForm;
  digest.product.route = null;
  return digest;
};

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    }),
  );

const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const selectOfficialSourcesForProgram = (sources, programId) => {
  const allowedAdapters = PROGRAM_SOURCE_FILTERS[programId] ?? null;
  if (!allowedAdapters) {
    return sources.filter((source) => source.sourceType === "official_registry");
  }
  return sources.filter((source) =>
    source.sourceType === "official_registry" &&
    source.programId === programId &&
    (!source.adapterKind || allowedAdapters.has(source.adapterKind))
  );
};

const sanitizeHtml = (html) =>
  String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const stripBrandPrefix = (productName, brandName) => {
  const normalizedProduct = normalizeQualityMarkText(productName);
  const normalizedBrand = normalizeQualityMarkText(brandName);
  if (!normalizedProduct || !normalizedBrand) return normalizedProduct;
  if (!normalizedProduct.startsWith(normalizedBrand)) return normalizedProduct;
  return normalizedProduct.slice(normalizedBrand.length).trim();
};

const tokenize = (value) =>
  normalizeQualityMarkText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const computeCoverage = (needle, haystack) => {
  const needleTokens = Array.from(new Set(tokenize(needle)));
  if (needleTokens.length === 0) return 0;
  const haystackTokens = new Set(tokenize(haystack));
  let matched = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) matched += 1;
  }
  return matched / needleTokens.length;
};

const phraseIncluded = (longText, shortText) => {
  const normalizedLong = ` ${normalizeQualityMarkText(longText)} `;
  const normalizedShort = normalizeQualityMarkText(shortText);
  if (!normalizedShort || normalizedShort.length < 5) return false;
  return normalizedLong.includes(` ${normalizedShort} `);
};

const parseNsfRegistryResults = (body, fallbackBrandName) => {
  const matches = [];
  const regex = /<li[^>]*class="[^"]*listng-results__item[^"]*"[\s\S]*?<\/li>/gi;
  for (const match of body.matchAll(regex)) {
    const itemHtml = match[0];
    const href = itemHtml.match(/<a[^>]+href="([^"]+)"/i)?.[1] ?? null;
    const productHtml = itemHtml.match(/results__product-name">([\s\S]*?)<\/p>/i)?.[1] ?? null;
    const companyHtml = itemHtml.match(/results__company-name">([\s\S]*?)<\/p>/i)?.[1] ?? null;
    const productName = sanitizeHtml(productHtml);
    const brandName = sanitizeHtml(companyHtml || fallbackBrandName).replace(/\s*®\s*$/i, "").trim();
    if (!href || href === "#" || productName.length < 4 || !brandName) continue;
    matches.push({
      evidenceUrl: href.startsWith("http") ? href : `https://nsfsport-prod.nsf.org${href}`,
      productName,
      brandName,
    });
  }
  return matches;
};

const parseInformedRegistryResults = (body, queryBrandName, baseOrigin) => {
  const matches = Array.from(
    body.matchAll(/<div[^>]*\bviews-row\b[\s\S]*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*anchor-color-black[^"]*"[\s\S]*?<\/a>/gi),
  );

  return matches
    .map((match) => ({
      href: match[1],
      text: sanitizeHtml(match[0]),
    }))
    .map(({ href, text }) => {
      const cutAt = text.search(/\bTYPE\s*:/i);
      const productName = (cutAt >= 0 ? text.slice(0, cutAt) : text).trim();
      return {
        evidenceUrl: href.startsWith("http")
          ? href
          : `${baseOrigin}${href}`,
        productName,
        brandName: queryBrandName,
      };
    })
    .filter((item) => item.productName.length >= 6);
};

const parseIfosBrandResults = (body) => {
  const parsed = JSON.parse(body);
  const html = String(parsed?.html ?? "");
  return Array.from(
    html.matchAll(/href="\/certified-products\/brand\?id=([^"]+)"[\s\S]*?<img[^>]+alt="([^"]+)"/gi),
  ).map((match) => ({
    brandId: match[1],
    brandName: match[2],
  }));
};

const parseIfosBrandPageProducts = (body, fallbackBrandName) =>
  Array.from(
    body.matchAll(/<h3 class="results__brand[\s\S]*?<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi),
  )
    .map((match) => ({
      evidenceUrl: match[1].startsWith("http")
        ? match[1]
        : `https://certifications.nutrasource.ca${match[1]}`,
      productName: sanitizeHtml(match[2]),
    }))
    .filter((item) => item.productName.length >= 6)
    .map((item) => ({
      evidenceUrl: item.evidenceUrl,
      productName: item.productName,
      brandName: fallbackBrandName,
    }));

const toRegistryQueryBrandName = (programId, brandName) => {
  const raw = String(brandName ?? "");
  if (programId === "nsf_certified_for_sport" && /\bcellucor\b/i.test(raw)) return "Cellucor";
  return brandName;
};

const fetchRegistryEntriesForBrand = async ({ programId, brandName, queryBrandName = brandName, seedKind = "primary" }) => {
  const sources = selectOfficialSourcesForProgram(
    buildQualityMarkSourceCandidates({
      identityType: "gtin14",
      identityValue: null,
      sourceType: "web",
      brandName: queryBrandName,
      productName: null,
    }),
    programId,
  );

  if (programId === "ifos") {
    const brandSearchSource = sources[0] ?? null;
    if (!brandSearchSource) {
      return { programId, brandName, queryBrandName, entries: [], warnings: ["no_brand_search_source"], seedKind };
    }
    const searchFetch = await fetchQualityMarkSource(brandSearchSource);
    if (!searchFetch.ok || !searchFetch.body) {
      return {
        programId,
        brandName,
        queryBrandName,
        entries: [],
        warnings: [searchFetch.error ?? "ifos_brand_search_failed"],
        searchEvidenceUrl: brandSearchSource.url,
        seedKind,
      };
    }
    const brandResults = parseIfosBrandResults(searchFetch.body);
    const entries = [];
    const warnings = [];
    for (const brandResult of brandResults.slice(0, 3)) {
      const brandPageUrl = `https://certifications.nutrasource.ca/certified-products/brand?id=${encodeURIComponent(brandResult.brandId)}`;
      const brandPageSource = {
        url: brandPageUrl,
        sourceType: "official_registry",
        title: "Nutrasource IFOS brand page",
        programId: "ifos",
        responseFormat: "html",
        brandName: brandResult.brandName,
        productName: null,
        queryText: brandName,
      };
      const brandPageFetch = await fetchQualityMarkSource(brandPageSource);
      if (!brandPageFetch.ok || !brandPageFetch.body) {
        warnings.push(brandPageFetch.error ?? "ifos_brand_page_failed");
        continue;
      }
      const products = parseIfosBrandPageProducts(brandPageFetch.body, brandResult.brandName);
      for (const product of products) {
        entries.push({
          programId,
          brandName: brandResult.brandName,
          productName: product.productName,
          evidenceUrl: brandPageUrl,
          queryBrandName,
        });
      }
    }
    return {
      programId,
      brandName,
      queryBrandName,
      entries,
      warnings,
      searchEvidenceUrl: brandSearchSource.url,
      seedKind,
    };
  }

  const results = await Promise.all(sources.map((source) => fetchQualityMarkSource(source).then((fetchResult) => ({
    source,
    fetchResult,
  }))));
  const entries = [];
  const warnings = [];
  for (const result of results) {
    if (!result.fetchResult.ok || !result.fetchResult.body) {
      warnings.push(result.fetchResult.error ?? "registry_fetch_failed");
      continue;
    }
    const body = result.fetchResult.body;
    const parsedEntries =
      programId === "nsf_certified_for_sport"
        ? parseNsfRegistryResults(body, brandName)
        : parseInformedRegistryResults(
            body,
            brandName,
            result.source.url.includes("choice.wetestyoutrust.com")
              ? "https://choice.wetestyoutrust.com"
              : "https://sport.wetestyoutrust.com",
          );
    for (const entry of parsedEntries) {
      entries.push({
        programId,
        brandName: entry.brandName,
        productName: entry.productName,
        evidenceUrl: entry.evidenceUrl ?? result.source.url,
        queryBrandName,
      });
    }
  }
  return {
    programId,
    brandName,
    queryBrandName,
    entries,
    warnings,
    searchEvidenceUrl: sources[0]?.url ?? null,
    seedKind,
  };
};

const buildSeedBrands = (seedSelectionRows) => {
  const grouped = new Map();
  for (const programId of PROGRAMS) grouped.set(programId, new Map());

  for (const row of seedSelectionRows) {
    if (!PROGRAMS.includes(row?.strongestProgramId)) continue;
    const brandName = safeText(row?.brandName);
    if (!brandName) continue;
    const bucket = grouped.get(row.strongestProgramId);
    bucket.set(brandName, (bucket.get(brandName) ?? 0) + 1);
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([programId, counts]) => [
      programId,
      Array.from(counts.entries())
        .sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1];
          return a[0].localeCompare(b[0]);
        })
        .slice(0, BRANDS_PER_PROGRAM)
        .map(([brandName, seedCount]) => ({ brandName, seedCount })),
    ]),
  );
};

const buildNsfFallbackBrands = (seedSelectionRows, seedBrands, importedRows) => {
  const existing = new Set((seedBrands.nsf_certified_for_sport ?? []).map((item) => compactQualityMarkText(item.brandName)));
  const counts = new Map();
  for (const row of seedSelectionRows) {
    const brandName = safeText(row?.brandName);
    if (!brandName) continue;
    const compact = compactQualityMarkText(brandName);
    if (!compact || existing.has(compact)) continue;
    counts.set(brandName, (counts.get(brandName) ?? 0) + 1);
  }
  const importedCounts = new Map();
  for (const row of importedRows) {
    const brandName = safeText(row?.brandName);
    const compact = compactQualityMarkText(brandName);
    if (!compact || existing.has(compact)) continue;
    importedCounts.set(brandName, (importedCounts.get(brandName) ?? 0) + 1);
  }

  const selected = [];
  const seen = new Set();
  for (const brandName of NSF_PREFERRED_FALLBACK_BRANDS) {
    const compact = compactQualityMarkText(brandName);
    if (seen.has(compact) || existing.has(compact)) continue;
    const importedCount = importedCounts.get(brandName) ?? 0;
    if (importedCount <= 0) continue;
    selected.push({
      brandName,
      seedCount: counts.get(brandName) ?? 0,
      importedCount,
      priority: "preferred",
    });
    seen.add(compact);
    if (selected.length >= NSF_FALLBACK_BRANDS) return selected;
  }

  const ranked = Array.from(importedCounts.entries())
    .sort((a, b) => {
      const aPreferred = NSF_PREFERRED_FALLBACK_BRANDS.includes(a[0]) ? 1 : 0;
      const bPreferred = NSF_PREFERRED_FALLBACK_BRANDS.includes(b[0]) ? 1 : 0;
      if (bPreferred !== aPreferred) return bPreferred - aPreferred;
      const seedDelta = (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0);
      if (seedDelta !== 0) return seedDelta;
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
  for (const [brandName, importedCount] of ranked) {
    const compact = compactQualityMarkText(brandName);
    if (seen.has(compact) || existing.has(compact)) continue;
    selected.push({
      brandName,
      seedCount: counts.get(brandName) ?? 0,
      importedCount,
      priority: "ranked",
    });
    seen.add(compact);
    if (selected.length >= NSF_FALLBACK_BRANDS) break;
  }
  return selected;
};

const buildPreferredFallbackBrands = ({ existingBrands, seedSelectionRows, importedRows, preferredBrands, limit }) => {
  const existing = new Set(existingBrands.map((item) => compactQualityMarkText(item.brandName)));
  const counts = new Map();
  for (const row of seedSelectionRows) {
    const brandName = safeText(row?.brandName);
    if (!brandName) continue;
    const compact = compactQualityMarkText(brandName);
    if (!compact || existing.has(compact)) continue;
    counts.set(brandName, (counts.get(brandName) ?? 0) + 1);
  }
  const importedCounts = new Map();
  for (const row of importedRows) {
    const brandName = safeText(row?.brandName);
    const compact = compactQualityMarkText(brandName);
    if (!compact || existing.has(compact)) continue;
    importedCounts.set(brandName, (importedCounts.get(brandName) ?? 0) + 1);
  }

  const selected = [];
  const seen = new Set();
  for (const brandName of preferredBrands) {
    const compact = compactQualityMarkText(brandName);
    if (seen.has(compact) || existing.has(compact)) continue;
    const importedCount = importedCounts.get(brandName) ?? 0;
    if (importedCount <= 0) continue;
    selected.push({
      brandName,
      seedCount: counts.get(brandName) ?? 0,
      importedCount,
      priority: "preferred",
    });
    seen.add(compact);
    if (selected.length >= limit) return selected;
  }

  return selected;
};

const buildImportedIndex = (rows) => {
  const byBrand = new Map();
  for (const row of rows) {
    const brandKey = compactQualityMarkText(row?.brandName ?? "");
    if (!brandKey) continue;
    if (!byBrand.has(brandKey)) byBrand.set(brandKey, []);
    byBrand.get(brandKey).push(row);
  }
  return { byBrand };
};

const getBrandCandidateRows = (officialBrandName, importedIndex) => {
  const brandKey = compactQualityMarkText(officialBrandName);
  if (!brandKey) return [];
  const exact = importedIndex.byBrand.get(brandKey);
  if (exact?.length) return exact;

  const matches = [];
  for (const [candidateKey, rows] of importedIndex.byBrand.entries()) {
    if (
      brandKey.includes(candidateKey) ||
      candidateKey.includes(brandKey) ||
      computeCoverage(officialBrandName, candidateKey) >= 0.6 ||
      computeCoverage(candidateKey, officialBrandName) >= 0.6
    ) {
      matches.push(...rows);
    }
  }
  return matches;
};

const isIfosRelevantProductName = (value) => {
  const text = String(value ?? "");
  return OMEGA_KEYWORD_REGEX.test(text) || /\b(baby'?s dha|mom'?s dha|super dha|cod liver|omega-3|fish oil)\b/i.test(text);
};

const buildOfficialNameVariants = (officialEntry) => {
  const variants = new Set();
  const push = (value) => {
    const normalized = normalizeQualityMarkText(value);
    if (normalized.length >= 3) variants.add(normalized);
  };

  const officialName = String(officialEntry?.productName ?? "");
  push(officialName);
  push(stripBrandPrefix(officialName, officialEntry?.brandName ?? ""));

  if (officialEntry?.programId === "nsf_certified_for_sport") {
    push(officialName.replace(/\bgol sport\b/gi, "Garden of Life Sport"));
    push(officialName.replace(/\bcertified\b/gi, ""));
    push(officialName.replace(/\borganic plant-based performance protein\b/gi, "Sport Organic Plant-Based Protein"));
    push(officialName.replace(/\borganic plant based performance protein\b/gi, "Sport Organic Plant-Based Protein"));
    push(officialName.replace(/\bcertified grass-fed whey\b/gi, "Sport Certified Grass Fed Whey"));
    push(officialName.replace(/\bcertified grass fed whey\b/gi, "Sport Certified Grass Fed Whey"));
    push(officialName.replace(/\bgarden of life sport creatine monohydrate \+ probiotics(?: kosher 60 servings)?\b/gi, "Sport Creatine Monohydrate + Probiotics"));

    if (/^sun chlorella a powder/i.test(officialName)) {
      push("Sun Chlorella Chlorella Supplement");
      push("Chlorella Supplement");
    }

    if (/^ghost energy rtd\b/i.test(officialName)) {
      push(officialName.replace(/\brtd\b/gi, ""));
      push(officialName.replace(/\b8\.4\s*oz\b/gi, ""));
      push(officialName.replace(/^ghost energy rtd\s*/i, "Ghost Energy "));
    }

    if (/^essentials creatine monohydrate\b/i.test(officialName)) {
      push("Bucked Up Essentials Creatine");
      push("Essentials Creatine");
      push("Creatine Monohydrate");
    }

    if (/^cellucor c4 sport\b/i.test(officialName)) {
      push(officialName.replace(/^cellucor\s+/i, ""));
      push(officialName.replace(/\bc4 sport\b/gi, "C4 Sport"));
      push(officialName.replace(/\bc4 ripped sport\b/gi, "C4 Sport Ripped"));
      push(officialName.replace(/\bc4 supersport\b/gi, "C4 Sport"));
      push(officialName.replace(/\bc4 ripped supersport\b/gi, "C4 Ripped Sport"));
    }
  }

  if (officialEntry?.programId === "ifos") {
    push(officialName.replace(/\brxomega-3\b/gi, "Rx Omega-3"));
    push(officialName.replace(/\bomegafactors\b/gi, "Omega Factors"));
    push(officialName.replace(/\bmaximum triple strength\b/gi, ""));
    push(officialName.replace(/\bsea rich\b/gi, "SeaRich"));

    if (/^searich omega-3 lemon meringue$/i.test(officialName)) {
      push("SeaRich Omega-3 Delicious Lemon Meringue");
    }

    if (/^rxomega-3 maximum triple strength$/i.test(officialName)) {
      push("Rx Omega-3");
    }
  }

  return [...variants];
};

const buildCandidateNameVariants = (row, programId) => {
  const variants = new Set();
  const push = (value) => {
    const normalized = normalizeQualityMarkText(value);
    if (normalized.length >= 3) variants.add(normalized);
  };

  const title = String(row?.title ?? "");
  const candidateProductName = stripBrandPrefix(title, row?.brandName ?? "");

  push(title);
  push(candidateProductName);

  if (programId === "nsf_certified_for_sport") {
    push(candidateProductName.replace(/\bsport,\s*/gi, "Sport "));
    push(candidateProductName.replace(/\borganic whey protein,\s*grass-fed\b/gi, "Sport Certified Grass Fed Whey"));
    push(candidateProductName.replace(/\bsport,\s*certified grass fed whey\b/gi, "Sport Certified Grass Fed Whey"));
    push(candidateProductName.replace(/\bsport,\s*organic plant-based protein\b/gi, "Sport Organic Plant-Based Protein"));
    push(candidateProductName.replace(/\bchlorella supplement\b/gi, "A Powder"));
    push(candidateProductName.replace(/\bbasics,\s*creatine\b/gi, "Creatine Monohydrate"));
    push(candidateProductName.replace(/\benergy,\s*/gi, "Energy "));
    push(candidateProductName.replace(/\brtd\b/gi, ""));
    push(candidateProductName.replace(/\bc4\s+sport(?:\s+strength)?\b/gi, "C4 Sport"));
    push(candidateProductName.replace(/\bc4\s+sport\s+ripped\b/gi, "C4 Ripped Sport"));
    push(candidateProductName.replace(/\bc4\s+ripped\s+sport\b/gi, "C4 Ripped Sport"));
    push(candidateProductName.replace(/\bc4\s+ultimate\s+strength\b/gi, "C4"));
  }

  if (programId === "ifos") {
    push(candidateProductName.replace(/\bomegafactors\b/gi, "Omega Factors"));
    push(candidateProductName.replace(/\brx omega-3\b/gi, "RxOmega-3"));
    push(candidateProductName.replace(/\bdelicious lemon meringue\b/gi, "Lemon Meringue"));
    push(candidateProductName.replace(/\benteripure(?:tm)?\b/gi, ""));
    push(candidateProductName.replace(/\bwith vitamin d3\b/gi, ""));
  }

  return [...variants];
};

const matchOfficialEntryToIherbRow = (officialEntry, importedIndex) => {
  const candidates = getBrandCandidateRows(officialEntry.brandName, importedIndex)
    .filter((row) => officialEntry.programId !== "ifos" || isIfosRelevantProductName(row?.title));
  if (officialEntry.programId === "ifos" && !isIfosRelevantProductName(officialEntry.productName)) {
    return null;
  }
  const officialVariants = buildOfficialNameVariants(officialEntry);
  const scored = candidates
    .map((row) => {
      const candidateVariants = buildCandidateNameVariants(row, officialEntry.programId);
      let officialCoverage = 0;
      let candidateCoverage = 0;
      let phraseMatch = false;

      for (const officialVariant of officialVariants) {
        for (const candidateVariant of candidateVariants) {
          officialCoverage = Math.max(officialCoverage, computeCoverage(officialVariant, candidateVariant));
          candidateCoverage = Math.max(candidateCoverage, computeCoverage(candidateVariant, officialVariant));
          phraseMatch =
            phraseMatch ||
            phraseIncluded(candidateVariant, officialVariant) ||
            phraseIncluded(officialVariant, candidateVariant);
        }
      }
      let score = officialCoverage * 0.75 + candidateCoverage * 0.25;
      if (phraseMatch) score += 0.2;
      if (officialEntry.programId === "ifos" && OMEGA_KEYWORD_REGEX.test(String(row?.title ?? ""))) score += 0.08;
      return {
        row,
        score,
        officialCoverage,
        candidateCoverage,
        phraseMatch,
      };
    })
    .filter((item) => item.officialCoverage >= 0.7 || (item.phraseMatch && item.officialCoverage >= 0.45))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.row?.title ?? "").length - String(b.row?.title ?? "").length;
    });

  return scored[0] ?? null;
};

const buildSelectionRow = (row, matchInfo, officialEntry) => {
  const overlayClaims = toOverlayClaims(row);
  const digest = toFactsDigest(row, overlayClaims);
  const payload = compileDecisionSupport({
    digest,
    factsDigestHash: computeFactsDigestHash(digest),
    viewMode: "details",
    locale: "en",
    flagsSnapshot: null,
    patchActivation: null,
    overlayClaims,
  });
  const testingModule = Array.isArray(payload?.nutriScoreCardV2?.modules)
    ? payload.nutriScoreCardV2.modules.find((module) => module?.id === "testing_verification")
    : null;
  const thirdPartyItem = Array.isArray(testingModule?.checklist)
    ? testingModule.checklist.find((item) => item?.key === "testing_verification:third_party_tested_claim")
    : null;
  const categoryId = payload?.categoryId ?? null;
  const definition = getQualityMarkProgramDefinition(officialEntry.programId);
  const officialRegistryBrandName =
    normalizeQualityMarkText(String(officialEntry?.brandName ?? "")).length >= 3
      ? officialEntry.brandName
      : (row?.brandName ?? officialEntry.brandName);

  return {
    key: buildQualityMarkLookupKey({
      sourceType: digest.sourceType,
      identityType: digest.identity.type,
      identityValue: digest.identity.value,
      brandName: digest.product.brandDisplay,
      productName: digest.product.name,
    }),
    productId: row?.productId ? String(row.productId) : null,
    barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
    brandName: row?.brandName ?? null,
    productName: row?.title ?? null,
    iherbUrl: row?.link ?? null,
    categoryId,
    strongestProgramId: officialEntry.programId,
    strongestProgramLabel: definition?.label ?? officialEntry.programId,
    thirdPartyChecklistState: thirdPartyItem?.state ?? null,
    verificationSummary: payload?.qualityMark?.verificationSummary ?? null,
    selectionReason: "registry_first_positive_control",
    officialRegistryProductName: officialEntry.productName,
    officialRegistryBrandName,
    officialRegistryEvidenceUrl: officialEntry.evidenceUrl,
    registryQueryBrandName: officialEntry.queryBrandName,
    matchScore: Number(matchInfo.score.toFixed(4)),
    officialCoverage: Number(matchInfo.officialCoverage.toFixed(4)),
    candidateCoverage: Number(matchInfo.candidateCoverage.toFixed(4)),
    phraseMatch: matchInfo.phraseMatch,
  };
};

const toSelectionMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 Registry-First Positive Control Selection");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Selected products: ${report.selectedCount}`);
  lines.push("");
  lines.push("## Seed Brands");
  lines.push("");
  for (const [programLabel, brands] of Object.entries(report.seedBrands)) {
    lines.push(`- ${programLabel}: ${brands.map((item) => `${item.brandName} (${item.seedCount})`).join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## Official Registry Query Summary");
  lines.push("");
  for (const row of report.registryQuerySummary) {
    lines.push(`- ${row.programLabel} | ${row.brandName} | seed=${row.seedKind} | officialRows=${row.officialRowCount} | warnings=${row.warnings.join(", ") || "none"} | matched=${row.matchedCount}`);
  }
  lines.push("");
  lines.push("## Selected Products");
  lines.push("");
  for (const row of report.rows) {
    lines.push(`- ${row.strongestProgramLabel} | ${row.brandName} | ${row.productName} | official="${row.officialRegistryProductName}" | score=${row.matchScore} | ${row.iherbUrl}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const [stagingPayload, mergePayload, seedSelectionPayload] = await Promise.all([
    readJson(STAGING_PATH),
    readJson(MERGE_REPORT_PATH),
    readJson(SEED_SELECTION_PATH),
  ]);

  const seedSelectionRows = Array.isArray(seedSelectionPayload?.rows) ? seedSelectionPayload.rows : [];
  if (seedSelectionRows.length === 0) {
    throw new Error(`Seed selection rows not found in ${SEED_SELECTION_PATH}`);
  }

  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );
  const imported = products.filter((row) => matchedIds.has(String(row?.productId ?? "")));
  const importedIndex = buildImportedIndex(imported);
  const seedBrands = buildSeedBrands(seedSelectionRows);
  const nsfFallbackBrands = buildNsfFallbackBrands(seedSelectionRows, seedBrands, imported);
  const ifosFallbackBrands = buildPreferredFallbackBrands({
    existingBrands: seedBrands.ifos ?? [],
    seedSelectionRows,
    importedRows: imported,
    preferredBrands: IFOS_PREFERRED_FALLBACK_BRANDS,
    limit: IFOS_FALLBACK_BRANDS,
  });
  const registryQueryTasks = PROGRAMS.flatMap((programId) => {
    const primary = (seedBrands[programId] ?? []).map((brand) => ({
      programId,
      brandName: brand.brandName,
      queryBrandName: toRegistryQueryBrandName(programId, brand.brandName),
      seedKind: "primary",
    }));
    if (programId === "nsf_certified_for_sport") {
      const fallback = nsfFallbackBrands.map((brand) => ({
        programId,
        brandName: brand.brandName,
        queryBrandName: toRegistryQueryBrandName(programId, brand.brandName),
        seedKind: "fallback",
      }));
      return [...primary, ...fallback];
    }
    if (programId === "ifos") {
      const fallback = ifosFallbackBrands.map((brand) => ({
        programId,
        brandName: brand.brandName,
        queryBrandName: toRegistryQueryBrandName(programId, brand.brandName),
        seedKind: "fallback",
      }));
      return [...primary, ...fallback];
    }
    return primary;
  });

  const registryQueryResults = await mapLimit(registryQueryTasks, CONCURRENCY, async (task, index) => {
    const result = await fetchRegistryEntriesForBrand(task);
    console.log(
      JSON.stringify(
        {
          phase: "week2_registry_first_query",
          processed: index + 1,
          total: registryQueryTasks.length,
          programId: task.programId,
          brandName: task.brandName,
          queryBrandName: task.queryBrandName ?? task.brandName,
          seedKind: task.seedKind,
          officialRowCount: result.entries.length,
          warnings: result.warnings,
        },
        null,
        2,
      ),
    );
    return result;
  });

  const selectedRows = [];
  const selectedKeys = new Set();

  for (const programId of PROGRAMS) {
    const programLimit = MATCHES_PER_PROGRAM;
    const programResults = registryQueryResults
      .filter((result) => result.programId === programId)
      .map((result) => ({
        ...result,
        matchedCandidates: result.entries
          .map((officialEntry) => {
            const matchInfo = matchOfficialEntryToIherbRow(officialEntry, importedIndex);
            if (!matchInfo?.row) return null;
            return {
              officialEntry,
              matchInfo,
              key: String(matchInfo.row?.productId ?? matchInfo.row?.barcode_gtin14 ?? ""),
            };
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.matchInfo.score !== a.matchInfo.score) return b.matchInfo.score - a.matchInfo.score;
            return String(a.matchInfo.row?.title ?? "").length - String(b.matchInfo.row?.title ?? "").length;
          }),
      }));

    let addedForProgram = 0;
    while (addedForProgram < programLimit) {
      let addedThisRound = 0;
      for (const result of programResults) {
        while (result.matchedCandidates.length > 0) {
          const candidate = result.matchedCandidates.shift();
          if (!candidate?.key || selectedKeys.has(candidate.key)) continue;
          selectedRows.push(buildSelectionRow(candidate.matchInfo.row, candidate.matchInfo, candidate.officialEntry));
          selectedKeys.add(candidate.key);
          addedForProgram += 1;
          addedThisRound += 1;
          break;
        }
        if (addedForProgram >= programLimit) break;
      }
      if (addedThisRound === 0) break;
    }
  }

  const selectionReport = {
    schemaVersion: "week2_registry_first_positive_control_selection.v1",
    generatedAt: nowIso(),
    seedSelectionPath: SEED_SELECTION_PATH,
    selectedCount: selectedRows.length,
    matchesPerProgram: MATCHES_PER_PROGRAM,
    seedBrands: Object.fromEntries(
      PROGRAMS.map((programId) => [
        getQualityMarkProgramDefinition(programId)?.label ?? programId,
        seedBrands[programId] ?? [],
      ]),
    ),
    registryQuerySummary: registryQueryResults.map((result) => ({
      programId: result.programId,
      programLabel: getQualityMarkProgramDefinition(result.programId)?.label ?? result.programId,
      brandName: result.brandName,
      queryBrandName: result.queryBrandName ?? result.brandName,
      seedKind: result.seedKind ?? "primary",
      officialRowCount: result.entries.length,
      matchedCount: selectedRows.filter(
        (row) =>
          row.strongestProgramId === result.programId &&
          compactQualityMarkText(row.registryQueryBrandName) === compactQualityMarkText(result.queryBrandName ?? result.brandName),
      ).length,
      warnings: result.warnings,
      searchEvidenceUrl: result.searchEvidenceUrl ?? null,
    })),
    programCounts: sortCounts(
      selectedRows.reduce((acc, row) => {
        increment(acc, row.strongestProgramLabel ?? row.strongestProgramId ?? "unknown");
        return acc;
      }, {}),
    ),
    nsfFallbackBrands,
    ifosFallbackBrands,
    rows: selectedRows,
  };

  await fs.writeFile(SELECTION_JSON, `${JSON.stringify(selectionReport, null, 2)}\n`, "utf8");
  await fs.writeFile(SELECTION_MD, toSelectionMarkdown(selectionReport), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        selected: selectedRows.length,
        selectionJson: SELECTION_JSON,
        selectionMd: SELECTION_MD,
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
