#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import {
  ingredientOverviewGenericHit,
  scientificGenericHit,
  sourceWeakHintLeakageHit,
} from "./lib/science-validation-reporting.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const STAGING_JSON = getArg("staging-json");
const OUT_DIR = getArg("out-dir", "output/canadian_brand_full_coverage_wave_v0/post_merge_validation");
const API_BASE_URL = getArg(
  "api-base-url",
  process.env.SCIENCE_VALIDATION_API_BASE_URL || process.env.API_BASE_URL || "http://127.0.0.1:3001",
);
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", "2")) || 2);

const PERSONALIZATION_HEADER = JSON.stringify({
  profile: {
    goals: ["Sleep", "Energy", "Immunity", "Recovery", "Focus", "Stress Support"],
    preferredTypes: ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein"],
  },
  savedSupplements: [],
});

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-auth-disabled": "1",
  "x-local-personalization": PERSONALIZATION_HEADER,
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache",
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const BAD_DEFAULT_ANCHOR_PATTERN =
  /\b(?:amount per serving|daily value|serving size|servings per container|calories|total fat|total carbohydrate|sugars?|flavou?r|suggested use|warnings?|non medicinal|other ingredients|food-based product|food-based powder)\b/i;

const isBadDefaultAnchor = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (/^sodium$/i.test(normalized)) return true;
  return BAD_DEFAULT_ANCHOR_PATTERN.test(normalized);
};

const fetchJson = async (url, options = {}, timeoutMs = 60_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, elapsedMs: Date.now() - startedAt, json };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      json: { error: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const candidateEvidenceText = (row) =>
  normalizeLooseText(
    [
      row.brandName,
      row.title,
      row.normalizedTitle,
      row.link,
      row.canadianCoverage?.originalCatalogTitle,
      ...(row.sourceSummary?.sourceUrls ?? []),
      ...(row.supplementFacts?.nutritionalFacts ?? []).flatMap((fact) => [
        fact?.substancy,
        fact?.amountPerServing,
      ]),
      row.descriptionSections?.["Other ingredients"],
    ].join(" "),
  );

const anchorSupportedByCandidate = (anchor, row) => {
  const normalizedAnchor = normalizeLooseText(anchor);
  if (!normalizedAnchor) return false;
  const evidence = candidateEvidenceText(row);
  if (evidence.includes(normalizedAnchor)) return true;

  if (/^probiotics?$/.test(normalizedAnchor)) {
    return /\bprobiotic(s)?\b|\bcfu\b|lactobacillus|bifidobacterium|bacillus|bacterial culture/i.test(evidence);
  }
  if (/^b complex|vitamin b complex/.test(normalizedAnchor)) {
    return /\bb\s*\d+\b|thiamine|riboflavin|niacin|pantothenate|pyridox|biotin|folate|cobalamin|b complex/i.test(evidence);
  }
  if (/^multivitamin|multi vitamin|multivitamin mineral/.test(normalizedAnchor)) {
    return /\bmulti|vitamin a|vitamin b|vitamin c|vitamin d|mineral/i.test(evidence);
  }
  if (/^omega/.test(normalizedAnchor)) {
    return /\bomega|fish oil|flax|borage|epa|dha/i.test(evidence);
  }
  if (/^greens?$|superfood/.test(normalizedAnchor)) {
    return /\bgreens?|superfood|alfalfa|barley grass|spirulina|chlorella/i.test(evidence);
  }
  if (/^whey protein$/.test(normalizedAnchor)) {
    return /\bwhey\b.*\bprotein\b|\bprotein\b.*\bwhey\b/i.test(evidence);
  }

  const tokens = normalizedAnchor
    .split(" ")
    .filter(
      (token) =>
        token.length >= 4 &&
        ![
          "acid",
          "extract",
          "source",
          "whole",
          "root",
          "fruit",
          "leaf",
          "seed",
          "skin",
          "vegetarian",
          "citrate",
          "hydrochloride",
          "monohydrate",
          "micronized",
        ].includes(token),
    );
  return tokens.some((token) => evidence.includes(token));
};

const stringifyOverview = (payload) => JSON.stringify(payload?.ingredientOverview ?? payload ?? {});
const stringifyScientific = (payload) => JSON.stringify(payload?.scientificBackground ?? payload ?? {});
const snippet = (value, limit = 220) => normalizeText(value).slice(0, limit);
const ANCHOR_COPY_TOKEN_STOPLIST = new Set([
  "acid",
  "ascorbate",
  "bisglycinate",
  "chelate",
  "citrate",
  "elemental",
  "extract",
  "gluconate",
  "glycinate",
  "hydrochloride",
  "monohydrate",
  "sulfate",
]);
const resolveAnchorCopyToken = (anchor) => {
  const normalized = normalizeLooseText(anchor);
  if (!normalized) return "";
  if (/^vitamin\s+[a-z0-9]\b/.test(normalized)) return "vitamin";
  for (const preferred of [
    "zinc",
    "magnesium",
    "calcium",
    "iron",
    "melatonin",
    "biotin",
    "collagen",
    "cranberry",
    "turmeric",
    "curcumin",
    "vitamin",
    "folate",
    "riboflavin",
    "ginkgo",
    "quercetin",
    "selenium",
  ]) {
    if (normalized.includes(preferred)) return preferred;
  }
  return (
    normalized
      .split(" ")
      .find((token) => token.length >= 4 && !ANCHOR_COPY_TOKEN_STOPLIST.has(token)) ?? normalized
  );
};

const validateRow = async (row, index, total) => {
  const barcode = row.upcCode || row.barcode_gtin14;
  console.error(`[canadian-post-merge] ${index + 1}/${total} ${row.brandName} | ${row.title}`);

  const decisionSupport = await fetchJson(
    `${API_BASE_URL}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=details`,
    { headers },
  );
  const decisionPayload = decisionSupport.json ?? {};
  const defaultRow = decisionPayload?.scienceBlock?.ingredientRows?.[0] ?? null;
  const defaultName = normalizeText(defaultRow?.name);
  const defaultAnchor = {
    ok: Boolean(
        decisionSupport.ok &&
        defaultName &&
        !isBadDefaultAnchor(defaultName) &&
        anchorSupportedByCandidate(defaultName, row),
    ),
    name: defaultName || null,
    dose: defaultRow?.dose ?? null,
    rowCount: decisionPayload?.scienceBlock?.ingredientRows?.length ?? 0,
    sourceTier: decisionPayload?.scienceBlock?.ingredientSourceTier ?? null,
    sourceType: decisionPayload?.sourceType ?? null,
    failReason: !decisionSupport.ok
      ? `decision_support_http_${decisionSupport.status}`
      : !defaultName
      ? "missing_default_anchor"
      : isBadDefaultAnchor(defaultName)
        ? "bad_anchor_macro_or_food_like"
          : !anchorSupportedByCandidate(defaultName, row)
            ? "anchor_not_supported_by_title_or_facts"
            : null,
  };

  let ingredientOverview = {
    ok: false,
    status: null,
    elapsedMs: null,
    source: null,
    genericHit: null,
    sourceLeak: null,
    mentionsAnchor: null,
    snippet: null,
    failReason: "skipped_decision_support_failed",
  };
  let scientificBackground = {
    ok: false,
    status: null,
    elapsedMs: null,
    source: null,
    genericHit: null,
    sourceLeak: null,
    mentionsAnchor: null,
    snippet: null,
    failReason: "skipped_decision_support_failed",
  };

  if (
    decisionSupport.ok &&
    decisionPayload.digest &&
    decisionPayload.decisionInputsHash &&
    decisionPayload.personalizationScopeHash &&
    defaultName
  ) {
    const body = {
      barcode,
      decisionDigest: decisionPayload.digest,
      decisionInputsHash: decisionPayload.decisionInputsHash,
      personalizationScopeHash: decisionPayload.personalizationScopeHash,
    };
    const anchorToken = resolveAnchorCopyToken(defaultName);

    const overviewResponse = await fetchJson(`${API_BASE_URL}/api/ingredient-overview/v1`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const overviewText = stringifyOverview(overviewResponse.json);
    const overviewLower = normalizeLooseText(overviewText);
    ingredientOverview = {
      ok: Boolean(
        overviewResponse.ok &&
          !ingredientOverviewGenericHit(overviewResponse.json?.ingredientOverview) &&
          !sourceWeakHintLeakageHit(overviewResponse.json?.ingredientOverview) &&
          (!anchorToken || overviewLower.includes(anchorToken)),
      ),
      status: overviewResponse.status,
      elapsedMs: overviewResponse.elapsedMs,
      source: overviewResponse.json?.source ?? null,
      genericHit: ingredientOverviewGenericHit(overviewResponse.json?.ingredientOverview),
      sourceLeak: sourceWeakHintLeakageHit(overviewResponse.json?.ingredientOverview),
      mentionsAnchor: !anchorToken || overviewLower.includes(anchorToken),
      snippet: snippet(overviewText),
      failReason: !overviewResponse.ok
        ? `overview_http_${overviewResponse.status}`
        : ingredientOverviewGenericHit(overviewResponse.json?.ingredientOverview)
          ? "overview_generic"
          : sourceWeakHintLeakageHit(overviewResponse.json?.ingredientOverview)
            ? "overview_source_leakage"
            : anchorToken && !overviewLower.includes(anchorToken)
              ? "overview_does_not_mention_anchor"
              : null,
    };

    const scientificResponse = await fetchJson(
      `${API_BASE_URL}/api/scientific-background/v1`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...body,
          selectedIngredientName: defaultName,
        }),
      },
      90_000,
    );
    const scientificText = stringifyScientific(scientificResponse.json);
    const scientificLower = normalizeLooseText(scientificText);
    scientificBackground = {
      ok: Boolean(
        scientificResponse.ok &&
          !scientificGenericHit(scientificResponse.json?.scientificBackground) &&
          !sourceWeakHintLeakageHit(scientificResponse.json?.scientificBackground) &&
          (!anchorToken || scientificLower.includes(anchorToken)),
      ),
      status: scientificResponse.status,
      elapsedMs: scientificResponse.elapsedMs,
      source: scientificResponse.json?.source ?? null,
      genericHit: scientificGenericHit(scientificResponse.json?.scientificBackground),
      sourceLeak: sourceWeakHintLeakageHit(scientificResponse.json?.scientificBackground),
      mentionsAnchor: !anchorToken || scientificLower.includes(anchorToken),
      snippet: snippet(scientificText),
      failReason: !scientificResponse.ok
        ? `scientific_http_${scientificResponse.status}`
        : scientificGenericHit(scientificResponse.json?.scientificBackground)
          ? "scientific_generic"
          : sourceWeakHintLeakageHit(scientificResponse.json?.scientificBackground)
            ? "scientific_source_leakage"
            : anchorToken && !scientificLower.includes(anchorToken)
              ? "scientific_does_not_mention_anchor"
              : null,
    };
  }

  const searchResponse = await fetchJson(`${API_BASE_URL}/api/search?q=${encodeURIComponent(barcode)}&limit=5`);
  const supplements = searchResponse.json?.data?.supplements ?? [];
  const top = supplements[0] ?? null;
  const expectedBarcode = normalizeBarcode(row.barcode_gtin14 || row.upcCode);
  const topBarcode = normalizeBarcode(top?.barcode || top?.upcCode);
  const topBrandMatches = normalizeLooseText(top?.brand) === normalizeLooseText(row.brandName);
  const topProductIdMatches = normalizeText(top?.productId) === normalizeText(row.productId);
  const canonicalIdentityMatches = topBarcode === expectedBarcode && topBrandMatches;
  const searchDetail = {
    ok: Boolean(
      searchResponse.ok &&
        top &&
        canonicalIdentityMatches,
    ),
    status: searchResponse.status,
    elapsedMs: searchResponse.elapsedMs,
    identityResolution: topProductIdMatches
      ? "staging_product_id"
      : canonicalIdentityMatches
        ? "existing_product_same_barcode_brand"
        : null,
    productIdStrictMatch: topProductIdMatches,
    top: top
      ? {
          productId: top.productId,
          barcode: top.barcode,
          upcCode: top.upcCode,
          brand: top.brand,
          name: top.name,
          category: top.category,
          dose: top.dose,
          factsStatus: top.factsStatus,
          coverageStatus: top.coverageStatus,
        }
      : null,
    failReason: !searchResponse.ok
      ? `search_http_${searchResponse.status}`
      : !top
        ? "search_no_results"
        : topBarcode !== expectedBarcode
          ? "search_top_barcode_mismatch"
          : !topBrandMatches
              ? "search_top_brand_mismatch"
              : null,
  };

  const failReasons = [
    defaultAnchor.failReason,
    ingredientOverview.failReason,
    scientificBackground.failReason,
    searchDetail.failReason,
  ].filter(Boolean);

  return {
    brandName: row.brandName,
    title: row.title,
    productId: row.productId,
    upcCode: row.upcCode,
    barcodeGtin14: row.barcode_gtin14,
    firstParsedFact: row.supplementFacts?.nutritionalFacts?.[0]?.substancy ?? null,
    defaultAnchor,
    ingredientOverview,
    scientificBackground,
    searchDetail,
    ok: failReasons.length === 0,
    failReasons,
  };
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await mapper(items[index], index);
      }
    }),
  );
  return out;
};

const renderMarkdown = (report) => {
  const lines = [
    "# Canadian Official Post-Merge Validation",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- total: ${report.summary.total}`,
    `- pass: ${report.summary.pass}`,
    `- fail: ${report.summary.fail}`,
    "",
    "## Failure Buckets",
    "",
  ];
  const failures = Object.entries(report.summary.gateFailures);
  if (failures.length === 0) {
    lines.push("- none");
  } else {
    for (const [reason, count] of failures) lines.push(`- ${reason}: ${count}`);
  }
  lines.push("", "## Rows", "");
  for (const row of report.rows) {
    lines.push(
      `- ${row.ok ? "PASS" : "FAIL"} | ${row.brandName} | ${row.title} | anchor=${row.defaultAnchor.name || "n/a"} | overview=${row.ingredientOverview.ok ? "ok" : "fail"} | scientific=${row.scientificBackground.ok ? "ok" : "fail"} | search=${row.searchDetail.ok ? "ok" : "fail"}${row.failReasons.length ? ` | ${row.failReasons.join(", ")}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  if (!STAGING_JSON) {
    throw new Error("Missing --staging-json");
  }

  const stagingPath = path.resolve(ROOT, STAGING_JSON);
  const staging = JSON.parse(await fs.readFile(stagingPath, "utf8"));
  const products = Array.isArray(staging?.products) ? staging.products : [];
  if (products.length === 0) {
    throw new Error("No products found in staging JSON");
  }

  const rows = await mapWithConcurrency(products, CONCURRENCY, (row, index) =>
    validateRow(row, index, products.length),
  );
  const summary = {
    total: rows.length,
    pass: rows.filter((row) => row.ok).length,
    fail: rows.filter((row) => !row.ok).length,
    byBrand: rows.reduce((acc, row) => {
      acc[row.brandName] ??= { total: 0, pass: 0, fail: 0 };
      acc[row.brandName].total += 1;
      if (row.ok) acc[row.brandName].pass += 1;
      else acc[row.brandName].fail += 1;
      return acc;
    }, {}),
    gateFailures: rows.reduce((acc, row) => {
      for (const reason of row.failReasons) acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    reportType: "canadian_official_post_merge_product_surface_validation",
    apiBaseUrl: API_BASE_URL,
    stagingPath: STAGING_JSON,
    summary,
    rows,
  };

  await fs.mkdir(path.resolve(ROOT, OUT_DIR), { recursive: true });
  const jsonPath = path.resolve(ROOT, OUT_DIR, "canadian_official_post_merge_validation.json");
  const mdPath = path.resolve(ROOT, OUT_DIR, "canadian_official_post_merge_validation.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: summary.fail === 0,
        outputs: { json: jsonPath, md: mdPath },
        summary,
      },
      null,
      2,
    ),
  );

  if (summary.fail > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
