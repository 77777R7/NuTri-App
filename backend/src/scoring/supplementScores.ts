// Deterministic supplement scoring utilities
import type { NutrientCategory, ScoreBreakdown, SupplementMeta } from "../types.js";

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

// --- Nutrient Category Logic ---

interface DoseRule {
  fullScoreRange: [number, number]; // [min, max] ratio for full score
  softHighRange: [number, number];  // [min, max] ratio for soft penalty
  hardHighCutoff: number;           // ratio above which hard penalty applies
  tolerableUpperLimit?: number;     // ratio above which safety warning might be triggered
}

const DOSE_RULES: Record<NutrientCategory, DoseRule> = {
  water_soluble_vitamin: {
    fullScoreRange: [1.0, 2.0],    // 100%–200% RDA 满分
    softHighRange: [2.0, 5.0],     // 200%–500% 缓慢降分
    hardHighCutoff: 10.0,          // >1000% 开始重扣
    tolerableUpperLimit: 15.0      // Very high tolerance
  },
  fat_soluble_vitamin: {
    fullScoreRange: [0.8, 1.2],    // 80%–120% 严格
    softHighRange: [1.2, 1.5],     // 120%–150% 勉强接受
    hardHighCutoff: 1.5,
    tolerableUpperLimit: 1.5       // Strict UL
  },
  essential_mineral: {
    fullScoreRange: [0.8, 1.2],
    softHighRange: [1.2, 1.5],
    hardHighCutoff: 1.5,
    tolerableUpperLimit: 1.2       // Strict UL for minerals
  },
  other: {
    fullScoreRange: [0.5, 1.5],    // 很多草本没明显 RDA，只能宽松一点
    softHighRange: [1.5, 2.0],
    hardHighCutoff: 2.0
  }
};

// Helper to determine category if not provided in meta
// (This is also used in deepseek.ts normalization)
export const getNutrientCategory = (ingredientName?: string): NutrientCategory => {
  if (!ingredientName) return "other";
  const lower = ingredientName.toLowerCase();

  if (lower.includes("vitamin c") || lower.includes("ascorbic") || lower.includes("vitamin b") || lower.includes("niacin") || lower.includes("thiamin") || lower.includes("riboflavin") || lower.includes("folate") || lower.includes("biotin")) {
    return "water_soluble_vitamin";
  }
  if (lower.includes("vitamin a") || lower.includes("vitamin d") || lower.includes("vitamin e") || lower.includes("vitamin k")) {
    return "fat_soluble_vitamin";
  }
  if (lower.includes("zinc") || lower.includes("iron") || lower.includes("magnesium") || lower.includes("calcium") || lower.includes("selenium") || lower.includes("copper")) {
    return "essential_mineral";
  }
  return "other";
};

// Effectiveness in Real Life (E: 0–10)
const scoreEffectiveness = (meta: SupplementMeta): number => {
  // 1) Evidence (0–4)
  let E_evidence = 0;
  switch (meta.evidenceLevel) {
    case 3: E_evidence = 4; break;
    case 2: E_evidence = 3; break;
    case 1: E_evidence = 2; break;
    case 0: default: E_evidence = 0; break;
  }

  // 2) Dose match (0–3) - NEW LOGIC
  let E_dose = 0;
  if (meta.refDoseMg && meta.actualDoseMg && meta.refDoseMg > 0) {
    const doseRatio = meta.actualDoseMg / meta.refDoseMg;
    // Use pre-calculated category or fallback
    const category = meta.primaryCategory ?? getNutrientCategory(meta.primaryIngredient);
    const rule = DOSE_RULES[category];

    if (doseRatio >= rule.fullScoreRange[0] && doseRatio <= rule.fullScoreRange[1]) {
      E_dose = 3; // Full score
    } else if (doseRatio >= rule.softHighRange[0] && doseRatio <= rule.softHighRange[1]) {
      E_dose = 2; // Soft penalty for high dose
    } else if (doseRatio > rule.hardHighCutoff) {
      E_dose = 0; // Hard penalty for very high dose
    } else if (doseRatio < rule.fullScoreRange[0] && doseRatio >= rule.fullScoreRange[0] * 0.5) {
      E_dose = 1; // Under-dosed but present
    } else {
      E_dose = 0; // Way off
    }
  } else {
    // Missing dose info: Neutral score but will be weighted down by coverage
    E_dose = 1.5;
  }

  // 3) Form / bioavailability (0–2)
  let E_form = 0;
  if (meta.formBioRating === "high") E_form = 2;
  else if (meta.formBioRating === "medium") E_form = 1;
  else E_form = 0;

  // 4) Formula focus (0–1)
  let E_focus = 0;
  if (typeof meta.coreActiveRatio === "number" && meta.coreActiveRatio >= 0.7) E_focus = 1;

  const E = clamp(E_evidence + E_dose + E_form + E_focus, 0, 10);
  return E;
};

// Safety & Risk (S: 0–10)
const scoreSafety = (meta: SupplementMeta): number => {
  // 1) Dose vs UL (0–4)
  let S_dose = 3;
  if (typeof meta.ulRatio === "number") {
    const r = meta.ulRatio;
    if (r <= 0.5) S_dose = 4;
    else if (r <= 0.8) S_dose = 3;
    else if (r <= 1.0) S_dose = 2;
    else if (r <= 1.2) S_dose = 1;
    else S_dose = 0;
  }

  // 2) Interactions (0–3)
  let S_interactions = 2;
  switch (meta.interactionLevel) {
    case "low": S_interactions = 3; break;
    case "moderate": S_interactions = 2; break;
    case "high": S_interactions = 1; break;
    case "unknown": default: S_interactions = 2; break;
  }

  // 3) Allergens / stimulants (0–2)
  let S_allergens = 2;
  if (meta.hasCommonAllergens || meta.hasStrongStimulants) S_allergens = 1;

  // 4) Quality / testing (0–1)
  const S_quality = meta.thirdPartyTested ? 1 : 0;

  const S = clamp(S_dose + S_interactions + S_allergens + S_quality, 0, 10);
  return S;
};

// Value & Practicality (V: 0–10)
const scoreValue = (meta: SupplementMeta): number => {
  // 1) Cost per month (0–4)
  let V_cost = 2;
  if (meta.price != null && meta.daysPerBottle && meta.daysPerBottle > 0) {
    const pricePerDay = meta.price / meta.daysPerBottle;
    const pricePerMonth = pricePerDay * 30;

    if (pricePerMonth <= 10) V_cost = 4;
    else if (pricePerMonth <= 20) V_cost = 3;
    else if (pricePerMonth <= 35) V_cost = 2;
    else if (pricePerMonth <= 50) V_cost = 1;
    else V_cost = 0;
  }

  // 2) Overlap (0–2)
  let V_overlap = 1;
  switch (meta.overlapLevel) {
    case "low": V_overlap = 2; break;
    case "medium": V_overlap = 1; break;
    case "high": V_overlap = 0; break;
    case "unknown": default: V_overlap = 1; break;
  }

  // 3) Convenience (0–2)
  let V_convenience = 1;
  if (meta.dosesPerDay != null) {
    if (meta.dosesPerDay <= 2) V_convenience = 2;
    else if (meta.dosesPerDay <= 3) V_convenience = 1;
    else V_convenience = 0;
  }
  if (meta.timingConstraints === "complex") V_convenience = Math.max(0, V_convenience - 1);

  // 4) Duration / Clarity (0–2)
  let V_duration = 1;
  if (meta.daysPerBottle != null) {
    if (meta.daysPerBottle >= 30) V_duration = 2;
    else if (meta.daysPerBottle >= 15) V_duration = 1;
    else V_duration = 0;
  }
  if (meta.labelClarity === "unclear") V_duration = Math.max(0, V_duration - 1);

  const V = clamp(V_cost + V_overlap + V_convenience + V_duration, 0, 10);
  return V;
};

export const computeScores = (meta: SupplementMeta): ScoreBreakdown => {
  const rawEffectiveness = scoreEffectiveness(meta);
  const rawSafety = scoreSafety(meta);
  const rawValue = scoreValue(meta);

  // Apply Coverage Logic
  // Default coverage to 0.5 if missing (conservative)
  const coverage = meta.dataCoverage ?? 0.5;

  // Formula: final = raw * (0.7 + 0.3 * coverage)
  // If coverage is 1.0, final = raw * 1.0
  // If coverage is 0.0, final = raw * 0.7 (penalized but not zeroed)
  const coverageFactor = 0.7 + (0.3 * coverage);

  // Apply coverage factor ONLY to Effectiveness (as per user feedback)
  const effectiveness = parseFloat((rawEffectiveness * coverageFactor).toFixed(1));

  // Safety and Value remain raw for now (or could have their own specific coverage logic later)
  const safety = parseFloat(rawSafety.toFixed(1));
  const value = parseFloat(rawValue.toFixed(1));

  const overall0to10 = 0.4 * effectiveness + 0.3 * safety + 0.3 * value;
  const overall = Math.round(clamp(overall0to10, 0, 10) * 10);

  let label: ScoreBreakdown["label"];
  if (overall >= 80) label = "strongly_recommended";
  else if (overall >= 60) label = "optional";
  else if (overall >= 40) label = "low_priority";
  else label = "not_recommended";

  return {
    effectiveness,
    safety,
    value,
    overall,
    label,
  };
};
