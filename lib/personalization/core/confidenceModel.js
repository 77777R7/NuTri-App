"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConfidenceBreakdown = void 0;
const hasReasonCode = (reasons, code) => (reasons ?? []).some((reason) => reason.code === code);
const findGoalMatch = (evaluation, goalKey) => {
    if (!evaluation)
        return undefined;
    if (goalKey) {
        return evaluation.productGoalMatches.find((match) => match.goalKey === goalKey);
    }
    const highlightedGoal = evaluation.smartFilterMembership.highlightedGoal;
    return highlightedGoal
        ? evaluation.productGoalMatches.find((match) => match.goalKey === highlightedGoal)
        : evaluation.productGoalMatches[0];
};
const buildConfidenceBreakdown = (input) => {
    const evaluation = input.evaluation;
    const match = findGoalMatch(evaluation, input.goalKey);
    const matchReasons = match?.reasons ?? [];
    const eligibilityReasons = evaluation?.eligibility?.reasons ?? [];
    const coverageStatus = evaluation?.coverage.status;
    const factsStatus = evaluation?.factsStatus;
    const overlapCount = input.stackOverlapCount ?? 0;
    const lowDisclosure = hasReasonCode(matchReasons, "low_disclosure_caps_strong_match") ||
        hasReasonCode(eligibilityReasons, "low_disclosure_caps_strong_match");
    const proprietaryBlend = hasReasonCode(matchReasons, "proprietary_blend_caps_goal_match") ||
        hasReasonCode(eligibilityReasons, "proprietary_blend_caps_goal_match");
    const missingEvidence = hasReasonCode(matchReasons, "goal_specific_evidence_missing");
    const directGoalSupport = hasReasonCode(matchReasons, "goal_supported_by_ingredient");
    const doseFloorMet = hasReasonCode(matchReasons, "dose_meets_effective_floor");
    const duplicateRisk = hasReasonCode(eligibilityReasons, "duplicate_overlap_high") || overlapCount > 0;
    const genericSafety = hasReasonCode(eligibilityReasons, "ingredient_requires_generic_safety_path");
    const hasStructuredButUnauditedGoalSupport = missingEvidence &&
        !lowDisclosure &&
        !proprietaryBlend &&
        directGoalSupport &&
        doseFloorMet &&
        (match?.tier === "related" || match?.tier === "strong_match");
    const evidence = coverageStatus !== "coverage_ready" || !match || match.tier === "no_match"
        ? "low"
        : match.confidence?.evidence
            ? match.confidence.evidence
            : lowDisclosure || proprietaryBlend || missingEvidence
                ? match.tier === "strong_match"
                    ? "medium"
                    : hasStructuredButUnauditedGoalSupport
                        ? "medium"
                        : "low"
                : match.tier === "strong_match"
                    ? "high"
                    : match.tier === "related"
                        ? "medium"
                        : "low";
    const labelCompleteness = coverageStatus !== "coverage_ready"
        ? "weak"
        : match?.confidence?.disclosure === "full"
            ? "full"
            : match?.confidence?.disclosure === "partial"
                ? "partial"
                : factsStatus === "full" && !lowDisclosure && !proprietaryBlend
                    ? "full"
                    : factsStatus === "full" || factsStatus === "partial"
                        ? "partial"
                        : "weak";
    const overlapRisk = duplicateRisk
        ? overlapCount > 1 || hasReasonCode(eligibilityReasons, "duplicate_overlap_high")
            ? "high"
            : "watch"
        : "none";
    const routineFit = coverageStatus !== "coverage_ready" || genericSafety || evaluation?.eligibility?.rankEligible === false
        ? "complex"
        : overlapRisk === "high"
            ? "complex"
            : match?.tier === "strong_match" || match?.tier === "related"
                ? "easy"
                : "moderate";
    return {
        evidence,
        labelCompleteness,
        overlapRisk,
        routineFit,
    };
};
exports.buildConfidenceBreakdown = buildConfidenceBreakdown;
