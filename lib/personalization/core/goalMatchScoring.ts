import type {
  DecisionReason,
  GoalKey,
  ProductGoalMatch,
  ProductGoalMatchTier,
} from '../../../types/personalization';
import goalIngredientMapData from '../../../data/personalization/goal_ingredient_map.v1.json';
import {
  listActiveGoalCatalogEntries,
  normalizeGoalKeys,
} from './goalCatalog';

type EvidenceGrade = 'A' | 'B' | 'C';
type DisclosureQuality = 'high' | 'medium' | 'low' | 'unknown';

type GoalIngredientMatchRecord = {
  ingredientKey: string;
  tier: ProductGoalMatchTier;
  evidenceGrade: EvidenceGrade;
  minEffectiveDose: number;
  unit: string;
  preferredForms: string[];
  caps: string[];
  rationale: string;
};

type GoalIngredientMappingRecord = {
  goalKey: GoalKey;
  ingredientMatches: GoalIngredientMatchRecord[];
};

type GoalIngredientMapFile = {
  version?: string;
  mappings: GoalIngredientMappingRecord[];
  goalIngredientMap: Array<{
    goalKey: GoalKey;
    ingredientKey: string;
    tier: 'strong' | 'supporting' | 'exploratory';
    evidenceGrade: EvidenceGrade;
    minEffectiveDose: number;
    unit: string;
    preferredForms: string[];
    caps: string[];
    rationale: string;
  }>;
};

export type GoalEvidenceLikeInput = {
  goalKey?: GoalKey | string | null;
  goal?: GoalKey | string | null;
  evidenceGrade?: string | null;
  evidence_grade?: string | null;
  minEffectiveDose?: number | null;
  min_effective_dose?: number | null;
  unit?: string | null;
  auditStatus?: string | null;
  audit_status?: string | null;
  supportsStrongMatch?: boolean | null;
  requiresGenericSafetyPath?: boolean | null;
};

export type ProductIngredientLikeInput = {
  ingredientKey?: string | null;
  ingredientLabel?: string | null;
  name?: string | null;
  amount?: number | null;
  amountUnknown?: boolean | null;
  unit?: string | null;
  amountUnit?: string | null;
  amountUnitNormalized?: string | null;
  formKey?: string | null;
  formLabel?: string | null;
  form?: string | null;
  disclosureQuality?: DisclosureQuality | null;
  proprietaryBlend?: boolean | null;
  evidence?: GoalEvidenceLikeInput[] | null;
};

export type ProductGoalMatchScoringInput = {
  goals?: Array<GoalKey | string | null | undefined> | null;
  ingredients?: ProductIngredientLikeInput[] | null;
  disclosureQuality?: DisclosureQuality | null;
  proprietaryBlendWithoutClearActives?: boolean | null;
};

type GoalIngredientMapEntry = GoalIngredientMatchRecord & {
  goalKey: GoalKey;
  ingredientKey: string;
};

type ScoredCandidate = {
  ingredientKey: string;
  ingredientLabel: string;
  score: number;
  tier: ProductGoalMatchTier;
  reasons: DecisionReason[];
  caps: string[];
  confidence: NonNullable<ProductGoalMatch['confidence']>;
};

type DoseEvaluation =
  | { status: 'not_applicable' }
  | { status: 'meets' }
  | { status: 'below' }
  | { status: 'unknown' };

const GOAL_INGREDIENT_MAP = goalIngredientMapData as GoalIngredientMapFile;

const TIER_ORDER: ProductGoalMatchTier[] = ['no_match', 'weak_match', 'related', 'strong_match'];

const BASE_SCORE_BY_TIER: Record<ProductGoalMatchTier, number> = {
  no_match: 0,
  weak_match: 38,
  related: 66,
  strong_match: 88,
};

const EVIDENCE_GRADE_BONUS: Record<EvidenceGrade, number> = {
  A: 8,
  B: 3,
  C: -12,
};

const CONVERTIBLE_UNIT_TO_MG: Record<string, number> = {
  mcg: 0.001,
  mg: 1,
  g: 1000,
};

const INGREDIENT_KEY_ALIASES: Record<string, string> = {
  coq10: 'coenzyme_q10',
  coenzymeq10: 'coenzyme_q10',
  vitaminb12: 'vitamin_b12',
  vitaminb_12: 'vitamin_b12',
  fishoil: 'omega_3',
  omega3: 'omega_3',
  omega_3fattyacids: 'omega_3',
  proteinblend: 'protein',
  wheyprotein: 'protein',
  creatinemonohydrate: 'creatine',
};

const normalizeTextKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const normalizeFreeformToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const canonicalizeIngredientKey = (value: string): string => {
  const freeform = normalizeFreeformToken(value);
  return INGREDIENT_KEY_ALIASES[freeform] ?? normalizeTextKey(value);
};

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

const compareTier = (left: ProductGoalMatchTier, right: ProductGoalMatchTier): number =>
  TIER_ORDER.indexOf(left) - TIER_ORDER.indexOf(right);

const minTier = (left: ProductGoalMatchTier, right: ProductGoalMatchTier): ProductGoalMatchTier =>
  compareTier(left, right) <= 0 ? left : right;

const downgradeTier = (tier: ProductGoalMatchTier): ProductGoalMatchTier => {
  const currentIndex = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, currentIndex - 1)] ?? 'no_match';
};

const applyTierCap = (
  tier: ProductGoalMatchTier,
  capTier: ProductGoalMatchTier,
): ProductGoalMatchTier => minTier(tier, capTier);

const scoreToTier = (score: number): ProductGoalMatchTier => {
  if (score >= 85) return 'strong_match';
  if (score >= 60) return 'related';
  if (score >= 30) return 'weak_match';
  return 'no_match';
};

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

const normalizeEvidenceGrade = (value: string | null | undefined): EvidenceGrade | null => {
  if (value === 'A' || value === 'B' || value === 'C') return value;
  return null;
};

const normalizeDisclosureQuality = (
  productDisclosure: DisclosureQuality | null | undefined,
  ingredientDisclosure: DisclosureQuality | null | undefined,
): DisclosureQuality => ingredientDisclosure ?? productDisclosure ?? 'unknown';

const normalizeUnit = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = normalizeFreeformToken(value);
  if (normalized === 'mcg' || normalized === 'ug') return 'mcg';
  if (normalized === 'mg' || normalized === 'milligram' || normalized === 'milligrams') return 'mg';
  if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') return 'g';
  return normalized || null;
};

const convertDose = (amount: number, unit: string): number | null => {
  const factor = CONVERTIBLE_UNIT_TO_MG[unit];
  if (!factor) return null;
  return amount * factor;
};

const evaluateDose = (
  amount: number | null | undefined,
  unit: string | null | undefined,
  floor: number | null,
  floorUnit: string | null,
): DoseEvaluation => {
  if (floor == null || !floorUnit) {
    return { status: 'not_applicable' };
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return { status: 'unknown' };
  }

  const normalizedUnit = normalizeUnit(unit);
  const normalizedFloorUnit = normalizeUnit(floorUnit);
  if (!normalizedUnit || !normalizedFloorUnit) {
    return { status: 'unknown' };
  }

  if (normalizedUnit === normalizedFloorUnit) {
    return amount >= floor ? { status: 'meets' } : { status: 'below' };
  }

  const amountInMg = convertDose(amount, normalizedUnit);
  const floorInMg = convertDose(floor, normalizedFloorUnit);
  if (amountInMg == null || floorInMg == null) {
    return { status: 'unknown' };
  }

  return amountInMg >= floorInMg ? { status: 'meets' } : { status: 'below' };
};

const normalizeIngredientKey = (ingredient: ProductIngredientLikeInput): string | null => {
  const candidates = [ingredient.ingredientKey, ingredient.ingredientLabel, ingredient.name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => canonicalizeIngredientKey(value));

  return candidates[0] ?? null;
};

const getIngredientLookupTokens = (ingredient: ProductIngredientLikeInput): string[] =>
  Array.from(
    new Set(
      [ingredient.ingredientKey, ingredient.ingredientLabel, ingredient.name]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => canonicalizeIngredientKey(value)),
    ),
  );

const tokenMatchesIngredientKey = (token: string, ingredientKey: string): boolean =>
  token === ingredientKey ||
  token.startsWith(`${ingredientKey}_`) ||
  token.endsWith(`_${ingredientKey}`) ||
  token.includes(`_${ingredientKey}_`);

const normalizeAuditStatus = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = normalizeFreeformToken(value);
  return normalized || null;
};

const isAuditedStatus = (value: string | null): boolean =>
  value === 'approved' || value === 'verified' || value === 'reviewed' || value === 'captured';

const resolveEvidenceForGoal = (
  ingredient: ProductIngredientLikeInput,
  goalKey: GoalKey,
): GoalEvidenceLikeInput | null =>
  (ingredient.evidence ?? []).find(
    (row) => normalizeGoalKeys([row.goalKey ?? row.goal ?? null])[0] === goalKey,
  ) ?? null;

const resolveEvidenceGrade = (
  evidence: GoalEvidenceLikeInput | null,
  row: GoalIngredientMapEntry,
): EvidenceGrade | null =>
  evidence
    ? normalizeEvidenceGrade(evidence.evidenceGrade ?? evidence.evidence_grade ?? null) ??
      row.evidenceGrade
    : null;

const resolveEvidenceFloor = (
  evidence: GoalEvidenceLikeInput | null,
  row: GoalIngredientMapEntry,
): number | null => {
  const value = evidence?.minEffectiveDose ?? evidence?.min_effective_dose ?? null;
  if (typeof value === 'number' && value > 0) return value;
  return typeof row.minEffectiveDose === 'number' && row.minEffectiveDose > 0
    ? row.minEffectiveDose
    : null;
};

const resolveEvidenceUnit = (
  evidence: GoalEvidenceLikeInput | null,
  row: GoalIngredientMapEntry,
): string | null => normalizeUnit(evidence?.unit ?? row.unit ?? null);

const resolveEvidenceAuditStatus = (evidence: GoalEvidenceLikeInput | null): string | null =>
  normalizeAuditStatus(evidence?.auditStatus ?? evidence?.audit_status ?? null);

const resolveIngredientAmount = (ingredient: ProductIngredientLikeInput): number | null => {
  if (ingredient.amountUnknown) return null;
  return typeof ingredient.amount === 'number' && ingredient.amount > 0 ? ingredient.amount : null;
};

const resolveIngredientUnit = (ingredient: ProductIngredientLikeInput): string | null =>
  normalizeUnit(ingredient.amountUnitNormalized ?? ingredient.unit ?? ingredient.amountUnit ?? null);

const buildGoalIngredientIndex = (): ReadonlyMap<GoalKey, GoalIngredientMapEntry[]> => {
  const byGoalKey = new Map<GoalKey, GoalIngredientMapEntry[]>();

  GOAL_INGREDIENT_MAP.mappings.forEach((mapping) => {
    byGoalKey.set(
      mapping.goalKey,
      mapping.ingredientMatches.map((match) => ({
        ...match,
        goalKey: mapping.goalKey,
        ingredientKey: canonicalizeIngredientKey(match.ingredientKey),
      })),
    );
  });

  return byGoalKey;
};

const GOAL_INGREDIENT_INDEX = buildGoalIngredientIndex();

const findIngredientRows = (
  goalKey: GoalKey,
  ingredient: ProductIngredientLikeInput,
): GoalIngredientMapEntry[] => {
  const goalRows = GOAL_INGREDIENT_INDEX.get(goalKey) ?? [];
  const tokens = getIngredientLookupTokens(ingredient);

  if (tokens.length === 0) {
    return [];
  }

  return goalRows.filter((row) => tokens.some((token) => tokenMatchesIngredientKey(token, row.ingredientKey)));
};

const scoreCandidate = (
  goalKey: GoalKey,
  ingredient: ProductIngredientLikeInput,
  row: GoalIngredientMapEntry,
  productDisclosureQuality: DisclosureQuality | null | undefined,
  proprietaryBlendWithoutClearActives: boolean,
): ScoredCandidate => {
  const ingredientLabel =
    ingredient.ingredientLabel?.trim() ||
    ingredient.name?.trim() ||
    row.ingredientKey.replace(/_/g, ' ');
  const evidence = resolveEvidenceForGoal(ingredient, goalKey);
  const evidenceGrade = resolveEvidenceGrade(evidence, row);
  const evidenceFloor = resolveEvidenceFloor(evidence, row);
  const evidenceUnit = resolveEvidenceUnit(evidence, row);
  const evidenceAuditStatus = resolveEvidenceAuditStatus(evidence);
  const amount = resolveIngredientAmount(ingredient);
  const amountUnit = resolveIngredientUnit(ingredient);
  const disclosureQuality = normalizeDisclosureQuality(
    productDisclosureQuality,
    ingredient.disclosureQuality,
  );

  let score = BASE_SCORE_BY_TIER[row.tier];
  let maxTier = row.tier;
  const caps: string[] = [];
  const reasons: DecisionReason[] = [
    makeReason('goal_supported_by_ingredient', 'goal_map_match', 'catalog', {
      goalKey,
      ingredientKey: row.ingredientKey,
      ingredientLabel,
    }),
  ];

  if (evidenceGrade) {
    score += EVIDENCE_GRADE_BONUS[evidenceGrade];

    if (evidenceGrade === 'C') {
      maxTier = applyTierCap(maxTier, downgradeTier(row.tier));
      reasons.push(
        makeReason('evidence_grade_limited', 'goal_specific_evidence', 'catalog', {
          evidenceGrade,
          ingredientKey: row.ingredientKey,
        }),
      );
    } else {
      reasons.push(
        makeReason('goal_specific_evidence_present', 'goal_specific_evidence', 'catalog', {
          evidenceGrade,
          ingredientKey: row.ingredientKey,
        }),
      );
    }
  } else {
    if (row.tier === 'strong_match') {
      maxTier = applyTierCap(maxTier, 'related');
    }
    reasons.push(
      makeReason('goal_specific_evidence_missing', 'goal_specific_evidence', 'catalog', {
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  if (evidenceAuditStatus && !isAuditedStatus(evidenceAuditStatus)) {
    score -= 8;
    maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
    reasons.push(
      makeReason('goal_specific_evidence_unreviewed', 'goal_specific_evidence', 'catalog', {
        auditStatus: evidenceAuditStatus,
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  const doseEvaluation = evaluateDose(amount, amountUnit, evidenceFloor, evidenceUnit);
  if (doseEvaluation.status === 'meets') {
    score += 8;
    reasons.push(
      makeReason('dose_meets_effective_floor', 'dose_floor_check', 'derived', {
        ingredientKey: row.ingredientKey,
      }),
    );
  } else if (doseEvaluation.status === 'below') {
    score -= 24;
    maxTier = applyTierCap(maxTier, 'weak_match');
    reasons.push(
      makeReason('dose_below_effective_floor', 'dose_floor_check', 'derived', {
        ingredientKey: row.ingredientKey,
      }),
    );
  } else if (doseEvaluation.status === 'unknown') {
    score -= 14;
    maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
    reasons.push(
      makeReason('dose_not_disclosed', 'dose_floor_check', 'observed', {
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  const normalizedForm = normalizeTextKey(ingredient.formKey ?? ingredient.formLabel ?? ingredient.form ?? '');
  if (
    normalizedForm &&
    row.preferredForms.some((form) => canonicalizeIngredientKey(form) === normalizedForm)
  ) {
    score += 3;
    reasons.push(
      makeReason('ingredient_form_preferred', 'ingredient_form_preference', 'catalog', {
        ingredientKey: row.ingredientKey,
        formKey: normalizedForm,
      }),
    );
  }

  if (disclosureQuality === 'low') {
    score -= 18;
    maxTier = applyTierCap(maxTier, 'weak_match');
    caps.push('low_disclosure');
    reasons.push(
      makeReason('low_disclosure_caps_strong_match', 'low_disclosure_caps_goal_match', 'observed', {
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  if (proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend) {
    score -= 20;
    maxTier = applyTierCap(maxTier, 'weak_match');
    caps.push('proprietary_blend');
    reasons.push(
      makeReason('proprietary_blend_caps_goal_match', 'proprietary_blend_caps_goal_match', 'observed', {
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  if (
    row.caps.includes('eligibility_requires_generic_safety_path') ||
    Boolean(evidence?.requiresGenericSafetyPath)
  ) {
    caps.push('generic_safety_path');
    reasons.push(
      makeReason('ingredient_requires_generic_safety_path', 'generic_safety_path_guardrail', 'catalog', {
        ingredientKey: row.ingredientKey,
      }),
    );
  }

  const confidence: NonNullable<ProductGoalMatch['confidence']> = {
    evidence:
      !evidenceGrade
        ? row.tier === 'strong_match'
          ? 'medium'
          : 'low'
        : evidenceAuditStatus && !isAuditedStatus(evidenceAuditStatus)
          ? 'medium'
          : evidenceGrade === 'A'
            ? 'high'
            : evidenceGrade === 'B'
              ? 'medium'
              : 'low',
    dose:
      doseEvaluation.status === 'meets' ||
      doseEvaluation.status === 'below' ||
      doseEvaluation.status === 'unknown'
        ? doseEvaluation.status
        : 'not_applicable',
    disclosure:
      disclosureQuality === 'high' && !proprietaryBlendWithoutClearActives && !ingredient.proprietaryBlend
        ? 'full'
        : disclosureQuality === 'low' || proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend
          ? 'weak'
          : 'partial',
  };

  return {
    ingredientKey: row.ingredientKey,
    ingredientLabel,
    score: clampScore(score),
    tier: applyTierCap(scoreToTier(score), maxTier),
    reasons,
    caps: Array.from(new Set(caps)),
    confidence,
  };
};

const sortCandidates = (left: ScoredCandidate, right: ScoredCandidate): number => {
  const tierDelta = compareTier(right.tier, left.tier);
  if (tierDelta !== 0) return tierDelta;
  return right.score - left.score;
};

const buildNoMatch = (goalKey: GoalKey): ProductGoalMatch => ({
  goalKey,
  score: 0,
  tier: 'no_match',
  reasons: [
    makeReason('no_goal_support_detected', 'goal_map_match', 'derived', {
      goalKey,
    }),
  ],
  confidence: {
    evidence: 'low',
    dose: 'not_applicable',
    disclosure: 'weak',
  },
});

const getTargetGoals = (inputGoals: ProductGoalMatchScoringInput['goals']): GoalKey[] => {
  const normalized = normalizeGoalKeys(inputGoals);
  if (normalized.length > 0) {
    return normalized;
  }

  return listActiveGoalCatalogEntries().map((goal) => goal.goalKey);
};

export const scoreProductGoalMatches = (input: ProductGoalMatchScoringInput): ProductGoalMatch[] => {
  const goals = getTargetGoals(input.goals);
  const ingredients = (input.ingredients ?? []).filter(
    (ingredient): ingredient is ProductIngredientLikeInput =>
      getIngredientLookupTokens(ingredient).length > 0,
  );

  return goals.map((goalKey) => {
    const candidates = ingredients.flatMap((ingredient) =>
      findIngredientRows(goalKey, ingredient).map((row) =>
        scoreCandidate(
          goalKey,
          ingredient,
          row,
          input.disclosureQuality,
          Boolean(input.proprietaryBlendWithoutClearActives),
        ),
      ),
    );

    if (candidates.length === 0) {
      return buildNoMatch(goalKey);
    }

    const sortedCandidates = [...candidates].sort(sortCandidates);
    const primary = sortedCandidates[0];
    const corroboratingMatches = sortedCandidates.filter(
      (candidate, index) => index > 0 && candidate.tier !== 'no_match',
    );
    const reasons = [...primary.reasons];
    const caps = Array.from(new Set(sortedCandidates.flatMap((candidate) => candidate.caps)));
    const corroborationBonus = Math.min(8, corroboratingMatches.length * 4);

    if (corroboratingMatches.length > 0) {
      reasons.push(
        makeReason('multiple_supporting_ingredients', 'goal_corroboration', 'derived', {
          count: corroboratingMatches.length + 1,
        }),
      );
    }

    return {
      goalKey,
      score: clampScore(primary.score + corroborationBonus),
      tier: primary.tier,
      reasons,
      ...(caps.length > 0 ? { caps } : {}),
      confidence: primary.confidence,
    };
  });
};

export const goalMatchScoringInternals = {
  canonicalizeIngredientKey,
  normalizeIngredientKey,
  normalizeTextKey,
  normalizeUnit,
  evaluateDose,
  scoreToTier,
};
