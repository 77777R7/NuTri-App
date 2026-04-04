import { createHash } from "node:crypto";

import type { FactsDigest } from "./factsDigest.js";
import type { ScienceIngredientRow as DecisionSupportScienceIngredientRow } from "./iherbOverlayIngredients.js";
import { buildIngredientScienceContext } from "./ingredientScienceContext.js";
import { lookupSafeScienceSignals } from "./kbRuntime.js";
import {
  buildUlScopeNote,
  classifyUlRisk,
  convertDoseToUlUnit,
  formatDoseText,
  getUlLimitByLifeStage,
  lookupUlByCanonicalKey,
} from "./ods/ulDataset.js";
import { lookupQualityMarkAudit } from "./qualityMarks/cache.js";
import {
  buildQualityMarkProgramMatches,
  detectQualityMarkProgramIds,
  isGenericThirdPartyClaimEvidenceMatch,
  mergeQualityMarkSummaries,
  summarizeQualityMarkProgramMatches,
} from "./qualityMarks/matchers.js";
import { getQualityMarkProgramDefinition } from "./qualityMarks/programs.js";
import type { QualityMarkProgramMatch, QualityMarkVerificationSummary } from "./qualityMarks/types.js";
import { buildProductSafetySummary } from "./safety/productSafetySummary.js";
import type { UlGuidanceEntry } from "./safety/types.js";
import { buildAllergyInsight } from "./allergy/allergyInsightBuilder.js";
import * as goalMatchScoringModule from "../../lib/personalization/core/goalMatchScoring.ts";
import * as catalogProductEvaluationModule from "../../lib/personalization/core/catalogProductEvaluation.ts";
import * as goalFitCopyModule from "../../lib/personalization/goalFitCopy.ts";
import type { ProductIngredientLikeInput } from "../../lib/personalization/core/goalMatchScoring.ts";
import type {
  CatalogOverlayIngredientRow,
  CatalogProductEvaluationResult,
} from "../../lib/personalization/core/catalogProductEvaluation.ts";
import type {
  BlockerKey,
  ExperienceLevel,
  GoalKey,
  PersonalizationProfile,
  ProductGoalMatch,
  ProductGoalMatchTier,
  SupplementTypeKey,
} from "../../types/personalization.js";

const scoreProductGoalMatches =
  goalMatchScoringModule.scoreProductGoalMatches ??
  goalMatchScoringModule.default?.scoreProductGoalMatches;

const evaluateCatalogProduct =
  catalogProductEvaluationModule.evaluateCatalogProduct ??
  catalogProductEvaluationModule.default?.evaluateCatalogProduct;

const formatGoalFitReason =
  goalFitCopyModule.formatGoalFitReason ??
  goalFitCopyModule.default?.formatGoalFitReason;
const summarizeGoalFitReasons =
  goalFitCopyModule.summarizeGoalFitReasons ??
  goalFitCopyModule.default?.summarizeGoalFitReasons;

if (typeof scoreProductGoalMatches !== "function") {
  throw new Error("[decisionSupport] Failed to load scoreProductGoalMatches");
}
if (typeof evaluateCatalogProduct !== "function") {
  throw new Error("[decisionSupport] Failed to load evaluateCatalogProduct");
}
if (typeof formatGoalFitReason !== "function") {
  throw new Error("[decisionSupport] Failed to load formatGoalFitReason");
}
if (typeof summarizeGoalFitReasons !== "function") {
  throw new Error("[decisionSupport] Failed to load summarizeGoalFitReasons");
}

export type DecisionSupportViewMode = "details";

export type DecisionSupportSourceTier =
  | "official_record"
  | "scanned_label"
  | "overlay_iherb"
  | "general_science"
  | "inferred";

export type DecisionSupportSeverity = "high" | "medium" | "low";
export type DecisionSupportFixability = "fixable" | "ceiling" | "unknown";

export type DecisionSupportSubscoreId =
  | "GoalEvidenceFit"
  | "FormulaQuality"
  | "SafetyTransparency"
  | "TrustQualityAssurance";

export type DecisionSupportVerdict =
  | "strong_candidate"
  | "reasonable_but_incomplete"
  | "hard_to_recommend_until_label_verified";

export type DecisionSupportChecklistItem = {
  id: string;
  label: string;
  why?: string | null;
  passed: boolean;
  weight: number;
  sourceTier: DecisionSupportSourceTier;
  affectsCoreVerdict: boolean;
};

export type DecisionSupportSubscore = {
  id: DecisionSupportSubscoreId;
  score: number;
  passedWeight: number;
  totalWeight: number;
  checklistCount: number;
};

export type DecisionSupportBlocker = {
  code:
    | "missing_active_breakdown"
    | "missing_directions_dsld"
    | "warnings_missing_fixable"
    | "warnings_missing_ceiling"
    | "missing_form_high_impact";
  title: string;
  why: string;
  severity: DecisionSupportSeverity;
  fixability: DecisionSupportFixability;
  affectsCoreVerdict: boolean;
  beforeYouBuy: boolean;
};

export type DecisionSupportQualityMarkStatus = "detected" | "not_detected" | "unknown";

export type DecisionSupportQualityMarkTrustSignal = {
  code: "quality_mark_status";
  status: DecisionSupportQualityMarkStatus;
  checked: boolean;
  confidence: number | null;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  sourcesTried: string[];
  lastCheckedAt: string | null;
  checkedMode: "search_only" | "page_fetch" | null;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  evidenceType: "page" | "search" | "official_registry" | null;
  note: string;
  programMatches?: QualityMarkProgramMatch[];
  verificationSummary?: QualityMarkVerificationSummary | null;
};

export type DecisionSupportBrandLevelProgramSignal = {
  code: "brand_level_official_program";
  status: DecisionSupportQualityMarkStatus;
  checked: boolean;
  confidence: number | null;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  sourcesTried: string[];
  lastCheckedAt: string | null;
  checkedMode: "search_only" | "page_fetch" | null;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  evidenceType: "page" | "search" | "official_registry" | null;
  note: string;
  programLabel: string | null;
  matchLevel: "brand";
  programMatches?: QualityMarkProgramMatch[];
  verificationSummary?: QualityMarkVerificationSummary | null;
};

export type DecisionSupportExtraTrustSignal =
  | DecisionSupportQualityMarkTrustSignal
  | DecisionSupportBrandLevelProgramSignal;

export type DecisionSupportChecklistStatus = "verified" | "missing" | "unknown";

export type DecisionSupportEvidenceStrength =
  | "official"
  | "scanned_label"
  | "overlay_label_transcription"
  | "overlay_claim"
  | "cert_page_verified"
  | "general_science"
  | "inferred";

export type DecisionSupportChecklistRole = "score" | "info";

export type DecisionSupportProofClass =
  | "official_like"
  | "overlay_transcription"
  | "claim_only"
  | "independent_verifier"
  | "science_only";

export type DecisionSupportOverallBand =
  | "Excellent"
  | "Strong"
  | "Good"
  | "Fair"
  | "Limited"
  | "Weak";

export type DecisionSupportModuleBand = "High" | "Moderate" | "Limited" | "Low";

export type DecisionSupportNutriScoreCardV2ModuleId =
  | "ingredient_safety"
  | "formula_transparency"
  | "label_clarity"
  | "manufacturing_standards"
  | "testing_verification"
  | "product_quality";

export type DecisionSupportNutriScoreCardV2ChecklistItem = {
  key: string;
  label: string;
  state: DecisionSupportChecklistStatus;
  sourceTier: DecisionSupportSourceTier;
  evidenceStrength: DecisionSupportEvidenceStrength;
  evidenceRef: string | null;
  note: string | null;
  weight: number;
  role: DecisionSupportChecklistRole;
  critical: boolean;
  proofClass?: DecisionSupportProofClass;
  scoreEligible: boolean;
};

export type DecisionSupportNutriScoreCardV2Module = {
  id: DecisionSupportNutriScoreCardV2ModuleId;
  title: string;
  score: number;
  status: "high" | "moderate" | "limited" | "low";
  band: DecisionSupportModuleBand;
  checklist: DecisionSupportNutriScoreCardV2ChecklistItem[];
  debug?: {
    completenessScore: number;
    proofCap: number;
    criticalCap: number;
    finalScore: number;
    legacyScore: number;
    unknownRatio: number;
    confidenceContribution: number;
    confidenceWeightSum: number;
    criticalGateTriggered: boolean;
  };
};

export type DecisionSupportNutriScoreCardV2 = {
  overallScore: number;
  overallBand: DecisionSupportOverallBand;
  confidencePct: number;
  modules: DecisionSupportNutriScoreCardV2Module[];
  debug?: {
    legacyOverallScore: number;
    rawOverallBand: DecisionSupportOverallBand;
    criticalGateFailed: boolean;
    moduleWeightsUsed: Record<DecisionSupportNutriScoreCardV2ModuleId, number>;
  };
};

export type DecisionSupportOverlayClaims = {
  provider: "iherb";
  productId: string | null;
  brandName: string | null;
  title: string | null;
  link: string | null;
  imageUrl: string | null;
  categories: string[];
  description: string | null;
  suggestedUse: string | null;
  otherIngredients: string | null;
  warnings: string | null;
  disclaimer: string | null;
  nutritionalFacts: Array<{
    substancy: string;
    amountPerServing: string;
    dailyValuePercent: string | null;
  }>;
};

export type DecisionSupportOverviewBlock = {
  sourceStrip: string[];
  bestForBullets: string[];
  providesVerified: {
    servingSize: string | null;
    servingsPerContainer: number | null;
    keyIngredients: Array<{ name: string; dose: string | null }>;
    dosageForm: string | null;
    count: string | null;
  };
  missingInfo: string[];
  singleCta: { label: string; id: string } | null;
};

export type DecisionSupportScienceBlock = {
  ingredientSourceTier: "overlay_iherb" | "official_record";
  ingredientRows: DecisionSupportScienceIngredientRow[];
  ingredientSnapshotNames: string[];
  formMatters: {
    ingredientChemicalForm: string | null;
    dosageForm: string | null;
  };
  odsGeneralScienceBullets: string[];
  aiSummaryContract3: [string, string, string];
};

export type DecisionSupportUsageBlock = {
  directions: {
    text: string;
    lines: string[];
    sourceTier: "official_record" | "scanned_label" | "overlay_iherb" | "missing";
    hasDirectionsTextVisible: boolean;
  };
  timingTip: string;
  conservativeGuidance: string;
};

export type DecisionSupportSafetyBlock = {
  labelWarnings: string[];
  ulGuidance: string[];
  ulGuidanceEntries?: UlGuidanceEntry[];
  generalWatchouts: string[];
  dataStatusRef: string;
};

export type DecisionSupportQualityMark = {
  status: DecisionSupportQualityMarkStatus;
  checked: boolean;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  sourcesTried: string[];
  lastCheckedAt: string | null;
  checkedMode: "search_only" | "page_fetch" | null;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  evidenceType: "page" | "search" | "official_registry" | null;
  note: string;
  programMatches?: QualityMarkProgramMatch[];
  verificationSummary?: QualityMarkVerificationSummary | null;
};

export type DecisionSupportPersonalizedResultLaneSectionStatus = "ready" | "pending" | "unavailable";

export type DecisionSupportPersonalizedResultLaneSectionKey =
  | "safety"
  | "goal_fit"
  | "personal_insight"
  | "allergy_insight"
  | "dosage_context"
  | "product_standing";

export type DecisionSupportPersonalizedGoalFitDecision =
  | "fits"
  | "mixed"
  | "does_not_fit"
  | "unknown";

export type DecisionSupportPersonalizedDoseAssessment =
  | "aligned"
  | "low"
  | "high"
  | "unclear"
  | "unknown";

export type DecisionSupportPersonalizedProductStanding =
  | "strong"
  | "average"
  | "weak"
  | "unknown";

export type DecisionSupportPersonalizedGoalFit = {
  status: DecisionSupportPersonalizedResultLaneSectionStatus;
  reasonCode: "USER_GOAL_CONTEXT_NOT_ATTACHED" | "NO_GOAL_SUPPORT_SIGNALS_DETECTED" | null;
  summary: string;
  selectedGoalKey: GoalKey | null;
  fitDecision: DecisionSupportPersonalizedGoalFitDecision;
  fitTier: ProductGoalMatchTier | "unknown";
  previewTopGoalKey: GoalKey | null;
  previewTopTier: ProductGoalMatchTier | "unknown";
  candidateGoalKeys: GoalKey[];
};

export type DecisionSupportPersonalizedSupportSignal = {
  goalKey: GoalKey;
  label: string;
  source: "goal_match_scoring_preview" | "selected_goal_evaluation";
};

export type DecisionSupportPersonalizedConflictSignal = {
  ingredient: string;
  ingredientRole: "active" | "inactive" | "unknown";
  source: "saved_stack" | "restriction" | "allergy";
  summary: string;
};

export type DecisionSupportPersonalizedInsight = {
  status: DecisionSupportPersonalizedResultLaneSectionStatus;
  reasonCode: "SAVED_SUPPLEMENTS_NOT_ATTACHED" | null;
  summary: string;
  supportSummary: string;
  conflictSummary: string;
  supports: DecisionSupportPersonalizedSupportSignal[];
  conflicts: DecisionSupportPersonalizedConflictSignal[];
  expandableDetailsReady: boolean;
};

export type DecisionSupportPersonalizedAllergyDetail = {
  flag: string;
  source: "active_ingredient" | "inactive_ingredient" | "label_disclosure" | "warning";
  matchedText?: string | null;
  confidence: "high" | "medium" | "low";
};

export type DecisionSupportPersonalizedAllergyInsight = {
  status: DecisionSupportPersonalizedResultLaneSectionStatus;
  reasonCode:
    | "ALLERGY_PROFILE_NOT_ATTACHED"
    | "NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED"
    | null;
  summary: string;
  matchedAllergyFlags: string[];
  matchedRestrictions: string[];
  details: DecisionSupportPersonalizedAllergyDetail[];
};

export type DecisionSupportAttachedAllergyContext = {
  userAllergyFlags?: string[] | null;
  userIngredientRestrictions?: string[] | null;
  productAllergyFlags?: string[] | null;
  productIngredientRestrictions?: string[] | null;
  productCoverageStatus?: "resolved" | "partial" | "insufficient" | null;
  productMatchEvidence?: Record<string, unknown> | null;
};

export type DecisionSupportAttachedStackOverlapItem = {
  ingredientKey: string;
  ingredientDisplay: string;
  count: number;
  supplements: Array<{
    supplementId: string;
    productName: string;
  }>;
};

export type DecisionSupportAttachedStackOverlapContext = {
  status: "ok" | "partial";
  savedStackCount: number;
  overlapCount: number;
  overlaps: DecisionSupportAttachedStackOverlapItem[];
};

export type DecisionSupportAttachedPersonalizationContext = {
  profile?: PersonalizationProfile | null;
  prioritizedGoals?: GoalKey[] | null;
  selectedGoalKey?: GoalKey | null;
  preferredTypes?: SupplementTypeKey[] | null;
  supplementExperience?: ExperienceLevel | null;
  ageRange?: string | null;
  adherenceBlocker?: BlockerKey | null;
  stackOverlap?: DecisionSupportAttachedStackOverlapContext | null;
  allergyContext?: DecisionSupportAttachedAllergyContext | null;
};

export type DecisionSupportPersonalizedDosageContext = {
  status: DecisionSupportPersonalizedResultLaneSectionStatus;
  reasonCode: "RECOMMENDED_DOSE_COMPARISON_NOT_ATTACHED" | "NO_PRODUCT_DOSE_VISIBLE" | null;
  summary: string;
  assessment: DecisionSupportPersonalizedDoseAssessment;
  comparisonMode: "selected_goal" | "best_detected_goal_preview" | "not_attached";
  previewGoalKey: GoalKey | null;
  productDoseText: string | null;
  productDirectionsText: string | null;
};

export type DecisionSupportPersonalizedStandingAlternative = {
  productId: string | null;
  title: string;
  reason: string | null;
};

export type DecisionSupportPersonalizedProductStandingBlock = {
  status: DecisionSupportPersonalizedResultLaneSectionStatus;
  reasonCode: "PRODUCT_BENCHMARK_NOT_ATTACHED" | null;
  summary: string;
  standing: DecisionSupportPersonalizedProductStanding;
  standingLabel: string | null;
  benchmarkLabel: string | null;
  percentile: number | null;
  peerCount: number | null;
  betterAlternatives: DecisionSupportPersonalizedStandingAlternative[];
};

export type DecisionSupportPersonalizedResultLane = {
  schemaVersion: 1;
  contract: "personalized_result_lane/v1";
  recommendedSectionOrder: DecisionSupportPersonalizedResultLaneSectionKey[];
  goalFit: DecisionSupportPersonalizedGoalFit;
  personalInsight: DecisionSupportPersonalizedInsight;
  allergyInsight: DecisionSupportPersonalizedAllergyInsight;
  dosageContext: DecisionSupportPersonalizedDosageContext;
  productStanding: DecisionSupportPersonalizedProductStandingBlock;
};

export type DecisionSupportCategoryId =
  | "fish_oil_omega3"
  | "out_of_scope_non_supplement"
  | "taxonomy_backlog_hold"
  | "vitamin_d"
  | "magnesium"
  | "probiotics"
  | "metabolic_glucose_support"
  | "sports_anabolic_support"
  | "cholesterol_lipid_support"
  | "liver_bile_support"
  | "cellular_nucleotide_support"
  | "antioxidant_cellular_energy"
  | "nootropic_memory_cognition"
  | "specialty_vitamins_other"
  | "specialty_single_amino_and_neuro"
  | "fatty_acids_specialty_lipids"
  | "womens_hormonal_and_lactation"
  | "mens_prostate_and_hormonal"
  | "digestive_and_gastro_functional"
  | "botanical_herbal_support"
  | "sports_performance_amino_acids"
  | "sleep_stress_mood_support"
  | "vitamin_mineral_other"
  | "joint_bone_mobility"
  | "collagen_connective_support"
  | "digestive_fiber_enzymes"
  | "superfoods_mushrooms_greens"
  | "unknown";

export type DecisionSupportPayload = {
  digest: string;
  decisionInputsHash: string;
  decisionContractVersion: string;
  overlayClaimsHash: string | null;
  overlayAugmentationVersion: string | null;
  overlayAugmentationSource: "iherb" | "none";
  patchActivationCanonical: string;
  rubricVersion: string;
  categoryId: DecisionSupportCategoryId;
  categoryProfileVersion: string;
  viewMode: DecisionSupportViewMode;
  verdict: DecisionSupportVerdict;
  verdictReason: string;
  subscores: DecisionSupportSubscore[];
  checklist: DecisionSupportChecklistItem[];
  blockers: DecisionSupportBlocker[];
  topBlockers: DecisionSupportBlocker[];
  extraTrustSignals: DecisionSupportExtraTrustSignal[];
  sourceTiers: DecisionSupportSourceTier[];
  nutriScoreCardV2: DecisionSupportNutriScoreCardV2;
  overviewBlock: DecisionSupportOverviewBlock;
  scienceBlock: DecisionSupportScienceBlock;
  usageBlock: DecisionSupportUsageBlock;
  safetyBlock: DecisionSupportSafetyBlock;
  personalizedResultLane: DecisionSupportPersonalizedResultLane;
  qualityMark: DecisionSupportQualityMark;
  safeScienceSignalSource?: "subset" | "fallback" | "none";
  safeScienceFallbackType?: "best_for" | "comparison" | null;
  decisionDebug?: {
    factsDigestHash: string;
    sourceIdentityCanonical: string;
    sourceType: FactsDigest["sourceType"];
    digestIdentityType: FactsDigest["identity"]["type"];
    digestIdentityValue: string;
    localeCanonical: string;
    rubricVersion: string;
    categoryId: DecisionSupportCategoryId;
    categoryProfileVersion: string;
    viewMode: DecisionSupportViewMode;
    flagsSnapshotCanonical: string;
    overlayClaimsHash: string | null;
    overlayAugmentationVersion: string | null;
    overlayAugmentationSource: "iherb" | "none";
    patchActivationCanonical: string;
    allergyContextCanonical: string;
    personalizationContextCanonical: string;
    decisionContractVersion: string;
    digestInputParts: {
      factsDigestHash: string;
      decisionContractVersion: string;
      localeCanonical: string;
      rubricVersion: string;
      categoryId: DecisionSupportCategoryId;
      categoryProfileVersion: string;
      viewMode: DecisionSupportViewMode;
      flagsSnapshotCanonical: string;
      sourceIdentityCanonical: string;
      overlayAugmentationSource: "iherb" | "none";
      overlayAugmentationVersion: string | null;
      overlayClaimsHash: string | null;
      patchActivationCanonical: string;
      allergyContextCanonical: string;
      personalizationContextCanonical: string;
    };
  };
};

export type DecisionSupportInline = {
  verdict: DecisionSupportVerdict;
  subscores: Array<{ id: DecisionSupportSubscoreId; score: number }>;
  topBlockers: Array<{
    code: DecisionSupportBlocker["code"];
    title: string;
    why: string;
    severity: DecisionSupportSeverity;
  }>;
  nutriScoreCardV2: DecisionSupportNutriScoreCardV2;
  overviewBlock: DecisionSupportOverviewBlock;
  scienceBlock: DecisionSupportScienceBlock;
  usageBlock: DecisionSupportUsageBlock;
  safetyBlock: DecisionSupportSafetyBlock;
  personalizedResultLane: DecisionSupportPersonalizedResultLane;
  qualityMark: DecisionSupportQualityMark;
};

type DecisionSupportCompileParams = {
  digest: FactsDigest;
  factsDigestHash: string;
  viewMode: DecisionSupportViewMode;
  locale?: "zh" | "en";
  flagsSnapshot?: Record<string, unknown>;
  patchActivation?: {
    appliedLaneIds?: string[];
  } | null;
  overlayClaims?: DecisionSupportOverlayClaims | null;
  allergyContext?: DecisionSupportAttachedAllergyContext | null;
  personalizationContext?: DecisionSupportAttachedPersonalizationContext | null;
};

export const DECISION_SUPPORT_CONTRACT_VERSION = "dc-v1";
export const DECISION_SUPPORT_RUBRIC_VERSION = "v1.6.12-r2d-7";
export const DECISION_SUPPORT_OVERLAY_AUGMENTATION_VERSION = "iherb-overlay-v1";
export const DECISION_SUPPORT_PATCH_VERSION = "patch-shadow-v1";
const DECISION_SUPPORT_DIGEST_DELIMITER = "\n|\n";
const CATEGORY_PROFILE_VERSION: Record<DecisionSupportCategoryId, string> = {
  fish_oil_omega3: "fish-oil-omega3-v1",
  out_of_scope_non_supplement: "out-of-scope-non-supplement-v1",
  taxonomy_backlog_hold: "taxonomy-backlog-hold-v1",
  vitamin_d: "vitamin-d-v1",
  magnesium: "magnesium-v1",
  probiotics: "probiotics-v1",
  metabolic_glucose_support: "metabolic-glucose-support-v1",
  sports_anabolic_support: "sports-anabolic-support-v1",
  cholesterol_lipid_support: "cholesterol-lipid-support-v1",
  liver_bile_support: "liver-bile-support-v1",
  cellular_nucleotide_support: "cellular-nucleotide-support-v1",
  antioxidant_cellular_energy: "antioxidant-cellular-energy-v1",
  nootropic_memory_cognition: "nootropic-memory-cognition-v1",
  specialty_vitamins_other: "specialty-vitamins-other-v1",
  specialty_single_amino_and_neuro: "specialty-single-amino-and-neuro-v1",
  fatty_acids_specialty_lipids: "fatty-acids-specialty-lipids-v1",
  womens_hormonal_and_lactation: "womens-hormonal-and-lactation-v1",
  mens_prostate_and_hormonal: "mens-prostate-and-hormonal-v1",
  digestive_and_gastro_functional: "digestive-and-gastro-functional-v1",
  botanical_herbal_support: "botanical-herbal-support-v1",
  sports_performance_amino_acids: "sports-performance-amino-acids-v1",
  sleep_stress_mood_support: "sleep-stress-mood-support-v1",
  vitamin_mineral_other: "vitamin-mineral-other-v1",
  joint_bone_mobility: "joint-bone-mobility-v1",
  collagen_connective_support: "collagen-connective-support-v1",
  digestive_fiber_enzymes: "digestive-fiber-enzymes-v1",
  superfoods_mushrooms_greens: "superfoods-mushrooms-greens-v1",
  unknown: "unknown-v1",
};

const scoreClamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const stableStringify = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => typeof key === "string")
      .sort(([a], [b]) => a.localeCompare(b));
    const parts = entries.map(([key, itemValue]) => `${JSON.stringify(key)}:${stableStringify(itemValue)}`);
    return `{${parts.join(",")}}`;
  }
  return "null";
};

export const canonicalizeFlagsSnapshot = (value: Record<string, unknown> | null | undefined): string =>
  stableStringify(value ?? {});

const canonicalizeSourceIdentity = (digest: FactsDigest): string => {
  const identityType = String(digest?.identity?.type ?? "unknown").trim().toLowerCase();
  const identityValue = String(digest?.identity?.value ?? "").trim();
  return `${identityType}:${identityValue}`;
};

const canonicalizePatchActivation = (
  value: DecisionSupportCompileParams["patchActivation"],
): string => {
  const appliedLaneIds = Array.isArray(value?.appliedLaneIds)
    ? [...new Set(value.appliedLaneIds.map((item) => String(item ?? "").trim()).filter(Boolean))].sort()
    : [];
  return stableStringify({ appliedLaneIds });
};

const canonicalizeOverlayClaims = (
  value: DecisionSupportOverlayClaims | null | undefined,
): string => stableStringify(value ?? null);

const canonicalizeAllergyContext = (
  value: DecisionSupportAttachedAllergyContext | null | undefined,
): string => stableStringify(value ?? null);

const canonicalizePersonalizationContext = (
  value: DecisionSupportAttachedPersonalizationContext | null | undefined,
): string => stableStringify(value ?? null);

const hashCanonicalString = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const buildDecisionSupportOverlayAugmentationMeta = (
  overlayClaims: DecisionSupportOverlayClaims | null | undefined,
): {
  source: "iherb" | "none";
  version: string | null;
  claimsHash: string | null;
} => {
  if (!overlayClaims) {
    return {
      source: "none",
      version: null,
      claimsHash: null,
    };
  }

  return {
    source: "iherb",
    version: DECISION_SUPPORT_OVERLAY_AUGMENTATION_VERSION,
    claimsHash: hashCanonicalString(canonicalizeOverlayClaims(overlayClaims)),
  };
};

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const normalizeDisplayText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const stripTrailingSentencePunctuation = (value: string): string => value.replace(/[.!?]+$/g, "").trim();

const normalizeActiveNames = (digest: FactsDigest): string[] =>
  (Array.isArray(digest?.actives) ? digest.actives : [])
    .map((active) => normalizeText(active?.name))
    .filter(Boolean);

const GOAL_DISPLAY_LABELS: Record<GoalKey, string> = {
  sleep: "Sleep",
  energy: "Energy",
  immunity: "Immunity",
  recovery: "Recovery",
  focus: "Focus",
  libido_enhancement: "Libido Enhancement",
  stress_support: "Stress Support",
  weight_management: "Weight Management",
};

const PRODUCT_GOAL_TIER_PRIORITY: Record<ProductGoalMatchTier, number> = {
  strong_match: 4,
  related: 3,
  weak_match: 2,
  no_match: 1,
};

const PERSONALIZED_RESULT_LANE_SECTION_ORDER: DecisionSupportPersonalizedResultLaneSectionKey[] = [
  "safety",
  "goal_fit",
  "personal_insight",
  "allergy_insight",
  "dosage_context",
  "product_standing",
];

const humanizeGoalKey = (goalKey: GoalKey): string => GOAL_DISPLAY_LABELS[goalKey] ?? goalKey;

const joinDisplayLabels = (labels: string[]): string => {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
};

const buildGoalPreviewInputs = (digest: FactsDigest): ProductIngredientLikeInput[] =>
  (Array.isArray(digest?.actives) ? digest.actives : [])
    .map((active): ProductIngredientLikeInput | null => {
      const ingredientName = normalizeDisplayText(active?.name);
      if (!ingredientName) return null;

      const hasComparableDose =
        typeof active?.amount === "number"
        && Number.isFinite(active.amount)
        && active.amount > 0
        && normalizeDisplayText(active?.unit).length > 0;
      const hasAnyDoseSignal =
        hasComparableDose || normalizeDisplayText(active?.amountText).length > 0;
      const hasAnyFormSignal = normalizeDisplayText(active?.chemicalForm).length > 0;

      return {
        ingredientLabel: ingredientName,
        name: ingredientName,
        amount: hasComparableDose ? active.amount : null,
        unit: hasComparableDose ? normalizeDisplayText(active.unit) : null,
        form: hasAnyFormSignal ? normalizeDisplayText(active.chemicalForm) : null,
        formLabel: hasAnyFormSignal ? normalizeDisplayText(active.chemicalForm) : null,
        disclosureQuality: hasComparableDose ? "high" : hasAnyDoseSignal || hasAnyFormSignal ? "medium" : "low",
        proprietaryBlend: false,
      };
    })
    .filter((item): item is ProductIngredientLikeInput => Boolean(item));

const compareGoalPreviewMatches = (left: ProductGoalMatch, right: ProductGoalMatch): number => {
  const tierDelta = PRODUCT_GOAL_TIER_PRIORITY[right.tier] - PRODUCT_GOAL_TIER_PRIORITY[left.tier];
  if (tierDelta !== 0) return tierDelta;
  return right.score - left.score;
};

const buildGoalPreviewMatches = (digest: FactsDigest): ProductGoalMatch[] => {
  const ingredients = buildGoalPreviewInputs(digest);
  if (ingredients.length === 0) return [];

  const hasDose = ingredients.some(
    (ingredient) =>
      typeof ingredient.amount === "number"
      && ingredient.amount > 0
      && typeof ingredient.unit === "string"
      && ingredient.unit.length > 0,
  );

  return scoreProductGoalMatches({
    ingredients,
    disclosureQuality: hasDose ? "high" : "medium",
    proprietaryBlendWithoutClearActives: false,
  })
    .filter((match) => match.tier !== "no_match" && match.score > 0)
    .sort(compareGoalPreviewMatches);
};

const GENERIC_NUTRITION_ACTIVE_REGEX =
  /\bcalories?\b|\btotal fat\b|\bsaturated fat\b|\bcholesterol\b|\bsodium\b|\bcarbohydrate\b|\bprotein\b/;

const isGenericNutritionActiveName = (value: string | null | undefined): boolean =>
  GENERIC_NUTRITION_ACTIVE_REGEX.test(normalizeDisplayText(value).toLowerCase());

type DosePreviewCandidate = {
  name: string;
  doseText: string;
};

const buildDosePreviewCandidate = (active: FactsDigest["actives"][number] | null | undefined): DosePreviewCandidate | null => {
  const ingredientName = normalizeDisplayText(active?.name);
  if (!ingredientName || isGenericNutritionActiveName(ingredientName)) return null;

  const amountText = normalizeDisplayText(active?.amountText);
  if (amountText) {
    return {
      name: ingredientName,
      doseText: amountText,
    };
  }

  if (
    typeof active?.amount === "number"
    && Number.isFinite(active.amount)
    && active.amount > 0
    && normalizeDisplayText(active?.unit).length > 0
  ) {
    return {
      name: ingredientName,
      doseText: formatDoseText(active.amount, normalizeDisplayText(active.unit)),
    };
  }

  return null;
};

const buildProductDosePreviewText = (digest: FactsDigest): string | null => {
  const candidates = (digest.actives ?? [])
    .map((active) => buildDosePreviewCandidate(active))
    .filter((candidate): candidate is DosePreviewCandidate => Boolean(candidate));

  if (candidates.length === 0) return null;

  if (detectCategoryId(digest) === "fish_oil_omega3") {
    const epa = candidates.find((candidate) => /\bepa\b|\beicosapentaenoic\b/i.test(candidate.name));
    const dha = candidates.find((candidate) => /\bdha\b|\bdocosahexaenoic\b/i.test(candidate.name));
    if (epa && dha) {
      return `EPA ${epa.doseText} + DHA ${dha.doseText} per serving`;
    }

    const totalOmega3 = candidates.find((candidate) =>
      /\b(total\s+)?omega[-\s]?3\b|\bomega[-\s]?3 fatty acids?\b/i.test(candidate.name),
    );
    if (totalOmega3) {
      return `${totalOmega3.name}: ${totalOmega3.doseText} per serving`;
    }

    const fishOil = candidates.find((candidate) => /\bfish oil\b|\bpollock oil\b|\bmarine oil\b/i.test(candidate.name));
    if (fishOil) {
      return `${fishOil.name}: ${fishOil.doseText} per serving`;
    }
  }

  return `${candidates[0].name}: ${candidates[0].doseText} per serving`;
};

const buildDirectionsPreviewText = (usageBlock: DecisionSupportUsageBlock): string | null => {
  const firstLine = usageBlock.directions.lines.find((line) => normalizeDisplayText(line).length > 0);
  if (firstLine) return normalizeDisplayText(firstLine);

  const text = normalizeDisplayText(usageBlock.directions.text);
  return text || null;
};

const buildCatalogIngredientRowsFromDigest = (digest: FactsDigest): CatalogOverlayIngredientRow[] =>
  (Array.isArray(digest?.actives) ? digest.actives : [])
    .map((active): CatalogOverlayIngredientRow | null => {
      const name = normalizeDisplayText(active?.name);
      if (!name) return null;
      if (isGenericNutritionActiveName(name)) return null;

      const amountText = normalizeDisplayText(active?.amountText);
      if (amountText) {
        return { name, dose: amountText };
      }

      if (
        typeof active?.amount === "number"
        && Number.isFinite(active.amount)
        && active.amount > 0
        && normalizeDisplayText(active?.unit).length > 0
      ) {
        return {
          name,
          dose: formatDoseText(active.amount, normalizeDisplayText(active.unit)),
        };
      }

      return { name, dose: null };
    })
    .filter((row): row is CatalogOverlayIngredientRow => Boolean(row));

const buildDecisionSupportProductId = (digest: FactsDigest): string =>
  `${digest.sourceType}:${normalizeDisplayText(digest.identity?.value) || "unknown"}`;

const resolveGoalFitDecision = (
  tier: ProductGoalMatchTier | "unknown",
): DecisionSupportPersonalizedGoalFitDecision => {
  switch (tier) {
    case "strong_match":
    case "related":
      return "fits";
    case "weak_match":
      return "mixed";
    case "no_match":
      return "does_not_fit";
    default:
      return "unknown";
  }
};

const hasReasonCode = (
  reasons: Array<{ code: string }> | null | undefined,
  code: string,
): boolean => Array.isArray(reasons) && reasons.some((reason) => reason.code === code);

const buildConflictSignalsFromOverlap = (
  overlapContext: DecisionSupportAttachedStackOverlapContext | null | undefined,
): DecisionSupportPersonalizedConflictSignal[] =>
  (overlapContext?.overlaps ?? []).map((item) => {
    const otherCount = Math.max(1, item.count - 1);
    return {
      ingredient: item.ingredientDisplay,
      ingredientRole: "active",
      source: "saved_stack",
      summary:
        otherCount === 1
          ? `${item.ingredientDisplay} also appears in 1 saved supplement.`
          : `${item.ingredientDisplay} also appears in ${otherCount} saved supplements.`,
    };
  });

const buildCurrentProductEvaluation = (params: {
  digest: FactsDigest;
  usageBlock: DecisionSupportUsageBlock;
  personalizationContext: DecisionSupportAttachedPersonalizationContext;
  selectedGoalKey: GoalKey | null;
}): CatalogProductEvaluationResult | null => {
  const { selectedGoalKey } = params;
  if (!selectedGoalKey) return null;

  const ingredientRows = buildCatalogIngredientRowsFromDigest(params.digest);
  const overlapCount = params.personalizationContext.stackOverlap?.overlaps?.length ?? 0;
  const duplicateRiskLevel =
    overlapCount > 1 ? "high" : overlapCount === 1 ? "medium" : "none";

  return evaluateCatalogProduct({
    productId: buildDecisionSupportProductId(params.digest),
    goalKey: selectedGoalKey,
    preferredTypes: params.personalizationContext.preferredTypes ?? undefined,
    title: params.digest.product.name ?? params.digest.product.brandDisplay ?? "Unknown supplement",
    brandName: params.digest.product.brandDisplay ?? params.digest.product.brandLegal ?? null,
    dosageText: buildProductDosePreviewText(params.digest),
    suggestedUse: buildDirectionsPreviewText(params.usageBlock),
    ingredients: ingredientRows,
    duplicateRisk: {
      level: duplicateRiskLevel,
      ingredientKeys: (params.personalizationContext.stackOverlap?.overlaps ?? []).map((item) => item.ingredientKey),
    },
    supplementExperience: params.personalizationContext.supplementExperience ?? undefined,
    ageRange: params.personalizationContext.ageRange ?? undefined,
    adherenceBlocker: params.personalizationContext.adherenceBlocker ?? undefined,
  });
};

const buildGoalFitSummaryFromEvaluation = (params: {
  goalKey: GoalKey;
  evaluation: CatalogProductEvaluationResult;
}): string => {
  const goalLabel = humanizeGoalKey(params.goalKey);
  const card = params.evaluation.goalFitCard;
  const tier = card?.tier ?? "not_enough_structured_data";

  switch (tier) {
    case "strong_match":
      return `Strong support for your ${goalLabel} goal. ${summarizeGoalFitReasons(card?.whyFit ?? [], `The current label shows a strong fit for ${goalLabel}.`)}`;
    case "related":
      return `This looks aligned with your ${goalLabel} goal. ${summarizeGoalFitReasons(card?.whyFit ?? [], `The current label shows a useful fit for ${goalLabel}.`)}`;
    case "weak_match":
      return `This may help with your ${goalLabel} goal, but the signal is still limited. ${summarizeGoalFitReasons(card?.whyNotStronger ?? [], `The current label shows only a limited fit for ${goalLabel}.`)}`;
    case "no_match":
      return `This is not a strong fit for your ${goalLabel} goal right now. ${summarizeGoalFitReasons(card?.whyNotStronger ?? [], `We are not seeing enough goal-specific support for ${goalLabel}.`)}`;
    default:
      return `We need more structured data before we can score this confidently for ${goalLabel}.`;
  }
};

const buildSupportSignalsFromEvaluation = (params: {
  goalKey: GoalKey;
  evaluation: CatalogProductEvaluationResult;
}): DecisionSupportPersonalizedSupportSignal[] => {
  const tier = params.evaluation.goalFitCard?.tier ?? "not_enough_structured_data";
  if (tier === "strong_match" || tier === "related" || tier === "weak_match") {
    return [
      {
        goalKey: params.goalKey,
        label: humanizeGoalKey(params.goalKey),
        source: "selected_goal_evaluation",
      },
    ];
  }
  return [];
};

const buildPersonalInsightSummary = (params: {
  selectedGoalKey: GoalKey | null;
  supportSignals: DecisionSupportPersonalizedSupportSignal[];
  conflictSignals: DecisionSupportPersonalizedConflictSignal[];
  overlapContext: DecisionSupportAttachedStackOverlapContext | null | undefined;
}): {
  summary: string;
  supportSummary: string;
  conflictSummary: string;
} => {
  const goalLabel = params.selectedGoalKey ? humanizeGoalKey(params.selectedGoalKey) : null;
  const supportSummary = params.supportSignals.length > 0
    ? goalLabel
      ? `Supports your ${goalLabel} goal.`
      : `Detected a usable support signal from the current label.`
    : goalLabel
      ? `Not a strong fit for your ${goalLabel} goal right now.`
      : `No strong personalized support signal surfaced from the current label.`;

  const conflictSummary = params.conflictSignals.length > 0
    ? params.conflictSignals[0]?.summary ?? "May overlap with your saved supplements."
    : (params.overlapContext?.savedStackCount ?? 0) > 0
      ? "No major overlap found with your saved supplements."
      : "No saved supplements to compare yet.";

  const summary = params.conflictSignals.length > 0
    ? "May overlap with your saved supplements."
    : supportSummary;

  return { summary, supportSummary, conflictSummary };
};

const buildDosageContextFromEvaluation = (params: {
  selectedGoalKey: GoalKey | null;
  evaluation: CatalogProductEvaluationResult | null;
  digest: FactsDigest;
  usageBlock: DecisionSupportUsageBlock;
}): DecisionSupportPersonalizedDosageContext => {
  const productDoseText = buildProductDosePreviewText(params.digest);
  const productDirectionsText = buildDirectionsPreviewText(params.usageBlock);
  const hasVisibleProductDose = Boolean(productDoseText || productDirectionsText);

  if (!hasVisibleProductDose) {
    return {
      status: "unavailable",
      reasonCode: "NO_PRODUCT_DOSE_VISIBLE",
      summary: "Recommended-dose comparison is reserved here, and this label does not expose enough dose or directions detail yet.",
      assessment: "unknown",
      comparisonMode: "not_attached",
      previewGoalKey: params.selectedGoalKey,
      productDoseText,
      productDirectionsText,
    };
  }

  if (!params.selectedGoalKey || !params.evaluation) {
    return {
      status: "pending",
      reasonCode: "RECOMMENDED_DOSE_COMPARISON_NOT_ATTACHED",
      summary: "Product dose is visible, but selected-goal dose comparison is not attached yet.",
      assessment: "unclear",
      comparisonMode: "not_attached",
      previewGoalKey: null,
      productDoseText,
      productDirectionsText,
    };
  }

  const whyFit = params.evaluation.goalFitCard?.whyFit ?? [];
  const whyNotStronger = params.evaluation.goalFitCard?.whyNotStronger ?? [];
  const assessment: DecisionSupportPersonalizedDoseAssessment = hasReasonCode(whyFit, "dose_meets_effective_floor")
    ? "aligned"
    : hasReasonCode(whyNotStronger, "dose_below_effective_floor")
      ? "low"
      : "unclear";
  const goalLabel = humanizeGoalKey(params.selectedGoalKey);
  const summary = assessment === "aligned"
    ? `The disclosed serving looks aligned for your ${goalLabel} goal.`
    : assessment === "low"
      ? `The disclosed serving looks lighter than a stronger ${goalLabel} fit usually requires.`
      : `The product dose is visible, but it is still hard to compare confidently for your ${goalLabel} goal.`;

  return {
    status: "ready",
    reasonCode: null,
    summary,
    assessment,
    comparisonMode: "selected_goal",
    previewGoalKey: params.selectedGoalKey,
    productDoseText,
    productDirectionsText,
  };
};

const normalizeAllergyDetailSource = (
  value: unknown,
): DecisionSupportPersonalizedAllergyDetail["source"] | null => {
  switch (String(value ?? "").trim()) {
    case "active_ingredient":
    case "inactive_ingredient":
    case "label_disclosure":
    case "warning":
      return String(value) as DecisionSupportPersonalizedAllergyDetail["source"];
    default:
      return null;
  }
};

const normalizeAllergyDetailConfidence = (
  value: unknown,
): DecisionSupportPersonalizedAllergyDetail["confidence"] => {
  switch (String(value ?? "").trim()) {
    case "high":
    case "low":
      return String(value) as DecisionSupportPersonalizedAllergyDetail["confidence"];
    case "medium":
    default:
      return "medium";
  }
};

const parseAttachedAllergyDetails = (
  matchEvidence: Record<string, unknown> | null | undefined,
): DecisionSupportPersonalizedAllergyDetail[] => {
  if (!matchEvidence || typeof matchEvidence !== "object" || Array.isArray(matchEvidence)) {
    return [];
  }

  const flagsBucket = "flags" in matchEvidence ? (matchEvidence.flags as unknown) : null;
  if (!flagsBucket || typeof flagsBucket !== "object" || Array.isArray(flagsBucket)) {
    return [];
  }

  const details: DecisionSupportPersonalizedAllergyDetail[] = [];
  const seen = new Set<string>();

  Object.entries(flagsBucket as Record<string, unknown>).forEach(([flag, rawEntries]) => {
    if (!Array.isArray(rawEntries)) return;
    rawEntries.forEach((rawEntry) => {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return;
      const entry = rawEntry as Record<string, unknown>;
      const source = normalizeAllergyDetailSource(entry.source);
      if (!source) return;
      const matchedText =
        typeof entry.matchedText === "string" && entry.matchedText.trim().length > 0
          ? entry.matchedText.trim()
          : null;
      const confidence = normalizeAllergyDetailConfidence(entry.confidence);
      const key = [flag, source, matchedText ?? "", confidence].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      details.push({
        flag,
        source,
        matchedText,
        confidence,
      });
    });
  });

  return details;
};

const resolvePreviewDoseAssessment = (
  match: ProductGoalMatch | null,
): DecisionSupportPersonalizedDoseAssessment => {
  switch (match?.confidence?.dose) {
    case "meets":
      return "aligned";
    case "below":
      return "low";
    case "unknown":
      return "unclear";
    case "not_applicable":
    default:
      return "unknown";
  }
};

const buildPersonalizedResultLane = (params: {
  digest: FactsDigest;
  usageBlock: DecisionSupportUsageBlock;
  allergyContext?: DecisionSupportAttachedAllergyContext | null;
  personalizationContext?: DecisionSupportAttachedPersonalizationContext | null;
}): DecisionSupportPersonalizedResultLane => {
  const goalPreviewMatches = buildGoalPreviewMatches(params.digest);
  const previewTopGoal = goalPreviewMatches[0] ?? null;
  const attachedContext = params.personalizationContext ?? null;
  const selectedGoalKey = attachedContext?.selectedGoalKey ?? null;
  const candidateGoalKeys =
    (attachedContext?.prioritizedGoals?.length ?? 0) > 0
      ? (attachedContext?.prioritizedGoals ?? []).slice(0, 3)
      : goalPreviewMatches.slice(0, 3).map((match) => match.goalKey);
  const previewSupportSignals: DecisionSupportPersonalizedSupportSignal[] = goalPreviewMatches
    .slice(0, 3)
    .map((match) => ({
      goalKey: match.goalKey,
      label: humanizeGoalKey(match.goalKey),
      source: "goal_match_scoring_preview" as const,
    }));
  const currentProductEvaluation = attachedContext
    ? buildCurrentProductEvaluation({
      digest: params.digest,
      usageBlock: params.usageBlock,
      personalizationContext: attachedContext,
      selectedGoalKey,
    })
    : null;
  const supportSignals =
    currentProductEvaluation && selectedGoalKey
      ? buildSupportSignalsFromEvaluation({
        goalKey: selectedGoalKey,
        evaluation: currentProductEvaluation,
      })
      : previewSupportSignals;
  const conflictSignals = buildConflictSignalsFromOverlap(attachedContext?.stackOverlap);
  const supportLabels = supportSignals.map((signal) => signal.label);
  const productDoseText = buildProductDosePreviewText(params.digest);
  const productDirectionsText = buildDirectionsPreviewText(params.usageBlock);
  const hasVisibleProductDose = Boolean(productDoseText || productDirectionsText);
  const dosageAssessment = previewTopGoal && hasVisibleProductDose
    ? resolvePreviewDoseAssessment(previewTopGoal)
    : hasVisibleProductDose
      ? "unclear"
      : "unknown";

  return {
    schemaVersion: 1,
    contract: "personalized_result_lane/v1",
    recommendedSectionOrder: [...PERSONALIZED_RESULT_LANE_SECTION_ORDER],
    goalFit: currentProductEvaluation && selectedGoalKey
      ? {
        status: "ready",
        reasonCode: null,
        summary: buildGoalFitSummaryFromEvaluation({
          goalKey: selectedGoalKey,
          evaluation: currentProductEvaluation,
        }),
        selectedGoalKey,
        fitDecision: resolveGoalFitDecision(
          currentProductEvaluation.goalFitCard?.tier === "not_enough_structured_data"
            ? "unknown"
            : (currentProductEvaluation.goalFitCard?.tier ?? "unknown"),
        ),
        fitTier:
          currentProductEvaluation.goalFitCard?.tier === "not_enough_structured_data"
            ? "unknown"
            : (currentProductEvaluation.goalFitCard?.tier ?? "unknown"),
        previewTopGoalKey: previewTopGoal?.goalKey ?? null,
        previewTopTier: previewTopGoal?.tier ?? "unknown",
        candidateGoalKeys,
      }
      : {
        status: "pending",
        reasonCode: previewTopGoal ? "USER_GOAL_CONTEXT_NOT_ATTACHED" : "NO_GOAL_SUPPORT_SIGNALS_DETECTED",
        summary: previewTopGoal
          ? `Detected strongest goal-fit preview for ${humanizeGoalKey(previewTopGoal.goalKey)}, but user goal selection is not attached to this decision support payload yet.`
          : "Goal-fit contract is reserved here, but user goal selection is not attached and the current label does not yield a strong preview signal yet.",
        selectedGoalKey: null,
        fitDecision: "unknown",
        fitTier: "unknown",
        previewTopGoalKey: previewTopGoal?.goalKey ?? null,
        previewTopTier: previewTopGoal?.tier ?? "unknown",
        candidateGoalKeys,
      },
    personalInsight: attachedContext
      ? (() => {
        const { summary, supportSummary, conflictSummary } = buildPersonalInsightSummary({
          selectedGoalKey,
          supportSignals,
          conflictSignals,
          overlapContext: attachedContext.stackOverlap,
        });

        return {
          status: "ready" as const,
          reasonCode: null,
          summary,
          supportSummary,
          conflictSummary,
          supports: supportSignals,
          conflicts: conflictSignals,
          expandableDetailsReady: supportSignals.length > 0 || conflictSignals.length > 0,
        };
      })()
      : {
        status: "pending",
        reasonCode: "SAVED_SUPPLEMENTS_NOT_ATTACHED",
        summary: supportLabels.length > 0
          ? `Detected product-level support signals for ${joinDisplayLabels(supportLabels)}, but saved supplement conflict matching is not attached yet.`
          : "Personal insight contract is reserved here, but saved supplement conflict matching is not attached yet.",
        supportSummary: supportLabels.length > 0
          ? `Detected product-level support signals for ${joinDisplayLabels(supportLabels)}.`
          : "No clear product-level support signal was strong enough to surface from the current label.",
        conflictSummary: "Saved supplement conflict matching is not attached to this decision support payload yet.",
        supports: supportSignals,
        conflicts: [],
        expandableDetailsReady: false,
      },
    allergyInsight: (attachedContext?.allergyContext ?? params.allergyContext)
      ? buildAllergyInsight({
        userAllergyFlags: (attachedContext?.allergyContext ?? params.allergyContext)?.userAllergyFlags ?? [],
        userIngredientRestrictions: (attachedContext?.allergyContext ?? params.allergyContext)?.userIngredientRestrictions ?? [],
        productAllergyFlags: (attachedContext?.allergyContext ?? params.allergyContext)?.productAllergyFlags ?? null,
        productIngredientRestrictions: (attachedContext?.allergyContext ?? params.allergyContext)?.productIngredientRestrictions ?? null,
        productCoverageStatus: (attachedContext?.allergyContext ?? params.allergyContext)?.productCoverageStatus ?? null,
        productDetails: parseAttachedAllergyDetails((attachedContext?.allergyContext ?? params.allergyContext)?.productMatchEvidence),
      })
      : {
        status: "pending",
        reasonCode: "ALLERGY_PROFILE_NOT_ATTACHED",
        summary:
          "Allergy-aware reasoning is reserved here, but user allergy settings and normalized product allergen flags are not attached yet.",
        matchedAllergyFlags: [],
        matchedRestrictions: [],
        details: [],
      },
    dosageContext: attachedContext
      ? buildDosageContextFromEvaluation({
        selectedGoalKey,
        evaluation: currentProductEvaluation,
        digest: params.digest,
        usageBlock: params.usageBlock,
      })
      : {
        status: hasVisibleProductDose ? "pending" : "unavailable",
        reasonCode: hasVisibleProductDose ? "RECOMMENDED_DOSE_COMPARISON_NOT_ATTACHED" : "NO_PRODUCT_DOSE_VISIBLE",
        summary: !hasVisibleProductDose
          ? "Recommended-dose comparison is reserved here, and this label does not expose enough dose or directions detail yet."
          : previewTopGoal
            ? `Product dose is visible. The best detected goal preview points to ${humanizeGoalKey(previewTopGoal.goalKey)}, but selected-goal dosage comparison is not attached yet.`
            : "Product dose is visible, but recommended-dose comparison is not attached yet.",
        assessment: dosageAssessment,
        comparisonMode: previewTopGoal && hasVisibleProductDose ? "best_detected_goal_preview" : "not_attached",
        previewGoalKey: previewTopGoal?.goalKey ?? null,
        productDoseText,
        productDirectionsText,
      },
    productStanding: {
      status: "pending",
      reasonCode: "PRODUCT_BENCHMARK_NOT_ATTACHED",
      summary: "Product standing and better alternatives are reserved here, but benchmark logic is not attached to decision support yet.",
      standing: "unknown",
      standingLabel: null,
      benchmarkLabel: "similar products",
      percentile: null,
      peerCount: null,
      betterAlternatives: [],
    },
  };
};

const sanitizeDecisionLine = (value: string | null | undefined): string | null => {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/\bsafe|effective|works?|cures?|treats?\b/i.test(raw)) return null;
  if (/\bnormal function\b|\bday-to-day wellness\b|\bgeneral wellness\b/i.test(raw)) return null;
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
};

const dedupeLines = (lines: Array<string | null | undefined>, max = 3): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = sanitizeDecisionLine(raw);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
};

const dedupeDisplayValues = (values: Array<string | null | undefined>, max = 8): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const normalized = stripTrailingSentencePunctuation(normalizeDisplayText(raw));
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= max) break;
  }
  return out;
};

const dropBestForPrefix = (value: string | null | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^(best for|good if you want|not ideal if)\s*:\s*/i, "").trim();
};

const cleanupSentenceFragment = (value: string | null | undefined): string => {
  const raw = dropBestForPrefix(value);
  return raw.replace(/[.!?]+$/, "").trim();
};

const buildCategoryBestForBullets = (params: {
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  missingActiveBreakdown: boolean;
}): string[] => {
  const { categoryId, safeScienceSignals, missingActiveBreakdown } = params;
  if (categoryId === "fish_oil_omega3") {
    return [
      "Best for: increasing omega-3 intake as part of a heart/vascular-support routine.",
      "Good if you want: products with clear EPA+DHA per serving (easier to compare strength).",
      missingActiveBreakdown
        ? "Not ideal if: the label does not disclose EPA+DHA, because fish-oil mg alone is a weak strength signal."
        : "Not ideal if: you compare only fish-oil mg and ignore EPA+DHA transparency.",
    ];
  }
  if (categoryId === "probiotics") {
    return [
      "Best for: daily gut or digestive-flora support where strain naming and CFU disclosure make probiotic comparisons more grounded.",
      "Good if you want: labels that clearly state probiotic strains, CFU strength, and useful storage or shelf-stability context.",
      "Not ideal if: the label leans on a generic probiotic blend without clarifying strains, CFU, or storage guidance.",
    ];
  }
  if (categoryId === "magnesium") {
    return [
      "Best for: magnesium-support routines where chemical form disclosure helps comparisons stay grounded.",
      "Good if you want: labels that clearly state magnesium form, per-serving strength, and useful timing or food-tolerance context.",
      "Not ideal if: the label names magnesium without clarifying form, because glycinate, citrate, oxide, and similar forms can compare differently for tolerance and fit.",
    ];
  }
  if (categoryId === "sleep_stress_mood_support") {
    return [
      "Best for: sleep-, stress-, or mood-support routines where bedtime timing and calming-active disclosure make comparisons more grounded.",
      "Good if you want: labels that clearly state melatonin, theanine, GABA, 5-HTP, or similar calming actives per serving, plus useful bedtime timing context.",
      "Not ideal if: the label sounds broadly relaxing but does not clarify the core sleep-support actives or when to take them.",
    ];
  }
  if (categoryId === "botanical_herbal_support") {
    return [
      "Best for: herbal-support routines where single-herb naming, extract disclosure, and source transparency make comparisons more grounded.",
      "Good if you want: labels that clearly state the herb, plant part or extract form, and per-serving strength instead of broad botanical language alone.",
      "Not ideal if: the label sounds herbal but does not clarify the main herb, extract strength, or source context well enough to compare products cleanly.",
    ];
  }
  if (categoryId === "metabolic_glucose_support") {
    return [
      "Best for: glucose- or glycemic-support routines where berberine disclosure helps comparisons stay grounded.",
      "Good if you want: products with clear berberine or glucose-support actives per serving, plus useful meal-timing context.",
      "Not ideal if: meal timing or active disclosure is vague, because that makes glucose-support products harder to compare.",
    ];
  }
  if (categoryId === "cholesterol_lipid_support") {
    return [
      "Best for: cholesterol- or lipid-support routines where red-yeast-rice disclosure helps comparisons stay grounded.",
      "Good if you want: products with clear red-yeast-rice or lipid-support actives per serving, plus useful with-food context.",
      "Not ideal if: the label leans on broad herb language without clarifying the core lipid-support actives or supporting context.",
    ];
  }
  if (categoryId === "liver_bile_support") {
    return [
      "Best for: liver-bile or fat-digestion support routines where TUDCA or ox-bile disclosure helps comparisons stay grounded.",
      "Good if you want: products with clear bile-support actives per serving, plus useful with-food or with-fat context.",
      "Not ideal if: the product sounds generically digestive without clarifying the core liver-bile actives or mealtime context.",
    ];
  }

  const base = dedupeLines(
    [
      safeScienceSignals?.bestForBullets?.[0] ?? null,
      safeScienceSignals?.bestForBullets?.[1] ?? null,
      safeScienceSignals?.formImpactLine ?? null,
    ],
    3,
  );
  const bestFor = cleanupSentenceFragment(base[0] ?? "comparing ingredient support based on clear label disclosure");
  const goodIf = cleanupSentenceFragment(
    base[1] ?? "products with clear per-serving disclosure so comparisons are easier",
  );
  const notIdeal = cleanupSentenceFragment(
    base[2] ?? "core disclosure is missing, because confidence drops when key details are not stated",
  );
  return [
    `Best for: ${bestFor}.`,
    `Good if you want: ${goodIf}.`,
    `Not ideal if: ${notIdeal}.`,
  ];
};

const hasDirections = (digest: FactsDigest): boolean =>
  (Array.isArray(digest?.labelDosing) ? digest.labelDosing : []).some((row) =>
    [row?.rawText, row?.dose, row?.frequency].some((value) => normalizeText(value).length > 0),
  );

const hasExplicitForm = (digest: FactsDigest): boolean =>
  (Array.isArray(digest?.actives) ? digest.actives : []).some((active) => {
    const chemicalForm = normalizeText(active?.chemicalForm);
    const activeName = normalizeText(active?.name);
    return chemicalForm.length > 0 || /\bvitamin\s*d[23]\b/.test(activeName);
  });

const hasWarningsData = (digest: FactsDigest): boolean => {
  const warnings = digest?.warnings;
  if (!warnings || typeof warnings !== "object") return false;
  const explicitSignals = [warnings.warnings, warnings.consultDoctorIf, warnings.redFlags]
    .flat()
    .filter((item) => normalizeText(item).length > 0);
  if (explicitSignals.length > 0) return true;
  return warnings.missingFlag === false;
};

const PROBIOTIC_CATEGORY_REGEX = /(probiotic|cfu|lactobacillus|bifidobacterium|saccharomyces|florassist|microbiome|gut)/;
const OUT_OF_SCOPE_NON_SUPPLEMENT_CATEGORY_REGEX =
  /(\bstroopwafels?\b|\bbetter stevia\b|\bconfectioners\b.*\bsweetener\b|\bxylimelts?\b|\bturbinado sugar cubes?\b|\bhawaiian hula rub\b|\bmanuka honey\b|\bhand soap\b|\blotion\b|\bfoam bath\b|\bmoisture cream\b)/;
const TAXONOMY_BACKLOG_HOLD_CATEGORY_REGEX =
  /(\bflat tummy\b.*\bshakes?\b|\bcuraphen\b|\borganic spearmint\b.*\btea\b|\bchitosan\b)/;
const VITAMIN_D_CATEGORY_REGEX = /(vitamin\s*d\b|\bd3\b|\bd2\b|cholecalciferol|ergocalciferol|calcifediol|calcitriol)/;
const MAGNESIUM_CATEGORY_REGEX =
  /(\bmagnesium\b|\bmagnesium glycinate\b|\bmagnesium citrate\b|\bmagnesium oxide\b|\bmagnesium malate\b|\bmagnesium threonate\b|\bmagnesium chloride\b|\bmagnesium taurate\b)/;
const METABOLIC_GLUCOSE_SUPPORT_CATEGORY_REGEX =
  /(\bberberine\b|\bwellbetx\b|\bglucose support\b|\bblood sugar\b|\bglycemic\b|\binsulin support\b)/;
const SPORTS_ANABOLIC_SUPPORT_CATEGORY_REGEX =
  /(\bbeta ecdysterone\b|\becdysterone\b|\banabol\b|\banabolic\b)/;
const CHOLESTEROL_LIPID_SUPPORT_CATEGORY_REGEX =
  /(\bred yeast rice\b|\bcholesterol support\b|\blipid support\b)/;
const LIVER_BILE_SUPPORT_CATEGORY_REGEX =
  /(\btudca\b|\btauroursodeoxycholic\b|\box bile\b|\bbile support\b|\bbile flow\b|\bliver formula\b)/;
const CELLULAR_NUCLEOTIDE_SUPPORT_CATEGORY_REGEX =
  /(\bnucleotide\b|\brna\s*\/\s*dna\b|\bdna\s*\/\s*rna\b)/;
const COLLAGEN_CATEGORY_REGEX =
  /(\bcollagen\b|\bcollagen peptides?\b|\bmarine collagen\b|\bbone broth\b|\btype ii collagen\b)/;
const JOINT_BONE_CATEGORY_REGEX =
  /(\bglucosamine\b|\bchondroitin\b|\bmsm\b|\bhyaluronic\b|\bjoint\b|\bmobility\b|\bcartilage\b|\bosteo\b)/;
const SLEEP_STRESS_MOOD_CATEGORY_REGEX =
  /(\b5-htp\b|\b5[- ]hydroxytryptophan\b|\bmelatonin\b|\bgaba\b|\bl-theanine\b|\btheanine\b|\btryptophan\b|\bmood\b|\bsleep\b|\bstress\b|\bcalm\b|\brelax\b|\badrenal\b)/;
const SPORTS_AMINO_CATEGORY_REGEX =
  /(\bamino\b|\bbcaa\b|\beaa\b|\bcreatine\b|\bglutamine\b|\barginine\b|\bcitrulline\b|\bbeta alanine\b|\bcarnitine\b|\bpre[- ]?workout\b|\bpost[- ]?workout\b|\bhydration\b|\belectrolyte\b|\bwhey\b|\bprotein powder\b|\bpump\b)/;
const DIGESTIVE_FIBER_ENZYME_CATEGORY_REGEX =
  /(\bpsyllium\b|\bfiber\b|\bdigestive\b|\bdigest basic\b|\bdigest spectrum\b|\benzyme\b|\bpancreatic enzymes?\b|\bspectrazyme\b|\bcolon\b|\bcleanse\b|\bwhole husk\b)/;
const SUPERFOODS_MUSHROOMS_GREENS_CATEGORY_REGEX =
  /(\bmushroom\b|\bmushrooms\b|\bmycobotanical\b|\bcordyceps\b|\bcordychi\b|\bgreens?\b|\bsuperfood\b|\bspirulina\b|\bchlorella\b|\bwheatgrass\b|\bbarley grass\b|\bbeet root\b|\bmatcha\b)/;
const ANTIOXIDANT_CELLULAR_ENERGY_CATEGORY_REGEX =
  /(\bcoq-?10\b|\bcoenzyme q10\b|\bubiquinol\b|\bubiquinone\b|\balpha lipoic acid\b|\bastaxanthin\b|\blutein\b|\bzeaxanthin\b|\bquercetin\b|\bresveratrol\b|\bfisetin\b|\bpqq\b|\bglutathione\b|\blycopene\b|\bpolicosanol\b|\bcranberry\b|\bpomegranate\b|\bblueberry extract\b)/;
const NOOTROPIC_MEMORY_COGNITION_CATEGORY_REGEX =
  /(\bciticoline\b|\bcdp choline\b|\bcholine\b|\bcognium\b|\bmemory\b|\bcognitive\b|\bbrain\b|\bfocus\b|\bnootropic\b|\bsharpmind\b|\bsame\b|\bginkgo biloba\b|\bgotu kola\b|\bphosphatidylserine\b|\bnicotinamide riboside\b|\bniagen\b|\bnad\+\b|\bnad plus\b|\bnad daily\b|\bcell regenerator\b)/;
const SPECIALTY_VITAMINS_OTHER_CATEGORY_REGEX =
  /(\bvitamin b-?12\b|\bcobalamin\b|\bvitamin b-?3\b|\bniacin\b|\bniacinamide\b|\bvitamin a\b|\bbenfotiamine\b|\bvitamin e\b)/;
const SPECIALTY_SINGLE_AMINO_AND_NEURO_CATEGORY_REGEX =
  /(\bl-lysine\b|\blysine\b|\btaurine\b|\bl-tyrosine\b|\btyrosine\b|\bn-acetyl l-tyrosine\b|\bn-acetyl cysteine\b|\bnac\b)/;
const FATTY_ACIDS_SPECIALTY_LIPIDS_CATEGORY_REGEX =
  /(\bmct oil\b|\bmedium chain triglycerides?\b|\bcoconut oil\b|\bhemp seed oil\b|\bevening primrose\b|\blecithin\b|\bphospholipid complex\b|\bliposomal phospholipid\b)/;
const WOMENS_HORMONAL_AND_LACTATION_CATEGORY_REGEX =
  /(\bmeta-balance\b|\bblack cohosh\b|\bmenopause\b|\bperimenopaus\w*\b|\bpms\b|\bchaste tree\b|\bwild yam\b|\bsoy isoflavones?\b|\bovulation support\b|\blactation\b|\bbreastfeeding\b|\bmore milk\b)/;
const MENS_PROSTATE_AND_HORMONAL_CATEGORY_REGEX =
  /(\bsaw palmetto\b|\bdhea\b|\bdehydroepiandrosterone\b|\bmen'?s fertility support\b|\bmen'?s motility support\b|\btestosterone support\b|\bmale performance\b|\bmale enhancement\b)/;
const DIGESTIVE_AND_GASTRO_FUNCTIONAL_CATEGORY_REGEX =
  /(\bpapaya\b|\bpapain\b|\bconstipation\b|\bbowel movement\b|\bkeep it movin\b|\bmove things along\b|\bslimming tea\b|\bherbal laxative\b)/;
const BOTANICAL_HERBAL_CATEGORY_REGEX =
  /(\bturmeric\b|\bcurcumin\b|\bashwagandha\b|\bvalerian\b|\byellow dock\b|\bblack seed\b|\bmilk thistle\b|\bechinacea\b|\belderberry\b|\bginseng\b|\brhodiola\b|\bmaca\b|\bgarlic\b|\bboswellia\b|\bdevil'?s claw\b|\bgrape seed\b|\bhorse chestnut\b|\bcatuaba\b|\bmucuna pruriens\b|\bastragalus\b|\bwormwood\b|\bfenugreek\b|\bolive leaf\b|\boregano\b|\bhawthorn\b|st\.?\s*john'?s wort\b|\bslippery elm\b|\bshilajit\b|\bbutterbur\b|\bsaffron\b|\bcoleus forskoh?lii\b|\bgrapefruit seed extract\b|\bchanca piedra\b|\bginger\b|\blicorice\b|\bcinnamon\b|\bherb\b|\bbotanical\b)/;
const VITAMIN_MINERAL_OTHER_CATEGORY_REGEX =
  /(\bvitamin c\b|\bcomplex c\b|\bpaba\b|\bbiotin\b|\bselenium\b|\bchromium\b|\bboron\b|\bpotassium\b|\bcalcium\b|\biron\b|\bzinc\b|\bcopper\b|\bmanganese\b|\bmolybdenum\b|\biodine\b|\bprenatal\b)/;
const SPECIALTY_FOLATE_CATEGORY_REGEX = /(\bmethyl folate\b|\bmethylfolate\b|\b5-mthf\b|\bfolate\b)/;

const detectCategoryId = (digest: FactsDigest): DecisionSupportCategoryId => {
  const productText = `${normalizeText(digest?.product?.name)} ${normalizeText(digest?.product?.brandDisplay)}`;
  const activeNames = normalizeActiveNames(digest);
  const combined = `${productText} ${activeNames.join(" ")}`;

  if (/(fish\s*oil|omega\s*-?\s*3|epa|dha|theromega)/.test(combined)) return "fish_oil_omega3";
  if (OUT_OF_SCOPE_NON_SUPPLEMENT_CATEGORY_REGEX.test(combined)) return "out_of_scope_non_supplement";
  if (TAXONOMY_BACKLOG_HOLD_CATEGORY_REGEX.test(combined)) return "taxonomy_backlog_hold";

  const probioticInProductName = PROBIOTIC_CATEGORY_REGEX.test(productText);
  const probioticInActives = activeNames.some((name) => PROBIOTIC_CATEGORY_REGEX.test(name));
  const vitaminDInProductName = VITAMIN_D_CATEGORY_REGEX.test(productText);
  const vitaminDInActives = activeNames.some((name) => VITAMIN_D_CATEGORY_REGEX.test(name));

  // Probiotic-branded products can still carry incidental vitamin D terms.
  // When both appear, bias to probiotics unless only vitamin D appears in actives.
  if (probioticInProductName || probioticInActives) {
    if (!vitaminDInProductName && vitaminDInActives && !probioticInActives) {
      return "vitamin_d";
    }
    return "probiotics";
  }

  if (vitaminDInProductName || vitaminDInActives) return "vitamin_d";
  if (MAGNESIUM_CATEGORY_REGEX.test(combined)) return "magnesium";
  if (METABOLIC_GLUCOSE_SUPPORT_CATEGORY_REGEX.test(combined)) return "metabolic_glucose_support";
  if (SPORTS_ANABOLIC_SUPPORT_CATEGORY_REGEX.test(combined)) return "sports_anabolic_support";
  if (CHOLESTEROL_LIPID_SUPPORT_CATEGORY_REGEX.test(combined)) return "cholesterol_lipid_support";
  if (LIVER_BILE_SUPPORT_CATEGORY_REGEX.test(combined)) return "liver_bile_support";
  if (CELLULAR_NUCLEOTIDE_SUPPORT_CATEGORY_REGEX.test(combined)) return "cellular_nucleotide_support";
  if (ANTIOXIDANT_CELLULAR_ENERGY_CATEGORY_REGEX.test(combined)) return "antioxidant_cellular_energy";
  if (NOOTROPIC_MEMORY_COGNITION_CATEGORY_REGEX.test(combined)) return "nootropic_memory_cognition";
  if (SPECIALTY_VITAMINS_OTHER_CATEGORY_REGEX.test(combined)) return "specialty_vitamins_other";
  if (SPECIALTY_FOLATE_CATEGORY_REGEX.test(combined)) return "specialty_vitamins_other";
  if (SPECIALTY_SINGLE_AMINO_AND_NEURO_CATEGORY_REGEX.test(combined)) return "specialty_single_amino_and_neuro";
  if (FATTY_ACIDS_SPECIALTY_LIPIDS_CATEGORY_REGEX.test(combined)) return "fatty_acids_specialty_lipids";
  if (WOMENS_HORMONAL_AND_LACTATION_CATEGORY_REGEX.test(combined)) return "womens_hormonal_and_lactation";
  if (MENS_PROSTATE_AND_HORMONAL_CATEGORY_REGEX.test(combined)) return "mens_prostate_and_hormonal";
  if (DIGESTIVE_AND_GASTRO_FUNCTIONAL_CATEGORY_REGEX.test(combined)) return "digestive_and_gastro_functional";
  if (COLLAGEN_CATEGORY_REGEX.test(combined)) return "collagen_connective_support";
  if (SLEEP_STRESS_MOOD_CATEGORY_REGEX.test(combined)) return "sleep_stress_mood_support";
  if (SPORTS_AMINO_CATEGORY_REGEX.test(combined)) return "sports_performance_amino_acids";
  if (DIGESTIVE_FIBER_ENZYME_CATEGORY_REGEX.test(combined)) return "digestive_fiber_enzymes";
  if (SUPERFOODS_MUSHROOMS_GREENS_CATEGORY_REGEX.test(combined)) return "superfoods_mushrooms_greens";
  if (JOINT_BONE_CATEGORY_REGEX.test(combined)) return "joint_bone_mobility";
  if (BOTANICAL_HERBAL_CATEGORY_REGEX.test(combined)) return "botanical_herbal_support";
  if (VITAMIN_MINERAL_OTHER_CATEGORY_REGEX.test(combined)) return "vitamin_mineral_other";
  return "unknown";
};

const hasFishOilBreakdown = (digest: FactsDigest): boolean => {
  const activeNames = normalizeActiveNames(digest);
  return activeNames.some((name) => /(\bepa\b|\bdha\b|total\s*omega\s*-?\s*3|omega\s*-?\s*3)/.test(name));
};

type OverlayOmega3Facts = {
  hasAny: boolean;
  hasEpaDhaBreakdown: boolean;
  hasFishOilTotal: boolean;
  entries: Array<{ name: string; dose: string }>;
};

const normalizeOverlayDose = (value: string | null | undefined): string | null => {
  const normalized = normalizeDisplayText(value);
  return normalized.length > 0 ? normalized : null;
};

const parseOverlayOmega3Facts = (overlayClaims: DecisionSupportOverlayClaims | null | undefined): OverlayOmega3Facts => {
  const rows = Array.isArray(overlayClaims?.nutritionalFacts) ? overlayClaims.nutritionalFacts : [];
  const normalizedRows = rows.map((row) => ({
    nameRaw: normalizeDisplayText(row?.substancy),
    name: normalizeText(row?.substancy),
    dose: normalizeOverlayDose(row?.amountPerServing),
  }));

  const findDose = (matcher: (name: string) => boolean): { name: string; dose: string } | null => {
    const hit = normalizedRows.find((row) => matcher(row.name) && row.dose);
    if (!hit || !hit.dose) return null;
    return { name: hit.nameRaw || "Ingredient", dose: hit.dose };
  };

  const totalOmega3 = findDose((name) => /\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b/.test(name));
  const epa = findDose((name) => /\bepa\b|eicosapentaenoic/.test(name));
  const dha = findDose((name) => /\bdha\b|docosahexaenoic/.test(name));
  const fishOil = findDose((name) => /\bfish\s*oil\b|\bkrill\s*oil\b|\bpollock\b/.test(name));

  const entries = [totalOmega3, epa, dha, fishOil].filter((item): item is { name: string; dose: string } => Boolean(item));
  return {
    hasAny: entries.length > 0,
    hasEpaDhaBreakdown: Boolean(epa && dha),
    hasFishOilTotal: Boolean(fishOil),
    entries,
  };
};

const OVERLAY_FACTS_HEADER_PATTERN =
  /(amount\s+per\s+serving|daily\s+value|%dv|%\s*dv|serving\s+size|servings\s+per\s+container)/i;

const extractChemicalFormFromFactsRow = (
  substancy: string,
): { baseName: string; form: string } | null => {
  const rowText = normalizeDisplayText(substancy);
  if (!rowText) return null;
  if (OVERLAY_FACTS_HEADER_PATTERN.test(rowText)) return null;

  const parenthetical = rowText.match(/\((as|from)\s+([^)]+)\)/i);
  if (parenthetical?.index != null && parenthetical[2]) {
    const baseName = normalizeDisplayText(rowText.slice(0, parenthetical.index));
    const form = normalizeDisplayText(parenthetical[2].replace(/[™®]/g, ""));
    if (baseName && form && !OVERLAY_FACTS_HEADER_PATTERN.test(baseName)) {
      return { baseName, form };
    }
  }

  const trailingPhrase = rowText.match(/\b(as|from)\s+([^,;()]+)$/i);
  if (trailingPhrase?.index != null && trailingPhrase[2]) {
    const baseName = normalizeDisplayText(rowText.slice(0, trailingPhrase.index));
    const form = normalizeDisplayText(trailingPhrase[2].replace(/[™®]/g, ""));
    if (baseName && form && !OVERLAY_FACTS_HEADER_PATTERN.test(baseName)) {
      return { baseName, form };
    }
  }

  return null;
};

const extractOverlayChemicalFormFromFacts = (
  overlayClaims: DecisionSupportOverlayClaims | null | undefined,
): { baseName: string; form: string } | null => {
  const rows = Array.isArray(overlayClaims?.nutritionalFacts) ? overlayClaims.nutritionalFacts : [];
  for (const row of rows) {
    const parsed = extractChemicalFormFromFactsRow(String(row?.substancy ?? ""));
    if (parsed) return parsed;
  }
  return null;
};

const OMEGA3_FORM_CUES: Array<{ re: RegExp; label: string }> = [
  { re: /\bre-?esterified triglyceride\b|\brtg\b/, label: "Re-esterified triglyceride (rTG)" },
  { re: /\btriglyceride\b|\btg\b/, label: "Triglyceride (TG)" },
  { re: /\bethyl ester\b/, label: "Ethyl ester" },
  { re: /\bphospholipid\b/, label: "Phospholipid" },
];

const extractOmega3FormCueFromOverlay = (
  overlayClaims: DecisionSupportOverlayClaims | null | undefined,
): string | null => {
  const corpus = normalizeOverlayCorpus(overlayClaims);
  if (!corpus) return null;
  for (const cue of OMEGA3_FORM_CUES) {
    if (cue.re.test(corpus)) return cue.label;
  }
  return null;
};

const hasOverlayChemicalFormCue = (
  categoryId: DecisionSupportCategoryId,
  overlayClaims: DecisionSupportOverlayClaims | null | undefined,
): boolean => {
  if (extractOverlayChemicalFormFromFacts(overlayClaims)) return true;
  const corpus = normalizeOverlayCorpus(overlayClaims);
  if (!corpus) return false;
  if (categoryId === "fish_oil_omega3") {
    return Boolean(extractOmega3FormCueFromOverlay(overlayClaims));
  }
  if (categoryId === "vitamin_d") {
    return /\bd3\b|\bd2\b|cholecalciferol|ergocalciferol/.test(corpus);
  }
  if (categoryId === "magnesium") {
    return /\bglycinate\b|\bcitrate\b|\boxide\b|\bmalate\b|\bthreonate\b|\btaurate\b/.test(corpus);
  }
  return false;
};

const parseOverlaySuggestedUseLine = (overlayClaims: DecisionSupportOverlayClaims | null | undefined): string | null => {
  const raw = normalizeDisplayText(overlayClaims?.suggestedUse);
  if (!raw) return null;
  const withoutPrefix = raw.replace(/^suggested use\s*[:\-]?\s*/i, "");
  const firstSentence = withoutPrefix.split(/(?<=[.!?])\s+/)[0] || withoutPrefix;
  return sanitizeDecisionLine(firstSentence) ?? sanitizeDecisionLine(withoutPrefix);
};

const splitOverlayTextLines = (value: string | null | undefined, max = 5): string[] => {
  const raw = normalizeDisplayText(value);
  if (!raw) return [];
  const parts = raw
    .replace(/[\r\n]+/g, ". ")
    .split(/(?:•|\u2022|;|(?<=[.!?])\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);
  return dedupeLines(parts, max);
};

const detectOverlayDosageForm = (overlayClaims: DecisionSupportOverlayClaims | null | undefined): string | null => {
  const corpus = normalizeOverlayCorpus(overlayClaims);
  if (!corpus) return null;
  if (/\bsoftgels?\b/.test(corpus)) return "Softgel";
  if (/\bcapsules?\b/.test(corpus)) return "Capsule";
  if (/\btablets?\b/.test(corpus)) return "Tablet";
  if (/\bgummies?\b/.test(corpus)) return "Gummy";
  if (/\bpowder\b/.test(corpus)) return "Powder";
  if (/\bliquid\b/.test(corpus)) return "Liquid";
  return null;
};

const resolveScienceDosageForm = (params: {
  digest: FactsDigest;
  overlayClaims: DecisionSupportOverlayClaims | null | undefined;
  ingredientSourceTier: "overlay_iherb" | "official_record";
}): string | null => {
  const digestDosageForm = normalizeDisplayText(params.digest?.product?.dosageForm) || null;
  const overlayDosageForm = detectOverlayDosageForm(params.overlayClaims);
  if (params.ingredientSourceTier === "overlay_iherb") {
    return overlayDosageForm || digestDosageForm || null;
  }
  return digestDosageForm || overlayDosageForm || null;
};

const toSubscore = (id: DecisionSupportSubscoreId, checklist: DecisionSupportChecklistItem[]): DecisionSupportSubscore => {
  const relevant = checklist.filter((item) => item.id.startsWith(`${id.toLowerCase()}:`));
  const visible = relevant;
  const totalWeight = visible.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const passedWeight = visible
    .filter((item) => item.passed)
    .reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const ratio = totalWeight > 0 ? passedWeight / totalWeight : 0;
  return {
    id,
    score: scoreClamp(ratio * 100),
    passedWeight,
    totalWeight,
    checklistCount: visible.length,
  };
};

const blockerPriority = (blocker: DecisionSupportBlocker): [number, number, string] => {
  const severityRank = blocker.severity === "high" ? 3 : blocker.severity === "medium" ? 2 : 1;
  const fixabilityRank = blocker.fixability === "fixable" ? 3 : blocker.fixability === "unknown" ? 2 : 1;
  return [severityRank, fixabilityRank, blocker.code];
};

const compareBlockers = (a: DecisionSupportBlocker, b: DecisionSupportBlocker): number => {
  const pa = blockerPriority(a);
  const pb = blockerPriority(b);
  if (pa[0] !== pb[0]) return pb[0] - pa[0];
  if (pa[1] !== pb[1]) return pb[1] - pa[1];
  return pa[2].localeCompare(pb[2]);
};

const dedupeSourceTiers = (checklist: DecisionSupportChecklistItem[]): DecisionSupportSourceTier[] =>
  Array.from(new Set(checklist.map((item) => item.sourceTier)));

const buildChecklist = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  viewMode: DecisionSupportViewMode;
  missingWarningsAsFixable: boolean;
  missingWarningsAsCeiling: boolean;
  missingDirectionsDsld: boolean;
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  qualitySignal: DecisionSupportExtraTrustSignal;
}): DecisionSupportChecklistItem[] => {
  const {
    digest,
    categoryId,
    viewMode,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
    safeScienceSignals,
    qualitySignal,
  } = params;

  const officialRecord = digest.sourceType === "lnhpd" || digest.sourceType === "dsld";
  const scannedLabel = false;
  const supportSignals = Array.isArray(digest.actives) && digest.actives.length > 0;
  const amountDisclosed = (digest.actives ?? []).some((item) => Number.isFinite(Number(item?.amount)) && normalizeText(item?.unit).length > 0);
  const hasDirectionsData = hasDirections(digest);
  const warningsAvailable = hasWarningsData(digest);
  const explicitForm = hasExplicitForm(digest);
  const hasInferredSignals = (digest.actives ?? []).some((item) => normalizeText(item?.chemicalForm).length > 0);
  const hasMissingItemsSurfaced = missingWarningsAsFixable || missingWarningsAsCeiling || missingDirectionsDsld || missingActiveBreakdown;

  const all: DecisionSupportChecklistItem[] = [
    {
      id: "goalevidencefit:official_record_used",
      label: "Official record linked",
      passed: officialRecord,
      weight: 3,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
    },
    {
      id: "goalevidencefit:ingredient_signal_present",
      label: "Category intent recognized",
      why: safeScienceSignals?.bestForBullets?.[0] ?? null,
      passed: supportSignals,
      weight: 3,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: true,
    },
    {
      id: "goalevidencefit:category_profile_resolved",
      label: "Category profile resolved",
      passed: categoryId !== "unknown",
      weight: 2,
      sourceTier: "general_science",
      affectsCoreVerdict: false,
    },

    {
      id: "formulaquality:amount_disclosed",
      label: categoryId === "fish_oil_omega3" ? "Oil amount disclosed" : "Active amount disclosed",
      passed: amountDisclosed,
      weight: 4,
      sourceTier: officialRecord ? "official_record" : "general_science",
      affectsCoreVerdict: true,
    },
    {
      id: "formulaquality:form_disclosed",
      label: "Chemical form disclosed",
      why: safeScienceSignals?.formImpactLine ?? null,
      passed: !missingFormHighImpact && explicitForm,
      weight: 2,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: true,
    },
    {
      id: "formulaquality:active_breakdown",
      label: categoryId === "fish_oil_omega3" ? "EPA+DHA breakdown disclosed" : "Active breakdown disclosed",
      passed: !missingActiveBreakdown,
      weight: 4,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
    },

    {
      id: "safetytransparency:directions_present",
      label: "Directions present in record",
      passed: hasDirectionsData,
      weight: 4,
      sourceTier: officialRecord ? "official_record" : "general_science",
      affectsCoreVerdict: true,
    },
    {
      id: "safetytransparency:warnings_present",
      label: "Label warnings present in record",
      why: safeScienceSignals?.beforeYouBuyLine ?? null,
      passed: warningsAvailable,
      weight: 4,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: missingWarningsAsFixable,
    },
    {
      id: "safetytransparency:warnings_ceiling_notice",
      label: "Missing items surfaced in Missing info (Overview)",
      passed: hasMissingItemsSurfaced || (warningsAvailable && hasDirectionsData),
      weight: 1,
      sourceTier: "official_record",
      affectsCoreVerdict: false,
    },

    {
      id: "trustqualityassurance:source_finality",
      label: "Authoritative source finalized",
      passed: officialRecord,
      weight: 4,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
    },
    {
      id: "trustqualityassurance:quality_mark_checked",
      label: "Third-party quality mark checked",
      passed: qualitySignal.checked && qualitySignal.status !== "unknown",
      weight: 1,
      sourceTier: qualitySignal.status === "unknown" ? "inferred" : "general_science",
      affectsCoreVerdict: false,
    },
    {
      id: "trustqualityassurance:inferred_hint_available",
      label: "Inferred hint available",
      passed: hasInferredSignals,
      weight: 1,
      sourceTier: "inferred",
      affectsCoreVerdict: false,
    },
  ];

  if (missingDirectionsDsld) {
    return all.map((item) =>
      item.id === "safetytransparency:directions_present" ? { ...item, passed: false } : item,
    );
  }
  return all;
};

const buildBlockers = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  missingWarningsAsFixable: boolean;
  missingWarningsAsCeiling: boolean;
  missingDirectionsDsld: boolean;
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
}): DecisionSupportBlocker[] => {
  const blockers: DecisionSupportBlocker[] = [];

  if (params.missingActiveBreakdown) {
    blockers.push({
      code: "missing_active_breakdown",
      title: "Active breakdown missing",
      why: "EPA/DHA or total omega-3 breakdown is not disclosed in this record.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingDirectionsDsld) {
    blockers.push({
      code: "missing_directions_dsld",
      title: "Directions missing in DSLD record",
      why: "Directions are not provided in this record and should be verified from the label.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingWarningsAsFixable) {
    blockers.push({
      code: "warnings_missing_fixable",
      title: "Label warnings missing",
      why: "Label-specific warnings are expected but missing from the captured record.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingWarningsAsCeiling) {
    blockers.push({
      code: "warnings_missing_ceiling",
      title: "Label warnings unavailable in official record",
      why: "This dataset usually does not include full label warnings, so package verification is still needed.",
      severity: "medium",
      fixability: "ceiling",
      affectsCoreVerdict: false,
      beforeYouBuy: true,
    });
  }

  if (params.missingFormHighImpact) {
    blockers.push({
      code: "missing_form_high_impact",
      title: "Form disclosure is incomplete",
      why: "A high-impact form detail is not explicitly stated in this record.",
      severity: "medium",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: false,
    });
  }

  return blockers.sort(compareBlockers);
};

const deriveVerdict = (params: {
  subscores: DecisionSupportSubscore[];
  topBlockers: DecisionSupportBlocker[];
}): { verdict: DecisionSupportVerdict; verdictReason: string } => {
  const { subscores, topBlockers } = params;
  const coreBlockers = topBlockers.filter((item) => item.affectsCoreVerdict);
  const highCoreBlockerCount = coreBlockers.filter((item) => item.severity === "high").length;
  const average = subscores.length > 0
    ? subscores.reduce((sum, item) => sum + item.score, 0) / subscores.length
    : 0;

  if (highCoreBlockerCount > 0 || average < 55) {
    return {
      verdict: "hard_to_recommend_until_label_verified",
      verdictReason: highCoreBlockerCount > 0
        ? "High-impact blockers remain unresolved."
        : "Decision-support confidence is low from current record coverage.",
    };
  }

  if (coreBlockers.length === 0 && average >= 75) {
    return {
      verdict: "strong_candidate",
      verdictReason: "Coverage is strong enough for shopping readiness.",
    };
  }

  return {
    verdict: "reasonable_but_incomplete",
    verdictReason: "Core fields are partly available, but some gaps still need label verification.",
  };
};

const findSubscore = (subscores: DecisionSupportSubscore[], id: DecisionSupportSubscoreId): number =>
  subscores.find((item) => item.id === id)?.score ?? 0;

const CLAIM_CGMP_REGEX = /\bcgmp\b|good[-\s]*manufacturing[-\s]*practice|certified[-\s]*manufacturing/i;
const CLAIM_CGMP_COMPACT_REGEX = /cgmp|goodmanufacturingpractice|certifiedmanufacturing/i;
const CLAIM_THIRD_PARTY_TESTED_REGEX =
  /\bthird[-\s]*party[-\s]*tested\b|\bifos\b|\busp\b|\bnsf\b|informed[-\s]*choice|informed[-\s]*sport|\bbscg\b/i;
const CLAIM_THIRD_PARTY_TESTED_COMPACT_REGEX =
  /thirdpartytested|ifos|usp|nsf|informedchoice|informedsport|bscg/i;
const CLAIM_QUALITY_SIGNAL_REGEX = /\bnon[-\s]?gmo\b|\bgluten[-\s]?free\b|\bvegan\b|\bsoy[-\s]?free\b|\bdairy[-\s]?free\b|\bmsc\b/i;
const CLAIM_QUALITY_SIGNAL_COMPACT_REGEX = /nongmo|glutenfree|vegan|soyfree|dairyfree|msc/i;
const CLAIM_MANUFACTURING_ORIGIN_REGEX = /\bmade in\b|\bmanufactured in\b|\bfacility\b|\busa\b|\bcanada\b/i;
const CLAIM_MANUFACTURING_ORIGIN_COMPACT_REGEX = /madein|manufacturedin|facility|usa|canada/i;
const CLAIM_CHEMICAL_FORM_REGEX =
  /\bd3\b|\bd2\b|\bmk[-\s]?7\b|\bmk[-\s]?4\b|\bubiquinol\b|\bubiquinone\b|\bcitrate\b|\boxide\b|\bglycinate\b|\bmalate\b|\btriglyceride(?:\s+form)?\b|\brtg\b|\btg\s+as\s+rtg\b/i;
const CLAIM_CHEMICAL_FORM_COMPACT_REGEX =
  /d3|d2|mk7|mk4|ubiquinol|ubiquinone|citrate|oxide|glycinate|malate|triglycerideform|triglyceride|tgasrtg|rtg/i;
const CLAIM_EPA_DHA_REGEX = /\bepa\b|\bdha\b|omega[-\s]?3/i;
const CLAIM_EPA_DHA_COMPACT_REGEX = /epa|dha|omega3/i;
const CONFIDENCE_EVIDENCE_WEIGHTS: Record<DecisionSupportEvidenceStrength, number> = {
  official: 1.0,
  scanned_label: 0.95,
  overlay_label_transcription: 0.85,
  cert_page_verified: 1.0,
  overlay_claim: 0.6,
  general_science: 0.55,
  inferred: 0.25,
};

const MODULE_WEIGHTS_DEFAULT: Record<DecisionSupportNutriScoreCardV2ModuleId, number> = {
  ingredient_safety: 20,
  formula_transparency: 25,
  label_clarity: 15,
  manufacturing_standards: 10,
  testing_verification: 20,
  product_quality: 10,
};

const MODULE_WEIGHTS_FISH_OIL: Record<DecisionSupportNutriScoreCardV2ModuleId, number> = {
  ingredient_safety: 15,
  formula_transparency: 30,
  label_clarity: 15,
  manufacturing_standards: 10,
  testing_verification: 20,
  product_quality: 10,
};

const normalizeOverlayCorpus = (overlayClaims: DecisionSupportOverlayClaims | null | undefined): string =>
  [
    overlayClaims?.description ?? "",
    overlayClaims?.suggestedUse ?? "",
    overlayClaims?.otherIngredients ?? "",
    overlayClaims?.warnings ?? "",
    overlayClaims?.disclaimer ?? "",
    ...(overlayClaims?.categories ?? []),
    ...(overlayClaims?.nutritionalFacts ?? []).map((row) =>
      [row.substancy, row.amountPerServing, row.dailyValuePercent ?? ""].join(" "),
    ),
  ]
    .join(" ")
    .normalize("NFKD")
    .replace(/[®™]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([^a-z0-9\s])/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const compactOverlayCorpus = (value: string): string => value.replace(/[^a-z0-9]+/g, "");

const claimRegexMatch = (params: {
  corpus: string;
  corpusCompact: string;
  spaced: RegExp;
  compact: RegExp;
}): boolean => params.spaced.test(params.corpus) || params.compact.test(params.corpusCompact);

const buildOverlayThirdPartyVerificationSummary = (params: {
  corpus: string;
  corpusCompact: string;
}): QualityMarkVerificationSummary | null => {
  const programIds = detectQualityMarkProgramIds({
    text: params.corpus,
    compactText: params.corpusCompact,
    includeNonEquivalent: true,
  });
  if (programIds.length === 0) return null;
  const programMatches = buildQualityMarkProgramMatches({
    programIds,
    status: "claimed_on_product_page",
    evidenceUrl: null,
    evidenceType: "page",
    sourceType: "retailer_marketplace",
    confidence: 0.6,
    note: "Detected from overlay claim text.",
  });
  return summarizeQualityMarkProgramMatches({
    programMatches,
    checked: true,
  });
};

const extractThirdPartyTestingSources = (params: {
  corpus: string;
  corpusCompact: string;
  qualityMark: DecisionSupportQualityMark;
}): string[] => {
  const { corpus, corpusCompact, qualityMark } = params;
  const overlayProgramLabels = detectQualityMarkProgramIds({
    text: corpus,
    compactText: corpusCompact,
    includeNonEquivalent: false,
  })
    .map((programId) => getQualityMarkProgramDefinition(programId)?.label ?? null)
    .filter(Boolean) as string[];
  const qualityMarkLabels = (qualityMark.programMatches ?? [])
    .filter((match) => isGenericThirdPartyClaimEvidenceMatch(match))
    .map((match) => match.programLabel);
  const hits = [...overlayProgramLabels, ...qualityMarkLabels];

  const hasGenericThirdPartyClaim = CLAIM_THIRD_PARTY_TESTED_REGEX.test(corpus) ||
    CLAIM_THIRD_PARTY_TESTED_COMPACT_REGEX.test(corpusCompact);
  if (hits.length === 0 && hasGenericThirdPartyClaim) {
    hits.push("Third-party tested (program unspecified)");
  }

  if (qualityMark.verificationSummary?.officialRegistryVerified) {
    hits.push("Official registry verification");
  } else if (qualityMark.verificationSummary?.productPageClaimDetected) {
    hits.push("Product page claim detected");
  }

  return Array.from(new Set(hits));
};

const getOverallBand = (score: number): DecisionSupportOverallBand => {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 45) return "Limited";
  return "Weak";
};

const getModuleBand = (score: number): DecisionSupportModuleBand => {
  if (score >= 85) return "High";
  if (score >= 65) return "Moderate";
  if (score >= 40) return "Limited";
  return "Low";
};

const moduleBandToStatus = (band: DecisionSupportModuleBand): "high" | "moderate" | "limited" | "low" => {
  if (band === "High") return "high";
  if (band === "Moderate") return "moderate";
  if (band === "Limited") return "limited";
  return "low";
};

const buildV2ChecklistItem = (params: {
  key: string;
  label: string;
  state: DecisionSupportChecklistStatus;
  sourceTier: DecisionSupportSourceTier;
  evidenceStrength: DecisionSupportEvidenceStrength;
  evidenceRef?: string | null;
  note?: string | null;
  weight?: number;
  role?: DecisionSupportChecklistRole;
  critical?: boolean;
  proofClass?: DecisionSupportProofClass;
  scoreEligible?: boolean;
}): DecisionSupportNutriScoreCardV2ChecklistItem => {
  const role = params.role ?? "score";
  const inferredWeight = role === "score" ? 1 : 0;
  const weight = Number.isFinite(Number(params.weight)) ? Math.max(0, Number(params.weight)) : inferredWeight;
  return {
  key: params.key,
  label: params.label,
  state: params.state,
  sourceTier: params.sourceTier,
  evidenceStrength: params.evidenceStrength,
  evidenceRef: params.evidenceRef ?? null,
  note: params.note ?? null,
  weight,
  role,
  critical: Boolean(params.critical),
  proofClass: params.proofClass,
  scoreEligible: params.scoreEligible ?? (role === "score" && weight > 0),
  };
};

const resolveProofClass = (item: DecisionSupportNutriScoreCardV2ChecklistItem): DecisionSupportProofClass => {
  if (item.proofClass) return item.proofClass;
  if (item.evidenceStrength === "official" || item.evidenceStrength === "scanned_label") return "official_like";
  if (item.evidenceStrength === "overlay_label_transcription") return "overlay_transcription";
  if (item.evidenceStrength === "overlay_claim") return "claim_only";
  if (item.evidenceStrength === "cert_page_verified") return "independent_verifier";
  return "science_only";
};

const legacyScoreFromItems = (items: DecisionSupportNutriScoreCardV2ChecklistItem[]): number => {
  const scoredItems = items.filter((item) => item.scoreEligible !== false);
  if (scoredItems.length === 0) return 0;
  const verifiedCount = scoredItems.filter((item) => item.state === "verified").length;
  const unknownCount = scoredItems.filter((item) => item.state === "unknown").length;
  const unknownRatio = unknownCount / scoredItems.length;
  let score = scoreClamp((verifiedCount / scoredItems.length) * 100);
  if (unknownRatio > 0.6) score = Math.min(score, 45);
  else if (unknownRatio > 0.4) score = Math.min(score, 60);
  return score;
};

const getModuleProofCap = (params: {
  moduleId: DecisionSupportNutriScoreCardV2ModuleId;
  scoreItems: DecisionSupportNutriScoreCardV2ChecklistItem[];
}): number => {
  const verified = params.scoreItems.filter((item) => item.state === "verified");
  const proofWeight = {
    official_like: 0,
    overlay_transcription: 0,
    claim_only: 0,
    independent_verifier: 0,
    science_only: 0,
  };
  for (const item of verified) {
    const cls = resolveProofClass(item);
    proofWeight[cls] += Math.max(0, item.weight);
  }
  const hasOfficialLike = proofWeight.official_like > 0;
  const hasOverlayTranscription = proofWeight.overlay_transcription > 0;
  const hasClaimOnly = proofWeight.claim_only > 0;
  const hasIndependentVerifier = proofWeight.independent_verifier > 0;
  const hasBatchPublicProof = verified.some(
    (item) => /batch_public_report|public_coa|lot_report/i.test(item.key),
  );

  switch (params.moduleId) {
    case "ingredient_safety":
      if (hasOfficialLike) return 100;
      if (hasOverlayTranscription) return 85;
      if (hasClaimOnly) return 70;
      return 60;
    case "formula_transparency":
      if (hasOfficialLike) return 100;
      if (hasOverlayTranscription) return 90;
      if (hasClaimOnly) return 75;
      return 60;
    case "label_clarity":
      if (hasOfficialLike) return 100;
      if (hasOverlayTranscription) return 90;
      if (hasClaimOnly) return 70;
      return 55;
    case "manufacturing_standards":
      if (hasOfficialLike || hasIndependentVerifier) return 100;
      if (hasClaimOnly) return 60;
      return 45;
    case "testing_verification":
      if (hasBatchPublicProof) return 100;
      if (hasIndependentVerifier) return 85;
      if (hasClaimOnly) return 55;
      return 40;
    case "product_quality":
      if (hasOfficialLike || hasOverlayTranscription) return 90;
      if (hasClaimOnly) return 80;
      return 45;
    default:
      return 60;
  }
};

const getModuleCriticalCap = (params: {
  moduleId: DecisionSupportNutriScoreCardV2ModuleId;
  categoryId: DecisionSupportCategoryId;
  scoreItems: DecisionSupportNutriScoreCardV2ChecklistItem[];
}): { cap: number; triggered: boolean } => {
  let cap = 100;
  let triggered = false;
  const { moduleId, categoryId, scoreItems } = params;

  const hasCriticalGap = scoreItems.some((item) => item.critical && item.state !== "verified");
  if (hasCriticalGap) {
    cap = Math.min(cap, 85);
    triggered = true;
  }

  if (categoryId === "fish_oil_omega3" && moduleId === "formula_transparency") {
    const breakdown = scoreItems.find((item) => /breakdown_disclosed/i.test(item.key));
    const chemicalForm = scoreItems.find((item) => /chemical_form_disclosed/i.test(item.key));
    if (!breakdown || breakdown.state !== "verified") {
      cap = Math.min(cap, 74);
      triggered = true;
    } else if (!chemicalForm || chemicalForm.state !== "verified") {
      cap = Math.min(cap, 88);
      triggered = true;
    }
  }

  if (categoryId === "fish_oil_omega3" && moduleId === "testing_verification") {
    const thirdPartyClaim = scoreItems.find((item) => /third_party_tested_claim/i.test(item.key));
    if (!thirdPartyClaim || thirdPartyClaim.state !== "verified") {
      cap = Math.min(cap, 55);
      triggered = true;
    }
  }

  return { cap, triggered };
};

const computeV2ModuleScore = (params: {
  moduleId: DecisionSupportNutriScoreCardV2ModuleId;
  categoryId: DecisionSupportCategoryId;
  items: DecisionSupportNutriScoreCardV2ChecklistItem[];
}): {
  score: number;
  status: "high" | "moderate" | "limited" | "low";
  band: DecisionSupportModuleBand;
  completenessScore: number;
  proofCap: number;
  criticalCap: number;
  legacyScore: number;
  unknownRatio: number;
  confidenceContribution: number;
  confidenceWeightSum: number;
  criticalGateTriggered: boolean;
} => {
  const scoredItems = params.items.filter((item) => item.role === "score" && item.weight > 0);
  if (scoredItems.length === 0) {
    return {
      score: 0,
      band: "Low",
      status: "low",
      completenessScore: 0,
      proofCap: 0,
      criticalCap: 0,
      legacyScore: 0,
      unknownRatio: 1,
      confidenceContribution: 0,
      confidenceWeightSum: 0,
      criticalGateTriggered: false,
    };
  }

  const weightSum = scoredItems.reduce((sum, item) => sum + item.weight, 0);
  const completenessNumerator = scoredItems.reduce(
    (sum, item) => sum + (item.state === "verified" ? item.weight : 0),
    0,
  );
  const completenessScore = weightSum > 0 ? scoreClamp((completenessNumerator / weightSum) * 100) : 0;
  const proofCap = getModuleProofCap({ moduleId: params.moduleId, scoreItems: scoredItems });
  const criticalCapResult = getModuleCriticalCap({
    moduleId: params.moduleId,
    categoryId: params.categoryId,
    scoreItems: scoredItems,
  });
  const finalScore = scoreClamp(Math.min(completenessScore, proofCap, criticalCapResult.cap));
  const unknownCount = scoredItems.filter((item) => item.state === "unknown").length;
  const unknownRatio = unknownCount / scoredItems.length;
  const confidenceContribution = scoredItems.reduce((sum, item) => {
    if (item.state !== "verified") return sum;
    const evidenceWeight = CONFIDENCE_EVIDENCE_WEIGHTS[item.evidenceStrength] ?? 0.25;
    return sum + item.weight * evidenceWeight;
  }, 0);
  const band = getModuleBand(finalScore);
  return {
    score: finalScore,
    band,
    status: moduleBandToStatus(band),
    completenessScore,
    proofCap,
    criticalCap: criticalCapResult.cap,
    legacyScore: legacyScoreFromItems(scoredItems),
    unknownRatio,
    confidenceContribution,
    confidenceWeightSum: weightSum,
    criticalGateTriggered: criticalCapResult.triggered,
  };
};

const getModuleWeightsForCategory = (
  categoryId: DecisionSupportCategoryId,
): Record<DecisionSupportNutriScoreCardV2ModuleId, number> =>
  categoryId === "fish_oil_omega3" ? MODULE_WEIGHTS_FISH_OIL : MODULE_WEIGHTS_DEFAULT;

const downgradeOverallBand = (band: DecisionSupportOverallBand): DecisionSupportOverallBand => {
  if (band === "Excellent") return "Strong";
  if (band === "Strong") return "Good";
  if (band === "Good") return "Fair";
  if (band === "Fair") return "Limited";
  if (band === "Limited") return "Weak";
  return "Weak";
};

const applyOverallBandConfidenceGate = (params: {
  rawBand: DecisionSupportOverallBand;
  overallScore: number;
  confidencePct: number;
  moduleScores: Record<DecisionSupportNutriScoreCardV2ModuleId, number>;
  criticalGateFailed: boolean;
}): DecisionSupportOverallBand => {
  const { overallScore, confidencePct, moduleScores, criticalGateFailed } = params;
  let band = params.rawBand;

  const meetsBandRule = (candidate: DecisionSupportOverallBand): boolean => {
    if (candidate === "Excellent") {
      return (
        overallScore >= 90 &&
        confidencePct >= 90 &&
        (moduleScores.testing_verification ?? 0) >= 70 &&
        !criticalGateFailed
      );
    }
    if (candidate === "Strong") return overallScore >= 80 && confidencePct >= 75;
    if (candidate === "Good") return overallScore >= 70 && confidencePct >= 60;
    return true;
  };

  while (!meetsBandRule(band) && band !== "Weak") {
    band = downgradeOverallBand(band);
  }
  return band;
};

const buildNutriScoreCardV2 = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  checklist: DecisionSupportChecklistItem[];
  blockers: DecisionSupportBlocker[];
  usageBlock: DecisionSupportUsageBlock;
  safetyBlock: DecisionSupportSafetyBlock;
  qualityMark: DecisionSupportQualityMark;
  overlayClaims: DecisionSupportOverlayClaims | null;
}): DecisionSupportNutriScoreCardV2 => {
  const {
    digest,
    categoryId,
    checklist,
    blockers,
    usageBlock,
    safetyBlock,
    qualityMark,
    overlayClaims,
  } = params;

  const overlayPresent = Boolean(overlayClaims);
  const overlayRef = overlayClaims?.link ?? null;
  const overlayCorpus = normalizeOverlayCorpus(overlayClaims);
  const overlayCorpusCompact = compactOverlayCorpus(overlayCorpus);
  const overlayChemicalFormFromFacts = extractOverlayChemicalFormFromFacts(overlayClaims);
  const overlayFactsCorpus = (overlayClaims?.nutritionalFacts ?? [])
    .map((row) => `${row.substancy ?? ""} ${row.amountPerServing ?? ""} ${row.dailyValuePercent ?? ""}`.trim())
    .join(" ")
    .toLowerCase();
  const overlayFactsCorpusCompact = compactOverlayCorpus(overlayFactsCorpus);
  const overlayHasDirections = normalizeText(overlayClaims?.suggestedUse).length > 0;
  const overlayHasWarnings = normalizeText(overlayClaims?.warnings).length > 0;
  const overlayHasOtherIngredients = normalizeText(overlayClaims?.otherIngredients).length > 0;
  const overlayHasNutritionalFacts = (overlayClaims?.nutritionalFacts ?? []).length > 0;
  const overlayHasEpaDhaFromFacts = claimRegexMatch({
    corpus: overlayFactsCorpus,
    corpusCompact: overlayFactsCorpusCompact,
    spaced: CLAIM_EPA_DHA_REGEX,
    compact: CLAIM_EPA_DHA_COMPACT_REGEX,
  });
  const overlayHasEpaDha = overlayHasEpaDhaFromFacts || claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_EPA_DHA_REGEX,
    compact: CLAIM_EPA_DHA_COMPACT_REGEX,
  });
  const overlayHasChemicalFormFromFacts = Boolean(overlayChemicalFormFromFacts);
  const overlayHasChemicalForm = overlayHasChemicalFormFromFacts || claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_CHEMICAL_FORM_REGEX,
    compact: CLAIM_CHEMICAL_FORM_COMPACT_REGEX,
  });
  const overlayHasCgmpClaim = claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_CGMP_REGEX,
    compact: CLAIM_CGMP_COMPACT_REGEX,
  });
  const overlayHasTestingClaim = claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_THIRD_PARTY_TESTED_REGEX,
    compact: CLAIM_THIRD_PARTY_TESTED_COMPACT_REGEX,
  });
  const overlayHasQualitySignals = claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_QUALITY_SIGNAL_REGEX,
    compact: CLAIM_QUALITY_SIGNAL_COMPACT_REGEX,
  });
  const overlayHasManufacturingOrigin = claimRegexMatch({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    spaced: CLAIM_MANUFACTURING_ORIGIN_REGEX,
    compact: CLAIM_MANUFACTURING_ORIGIN_COMPACT_REGEX,
  });

  const amountDisclosed = (digest.actives ?? []).some(
    (item) => Number.isFinite(Number(item?.amount)) && normalizeText(item?.unit).length > 0,
  );
  const warningsAvailable = hasWarningsData(digest);
  const explicitForm = hasExplicitForm(digest);
  const directionsVisible = usageBlock.directions.hasDirectionsTextVisible;
  const missingInfoSurfaced = blockers.some((blocker) => blocker.beforeYouBuy);
  const hasServingTransparency = normalizeText(digest.serving?.servingSize).length > 0 ||
    typeof digest.serving?.servingsPerContainer === "number" ||
    overlayHasNutritionalFacts;
  const hasInactiveDisclosure = (digest.inactives ?? []).length > 0 || overlayHasOtherIngredients;
  const hasOfficialActiveList = (digest.actives ?? []).length > 0;
  const hasBreakdownDisclosure = categoryId === "fish_oil_omega3"
    ? hasFishOilBreakdown(digest) || overlayHasEpaDha
    : hasOfficialActiveList;
  const hasDirectionsFromOfficial = directionsVisible && usageBlock.directions.sourceTier === "official_record";
  const hasDirectionsFromLabel = directionsVisible && usageBlock.directions.sourceTier === "scanned_label";

  const useOverlayMissingState = (claimPresent: boolean): DecisionSupportChecklistStatus => {
    if (claimPresent) return "verified";
    return overlayPresent ? "missing" : "unknown";
  };

  const ingredientSafetyChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    warningsAvailable
      ? buildV2ChecklistItem({
          key: "ingredient_safety:warnings_disclosed",
          label: "Label warnings or cautions disclosed",
          state: "verified",
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 4,
          role: "score",
        })
      : overlayHasWarnings
      ? buildV2ChecklistItem({
          key: "ingredient_safety:warnings_disclosed",
          label: "Label warnings or cautions disclosed",
          state: "verified",
          sourceTier: "overlay_iherb",
          evidenceStrength: "overlay_label_transcription",
          proofClass: "overlay_transcription",
          evidenceRef: overlayRef,
          note: "Claim-based (overlay_iherb)",
          weight: 4,
          role: "score",
        })
      : buildV2ChecklistItem({
          key: "ingredient_safety:warnings_disclosed",
          label: "Label warnings or cautions disclosed",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
          evidenceStrength: overlayPresent ? "overlay_label_transcription" : "official",
          proofClass: overlayPresent ? "overlay_transcription" : "official_like",
          evidenceRef: overlayRef,
          weight: 4,
          role: "score",
        }),
    hasInactiveDisclosure
      ? buildV2ChecklistItem({
          key: "ingredient_safety:other_ingredients_disclosed",
          label: "Other ingredients/allergen disclosure available",
          state: "verified",
          sourceTier: (digest.inactives ?? []).length > 0 ? "official_record" : "overlay_iherb",
          evidenceStrength: (digest.inactives ?? []).length > 0 ? "official" : "overlay_label_transcription",
          proofClass: (digest.inactives ?? []).length > 0 ? "official_like" : "overlay_transcription",
          evidenceRef: (digest.inactives ?? []).length > 0 ? null : overlayRef,
          note: (digest.inactives ?? []).length > 0 ? null : "Claim-based (overlay_iherb)",
          weight: 4,
          role: "score",
        })
      : buildV2ChecklistItem({
          key: "ingredient_safety:other_ingredients_disclosed",
          label: "Other ingredients/allergen disclosure available",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "inferred",
          evidenceStrength: overlayPresent ? "overlay_label_transcription" : "inferred",
          proofClass: overlayPresent ? "overlay_transcription" : "science_only",
          evidenceRef: overlayRef,
          weight: 4,
          role: "score",
        }),
    buildV2ChecklistItem({
      key: "ingredient_safety:watchouts_surfaced",
      label: "General interaction/watch-out guidance surfaced",
      state: (safetyBlock.generalWatchouts ?? []).length > 0 ? "verified" : "unknown",
      sourceTier: "general_science",
      evidenceStrength: "general_science",
      proofClass: "science_only",
      role: "info",
      weight: 0,
    }),
  ];

  const formulaTransparencyChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    amountDisclosed
      ? buildV2ChecklistItem({
          key: "formula_transparency:active_amount_disclosed",
          label: "Active amount disclosed per serving",
          state: "verified",
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 2,
          role: "score",
        })
      : overlayHasNutritionalFacts
      ? buildV2ChecklistItem({
          key: "formula_transparency:active_amount_disclosed",
          label: "Active amount disclosed per serving",
          state: "verified",
          sourceTier: "overlay_iherb",
          evidenceStrength: "overlay_label_transcription",
          proofClass: "overlay_transcription",
          evidenceRef: overlayRef,
          note: "Claim-based (overlay_iherb)",
          weight: 2,
          role: "score",
        })
      : buildV2ChecklistItem({
          key: "formula_transparency:active_amount_disclosed",
          label: "Active amount disclosed per serving",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
          evidenceStrength: overlayPresent ? "overlay_label_transcription" : "official",
          proofClass: overlayPresent ? "overlay_transcription" : "official_like",
          evidenceRef: overlayRef,
          weight: 2,
          role: "score",
        }),
    categoryId === "fish_oil_omega3"
      ? hasBreakdownDisclosure
        ? buildV2ChecklistItem({
            key: "formula_transparency:breakdown_disclosed",
            label: "EPA+DHA breakdown disclosed",
            state: "verified",
            sourceTier: hasFishOilBreakdown(digest) ? "official_record" : "overlay_iherb",
            evidenceStrength: hasFishOilBreakdown(digest)
              ? "official"
              : (overlayHasEpaDhaFromFacts ? "overlay_label_transcription" : "overlay_claim"),
            proofClass: hasFishOilBreakdown(digest)
              ? "official_like"
              : (overlayHasEpaDhaFromFacts ? "overlay_transcription" : "claim_only"),
            evidenceRef: hasFishOilBreakdown(digest) ? null : overlayRef,
            note: hasFishOilBreakdown(digest) ? null : "Claim-based (overlay_iherb)",
            weight: 5,
            role: "score",
            critical: true,
          })
        : buildV2ChecklistItem({
            key: "formula_transparency:breakdown_disclosed",
            label: "EPA+DHA breakdown disclosed",
            state: useOverlayMissingState(overlayHasEpaDha),
            sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
            evidenceStrength: overlayPresent ? (overlayHasEpaDhaFromFacts ? "overlay_label_transcription" : "overlay_claim") : "official",
            proofClass: overlayPresent ? (overlayHasEpaDhaFromFacts ? "overlay_transcription" : "claim_only") : "official_like",
            evidenceRef: overlayRef,
            weight: 5,
            role: "score",
            critical: true,
          })
      : buildV2ChecklistItem({
          key: "formula_transparency:breakdown_disclosed",
          label: "Active ingredient list disclosed",
          state: hasOfficialActiveList ? "verified" : (overlayPresent ? "missing" : "unknown"),
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 5,
          role: "score",
          critical: true,
        }),
    explicitForm
      ? buildV2ChecklistItem({
          key: "formula_transparency:chemical_form_disclosed",
          label: "Chemical form disclosed",
          state: "verified",
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 3,
          role: "score",
          critical: true,
        })
      : overlayHasChemicalForm
      ? buildV2ChecklistItem({
          key: "formula_transparency:chemical_form_disclosed",
          label: "Chemical form disclosed",
          state: "verified",
          sourceTier: "overlay_iherb",
          evidenceStrength: overlayHasChemicalFormFromFacts ? "overlay_label_transcription" : "overlay_claim",
          proofClass: overlayHasChemicalFormFromFacts ? "overlay_transcription" : "claim_only",
          evidenceRef: overlayRef,
          note: overlayHasChemicalFormFromFacts ? "From supplemental label data (iHerb)." : "Claim-based (overlay_iherb)",
          weight: 3,
          role: "score",
          critical: true,
        })
      : buildV2ChecklistItem({
          key: "formula_transparency:chemical_form_disclosed",
          label: "Chemical form disclosed",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
          evidenceStrength: overlayPresent ? "overlay_claim" : "official",
          proofClass: overlayPresent ? "claim_only" : "official_like",
          evidenceRef: overlayRef,
          weight: 3,
          role: "score",
          critical: true,
        }),
  ];

  const labelClarityChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    hasDirectionsFromOfficial
      ? buildV2ChecklistItem({
          key: "label_clarity:directions_present",
          label: "Directions present in record",
          state: "verified",
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 5,
          role: "score",
        })
      : hasDirectionsFromLabel
      ? buildV2ChecklistItem({
          key: "label_clarity:directions_present",
          label: "Directions present in record",
          state: "verified",
          sourceTier: "scanned_label",
          evidenceStrength: "scanned_label",
          proofClass: "official_like",
          weight: 5,
          role: "score",
        })
      : overlayHasDirections
      ? buildV2ChecklistItem({
          key: "label_clarity:directions_present",
          label: "Directions present in record",
          state: "verified",
          sourceTier: "overlay_iherb",
          evidenceStrength: "overlay_label_transcription",
          proofClass: "overlay_transcription",
          evidenceRef: overlayRef,
          note: "Claim-based (overlay_iherb)",
          weight: 5,
          role: "score",
        })
      : buildV2ChecklistItem({
          key: "label_clarity:directions_present",
          label: "Directions present in record",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
          evidenceStrength: overlayPresent ? "overlay_label_transcription" : "official",
          proofClass: overlayPresent ? "overlay_transcription" : "official_like",
          evidenceRef: overlayRef,
          weight: 5,
          role: "score",
        }),
    warningsAvailable
      ? buildV2ChecklistItem({
          key: "label_clarity:warnings_present",
          label: "Label warnings present in record",
          state: "verified",
          sourceTier: "official_record",
          evidenceStrength: "official",
          proofClass: "official_like",
          weight: 5,
          role: "score",
        })
      : overlayHasWarnings
      ? buildV2ChecklistItem({
          key: "label_clarity:warnings_present",
          label: "Label warnings present in record",
          state: "verified",
          sourceTier: "overlay_iherb",
          evidenceStrength: "overlay_label_transcription",
          proofClass: "overlay_transcription",
          evidenceRef: overlayRef,
          note: "Claim-based (overlay_iherb)",
          weight: 5,
          role: "score",
        })
      : buildV2ChecklistItem({
          key: "label_clarity:warnings_present",
          label: "Label warnings present in record",
          state: overlayPresent ? "missing" : "unknown",
          sourceTier: overlayPresent ? "overlay_iherb" : "official_record",
          evidenceStrength: overlayPresent ? "overlay_label_transcription" : "official",
          proofClass: overlayPresent ? "overlay_transcription" : "official_like",
          evidenceRef: overlayRef,
          weight: 5,
          role: "score",
        }),
    buildV2ChecklistItem({
      key: "label_clarity:missing_items_surfaced",
      label: "Missing items surfaced in Missing info",
      state: missingInfoSurfaced || (warningsAvailable && directionsVisible) ? "verified" : "unknown",
      sourceTier: "official_record",
      evidenceStrength: "official",
      proofClass: "science_only",
      role: "info",
      weight: 0,
    }),
  ];

  const manufacturingChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    buildV2ChecklistItem({
      key: "manufacturing_standards:cgmp_claim",
      label: "cGMP / manufacturing compliance claim present",
      state: useOverlayMissingState(overlayHasCgmpClaim),
      sourceTier: overlayPresent ? "overlay_iherb" : "inferred",
      evidenceStrength: overlayPresent ? "overlay_claim" : "inferred",
      proofClass: overlayPresent ? "claim_only" : "science_only",
      evidenceRef: overlayRef,
      note: overlayHasCgmpClaim ? "Claim-based (overlay_iherb)" : null,
      weight: 4,
      role: "score",
    }),
    buildV2ChecklistItem({
      key: "manufacturing_standards:origin_claim",
      label: "Manufacturing location/facility detail present",
      state: useOverlayMissingState(overlayHasManufacturingOrigin),
      sourceTier: overlayPresent ? "overlay_iherb" : "inferred",
      evidenceStrength: overlayPresent ? "overlay_claim" : "inferred",
      proofClass: overlayPresent ? "claim_only" : "science_only",
      evidenceRef: overlayRef,
      note: overlayHasManufacturingOrigin ? "Claim-based (overlay_iherb)" : null,
      weight: 2,
      role: "score",
    }),
  ];

  const thirdPartyTestingSources = extractThirdPartyTestingSources({
    corpus: overlayCorpus,
    corpusCompact: overlayCorpusCompact,
    qualityMark,
  });
  const mergedThirdPartyVerificationSummary = mergeQualityMarkSummaries(
    qualityMark.verificationSummary ?? null,
    buildOverlayThirdPartyVerificationSummary({
      corpus: overlayCorpus,
      corpusCompact: overlayCorpusCompact,
    }),
  );
  const hasIndependentTestingProof = Boolean(mergedThirdPartyVerificationSummary?.officialRegistryVerified);
  const hasProductPageTestingClaim = Boolean(mergedThirdPartyVerificationSummary?.productPageClaimDetected);
  const hasThirdPartyClaimEvidence =
    overlayHasTestingClaim || thirdPartyTestingSources.length > 0 || hasProductPageTestingClaim;
  const thirdPartyClaimState: DecisionSupportChecklistStatus = hasIndependentTestingProof
    ? "verified"
    : hasThirdPartyClaimEvidence
      ? useOverlayMissingState(true)
      : mergedThirdPartyVerificationSummary?.overallStatus === "ambiguous"
        ? "unknown"
        : useOverlayMissingState(false);
  const testingChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    buildV2ChecklistItem({
      key: "testing_verification:third_party_tested_claim",
      label: "Third-party tested claim present",
      state: thirdPartyClaimState,
      sourceTier: hasIndependentTestingProof
        ? "official_record"
        : hasProductPageTestingClaim
        ? "official_record"
        : overlayPresent
        ? "overlay_iherb"
        : "inferred",
      evidenceStrength: hasIndependentTestingProof
        ? "cert_page_verified"
        : hasProductPageTestingClaim
        ? "overlay_claim"
        : overlayPresent
        ? "overlay_claim"
        : "inferred",
      proofClass: hasIndependentTestingProof
        ? "independent_verifier"
        : hasProductPageTestingClaim
        ? "claim_only"
        : overlayPresent
        ? "claim_only"
        : "science_only",
      evidenceRef:
        hasIndependentTestingProof || hasProductPageTestingClaim ? (qualityMark.evidenceRef ?? overlayRef) : overlayRef,
      note: null,
      weight: 10,
      role: "score",
      critical: true,
    }),
  ];

  const productQualityChecklist: DecisionSupportNutriScoreCardV2ChecklistItem[] = [
    buildV2ChecklistItem({
      key: "product_quality:lifestyle_claims",
      label: "Lifestyle/quality claims disclosed (e.g., non-GMO, gluten-free, vegan)",
      state: useOverlayMissingState(overlayHasQualitySignals),
      sourceTier: overlayPresent ? "overlay_iherb" : "inferred",
      evidenceStrength: overlayPresent ? "overlay_claim" : "inferred",
      proofClass: overlayPresent ? "claim_only" : "science_only",
      evidenceRef: overlayRef,
      note: overlayHasQualitySignals ? "Claim-based (overlay_iherb)" : null,
      weight: 2,
      role: "score",
    }),
    buildV2ChecklistItem({
      key: "product_quality:serving_transparency",
      label: "Serving transparency disclosed (serving size / servings per container)",
      state: hasServingTransparency ? "verified" : overlayPresent ? "missing" : "unknown",
      sourceTier: hasServingTransparency
        ? normalizeText(digest.serving?.servingSize).length > 0 || typeof digest.serving?.servingsPerContainer === "number"
          ? "official_record"
          : "overlay_iherb"
        : overlayPresent
        ? "overlay_iherb"
        : "inferred",
      evidenceStrength: hasServingTransparency
        ? normalizeText(digest.serving?.servingSize).length > 0 || typeof digest.serving?.servingsPerContainer === "number"
          ? "official"
          : "overlay_label_transcription"
        : overlayPresent
        ? "overlay_label_transcription"
        : "inferred",
      proofClass: hasServingTransparency
        ? normalizeText(digest.serving?.servingSize).length > 0 || typeof digest.serving?.servingsPerContainer === "number"
          ? "official_like"
          : "overlay_transcription"
        : overlayPresent
        ? "overlay_transcription"
        : "science_only",
      evidenceRef: hasServingTransparency && overlayPresent ? overlayRef : null,
      note: hasServingTransparency && overlayPresent &&
        !(normalizeText(digest.serving?.servingSize).length > 0 || typeof digest.serving?.servingsPerContainer === "number")
        ? "Claim-based (overlay_iherb)"
        : null,
      weight: 3,
      role: "score",
    }),
  ];

  const moduleBlueprint: Array<{
    id: DecisionSupportNutriScoreCardV2ModuleId;
    title: string;
    checklist: DecisionSupportNutriScoreCardV2ChecklistItem[];
  }> = [
    { id: "ingredient_safety", title: "Ingredient Safety", checklist: ingredientSafetyChecklist },
    { id: "formula_transparency", title: "Formula Transparency", checklist: formulaTransparencyChecklist },
    { id: "label_clarity", title: "Label Clarity (Directions & Warnings)", checklist: labelClarityChecklist },
    { id: "manufacturing_standards", title: "Manufacturing Standards", checklist: manufacturingChecklist },
    { id: "testing_verification", title: "Testing & Verification", checklist: testingChecklist },
    { id: "product_quality", title: "Product Quality Signals", checklist: productQualityChecklist },
  ];

  const modules: DecisionSupportNutriScoreCardV2Module[] = moduleBlueprint.map((module) => {
    const computed = computeV2ModuleScore({
      moduleId: module.id,
      categoryId,
      items: module.checklist,
    });
    return {
      id: module.id,
      title: module.title,
      score: computed.score,
      band: computed.band,
      status: computed.status,
      checklist: module.checklist,
      debug: {
        completenessScore: computed.completenessScore,
        proofCap: computed.proofCap,
        criticalCap: computed.criticalCap,
        finalScore: computed.score,
        legacyScore: computed.legacyScore,
        unknownRatio: computed.unknownRatio,
        confidenceContribution: computed.confidenceContribution,
        confidenceWeightSum: computed.confidenceWeightSum,
        criticalGateTriggered: computed.criticalGateTriggered,
      },
    };
  });

  const moduleWeights = getModuleWeightsForCategory(categoryId);
  const totalModuleWeight = modules.reduce((sum, module) => sum + (moduleWeights[module.id] ?? 0), 0);
  const overallScore = totalModuleWeight > 0
    ? scoreClamp(
      modules.reduce((sum, module) => sum + module.score * (moduleWeights[module.id] ?? 0), 0) / totalModuleWeight,
    )
    : 0;
  const legacyOverallScore = totalModuleWeight > 0
    ? scoreClamp(
      modules.reduce((sum, module) => sum + (module.debug?.legacyScore ?? 0) * (moduleWeights[module.id] ?? 0), 0) /
        totalModuleWeight,
    )
    : 0;

  const confidenceWeightSum = modules.reduce((sum, module) => sum + (module.debug?.confidenceWeightSum ?? 0), 0);
  const confidenceContribution = modules.reduce((sum, module) => sum + (module.debug?.confidenceContribution ?? 0), 0);
  const confidencePct = confidenceWeightSum > 0
    ? scoreClamp((confidenceContribution / confidenceWeightSum) * 100)
    : 0;

  const criticalGateFailed = modules.some((module) => module.debug?.criticalGateTriggered);
  const rawOverallBand = getOverallBand(overallScore);
  const overallBand = applyOverallBandConfidenceGate({
    rawBand: rawOverallBand,
    overallScore,
    confidencePct,
    moduleScores: {
      ingredient_safety: modules.find((item) => item.id === "ingredient_safety")?.score ?? 0,
      formula_transparency: modules.find((item) => item.id === "formula_transparency")?.score ?? 0,
      label_clarity: modules.find((item) => item.id === "label_clarity")?.score ?? 0,
      manufacturing_standards: modules.find((item) => item.id === "manufacturing_standards")?.score ?? 0,
      testing_verification: modules.find((item) => item.id === "testing_verification")?.score ?? 0,
      product_quality: modules.find((item) => item.id === "product_quality")?.score ?? 0,
    },
    criticalGateFailed,
  });

  return {
    overallScore,
    overallBand,
    confidencePct,
    modules,
    debug: {
      legacyOverallScore,
      rawOverallBand,
      criticalGateFailed,
      moduleWeightsUsed: moduleWeights,
    },
  };
};

const buildOverviewBlock = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  blockers: DecisionSupportBlocker[];
  missingActiveBreakdown: boolean;
  overlayClaims: DecisionSupportOverlayClaims | null;
  usageBlock: DecisionSupportUsageBlock;
}): DecisionSupportOverviewBlock => {
  const { digest, categoryId, safeScienceSignals, blockers, missingActiveBreakdown, overlayClaims, usageBlock } = params;
  const overlayOmega3Facts = parseOverlayOmega3Facts(overlayClaims);
  const overlayWarnings = splitOverlayTextLines(overlayClaims?.warnings, 4);
  const overlayHasWarnings = overlayWarnings.length > 0;
  const overlayHasChemicalForm = hasOverlayChemicalFormCue(categoryId, overlayClaims);
  const hasDirectionsVisible = usageBlock.directions.hasDirectionsTextVisible;

  const sourceStrip = dedupeLines([
    digest.sourceType === "lnhpd" || digest.sourceType === "dsld" ? "Official record (DSLD/LNHPD)." : null,
    usageBlock.directions.sourceTier === "scanned_label" ? "Scanned label (patch/label)." : null,
    overlayClaims ? "Supplemental product-page label data (iHerb)." : null,
    "General science (NIH ODS).",
    "AI summary (grounded).",
  ], 5);
  const bestForBullets = buildCategoryBestForBullets({
    categoryId,
    safeScienceSignals,
    missingActiveBreakdown: missingActiveBreakdown && !overlayOmega3Facts.hasEpaDhaBreakdown,
  });

  const digestKeyIngredients = (digest.actives ?? [])
    .slice(0, 4)
    .map((item) => ({
      name: normalizeDisplayText(item?.name) || "Ingredient",
      dose:
        item?.amount != null
          ? normalizeDisplayText(`${item.amount} ${item?.unit ?? ""}`) || null
          : null,
    }))
    .filter((item) => item.name.length > 0);

  const overlayKeyIngredients = categoryId === "fish_oil_omega3"
    ? overlayOmega3Facts.entries.map((row) => ({ name: row.name, dose: row.dose }))
    : [];

  const keyIngredientCandidates = [...overlayKeyIngredients, ...digestKeyIngredients];
  const seenIngredientKeys = new Set<string>();
  const keyIngredients = keyIngredientCandidates
    .filter((item) => {
      const key = normalizeText(item.name);
      if (!key || seenIngredientKeys.has(key)) return false;
      seenIngredientKeys.add(key);
      return true;
    })
    .slice(0, 4);

  const unresolvedBeforeYouBuy = blockers
    .filter((item) => item.beforeYouBuy)
    .filter((item) => {
      if (item.code === "missing_directions_dsld") return !hasDirectionsVisible;
      if (item.code === "warnings_missing_fixable" || item.code === "warnings_missing_ceiling") {
        return !hasWarningsData(digest) && !overlayHasWarnings;
      }
      if (item.code === "missing_active_breakdown") {
        return missingActiveBreakdown && !overlayOmega3Facts.hasEpaDhaBreakdown;
      }
      if (item.code === "missing_form_high_impact") {
        return !hasExplicitForm(digest) && !overlayHasChemicalForm;
      }
      return true;
    });

  const missingInfo = dedupeLines(unresolvedBeforeYouBuy.map((item) => item.why), 2);
  const primaryMissingCode = unresolvedBeforeYouBuy[0]?.code ?? null;
  const singleCta = missingInfo.length > 0
    ? {
      label:
        primaryMissingCode === "missing_active_breakdown"
          ? "Check label for EPA+DHA per serving"
          : primaryMissingCode === "missing_form_high_impact"
          ? "Confirm D2/D3 or chemical form on label"
          : "Scan Directions + Warnings panel",
      id:
        primaryMissingCode === "missing_active_breakdown"
          ? "check_epa_dha_breakdown"
          : primaryMissingCode === "missing_form_high_impact"
          ? "confirm_chemical_form"
          : "scan_directions_warnings",
    }
    : null;

  return {
    sourceStrip,
    bestForBullets,
    providesVerified: {
      servingSize: normalizeDisplayText(digest?.serving?.servingSize) || null,
      servingsPerContainer:
        typeof digest?.serving?.servingsPerContainer === "number"
          ? digest.serving.servingsPerContainer
          : null,
      keyIngredients,
      dosageForm: normalizeDisplayText(digest?.product?.dosageForm) || null,
      count:
        typeof digest?.serving?.servingsPerContainer === "number"
          ? `${digest.serving.servingsPerContainer} servings`
          : null,
    },
    missingInfo,
    singleCta,
  };
};

const sentenceNeedsSupportVerb = (sentence: string): boolean => !/\bsupport\b/i.test(sentence);

const buildGeneralUseSentence = (params: {
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  overviewBestForBullets: string[];
}): string => {
  const { categoryId, safeScienceSignals, overviewBestForBullets } = params;
  if (categoryId === "probiotics") {
    return "Often used for gut or digestive-flora support goals, especially when shoppers compare strain naming, CFU strength, and storage guidance.";
  }
  if (categoryId === "magnesium") {
    return "Often used for magnesium-support goals, especially when shoppers compare glycinate, citrate, oxide, or other forms for strength, tolerance, and timing fit.";
  }
  if (categoryId === "sleep_stress_mood_support") {
    return "Often used for sleep-, stress-, or mood-support goals, especially when shoppers compare calming actives, bedtime timing, and next-day fit.";
  }
  if (categoryId === "botanical_herbal_support") {
    return "Often used for herbal-support goals, especially when shoppers compare the named herb, extract form, plant source, and disclosure quality.";
  }
  if (categoryId === "metabolic_glucose_support") {
    return "Often used for glucose- or glycemic-support goals, especially when shoppers compare berberine strength and meal-timing clarity.";
  }
  if (categoryId === "cholesterol_lipid_support") {
    return "Often used for cholesterol- or lipid-support goals, especially when shoppers compare red-yeast-rice strength and with-food context.";
  }
  if (categoryId === "liver_bile_support") {
    return "Often used for liver-bile or fat-digestion support goals, especially when shoppers compare TUDCA or ox-bile strength and with-food context.";
  }
  if (categoryId === "fish_oil_omega3") {
    return "Often used for omega-3 intake goals, especially when shoppers compare EPA+DHA disclosure, source oil, and per-serving strength.";
  }
  const overviewKeys = overviewBestForBullets.map((line) => cleanupSentenceFragment(line).toLowerCase());
  const candidates = (safeScienceSignals?.bestForBullets ?? [])
    .map((line) => cleanupSentenceFragment(line))
    .filter(Boolean);
  const candidate =
    candidates.find((line) => !overviewKeys.some((key) => key && line.toLowerCase().includes(key))) ??
    candidates[1] ??
    candidates[0] ??
    "goal-oriented supplement support";
  const normalized = cleanupSentenceFragment(candidate);
  if (!normalized) return "Often used to support goal-oriented supplement support (general science).";
  return sentenceNeedsSupportVerb(normalized)
    ? `Often used to support ${normalized} (general science).`
    : `Often used for ${normalized} (general science).`;
};

const buildComparabilityDisclosure = (params: {
  categoryId: DecisionSupportCategoryId;
  hasActiveBreakdown: boolean;
  hasChemicalForm: boolean;
  digest: FactsDigest;
}): string => {
  const { categoryId, hasActiveBreakdown, hasChemicalForm, digest } = params;
  if (categoryId === "fish_oil_omega3") {
    return hasActiveBreakdown
      ? "EPA+DHA disclosure is available"
      : "EPA+DHA disclosure is missing";
  }
  if (categoryId === "vitamin_d") {
    return hasChemicalForm ? "D3 or D2 form disclosure is available" : "D3 or D2 form is not stated";
  }
  if (categoryId === "magnesium") {
    return hasChemicalForm ? "magnesium chemical form is disclosed" : "magnesium chemical form is not stated";
  }
  if (categoryId === "probiotics") {
    const names = normalizeActiveNames(digest);
    const hasStrain = names.some((name) => /(lactobacillus|bifidobacterium|saccharomyces|strain)/.test(name));
    const hasCfu = names.some((name) => /\bcfu\b/.test(name));
    if (hasStrain && hasCfu) return "strain and CFU disclosure are both available";
    if (hasStrain || hasCfu) return "strain or CFU disclosure is only partial";
    return "strain and CFU disclosure are missing";
  }
  if (categoryId === "sleep_stress_mood_support") {
    const names = normalizeActiveNames(digest);
    const hasBedtimeActives = names.some((name) => /\bmelatonin\b|\b5-htp\b|\bgaba\b|\btheanine\b|\bvalerian\b|\bashwagandha\b/.test(name));
    if (hasBedtimeActives) return "sleep-support actives are disclosed, and bedtime timing is the next comparison priority";
    return "sleep-support actives are not clearly disclosed";
  }
  if (categoryId === "botanical_herbal_support") {
    const names = normalizeActiveNames(digest);
    const hasExtractCue = names.some((name) => /\bextract\b|\broot\b|\bleaf\b|\bseed\b|\bbark\b|\bfruit\b|\bberry\b/.test(name));
    if (hasExtractCue) return "named herb and extract or source cues are disclosed, and plant-part transparency is the next comparison priority";
    return "herbal actives are disclosed, but extract or source transparency stays partial";
  }
  if (categoryId === "metabolic_glucose_support") {
    const names = normalizeActiveNames(digest);
    const hasBerberine = names.some((name) => /\bberberine\b/.test(name));
    if (hasBerberine && hasChemicalForm) return "berberine disclosure and product-detail context are both available";
    if (hasBerberine) return "berberine is disclosed, but supporting detail stays partial";
    return "glucose-support actives are not clearly disclosed";
  }
  if (categoryId === "cholesterol_lipid_support") {
    const names = normalizeActiveNames(digest);
    const hasRedYeastRice = names.some((name) => /\bred yeast rice\b/.test(name));
    const hasCoq10 = names.some((name) => /\bcoq-?10\b|\bcoenzyme q10\b/.test(name));
    if (hasRedYeastRice && hasCoq10) return "red-yeast-rice disclosure and supporting lipid-context actives are both available";
    if (hasRedYeastRice) return "red-yeast-rice disclosure is available, but supporting lipid context stays partial";
    return "lipid-support actives are not clearly disclosed";
  }
  if (categoryId === "liver_bile_support") {
    const names = normalizeActiveNames(digest);
    const hasTudca = names.some((name) => /\btudca\b|\btauroursodeoxycholic\b/.test(name));
    const hasOxBile = names.some((name) => /\box bile\b|\bbile\b/.test(name));
    if (hasTudca || hasOxBile) return "liver-bile actives are disclosed, and mealtime context is the next comparison priority";
    return "liver-bile actives are not clearly disclosed";
  }
  return hasChemicalForm ? "core disclosure is available" : "core disclosure is partly missing";
};

const getMissingCodePriority = (categoryId: DecisionSupportCategoryId): DecisionSupportBlocker["code"][] => {
  if (categoryId === "fish_oil_omega3") {
    return [
      "missing_active_breakdown",
      "missing_directions_dsld",
      "warnings_missing_fixable",
      "warnings_missing_ceiling",
      "missing_form_high_impact",
    ];
  }
  if (categoryId === "vitamin_d") {
    return [
      "missing_form_high_impact",
      "missing_directions_dsld",
      "warnings_missing_fixable",
      "warnings_missing_ceiling",
      "missing_active_breakdown",
    ];
  }
  return [
    "missing_directions_dsld",
    "warnings_missing_fixable",
    "warnings_missing_ceiling",
    "missing_form_high_impact",
    "missing_active_breakdown",
  ];
};

const buildLimitationText = (code: DecisionSupportBlocker["code"]): string => {
  if (code === "missing_active_breakdown") return "EPA/DHA breakdown is missing from the official record";
  if (code === "missing_directions_dsld") return "exact directions are not included in the official record";
  if (code === "warnings_missing_fixable") return "product-specific label warnings are missing";
  if (code === "warnings_missing_ceiling") return "product-specific label warnings are not included in the official record";
  if (code === "missing_form_high_impact") return "chemical form disclosure is not stated";
  return "critical label transparency details are missing";
};

const buildActionStep = (params: {
  code: DecisionSupportBlocker["code"] | null;
  categoryId: DecisionSupportCategoryId;
  fallbackAction: string;
}): string => {
  const { code, categoryId, fallbackAction } = params;
  if (categoryId === "fish_oil_omega3" && code === "missing_active_breakdown") {
    return "Check the label for EPA+DHA per serving.";
  }
  if (categoryId === "probiotics" && code === "missing_form_high_impact") {
    return "Confirm probiotic strains, CFU strength, and any storage guidance on the label.";
  }
  if (categoryId === "magnesium" && code === "missing_form_high_impact") {
    return "Confirm the magnesium form and compare whether the label gives useful tolerance or timing guidance.";
  }
  if (categoryId === "sleep_stress_mood_support" && code === "missing_form_high_impact") {
    return "Confirm the main calming or sleep-support active and whether the label gives useful bedtime timing guidance.";
  }
  if (categoryId === "botanical_herbal_support" && code === "missing_form_high_impact") {
    return "Confirm the main herb, extract or plant-part disclosure, and whether the label gives enough source context to compare.";
  }
  if (categoryId === "metabolic_glucose_support" && code === "missing_form_high_impact") {
    return "Confirm the berberine or glucose-support active and whether the label gives useful meal-timing guidance.";
  }
  if (categoryId === "cholesterol_lipid_support" && code === "missing_form_high_impact") {
    return "Confirm the red-yeast-rice or lipid-support active and whether the label gives useful with-food context.";
  }
  if (categoryId === "liver_bile_support" && code === "missing_form_high_impact") {
    return "Confirm the TUDCA or ox-bile active and whether the label gives useful with-food or with-fat context.";
  }
  if (categoryId === "vitamin_d" || code === "missing_form_high_impact") {
    return "Confirm D2 or D3 / chemical form on the label.";
  }
  if (
    code === "missing_directions_dsld" ||
    code === "warnings_missing_fixable" ||
    code === "warnings_missing_ceiling"
  ) {
    return "Scan the Directions + Warnings panel on the bottle.";
  }
  return sanitizeDecisionLine(fallbackAction) ?? "Scan the Directions + Warnings panel on the bottle.";
};

const buildAiSummaryContract = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  overviewBlock: DecisionSupportOverviewBlock;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  usageBlock: DecisionSupportUsageBlock;
  blockers: DecisionSupportBlocker[];
  hasActiveBreakdown: boolean;
  hasChemicalForm: boolean;
  overlayClaims: DecisionSupportOverlayClaims | null;
  scienceIngredientRows: DecisionSupportScienceIngredientRow[];
}): [string, string, string] => {
  const {
    digest,
    categoryId,
    overviewBlock,
    safeScienceSignals,
    usageBlock,
    blockers,
    hasActiveBreakdown,
    hasChemicalForm,
    overlayClaims,
    scienceIngredientRows,
  } = params;
  const overlayOmega3Facts = parseOverlayOmega3Facts(overlayClaims);
  const overlayHasWarnings = splitOverlayTextLines(overlayClaims?.warnings, 4).length > 0;
  const overlayHasChemicalForm = hasOverlayChemicalFormCue(categoryId, overlayClaims);
  const sentence1 = sanitizeDecisionLine(
    buildGeneralUseSentence({
      categoryId,
      safeScienceSignals,
      overviewBestForBullets: overviewBlock.bestForBullets,
    }),
  ) ?? "Often used to support goal-oriented supplement support (general science).";

  const keyIngredient = scienceIngredientRows[0] ?? null;
  const provideFragment = keyIngredient
    ? `${keyIngredient.name}${keyIngredient.dose ? ` ${keyIngredient.dose} per serving` : ""}`
    : `${overviewBlock.providesVerified.servingSize ?? "label-disclosed serving information"}`;
  const disclosureStatus = buildComparabilityDisclosure({
    categoryId,
    hasActiveBreakdown,
    hasChemicalForm,
    digest,
  });
  const sentence2 = sanitizeDecisionLine(
    `This product provides ${provideFragment}, but ${disclosureStatus} affects how easy it is to compare`,
  ) ?? "This product provides label-disclosed details, but core disclosure gaps affect how easy it is to compare.";

  const priority = getMissingCodePriority(categoryId);
  const blockerMap = new Map(blockers.map((item) => [item.code, item]));
  const eligibleCodes = priority
    .filter((code) => blockerMap.has(code))
    .filter((code) => {
      if (code === "missing_directions_dsld") return !usageBlock.directions.hasDirectionsTextVisible;
      if (code === "missing_active_breakdown") return !(hasActiveBreakdown || overlayOmega3Facts.hasEpaDhaBreakdown);
      if (code === "missing_form_high_impact") return !(hasChemicalForm || overlayHasChemicalForm);
      if (code === "warnings_missing_fixable" || code === "warnings_missing_ceiling") {
        return !(hasWarningsData(digest) || overlayHasWarnings);
      }
      return true;
    });
  const chosenCode = eligibleCodes[0] ?? null;
  const hasUnresolvedMissingInfo = (overviewBlock.missingInfo ?? []).length > 0;
  const limitation = chosenCode
    ? buildLimitationText(chosenCode)
    : hasUnresolvedMissingInfo
    ? "some disclosure details still need label confirmation"
    : "no high-impact unresolved disclosure gap was detected from current verified product data";
  const action = chosenCode
    ? buildActionStep({
      code: chosenCode,
      categoryId,
      fallbackAction: overviewBlock.singleCta?.label ?? "Scan the Directions + Warnings panel on the bottle.",
    }).replace(/[.]+$/, "")
    : categoryId === "fish_oil_omega3"
    ? "Compare EPA+DHA per serving with similar products"
    : categoryId === "probiotics"
    ? "Compare strain naming, CFU strength, and storage guidance with similar probiotic products"
    : categoryId === "magnesium"
    ? "Compare magnesium form, per-serving strength, and whether the label gives useful tolerance or timing guidance"
    : categoryId === "sleep_stress_mood_support"
    ? "Compare calming-active strength, bedtime timing guidance, and whether the label explains next-day fit"
    : categoryId === "botanical_herbal_support"
    ? "Compare the named herb, extract or plant-part disclosure, and whether the label gives enough source context to compare cleanly"
    : categoryId === "metabolic_glucose_support"
    ? "Compare berberine strength per serving and whether the label gives useful meal-timing guidance"
    : categoryId === "cholesterol_lipid_support"
    ? "Compare red-yeast-rice strength per serving and whether the label gives useful with-food context"
    : categoryId === "liver_bile_support"
    ? "Compare TUDCA or ox-bile strength per serving and whether the label gives useful with-food or with-fat guidance"
    : "Compare key per-serving actives and directions before buying";
  const sentence3 = sanitizeDecisionLine(`Main limitation: ${limitation}. Next step: ${action}`) ??
    "Main limitation: some disclosure details still need label confirmation. Next step: Scan the Directions + Warnings panel on the bottle.";

  return [sentence1, sentence2, sentence3];
};

const buildScienceBlock = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  overviewBlock: DecisionSupportOverviewBlock;
  usageBlock: DecisionSupportUsageBlock;
  blockers: DecisionSupportBlocker[];
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
  overlayClaims: DecisionSupportOverlayClaims | null;
  selectedIngredients: {
    ingredientSourceTier: "overlay_iherb" | "official_record";
    ingredientRows: DecisionSupportScienceIngredientRow[];
  };
}): DecisionSupportScienceBlock => {
  const {
    digest,
    categoryId,
    safeScienceSignals,
    overviewBlock,
    usageBlock,
    blockers,
    missingActiveBreakdown,
    missingFormHighImpact,
    overlayClaims,
    selectedIngredients,
  } = params;
  const overlayOmega3Facts = parseOverlayOmega3Facts(overlayClaims);
  const overlayChemicalFormFromFacts = extractOverlayChemicalFormFromFacts(overlayClaims);
  const ingredientRows = selectedIngredients.ingredientRows.map((row) => ({
    name: normalizeDisplayText(row.name) || "Ingredient",
    dose: row.dose ? normalizeDisplayText(row.dose) : null,
  }));
  const ingredientSnapshotNames = dedupeDisplayValues(ingredientRows.map((row) => row.name), 8);

  const digestChemicalForm =
    normalizeDisplayText((digest.actives ?? []).find((item) => normalizeText(item?.chemicalForm))?.chemicalForm) || null;
  const overlayChemicalForm = categoryId === "fish_oil_omega3"
    ? extractOmega3FormCueFromOverlay(overlayClaims)
    : (overlayChemicalFormFromFacts?.form ?? null);
  const normalizedDigestForm = normalizeText(digestChemicalForm);
  const digestFormLooksLikeOmegaAcid =
    categoryId === "fish_oil_omega3" && (/\bepa\b|\bdha\b|eicosapentaenoic|docosahexaenoic/.test(normalizedDigestForm));
  const ingredientChemicalForm = digestFormLooksLikeOmegaAcid
    ? (overlayChemicalForm ?? null)
    : (digestChemicalForm || overlayChemicalForm || null);
  const dosageForm = resolveScienceDosageForm({
    digest,
    overlayClaims,
    ingredientSourceTier: selectedIngredients.ingredientSourceTier,
  });
  const odsGeneralScienceBullets = dedupeLines(
    [safeScienceSignals?.formImpactLine ?? null, ...(safeScienceSignals?.evidenceLines ?? [])],
    3,
  );
  const fallbackOdsBullets =
    categoryId === "fish_oil_omega3"
      ? [
        "For omega-3 products, EPA+DHA per serving is usually the most useful number for comparing strength.",
        "If EPA+DHA is not disclosed, consider strength harder to judge and compare products by label transparency first.",
      ]
      : categoryId === "probiotics"
      ? [
        "For probiotics, strain naming and CFU disclosure are usually the most useful first comparison points.",
        "Storage or shelf-stability guidance matters more here than in many generic supplement lanes, because labels often differ in how they protect viable cultures.",
      ]
      : categoryId === "magnesium"
      ? [
        "For magnesium products, chemical form is usually the most useful first comparison point because glycinate, citrate, oxide, and other forms can behave differently in routine use.",
        "Timing, food context, and GI-tolerance language matter more here than in many generic mineral lanes because users often choose magnesium forms based on fit as much as dose.",
      ]
      : categoryId === "sleep_stress_mood_support"
      ? [
        "For sleep- or mood-support products, the most useful first comparison points are the main calming actives per serving and whether the label gives bedtime timing guidance.",
        "Timing language matters more here than in many generic supplement lanes because labels often position these products around sleep windows, relaxation routines, or next-day grogginess concerns.",
      ]
      : categoryId === "botanical_herbal_support"
      ? [
        "For herbal products, the most useful first comparison points are the named herb, whether the label discloses an extract or plant part, and the per-serving strength.",
        "Extract and source transparency matter more here than in many generic supplement lanes because broad botanical language alone makes herb products much harder to compare cleanly.",
      ]
      : categoryId === "metabolic_glucose_support"
      ? [
        "For glucose-support products, berberine or similarly named actives per serving are usually the most useful first comparison point.",
        "Meal-timing language matters more here than in many generic supplement lanes, because labels often position these products around meals.",
      ]
      : categoryId === "cholesterol_lipid_support"
      ? [
        "For cholesterol-support products, red-yeast-rice or similarly named lipid-support actives per serving are usually the most useful first comparison point.",
        "With-food language and supporting lipid-context actives can matter more here than in a generic herb lane.",
      ]
      : categoryId === "liver_bile_support"
      ? [
        "For liver-bile products, TUDCA or ox-bile per serving are usually the most useful first comparison point.",
        "With-food or with-fat language matters more here than in a generic digestive lane because labels often position these products around meals containing fat.",
      ]
      : ["Use ingredient-level guidance to compare disclosure quality across products."];
  const aiSummaryContract3 = buildAiSummaryContract({
    digest,
    categoryId,
    overviewBlock,
    safeScienceSignals,
    usageBlock,
    blockers,
    hasActiveBreakdown: !missingActiveBreakdown || overlayOmega3Facts.hasEpaDhaBreakdown,
    hasChemicalForm: (!missingFormHighImpact && hasExplicitForm(digest)) || hasOverlayChemicalFormCue(categoryId, overlayClaims),
    overlayClaims,
    scienceIngredientRows: ingredientRows,
  });
  return {
    ingredientSourceTier: selectedIngredients.ingredientSourceTier,
    ingredientRows,
    ingredientSnapshotNames,
    formMatters: {
      ingredientChemicalForm,
      dosageForm,
    },
    odsGeneralScienceBullets:
      odsGeneralScienceBullets.length > 0
        ? odsGeneralScienceBullets
        : fallbackOdsBullets,
    aiSummaryContract3,
  };
};

const buildCategoryUsageCueLine = (categoryId: DecisionSupportCategoryId): string | null => {
  if (categoryId === "probiotics") {
    return "Probiotic-lane usage cue: compare daily serving, with-meal or empty-stomach directions, and any refrigeration instructions.";
  }
  if (categoryId === "metabolic_glucose_support") {
    return "Glucose-lane usage cue: compare before-meal or with-meal directions and whether the label ties the routine to blood-sugar timing.";
  }
  if (categoryId === "cholesterol_lipid_support") {
    return "Cholesterol-lane usage cue: compare with-food directions, daily serving, and whether the label explains the lipid-support routine clearly.";
  }
  if (categoryId === "liver_bile_support") {
    return "Liver-bile lane usage cue: compare with-food or with-fat directions and whether the label ties the routine to bile-support timing.";
  }
  if (categoryId === "botanical_herbal_support") {
    return "Herbal-lane usage cue: compare daily serving, capsule or tea format, and whether the label explains extract strength or plant-part disclosure.";
  }
  if (categoryId === "sleep_stress_mood_support") {
    return "Sleep-lane timing cue: compare at bedtime or night-time directions and whether the label mentions next-day fit.";
  }
  if (categoryId === "magnesium") {
    return "Magnesium-lane usage cue: compare amount per serving and whether the label suggests with food or a split routine if tolerance is a concern.";
  }
  return null;
};

const buildUsageBlock = (params: {
  categoryId: DecisionSupportCategoryId;
  digest: FactsDigest;
  patchActivation?: { appliedLaneIds?: string[] } | null;
  overlayClaims: DecisionSupportOverlayClaims | null;
}): DecisionSupportUsageBlock => {
  const { categoryId, digest, patchActivation, overlayClaims } = params;
  const directionsRows = (Array.isArray(digest?.labelDosing) ? digest.labelDosing : [])
    .map((row) =>
      normalizeDisplayText([row?.population, row?.dose, row?.frequency, row?.rawText].filter(Boolean).join(" ")),
    )
    .filter(Boolean);
  const directionsTextVisible = directionsRows.length > 0;
  const directionsFromPatch = (patchActivation?.appliedLaneIds ?? []).includes("patch_directions_text_v1");
  const overlaySuggestedUseLine = parseOverlaySuggestedUseLine(overlayClaims);
  const overlayDirectionsVisible = !directionsTextVisible && Boolean(overlaySuggestedUseLine);
  const servingCue = normalizeDisplayText(digest?.serving?.servingSize) || "serving size not stated";
  const directionsLines = directionsTextVisible
    ? [
      sanitizeDecisionLine(directionsRows[0] ?? null),
      directionsFromPatch ? "Source: scanned_label (patched)." : "Source: official_record.",
      directionsFromPatch ? "Note: official record may not include directions; label is authoritative." : null,
    ]
    : overlayDirectionsVisible
    ? [
      `Directions from supplemental label data: ${overlaySuggestedUseLine}`,
      "Source: overlay_iherb (supplemental product-page label data).",
      `Serving cue (verified): ${servingCue} per serving (serving != daily dose).`,
    ]
    : [
      "Directions are not included in the official record.",
      "Please use the bottle's Directions panel to confirm daily serving and schedule.",
      `Serving cue (verified): ${servingCue} per serving (serving != daily dose).`,
    ];
  const categoryUsageCueLine = buildCategoryUsageCueLine(categoryId);
  const normalizedLines = dedupeLines([...directionsLines, categoryUsageCueLine], 4);
  return {
    directions: {
      text: normalizedLines[0] ?? "Directions are not included in the official record.",
      lines: normalizedLines.length > 0 ? normalizedLines : ["Directions are not included in the official record."],
      sourceTier: directionsTextVisible
        ? (directionsFromPatch ? "scanned_label" : "official_record")
        : overlayDirectionsVisible
        ? "overlay_iherb"
        : "missing",
      hasDirectionsTextVisible: directionsTextVisible || overlayDirectionsVisible,
    },
    timingTip: "Build a consistent routine after confirming label directions.",
    conservativeGuidance: "If you're unsure, start with the lowest label-suggested daily amount and reassess tolerance.",
  };
};

const DAILY_FREQUENCY_WORD_TO_NUM: Record<string, number> = {
  once: 1,
  twice: 2,
  thrice: 3,
};

const parseDailyFrequencyRangeFromText = (
  value: string | null | undefined,
): { minTimesPerDay: number; maxTimesPerDay: number } | null => {
  const text = normalizeDisplayText(value).toLowerCase();
  if (!text) return null;
  const normalized = text.replace(/[–—]/g, "-");

  const numericRange = normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:times?|x)\s*(?:daily|per\s+day|a\s+day)\b/i,
  );
  if (numericRange?.[1] && numericRange[2]) {
    const min = Number(numericRange[1]);
    const max = Number(numericRange[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return { minTimesPerDay: min, maxTimesPerDay: max };
    }
  }

  const numericSingle = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:times?|x)\s*(?:daily|per\s+day|a\s+day)\b/i);
  if (numericSingle?.[1]) {
    const times = Number(numericSingle[1]);
    if (Number.isFinite(times) && times > 0) return { minTimesPerDay: times, maxTimesPerDay: times };
  }

  const wordSingle = normalized.match(/\b(once|twice|thrice)\s*(?:daily|per\s+day|a\s+day)\b/i);
  if (wordSingle?.[1]) {
    const times = DAILY_FREQUENCY_WORD_TO_NUM[wordSingle[1]] ?? null;
    if (times) return { minTimesPerDay: times, maxTimesPerDay: times };
  }

  return null;
};

const resolvePrimaryActiveDose = (
  digest: FactsDigest,
): { name: string; amount: number; unit: string; evidenceText: string | null } | null => {
  const primary =
    (digest.actives ?? []).find((active) => !isGenericNutritionActiveName(active?.name ?? null)) ??
    (digest.actives ?? [])[0];
  if (!primary) return null;
  const unitFromField = normalizeDisplayText(primary.unit);
  const numericFromField = Number(primary.amount);
  if (Number.isFinite(numericFromField) && numericFromField > 0 && unitFromField) {
    return {
      name: primary.name,
      amount: numericFromField,
      unit: unitFromField,
      evidenceText: primary.evidenceText ?? primary.amountText ?? null,
    };
  }

  const amountText = normalizeDisplayText(primary.amountText);
  const parsed = amountText.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mcg|µg|μg|mg|g|iu)\b/i);
  if (!parsed?.[1] || !parsed[2]) return null;
  const amount = Number(parsed[1].replace(/,/g, ""));
  const unit = normalizeDisplayText(parsed[2]).toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;
  return {
    name: primary.name,
    amount,
    unit,
    evidenceText: amountText || primary.evidenceText || null,
  };
};

const resolveUlDirectionText = (
  digest: FactsDigest,
  overlayClaims: DecisionSupportOverlayClaims | null,
): string | null => {
  const digestPreferred = (Array.isArray(digest.labelDosing) ? digest.labelDosing : [])
    .map((row) => normalizeDisplayText(row?.rawText))
    .filter(Boolean);
  if (digestPreferred.length > 0) return digestPreferred[0] ?? null;
  const fallback = normalizeDisplayText(overlayClaims?.suggestedUse);
  return fallback || null;
};

const buildSafetyBlock = (params: {
  categoryId: DecisionSupportCategoryId;
  digest: FactsDigest;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  overlayClaims: DecisionSupportOverlayClaims | null;
}): DecisionSupportSafetyBlock => {
  const { categoryId, digest, safeScienceSignals, overlayClaims } = params;
  const officialWarnings = dedupeLines(
    Array.isArray(digest?.warnings?.warnings) ? digest.warnings.warnings : [],
    4,
  );
  const overlayWarningsRaw = splitOverlayTextLines(overlayClaims?.warnings, 8);
  const overlayWarningsPrioritized = overlayWarningsRaw.filter((line) =>
    /\bpregnan|nursing|blood thinner|surgery|physician|doctor|consult|seal|store|fish|allerg|medication|medical\b/i.test(
      line,
    ),
  );
  const overlayWarnings = dedupeLines(
    overlayWarningsPrioritized.length > 0 ? overlayWarningsPrioritized : overlayWarningsRaw,
    4,
  );
  const labelWarnings = officialWarnings.length > 0
    ? officialWarnings
    : overlayWarnings.length > 0
    ? overlayWarnings
    : [];
  const primaryActiveDose = resolvePrimaryActiveDose(digest);
  const ulItem = primaryActiveDose
    ? lookupUlByCanonicalKey(primaryActiveDose.name, [primaryActiveDose.name])
    : null;
  const adultUlGroup = ulItem ? getUlLimitByLifeStage(ulItem, "adult_19_plus") : null;
  const directionTextForUl = resolveUlDirectionText(digest, overlayClaims);
  const directionFrequencyRange = parseDailyFrequencyRangeFromText(directionTextForUl);
  const productSafetySummary = buildProductSafetySummary({ digest });

  const omega3UlGuidance = [
    "NIH ODS does not set a single UL for omega-3 in the same way as some vitamins/minerals.",
    "General tip: consider total intake from all sources and follow label guidance.",
  ];

  const defaultUlGuidance = dedupeLines(
    [
      ...(safeScienceSignals?.evidenceLines ?? []).filter((line) => /\bul\b|upper limit/i.test(line)),
      "UL guidance is general and should be compared with total daily intake across all sources.",
    ],
    2,
  );

  const ulNumericGuidance = (() => {
    if (categoryId === "fish_oil_omega3") return [] as string[];
    if (!ulItem || !adultUlGroup) return [] as string[];

    const lines: string[] = [];
    const ulText = formatDoseText(adultUlGroup.value, adultUlGroup.unit);
    lines.push(`Adult UL (NIH ODS): ${ulText}/day (total intake).`);

    const scopeNote = buildUlScopeNote({
      scope: ulItem.scope,
      canonicalKey: ulItem.ingredientCanonicalKey,
    });
    if (scopeNote) lines.push(scopeNote);

    if (primaryActiveDose && directionFrequencyRange) {
      const converted = convertDoseToUlUnit({
        amount: primaryActiveDose.amount,
        fromUnit: primaryActiveDose.unit,
        targetUnit: adultUlGroup.unit,
        altUnits: ulItem.altUnits,
      });
      if (converted.ok && converted.value != null && converted.unit) {
        const minDaily = converted.value * directionFrequencyRange.minTimesPerDay;
        const maxDaily = converted.value * directionFrequencyRange.maxTimesPerDay;
        const minDailyText = formatDoseText(minDaily, converted.unit);
        const maxDailyText = formatDoseText(maxDaily, converted.unit);
        const risk = classifyUlRisk(maxDaily / adultUlGroup.value);
        if (risk === "high" || risk === "moderate") {
          if (directionFrequencyRange.minTimesPerDay === directionFrequencyRange.maxTimesPerDay) {
            lines.push(`Label directions could reach about ${maxDailyText}/day; this may exceed the UL.`);
          } else {
            lines.push(
              `Label directions could provide about ${minDailyText}/day, up to ${maxDailyText}/day at the top end; this may exceed the UL.`,
            );
          }
        } else if (directionFrequencyRange.minTimesPerDay === directionFrequencyRange.maxTimesPerDay) {
          lines.push(`Label directions estimate about ${maxDailyText}/day, which appears below the UL.`);
        } else {
          lines.push(
            `Label directions estimate about ${minDailyText}/day to ${maxDailyText}/day, which appears below the UL.`,
          );
        }
        return dedupeLines(lines, 3);
      }
    }

    lines.push("Compare this UL against total daily intake from food, fortified products, and supplements.");
    return dedupeLines(lines, 3);
  })();

  const omega3Watchouts = [
    "If pregnant/nursing or taking blood thinners / preparing for surgery, confirm with a clinician and read label cautions.",
    "Stop/adjust if you notice unexpected effects and consult a professional.",
  ];
  const metabolicGlucoseWatchouts = [
    "Glucose-lane watch-out: actives in this lane can overlap with blood-sugar or diabetes medication routines, so timing and tolerance still matter.",
    "If you are pregnant or using glucose-lowering medications, review the label cautions with a clinician before use.",
  ];
  const cholesterolWatchouts = [
    "Cholesterol-lane watch-out: red-yeast-rice products can overlap with liver or statin-like caution language on labels, so those warnings deserve extra attention.",
    "If you are pregnant or using cholesterol medications, review the label cautions with a clinician before use.",
  ];
  const liverBileWatchouts = [
    "Liver-bile lane watch-out: bile, gallbladder, or liver-history cautions matter more here than in a generic digestive lane.",
    "If you have gallbladder or liver concerns, or use medications, review the label cautions with a healthcare practitioner before use.",
  ];
  const botanicalWatchouts = [
    "Herbal-lane watch-out: herb products can vary in extract strength and medication-interaction risk, so disclosure quality still matters.",
    "If you are pregnant, allergic to the source plant, or using medications, review the label cautions with a clinician before use.",
  ];
  const probioticsWatchouts = [
    "Probiotic-lane watch-out: storage or refrigeration instructions matter more here because viability can depend on how the product is handled.",
    "If you are immunocompromised, pregnant, or using medications, review the label cautions with a clinician before use.",
  ];
  const magnesiumWatchouts = [
    "Magnesium-lane watch-out: some forms or higher intakes can cause diarrhea or laxative-type GI effects, so tolerance still matters.",
    "If you have kidney concerns, are pregnant, or use medications, review the label cautions with a clinician before use.",
  ];
  const sleepStressWatchouts = [
    "Sleep-lane watch-out: products in this lane can cause drowsiness, so avoid driving, alcohol, or other sedating combinations if the label warns about them.",
    "If pregnant, breastfeeding, or using sedating medications, review the label cautions with a clinician before use.",
  ];
  const defaultWatchouts = dedupeLines(
    [
      "If you are pregnant, breastfeeding, or using medications, review watch-outs before use.",
      "General watch-outs are ingredient-level guidance and not product-label warnings.",
    ],
    3,
  );
  return {
    labelWarnings:
      labelWarnings.length > 0
        ? labelWarnings
        : [
          "Product-specific label warnings were not included in the official record.",
          "Check the bottle's Warnings/Cautions panel.",
        ],
    ulGuidance:
      productSafetySummary.ulGuidanceEntries.length > 0
        ? dedupeLines(
          productSafetySummary.ulGuidanceEntries.map((entry) => entry.displayLine),
          3,
        )
        : categoryId === "fish_oil_omega3"
        ? omega3UlGuidance
        : (
          ulNumericGuidance.length > 0
            ? ulNumericGuidance
            : (defaultUlGuidance.length > 0
              ? defaultUlGuidance
              : ["UL guidance remains general and should be reviewed with total daily intake."])
        ),
    ulGuidanceEntries:
      productSafetySummary.ulGuidanceEntries.length > 0 ? productSafetySummary.ulGuidanceEntries : undefined,
    generalWatchouts:
      categoryId === "fish_oil_omega3"
        ? omega3Watchouts
        : categoryId === "metabolic_glucose_support"
        ? metabolicGlucoseWatchouts
        : categoryId === "cholesterol_lipid_support"
        ? cholesterolWatchouts
        : categoryId === "liver_bile_support"
        ? liverBileWatchouts
        : categoryId === "botanical_herbal_support"
        ? botanicalWatchouts
        : categoryId === "probiotics"
        ? probioticsWatchouts
        : categoryId === "magnesium"
        ? magnesiumWatchouts
        : categoryId === "sleep_stress_mood_support"
        ? sleepStressWatchouts
        : defaultWatchouts,
    dataStatusRef: "See Missing info in Overview.",
  };
};

const deriveQualityMarkSignal = (digest: FactsDigest): DecisionSupportQualityMarkTrustSignal => {
  const cached = lookupQualityMarkAudit({
    sourceType: digest?.sourceType ?? null,
    identityType: digest?.identity?.type ?? null,
    identityValue: digest?.identity?.value ?? null,
    brandName: digest?.product?.brandDisplay ?? null,
    productName: digest?.product?.name ?? null,
  });
  if (cached.entry) {
    const searchOnlyEvidence = cached.entry.checkedMode === "search_only" ||
      cached.entry.evidenceType === "search" ||
      /^https:\/\/duckduckgo\.com\/html\//i.test(String(cached.entry.evidenceRef ?? ""));
    const normalizedStatus: DecisionSupportQualityMarkStatus = searchOnlyEvidence
      ? "unknown"
      : cached.entry.status;
    const normalizedCheckedMode = cached.entry.checkedMode ?? (searchOnlyEvidence ? "search_only" : "page_fetch");
    const normalizedEvidenceType = cached.entry.evidenceType ?? (searchOnlyEvidence ? "search" : "page");
    const normalizedPagesFetchedCount = Number.isFinite(cached.entry.pagesFetchedCount) ? cached.entry.pagesFetchedCount : 0;
    const normalizedSearchPagesFetchedCount = Number.isFinite(cached.entry.searchPagesFetchedCount)
      ? cached.entry.searchPagesFetchedCount
      : (searchOnlyEvidence ? 1 : 0);
    const verificationSummary = cached.entry.verificationSummary ?? null;
    const note =
      searchOnlyEvidence
        ? "Third-party verification is still unproven because only search-only evidence is available."
        : verificationSummary?.overallStatus === "verified"
          ? `Third-party verification was confirmed via the ${verificationSummary.strongestProgramLabel ?? "official"} registry.`
          : verificationSummary?.warnings.includes("registry_access_blocked")
            ? `Official ${verificationSummary.strongestProgramLabel ?? "registry"} access was attempted but blocked, so third-party verification remains unproven.`
            : verificationSummary?.warnings.includes("brand_level_only_match")
              ? `Official ${verificationSummary.strongestProgramLabel ?? "registry"} results matched the brand, but product-level verification remains unproven.`
              : verificationSummary?.overallStatus === "claimed" &&
                  verificationSummary?.warnings.includes("registry_checked_not_found")
                ? `A program-specific third-party claim was detected${verificationSummary.strongestProgramLabel ? ` (${verificationSummary.strongestProgramLabel})` : ""}, but official registry checks did not confirm a product-level match.`
          : verificationSummary?.overallStatus === "claimed"
            ? `A program-specific third-party claim was detected${verificationSummary.strongestProgramLabel ? ` (${verificationSummary.strongestProgramLabel})` : ""}, but registry verification has not been completed yet.`
            : verificationSummary?.warnings.includes("registry_checked_not_found")
              ? `Official ${verificationSummary.strongestProgramLabel ?? "registry"} verification was checked and no product-level match was found.`
            : verificationSummary?.overallStatus === "not_proven"
              ? "Third-party verification was checked and is not currently proven from the available evidence."
              : verificationSummary?.warnings.includes("program_not_equivalent_to_generic_third_party")
                ? "A quality program was mentioned, but it is not treated as a generic third-party testing proof."
                : "Third-party quality mark check is inconclusive.";
    return {
      code: "quality_mark_status",
      status: normalizedStatus,
      checked: cached.entry.checked,
      confidence: cached.entry.confidence,
      confidenceBucket: cached.entry.confidenceBucket,
      evidenceRef: cached.entry.evidenceRef,
      sourcesTried: cached.entry.sourcesTried,
      lastCheckedAt: cached.entry.checkedAt,
      checkedMode: normalizedCheckedMode,
      pagesFetchedCount: normalizedPagesFetchedCount,
      searchPagesFetchedCount: normalizedSearchPagesFetchedCount,
      evidenceType: normalizedEvidenceType,
      note,
      programMatches: cached.entry.programMatches ?? [],
      verificationSummary,
    };
  }
  return {
    code: "quality_mark_status",
    status: "unknown",
    checked: false,
    confidence: null,
    confidenceBucket: "low",
    evidenceRef: null,
    sourcesTried: [],
    lastCheckedAt: null,
    checkedMode: null,
    pagesFetchedCount: 0,
    searchPagesFetchedCount: 0,
    evidenceType: null,
    note: "Third-party quality mark status is unknown until verified web evidence is available.",
    programMatches: [],
    verificationSummary: null,
  };
};

const deriveBrandLevelOfficialProgramSignal = (
  qualitySignal: DecisionSupportQualityMarkTrustSignal,
): DecisionSupportBrandLevelProgramSignal | null => {
  const verificationSummary = qualitySignal.verificationSummary ?? null;
  if (!verificationSummary?.brandLevelOfficialProgramDetected) return null;
  return {
    code: "brand_level_official_program",
    status: "detected",
    checked: qualitySignal.checked,
    confidence: qualitySignal.confidence,
    confidenceBucket: qualitySignal.confidenceBucket,
    evidenceRef: qualitySignal.evidenceRef,
    sourcesTried: qualitySignal.sourcesTried,
    lastCheckedAt: qualitySignal.lastCheckedAt,
    checkedMode: qualitySignal.checkedMode,
    pagesFetchedCount: qualitySignal.pagesFetchedCount,
    searchPagesFetchedCount: qualitySignal.searchPagesFetchedCount,
    evidenceType: qualitySignal.evidenceType,
    note:
      verificationSummary.brandLevelOfficialProgramLabels.length > 0
        ? `Official registry results matched the brand for ${verificationSummary.brandLevelOfficialProgramLabels.join(", ")}, but product-level verification remains unproven.`
        : "Official registry results matched the brand, but product-level verification remains unproven.",
    programLabel: verificationSummary.strongestProgramLabel,
    matchLevel: "brand",
    programMatches: qualitySignal.programMatches ?? [],
    verificationSummary,
  };
};

export const compileDecisionSupport = (
  params: DecisionSupportCompileParams,
): DecisionSupportPayload => {
  const digestSourceType = normalizeText(params.digest?.sourceType);
  const categoryId = detectCategoryId(params.digest);
  const categoryProfileVersion = CATEGORY_PROFILE_VERSION[categoryId];

  const missingWarnings = !hasWarningsData(params.digest);
  const missingWarningsAsFixable = missingWarnings && digestSourceType === "web";
  const missingWarningsAsCeiling = missingWarnings && (digestSourceType === "lnhpd" || digestSourceType === "dsld");

  const missingDirectionsDsld = digestSourceType === "dsld" && !hasDirections(params.digest);
  const missingActiveBreakdown = categoryId === "fish_oil_omega3" && !hasFishOilBreakdown(params.digest);
  const missingFormHighImpact = categoryId === "vitamin_d" && !hasExplicitForm(params.digest);
  const safeScienceSignals = lookupSafeScienceSignals({
    ingredientName: params.digest?.actives?.[0]?.name ?? params.digest?.product?.name ?? null,
    formText: params.digest?.actives?.[0]?.chemicalForm ?? null,
  });
  const qualitySignal = deriveQualityMarkSignal(params.digest);
  const overlayCorpus = normalizeOverlayCorpus(params.overlayClaims ?? null);
  const overlayCorpusCompact = compactOverlayCorpus(overlayCorpus);
  const qualitySignalForPayload: DecisionSupportQualityMarkTrustSignal = {
    ...qualitySignal,
    verificationSummary: mergeQualityMarkSummaries(
      qualitySignal.verificationSummary ?? null,
      buildOverlayThirdPartyVerificationSummary({
        corpus: overlayCorpus,
        corpusCompact: overlayCorpusCompact,
      }),
    ),
  };
  const brandLevelOfficialProgramSignal = deriveBrandLevelOfficialProgramSignal(qualitySignalForPayload);

  const checklist = buildChecklist({
    digest: params.digest,
    categoryId,
    viewMode: params.viewMode,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
    safeScienceSignals,
    qualitySignal,
  });

  const blockers = buildBlockers({
    digest: params.digest,
    categoryId,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
  });

  const topBlockers = blockers
    .filter((item) => item.affectsCoreVerdict)
    .sort(compareBlockers)
    .slice(0, 3);

  const subscores = [
    toSubscore("GoalEvidenceFit", checklist),
    toSubscore("FormulaQuality", checklist),
    toSubscore("SafetyTransparency", checklist),
    toSubscore("TrustQualityAssurance", checklist),
  ];

  const { verdict, verdictReason } = deriveVerdict({ subscores, topBlockers });

  const sourceIdentityCanonical = canonicalizeSourceIdentity(params.digest);
  const flagsSnapshotCanonical = canonicalizeFlagsSnapshot(params.flagsSnapshot);
  const patchActivationCanonical = canonicalizePatchActivation(params.patchActivation ?? null);
  const overlayAugmentation = buildDecisionSupportOverlayAugmentationMeta(params.overlayClaims ?? null);
  const allergyContextCanonical = canonicalizeAllergyContext(params.allergyContext ?? null);
  const personalizationContextCanonical = canonicalizePersonalizationContext(
    params.personalizationContext ?? null,
  );
  const localeCanonical = String(params.locale ?? "en").trim().toLowerCase();
  const digestInputParts = {
    factsDigestHash: params.factsDigestHash,
    decisionContractVersion: DECISION_SUPPORT_CONTRACT_VERSION,
    localeCanonical,
    rubricVersion: DECISION_SUPPORT_RUBRIC_VERSION,
    categoryId,
    categoryProfileVersion,
    viewMode: params.viewMode,
    flagsSnapshotCanonical,
    sourceIdentityCanonical,
    overlayAugmentationSource: overlayAugmentation.source,
    overlayAugmentationVersion: overlayAugmentation.version,
    overlayClaimsHash: overlayAugmentation.claimsHash,
    patchActivationCanonical,
    allergyContextCanonical,
    personalizationContextCanonical,
  } as const;
  const digestInput = [
    digestInputParts.factsDigestHash,
    digestInputParts.decisionContractVersion,
    digestInputParts.localeCanonical,
    digestInputParts.rubricVersion,
    digestInputParts.categoryId,
    digestInputParts.categoryProfileVersion,
    digestInputParts.viewMode,
    digestInputParts.flagsSnapshotCanonical,
    digestInputParts.sourceIdentityCanonical,
    digestInputParts.overlayAugmentationSource,
    digestInputParts.overlayAugmentationVersion ?? "none",
    digestInputParts.overlayClaimsHash ?? "none",
    digestInputParts.patchActivationCanonical,
    digestInputParts.allergyContextCanonical,
    digestInputParts.personalizationContextCanonical,
  ].join(DECISION_SUPPORT_DIGEST_DELIMITER);
  const decisionInputsHash = hashCanonicalString(digestInput);
  const digest = decisionInputsHash;

  const usageBlock = buildUsageBlock({
    categoryId,
    digest: params.digest,
    patchActivation: params.patchActivation ?? null,
    overlayClaims: params.overlayClaims ?? null,
  });
  const ingredientScienceContext = buildIngredientScienceContext({
    digest: params.digest,
    overlayClaims: params.overlayClaims ?? null,
  });
  const selectedScienceIngredients = {
    ingredientSourceTier: ingredientScienceContext.ingredientSourceTier,
    ingredientRows: ingredientScienceContext.ingredientRows,
  };
  const overviewBlock = buildOverviewBlock({
    digest: params.digest,
    categoryId,
    safeScienceSignals,
    blockers,
    missingActiveBreakdown,
    overlayClaims: params.overlayClaims ?? null,
    usageBlock,
  });
  const scienceBlock = buildScienceBlock({
    digest: params.digest,
    categoryId,
    safeScienceSignals,
    overviewBlock,
    usageBlock,
    blockers,
    missingActiveBreakdown,
    missingFormHighImpact,
    overlayClaims: params.overlayClaims ?? null,
    selectedIngredients: selectedScienceIngredients,
  });
  const safetyBlock = buildSafetyBlock({
    categoryId,
    digest: params.digest,
    safeScienceSignals,
    overlayClaims: params.overlayClaims ?? null,
  });
  const qualityMark: DecisionSupportQualityMark = {
    status: qualitySignalForPayload.status,
    checked: qualitySignalForPayload.checked,
    confidenceBucket: qualitySignalForPayload.confidenceBucket,
    evidenceRef: qualitySignalForPayload.evidenceRef,
    sourcesTried: qualitySignalForPayload.sourcesTried,
    lastCheckedAt: qualitySignalForPayload.lastCheckedAt,
    checkedMode: qualitySignalForPayload.checkedMode,
    pagesFetchedCount: qualitySignalForPayload.pagesFetchedCount,
    searchPagesFetchedCount: qualitySignalForPayload.searchPagesFetchedCount,
    evidenceType: qualitySignalForPayload.evidenceType,
    note: qualitySignalForPayload.note,
    programMatches: qualitySignalForPayload.programMatches ?? [],
    verificationSummary: qualitySignalForPayload.verificationSummary ?? null,
  };
  const nutriScoreCardV2 = buildNutriScoreCardV2({
    digest: params.digest,
    categoryId,
    checklist,
    blockers,
    usageBlock,
    safetyBlock,
    qualityMark,
    overlayClaims: params.overlayClaims ?? null,
  });
  const personalizedResultLane = buildPersonalizedResultLane({
    digest: params.digest,
    usageBlock,
    allergyContext: params.allergyContext ?? null,
    personalizationContext: params.personalizationContext ?? null,
  });

  return {
    digest,
    decisionInputsHash,
    decisionContractVersion: DECISION_SUPPORT_CONTRACT_VERSION,
    overlayClaimsHash: overlayAugmentation.claimsHash,
    overlayAugmentationVersion: overlayAugmentation.version,
    overlayAugmentationSource: overlayAugmentation.source,
    patchActivationCanonical,
    rubricVersion: DECISION_SUPPORT_RUBRIC_VERSION,
    categoryId,
    categoryProfileVersion,
    viewMode: params.viewMode,
    verdict,
    verdictReason,
    subscores,
    checklist,
    blockers,
    topBlockers,
    extraTrustSignals: brandLevelOfficialProgramSignal
      ? [qualitySignalForPayload, brandLevelOfficialProgramSignal]
      : [qualitySignalForPayload],
    sourceTiers: dedupeSourceTiers(checklist),
    nutriScoreCardV2,
    overviewBlock,
    scienceBlock,
    usageBlock,
    safetyBlock,
    personalizedResultLane,
    qualityMark,
    safeScienceSignalSource: safeScienceSignals?.signalSource ?? "none",
    safeScienceFallbackType: safeScienceSignals?.fallbackType ?? null,
    decisionDebug: {
      factsDigestHash: params.factsDigestHash,
      sourceIdentityCanonical,
      sourceType: params.digest.sourceType,
      digestIdentityType: params.digest.identity.type,
      digestIdentityValue: params.digest.identity.value,
      localeCanonical,
      rubricVersion: DECISION_SUPPORT_RUBRIC_VERSION,
      categoryId,
      categoryProfileVersion,
      viewMode: params.viewMode,
      flagsSnapshotCanonical,
      overlayClaimsHash: overlayAugmentation.claimsHash,
      overlayAugmentationVersion: overlayAugmentation.version,
      overlayAugmentationSource: overlayAugmentation.source,
      patchActivationCanonical,
      allergyContextCanonical,
      personalizationContextCanonical,
      decisionContractVersion: DECISION_SUPPORT_CONTRACT_VERSION,
      digestInputParts,
    },
  };
};

export const toDecisionSupportInline = (payload: DecisionSupportPayload): DecisionSupportInline => ({
  verdict: payload.verdict,
  subscores: payload.subscores.map((item) => ({ id: item.id, score: item.score })),
  topBlockers: payload.topBlockers.map((item) => ({
    code: item.code,
    title: item.title,
    why: item.why,
    severity: item.severity,
  })),
  nutriScoreCardV2: payload.nutriScoreCardV2,
  overviewBlock: payload.overviewBlock,
  scienceBlock: payload.scienceBlock,
  usageBlock: payload.usageBlock,
  safetyBlock: payload.safetyBlock,
  personalizedResultLane: payload.personalizedResultLane,
  qualityMark: payload.qualityMark,
});
