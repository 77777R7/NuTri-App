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
  primaryIngredient?: string; // NEW: for nutrient category lookup
  primaryCategory?: NutrientCategory; // NEW: Pre-calculated category
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
  dataCoverage?: number; // NEW: 0-1 confidence score
}

export interface ScoreBreakdown {
  effectiveness: number; // 0–10
  safety: number; // 0–10
  value: number; // 0–10
  overall: number; // 0–100
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
  withFood: boolean | null; // true=with food, false=empty stomach, null=anytime
  conflicts: string[];
  sourceType: "product_label" | "general_knowledge";
}

export interface AiSupplementAnalysisSuccess {
  schemaVersion: number;
  barcode: string;
  generatedAt: string;
  model: string;
  status: "success";
  overallScore: number; // 0-5 weighted blend of category scores
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
    // New structured content
    verdict?: string;
    highlights?: string[];
    warnings?: string[];
  };
  value: {
    score: RatingScore;
    verdict: string;
    analysis: string;
    // New structured content
    highlights?: string[];
    warnings?: string[];
  };
  safety: {
    score: RatingScore;
    risks: string[];
    redFlags: string[];
    additivesInfo: string | null;
    // New structured content
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
  sources: Array<{ title: string; link: string }>;
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
