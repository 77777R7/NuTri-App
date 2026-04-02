import type { DecisionReason, GoalFitCard, GoalCompareEntry } from "../../types/personalization";

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

export const formatGoalFitReason = (reason: DecisionReason) => {
  switch (reason.code) {
    case "goal_supported_by_ingredient":
      return "Supports this goal through ingredients we directly map to it.";
    case "dose_meets_effective_floor":
      return "At least one relevant ingredient clears our effective floor for this goal.";
    case "goal_specific_evidence_missing":
      return "Relevant for this goal, but the goal-specific evidence is still lighter than our strongest picks.";
    case "dose_below_effective_floor":
      return "The disclosed dose looks lighter than what usually supports a stronger pick for this goal.";
    case "low_disclosure_caps_strong_match":
      return "The label leaves enough gaps that we keep this below our strongest tier.";
    case "proprietary_blend_caps_goal_match":
      return "A proprietary blend makes this harder to score as one of the strongest fits.";
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
