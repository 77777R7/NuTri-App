import {
  CANONICAL_ALLERGY_FLAGS,
  CANONICAL_INGREDIENT_RESTRICTIONS,
  type CanonicalAllergyFlag,
  type CanonicalIngredientRestriction,
} from "./allergenTaxonomy.js";
import { normalizeMatchText } from "./sourceHelpers.js";

export type AllergyEvidenceSource =
  | "active_ingredient"
  | "inactive_ingredient"
  | "label_disclosure"
  | "warning";

export type AllergyMatchConfidence = "high" | "medium" | "low";

export type NormalizedAllergenDetail = {
  flag: CanonicalAllergyFlag | CanonicalIngredientRestriction;
  source: AllergyEvidenceSource;
  matchedText: string;
  confidence: AllergyMatchConfidence;
};

export type ProductAllergenCoverageStatus =
  | "resolved"
  | "partial"
  | "insufficient";

export type AllergenTextInput = {
  source: AllergyEvidenceSource;
  text: string | null | undefined;
};

export type NormalizedAllergenResult = {
  allergyFlags: CanonicalAllergyFlag[];
  ingredientRestrictions: CanonicalIngredientRestriction[];
  details: NormalizedAllergenDetail[];
  coverageStatus: ProductAllergenCoverageStatus;
};

type Rule<TFlag extends string> = {
  flag: TFlag;
  patterns: RegExp[];
  negationPatterns?: RegExp[];
  exclusionPatterns?: RegExp[];
};

const ALLERGY_RULES: Rule<CanonicalAllergyFlag>[] = [
  {
    flag: "milk",
    patterns: [
      /\bmilk\b/i,
      /\bdairy\b/i,
      /\bwhey\b/i,
      /\bcasein(?:ate)?\b/i,
      /\blactose\b/i,
      /\bmilk protein\b/i,
      /\bcolostrum\b/i,
    ],
    negationPatterns: [
      /\b(?:milk|dairy)[-\s]?free\b/i,
      /\bfree (?:of|from) (?:milk|dairy)\b/i,
      /\bwithout (?:milk|dairy)\b/i,
      /\bno (?:milk|dairy)\b/i,
    ],
    exclusionPatterns: [/\bmilk thistle\b/i],
  },
  {
    flag: "egg",
    patterns: [
      /\begg\b/i,
      /\begg white\b/i,
      /\begg yolk\b/i,
      /\balbumen\b/i,
      /\bovalbumin\b/i,
    ],
    negationPatterns: [
      /\begg[-\s]?free\b/i,
      /\bfree (?:of|from) egg\b/i,
      /\bwithout egg\b/i,
      /\bno egg\b/i,
    ],
  },
  {
    flag: "fish",
    patterns: [
      /\bfish\b/i,
      /\bfish oil\b/i,
      /\bcod liver oil\b/i,
      /\bankhovy\b/i,
      /\banchovy\b/i,
      /\bsalmon\b/i,
      /\bsardine\b/i,
      /\bmackerel\b/i,
      /\btuna\b/i,
      /\bmenhaden\b/i,
      /\bpollock\b/i,
      /\btrout\b/i,
    ],
    negationPatterns: [
      /\bfish[-\s]?free\b/i,
      /\bfree (?:of|from) fish\b/i,
      /\bwithout fish\b/i,
      /\bno fish\b/i,
    ],
  },
  {
    flag: "shellfish",
    patterns: [
      /\bshellfish\b/i,
      /\bshrimp\b/i,
      /\bprawn\b/i,
      /\bkrill\b/i,
      /\blobster\b/i,
      /\bcrab\b/i,
      /\bcrayfish\b/i,
      /\bclam\b/i,
      /\bmussel\b/i,
      /\boyster\b/i,
      /\bscallop\b/i,
    ],
    negationPatterns: [
      /\bshellfish[-\s]?free\b/i,
      /\bfree (?:of|from) shellfish\b/i,
      /\bwithout shellfish\b/i,
      /\bno shellfish\b/i,
    ],
  },
  {
    flag: "tree_nuts",
    patterns: [
      /\btree nuts?\b/i,
      /\balmond\b/i,
      /\bcashew\b/i,
      /\bwalnut\b/i,
      /\bpecan\b/i,
      /\bpistachio\b/i,
      /\bmacadamia\b/i,
      /\bhazelnut\b/i,
      /\bbrazil nut\b/i,
    ],
    negationPatterns: [
      /\btree nut[-\s]?free\b/i,
      /\bnut[-\s]?free\b/i,
      /\bfree (?:of|from) tree nuts?\b/i,
      /\bwithout tree nuts?\b/i,
      /\bno tree nuts?\b/i,
    ],
  },
  {
    flag: "peanuts",
    patterns: [/\bpeanut(?:s)?\b/i, /\bgroundnut\b/i, /\barachis\b/i],
    negationPatterns: [
      /\bpeanut[-\s]?free\b/i,
      /\bfree (?:of|from) peanuts?\b/i,
      /\bwithout peanuts?\b/i,
      /\bno peanuts?\b/i,
    ],
  },
  {
    flag: "wheat",
    patterns: [/\bwheat(?:grass| germ| bran| flour)?\b/i],
    negationPatterns: [
      /\bwheat[-\s]?free\b/i,
      /\bfree (?:of|from) wheat\b/i,
      /\bwithout wheat\b/i,
      /\bno wheat\b/i,
    ],
  },
  {
    flag: "soy",
    patterns: [
      /\bsoy\b/i,
      /\bsoya\b/i,
      /\bsoybean\b/i,
      /\bsoy lecithin\b/i,
      /\bsoy protein\b/i,
    ],
    negationPatterns: [
      /\bsoy[-\s]?free\b/i,
      /\bsoya[-\s]?free\b/i,
      /\bfree (?:of|from) soy\b/i,
      /\bwithout soy\b/i,
      /\bno soy\b/i,
    ],
  },
  {
    flag: "sesame",
    patterns: [/\bsesame\b/i, /\btahini\b/i, /\bsesamum\b/i],
    negationPatterns: [
      /\bsesame[-\s]?free\b/i,
      /\bfree (?:of|from) sesame\b/i,
      /\bwithout sesame\b/i,
      /\bno sesame\b/i,
    ],
  },
];

const RESTRICTION_RULES: Rule<CanonicalIngredientRestriction>[] = [
  {
    flag: "gluten",
    patterns: [
      /\bgluten\b/i,
      /\bbarley\b/i,
      /\brye\b/i,
      /\btriticale\b/i,
      /\bmalt\b(?!odextrin)/i,
    ],
    negationPatterns: [
      /\bgluten[-\s]?free\b/i,
      /\bfree (?:of|from) gluten\b/i,
      /\bwithout gluten\b/i,
      /\bno gluten\b/i,
    ],
  },
  {
    flag: "gelatin_animal_based",
    patterns: [
      /\bgelatin\b/i,
      /\bgelatine\b/i,
      /\bbovine gelatin\b/i,
      /\bporcine gelatin\b/i,
    ],
    negationPatterns: [
      /\bgelatin[-\s]?free\b/i,
      /\bfree (?:of|from) gelatin\b/i,
      /\bwithout gelatin\b/i,
      /\bno gelatin\b/i,
    ],
  },
];

const confidenceForSource = (
  source: AllergyEvidenceSource,
): AllergyMatchConfidence => {
  if (source === "warning") return "low";
  if (source === "label_disclosure") return "medium";
  return "high";
};

const hasCoverage = (inputs: AllergenTextInput[]): ProductAllergenCoverageStatus => {
  const populated = inputs.filter((input) => String(input.text ?? "").trim().length > 0);
  if (populated.length === 0) return "insufficient";
  if (
    populated.some(
      (input) =>
        input.source === "active_ingredient" ||
        input.source === "inactive_ingredient",
    )
  ) {
    return "resolved";
  }
  return "partial";
};

const matchesRule = <TFlag extends string>(
  rule: Rule<TFlag>,
  rawText: string,
): boolean => {
  if (rule.exclusionPatterns?.some((pattern) => pattern.test(rawText))) return false;
  if (rule.negationPatterns?.some((pattern) => pattern.test(rawText))) return false;
  return rule.patterns.some((pattern) => pattern.test(rawText));
};

export const normalizeAllergenTextInputs = (
  inputs: AllergenTextInput[],
): NormalizedAllergenResult => {
  const allergyFlags = new Set<CanonicalAllergyFlag>();
  const ingredientRestrictions = new Set<CanonicalIngredientRestriction>();
  const detailMap = new Map<string, NormalizedAllergenDetail>();

  inputs.forEach((input) => {
    const rawText = String(input.text ?? "").trim();
    if (!rawText) return;

    ALLERGY_RULES.forEach((rule) => {
      if (!matchesRule(rule, rawText)) return;
      allergyFlags.add(rule.flag);
      const key = `${rule.flag}:${input.source}:${normalizeMatchText(rawText)}`;
      if (!detailMap.has(key)) {
        detailMap.set(key, {
          flag: rule.flag,
          source: input.source,
          matchedText: rawText,
          confidence: confidenceForSource(input.source),
        });
      }
    });

    RESTRICTION_RULES.forEach((rule) => {
      if (!matchesRule(rule, rawText)) return;
      ingredientRestrictions.add(rule.flag);
      const key = `${rule.flag}:${input.source}:${normalizeMatchText(rawText)}`;
      if (!detailMap.has(key)) {
        detailMap.set(key, {
          flag: rule.flag,
          source: input.source,
          matchedText: rawText,
          confidence: confidenceForSource(input.source),
        });
      }
    });
  });

  return {
    allergyFlags: CANONICAL_ALLERGY_FLAGS.filter((flag) => allergyFlags.has(flag)),
    ingredientRestrictions: CANONICAL_INGREDIENT_RESTRICTIONS.filter((flag) =>
      ingredientRestrictions.has(flag),
    ),
    details: Array.from(detailMap.values()).sort((a, b) => {
      if (a.flag !== b.flag) return a.flag.localeCompare(b.flag);
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      return a.matchedText.localeCompare(b.matchedText);
    }),
    coverageStatus: hasCoverage(inputs),
  };
};

export const allergenNormalizationInternals = {
  ALLERGY_RULES,
  RESTRICTION_RULES,
  confidenceForSource,
  hasCoverage,
  matchesRule,
};
