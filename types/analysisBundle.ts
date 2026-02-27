export type BasisTag =
  | 'label_fact'
  | 'regulatory_claim'
  | 'ingredient_inference'
  | 'web_evidence'
  | 'general_advice'
  | 'not_provided'
  | 'conflict';

export type Bullet = { text: string; basisTags: BasisTag[] };

export type UsageField = { text: string; basisTags: BasisTag[] };

export type WithFoodField = { value: boolean | null; text: string | null; basisTags: BasisTag[] };

export type OverviewCover = { summary: string; bullets: Bullet[] };
export type OverviewDetail = { summary: string; bullets: Bullet[] };

export type IngredientsCoverItem = { name: string; dose: string | null; basisTags: BasisTag[] };
export type IngredientsCover = { items: IngredientsCoverItem[]; totalCount?: number | null };

// V3 detail item
export type IngredientsDetailItemV3 = {
  name: string;
  whatItDoes: string;
  doseContext: string;
  formExplain: string;
  basisTags: BasisTag[];
};

export type IngredientsDetailV3 = {
  items: IngredientsDetailItemV3[];
  overallSummary: UsageField | null;
  overlapNotes: UsageField | null;
};

// V4 detail item
export type IngredientsDetailItemV4 = {
  name: string;
  whatItDoes: UsageField;
  doseContext: UsageField;
  chemicalFormExplain: UsageField;
  deliveryFormExplain: UsageField | null;
};

export type IngredientsDetailV4 = {
  items: IngredientsDetailItemV4[];
  overallSummary: UsageField | null;
  overlapNotes: UsageField | null;
};

export type UsageCover = {
  bullets: Bullet[];
  bestTimeToTake: UsageField | null;
  withFood: WithFoodField | null;
  dosage?: UsageField | null;
};

export type UsageLabelDose = {
  population: string | null;
  age: string | null;
  dose: string | null;
  frequency: string | null;
  rawText: string | null;
  basisTags: BasisTag[];
};

export type UsageDetail = {
  timingRationale: UsageField | null;
  withFoodRationale: UsageField | null;
  scheduleFromLabel: UsageLabelDose[];
};

export type SafetyCover = { verdict: string; bullets: Bullet[] };
export type SafetyItem = Bullet;

export type SafetyDetail = {
  warnings: SafetyItem[];
  consultDoctorIf: SafetyItem[];
  redFlags: SafetyItem[];
};

export type SafetySignalScope = 'label_specific' | 'ods_general';
export type SafetySignalSource =
  | 'label_record'
  | 'score_v4_ul'
  | 'ods_watchout'
  | 'ods_interaction'
  | 'quality_note'
  | 'unknown';

export type SafetySignalItem = {
  id: string;
  text: string;
  scope: SafetySignalScope;
  source: SafetySignalSource;
  reasonCode?: string;
  sourceUrl?: string;
  riskLevel?: string;
};

export type SafetyUlAmount = {
  value: number | null;
  unit: string | null;
  text: string | null;
};

export type SafetyUlScope =
  | 'total_intake'
  | 'supplements_only'
  | 'supplements_or_fortified_only'
  | 'unknown';

export type SafetyUlRiskBand = 'low' | 'moderate' | 'high' | 'unknown';
export type SafetyUlEvidenceSource = 'NIH_ODS_UL' | 'LEGACY_UL_META' | 'UNKNOWN';

export type SafetyUlEntry = {
  id: string;
  nutrientKey: string;
  displayName: string;
  currentDailyAmount: SafetyUlAmount;
  ulDailyAmount: SafetyUlAmount;
  riskBand: SafetyUlRiskBand;
  scope: SafetyUlScope;
  evidenceSource: SafetyUlEvidenceSource;
  explainLine: string;
  reasonCode?: string;
  sourceUrl?: string;
};

export type SafetySignalPack = {
  schemaVersion: 1;
  labelWarnings: SafetySignalItem[];
  ulEntries?: SafetyUlEntry[] | null;
  ulSignals: SafetySignalItem[];
  odsInteractions: SafetySignalItem[];
  odsWatchouts: SafetySignalItem[];
  qualityNotes: SafetySignalItem[];
};

export type DataStatus = 'complete' | 'pending' | 'limited' | 'not_provided' | 'error';

export type DeterministicSignalsMeta = {
  schemaVersion: 1;
  ingredientCount: number;
  doseCount: number;
  usageStructuredCount: number;
  safetySignalCount: number;
  parserDiagnosticsTop: string[];
};

export type AnalysisBundleMetaV3 = {
  schemaVersion: 3;
  promptVersion: string;
  sourceType: 'lnhpd' | 'dsld' | 'web';
  sourceTypeFinal?: boolean;
  scoreAvailable?: boolean;
  scoreReasonCode?: string;
  deterministicSignals?: DeterministicSignalsMeta | null;
  authoritativeIdentity: { type: 'npn' | 'dsldLabelId' | 'webCanonicalId' | 'gtin14'; value: string };
  productIdentity?: {
    name?: string | null;
    brand?: string | null;
    sourceAttribution?: 'verified_regulatory' | 'label_record' | 'web_hint_unverified' | 'unknown';
    identityStable?: boolean;
    sourceId?: string | null;
  };
  locale: 'zh' | 'en';
  phase: 'skeleton' | 'fast_ai' | 'full_ai';
  bundleId: string;
  revision: number;
  factsDigestHash: string;
  factsSourceVersion: string;
  detailReady?: boolean;
  fallbackReason?: string;
  stage0Winner?: 'verified_regulatory' | 'label_record' | 'web_hint_unverified' | 'unknown';
  stage0StartCount?: number;
  stage0ReplaceCount?: number;
  terminalReason?: string;
  degradedMode?: boolean;
  eventLoopLagP95DuringRequest?: number;
  webBytesReadTotal?: number;
  webParseMsTotal?: number;
  serverCommitSha?: string | null;
};

export type AnalysisBundleMetaV4 = Omit<AnalysisBundleMetaV3, 'schemaVersion'> & { schemaVersion: 4 };

export type AnalysisBundleV3 = {
  meta: AnalysisBundleMetaV3;
  sections: {
    overview: { layout: 'overview_card'; cover: OverviewCover | null; detail: OverviewDetail | null; dataStatus: DataStatus };
    ingredients: { layout: 'ingredients_list'; cover: IngredientsCover | null; detail: IngredientsDetailV3 | null; dataStatus: DataStatus };
    usage: { layout: 'usage_bullets'; cover: UsageCover | null; detail: UsageDetail | null; dataStatus: DataStatus };
    safety: {
      layout: 'safety_bullets';
      cover: SafetyCover | null;
      detail: SafetyDetail | null;
      signals?: SafetySignalPack | null;
      dataStatus: DataStatus;
    };
  };
};

export type AnalysisBundleV4 = {
  meta: AnalysisBundleMetaV4;
  sections: {
    overview: { layout: 'overview_card'; cover: OverviewCover | null; detail: OverviewDetail | null; dataStatus: DataStatus };
    ingredients: { layout: 'ingredients_list'; cover: IngredientsCover | null; detail: IngredientsDetailV4 | null; dataStatus: DataStatus };
    usage: { layout: 'usage_bullets'; cover: UsageCover | null; detail: UsageDetail | null; dataStatus: DataStatus };
    safety: {
      layout: 'safety_bullets';
      cover: SafetyCover | null;
      detail: SafetyDetail | null;
      signals?: SafetySignalPack | null;
      dataStatus: DataStatus;
    };
  };
};

export type AnalysisBundle = AnalysisBundleV3 | AnalysisBundleV4;
export type IngredientsDetail = IngredientsDetailV3 | IngredientsDetailV4;
