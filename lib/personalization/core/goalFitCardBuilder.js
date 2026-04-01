"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGoalFitCard = void 0;
const confidenceModel_1 = require("./confidenceModel");
const POSITIVE_REASON_CODES = new Set([
    "goal_supported_by_ingredient",
    "dose_meets_effective_floor",
    "personalization.product_evaluation.coverage_ready",
]);
const NOT_STRONGER_REASON_CODES = new Set([
    "goal_specific_evidence_missing",
    "dose_below_effective_floor",
    "low_disclosure_caps_strong_match",
    "proprietary_blend_caps_goal_match",
]);
const HOLDBACK_REASON_CODES = new Set([
    "duplicate_overlap_high",
    "diet_constraint_conflict",
    "ingredient_requires_generic_safety_path",
    "personalization.product_evaluation.not_enough_structured_data",
]);
const STACK_CONTEXT_REASON_CODES = new Set([
    "duplicate_overlap_high",
    "ingredient_requires_generic_safety_path",
    "personalization.product_evaluation.coverage_ready",
]);
const dedupeReasons = (reasons) => {
    const seen = new Set();
    const deduped = [];
    for (const reason of reasons) {
        const key = `${reason.code}:${JSON.stringify(reason.params ?? {})}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(reason);
    }
    return deduped;
};
const fallbackReason = (code, source = "derived") => ({
    code,
    ruleId: "personalization.goal_fit_card.fallback",
    source,
});
const buildGoalFitCard = (input) => {
    const evaluation = input.evaluation;
    if (!evaluation)
        return null;
    const match = input.goalKey != null
        ? evaluation.productGoalMatches.find((entry) => entry.goalKey === input.goalKey)
        : evaluation.productGoalMatches.find((entry) => entry.goalKey === evaluation.smartFilterMembership.highlightedGoal) ?? evaluation.productGoalMatches[0];
    const whyFit = dedupeReasons((match?.reasons ?? []).filter((reason) => POSITIVE_REASON_CODES.has(reason.code)));
    const whyNotStronger = dedupeReasons([
        ...(match?.reasons ?? []),
        ...(evaluation.eligibility?.reasons ?? []),
    ].filter((reason) => NOT_STRONGER_REASON_CODES.has(reason.code)));
    const holdbacks = dedupeReasons([
        ...(evaluation.coverage.reasons ?? []),
        ...(evaluation.eligibility?.reasons ?? []),
    ].filter((reason) => HOLDBACK_REASON_CODES.has(reason.code)));
    const stackContext = dedupeReasons([
        ...(evaluation.coverage.reasons ?? []),
        ...(evaluation.eligibility?.reasons ?? []),
        ...(match?.reasons ?? []),
    ].filter((reason) => STACK_CONTEXT_REASON_CODES.has(reason.code)));
    return {
        productId: evaluation.productId,
        ...(input.goalKey ? { goalKey: input.goalKey } : match?.goalKey ? { goalKey: match.goalKey } : {}),
        tier: evaluation.coverage.status === "coverage_ready"
            ? match?.tier ?? evaluation.smartFilterMembership.bucket
            : "not_enough_structured_data",
        confidence: (0, confidenceModel_1.buildConfidenceBreakdown)({
            evaluation,
            goalKey: input.goalKey,
            stackOverlapCount: input.stackOverlapCount,
        }),
        whyFit: whyFit.length > 0
            ? whyFit
            : evaluation.coverage.status === "coverage_ready"
                ? [fallbackReason("goal_fit_summary_available")]
                : [fallbackReason("goal_fit_waiting_for_more_structured_data")],
        whyNotStronger: whyNotStronger.length > 0 ? whyNotStronger : [fallbackReason("goal_fit_no_major_strength_caps")],
        holdbacks: holdbacks.length > 0
            ? holdbacks
            : evaluation.coverage.status === "coverage_ready"
                ? [fallbackReason("goal_fit_no_major_holdbacks")]
                : [fallbackReason("goal_fit_waiting_for_more_structured_data")],
        stackContext: stackContext.length > 0
            ? stackContext
            : evaluation.coverage.status === "coverage_ready" &&
                evaluation.eligibility?.rankEligible !== false
                ? [fallbackReason("goal_fit_stack_context_easy_start")]
                : [fallbackReason("goal_fit_stack_context_watchouts")],
    };
};
exports.buildGoalFitCard = buildGoalFitCard;
