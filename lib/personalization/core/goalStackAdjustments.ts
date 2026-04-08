import type { DecisionReason, GoalKey } from '../../../types/personalization';
import { getGoalLabel } from './goalCatalog';
import { getFormulaPatterns, getIngredientGoalEdges } from './goalMatchOntology';
import { buildReason, buildReasonCode, buildRuleId } from './reasonCodes';

export type GoalStackCoverageState = 'strong' | 'some' | 'limited' | 'none' | 'unknown';
export type GoalStackContextImpact = 'positive' | 'neutral' | 'negative';
export type GoalStackMarginalValue = 'high' | 'medium' | 'low';

export type GoalStackAdjustmentInput = {
  goalKey: GoalKey;
  state: GoalStackCoverageState;
  score?: number | null;
};

export type GoalStackOverlapContextLike = {
  savedStackCount: number;
  overlapCount: number;
  overlaps: {
    ingredientKey?: string | null;
    ingredientDisplay?: string | null;
    count?: number | null;
  }[];
} | null | undefined;

export type GoalStackAdjustment = {
  goalKey: GoalKey;
  adjustedScore: number;
  stackContextImpact: GoalStackContextImpact;
  marginalValue: GoalStackMarginalValue;
  overlapIngredientKeys: string[];
  overlapIngredientDisplays: string[];
  reasonCodes: string[];
  reasons: DecisionReason[];
  summary?: string;
  action?: string[];
};

const STACK_CONTEXT_REASON_CODES = {
  overlapReducesMarginalValue: buildReasonCode('stack_goal_context', 'overlap_reduces_marginal_value'),
  lowOverlapAdditiveLane: buildReasonCode('stack_goal_context', 'low_overlap_additive_lane'),
} as const;

const STACK_CONTEXT_RULE_IDS = {
  overlapReducesMarginalValue: buildRuleId('stack_goal_context', 'overlap_reduces_marginal_value'),
  lowOverlapAdditiveLane: buildRuleId('stack_goal_context', 'low_overlap_additive_lane'),
} as const;

const canonicalizeFreeformToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const normalizeTextKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const STACK_INGREDIENT_ALIASES: Record<string, string> = {
  omega3: 'omega_3',
  fishoil: 'omega_3',
  fishoils: 'omega_3',
  epa: 'omega_3',
  dha: 'omega_3',
  vitaminc: 'vitamin_c',
  ascorbicacid: 'vitamin_c',
  vitaminb12: 'vitamin_b12',
  coq10: 'coenzyme_q10',
  coenzymeq10: 'coenzyme_q10',
  magnesiumglycinate: 'magnesium',
  magnesiumbisglycinate: 'magnesium',
  zincpicolinate: 'zinc',
  zinccitrate: 'zinc',
  zincgluconate: 'zinc',
};

const canonicalizeIngredientKey = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const freeform = canonicalizeFreeformToken(value);
  if (!freeform) return null;
  return STACK_INGREDIENT_ALIASES[freeform] ?? normalizeTextKey(value);
};

const normalizeUniqueStrings = (values: (string | null | undefined)[]): string[] =>
  values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, array) => array.indexOf(value) === index);

const lowerFirst = (value: string): string =>
  value.length > 0 ? value.charAt(0).toLowerCase() + value.slice(1) : value;

const joinLabels = (values: string[]): string => {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const goalHasPositiveSignal = (state: GoalStackCoverageState) => state === 'strong' || state === 'some';
const goalHasAnySignal = (state: GoalStackCoverageState) =>
  state === 'strong' || state === 'some' || state === 'limited';

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const getGoalRelevantIngredientKeys = (goalKey: GoalKey): Set<string> => {
  const keys = new Set<string>();
  for (const edge of getIngredientGoalEdges(goalKey)) {
    const normalized = canonicalizeIngredientKey(edge.ingredientKey);
    if (normalized) keys.add(normalized);
  }
  for (const pattern of getFormulaPatterns(goalKey)) {
    for (const ingredientKey of pattern.requiredIngredients) {
      const normalized = canonicalizeIngredientKey(ingredientKey);
      if (normalized) keys.add(normalized);
    }
    for (const ingredientKey of pattern.optionalIngredients ?? []) {
      const normalized = canonicalizeIngredientKey(ingredientKey);
      if (normalized) keys.add(normalized);
    }
  }
  return keys;
};

const getRelevantOverlapItems = (
  goalKey: GoalKey,
  overlapContext: GoalStackOverlapContextLike,
) => {
  const goalRelevantKeys = getGoalRelevantIngredientKeys(goalKey);
  return (overlapContext?.overlaps ?? []).filter((item) => {
    const candidates = [
      canonicalizeIngredientKey(item.ingredientKey),
      canonicalizeIngredientKey(item.ingredientDisplay),
    ].filter((value): value is string => Boolean(value));
    return candidates.some((candidate) => goalRelevantKeys.has(candidate));
  });
};

const buildNegativeStackSummary = (goalLabel: string, overlapDisplays: string[]) => {
  const overlapSummary = joinLabels(overlapDisplays);
  if (!overlapSummary) {
    return `Your saved stack already overlaps with this ${lowerFirst(goalLabel)} lane, so the added value looks lower.`;
  }
  return `Your saved stack already includes ${overlapSummary}, so the added ${lowerFirst(goalLabel)} value looks lower.`;
};

const buildNegativeStackAction = (goalLabel: string, overlapDisplays: string[]) => {
  const overlapSummary = joinLabels(overlapDisplays);
  if (!overlapSummary) {
    return [`Review overlap before adding another ${lowerFirst(goalLabel)}-oriented product.`];
  }
  return [`Review overlap with ${overlapSummary} before adding another ${lowerFirst(goalLabel)}-oriented product.`];
};

const buildPositiveStackSummary = (goalLabel: string) =>
  `This ${lowerFirst(goalLabel)} lane looks additive to your current stack without obvious ingredient overlap.`;

const buildPositiveStackAction = (goalLabel: string) =>
  [`Lower overlap can make this a cleaner add for ${lowerFirst(goalLabel)} support.`];

export const buildGoalStackAdjustments = (params: {
  goalCoverage: GoalStackAdjustmentInput[];
  overlapContext: GoalStackOverlapContextLike;
}): GoalStackAdjustment[] => {
  const savedStackCount = params.overlapContext?.savedStackCount ?? 0;

  return params.goalCoverage.map((entry) => {
    const baseScore = Math.max(0, Math.round(entry.score ?? 0));
    const goalLabel = getGoalLabel(entry.goalKey) ?? entry.goalKey;
    const relevantOverlapItems = getRelevantOverlapItems(entry.goalKey, params.overlapContext);
    const overlapIngredientKeys = normalizeUniqueStrings(relevantOverlapItems.map((item) => canonicalizeIngredientKey(item.ingredientKey)));
    const overlapIngredientDisplays = normalizeUniqueStrings(
      relevantOverlapItems.map((item) => item.ingredientDisplay ?? item.ingredientKey ?? null),
    );
    const overlapIntensity = relevantOverlapItems.reduce(
      (sum, item) => sum + Math.max(1, (item.count ?? 1) - 1),
      0,
    );

    if (savedStackCount <= 0) {
      return {
        goalKey: entry.goalKey,
        adjustedScore: clampScore(baseScore),
        stackContextImpact: 'neutral',
        marginalValue:
          goalHasPositiveSignal(entry.state)
            ? 'high'
            : entry.state === 'limited'
              ? 'medium'
              : 'low',
        overlapIngredientKeys,
        overlapIngredientDisplays,
        reasonCodes: [],
        reasons: [],
      };
    }

    if (relevantOverlapItems.length > 0) {
      const basePenalty = goalHasPositiveSignal(entry.state)
        ? 18
        : entry.state === 'limited'
          ? 12
          : 8;
      const overlapPenalty = Math.min(12, Math.max(0, overlapIntensity - 1) * 4);
      const adjustedScore = clampScore(baseScore - basePenalty - overlapPenalty);
      const reason = buildReason(
        STACK_CONTEXT_REASON_CODES.overlapReducesMarginalValue,
        STACK_CONTEXT_RULE_IDS.overlapReducesMarginalValue,
        'observed',
        {
          goalKey: entry.goalKey,
          overlapCount: relevantOverlapItems.length,
          ingredientKeys: overlapIngredientKeys.join(','),
          savedStackCount,
        },
      );

      return {
        goalKey: entry.goalKey,
        adjustedScore,
        stackContextImpact: 'negative',
        marginalValue: goalHasAnySignal(entry.state) ? (relevantOverlapItems.length > 1 ? 'low' : 'medium') : 'low',
        overlapIngredientKeys,
        overlapIngredientDisplays,
        reasonCodes: [reason.code],
        reasons: [reason],
        summary: buildNegativeStackSummary(goalLabel, overlapIngredientDisplays),
        action: buildNegativeStackAction(goalLabel, overlapIngredientDisplays),
      };
    }

    if (goalHasPositiveSignal(entry.state)) {
      const adjustedScore = clampScore(baseScore + 4);
      const reason = buildReason(
        STACK_CONTEXT_REASON_CODES.lowOverlapAdditiveLane,
        STACK_CONTEXT_RULE_IDS.lowOverlapAdditiveLane,
        'derived',
        {
          goalKey: entry.goalKey,
          savedStackCount,
        },
      );

      return {
        goalKey: entry.goalKey,
        adjustedScore,
        stackContextImpact: 'positive',
        marginalValue: entry.state === 'strong' ? 'high' : 'medium',
        overlapIngredientKeys,
        overlapIngredientDisplays,
        reasonCodes: [reason.code],
        reasons: [reason],
        summary: buildPositiveStackSummary(goalLabel),
        action: buildPositiveStackAction(goalLabel),
      };
    }

    return {
      goalKey: entry.goalKey,
      adjustedScore: clampScore(baseScore),
      stackContextImpact: 'neutral',
      marginalValue: entry.state === 'limited' ? 'medium' : 'low',
      overlapIngredientKeys,
      overlapIngredientDisplays,
      reasonCodes: [],
      reasons: [],
    };
  });
};

export const goalStackAdjustmentsInternals = {
  canonicalizeIngredientKey,
  getGoalRelevantIngredientKeys,
  getRelevantOverlapItems,
};
