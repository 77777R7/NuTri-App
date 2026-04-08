import evidenceGraphData from '../../../data/personalization/evidence_graph.v1.json';
import type { GoalKey } from '../../../types/personalization';

export type EvidenceTierV2 = 'A' | 'B' | 'C' | 'D';

export type EvidenceGraphProvenanceSourceType =
  | 'ontology_migration'
  | 'review_article'
  | 'systematic_review'
  | 'clinical_guideline'
  | 'internal_curation';

export type EvidenceGraphProvenance = {
  sourceType: EvidenceGraphProvenanceSourceType;
  sourceKey: string;
  title: string;
  citation?: string;
  url?: string;
  note?: string;
};

export type EvidenceGraphIngredientNode = {
  ingredientKey: string;
  label: string;
};

export type EvidenceGraphGoalNode = {
  goalKey: GoalKey;
  label: string;
};

export type EvidenceGraphIngredientGoalEdge = {
  ingredientKey: string;
  goalKey: GoalKey;
  relation: 'supports_goal';
  evidenceTier: EvidenceTierV2;
  baseWeight: number;
  minDoseHint: number;
  doseUnit: 'mcg' | 'mg' | 'g';
  maxUsefulDoseHint?: number | null;
  formConstraint?: string[];
  notes?: string[];
  caps?: string[];
  provenance: EvidenceGraphProvenance[];
};

export type EvidenceGraphFormulaPattern = {
  goalKey: GoalKey;
  requiredIngredients: string[];
  optionalIngredients?: string[];
  bonusWeight: number;
  reasonCodes: string[];
  provenance: EvidenceGraphProvenance[];
};

type EvidenceGraphFileV1 = {
  version?: string;
  ingredientNodes?: EvidenceGraphIngredientNode[];
  goalNodes?: EvidenceGraphGoalNode[];
  ingredientGoalEdges?: EvidenceGraphIngredientGoalEdge[];
  formulaPatterns?: EvidenceGraphFormulaPattern[];
};

type GoalIngredientMapV2Projection = {
  version: 'v2';
  edges: {
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
  }[];
  formulaPatterns: {
    goalKey: GoalKey;
    requiredIngredients: string[];
    optionalIngredients?: string[];
    bonusWeight: number;
    reasonCodes: string[];
    provenance?: EvidenceGraphProvenance[];
  }[];
};

const EVIDENCE_GRAPH = evidenceGraphData as EvidenceGraphFileV1;

const normalizeUniqueStrings = (values?: string[]) =>
  values?.map((value) => value.trim()).filter(Boolean).filter((value, index, array) => array.indexOf(value) === index) ?? [];

const normalizeProvenance = (
  provenance: EvidenceGraphProvenance[] | undefined,
): EvidenceGraphProvenance[] =>
  (provenance ?? [])
    .map((entry) => ({
      sourceType: entry.sourceType,
      sourceKey: entry.sourceKey,
      title: entry.title.trim(),
      ...(typeof entry.citation === 'string' && entry.citation.trim().length > 0 ? { citation: entry.citation.trim() } : {}),
      ...(typeof entry.url === 'string' && entry.url.trim().length > 0 ? { url: entry.url.trim() } : {}),
      ...(typeof entry.note === 'string' && entry.note.trim().length > 0 ? { note: entry.note.trim() } : {}),
    }))
    .filter(
      (entry) => entry.sourceKey.length > 0 && entry.title.length > 0,
    )
    .filter((entry, index, array) => {
      const key = `${entry.sourceType}:${entry.sourceKey}:${entry.title}`;
      return array.findIndex((candidate) =>
        `${candidate.sourceType}:${candidate.sourceKey}:${candidate.title}` === key) === index;
    });

const normalizeIngredientGoalEdge = (
  edge: EvidenceGraphIngredientGoalEdge,
): GoalIngredientMapV2Projection['edges'][number] => ({
  ingredientKey: edge.ingredientKey,
  goalKey: edge.goalKey,
  evidenceTier: edge.evidenceTier,
  baseWeight: edge.baseWeight,
  minDoseHint: edge.minDoseHint,
  doseUnit: edge.doseUnit,
  ...(edge.maxUsefulDoseHint != null ? { maxUsefulDoseHint: edge.maxUsefulDoseHint } : {}),
  ...(normalizeUniqueStrings(edge.formConstraint).length > 0 ? { formConstraint: normalizeUniqueStrings(edge.formConstraint) } : {}),
  ...(normalizeUniqueStrings(edge.notes).length > 0 ? { notes: normalizeUniqueStrings(edge.notes) } : {}),
  ...(normalizeUniqueStrings(edge.caps).length > 0 ? { caps: normalizeUniqueStrings(edge.caps) } : {}),
  ...(normalizeProvenance(edge.provenance).length > 0 ? { provenance: normalizeProvenance(edge.provenance) } : {}),
});

const normalizeFormulaPattern = (
  pattern: EvidenceGraphFormulaPattern,
): GoalIngredientMapV2Projection['formulaPatterns'][number] => ({
  goalKey: pattern.goalKey,
  requiredIngredients: normalizeUniqueStrings(pattern.requiredIngredients),
  ...(normalizeUniqueStrings(pattern.optionalIngredients).length > 0
    ? { optionalIngredients: normalizeUniqueStrings(pattern.optionalIngredients) }
    : {}),
  bonusWeight: pattern.bonusWeight,
  reasonCodes: normalizeUniqueStrings(pattern.reasonCodes),
  ...(normalizeProvenance(pattern.provenance).length > 0 ? { provenance: normalizeProvenance(pattern.provenance) } : {}),
});

export const projectGoalIngredientMapV2FromEvidenceGraph = (): GoalIngredientMapV2Projection => ({
  version: 'v2',
  edges: (EVIDENCE_GRAPH.ingredientGoalEdges ?? []).map(normalizeIngredientGoalEdge),
  formulaPatterns: (EVIDENCE_GRAPH.formulaPatterns ?? []).map(normalizeFormulaPattern),
});

export const getIngredientGoalProvenance = (
  goalKey: GoalKey,
  ingredientKey: string,
): EvidenceGraphProvenance[] =>
  normalizeProvenance(
    (EVIDENCE_GRAPH.ingredientGoalEdges ?? []).find(
      (edge) => edge.goalKey === goalKey && edge.ingredientKey === ingredientKey,
    )?.provenance,
  );

export const getFormulaPatternProvenance = (
  goalKey: GoalKey,
  requiredIngredients: string[],
): EvidenceGraphProvenance[] => {
  const normalizedRequired = normalizeUniqueStrings(requiredIngredients).sort();
  return normalizeProvenance(
    (EVIDENCE_GRAPH.formulaPatterns ?? []).find((pattern) => (
      pattern.goalKey === goalKey
      && [...normalizeUniqueStrings(pattern.requiredIngredients)].sort().join('|') === normalizedRequired.join('|')
    ))?.provenance,
  );
};

export const goalEvidenceGraphInternals = {
  normalizeIngredientGoalEdge,
  normalizeFormulaPattern,
  normalizeProvenance,
};
