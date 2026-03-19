import {
  GOAL_OPTIONS,
  LEGACY_DEFAULT_GOALS,
  canonicalizeGoal as canonicalizeOnboardingGoal,
} from '../../onboarding-v2';
import type { GoalKey, SupplementTypeKey } from '../../../types/personalization';
import goalCatalogData from '../../../data/personalization/goal_catalog.v1.json';

type GoalOption = (typeof GOAL_OPTIONS)[number];

type GoalCatalogRawRecord = {
  key?: GoalKey;
  goalKey?: GoalKey;
  label: string;
  onboardingLabel?: GoalOption;
  aliases?: string[];
  defaultPriority: number;
  summary?: string;
  defaultVisible?: boolean;
  active?: boolean;
  allowedTypes?: SupplementTypeKey[];
};

type GoalCatalogFile = {
  version?: string;
  goals: GoalCatalogRawRecord[];
};

export type GoalCatalogEntry = {
  goalKey: GoalKey;
  label: string;
  onboardingLabel: GoalOption;
  aliases: string[];
  defaultPriority: number;
  summary: string;
  defaultVisible: boolean;
  active: boolean;
  allowedTypes: SupplementTypeKey[];
  normalizedTokens: string[];
};

export type GoalCatalog = {
  schemaVersion: string;
  version: string;
  goals: GoalCatalogEntry[];
  byGoalKey: ReadonlyMap<GoalKey, GoalCatalogEntry>;
  byNormalizedKey: ReadonlyMap<string, GoalKey>;
  defaultGoalKeys: GoalKey[];
};

const V1_GOAL_CATALOG = goalCatalogData as GoalCatalogFile;

const GOAL_LABEL_TO_KEY: Record<string, GoalKey> = {
  Sleep: 'sleep',
  Energy: 'energy',
  Immunity: 'immunity',
  Recovery: 'recovery',
  Focus: 'focus',
  'Libido Enhancement': 'libido_enhancement',
  'Stress Support': 'stress_support',
  'Weight Management': 'weight_management',
};

const GOAL_OPTION_SET = new Set<string>(GOAL_OPTIONS);
const isGoalOption = (value: string): value is GoalOption => GOAL_OPTION_SET.has(value);

const normalizeCatalogToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const goalLabelToKey = (label: string): GoalKey | null => GOAL_LABEL_TO_KEY[label] ?? null;

let cachedCatalog: GoalCatalog | null = null;

const buildGoalCatalog = (): GoalCatalog => {
  const byGoalKey = new Map<GoalKey, GoalCatalogEntry>();
  const byNormalizedKey = new Map<string, GoalKey>();

  const goals = V1_GOAL_CATALOG.goals.map((goal) => {
    const goalKey = goal.key ?? goal.goalKey;
    if (!goalKey) {
      throw new Error(`Goal catalog record missing key for label: ${goal.label}`);
    }

    const onboardingLabel = goal.onboardingLabel ?? goal.label;
    if (!isGoalOption(onboardingLabel)) {
      throw new Error(`Unsupported onboarding goal label: ${onboardingLabel}`);
    }

    const expectedGoalKey = goalLabelToKey(onboardingLabel);
    if (!expectedGoalKey || expectedGoalKey !== goalKey) {
      throw new Error(`Goal catalog label mismatch: ${onboardingLabel} -> ${goalKey}`);
    }

    const aliases = Array.from(
      new Set([goal.label, onboardingLabel, ...(goal.aliases ?? [])].filter(Boolean) as string[]),
    );
    const active = goal.active ?? goal.defaultVisible ?? true;
    const defaultVisible = goal.defaultVisible ?? active;

    const normalizedTokens = Array.from(
      new Set(
        [goalKey, goal.label, onboardingLabel, ...aliases]
          .map((token) => normalizeCatalogToken(token))
          .filter(Boolean),
      ),
    );

    const entry: GoalCatalogEntry = {
      goalKey,
      label: goal.label,
      onboardingLabel,
      aliases,
      defaultPriority: goal.defaultPriority,
      summary: goal.summary ?? '',
      defaultVisible,
      active,
      allowedTypes: [...(goal.allowedTypes ?? [])],
      normalizedTokens,
    };

    byGoalKey.set(goalKey, entry);
    normalizedTokens.forEach((token) => {
      byNormalizedKey.set(token, goalKey);
    });

    return entry;
  });

  const defaultGoalKeys = LEGACY_DEFAULT_GOALS.map((label) => {
    const goalKey = goalLabelToKey(label);
    if (!goalKey) {
      throw new Error(`Unknown default goal label: ${label}`);
    }
    return goalKey;
  });

  return {
    schemaVersion: V1_GOAL_CATALOG.version ?? 'v1',
    version: V1_GOAL_CATALOG.version ?? 'v1',
    goals,
    byGoalKey,
    byNormalizedKey,
    defaultGoalKeys,
  };
};

export const getGoalCatalog = (): GoalCatalog => {
  if (!cachedCatalog) {
    cachedCatalog = buildGoalCatalog();
  }

  return cachedCatalog;
};

export const normalizeGoalKey = (value: string | GoalKey | null | undefined): GoalKey | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const catalog = getGoalCatalog();
  if (catalog.byGoalKey.has(trimmed as GoalKey)) {
    return trimmed as GoalKey;
  }

  const normalized = normalizeCatalogToken(trimmed);
  const directMatch = catalog.byNormalizedKey.get(normalized);
  if (directMatch) {
    return directMatch;
  }

  const onboardingLabel = canonicalizeOnboardingGoal(trimmed);
  if (!onboardingLabel) {
    return null;
  }

  return goalLabelToKey(onboardingLabel);
};

export const normalizeGoalKeys = (
  values: Array<string | GoalKey | null | undefined> | null | undefined,
): GoalKey[] => {
  const seen = new Set<GoalKey>();

  (values ?? []).forEach((value) => {
    const goalKey = normalizeGoalKey(value);
    if (goalKey) {
      seen.add(goalKey);
    }
  });

  return Array.from(seen);
};

export const getGoalCatalogEntry = (
  value: string | GoalKey | null | undefined,
): GoalCatalogEntry | null => {
  const goalKey = normalizeGoalKey(value);
  if (!goalKey) return null;
  return getGoalCatalog().byGoalKey.get(goalKey) ?? null;
};

export const getGoalLabel = (value: string | GoalKey | null | undefined): string | null =>
  getGoalCatalogEntry(value)?.label ?? null;

export const getDefaultGoalKeys = (): GoalKey[] => [...getGoalCatalog().defaultGoalKeys];

export const listActiveGoalCatalogEntries = (): GoalCatalogEntry[] =>
  getGoalCatalog().goals.filter((goal) => goal.active);

export const goalCatalogInternals = {
  normalizeCatalogToken,
  goalLabelToKey,
};
