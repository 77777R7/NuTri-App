import type { OdsUlScope } from "../ods/ulDataset.js";

export type Week3LaunchTier = "tier1" | "tier2" | "unlisted";
export type Week3UlLaunchMode = true | "fallback_only" | false;

export type SafetyComparisonStatus =
  | "below"
  | "near"
  | "over"
  | "not_comparable"
  | "no_ul_established";

export type SafetyIngredientMatch = {
  rawIngredientText: string;
  ingredientCanonicalKey: string | null;
  ingredientDisplayName: string;
  canonicalParentKey: string | null;
  matchSource: "week3_whitelist" | "ods_alias" | "name_key" | "none";
  matchConfidence: number;
  launchTier: Week3LaunchTier;
  launchEnabledForUlCompare: Week3UlLaunchMode;
  chemicalFormText: string | null;
};

export type DailyDoseBasis = "label_daily_estimate" | "one_serving_fallback";
export type DailyDoseBasisReason =
  | "parsed_label_directions"
  | "missing_directions"
  | "ambiguous_frequency"
  | "snapshot_only_no_directions"
  | "insufficient_active_dose";

export type NormalizedDose = {
  rawDoseText: string | null;
  normalizedDoseValue: number | null;
  normalizedDoseUnit: string | null;
  conversionConfidence: number;
  conversionReason:
    | "DIRECT_UNIT_MATCH"
    | "MASS_UNIT_NORMALIZED"
    | "UNSUPPORTED_UNIT"
    | "INVALID_INPUT"
    | "NON_COMPARABLE_UNIT";
  comparableToUl: boolean;
  dailyEstimatedDoseValue: number | null;
  dailyEstimatedDoseUnit: string | null;
  dailyEstimatedDoseText: string | null;
  dailyDoseBasis: DailyDoseBasis;
  dailyDoseBasisReason: DailyDoseBasisReason;
};

export type UlMatchResult = {
  ulMatched: boolean;
  ingredientCanonicalKey: string | null;
  ingredientDisplayName: string;
  comparisonStatus: SafetyComparisonStatus;
  ulValue: number | null;
  ulUnit: string | null;
  ulValueText: string | null;
  currentDoseValue: number | null;
  currentDoseUnit: string | null;
  currentDoseText: string | null;
  scope: OdsUlScope | null;
  scopeNote: string | null;
  lifeStage: "adult_19_plus";
  source: "NIH_ODS_UL" | "UNKNOWN";
  sourceLabel: string | null;
  sourceUrl: string | null;
  comparisonRatio: number | null;
  reasonCode:
    | "ODS_UL_MATCHED"
    | "NO_UL_ESTABLISHED"
    | "DOSE_NOT_COMPARABLE"
    | "UNLISTED_INGREDIENT"
    | "UNMATCHED_INGREDIENT";
  notes: string[];
};

export type UlGuidanceEntry = {
  ingredientCanonicalKey: string;
  ingredientDisplayName: string;
  currentDoseText: string | null;
  ulLimitText: string | null;
  comparisonStatus: SafetyComparisonStatus;
  scope: OdsUlScope | null;
  scopeNote: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  reasonCode: string;
  displayLine: string;
  launchTier: Week3LaunchTier;
};

export type ProductSafetySummary = {
  ulGuidanceEntries: UlGuidanceEntry[];
  fallbackReason:
    | "INSUFFICIENT_PRODUCT_INGREDIENT_DATA"
    | "NO_WEEK3_WHITELIST_MATCH"
    | "NO_UL_ESTABLISHED"
    | "ONLY_NOT_COMPARABLE_ENTRIES"
    | null;
  comparedIngredientCount: number;
};

export type DuplicateIngredientContribution = {
  supplementId: string;
  productName: string;
  ingredientCanonicalKey: string;
  ingredientDisplayName: string;
  rawDoseText: string | null;
  dailyEstimatedDoseText: string | null;
  dailyEstimatedDoseValue: number | null;
  dailyEstimatedDoseUnit: string | null;
  dailyDoseBasis: DailyDoseBasis;
  dailyDoseBasisReason: DailyDoseBasisReason;
  dailyDoseBasisLabel: string;
  comparisonStatus: SafetyComparisonStatus;
  comparableToUl: boolean;
};

export type DuplicateIngredientGroup = {
  ingredientCanonicalKey: string;
  ingredientDisplayName: string;
  productCount: number;
  products: DuplicateIngredientContribution[];
  estimatedTotalDoseValue: number | null;
  estimatedTotalDoseUnit: string | null;
  estimatedTotalDoseText: string | null;
  ulValue: number | null;
  ulUnit: string | null;
  ulValueText: string | null;
  scope: OdsUlScope | null;
  scopeNote: string | null;
  status: SafetyComparisonStatus;
  confidence: "high" | "medium" | "low";
  surfaced: boolean;
  launchTier: Week3LaunchTier;
};

export type SavedStackSummary = {
  stackLevelSummary: {
    headline: string | null;
    detailLines: string[];
    status: SafetyComparisonStatus | null;
  };
  duplicateGroups: DuplicateIngredientGroup[];
  meta: {
    processedSupplements: number;
    skippedSupplements: number;
    surfacedGroupCount: number;
    hiddenGroupCount: number;
    supportedLifeStage: "adult_19_plus";
    dailyDoseBasisCounts: {
      labelDailyEstimate: number;
      oneServingFallback: number;
    };
    dailyDoseBasisReasonCounts: Partial<Record<DailyDoseBasisReason, number>>;
    estimateBasisSummary: string | null;
    hiddenGroupNote: string | null;
    skippedSupplementNote: string | null;
  };
};
