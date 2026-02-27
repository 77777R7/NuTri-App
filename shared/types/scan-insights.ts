export type FactSource = 'lnhpd' | 'dsld' | 'web';

export type Identity =
  | { kind: 'npn'; value: string }
  | { kind: 'dsld_label_id'; value: string }
  | { kind: 'gtin14'; value: string }
  | { kind: 'web_canonical_id'; value: string };

export type RouteType = 'oral' | 'topical' | 'other' | 'unknown';

export type MissingReason =
  | 'missing_directions'
  | 'missing_warnings'
  | 'missing_amounts'
  | 'missing_units'
  | 'missing_form'
  | 'multiple_label_entries'
  | 'source_low_quality'
  | 'partial_record';

export interface FactSourceRef {
  kind: 'reg' | 'label' | 'web';
  title?: string | null;
  url?: string | null;
  domain?: string | null;
  quality?: 'high' | 'medium' | 'low' | null;
}

export interface FactProvenance {
  source: FactSource;
  extractedAt?: string | null;
  datasetVersion?: string | null;
  sourceFiles?: { pdf?: string | null; thumbnail?: string | null } | null;
}

export interface ActiveIngredientFact {
  name: string;
  nameRaw?: string | null;
  amount?: number | null;
  unit?: string | null;
  per?: 'serving' | 'dose' | 'unknown';
  formText?: string | null;
  formTextSource?: 'ingredient_name' | 'source_material' | 'none';
  notes?: string[];
}

export interface UsageFact {
  route: RouteType;
  dosageForm?: string | null;
  servingSizeText?: string | null;
  servingsPerContainer?: number | null;
  directionsText?: string | null;
  timesPerDay?: number | null;
  population?: 'adults' | 'adolescents' | 'children' | 'general' | 'unknown' | null;
  dose?: {
    population?: 'adults' | 'adolescents' | 'children' | 'unknown';
    quantity?: number | null;
    quantityUnit?: string | null;
    frequencyMin?: number | null;
    frequencyMax?: number | null;
    frequencyUnit?: string | null;
  } | null;
}

export interface SafetyFact {
  labelWarnings?: string[];
}

export interface FactsDTO {
  meta: {
    source: FactSource;
    sourceId: string;
    fetchedAt: string;
  };
  identity: Identity;
  product: {
    name: string | null;
    brand?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  };
  serving: {
    servingSizeText?: string | null;
    servingsPerContainer?: number | null;
  };
  ingredients: {
    actives: ActiveIngredientFact[];
    inactives?: string[];
    proprietaryBlends?: { name: string; items?: string[] }[];
  };
  usage: UsageFact;
  safety: SafetyFact;
  provenance: FactProvenance;
  sources: FactSourceRef[];
  dataQuality: {
    overallStatus: 'complete' | 'limited' | 'not_provided';
    isComplete?: boolean | null;
    missingFields?: string[];
    missingReasons?: MissingReason[];
    notes?: string[];
  };
}

export type LayerTag = 'Facts' | 'Dataset' | 'ReviewedKB' | 'ODS';

export interface IngredientSummaryLLMOutput {
  tldr: string;
  highlights: string[];
  caveats: string[];
  confidence_note: string;
  sources_used: {
    facts: boolean;
    dataset: boolean;
    reviewedKB: boolean;
    ods: boolean;
  };
  fallbackUsed: boolean;
}

export interface IngredientInsight {
  name: string;
  ingredientId?: string | null;
  form: {
    text: string | null;
    source: 'facts' | 'inferred' | 'none';
    matchScore?: number | null;
    evidenceGrade?: string | null;
  };
  rbf: {
    factor: number | null;
    band: 'high' | 'normal' | 'low' | 'unknown';
  };
  dose: {
    dailyAmount?: number | null;
    unit?: string | null;
    rangeMin?: number | null;
    rangeMax?: number | null;
    status: 'below_typical' | 'within_typical' | 'above_typical' | 'unknown';
  };
  whyBullets: string[];
  layerTags: LayerTag[];
  confidenceNote: string;
}

export interface InsightsDTO {
  meta: {
    datasetVersion: string | null;
  };
  keyIngredients: {
    selected: { ingredientName: string; ingredientId?: string | null }[];
    selectionReason: string;
  };
  keyIngredientsInsights: IngredientInsight[];
  assumptions: {
    dailyMultiplierSource: 'label' | 'heuristic' | 'unknown';
    dailyMultiplierReliability: 'reliable' | 'partial' | 'unknown';
    notes: string[];
  };
  summary: IngredientSummaryLLMOutput | null;
}
