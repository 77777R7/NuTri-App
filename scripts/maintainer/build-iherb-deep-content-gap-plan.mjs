#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

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
  path.join(ROOT, "output", "iherb_healthy_origins_p0_official_ocr_final_20260313", "staging_products.official_refreshed.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_healthy_origins_final_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_deep_content_gap_plan_${TODAY}`),
);

const {
  compileDecisionSupport,
} = await import("../../backend/src/decisionSupport.ts");
const {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
} = await import("../../backend/src/factsDigest.ts");
const {
  normalizeIherbSupplementFactsRows,
} = await import("../../backend/src/iherbOverlayIngredients.ts");
const {
  isNutritionLabelLikeIngredientName,
} = await import("../../backend/src/scoring/nutritionLabelLikeLexicon.ts");

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));
const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;

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
  return digest;
};

const getDeepContentStatus = (payload) => {
  const overview = payload?.overviewBlock;
  const science = payload?.scienceBlock;
  const usage = payload?.usageBlock;
  const safety = payload?.safetyBlock;

  const overviewOk =
    Array.isArray(overview?.bestForBullets) && overview.bestForBullets.length > 0
    && Array.isArray(overview?.providesVerified?.keyIngredients) && overview.providesVerified.keyIngredients.length > 0;
  const scienceOk =
    Array.isArray(science?.ingredientRows) && science.ingredientRows.length > 0
    && Array.isArray(science?.aiSummaryContract3) && science.aiSummaryContract3.length === 3;
  const usageOk =
    hasText(usage?.directions?.text)
    && Array.isArray(usage?.directions?.lines) && usage.directions.lines.length > 0;
  const safetyOk =
    (Array.isArray(safety?.labelWarnings) && safety.labelWarnings.length > 0)
    || (Array.isArray(safety?.generalWatchouts) && safety.generalWatchouts.length > 0)
    || (Array.isArray(safety?.ulGuidance) && safety.ulGuidance.length > 0);

  return {
    ready: overviewOk && scienceOk && usageOk && safetyOk,
    overviewOk,
    scienceOk,
    usageOk,
    safetyOk,
  };
};

const classifyFactType = (row) => {
  const facts = Array.isArray(row?.supplementFacts?.nutritionalFacts) ? row.supplementFacts.nutritionalFacts : [];
  const substanceRows = facts.filter((item) => hasText(item?.substancy));
  const normalized = normalizeIherbSupplementFactsRows(facts);

  if (normalized.length > 0) return "has_extractable_ingredients";
  if (substanceRows.length === 0) return "header_only_facts";

  const nutritionLikeCount = substanceRows.filter((item) =>
    isNutritionLabelLikeIngredientName(safeText(item?.substancy))).length;

  if (nutritionLikeCount === substanceRows.length) return "nutrition_only_facts";
  return "named_rows_unparsed";
};

const CANDIDATE_CATEGORY_RULES = [
  {
    id: "vitamin_c",
    label: "Vitamin C / Ascorbic Acid",
    regex: /\b(vitamin\s*c|ascorbic\s*acid|sodium\s+ascorbate)\b/i,
    tier: "P0",
  },
  {
    id: "collagen",
    label: "Collagen",
    regex: /\bcollagen\b/i,
    tier: "P0",
  },
  {
    id: "protein",
    label: "Protein / Whey / Plant Protein",
    regex: /\b(whey\s+protein|protein|pea\s+protein|plant\s+protein|casein)\b/i,
    tier: "P1",
  },
  {
    id: "turmeric_curcumin",
    label: "Turmeric / Curcumin",
    regex: /\b(turmeric|curcumin)\b/i,
    tier: "P0",
  },
  {
    id: "melatonin",
    label: "Melatonin",
    regex: /\bmelatonin\b/i,
    tier: "P0",
  },
  {
    id: "coq10",
    label: "CoQ10 / Ubiquinol",
    regex: /\b(co\s*q-?10|coenzyme\s*q10|ubiquinol|ubiquinone)\b/i,
    tier: "P0",
  },
  {
    id: "creatine",
    label: "Creatine",
    regex: /\bcreatine\b/i,
    tier: "P0",
  },
  {
    id: "b12",
    label: "Vitamin B12",
    regex: /\b(vitamin\s*b12|b-?12|methylcobalamin|cyanocobalamin|adenosylcobalamin)\b/i,
    tier: "P1",
  },
  {
    id: "digestive_enzymes",
    label: "Digestive Enzymes",
    regex: /\b(digestive\s+enzymes?|papaya\s+enzyme)\b/i,
    tier: "P1",
  },
  {
    id: "zinc",
    label: "Zinc",
    regex: /\bzinc\b/i,
    tier: "P1",
  },
  {
    id: "berberine",
    label: "Berberine",
    regex: /\bberberine\b/i,
    tier: "P1",
  },
  {
    id: "nac",
    label: "NAC / N-Acetyl-L-Cysteine",
    regex: /\b(nac|n-?acetyl-?l-?cysteine)\b/i,
    tier: "P1",
  },
];

const bump = (map, key) => {
  map[key] = (map[key] ?? 0) + 1;
};

const topEntries = (objectMap, limit) =>
  Object.entries(objectMap)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Deep Content Gap Plan");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- stagingPath: ${report.inputs.stagingPath}`);
  lines.push(`- mergeReportPath: ${report.inputs.mergeReportPath}`);
  lines.push(`- importedTotal: ${report.summary.importedTotal}`);
  lines.push(`- deepContentGapTotal: ${report.summary.deepContentGapTotal}`);
  lines.push(`- unknownCategoryTotal: ${report.summary.unknownCategoryTotal}`);
  lines.push("");
  lines.push("## Deep Content Gap");
  lines.push("");
  for (const [factType, count] of topEntries(report.deepGap.factTypeCounts, 10)) {
    lines.push(`- ${factType}: ${count}`);
  }
  lines.push("");
  lines.push("## Best First Wave");
  lines.push("");
  for (const item of report.deepGap.bestFirstWave) {
    lines.push(`- ${item.brand}: ${item.count} | ${item.factType}`);
  }
  lines.push("");
  lines.push("## Unknown Category Expansion Priority");
  lines.push("");
  for (const item of report.categoryExpansion.priorityList) {
    lines.push(`- ${item.tier} | ${item.label}: ${item.count} products across ${item.brandCount} brands`);
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingPayload = await readJson(STAGING_PATH);
  const mergePayload = await readJson(MERGE_REPORT_PATH);
  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );
  const imported = products.filter((row) => matchedIds.has(String(row?.productId ?? "")));

  const deepGapRows = [];
  const unknownRows = [];
  const factTypeCounts = {};
  const brandCounts = {};
  const brandTypeCounts = {};

  const categoryPriority = new Map(
    CANDIDATE_CATEGORY_RULES.map((rule) => [rule.id, { ...rule, count: 0, brands: new Set(), samples: [] }]),
  );

  for (const row of imported) {
    const overlayClaims = toOverlayClaims(row);
    const digest = toFactsDigest(row, overlayClaims);
    const factsDigestHash = computeFactsDigestHash(digest);
    const payload = compileDecisionSupport({
      digest,
      factsDigestHash,
      viewMode: "details",
      locale: "en",
      flagsSnapshot: null,
      patchActivation: null,
      overlayClaims,
    });

    const deepStatus = getDeepContentStatus(payload);
    if (!deepStatus.ready) {
      const factType = classifyFactType(row);
      deepGapRows.push({
        brand: safeText(row.brandName),
        title: safeText(row.title),
        barcode: safeText(row.barcode_gtin14),
        factType,
        categoryId: safeText(payload.categoryId) || "unknown",
      });
      bump(factTypeCounts, factType);
      bump(brandCounts, safeText(row.brandName) || "unknown");
      bump(brandTypeCounts, `${safeText(row.brandName) || "unknown"}||${factType}`);
    }

    if (payload.categoryId === "unknown") {
      unknownRows.push(row);
      const haystack = [safeText(row.title), ...(Array.isArray(row.categories) ? row.categories.map((item) => safeText(item)) : [])].join(" | ");
      for (const rule of CANDIDATE_CATEGORY_RULES) {
        if (!rule.regex.test(haystack)) continue;
        const entry = categoryPriority.get(rule.id);
        if (!entry) continue;
        entry.count += 1;
        entry.brands.add(safeText(row.brandName) || "unknown");
        if (entry.samples.length < 5) {
          entry.samples.push({
            brand: safeText(row.brandName),
            title: safeText(row.title),
            barcode: safeText(row.barcode_gtin14),
          });
        }
      }
    }
  }

  const bestFirstWave = Object.entries(brandTypeCounts)
    .map(([key, count]) => {
      const [brand, factType] = key.split("||");
      return { brand, factType, count };
    })
    .filter((item) => item.factType === "header_only_facts")
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);

  const priorityList = [...categoryPriority.values()]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      tier: entry.tier,
      count: entry.count,
      brandCount: entry.brands.size,
      samples: entry.samples,
    }))
    .sort((left, right) => right.count - left.count);

  const report = {
    schemaVersion: "iherb_deep_content_gap_plan.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: path.relative(ROOT, STAGING_PATH),
      mergeReportPath: path.relative(ROOT, MERGE_REPORT_PATH),
    },
    summary: {
      importedTotal: imported.length,
      deepContentGapTotal: deepGapRows.length,
      unknownCategoryTotal: unknownRows.length,
    },
    deepGap: {
      factTypeCounts,
      topBrands: topEntries(brandCounts, 25).map(([brand, count]) => ({ brand, count })),
      topBrandTypeCombos: Object.entries(brandTypeCounts)
        .map(([key, count]) => {
          const [brand, factType] = key.split("||");
          return { brand, factType, count };
        })
        .sort((left, right) => right.count - left.count)
        .slice(0, 40),
      bestFirstWave,
      sampleRows: deepGapRows.slice(0, 30),
    },
    categoryExpansion: {
      priorityList,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outJson = path.join(OUT_DIR, "deep_content_gap_plan.json");
  const outMd = path.join(OUT_DIR, "deep_content_gap_plan.md");
  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, toMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: true,
    summary: report.summary,
    outputs: {
      json: path.relative(ROOT, outJson),
      md: path.relative(ROOT, outMd),
    },
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
