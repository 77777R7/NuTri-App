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
    effectiveness: number; // 0–100 (Scaled for UI)
    safety: number; // 0–100
    value: number; // 0–100
    overall: number; // 0–100
    label: "strongly_recommended" | "optional" | "low_priority" | "not_recommended";
}
