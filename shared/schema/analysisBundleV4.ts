import { z } from "zod";

export const ANALYSIS_BUNDLE_SCHEMA_VERSION = 4 as const;

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
  whatItDoes: UsageFieldSchema,
  doseContext: UsageFieldSchema,
  chemicalFormExplain: UsageFieldSchema,
  deliveryFormExplain: UsageFieldSchema.nullable(),
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

export const SafetySignalScopeSchema = z.enum(["label_specific", "ods_general"]);
export type SafetySignalScope = z.infer<typeof SafetySignalScopeSchema>;

export const SafetySignalSourceSchema = z.enum([
  "label_record",
  "score_v4_ul",
  "ods_watchout",
  "ods_interaction",
  "quality_note",
  "unknown",
]);
export type SafetySignalSource = z.infer<typeof SafetySignalSourceSchema>;

export const SafetySignalItemSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  scope: SafetySignalScopeSchema,
  source: SafetySignalSourceSchema,
  reasonCode: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url().optional(),
  riskLevel: z.string().trim().min(1).optional(),
});
export type SafetySignalItem = z.infer<typeof SafetySignalItemSchema>;

export const SafetyUlAmountSchema = z.object({
  value: z.number().nullable(),
  unit: z.string().trim().min(1).nullable(),
  text: z.string().trim().min(1).nullable(),
});
export type SafetyUlAmount = z.infer<typeof SafetyUlAmountSchema>;

export const SafetyUlScopeSchema = z.enum([
  "total_intake",
  "supplements_only",
  "supplements_or_fortified_only",
  "unknown",
]);
export type SafetyUlScope = z.infer<typeof SafetyUlScopeSchema>;

export const SafetyUlRiskBandSchema = z.enum(["low", "moderate", "high", "unknown"]);
export type SafetyUlRiskBand = z.infer<typeof SafetyUlRiskBandSchema>;

export const SafetyUlEvidenceSourceSchema = z.enum(["NIH_ODS_UL", "LEGACY_UL_META", "UNKNOWN"]);
export type SafetyUlEvidenceSource = z.infer<typeof SafetyUlEvidenceSourceSchema>;

export const SafetyUlEntrySchema = z.object({
  id: z.string().trim().min(1),
  nutrientKey: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  currentDailyAmount: SafetyUlAmountSchema,
  ulDailyAmount: SafetyUlAmountSchema,
  riskBand: SafetyUlRiskBandSchema,
  scope: SafetyUlScopeSchema,
  evidenceSource: SafetyUlEvidenceSourceSchema,
  explainLine: z.string().trim().min(1),
  reasonCode: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url().optional(),
});
export type SafetyUlEntry = z.infer<typeof SafetyUlEntrySchema>;

export const SafetySignalPackSchema = z.object({
  schemaVersion: z.literal(1),
  labelWarnings: z.array(SafetySignalItemSchema),
  ulEntries: z.array(SafetyUlEntrySchema).nullable().optional(),
  ulSignals: z.array(SafetySignalItemSchema),
  odsInteractions: z.array(SafetySignalItemSchema),
  odsWatchouts: z.array(SafetySignalItemSchema),
  qualityNotes: z.array(SafetySignalItemSchema),
});
export type SafetySignalPack = z.infer<typeof SafetySignalPackSchema>;

export const DataStatusSchema = z.enum(["complete", "pending", "limited", "not_provided", "error"]);
export type DataStatus = z.infer<typeof DataStatusSchema>;

export const FallbackCodeSchema = z
  .enum([
    "facts_digest_missing",
    "bundle_fast_missing",
    "detail_not_ready_until_revision1",
    "enrichment_queued",
    "deepseek_api_key_missing",
    "job_pending",
    "rate_limited",
    "cache_claim_failed",
    "watchdog_fast_timeout",
    "watchdog_global_timeout",
    "fast_generation_failed",
    "LLM_DETAIL_FAILED",
    "verify_budget_exhausted",
    "verify_failed",
    "revise_failed",
    "verify_claim_without_support",
    "web_text_unusable",
  ])
  .or(z.string().regex(/^[A-Za-z0-9_]+$/));
export type FallbackCode = z.infer<typeof FallbackCodeSchema>;

export const FallbackMetaSchema = z.object({
  code: FallbackCodeSchema,
  detail: z.string().optional(),
});
export type FallbackMeta = z.infer<typeof FallbackMetaSchema>;

export const WebPipelineStepSchema = z.object({
  step: z.enum([
    "retrieve",
    "sanitize",
    "select_evidence",
    "draft",
    "verify",
    "revise",
    "emit",
  ]),
  status: z.enum(["ok", "degraded", "failed"]),
  code: z.string().optional(),
});
export type WebPipelineStep = z.infer<typeof WebPipelineStepSchema>;

export const WebVerifyMetaSchema = z.object({
  verifyStatus: z.enum(["ok", "degraded", "failed"]),
  reviseStatus: z.enum(["ok", "degraded", "failed"]).optional(),
  revisedClaimsCount: z.number().int().min(0),
  droppedClaimsCount: z.number().int().min(0),
  // Deterministic: counts claims dropped due to prompt-injection-like intent+object patterns.
  injectionClaimDroppedCount: z.number().int().min(0).optional(),
  // Optional to avoid introducing non-deterministic fields into public bundles.
  // Populated only for regression-token requests.
  budgetUsedMs: z.number().int().min(0).optional(),
  // Deterministic claim-level accounting (preferred for metrics over revised/dropped).
  checkedClaimsCount: z.number().int().min(0).optional(),
  supportedClaimsCount: z.number().int().min(0).optional(),
  unsupportedClaimsCount: z.number().int().min(0).optional(),
  abstainedClaimsCount: z.number().int().min(0).optional(),
  fallbackCode: FallbackCodeSchema.optional(),
});
export type WebVerifyMeta = z.infer<typeof WebVerifyMetaSchema>;

export const PipelineMetricStepSchema = z.object({
  step: z.enum([
    "retrieve",
    "sanitize",
    "select_evidence",
    "draft",
    "verify",
    "revise",
    "emit",
  ]),
  status: z.enum(["ok", "degraded", "failed"]),
  code: z.string().optional(),
  ms: z.number().int().min(0).optional(),
});
export type PipelineMetricStep = z.infer<typeof PipelineMetricStepSchema>;

export const PipelineMetricsEventSchema = z.object({
  pipelineMetricsSchemaVersion: z.number().int().min(1).optional(),
  requestId: z.string().nullable(),
  barcode: z.string(),
  sourceType: z.enum(["lnhpd", "dsld", "web"]),
  steps: z.array(PipelineMetricStepSchema),
  totalMs: z.number().int().min(0),
  emittedAt: z.string(),
});
export type PipelineMetricsEvent = z.infer<typeof PipelineMetricsEventSchema>;

export const DeterministicSignalsMetaSchema = z.object({
  schemaVersion: z.literal(1),
  ingredientCount: z.number().int().min(0),
  doseCount: z.number().int().min(0),
  usageStructuredCount: z.number().int().min(0),
  safetySignalCount: z.number().int().min(0),
  parserDiagnosticsTop: z.array(z.string().trim().min(1)).max(12),
});
export type DeterministicSignalsMeta = z.infer<typeof DeterministicSignalsMetaSchema>;

export const AnalysisBundleMetaSchema = z.object({
  schemaVersion: z.literal(ANALYSIS_BUNDLE_SCHEMA_VERSION),
  promptVersion: z.string(),
  sourceType: z.enum(["lnhpd", "dsld", "web"]),
  sourceTypeFinal: z.boolean().optional(),
  scoreAvailable: z.boolean().optional(),
  scoreReasonCode: z.string().optional(),
  inferenceOnly: z.boolean().optional(),
  detailReady: z.boolean().optional(),
  deterministicSignals: DeterministicSignalsMetaSchema.nullable().optional(),
  authoritativeIdentity: z.object({
    type: z.enum(["npn", "dsldLabelId", "webCanonicalId", "gtin14"]),
    value: z.string(),
  }),
  productIdentity: z.object({
    name: z.string().nullable().optional(),
    brand: z.string().nullable().optional(),
    sourceAttribution: z
      .enum(["verified_regulatory", "label_record", "web_hint_unverified", "unknown"])
      .optional(),
    identityStable: z.boolean().optional(),
    sourceId: z.string().nullable().optional(),
  }).optional(),
  regulatoryIds: z.object({
    npnCandidates: z.array(
      z.object({
        value: z.string().regex(/^\d+$/),
        sourceKind: z.enum([
          "lnhpd_record",
          "label_record",
          "db_barcode_regulatory_map_npn",
          "snapshot_regulatory",
          "scan_history",
          "name_match",
          "web_extract",
        ]),
        confidence: z.number().min(0).max(1),
        stableReason: z.enum(["verified_record", "stable_db", "unverified"]),
      }),
    ).max(3),
  }).optional(),
  candidateBackfill: z.object({
    attempted: z.boolean(),
    used: z.boolean(),
    source: z
      .enum([
        "lnhpd_record",
        "label_record",
        "db_barcode_regulatory_map_npn",
        "snapshot_regulatory",
        "scan_history",
        "name_match",
        "web_extract",
      ])
      .nullable()
      .optional(),
    reasonCode: z.string().optional(),
    latencyMs: z.number().int().min(0).optional(),
    scoreSuppressed: z.boolean().optional(),
  }).optional(),
  locale: z.enum(["zh", "en"]),
  phase: z.enum(["skeleton", "fast_ai", "full_ai"]),
  bundleId: z.string(),
  revision: z.number().int().min(0),
  factsDigestHash: z.string(),
  factsSourceVersion: z.string(),
  // Versioned meta schema so step/code naming can evolve without breaking scorecards.
  webPipelineSchemaVersion: z.number().int().min(1).optional(),
  webPipeline: z.array(WebPipelineStepSchema).optional(),
  webVerifyMeta: WebVerifyMetaSchema.optional(),
  fallback: FallbackMetaSchema.optional(),
  fallbackReason: z.string().optional(),
  stage0Winner: z
    .enum(["verified_regulatory", "label_record", "web_hint_unverified", "unknown"])
    .optional(),
  stage0StartCount: z.number().int().min(0).optional(),
  stage0ReplaceCount: z.number().int().min(0).optional(),
  terminalReason: z.string().optional(),
  degradedMode: z.boolean().optional(),
  eventLoopLagP95DuringRequest: z.number().min(0).optional(),
  webBytesReadTotal: z.number().int().min(0).optional(),
  webParseMsTotal: z.number().min(0).optional(),
  serverCommitSha: z.string().nullable().optional(),
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
  signals: SafetySignalPackSchema.nullable().optional(),
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
