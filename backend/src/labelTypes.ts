export interface ParsedIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
  dvPercent: number | null;
  confidence: number;
  rawLine: string;
}

export interface ValidationIssue {
  type:
    | 'unit_invalid'
    | 'value_anomaly'
    | 'missing_serving_size'
    | 'header_not_found'
    | 'low_coverage'
    | 'incomplete_ingredients'
    | 'possible_missing_column'
    | 'non_ingredient_line_detected'
    | 'unit_boundary_suspect'
    | 'dose_inconsistency_or_claim';
  message: string;
}

export interface LabelDraft {
  servingSize: string | null;
  ingredients: ParsedIngredient[];
  parseCoverage: number;
  confidenceScore: number;
  issues: ValidationIssue[];
}
