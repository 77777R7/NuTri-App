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
};

export type CompileIngredientOverviewOpts = {
  llmFn?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
};

export type IngredientOverviewExecutionProfile = {
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
};

export const INGREDIENT_OVERVIEW_PROMPT_VERSION = "ingredient_overview_v5";

const LLM_TIMEOUT_MS = 9_000;
const LLM_MAX_RETRIES = 1;
const INGREDIENT_OVERVIEW_STANDARD_TIMEOUT_MS = 3_500;
const INGREDIENT_OVERVIEW_BLEND_TIMEOUT_MS = 2_500;
const INGREDIENT_OVERVIEW_FOOD_LIKE_TIMEOUT_MS = 1_200;
const INGREDIENT_OVERVIEW_STANDARD_MAX_TOKENS = 520;
const INGREDIENT_OVERVIEW_BLEND_MAX_TOKENS = 420;
const INGREDIENT_OVERVIEW_FOOD_LIKE_MAX_TOKENS = 320;

export const resolveIngredientOverviewExecutionProfile = (
  context: IngredientScienceContext,
): IngredientOverviewExecutionProfile => {
  if (context.productArchetype === "functional_food_like") {
    return {
      timeoutMs: INGREDIENT_OVERVIEW_FOOD_LIKE_TIMEOUT_MS,
      maxRetries: 0,
      maxTokens: INGREDIENT_OVERVIEW_FOOD_LIKE_MAX_TOKENS,
    };
  }

  if (context.formulaMode === "blend") {
    return {
      timeoutMs: INGREDIENT_OVERVIEW_BLEND_TIMEOUT_MS,
      maxRetries: 0,
      maxTokens: INGREDIENT_OVERVIEW_BLEND_MAX_TOKENS,
    };
  }

  return {
    timeoutMs: INGREDIENT_OVERVIEW_STANDARD_TIMEOUT_MS,
    maxRetries: 0,
    maxTokens: INGREDIENT_OVERVIEW_STANDARD_MAX_TOKENS,
  };
};

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

const normalizeComparable = (value: string | null | undefined): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
    formulaMode: getMode(context),
    anchorIngredient: context.anchorIngredient,
    ingredientRows: context.ingredientDescriptors.map((descriptor) => ({
      name: descriptor.name,
      dose: descriptor.dose,
      ingredientFamily: descriptor.ingredientFamily,
      lineRole: descriptor.lineRole,
    })),
    labelConstraints: context.labelConstraints,
  };

  return [
    "You are writing an Ingredient overview card for a supplement shopper.",
    "Your job is to decode the formula in plain English, not to rewrite the ingredient list and not to summarize research.",
    "Explain what kind of ingredient or formula this product centers on and how the label is structured.",
    "Add one short comparison-oriented hint that tells the shopper what matters most when comparing products.",
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

export const compileIngredientOverviewAsync = async (
  context: IngredientScienceContext,
  opts?: CompileIngredientOverviewOpts,
): Promise<IngredientOverviewCompileResult> => {
  const fallbackBlock = buildFallbackBlock(context);
  const llmFn = opts?.llmFn;

  if (!llmFn) {
    return {
      ingredientOverview: fallbackBlock,
      source: "fallback",
      fallbackUsed: true,
      promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
    };
  }

  const prompt = buildPrompt(context);
  const timeoutMs = opts?.timeoutMs ?? LLM_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await withTimeout(llmFn(prompt), timeoutMs);
      const parsed = parseBlock(raw);
      if (!parsed?.mode) continue;
      const candidate: IngredientOverviewBlock = {
        mode: parsed.mode,
        titleLine: normalizeTitleLine(context, parsed.titleLine ?? null),
        paragraph1: asSentence(parsed.paragraph1),
        paragraph2: parsed.paragraph2 ? asSentence(parsed.paragraph2) : null,
        compareHint: parsed.compareHint ? asSentence(parsed.compareHint) : null,
      };
      if (!gateBlock(context, candidate)) continue;
      return {
        ingredientOverview: candidate,
        source: "api",
        fallbackUsed: false,
        promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
      };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "llm_timeout") {
        continue;
      }
    }
  }

  return {
    ingredientOverview: fallbackBlock,
    source: "fallback",
    fallbackUsed: true,
    promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
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
