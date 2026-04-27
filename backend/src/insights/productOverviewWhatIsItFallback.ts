import type { ProductOverviewWhatIsIt } from "../deepseek.js";

type ProductOverviewFallbackInput = {
  productName: string;
  brandName?: string | null;
  productTypeHint: string | null;
  primaryIngredient: string | null;
  keyIngredients: Array<{ name: string; dose?: string | null }>;
  sourceContextHint: string | null;
  chemicalFormHint: string | null;
  allIngredientRows?: Array<{ name: string; dose?: string | null }>;
  descriptionHighlights?: string[];
  warningHighlights?: string[];
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
const PRODUCT_OVERVIEW_OMEGA_PATTERN =
  /\b(omega(?:\s|-)?3|fish oil|krill oil|cod liver oil|algae dha|algal dha|\bepa\b|\bdha\b)\b/i;
const PRODUCT_OVERVIEW_PROBIOTIC_PATTERN =
  /\b(probiotic|acidophilus|bifidobacter|bifidus|lactobacill|saccharomyces|spore\s+based|sbo probiotic|\bcfu\b)\b/i;
const PRODUCT_OVERVIEW_PROBIOTIC_STRAIN_PATTERN =
  /\b(lactobacill\w*|bifidobacter\w*|saccharomyces|bacillus|streptococcus|lactococcus|acidophilus|rhamnosus|plantarum|reuteri|casei|longum|breve|coagulans|bulgaricus|thermophilus|boulardii)\b/i;
const PRODUCT_OVERVIEW_OPAQUE_PROBIOTIC_BLEND_PATTERN =
  /\b(proprietary\s+blend|probiotic\s+blend|probiotics?\s+blend|microflora\s+blend|blend|complex|matrix|formula)\b/i;
const PRODUCT_OVERVIEW_VITAMIN_C_PATTERN = /\b(vitamin\s*c|ascorbic acid|ascorbate|ester-?c)\b/i;
const PRODUCT_OVERVIEW_COMPANION_PATTERN =
  /\b(vitamin\s*b(?:3|6|12)\b|\bb(?:3|6|12)\b|niacin(?:amide)?\b|nicotinamide\b|pyridoxine\b|pyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|p-?5-?p\b|folate\b|folic acid\b|methylfolate\b|zinc\b|magnesium\b|calcium\b|selenium\b|copper\b|chromium\b|iodine\b)\b/i;

const cleanOverviewDisplayName = (value?: string | null): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const cleaned = normalized
    .replace(/^Regenerative Organic Certified\s+/i, "")
    .replace(/\*+/g, "")
    .replace(/\s*\([^)]{1,120}\)/g, "")
    .replace(/[()]/g, "")
    .replace(/\b\d+\s*:\s*\d+\s+extract\b/gi, "extract")
    .replace(/\s+equivalent to\b.*$/i, "")
    .replace(/\s+standardized to\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length <= 96) return cleaned;
  return `${cleaned.slice(0, 92).replace(/\s+\S*$/, "").trim()}...`;
};

const extractProbioticStrainNames = (value?: string | null): string[] => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const strainReadable = normalized
    .replace(/([a-z])(?=(?:Lactobacillus|Bifidobacterium|Saccharomyces|Streptococcus|Lactococcus)\b)/gi, "$1 ")
    .replace(/\s{2,}/g, " ");
  const matches = strainReadable.match(
    /\b(?:Lactobacillus|Bifidobacterium|Saccharomyces|Bacillus|Streptococcus|Lactococcus)\s+[a-z][a-z-]+(?:\s+[A-Z0-9-]+)?/gi,
  ) ?? [];
  return dedupeStrings(matches.map((match) => cleanOverviewDisplayName(match)));
};

const stripSupportClaims = (value?: string | null): string | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized
    .replace(/\bsupport supplement\b/i, "supplement")
    .replace(/\bsupplement supplement\b/i, "supplement")
    .replace(/\bfor support\b/i, "")
    .replace(/\bliver\s+detox\b/i, "liver-focused")
    .replace(/\bdetox\b/i, "focused")
    .replace(/\bcleanse\b/i, "formula")
    .trim();
};

const normalizeProductTypeHint = (
  params: ProductOverviewFallbackInput,
  fallback: string,
): string => {
  let normalized = stripSupportClaims(params.productTypeHint);
  const brand = normalizeText(params.brandName);
  if (normalized && brand && normalized.toLowerCase() === brand.toLowerCase()) {
    normalized = null;
  }
  if (!normalized) return fallback;
  normalized = normalized
    .replace(/\bpowders\b/i, "powder")
    .replace(/\bformulas\b/i, "formula")
    .replace(/\bproducts\b/i, "product")
    .replace(/\s{2,}/g, " ")
    .trim();
  const lowerNormalized = normalized.toLowerCase();
  if (["product", "products", "supplement", "supplements"].includes(lowerNormalized)) {
    return fallback;
  }
  return normalized;
};

const normalizeFormulaTypeHint = (
  params: ProductOverviewFallbackInput,
  fallback = "multi-ingredient formula",
): string => {
  const hint = normalizeProductTypeHint(params, fallback).toLowerCase();
  if (/\bformula\b$/.test(hint)) return hint;
  if (/\bsupplement\b$/.test(hint)) return hint;
  return `${hint} formula`;
};

const buildSingleIngredientFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const primaryIngredient = cleanOverviewDisplayName(params.primaryIngredient)
    ?? cleanOverviewDisplayName(params.keyIngredients[0]?.name)
    ?? cleanOverviewDisplayName(params.productName)
    ?? "This product";
  const productTypeHint = normalizeProductTypeHint(params, "single-ingredient supplement");
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
  const sourceText = [
    params.productName,
    params.primaryIngredient,
    ...params.keyIngredients.map((item) => item.name),
  ].join(" ");
  const sourceLine = (() => {
    if (/\b(algae|algal)\b/i.test(sourceText)) return "algae-derived omega-3 fatty acids";
    if (/\bkrill\b/i.test(sourceText)) return "krill-oil-derived omega-3 fatty acids";
    if (/\b(fish|pollock|salmon|cod)\b/i.test(sourceText)) return "fish-oil-derived omega-3 fatty acids";
    return "disclosed omega-3 fatty acid lines";
  })();

  return {
    mode: "short",
    lead: `This is an omega-3 supplement built around ${sourceLine}.`,
    whatItIs: toSentence(
      namedBreakdown.length > 0
        ? `The label separates the source oil from specific omega-3 components such as ${listToEnglish(namedBreakdown)}, which are the lines shoppers usually compare most closely`
        : "The label presents omega-3s as a fish-oil-based formula rather than as a single isolated ingredient"
    ),
    whyPeopleTakeIt: "People usually choose products like this for general omega-3 intake and to compare how clearly the EPA and DHA breakdown is disclosed.",
  };
};

const buildProbioticFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const names = dedupeStrings([
    params.primaryIngredient,
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ]);
  const extractedStrains = dedupeStrings(names.flatMap((name) => extractProbioticStrainNames(name)));
  const fallbackStrainNames = names
    .filter((name) => PRODUCT_OVERVIEW_PROBIOTIC_STRAIN_PATTERN.test(name))
    .filter((name) => !PRODUCT_OVERVIEW_OPAQUE_PROBIOTIC_BLEND_PATTERN.test(name))
    .map((name) => cleanOverviewDisplayName(name))
    .filter((name): name is string => Boolean(name && name.length <= 72));
  const namedStrains = dedupeStrings([...extractedStrains, ...fallbackStrainNames]).slice(0, 3);
  const hasOpaqueBlendLine = names.some((name) => PRODUCT_OVERVIEW_OPAQUE_PROBIOTIC_BLEND_PATTERN.test(name));
  const labelText = [
    params.productName,
    params.productTypeHint,
    params.primaryIngredient,
    ...params.keyIngredients.map((item) => `${item.name} ${item.dose ?? ""}`),
    ...(params.allIngredientRows ?? []).map((item) => `${item.name} ${item.dose ?? ""}`),
  ].join(" ");
  const hasCfuHint = /\bCFU\b|colony\s+forming/i.test(labelText);

  const lead = namedStrains.length > 0
    ? "This is a probiotic supplement where the named strain line is the main comparison point."
    : "This is a probiotic supplement where the label transparency matters more than a broad blend name.";
  const whatItIs = namedStrains.length > 0
    ? toSentence(
        `The label names probiotic components such as ${listToEnglish(namedStrains)}, which is more useful for comparison than a generic blend-only line`
      )
    : hasOpaqueBlendLine
      ? "The label uses a broad or proprietary blend line, so it identifies the probiotic category but gives less strain-level detail than a fully itemized formula."
      : "The label points to the probiotic category, so the useful comparison is whether it names the strains clearly rather than only describing the product in broad terms.";
  const cfuPhrase = hasCfuHint
    ? "whether CFU is stated clearly per serving"
    : "whether CFU per serving is disclosed";

  return {
    mode: "short",
    lead,
    whatItIs,
    whyPeopleTakeIt: toSentence(
      `People usually compare probiotic products by strain names, ${cfuPhrase}, serving size, storage notes, and whether a blend hides the amount of each component`
    ),
  };
};

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
  const rawLeadActive = normalizeText(params.primaryIngredient);
  const leadActive = cleanOverviewDisplayName(params.primaryIngredient);
  if (!leadActive || leadActive === "Multi-ingredient formula" || PRODUCT_OVERVIEW_BLEND_PATTERN.test(leadActive)) {
    return null;
  }

  const productTypeHint = normalizeFormulaTypeHint(params);
  const allNamedIngredients = dedupeStrings([
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ]);
  const otherIngredients = allNamedIngredients.filter(
    (name) => name.toLowerCase() !== (rawLeadActive ?? leadActive).toLowerCase(),
  );
  const supportingActives = otherIngredients
    .filter((name) => !isCompanionOverviewIngredient(name))
    .map((name) => cleanOverviewDisplayName(name))
    .filter((name) => name?.toLowerCase() !== leadActive.toLowerCase())
    .filter((name, index, rows) => rows.findIndex((row) => row?.toLowerCase() === name?.toLowerCase()) === index)
    .filter(Boolean)
    .slice(0, 3) as string[];
  const companionNutrients = otherIngredients
    .filter((name) => isCompanionOverviewIngredient(name))
    .map((name) => cleanOverviewDisplayName(name))
    .filter((name) => name?.toLowerCase() !== leadActive.toLowerCase())
    .filter((name, index, rows) => rows.findIndex((row) => row?.toLowerCase() === name?.toLowerCase()) === index)
    .filter(Boolean)
    .slice(0, 2) as string[];

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
      `The formula is organized around ${leadActive} as the lead active rather than reading every disclosed line as equally central`
    );
  })();

  return {
    mode: "rich",
    lead: toSentence(`This is a ${leadActive}-led ${productTypeHint}`),
    whatItIs,
    whyPeopleTakeIt: toSentence(
      `People usually choose products like this to compare whether ${leadActive} stays clearly disclosed as the main active and how the supporting lines are arranged around it`
    ),
  };
};

const buildGenericMultiIngredientFallback = (params: ProductOverviewFallbackInput): ProductOverviewWhatIsIt => {
  const productTypeHint = normalizeProductTypeHint(params, "multi-ingredient supplement");
  const names = dedupeStrings([
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ])
    .map((name) => cleanOverviewDisplayName(name))
    .filter(Boolean)
    .slice(0, 3) as string[];
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
  const primaryIngredient = lower(params.primaryIngredient);
  const ingredientTokens = dedupeStrings([
    params.primaryIngredient,
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ]).map((value) => value.toLowerCase());
  const strongOmegaSignal =
    PRODUCT_OVERVIEW_OMEGA_PATTERN.test(productName)
    || PRODUCT_OVERVIEW_OMEGA_PATTERN.test(productTypeHint)
    || PRODUCT_OVERVIEW_OMEGA_PATTERN.test(primaryIngredient);
  const strongProbioticSignal =
    PRODUCT_OVERVIEW_PROBIOTIC_PATTERN.test(productName)
    || PRODUCT_OVERVIEW_PROBIOTIC_PATTERN.test(productTypeHint)
    || PRODUCT_OVERVIEW_PROBIOTIC_PATTERN.test(primaryIngredient);
  const strongVitaminCSignal =
    PRODUCT_OVERVIEW_VITAMIN_C_PATTERN.test(productName)
    || PRODUCT_OVERVIEW_VITAMIN_C_PATTERN.test(productTypeHint)
    || PRODUCT_OVERVIEW_VITAMIN_C_PATTERN.test(primaryIngredient);

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

    if (strongProbioticSignal) {
      return buildProbioticFallback(params);
    }

    if (ingredientTokens.some((token) => PRODUCT_OVERVIEW_VITAMIN_C_PATTERN.test(token)) || strongVitaminCSignal) {
      return buildVitaminCFallback();
    }

    return buildSingleIngredientFallback(params);
  }

  if (strongOmegaSignal) {
    return buildOmegaFallback(params);
  }

  if (strongProbioticSignal) {
    return buildProbioticFallback(params);
  }

  if (strongVitaminCSignal && PRODUCT_OVERVIEW_VITAMIN_C_PATTERN.test(primaryIngredient)) {
    return buildVitaminCFallback();
  }

  const leadActiveMultiFallback = buildLeadActiveMultiIngredientFallback(params);
  if (leadActiveMultiFallback) {
    return leadActiveMultiFallback;
  }

  return buildGenericMultiIngredientFallback(params);
};
