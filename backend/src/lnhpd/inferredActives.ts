type NormalizedAmountUnit = "mg" | "mcg" | "g" | "iu" | "cfu" | "ml";

export const INFERRED_FROM_PRODUCT_NAME = "inferred_from_product_name" as const;
export const INFERENCE_SOURCE_PRODUCT_NAME = "product_name" as const;
export const INFERENCE_ONLY_SCORE_REASON_CODE = "INFERENCE_ONLY_LOW_CONFIDENCE" as const;
export const INFERENCE_ONLY_SCORE_CONFIDENCE_CAP = 0.4;
export const INFERENCE_ONLY_ACTIVE_CONFIDENCE_MAX = 0.4;

export type InferredLnhpdMeta = {
  ingredientName: string;
  properName: typeof INFERRED_FROM_PRODUCT_NAME;
  inferenceSource: typeof INFERENCE_SOURCE_PRODUCT_NAME;
};

export type InferredLnhpdActive = {
  name: string;
  amount: number | null;
  unit: NormalizedAmountUnit | string | null;
  lnhpdMeta: InferredLnhpdMeta;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeUnitLabel = (unitRaw?: string | null): NormalizedAmountUnit | string | null => {
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
  if (
    normalized.startsWith("ml") ||
    normalized.startsWith("milliliter") ||
    normalized.startsWith("millilitre")
  ) {
    return "ml";
  }
  if (normalized.includes("cfu") || normalized.includes("ufc")) return "cfu";
  return normalized;
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes("cfu") && !unitLower.includes("ufc")) return null;
  if (unitLower.includes("trillion")) return 1_000_000_000_000;
  if (unitLower.includes("billion")) return 1_000_000_000;
  if (unitLower.includes("million")) return 1_000_000;
  return 1;
};

const normalizeAmountAndUnit = (
  amount: number | null,
  unitRaw?: string | null,
): { amount: number | null; unit: NormalizedAmountUnit | string | null } => {
  if (!unitRaw) return { amount, unit: null };
  const normalizedUnit = normalizeUnitLabel(unitRaw) ?? unitRaw.trim();
  if (amount == null) return { amount, unit: normalizedUnit };
  const unitLower = unitRaw.trim().toLowerCase();
  const cfuMultiplier = parseCfuMultiplier(unitLower);
  if (cfuMultiplier) {
    return { amount: amount * cfuMultiplier, unit: "cfu" };
  }
  return { amount, unit: normalizedUnit };
};

const buildInferredActive = (
  name: string,
  amount: number | null,
  unit: NormalizedAmountUnit | string | null,
): InferredLnhpdActive => ({
  name,
  amount,
  unit,
  lnhpdMeta: {
    ingredientName: name,
    properName: INFERRED_FROM_PRODUCT_NAME,
    inferenceSource: INFERENCE_SOURCE_PRODUCT_NAME,
  },
});

export const isProductNameInferredMeta = (
  meta: {
    properName?: string | null;
    inferenceSource?: string | null;
  } | null | undefined,
): boolean => {
  if (!meta) return false;
  return (
    meta.inferenceSource === INFERENCE_SOURCE_PRODUCT_NAME ||
    meta.properName === INFERRED_FROM_PRODUCT_NAME
  );
};

export const isOnlyInferredLnhpdDigestActives = (
  actives:
    | Array<{
        source?: string | null;
        confidence?: number | null;
        evidenceText?: string | null;
      }>
    | null
    | undefined,
): boolean => {
  if (!Array.isArray(actives) || actives.length === 0) return false;
  return actives.every((active) => {
    if (!active || active.source !== "lnhpd") return false;
    if (typeof active.confidence !== "number" || !Number.isFinite(active.confidence)) return false;
    if (active.confidence > INFERENCE_ONLY_ACTIVE_CONFIDENCE_MAX) return false;
    const evidenceText = typeof active.evidenceText === "string" ? active.evidenceText : "";
    return /inferred from product name/i.test(evidenceText);
  });
};

export const inferLnhpdActivesFromProductName = (
  productNameRaw: string | null | undefined,
): InferredLnhpdActive[] => {
  if (!productNameRaw) return [];
  const productName = productNameRaw.trim();
  if (!productName) return [];

  const normalized = productName.toLowerCase();
  const hasExplicitVitaminD =
    /\bvitamin\s*d(?:\s*[23])?\b/i.test(productName) ||
    /\bcholecalciferol\b/i.test(productName) ||
    /\bergocalciferol\b/i.test(productName);
  const hasDShorthandWithDose =
    /^\s*d(?:\s*[23])?\b/i.test(productName) &&
    /\b(\d{1,5}(?:[.,]\d{1,3})?)\s*(iu|i\.?u\.?|mcg|μg|µg|ug|mg|g)\b/i.test(productName);

  if (hasExplicitVitaminD || hasDShorthandWithDose) {
    const amountMatch = productName.match(
      /\b(\d{1,5}(?:[.,]\d{1,3})?)\s*(iu|i\.?u\.?|mcg|μg|µg|ug|mg|g)\b/i,
    );
    const parsedAmount = amountMatch?.[1] ? parseNumber(amountMatch[1].replace(/,/g, "")) : null;
    const parsedUnitRaw = amountMatch?.[2] ?? null;
    const normalizedAmount = normalizeAmountAndUnit(parsedAmount ?? null, parsedUnitRaw);
    return [
      buildInferredActive(
        "Vitamin D",
        normalizedAmount.amount ?? null,
        normalizedAmount.unit ?? null,
      ),
    ];
  }

  // Deterministic generic fallback for LNHPD thin records:
  // extract "<ingredient phrase> <amount><unit>" only when both amount and unit are explicit.
  const genericDoseMatch = productName.match(
    /^\s*(.+?)\s+(\d[\d,]*(?:\.\d+)?)\s*(iu|i\.?u\.?|mcg|μg|µg|ug|mg|g)\b/i,
  );
  if (genericDoseMatch?.[1] && genericDoseMatch?.[2]) {
    const ingredientName = genericDoseMatch[1]
      .replace(/[\s|:;,_\-–]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const parsedAmount = parseNumber(genericDoseMatch[2].replace(/,/g, ""));
    const parsedUnitRaw = genericDoseMatch[3] ?? null;
    const normalizedAmount = normalizeAmountAndUnit(parsedAmount ?? null, parsedUnitRaw);
    if (ingredientName.length >= 2 && normalizedAmount.amount != null && normalizedAmount.unit != null) {
      return [
        buildInferredActive(
          ingredientName,
          normalizedAmount.amount,
          normalizedAmount.unit,
        ),
      ];
    }
  }

  const conservativeNameInferences: Array<{ test: RegExp; name: string }> = [
    { test: /\bl[\s-]*glutamine\b/i, name: "L-Glutamine" },
    { test: /\bl[\s-]*methionine\b/i, name: "L-Methionine" },
    { test: /\bpau\s*d['`-]?arco\b/i, name: "Pau d'Arco" },
    { test: /^\s*super\s+fiber(?:\b|$)/i, name: "Dietary Fiber" },
  ];
  const inferred = conservativeNameInferences.find((candidate) => candidate.test.test(normalized));
  if (!inferred) return [];
  return [buildInferredActive(inferred.name, null, null)];
};
