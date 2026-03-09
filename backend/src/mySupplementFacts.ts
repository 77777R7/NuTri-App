import type { DecisionSupportOverlayClaims } from "./decisionSupport.js";
import type { FactsDigest } from "./factsDigest.js";
import { normalizeIherbSupplementFactsRows } from "./iherbOverlayIngredients.js";

export type MySupplementFactsIdentityType = FactsDigest["identity"]["type"];

export type MySupplementFactsV1 = {
  version: "facts_v1";
  identity: { type: MySupplementFactsIdentityType; value: string };
  factsSourceVersion: string;
  factsDigestHash: string;
  product: {
    name: string | null;
    brandDisplay: string | null;
    dosageForm: string | null;
  };
  actives: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    amountText: string | null;
    source: "label" | "dsld" | "lnhpd" | "web";
    confidence: number | null;
  }>;
  serving: FactsDigest["serving"];
  directions: {
    rawText: string | null;
    parsed: {
      perDoseCount: number | null;
      countUnit:
        | "tablet"
        | "capsule"
        | "softgel"
        | "gummy"
        | "scoop"
        | "drop"
        | "packet"
        | "serving"
        | null;
      timesPerDay: number | null;
      withMeals: boolean | null;
      timingHints: Array<"morning" | "evening" | "bedtime" | "with_meals" | "before_meals" | "after_meals">;
    };
    parseConfidence: number; // 0-1
  };
  overlay: {
    provider: "iherb";
    brandName: string | null;
    title: string | null;
    description: string | null;
    link: string | null;
    suggestedUse: string | null;
    ingredients: Array<{
      name: string;
      dose: string | null;
    }>;
  } | null;
  warnings: {
    bullets: string[];
    missing: boolean;
  };
  claims: {
    labelPurposes: string[];
    webClaims: string[];
  };
  quality: FactsDigest["quality"];
};

const safeTrim = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeDirectionsWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export function parseLabelDirectionsV1(rawText: string | null): {
  parsed: MySupplementFactsV1["directions"]["parsed"];
  parseConfidence: number;
} {
  const cleaned = rawText ? normalizeDirectionsWhitespace(rawText) : "";
  const lower = cleaned.toLowerCase();

  const parsed: MySupplementFactsV1["directions"]["parsed"] = {
    perDoseCount: null,
    countUnit: null,
    timesPerDay: null,
    withMeals: null,
    timingHints: [],
  };

  if (!cleaned) {
    return { parsed, parseConfidence: 0 };
  }

  // Timing/meal hints.
  const hints: MySupplementFactsV1["directions"]["parsed"]["timingHints"] = [];
  if (/\bwith\s+(food|meals?|a\s+meal)\b/i.test(cleaned)) hints.push("with_meals");
  if (/\bafter\s+meals?\b/i.test(cleaned)) hints.push("after_meals");
  if (/\bbefore\s+meals?\b/i.test(cleaned) || /\bempty\s+stomach\b/i.test(cleaned)) hints.push("before_meals");
  if (/\bmorning\b/i.test(cleaned)) hints.push("morning");
  if (/\bevening\b/i.test(cleaned)) hints.push("evening");
  if (/\bbedtime\b|\bbefore\s+bed\b|\bat\s+night\b/i.test(cleaned)) hints.push("bedtime");
  parsed.timingHints = Array.from(new Set(hints));

  if (parsed.timingHints.includes("with_meals") || parsed.timingHints.includes("after_meals")) {
    parsed.withMeals = true;
  } else if (parsed.timingHints.includes("before_meals")) {
    parsed.withMeals = false;
  }

  // Count units per dose (e.g. "1 tablet", "2 capsules").
  const countMatch = cleaned.match(
    /\b(\d+)\s*(tablet|capsule|softgel|gummy|scoop|drop|packet|serving)s?\b/i,
  );
  if (countMatch) {
    parsed.perDoseCount = Number(countMatch[1]);
    parsed.countUnit = (countMatch[2] ?? "").toLowerCase() as any;
  }

  // Frequency per day (e.g. "2 times daily", "twice daily", "once daily").
  const timesMatch = lower.match(/\b(\d+)\s*(?:times|x)\s*(?:per\s*)?(?:day|daily)\b/);
  if (timesMatch?.[1]) {
    const n = Number(timesMatch[1]);
    if (Number.isFinite(n) && n > 0) parsed.timesPerDay = n;
  } else if (/\bonce\s+daily\b/.test(lower)) {
    parsed.timesPerDay = 1;
  } else if (/\btwice\s+daily\b/.test(lower)) {
    parsed.timesPerDay = 2;
  } else if (/\bthree\s+times\s+daily\b/.test(lower) || /\b3\s+times\s+daily\b/.test(lower)) {
    parsed.timesPerDay = 3;
  }

  // Simple confidence heuristic: reward the fields we can extract deterministically.
  let confidence = 0.2;
  if (parsed.perDoseCount !== null && parsed.countUnit) confidence += 0.35;
  if (parsed.timesPerDay !== null) confidence += 0.25;
  if (parsed.withMeals !== null) confidence += 0.2;
  if (parsed.timingHints.length > 0) confidence += 0.1;
  confidence = clamp01(confidence);

  return { parsed, parseConfidence: confidence };
}

export function buildMySupplementFactsV1(params: {
  digest: FactsDigest;
  factsSourceVersion: string;
  factsDigestHash: string;
  labelDirectionsRawText: string | null;
  overlayClaims?: DecisionSupportOverlayClaims | null;
}): MySupplementFactsV1 {
  const overlayBrandName = safeTrim(params.overlayClaims?.brandName);
  const overlayTitle = safeTrim(params.overlayClaims?.title);
  const overlayDescription = safeTrim(params.overlayClaims?.description);
  const overlayLink = safeTrim(params.overlayClaims?.link);
  const overlaySuggestedUse = safeTrim(params.overlayClaims?.suggestedUse);
  const overlayIngredients = normalizeIherbSupplementFactsRows(params.overlayClaims?.nutritionalFacts);
  const labelDirectionsRawText = overlaySuggestedUse ?? safeTrim(params.labelDirectionsRawText);
  const parsedDirections = parseLabelDirectionsV1(labelDirectionsRawText);

  return {
    version: "facts_v1",
    identity: { type: params.digest.identity.type, value: params.digest.identity.value },
    factsSourceVersion: params.factsSourceVersion,
    factsDigestHash: params.factsDigestHash,
    product: {
      name: params.digest.product.name ?? null,
      brandDisplay: params.digest.product.brandDisplay ?? null,
      dosageForm: params.digest.product.dosageForm ?? null,
    },
    actives: params.digest.actives.map((active) => ({
      name: active.name,
      amount: active.amount ?? null,
      unit: active.unit ?? null,
      amountText: active.amountText ?? null,
      source: active.source,
      confidence: active.confidence ?? null,
    })),
    serving: params.digest.serving,
    directions: {
      rawText: labelDirectionsRawText,
      parsed: parsedDirections.parsed,
      parseConfidence: parsedDirections.parseConfidence,
    },
    overlay:
      overlayBrandName || overlayTitle || overlayDescription || overlayLink || overlaySuggestedUse || overlayIngredients.length > 0
        ? {
            provider: "iherb",
            brandName: overlayBrandName,
            title: overlayTitle,
            description: overlayDescription,
            link: overlayLink,
            suggestedUse: overlaySuggestedUse,
            ingredients: overlayIngredients,
          }
        : null,
    warnings: {
      bullets: [
        ...(params.digest.warnings.warnings ?? []),
        ...(params.digest.warnings.consultDoctorIf ?? []),
        ...(params.digest.warnings.redFlags ?? []),
      ].filter(Boolean),
      missing: Boolean(params.digest.warnings.missingFlag),
    },
    claims: {
      labelPurposes: params.digest.claims.labelPurposes ?? [],
      webClaims: params.digest.claims.webClaims ?? [],
    },
    quality: params.digest.quality,
  };
}
