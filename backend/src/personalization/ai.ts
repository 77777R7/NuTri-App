import explanationTemplatesData from "../../../data/personalization/explanation_templates.v1.json" with { type: "json" };
import * as goalMatchOntologyModule from "../../../lib/personalization/core/goalMatchOntology";
import type {
  DecisionReason,
  ExplanationFact,
  ExplanationPayload,
  ExplanationResult,
  ExplanationSurface,
  FirstStackPlan,
  GoalFitCard,
  GoalKey,
  PersonalizationSnapshot,
  SupplementTypeKey,
} from "../../../types/personalization.js";

type ExplanationTemplateFile = {
  version: string;
  templates: {
    code: string;
    template: string;
    placeholders: string[];
  }[];
};

type ExplanationTemplate = ExplanationTemplateFile["templates"][number];
type GoalIngredientPreviewLaneFromOntology = {
  goalKey: GoalKey;
  goalLabel: string;
  ingredientKeys: string[];
};
type GoalIngredientLane = {
  goalLabel: string;
  ingredients: string[];
};

const EXPLANATION_TEMPLATE_FILE = explanationTemplatesData as ExplanationTemplateFile;

const resolveBuildGoalIngredientPreviewLanes = (): ((
  goals: readonly GoalKey[],
) => GoalIngredientPreviewLaneFromOntology[]) => {
  const candidateModule = goalMatchOntologyModule as typeof goalMatchOntologyModule & {
    default?: {
      buildGoalIngredientPreviewLanes?: (
        goals: readonly GoalKey[],
      ) => GoalIngredientPreviewLaneFromOntology[];
    };
  };

  return (
    candidateModule.buildGoalIngredientPreviewLanes ??
    candidateModule.default?.buildGoalIngredientPreviewLanes ??
    (() => [])
  );
};

const buildGoalIngredientPreviewLanesFromOntology = resolveBuildGoalIngredientPreviewLanes();

const TEMPLATE_ALIASES: Record<string, string> = {
  duplicate_overlap_high: "duplicate_overlap_downgrade",
  generic_safety_path: "ingredient_requires_generic_safety_path",
};

const TEMPLATES_BY_CODE = new Map<string, ExplanationTemplate>(
  EXPLANATION_TEMPLATE_FILE.templates.map((template) => [template.code, template]),
);
const INGREDIENT_LABEL_OVERRIDES: Record<string, string> = {
  ashwagandha: "Ashwagandha",
  bacopa: "Bacopa",
  beta_glucan: "Beta-glucan",
  caffeine: "Caffeine",
  citicoline: "Citicoline",
  coenzyme_q10: "CoQ10",
  collagen_peptides: "Collagen peptides",
  creatine: "Creatine",
  elderberry: "Elderberry",
  fiber: "Fiber",
  glycine: "Glycine",
  green_tea_extract: "Green tea extract",
  iron: "Iron",
  l_theanine: "L-theanine",
  l_tyrosine: "L-tyrosine",
  lemon_balm_extract: "Lemon balm",
  maca: "Maca",
  magnesium: "Magnesium",
  melatonin: "Melatonin",
  omega_3: "Omega-3",
  protein: "Protein",
  quercetin: "Quercetin",
  rhodiola_rosea: "Rhodiola",
  tart_cherry: "Tart cherry",
  valerian_root_extract: "Valerian root",
  vitamin_b12: "Vitamin B12",
  vitamin_c: "Vitamin C",
  vitamin_d: "Vitamin D",
  zinc: "Zinc",
};

const titleCase = (value: string): string =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const humanizeGoal = (goal: GoalKey): string => {
  switch (goal) {
    case "libido_enhancement":
      return "Libido Enhancement";
    case "stress_support":
      return "Stress Support";
    case "weight_management":
      return "Weight Management";
    default:
      return titleCase(goal);
  }
};

const humanizeType = (type: SupplementTypeKey): string => titleCase(type);
const humanizeIngredient = (ingredientKey: string): string =>
  INGREDIENT_LABEL_OVERRIDES[ingredientKey] ?? titleCase(ingredientKey);

const humanizeScheduleTemplate = (templateKey: string): string => {
  if (templateKey.includes("advanced")) return "advanced";
  if (templateKey.includes("guided")) return "guided";
  return "simple";
};

const looksOpaqueProductId = (value: string): boolean =>
  /^[0-9a-f]{8,}$/i.test(value.replace(/-/g, "")) || /^prod[_-]/i.test(value) || /^sku[_-]/i.test(value);

const humanizeProductId = (productId: string): string => {
  const trimmed = productId.trim();
  if (!trimmed || looksOpaqueProductId(trimmed)) {
    return "Recommended product";
  }

  return titleCase(
    trimmed
      .replace(/^foundation[_-]/i, "")
      .replace(/^goal[_-]support[_-]/i, "")
      .replace(/^optional[_-]/i, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
};

const getItemDisplayLabel = (item: FirstStackPlan["items"][number]): string =>
  item.display?.title?.trim() || humanizeProductId(item.productId);

const extractSupportedGoalsFromReasons = (reasons: readonly DecisionReason[]): string[] => {
  const rawValue = reasons.find((reason) => typeof reason.params?.supportedGoals === "string")?.params?.supportedGoals;
  if (typeof rawValue !== "string" || !rawValue.trim()) return [];

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((goal) => humanizeGoal(goal as GoalKey));
};

const stableFactKey = (fact: ExplanationFact) =>
  JSON.stringify([fact.code, fact.params ? Object.entries(fact.params).sort() : []]);

const stableReasonKey = (reason: DecisionReason) =>
  JSON.stringify([
    reason.code,
    reason.ruleId,
    reason.source,
    reason.params ? Object.entries(reason.params).sort() : [],
  ]);

const dedupeDecisionReasons = (reasons: readonly DecisionReason[]): DecisionReason[] => {
  const seen = new Set<string>();
  const deduped: DecisionReason[] = [];

  reasons.forEach((reason) => {
    const key = stableReasonKey(reason);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({
      code: reason.code,
      ruleId: reason.ruleId,
      source: reason.source,
      ...(reason.params ? { params: { ...reason.params } } : {}),
    });
  });

  return deduped;
};

const dedupeFacts = (facts: readonly ExplanationFact[]): ExplanationFact[] => {
  const seen = new Set<string>();
  const deduped: ExplanationFact[] = [];

  facts.forEach((fact) => {
    const normalized: ExplanationFact = {
      factId: fact.factId,
      code: fact.code,
      ...(fact.params ? { params: Object.fromEntries(Object.entries(fact.params).sort()) } : {}),
    };
    const key = stableFactKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(normalized);
  });

  return deduped;
};

const reasonToFact = (reason: DecisionReason, factId: string): ExplanationFact => ({
  factId,
  code: TEMPLATE_ALIASES[reason.code] ?? reason.code,
  ...(reason.params ? { params: { ...reason.params } } : {}),
});

const buildSurfaceFactsFromReasons = (
  reasons: readonly DecisionReason[],
  surface: ExplanationSurface,
): ExplanationFact[] =>
  dedupeDecisionReasons(reasons).map((reason, index) =>
    reasonToFact(reason, `${surface}_reason_${index + 1}`),
  );

const buildPlanPreviewDerivedFacts = (snapshot: PersonalizationSnapshot): ExplanationFact[] => {
  const facts: ExplanationFact[] = [];
  const blocker = snapshot.profile.declared.adherenceBlocker;
  const diets = snapshot.profile.declared.diets ?? [];
  const activityGoals = snapshot.strategies.activityPlan.suggestedGoals;
  const ingredientLanes = buildGoalIngredientLanes(snapshot.surfaces.planPreview.goals);

  if (blocker === "busy_day_forgetfulness") {
    facts.push({ factId: "plan_preview_busy_day", code: "busy_day_blocker_mealtime_anchor" });
  }

  if (blocker === "routine_changes_day_to_day") {
    facts.push({ factId: "plan_preview_routine_changes", code: "routine_changes_schedule_guided" });
  }

  if (blocker === "goal_fit_uncertainty") {
    facts.push({
      factId: "plan_preview_goal_fit_uncertainty",
      code: "goal_fit_uncertainty_explanation_first",
    });
  }

  if (diets.includes("vegan") && snapshot.strategies.dietLanes.some((lane) => lane.laneKey === "diet_vegan_support")) {
    facts.push({ factId: "plan_preview_vegan_lane", code: "vegan_lane_b12_review" });
  }

  if (activityGoals.includes("recovery")) {
    facts.push({ factId: "plan_preview_activity_recovery", code: "activity_recovery_direction" });
  }

  ingredientLanes.forEach((lane, index) => {
    facts.push({
      factId: `plan_preview_goal_ingredients_${index + 1}`,
      code: "plan_preview_goal_ingredient_lane",
      params: {
        goalLabel: lane.goalLabel,
        ingredientLabels: lane.ingredients.join(", "),
      },
    });
  });

  return facts;
};

const buildFirstStackDerivedFacts = (plan: FirstStackPlan): ExplanationFact[] => {
  const roleCounts = plan.items.reduce<Record<string, number>>((counts, item) => {
    counts[item.role] = (counts[item.role] ?? 0) + 1;
    return counts;
  }, {});

  const facts: ExplanationFact[] = [
    {
      factId: "first_stack_schedule_template",
      code: "first_stack_schedule_template",
      params: {
        scheduleTemplate: humanizeScheduleTemplate(plan.scheduleTemplateKey),
      },
    },
    {
      factId: "first_stack_item_mix",
      code: "first_stack_item_mix",
      params: {
        foundationCount: roleCounts.foundation ?? 0,
        goalSupportCount: roleCounts.goal_support ?? 0,
        optionalCount: roleCounts.optional ?? 0,
      },
    },
    ...plan.items.slice(0, 3).map((item, index) => ({
      factId: `first_stack_item_${index + 1}`,
      code: "first_stack_item_highlight",
      params: {
        productLabel: getItemDisplayLabel(item),
        roleLabel: getRoleLabel(item.role),
        supportedGoals: extractSupportedGoalsFromReasons(item.reasons).join(", "),
      },
    })),
  ];

  return facts;
};

const buildGoalFitDerivedFacts = (
  snapshot: PersonalizationSnapshot,
  surface: Extract<ExplanationSurface, "goal_fit_detail" | "product_compare">,
): ExplanationFact[] => {
  const goalFitCards: Record<string, GoalFitCard> = snapshot.evaluations.goalFitCards ?? {};
  const cards = Object.values(goalFitCards).slice(
    0,
    surface === "product_compare" ? 2 : 1,
  );

  if (cards.length === 0) {
    return [];
  }

  const facts: ExplanationFact[] = [
    {
      factId: `${surface}_overview`,
      code: surface === "product_compare" ? "product_compare_ready" : "goal_fit_detail_primary",
      params:
        surface === "product_compare"
          ? {
              candidateCount: cards.length,
            }
          : {
              goalLabel: humanizeGoal(
                cards[0]?.goalKey ?? snapshot.surfaces.planPreview.goals[0] ?? "sleep",
              ),
              fitTier: titleCase(cards[0]?.tier?.replace(/_/g, " ") ?? "related"),
              evidenceLevel: titleCase(cards[0]?.confidence.evidence ?? "medium"),
            },
    },
  ];

  cards.forEach((card, index) => {
    [...card.whyFit, ...card.whyNotStronger, ...card.holdbacks, ...(card.stackContext ?? [])].forEach(
      (reason, reasonIndex) => {
        facts.push(
          reasonToFact(
            reason,
            `${surface}_card_${index + 1}_reason_${reasonIndex + 1}`,
          ),
        );
      },
    );
  });

  return facts;
};

const buildWeeklyInsightDerivedFacts = (snapshot: PersonalizationSnapshot): ExplanationFact[] => {
  const stackAudit = snapshot.premiumInsights?.stackAudit;

  return dedupeFacts([
    {
      factId: "weekly_insight_support_state",
      code: "weekly_insight_support_state",
      params: {
        supportState: titleCase(snapshot.strategies.supportState),
        decisionMode: titleCase(snapshot.strategies.preferenceVector.decisionMode.replace(/_/g, " ")),
      },
    },
    ...(stackAudit?.heldBack.length
      ? [
          {
            factId: "weekly_insight_held_back",
            code: "weekly_insight_held_back",
            params: {
              heldBackCount: stackAudit.heldBack.length,
            },
          } satisfies ExplanationFact,
        ]
      : []),
  ]);
};

const getRoleLabel = (role: FirstStackPlan["items"][number]["role"]): string => {
  switch (role) {
    case "foundation":
      return "foundation support";
    case "goal_support":
      return "goal support";
    case "optional":
    default:
      return "optional add-on";
  }
};

export const buildExplanationPayload = (
  snapshot: PersonalizationSnapshot,
  surface: ExplanationSurface,
): ExplanationPayload => {
  const selectedGoals = [...snapshot.surfaces.planPreview.goals];
  const selectedTypes = [...snapshot.surfaces.planPreview.types];

  if (surface === "plan_preview") {
    const facts = dedupeFacts([
      ...buildSurfaceFactsFromReasons(snapshot.surfaces.planPreview.reasons, surface),
      ...buildPlanPreviewDerivedFacts(snapshot),
    ]);

    return {
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      surface,
      selectedGoals,
      selectedTypes,
      facts,
    };
  }

  if (surface === "goal_fit_detail" || surface === "product_compare") {
    return {
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      surface,
      selectedGoals,
      selectedTypes,
      facts: dedupeFacts(buildGoalFitDerivedFacts(snapshot, surface)),
    };
  }

  if (surface === "weekly_insight") {
    return {
      snapshotId: snapshot.snapshotId,
      rulesVersion: snapshot.rulesVersion,
      surface,
      selectedGoals,
      selectedTypes,
      facts: dedupeFacts([
        ...buildSurfaceFactsFromReasons(snapshot.premiumInsights?.stackAudit?.reasons ?? [], surface),
        ...buildWeeklyInsightDerivedFacts(snapshot),
      ]),
    };
  }

  const firstStackPlan = snapshot.evaluations.firstStackPlan;
  const facts = dedupeFacts([
    ...buildSurfaceFactsFromReasons(firstStackPlan?.explanationFacts ?? [], surface),
    ...buildSurfaceFactsFromReasons(firstStackPlan?.items.flatMap((item) => item.reasons) ?? [], surface),
    ...(firstStackPlan ? buildFirstStackDerivedFacts(firstStackPlan) : []),
  ]);

  return {
    snapshotId: snapshot.snapshotId,
    rulesVersion: snapshot.rulesVersion,
    surface,
    selectedGoals,
    selectedTypes,
    facts,
    ...(firstStackPlan ? { firstStackPlan } : {}),
  };
};

const renderTemplate = (fact: ExplanationFact): string | null => {
  if (fact.code === "first_stack_schedule_template") {
    const label = typeof fact.params?.scheduleTemplate === "string" ? fact.params.scheduleTemplate : "simple";
    return `We'll start with a ${label} schedule template so your first stack stays manageable.`;
  }

  if (fact.code === "first_stack_item_mix") {
    const foundationCount = Number(fact.params?.foundationCount ?? 0);
    const goalSupportCount = Number(fact.params?.goalSupportCount ?? 0);
    const optionalCount = Number(fact.params?.optionalCount ?? 0);
    return `This first stack balances ${foundationCount} foundation, ${goalSupportCount} goal-support, and ${optionalCount} optional items.`;
  }

  if (fact.code === "first_stack_item_highlight") {
    const productLabel = typeof fact.params?.productLabel === "string" ? fact.params.productLabel : "Recommended product";
    const roleLabel = typeof fact.params?.roleLabel === "string" ? fact.params.roleLabel : "goal support";
    const supportedGoals = typeof fact.params?.supportedGoals === "string" ? fact.params.supportedGoals.trim() : "";

    if (supportedGoals) {
      return `${productLabel} is included as ${roleLabel} for ${supportedGoals}.`;
    }

    return `${productLabel} is included as ${roleLabel}.`;
  }

  if (fact.code === "goal_fit_uncertainty_explanation_first") {
    return "We will start by explaining why a supplement fits your goals before we push reminder setup or routine complexity.";
  }

  if (fact.code === "plan_preview_goal_ingredient_lane") {
    const goalLabel = typeof fact.params?.goalLabel === "string" ? fact.params.goalLabel : "your goal";
    const ingredientLabels =
      typeof fact.params?.ingredientLabels === "string" ? fact.params.ingredientLabels.trim() : "";

    if (ingredientLabels) {
      return `For ${goalLabel}, we'll first review ingredients like ${ingredientLabels}.`;
    }

    return `For ${goalLabel}, we'll first review the ingredient lanes most often used for that goal.`;
  }

  if (fact.code === "goal_fit_detail_primary") {
    const goalLabel = typeof fact.params?.goalLabel === "string" ? fact.params.goalLabel : "your goal";
    const fitTier = typeof fact.params?.fitTier === "string" ? fact.params.fitTier : "Related";
    const evidenceLevel =
      typeof fact.params?.evidenceLevel === "string" ? fact.params.evidenceLevel : "Medium";
    return `For ${goalLabel}, the current lead fit sits at ${fitTier} with ${evidenceLevel} evidence confidence.`;
  }

  if (fact.code === "product_compare_ready") {
    const candidateCount = Number(fact.params?.candidateCount ?? 0);
    return `We can compare ${candidateCount} coverage-ready products on fit, evidence, disclosure, overlap, and routine ease.`;
  }

  if (fact.code === "weekly_insight_support_state") {
    const supportState =
      typeof fact.params?.supportState === "string" ? fact.params.supportState : "Explore";
    const decisionMode =
      typeof fact.params?.decisionMode === "string" ? fact.params.decisionMode : "Best Fit";
    return `You're currently in ${supportState} mode, with personalization steering toward ${decisionMode}.`;
  }

  if (fact.code === "weekly_insight_held_back") {
    const heldBackCount = Number(fact.params?.heldBackCount ?? 0);
    return `${heldBackCount} saved product${heldBackCount === 1 ? "" : "s"} stayed behind the main stack because the confidence or safety signal is still conservative.`;
  }

  const template = TEMPLATES_BY_CODE.get(fact.code);
  if (!template) return null;

  return template.template.replace(/\{(\w+)\}/g, (_match, placeholder: string) => {
    const raw = fact.params?.[placeholder];
    return raw == null ? "" : String(raw);
  });
};

const buildPlanPreviewSummary = (payload: ExplanationPayload): string => {
  const ingredientLanes = buildGoalIngredientLanes(payload.selectedGoals);
  const hasGoalFitUncertaintyFact = payload.facts.some(
    (fact) => fact.code === "goal_fit_uncertainty_explanation_first",
  );
  if (ingredientLanes.length > 0) {
    const goalLabels = ingredientLanes.map((lane) => lane.goalLabel);
    const ingredientLabels = Array.from(
      new Set(ingredientLanes.flatMap((lane) => lane.ingredients)),
    ).slice(0, goalLabels.length > 3 ? 6 : goalLabels.length > 1 ? 4 : 3);

    if (goalLabels.length === 1) {
      if (hasGoalFitUncertaintyFact) {
        return `We'll start by reviewing ingredients commonly used for ${goalLabels[0]} and clarifying why they fit that goal, starting with ${formatList(ingredientLabels)}.`;
      }
      return `We'll start by surfacing ingredients commonly reviewed for ${goalLabels[0]}, starting with ${formatList(ingredientLabels)}.`;
    }

    if (goalLabels.length > 3) {
      if (hasGoalFitUncertaintyFact) {
        return `We'll start by surfacing ingredient directions for ${formatList(goalLabels)} support, clarifying how each lane fits, and starting with ${formatList(ingredientLabels)} and related ingredients for each goal.`;
      }
      return `We'll start by surfacing ingredient directions for ${formatList(goalLabels)} support, starting with ${formatList(ingredientLabels)} and related ingredients for each goal.`;
    }

    if (hasGoalFitUncertaintyFact) {
      return `We'll start by surfacing ingredient directions for ${formatList(goalLabels)} support and clarifying why each lane fits, starting with ${formatList(ingredientLabels)}.`;
    }

    return `We'll start by surfacing ingredient directions for ${formatList(goalLabels)} support, starting with ${formatList(ingredientLabels)}.`;
  }

  const goalText =
    payload.selectedGoals.length > 0
      ? payload.selectedGoals.map(humanizeGoal).join(", ")
      : "your selected goals";
  const typeText =
    payload.selectedTypes.length > 0
      ? payload.selectedTypes.map(humanizeType).join(", ")
      : "the supplement types you picked";

  return `We'll start your first plan around ${goalText} and pre-focus Smart Filter on ${typeText}.`;
};

const buildFirstStackSummary = (payload: ExplanationPayload): string => {
  const itemCount = payload.firstStackPlan?.items.length ?? 0;
  if (itemCount === 0) {
    return "We'll keep your first stack simple until we have stronger product-fit facts to explain.";
  }

  const scheduleStyle = payload.firstStackPlan
    ? humanizeScheduleTemplate(payload.firstStackPlan.scheduleTemplateKey)
    : "simple";

  const leadProducts = payload.firstStackPlan?.items
    .slice(0, 2)
    .map((item: FirstStackPlan["items"][number]) => humanizeProductId(item.productId))
    .filter((label: string) => label !== "Recommended product") ?? [];

  if (leadProducts.length > 0) {
    return `We'll start with ${leadProducts.join(" and ")} in a ${scheduleStyle} schedule so the plan stays realistic.`;
  }

  return `We'll start with ${itemCount} stack item${itemCount === 1 ? "" : "s"} and a ${scheduleStyle} schedule so the plan stays realistic.`;
};

const buildGoalFitSummary = (payload: ExplanationPayload): string =>
  `We explain goal fit using deterministic match reasons, confidence signals, and stack context from structured product facts.`;

const buildProductCompareSummary = (payload: ExplanationPayload): string =>
  `We compare products with deterministic fit, evidence, disclosure, overlap, and routine signals instead of AI ranking.`;

const buildWeeklyInsightSummary = (payload: ExplanationPayload): string =>
  `This week's insight focuses on what stayed forward in your stack and what the system is still treating conservatively.`;

const buildPlanPreviewBullets = (payload: ExplanationPayload): string[] => {
  const ingredientLanes = buildGoalIngredientLanes(payload.selectedGoals);
  const ingredientBullets = ingredientLanes
    .map(
      (lane) =>
        `For ${lane.goalLabel}, we'll first look at ${formatList(lane.ingredients.slice(0, 3))}.`,
    );

  if (ingredientBullets.length > 0) {
    if (ingredientBullets.length <= 2) {
      const extraFactBullets = payload.facts
        .filter((fact) => fact.code !== "plan_preview_goal_ingredient_lane")
        .map(renderTemplate)
        .filter((value: string | null): value is string => Boolean(value))
        .slice(0, 2);

      return [...ingredientBullets, ...extraFactBullets];
    }

    return ingredientBullets;
  }

  const factBullets = payload.facts
    .filter((fact) => fact.code !== "plan_preview_goal_ingredient_lane")
    .map(renderTemplate)
    .filter((value: string | null): value is string => Boolean(value));

  if (factBullets.length > 0) {
    return factBullets;
  }

  if (payload.selectedTypes.length > 0) {
    return [
      `We'll pre-focus ${payload.selectedTypes.map(humanizeType).join(", ")} when Smart Filter opens.`,
    ];
  }

  if (payload.selectedGoals.length > 0) {
    return [`Your current goals are ${payload.selectedGoals.map(humanizeGoal).join(", ")}.`];
  }

  return ["We'll keep your first plan simple until more personalization signals are available."];
};

const buildFirstStackBullets = (payload: ExplanationPayload): string[] => {
  const bullets = payload.facts
    .map(renderTemplate)
    .filter((value: string | null): value is string => Boolean(value))
    .slice(0, 4);

  if (payload.firstStackPlan && bullets.length < 4) {
    const roleCounts = payload.firstStackPlan.items.reduce<Record<string, number>>((counts, item) => {
      counts[item.role] = (counts[item.role] ?? 0) + 1;
      return counts;
    }, {});
    bullets.unshift(
      `The first stack covers ${roleCounts.foundation ?? 0} foundation item(s) and ${roleCounts.goal_support ?? 0} goal-support item(s).`,
    );
  }

  return bullets.slice(0, 4);
};

const buildGenericBullets = (payload: ExplanationPayload, fallback: string): string[] => {
  const bullets = payload.facts
    .map(renderTemplate)
    .filter((value: string | null): value is string => Boolean(value))
    .slice(0, 4);

  return bullets.length > 0 ? bullets : [fallback];
};

export const renderDeterministicExplanation = (
  payload: ExplanationPayload,
): ExplanationResult => {
  const summary =
    payload.surface === "plan_preview"
      ? buildPlanPreviewSummary(payload)
      : payload.surface === "first_stack"
        ? buildFirstStackSummary(payload)
        : payload.surface === "goal_fit_detail"
          ? buildGoalFitSummary(payload)
          : payload.surface === "product_compare"
            ? buildProductCompareSummary(payload)
            : buildWeeklyInsightSummary(payload);
  const bullets =
    payload.surface === "plan_preview"
      ? buildPlanPreviewBullets(payload)
      : payload.surface === "first_stack"
        ? buildFirstStackBullets(payload)
        : buildGenericBullets(
            payload,
            "We'll keep this explanation tied to structured facts until stronger product-level context is available.",
          );

  return {
    source: "deterministic",
    fallback: true,
    summary,
    bullets:
      bullets.length > 0
        ? bullets
        : ["We'll keep the first experience simple and explain more once stronger personalization facts are available."],
  };
};

export interface PersonalizationExplainer {
  explain(input: ExplanationPayload): Promise<ExplanationResult>;
}

export type PersonalizationExplanationService = {
  buildPayload(snapshot: PersonalizationSnapshot, surface: ExplanationSurface): ExplanationPayload;
  explainSnapshot(
    snapshot: PersonalizationSnapshot,
    surface: ExplanationSurface,
  ): Promise<{ payload: ExplanationPayload; result: ExplanationResult }>;
};

export const createPersonalizationExplanationService = (
  explainer: PersonalizationExplainer,
): PersonalizationExplanationService => ({
  buildPayload: buildExplanationPayload,
  async explainSnapshot(snapshot, surface) {
    const payload = buildExplanationPayload(snapshot, surface);
    const result =
      surface === "plan_preview"
        ? renderDeterministicExplanation(payload)
        : await explainer.explain(payload);
    return { payload, result };
  },
});

const buildGoalIngredientLanes = (goals: readonly GoalKey[]): GoalIngredientLane[] =>
  buildGoalIngredientPreviewLanesFromOntology(goals)
    .map((lane) => {
      const ingredients = lane.ingredientKeys
        .map((ingredientKey) => humanizeIngredient(ingredientKey))
        .filter(Boolean);

      return ingredients.length > 0
        ? {
            goalLabel: humanizeGoal(lane.goalKey),
            ingredients,
          }
        : null;
    })
    .filter((lane): lane is GoalIngredientLane => lane != null);

const formatList = (values: readonly string[]): string => {
  if (values.length === 0) return "the leading ingredient lanes";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

export const personalizationAiInternals = {
  buildSurfaceFactsFromReasons,
  buildPlanPreviewDerivedFacts,
  buildFirstStackDerivedFacts,
  buildGoalIngredientLanes,
  renderTemplate,
  dedupeFacts,
};
