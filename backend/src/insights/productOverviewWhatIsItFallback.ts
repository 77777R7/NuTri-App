import type { ProductOverviewWhatIsIt } from "../deepseek.js";

type ProductOverviewFallbackInput = {
  productName: string;
  productTypeHint: string | null;
  primaryIngredient: string | null;
  keyIngredients: Array<{ name: string; dose?: string | null }>;
  sourceContextHint: string | null;
  chemicalFormHint: string | null;
  isLikelySingleIngredient: boolean;
};

const normalizeText = (value?: string | null): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
};

const toSentence = (value?: string | null): string => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const dedupeStrings = (rows: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const text = normalizeText(row);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const listToEnglish = (rows: string[]): string => {
  if (rows.length === 0) return "";
  if (rows.length === 1) return rows[0];
  if (rows.length === 2) return `${rows[0]} and ${rows[1]}`;
  return `${rows.slice(0, -1).join(", ")}, and ${rows[rows.length - 1]}`;
};

const lower = (value?: string | null): string => normalizeText(value)?.toLowerCase() ?? "";
const PRODUCT_OVERVIEW_BLEND_PATTERN = /\b(blend|complex|matrix|formula|proprietary)\b/i;
const PRODUCT_OVERVIEW_COMPANION_PATTERN =
  /\b(vitamin\s*b(?:3|6|12)\b|\bb(?:3|6|12)\b|niacin(?:amide)?\b|nicotinamide\b|pyridoxine\b|pyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|p-?5-?p\b|folate\b|folic acid\b|methylfolate\b|zinc\b|magnesium\b|calcium\b|selenium\b|copper\b|chromium\b|iodine\b)\b/i;

const stripSupportClaims = (value?: string | null): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized
    .replace(/\bsupport supplement\b/i, "supplement")
    .replace(/\bsupplement supplement\b/i, "supplement")
    .replace(/\bfor support\b/i, "")
    .trim();
};

const buildSingleIngredientFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const primaryIngredient = normalizeText(params.primaryIngredient)
    ?? normalizeText(params.keyIngredients[0]?.name)
    ?? normalizeText(params.productName)
    ?? "This product";
  const productTypeHint = stripSupportClaims(params.productTypeHint)
    ?? "single-ingredient supplement";
  const sourceContextHint = normalizeText(params.sourceContextHint);
  const chemicalFormHint = normalizeText(params.chemicalFormHint);

  const lead = toSentence(
    `${primaryIngredient} is a supplement ingredient used in ${productTypeHint.toLowerCase()} products`,
  );
  const backgroundContext = sourceContextHint
    ? `It is presented here with source context from ${sourceContextHint}`
    : chemicalFormHint
      ? `It is presented here with a disclosed ingredient form of ${chemicalFormHint}`
      : "It appears here as the main named active in a straightforward single-ingredient formula";
  const whatItIs = toSentence(backgroundContext);
  const whyPeopleTakeIt = toSentence(
    `People usually choose products like this to compare the named ingredient, the disclosed label context, and how clearly the formula stays focused on one main active`,
  );

  return {
    mode: "rich",
    lead,
    whatItIs,
    whyPeopleTakeIt,
  };
};

const buildOmegaFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const names = dedupeStrings(params.keyIngredients.map((item) => item.name));
  const hasEpa = names.some((name) => /\bepa\b/i.test(name));
  const hasDha = names.some((name) => /\bdha\b/i.test(name));
  const namedBreakdown = [hasEpa ? "EPA" : null, hasDha ? "DHA" : null].filter(Boolean) as string[];

  return {
    mode: "short",
    lead: "This is an omega-3 supplement built around fish-oil-derived fatty acids.",
    whatItIs: toSentence(
      namedBreakdown.length > 0
        ? `The label separates the source oil from specific omega-3 components such as ${listToEnglish(namedBreakdown)}, which are the lines shoppers usually compare most closely`
        : "The label presents omega-3s as a fish-oil-based formula rather than as a single isolated ingredient"
    ),
    whyPeopleTakeIt: "People usually choose products like this for general omega-3 intake and to compare how clearly the EPA and DHA breakdown is disclosed.",
  };
};

const buildProbioticFallback = (): ProductOverviewWhatIsIt => ({
  mode: "short",
  lead: "This is a probiotic-style supplement organized around a blend-based formula.",
  whatItIs:
    "The label combines named blend lines rather than a fully itemized ingredient list, so the product is best understood as a formula with partially disclosed components.",
  whyPeopleTakeIt:
    "People usually choose products like this to compare how clearly the blend is described and whether the label gives enough detail to judge what is inside.",
});

const buildVitaminCFallback = (): ProductOverviewWhatIsIt => ({
  mode: "rich",
  lead: "This is a vitamin C supplement built around a clearly named vitamin ingredient.",
  whatItIs:
    "It belongs to the straightforward vitamin-supplement category and may also include companion nutrients that sit alongside the main vitamin line on the label.",
  whyPeopleTakeIt:
    "People usually choose products like this for direct vitamin C supplementation and to compare the named ingredient, label clarity, and any supporting nutrients included in the formula.",
});

const isCompanionOverviewIngredient = (value?: string | null): boolean =>
  PRODUCT_OVERVIEW_COMPANION_PATTERN.test(normalizeText(value) ?? "");

const buildLeadActiveMultiIngredientFallback = (
  params: ProductOverviewFallbackInput,
): ProductOverviewWhatIsIt | null => {
  const leadActive = normalizeText(params.primaryIngredient);
  if (!leadActive || leadActive === "Multi-ingredient formula" || PRODUCT_OVERVIEW_BLEND_PATTERN.test(leadActive)) {
    return null;
  }

  const productTypeHint = stripSupportClaims(params.productTypeHint) ?? "multi-ingredient supplement";
  const otherIngredients = dedupeStrings(params.keyIngredients.map((item) => item.name)).filter(
    (name) => name.toLowerCase() !== leadActive.toLowerCase(),
  );
  const supportingActives = otherIngredients.filter((name) => !isCompanionOverviewIngredient(name)).slice(0, 3);
  const companionNutrients = otherIngredients.filter((name) => isCompanionOverviewIngredient(name)).slice(0, 2);

  const whatItIs = (() => {
    if (supportingActives.length > 0 && companionNutrients.length > 0) {
      return toSentence(
        `The label keeps ${leadActive} as the main named active while supporting components such as ${listToEnglish(supportingActives)} sit alongside companion nutrient lines like ${listToEnglish(companionNutrients)}`
      );
    }
    if (supportingActives.length > 0) {
      return toSentence(
        `The label keeps ${leadActive} as the main named active while additional disclosed components such as ${listToEnglish(supportingActives)} shape the rest of the formula`
      );
    }
    if (companionNutrients.length > 0) {
      return toSentence(
        `The label keeps ${leadActive} as the main named active while companion nutrient lines such as ${listToEnglish(companionNutrients)} support the broader formula setup`
      );
    }
    return toSentence(
      `The formula is organized around ${leadActive} as the lead active rather than treating every disclosed line as equally central`
    );
  })();

  return {
    mode: "rich",
    lead: toSentence(`This is a ${leadActive}-led ${productTypeHint.toLowerCase()} formula`),
    whatItIs,
    whyPeopleTakeIt: toSentence(
      `People usually choose products like this to compare whether ${leadActive} stays clearly disclosed as the main active and how the supporting lines are arranged around it`
    ),
  };
};

const buildGenericMultiIngredientFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const productTypeHint = stripSupportClaims(params.productTypeHint) ?? "multi-ingredient supplement";
  const names = dedupeStrings(params.keyIngredients.map((item) => item.name)).slice(0, 3);
  const namedContext = names.length > 0 ? ` with named components such as ${listToEnglish(names)}` : "";

  return {
    mode: "short",
    lead: toSentence(`This is a ${productTypeHint.toLowerCase()} with more than one disclosed ingredient`),
    whatItIs: toSentence(
      `The formula is organized as a structured label${namedContext}, so shoppers need to distinguish the main active from supporting or context lines`
    ),
    whyPeopleTakeIt:
      "People usually choose products like this to compare the named ingredients and how clearly the label separates the main active from supporting components.",
  };
};

export const buildProductOverviewWhatIsItFallback = (
  params: ProductOverviewFallbackInput,
): ProductOverviewWhatIsIt => {
  const productName = lower(params.productName);
  const productTypeHint = lower(params.productTypeHint);
  const ingredientTokens = dedupeStrings([
    params.primaryIngredient,
    ...params.keyIngredients.map((item) => item.name),
  ]).map((value) => value.toLowerCase());

  if (params.isLikelySingleIngredient) {
    if (ingredientTokens.some((token) => token.includes("astaxanthin"))) {
      return {
        mode: "rich",
        lead: "Astaxanthin is a carotenoid supplement ingredient commonly used in antioxidant-focused products.",
        whatItIs: toSentence(
          normalizeText(params.sourceContextHint)
            ? `It is presented here with source context from ${normalizeText(params.sourceContextHint)} and appears as the main named active in the formula`
            : "It appears here as the main named active in a straightforward single-ingredient formula"
        ),
        whyPeopleTakeIt:
          "People usually choose astaxanthin products to compare the named ingredient, the source context on the label, and how clearly the formula stays focused on one active.",
      };
    }

    if (ingredientTokens.some((token) => token.includes("vitamin c")) || productTypeHint.includes("vitamin c")) {
      return buildVitaminCFallback();
    }

    return buildSingleIngredientFallback(params);
  }

  if (
    productTypeHint.includes("omega-3")
    || productName.includes("omega-3")
    || ingredientTokens.some((token) => token.includes("epa") || token.includes("dha") || token.includes("fish oil"))
  ) {
    return buildOmegaFallback(params);
  }

  if (
    productTypeHint.includes("probiotic")
    || productName.includes("probiotic")
    || ingredientTokens.some((token) => token.includes("probiotic") || token.includes("phage") || token.includes("blend"))
  ) {
    return buildProbioticFallback();
  }

  if (ingredientTokens.some((token) => token.includes("vitamin c")) || productTypeHint.includes("vitamin c")) {
    return buildVitaminCFallback();
  }

  const leadActiveMultiFallback = buildLeadActiveMultiIngredientFallback(params);
  if (leadActiveMultiFallback) {
    return leadActiveMultiFallback;
  }

  return buildGenericMultiIngredientFallback(params);
};
