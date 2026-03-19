import type {
  BlockerKey,
  DecisionReason,
  EligibilityDecision,
  ExperienceLevel,
  ProductGoalMatch,
} from '../../../types/personalization';
import type { DuplicateRiskLevel } from '../../../types/personalization';
import safetyRulesData from '../../../data/personalization/safety_rules.v1.json';

type SafetyEligibilityRule = {
  ruleId: string;
  appliesWhen?: {
    duplicateRiskLevels?: DuplicateRiskLevel[];
    experienceLevels?: ExperienceLevel[];
    ageRanges?: string[];
    blockers?: BlockerKey[];
  };
  outcome: {
    eligible: boolean;
    rankEligible: boolean;
    caps: string[];
  };
  reasonCode: string;
};

type SafetyRulesFile = {
  version?: string;
  eligibilityRules?: SafetyEligibilityRule[];
};

export type EligibilityPolicyInput = {
  productGoalMatches?: ProductGoalMatch[] | null;
  duplicateRisk?: {
    level?: DuplicateRiskLevel | null;
    ingredientKeys?: string[] | null;
  } | null;
  supplementExperience?: ExperienceLevel | null;
  ageRange?: string | null;
  adherenceBlocker?: BlockerKey | null;
  hasDietConstraintConflict?: boolean | null;
  requiresGenericSafetyPath?: boolean | null;
};

const SAFETY_RULES = safetyRulesData as SafetyRulesFile;

const makeReason = (
  code: string,
  ruleId: string,
  source: DecisionReason['source'],
  params?: DecisionReason['params'],
): DecisionReason => ({
  code,
  ruleId,
  source,
  ...(params ? { params } : {}),
});

const getDuplicateRule = (level: DuplicateRiskLevel | null | undefined) =>
  SAFETY_RULES.eligibilityRules?.find((rule) =>
    rule.appliesWhen?.duplicateRiskLevels?.includes(level ?? 'none'),
  ) ?? null;

const collectMatchCaps = (matches: ProductGoalMatch[]): string[] =>
  Array.from(new Set(matches.flatMap((match) => match.caps ?? [])));

const buildCapReasons = (caps: string[]): DecisionReason[] => {
  const reasons: DecisionReason[] = [];

  if (caps.includes('low_disclosure')) {
    reasons.push(
      makeReason('low_disclosure_caps_strong_match', 'low_disclosure_caps_goal_match', 'observed'),
    );
  }

  if (caps.includes('proprietary_blend')) {
    reasons.push(
      makeReason('proprietary_blend_caps_goal_match', 'proprietary_blend_caps_goal_match', 'observed'),
    );
  }

  if (caps.includes('generic_safety_path')) {
    reasons.push(
      makeReason(
        'ingredient_requires_generic_safety_path',
        'sensitive_goal_generic_safety_path',
        'catalog',
      ),
    );
  }

  return reasons;
};

export const evaluateEligibilityPolicy = (input: EligibilityPolicyInput): EligibilityDecision => {
  const matches = input.productGoalMatches ?? [];
  const caps = collectMatchCaps(matches);
  const reasons: DecisionReason[] = [];

  let eligible = true;
  let rankEligible = true;

  const duplicateRule = getDuplicateRule(input.duplicateRisk?.level);
  if (duplicateRule) {
    eligible = duplicateRule.outcome.eligible;
    rankEligible = duplicateRule.outcome.rankEligible;
    caps.push(...duplicateRule.outcome.caps);
    reasons.push(
      makeReason(duplicateRule.reasonCode, duplicateRule.ruleId, 'observed', {
        ingredientKeys: (input.duplicateRisk?.ingredientKeys ?? []).join(','),
        level: input.duplicateRisk?.level ?? 'none',
      }),
    );
  }

  if (input.hasDietConstraintConflict) {
    eligible = false;
    rankEligible = false;
    caps.push('diet_constraint_conflict');
    reasons.push(
      makeReason('diet_constraint_exclusion', 'diet_constraint_exclusion', 'declared'),
    );
  }

  if (input.requiresGenericSafetyPath) {
    caps.push('generic_safety_path');
  }

  reasons.push(...buildCapReasons(Array.from(new Set(caps))));

  return {
    eligible,
    rankEligible,
    caps: Array.from(new Set(caps)),
    reasons,
  };
};

export const eligibilityPolicyInternals = {
  buildCapReasons,
  collectMatchCaps,
  getDuplicateRule,
};
