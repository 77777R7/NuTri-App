export const ONBOARDING_TOTAL_STEPS = 12;

export const AGE_RANGE_OPTIONS = [
  '13-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55+',
] as const;

export const SEX_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'] as const;

export const SUPPLEMENT_EXPERIENCE_OPTIONS = [
  'Brand new',
  'Tried a few',
  'Regular user',
  'Structured stack',
] as const;

export const GOAL_OPTIONS = [
  'Sleep',
  'Energy',
  'Immunity',
  'Recovery',
  'Focus',
  'Libido Enhancement',
  'Stress Support',
  'Weight Management',
] as const;

export const LEGACY_DEFAULT_GOALS = ['Sleep', 'Energy', 'Immunity', 'Recovery', 'Focus'] as const;

export const TYPE_OPTIONS = ['Vitamin', 'Mineral', 'Herb', 'Probiotic', 'Protein'] as const;

export const ADHERENCE_BLOCKER_OPTIONS = [
  'I forget when my day gets busy',
  'My routine changes day to day',
  'I am not sure which supplements fit my goals',
  'Labels and dosage are confusing',
  'I do not have a good daily tracking habit',
  'I am already consistent',
] as const;

export type SmartFilterConfig = {
  visibleGoals: string[];
  preselectedTypes: string[];
  preselectedTiming?: string[];
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const GOAL_ALIAS_TO_CANONICAL: Record<string, (typeof GOAL_OPTIONS)[number]> = {
  boostenergy: 'Energy',
  energy: 'Energy',
  improvesleep: 'Sleep',
  sleep: 'Sleep',
  supportimmunity: 'Immunity',
  immunity: 'Immunity',
  enhancefocus: 'Focus',
  focus: 'Focus',
  managestress: 'Stress Support',
  stresssupport: 'Stress Support',
  buildmuscle: 'Recovery',
  recovery: 'Recovery',
  weightmanagement: 'Weight Management',
  generalwellness: 'Recovery',
  libidoenhancement: 'Libido Enhancement',
};

export const canonicalizeGoal = (value: string): (typeof GOAL_OPTIONS)[number] | null => {
  const key = normalize(value);

  if (!key) return null;
  const direct = GOAL_OPTIONS.find((goal) => normalize(goal) === key);
  if (direct) return direct;

  return GOAL_ALIAS_TO_CANONICAL[key] ?? null;
};

export const resolveVisibleGoalTags = (goals?: string[] | null): string[] => {
  const seen = new Set<string>();

  (goals ?? []).forEach((goal) => {
    const canonical = canonicalizeGoal(goal);
    if (canonical) seen.add(canonical);
  });

  if (seen.size === 0) {
    return [...LEGACY_DEFAULT_GOALS];
  }

  return GOAL_OPTIONS.filter((goal) => seen.has(goal));
};

export const resolveTypeTags = (types?: string[] | null): string[] => {
  const allowed = new Set(TYPE_OPTIONS);
  const selected = (types ?? []).filter((type): type is string => typeof type === 'string' && allowed.has(type as (typeof TYPE_OPTIONS)[number]));
  return Array.from(new Set(selected));
};

export const buildSmartFilterConfig = (input: { goals?: string[] | null; preferredTypes?: string[] | null }): SmartFilterConfig => ({
  visibleGoals: resolveVisibleGoalTags(input.goals),
  preselectedTypes: resolveTypeTags(input.preferredTypes),
  preselectedTiming: [],
});
