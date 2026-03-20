import type {
  ConfidenceBreakdown,
  DecisionReason,
  PersonalizationProfile,
  PreferenceVector,
  SavedProductEvaluation,
  StackAudit,
  StackAuditItem,
  SupportState,
} from "@/types/personalization";

import { buildGoalFitCard } from "./goalFitCardBuilder";

type BuildStackAuditInput = {
  profile: PersonalizationProfile;
  supportState: SupportState;
  preferenceVector: PreferenceVector;
  evaluations: {
    savedProductEvaluations?: Record<string, SavedProductEvaluation>;
    firstStackPlan?: {
      items: Array<{
        productId: string;
      }>;
    };
  };
};

const buildReason = (
  code: string,
  params?: DecisionReason["params"],
): DecisionReason => ({
  code,
  ruleId: "personalization.stack_audit.v1",
  source: "derived",
  ...(params ? { params } : {}),
});

const toOverlapRisk = (
  profile: PersonalizationProfile,
  evaluations: SavedProductEvaluation[],
): ConfidenceBreakdown["overlapRisk"] => {
  if (profile.observed.duplicateRisk.level === "high") return "high";
  if (
    profile.observed.duplicateRisk.level === "medium" ||
    evaluations.some((evaluation) =>
      (evaluation.eligibility?.reasons ?? []).some((reason) => reason.code === "duplicate_overlap_high"),
    )
  ) {
    return "watch";
  }
  return "none";
};

const buildAuditItem = (
  evaluation: SavedProductEvaluation,
  status: StackAuditItem["status"],
): StackAuditItem => {
  const goalFitCard = buildGoalFitCard({
    evaluation,
  });

  return {
    productId: evaluation.productId,
    title: evaluation.display?.title,
    status,
    ...(goalFitCard?.goalKey ? { goalKey: goalFitCard.goalKey } : {}),
    ...(goalFitCard ? { confidence: goalFitCard.confidence } : {}),
    reasons:
      status === "kept"
        ? goalFitCard?.whyFit?.length
          ? goalFitCard.whyFit
          : evaluation.reasons.slice(0, 2)
        : [
            ...(evaluation.coverage.reasons ?? []),
            ...(evaluation.eligibility?.reasons ?? []),
            ...(goalFitCard?.holdbacks ?? []),
          ].slice(0, 3),
  };
};

export const buildStackAudit = (input: BuildStackAuditInput): StackAudit => {
  const evaluations = Object.values(input.evaluations.savedProductEvaluations ?? {});
  const firstStackIds = new Set(
    (input.evaluations.firstStackPlan?.items ?? []).map((item) => item.productId),
  );
  const overlapRisk = toOverlapRisk(input.profile, evaluations);

  const keptSeed = evaluations.filter(
    (evaluation) =>
      firstStackIds.has(evaluation.productId) ||
      (evaluation.coverage.status === "coverage_ready" &&
        (evaluation.eligibility?.rankEligible ?? true) &&
        evaluation.smartFilterMembership.bucket !== "no_match"),
  );

  const kept = keptSeed.slice(0, 3).map((evaluation) => buildAuditItem(evaluation, "kept"));

  const heldBackSeed = evaluations.filter(
    (evaluation) =>
      evaluation.coverage.status !== "coverage_ready" ||
      evaluation.eligibility?.rankEligible === false,
  );

  const heldBack = heldBackSeed
    .filter((evaluation) => !kept.some((item) => item.productId === evaluation.productId))
    .slice(0, 3)
    .map((evaluation) => buildAuditItem(evaluation, "held_back"));

  const headline =
    heldBack.length > 0
      ? `We kept ${kept.length} product${kept.length === 1 ? "" : "s"} forward and held back ${heldBack.length} until the label or safety signal is clearer.`
      : kept.length > 0
        ? `Your current stack stays conservative while it supports ${input.supportState}.`
        : "We are still assembling a conservative stack view from your saved products.";

  const summary =
    overlapRisk === "high"
      ? "We are watching overlap closely before pushing more products forward."
      : input.preferenceVector.decisionMode === "better_disclosure"
        ? "This view is currently biased toward products with stronger label completeness."
        : input.preferenceVector.decisionMode === "low_overlap"
          ? "This view is currently biased toward lower overlap with your existing stack."
          : "This stack audit explains what stayed forward, what got held back, and why.";

  return {
    supportState: input.supportState,
    overlapRisk,
    headline,
    summary,
    kept,
    heldBack,
    reasons: [
      buildReason("stack_audit_compiled", {
        keptCount: kept.length,
        heldBackCount: heldBack.length,
        overlapRisk,
        supportState: input.supportState,
      }),
    ],
  };
};
