import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CANADIAN_CANDIDATE_PATH =
  "output/canadian_brand_full_coverage_wave_v0/canadian_new_overlay_candidates.v2.json";

export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ÂÃ‚]+/g, "")
    .replace(/[™®]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const toSourceArray = (value) => (Array.isArray(value) ? value : []);

const stripLeadingFactHeading = (value) =>
  normalizeText(value)
    .replace(/^Each\s+[^:]{1,80}\s+contains:?\s*/i, "")
    .replace(/^(?:Nutritional Information\s+)?(?:Nutrient\s+)?/i, "")
    .replace(
      /^(?:Medicinal Ingredients?|Ingredient Amount(?: per Serving)?(?: RDA%)?|Amount \(Per [^)]+\)|Ingredient Amount \(Per [^)]+\))\s*/i,
      "",
    )
    .replace(
      /^\(?Per\s+\d+\s+(?:Capsules?|Caplets?|Tablets?|Softgels?|Gumm(?:y|ies)|Scoops?|Serving)(?:\s*\([^)]*\))?\)?\s*/i,
      "",
    )
    .replace(
      /^Amount\s+per\s+(?:Capsules?|Caplets?|Tablets?|Softgels?|Gumm(?:y|ies)|Scoops?|Serving|Tablespoon)(?:\s*\([^)]*\))?\s*/i,
      "",
    )
    .trim();

const cleanFactName = (value) =>
  normalizeText(value)
    .replace(
      /^(?:Medicinal Ingredients?|Ingredient|Amount|RDA%|Details|Probiotic Strain Amount \(CFU\)|Proteins?\s*&\s*Botanicals|Botanicals|Supporting Nutrient:?|Providing:?)\s*/i,
      "",
    )
    .replace(
      /^\(?Per\s+\d+\s+(?:Capsules?|Caplets?|Tablets?|Softgels?|Gumm(?:y|ies)|Scoops?|Serving)(?:\s*\([^)]*\))?\)?\s*/i,
      "",
    )
    .replace(
      /^Amount\s+per\s+(?:Capsules?|Caplets?|Tablets?|Softgels?|Gumm(?:y|ies)|Scoops?|Serving|Tablespoon)(?:\s*\([^)]*\))?\s*/i,
      "",
    )
    .replace(/^\)+\s*/, "")
    .replace(/\b(?:Equivalent to|standardized to|Providing:?|Total active|Total in billions|\* Total)\b.*$/i, "")
    .replace(/\s+\($/, "")
    .replace(/[;:,\-]+$/, "")
    .replace(/^[:;.,\-]+/, "")
    .trim();

export const parseCanadianOfficialFacts = (rawText, { maxRows = 12 } = {}) => {
  let text = stripLeadingFactHeading(rawText);
  const stopMatch = text.search(
    /\b(?:Non[- ]?Medicinal Ingredients?|Also Contains?|Allergen Statement|Free of|Caution|Warning|Recommended Purpose|Directions:)\b/i,
  );
  if (stopMatch > 8) {
    text = text.slice(0, stopMatch).trim();
  }

  const amountPattern =
    /\b(?:\d[\d,.]*(?:\.\d+)?\s*(?:mcg|mg|g|IU|iu|Billion\s*CFU|billion\s*CFU|Million\s*CFU|million\s*CFU|CFU)|\d[\d,.]*(?:\.\d+)?B\s*CFU)\b/g;
  const matches = [...text.matchAll(amountPattern)];
  const rows = [];

  for (let index = 0; index < matches.length && rows.length < maxRows; index += 1) {
    const match = matches[index];
    const start = index === 0 ? 0 : matches[index - 1].index + matches[index - 1][0].length;
    const end = match.index;
    const substancy = cleanFactName(text.slice(start, end));
    const amountPerServing = normalizeText(match[0]);

    if (!substancy || substancy.length < 3 || substancy.length > 120) continue;
    if (/^(?:to|of|dry herb|raw herb|rda|vitamins|minerals|details|per)$/i.test(substancy)) continue;
    if (/\b(?:non medicinal|also contains|other ingredients)\b/i.test(substancy)) continue;

    rows.push({
      substancy,
      amountPerServing,
      dailyValuePercent: null,
    });
  }

  return rows;
};

const inferServing = (factsText) => {
  const text = normalizeText(factsText);
  const servingSize =
    text.match(
      /(?:Each serving|Per\s+1\s+(?:Scoop|Capsule|Caplet|Tablet|Softgel|Gummy)|Amount per\s+(?:Scoop|Capsule|Caplet|Tablet|Softgel|Gummy|Serving))\s*\(?([^:)]+?)\)?\s+(?:contains|Ingredient|Medicinal|Vitamins|[A-Z])/i,
    )?.[1] ?? null;
  return {
    servingType: null,
    servingDescription: null,
    servingSize: normalizeText(servingSize) || null,
    servingsPerContainer: null,
  };
};

const hasCompleteOfficialCandidateFields = (row) =>
  Boolean(
    normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode) &&
      normalizeText(row?.productCatalogImage) &&
      normalizeText(row?.descriptionSections?.["Suggested use"]) &&
      normalizeText(row?.descriptionSections?.["Other ingredients"]) &&
      normalizeText(row?.descriptionSections?.Warnings),
  );

const scoreCandidate = (row, facts) => {
  let score = 0;
  score += Math.min(facts.length, 8) * 10;
  if (normalizeText(row?.descriptionSections?.Description)) score += 8;
  if (Array.isArray(row?.productImages)) score += Math.min(row.productImages.length, 4) * 3;
  if (Array.isArray(row?.categories) && row.categories.length > 0) score += 5;
  if (normalizeText(row?.dosageForm)) score += 4;
  if (normalizeText(row?.count)) score += 3;
  if (row?.canadianCoverage?.hasOfficialUpc) score += 5;
  return score;
};

const buildOverlayRecord = ({ row, facts, waveId }) => {
  const otherIngredients = normalizeText(row.descriptionSections?.["Other ingredients"]);
  const serving = inferServing(otherIngredients);
  const sourceUrls = [
    row.link,
    ...toSourceArray(row?.sourceSummary?.sourceUrls),
  ].filter(Boolean);
  const sourceNotes = [
    ...toSourceArray(row?.sourceSummary?.sourceNotes),
    `${waveId}: Canadian official complete fields with conservative facts parse`,
  ];

  return {
    ...row,
    barcode_gtin14: normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode),
    serving,
    supplementFacts: {
      servingSize: serving.servingSize,
      servingsPerContainer: null,
      nutritionalFacts: facts,
    },
    descriptionSections: {
      Description: normalizeText(row.descriptionSections?.Description),
      "Suggested use": normalizeText(row.descriptionSections?.["Suggested use"]),
      "Other ingredients": otherIngredients,
      Warnings: normalizeText(row.descriptionSections?.Warnings),
    },
    sourceSummary: {
      ...(row.sourceSummary ?? {}),
      sourceKind: "canadian_official_product_page",
      sourceTypes: [...new Set([...toSourceArray(row?.sourceSummary?.sourceTypes), "official_product_page"])].sort(),
      marketSources: [...new Set([...toSourceArray(row?.sourceSummary?.marketSources), "ca"])].sort(),
      sourceUrls: [...new Set(sourceUrls.map(normalizeText).filter(Boolean))].sort(),
      sourceNotes: [...new Set(sourceNotes.map(normalizeText).filter(Boolean))].sort(),
      npnIgnored: false,
      hasUsIherbPage: false,
      sourceRank: 90,
    },
    readiness: {
      ...(row.readiness ?? {}),
      canadianOfficialFullOverlayReady: true,
      highConfidenceUsProductPageReady: false,
      factParseMethod: "official_other_ingredients_amount_rows_v2",
      factParseRowCount: facts.length,
    },
    overlayRecordKey: `gtin14:${normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode)}`,
  };
};

const defaultTargetForBrand = (brandTargets, brand) => {
  if (brandTargets instanceof Map && brandTargets.has(brand)) return brandTargets.get(brand);
  return null;
};

export const parseBrandTargets = (value) => {
  const targets = new Map();
  for (const part of String(value ?? "").split(",")) {
    const [brand, rawCount] = part.split(":").map((item) => normalizeText(item));
    const count = Number(rawCount);
    if (!brand || !Number.isFinite(count) || count <= 0) continue;
    targets.set(brand, Math.floor(count));
  }
  return targets;
};

export const buildCanadianOfficialMergeWave = ({
  candidates,
  brands,
  brandTargets = new Map(),
  excludeGtins = new Set(),
  excludeProductIds = new Set(),
  waveId,
  sourceCandidatePath,
  limit = null,
}) => {
  const selected = [];
  const skipped = [];
  const scoredByBrand = new Map();

  for (const row of Array.isArray(candidates) ? candidates : []) {
    const brandName = normalizeText(row?.brandName);
    if (!brands.includes(brandName)) continue;

    const gtin = normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode);
    const productId = normalizeText(row?.productId);
    if (gtin && excludeGtins.has(gtin)) {
      skipped.push({ brandName, title: row?.title, barcode_gtin14: gtin, reason: "excluded_gtin" });
      continue;
    }
    if (productId && excludeProductIds.has(productId)) {
      skipped.push({ brandName, title: row?.title, barcode_gtin14: gtin, reason: "excluded_product_id" });
      continue;
    }
    if (!hasCompleteOfficialCandidateFields(row)) {
      skipped.push({ brandName, title: row?.title, barcode_gtin14: gtin, reason: "missing_required_official_fields" });
      continue;
    }

    const facts = parseCanadianOfficialFacts(row.descriptionSections["Other ingredients"]);
    if (facts.length === 0) {
      skipped.push({ brandName, title: row?.title, barcode_gtin14: gtin, reason: "unparseable_official_facts" });
      continue;
    }

    const item = {
      score: scoreCandidate(row, facts),
      row,
      facts,
    };
    if (!scoredByBrand.has(brandName)) scoredByBrand.set(brandName, []);
    scoredByBrand.get(brandName).push(item);
  }

  for (const brand of brands) {
    const rows = (scoredByBrand.get(brand) ?? []).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return normalizeText(a.row.title).localeCompare(normalizeText(b.row.title));
    });
    const brandTarget = defaultTargetForBrand(brandTargets, brand);
    const take = brandTarget ?? rows.length;
    for (const item of rows.slice(0, take)) {
      if (Number.isFinite(limit) && limit !== null && selected.length >= limit) break;
      selected.push(buildOverlayRecord({ row: item.row, facts: item.facts, waveId }));
    }
  }

  return {
    schemaVersion: "canadian-official-merge-wave.v1",
    generatedAt: new Date().toISOString(),
    sourceCandidatePath,
    selectionPolicy: {
      waveId,
      brands,
      brandTargets: Object.fromEntries(brandTargets instanceof Map ? brandTargets : new Map()),
      rules: [
        "has gtin14/upc",
        "has product image",
        "has official suggested_use",
        "has official warnings",
        "has official ingredient text",
        "conservative facts parse yielded at least one amount row",
      ],
    },
    summary: {
      requestedBrands: brands.length,
      selected: selected.length,
      skipped: skipped.length,
      byBrand: selected.reduce((acc, row) => {
        acc[row.brandName] = (acc[row.brandName] ?? 0) + 1;
        return acc;
      }, {}),
    },
    skipped,
    products: selected,
  };
};

export const collectExcludedIdsFromStagingFiles = async (filePaths) => {
  const excludeGtins = new Set();
  const excludeProductIds = new Set();

  for (const filePath of filePaths.filter(Boolean)) {
    const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
    const products = Array.isArray(payload?.products) ? payload.products : [];
    for (const row of products) {
      const gtin = normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode);
      const productId = normalizeText(row?.productId);
      if (gtin) excludeGtins.add(gtin);
      if (productId) excludeProductIds.add(productId);
    }
  }

  return { excludeGtins, excludeProductIds };
};

export const renderCanadianOfficialWaveMarkdown = (payload) => {
  const lines = [
    "# Canadian Official Merge Wave",
    "",
    `- generatedAt: ${payload.generatedAt}`,
    `- waveId: ${payload.selectionPolicy.waveId}`,
    `- selected: ${payload.summary.selected}`,
    `- skipped: ${payload.summary.skipped}`,
    "",
    "## By Brand",
    "",
  ];
  for (const [brand, count] of Object.entries(payload.summary.byBrand)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("", "## Products", "");
  for (const row of payload.products) {
    const firstFact = row.supplementFacts?.nutritionalFacts?.[0]?.substancy ?? "n/a";
    lines.push(`- ${row.brandName} | ${row.title} | ${row.barcode_gtin14} | first=${firstFact}`);
  }
  return `${lines.join("\n")}\n`;
};

export const writeCanadianOfficialMergeWave = async ({ payload, outDir, fileStem }) => {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${fileStem}.json`);
  const mdPath = path.join(outDir, `${fileStem}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderCanadianOfficialWaveMarkdown(payload), "utf8");
  return { jsonPath, mdPath };
};
