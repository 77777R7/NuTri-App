import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { FactsDigest } from "../src/factsDigest.js";
import {
  buildIngredientScienceContext,
  type IngredientScienceIngredientFamily,
} from "../src/ingredientScienceContext.js";
import { getScientificBackgroundEvidence } from "../src/insights/scientificBackgroundEvidencePackage.js";
import {
  buildScientificBackgroundDeterministicFallback,
  planScientificBackgroundSections,
} from "../src/insights/scientificBackgroundCompiler.js";
import {
  getNutriMinimalDefinitionForFamily,
  NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS,
  type NutriMinimalFullFamilyDefinition,
  type NutriMinimalProductizationClass,
  type NutriMinimalSafetyBoundaryTier,
} from "../src/nutriMinimalFullFamilyProductization.js";

type ReviewStatus = "approved" | "needs_edit" | "rejected";

type RegistryRow = {
  family: string;
  lane: string;
  review_status: ReviewStatus;
  review_reasons?: string[];
  plugin_verified_pmids?: Array<{ pmid?: string | null; title?: string | null }>;
  selection_notes?: string[];
};

type ReplayTarget = {
  family: IngredientScienceIngredientFamily;
  sourceIngredientId: string;
  displayName: string;
  category: string;
  productizationClass: NutriMinimalProductizationClass | "existing_runtime_family";
  safetyBoundaryTier: NutriMinimalSafetyBoundaryTier;
  patternKeywords: string[];
  pattern: RegExp;
  primaryLane: string;
  hardBoundary: string;
  required: boolean;
};

type ProductCandidate = {
  sourceFile: string;
  productId: string | null;
  barcode: string | null;
  url: string | null;
  brand: string | null;
  title: string;
  description: string | null;
  suggestedUse: string | null;
  warnings: string | null;
  ingredientRows: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    amountText: string | null;
  }>;
};

type ReplayRow = {
  family: string;
  source_ingredient_id: string;
  display_name: string;
  required: boolean;
  productization_class: string;
  safety_boundary_tier: NutriMinimalSafetyBoundaryTier;
  category: string;
  replay_product: {
    source_file: string | null;
    product_id: string | null;
    barcode: string | null;
    url: string | null;
    brand: string | null;
    title: string;
    facts_quality: "structured_ingredients" | "title_plus_description" | "title_only";
    ingredient_rows: Array<{
      name: string;
      amountText: string | null;
    }>;
  };
  inference: {
    pass: boolean;
    expected_family: string;
    context_family: string;
    anchor_family: string | null;
    selected_descriptor_family: string | null;
    selected_descriptor_name: string | null;
    descriptor_families: string[];
  };
  scientific_background: {
    pass: boolean;
    mode: string;
    family: string;
    headings: string[];
    heading_ids: string[];
    generic_hits: string[];
    contains_family_label: boolean;
    sample_summary: string | null;
    sample_evidence_read: string | null;
    sample_shopper_meaning: string | null;
  };
  evidence_grounding: {
    pass: boolean;
    primary_lane: string;
    registry_review_status: ReviewStatus | "missing";
    registry_review_reasons: string[];
    reviewed_evidence_found: boolean;
    live_grounding_status: "approved_reviewed_row" | "blocked_no_reviewed_row";
    expected_blocked_from_registry: boolean;
    first_reference_id: string | null;
    reference_count: number;
    registry_traceability_warning: boolean;
  };
  safety_claim_gate: {
    pass: boolean;
    unsafe_sentences: string[];
  };
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT, "..");
const STAGING_DIR = path.join(ROOT, "data", "staging", "nutri-minimal-v4");
const REGISTRY_PATH = path.join(
  STAGING_DIR,
  "scientific-evidence-candidate-registry.json",
);
const REPLAY_PACK_PATH = path.join(
  STAGING_DIR,
  "real-product-family-replay-pack.json",
);
const REPLAY_MARKDOWN_PATH = path.join(
  STAGING_DIR,
  "real-product-family-replay-pack.md",
);

const REAL_PRODUCT_SOURCE_FILES = [
  "backend/data/staging/nutri-minimal-v4/real-product-replay-source-fixtures.json",
  "backend/data/personalization/goal_navigator_candidate_bundle.v1.json",
  "data/validation/stable-gate-baseline.v1.json",
  "data/validation/canadian-upc-explicit-next-lane.v0.json",
  "output/rapidapi_yield_first_apply_candidate_1776541800000_retry1600/merge_report/overlay_merge_coverage_report.json",
  "output/rapidapi_yield_first_apply_candidate_1776541800000_retry1600/merge_report_apply/overlay_merge_coverage_report.json",
  "output/rapidapi_yield_first_apply_candidate_1776541800000_retry1600/raw_brand_fetches.json",
  "output/rapidapi_yield_first_apply_candidate_1776541800000_retry1600/staging_products.rapidapi_missing_brand_wave.json",
  "output/onboarding_remaining28_rapidapi_wave_retry_1776571000000/merge_report/overlay_merge_coverage_report.json",
  "output/onboarding_remaining28_rapidapi_wave_retry_1776571000000/merge_report_apply/overlay_merge_coverage_report.json",
  "output/onboarding_remaining28_rapidapi_wave_retry_1776571000000/raw_brand_fetches.json",
  "output/onboarding_remaining28_rapidapi_wave_retry_1776571000000/staging_products.rapidapi_missing_brand_wave.json",
  "output/onboarding_second20_rapidapi_wave_1776562000000/merge_report/overlay_merge_coverage_report.json",
  "output/onboarding_second20_rapidapi_wave_1776562000000/merge_report_apply/overlay_merge_coverage_report.json",
  "output/onboarding_second20_rapidapi_wave_1776562000000/raw_brand_fetches.json",
  "output/onboarding_second20_rapidapi_wave_1776562000000/staging_products.rapidapi_missing_brand_wave.json",
  "output/onboarding_top20_rapidapi_wave_1776558000000/merge_report/overlay_merge_coverage_report.json",
  "output/onboarding_top20_rapidapi_wave_1776558000000/merge_report_apply/overlay_merge_coverage_report.json",
  "output/full_db_api_fill_queue_after_top20_brand_map_1776557000000/1776544813874/api_fill_queue.by_runner.json",
  "output/full_db_api_fill_queue_after_food_honesty_1776545200000/1776543023667/api_fill_queue.by_runner.json",
  "output/full_db_api_fill_queue_after_onboarding_final5_apply_1776574000000/1776547384961/api_fill_queue.by_runner.json",
  "output/full_db_api_fill_queue_after_tropical_oasis_closure_v1_1776586000000/1776549081247/api_fill_queue.by_runner.json",
  "output/full_db_api_fill_queue_after_partial_conversion_merge_apply_v1_1776581700000/1776548349041/api_fill_queue.by_runner.json",
  "output/current57_partial_conversion_merge_1776581500000/current_staging_products.payload.json",
] as const;

const REQUIRED_FAMILIES: IngredientScienceIngredientFamily[] = [
  "same",
  "tocotrienols",
  "devil_s_claw",
  "schisandra_chinensis",
  "red_yeast_rice",
  "pygeum",
  "milk_thistle",
  "tribulus_terrestris",
  "chaga_mushroom",
  "nadh",
];

const PREFERRED_REQUIRED_REPLAY_PRODUCT_IDS: Record<string, string> = {
  pygeum: "70044",
  tribulus_terrestris: "48458",
};

const EXTRA_HIGH_RISK_SAMPLE_LIMIT = 16;

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
};

const normalize = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeKey = (value: string | null | undefined): string =>
  normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickString = (
  source: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) return value;
  }
  return null;
};

const extractIherbProductIdFromUrl = (url: string | null): string | null => {
  if (!url) return null;
  const match = url.match(/\/(\d{3,})(?:[/?#]|$)/);
  return match?.[1] ?? null;
};

const parseDoseText = (
  value: unknown,
): { amount: number | null; unit: string | null; amountText: string | null } => {
  const text = readString(value);
  if (!text) return { amount: null, unit: null, amountText: null };
  const match = text.match(/([\d,.]+)\s*(mcg|mg|g|iu|cfu|billion|million)\b/i);
  return {
    amount: match?.[1] ? readNumber(match[1]) : null,
    unit: match?.[2] ?? null,
    amountText: text,
  };
};

const extractIngredientRows = (
  source: Record<string, unknown>,
): ProductCandidate["ingredientRows"] => {
  const rows: ProductCandidate["ingredientRows"] = [];
  const pushRow = (candidate: unknown): void => {
    if (!isRecord(candidate)) return;
    const name = pickString(candidate, [
      "ingredientLabel",
      "name",
      "substancy",
      "ingredient",
      "label",
    ]);
    if (!name) return;
    const dose =
      parseDoseText(candidate.dose).amountText !== null
        ? parseDoseText(candidate.dose)
        : parseDoseText(
            candidate.amountPerServing ??
              candidate.amountText ??
              candidate.amount_per_serving,
          );
    rows.push({
      name,
      amount: readNumber(candidate.amount) ?? dose.amount,
      unit: readString(candidate.unit) ?? dose.unit,
      amountText:
        dose.amountText ??
        (readNumber(candidate.amount) && readString(candidate.unit)
          ? `${readNumber(candidate.amount)} ${readString(candidate.unit)}`
          : null),
    });
  };

  for (const key of ["ingredientInputs", "overlayIngredients", "ingredients"]) {
    const value = source[key];
    if (Array.isArray(value)) value.forEach(pushRow);
  }

  const supplementFacts = source.supplementFacts;
  if (isRecord(supplementFacts)) {
    const nutritionalFacts = supplementFacts.nutritionalFacts;
    if (Array.isArray(nutritionalFacts)) nutritionalFacts.forEach(pushRow);
  }

  return rows.filter((row, index, arr) => {
    const key = `${normalize(row.name)}|${normalize(row.amountText)}`;
    return arr.findIndex((candidate) => `${normalize(candidate.name)}|${normalize(candidate.amountText)}` === key) === index;
  });
};

const extractProductCandidate = (
  value: Record<string, unknown>,
  sourceFile: string,
): ProductCandidate | null => {
  const title = pickString(value, [
    "title",
    "productName",
    "name",
    "displayName",
  ]);
  if (!title || title.length < 6) return null;

  const url = pickString(value, ["externalUrl", "link", "url", "productUrl"]);
  const productId =
    pickString(value, ["productId", "sourceProductId", "id"]) ??
    extractIherbProductIdFromUrl(url);
  const barcode = pickString(value, [
    "barcode",
    "barcode_gtin14",
    "barcodeGtin14",
    "gtin14",
    "upcCode",
  ]);
  if (!productId && !barcode && !url) return null;

  const brand =
    pickString(value, ["brandName", "brand", "brandDisplay"]) ??
    title.split(",")[0]?.trim() ??
    null;
  const description = pickString(value, [
    "description",
    "allDescription",
    "descriptionText",
  ]);
  const suggestedUse = pickString(value, [
    "suggestedUse",
    "suggested_use",
    "directions",
    "directionsText",
  ]);
  const warnings = pickString(value, [
    "warnings",
    "warning",
    "warningText",
    "warningsText",
  ]);

  return {
    sourceFile,
    productId,
    barcode,
    url,
    brand,
    title,
    description,
    suggestedUse,
    warnings,
    ingredientRows: extractIngredientRows(value),
  };
};

const collectProductCandidatesFromValue = (
  value: unknown,
  sourceFile: string,
  output: ProductCandidate[],
): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectProductCandidatesFromValue(item, sourceFile, output);
    return;
  }
  if (!isRecord(value)) return;

  const directCandidate = extractProductCandidate(value, sourceFile);
  if (directCandidate) output.push(directCandidate);

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectProductCandidatesFromValue(child, sourceFile, output);
    }
  }
};

const collectRealProductCandidates = async (): Promise<ProductCandidate[]> => {
  const candidates: ProductCandidate[] = [];
  for (const sourceFile of REAL_PRODUCT_SOURCE_FILES) {
    const absolutePath = path.join(REPO_ROOT, sourceFile);
    const parsed = await readJson<unknown>(absolutePath);
    if (!parsed) continue;
    collectProductCandidatesFromValue(parsed, sourceFile, candidates);
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.productId ?? ""}|${candidate.barcode ?? ""}|${normalize(candidate.brand)}|${normalize(candidate.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const manualRuntimeTarget = (
  params: Omit<ReplayTarget, "required" | "productizationClass">,
): ReplayTarget => ({
  ...params,
  productizationClass: "existing_runtime_family",
  required: true,
});

const targetFromDefinition = (
  definition: NutriMinimalFullFamilyDefinition,
  required: boolean,
  patternOverride?: RegExp,
): ReplayTarget => ({
  family: definition.canonicalFamily as IngredientScienceIngredientFamily,
  sourceIngredientId: definition.sourceIngredientId,
  displayName: definition.displayName,
  category: definition.category,
  productizationClass: definition.productizationClass,
  safetyBoundaryTier: definition.safetyBoundaryTier,
  patternKeywords: [...definition.patternKeywords],
  pattern: patternOverride ?? definition.pattern,
  primaryLane: primaryLaneForDefinition(definition),
  hardBoundary: definition.hardBoundary,
  required,
});

const primaryLaneForDefinition = (
  definition: Pick<
    NutriMinimalFullFamilyDefinition,
    "safetyBoundaryTier" | "category"
  >,
): string => {
  if (definition.safetyBoundaryTier === "high") return "primary_use_context";
  if (definition.category === "enzyme") return "functional_context";
  if (definition.category === "mineral") return "intake_and_status_context";
  if (definition.category === "botanical") return "primary_use_context";
  return "primary_context";
};

const buildRequiredTargets = (): ReplayTarget[] => {
  const fullFamilyTargets = new Map(
    NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.map((definition) => [
      definition.canonicalFamily,
      definition,
    ]),
  );

  const sameDefinition = fullFamilyTargets.get("same");
  const tocotrienolDefinition = fullFamilyTargets.get("tocotrienols");
  const devilDefinition = fullFamilyTargets.get("devil_s_claw");
  const schisandraDefinition = fullFamilyTargets.get("schisandra_chinensis");
  const chagaDefinition = fullFamilyTargets.get("chaga_mushroom");
  const nadhDefinition = fullFamilyTargets.get("nadh");

  const fullTargets = [
    sameDefinition
      ? targetFromDefinition(
          sameDefinition,
          true,
          /\b(?:SAMe|SAM-e|S[\s-]*adenosyl[\s-]*(?:L[\s-]*)?methionine)\b/,
        )
      : null,
    tocotrienolDefinition ? targetFromDefinition(tocotrienolDefinition, true) : null,
    devilDefinition ? targetFromDefinition(devilDefinition, true) : null,
    schisandraDefinition ? targetFromDefinition(schisandraDefinition, true) : null,
    chagaDefinition ? targetFromDefinition(chagaDefinition, true) : null,
    nadhDefinition ? targetFromDefinition(nadhDefinition, true) : null,
  ].filter((target): target is ReplayTarget => Boolean(target));

  const runtimeTargets = [
    manualRuntimeTarget({
      family: "red_yeast_rice",
      sourceIngredientId: "red_yeast_rice",
      displayName: "Red yeast rice",
      category: "botanical",
      safetyBoundaryTier: "high",
      patternKeywords: ["red yeast rice", "monascus", "monacolin"],
      pattern: /\bred\s+yeast\s+rice\b|\bmonascus\b|\bmonacolin\b/i,
      primaryLane: "primary_use_context",
      hardBoundary:
        "Hard boundary: do not present red yeast rice as treating cholesterol, replacing statins, or guaranteeing lipid outcomes.",
    }),
    manualRuntimeTarget({
      family: "pygeum",
      sourceIngredientId: "pygeum",
      displayName: "Pygeum",
      category: "botanical",
      safetyBoundaryTier: "high",
      patternKeywords: ["pygeum", "prunus africana", "pygeum africanum"],
      pattern: /\bpygeum\b|\bprunus\s+africana\b|\bpygeum\s+africanum\b/i,
      primaryLane: "primary_use_context",
      hardBoundary:
        "Hard boundary: do not present pygeum as treating urinary disease or replacing clinician-directed care.",
    }),
    manualRuntimeTarget({
      family: "milk_thistle",
      sourceIngredientId: "milk_thistle",
      displayName: "Milk thistle",
      category: "botanical",
      safetyBoundaryTier: "high",
      patternKeywords: ["milk thistle", "silybum", "silymarin"],
      pattern: /\bmilk\s+thistle\b|\bsilybum\b|\bsilymarin\b/i,
      primaryLane: "primary_use_context",
      hardBoundary:
        "Hard boundary: do not present milk thistle as detoxifying, treating liver disease, or replacing medical care.",
    }),
    manualRuntimeTarget({
      family: "tribulus_terrestris",
      sourceIngredientId: "tribulus_terrestris",
      displayName: "Tribulus terrestris",
      category: "botanical",
      safetyBoundaryTier: "high",
      patternKeywords: ["tribulus", "tribulus terrestris", "puncturevine"],
      pattern: /\btribulus(?:\s+terrestris)?\b|\bpuncturevine\b|\bprotodioscin\b/i,
      primaryLane: "primary_use_context",
      hardBoundary:
        "Hard boundary: do not present tribulus as boosting testosterone, treating sexual dysfunction, or guaranteeing performance outcomes.",
    }),
  ];

  const byFamily = new Map<string, ReplayTarget>();
  for (const target of [...fullTargets, ...runtimeTargets]) {
    if (REQUIRED_FAMILIES.includes(target.family)) byFamily.set(target.family, target);
  }
  return REQUIRED_FAMILIES.map((family) => byFamily.get(family)).filter(
    (target): target is ReplayTarget => Boolean(target),
  );
};

const targetMatchesText = (target: ReplayTarget, text: string): boolean => {
  if (target.pattern.test(text)) return true;
  const normalizedText = normalize(text);
  return target.patternKeywords.some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return normalizedKeyword.length >= 4 && normalizedText.includes(normalizedKeyword);
  });
};

const candidateTextForTarget = (candidate: ProductCandidate): string =>
  [
    candidate.title,
    candidate.brand,
    candidate.description,
    candidate.suggestedUse,
    candidate.warnings,
    ...candidate.ingredientRows.map((row) => `${row.name} ${row.amountText ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ");

const findCandidatesForTarget = (
  target: ReplayTarget,
  candidates: ProductCandidate[],
): ProductCandidate[] =>
  candidates
    .filter((candidate) => {
      const title = candidate.title;
      if (/sesame|same day/i.test(title) && target.family === "same") return false;
      return targetMatchesText(target, candidateTextForTarget(candidate));
    })
    .sort((left, right) => scoreCandidate(target, right) - scoreCandidate(target, left))
    .slice(0, 12);

const scoreCandidate = (target: ReplayTarget, candidate: ProductCandidate): number => {
  let score = 0;
  if (candidate.productId === PREFERRED_REQUIRED_REPLAY_PRODUCT_IDS[target.family]) {
    score += 500;
  }
  const titleText = candidate.title;
  const allText = candidateTextForTarget(candidate);
  if (targetMatchesText(target, titleText)) score += 50;
  const firstIngredientMatches =
    candidate.ingredientRows.length > 0 &&
    targetMatchesText(target, candidate.ingredientRows[0]?.name ?? "");
  const matchingIngredientRows = candidate.ingredientRows.filter((row) =>
    targetMatchesText(target, row.name),
  );
  if (matchingIngredientRows.length > 0) {
    score += 35;
  }
  if (firstIngredientMatches) score += 15;
  if (candidate.ingredientRows.length === 1 && matchingIngredientRows.length === 1) {
    score += 30;
  }
  if (candidate.ingredientRows.length > 2 && !firstIngredientMatches) score -= 20;
  if (candidate.ingredientRows.length > 0) score += 20;
  if (candidate.description) score += 8;
  if (candidate.warnings) score += 5;
  if (candidate.sourceFile.includes("goal_navigator_candidate_bundle")) score += 20;
  if (candidate.sourceFile.includes("merge_report_apply")) score += 8;
  if (/\b(capsules?|softgels?|tablets?|veggie capsules?|veg capsules?)\b/i.test(allText)) {
    score += 5;
  }
  return score;
};

const inferDosageForm = (title: string): string => {
  if (/soft\s*gels?|softgels?|softgel/i.test(title)) return "Softgel";
  if (/veggie capsules?|veg capsules?|capsules?/i.test(title)) return "Capsule";
  if (/tablets?/i.test(title)) return "Tablet";
  if (/powder/i.test(title)) return "Powder";
  if (/liquid|drops?/i.test(title)) return "Liquid";
  if (/gummies|gummy/i.test(title)) return "Gummy";
  return "Capsule";
};

const fallbackAmountForTarget = (
  target: ReplayTarget,
): { amount: number; unit: string } => {
  if (target.category === "mineral" || target.category === "vitamin") {
    return { amount: 100, unit: "mcg" };
  }
  if (target.category === "enzyme") return { amount: 100, unit: "mg" };
  if (target.family === "nadh") return { amount: 10, unit: "mg" };
  if (target.family === "same") return { amount: 200, unit: "mg" };
  return { amount: 500, unit: "mg" };
};

const buildDigest = (target: ReplayTarget, product: ProductCandidate): FactsDigest => {
  const fallbackAmount = fallbackAmountForTarget(target);
  const productActives =
    product.ingredientRows.length > 0
      ? product.ingredientRows
      : [
          {
            name: target.displayName,
            amount: fallbackAmount.amount,
            unit: fallbackAmount.unit,
            amountText: `${fallbackAmount.amount} ${fallbackAmount.unit}`,
          },
        ];

  return {
    sourceType: product.ingredientRows.length > 0 ? "dsld" : "web",
    identity: {
      type: product.barcode ? "gtin14" : "webCanonicalId",
      value: product.barcode ?? product.productId ?? product.url ?? `${target.family}-replay`,
      regionTags: ["US"],
      verifiedStatus: "real_product_replay",
    },
    product: {
      brandDisplay: product.brand,
      brandLegal: null,
      name: product.title,
      dosageForm: inferDosageForm(product.title),
      route: "oral",
    },
    actives: productActives.map((row) => ({
      name: row.name,
      amount: row.amount,
      unit: row.unit,
      amountText: row.amountText,
      source: "web",
      confidence: product.ingredientRows.length > 0 ? 0.9 : 0.72,
    })),
    inactives: [],
    serving: {
      servingSize: null,
      servingsPerContainer: null,
    },
    labelDosing: product.suggestedUse
      ? [
          {
            population: null,
            age: null,
            dose: null,
            frequency: null,
            rawText: product.suggestedUse,
          },
        ]
      : [],
    warnings: {
      warnings: product.warnings ? [product.warnings] : [],
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: !product.warnings,
    },
    claims: {
      labelPurposes: [],
      webClaims: product.description ? [product.description] : [],
    },
    quality: {
      isComplete: product.ingredientRows.length > 0,
      missingFields: product.ingredientRows.length > 0 ? [] : ["structured_ingredients"],
      completenessScore: product.ingredientRows.length > 0 ? 0.86 : 0.58,
    },
  };
};

const selectDescriptorFamily = (
  digest: FactsDigest,
  target: ReplayTarget,
) => {
  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: digest.product.name ?? "",
      brandName: digest.product.brandDisplay ?? "",
    },
  });
  const selectedDescriptor =
    context.ingredientDescriptors.find(
      (descriptor) => descriptor.ingredientFamily === target.family,
    ) ??
    context.ingredientDescriptors.find(
      (descriptor) =>
        normalizeKey(descriptor.name).includes(normalizeKey(target.displayName)) ||
        targetMatchesText(target, descriptor.name),
    ) ??
    null;
  const selectedIngredientName =
    selectedDescriptor?.name ??
    context.anchorIngredient?.name ??
    target.displayName;
  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName,
  });
  const block = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName,
    plan,
  });

  return { context, selectedDescriptor, selectedIngredientName, plan, block };
};

const flattenScientificBlockText = (
  block: ReturnType<typeof buildScientificBackgroundDeterministicFallback>,
): string =>
  [
    block.introLine,
    ...block.sections.flatMap((section) => [
      section.heading,
      section.summary,
      ...section.bullets,
      section.evidenceRead,
      section.shopperMeaning,
    ]),
    block.closingNote,
  ]
    .filter(Boolean)
    .join(" ");

const GENERIC_BACKGROUND_PATTERNS = [
  /clearest comparison lane here/i,
  /this is the strongest reading/i,
  /has approved pubmed-backed context/i,
  /broad orientation section/i,
  /appears in several research directions/i,
  /generic wellness positioning/i,
];

const findGenericHits = (text: string): string[] =>
  GENERIC_BACKGROUND_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) =>
    String(pattern),
  );

const hasFamilyLabel = (target: ReplayTarget, text: string): boolean =>
  targetMatchesText(target, text) ||
  normalize(text).includes(normalize(target.displayName));

const sentenceHasBoundary = (sentence: string): boolean =>
  /\b(do not|don't|does not|should not|avoid|not as|not proof|not a|without|rather than|keep|bounded|caution|separate from|not be read as|not be treated as|not automatically)\b/i.test(
    sentence,
  );

const UNSAFE_SENTENCE_PATTERNS = [
  /\b(treats?|treated|treating|cures?|curing|prevents?|preventing|replaces?|replacing|guarantees?|guaranteeing)\b/i,
  /\b(?:drug|medication|statin)[-\s]*(?:replacement|substitute)\b/i,
  /\b(?:best|better|superior|safer)\s+(?:than|form|choice|option)\b/i,
  /\bwill\s+(?:lower|reduce|improve|boost|detoxify)\b/i,
  /\b(?:lowers?|reduces?)\s+(?:ldl|cholesterol|blood sugar|glucose)\b/i,
  /\bboosts?\s+testosterone\b/i,
  /\bdetoxif(?:y|ies|ication)\b/i,
];

const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const findUnsafeSentences = (text: string): string[] =>
  splitSentences(text).filter((sentence) => {
    if (/\btreating\s+(?:two\s+)?(?:labels?|products?)\s+as\s+equivalent\b/i.test(sentence)) {
      return false;
    }
    if (
      /^treat\s+.+\s+as\s+(?:a\s+)?(?:confidence|context|comparison|label|formula|disclosure)\b/i.test(
        sentence,
      )
    ) {
      return false;
    }
    if (sentenceHasBoundary(sentence)) return false;
    return UNSAFE_SENTENCE_PATTERNS.some((pattern) => pattern.test(sentence));
  });

const makeRegistryKey = (family: string, lane: string): string =>
  `${family}|${lane}`;

const buildTargetSet = (
  candidates: ProductCandidate[],
): { requiredTargets: ReplayTarget[]; targets: ReplayTarget[] } => {
  const requiredTargets = buildRequiredTargets();
  const requiredSet = new Set(requiredTargets.map((target) => target.family));
  const extraTargets = NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS.filter(
    (definition) =>
      definition.safetyBoundaryTier === "high" &&
      !requiredSet.has(definition.canonicalFamily as IngredientScienceIngredientFamily),
  )
    .map((definition) => targetFromDefinition(definition, false))
    .filter((target) => findCandidatesForTarget(target, candidates).length > 0)
    .sort((left, right) => left.family.localeCompare(right.family))
    .slice(0, EXTRA_HIGH_RISK_SAMPLE_LIMIT);

  return {
    requiredTargets,
    targets: [...requiredTargets, ...extraTargets],
  };
};

const pickBestReplayProduct = (
  target: ReplayTarget,
  candidates: ProductCandidate[],
): { product: ProductCandidate; replay: ReturnType<typeof selectDescriptorFamily> } | null => {
  const productCandidates = findCandidatesForTarget(target, candidates);
  let best: { product: ProductCandidate; replay: ReturnType<typeof selectDescriptorFamily>; score: number } | null =
    null;

  for (const product of productCandidates) {
    const digest = buildDigest(target, product);
    const replay = selectDescriptorFamily(digest, target);
    const descriptorFamilies = replay.context.ingredientDescriptors.map(
      (descriptor) => descriptor.ingredientFamily,
    );
    const inferenceStrong =
      replay.plan.family === target.family ||
      replay.selectedDescriptor?.ingredientFamily === target.family ||
      replay.context.anchorIngredient?.ingredientFamily === target.family ||
      replay.context.ingredientFamily === target.family ||
      descriptorFamilies.includes(target.family);
    const score =
      scoreCandidate(target, product) +
      (replay.plan.family === target.family ? 80 : 0) +
      (replay.context.anchorIngredient?.ingredientFamily === target.family ? 40 : 0) +
      (replay.selectedDescriptor?.ingredientFamily === target.family ? 35 : 0) +
      (inferenceStrong ? 30 : -100);
    if (!best || score > best.score) best = { product, replay, score };
  }

  return best ? { product: best.product, replay: best.replay } : null;
};

const factsQualityForProduct = (
  product: ProductCandidate,
): ReplayRow["replay_product"]["facts_quality"] => {
  if (product.ingredientRows.length > 0) return "structured_ingredients";
  if (product.description) return "title_plus_description";
  return "title_only";
};

const buildReplayRow = (
  target: ReplayTarget,
  selected: { product: ProductCandidate; replay: ReturnType<typeof selectDescriptorFamily> } | null,
  registryByKey: Map<string, RegistryRow>,
): ReplayRow => {
  const product =
    selected?.product ??
    ({
      sourceFile: null,
      productId: null,
      barcode: null,
      url: null,
      brand: "Replay Fixture",
      title: `${target.displayName} real-product replay missing`,
      description: null,
      suggestedUse: null,
      warnings: null,
      ingredientRows: [],
    } as ProductCandidate);
  const replay =
    selected?.replay ?? selectDescriptorFamily(buildDigest(target, product), target);
  const text = flattenScientificBlockText(replay.block);
  const genericHits = findGenericHits(text);
  const unsafeSentences = findUnsafeSentences(text);
  const containsFamilyLabel = hasFamilyLabel(target, text);
  const registryRow = registryByKey.get(makeRegistryKey(target.family, target.primaryLane));
  const reviewedEvidence = getScientificBackgroundEvidence(
    target.family,
    target.primaryLane,
    "en",
  );
  const descriptorFamilies = replay.context.ingredientDescriptors.map(
    (descriptor) => descriptor.ingredientFamily,
  );
  const inferencePass =
    Boolean(selected) &&
    (replay.plan.family === target.family ||
      replay.selectedDescriptor?.ingredientFamily === target.family ||
      replay.context.anchorIngredient?.ingredientFamily === target.family ||
      replay.context.ingredientFamily === target.family ||
      descriptorFamilies.includes(target.family));
  const scientificPass =
    replay.plan.family === target.family &&
    replay.block.sections.length >= 2 &&
    containsFamilyLabel &&
    genericHits.length === 0;
  const expectedBlockedFromRegistry =
    !reviewedEvidence && registryRow?.review_status !== "approved";
  const registryTraceabilityWarning =
    Boolean(reviewedEvidence) && registryRow?.review_status !== "approved";
  const groundingPass =
    Boolean(reviewedEvidence) ||
    (expectedBlockedFromRegistry &&
      registryRow?.review_status !== "approved");
  const safetyPass = unsafeSentences.length === 0;

  return {
    family: target.family,
    source_ingredient_id: target.sourceIngredientId,
    display_name: target.displayName,
    required: target.required,
    productization_class: target.productizationClass,
    safety_boundary_tier: target.safetyBoundaryTier,
    category: target.category,
    replay_product: {
      source_file: product.sourceFile,
      product_id: product.productId,
      barcode: product.barcode,
      url: product.url,
      brand: product.brand,
      title: product.title,
      facts_quality: factsQualityForProduct(product),
      ingredient_rows: product.ingredientRows.slice(0, 8).map((row) => ({
        name: row.name,
        amountText: row.amountText,
      })),
    },
    inference: {
      pass: inferencePass,
      expected_family: target.family,
      context_family: replay.context.ingredientFamily,
      anchor_family: replay.context.anchorIngredient?.ingredientFamily ?? null,
      selected_descriptor_family:
        replay.selectedDescriptor?.ingredientFamily ?? null,
      selected_descriptor_name: replay.selectedDescriptor?.name ?? null,
      descriptor_families: Array.from(new Set(descriptorFamilies)),
    },
    scientific_background: {
      pass: scientificPass,
      mode: replay.plan.mode,
      family: replay.plan.family,
      headings: replay.block.sections.map((section) => section.heading),
      heading_ids: replay.plan.sections.map((section) => section.headingId),
      generic_hits: genericHits,
      contains_family_label: containsFamilyLabel,
      sample_summary: replay.block.sections[0]?.summary ?? null,
      sample_evidence_read: replay.block.sections[0]?.evidenceRead ?? null,
      sample_shopper_meaning: replay.block.sections[0]?.shopperMeaning ?? null,
    },
    evidence_grounding: {
      pass: groundingPass,
      primary_lane: target.primaryLane,
      registry_review_status: registryRow?.review_status ?? "missing",
      registry_review_reasons: registryRow?.review_reasons ?? [],
      reviewed_evidence_found: Boolean(reviewedEvidence),
      live_grounding_status: reviewedEvidence
        ? "approved_reviewed_row"
        : "blocked_no_reviewed_row",
      expected_blocked_from_registry: expectedBlockedFromRegistry,
      first_reference_id: reviewedEvidence?.supportingReferences[0]?.id ?? null,
      reference_count: reviewedEvidence?.supportingReferences.length ?? 0,
      registry_traceability_warning: registryTraceabilityWarning,
    },
    safety_claim_gate: {
      pass: safetyPass,
      unsafe_sentences: unsafeSentences,
    },
  };
};

const markdownEscape = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();

const renderMarkdownReport = (artifact: {
  generated_at: string;
  summary: Record<string, unknown>;
  replay_rows: ReplayRow[];
  failures: ReplayRow[];
}): string => {
  const requiredRows = artifact.replay_rows.filter((row) => row.required);
  const lines = [
    "# Nutri Minimal v4 Real Product Family Replay",
    "",
    `Generated at: ${artifact.generated_at}`,
    "",
    "## Summary",
    "",
    `- Sampled families: ${artifact.summary.sampled_families}`,
    `- Required priority families covered by real products: ${artifact.summary.required_real_product_coverage}/${artifact.summary.required_priority_families}`,
    `- Family inference pass: ${artifact.summary.family_inference_pass}/${artifact.summary.sampled_families}`,
    `- Scientific Background family-specific pass: ${artifact.summary.scientific_background_specific_pass}/${artifact.summary.sampled_families}`,
    `- Evidence grounding gate pass: ${artifact.summary.evidence_grounding_gate_pass}/${artifact.summary.sampled_families}`,
    `- Safety claim gate pass: ${artifact.summary.safety_claim_gate_pass}/${artifact.summary.sampled_families}`,
    `- Rejected or needs_edit rows blocked from live grounding: ${artifact.summary.blocked_unapproved_grounding_rows}`,
    `- Registry traceability warnings: ${artifact.summary.registry_traceability_warnings}`,
    `- Failures: ${artifact.summary.failures}`,
    "",
    "## Required Priority Samples",
    "",
    "| Family | Product | Inference | Scientific | Grounding | Safety | Live evidence | Registry status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of requiredRows) {
    lines.push(
      [
        row.family,
        markdownEscape(`${row.replay_product.brand ?? ""} ${row.replay_product.title}`),
        row.inference.pass ? "pass" : "fail",
        row.scientific_background.pass ? "pass" : "fail",
        row.evidence_grounding.pass ? "pass" : "fail",
        row.safety_claim_gate.pass ? "pass" : "fail",
        row.evidence_grounding.live_grounding_status,
        row.evidence_grounding.registry_review_status,
      ].join(" | "),
    );
  }

  const extraRows = artifact.replay_rows.filter((row) => !row.required);
  if (extraRows.length > 0) {
    lines.push("", "## Extra High-Risk Samples", "");
    lines.push(
      "| Family | Product | Inference | Scientific | Grounding | Safety |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const row of extraRows) {
      lines.push(
        [
          row.family,
          markdownEscape(`${row.replay_product.brand ?? ""} ${row.replay_product.title}`),
          row.inference.pass ? "pass" : "fail",
          row.scientific_background.pass ? "pass" : "fail",
          row.evidence_grounding.pass ? "pass" : "fail",
          row.safety_claim_gate.pass ? "pass" : "fail",
        ].join(" | "),
      );
    }
  }

  if (artifact.failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const row of artifact.failures) {
      lines.push(
        `- ${row.family}: inference=${row.inference.pass}, scientific=${row.scientific_background.pass}, grounding=${row.evidence_grounding.pass}, safety=${row.safety_claim_gate.pass}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

export const runNutriMinimalV4RealProductReplay = async (opts?: {
  writeArtifacts?: boolean;
}) => {
  const writeArtifacts = opts?.writeArtifacts ?? true;
  const registryArtifact = await readJson<{
    scientific_evidence_candidate_registry: RegistryRow[];
  }>(REGISTRY_PATH);
  if (!registryArtifact) {
    throw new Error(`Missing candidate registry at ${REGISTRY_PATH}`);
  }

  const registryByKey = new Map(
    registryArtifact.scientific_evidence_candidate_registry.map((row) => [
      makeRegistryKey(row.family, row.lane),
      row,
    ]),
  );
  const candidates = await collectRealProductCandidates();
  const { requiredTargets, targets } = buildTargetSet(candidates);
  const replayRows = targets.map((target) =>
    buildReplayRow(
      target,
      pickBestReplayProduct(target, candidates),
      registryByKey,
    ),
  );
  const failures = replayRows.filter(
    (row) =>
      !row.inference.pass ||
      !row.scientific_background.pass ||
      !row.evidence_grounding.pass ||
      !row.safety_claim_gate.pass ||
      (row.required && !row.replay_product.source_file),
  );
  const requiredRows = replayRows.filter((row) => row.required);
  const blockedUnapprovedRows = replayRows.filter(
    (row) =>
      row.evidence_grounding.registry_review_status !== "approved" &&
      !row.evidence_grounding.reviewed_evidence_found,
  );

  const artifact = {
    version: "nutri_minimal_v4_real_product_family_replay.v1",
    generated_at: new Date().toISOString(),
    source_files: REAL_PRODUCT_SOURCE_FILES,
    summary: {
      source_product_candidates: candidates.length,
      sampled_families: replayRows.length,
      required_priority_families: requiredTargets.length,
      required_real_product_coverage: requiredRows.filter(
        (row) => Boolean(row.replay_product.source_file),
      ).length,
      structured_ingredient_samples: replayRows.filter(
        (row) => row.replay_product.facts_quality === "structured_ingredients",
      ).length,
      title_or_description_only_samples: replayRows.filter(
        (row) => row.replay_product.facts_quality !== "structured_ingredients",
      ).length,
      family_inference_pass: replayRows.filter((row) => row.inference.pass).length,
      scientific_background_specific_pass: replayRows.filter(
        (row) => row.scientific_background.pass,
      ).length,
      evidence_grounding_gate_pass: replayRows.filter(
        (row) => row.evidence_grounding.pass,
      ).length,
      safety_claim_gate_pass: replayRows.filter((row) => row.safety_claim_gate.pass)
        .length,
      approved_reviewed_grounding_rows: replayRows.filter(
        (row) => row.evidence_grounding.reviewed_evidence_found,
      ).length,
      blocked_unapproved_grounding_rows: blockedUnapprovedRows.length,
      registry_traceability_warnings: replayRows.filter(
        (row) => row.evidence_grounding.registry_traceability_warning,
      ).length,
      failures: failures.length,
    },
    required_families: REQUIRED_FAMILIES,
    failures,
    replay_rows: replayRows,
  };

  if (writeArtifacts) {
    await fs.writeFile(REPLAY_PACK_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
    await fs.writeFile(REPLAY_MARKDOWN_PATH, renderMarkdownReport(artifact));
  }

  return artifact;
};

const isMain = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  runNutriMinimalV4RealProductReplay()
    .then((artifact) => {
      console.log(
        JSON.stringify(
          {
            ok: artifact.failures.length === 0,
            replay_pack_path: REPLAY_PACK_PATH,
            replay_markdown_path: REPLAY_MARKDOWN_PATH,
            summary: artifact.summary,
          },
          null,
          2,
        ),
      );
      if (artifact.failures.length > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exit(1);
    });
}
