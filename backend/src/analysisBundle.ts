import { z } from "zod";

export const ANALYSIS_BUNDLE_SCHEMA_VERSION = 3 as const;

export const BasisTagSchema = z.enum([
  "label_fact",
  "regulatory_claim",
  "ingredient_inference",
  "web_evidence",
  "general_advice",
  "not_provided",
  "conflict",
]);

export type BasisTag = z.infer<typeof BasisTagSchema>;

export const BulletSchema = z.object({
  text: z.string(),
  basisTags: z.array(BasisTagSchema),
});

export type Bullet = z.infer<typeof BulletSchema>;

export const UsageFieldSchema = z.object({
  text: z.string(),
  basisTags: z.array(BasisTagSchema),
});

export type UsageField = z.infer<typeof UsageFieldSchema>;

export const WithFoodFieldSchema = z.object({
  value: z.boolean().nullable(),
  text: z.string().nullable(),
  basisTags: z.array(BasisTagSchema),
});

export type WithFoodField = z.infer<typeof WithFoodFieldSchema>;

export const OverviewCoverSchema = z.object({
  summary: z.string(),
  bullets: z.array(BulletSchema),
});

export type OverviewCover = z.infer<typeof OverviewCoverSchema>;

export const OverviewDetailSchema = z.object({
  summary: z.string(),
  bullets: z.array(BulletSchema),
});

export type OverviewDetail = z.infer<typeof OverviewDetailSchema>;

export const IngredientsCoverItemSchema = z.object({
  name: z.string(),
  dose: z.string().nullable(),
  basisTags: z.array(BasisTagSchema),
});

export type IngredientsCoverItem = z.infer<typeof IngredientsCoverItemSchema>;

export const IngredientsCoverSchema = z.object({
  items: z.array(IngredientsCoverItemSchema),
  totalCount: z.number().int().min(0).nullable().optional(),
});

export type IngredientsCover = z.infer<typeof IngredientsCoverSchema>;

export const IngredientsDetailItemSchema = z.object({
  name: z.string(),
  whatItDoes: z.string(),
  doseContext: z.string(),
  formExplain: z.string(),
  basisTags: z.array(BasisTagSchema),
});

export type IngredientsDetailItem = z.infer<typeof IngredientsDetailItemSchema>;

export const IngredientsDetailSchema = z.object({
  items: z.array(IngredientsDetailItemSchema),
  overallSummary: UsageFieldSchema.nullable(),
  overlapNotes: UsageFieldSchema.nullable(),
});

export type IngredientsDetail = z.infer<typeof IngredientsDetailSchema>;

export const UsageCoverSchema = z.object({
  bullets: z.array(BulletSchema),
  bestTimeToTake: UsageFieldSchema.nullable(),
  withFood: WithFoodFieldSchema.nullable(),
  dosage: UsageFieldSchema.nullable().optional(),
});

export type UsageCover = z.infer<typeof UsageCoverSchema>;

export const UsageLabelDoseSchema = z.object({
  population: z.string().nullable(),
  age: z.string().nullable(),
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  rawText: z.string().nullable(),
  basisTags: z.array(BasisTagSchema),
});

export type UsageLabelDose = z.infer<typeof UsageLabelDoseSchema>;

export const UsageDetailSchema = z.object({
  timingRationale: UsageFieldSchema.nullable(),
  withFoodRationale: UsageFieldSchema.nullable(),
  scheduleFromLabel: z.array(UsageLabelDoseSchema),
});

export type UsageDetail = z.infer<typeof UsageDetailSchema>;

export const SafetyCoverSchema = z.object({
  verdict: z.string(),
  bullets: z.array(BulletSchema),
});

export type SafetyCover = z.infer<typeof SafetyCoverSchema>;

export const SafetyItemSchema = BulletSchema;
export type SafetyItem = z.infer<typeof SafetyItemSchema>;

export const SafetyDetailSchema = z.object({
  warnings: z.array(SafetyItemSchema),
  consultDoctorIf: z.array(SafetyItemSchema),
  redFlags: z.array(SafetyItemSchema),
});

export type SafetyDetail = z.infer<typeof SafetyDetailSchema>;

export const DataStatusSchema = z.enum(["complete", "pending", "limited", "not_provided", "error"]);
export type DataStatus = z.infer<typeof DataStatusSchema>;

export const AnalysisBundleMetaSchema = z.object({
  schemaVersion: z.literal(ANALYSIS_BUNDLE_SCHEMA_VERSION),
  promptVersion: z.string(),
  sourceType: z.enum(["lnhpd", "dsld", "web"]),
  authoritativeIdentity: z.object({
    type: z.enum(["npn", "dsldLabelId", "webCanonicalId", "gtin14"]),
    value: z.string(),
  }),
  locale: z.enum(["zh", "en"]),
  phase: z.enum(["skeleton", "fast_ai", "full_ai"]),
  bundleId: z.string(),
  revision: z.number().int().min(0),
  factsDigestHash: z.string(),
  factsSourceVersion: z.string(),
});

export type AnalysisBundleMeta = z.infer<typeof AnalysisBundleMetaSchema>;

export const OverviewSectionSchema = z.object({
  layout: z.literal("overview_card"),
  cover: OverviewCoverSchema.nullable(),
  detail: OverviewDetailSchema.nullable(),
  dataStatus: DataStatusSchema,
});

export const IngredientsSectionSchema = z.object({
  layout: z.literal("ingredients_list"),
  cover: IngredientsCoverSchema.nullable(),
  detail: IngredientsDetailSchema.nullable(),
  dataStatus: DataStatusSchema,
});

export const UsageSectionSchema = z.object({
  layout: z.literal("usage_bullets"),
  cover: UsageCoverSchema.nullable(),
  detail: UsageDetailSchema.nullable(),
  dataStatus: DataStatusSchema,
});

export const SafetySectionSchema = z.object({
  layout: z.literal("safety_bullets"),
  cover: SafetyCoverSchema.nullable(),
  detail: SafetyDetailSchema.nullable(),
  dataStatus: DataStatusSchema,
});

export const AnalysisBundleSchema = z.object({
  meta: AnalysisBundleMetaSchema,
  sections: z.object({
    overview: OverviewSectionSchema,
    ingredients: IngredientsSectionSchema,
    usage: UsageSectionSchema,
    safety: SafetySectionSchema,
  }),
});

export type AnalysisBundle = z.infer<typeof AnalysisBundleSchema>;

export const safeParseAnalysisBundle = (candidate: unknown) => AnalysisBundleSchema.safeParse(candidate);
