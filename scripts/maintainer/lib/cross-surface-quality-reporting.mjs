import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "./science-validation-reporting.mjs";

export const GOLDEN_JOURNEY_CATEGORIES = [
  "vitamin_mineral_single",
  "mineral_stack",
  "multivitamin_b_complex",
  "probiotic_microbiome",
  "omega3_source_oil",
  "botanical_extract",
  "sleep_amino",
  "metabolic_body_composition",
  "protein_fiber",
  "food_like",
  "prenatal_kids",
  "sparse_title_led",
];

export const GOLDEN_JOURNEY_PERSONAS = [
  "fish_allergy",
  "shellfish_allergy",
  "dairy_allergy",
  "soy_allergy",
  "gluten_restriction",
  "gelatin_restriction",
  "vegan_preference",
  "pregnancy_prenatal",
  "melatonin_sensitivity",
  "stimulant_sensitivity",
  "duplicate_zinc_magnesium_d",
  "digestion_goal",
  "sleep_goal",
  "immunity_goal",
  "fitness_recovery_goal",
  "stress_goal",
];

export const GOLDEN_JOURNEY_SURFACES = [
  "barcode_scan",
  "search",
  "search_origin_result",
];

export const GOLDEN_JOURNEY_ORIGINS = [
  "barcode_scan",
  "search_result",
];

export const GOLDEN_JOURNEY_GATES = [
  "route_health",
  "default_anchor",
  "bad_anchor",
  "overview_copy",
  "scientific_background",
  "allergy_sensitivity_relevance",
  "goal_relevance",
  "duplicate_stack",
  "unsafe_language",
  "canonical_product_consistency",
  "score_consistency",
  "selected_anchor_consistency",
  "warning_consistency",
  "search_relevance",
  "click_through_seed_consistency",
  "sparse_data_honesty",
];

export const GOLDEN_JOURNEY_SEVERITIES = ["P0", "P1", "P2", "P3"];

const CATEGORY_SET = new Set(GOLDEN_JOURNEY_CATEGORIES);
const PERSONA_SET = new Set(GOLDEN_JOURNEY_PERSONAS);
const SURFACE_SET = new Set(GOLDEN_JOURNEY_SURFACES);
const ORIGIN_SET = new Set(GOLDEN_JOURNEY_ORIGINS);
const GATE_SET = new Set(GOLDEN_JOURNEY_GATES);
const SEVERITY_SET = new Set(GOLDEN_JOURNEY_SEVERITIES);

const UNSAFE_LANGUAGE_PATTERNS = [
  /\bsafe\s+for\s+you\b/i,
  /\bsafe\s+in\s+pregnancy\b/i,
  /\bguarantees?\b/i,
  /\bproven\s+to\b/i,
  /\bprevents?\b/i,
  /\bcures?\b/i,
  /\bused\s+to\s+treat\b/i,
  /\btreats?\s+(?:insomnia|diseases?|conditions?|symptoms?|constipation|colds?|flu|infections?|inflammation|pain|anxiety|depression|diabetes|hypertension|arthritis|digestive\s+disease|heart\s+disease)\b/i,
  /\btreating\s+(?:insomnia|diseases?|conditions?|symptoms?|constipation|colds?|flu|infections?|inflammation|pain|anxiety|depression|diabetes|hypertension|arthritis|digestive\s+disease|heart\s+disease)\b/i,
  /\boverdose\b/i,
];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const EXPECTED_TERM_ALIASES = {
  dairy: ["dairy", "milk", "whey", "casein", "caseinate", "lactose"],
  milk: ["milk", "dairy", "whey", "casein", "caseinate", "lactose"],
  shellfish: ["shellfish", "krill", "shrimp", "prawn", "lobster", "crab", "scallop", "oyster"],
  fish: ["fish", "cod liver", "anchovy", "salmon", "sardine", "mackerel", "pollock", "trout"],
  soy: ["soy", "soya", "soybean", "soy lecithin", "soy protein"],
  gluten: ["gluten", "wheat", "barley", "rye", "malt"],
  gelatin: ["gelatin", "gelatine", "bovine gelatin", "porcine gelatin"],
  prenatal: ["prenatal", "pregnancy"],
  digestion: ["digestion", "digestive", "gut", "microbiome", "probiotic", "prebiotic", "fiber"],
  duplicate: ["duplicate", "overlap", "already includes", "already in your stack", "repeat"],
  "green tea": ["green tea", "matcha", "camellia sinensis", "egcg"],
};

const matchesExpectedIncludeTerm = (joined, term) => {
  const normalized = normalizeLooseText(term);
  const candidates = [
    normalized,
    ...(EXPECTED_TERM_ALIASES[normalized] ?? []),
  ]
    .map(normalizeLooseText)
    .filter(Boolean);
  return candidates.some((candidate) => joined.includes(candidate));
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const addValidationError = (errors, scenarioId, field, message) => {
  errors.push({
    scenarioId,
    field,
    message,
  });
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const validateStringList = ({
  errors,
  scenarioId,
  field,
  value,
  allowed,
}) => {
  if (!Array.isArray(value)) {
    addValidationError(errors, scenarioId, field, "must be an array");
    return;
  }
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      addValidationError(errors, scenarioId, field, "must contain only non-empty strings");
      continue;
    }
    if (allowed && !allowed.has(item)) {
      addValidationError(errors, scenarioId, field, `unsupported value: ${item}`);
    }
  }
};

const validateExpectedBlock = (scenario, errors) => {
  const id = scenario?.id ?? "unknown";
  const expected = scenario?.expected;
  if (!isPlainObject(expected)) {
    addValidationError(errors, id, "expected", "must be an object");
    return;
  }

  if (scenario.surface === "search") {
    if (!isPlainObject(expected.search)) {
      addValidationError(errors, id, "expected.search", "search scenarios require expected.search");
    } else {
      if (!isNonEmptyString(expected.search.expectedProductId)) {
        addValidationError(errors, id, "expected.search.expectedProductId", "must be a non-empty string");
      }
      if (!["top1", "top3", "recall5", "barcode_exact"].includes(expected.search.metric)) {
        addValidationError(errors, id, "expected.search.metric", "must be top1, top3, recall5, or barcode_exact");
      }
    }
    return;
  }

  if (isPlainObject(expected.defaultAnchor)) {
    for (const field of ["pass", "warn", "fail"]) {
      if (!Array.isArray(expected.defaultAnchor[field])) {
        addValidationError(errors, id, `expected.defaultAnchor.${field}`, "must be an array");
      }
    }
  }

  if (isPlainObject(expected.overview)) {
    for (const field of ["mustMention", "bannedPhrases"]) {
      if (!Array.isArray(expected.overview[field])) {
        addValidationError(errors, id, `expected.overview.${field}`, "must be an array");
      }
    }
  }

  if (isPlainObject(expected.scientificBackground)) {
    for (const field of ["mustMention", "bannedPhrases"]) {
      if (!Array.isArray(expected.scientificBackground[field])) {
        addValidationError(errors, id, `expected.scientificBackground.${field}`, "must be an array");
      }
    }
  }

  if (isPlainObject(expected.profileWarnings)) {
    for (const field of ["mustInclude", "mustNotInclude"]) {
      if (!Array.isArray(expected.profileWarnings[field])) {
        addValidationError(errors, id, `expected.profileWarnings.${field}`, "must be an array");
      }
    }
  }
};

const loadGoldenJourneyPackInternal = async (filePath, ancestry = new Set()) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  if (ancestry.has(resolved)) {
    throw new Error(`golden journey pack extends cycle detected at ${resolved}`);
  }

  const pack = JSON.parse(await fs.readFile(resolved, "utf8"));
  const nextAncestry = new Set(ancestry);
  nextAncestry.add(resolved);

  if (!isNonEmptyString(pack.extendsPackPath)) {
    return pack;
  }

  const basePack = await loadGoldenJourneyPackInternal(pack.extendsPackPath, nextAncestry);
  return {
    ...basePack,
    ...pack,
    scenarios: [
      ...(Array.isArray(basePack.scenarios) ? basePack.scenarios : []),
      ...(Array.isArray(pack.scenarios) ? pack.scenarios : []),
    ],
  };
};

export const loadGoldenJourneyPack = async (
  filePath = "data/validation/golden-journey-pack.v0.json",
) => loadGoldenJourneyPackInternal(filePath);

export const validateGoldenJourneyPack = (pack) => {
  const errors = [];
  if (!isPlainObject(pack)) {
    return [{ scenarioId: "pack", field: "pack", message: "pack must be an object" }];
  }
  if (!isNonEmptyString(pack.version)) {
    addValidationError(errors, "pack", "version", "must be a non-empty string");
  }
  if (!Array.isArray(pack.scenarios)) {
    addValidationError(errors, "pack", "scenarios", "must be an array");
    return errors;
  }

  const seenIds = new Set();
  for (const [index, scenario] of pack.scenarios.entries()) {
    const id = scenario?.id ?? `index:${index}`;
    if (!isPlainObject(scenario)) {
      addValidationError(errors, id, "scenario", "must be an object");
      continue;
    }
    if (!isNonEmptyString(scenario.id)) {
      addValidationError(errors, id, "id", "must be a non-empty string");
    } else if (seenIds.has(scenario.id)) {
      addValidationError(errors, id, "id", "must be unique");
    } else {
      seenIds.add(scenario.id);
    }

    if (!SURFACE_SET.has(scenario.surface)) {
      addValidationError(errors, id, "surface", `unsupported surface: ${scenario.surface}`);
    }
    if (!ORIGIN_SET.has(scenario.origin)) {
      addValidationError(errors, id, "origin", `unsupported origin: ${scenario.origin}`);
    }
    if (!CATEGORY_SET.has(scenario.category)) {
      addValidationError(errors, id, "category", `unsupported category: ${scenario.category}`);
    }
    validateStringList({
      errors,
      scenarioId: id,
      field: "personas",
      value: scenario.personas,
      allowed: PERSONA_SET,
    });
    validateStringList({
      errors,
      scenarioId: id,
      field: "gates",
      value: scenario.gates,
      allowed: GATE_SET,
    });
    if (!SEVERITY_SET.has(scenario.severityOnFail)) {
      addValidationError(errors, id, "severityOnFail", `unsupported severity: ${scenario.severityOnFail}`);
    }
    if (!isPlainObject(scenario.input)) {
      addValidationError(errors, id, "input", "must be an object");
    } else if (scenario.surface === "search" && !isNonEmptyString(scenario.input.query)) {
      addValidationError(errors, id, "input.query", "search scenarios require a query");
    } else if (scenario.surface === "barcode_scan" && !isNonEmptyString(scenario.input.barcode)) {
      addValidationError(errors, id, "input.barcode", "barcode scan scenarios require a barcode or fixture id");
    } else if (scenario.surface === "search_origin_result" && !isPlainObject(scenario.input.searchResultSeed)) {
      addValidationError(errors, id, "input.searchResultSeed", "search-origin result scenarios require a seed");
    }

    if (!isPlainObject(scenario.product)) {
      addValidationError(errors, id, "product", "must be an object");
    } else {
      for (const field of ["productId", "brand", "name"]) {
        if (!isNonEmptyString(scenario.product[field])) {
          addValidationError(errors, id, `product.${field}`, "must be a non-empty string");
        }
      }
    }

    validateExpectedBlock(scenario, errors);
  }

  return errors;
};

export const summarizeGoldenJourneyPack = (pack) => {
  const scenarios = Array.isArray(pack?.scenarios) ? pack.scenarios : [];
  const countBy = (field) =>
    scenarios.reduce((acc, scenario) => {
      const value = scenario?.[field] ?? "unknown";
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  const personas = new Set();
  const gates = new Set();
  for (const scenario of scenarios) {
    for (const persona of scenario?.personas ?? []) personas.add(persona);
    for (const gate of scenario?.gates ?? []) gates.add(gate);
  }
  return {
    version: pack?.version ?? null,
    total: scenarios.length,
    surfaces: countBy("surface"),
    origins: countBy("origin"),
    categories: countBy("category"),
    personas: Array.from(personas).sort(),
    gates: Array.from(gates).sort(),
  };
};

const buildGateResult = ({
  gate,
  status,
  reason,
  severity = null,
  details = {},
}) => ({
  gate,
  status,
  reason,
  severity,
  details,
});

export const containsUnsafeLanguage = (values) => {
  const text = Array.isArray(values) ? values.join(" ") : String(values ?? "");
  return UNSAFE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
};

export const extractSearchSupplements = (responseOrResults) => {
  if (Array.isArray(responseOrResults)) return responseOrResults;
  if (Array.isArray(responseOrResults?.supplements)) return responseOrResults.supplements;
  if (Array.isArray(responseOrResults?.data?.supplements)) return responseOrResults.data.supplements;
  return [];
};

const productMatchesExpectedId = (product, expectedProductId) =>
  normalizeText(product?.productId || product?.id) === normalizeText(expectedProductId);

const productMatchesExpectedBarcode = (product, expectedBarcode) => {
  const normalizedExpected = normalizeBarcode(expectedBarcode);
  if (!normalizedExpected) return false;
  return normalizeBarcode(product?.barcode ?? product?.upcCode) === normalizedExpected;
};

const searchResultText = (product) =>
  [
    product?.name,
    product?.brand,
    product?.category,
    product?.benefit,
    product?.dose,
  ].map(normalizeLooseText).join(" ");

const productMatchesRequiredTerms = (product, terms = []) => {
  if (!terms.length) return false;
  const haystack = searchResultText(product);
  return terms.every((term) => haystack.includes(normalizeLooseText(term)));
};

export const scoreSearchRelevanceCase = ({ scenario, response, results }) => {
  const expected = scenario?.expected?.search;
  if (!expected) {
    return buildGateResult({
      gate: "search_relevance",
      status: "fail",
      reason: "missing_expected_search",
      severity: scenario?.severityOnFail ?? "P2",
    });
  }
  const supplements = extractSearchSupplements(response ?? results);
  let matchMode = "productId";
  let rankIndex = supplements.findIndex((item) =>
    productMatchesExpectedId(item, expected.expectedProductId),
  );
  const expectedBarcode = normalizeBarcode(scenario?.product?.barcode);
  if (rankIndex < 0 && expectedBarcode) {
    const barcodeRankIndex = supplements.findIndex((item) =>
      productMatchesExpectedBarcode(item, expectedBarcode),
    );
    if (barcodeRankIndex >= 0) {
      rankIndex = barcodeRankIndex;
      matchMode = "barcode";
    }
  }
  if (rankIndex < 0 && expected.metric === "recall5" && Array.isArray(expected.mustMatchTerms)) {
    const termRankIndex = supplements.findIndex((item, index) =>
      index < 5 && productMatchesRequiredTerms(item, expected.mustMatchTerms),
    );
    if (termRankIndex >= 0) {
      rankIndex = termRankIndex;
      matchMode = "terms";
    }
  }
  const rank = rankIndex >= 0 ? rankIndex + 1 : null;

  let pass = false;
  if (expected.metric === "top1") pass = rank === 1;
  if (expected.metric === "top3") pass = rank !== null && rank <= 3;
  if (expected.metric === "recall5") pass = rank !== null && rank <= 5;
  if (expected.metric === "barcode_exact") {
    const top = supplements[0] ?? null;
    pass =
      rank === 1 &&
      (!expectedBarcode ||
        normalizeBarcode(top?.barcode ?? top?.upcCode) === expectedBarcode);
  }

  return buildGateResult({
    gate: "search_relevance",
    status: pass ? "pass" : "fail",
    reason: pass ? "search_expectation_met" : `search_${expected.metric}_miss`,
    severity: pass ? null : scenario?.severityOnFail ?? "P2",
    details: {
      expectedProductId: expected.expectedProductId,
      metric: expected.metric,
      matchMode: pass ? matchMode : null,
      rank,
      resultCount: supplements.length,
    },
  });
};

export const evaluateClickThroughSeedConsistency = (scenario, actual = {}) => {
  const seed = scenario?.input?.searchResultSeed;
  if (!seed) {
    return buildGateResult({
      gate: "click_through_seed_consistency",
      status: "fail",
      reason: "missing_search_result_seed",
      severity: scenario?.severityOnFail ?? "P1",
    });
  }

  const actualProduct = actual.product ?? scenario.product ?? {};
  const mismatches = [];
  if (normalizeText(seed.productId) !== normalizeText(actualProduct.productId)) {
    mismatches.push("productId");
  }
  if (normalizeText(seed.brand) !== normalizeText(actualProduct.brand)) {
    mismatches.push("brand");
  }
  if (normalizeText(seed.name) !== normalizeText(actualProduct.name)) {
    mismatches.push("name");
  }
  const seedBarcode = normalizeBarcode(seed.barcode ?? seed.upcCode);
  const productBarcode = normalizeBarcode(actualProduct.barcode);
  if (seedBarcode && productBarcode && seedBarcode !== productBarcode) {
    mismatches.push("barcode");
  }

  return buildGateResult({
    gate: "click_through_seed_consistency",
    status: mismatches.length === 0 ? "pass" : "fail",
    reason: mismatches.length === 0 ? "seed_matches_product" : "seed_product_mismatch",
    severity: mismatches.length === 0 ? null : scenario?.severityOnFail ?? "P1",
    details: { mismatches },
  });
};

export const evaluateCrossSurfaceConsistency = (scenario, actual = {}) => {
  const expected = scenario?.expected?.consistency ?? {};
  const actualProduct = actual.product ?? scenario?.product ?? {};
  const actualAnchor = actual.selectedAnchor ?? expected.selectedAnchor ?? null;
  const actualScoreBand = actual.scoreBand ?? expected.scoreBand ?? null;
  const results = [];

  if (scenario?.gates?.includes("click_through_seed_consistency")) {
    results.push(evaluateClickThroughSeedConsistency(scenario, actual));
  }

  if (scenario?.gates?.includes("canonical_product_consistency")) {
    const expectedProductId = expected.productId ?? scenario?.product?.productId ?? null;
    const expectedBarcode = normalizeBarcode(expected.barcode ?? scenario?.product?.barcode);
    const actualBarcode = normalizeBarcode(actualProduct.barcode ?? actual.barcode);
    const productIdPass =
      !expectedProductId || normalizeText(actualProduct.productId) === normalizeText(expectedProductId);
    const barcodePass =
      !expectedBarcode || !actualBarcode || expectedBarcode === actualBarcode;
    results.push(buildGateResult({
      gate: "canonical_product_consistency",
      status: productIdPass && barcodePass ? "pass" : "fail",
      reason: productIdPass && barcodePass ? "canonical_product_consistent" : "canonical_product_mismatch",
      severity: productIdPass && barcodePass ? null : scenario?.severityOnFail ?? "P1",
      details: { expectedProductId, expectedBarcode, actualBarcode },
    }));
  }

  if (scenario?.gates?.includes("selected_anchor_consistency")) {
    const allowedAnchors = scenario?.expected?.defaultAnchor?.pass ?? [];
    const pass =
      !actualAnchor ||
      allowedAnchors.length === 0 ||
      allowedAnchors.some((anchor) => normalizeLooseText(anchor) === normalizeLooseText(actualAnchor));
    results.push(buildGateResult({
      gate: "selected_anchor_consistency",
      status: pass ? "pass" : "fail",
      reason: pass ? "selected_anchor_consistent" : "selected_anchor_mismatch",
      severity: pass ? null : scenario?.severityOnFail ?? "P1",
      details: { actualAnchor, allowedAnchors },
    }));
  }

  if (scenario?.gates?.includes("score_consistency")) {
    const expectedScoreBand = expected.scoreBand ?? null;
    const pass = !expectedScoreBand || actualScoreBand === expectedScoreBand;
    results.push(buildGateResult({
      gate: "score_consistency",
      status: pass ? "pass" : "fail",
      reason: pass ? "score_band_consistent" : "score_band_mismatch",
      severity: pass ? null : scenario?.severityOnFail ?? "P1",
      details: { expectedScoreBand, actualScoreBand },
    }));
  }

  return results;
};

export const evaluatePersonaExpectations = (scenario, actual = {}) => {
  const expected = scenario?.expected?.profileWarnings;
  if (!expected) return [];
  const text = [
    ...(actual.warnings ?? []),
    ...(actual.chips ?? []),
    ...(actual.copy ?? []),
  ].map(normalizeLooseText);
  const joined = text.join(" ");
  const missing = (expected.mustInclude ?? []).filter((term) =>
    !matchesExpectedIncludeTerm(joined, term),
  );
  const forbidden = (expected.mustNotInclude ?? []).filter((term) =>
    joined.includes(normalizeLooseText(term)),
  );

  return [buildGateResult({
    gate: "allergy_sensitivity_relevance",
    status: missing.length === 0 && forbidden.length === 0 ? "pass" : "fail",
    reason: missing.length === 0 && forbidden.length === 0
      ? "persona_expectation_met"
      : "persona_expectation_mismatch",
    severity: missing.length === 0 && forbidden.length === 0 ? null : scenario?.severityOnFail ?? "P1",
    details: { missing, forbidden },
  })];
};
