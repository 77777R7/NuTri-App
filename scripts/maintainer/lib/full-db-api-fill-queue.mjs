import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./iherb-overlay-utils.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const FACT_NAME_NOISE_PATTERN =
  /^(?:amount per serving|serving size|servings? per container|daily value|% daily value|ingredients?)$/i;

const FOOD_LIKE_TITLE_PATTERN =
  /\b(?:protein\s+bar|nutrition\s+bar|bar\b|cookie|cracker|pretzel|chips?|popcorn|snack|bites?|chocolate|candy|jelly\s+beans?|gummy\s+bears?|energy\s+gel|go\s+gel|gel\b|drink\s+mix|beverage|smoothie|latte|coffee|tea\s+bags?|herbal\s+tea|broth|soup|sauce|dressing|syrup|coconut\s+aminos|soy\s+sauce\s+replacement|jerky|tuna|sardines?|salmon|jam|jelly|gravy|seasoning(?:\s+mix)?|finishing\s+salt|garlic\s+salt|salt\b|dry\s+rub|rub\b|scone\s+mix|pancake(?:\s*&\s*waffle)?\s+mix|cornbread\s+mix|baking\s+powder)\b/i;

const FOOD_LIKE_CATEGORY_PATTERN =
  /\b(?:grocery|foods?|snacks?|beverages?|pantry|candy|chocolate|tea|coffee|sauces?|soups?|broth|crackers?|popcorn|bars?|spices?|seasonings?|condiments?|baking)\b/i;

const FOOD_LIKE_HONESTY_WIN_PATTERN =
  /\b(?:protein\s+bar|nutrition\s+bar|energy\s+gel|go\s+gel|drink\s+mix|coconut\s+aminos|soy\s+sauce\s+replacement|bar\b|gel\b|cookie|cracker|popcorn|chocolate|candy|jelly\s+beans?|gummy\s+bears?|jam|jelly|seasoning(?:\s+mix)?|finishing\s+salt|garlic\s+salt|dry\s+rub|scone\s+mix|pancake(?:\s*&\s*waffle)?\s+mix|cornbread\s+mix|baking\s+powder)\b/i;

const SUPPLEMENT_TITLE_PATTERN =
  /\b(?:vitamin|mineral|multivitamin|b[\s-]*complex|probiotic|prebiotic|microbiome|omega|dha|epa|fish oil|krill|algal|algae oil|sleep|melatonin|5-htp|theanine|gaba|ashwagandha|green tea|fiber|psyllium|inulin|electrolyte|hydration|creatine|collagen|protein|whey|soy protein|pea protein|magnesium|calcium|zinc|potassium|iron|folate|b12|d3|nac|acetyl|enzyme|extract|amino|capsules?|softgels?|tablets?|caplets?|powder|drops?|liquid|spray|lozenges?|vegcaps?|soft chews?|chewables?|gummies)\b/i;

const SUPPLEMENT_CATEGORY_PATTERN =
  /\b(?:vitamins?|minerals?|supplements?|sports nutrition|amino acids?|herbs?|botanicals?|fish oil|omega|probiotics?|fiber|protein|digestive support|sleep)\b/i;

const SUPPLEMENT_DOSAGE_FORM_PATTERN =
  /\b(?:capsules?|softgels?|tablets?|caplets?|powder|drops?|liquid|spray|lozenges?|vegcaps?|soft chews?|chewables?|gummies)\b/i;

const SECTION_KEY_ALIASES = {
  suggested_use: new Set([
    "suggesteduse",
    "suggestedusage",
    "suggesteddirections",
    "directions",
    "direction",
    "recommendeduse",
    "howtouse",
    "usage",
  ]),
  warnings: new Set([
    "warnings",
    "warning",
    "disclaimer",
    "safetyinformation",
    "caution",
    "cautions",
  ]),
};

const normalizeKey = (value) => normalizeLower(value).replace(/[^a-z0-9]+/g, "");

const flattenTextValues = (value) => {
  if (typeof value === "string" || typeof value === "number") {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap(flattenTextValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(flattenTextValues);
};

const toTextList = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    const text = normalizeText(value);
    return text ? [text] : [];
  }
  return flattenTextValues(value);
};

export const readNutritionRows = (supplementFacts) => {
  if (!supplementFacts || typeof supplementFacts !== "object") return [];
  const rows =
    (Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : null) ??
    (Array.isArray(supplementFacts.nutritional_facts) ? supplementFacts.nutritional_facts : null) ??
    [];
  return Array.isArray(rows) ? rows : [];
};

const readFactName = (row) =>
  normalizeText(
    row?.substancy ?? row?.substance ?? row?.substance_name ?? row?.name ?? row?.ingredient ?? null,
  );

const readFactAmount = (row) =>
  normalizeText(
    row?.amountPerServing ?? row?.amount_per_serving ?? row?.amount ?? row?.value ?? row?.dose ?? null,
  );

const hasMeaningfulFactName = (row) => {
  const name = readFactName(row);
  if (!name) return false;
  return !FACT_NAME_NOISE_PATTERN.test(name);
};

const hasMeaningfulFactAmount = (row) => {
  const amount = readFactAmount(row);
  if (!amount) return false;
  return !FACT_NAME_NOISE_PATTERN.test(amount);
};

const readSectionText = (sections, targetKey) => {
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return "";
  const aliases = SECTION_KEY_ALIASES[targetKey] ?? new Set();
  for (const [key, value] of Object.entries(sections)) {
    if (!aliases.has(normalizeKey(key))) continue;
    const text = normalizeText(flattenTextValues(value).join(" "));
    if (text) return text;
  }
  return "";
};

const hasImageCoverage = (row) =>
  Boolean(normalizeText(row?.product_catalog_image)) || toTextList(row?.product_images).length > 0;

export const detectMissingCoreFields = (row) => {
  const nutritionRows = readNutritionRows(row?.supplement_facts);
  const hasIngredient = nutritionRows.some((fact) => hasMeaningfulFactName(fact));
  const hasDosage = nutritionRows.some((fact) => hasMeaningfulFactAmount(fact));
  const hasSuggestedUse = Boolean(readSectionText(row?.description_sections, "suggested_use"));
  const hasWarnings = Boolean(readSectionText(row?.description_sections, "warnings"));
  const hasProductImage = hasImageCoverage(row);

  const coreMissingFields = [];
  if (!hasIngredient) coreMissingFields.push("ingredient");
  if (!hasDosage) coreMissingFields.push("dosage");
  if (!hasSuggestedUse) coreMissingFields.push("suggested_use");
  if (!hasWarnings) coreMissingFields.push("warnings");
  if (!hasProductImage) coreMissingFields.push("product_image");

  return {
    coreMissingFields,
    coreResolvedFields: ["ingredient", "dosage", "suggested_use", "warnings", "product_image"].filter(
      (field) => !coreMissingFields.includes(field),
    ),
    factsCount: nutritionRows.length,
    hasIngredient,
    hasDosage,
    hasSuggestedUse,
    hasWarnings,
    hasProductImage,
  };
};

export const classifyProductKind = (row) => {
  const title = normalizeText(row?.title);
  const titleLower = normalizeLower(title);
  const categoriesText = toTextList(row?.categories).join(" | ");

  const reasons = [];
  let foodSignals = 0;
  let supplementSignals = 0;

  if (FOOD_LIKE_TITLE_PATTERN.test(titleLower)) {
    reasons.push("title_food_like");
    foodSignals += 2;
  }
  if (FOOD_LIKE_CATEGORY_PATTERN.test(categoriesText)) {
    reasons.push("category_food_like");
    foodSignals += 1;
  }
  if (FOOD_LIKE_HONESTY_WIN_PATTERN.test(titleLower)) {
    reasons.push("explicit_food_form");
    foodSignals += 3;
  }

  if (SUPPLEMENT_TITLE_PATTERN.test(titleLower)) {
    reasons.push("title_supplement_signal");
    supplementSignals += 2;
  }
  if (SUPPLEMENT_CATEGORY_PATTERN.test(categoriesText)) {
    reasons.push("category_supplement_signal");
    supplementSignals += 1;
  }
  if (SUPPLEMENT_DOSAGE_FORM_PATTERN.test(titleLower)) {
    reasons.push("dosage_form_signal");
    supplementSignals += 1;
  }
  if (readNutritionRows(row?.supplement_facts).some((fact) => hasMeaningfulFactName(fact) || hasMeaningfulFactAmount(fact))) {
    reasons.push("structured_facts_present");
    supplementSignals += 1;
  }

  if (foodSignals > 0 && (FOOD_LIKE_HONESTY_WIN_PATTERN.test(titleLower) || foodSignals >= supplementSignals)) {
    return { productKind: "food_like", reasonCodes: reasons };
  }
  if (supplementSignals > 0) {
    return { productKind: "supplement_like", reasonCodes: reasons };
  }
  if (foodSignals > 0) {
    return { productKind: "food_like", reasonCodes: reasons };
  }
  return {
    productKind: "supplement_like",
    reasonCodes: [...reasons, "default_supplement_context"],
  };
};

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const loadBrandSupportIndex = async () => {
  const officialDir = path.join(ROOT_DIR, "data", "iherb_official_fallback_configs");
  const rapidApiMapPath = path.join(ROOT_DIR, "data", "iherb_rapidapi_brand_map.json");

  const officialConfigByBrand = new Map();
  const officialEntries = await fs.readdir(officialDir, { withFileTypes: true });
  for (const entry of officialEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "template.brand.json") continue;
    const configPath = path.join(officialDir, entry.name);
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    const brandName = normalizeText(config?.brandName);
    if (!brandName) continue;
    officialConfigByBrand.set(normalizeLower(brandName), {
      brandName,
      configPath: path.relative(ROOT_DIR, configPath),
      priorityLane: normalizeText(config?.priorityLane) || "P0_api_fill_us_strong_identity",
    });
  }

  const rapidApiByBrand = new Map();
  const rapidApiMap = JSON.parse(await fs.readFile(rapidApiMapPath, "utf8"));
  for (const brand of Array.isArray(rapidApiMap?.brands) ? rapidApiMap.brands : []) {
    const brandName = normalizeText(brand?.brandName);
    const brandSlug = normalizeText(brand?.brandSlug);
    const status = normalizeLower(brand?.status);
    if (!brandName || status !== "available" || !brandSlug) continue;
    rapidApiByBrand.set(normalizeLower(brandName), {
      brandName,
      brandSlug,
    });
  }

  return { officialConfigByBrand, rapidApiByBrand };
};

export const recommendExecution = ({ brandName, productKind, missingCoreFields, brandSupportIndex }) => {
  if (productKind === "food_like") {
    return {
      priorityLane: null,
      recommendedRunner: "route_honesty_audit_only",
      recommendedAction: "route_honesty_audit",
      configPath: null,
      rapidApiBrandSlug: null,
    };
  }

  const normalizedBrand = normalizeLower(brandName);
  const officialConfig = brandSupportIndex?.officialConfigByBrand?.get(normalizedBrand) ?? null;
  if (officialConfig) {
    return {
      priorityLane: officialConfig.priorityLane ?? "P0_api_fill_us_strong_identity",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedAction:
        missingCoreFields.includes("ingredient") || missingCoreFields.includes("dosage")
          ? "recover_facts"
          : "recover_soft_fields",
      configPath: officialConfig.configPath,
      rapidApiBrandSlug: null,
    };
  }

  const rapidApiBrand = brandSupportIndex?.rapidApiByBrand?.get(normalizedBrand) ?? null;
  if (rapidApiBrand) {
    return {
      priorityLane: "P0_api_fill_us_strong_identity",
      recommendedRunner: "run-iherb-missing-brand-rapidapi-wave",
      recommendedAction:
        missingCoreFields.includes("ingredient") || missingCoreFields.includes("dosage")
          ? "recover_facts"
          : "recover_soft_fields",
      configPath: null,
      rapidApiBrandSlug: rapidApiBrand.brandSlug,
    };
  }

  return {
    priorityLane: "P0_api_fill_us_strong_identity",
    recommendedRunner: "needs_brand_support_onboarding",
    recommendedAction:
      missingCoreFields.includes("ingredient") || missingCoreFields.includes("dosage")
        ? "recover_facts"
        : "recover_soft_fields",
    configPath: null,
    rapidApiBrandSlug: null,
  };
};

export const buildExecutableQueueRow = ({ row, brandSupportIndex }) => {
  const brandName = normalizeText(row?.brand_name);
  const title = normalizeText(row?.title);
  const core = detectMissingCoreFields(row);
  const classification = classifyProductKind(row);

  let lane = null;
  let closureBucket = null;
  if (
    classification.productKind === "supplement_like" &&
    core.factsCount === 0 &&
    (core.coreMissingFields.includes("ingredient") || core.coreMissingFields.includes("dosage"))
  ) {
    lane = "lane_a_hard_facts";
    closureBucket = "full_db_hard_facts";
  } else if (
    classification.productKind === "supplement_like" &&
    core.coreMissingFields.some((field) => ["suggested_use", "warnings", "product_image"].includes(field))
  ) {
    lane = "lane_b_soft_fields_supplement_like";
    closureBucket = "full_db_supplement_like_soft_fields";
  } else if (classification.productKind === "food_like" && core.coreMissingFields.length > 0) {
    lane = "lane_c_food_like_route_honesty";
    closureBucket = "full_db_food_like_route_honesty";
  }

  if (!lane) return null;

  const execution = recommendExecution({
    brandName,
    productKind: classification.productKind,
    missingCoreFields: core.coreMissingFields,
    brandSupportIndex,
  });

  return {
    lane,
    productId: normalizeText(row?.product_id) || null,
    brandName: brandName || null,
    title: title || null,
    barcode_gtin14: normalizeText(row?.barcode_gtin14) || null,
    barcode: normalizeText(row?.barcode_gtin14 ?? row?.upc_code) || null,
    link: normalizeText(row?.link) || null,
    priorityLane: execution.priorityLane,
    closureBucket,
    missingFields: core.coreMissingFields,
    coreMissingFields: core.coreMissingFields,
    coreResolvedFields: core.coreResolvedFields,
    factsCount: core.factsCount,
    recommendedRunner: execution.recommendedRunner,
    recommendedAction: execution.recommendedAction,
    recommendedConfigPath: execution.configPath,
    rapidApiBrandSlug: execution.rapidApiBrandSlug,
    classification: {
      productKind: classification.productKind,
      reasonCodes: classification.reasonCodes,
    },
    source: {
      table: "iherb_overlay_products",
      basis: "full_db_api_fill_queue.v1",
    },
  };
};

const increment = (map, key, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const topEntries = (map, keyName, limit = 15) =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));

export const summarizeApiFillQueue = (queueRows, { totalRows = 0 } = {}) => {
  const laneCounts = new Map();
  const runnerCounts = new Map();
  const comboCounts = new Map();
  const brandCountsByLane = new Map();
  const examplesByLane = new Map();

  for (const row of queueRows) {
    increment(laneCounts, row.lane);
    increment(runnerCounts, row.recommendedRunner);
    increment(comboCounts, row.coreMissingFields.join("+") || "none");

    if (!brandCountsByLane.has(row.lane)) brandCountsByLane.set(row.lane, new Map());
    if (!examplesByLane.has(row.lane)) examplesByLane.set(row.lane, []);

    increment(brandCountsByLane.get(row.lane), row.brandName || "unknown_brand");
    const examples = examplesByLane.get(row.lane);
    if (examples.length < 10) {
      examples.push({
        productId: row.productId,
        brandName: row.brandName,
        title: row.title,
        missingFields: row.coreMissingFields,
        recommendedRunner: row.recommendedRunner,
      });
    }
  }

  return {
    schemaVersion: "full_db_api_fill_queue.v1",
    generatedAt: new Date().toISOString(),
    totals: {
      overlayProducts: totalRows,
      queued: queueRows.length,
      lane_a_hard_facts: laneCounts.get("lane_a_hard_facts") ?? 0,
      lane_b_soft_fields_supplement_like: laneCounts.get("lane_b_soft_fields_supplement_like") ?? 0,
      lane_c_food_like_route_honesty: laneCounts.get("lane_c_food_like_route_honesty") ?? 0,
    },
    runnerRollup: topEntries(runnerCounts, "recommendedRunner", 10),
    missingFieldCombos: topEntries(comboCounts, "combo", 20),
    brandRollup: Object.fromEntries(
      [...brandCountsByLane.entries()].map(([lane, counts]) => [lane, topEntries(counts, "brandName", 20)]),
    ),
    examplesByLane: Object.fromEntries([...examplesByLane.entries()]),
  };
};

export const renderApiFillQueueMarkdown = (summary) => {
  const lines = [
    "# Full DB API Fill Queue",
    "",
    `- overlayProducts: ${summary?.totals?.overlayProducts ?? 0}`,
    `- queued: ${summary?.totals?.queued ?? 0}`,
    `- lane_a_hard_facts: ${summary?.totals?.lane_a_hard_facts ?? 0}`,
    `- lane_b_soft_fields_supplement_like: ${summary?.totals?.lane_b_soft_fields_supplement_like ?? 0}`,
    `- lane_c_food_like_route_honesty: ${summary?.totals?.lane_c_food_like_route_honesty ?? 0}`,
    "",
    "## Runner Rollup",
    "",
  ];

  for (const row of summary?.runnerRollup ?? []) {
    lines.push(`- ${row.recommendedRunner}: ${row.count}`);
  }

  lines.push("", "## Missing Field Combos", "");
  for (const row of summary?.missingFieldCombos ?? []) {
    lines.push(`- ${row.combo}: ${row.count}`);
  }

  lines.push("", "## Brand Rollup", "");
  for (const [lane, rows] of Object.entries(summary?.brandRollup ?? {})) {
    lines.push(`### ${lane}`, "");
    for (const row of rows) {
      lines.push(`- ${row.brandName}: ${row.count}`);
    }
    lines.push("");
  }

  lines.push("## Examples", "");
  for (const [lane, rows] of Object.entries(summary?.examplesByLane ?? {})) {
    lines.push(`### ${lane}`, "");
    for (const row of rows) {
      lines.push(
        `- ${row.productId || "n/a"} | ${row.brandName || "n/a"} | ${row.title || "n/a"} | missing=${(row.missingFields ?? []).join(", ") || "none"} | runner=${row.recommendedRunner || "n/a"}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

export const writeApiFillQueueOutputs = async ({
  queueRows,
  summary,
  outDir = "output/full_db_api_fill_queue",
}) => {
  const hardFactsRows = queueRows.filter((row) => row.lane === "lane_a_hard_facts");
  const softFieldRows = queueRows.filter((row) => row.lane === "lane_b_soft_fields_supplement_like");
  const foodLikeRows = queueRows.filter((row) => row.lane === "lane_c_food_like_route_honesty");
  const byRunner = queueRows.reduce((acc, row) => {
    const key = row.recommendedRunner ?? "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const timestamp = String(Date.now());
  const outputDir = path.join(outDir, timestamp);

  await writeJson(path.join(outputDir, "api_fill_queue.all.json"), queueRows);
  await writeJson(path.join(outputDir, "api_fill_queue.hard_facts.json"), hardFactsRows);
  await writeJson(path.join(outputDir, "api_fill_queue.soft_fields_supplement_like.json"), softFieldRows);
  await writeJson(path.join(outputDir, "api_fill_queue.food_like_route_honesty.json"), foodLikeRows);
  await writeJson(path.join(outputDir, "api_fill_queue.by_runner.json"), byRunner);
  await writeJson(path.join(outputDir, "api_fill_queue.summary.json"), summary);
  await writeText(path.join(outputDir, "api_fill_queue.md"), renderApiFillQueueMarkdown(summary));

  return {
    outputDir: path.join(outDir, timestamp),
    files: {
      all: path.join(outputDir, "api_fill_queue.all.json"),
      hardFacts: path.join(outputDir, "api_fill_queue.hard_facts.json"),
      softFields: path.join(outputDir, "api_fill_queue.soft_fields_supplement_like.json"),
      foodLike: path.join(outputDir, "api_fill_queue.food_like_route_honesty.json"),
      byRunner: path.join(outputDir, "api_fill_queue.by_runner.json"),
      summary: path.join(outputDir, "api_fill_queue.summary.json"),
      markdown: path.join(outputDir, "api_fill_queue.md"),
    },
  };
};
