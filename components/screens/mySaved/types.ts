export type StackSafetyComparisonStatus =
  | "below"
  | "near"
  | "over"
  | "not_comparable"
  | "no_ul_established";

export type StackDuplicateContribution = {
  supplementId: string;
  productName: string;
  ingredientCanonicalKey: string;
  ingredientDisplayName: string;
  rawDoseText?: string | null;
  dailyEstimatedDoseText?: string | null;
  dailyEstimatedDoseValue?: number | null;
  dailyEstimatedDoseUnit?: string | null;
  dailyDoseBasis?: "label_daily_estimate" | "one_serving_fallback";
  dailyDoseBasisReason?:
    | "parsed_label_directions"
    | "missing_directions"
    | "ambiguous_frequency"
    | "snapshot_only_no_directions"
    | "insufficient_active_dose";
  dailyDoseBasisLabel?: string;
  comparisonStatus?: StackSafetyComparisonStatus;
  comparableToUl?: boolean;
};

export type StackDuplicateGroup = {
  ingredientCanonicalKey: string;
  ingredientDisplayName: string;
  productCount: number;
  products: StackDuplicateContribution[];
  estimatedTotalDoseText?: string | null;
  ulValueText?: string | null;
  scopeNote?: string | null;
  status: StackSafetyComparisonStatus;
  confidence?: "high" | "medium" | "low";
  surfaced?: boolean;
};

export type StackLevelSafetySummary = {
  headline: string | null;
  detailLines: string[];
  status: StackSafetyComparisonStatus | null;
};

export type StackSafetyMeta = {
  processedSupplements: number;
  skippedSupplements: number;
  surfacedGroupCount: number;
  hiddenGroupCount: number;
  supportedLifeStage: "adult_19_plus";
  dailyDoseBasisCounts?: {
    labelDailyEstimate: number;
    oneServingFallback: number;
  };
  dailyDoseBasisReasonCounts?: Partial<
    Record<
      | "parsed_label_directions"
      | "missing_directions"
      | "ambiguous_frequency"
      | "snapshot_only_no_directions"
      | "insufficient_active_dose",
      number
    >
  >;
  estimateBasisSummary?: string | null;
  hiddenGroupNote?: string | null;
  skippedSupplementNote?: string | null;
  truncated?: boolean;
  overlapCount?: number;
  hiddenOverlapCount?: number;
};
