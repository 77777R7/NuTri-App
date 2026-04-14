import type { IngredientScienceContext } from "../ingredientScienceContext.js";
import { normalizeIngredientScienceKey } from "../ingredientScienceContext.js";
import { extractJsonObjectLoose } from "./summaryCompiler.js";

type IngredientOverviewMode = "single_anchor" | "multi_anchor" | "blend_anchor";

type IngredientOverviewBlock = {
  mode: IngredientOverviewMode;
  titleLine: string | null;
  paragraph1: string;
  paragraph2: string | null;
  compareHint: string | null;
};

type IngredientOverviewLlmOutput = Partial<IngredientOverviewBlock>;

export type IngredientOverviewCompileResult = {
  ingredientOverview: IngredientOverviewBlock;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  promptVersion: string;
  diagnostics: IngredientOverviewCompileDiagnostics;
};

export type IngredientOverviewCompileDiagnostics = {
  liveWriterConfigured: boolean;
  liveWriterAttempted: boolean;
  liveWriterHit: boolean;
  attemptCount: number;
  timeoutMs: number;
  maxRetries: number;
  fallbackReason: string | null;
  lastError: string | null;
  parseFailureCount: number;
  gateRejectCount: number;
  timeoutCount: number;
  errorCount: number;
};

export type CompileIngredientOverviewOpts = {
  llmFn?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
};

export type IngredientOverviewExecutionProfile = {
  timeoutMs: number;
  backgroundRefreshTimeoutMs: number;
  maxRetries: number;
  backgroundRefreshMaxRetries: number;
  maxTokens: number;
  cacheTtlMs: number;
};

export const INGREDIENT_OVERVIEW_PROMPT_VERSION = "ingredient_overview_v8";

const LLM_TIMEOUT_MS = 9_000;
const LLM_MAX_RETRIES = 1;
const SINGLE_ANCHOR_TIMEOUT_MS = 3_000;
const MULTI_ANCHOR_TIMEOUT_MS = 3_750;
const BLEND_ANCHOR_TIMEOUT_MS = 3_250;
const COMPLEX_FORMULA_TIMEOUT_MS = 4_250;
const BACKGROUND_REFRESH_TIMEOUT_MS = 14_000;
const COMPLEX_BACKGROUND_REFRESH_TIMEOUT_MS = 18_000;
const INGREDIENT_OVERVIEW_MAX_TOKENS = 450;
const INGREDIENT_OVERVIEW_CACHE_TTL_MS = 10 * 60_000;

const BANNED_PATTERNS = [
  /people take this/i,
  /may help support/i,
  /\bsupports?\b/i,
  /\bboosts?\b/i,
  /\btreats?\b/i,
  /\bprevents?\b/i,
  /\bcures?\b/i,
  /\bdiagnoses?\b/i,
  /\bclinical studies?\b/i,
  /\bhas been studied\b/i,
  /\bresearch suggests\b/i,
  /\bevidence is mixed\b/i,
  /\bbest form\b/i,
  /\bsuperior\b/i,
  /\bimproves absorption\b/i,
];

const ROLE_KEYWORD_PATTERN = /\blabel\b|\bsource\b|\bbreakdown\b|\btotal\b|\bcompare\b|\bdisclosure\b|\bblend\b|\bformula\b|\bcompanion\b/i;
const FACTUAL_RESTATEMENT_PATTERNS = [
  /\bthis supplement provides\b/i,
  /\bthis formula delivers\b/i,
  /\bthis product contains\b/i,
  /\bit provides\b.{0,80}\bmg\b/i,
  /\bit delivers\b.{0,80}\bmg\b/i,
  /\bit includes\b.{0,120}\bmg\b/i,
];
const SPECIFIC_COMPARE_HINT_PATTERN =
  /\b(per serving|stated amount|disclosed amount|breakdown|epa|dha|source|form|delivery|strain|cfu|blend total|item[- ]level|disclosure|label)\b/i;

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeDiagnosticReason = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
};

const resolveErrorReason = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown_error";
  const normalized = normalizeDiagnosticReason(error.message);
  return normalized ?? "unknown_error";
};

const normalizeComparable = (value: string | null | undefined): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const lowerFirst = (value: string | null | undefined): string => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
};

const lineRoleLabel = (value: string | null | undefined): string => {
  switch (value) {
    case "primary_active":
      return "lead active";
    case "companion_nutrient":
      return "supporting nutrient";
    case "source_line":
      return "source line";
    case "aggregate_line":
      return "total line";
    case "breakdown_line":
      return "breakdown line";
    case "blend_line":
      return "blend-style line";
    default:
      return "supporting formula line";
  }
};

const joinNames = (values: string[]): string => {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const buildFormulaRoleSummary = (context: IngredientScienceContext): string | null => {
  const anchorName = normalizeText(context.anchorIngredient?.name);
  if (!anchorName) return null;
  const companionNames = context.coIngredients
    .filter((row) => row.lineRole === "companion_nutrient" || row.lineRole === "generic_line")
    .map((row) => row.name)
    .slice(0, 3);
  const structuralNames = context.coIngredients
    .filter((row) => row.lineRole !== "companion_nutrient" && row.lineRole !== "generic_line")
    .map((row) => `${row.name} (${lineRoleLabel(row.lineRole)})`)
    .slice(0, 2);
  const relationships = context.relationshipCandidates.map((candidate) => candidate.safeStatement).slice(0, 2);

  const parts = [
    `${anchorName} is the lead active in this formula.`,
    companionNames.length
      ? `${joinNames(companionNames)} appear as companion or supporting lines around that anchor.`
      : null,
    structuralNames.length
      ? `The label also includes ${joinNames(structuralNames)} that shape how the formula should be read.`
      : null,
    relationships[0] ?? null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : null;
};

const asSentence = (value: string | null | undefined): string => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const splitSentences = (value: string): string[] =>
  normalizeText(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

const removeWeakOrUnsafeSentences = (
  context: IngredientScienceContext,
  value: string | null | undefined,
): string => {
  const kept = splitSentences(String(value ?? "")).filter((sentence) => {
    if (BANNED_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
    if (FACTUAL_RESTATEMENT_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
    if (countDoseMentions(context, sentence) > 0) return false;
    return true;
  });
  return normalizeText(kept.join(" "));
};

const isSentenceLikeTitle = (value: string | null | undefined): boolean => {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (/[.!?]$/.test(normalized)) return true;
  return /\b(centers? on|focus(?:es)? on|provides|contains|delivers)\b/i.test(normalized);
};

const countIngredientMentions = (context: IngredientScienceContext, text: string): number => {
  const haystack = normalizeComparable(text);
  if (!haystack) return 0;
  return context.ingredientDescriptors.reduce((count, descriptor) => {
    const comparableName = normalizeComparable(descriptor.name);
    if (!comparableName) return count;
    return haystack.includes(comparableName) ? count + 1 : count;
  }, 0);
};

const countDoseMentions = (context: IngredientScienceContext, text: string): number => {
  const haystack = normalizeComparable(text);
  if (!haystack) return 0;
  return context.ingredientDescriptors.reduce((count, descriptor) => {
    const comparableDose = normalizeComparable(descriptor.dose);
    if (!comparableDose) return count;
    return haystack.includes(comparableDose) ? count + 1 : count;
  }, 0);
};

const getMode = (context: IngredientScienceContext): IngredientOverviewMode => {
  if (context.formulaMode === "single_ingredient") return "single_anchor";
  if (context.formulaMode === "blend") return "blend_anchor";
  return "multi_anchor";
};

const buildTitleLineFallback = (context: IngredientScienceContext): string | null => {
  if (context.formulaMode === "single_ingredient") {
    return context.anchorIngredient?.name ?? "Single-ingredient formula";
  }
  if (context.ingredientFamily === "omega_3") return "Omega-3 formula";
  if (context.ingredientFamily === "probiotic_or_blend") return "Blend-style formula";
  if (context.anchorIngredient?.name) return context.anchorIngredient.name;
  return "Supplement formula";
};

const buildSingleAnchorFallback = (context: IngredientScienceContext): IngredientOverviewBlock => {
  const anchorName = context.anchorIngredient?.name ?? "This ingredient";
  switch (context.ingredientFamily) {
    case "astaxanthin_carotenoid":
      return {
        mode: "single_anchor",
        titleLine: "Astaxanthin",
        paragraph1: "Astaxanthin is a carotenoid pigment commonly associated with microalgae and with the red or pink color seen in foods such as salmon and shrimp.",
        paragraph2: "On supplement labels, it usually appears as a stand-alone active rather than as a broad blend or total line, which makes the ingredient identity easier to compare across products.",
        compareHint: "When comparing products, focus on the stated amount per serving, the named source, and whether the label clearly identifies the form or delivery type.",
      };
    case "vitamin_c":
      return {
        mode: "single_anchor",
        titleLine: "Vitamin C",
        paragraph1: "Vitamin C is a single-ingredient vitamin formula, and this label names the active directly instead of burying it inside a broader blend or matrix.",
        paragraph2: "That makes the product easier to compare because shoppers can focus on the exact ingredient identity and stated form without decoding a more complex formula first.",
        compareHint: "When comparing products, look first at the stated vitamin C amount and then check whether the label clearly states the exact form and delivery type.",
      };
    case "zinc":
      return {
        mode: "single_anchor",
        titleLine: "Zinc",
        paragraph1: "Zinc is a mineral ingredient that often appears in simple, directly labeled supplement formulas rather than as part of a broad blend total.",
        paragraph2: "Here it functions as the main disclosed active, so the shopper can compare the named mineral and stated amount without decoding a more complex formula first.",
        compareHint: "When comparing products, focus on the named zinc ingredient, the stated amount per serving, and whether the form is clearly disclosed.",
      };
    case "omega_3":
      return {
        mode: "single_anchor",
        titleLine: buildTitleLineFallback(context),
        paragraph1: "This product is organized around omega-3 fats as the primary disclosed active rather than a broad multi-part formula.",
        paragraph2: "For omega-3 labels, the most useful comparison details are usually the named fatty acids and the clearly stated per-serving amounts.",
        compareHint: "When comparing products, focus on total omega-3 plus the disclosed EPA and DHA amounts whenever the label provides them.",
      };
    default:
      return {
        mode: "single_anchor",
        titleLine: buildTitleLineFallback(context),
        paragraph1: asSentence(`${anchorName} is the main disclosed ingredient in this product rather than one part of a broad formula`),
        paragraph2: "That makes the label easier to read because the core active is named directly instead of being buried inside a complex blend.",
        compareHint: "When comparing products, focus on the named ingredient, the disclosed amount per serving, and whether the label clearly states the form or source.",
      };
  }
};

const buildMultiAnchorFallback = (context: IngredientScienceContext): IngredientOverviewBlock => {
  if (context.ingredientFamily === "omega_3") {
    return {
      mode: "multi_anchor",
      titleLine: "Omega-3 formula",
      paragraph1: "This omega-3 product is organized around fish oil as the source ingredient, with separate lines that break out total omega-3 and the specific fatty acids underneath it.",
      paragraph2: "That structure helps distinguish the source oil from the EPA and DHA amounts that matter most when you compare products side by side.",
      compareHint: "When comparing omega-3 products, focus on total omega-3 plus the disclosed EPA and DHA amounts, not just the fish-oil total.",
    };
  }

  if (context.ingredientFamily === "vitamin_c") {
    return {
      mode: "multi_anchor",
      titleLine: buildTitleLineFallback(context),
      paragraph1: "This formula is built around vitamin C as the primary disclosed active, with additional nutrients included alongside it rather than hidden in a blend.",
      paragraph2: "That means the label is showing a main vitamin ingredient plus companion nutrients that may change how the formula is positioned and compared.",
      compareHint: "When comparing products, look first at the vitamin C amount and then check whether the added nutrients are clearly disclosed in meaningful amounts.",
    };
  }

  if (context.anchorIngredient?.name) {
    const anchorName = context.anchorIngredient.name;
    const companionNames = context.coIngredients
      .filter((row) => row.lineRole === "companion_nutrient" || row.lineRole === "generic_line")
      .map((row) => row.name)
      .slice(0, 3);
    const structuralNames = context.coIngredients
      .filter((row) => row.lineRole !== "companion_nutrient" && row.lineRole !== "generic_line")
      .map((row) => `${row.name} as a ${lineRoleLabel(row.lineRole)}`)
      .slice(0, 2);
    const companionSummary = companionNames.length
      ? `${joinNames(companionNames)} appear as supporting formula lines around that lead active.`
      : "The surrounding rows work more as supporting formula lines than as equal co-headliners.";
    const structureSummary = structuralNames.length
      ? `The label also uses ${joinNames(structuralNames)}, which changes how the formula should be compared.`
      : "That makes the most useful reading start with the lead active and then move outward to the supporting lines.";

    return {
      mode: "multi_anchor",
      titleLine: buildTitleLineFallback(context),
      paragraph1: `${anchorName} stays as the main named active in this multi-part formula rather than reading like one ingredient among equals.`,
      paragraph2: `${companionSummary} ${structureSummary}`,
      compareHint: "When comparing products, start with the lead active line and then check whether the companion and structural rows are disclosed clearly enough to show what role they actually play.",
    };
  }

  return {
    mode: "multi_anchor",
    titleLine: buildTitleLineFallback(context),
    paragraph1: "This product uses a multi-part formula instead of relying on only one disclosed active ingredient.",
    paragraph2: "In formulas like this, some lines identify the main actives while others provide supporting ingredients or additional label detail that helps explain how the product is structured.",
    compareHint: "When comparing products, focus on the named primary actives first and then check whether the rest of the formula is itemized clearly enough to compare.",
  };
};

const buildBlendAnchorFallback = (context: IngredientScienceContext): IngredientOverviewBlock => {
  if (context.ingredientFamily === "probiotic_or_blend") {
    return {
      mode: "blend_anchor",
      titleLine: "Blend-style formula",
      paragraph1: "This product is organized around broad blend-style label lines rather than a fully itemized ingredient list.",
      paragraph2: "That can describe the formula category at a glance, but it gives less precision about which strains or components are doing the work and in what amounts.",
      compareHint: "When comparing products, look for strain names, item-level disclosure, and whether the label gives more than a single blend total.",
    };
  }

  return {
    mode: "blend_anchor",
    titleLine: buildTitleLineFallback(context),
    paragraph1: "This product is organized as a blend-style formula rather than a fully itemized ingredient list.",
    paragraph2: "That makes the overall formula easier to summarize, but it also limits how precisely the label can be compared with a more transparent product.",
    compareHint: "When comparing products, look for item-level naming and whether the label provides more than a broad total for the blend.",
  };
};

const buildFallbackBlock = (context: IngredientScienceContext): IngredientOverviewBlock => {
  const mode = getMode(context);
  if (mode === "single_anchor") return buildSingleAnchorFallback(context);
  if (mode === "blend_anchor") return buildBlendAnchorFallback(context);
  return buildMultiAnchorFallback(context);
};

const buildPrompt = (context: IngredientScienceContext): string => {
  const payload = {
    productName: context.productName,
    sourceType: context.sourceType,
    ingredientSourceTier: context.ingredientSourceTier,
    formulaMode: getMode(context),
    anchorIngredient: context.anchorIngredient,
    formulaRoleSummary: buildFormulaRoleSummary(context),
    coIngredients: context.coIngredients.slice(0, 4),
    relationshipCandidates: context.relationshipCandidates.slice(0, 3),
    ingredientRows: context.ingredientDescriptors.map((descriptor) => ({
      name: descriptor.name,
      dose: descriptor.dose,
      ingredientFamily: descriptor.ingredientFamily,
      lineRole: descriptor.lineRole,
      categoryHint: descriptor.categoryHint,
      sourceContext: descriptor.sourceContext,
      formContext: descriptor.formContext,
    })),
    labelConstraints: context.labelConstraints,
  };

  return [
    "You are writing an Ingredient overview card for a supplement shopper.",
    "Your job is to decode the formula in plain English, not to rewrite the ingredient list and not to summarize research.",
    "Explain what kind of ingredient or formula this product centers on and how the label is structured.",
    "Add one short comparison-oriented hint that tells the shopper what matters most when comparing products.",
    "Use the anchor ingredient as the lead active unless the payload makes clear that the label is acting like a source line, total line, or blend line.",
    "Use coIngredients, relationshipCandidates, categoryHint, sourceContext, formContext, and lineRole to explain how the selected formula is arranged.",
    "Distinguish the lead active from companion nutrients or supporting formula lines so the shopper can tell which rows are central and which are contextual.",
    "Keep the explanation tied to this specific formula. Do not drift into general ingredient encyclopedia copy.",
    'Do not start with phrases like "This supplement provides", "This formula delivers", or "This product contains".',
    "Do not turn the factual ingredient rows into prose and do not enumerate multiple ingredient amounts line by line.",
    "Do not repeat the exact milligram amount or exact per-serving dose from the factual card above.",
    "For multi-part formulas, explain source lines, total lines, breakdown lines, or blend disclosure instead of repeating the facts.",
    "Keep titleLine short and label-like. It should be a short noun phrase, not a full sentence.",
    "Do not write about research, studies, evidence, support claims, disease, treatment, cure, prevention, or diagnosis.",
    "Do not rewrite the factual ingredient rows line by line.",
    "Do not say people take this product for anything.",
    "Do not use generic filler like lead ingredient unless you immediately explain its role on the label.",
    "Keep the tone shopper-facing, plain English, and product-specific.",
    "Write in English only.",
    'Return JSON only with this shape: {"mode":"single_anchor|multi_anchor|blend_anchor","titleLine":"...","paragraph1":"...","paragraph2":"...","compareHint":"..."}',
    `INPUT_JSON: ${JSON.stringify(payload)}`,
  ].join("\n");
};

const parseBlock = (raw: string): IngredientOverviewLlmOutput | null => {
  const result = extractJsonObjectLoose(raw);
  if (!result.ok || !result.parsed || typeof result.parsed !== "object") return null;
  const parsed = result.parsed as Record<string, unknown>;
  const modeValue = normalizeText(typeof parsed.mode === "string" ? parsed.mode : "");
  const mode: IngredientOverviewMode | undefined =
    modeValue === "single_anchor" || modeValue === "multi_anchor" || modeValue === "blend_anchor"
      ? modeValue
      : undefined;
  return {
    mode,
    titleLine: normalizeText(typeof parsed.titleLine === "string" ? parsed.titleLine : "") || null,
    paragraph1: normalizeText(typeof parsed.paragraph1 === "string" ? parsed.paragraph1 : ""),
    paragraph2: normalizeText(typeof parsed.paragraph2 === "string" ? parsed.paragraph2 : "") || null,
    compareHint: normalizeText(typeof parsed.compareHint === "string" ? parsed.compareHint : "") || null,
  };
};

const hasAnchorReference = (context: IngredientScienceContext, block: IngredientOverviewBlock): boolean => {
  const haystack = normalizeComparable(
    [block.titleLine, block.paragraph1, block.paragraph2, block.compareHint].filter(Boolean).join(" "),
  );
  const anchorName = context.anchorIngredient?.name ?? null;
  if (!anchorName) return Boolean(block.paragraph1);
  if (haystack.includes(normalizeComparable(anchorName))) return true;
  if (context.ingredientFamily === "omega_3" && /\bomega 3\b|\bfish oil\b|\bepa\b|\bdha\b/.test(haystack)) return true;
  if (context.ingredientFamily === "probiotic_or_blend" && /\bprobiotic\b|\bblend\b|\bstrain\b|\bphage\b/.test(haystack)) return true;
  return false;
};

const addsFormulaMeaning = (block: IngredientOverviewBlock): boolean => {
  const combined = [block.paragraph1, block.paragraph2, block.compareHint].filter(Boolean).join(" ");
  return ROLE_KEYWORD_PATTERN.test(combined);
};

const looksLikeFactualEcho = (context: IngredientScienceContext, block: IngredientOverviewBlock): boolean => {
  const combined = [block.paragraph1, block.paragraph2].filter(Boolean).join(" ");
  if (!combined) return false;
  if (FACTUAL_RESTATEMENT_PATTERNS.some((pattern) => pattern.test(combined))) return true;

  const ingredientMentionCount = countIngredientMentions(context, combined);
  const doseMentionCount = countDoseMentions(context, combined);

  if (ingredientMentionCount >= 2 && doseMentionCount >= 2) return true;
  if (ingredientMentionCount >= 3 && doseMentionCount >= 1) return true;

  return false;
};

const hasSpecificCompareHint = (compareHint: string | null): boolean =>
  SPECIFIC_COMPARE_HINT_PATTERN.test(normalizeText(compareHint));

const normalizeTitleLine = (context: IngredientScienceContext, titleLine: string | null): string | null => {
  const normalized = normalizeText(titleLine);
  if (!normalized) return buildTitleLineFallback(context);
  if (normalized.length > 72 || isSentenceLikeTitle(normalized)) return buildTitleLineFallback(context);
  return normalized;
};

const repairBlock = (
  context: IngredientScienceContext,
  candidate: IngredientOverviewBlock,
  fallbackBlock: IngredientOverviewBlock,
): IngredientOverviewBlock => {
  const anchorName = normalizeText(context.anchorIngredient?.name);
  const normalizedParagraphOne = removeWeakOrUnsafeSentences(context, candidate.paragraph1);
  const normalizedParagraphTwo = removeWeakOrUnsafeSentences(context, candidate.paragraph2);
  const normalizedCompareHint = removeWeakOrUnsafeSentences(context, candidate.compareHint);
  const repairedParagraphOne = (() => {
    if (!anchorName || !normalizedParagraphOne) return normalizedParagraphOne;
    const existing = normalizeComparable(normalizedParagraphOne);
    if (existing.includes(normalizeComparable(anchorName))) return normalizedParagraphOne;
    return `${anchorName} anchors this formula, and ${lowerFirst(normalizedParagraphOne)}`;
  })();

  const repaired: IngredientOverviewBlock = {
    mode: candidate.mode ?? fallbackBlock.mode,
    titleLine: normalizeTitleLine(context, candidate.titleLine ?? fallbackBlock.titleLine),
    paragraph1: asSentence(repairedParagraphOne || fallbackBlock.paragraph1),
    paragraph2: normalizedParagraphTwo ? asSentence(normalizedParagraphTwo) : (fallbackBlock.paragraph2 ?? null),
    compareHint:
      normalizedCompareHint && hasSpecificCompareHint(normalizedCompareHint)
        ? asSentence(normalizedCompareHint)
        : fallbackBlock.compareHint,
  };

  if (!addsFormulaMeaning(repaired) && fallbackBlock.paragraph2) {
    repaired.paragraph2 = fallbackBlock.paragraph2;
  }

  return repaired;
};

const gateBlock = (context: IngredientScienceContext, block: IngredientOverviewBlock): boolean => {
  if (!block.mode) return false;
  if (!block.paragraph1) return false;
  if (!block.compareHint) return false;
  if (!hasAnchorReference(context, block)) return false;
  if (!addsFormulaMeaning(block)) return false;
  if (!hasSpecificCompareHint(block.compareHint)) return false;

  const allText = [block.titleLine, block.paragraph1, block.paragraph2, block.compareHint].filter(Boolean).join(" ");
  if (BANNED_PATTERNS.some((pattern) => pattern.test(allText))) return false;
  if (looksLikeFactualEcho(context, block)) return false;
  if (countDoseMentions(context, allText) > 0) return false;

  const sentenceCount =
    splitSentences(block.paragraph1).length +
    splitSentences(block.paragraph2 ?? "").length +
    splitSentences(block.compareHint ?? "").length;
  if (sentenceCount < 2 || sentenceCount > 5) return false;

  return true;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("llm_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const resolveIngredientOverviewExecutionProfile = (
  context: IngredientScienceContext,
): IngredientOverviewExecutionProfile => {
  const mode = getMode(context);
  const family = context.ingredientFamily;
  const companionCount = context.coIngredients.length;

  if (family === "omega_3") {
    return {
      timeoutMs: COMPLEX_FORMULA_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: COMPLEX_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: 0,
      backgroundRefreshMaxRetries: 1,
      maxTokens: INGREDIENT_OVERVIEW_MAX_TOKENS,
      cacheTtlMs: INGREDIENT_OVERVIEW_CACHE_TTL_MS,
    };
  }

  if (mode === "single_anchor") {
    return {
      timeoutMs: SINGLE_ANCHOR_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: 0,
      backgroundRefreshMaxRetries: 1,
      maxTokens: INGREDIENT_OVERVIEW_MAX_TOKENS,
      cacheTtlMs: INGREDIENT_OVERVIEW_CACHE_TTL_MS,
    };
  }

  if (mode === "blend_anchor") {
    return {
      timeoutMs: BLEND_ANCHOR_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: 0,
      backgroundRefreshMaxRetries: 1,
      maxTokens: INGREDIENT_OVERVIEW_MAX_TOKENS,
      cacheTtlMs: INGREDIENT_OVERVIEW_CACHE_TTL_MS,
    };
  }

  return {
    timeoutMs: companionCount >= 3 ? COMPLEX_FORMULA_TIMEOUT_MS : MULTI_ANCHOR_TIMEOUT_MS,
    backgroundRefreshTimeoutMs: companionCount >= 3 ? COMPLEX_BACKGROUND_REFRESH_TIMEOUT_MS : BACKGROUND_REFRESH_TIMEOUT_MS,
    maxRetries: 0,
    backgroundRefreshMaxRetries: 1,
    maxTokens: INGREDIENT_OVERVIEW_MAX_TOKENS,
    cacheTtlMs: INGREDIENT_OVERVIEW_CACHE_TTL_MS,
  };
};

export const compileIngredientOverviewAsync = async (
  context: IngredientScienceContext,
  opts?: CompileIngredientOverviewOpts,
): Promise<IngredientOverviewCompileResult> => {
  const fallbackBlock = buildFallbackBlock(context);
  const llmFn = opts?.llmFn;
  const timeoutMs = opts?.timeoutMs ?? LLM_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_MAX_RETRIES;
  const diagnostics: IngredientOverviewCompileDiagnostics = {
    liveWriterConfigured: Boolean(llmFn),
    liveWriterAttempted: false,
    liveWriterHit: false,
    attemptCount: 0,
    timeoutMs,
    maxRetries,
    fallbackReason: null,
    lastError: null,
    parseFailureCount: 0,
    gateRejectCount: 0,
    timeoutCount: 0,
    errorCount: 0,
  };

  if (!llmFn) {
    return {
      ingredientOverview: fallbackBlock,
      source: "fallback",
      fallbackUsed: true,
      promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
      diagnostics: {
        ...diagnostics,
        fallbackReason: "llm_unconfigured",
      },
    };
  }

  const prompt = buildPrompt(context);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    diagnostics.liveWriterAttempted = true;
    diagnostics.attemptCount = attempt + 1;
    try {
      const raw = await withTimeout(llmFn(prompt), timeoutMs);
      const parsed = parseBlock(raw);
      if (!parsed) {
        diagnostics.parseFailureCount += 1;
        diagnostics.fallbackReason = "parse_failed";
        continue;
      }
      const candidate: IngredientOverviewBlock = {
        mode: parsed.mode ?? fallbackBlock.mode,
        titleLine: normalizeTitleLine(context, parsed.titleLine ?? null),
        paragraph1: asSentence(parsed.paragraph1),
        paragraph2: parsed.paragraph2 ? asSentence(parsed.paragraph2) : null,
        compareHint: parsed.compareHint ? asSentence(parsed.compareHint) : null,
      };
      const repairedCandidate = repairBlock(context, candidate, fallbackBlock);
      if (!gateBlock(context, repairedCandidate)) {
        diagnostics.gateRejectCount += 1;
        diagnostics.fallbackReason = "quality_gate_rejected";
        continue;
      }
      return {
        ingredientOverview: repairedCandidate,
        source: "api",
        fallbackUsed: false,
        promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
        diagnostics: {
          ...diagnostics,
          liveWriterHit: true,
          fallbackReason: null,
          lastError: null,
        },
      };
    } catch (error) {
      const reason = resolveErrorReason(error);
      diagnostics.lastError = reason;
      diagnostics.fallbackReason = reason;
      if (reason === "llm_timeout") diagnostics.timeoutCount += 1;
      else diagnostics.errorCount += 1;
      continue;
    }
  }

  return {
    ingredientOverview: fallbackBlock,
    source: "fallback",
    fallbackUsed: true,
    promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
    diagnostics: {
      ...diagnostics,
      fallbackReason:
        diagnostics.fallbackReason ??
        (diagnostics.parseFailureCount > 0
          ? "parse_failed"
          : diagnostics.gateRejectCount > 0
            ? "quality_gate_rejected"
            : "exhausted_without_valid_output"),
    },
  };
};

export const buildIngredientOverviewDeterministicFallback = (
  context: IngredientScienceContext,
): IngredientOverviewBlock => buildFallbackBlock(context);

export const ingredientOverviewAnchorMatchesSelected = (
  context: IngredientScienceContext,
  selectedIngredientName: string,
): boolean => {
  const selectedKey = normalizeIngredientScienceKey(selectedIngredientName);
  const anchorKey = normalizeIngredientScienceKey(context.anchorIngredient?.name ?? null);
  return Boolean(selectedKey && anchorKey && selectedKey === anchorKey);
};
