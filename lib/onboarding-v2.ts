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

export const ALLERGY_FLAG_OPTIONS = [
  'milk',
  'egg',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
] as const;

export type AllergyFlag = (typeof ALLERGY_FLAG_OPTIONS)[number];

export const INGREDIENT_RESTRICTION_OPTIONS = [
  'gluten',
  'gelatin_animal_based',
] as const;

export type IngredientRestriction = (typeof INGREDIENT_RESTRICTION_OPTIONS)[number];

export type AllergyUiOption = {
  label: string;
  value: AllergyFlag;
};

export type RestrictionUiOption = {
  label: string;
  value: IngredientRestriction;
};

export const PRIMARY_ALLERGY_UI_OPTIONS: readonly AllergyUiOption[] = [
  { label: 'Fish', value: 'fish' },
  { label: 'Shellfish', value: 'shellfish' },
  { label: 'Dairy', value: 'milk' },
  { label: 'Soy', value: 'soy' },
  { label: 'Tree nuts', value: 'tree_nuts' },
  { label: 'Peanuts', value: 'peanuts' },
] as const;

export const SECONDARY_ALLERGY_UI_OPTIONS: readonly AllergyUiOption[] = [
  { label: 'Egg', value: 'egg' },
  { label: 'Sesame', value: 'sesame' },
  { label: 'Wheat', value: 'wheat' },
] as const;

export const RESTRICTION_UI_OPTIONS: readonly RestrictionUiOption[] = [
  { label: 'Gluten', value: 'gluten' },
  { label: 'Gelatin / animal-based', value: 'gelatin_animal_based' },
] as const;

export const AVOID_COMMON_OPTIONS = ['Fish', 'Shellfish', 'Dairy', 'Soy', 'Tree nuts', 'Peanuts'] as const;
export const AVOID_MORE_OPTIONS = ['Egg', 'Sesame', 'Wheat'] as const;
export const AVOID_RESTRICTION_OPTIONS = ['Gluten', 'Gelatin / animal-based', 'No known allergies'] as const;
export const NO_KNOWN_ALLERGIES_LABEL = 'No known allergies' as const;

const normalizeAvoidLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const ALLERGY_LABEL_TO_FLAG = new Map<string, AllergyFlag>(
  [...PRIMARY_ALLERGY_UI_OPTIONS, ...SECONDARY_ALLERGY_UI_OPTIONS].map((option) => [
    normalizeAvoidLabel(option.label),
    option.value,
  ]),
);

const RESTRICTION_LABEL_TO_VALUE = new Map<string, IngredientRestriction>(
  RESTRICTION_UI_OPTIONS.map((option) => [
    normalizeAvoidLabel(option.label),
    option.value,
  ]),
);

const ALLERGY_FLAG_TO_LABEL = new Map<AllergyFlag, string>(
  [...PRIMARY_ALLERGY_UI_OPTIONS, ...SECONDARY_ALLERGY_UI_OPTIONS].map((option) => [
    option.value,
    option.label,
  ]),
);

const RESTRICTION_VALUE_TO_LABEL = new Map<IngredientRestriction, string>(
  RESTRICTION_UI_OPTIONS.map((option) => [option.value, option.label]),
);

export type NormalizedAvoidSelection = {
  avoidItems: string[];
  allergyFlags: AllergyFlag[];
  ingredientRestrictions: IngredientRestriction[];
  noKnownAllergies: boolean;
};

const uniqueNormalizedStrings = <T extends string>(values: T[]): T[] => Array.from(new Set(values));

export const normalizeAvoidItemsSelection = (selected: string[] | null | undefined): NormalizedAvoidSelection => {
  const raw = Array.isArray(selected) ? selected : [];
  const noKnownAllergies = raw.some((item) => normalizeAvoidLabel(item) === normalizeAvoidLabel(NO_KNOWN_ALLERGIES_LABEL));

  if (noKnownAllergies) {
    return {
      avoidItems: [NO_KNOWN_ALLERGIES_LABEL],
      allergyFlags: [],
      ingredientRestrictions: [],
      noKnownAllergies: true,
    };
  }

  const allergyFlags = uniqueNormalizedStrings(
    raw
      .map((item) => ALLERGY_LABEL_TO_FLAG.get(normalizeAvoidLabel(item)))
      .filter((value): value is AllergyFlag => Boolean(value)),
  );

  const ingredientRestrictions = uniqueNormalizedStrings(
    raw
      .map((item) => RESTRICTION_LABEL_TO_VALUE.get(normalizeAvoidLabel(item)))
      .filter((value): value is IngredientRestriction => Boolean(value)),
  );

  const canonicalAvoidItems = uniqueNormalizedStrings([
    ...allergyFlags
      .map((value) => ALLERGY_FLAG_TO_LABEL.get(value))
      .filter((value): value is string => Boolean(value)),
    ...ingredientRestrictions
      .map((value) => RESTRICTION_VALUE_TO_LABEL.get(value))
      .filter((value): value is string => Boolean(value)),
  ]);

  return {
    avoidItems: canonicalAvoidItems,
    allergyFlags,
    ingredientRestrictions,
    noKnownAllergies: false,
  };
};

export const buildAvoidItemsFromStructuredPreferences = (input: {
  avoidItems?: string[] | null;
  allergyFlags?: AllergyFlag[] | null;
  ingredientRestrictions?: IngredientRestriction[] | null;
  noKnownAllergies?: boolean | null;
}): string[] => {
  if (input.noKnownAllergies) return [NO_KNOWN_ALLERGIES_LABEL];

  const structured = uniqueNormalizedStrings([
    ...((input.allergyFlags ?? [])
      .map((value) => ALLERGY_FLAG_TO_LABEL.get(value))
      .filter((value): value is string => Boolean(value))),
    ...((input.ingredientRestrictions ?? [])
      .map((value) => RESTRICTION_VALUE_TO_LABEL.get(value))
      .filter((value): value is string => Boolean(value))),
  ]);

  if (structured.length > 0) return structured;
  return normalizeAvoidItemsSelection(input.avoidItems ?? []).avoidItems;
};

export const ADHERENCE_BLOCKER_OPTIONS = [
  'I forget when my day gets busy',
  'My routine changes day to day',
  'I am not sure which supplements fit my goals',
  'Labels and dosage are confusing',
  'I do not have a good daily tracking habit',
  'I am already consistent',
] as const;

export const SETUP_OPTIONS = [
  { title: 'Camera shortcut', description: 'Open the camera faster when you want to scan.' },
  { title: 'Daily reminder nudges', description: 'Keep check-ins easier with a gentle reminder.' },
  { title: 'Photo library upload', description: 'Use saved photos when scan is not the easiest path.' },
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
  const selected = (types ?? []).filter(
    (type): type is string => typeof type === 'string' && allowed.has(type as (typeof TYPE_OPTIONS)[number]),
  );
  return Array.from(new Set(selected));
};

export const buildSmartFilterConfig = (input: { goals?: string[] | null; preferredTypes?: string[] | null }): SmartFilterConfig => ({
  visibleGoals: resolveVisibleGoalTags(input.goals),
  preselectedTypes: resolveTypeTags(input.preferredTypes),
  preselectedTiming: [],
});
