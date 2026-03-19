import explanationTemplatesData from "../../../data/personalization/explanation_templates.v1.json";
import type {
  BlockerKey,
  DecisionReason,
  ExplanationFact,
  ExplanationPayload,
  ExplanationResult,
  ExplanationSurface,
  FirstStackPlan,
  GoalKey,
  PersonalizationSnapshot,
  SupplementTypeKey,
} from "../../../types/personalization";

type ExplanationTemplateFile = {
  version: string;
  templates: Array<{
    code: string;
    template: string;
    placeholders: string[];
  }>;
};

type ExplanationTemplate = ExplanationTemplateFile["templates"][number];

const EXPLANATION_TEMPLATE_FILE = explanationTemplatesData as ExplanationTemplateFile;

const TEMPLATE_ALIASES: Record<string, string> = {
  duplicate_overlap_high: "duplicate_overlap_downgrade",
  generic_safety_path: "ingredient_requires_generic_safety_path",
};

const TEMPLATES_BY_CODE = new Map<string, ExplanationTemplate>(
  EXPLANATION_TEMPLATE_FILE.templates.map((template) => [template.code, template]),
);

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

const humanizeAnchor = (anchor: string): string =>
  anchor
    .split("_")
    .map((part) => {
      if (part.toLowerCase() === "workout") return "workout";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

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

  if (blocker === "busy_day_forgetfulness") {
    facts.push({ factId: "plan_preview_busy_day", code: "busy_day_blocker_mealtime_anchor" });
  }

  if (blocker === "routine_changes_day_to_day") {
    facts.push({ factId: "plan_preview_routine_changes", code: "routine_changes_schedule_guided" });
  }

  if (diets.includes("vegan") && snapshot.strategies.dietLanes.some((lane) => lane.laneKey === "diet_vegan_support")) {
    facts.push({ factId: "plan_preview_vegan_lane", code: "vegan_lane_b12_review" });
  }

  if (activityGoals.includes("recovery")) {
    facts.push({ factId: "plan_preview_activity_recovery", code: "activity_recovery_direction" });
  }

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

  const template = TEMPLATES_BY_CODE.get(fact.code);
  if (!template) return null;

  return template.template.replace(/\{(\w+)\}/g, (_match, placeholder: string) => {
    const raw = fact.params?.[placeholder];
    return raw == null ? "" : String(raw);
  });
};

const buildPlanPreviewSummary = (payload: ExplanationPayload): string => {
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
    .map((item) => humanizeProductId(item.productId))
    .filter((label) => label !== "Recommended product") ?? [];

  if (leadProducts.length > 0) {
    return `We'll start with ${leadProducts.join(" and ")} in a ${scheduleStyle} schedule so the plan stays realistic.`;
  }

  return `We'll start with ${itemCount} stack item${itemCount === 1 ? "" : "s"} and a ${scheduleStyle} schedule so the plan stays realistic.`;
};

const buildPlanPreviewBullets = (payload: ExplanationPayload): string[] => {
  const bullets = payload.facts
    .map(renderTemplate)
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

  if (payload.selectedGoals.length > 0) {
    bullets.unshift(`Your current goals are ${payload.selectedGoals.map(humanizeGoal).join(", ")}.`);
  }

  if (payload.selectedTypes.length > 0 && bullets.length < 4) {
    bullets.push(
      `We'll pre-select ${payload.selectedTypes.map(humanizeType).join(", ")} the first time you open Smart Filter.`,
    );
  }

  return bullets.slice(0, 4);
};

const buildFirstStackBullets = (payload: ExplanationPayload): string[] => {
  const bullets = payload.facts
    .map(renderTemplate)
    .filter((value): value is string => Boolean(value))
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

export const renderDeterministicExplanation = (
  payload: ExplanationPayload,
): ExplanationResult => {
  const summary =
    payload.surface === "plan_preview"
      ? buildPlanPreviewSummary(payload)
      : buildFirstStackSummary(payload);
  const bullets =
    payload.surface === "plan_preview"
      ? buildPlanPreviewBullets(payload)
      : buildFirstStackBullets(payload);

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
    const result = await explainer.explain(payload);
    return { payload, result };
  },
});

export const personalizationAiInternals = {
  buildSurfaceFactsFromReasons,
  buildPlanPreviewDerivedFacts,
  buildFirstStackDerivedFacts,
  renderTemplate,
  dedupeFacts,
};
