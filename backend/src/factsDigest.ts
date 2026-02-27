import { createHash } from "node:crypto";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";

export type FactsDigestSource = "lnhpd" | "dsld" | "web";
export type FactsIdentityType = "npn" | "dsldLabelId" | "webCanonicalId" | "gtin14";

export type FactsDigest = {
  sourceType: FactsDigestSource;
  identity: {
    type: FactsIdentityType;
    value: string;
    regionTags: string[];
    verifiedStatus?: string | null;
  };
  product: {
    brandDisplay: string | null;
    brandLegal?: string | null;
    name: string | null;
    dosageForm: string | null;
    route: string | null;
  };
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    amountText?: string | null;
    chemicalForm?: string | null;
    chemicalFormEvidence?: string | null;
    chemicalFormConfidence?: number | null;
    chemicalFormSource?:
      | "lnhpd_meta"
      | "label_parenthetical"
      | "label_as_phrase"
      | "label_from_phrase"
      | "ingredient_name"
      | "none";
    deliveryForm?: string | null;
    evidenceText?: string | null;
    source: "label" | "dsld" | "lnhpd" | "web";
    confidence: number | null;
  }>;
  inactives: string[];
  serving: {
    servingSize: string | null;
    servingsPerContainer: number | null;
  };
  labelDosing: Array<{
    population: string | null;
    age: string | null;
    dose: string | null;
    frequency: string | null;
    rawText: string | null;
  }>;
  warnings: {
    warnings: string[];
    consultDoctorIf: string[];
    redFlags: string[];
    missingFlag: boolean;
  };
  claims: {
    labelPurposes: string[];
    webClaims: string[];
  };
  quality: {
    isComplete: boolean;
    missingFields: string[];
    completenessScore: number;
  };
};

export type LnhpdFactsInput = {
  brandName: string | null;
  productName: string | null;
  npn: string | null;
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
    lnhpdMeta?: {
      ingredientName?: string | null;
      properName?: string | null;
      sourceMaterial?: string | null;
      extractTypeDesc?: string | null;
      inferenceSource?: string | null;
    } | null;
  }>;
  inactive: string[];
  purposes: string[];
  routes: string[];
  doses: string[];
  datasetVersion: string | null;
  extractedAt: string | null;
};

export type DsldFactsInput = {
  brandName: string | null;
  productName: string | null;
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
  }>;
  inactive: string[];
  proprietaryBlends: Array<{
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }>;
  datasetVersion: string | null;
  extractedAt: string | null;
};

export type WebFactsInput = {
  barcode: string;
  canonical: {
    name?: string | null;
    brand?: string | null;
    url?: string | null;
    domain?: string | null;
  };
  identifiers: {
    npn?: string | null;
  };
  textFacts: {
    ingredientsText?: string | null;
    directionsText?: string | null;
    warningsText?: string | null;
    servingSizeText?: string | null;
  };
  coverageScore: number;
  missingFields: string[];
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeChemicalFormConfidence = (value?: number | null): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
};

const CHEMICAL_FORM_KEYWORDS = [
  "oxide",
  "citrate",
  "gluconate",
  "carbonate",
  "sulfate",
  "chloride",
  "ascorbate",
  "glycinate",
  "malate",
  "picolinate",
  "nicotinate",
  "carnosine",
  "tartrate",
  "succinate",
  "nitrate",
  "phosphate",
  "fumarate",
  "lactate",
  "bisglycinate",
  "chelate",
  // Common mineral salt form in DSLD labels (e.g. "Magnesium Orotate").
  "orotate",
];

const CHEMICAL_FORM_BLACKLIST = ["dioxide", "peroxide", "antioxidant", "oxidative"];

const WEAK_FORM_INGREDIENT_ALLOWLIST = [
  "calcium",
  "magnesium",
  "zinc",
  "iron",
  "copper",
  "selenium",
  "iodine",
  "chromium",
  "manganese",
  "molybdenum",
  "potassium",
  "vitamin",
  "folate",
  "folic",
  "niacin",
  "riboflavin",
  "thiamin",
  "omega",
  "epa",
  "dha",
  "creatine",
  "coq10",
  "carnitine",
];

const hasBlacklistedFormToken = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return CHEMICAL_FORM_BLACKLIST.some((token) => normalized.includes(token));
};

const extractExplicitChemicalFormFromText = (
  text: string,
): {
  form: string;
  evidence: string;
  confidence: number;
  source: "label_parenthetical" | "label_as_phrase" | "label_from_phrase";
} | null => {
  const parenthetical = text.match(/\(as ([^)]+)\)/i);
  if (parenthetical?.[1]) {
    const form = normalizeWhitespace(parenthetical[1]);
    if (form && !hasBlacklistedFormToken(form)) {
      return { form, evidence: parenthetical[0], confidence: 0.8, source: "label_parenthetical" };
    }
  }

  const asMatch = text.match(/\bas ([^,;]+?)(?:,|;|$)/i);
  if (asMatch?.[1]) {
    const form = normalizeWhitespace(asMatch[1]);
    if (form && !hasBlacklistedFormToken(form)) {
      return { form, evidence: asMatch[0], confidence: 0.75, source: "label_as_phrase" };
    }
  }

  const fromMatch = text.match(/\bfrom ([^,;]+?)(?:,|;|$)/i);
  if (fromMatch?.[1]) {
    const form = normalizeWhitespace(fromMatch[1]);
    if (form && !hasBlacklistedFormToken(form)) {
      return { form, evidence: fromMatch[0], confidence: 0.72, source: "label_from_phrase" };
    }
  }

  return null;
};

const isAllowedWeakFormIngredient = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return WEAK_FORM_INGREDIENT_ALLOWLIST.some((token) => normalized.includes(token));
};

const extractChemicalFormFromText = (
  rawText: string,
): {
  form: string;
  evidence: string;
  confidence: number;
  source: "label_parenthetical" | "label_as_phrase" | "label_from_phrase" | "ingredient_name";
} | null => {
  const text = normalizeWhitespace(rawText);
  if (!text) return null;

  const explicit = extractExplicitChemicalFormFromText(text);
  if (explicit) return explicit;

  const lower = text.toLowerCase();
  if (!isAllowedWeakFormIngredient(lower)) return null;
  if (hasBlacklistedFormToken(lower)) return null;
  const keywordMatch =
    [...CHEMICAL_FORM_KEYWORDS]
      .sort((a, b) => b.length - a.length)
      .find((keyword) => {
        if (!lower.includes(keyword)) return false;
        // Use word boundaries to avoid partial matches (e.g. antioxidant/oxidative).
        const re = new RegExp(`\\b${keyword}\\b`, "i");
        return re.test(lower);
      }) ?? null;
  if (keywordMatch) {
    // P0-C: normalize for KB lookup (keyword), while preserving original label evidence text.
    return { form: keywordMatch, evidence: text, confidence: 0.6, source: "ingredient_name" };
  }

  return null;
};

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith("mcg") ||
    normalized.startsWith("ug") ||
    normalized.startsWith("µg") ||
    normalized.startsWith("μg") ||
    normalized.startsWith("microgram")
  ) {
    return "mcg";
  }
  if (normalized.startsWith("mg") || normalized.startsWith("milligram")) return "mg";
  if (normalized.startsWith("g") || normalized.startsWith("gram")) return "g";
  if (normalized.startsWith("iu") || normalized.startsWith("i.u")) return "iu";
  if (normalized.includes("cfu") || normalized.includes("ufc")) return "cfu";
  if (normalized.startsWith("ml") || normalized.startsWith("milliliter") || normalized.startsWith("millilitre")) {
    return "ml";
  }
  return normalized;
};

const parseActiveSummaryLine = (rawLine: string): { name: string; amount: number | null; unit: string | null } => {
  const cleaned = rawLine.replace(/\{[^}]*\}/g, "").trim();
  if (!cleaned) {
    return { name: rawLine.trim(), amount: null, unit: null };
  }

  const amountUnitMatch = cleaned.match(
    /(.*?)(\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml|cfu|ufc|kcal|cal|calorie(?:s)?|%\s*dv|%dv|%)/i,
  );
  if (amountUnitMatch) {
    const [, name, amountRaw, unitRaw] = amountUnitMatch;
    const amount = Number(amountRaw);
    const unitNormalized = normalizeUnitLabel(unitRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: unitNormalized,
    };
  }

  const numericMatch = cleaned.match(/(.*?)(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, name, amountRaw] = numericMatch;
    const amount = Number(amountRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: null,
    };
  }

  return { name: cleaned, amount: null, unit: null };
};

const splitTextToLines = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/\n|\r|•|\u2022|;|\|/g)
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
};

const extractShortBullets = (value?: string | null): string[] => {
  const lines = splitTextToLines(value);
  if (!lines.length) return [];
  return lines.map((item) => {
    if (item.length <= 160) return item;
    return `${item.slice(0, 157).trim()}...`;
  });
};

const PURPOSE_CATEGORY_ORDER = [
  "immune",
  "antioxidant",
  "energy",
  "bone",
  "heart",
  "skin",
  "digestive",
  "stress",
  "general",
];

const PURPOSE_CATEGORY_LABELS: Record<string, string> = {
  immune: "Supports immune function",
  antioxidant: "Antioxidant support",
  energy: "Supports energy and metabolism",
  bone: "Supports bone and connective tissue",
  heart: "Supports cardiovascular health",
  skin: "Supports skin, hair, and nails",
  digestive: "Supports digestive health",
  stress: "Supports stress and sleep balance",
  general: "Supports general health",
};

const categorizePurpose = (purpose: string): string => {
  const normalized = purpose.toLowerCase();
  if (/immune|immunity|cold/.test(normalized)) return "immune";
  if (/antioxidant|oxidative/.test(normalized)) return "antioxidant";
  if (/energy|fatigue|metabolism/.test(normalized)) return "energy";
  if (/bone|calcium|oste/.test(normalized)) return "bone";
  if (/heart|cardio|cholesterol|lipid/.test(normalized)) return "heart";
  if (/skin|hair|nail|collagen/.test(normalized)) return "skin";
  if (/digest|gut|stomach/.test(normalized)) return "digestive";
  if (/stress|calm|sleep/.test(normalized)) return "stress";
  return "general";
};

const dedupeAndSortPurposes = (purposes: string[]): string[] => {
  const cleaned = purposes
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.sort((a, b) => {
    const catA = categorizePurpose(a);
    const catB = categorizePurpose(b);
    const idxA = PURPOSE_CATEGORY_ORDER.indexOf(catA);
    const idxB = PURPOSE_CATEGORY_ORDER.indexOf(catB);
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });
};

const summarizePurposes = (purposes: string[], maxItems = 4): string[] => {
  const cleaned = dedupeAndSortPurposes(purposes);
  if (!cleaned.length) return [];
  const categoryMap = new Map<string, string>();
  for (const purpose of cleaned) {
    const category = categorizePurpose(purpose);
    if (!categoryMap.has(category)) {
      categoryMap.set(category, PURPOSE_CATEGORY_LABELS[category] ?? purpose);
    }
  }
  const ordered = PURPOSE_CATEGORY_ORDER.flatMap((category) =>
    categoryMap.has(category) ? [categoryMap.get(category)!] : [],
  );
  if (ordered.length > 0) {
    return ordered.slice(0, maxItems);
  }
  return cleaned.slice(0, maxItems);
};

const computeCompleteness = (digest: FactsDigest): FactsDigest["quality"] => {
  const missingFields: string[] = [];
  if (!digest.product.name) missingFields.push("product_name");
  if (!digest.product.brandDisplay) missingFields.push("brand");
  if (!digest.actives.length) missingFields.push("actives");
  if (!digest.serving.servingSize) missingFields.push("serving_size");
  if (digest.warnings.missingFlag) missingFields.push("warnings");

  const totalFields = 5;
  const completenessScore = Math.max(0, Math.min(1, (totalFields - missingFields.length) / totalFields));
  return {
    isComplete: completenessScore >= 0.8,
    missingFields,
    completenessScore,
  };
};

const pickBrandDisplay = (snapshot: SupplementSnapshot | null | undefined, fallback?: string | null): string | null => {
  if (snapshot?.product?.brand) return snapshot.product.brand;
  if (fallback) return fallback;
  return null;
};

const pickProductName = (snapshot: SupplementSnapshot | null | undefined, fallback?: string | null): string | null => {
  if (snapshot?.product?.name) return snapshot.product.name;
  if (fallback) return fallback;
  return null;
};

const extractDeliveryFormFromText = (rawText: string): string | null => {
  const cleaned = normalizeWhitespace(rawText).toLowerCase();
  if (!cleaned) return null;
  const forms: Array<{ re: RegExp; value: string }> = [
    { re: /\btablet(s)?\b/, value: "tablet" },
    { re: /\bcapsule(s)?\b/, value: "capsule" },
    { re: /\bsoftgel(s)?\b/, value: "softgel" },
    { re: /\bgumm(y|ies)\b/, value: "gummy" },
    { re: /\bspray(s)?\b/, value: "spray" },
    { re: /\bscoop(s)?\b/, value: "scoop" },
    { re: /\bdrop(s)?\b/, value: "drops" },
    { re: /\bpowder\b/, value: "powder" },
    { re: /\bliquid\b/, value: "liquid" },
  ];
  for (const { re, value } of forms) {
    if (re.test(cleaned)) return value;
  }
  return null;
};

const extractDeliveryFormFromDosingLines = (lines: string[]): string | null => {
  for (const line of lines) {
    if (!line) continue;
    const match = extractDeliveryFormFromText(line);
    if (match) return match;
  }
  return null;
};

const parseLnhpdLabelDosingLine = (rawDose: string): FactsDigest["labelDosing"][number] => {
  const rawText = normalizeWhitespace(rawDose);
  if (!rawText) {
    return {
      population: null,
      age: null,
      dose: null,
      frequency: null,
      rawText: null,
    };
  }

  let populationPart: string | null = null;
  let detailPart = rawText;
  const colonIndex = rawText.indexOf(":");
  if (colonIndex > 0) {
    const prefix = normalizeWhitespace(rawText.slice(0, colonIndex));
    const suffix = normalizeWhitespace(rawText.slice(colonIndex + 1));
    if (prefix && suffix) {
      populationPart = prefix;
      detailPart = suffix;
    }
  }

  const ageMatch = populationPart?.match(/\bage\s*([^)]+)\)?/i);
  const age = ageMatch?.[1] ? normalizeWhitespace(ageMatch[1]) : null;
  const population = populationPart
    ? normalizeWhitespace(populationPart.replace(/\(\s*age[^)]*\)/i, ""))
    : null;

  const doseMatch = detailPart.match(
    /(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:tablets?|capsules?|softgels?|gummies?|drops?|sprays?|scoops?|ml|mg|mcg|g|iu))/i,
  );
  const frequencyMatch =
    detailPart.match(
      /\b((?:once|twice|three|four|\d+(?:\s*-\s*\d+)?)\s*(?:times?)?\s*(?:daily|per day|weekly|per week|monthly|per month))\b/i,
    )
    ?? detailPart.match(/\b(daily|weekly|monthly|per day|per week|per month)\b/i);

  return {
    population: population || null,
    age: age || null,
    dose: doseMatch?.[1] ? normalizeWhitespace(doseMatch[1]) : null,
    frequency: frequencyMatch?.[1] ? normalizeWhitespace(frequencyMatch[1]) : null,
    rawText,
  };
};

export const buildFactsDigestFromLnhpd = (params: {
  facts: LnhpdFactsInput;
  snapshot?: SupplementSnapshot | null;
  identityValue: string;
  regionTags?: string[] | null;
}): FactsDigest => {
  const { facts, snapshot, identityValue } = params;
  const brandDisplay = pickBrandDisplay(snapshot, facts.brandName ?? null);
  const productName = pickProductName(snapshot, facts.productName ?? null);

  const dosingLines = (facts.doses ?? []).map((dose) => normalizeWhitespace(dose)).filter(Boolean);
  const deliveryForm =
    extractDeliveryFormFromDosingLines(dosingLines) ??
    (facts.servingSize ? extractDeliveryFormFromText(facts.servingSize) : null);

  const actives = (facts.actives ?? []).map((active) => {
    const normalizedUnit = normalizeUnitLabel(active.unit ?? null);
    const inferredFromProductName = active.lnhpdMeta?.inferenceSource === "product_name";
    const evidenceText = inferredFromProductName
      ? "Inferred from product name; treat as low-confidence ingredient evidence."
      : active.lnhpdMeta?.sourceMaterial ?? active.lnhpdMeta?.extractTypeDesc ?? null;

    // P0-2: Extract chemical form evidence from LNHPD inputs in a DSLD-like way, so KB-first can
    // resolve reliably when the label discloses a salt/form.
    const candidateSources = [
      active.formRaw ?? null,
      active.lnhpdMeta?.ingredientName ?? null,
      active.lnhpdMeta?.properName ?? null,
      active.name ?? null,
    ].filter(Boolean) as string[];
    let extracted: ReturnType<typeof extractChemicalFormFromText> | null = null;
    for (const source of candidateSources) {
      const next = extractChemicalFormFromText(source);
      if (!next) continue;
      if (!extracted || next.confidence > extracted.confidence) extracted = next;
    }
    const chemicalForm = extracted?.form ? normalizeWhitespace(extracted.form) : null;
    const chemicalFormEvidence =
      extracted?.source === "ingredient_name"
        ? extracted.evidence
        : extracted?.form ?? null;
    const chemicalFormConfidence = normalizeChemicalFormConfidence(extracted?.confidence ?? null);
    const chemicalFormSource: FactsDigest["actives"][number]["chemicalFormSource"] =
      extracted?.source ?? "none";

    return {
      name: normalizeWhitespace(active.name),
      amount: active.amount ?? null,
      unit: normalizedUnit,
      amountText: active.amount != null && normalizedUnit ? `${active.amount} ${normalizedUnit}` : null,
      chemicalForm,
      chemicalFormEvidence: chemicalFormEvidence ? normalizeWhitespace(chemicalFormEvidence) : chemicalForm,
      chemicalFormConfidence,
      chemicalFormSource,
      deliveryForm,
      evidenceText: evidenceText ? normalizeWhitespace(evidenceText) : null,
      source: "lnhpd" as const,
      confidence: inferredFromProductName ? 0.35 : active.lnhpdMeta ? 0.9 : 0.7,
    };
  });

  const digest: FactsDigest = {
    sourceType: "lnhpd",
    identity: {
      type: "npn",
      value: identityValue,
      regionTags: params.regionTags ?? snapshot?.regulatory?.regionTags ?? [],
      verifiedStatus: snapshot?.regulatory?.npnStatus ?? null,
    },
    product: {
      brandDisplay: brandDisplay ?? null,
      brandLegal: facts.brandName ?? null,
      name: productName ?? null,
      dosageForm: snapshot?.label?.servingSize ?? null,
      route: facts.routes?.[0] ?? null,
    },
    actives,
    inactives: facts.inactive ?? [],
    serving: {
      servingSize: facts.servingSize ?? null,
      servingsPerContainer: facts.servingsPerContainer ?? null,
    },
    labelDosing: (facts.doses ?? []).map((dose) => parseLnhpdLabelDosingLine(dose)),
    warnings: {
      warnings: [],
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: true,
    },
    claims: {
      labelPurposes: summarizePurposes(facts.purposes ?? []),
      webClaims: [],
    },
    quality: { isComplete: false, missingFields: [], completenessScore: 0 },
  };

  digest.quality = computeCompleteness(digest);
  return digest;
};

export const buildFactsDigestFromDsld = (params: {
  facts: DsldFactsInput;
  snapshot?: SupplementSnapshot | null;
  identityValue: string;
  regionTags?: string[] | null;
}): FactsDigest => {
  const { facts, snapshot, identityValue } = params;
  const brandDisplay = pickBrandDisplay(snapshot, facts.brandName ?? null);
  const productName = pickProductName(snapshot, facts.productName ?? null);

  const actives = (facts.actives ?? []).map((active) => {
    const normalizedUnit = normalizeUnitLabel(active.unit ?? null);
    const formRawNormalized = active.formRaw ? normalizeWhitespace(active.formRaw) : null;
    const extracted =
      formRawNormalized
        ? {
            form: formRawNormalized,
            evidence: formRawNormalized,
            confidence: 0.75,
            source: "label_parenthetical" as const,
          }
        : extractChemicalFormFromText(active.name);
    const chemicalForm = extracted?.form ?? null;
    const chemicalFormConfidence = normalizeChemicalFormConfidence(extracted?.confidence ?? null);
    const chemicalFormSource: FactsDigest["actives"][number]["chemicalFormSource"] = extracted?.source ?? "none";
    return {
      name: normalizeWhitespace(active.name),
      amount: active.amount ?? null,
      unit: normalizedUnit,
      amountText: active.amount != null && normalizedUnit ? `${active.amount} ${normalizedUnit}` : null,
      chemicalForm: chemicalForm,
      chemicalFormEvidence: extracted?.evidence ?? null,
      chemicalFormConfidence,
      chemicalFormSource,
      deliveryForm: null,
      evidenceText: null,
      source: "dsld" as const,
      confidence: 0.8,
    };
  });

  const digest: FactsDigest = {
    sourceType: "dsld",
    identity: {
      type: "dsldLabelId",
      value: identityValue,
      regionTags: params.regionTags ?? snapshot?.regulatory?.regionTags ?? [],
      verifiedStatus: snapshot?.regulatory?.npnStatus ?? null,
    },
    product: {
      brandDisplay: brandDisplay ?? null,
      brandLegal: facts.brandName ?? null,
      name: productName ?? null,
      dosageForm: snapshot?.label?.servingSize ?? null,
      route: null,
    },
    actives,
    inactives: facts.inactive ?? [],
    serving: {
      servingSize: facts.servingSize ?? null,
      servingsPerContainer: facts.servingsPerContainer ?? null,
    },
    labelDosing: [],
    warnings: {
      warnings: [],
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: true,
    },
    claims: {
      labelPurposes: [],
      webClaims: [],
    },
    quality: { isComplete: false, missingFields: [], completenessScore: 0 },
  };

  digest.quality = computeCompleteness(digest);
  return digest;
};

export const buildFactsDigestFromWeb = (params: {
  facts: WebFactsInput;
  snapshot?: SupplementSnapshot | null;
  identityType: FactsIdentityType;
  identityValue: string;
  regionTags?: string[] | null;
}): FactsDigest => {
  const { facts, snapshot } = params;
  const brandDisplay = pickBrandDisplay(snapshot, facts.canonical?.brand ?? null);
  const productName = pickProductName(snapshot, facts.canonical?.name ?? null);

  const ingredientLines = splitTextToLines(facts.textFacts.ingredientsText ?? null);
  const actives = ingredientLines.slice(0, 20).map((line) => {
    const parsed = parseActiveSummaryLine(line);
    const normalizedUnit = normalizeUnitLabel(parsed.unit ?? null);
    return {
      name: normalizeWhitespace(parsed.name),
      amount: parsed.amount,
      unit: normalizedUnit,
      amountText: parsed.amount != null && normalizedUnit ? `${parsed.amount} ${normalizedUnit}` : null,
      chemicalForm: null,
      chemicalFormEvidence: null,
      chemicalFormConfidence: null,
      chemicalFormSource: "none" as const,
      deliveryForm: null,
      evidenceText: line,
      source: "web" as const,
      confidence: 0.6,
    };
  });

  const warnings = extractShortBullets(facts.textFacts.warningsText ?? null);
  const dosingLines = extractShortBullets(facts.textFacts.directionsText ?? null);

  const digest: FactsDigest = {
    sourceType: "web",
    identity: {
      type: params.identityType,
      value: params.identityValue,
      regionTags: params.regionTags ?? snapshot?.regulatory?.regionTags ?? [],
      verifiedStatus: snapshot?.regulatory?.npnStatus ?? null,
    },
    product: {
      brandDisplay: brandDisplay ?? null,
      brandLegal: null,
      name: productName ?? null,
      dosageForm: null,
      route: null,
    },
    actives,
    inactives: [],
    serving: {
      servingSize: facts.textFacts.servingSizeText ? normalizeWhitespace(facts.textFacts.servingSizeText) : null,
      servingsPerContainer: null,
    },
    labelDosing: dosingLines.map((dose) => ({
      population: null,
      age: null,
      dose: null,
      frequency: null,
      rawText: dose,
    })),
    warnings: {
      warnings,
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: warnings.length === 0,
    },
    claims: {
      labelPurposes: [],
      webClaims: [],
    },
    quality: { isComplete: false, missingFields: [], completenessScore: 0 },
  };

  digest.quality = computeCompleteness(digest);
  return digest;
};

const canonicalizeValue = (value: unknown, path: string[] = []): unknown => {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => canonicalizeValue(item, path));
    const pathKey = path.join(".");
    if (pathKey.endsWith("actives")) {
      return [...normalizedItems].sort((a, b) => {
        const left = a as { name?: string; amount?: number | null; unit?: string | null };
        const right = b as { name?: string; amount?: number | null; unit?: string | null };
        const keyLeft = `${left?.name ?? ""}|${left?.amount ?? ""}|${left?.unit ?? ""}`;
        const keyRight = `${right?.name ?? ""}|${right?.amount ?? ""}|${right?.unit ?? ""}`;
        return keyLeft.localeCompare(keyRight);
      });
    }
    if (
      pathKey.endsWith("labelPurposes") ||
      pathKey.endsWith("webClaims") ||
      pathKey.endsWith("warnings") ||
      pathKey.endsWith("consultDoctorIf") ||
      pathKey.endsWith("redFlags")
    ) {
      return [...normalizedItems].sort((a, b) => String(a).localeCompare(String(b)));
    }
    return normalizedItems;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      out[key] = canonicalizeValue(val, [...path, key]);
    }
    return out;
  }
  return value;
};

export const canonicalizeFactsDigest = (digest: FactsDigest): string => {
  const normalized = canonicalizeValue(digest) as Record<string, unknown>;
  return JSON.stringify(normalized);
};

export const computeFactsDigestHash = (digest: FactsDigest): string => {
  const canonical = canonicalizeFactsDigest(digest);
  return createHash("sha256").update(canonical).digest("hex");
};
