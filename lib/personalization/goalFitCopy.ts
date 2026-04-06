import type { DecisionReason, GoalFitCard, GoalCompareEntry } from "../../types/personalization";

export type GoalNarrativeFitLevel = 'strong' | 'some' | 'limited' | 'none' | 'unknown';

// Legacy badge labels for older personalization surfaces. Scan narrative should use the
// calibrated helpers below instead of reading these tier labels directly.
export const GOAL_FIT_TIER_LABELS: Record<GoalFitCard["tier"], string> = {
  strong_match: "Strong fit",
  related: "Related",
  weak_match: "Weak fit",
  no_match: "Lower priority",
  not_enough_structured_data: "Not enough data",
};

export const GOAL_FIT_EVIDENCE_LABELS: Record<GoalCompareEntry["confidence"]["evidence"], string> = {
  high: "Strong",
  medium: "Moderate",
  low: "Limited",
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, " ").trim() ?? "";

const lowerFirst = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
};

const ensurePeriod = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const uniqueLines = (values: (string | null | undefined)[], limit = 3): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => ensurePeriod(value))
        .filter(Boolean),
    ),
  ).slice(0, limit);

export const GOAL_NARRATIVE_FORBIDDEN_COPY = [
  "Not fit your goal",
  "Not suitable for your",
  "Not a strong fit for your",
] as const;

export const GOAL_NARRATIVE_FORBIDDEN_REGEX =
  /Not fit your goal|Not suitable for your|Not a strong fit for your/i;

export const describeGoalNarrativeFitLevel = (fitLevel: GoalNarrativeFitLevel): string => {
  switch (fitLevel) {
    case "strong":
      return "strong support";
    case "some":
      return "some support";
    case "limited":
      return "limited support";
    case "unknown":
      return "not enough label detail";
    case "none":
    default:
      return "no clear support from this label";
  }
};

export const buildGoalNarrativeSummary = (goalLabel: string, fitLevel: GoalNarrativeFitLevel): string => {
  const loweredGoal = lowerFirst(goalLabel);
  switch (fitLevel) {
    case "strong":
      return `The visible ingredients look strongly aligned with ${loweredGoal}.`;
    case "some":
      return `The label shows some support for ${loweredGoal}.`;
    case "limited":
      return `The label shows limited support for ${loweredGoal}.`;
    case "unknown":
      return `We need more label detail before we can judge ${loweredGoal} support.`;
    case "none":
    default:
      return `We do not see clear ${loweredGoal} support from this label.`;
  }
};

export const buildGoalNarrativeHeroCopy = (goalLabel: string, fitLevel: GoalNarrativeFitLevel) => {
  const normalizedGoal = normalizeText(goalLabel);

  switch (fitLevel) {
    case "strong":
      return {
        tone: "positive" as const,
        chip: `Strong fit for your ${normalizedGoal} goal`,
        summary: `Best aligned with your ${normalizedGoal} goal`,
      };
    case "some":
      return {
        tone: "neutral" as const,
        chip: `Could work for your ${normalizedGoal} goal`,
        summary: `This label shows some support for your ${normalizedGoal} goal`,
      };
    case "limited":
      return {
        tone: "neutral" as const,
        chip: `Limited support for your ${normalizedGoal} goal`,
        summary: `This label shows limited support for your ${normalizedGoal} goal.`,
      };
    case "none":
      return {
        tone: "neutral" as const,
        chip: `No clear support for your ${normalizedGoal} goal`,
        summary: `This label does not show clear ${normalizedGoal} support.`,
      };
    case "unknown":
    default:
      return {
        tone: "neutral" as const,
        chip: `Not enough label detail for your ${normalizedGoal} goal`,
        summary: `We need more label detail before we can judge ${normalizedGoal} support confidently.`,
      };
  }
};

const buildSupportTitle = (goalLabel?: string | null) => {
  const goal = lowerFirst(goalLabel);
  if (!goal) return "Supports your health goals";
  if (goal === "immunity") return "Supports your immunity health";
  return `Supports your ${goal} goal`;
};

export const buildGoalSupportFallbackTitle = (
  goalLabel: string,
  fitLevel: GoalNarrativeFitLevel,
): string => {
  const normalizedGoal = normalizeText(goalLabel);
  const loweredGoal = lowerFirst(normalizedGoal);

  switch (fitLevel) {
    case "strong":
      return buildSupportTitle(normalizedGoal);
    case "some":
    case "limited":
      return `Limited support for your ${loweredGoal} goal`;
    case "none":
      return `No clear support for your ${normalizedGoal} goal`;
    case "unknown":
    default:
      return `Not enough label detail for your ${normalizedGoal} goal`;
  }
};

export const buildGoalSupportFallbackBullets = (
  goalLabel: string,
  fitLevel: GoalNarrativeFitLevel,
): string[] => {
  const normalizedGoal = normalizeText(goalLabel);
  const loweredGoal = lowerFirst(normalizedGoal);

  switch (fitLevel) {
    case "strong":
      return uniqueLines([
        `This label looks strongly aligned with your ${loweredGoal} goal.`,
        `The visible ingredients look more supportive of ${loweredGoal} than other goals we checked.`,
      ]);
    case "some":
    case "limited":
      return uniqueLines([
        `This label shows limited support for ${loweredGoal}.`,
        `Other goals may be supported more clearly than ${normalizedGoal}.`,
      ]);
    case "none":
      return uniqueLines([
        `This label does not show clear ${loweredGoal} support.`,
        `Other goals may be supported more clearly than ${normalizedGoal}.`,
      ]);
    case "unknown":
    default:
      return uniqueLines([
        `We need more label detail before we can judge ${loweredGoal} support confidently.`,
        "This product may still be useful, but the current label does not show enough detail yet.",
      ]);
  }
};

export const mapLegacyFitDecisionToNarrativeFitLevel = (
  fitDecision: 'fits' | 'mixed' | 'does_not_fit' | 'unknown' | null | undefined,
): GoalNarrativeFitLevel => {
  switch (fitDecision) {
    case "fits":
      return "strong";
    case "mixed":
      return "some";
    case "does_not_fit":
      return "none";
    case "unknown":
    default:
      return "unknown";
  }
};

export const mapPreviewTierToNarrativeFitLevel = (
  tier: GoalFitCard["tier"] | "unknown" | null | undefined,
): GoalNarrativeFitLevel => {
  switch (tier) {
    case "strong_match":
      return "strong";
    case "related":
      return "some";
    case "weak_match":
      return "limited";
    case "no_match":
      return "none";
    case "not_enough_structured_data":
    case "unknown":
    default:
      return "unknown";
  }
};

export const formatGoalFitReason = (reason: DecisionReason) => {
  switch (reason.code) {
    case "goal_supported_by_ingredient":
      return "Supports this goal through ingredients we directly map to it.";
    case "dose_meets_effective_floor":
      return "At least one relevant ingredient clears our effective floor for this goal.";
    case "goal_specific_evidence_missing":
      return "Relevant for this goal, but the goal-specific evidence is still lighter than our strongest picks.";
    case "goal_specific_evidence_present":
      return "The current ingredient map gives this goal a usable evidence-backed signal.";
    case "dose_below_effective_floor":
      return "The disclosed dose looks lighter than what usually supports a stronger pick for this goal.";
    case "dose_not_disclosed":
      return "The label does not disclose enough dose detail for a stronger goal-specific review.";
    case "low_disclosure_caps_strong_match":
      return "The label leaves enough gaps that we keep this below our strongest tier.";
    case "proprietary_blend_caps_goal_match":
      return "A proprietary blend makes this harder to score as one of the strongest fits.";
    case "ingredient_form_preferred":
      return "The disclosed form is one of the forms we treat as more supportive for this goal.";
    case "multiple_supporting_ingredients":
      return "More than one visible ingredient supports this goal, which makes the signal more credible.";
    case "goal_support_not_enough_label_detail":
      return "We still need more label detail before we can judge this goal cleanly.";
    case "no_goal_support_detected":
      return "We are not seeing a clear goal-specific support signal on this label.";
    case "formula_pattern_immunity_vitamin_c_zinc":
      return "Vitamin C and zinc together reinforce an immunity-oriented pattern on this label.";
    case "formula_pattern_immunity_vitamin_c_d3":
      return "Vitamin C and vitamin D together reinforce an immunity-oriented pattern on this label.";
    case "formula_pattern_immunity_vitamin_c_zinc_d3":
      return "Vitamin C, zinc, and vitamin D together reinforce an immunity-focused pattern.";
    case "formula_pattern_sleep_magnesium_theanine":
      return "Magnesium and L-theanine together reinforce a sleep-support pattern.";
    case "formula_pattern_sleep_magnesium_glycine":
      return "Magnesium and glycine together reinforce a sleep-support pattern.";
    case "formula_pattern_sleep_melatonin_magnesium":
      return "Melatonin and magnesium together reinforce a sleep-support pattern.";
    case "formula_pattern_recovery_omega3_protein":
      return "Omega-3 and protein together reinforce a recovery-support pattern.";
    case "formula_pattern_recovery_omega3_tart_cherry":
      return "Omega-3 and tart cherry together reinforce a recovery-support pattern.";
    case "formula_pattern_recovery_creatine_protein":
      return "Creatine and protein together reinforce a recovery-support pattern.";
    case "formula_pattern_recovery_curcumin_omega3":
      return "Curcumin and omega-3 together reinforce a recovery-support pattern.";
    case "formula_pattern_stress_magnesium_theanine":
      return "Magnesium and L-theanine together reinforce a stress-support pattern.";
    case "formula_pattern_stress_ashwagandha_magnesium":
      return "Ashwagandha and magnesium together reinforce a stress-support pattern.";
    case "formula_pattern_focus_caffeine_theanine":
      return "Caffeine and L-theanine together reinforce a focus-support pattern.";
    case "formula_pattern_focus_citicoline_tyrosine":
      return "Citicoline and L-tyrosine together reinforce a focus-support pattern.";
    case "formula_pattern_energy_caffeine_tyrosine":
      return "Caffeine and L-tyrosine together reinforce an energy-support pattern.";
    case "formula_pattern_energy_b12_coq10":
      return "Vitamin B12 and CoQ10 together reinforce an energy-support pattern.";
    case "formula_pattern_weight_fiber_protein":
      return "Fiber and protein together reinforce a weight-management pattern.";
    case "duplicate_overlap_high":
      return "This may overlap with what is already in your current stack.";
    case "personalization.product_evaluation.coverage_ready":
      return "The current label is complete enough for a confident structured review.";
    case "ingredient_requires_generic_safety_path":
      return "We keep this on a more conservative safety path for now.";
    case "diet_constraint_conflict":
      return "This may conflict with one of your dietary constraints.";
    case "personalization.product_evaluation.not_enough_structured_data":
    case "goal_fit_waiting_for_more_structured_data":
      return "We need more structured ingredient and dose data before we can score this confidently.";
    case "goal_fit_summary_available":
      return "The current label shows a usable signal for this goal.";
    case "goal_fit_no_major_strength_caps":
      return "We are not seeing a standout strength signal that would move this above our stronger picks yet.";
    case "goal_fit_no_major_holdbacks":
      return "No major holdback stands out on the current label.";
    case "goal_fit_stack_context_easy_start":
      return "This looks easier to add without creating an obvious stack conflict.";
    case "goal_fit_stack_context_watchouts":
      return "This fit is usable, but your current stack still needs a more careful review.";
    default:
      return reason.code
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }
};

export const summarizeGoalFitReasons = (reasons: DecisionReason[], fallback: string) =>
  reasons.length > 0
    ? reasons
        .slice(0, 2)
        .map((reason) => formatGoalFitReason(reason))
        .join(" ")
    : fallback;

export const formatGoalFitConfidenceValue = (
  value: GoalCompareEntry["confidence"]["evidence"] |
    GoalCompareEntry["confidence"]["labelCompleteness"] |
    GoalCompareEntry["confidence"]["overlapRisk"] |
    GoalCompareEntry["confidence"]["routineFit"],
) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

export const formatGoalFitEvidenceValue = (
  value: GoalCompareEntry["confidence"]["evidence"],
) => GOAL_FIT_EVIDENCE_LABELS[value];
