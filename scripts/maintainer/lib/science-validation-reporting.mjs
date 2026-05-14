#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(SCRIPT_DIR, "../../..");

export const SCIENCE_VALIDATION_GATES = {
  decisionSupportOkRate: 99.5,
  scienceRowCoverageRate: 98,
  defaultIngredientQualityRate: 95,
  sidecar5xxTimeoutRate: 1,
  foodLikeResearchLeakageRate: 2,
  scientificGenericFinal: 0,
  macroPackageBadAnchors: 0,
};

const MACRO_ANCHOR_PATTERN =
  /\b(?:calories?|energy|total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|sodium|potassium|total\s+carbohydrates?|carbohydrates?|dietary\s+fib(?:er|re)|fib(?:er|re)|sugars?|added\s+sugars?|protein|serving\s+size|servings?\s+per\s+container)\b/i;

const PACKAGE_ANCHOR_PATTERN =
  /\b(?:capsules?|tablets?|softgels?|gummies|chewables?|servings?|stick\s+packs?|tea\s+bags?|wafers?|bottles?|fl\s*oz|net\s+wt|count|ct\.?)\b/i;

const FOOD_LIKE_PATTERN =
  /\b(?:stroopwafels?|snacks?|gumm(?:y|ies)|chews?|tea\s+bags?|herbal\s+tea|juice\s+powder|dragon\s+fruit|greens?\s+powder|superfood\s+powder|food_like|food-like|snack|syrup|beverage|drink\s+mix)\b/i;

const FORMULA_STACK_PATTERN =
  /\b(?:multi(?:vitamin)?|b[\s-]*complex|complex|blend|matrix|cal(?:cium)?[\s-]*mag(?:nesium)?[\s-]*zinc|mineral\s+stack|immune\s+blend|children|kids|formula)\b/i;

const TITLE_LED_PROTEIN_PRODUCT_PATTERN =
  /\b(?:protein\s+(?:snack|mix|bar|powder|drink|beverage|shake|smoothie|iced\s+tea)|(?:whey|pea|rice|soy|hemp|collagen|casein)\s+protein)\b/i;

const PROBIOTIC_TITLE_PATTERN =
  /\b(?:probiotics?|pro-bio|flora|microbiome|live cultures?|cfu|digestive support|protectis|floraphage|osfortis|cytoflora)\b/i;

const PROBIOTIC_ANCHOR_PATTERN =
  /\b(?:probiotics?|probiotic\s+blend|acidophilus|lactobacillus|bifidobacterium|pediococcus|saccharomyces|bacillus|cfu|live cultures?)\b/i;

const VITAMIN_D_ALIAS_PATTERN =
  /\bvitamin\s*d\s*(?:2|3)?\b|\bd\s*(?:2|3)\b|\bcholecalciferol\b|\bergocalciferol\b/i;

const VITAMIN_D_TITLE_PATTERN =
  VITAMIN_D_ALIAS_PATTERN;

const SHORT_INGREDIENT_ALIAS_PATTERN = /^(?:d2|d3)$/i;

const GENERIC_SCIENCE_PATTERNS = [
  /appears in several research directions/i,
  /some outcomes are usually more central than others/i,
  /research emphasis changes with the exact ingredient/i,
  /not every broad claim is equally central/i,
  /useful orientation section/i,
];

const WEAK_SOURCE_COPY_PATTERNS = [
  /limited unverified web evidence/i,
  /\bweb hint(?:s)?\b/i,
  /\bunverified\b/i,
  /\bsource fact\b/i,
  /verify all details against the package label/i,
  /should be confirmed against the package label/i,
  /could not verify this (?:upc|barcode)/i,
];

const INGREDIENT_OVERVIEW_GENERIC_PATTERNS = [
  /\bthis (?:supplement|product|formula) (?:contains|includes|provides|features|delivers)\b/i,
  /\b(?:general|overall) wellness\b/i,
  /\bpart of a daily routine\b/i,
  /\bbroad support\b/i,
];

const CONTEXTUAL_COPY_SIGNAL_PATTERN =
  /\b(?:compare|paired|pairing|supporting|lead|leading|anchor|stack|blend|formula role|shopper|shopping|context|identity|strain|cfu|form|timing|extract|standardized|species|disclosure|cofactor|lane|positioning)\b/i;

const FACTUAL_ECHO_SIGNAL_PATTERN =
  /\b(?:contains|includes|provides|delivers|features|supplies)\b/i;

const DOSE_OR_SERVING_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|cfu|billion|million|milliard|grams?)\b|\bper serving\b|\beach serving\b|\bserving\b/i;

const INGREDIENT_TOKEN_STOPWORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "plus",
  "blend",
  "complex",
  "formula",
  "matrix",
  "support",
  "supplement",
  "extract",
  "mineral",
  "vitamin",
  "oil",
]);

export const percent = (count, total, digits = 1) =>
  total > 0 ? Number(((count / total) * 100).toFixed(digits)) : 0;

export const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(path.resolve(ROOT_DIR, filePath), "utf8"));

export const writeJson = async (filePath, value) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(value, null, 2));
};

export const writeText = async (filePath, value) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, value);
};

export const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

export const getRows = (report) => {
  if (Array.isArray(report?.rows)) return report.rows;
  if (Array.isArray(report?.results)) return report.results;
  if (Array.isArray(report)) return report;
  return [];
};

export const getRowCluster = (row) =>
  String(row?.cluster ?? row?.bucket ?? row?.canaryType ?? row?.clusterKey ?? "unknown");

export const getRowBarcode = (row) =>
  normalizeBarcode(row?.barcode ?? row?.barcode_gtin14 ?? row?.upc_code ?? row?.gtin14);

export const rowKey = (row) => `${getRowBarcode(row) ?? "missing_barcode"}::${getRowCluster(row)}`;

const normalizeSource = (source) => {
  if (source === "server-fallback" || source === "fallback") return "server-fallback";
  if (source === "api") return "api";
  return source ?? null;
};

const normalizeStatus = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeBool = (value) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
};

const normalizeLooseText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const squashLooseText = (value) => normalizeLooseText(value).replace(/\s+/g, "");

const flattenTextValues = (value) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap(flattenTextValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(flattenTextValues);
};

const getIngredientOverviewBlock = (sidecar) =>
  sidecar?.ingredientOverview ?? sidecar?.block ?? null;

const getScientificBackgroundBlock = (sidecar) =>
  sidecar?.scientificBackground ?? sidecar?.block ?? null;

const collectIngredientOverviewText = (blockOrSidecar) => {
  const block = getIngredientOverviewBlock(blockOrSidecar) ?? blockOrSidecar;
  if (!block || typeof block === "string") return flattenTextValues(block);
  return [
    block.titleLine,
    block.paragraph1,
    block.paragraph2,
    block.compareHint,
  ].filter(Boolean);
};

const collectScientificBackgroundText = (blockOrSidecar) => {
  const block = getScientificBackgroundBlock(blockOrSidecar) ?? blockOrSidecar;
  if (!block || typeof block === "string") return flattenTextValues(block);
  return [
    block.introLine,
    ...(Array.isArray(block.sections)
      ? block.sections.flatMap((section) => [
        section.heading,
        section.summary,
        ...(Array.isArray(section.bullets) ? section.bullets : []),
        section.evidenceRead,
        section.shopperMeaning,
      ])
      : []),
    block.closingNote,
  ].filter(Boolean);
};

const buildCopyPreview = (lines) =>
  String(lines.filter(Boolean).join(" ").replace(/\s+/g, " ").trim()).slice(0, 220) || null;

const buildIngredientAliases = (name) => {
  const value = String(name ?? "").trim();
  if (!value) return [];
  const normalized = normalizeLooseText(value);
  const aliases = new Set([
    value.toLowerCase(),
    normalized,
    squashLooseText(value),
  ]);
  const add = (...items) => {
    for (const item of items) {
      const trimmed = String(item ?? "").trim();
      if (!trimmed) continue;
      aliases.add(trimmed.toLowerCase());
      aliases.add(normalizeLooseText(trimmed));
      aliases.add(squashLooseText(trimmed));
    }
  };

  if (/\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b/i.test(value)) {
    add("5-HTP", "5 HTP", "5HTP", "5-Hydroxytryptophan");
  }
  if (/(^|[^a-z])cla([^a-z]|$)|conjugated linoleic acid|tonalin/i.test(value)) {
    add("CLA", "Conjugated Linoleic Acid", "Tonalin");
  }
  if (/\bomega[\s-]*3\b/i.test(value)) {
    add("Omega-3", "Omega 3", "Omega3");
  }
  if (/\bgreen tea\b|\bmatcha\b|camellia sinensis/i.test(value)) {
    add("Green Tea", "Matcha", "Camellia sinensis");
  }
  if (/\bvitamin\s*c\b/i.test(value)) {
    add("Vitamin C", "Ascorbic Acid");
  }
  if (VITAMIN_D_ALIAS_PATTERN.test(value)) {
    add("Vitamin D", "Vitamin D3", "Vitamin D2", "D3", "D2", "Cholecalciferol", "Ergocalciferol");
  }
  if (/\bvitamin\s*b\s*12\b|\bb\s*12\b|\bcyanocobal(?:a|min|amin)\b|\bmethylcobalamin\b/i.test(value)) {
    add("Vitamin B12", "B12", "Cyanocobalamin", "Cyanocobalmin", "Methylcobalamin");
  }
  if (/\bsensoril\b|\bksm-?66\b|\bwithania\s+somnifera\b|\bashwagandha\b/i.test(value)) {
    add("Ashwagandha", "Withania somnifera", "Sensoril", "KSM-66");
  }
  if (/\bcarnitine\b/i.test(value)) {
    add("Carnitine", "L-Carnitine", "Acetyl L-Carnitine");
  }

  for (const match of value.matchAll(/\b([A-Z]{2,5})\b/g)) {
    add(match[1]);
  }
  for (const match of value.matchAll(/\(([A-Za-z]{2,5})\)/g)) {
    add(match[1]);
  }

  for (const token of normalized.split(/\s+/)) {
    if (token.length < 4) continue;
    if (INGREDIENT_TOKEN_STOPWORDS.has(token)) continue;
    aliases.add(token);
  }

  return Array.from(aliases)
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 3 || SHORT_INGREDIENT_ALIAS_PATTERN.test(alias));
};

const copyMentionsIngredient = (lines, ingredientName) => {
  if (!lines?.length || !ingredientName) return false;
  const joined = lines.join("\n");
  const normalized = normalizeLooseText(joined);
  const squashed = squashLooseText(joined);
  return buildIngredientAliases(ingredientName).some((alias) => {
    const normalizedAlias = normalizeLooseText(alias);
    if (!normalizedAlias) return false;
    if (normalized.includes(normalizedAlias)) return true;
    if (!normalizedAlias.includes(" ") && squashed.includes(normalizedAlias.replace(/\s+/g, ""))) return true;
    return false;
  });
};

const isTitleLedProteinAnchor = (name, title) =>
  /^protein$/i.test(String(name ?? "").trim()) && TITLE_LED_PROTEIN_PRODUCT_PATTERN.test(String(title ?? ""));

const isTitleLedProbioticVitaminDAnchor = (name, title) =>
  PROBIOTIC_ANCHOR_PATTERN.test(String(name ?? "")) &&
  PROBIOTIC_TITLE_PATTERN.test(String(title ?? "")) &&
  VITAMIN_D_TITLE_PATTERN.test(String(title ?? ""));

const isTitleLedDefaultAnchor = (name, context = {}) =>
  isTitleLedProteinAnchor(name, context?.title) ||
  isTitleLedProbioticVitaminDAnchor(name, context?.title);

export const isBadAnchorName = (name, context = {}) => {
  const value = String(name ?? "").trim();
  const title = String(context?.title ?? "").trim();
  if (!value) return true;
  if (isTitleLedProteinAnchor(value, title)) {
    return false;
  }
  if (/\bprotein\b/i.test(value) && /\b(?:pea|whey|rice|soy|hemp|collagen|casein|isolate|concentrate|powder)\b/i.test(value)) {
    return false;
  }
  if (/\bfiber\b/i.test(value) && /\b(?:apple|psyllium|acacia|inulin|prebiotic)?\s*fiber\b/i.test(title)) {
    return false;
  }
  if (/\bpotassium\s+(?:gluconate|citrate|chloride|iodide|bicarbonate)\b/i.test(value)) {
    return false;
  }
  if (/\b(?:multi(?:vitamin)?|vitamin|mineral|support|formula|blend|complex)\b/i.test(value) && !/^(?:calories?|total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|sodium|total\s+carbohydrates?|dietary\s+fib(?:er|re)|sugars?|added\s+sugars?|protein)$/i.test(value)) {
    return false;
  }
  if (MACRO_ANCHOR_PATTERN.test(value)) return true;
  if (PACKAGE_ANCHOR_PATTERN.test(value) && !/\b(?:omega|fish oil|green tea|tea extract|probiotic|collagen|multi(?:vitamin)?|vitamin|mineral|elderberry|sambucus|immune|melatonin|fiber)\b/i.test(value)) {
    return true;
  }
  return false;
};

export const isFoodLikeRow = (row) => {
  const haystack = [
    getRowCluster(row),
    row?.clusterLabel,
    row?.title,
    row?.brandName,
    row?.bucket,
    row?.canaryType,
  ]
    .filter(Boolean)
    .join(" ");
  return FOOD_LIKE_PATTERN.test(haystack);
};

const isFormulaStackRow = (row) =>
  FORMULA_STACK_PATTERN.test([
    getRowCluster(row),
    row?.clusterLabel,
    row?.title,
    row?.brandName,
  ]
    .filter(Boolean)
    .join(" "));

export const scientificGenericHit = (blockOrText) => {
  if (!blockOrText) return false;
  const haystack = typeof blockOrText === "string"
    ? blockOrText
    : [
      blockOrText.selectedLabel,
      blockOrText.selectedDose,
      blockOrText.introLine,
      ...(Array.isArray(blockOrText.sections)
        ? blockOrText.sections.flatMap((section) => [
          section.heading,
          section.summary,
          ...(Array.isArray(section.bullets) ? section.bullets : []),
          section.evidenceRead,
          section.shopperMeaning,
        ])
        : []),
      blockOrText.closingNote,
    ]
      .filter(Boolean)
      .join("\n");
  return GENERIC_SCIENCE_PATTERNS.some((pattern) => pattern.test(haystack));
};

export const sourceWeakHintLeakageHit = (blockOrText) => {
  const haystack = flattenTextValues(blockOrText).join("\n");
  if (!haystack) return false;
  return WEAK_SOURCE_COPY_PATTERNS.some((pattern) => pattern.test(haystack));
};

export const ingredientOverviewGenericHit = (blockOrText) => {
  const lines = collectIngredientOverviewText(blockOrText);
  const haystack = lines.join("\n");
  if (!haystack) return false;
  return (
    INGREDIENT_OVERVIEW_GENERIC_PATTERNS.some((pattern) => pattern.test(haystack))
    && !CONTEXTUAL_COPY_SIGNAL_PATTERN.test(haystack)
  );
};

export const ingredientOverviewFactualEchoHit = (
  blockOrText,
  { selectedIngredientDose } = {},
) => {
  const lines = collectIngredientOverviewText(blockOrText);
  const haystack = lines.join("\n");
  if (!haystack) return false;
  const selectedDose = String(selectedIngredientDose ?? "").trim();
  const hasDoseSignal = DOSE_OR_SERVING_PATTERN.test(haystack)
    || (selectedDose && haystack.toLowerCase().includes(selectedDose.toLowerCase()));
  return (
    !sourceWeakHintLeakageHit(haystack)
    && FACTUAL_ECHO_SIGNAL_PATTERN.test(haystack)
    && hasDoseSignal
    && haystack.length <= 260
    && !CONTEXTUAL_COPY_SIGNAL_PATTERN.test(haystack)
  );
};

const resolveDisplayedIngredientOverviewBlock = (normalized) =>
  getIngredientOverviewBlock(normalized?.ingredientOverview?.revalidated)
  ?? getIngredientOverviewBlock(normalized?.ingredientOverview?.initial)
  ?? null;

const resolveDisplayedScientificBackgroundBlock = (normalized) =>
  getScientificBackgroundBlock(normalized?.scientificBackground?.final)
  ?? getScientificBackgroundBlock(normalized?.scientificBackground?.initial)
  ?? null;

export const scoreUxSourceCopyRow = (row) => {
  const normalized = normalizeValidationRow(row);
  const ingredientOverviewBlock = resolveDisplayedIngredientOverviewBlock(normalized);
  const scientificBackgroundBlock = resolveDisplayedScientificBackgroundBlock(normalized);
  const selectedIngredientName =
    normalized.scientificBackground.selectedIngredientName
    ?? normalized.decisionSupport.defaultIngredientName
    ?? null;
  const ingredientOverviewText = collectIngredientOverviewText(ingredientOverviewBlock);
  const scientificBackgroundText = collectScientificBackgroundText(scientificBackgroundBlock);
  const evaluated = Boolean(ingredientOverviewText.length || scientificBackgroundText.length);

  const failureReasons = [];
  const flags = {
    uxSourceCopyEvaluated: evaluated,
    sourceWeakHintLeakage:
      sourceWeakHintLeakageHit(ingredientOverviewBlock)
      || sourceWeakHintLeakageHit(scientificBackgroundBlock),
    ingredientOverviewGeneric:
      ingredientOverviewText.length > 0 && ingredientOverviewGenericHit(ingredientOverviewBlock),
    ingredientOverviewFactualEcho:
      ingredientOverviewText.length > 0
      && ingredientOverviewFactualEchoHit(ingredientOverviewBlock, {
        selectedIngredientDose: normalized.decisionSupport.defaultIngredientDose,
      }),
    ingredientOverviewSelectedMismatch:
      ingredientOverviewText.length > 0
      && Boolean(selectedIngredientName)
      && !copyMentionsIngredient(ingredientOverviewText, selectedIngredientName),
    scientificBackgroundGeneric:
      scientificBackgroundText.length > 0 && scientificGenericHit(scientificBackgroundBlock),
    scientificBackgroundSelectedMismatch:
      scientificBackgroundText.length > 0
      && Boolean(selectedIngredientName)
      && !copyMentionsIngredient(scientificBackgroundText, selectedIngredientName),
  };

  if (flags.sourceWeakHintLeakage) failureReasons.push("source_weak_hint_leakage");
  if (flags.ingredientOverviewGeneric) failureReasons.push("ingredient_overview_generic");
  if (flags.ingredientOverviewFactualEcho) failureReasons.push("ingredient_overview_factual_echo");
  if (flags.ingredientOverviewSelectedMismatch) failureReasons.push("ingredient_overview_selected_mismatch");
  if (flags.scientificBackgroundGeneric) failureReasons.push("scientific_background_generic");
  if (flags.scientificBackgroundSelectedMismatch) failureReasons.push("scientific_background_selected_mismatch");

  return {
    ...normalized,
    ingredientOverviewBlock,
    scientificBackgroundBlock,
    flags: {
      ...flags,
      uxSourceCopyPass: evaluated ? failureReasons.length === 0 : false,
    },
    failureReasons,
    snippets: {
      ingredientOverview: buildCopyPreview(ingredientOverviewText),
      scientificBackground: buildCopyPreview(scientificBackgroundText),
    },
  };
};

const extractDecisionSupport = (row) => {
  const ds = row?.decisionSupport ?? {};
  const topStatus = normalizeStatus(row?.dsStatus ?? row?.httpStatus);
  const status = normalizeStatus(ds.status) ?? topStatus;
  const ok = normalizeBool(ds.ok) ?? normalizeBool(row?.ok) ?? (status ? status >= 200 && status < 300 : false);
  return {
    ok,
    status,
    elapsedMs: Number(ds.elapsedMs ?? row?.dsMs ?? row?.elapsedMs ?? 0) || null,
    sourceType: ds.sourceType ?? row?.sourceType ?? null,
    digest: ds.digest ?? row?.decisionDigest ?? null,
    decisionInputsHash: ds.decisionInputsHash ?? row?.decisionInputsHash ?? null,
    personalizationScopeHash: ds.personalizationScopeHash ?? row?.personalizationScopeHash ?? null,
    scienceRowCount: Number(ds.scienceRowCount ?? row?.scienceRowCount ?? row?.ingredientRowsCount ?? 0) || 0,
    defaultIngredientName:
      ds.defaultIngredientName
      ?? row?.defaultIngredientName
      ?? row?.defaultName
      ?? row?.selectedIngredient
      ?? null,
    defaultIngredientDose: ds.defaultIngredientDose ?? row?.defaultDose ?? row?.selectedDose ?? null,
    defaultIngredientAligned:
      normalizeBool(ds.defaultIngredientAligned)
      ?? normalizeBool(row?.defaultIngredientAligned)
      ?? normalizeBool(row?.aligned),
  };
};

const extractSidecarInitial = (row, key) => {
  if (key === "ingredientOverview") {
    const initial = row?.ingredientOverview?.initial ?? null;
    if (initial) {
      return {
        ok: normalizeBool(initial.ok) ?? (normalizeStatus(initial.status) ? normalizeStatus(initial.status) < 400 : null),
        status: normalizeStatus(initial.status),
        elapsedMs: Number(initial.elapsedMs ?? 0) || null,
        source: normalizeSource(initial.source),
        fallbackUsed: normalizeBool(initial.fallbackUsed),
        ingredientOverview: getIngredientOverviewBlock(initial),
        promptVersion: initial.promptVersion ?? null,
      };
    }
    return null;
  }
  const initial = row?.scientificBackground?.initial ?? null;
  if (initial) {
    return {
      ok: normalizeBool(initial.ok) ?? (normalizeStatus(initial.status) ? normalizeStatus(initial.status) < 400 : null),
      status: normalizeStatus(initial.status),
      elapsedMs: Number(initial.elapsedMs ?? 0) || null,
      source: normalizeSource(initial.source),
      fallbackUsed: normalizeBool(initial.fallbackUsed),
      mode: initial.mode ?? initial.planMode ?? row?.scientificBackground?.mode ?? null,
      genericHit: Boolean(initial.genericHit),
      backgroundRefreshPending: normalizeBool(initial.backgroundRefreshPending),
      scientificBackground: getScientificBackgroundBlock(initial),
      promptVersion: initial.promptVersion ?? null,
    };
  }
  if (row?.sbStatus || row?.sbSource || row?.sbMode) {
    return {
      ok: row?.sbStatus ? Number(row.sbStatus) < 400 : null,
      status: normalizeStatus(row?.sbStatus),
      elapsedMs: Number(row?.sbMs ?? 0) || null,
      source: normalizeSource(row?.sbSource),
      fallbackUsed: normalizeBool(row?.fallbackUsed),
      mode: row?.sbMode ?? null,
      genericHit: Boolean(row?.genericHit),
      backgroundRefreshPending: normalizeBool(row?.backgroundRefreshPending),
      scientificBackground: getScientificBackgroundBlock(row?.scientificBackground?.initial ?? row?.scientificBackground),
      promptVersion: row?.scientificBackground?.initial?.promptVersion ?? row?.scientificBackground?.promptVersion ?? null,
    };
  }
  return null;
};

const extractSidecarFinal = (row) => {
  const final = row?.scientificBackground?.final ?? null;
  if (final) {
    return {
      ok: normalizeBool(final.ok) ?? (normalizeStatus(final.status) ? normalizeStatus(final.status) < 400 : null),
      status: normalizeStatus(final.status),
      elapsedMs: Number(final.elapsedMs ?? 0) || null,
      source: normalizeSource(final.source),
      fallbackUsed: normalizeBool(final.fallbackUsed),
      mode: final.mode ?? final.planMode ?? row?.scientificBackground?.mode ?? null,
      genericHit: Boolean(final.genericHit),
      backgroundRefreshPending: normalizeBool(final.backgroundRefreshPending),
      scientificBackground: getScientificBackgroundBlock(final),
      promptVersion: final.promptVersion ?? null,
    };
  }
  return extractSidecarInitial(row, "scientificBackground");
};

export const normalizeValidationRow = (row) => {
  const decisionSupport = extractDecisionSupport(row);
  const ingredientOverviewInitial = extractSidecarInitial(row, "ingredientOverview");
  const ingredientOverviewRevalidated = row?.ingredientOverview?.revalidated
    ? {
      ok: normalizeBool(row.ingredientOverview.revalidated.ok),
      status: normalizeStatus(row.ingredientOverview.revalidated.status),
      elapsedMs: Number(row.ingredientOverview.revalidated.elapsedMs ?? 0) || null,
      source: normalizeSource(row.ingredientOverview.revalidated.source),
      fallbackUsed: normalizeBool(row.ingredientOverview.revalidated.fallbackUsed),
      ingredientOverview: getIngredientOverviewBlock(row.ingredientOverview.revalidated),
      promptVersion: row.ingredientOverview.revalidated.promptVersion ?? null,
    }
    : null;
  const scientificInitial = extractSidecarInitial(row, "scientificBackground");
  const scientificFinal = extractSidecarFinal(row);
  const productTypeMode =
    row?.sbMode
    ?? row?.scientificBackground?.final?.mode
    ?? row?.scientificBackground?.initial?.mode
    ?? row?.scientificBackground?.mode
    ?? null;

  return {
    raw: row,
    key: rowKey(row),
    barcode: getRowBarcode(row),
    cluster: getRowCluster(row),
    clusterLabel: row?.clusterLabel ?? row?.bucket ?? row?.canaryType ?? null,
    brandName: row?.brandName ?? null,
    title: row?.title ?? null,
    productId: row?.productId ?? row?.product_id ?? null,
    isFoodLike: isFoodLikeRow(row),
    isFormulaStack: isFormulaStackRow(row),
    productTypeMode,
    decisionSupport,
    ingredientOverview: {
      initial: ingredientOverviewInitial,
      revalidated: ingredientOverviewRevalidated,
    },
    scientificBackground: {
      selectedIngredientName:
        row?.scientificBackground?.selectedIngredientName
        ?? row?.selectedIngredient
        ?? decisionSupport.defaultIngredientName,
      initial: scientificInitial,
      final: scientificFinal,
    },
  };
};

const sidecarHasRouteFailure = (sidecar) => {
  const status = sidecar?.status;
  if (status === 0) return true;
  if (status && status >= 400) return true;
  return false;
};

const sidecarHas5xxOrTimeout = (sidecar) => {
  const status = sidecar?.status;
  if (status === 0) return true;
  if (status && status >= 500) return true;
  return false;
};

export const scoreValidationRow = (row) => {
  const normalized = normalizeValidationRow(row);
  const ds = normalized.decisionSupport;
  const ioInitial = normalized.ingredientOverview.initial;
  const ioRevalidated = normalized.ingredientOverview.revalidated;
  const sbInitial = normalized.scientificBackground.initial;
  const sbFinal = normalized.scientificBackground.final;
  const defaultName = ds.defaultIngredientName;
  const hasScienceRows = ds.scienceRowCount > 0;
  const badAnchor = isBadAnchorName(defaultName, { title: normalized.title, cluster: normalized.cluster });
  const titleLedDefaultAnchor = isTitleLedDefaultAnchor(defaultName, { title: normalized.title });
  const scientificGenericFinal = Boolean(sbFinal?.genericHit);
  const productTypeResearchLeak =
    normalized.isFoodLike && /research/i.test(String(normalized.productTypeMode ?? ""));

  const routeFailures = [];
  if (!ds.ok) routeFailures.push("decision_support_not_ok");
  if (sidecarHasRouteFailure(ioInitial)) routeFailures.push("ingredient_overview_route_failure");
  if (sidecarHasRouteFailure(sbInitial)) routeFailures.push("scientific_background_route_failure");

  const sidecar5xxTimeout =
    (!ds.ok && (ds.status === 0 || Number(ds.status) >= 500))
    || sidecarHas5xxOrTimeout(ioInitial)
    || sidecarHas5xxOrTimeout(sbInitial)
    || sidecarHas5xxOrTimeout(ioRevalidated)
    || sidecarHas5xxOrTimeout(sbFinal);

  let defaultIngredientPass = false;
  let defaultIngredientWarn = false;
  if (!hasScienceRows || badAnchor) {
    defaultIngredientPass = false;
  } else if (ds.defaultIngredientAligned === true) {
    defaultIngredientPass = true;
  } else if (titleLedDefaultAnchor) {
    defaultIngredientPass = true;
    defaultIngredientWarn = true;
  } else if (normalized.isFormulaStack || /^popular_/i.test(normalized.cluster) || normalized.cluster === "broad_residue") {
    defaultIngredientPass = true;
    defaultIngredientWarn = true;
  } else if (normalized.isFoodLike && !productTypeResearchLeak) {
    defaultIngredientPass = true;
    defaultIngredientWarn = true;
  }

  const summaryPass =
    !scientificGenericFinal
    && (!sbFinal || (sbFinal.ok !== false && ["api", "server-fallback", null].includes(sbFinal.source)))
    && (!ioInitial || ioInitial.ok !== false || (ioRevalidated && ioRevalidated.ok !== false));

  const failureReasons = [
    ...routeFailures,
    ...(!hasScienceRows ? ["missing_science_rows"] : []),
    ...(badAnchor ? ["macro_or_package_bad_anchor"] : []),
    ...(!defaultIngredientPass ? ["default_ingredient_quality_fail"] : []),
    ...(scientificGenericFinal ? ["scientific_generic_final"] : []),
    ...(productTypeResearchLeak ? ["food_like_research_mode_leakage"] : []),
    ...(sidecar5xxTimeout ? ["sidecar_5xx_or_timeout"] : []),
  ];

  return {
    ...normalized,
    flags: {
      routeHealthPass: ds.ok && routeFailures.length === 0,
      sidecar5xxTimeout,
      scienceRowCoveragePass: hasScienceRows && !badAnchor,
      missingScienceRows: !hasScienceRows,
      badAnchor,
      defaultIngredientQualityPass: defaultIngredientPass,
      defaultIngredientQualityWarn: defaultIngredientWarn,
      summaryQualityPass: summaryPass,
      scientificGenericFinal,
      productTypeRoutingApplicable: normalized.isFoodLike,
      productTypeRoutingPass: normalized.isFoodLike ? !productTypeResearchLeak : true,
      foodLikeResearchModeLeakage: productTypeResearchLeak,
      scientificBackgroundInitialApi: sbInitial?.source === "api",
      scientificBackgroundInitialFallback: sbInitial?.source === "server-fallback",
      scientificBackgroundFinalApi: sbFinal?.source === "api",
      scientificBackgroundFinalFallback: sbFinal?.source === "server-fallback",
      scientificBackgroundUpgradedToApi: sbInitial?.source === "server-fallback" && sbFinal?.source === "api",
      ingredientOverviewInitialApi: ioInitial?.source === "api",
      ingredientOverviewInitialFallback: ioInitial?.source === "server-fallback",
      ingredientOverviewUpgradedToApi: ioInitial?.source === "server-fallback" && ioRevalidated?.source === "api",
    },
    failureReasons: Array.from(new Set(failureReasons)),
  };
};

const groupBy = (rows, keyFn) => {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
};

const buildScore = (pass, total) => ({
  pass,
  total,
  fail: Math.max(0, total - pass),
  rate: percent(pass, total),
});

export const summarizeUxSourceCopyRows = (rows) => {
  const scoredRows = rows.map(scoreUxSourceCopyRow);
  const evaluatedRows = scoredRows.filter((row) => row.flags.uxSourceCopyEvaluated);
  const pass = evaluatedRows.filter((row) => row.flags.uxSourceCopyPass).length;
  const sourceWeakHintLeakage = evaluatedRows.filter((row) => row.flags.sourceWeakHintLeakage).length;
  const ingredientOverviewGeneric = evaluatedRows.filter((row) => row.flags.ingredientOverviewGeneric).length;
  const ingredientOverviewFactualEcho = evaluatedRows.filter((row) => row.flags.ingredientOverviewFactualEcho).length;
  const ingredientOverviewSelectedMismatch = evaluatedRows.filter((row) => row.flags.ingredientOverviewSelectedMismatch).length;
  const scientificBackgroundGeneric = evaluatedRows.filter((row) => row.flags.scientificBackgroundGeneric).length;
  const scientificBackgroundSelectedMismatch = evaluatedRows.filter((row) => row.flags.scientificBackgroundSelectedMismatch).length;

  const failureBuckets = Array.from(groupBy(
    evaluatedRows.flatMap((row) => row.failureReasons.map((reason) => ({ reason, row }))),
    (entry) => entry.reason,
  ))
    .map(([reason, entries]) => ({
      reason,
      count: entries.length,
      examples: entries.slice(0, 5).map(({ row }) => ({
        barcode: row.barcode,
        cluster: row.cluster,
        title: row.title,
        brandName: row.brandName,
        selectedIngredientName: row.scientificBackground.selectedIngredientName,
        ingredientOverview: row.snippets.ingredientOverview,
        scientificBackground: row.snippets.scientificBackground,
      })),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    sampleCount: rows.length,
    evaluatedCount: evaluatedRows.length,
    notEvaluatedCount: Math.max(0, rows.length - evaluatedRows.length),
    pass,
    fail: Math.max(0, evaluatedRows.length - pass),
    rate: percent(pass, evaluatedRows.length),
    sourceWeakHintLeakage,
    ingredientOverviewGeneric,
    ingredientOverviewFactualEcho,
    ingredientOverviewSelectedMismatch,
    scientificBackgroundGeneric,
    scientificBackgroundSelectedMismatch,
    failureBuckets,
    topBadExamples: evaluatedRows
      .filter((row) => !row.flags.uxSourceCopyPass)
      .slice(0, 20)
      .map((row) => ({
        barcode: row.barcode,
        cluster: row.cluster,
        title: row.title,
        brandName: row.brandName,
        selectedIngredientName: row.scientificBackground.selectedIngredientName,
        failures: row.failureReasons,
        ingredientOverview: row.snippets.ingredientOverview,
        scientificBackground: row.snippets.scientificBackground,
      })),
  };
};

export const summarizeValidationRows = (rows) => {
  const scoredRows = rows.map(scoreValidationRow);
  const total = scoredRows.length;
  const routePass = scoredRows.filter((row) => row.flags.routeHealthPass).length;
  const scienceCoveragePass = scoredRows.filter((row) => row.flags.scienceRowCoveragePass).length;
  const defaultQualityPass = scoredRows.filter((row) => row.flags.defaultIngredientQualityPass).length;
  const summaryQualityPass = scoredRows.filter((row) => row.flags.summaryQualityPass).length;
  const productRoutingRows = scoredRows.filter((row) => row.flags.productTypeRoutingApplicable);
  const productRoutingPass = productRoutingRows.filter((row) => row.flags.productTypeRoutingPass).length;
  const sidecar5xxTimeout = scoredRows.filter((row) => row.flags.sidecar5xxTimeout).length;
  const macroPackageBadAnchors = scoredRows.filter((row) => row.flags.badAnchor).length;
  const missingScienceRows = scoredRows.filter((row) => row.flags.missingScienceRows).length;
  const scientificGenericFinal = scoredRows.filter((row) => row.flags.scientificGenericFinal).length;
  const foodLikeResearchModeLeakage = scoredRows.filter((row) => row.flags.foodLikeResearchModeLeakage).length;
  const uxSourceCopy = summarizeUxSourceCopyRows(rows);

  const routeHealth = {
    ...buildScore(routePass, total),
    decisionSupportOk: scoredRows.filter((row) => row.decisionSupport.ok).length,
    sidecar5xxTimeout,
    sidecar5xxTimeoutRate: percent(sidecar5xxTimeout, total),
  };
  const scienceRowCoverage = {
    ...buildScore(scienceCoveragePass, total),
    missingScienceRows,
    macroPackageBadAnchors,
  };
  const defaultIngredientQuality = {
    ...buildScore(defaultQualityPass, total),
    warnings: scoredRows.filter((row) => row.flags.defaultIngredientQualityWarn).length,
  };
  const summaryQuality = {
    ...buildScore(summaryQualityPass, total),
    ingredientOverviewInitialApi: scoredRows.filter((row) => row.flags.ingredientOverviewInitialApi).length,
    ingredientOverviewInitialFallback: scoredRows.filter((row) => row.flags.ingredientOverviewInitialFallback).length,
    ingredientOverviewUpgradedToApi: scoredRows.filter((row) => row.flags.ingredientOverviewUpgradedToApi).length,
    scientificBackgroundInitialApi: scoredRows.filter((row) => row.flags.scientificBackgroundInitialApi).length,
    scientificBackgroundInitialFallback: scoredRows.filter((row) => row.flags.scientificBackgroundInitialFallback).length,
    scientificBackgroundFinalApi: scoredRows.filter((row) => row.flags.scientificBackgroundFinalApi).length,
    scientificBackgroundFinalFallback: scoredRows.filter((row) => row.flags.scientificBackgroundFinalFallback).length,
    scientificBackgroundUpgradedToApi: scoredRows.filter((row) => row.flags.scientificBackgroundUpgradedToApi).length,
    scientificGenericFinal,
  };
  const productTypeRouting = {
    ...buildScore(productRoutingPass, productRoutingRows.length),
    applicableCount: productRoutingRows.length,
    foodLikeResearchModeLeakage,
    foodLikeResearchModeLeakageRate: percent(foodLikeResearchModeLeakage, productRoutingRows.length),
  };

  const failureBuckets = Array.from(groupBy(
    scoredRows.flatMap((row) => row.failureReasons.map((reason) => ({ reason, row }))),
    (entry) => entry.reason,
  ))
    .map(([reason, entries]) => ({
      reason,
      count: entries.length,
      examples: entries.slice(0, 5).map(({ row }) => ({
        barcode: row.barcode,
        cluster: row.cluster,
        title: row.title,
        brandName: row.brandName,
        defaultIngredientName: row.decisionSupport.defaultIngredientName,
      })),
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const clusterBreakdown = Array.from(groupBy(scoredRows, (row) => row.cluster))
    .map(([cluster, clusterRows]) => ({
      cluster,
      sampleCount: clusterRows.length,
      routeHealthRate: percent(clusterRows.filter((row) => row.flags.routeHealthPass).length, clusterRows.length),
      scienceRowCoverageRate: percent(clusterRows.filter((row) => row.flags.scienceRowCoveragePass).length, clusterRows.length),
      defaultIngredientQualityRate: percent(clusterRows.filter((row) => row.flags.defaultIngredientQualityPass).length, clusterRows.length),
      missingScienceRows: clusterRows.filter((row) => row.flags.missingScienceRows).length,
      macroPackageBadAnchors: clusterRows.filter((row) => row.flags.badAnchor).length,
      scientificGenericFinal: clusterRows.filter((row) => row.flags.scientificGenericFinal).length,
      foodLikeResearchModeLeakage: clusterRows.filter((row) => row.flags.foodLikeResearchModeLeakage).length,
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount || a.cluster.localeCompare(b.cluster));

  let qualityVerdict = "pass";
  if (
    routeHealth.rate < SCIENCE_VALIDATION_GATES.decisionSupportOkRate
    || scienceRowCoverage.rate < SCIENCE_VALIDATION_GATES.scienceRowCoverageRate
    || defaultIngredientQuality.rate < SCIENCE_VALIDATION_GATES.defaultIngredientQualityRate
    || routeHealth.sidecar5xxTimeoutRate >= SCIENCE_VALIDATION_GATES.sidecar5xxTimeoutRate
    || scientificGenericFinal > SCIENCE_VALIDATION_GATES.scientificGenericFinal
    || productTypeRouting.foodLikeResearchModeLeakageRate >= SCIENCE_VALIDATION_GATES.foodLikeResearchLeakageRate
    || (uxSourceCopy.evaluatedCount > 0 && uxSourceCopy.fail > 0)
  ) {
    qualityVerdict = "fail";
  } else if (
    macroPackageBadAnchors > SCIENCE_VALIDATION_GATES.macroPackageBadAnchors
    || summaryQuality.scientificBackgroundFinalFallback > summaryQuality.scientificBackgroundFinalApi
    || defaultIngredientQuality.warnings > total * 0.1
  ) {
    qualityVerdict = "warn";
  }

  const recommendedNextAction = failureBuckets.length
    ? `Fix the largest remaining bucket first: ${failureBuckets[0].reason} (${failureBuckets[0].count} rows).`
    : uxSourceCopy.failureBuckets.length
      ? `Fix the largest remaining UX copy bucket first: ${uxSourceCopy.failureBuckets[0].reason} (${uxSourceCopy.failureBuckets[0].count} rows).`
      : "Proceed to the next validation phase.";

  const topBadExamples = scoredRows
    .filter((row) => row.failureReasons.length > 0)
    .slice(0, 20)
    .map((row) => ({
      barcode: row.barcode,
      cluster: row.cluster,
      brandName: row.brandName,
      title: row.title,
      defaultIngredientName: row.decisionSupport.defaultIngredientName,
      scienceRowCount: row.decisionSupport.scienceRowCount,
      productTypeMode: row.productTypeMode,
      failures: row.failureReasons,
    }));

  return {
    sampleCount: total,
    qualityVerdict,
    routeHealth,
    scienceRowCoverage,
    defaultIngredientQuality,
    summaryQuality,
    productTypeRouting,
    uxSourceCopy,
    estimatedAlignedCount: defaultQualityPass,
    estimatedAlignedRate: defaultIngredientQuality.rate,
    estimatedMissingScienceRows: missingScienceRows,
    macroPackageBadAnchors,
    foodLikeResearchModeLeakage,
    failureBuckets,
    topBadExamples,
    clusterBreakdown,
    recommendedNextAction,
  };
};

export const applyCanaryOverlay = (baseRow, overlayRow, sourceName) => {
  const merged = {
    ...(baseRow ?? {}),
    ...overlayRow,
    cluster: baseRow?.cluster ?? overlayRow?.cluster ?? overlayRow?.bucket ?? overlayRow?.canaryType ?? "unknown",
    clusterLabel: baseRow?.clusterLabel ?? overlayRow?.clusterLabel ?? overlayRow?.bucket ?? overlayRow?.canaryType ?? null,
    _mergeSources: Array.from(new Set([...(baseRow?._mergeSources ?? []), sourceName])),
  };

  const overlayDs = extractDecisionSupport(overlayRow);
  const hasOverlayDs =
    overlayRow?.decisionSupport
    || overlayRow?.dsStatus
    || overlayRow?.httpStatus
    || overlayRow?.defaultName
    || overlayRow?.selectedIngredient
    || overlayRow?.scienceRowCount
    || overlayRow?.ingredientRowsCount;

  if (hasOverlayDs) {
    merged.decisionSupport = {
      ...(baseRow?.decisionSupport ?? {}),
      ok: overlayDs.ok,
      status: overlayDs.status,
      elapsedMs: overlayDs.elapsedMs,
      sourceType: overlayDs.sourceType,
      digest: overlayDs.digest ?? baseRow?.decisionSupport?.digest ?? null,
      decisionInputsHash:
        overlayDs.decisionInputsHash ?? baseRow?.decisionSupport?.decisionInputsHash ?? null,
      personalizationScopeHash:
        overlayDs.personalizationScopeHash ?? baseRow?.decisionSupport?.personalizationScopeHash ?? null,
      defaultIngredientName: overlayDs.defaultIngredientName,
      defaultIngredientDose: overlayDs.defaultIngredientDose,
      defaultIngredientAligned: overlayDs.defaultIngredientAligned,
      scienceRowCount: overlayDs.scienceRowCount,
    };
  }

  if (overlayRow?.ingredientOverview) {
    merged.ingredientOverview = {
      ...(baseRow?.ingredientOverview ?? {}),
      ...overlayRow.ingredientOverview,
    };
  }

  if (overlayRow?.scientificBackground || overlayRow?.sbStatus || overlayRow?.sbSource || overlayRow?.sbMode) {
    const initial = extractSidecarInitial(overlayRow, "scientificBackground");
    merged.scientificBackground = {
      ...(baseRow?.scientificBackground ?? {}),
      ...(overlayRow?.scientificBackground ?? {}),
      initial: overlayRow?.scientificBackground?.initial ?? baseRow?.scientificBackground?.initial ?? initial,
      final: overlayRow?.scientificBackground?.final ?? baseRow?.scientificBackground?.final ?? initial,
      mode: overlayRow?.sbMode ?? overlayRow?.scientificBackground?.mode ?? baseRow?.scientificBackground?.mode ?? null,
      selectedIngredientName:
        overlayRow?.scientificBackground?.selectedIngredientName
        ?? overlayRow?.selectedIngredient
        ?? baseRow?.scientificBackground?.selectedIngredientName
        ?? null,
    };
  }

  return merged;
};

export const renderMarkdownReport = ({
  title,
  generatedAt,
  summary,
  sourceReports = [],
  mergeStats = null,
  phaseNotes = [],
}) => {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`Quality verdict: **${summary.qualityVerdict}**`);
  lines.push("");
  lines.push("## Headline Metrics");
  lines.push("");
  lines.push(`- Sample count: ${summary.sampleCount}`);
  lines.push(`- Estimated aligned/default ingredient quality: ${summary.estimatedAlignedCount}/${summary.sampleCount} (${summary.estimatedAlignedRate}%)`);
  lines.push(`- Estimated missing science rows: ${summary.estimatedMissingScienceRows}`);
  lines.push(`- Macro/package bad anchors: ${summary.macroPackageBadAnchors}`);
  lines.push(`- Food-like research-mode leakage: ${summary.foodLikeResearchModeLeakage}`);
  lines.push("");
  lines.push("## Five-Score Model");
  lines.push("");
  lines.push(`- routeHealth: ${summary.routeHealth.pass}/${summary.routeHealth.total} (${summary.routeHealth.rate}%), sidecar 5xx/timeout ${summary.routeHealth.sidecar5xxTimeout} (${summary.routeHealth.sidecar5xxTimeoutRate}%)`);
  lines.push(`- scienceRowCoverage: ${summary.scienceRowCoverage.pass}/${summary.scienceRowCoverage.total} (${summary.scienceRowCoverage.rate}%)`);
  lines.push(`- defaultIngredientQuality: ${summary.defaultIngredientQuality.pass}/${summary.defaultIngredientQuality.total} (${summary.defaultIngredientQuality.rate}%), warnings ${summary.defaultIngredientQuality.warnings}`);
  lines.push(`- summaryQuality: ${summary.summaryQuality.pass}/${summary.summaryQuality.total} (${summary.summaryQuality.rate}%), scientific final api ${summary.summaryQuality.scientificBackgroundFinalApi}, final server-fallback ${summary.summaryQuality.scientificBackgroundFinalFallback}, generic final ${summary.summaryQuality.scientificGenericFinal}`);
  lines.push(`- productTypeRouting: ${summary.productTypeRouting.pass}/${summary.productTypeRouting.total} (${summary.productTypeRouting.rate}%), leakage ${summary.productTypeRouting.foodLikeResearchModeLeakage}`);
  lines.push("");
  if (summary.uxSourceCopy) {
    lines.push("## UX Source/Copy Closure");
    lines.push("");
    lines.push(`- evaluated: ${summary.uxSourceCopy.pass}/${summary.uxSourceCopy.evaluatedCount} (${summary.uxSourceCopy.rate}%), not evaluated ${summary.uxSourceCopy.notEvaluatedCount}`);
    lines.push(`- source weak hint leakage: ${summary.uxSourceCopy.sourceWeakHintLeakage}`);
    lines.push(`- ingredient overview generic: ${summary.uxSourceCopy.ingredientOverviewGeneric}`);
    lines.push(`- ingredient overview factual echo: ${summary.uxSourceCopy.ingredientOverviewFactualEcho}`);
    lines.push(`- ingredient overview selected mismatch: ${summary.uxSourceCopy.ingredientOverviewSelectedMismatch}`);
    lines.push(`- scientific background generic: ${summary.uxSourceCopy.scientificBackgroundGeneric}`);
    lines.push(`- scientific background selected mismatch: ${summary.uxSourceCopy.scientificBackgroundSelectedMismatch}`);
    lines.push("");
  }
  if (mergeStats) {
    lines.push("## Merge Stats");
    lines.push("");
    for (const [key, value] of Object.entries(mergeStats)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push("");
  }
  if (sourceReports.length) {
    lines.push("## Source Reports");
    lines.push("");
    for (const source of sourceReports) {
      lines.push(`- ${source.label}: ${source.path} (${source.rows} rows)`);
    }
    lines.push("");
  }
  lines.push("## Failure Buckets");
  lines.push("");
  if (summary.failureBuckets.length) {
    for (const bucket of summary.failureBuckets.slice(0, 20)) {
      lines.push(`- ${bucket.reason}: ${bucket.count}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("");
  if (summary.uxSourceCopy?.failureBuckets?.length) {
    lines.push("## UX Copy Failure Buckets");
    lines.push("");
    for (const bucket of summary.uxSourceCopy.failureBuckets.slice(0, 20)) {
      lines.push(`- ${bucket.reason}: ${bucket.count}`);
    }
    lines.push("");
  }
  lines.push("## Cluster Breakdown");
  lines.push("");
  lines.push("| Cluster | Rows | Row coverage | Default quality | Missing rows | Bad anchors | Generic final | Food-like leakage |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const cluster of summary.clusterBreakdown.slice(0, 40)) {
    lines.push(`| ${cluster.cluster} | ${cluster.sampleCount} | ${cluster.scienceRowCoverageRate}% | ${cluster.defaultIngredientQualityRate}% | ${cluster.missingScienceRows} | ${cluster.macroPackageBadAnchors} | ${cluster.scientificGenericFinal} | ${cluster.foodLikeResearchModeLeakage} |`);
  }
  lines.push("");
  lines.push("## Top Bad Examples");
  lines.push("");
  if (summary.topBadExamples.length) {
    for (const example of summary.topBadExamples.slice(0, 20)) {
      lines.push(`- ${example.cluster} / ${example.barcode}: ${example.title ?? "Untitled"} -> ${example.defaultIngredientName ?? "no default"} (${example.failures.join(", ")})`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("## Recommended Next Action");
  lines.push("");
  lines.push(summary.recommendedNextAction);
  if (phaseNotes.length) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    for (const note of phaseNotes) lines.push(`- ${note}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};
