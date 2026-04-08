import goalIngredientMapV1Data from '../../../data/personalization/goal_ingredient_map.v1.json';
import goalIngredientMapV2Data from '../../../data/personalization/goal_ingredient_map.v2.json';
import type { GoalKey, ProductGoalMatchTier } from '../../../types/personalization';
import { flatMapCompat } from '@/lib/utils/arrayCompat';
import { listActiveGoalCatalogEntries, normalizeGoalKeys, getGoalLabel } from './goalCatalog';
import {
  getFormulaPatternProvenance,
  getIngredientGoalProvenance,
  projectGoalIngredientMapV2FromEvidenceGraph,
} from './goalEvidenceGraph';
import type { EvidenceGraphProvenance } from './goalEvidenceGraph';

export type EvidenceTierV2 = 'A' | 'B' | 'C' | 'D';

export type IngredientGoalEdgeV2 = {
  ingredientKey: string;
  goalKey: GoalKey;
  evidenceTier: EvidenceTierV2;
  baseWeight: number;
  minDoseHint: number;
  doseUnit: 'mcg' | 'mg' | 'g';
  maxUsefulDoseHint?: number | null;
  formConstraint?: string[];
  notes?: string[];
  caps?: string[];
  provenance?: EvidenceGraphProvenance[];
};

export type FormulaPatternV2 = {
  goalKey: GoalKey;
  requiredIngredients: string[];
  optionalIngredients?: string[];
  bonusWeight: number;
  reasonCodes: string[];
  provenance?: EvidenceGraphProvenance[];
};

type GoalIngredientMatchRecordV1 = {
  ingredientKey: string;
  tier: ProductGoalMatchTier;
  evidenceGrade: Exclude<EvidenceTierV2, 'D'>;
  minEffectiveDose: number;
  unit: 'mcg' | 'mg' | 'g';
  preferredForms: string[];
  caps: string[];
  rationale: string;
};

type GoalIngredientMapFileV1 = {
  version?: string;
  mappings: {
    goalKey: GoalKey;
    ingredientMatches: GoalIngredientMatchRecordV1[];
  }[];
  goalIngredientMap: {
    goalKey: GoalKey;
    ingredientKey: string;
    tier: 'strong' | 'supporting' | 'exploratory';
    evidenceGrade: Exclude<EvidenceTierV2, 'D'>;
    minEffectiveDose: number;
    unit: 'mcg' | 'mg' | 'g';
    preferredForms: string[];
    caps: string[];
    rationale: string;
  }[];
};

type GoalIngredientMapFileV2 = {
  version?: string;
  edges?: IngredientGoalEdgeV2[];
  formulaPatterns?: FormulaPatternV2[];
};

export type GoalIngredientPreviewLane = {
  goalKey: GoalKey;
  goalLabel: string;
  ingredientKeys: string[];
};

type GoalMatchOntology = {
  version: 'v1' | 'v2' | 'graph_v1';
  edges: IngredientGoalEdgeV2[];
  formulaPatterns: FormulaPatternV2[];
  edgesByGoal: ReadonlyMap<GoalKey, IngredientGoalEdgeV2[]>;
  formulaPatternsByGoal: ReadonlyMap<GoalKey, FormulaPatternV2[]>;
};

const GOAL_INGREDIENT_MAP_V1 = goalIngredientMapV1Data as GoalIngredientMapFileV1;
const GOAL_INGREDIENT_MAP_V2 = goalIngredientMapV2Data as GoalIngredientMapFileV2;

const V1_BASE_WEIGHT_BY_TIER: Record<ProductGoalMatchTier, number> = {
  strong_match: 0.88,
  related: 0.58,
  weak_match: 0.24,
  no_match: 0,
};

const EVIDENCE_TIER_PRIORITY: Record<EvidenceTierV2, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

const LEGACY_TIER_TO_V1_GROUPED: Record<ProductGoalMatchTier, 'strong' | 'supporting' | 'exploratory'> = {
  strong_match: 'strong',
  related: 'supporting',
  weak_match: 'exploratory',
  no_match: 'exploratory',
};

const V1_GROUPED_TO_LEGACY_TIER: Record<'strong' | 'supporting' | 'exploratory', ProductGoalMatchTier> = {
  strong: 'strong_match',
  supporting: 'related',
  exploratory: 'weak_match',
};

let cachedOntology: GoalMatchOntology | null = null;

const normalizeEdge = (edge: IngredientGoalEdgeV2): IngredientGoalEdgeV2 => ({
  ingredientKey: edge.ingredientKey,
  goalKey: edge.goalKey,
  evidenceTier: edge.evidenceTier,
  baseWeight: edge.baseWeight,
  minDoseHint: edge.minDoseHint,
  doseUnit: edge.doseUnit,
  ...(edge.maxUsefulDoseHint != null ? { maxUsefulDoseHint: edge.maxUsefulDoseHint } : {}),
  ...(edge.formConstraint?.length ? { formConstraint: [...new Set(edge.formConstraint)] } : {}),
  ...(edge.notes?.length ? { notes: [...new Set(edge.notes)] } : {}),
  ...(edge.caps?.length ? { caps: [...new Set(edge.caps)] } : {}),
  ...(edge.provenance?.length ? { provenance: edge.provenance } : {}),
});

const toV2EdgesFromV1 = (): IngredientGoalEdgeV2[] =>
  flatMapCompat(GOAL_INGREDIENT_MAP_V1.mappings, (mapping) =>
    mapping.ingredientMatches.map((match) =>
      normalizeEdge({
        ingredientKey: match.ingredientKey,
        goalKey: mapping.goalKey,
        evidenceTier: match.evidenceGrade,
        baseWeight: V1_BASE_WEIGHT_BY_TIER[match.tier] ?? 0.24,
        minDoseHint: match.minEffectiveDose,
        doseUnit: match.unit,
        ...(match.preferredForms.length > 0 ? { formConstraint: match.preferredForms } : {}),
        ...(match.rationale ? { notes: [match.rationale] } : {}),
        ...(match.caps.length > 0 ? { caps: match.caps } : {}),
      }),
    ),
  );

const buildOntology = (): GoalMatchOntology => {
  const graphProjection = projectGoalIngredientMapV2FromEvidenceGraph();
  const graphEdges = Array.isArray(graphProjection.edges) ? graphProjection.edges : [];
  const graphFormulaPatterns = Array.isArray(graphProjection.formulaPatterns)
    ? graphProjection.formulaPatterns
    : [];
  const candidateEdges = Array.isArray(GOAL_INGREDIENT_MAP_V2.edges)
    ? GOAL_INGREDIENT_MAP_V2.edges
    : [];
  const v2FormulaPatterns = Array.isArray(GOAL_INGREDIENT_MAP_V2.formulaPatterns)
    ? GOAL_INGREDIENT_MAP_V2.formulaPatterns.map((pattern) => ({
      goalKey: pattern.goalKey,
      requiredIngredients: [...new Set(pattern.requiredIngredients)],
      ...(pattern.optionalIngredients?.length
        ? { optionalIngredients: [...new Set(pattern.optionalIngredients)] }
        : {}),
      bonusWeight: pattern.bonusWeight,
      reasonCodes: [...new Set(pattern.reasonCodes)],
      ...(pattern.provenance?.length ? { provenance: pattern.provenance } : {}),
    }))
    : [];
  const sourceVersion = graphEdges.length > 0
    ? 'graph_v1'
    : candidateEdges.length > 0
      ? 'v2'
      : 'v1';
  const edges = sourceVersion === 'graph_v1'
    ? graphEdges.map(normalizeEdge)
    : candidateEdges.length > 0
      ? candidateEdges.map(normalizeEdge)
      : toV2EdgesFromV1();
  const formulaPatterns = sourceVersion === 'graph_v1' ? graphFormulaPatterns : v2FormulaPatterns;
  const edgesByGoal = new Map<GoalKey, IngredientGoalEdgeV2[]>();
  const formulaPatternsByGoal = new Map<GoalKey, FormulaPatternV2[]>();

  listActiveGoalCatalogEntries().forEach((goal) => {
    edgesByGoal.set(goal.goalKey, edges.filter((edge) => edge.goalKey === goal.goalKey));
    formulaPatternsByGoal.set(
      goal.goalKey,
      formulaPatterns.filter((pattern) => pattern.goalKey === goal.goalKey),
    );
  });

  return {
    version: sourceVersion,
    edges,
    formulaPatterns,
    edgesByGoal,
    formulaPatternsByGoal,
  };
};

const getOntology = (): GoalMatchOntology => {
  if (!cachedOntology) {
    cachedOntology = buildOntology();
  }

  return cachedOntology;
};

const toLegacyTier = (edge: IngredientGoalEdgeV2): ProductGoalMatchTier => {
  if (edge.evidenceTier === 'D' || edge.baseWeight < 0.18) return 'no_match';
  if (edge.baseWeight >= 0.8) return 'strong_match';
  if (edge.baseWeight >= 0.45) return 'related';
  return 'weak_match';
};

const sortPreviewEdges = (left: IngredientGoalEdgeV2, right: IngredientGoalEdgeV2): number => {
  const safeDelta = Number(!right.caps?.includes('eligibility_requires_generic_safety_path'))
    - Number(!left.caps?.includes('eligibility_requires_generic_safety_path'));
  if (safeDelta !== 0) return safeDelta;

  const weightDelta = right.baseWeight - left.baseWeight;
  if (weightDelta !== 0) return weightDelta;

  return EVIDENCE_TIER_PRIORITY[right.evidenceTier] - EVIDENCE_TIER_PRIORITY[left.evidenceTier];
};

export const getIngredientGoalEdges = (goalKey: GoalKey): IngredientGoalEdgeV2[] =>
  [...(getOntology().edgesByGoal.get(goalKey) ?? [])];

export const getFormulaPatterns = (goalKey: GoalKey): FormulaPatternV2[] =>
  [...(getOntology().formulaPatternsByGoal.get(goalKey) ?? [])];

export { getIngredientGoalProvenance, getFormulaPatternProvenance, projectGoalIngredientMapV2FromEvidenceGraph };

export const buildGoalIngredientPreviewLanes = (
  goals: readonly GoalKey[],
): GoalIngredientPreviewLane[] =>
  normalizeGoalKeys([...goals]).map((goalKey) => {
    const edges = getIngredientGoalEdges(goalKey)
      .filter((edge) => edge.evidenceTier !== 'D')
      .slice()
      .sort(sortPreviewEdges)
    const safeEdges = edges.filter((edge) => !edge.caps?.includes('eligibility_requires_generic_safety_path'));
    const ingredientKeys = (safeEdges.length > 0 ? safeEdges : edges)
      .map((edge) => edge.ingredientKey)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 3);

    return {
      goalKey,
      goalLabel: getGoalLabel(goalKey) ?? goalKey,
      ingredientKeys,
    };
  });

export const projectLegacyGoalIngredientMap = (): GoalIngredientMapFileV1 => {
  const ontology = getOntology();
  const legacyFlatRowByKey = new Map(
    GOAL_INGREDIENT_MAP_V1.goalIngredientMap.map((row) => [`${row.goalKey}:${row.ingredientKey}`, row] as const),
  );
  const grouped = listActiveGoalCatalogEntries().map((goal) => {
    const ingredientMatches = (ontology.edgesByGoal.get(goal.goalKey) ?? [])
      .filter((edge) => edge.evidenceTier !== 'D' && toLegacyTier(edge) !== 'no_match')
      .map((edge) => {
        const legacyFlatRow = legacyFlatRowByKey.get(`${edge.goalKey}:${edge.ingredientKey}`);
        if (legacyFlatRow) {
          return {
            ingredientKey: edge.ingredientKey,
            tier: V1_GROUPED_TO_LEGACY_TIER[legacyFlatRow.tier],
            evidenceGrade: legacyFlatRow.evidenceGrade,
            minEffectiveDose: legacyFlatRow.minEffectiveDose,
            unit: legacyFlatRow.unit,
            preferredForms: [...legacyFlatRow.preferredForms],
            caps: [...legacyFlatRow.caps],
            rationale: legacyFlatRow.rationale,
          };
        }

        return {
          ingredientKey: edge.ingredientKey,
          tier: toLegacyTier(edge),
          evidenceGrade: edge.evidenceTier === 'D' ? 'C' : edge.evidenceTier,
          minEffectiveDose: edge.minDoseHint,
          unit: edge.doseUnit,
          preferredForms: [...(edge.formConstraint ?? [])],
          caps: [...(edge.caps ?? [])],
          rationale: edge.notes?.[0] ?? `${getGoalLabel(edge.goalKey) ?? edge.goalKey} support mapping`,
        };
      });

    return {
      goalKey: goal.goalKey,
      ingredientMatches,
    };
  });

  return {
    version: 'v1',
    mappings: grouped,
    goalIngredientMap: flatMapCompat(grouped, (mapping) =>
      mapping.ingredientMatches.map((match) => ({
        goalKey: mapping.goalKey,
        ingredientKey: match.ingredientKey,
        tier: LEGACY_TIER_TO_V1_GROUPED[match.tier],
        evidenceGrade: match.evidenceGrade,
        minEffectiveDose: match.minEffectiveDose,
        unit: match.unit,
        preferredForms: match.preferredForms,
        caps: match.caps,
        rationale: match.rationale,
      })),
    ),
  };
};

export const goalMatchOntologyInternals = {
  toLegacyTier,
  sortPreviewEdges,
  buildOntology,
};
