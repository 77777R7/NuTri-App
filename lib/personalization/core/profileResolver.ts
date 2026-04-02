import blockerBehaviorRulesData from '../../../data/personalization/blocker_behavior_rules.v1.json';
import activityGoalMapData from '../../../data/personalization/activity_goal_map.v1.json';
import dietLaneMapData from '../../../data/personalization/diet_nutrient_lane_map.v1.json';
import type { ProfileDraft } from '../../../types/onboarding';
import type {
  BlockerKey,
  ConsistencyLevel,
  DuplicateRiskLevel,
  ExperienceLevel,
  GoalKey,
  PersonalizationDeclaredSignals,
  PersonalizationDerivedSignals,
  PersonalizationObservedSignals,
  PersonalizationProfile,
  SupplementTypeKey,
} from '../../../types/personalization';
import {
  DEFAULT_PERSONALIZATION_COMPUTED_AT,
  PERSONALIZATION_PROFILE_VERSION,
  REASON_CODES,
  RULE_IDS,
  buildReason,
} from './reasonCodes';
import { normalizeGoalKey } from './goalCatalog';

type GoalOverride = GoalKey | { key: GoalKey; priority?: number };

type BlockerBehaviorRulesFile = {
  version: string;
  blockerStrategies: Array<{
    key: BlockerKey;
    onboardingLabel: string;
    blockerMode: string;
  }>;
};

type DietLaneMapFile = {
  version: string;
  laneCatalog: Array<{
    laneKey: string;
    label: string;
  }>;
  dietMappings: Array<{
    dietKey: string;
    laneKeys: string[];
  }>;
};

type ActivityGoalMapFile = {
  version: string;
  activityMappings: Array<{
    activityKey: string;
    planKey: string;
  }>;
};

export type ProfileResolverInput = {
  draft?: ProfileDraft | null;
  declared?: Partial<Omit<PersonalizationDeclaredSignals, 'goals' | 'activity'>> & {
    goals?: GoalOverride[];
    activity?: string[] | string;
  };
  observed?: Partial<PersonalizationObservedSignals> & {
    duplicateRiskLevel?: DuplicateRiskLevel;
    duplicateIngredientKeys?: string[];
  };
  computedAt?: string;
  profileVersion?: string;
};

const BLOCKER_BEHAVIOR_RULES = blockerBehaviorRulesData as BlockerBehaviorRulesFile;
const DIET_LANE_MAP = dietLaneMapData as DietLaneMapFile;
const ACTIVITY_GOAL_MAP = activityGoalMapData as ActivityGoalMapFile;

const SUPPLEMENT_TYPE_KEYS = new Set<SupplementTypeKey>([
  'vitamin',
  'mineral',
  'herb',
  'probiotic',
  'protein',
]);
const CONSISTENCY_LEVELS = new Set<ConsistencyLevel>(['unknown', 'low', 'medium', 'high']);
const DUPLICATE_RISK_LEVELS = new Set<DuplicateRiskLevel>(['none', 'medium', 'high']);

const TYPE_ALIASES: Record<string, SupplementTypeKey> = {
  vitamin: 'vitamin',
  vitamins: 'vitamin',
  mineral: 'mineral',
  minerals: 'mineral',
  herb: 'herb',
  herbs: 'herb',
  herbal: 'herb',
  probiotic: 'probiotic',
  probiotics: 'probiotic',
  protein: 'protein',
  proteins: 'protein',
  powder: 'protein',
  powders: 'protein',
};

const BLOCKER_ALIASES: Record<string, BlockerKey> = {
  busydayforgetfulness: 'busy_day_forgetfulness',
  iforgetwhenmydaygetsbusy: 'busy_day_forgetfulness',
  routinechangesdaytoday: 'routine_changes_day_to_day',
  myroutinechangesdaytoday: 'routine_changes_day_to_day',
  goalfituncertainty: 'goal_fit_uncertainty',
  iamnotsurewhichsupplementsfitmygoals: 'goal_fit_uncertainty',
  labelanddosageconfusion: 'label_and_dosage_confusion',
  labelsanddosageareconfusing: 'label_and_dosage_confusion',
  weaktrackinghabit: 'weak_tracking_habit',
  idonothaveagooddailytrackinghabit: 'weak_tracking_habit',
  alreadyconsistent: 'already_consistent',
  iamalreadyconsistent: 'already_consistent',
};

const EXPERIENCE_ALIASES: Record<string, ExperienceLevel> = {
  brandnew: 'brand_new',
  new: 'brand_new',
  triedafew: 'tried_a_few',
  regularuser: 'regular_user',
  structuredstack: 'structured_stack',
};

const ACTIVITY_ALIAS_KEYS: Array<{ tokens: string[]; planKey: string }> = [
  {
    tokens: ['running', 'run', 'jogging', 'cycling', 'cardio', 'endurance'],
    planKey: 'activity_endurance_support',
  },
  {
    tokens: ['strength', 'weights', 'weightlifting', 'gym', 'muscle'],
    planKey: 'activity_strength_support',
  },
  {
    tokens: ['yoga', 'pilates', 'mobility', 'stretch'],
    planKey: 'activity_mobility_support',
  },
  {
    tokens: ['sport', 'sports', 'hiit', 'performance'],
    planKey: 'activity_performance_support',
  },
  {
    tokens: ['general fitness', 'generalfitness'],
    planKey: 'activity_general_support',
  },
];

const normalizeText = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeLookupKey = (value?: string | null) =>
  normalizeText(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const normalizeIngredientKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const normalizeUniqueStrings = (value?: string[] | string | null) => {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  raw.forEach(entry => {
    const trimmed = normalizeText(entry);
    if (!trimmed) return;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
};

const BLOCKER_LOOKUP = BLOCKER_BEHAVIOR_RULES.blockerStrategies.reduce(
  (lookup, strategy) => {
    const keyToken = normalizeLookupKey(strategy.key);
    const labelToken = normalizeLookupKey(strategy.onboardingLabel);

    if (keyToken) lookup[keyToken] = strategy.key;
    if (labelToken) lookup[labelToken] = strategy.key;

    return lookup;
  },
  { ...BLOCKER_ALIASES } as Record<string, BlockerKey>,
);

const DIET_MAPPING_BY_LOOKUP = DIET_LANE_MAP.dietMappings.reduce(
  (lookup, mapping) => {
    const key = normalizeLookupKey(mapping.dietKey);
    if (key) {
      lookup.set(key, mapping);
    }
    return lookup;
  },
  new Map<string, DietLaneMapFile['dietMappings'][number]>(),
);

const ACTIVITY_PLAN_KEY_BY_LOOKUP = ACTIVITY_GOAL_MAP.activityMappings.reduce(
  (lookup, mapping) => {
    const activityKey = normalizeLookupKey(mapping.activityKey);
    if (activityKey) {
      lookup.set(activityKey, mapping.planKey);
    }

    const planKey = normalizeLookupKey(mapping.planKey);
    if (planKey) {
      lookup.set(planKey, mapping.planKey);
    }

    return lookup;
  },
  new Map<string, string>(),
);

const BLOCKER_MODE_BY_KEY = BLOCKER_BEHAVIOR_RULES.blockerStrategies.reduce(
  (lookup, strategy) => lookup.set(strategy.key, strategy.blockerMode),
  new Map<BlockerKey, string>(),
);

const toGoalKey = (value: string): GoalKey | null => normalizeGoalKey(value);

const toSupplementTypeKey = (value: string): SupplementTypeKey | null => {
  const normalized = normalizeLookupKey(value);
  if (!normalized) return null;

  const aliased = TYPE_ALIASES[normalized];
  if (aliased) return aliased;

  return SUPPLEMENT_TYPE_KEYS.has(value as SupplementTypeKey) ? (value as SupplementTypeKey) : null;
};

const toBlockerKey = (value?: string | null): BlockerKey | undefined => {
  const normalized = normalizeLookupKey(value);
  return normalized ? BLOCKER_LOOKUP[normalized] : undefined;
};

const toExperienceLevel = (value?: string | null): ExperienceLevel | undefined => {
  const normalized = normalizeLookupKey(value);
  return normalized ? EXPERIENCE_ALIASES[normalized] : undefined;
};

const resolveDeclaredGoals = (
  draftGoals: string[] | undefined,
  declaredGoals: GoalOverride[] | undefined,
): Array<{ key: GoalKey; priority: number }> => {
  const ordered = [...(declaredGoals ?? []), ...(draftGoals ?? [])];
  const resolvedEntries: GoalOverride[] = [];
  const seen = new Set<GoalKey>();

  ordered.forEach((entry) => {
    const goalKey = typeof entry === 'string' ? toGoalKey(entry) : toGoalKey(entry.key);
    if (!goalKey || seen.has(goalKey)) return;
    seen.add(goalKey);
    resolvedEntries.push(typeof entry === 'string' ? goalKey : { ...entry, key: goalKey });
  });

  const priorityBase = resolvedEntries.length * 10;

  return resolvedEntries
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          key: entry,
          priority: Math.max(10, priorityBase - index * 10),
        };
      }

      return {
        key: entry.key,
        priority:
          typeof entry.priority === 'number' && Number.isFinite(entry.priority)
            ? entry.priority
            : Math.max(10, priorityBase - index * 10),
      };
    })
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key));
};

const resolvePreferredTypes = (
  draftTypes: string[] | undefined,
  declaredTypes: SupplementTypeKey[] | undefined,
) => {
  const seen = new Set<SupplementTypeKey>();
  const resolved: SupplementTypeKey[] = [];

  [...(declaredTypes ?? []), ...(draftTypes ?? [])].forEach((entry) => {
    const typeKey = toSupplementTypeKey(entry);
    if (!typeKey || seen.has(typeKey)) return;

    seen.add(typeKey);
    resolved.push(typeKey);
  });

  return resolved;
};

const sanitizeCount = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
};

const sanitizeCurrentStreak = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
};

const resolveConsistencyLevel = (value?: ConsistencyLevel | null): ConsistencyLevel =>
  value && CONSISTENCY_LEVELS.has(value) ? value : 'unknown';

const resolveDuplicateRisk = (observed?: ProfileResolverInput['observed']) => {
  const ingredientKeys = Array.from(
    new Set(
      normalizeUniqueStrings(
        observed?.duplicateRisk?.ingredientKeys ?? observed?.duplicateIngredientKeys,
      ).map(normalizeIngredientKey),
    ),
  );

  const preferredLevel = observed?.duplicateRisk?.level ?? observed?.duplicateRiskLevel;
  const level =
    preferredLevel && DUPLICATE_RISK_LEVELS.has(preferredLevel)
      ? preferredLevel
      : ingredientKeys.length > 0
        ? 'medium'
        : 'none';

  return {
    level,
    ingredientKeys,
  };
};

const deriveDietReviewLanes = (diets: string[]) => {
  const seen = new Set<string>();
  const lanes: string[] = [];

  diets.forEach((diet) => {
    const normalized = normalizeLookupKey(diet);
    if (!normalized) return;

    const mapped = DIET_MAPPING_BY_LOOKUP.get(normalized);
    if (!mapped) return;

    mapped.laneKeys.forEach((laneKey) => {
      if (seen.has(laneKey)) return;
      seen.add(laneKey);
      lanes.push(laneKey);
    });
  });

  return lanes;
};

const deriveActivityPlanKeys = (activities: string[]) => {
  const seen = new Set<string>();
  const planKeys: string[] = [];

  activities.forEach((activity) => {
    const normalized = normalizeLookupKey(activity);
    if (!normalized) return;

    const exact = ACTIVITY_PLAN_KEY_BY_LOOKUP.get(normalized);
    if (exact && !seen.has(exact)) {
      seen.add(exact);
      planKeys.push(exact);
      return;
    }

    const alias = ACTIVITY_ALIAS_KEYS.find(({ tokens }) =>
      tokens.some((token) => normalized.includes(token.replace(/[^a-z0-9]+/g, ''))),
    )?.planKey;

    if (alias && !seen.has(alias)) {
      seen.add(alias);
      planKeys.push(alias);
    }
  });

  return planKeys;
};

const deriveBlockerMode = (blocker?: BlockerKey) =>
  blocker ? BLOCKER_MODE_BY_KEY.get(blocker) : undefined;

const resolveDeclaredSignals = (input: ProfileResolverInput): PersonalizationDeclaredSignals => {
  const draft = input.draft ?? null;
  const diets = normalizeUniqueStrings(input.declared?.diets ?? draft?.diets);
  const activity = normalizeUniqueStrings(input.declared?.activity ?? draft?.activity);

  return {
    goals: resolveDeclaredGoals(draft?.goals, input.declared?.goals),
    preferredTypes: resolvePreferredTypes(draft?.preferredTypes, input.declared?.preferredTypes),
    adherenceBlocker: input.declared?.adherenceBlocker ?? toBlockerKey(draft?.adherenceBlocker),
    supplementExperience:
      input.declared?.supplementExperience ?? toExperienceLevel(draft?.supplementExperience),
    diets: diets.length > 0 ? diets : undefined,
    activity: activity.length > 0 ? activity : undefined,
    ageRange: input.declared?.ageRange ?? normalizeText(draft?.ageRange),
    sex: input.declared?.sex ?? normalizeText(draft?.sex),
  };
};

const resolveObservedSignals = (input: ProfileResolverInput): PersonalizationObservedSignals => ({
  currentStreak: sanitizeCurrentStreak(input.observed?.currentStreak),
  consistencyLevel: resolveConsistencyLevel(input.observed?.consistencyLevel),
  missedPattern: normalizeText(input.observed?.missedPattern),
  savedStackCount: sanitizeCount(input.observed?.savedStackCount),
  duplicateRisk: resolveDuplicateRisk(input.observed),
});

const resolveDerivedSignals = (input: {
  declared: PersonalizationDeclaredSignals;
  observed: PersonalizationObservedSignals;
}): PersonalizationDerivedSignals => ({
  dietReviewLanes: deriveDietReviewLanes(input.declared.diets ?? []),
  activityPlanKeys: deriveActivityPlanKeys(input.declared.activity ?? []),
  blockerMode: deriveBlockerMode(input.declared.adherenceBlocker),
});

export const resolvePersonalizationProfile = (
  input: ProfileResolverInput = {},
): PersonalizationProfile => {
  const declared = resolveDeclaredSignals(input);
  const observed = resolveObservedSignals(input);
  const derived = resolveDerivedSignals({ declared, observed });

  return {
    declared,
    observed,
    derived,
    meta: {
      profileVersion: input.profileVersion ?? PERSONALIZATION_PROFILE_VERSION,
      computedAt: input.computedAt ?? DEFAULT_PERSONALIZATION_COMPUTED_AT,
    },
  };
};

export const buildProfileTrace = (
  profile: PersonalizationProfile,
  input?: ProfileResolverInput,
) => {
  const reasons = [] as ReturnType<typeof buildReason>[];
  const observedInput = input?.observed;

  if (profile.declared.goals.length > 0) {
    reasons.push(
      buildReason(REASON_CODES.declaredGoalSelected, RULE_IDS.declaredGoalSelected, 'declared', {
        count: profile.declared.goals.length,
        topGoal: profile.declared.goals[0]?.key ?? '',
      }),
    );
  }

  if (profile.declared.preferredTypes.length > 0) {
    reasons.push(
      buildReason(REASON_CODES.declaredTypeSelected, RULE_IDS.declaredTypeSelected, 'declared', {
        count: profile.declared.preferredTypes.length,
      }),
    );
  }

  if (profile.declared.adherenceBlocker) {
    reasons.push(
      buildReason(REASON_CODES.declaredBlockerSelected, RULE_IDS.declaredBlockerSelected, 'declared', {
        blocker: profile.declared.adherenceBlocker,
      }),
    );
  }

  if (profile.declared.supplementExperience) {
    reasons.push(
      buildReason(
        REASON_CODES.declaredExperienceSelected,
        RULE_IDS.declaredExperienceSelected,
        'declared',
        {
          experience: profile.declared.supplementExperience,
        },
      ),
    );
  }

  if (typeof observedInput?.currentStreak === 'number') {
    reasons.push(
      buildReason(REASON_CODES.observedStreakRecorded, RULE_IDS.observedStreakRecorded, 'observed', {
        currentStreak: profile.observed.currentStreak ?? 0,
      }),
    );
  }

  if (observedInput?.consistencyLevel) {
    reasons.push(
      buildReason(
        REASON_CODES.observedConsistencyDerived,
        RULE_IDS.observedConsistencyDerived,
        'observed',
        {
          consistencyLevel: profile.observed.consistencyLevel,
        },
      ),
    );
  }

  if (typeof observedInput?.savedStackCount === 'number') {
    reasons.push(
      buildReason(
        REASON_CODES.observedSavedStackRecorded,
        RULE_IDS.observedSavedStackRecorded,
        'observed',
        {
          savedStackCount: profile.observed.savedStackCount,
        },
      ),
    );
  }

  if (
    observedInput?.duplicateRiskLevel ||
    observedInput?.duplicateRisk?.level ||
    (observedInput?.duplicateIngredientKeys?.length ?? 0) > 0 ||
    (observedInput?.duplicateRisk?.ingredientKeys?.length ?? 0) > 0
  ) {
    reasons.push(
      buildReason(
        REASON_CODES.observedDuplicateRiskDetected,
        RULE_IDS.observedDuplicateRiskDetected,
        'observed',
        {
          ingredientCount: profile.observed.duplicateRisk.ingredientKeys.length,
          level: profile.observed.duplicateRisk.level,
        },
      ),
    );
  }

  profile.derived.dietReviewLanes.forEach((laneKey) => {
    reasons.push(
      buildReason(REASON_CODES.derivedDietReviewLane, RULE_IDS.derivedDietReviewLane, 'derived', {
        laneKey,
      }),
    );
  });

  profile.derived.activityPlanKeys.forEach((planKey) => {
    reasons.push(
      buildReason(REASON_CODES.derivedActivityPlan, RULE_IDS.derivedActivityPlan, 'derived', {
        planKey,
      }),
    );
  });

  if (profile.derived.blockerMode) {
    reasons.push(
      buildReason(REASON_CODES.derivedBlockerMode, RULE_IDS.derivedBlockerMode, 'derived', {
        blockerMode: profile.derived.blockerMode,
      }),
    );
  }

  return reasons;
};

export const profileResolverInternals = {
  buildProfileTrace,
  deriveActivityPlanKeys,
  deriveBlockerMode,
  deriveDietReviewLanes,
  normalizeLookupKey,
  normalizeUniqueStrings,
  resolveDeclaredSignals,
  resolveDerivedSignals,
  resolveObservedSignals,
  toBlockerKey,
  toExperienceLevel,
  toGoalKey,
  toSupplementTypeKey,
};
