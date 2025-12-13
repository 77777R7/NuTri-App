export interface SearchItem {
  title: string;
  snippet: string;
  link: string;
  image?: string;
}

export interface SearchResponseOk {
  status: "ok";
  barcode: string;
  items: SearchItem[];
}

export interface SearchResponseNotFound {
  status: "not_found";
  barcode: string;
}

export type SearchResponse = SearchResponseOk | SearchResponseNotFound;

export interface ErrorResponse {
  error: string;
  detail?: string;
  statusCode?: number;
}

export type RatingScore = 0 | 1 | 2 | 3 | 4 | 5;
export type EvidenceLevel = 0 | 1 | 2 | 3;
export type FormBioRating = "high" | "medium" | "low";
export type InteractionLevel = "low" | "moderate" | "high" | "unknown";
export type OverlapLevel = "low" | "medium" | "high" | "unknown";

export type NutrientCategory = "water_soluble_vitamin" | "fat_soluble_vitamin" | "essential_mineral" | "other";

export interface SupplementMeta {
  evidenceLevel: EvidenceLevel;
  primaryIngredient?: string;
  primaryCategory?: NutrientCategory;
  refDoseMg?: number;
  actualDoseMg?: number;
  formBioRating?: FormBioRating;
  coreActiveRatio?: number;

  ulRatio?: number;
  interactionLevel?: InteractionLevel;
  hasCommonAllergens?: boolean;
  hasStrongStimulants?: boolean;
  thirdPartyTested?: boolean;

  price?: number;
  currency?: string;
  daysPerBottle?: number;
  dosesPerDay?: number;
  timingConstraints?: "flexible" | "with_food" | "empty_stomach" | "complex" | "unknown";
  labelClarity?: "clear" | "somewhat_unclear" | "unclear" | "unknown";
  overlapLevel?: OverlapLevel;
  dataCoverage?: number;
}

export interface ScoreBreakdown {
  effectiveness: number;
  safety: number;
  value: number;
  overall: number;
  label: "strongly_recommended" | "optional" | "low_priority" | "not_recommended";
}

export interface AiSupplementAnalysisBase {
  schemaVersion: 1;
  barcode: string;
  generatedAt?: string;
  model?: string;
}

export interface UsageAssessment {
  summary: string;
  timing: string | null;
  withFood: boolean | null;
  conflicts: string[];
  sourceType: "product_label" | "general_knowledge";
}

export interface AiSupplementAnalysisSuccess {
  schemaVersion: number;
  barcode: string;
  generatedAt: string;
  model: string;
  status: "success";
  overallScore: number;
  confidence: "low" | "medium" | "high";
  productInfo: {
    brand: string | null;
    name: string | null;
    category: string | null;
    image: string | null;
  };
  meta?: SupplementMeta;
  scores?: ScoreBreakdown;
  efficacy: {
    score: RatingScore;
    benefits: string[];
    dosageAssessment: {
      text: string;
      isUnderDosed: boolean;
    };
    verdict?: string;
    highlights?: string[];
    warnings?: string[];
  };
  value: {
    score: RatingScore;
    verdict: string;
    analysis: string;
    highlights?: string[];
    warnings?: string[];
  };
  safety: {
    score: RatingScore;
    risks: string[];
    redFlags: string[];
    additivesInfo: string | null;
    verdict?: string;
    highlights?: string[];
    warnings?: string[];
  };
  social: {
    score: RatingScore;
    tier: string;
    summary: string;
    tags: string[];
  };
  usage: UsageAssessment;
  sources: { title: string; link: string }[];
  disclaimer: string;
}

export interface AiSupplementAnalysisFailure extends AiSupplementAnalysisBase {
  status: "unknown_product" | "error";
  overallScore: 0;
  confidence: "low";
  productInfo: null;
  efficacy: null;
  value: null;
  safety: null;
  social: null;
  usage: null;
  sources: [];
  disclaimer: string;
}

export type AiSupplementAnalysis =
  | AiSupplementAnalysisSuccess
  | AiSupplementAnalysisFailure;

// ============================================================================
// NEW: Deep Ingredient Analysis Types (for enhanced AI prompts)
// ============================================================================

/**
 * Single ingredient analysis with chemical form and dosage evaluation
 */
export interface IngredientAnalysis {
  name: string;
  form: string | null;
  formQuality: "high" | "medium" | "low" | "unknown";
  formNote: string | null;
  dosageValue: number | null;
  dosageUnit: string | null;
  recommendedMin: number | null;
  recommendedMax: number | null;
  recommendedUnit: string | null;
  dosageAssessment: "adequate" | "underdosed" | "overdosed" | "unknown";
  evidenceLevel: "strong" | "moderate" | "weak" | "none";
  evidenceSummary: string | null;
  rdaSource?: "NIH" | "EFSA" | "Health Canada" | "mixed" | null;
  ulValue?: number | null;
  ulUnit?: string | null;
}

/**
 * Primary active ingredient information
 */
export interface PrimaryActive {
  name: string;
  form: string | null;
  formQuality: "high" | "medium" | "low" | "unknown";
  formNote: string | null;
  dosageValue: number | null;
  dosageUnit: string | null;
  evidenceLevel: "strong" | "moderate" | "weak" | "none";
  evidenceSummary: string | null;
}

/**
 * Enhanced efficacy analysis with deep ingredient details
 */
export interface EfficacyAnalysisEnhanced {
  score: number;
  verdict: string;
  primaryActive: PrimaryActive | null;
  ingredients: IngredientAnalysis[];
  overviewSummary: string | null;
  coreBenefits: string[];
  overallAssessment: string;
  marketingVsReality: string;
}

/**
 * UL warning for safety analysis
 */
export interface ULWarning {
  ingredient: string;
  currentDose: string;
  ulLimit: string;
  riskLevel: "moderate" | "high";
}

/**
 * Enhanced safety analysis with UL warnings and interactions
 */
export interface SafetyAnalysisEnhanced {
  score: number;
  verdict: string;
  risks: string[];
  redFlags: string[];
  ulWarnings: ULWarning[];
  allergens: string[];
  interactions: string[];
  consultDoctorIf: string[];
  recommendation: string;
}

/**
 * Enhanced usage analysis with specific guidance
 */
export interface UsageAnalysisEnhanced {
  usage: {
    summary: string;
    timing: string;
    withFood: boolean | null;
    frequency: string;
    interactions: string[];
  };
  value: {
    score: number;
    verdict: string;
    analysis: string;
    costPerServing: number | null;
    alternatives: string[];
  };
  social: {
    score: number;
    summary: string;
  };
}

/**
 * Brand extraction result from rule-based or AI extraction
 */
export interface BrandExtractionResult {
  brand: string | null;
  product: string | null;
  category: string | null;
  confidence: "high" | "medium" | "low";
  score: number;
  reason: string;
  source: "rule" | "ai";
}

/**
 * Source item with quality indicators
 */
export interface EnrichedSource {
  title: string;
  link: string;
  domain: string;
  isHighQuality: boolean;
}

