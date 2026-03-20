import type { DecisionReason, GoalFitCard, GoalCompareEntry } from "@/types/personalization";

export const GOAL_FIT_TIER_LABELS: Record<GoalFitCard["tier"], string> = {
  strong_match: "Strong fit",
  related: "Related",
  weak_match: "Weak fit",
  no_match: "Not a fit",
  not_enough_structured_data: "Not enough data",
};

export const formatGoalFitReason = (reason: DecisionReason) => {
  switch (reason.code) {
    case "goal_supported_by_ingredient":
      return "Contains ingredients that map directly to this goal.";
    case "dose_meets_effective_floor":
      return "At least one relevant ingredient meets the effective dose floor.";
    case "goal_specific_evidence_missing":
      return "We matched this ingredient to the goal, but we have not attached a product-level evidence row yet, so we keep confidence below our strongest tier.";
    case "dose_below_effective_floor":
      return "The disclosed dose looks lower than our effective floor for this goal.";
    case "low_disclosure_caps_strong_match":
      return "Disclosure quality lowers our confidence in a stronger fit.";
    case "proprietary_blend_caps_goal_match":
      return "A proprietary blend keeps the fit from ranking higher.";
    case "duplicate_overlap_high":
      return "This may overlap with what is already in your saved stack.";
    case "personalization.product_evaluation.coverage_ready":
      return "The current label data is complete enough for deterministic goal-fit scoring.";
    case "ingredient_requires_generic_safety_path":
      return "We keep this on a more conservative safety path.";
    case "diet_constraint_conflict":
      return "This may conflict with one of your dietary constraints.";
    case "personalization.product_evaluation.not_enough_structured_data":
    case "goal_fit_waiting_for_more_structured_data":
      return "We need more structured ingredient and dose data before we can score this confidently.";
    case "goal_fit_summary_available":
      return "The product shows a usable goal fit signal in the current structured facts.";
    case "goal_fit_no_major_strength_caps":
      return "We do not see a major strength cap right now.";
    case "goal_fit_no_major_holdbacks":
      return "We do not see a major holdback right now.";
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
