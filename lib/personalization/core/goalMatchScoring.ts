import type {
  ConfidenceBreakdown,
  DecisionReason,
  GoalKey,
  ProductGoalMatch,
  ProductGoalMatchTier,
} from '../../../types/personalization';
import {
  getFormulaPatterns,
  getIngredientGoalEdges,
  type EvidenceTierV2,
  type IngredientGoalEdgeV2,
} from './goalMatchOntology';
import {
  listActiveGoalCatalogEntries,
  normalizeGoalKeys,
} from './goalCatalog';

type DisclosureQuality = 'high' | 'medium' | 'low' | 'unknown';

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
  goals?: (GoalKey | string | null | undefined)[] | null;
  ingredients?: ProductIngredientLikeInput[] | null;
  disclosureQuality?: DisclosureQuality | null;
  proprietaryBlendWithoutClearActives?: boolean | null;
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
  | { status: 'within' }
  | { status: 'below' }
  | { status: 'uncertain' }
  | { status: 'above_safe' };

const TIER_ORDER: ProductGoalMatchTier[] = ['no_match', 'weak_match', 'related', 'strong_match'];

const SCORE_TO_TIER_THRESHOLDS: [number, ProductGoalMatchTier][] = [
  [85, 'strong_match'],
  [60, 'related'],
  [20, 'weak_match'],
];

const EVIDENCE_MULTIPLIER: Record<EvidenceTierV2, number> = {
  A: 1.08,
  B: 1,
  C: 0.85,
  D: 0.35,
};

const DOSE_MULTIPLIER = {
  below: 0.5,
  within: 1,
  above_safe: 0.9,
  uncertain: 0.7,
  not_applicable: 1,
} as const;

const FORM_MULTIPLIER = {
  preferred: 1.08,
  neutral: 1,
} as const;

export type GoalNarrativeFitLevel = 'strong' | 'some' | 'limited' | 'none' | 'unknown';

const LABEL_CONFIDENCE_MULTIPLIER: Record<DisclosureQuality, number> = {
  high: 1,
  medium: 0.92,
  low: 0.78,
  unknown: 1,
};

const PATTERN_BONUS_MULTIPLIER = 25;
const CORROBORATION_BONUS_PER_MATCH = 4;
const CORROBORATION_BONUS_CAP = 8;

const INGREDIENT_KEY_ALIASES: Record<string, string> = {
  coq10: 'coenzyme_q10',
  coenzymeq10: 'coenzyme_q10',
  vitaminb12: 'vitamin_b12',
  vitaminb_12: 'vitamin_b12',
  vitamind: 'vitamin_d',
  vitamind3: 'vitamin_d',
  vitamin_d3: 'vitamin_d',
  fishoil: 'omega_3',
  omega3: 'omega_3',
  omega_3fattyacids: 'omega_3',
  proteinblend: 'protein',
  wheyprotein: 'protein',
  creatinemonohydrate: 'creatine',
};

const CONVERTIBLE_UNIT_TO_MG: Record<string, number> = {
  mcg: 0.001,
  mg: 1,
  g: 1000,
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

const normalizeEvidenceTier = (value: string | null | undefined): EvidenceTierV2 | null => {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D') return value;
  return null;
};

const normalizeAuditStatus = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = normalizeFreeformToken(value);
  return normalized || null;
};

const isAuditedStatus = (value: string | null): boolean =>
  value === 'approved' || value === 'verified' || value === 'reviewed' || value === 'captured';

const normalizeDisclosureQuality = (
  productDisclosure: DisclosureQuality | null | undefined,
  ingredientDisclosure: DisclosureQuality | null | undefined,
): DisclosureQuality => ingredientDisclosure ?? productDisclosure ?? 'unknown';

const normalizeUnit = (value: string | null | undefined): 'mcg' | 'mg' | 'g' | null => {
  if (!value) return null;
  const normalized = normalizeFreeformToken(value);
  if (normalized === 'mcg' || normalized === 'ug') return 'mcg';
  if (normalized === 'mg' || normalized === 'milligram' || normalized === 'milligrams') return 'mg';
  if (normalized === 'g' || normalized === 'gram' || normalized === 'grams') return 'g';
  return null;
};

const convertDose = (amount: number, unit: 'mcg' | 'mg' | 'g'): number | null => {
  const factor = CONVERTIBLE_UNIT_TO_MG[unit];
  if (!factor) return null;
  return amount * factor;
};

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

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

const scoreToTier = (score: number): ProductGoalMatchTier => {
  for (const [threshold, tier] of SCORE_TO_TIER_THRESHOLDS) {
    if (score >= threshold) return tier;
  }
  return 'no_match';
};

const GOAL_UNCERTAINTY_REASON_CODES = new Set([
  'goal_support_not_enough_label_detail',
  'personalization.product_evaluation.not_enough_structured_data',
  'dose_not_disclosed',
  'low_disclosure_caps_strong_match',
  'proprietary_blend_caps_goal_match',
]);

export const mapNarrativeLabelCompleteness = (
  value: ConfidenceBreakdown['labelCompleteness'] | null | undefined,
): 'high' | 'medium' | 'low' => {
  switch (value) {
    case 'full':
      return 'high';
    case 'partial':
      return 'medium';
    case 'weak':
    default:
      return 'low';
  }
};

export const normalizeGoalNarrativeFitLevel = (params: {
  tier: ProductGoalMatchTier | 'unknown';
  reasonCodes?: string[] | null;
  coverageStatus?: 'coverage_ready' | 'not_enough_structured_data' | null;
  labelCompleteness?: ConfidenceBreakdown['labelCompleteness'] | null;
}): GoalNarrativeFitLevel => {
  const reasonCodes = params.reasonCodes ?? [];
  const hasUnknownSignal =
    params.coverageStatus === 'not_enough_structured_data'
    || reasonCodes.some((code) => GOAL_UNCERTAINTY_REASON_CODES.has(code));

  if (hasUnknownSignal || params.tier === 'unknown') {
    return 'unknown';
  }

  switch (params.tier) {
    case 'strong_match':
      return 'strong';
    case 'related':
      return 'some';
    case 'weak_match':
      return 'limited';
    case 'no_match':
    default:
      return 'none';
  }
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

const resolveEvidenceForGoal = (
  ingredient: ProductIngredientLikeInput,
  goalKey: GoalKey,
): GoalEvidenceLikeInput | null =>
  (ingredient.evidence ?? []).find(
    (row) => normalizeGoalKeys([row.goalKey ?? row.goal ?? null])[0] === goalKey,
  ) ?? null;

const resolveIngredientAmount = (ingredient: ProductIngredientLikeInput): number | null => {
  if (ingredient.amountUnknown) return null;
  return typeof ingredient.amount === 'number' && ingredient.amount > 0 ? ingredient.amount : null;
};

const resolveIngredientUnit = (ingredient: ProductIngredientLikeInput): 'mcg' | 'mg' | 'g' | null =>
  normalizeUnit(ingredient.amountUnitNormalized ?? ingredient.unit ?? ingredient.amountUnit ?? null);

const resolveEvidenceTier = (
  evidence: GoalEvidenceLikeInput | null,
  edge: IngredientGoalEdgeV2,
): EvidenceTierV2 => normalizeEvidenceTier(evidence?.evidenceGrade ?? evidence?.evidence_grade ?? null) ?? edge.evidenceTier;

const resolveDoseHint = (
  evidence: GoalEvidenceLikeInput | null,
  edge: IngredientGoalEdgeV2,
): { minDoseHint: number | null; doseUnit: 'mcg' | 'mg' | 'g' | null } => {
  const minDoseHint = evidence?.minEffectiveDose ?? evidence?.min_effective_dose ?? edge.minDoseHint ?? null;
  const doseUnit = normalizeUnit(evidence?.unit ?? edge.doseUnit ?? null);
  return {
    minDoseHint: typeof minDoseHint === 'number' && minDoseHint > 0 ? minDoseHint : null,
    doseUnit,
  };
};

const evaluateDose = (
  amount: number | null | undefined,
  unit: 'mcg' | 'mg' | 'g' | null | undefined,
  minDoseHint: number | null,
  doseUnit: 'mcg' | 'mg' | 'g' | null,
  maxUsefulDoseHint?: number | null,
): DoseEvaluation => {
  if (minDoseHint == null || !doseUnit) {
    return { status: 'not_applicable' };
  }

  if (typeof amount !== 'number' || amount <= 0 || !unit) {
    return { status: 'uncertain' };
  }

  const amountInMg = convertDose(amount, unit);
  const floorInMg = convertDose(minDoseHint, doseUnit);
  const maxInMg =
    typeof maxUsefulDoseHint === 'number' && maxUsefulDoseHint > 0
      ? convertDose(maxUsefulDoseHint, doseUnit)
      : null;

  if (amountInMg == null || floorInMg == null) {
    return { status: 'uncertain' };
  }

  if (amountInMg < floorInMg) {
    return { status: 'below' };
  }

  if (maxInMg != null && amountInMg > maxInMg) {
    return { status: 'above_safe' };
  }

  return { status: 'within' };
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

const normalizeIngredientKey = (ingredient: ProductIngredientLikeInput): string | null =>
  getIngredientLookupTokens(ingredient)[0] ?? null;

const findIngredientEdges = (
  goalKey: GoalKey,
  ingredient: ProductIngredientLikeInput,
): IngredientGoalEdgeV2[] => {
  const goalEdges = getIngredientGoalEdges(goalKey);
  const tokens = getIngredientLookupTokens(ingredient);
  if (tokens.length === 0) return [];

  return goalEdges.filter((edge) =>
    tokens.some((token) => tokenMatchesIngredientKey(token, canonicalizeIngredientKey(edge.ingredientKey))));
};

const resolveTierCapFromEdge = (
  edge: IngredientGoalEdgeV2,
  evidenceTier: EvidenceTierV2,
): ProductGoalMatchTier => {
  if (evidenceTier === 'D' || edge.baseWeight < 0.18) return 'no_match';
  if (edge.baseWeight >= 0.8) return 'strong_match';
  if (edge.baseWeight >= 0.45) return 'related';
  return 'weak_match';
};

const scoreCandidate = (
  goalKey: GoalKey,
  ingredient: ProductIngredientLikeInput,
  edge: IngredientGoalEdgeV2,
  productDisclosureQuality: DisclosureQuality | null | undefined,
  proprietaryBlendWithoutClearActives: boolean,
): ScoredCandidate => {
  const ingredientLabel =
    ingredient.ingredientLabel?.trim() ||
    ingredient.name?.trim() ||
    edge.ingredientKey.replace(/_/g, ' ');
  const evidence = resolveEvidenceForGoal(ingredient, goalKey);
  const evidenceTier = resolveEvidenceTier(evidence, edge);
  const { minDoseHint, doseUnit } = resolveDoseHint(evidence, edge);
  const evidenceAuditStatus = normalizeAuditStatus(evidence?.auditStatus ?? evidence?.audit_status ?? null);
  const amount = resolveIngredientAmount(ingredient);
  const amountUnit = resolveIngredientUnit(ingredient);
  const disclosureQuality = normalizeDisclosureQuality(
    productDisclosureQuality,
    ingredient.disclosureQuality,
  );
  const normalizedForm = normalizeTextKey(ingredient.formKey ?? ingredient.formLabel ?? ingredient.form ?? '');
  const hasPreferredForm =
    Boolean(normalizedForm) &&
    (edge.formConstraint ?? []).some((form) => canonicalizeIngredientKey(form) === normalizedForm);
  const doseEvaluation = evaluateDose(amount, amountUnit, minDoseHint, doseUnit, edge.maxUsefulDoseHint);
  const baseScore = edge.baseWeight * 100;
  let score =
    baseScore *
    EVIDENCE_MULTIPLIER[evidenceTier] *
    DOSE_MULTIPLIER[doseEvaluation.status] *
    (hasPreferredForm ? FORM_MULTIPLIER.preferred : FORM_MULTIPLIER.neutral) *
    LABEL_CONFIDENCE_MULTIPLIER[disclosureQuality];

  let maxTier = resolveTierCapFromEdge(edge, evidenceTier);
  const caps: string[] = [];
  const reasons: DecisionReason[] = [
    makeReason('goal_supported_by_ingredient', 'goal_map_match_v2', 'catalog', {
      goalKey,
      ingredientKey: edge.ingredientKey,
      ingredientLabel,
    }),
  ];

  reasons.push(
    makeReason('goal_specific_evidence_present', 'goal_specific_evidence_v2', 'catalog', {
      ingredientKey: edge.ingredientKey,
      evidenceGrade: evidenceTier,
      source: evidence ? 'ingredient_evidence' : 'goal_map',
    }),
  );

  if (evidenceTier === 'C' || evidenceTier === 'D') {
    reasons.push(
      makeReason('evidence_grade_limited', 'goal_specific_evidence_v2', 'catalog', {
        ingredientKey: edge.ingredientKey,
        evidenceGrade: evidenceTier,
      }),
    );
  }

  if (evidenceAuditStatus && !isAuditedStatus(evidenceAuditStatus)) {
    score *= 0.9;
    maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
    reasons.push(
      makeReason('goal_specific_evidence_unreviewed', 'goal_specific_evidence_v2', 'catalog', {
        auditStatus: evidenceAuditStatus,
        ingredientKey: edge.ingredientKey,
      }),
    );
  }

  switch (doseEvaluation.status) {
    case 'within':
      reasons.push(
        makeReason('dose_meets_effective_floor', 'dose_floor_check_v2', 'derived', {
          ingredientKey: edge.ingredientKey,
        }),
      );
      break;
    case 'below':
      maxTier = applyTierCap(maxTier, 'weak_match');
      reasons.push(
        makeReason('dose_below_effective_floor', 'dose_floor_check_v2', 'derived', {
          ingredientKey: edge.ingredientKey,
        }),
      );
      break;
    case 'uncertain':
      maxTier = applyTierCap(maxTier, downgradeTier(maxTier));
      reasons.push(
        makeReason('dose_not_disclosed', 'dose_floor_check_v2', 'observed', {
          ingredientKey: edge.ingredientKey,
        }),
      );
      reasons.push(
        makeReason('goal_support_not_enough_label_detail', 'goal_uncertainty_v2', 'derived', {
          ingredientKey: edge.ingredientKey,
          goalKey,
        }),
      );
      break;
    case 'above_safe':
      reasons.push(
        makeReason('dose_above_reference_band', 'dose_floor_check_v2', 'derived', {
          ingredientKey: edge.ingredientKey,
        }),
      );
      break;
    case 'not_applicable':
    default:
      break;
  }

  if (hasPreferredForm) {
    reasons.push(
      makeReason('ingredient_form_preferred', 'ingredient_form_preference_v2', 'catalog', {
        ingredientKey: edge.ingredientKey,
        formKey: normalizedForm,
      }),
    );
  }

  if (disclosureQuality === 'low') {
    maxTier = applyTierCap(maxTier, 'weak_match');
    caps.push('low_disclosure');
    reasons.push(
      makeReason('low_disclosure_caps_strong_match', 'low_disclosure_caps_goal_match_v2', 'observed', {
        ingredientKey: edge.ingredientKey,
      }),
    );
    reasons.push(
      makeReason('goal_support_not_enough_label_detail', 'goal_uncertainty_v2', 'derived', {
        ingredientKey: edge.ingredientKey,
        goalKey,
      }),
    );
  }

  if (proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend) {
    score *= 0.82;
    maxTier = applyTierCap(maxTier, 'weak_match');
    caps.push('proprietary_blend');
    reasons.push(
      makeReason('proprietary_blend_caps_goal_match', 'proprietary_blend_caps_goal_match_v2', 'observed', {
        ingredientKey: edge.ingredientKey,
      }),
    );
    reasons.push(
      makeReason('goal_support_not_enough_label_detail', 'goal_uncertainty_v2', 'derived', {
        ingredientKey: edge.ingredientKey,
        goalKey,
      }),
    );
  }

  if (
    (edge.caps ?? []).includes('eligibility_requires_generic_safety_path') ||
    Boolean(evidence?.requiresGenericSafetyPath)
  ) {
    caps.push('generic_safety_path');
    reasons.push(
      makeReason('ingredient_requires_generic_safety_path', 'generic_safety_path_guardrail_v2', 'catalog', {
        ingredientKey: edge.ingredientKey,
      }),
    );
  }

  const confidence: NonNullable<ProductGoalMatch['confidence']> = {
    evidence:
      evidenceTier === 'A'
        ? 'high'
        : evidenceTier === 'B'
          ? 'medium'
          : 'low',
    dose:
      doseEvaluation.status === 'within'
        ? 'meets'
        : doseEvaluation.status === 'below'
          ? 'below'
          : doseEvaluation.status === 'uncertain'
            ? 'unknown'
            : 'not_applicable',
    disclosure:
      disclosureQuality === 'high' && !proprietaryBlendWithoutClearActives && !ingredient.proprietaryBlend
        ? 'full'
        : disclosureQuality === 'low' || proprietaryBlendWithoutClearActives || ingredient.proprietaryBlend
          ? 'weak'
          : 'partial',
  };

  const tier = applyTierCap(scoreToTier(clampScore(score)), maxTier);

  return {
    ingredientKey: edge.ingredientKey,
    ingredientLabel,
    score: clampScore(score),
    tier,
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

const buildNoMatch = (goalKey: GoalKey, missingDetail = false): ProductGoalMatch => ({
  goalKey,
  score: 0,
  tier: 'no_match',
  reasons: [
    makeReason(
      missingDetail ? 'goal_support_not_enough_label_detail' : 'no_goal_support_detected',
      missingDetail ? 'goal_uncertainty_v2' : 'goal_map_match_v2',
      'derived',
      { goalKey },
    ),
  ],
  confidence: {
    evidence: 'low',
    dose: 'not_applicable',
    disclosure: missingDetail ? 'partial' : 'weak',
  },
});

const getTargetGoals = (inputGoals: ProductGoalMatchScoringInput['goals']): GoalKey[] => {
  const normalized = normalizeGoalKeys(inputGoals);
  if (normalized.length > 0) {
    return normalized;
  }

  return listActiveGoalCatalogEntries().map((goal) => goal.goalKey);
};

const getPresentIngredientKeySet = (
  goals: GoalKey[],
  ingredients: ProductIngredientLikeInput[],
): Set<string> => {
  const relevantOntologyKeys = new Set<string>();

  for (const goalKey of goals) {
    for (const edge of getIngredientGoalEdges(goalKey)) {
      relevantOntologyKeys.add(canonicalizeIngredientKey(edge.ingredientKey));
    }
    for (const pattern of getFormulaPatterns(goalKey)) {
      for (const ingredientKey of pattern.requiredIngredients) {
        relevantOntologyKeys.add(canonicalizeIngredientKey(ingredientKey));
      }
      for (const ingredientKey of pattern.optionalIngredients ?? []) {
        relevantOntologyKeys.add(canonicalizeIngredientKey(ingredientKey));
      }
    }
  }

  return new Set(
    ingredients.flatMap((ingredient) => {
      const tokens = getIngredientLookupTokens(ingredient);
      const normalizedIngredientKey = normalizeIngredientKey(ingredient);
      const matchedOntologyKeys = Array.from(relevantOntologyKeys).filter((ingredientKey) =>
        tokens.some((token) => tokenMatchesIngredientKey(token, ingredientKey)),
      );

      if (matchedOntologyKeys.length > 0) {
        return matchedOntologyKeys;
      }

      return normalizedIngredientKey ? [normalizedIngredientKey] : [];
    }),
  );
};

const computePatternBonus = (
  goalKey: GoalKey,
  presentIngredientKeys: Set<string>,
  candidates: ScoredCandidate[],
): { bonus: number; reasons: DecisionReason[] } => {
  const patterns = getFormulaPatterns(goalKey);
  if (patterns.length === 0) return { bonus: 0, reasons: [] };

  const strongestTierByIngredient = new Map<string, ProductGoalMatchTier>();
  candidates.forEach((candidate) => {
    const ingredientKey = canonicalizeIngredientKey(candidate.ingredientKey);
    const current = strongestTierByIngredient.get(ingredientKey);
    if (!current || compareTier(candidate.tier, current) > 0) {
      strongestTierByIngredient.set(ingredientKey, candidate.tier);
    }
  });

  const matchedPatterns = patterns.filter((pattern) =>
    pattern.requiredIngredients.every((ingredientKey) => presentIngredientKeys.has(canonicalizeIngredientKey(ingredientKey)))
    && pattern.requiredIngredients.some((ingredientKey) => {
      const tier = strongestTierByIngredient.get(canonicalizeIngredientKey(ingredientKey));
      return tier === 'related' || tier === 'strong_match';
    }),
  );

  if (matchedPatterns.length === 0) return { bonus: 0, reasons: [] };

  return {
    bonus: Math.min(
      12,
      matchedPatterns.reduce((total, pattern) => total + pattern.bonusWeight * PATTERN_BONUS_MULTIPLIER, 0),
    ),
    reasons: matchedPatterns.flatMap((pattern) =>
      pattern.reasonCodes.map((reasonCode) =>
        makeReason(reasonCode, 'formula_pattern_support_v2', 'catalog', { goalKey }),
      ),
    ),
  };
};

export const scoreProductGoalMatches = (input: ProductGoalMatchScoringInput): ProductGoalMatch[] => {
  const goals = getTargetGoals(input.goals);
  const ingredients = (input.ingredients ?? []).filter(
    (ingredient): ingredient is ProductIngredientLikeInput =>
      getIngredientLookupTokens(ingredient).length > 0,
  );
  const presentIngredientKeys = getPresentIngredientKeySet(goals, ingredients);

  return goals.map((goalKey) => {
    const candidates = ingredients.flatMap((ingredient) =>
      findIngredientEdges(goalKey, ingredient).map((edge) =>
        scoreCandidate(
          goalKey,
          ingredient,
          edge,
          input.disclosureQuality,
          Boolean(input.proprietaryBlendWithoutClearActives),
        ),
      ),
    );

    if (candidates.length === 0) {
      return buildNoMatch(goalKey, ingredients.some((ingredient) => resolveIngredientAmount(ingredient) == null));
    }

    const sortedCandidates = [...candidates].sort(sortCandidates);
    const primary = sortedCandidates[0];
    const corroboratingMatches = sortedCandidates.filter(
      (candidate, index) => index > 0 && candidate.tier !== 'no_match',
    );
    const { bonus: patternBonus, reasons: patternReasons } = computePatternBonus(
      goalKey,
      presentIngredientKeys,
      sortedCandidates,
    );
    const corroborationBonus = Math.min(CORROBORATION_BONUS_CAP, corroboratingMatches.length * CORROBORATION_BONUS_PER_MATCH);
    const score = clampScore((primary?.score ?? 0) + corroborationBonus + patternBonus);
    const tier = applyTierCap(scoreToTier(score), primary?.tier ?? 'no_match');
    const reasons = [...(primary?.reasons ?? []), ...patternReasons];
    const caps = Array.from(new Set(sortedCandidates.flatMap((candidate) => candidate.caps)));

    if (corroboratingMatches.length > 0) {
      reasons.push(
        makeReason('multiple_supporting_ingredients', 'goal_corroboration_v2', 'derived', {
          count: corroboratingMatches.length + 1,
        }),
      );
    }

    return {
      goalKey,
      score,
      tier,
      reasons,
      ...(caps.length > 0 ? { caps } : {}),
      confidence: primary?.confidence ?? {
        evidence: 'low',
        dose: 'not_applicable',
        disclosure: 'weak',
      },
    };
  });
};

export const goalMatchScoringInternals = {
  canonicalizeIngredientKey,
  normalizeIngredientKey,
  normalizeTextKey,
  normalizeUnit,
  evaluateDose,
  mapNarrativeLabelCompleteness,
  normalizeGoalNarrativeFitLevel,
  scoreToTier,
};
