import blockerRulesData from '@/data/personalization/blocker_behavior_rules.v1.json';
import type { BlockerStrategy, DecisionReason, PersonalizationProfile } from '@/types/personalization';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

type BlockerRuleFile = {
  version: string;
  blockerStrategies: Array<
    BlockerStrategy & {
      key: string;
      blockerMode: string;
      preferredTimingAnchors: string[];
    }
  >;
};

export type CompiledBlockerStrategy = {
  strategy: BlockerStrategy;
  preferredTimingAnchors: string[];
  reasons: DecisionReason[];
};

const BLOCKER_RULES = blockerRulesData as BlockerRuleFile;

const DEFAULT_BLOCKER_STRATEGY: BlockerStrategy = {
  reminderPriority: 'medium',
  scheduleComplexity: 'simple',
  notificationBudget: 'standard',
  emphasizeHomeCheckIn: false,
  emphasizeScheduleSetup: false,
  emphasizeExplanation: false,
};

const findBlockerRuleByKey = (key?: string) =>
  BLOCKER_RULES.blockerStrategies.find((rule) => rule.key === key);

const findBlockerRuleByMode = (mode?: string) =>
  BLOCKER_RULES.blockerStrategies.find((rule) => rule.blockerMode === mode);

const scheduleComplexityRank: Record<BlockerStrategy['scheduleComplexity'], number> = {
  simple: 0,
  guided: 1,
  advanced: 2,
};

const atLeastScheduleComplexity = (
  current: BlockerStrategy['scheduleComplexity'],
  minimum: BlockerStrategy['scheduleComplexity'],
): BlockerStrategy['scheduleComplexity'] =>
  scheduleComplexityRank[current] >= scheduleComplexityRank[minimum] ? current : minimum;

export const compileBlockerStrategy = (
  profile: PersonalizationProfile,
): CompiledBlockerStrategy => {
  const baseRule =
    findBlockerRuleByKey(profile.declared.adherenceBlocker) ??
    findBlockerRuleByMode(profile.derived.blockerMode);

  let strategy: BlockerStrategy = baseRule
    ? {
        reminderPriority: baseRule.reminderPriority,
        scheduleComplexity: baseRule.scheduleComplexity,
        notificationBudget: baseRule.notificationBudget,
        emphasizeHomeCheckIn: baseRule.emphasizeHomeCheckIn,
        emphasizeScheduleSetup: baseRule.emphasizeScheduleSetup,
        emphasizeExplanation: baseRule.emphasizeExplanation,
      }
    : { ...DEFAULT_BLOCKER_STRATEGY };

  const reasons: DecisionReason[] = [
    buildReason(
      baseRule ? REASON_CODES.blockerStrategySelected : REASON_CODES.blockerDefault,
      baseRule ? RULE_IDS.blockerStrategySelected : RULE_IDS.blockerDefault,
      'derived',
      {
        notificationBudget: strategy.notificationBudget,
        reminderPriority: strategy.reminderPriority,
        scheduleComplexity: strategy.scheduleComplexity,
      },
    ),
  ];

  if (profile.observed.consistencyLevel === 'low') {
    strategy = {
      ...strategy,
      reminderPriority: 'high',
      emphasizeHomeCheckIn: true,
    };
    reasons.push(
      buildReason(REASON_CODES.blockerObservedConsistency, RULE_IDS.blockerObservedConsistency, 'observed', {
        consistencyLevel: profile.observed.consistencyLevel,
        reminderPriority: strategy.reminderPriority,
      }),
    );
  }

  if (profile.observed.savedStackCount >= 4) {
    strategy = {
      ...strategy,
      scheduleComplexity: atLeastScheduleComplexity(strategy.scheduleComplexity, 'guided'),
      emphasizeScheduleSetup: true,
    };
    reasons.push(
      buildReason(REASON_CODES.blockerObservedStack, RULE_IDS.blockerObservedStack, 'observed', {
        savedStackCount: profile.observed.savedStackCount,
        scheduleComplexity: strategy.scheduleComplexity,
      }),
    );
  }

  if (profile.declared.supplementExperience === 'brand_new') {
    strategy = {
      ...strategy,
      emphasizeExplanation: true,
    };
  }

  return {
    strategy,
    preferredTimingAnchors: baseRule?.preferredTimingAnchors ?? [],
    reasons,
  };
};

export const blockerStrategyInternals = {
  DEFAULT_BLOCKER_STRATEGY,
  atLeastScheduleComplexity,
  findBlockerRuleByKey,
  findBlockerRuleByMode,
};
