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

export type IngredientsDetailItem = {
  name: string;
  whatItDoes: string;
  doseContext: string;
  formExplain: string;
  basisTags: BasisTag[];
};

export type IngredientsDetail = {
  items: IngredientsDetailItem[];
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

export type DataStatus = 'complete' | 'pending' | 'limited' | 'not_provided' | 'error';

export type AnalysisBundleMeta = {
  schemaVersion: 3;
  promptVersion: string;
  sourceType: 'lnhpd' | 'dsld' | 'web';
  authoritativeIdentity: { type: 'npn' | 'dsldLabelId' | 'webCanonicalId' | 'gtin14'; value: string };
  locale: 'zh' | 'en';
  phase: 'skeleton' | 'fast_ai' | 'full_ai';
  bundleId: string;
  revision: number;
  factsDigestHash: string;
  factsSourceVersion: string;
  serverCommitSha?: string | null;
};

export type AnalysisBundle = {
  meta: AnalysisBundleMeta;
  sections: {
    overview: { layout: 'overview_card'; cover: OverviewCover | null; detail: OverviewDetail | null; dataStatus: DataStatus };
    ingredients: { layout: 'ingredients_list'; cover: IngredientsCover | null; detail: IngredientsDetail | null; dataStatus: DataStatus };
    usage: { layout: 'usage_bullets'; cover: UsageCover | null; detail: UsageDetail | null; dataStatus: DataStatus };
    safety: { layout: 'safety_bullets'; cover: SafetyCover | null; detail: SafetyDetail | null; dataStatus: DataStatus };
  };
};
