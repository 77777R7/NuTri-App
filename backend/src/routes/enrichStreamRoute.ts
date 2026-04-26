import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";

type AnalysisBundle = any;
type AuthorityFailureReason =
  | "negative_cache_blocked"
  | "lnhpd_timeout_first"
  | "lnhpd_timeout_second"
  | "lnhpd_not_found"
  | "guardrail_failed"
  | "lnhpd_query_error";
type AuthorityMapStatus = any;
type BrandExtractionResult = any;
type CatalogResolved = any;
type DecisionSupportOverlayClaims = any;
type DeepseekResilienceOptions = any;
type DsldFacts = any;
type EnrichStreamAdmissionGate = any;
type EnrichStreamAdmissionLane = "full" | "bundle_only";
type FactsDigest = any;
type FactsIdentityType = any;
type LabelExtractionMeta = any;
type LabelFacts = any;
type LnhpdFacts = any;
type LnhpdForcedFailureMode = "timeout" | "not_found";
type LnhpdLookupStatus = any;
type NpnCandidate = any;
type NpnCandidateSourceKind = any;
type SearchItem = any;
type SearchResilienceOptions = any;
type SecondarySeedMatch = any;
type SnapshotAnalysisPayload = any;
type SupplementSnapshot = any;
type AuthenticatedRequest = Request & { regressionAuth?: boolean; user?: { id?: string } | null };

type ParseRequestBody = <T>(schema: z.ZodType<T>, req: Request, res: Response) => T | null;

export type EnrichStreamRouteDependencies = Record<string, any> & {
  verifySupabaseToken: RequestHandler;
  parseRequestBody: ParseRequestBody;
};

const enrichStreamBodySchema = z
  .object({
    barcode: z.string().min(1),
    deviceId: z.string().optional(),
  })
  .passthrough();

export const registerEnrichStreamRoute = (
  app: Express,
  deps: EnrichStreamRouteDependencies,
): void => {
  const {
    AMAZON_DOMAINS,
    ANALYSIS_BUNDLE_FAST_TIMEOUT_MS,
    ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
    ANALYSIS_DETAIL_LIMIT_DSLD,
    ANALYSIS_IDENTITY_CACHE_TTL_MS,
    AUTHORITATIVE_CA_DOMAINS,
    AUTHORITY_REGRESSION_SAMPLE_BARCODE,
    AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN,
    BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0,
    BUNDLE_ONLY_SKIP_WEB_SEARCH,
    BulkheadTimeoutError,
    CANDIDATE_SCORE_SUPPRESS_REASON_CODE,
    CA_NAME_HINT_BRANDLESS_RETRY,
    DETERMINISTIC_SIGNALS_PRIMARY,
    DeadlineBudget,
    ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
    ENRICH_STREAM_BUNDLE_ONLY_DONE_DELAY_MS,
    ENRICH_STREAM_BUNDLE_ONLY_TERMINAL_GUARD_MS,
    ENRICH_STREAM_CLIENT_DISCONNECT_GRACE_MS,
    ENRICH_STREAM_CRASH_CANARY_PRE_REV1_TERMINAL_GUARD_MS,
    ENRICH_STREAM_FULL_PRESSURE_CORE_FALLBACK_GUARD_MS,
    ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS,
    ENRICH_STREAM_HARD_TERMINAL_FALLBACK_MS,
    ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD,
    ENRICH_STREAM_OVERLOAD_RETRY_AFTER_MS,
    ENRICH_STREAM_QUEUE_WAIT_MS,
    ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY,
    ENRICH_STREAM_REV0_FALLBACK_DELAY_MS,
    ENRICH_STREAM_REV0_FALLBACK_DELAY_MS_BUNDLE_ONLY,
    ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS,
    ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS,
    EVENT_LOOP_LAG_P95_THRESHOLD_MS,
    EVENT_LOOP_LAG_SAMPLE_MS,
    EnrichStreamAdmissionError,
    GENERIC_BRAND_HINT_REGEX,
    GUARDRAIL_SIMILARITY_THRESHOLD,
    LNHPD_RUNTIME_ENABLED,
    MAX_RESULTS,
    NEGATIVE_TTL_MARKETPLACE_ONLY_MS,
    NEGATIVE_TTL_NEEDS_JS_MS,
    NEGATIVE_TTL_NO_SERP_MS,
    NEGATIVE_TTL_NO_TEXT_FACTS_MS,
    NEGATIVE_TTL_NO_VALID_URL_MS,
    NEGATIVE_TTL_ONLY_IMAGES_MS,
    NEGATIVE_TTL_TIMEOUT_MS,
    NPN_CANDIDATE_BACKFILL_MIN_BUDGET_MS,
    NPN_CANDIDATE_CATALOG_META_SECOND_CHANCE_TIMEOUT_MS,
    NPN_CANDIDATE_CATALOG_META_WAIT_MS,
    NPN_CANDIDATE_DIRECT_LOOKUP_TIMEOUT_MS,
    NPN_CANDIDATE_MAX,
    NPN_NEGATIVE_CACHE_THRESHOLD,
    NPN_NEGATIVE_CACHE_TTL_MS,
    NPN_NEGATIVE_CACHE_WINDOW_HOURS,
    REGULATORY_MAP_CONFLICT_TTL_MS,
    REGULATORY_MAP_MIN_CONFIDENCE,
    REGULATORY_MAP_NOT_FOUND_TTL_MS,
    REGULATORY_MAP_STALE_WINDOW_MS,
    REGULATORY_MAP_TTL_MS_LNHPD,
    REGULATORY_MAP_TTL_MS_WEB,
    REG_MAP_SECOND_CHANCE_TIMEOUT_MS,
    RESILIENCE_CATALOG_TIMEOUT_MS,
    RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
    RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS,
    RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
    RESILIENCE_DEEPSEEK_TIMEOUT_MS,
    RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
    RESILIENCE_GOOGLE_TIMEOUT_MS,
    RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS,
    RESILIENCE_LNHPD_TIMEOUT_MS,
    RESILIENCE_SNAPSHOT_TIMEOUT_MS,
    RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS,
    RESILIENCE_TOTAL_BUDGET_MS,
    RESOLUTION_CHEAP_PASS_MAX_BYTES,
    RESOLUTION_CHEAP_PASS_MAX_URLS,
    RESOLUTION_CHEAP_PASS_TIMEOUT_MS,
    RESOLUTION_ENGINE_VERSION,
    RESOLUTION_FACTS_MIN_COVERAGE,
    RESOLUTION_RESOLUTION_CACHE_TTL_MS,
    RESOLUTION_SEARCH_CALLS_MAX,
    RESOLUTION_SEARCH_STAGE_MAX_MS,
    RESOLUTION_SERP_CACHE_TTL_MS,
    RESOLUTION_STAGE1_RESERVE_MS,
    RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN,
    SECONDARY_ALLOW_MARKETPLACE,
    SECONDARY_CHEAP_PASS_MAX_BYTES,
    SECONDARY_CHEAP_PASS_MAX_URLS,
    SECONDARY_CHEAP_PASS_TIMEOUT_MS,
    SECONDARY_DEEP_FETCH_MAX_PAGES,
    SECONDARY_DEEP_FETCH_TIMEOUT_MS,
    SECONDARY_DOMAIN_LADDER_SITES,
    SECONDARY_LLM_BUDGET_MS,
    SECONDARY_LLM_TIMEOUT_MS,
    SECONDARY_MARKETPLACE_EXCLUDE_DOMAINS,
    SECONDARY_NEEDS_JS_OVERRIDE_MIN,
    SECONDARY_QUERY_EXCLUDE_DOMAINS,
    SECONDARY_QUERY_INCLUDE_ACTIVES_AS_SHOULD,
    SECONDARY_QUERY_MAX_CHARS,
    SECONDARY_QUERY_MAX_VARIANTS_PER_GROUP,
    SECONDARY_SEARCH_ENABLE,
    SECONDARY_SEARCH_GOOGLE_TIMEOUT_MS,
    SECONDARY_SEARCH_TOTAL_BUDGET_MS,
    SECONDARY_SEED_MATCH_MIN,
    SECONDARY_SEED_VERIFIED_MIN,
    SERVER_COMMIT_SHA,
    SSE_FAST_GRACE_MS,
    SSE_GLOBAL_STREAM_TIMEOUT_MS,
    SSE_LIFECYCLE_LOG_ENABLED,
    STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1,
    STAGE0_DSLD_BARCODE_FALLBACK_ENABLED,
    STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS,
    STAGE0_DSLD_BARCODE_FALLBACK_FULL_ENABLED,
    STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS,
    STAGE0_PROTOCOL_UNIFIED,
    STAGE0_WEB_DIGIT_SCAN_MAX_CHARS,
    STAGE0_WEB_JSONLD_MAX_NODES,
    STAGE0_WEB_MAX_BYTES,
    STAGE0_WEB_MAX_SOURCES,
    STAGE0_WEB_PARSE_BUDGET_MS,
    STAGE0_WEB_PARSE_PROFILE_ENABLED,
    STAGE0_WEB_PARSE_PROFILE_MAX_EVENTS,
    STAGE0_WEB_PARSE_PROFILE_SLOW_MS,
    STAGE0_WEB_PARSE_PROFILE_TOP_K,
    STAGE0_WEB_REGEX_SCAN_MAX_CHARS,
    STREAM_VERBOSE_LOG_ENABLED,
    TimeoutError,
    UPCITEMDB_API_KEY,
    WEB_BACKGROUND_BACKFILL_ENABLE,
    WEB_CANONICAL_TTL_MS,
    WEB_IDENTITY_PROVIDER_ENABLED,
    WEB_IDENTITY_PROVIDER_ORDER,
    WEB_IDENTITY_PROVIDER_TIMEOUT_MS,
    WEB_VERIFY_TIME_BUDGET_MS,
    abortable,
    applyDsldFactsToSnapshot,
    applyDsldInferenceGuard,
    applyFastFailureStatus,
    applyLnhpdFactsToSnapshot,
    applyWebBundleEvidenceGate,
    applyWebVerifyRevise,
    authDisabled,
    barcodeEnrichInFlight,
    barcodeSecondaryBackfill,
    buildAnalysisBundleSkeleton,
    buildAnalysisMeta,
    buildAnalysisStatus,
    buildBarcodeCacheKey,
    buildBarcodeSnapshot,
    buildBaseSafetySignalPack,
    buildBrandVariants,
    buildCandidateEvidence,
    buildCatalogBarcodeSnapshot,
    buildCountVariants,
    buildDosageVariants,
    buildDsldFactsInputFromSnapshot,
    buildFactsDigestFromDsld,
    buildFactsDigestFromLnhpd,
    buildFactsDigestFromWeb,
    buildIngredientsCover,
    buildLabelFactsFromSnapshot,
    buildLabelOnlyAnalysis,
    buildLnhpdFactsInputFromSnapshot,
    buildLowConfidenceAnalysis,
    buildMarketplaceSeedV2,
    buildMySupplementDigestQuick,
    buildNameHintsFromSourceTitles,
    buildNpnCandidates,
    buildPersistedEventFromBundle,
    buildProviderVerdict,
    buildProvisionalAnalysisBundle,
    buildSecondarySeedQueryPlan,
    buildSectionBullet,
    bundleUsesIherbOverlaySupport,
    canonicalizeUrl,
    captureException,
    clampRegexScanWindow,
    clearNegativeCache,
    clearNpnNegativeCache,
    clearResolutionCacheBestUrl,
    combineSignals,
    computeExpiresAt,
    computeFactsDigestHash,
    computeGuardrailScore,
    computeSeedMatch,
    contextFetchBreaker,
    contextFetchSemaphore,
    createDeferred,
    createRequestAbort,
    createTimeoutSignal,
    deepseekBreaker,
    deepseekSemaphore,
    extractBrandProduct,
    extractDeterministicSignalPack,
    extractDigitsPrefix,
    extractDomain,
    extractJsonLdScriptPayloads,
    fetchAnalysisBundle,
    fetchAnalysisBundleFastV3,
    fetchCanonicalDsldLabelIdByBarcode,
    fetchDsldFactsByBarcode,
    fetchDsldFactsByLabelId,
    fetchIherbOverlayClaimsByBarcode,
    fetchLnhpdFactsByName,
    fetchLnhpdFactsByNpn,
    fetchLnhpdFactsWithSecondChance,
    finalizePipelineStepCodes,
    getAnalysisIdentityCache,
    getBarcodeRegulatoryMap,
    getExtractabilityTier,
    getHistoricalLnhpdScanNpn,
    getKbRuntime,
    getNegativeCache,
    getNpnNegativeCache,
    getResolutionCache,
    getSerpCache,
    getSnapshotCache,
    getWebCanonicalMap,
    googleBreaker,
    googleSemaphore,
    hasAiPayload,
    hasAuthoritativeIdentityFromSnapshot,
    hasBundleOnlyAuthoritativeFastPath,
    hasBundleOnlyLabelRecordIdentityFromSnapshot,
    hasCoreFacts,
    hasLabelFacts,
    hasPreferredStage0DsldLabelId,
    incrementMetric,
    insertBarcodeResolutionTrainingRow,
    isAbortError,
    isAuthoritativeWebCandidate,
    isEventLoopLagOverThreshold,
    isExpiredAt,
    isHighQualityDomain,
    isMarketplaceDomain,
    isRegulatoryMapMiss,
    isSecondaryExcludedDomain,
    logBarcodeScan,
    matchesVariantInText,
    mergeAndDedupe,
    mergeEfficacyWithFallback,
    mergeFastAnalysisBundle,
    mergeLabelFallbacks,
    mergeSafetyWithFallback,
    mergeUsagePayloadWithFallback,
    normalizeBarcodeInput,
    normalizeBarcodeToGtin14,
    normalizeLabelExtractionSource,
    normalizeNpnValue,
    nowIso,
    parseDebugDecisionRequested,
    parseRequestBody,
    passesStableDbIdentityCheck,
    performGoogleSearch,
    prepareContextSources,
    queueBarcodeAnalysisCompletion,
    queueDsldDetailEnrichment,
    queueFirstPartyAnalysisCompletion,
    queueShadowCompare,
    readEventLoopLagP95Ms,
    recordMetricTiming,
    recordScanStreamTerminal,
    recordNpnNegativeAttempt,
    recordResolutionCacheFailure,
    resetEventLoopLagP95Window,
    resolveAnalysisMeta,
    resolveAuthorityCandidate,
    resolveCatalogByBarcode,
    resolveIdentityProviderLookup,
    resolveLocale,
    resolvePreferredStage0DsldLabelId,
    resolveScanStreamRev1DonePolicy,
    runSearchPlan,
    safeParseAnalysisBundle,
    safeSendSse,
    sanitizeAnalysisBundleCoverFields,
    sanitizeWebText,
    scoreSearchItem,
    selectBestWebCandidates,
    selectEnrichStreamAdmissionGate,
    sendSSE,
    shouldReEnrich,
    shouldRejectEnrichStreamForServerOverload,
    snapshotPayloadUsesIherbOverlaySupport,
    storeSnapshotCache,
    summarizeDeterministicSignals,
    supabaseReadBreaker,
    supabaseReadSemaphore,
    toLabelFactsFromDsld,
    toLabelFactsFromLnhpd,
    upsertAnalysisIdentityCache,
    upsertBarcodeRegulatoryMap,
    upsertNegativeCache,
    upsertProductIngredientsFromLabelFacts,
    upsertResolutionCacheStrongMatch,
    upsertSerpCache,
    upsertWebCanonicalMap,
    validateSnapshotOrFallback,
    withTimeoutPromise,
  } = deps as Record<string, any>;

  app.post("/api/enrich-stream", deps.verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(enrichStreamBodySchema, req, res);
  if (!parsedBody) {
    return;
  }
  const rawBarcode = parsedBody.barcode;
  const streamModeRaw =
    typeof (parsedBody as Record<string, unknown>)["streamMode"] === "string"
      ? String((parsedBody as Record<string, unknown>)["streamMode"]).trim()
      : null;
  const streamAnalysisBundleOnly =
    streamModeRaw === "analysis_bundle_only" || streamModeRaw === "bundle_only" || streamModeRaw === "analysis_bundle";
  const streamAdmissionLane: EnrichStreamAdmissionLane = streamAnalysisBundleOnly ? "bundle_only" : "full";
  const streamAdmissionGate = selectEnrichStreamAdmissionGate(streamAdmissionLane);
  const streamAdmissionQueueWaitMs = streamAnalysisBundleOnly
    ? Math.max(ENRICH_STREAM_QUEUE_WAIT_MS, ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY)
    : ENRICH_STREAM_QUEUE_WAIT_MS;
  const normalized = normalizeBarcodeInput(rawBarcode);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const acceptLanguageHeader =
    typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : null;
  const locale = resolveLocale(acceptLanguageHeader);
  const requestEntryAt = Date.now();
  const globalStreamTimeoutMs =
    Number.isFinite(SSE_GLOBAL_STREAM_TIMEOUT_MS) && SSE_GLOBAL_STREAM_TIMEOUT_MS > 0
      ? SSE_GLOBAL_STREAM_TIMEOUT_MS
      : 15000;
  const globalDeadlineAt = requestEntryAt + Math.max(1000, globalStreamTimeoutMs);
  const isRegressionRequest = (req as AuthenticatedRequest).regressionAuth === true;
  const debugDecisionRequested = parseDebugDecisionRequested(req);
  const authBypassHeader = req.headers["x-auth-disabled"];
  const isAuthBypassRequest = Array.isArray(authBypassHeader)
    ? authBypassHeader.includes("1")
    : authBypassHeader === "1";
  const regressionTokenHeaderRaw = req.headers["x-regression-token"];
  const hasRegressionTokenHeader = Array.isArray(regressionTokenHeaderRaw)
    ? regressionTokenHeaderRaw.some((value) => String(value ?? "").trim().length > 0)
    : String(regressionTokenHeaderRaw ?? "").trim().length > 0;
  const authorityRegressionSampleHeaderRaw = req.headers["x-authority-regression-sample"];
  const authorityRegressionSampleRequested = Array.isArray(authorityRegressionSampleHeaderRaw)
    ? authorityRegressionSampleHeaderRaw.some((value) => String(value).trim().toLowerCase() === "1" || String(value).trim().toLowerCase() === "true")
    : String(authorityRegressionSampleHeaderRaw ?? "").trim().toLowerCase() === "1" ||
    String(authorityRegressionSampleHeaderRaw ?? "").trim().toLowerCase() === "true";
  const crashCanaryHeaderRaw = req.headers["x-crash-canary"];
  const isCrashCanaryRequest = Array.isArray(crashCanaryHeaderRaw)
    ? crashCanaryHeaderRaw.some((value) => {
        const normalizedValue = String(value ?? "").trim().toLowerCase();
        return normalizedValue === "1" || normalizedValue === "true" || normalizedValue === "yes";
      })
    : (() => {
        const normalizedValue = String(crashCanaryHeaderRaw ?? "").trim().toLowerCase();
        return normalizedValue === "1" || normalizedValue === "true" || normalizedValue === "yes";
      })();
  const isRegressionLikeRequest =
    isRegressionRequest ||
    ((authDisabled || isAuthBypassRequest) && (hasRegressionTokenHeader || authorityRegressionSampleRequested)) ||
    (process.env.NODE_ENV !== "production" && isAuthBypassRequest && authorityRegressionSampleRequested);
  const authorityFailModeHeaderRaw =
    typeof req.headers["x-authority-fail-mode"] === "string"
      ? req.headers["x-authority-fail-mode"].trim().toLowerCase()
      : "";
  const requestedAuthorityFailMode: LnhpdForcedFailureMode | null =
    isRegressionRequest && (authorityFailModeHeaderRaw === "timeout" || authorityFailModeHeaderRaw === "not_found")
      ? (authorityFailModeHeaderRaw as LnhpdForcedFailureMode)
      : null;
  let authorityFailMode: LnhpdForcedFailureMode | null = requestedAuthorityFailMode;
  const bundleId = randomUUID();
  let finishInFlight: ((error?: unknown) => void) | null = null;
  let releaseAdmission: (() => void) | null = null;
  let catalogSnapshotForAi: SupplementSnapshot | null = null;
  let catalogAnalysisPayloadForAi: SnapshotAnalysisPayload | null = null;
  let catalogLabelExtractionForAi: LabelExtractionMeta | null = null;
  let catalogLabelFactsForAi: LabelFacts | null = null;
  let stage0BundleAbort: AbortController | null = null;
  let stage0BundleSignalCleanup: (() => void) | null = null;
  let stage1BundleAbort: AbortController | null = null;
  let stage1BundleSignalCleanup: (() => void) | null = null;

  let sseStarted = false;
  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  sseStarted = true;
  const requestAbort = createRequestAbort(res);

  const streamState = {
    rev0Sent: false,
    rev1Sent: false,
    persistedSent: false,
    doneSent: false,
    ended: false,
    fallbackRev1Locked: false,
    clientDisconnected: false,
    tRev0: null as number | null,
    tRev1: null as number | null,
    tPersisted: null as number | null,
    tDone: null as number | null,
    rev1Source: null as "fast_ai" | "fallback" | null,
    latestRevision: null as number | null,
    latestSourceType: null as string | null,
    latestSourceTypeFinal: null as boolean | null,
    latestIdentityType: null as string | null,
  };
  type Stage0Winner = "verified_regulatory" | "label_record" | "web_hint_unverified" | "unknown";
  type StreamProductIdentity = {
    name: string | null;
    brand: string | null;
    sourceAttribution: Stage0Winner;
    identityStable: boolean;
    sourceId?: string | null;
  };
  const stage0Rank = (winner: Stage0Winner): number => {
    switch (winner) {
      case "verified_regulatory":
        return 3;
      case "label_record":
        return 2;
      case "web_hint_unverified":
        return 1;
      default:
        return 0;
    }
  };
  const normalizeIdentityText = (value: unknown): string | null => {
    const text = typeof value === "string" ? value.trim() : "";
    return text.length > 0 ? text : null;
  };
  const normalizeProductIdentityAttribution = (value: unknown): Stage0Winner => {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (
      raw === "verified_regulatory"
      || raw === "verified"
      || raw === "regulatory"
      || raw === "lnhpd"
      || raw === "dsld"
    ) {
      return "verified_regulatory";
    }
    if (raw === "label_record" || raw === "label" || raw === "label_scan") {
      return "label_record";
    }
    if (raw === "web_hint_unverified" || raw === "web_hint" || raw === "web") {
      return "web_hint_unverified";
    }
    return "unknown";
  };
  const sourceAttributionFromDigestSource = (sourceType: FactsDigest["sourceType"]): Stage0Winner => {
    if (sourceType === "lnhpd" || sourceType === "dsld") return "verified_regulatory";
    if (sourceType === "web") return "web_hint_unverified";
    return "unknown";
  };
  const buildProductIdentityFromDigest = (params: {
    digest: FactsDigest;
    identityType: FactsIdentityType;
    identityValue: string;
    sourceTypeFinal: boolean;
  }): StreamProductIdentity | null => {
    const sourceAttribution = sourceAttributionFromDigestSource(params.digest.sourceType);
    const name = normalizeIdentityText(params.digest.product?.name);
    const brand = normalizeIdentityText(params.digest.product?.brandDisplay);
    const sourceId = normalizeIdentityText(params.identityValue);
    if (!name && !brand && !sourceId) return null;
    const identityStable =
      sourceAttribution === "verified_regulatory"
        ? Boolean(name)
        : sourceAttribution === "label_record"
          ? Boolean(name) && params.sourceTypeFinal
          : false;
    return {
      name,
      brand,
      sourceAttribution,
      identityStable,
      sourceId: sourceId ? `${params.identityType}:${sourceId}` : null,
    };
  };
  const toStreamProductIdentity = (candidate: unknown): StreamProductIdentity | null => {
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    const sourceAttribution = normalizeProductIdentityAttribution(row.sourceAttribution);
    const name = normalizeIdentityText(row.name);
    const brand = normalizeIdentityText(row.brand);
    const sourceId = normalizeIdentityText(row.sourceId);
    if (!name && !brand && !sourceId) return null;
    const identityStable =
      row.identityStable === true
      || (sourceAttribution === "verified_regulatory" && Boolean(name));
    return {
      name,
      brand,
      sourceAttribution,
      identityStable,
      sourceId: sourceId ?? null,
    };
  };
  let latestProductIdentity: StreamProductIdentity | null = null;
  let lockedTrustedProductIdentity: StreamProductIdentity | null = null;
  const rememberStreamProductIdentity = (candidate: StreamProductIdentity | null): StreamProductIdentity | null => {
    if (lockedTrustedProductIdentity) {
      latestProductIdentity = lockedTrustedProductIdentity;
      return lockedTrustedProductIdentity;
    }
    if (!candidate) {
      return latestProductIdentity;
    }
    latestProductIdentity = candidate;
    if (
      candidate.sourceAttribution === "verified_regulatory"
      && candidate.identityStable
      && Boolean(candidate.name)
    ) {
      lockedTrustedProductIdentity = candidate;
      latestProductIdentity = candidate;
      return candidate;
    }
    return candidate;
  };
  const attachProductIdentityMeta = (
    bundle: AnalysisBundle,
    fallbackIdentity: StreamProductIdentity | null = null,
  ): AnalysisBundle => {
    const candidateFromMeta = toStreamProductIdentity((bundle.meta as Record<string, unknown>)?.productIdentity);
    const chosen = rememberStreamProductIdentity(candidateFromMeta ?? fallbackIdentity);
    if (!chosen) return bundle;
    return {
      ...bundle,
      meta: {
        ...bundle.meta,
        productIdentity: chosen,
      },
    };
  };
  type PipelineStepName = "retrieve" | "sanitize" | "select_evidence" | "draft" | "verify" | "revise" | "emit";
  type PipelineStepStatus = "ok" | "degraded" | "failed";
  type PipelineStepMetric = {
    step: PipelineStepName;
    status: PipelineStepStatus;
    code?: string;
    ms?: number;
    startedAtMs?: number;
  };
  const pipelineStepsOrder: PipelineStepName[] = [
    "retrieve",
    "sanitize",
    "select_evidence",
    "draft",
    "verify",
    "revise",
    "emit",
  ];
  const pipelineMetricsEnabled = isRegressionRequest;
  const pipelineStartedAt = performance.now();
  const streamTimingRecorded = {
    rev0: false,
    rev1: false,
    done: false,
  };
  const recordStreamTimingOnce = (
    metricName: "time_to_rev0_ms" | "time_to_rev1_ms" | "time_to_done_ms",
    stage: keyof typeof streamTimingRecorded,
  ) => {
    if (streamTimingRecorded[stage]) return;
    streamTimingRecorded[stage] = true;
    recordMetricTiming(metricName, performance.now() - pipelineStartedAt);
  };
  const startedAt = pipelineStartedAt;
  const pipelineState = new Map<PipelineStepName, PipelineStepMetric>(
    pipelineStepsOrder.map((step) => [step, { step, status: "degraded", code: "not_reached" }]),
  );
  let pipelineTouched = false;
  let pipelineMetricsEmitted = false;
  let snapshotCacheHit = false;
  let fastBundleReplacedCount = 0;
  let fallbackRev1LockedCount = 0;
  let stage0StartCount = 0;
  let stage0ReplaceCount = 0;
  let stage0UpgradeCount = 0;
  let stage0RunSeq = 0;
  let activeStage0RunId: number | null = null;
  let activeStage0Winner: Stage0Winner = "unknown";
  let activeStage0SourceTypeHint: "lnhpd" | "dsld" | "web" | null = null;
  let activeStage0IdentityTypeHint: "npn" | "dsldLabelId" | "gtin14" | "webCanonicalId" | null = null;
  let activeStage0IdentityValueHint: string | null = null;
  let activeStage0Rank = stage0Rank(activeStage0Winner);
  let stage0Rev1Locked = false;
  let terminalReason: string | null = null;
  let degradedMode = false;
  let budgetGuardTriggered = false;
  let eventLoopGuardTriggered = false;
  let eventLoopLagP95DuringRequest = 0;
  let webBytesReadTotal = 0;
  let webParseMsTotal = 0;
  type WebParseProfileBucket = {
    calls: number;
    slowCalls: number;
    totalMs: number;
    maxMs: number;
    maxTextLen: number;
  };
  const webParseProfileBuckets = new Map<string, WebParseProfileBucket>();
  let webParseProfileEventCount = 0;
  let webParseProfileSummaryEmitted = false;
  const shouldSkipWebParseWork = (): boolean => {
    if (streamState.doneSent || streamState.ended || streamState.clientDisconnected || res.writableEnded) {
      return true;
    }
    if (degradedMode) {
      return true;
    }
    if (webParseMsTotal >= STAGE0_WEB_PARSE_BUDGET_MS) {
      return true;
    }
    if (streamAbortController?.signal?.aborted) {
      return true;
    }
    return isEventLoopLagOverThreshold();
  };
  const profileWebParseStep = <T>(
    step: string,
    text: string | null | undefined,
    fn: () => T,
    options?: {
      fallback?: () => T;
      skipWhenOverBudget?: boolean;
    },
  ): T => {
    if (options?.skipWhenOverBudget !== false && shouldSkipWebParseWork()) {
      if (options?.fallback) {
        return options.fallback();
      }
      return fn();
    }
    if (!STAGE0_WEB_PARSE_PROFILE_ENABLED) {
      return fn();
    }
    const startedAt = performance.now();
    try {
      return fn();
    } finally {
      const elapsedMs = Math.max(0, performance.now() - startedAt);
      webParseMsTotal += elapsedMs;
      const textLen = typeof text === "string" ? text.length : 0;
      const current = webParseProfileBuckets.get(step) ?? {
        calls: 0,
        slowCalls: 0,
        totalMs: 0,
        maxMs: 0,
        maxTextLen: 0,
      };
      current.calls += 1;
      current.totalMs += elapsedMs;
      current.maxMs = Math.max(current.maxMs, elapsedMs);
      current.maxTextLen = Math.max(current.maxTextLen, textLen);
      if (elapsedMs >= STAGE0_WEB_PARSE_PROFILE_SLOW_MS) {
        current.slowCalls += 1;
        if (webParseProfileEventCount < STAGE0_WEB_PARSE_PROFILE_MAX_EVENTS) {
          webParseProfileEventCount += 1;
          console.warn("[enrich-stream][web_parse_hotspot]", {
            requestId: requestId || null,
            barcode: streamBarcode ?? normalized?.code ?? null,
            step,
            elapsedMs: Math.round(elapsedMs * 100) / 100,
            textLen,
            stage0Winner: activeStage0Winner,
            sourceType: streamState.latestSourceType,
            rev1Sent: streamState.rev1Sent,
          });
        }
      }
      webParseProfileBuckets.set(step, current);
      if (
        webParseMsTotal > STAGE0_WEB_PARSE_BUDGET_MS &&
        !streamState.rev1Sent &&
        !streamState.doneSent &&
        !streamState.ended
      ) {
        emitDegradedLimitedRev1AndFinalize("DEGRADED_WEB_BUDGET");
      }
    }
  };
  const emitWebParseProfileSummary = (phase: string) => {
    if (!STAGE0_WEB_PARSE_PROFILE_ENABLED) return;
    if (webParseProfileSummaryEmitted) return;
    webParseProfileSummaryEmitted = true;
    const top = Array.from(webParseProfileBuckets.entries())
      .map(([step, bucket]) => ({
        step,
        calls: bucket.calls,
        slowCalls: bucket.slowCalls,
        totalMs: Math.round(bucket.totalMs * 100) / 100,
        avgMs: bucket.calls > 0 ? Math.round((bucket.totalMs / bucket.calls) * 100) / 100 : 0,
        maxMs: Math.round(bucket.maxMs * 100) / 100,
        maxTextLen: bucket.maxTextLen,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, STAGE0_WEB_PARSE_PROFILE_TOP_K);
    console.info("[enrich-stream][web_parse_profile_summary]", {
      requestId: requestId || null,
      barcode: streamBarcode ?? normalized?.code ?? null,
      phase,
      webParseMsTotal: Math.max(0, Math.round(webParseMsTotal)),
      webBytesReadTotal,
      profileBucketsEmpty: webParseProfileBuckets.size === 0,
      top,
    });
  };
  const buildWebParseProfileSnapshot = (topK = 3) => {
    if (!STAGE0_WEB_PARSE_PROFILE_ENABLED) return null;
    const top = Array.from(webParseProfileBuckets.entries())
      .map(([step, bucket]) => ({
        step,
        calls: bucket.calls,
        slowCount: bucket.slowCalls,
        totalMs: Math.round(bucket.totalMs * 100) / 100,
        maxMs: Math.round(bucket.maxMs * 100) / 100,
      }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, Math.max(1, topK));
    return {
      webParseMsTotal: Math.max(0, Math.round(webParseMsTotal)),
      webBytesReadTotal,
      profileBucketsEmpty: webParseProfileBuckets.size === 0,
      top,
    };
  };
  let npnCandidatesForMeta: NpnCandidate[] = [];
  let candidateBackfillDigest: FactsDigest | null = null;
  let candidateBackfillState: {
    attempted: boolean;
    used: boolean;
    source: NpnCandidateSourceKind | null;
    reasonCode: string | null;
    latencyMs: number | null;
    scoreSuppressed: boolean;
  } = {
    attempted: false,
    used: false,
    source: null,
    reasonCode: null,
    latencyMs: null,
    scoreSuppressed: false,
  };
  const pipelineStatusRank = (status: PipelineStepStatus): number =>
    status === "failed" ? 3 : status === "degraded" ? 2 : 1;
  const markPipelineStepStart = (step: PipelineStepName) => {
    if (!pipelineMetricsEnabled) return;
    pipelineTouched = true;
    const current = pipelineState.get(step);
    pipelineState.set(step, {
      step,
      status: current?.status ?? "ok",
      code: current?.code,
      ms: current?.ms,
      startedAtMs: performance.now(),
    });
  };
  const markPipelineStepEnd = (step: PipelineStepName, status: PipelineStepStatus, code?: string) => {
    if (!pipelineMetricsEnabled) return;
    pipelineTouched = true;
    const current = pipelineState.get(step);
    const nextMs =
      typeof current?.startedAtMs === "number" ? Math.max(0, Math.round(performance.now() - current.startedAtMs)) : current?.ms;
    const existingStatus = current?.status ?? "degraded";
    const keepExisting = pipelineStatusRank(existingStatus) > pipelineStatusRank(status);
    pipelineState.set(step, {
      step,
      status: keepExisting ? existingStatus : status,
      code: keepExisting ? current?.code : code ?? current?.code,
      ms: nextMs,
    });
  };
  const finalizePipelineNotReachedCodes = () => {
    if (!pipelineMetricsEnabled) return;
    const finalized = finalizePipelineStepCodes(pipelineStepsOrder, pipelineState);
    for (const step of pipelineStepsOrder) {
      const item = finalized.get(step);
      if (item) pipelineState.set(step, item);
    }
  };
  const buildStableWebPipeline = () =>
  (finalizePipelineNotReachedCodes(),
    pipelineStepsOrder.map((step) => {
      const item = pipelineState.get(step);
      return {
        step,
        status: item?.status ?? "degraded",
        code: item?.code,
      };
    }));
  const attachWebPipelineMeta = (bundle: AnalysisBundle): AnalysisBundle => {
    if (!pipelineMetricsEnabled) return bundle;
    if (bundle.meta.sourceType !== "web") return bundle;
    return {
      ...bundle,
      meta: {
        ...bundle.meta,
        webPipelineSchemaVersion: 1,
        webPipeline: buildStableWebPipeline(),
      },
    };
  };
  const buildStabilityMeta = () => ({
    stage0Winner: activeStage0Winner,
    stage0StartCount,
    stage0ReplaceCount,
    terminalReason: terminalReason ?? undefined,
    degradedMode,
    productIdentity: lockedTrustedProductIdentity ?? latestProductIdentity ?? undefined,
    regulatoryIds:
      npnCandidatesForMeta.length > 0
        ? {
            npnCandidates: npnCandidatesForMeta,
          }
        : undefined,
    candidateBackfill: candidateBackfillState.attempted
      ? {
          attempted: true,
          used: candidateBackfillState.used,
          source: candidateBackfillState.source,
          reasonCode: candidateBackfillState.reasonCode ?? undefined,
          latencyMs:
            Number.isFinite(Number(candidateBackfillState.latencyMs))
              ? Number(candidateBackfillState.latencyMs)
              : undefined,
          scoreSuppressed: candidateBackfillState.scoreSuppressed,
        }
      : undefined,
    rev1ToDoneMs:
      typeof streamState.tRev1 === "number" && typeof streamState.tDone === "number"
        ? Math.max(0, Math.round(streamState.tDone - streamState.tRev1))
        : undefined,
    doneTimerKind: doneTimerKind ?? undefined,
    doneTimerPlannedDelayMs:
      Number.isFinite(Number(doneTimerPlannedDelayMs)) && Number(doneTimerPlannedDelayMs) >= 0
        ? Number(doneTimerPlannedDelayMs)
        : undefined,
    doneTimerDriftMs:
      Number.isFinite(Number(doneTimerDriftMs)) && Number(doneTimerDriftMs) >= 0
        ? Number(doneTimerDriftMs)
        : undefined,
    persistedCommitMode,
    persistedCommitCompletedBeforeDone:
      typeof streamState.tPersisted === "number"
        ? (typeof streamState.tDone === "number" ? streamState.tPersisted <= streamState.tDone : true)
        : false,
    eventLoopLagP95DuringRequest: Math.max(0, Math.round(eventLoopLagP95DuringRequest)),
    webBytesReadTotal,
    webParseMsTotal: Math.max(0, Math.round(webParseMsTotal)),
  });
  const attachStabilityMeta = (bundle: AnalysisBundle): AnalysisBundle => {
    const sourceTypeFinal = bundle.meta.sourceTypeFinal === true;
    const shouldSuppressScore = candidateBackfillState.used && !sourceTypeFinal;
    if (shouldSuppressScore && !candidateBackfillState.scoreSuppressed) {
      candidateBackfillState = {
        ...candidateBackfillState,
        scoreSuppressed: true,
        reasonCode: candidateBackfillState.reasonCode ?? CANDIDATE_SCORE_SUPPRESS_REASON_CODE,
      };
    }
    return {
      ...bundle,
      meta: {
        ...bundle.meta,
        ...(shouldSuppressScore
          ? {
              scoreAvailable: false,
              scoreReasonCode: CANDIDATE_SCORE_SUPPRESS_REASON_CODE,
            }
          : null),
        ...buildStabilityMeta(),
      },
    };
  };
  const emitPipelineMetrics = (sourceTypeHint?: "lnhpd" | "dsld" | "web") => {
    if (!pipelineMetricsEnabled || pipelineMetricsEmitted) return;
    const resolvedSourceType =
      sourceTypeHint ??
      (streamState.latestSourceType === "lnhpd" || streamState.latestSourceType === "dsld" || streamState.latestSourceType === "web"
        ? (streamState.latestSourceType as "lnhpd" | "dsld" | "web")
        : "web");
    if (!pipelineTouched && resolvedSourceType !== "web") return;
    finalizePipelineNotReachedCodes();
    const steps = pipelineStepsOrder.map((step) => {
      const item = pipelineState.get(step);
      return {
        step,
        status: item?.status ?? "degraded",
        code: item?.code,
        ms: item?.ms,
      };
    });
    const totalMs = Math.max(0, Math.round(performance.now() - pipelineStartedAt));
    const sent = safeSendSse(res, "pipeline_metrics", {
      pipelineMetricsSchemaVersion: 1,
      requestId: requestId || null,
      barcode: streamBarcode ?? normalized?.code ?? "",
      sourceType: resolvedSourceType,
      cacheHit: snapshotCacheHit,
      cancelCounts: {
        fast_bundle_replaced_count: fastBundleReplacedCount,
        fallback_rev1_locked_count: fallbackRev1LockedCount,
      },
      streamStability: buildStabilityMeta(),
      steps,
      totalMs,
      emittedAt: new Date().toISOString(),
    });
    if (sent) {
      pipelineMetricsEmitted = true;
    }
  };
  markPipelineStepStart("retrieve");
  // Default to a short keepalive because some mobile SSE polyfills time out aggressively.
  // Can be overridden via SSE_KEEPALIVE_MS (min 5000ms).
  const keepAliveMsRaw = Number(process.env.SSE_KEEPALIVE_MS ?? "5000");
  const keepAliveMs =
    Number.isFinite(keepAliveMsRaw) && keepAliveMsRaw >= 5000 ? keepAliveMsRaw : 15000;
  const keepAlive = setInterval(() => {
    if (streamState.ended || streamState.doneSent || res.writableEnded) return;
    // Some SSE clients (notably certain React Native polyfills) do not tolerate comment keepalives (": ping").
    // Use a standard SSE event instead so both mobile clients and our CI parsers stay stable.
    safeSendSse(res, "keepalive", { type: "ping" });
  }, keepAliveMs);
  (keepAlive as any).unref?.();
  const clearKeepAlive = () => clearInterval(keepAlive);
  res.on("close", clearKeepAlive);
  res.on("finish", clearKeepAlive);
  let pendingDoneReason: string | null = null;
  let streamAbortController: AbortController | null = null;
  let latestSkeletonBundle: AnalysisBundle | null = null;
  let latestNotFoundHint: {
    brand: string | null;
    product: string | null;
    category: string | null;
    sources: Array<{ title: string; link: string; domain: string; isHighQuality: boolean }> | null;
  } = {
    brand: null,
    product: null,
    category: null,
    sources: null,
  };
  let streamBarcode: string | null = null;
  let requestId = "";
  requestId = String(res.getHeader("x-request-id") ?? "");
  let streamLocale = locale;
  let cleanupRequestSignal: (() => void) | null = null;
  let fastWatchdog: ReturnType<typeof setTimeout> | null = null;
  let globalWatchdog: ReturnType<typeof setTimeout> | null = null;
  let bundleOnlyDoneTimer: ReturnType<typeof setTimeout> | null = null;
  let bundleOnlyTerminalGuardTimer: ReturnType<typeof setTimeout> | null = null;
  let fullPressureCoreFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let fullPreRev1TerminalGuardTimer: ReturnType<typeof setTimeout> | null = null;
  let webRev1DoneTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTerminalWatchdog: ReturnType<typeof setTimeout> | null = null;
  let disconnectReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let lagSamplerTimer: ReturnType<typeof setInterval> | null = null;
  let doneTimerKind: "bundle_only_done" | "full_rev1_watchdog" | null = null;
  let doneTimerPlannedDelayMs: number | null = null;
  let doneTimerScheduledAtMs: number | null = null;
  let doneTimerDriftMs: number | null = null;
  let persistedCommitMode: "awaited" | "background_async" = "awaited";
  let pipelineAborted = false;

  const clearWatchdogs = () => {
    if (fastWatchdog) {
      clearTimeout(fastWatchdog);
      fastWatchdog = null;
    }
    if (globalWatchdog) {
      clearTimeout(globalWatchdog);
      globalWatchdog = null;
    }
    if (bundleOnlyDoneTimer) {
      clearTimeout(bundleOnlyDoneTimer);
      bundleOnlyDoneTimer = null;
    }
    if (bundleOnlyTerminalGuardTimer) {
      clearTimeout(bundleOnlyTerminalGuardTimer);
      bundleOnlyTerminalGuardTimer = null;
    }
    if (fullPressureCoreFallbackTimer) {
      clearTimeout(fullPressureCoreFallbackTimer);
      fullPressureCoreFallbackTimer = null;
    }
    if (fullPreRev1TerminalGuardTimer) {
      clearTimeout(fullPreRev1TerminalGuardTimer);
      fullPreRev1TerminalGuardTimer = null;
    }
    if (webRev1DoneTimer) {
      clearTimeout(webRev1DoneTimer);
      webRev1DoneTimer = null;
    }
    if (hardTerminalWatchdog) {
      clearTimeout(hardTerminalWatchdog);
      hardTerminalWatchdog = null;
    }
    if (lagSamplerTimer) {
      clearInterval(lagSamplerTimer);
      lagSamplerTimer = null;
    }
  };
  const sampleRequestLag = () => {
    const lagMs = readEventLoopLagP95Ms();
    if (Number.isFinite(lagMs)) {
      eventLoopLagP95DuringRequest = Math.max(eventLoopLagP95DuringRequest, lagMs);
    }
  };
  const startLagSampler = () => {
    resetEventLoopLagP95Window();
    sampleRequestLag();
    if (lagSamplerTimer) return;
    lagSamplerTimer = setInterval(sampleRequestLag, EVENT_LOOP_LAG_SAMPLE_MS);
    (lagSamplerTimer as { unref?: () => void }).unref?.();
  };
  const clearDisconnectReleaseTimer = () => {
    if (!disconnectReleaseTimer) return;
    clearTimeout(disconnectReleaseTimer);
    disconnectReleaseTimer = null;
  };
  const abortPipelineOnce = (error?: unknown) => {
    if (pipelineAborted) return;
    pipelineAborted = true;
    const reason =
      error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : "stream_finalized");
    streamAbortController?.abort(reason);
    stage0BundleAbort?.abort(reason);
    stage0BundleAbort = null;
    stage0BundleSignalCleanup?.();
    stage0BundleSignalCleanup = null;
    activeStage0RunId = null;
    stage1BundleAbort?.abort(reason);
    stage1BundleAbort = null;
    stage1BundleSignalCleanup?.();
    stage1BundleSignalCleanup = null;
  };
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const toChunkText = (chunk: unknown, encoding?: BufferEncoding): string => {
    if (typeof chunk === "string") return chunk;
    if (Buffer.isBuffer(chunk)) return chunk.toString(encoding ?? "utf8");
    return "";
  };
  const logDoneEvent = (
    eventKind: "attempt" | "success" | "skipped",
    extra?: Record<string, unknown>,
  ) => {
    if (!SSE_LIFECYCLE_LOG_ENABLED) return;
    const base = {
      request_id: requestId || null,
      barcode: streamBarcode,
      done_emit_attempt: eventKind === "attempt",
      done_emit_success: eventKind === "success",
      done_emit_skipped: eventKind === "skipped",
      finalize_reason: pendingDoneReason ?? "unspecified",
      res_writableEnded: res.writableEnded,
      clientDisconnected: streamState.clientDisconnected,
      identityType: streamState.latestIdentityType,
      sourceType: streamState.latestSourceType,
      revision: streamState.latestRevision,
      rev0_sent: streamState.rev0Sent,
      rev1_sent: streamState.rev1Sent,
      persisted_sent: streamState.persistedSent,
      done_sent: streamState.doneSent,
      snapshot_cache_hit: snapshotCacheHit,
      fast_bundle_replaced_count: fastBundleReplacedCount,
      fallback_rev1_locked_count: fallbackRev1LockedCount,
    };
    console.info("[sse_done]", { ...base, ...(extra ?? {}) });
  };
  const logSseLifecycle = (payload: Record<string, unknown>) => {
    if (!SSE_LIFECYCLE_LOG_ENABLED) return;
    console.info("[SSE_LIFECYCLE]", payload);
  };
  // Track lifecycle even when legacy branches still call sendSSE/res.end directly.
  (res.write as unknown) = ((chunk: unknown, encoding?: BufferEncoding, cb?: (error?: Error | null) => void) => {
    const text = toChunkText(chunk, encoding);
    const result = originalWrite(
      chunk as Parameters<Response["write"]>[0],
      encoding as Parameters<Response["write"]>[1],
      cb as Parameters<Response["write"]>[2],
    );
    if (text.includes("event: done")) {
      streamState.doneSent = true;
      streamState.tDone = Date.now();
      recordStreamTimingOnce("time_to_done_ms", "done");
      markPipelineStepEnd("emit", "ok");
      logDoneEvent("success", { emit_path: "write_wrapper_observed_done_event" });
    }
    return result;
  }) as Response["write"];
  (res.end as unknown) = ((chunk?: unknown, encoding?: BufferEncoding, cb?: () => void) => {
    if (!streamState.ended) {
      streamState.ended = true;
      emitWebParseProfileSummary("res_end");
      clearKeepAlive();
      clearWatchdogs();
      cleanupRequestSignal?.();
      cleanupRequestSignal = null;
      const headerContentType = String(res.getHeader("Content-Type") ?? res.getHeader("content-type") ?? "");
      const isSseResponse = sseStarted || headerContentType.toLowerCase().includes("text/event-stream");
      logDoneEvent("attempt", {
        emit_path: "res_end_guard",
        isSseResponse,
      });
      if (
        !streamState.doneSent &&
        !res.writableEnded &&
        !streamState.clientDisconnected &&
        isSseResponse
      ) {
        const webParseProfile = buildWebParseProfileSnapshot(3);
        const emitted = safeSendSse(res, "done", {
          barcode: streamBarcode,
          reason: pendingDoneReason ?? "implicit_end_guard",
          ...(webParseProfile ? { webParseProfile } : null),
        });
        if (emitted) {
          streamState.doneSent = true;
          streamState.tDone = Date.now();
          recordStreamTimingOnce("time_to_done_ms", "done");
          recordScanStreamTerminal?.({
            terminal: "DONE",
            reason: pendingDoneReason ?? "implicit_end_guard",
            degradedMode,
            sourceType: streamState.latestSourceType ?? null,
          });
          markPipelineStepEnd("emit", "ok");
          logDoneEvent("success", { emit_path: "res_end_guard_send_done" });
        } else {
          markPipelineStepEnd("emit", "failed", "done_send_failed");
          logDoneEvent("skipped", {
            emit_path: "res_end_guard_send_done",
            skip_reason: "safe_send_failed",
          });
        }
      } else {
        logDoneEvent("skipped", {
          emit_path: "res_end_guard",
          skip_reason: streamState.doneSent
            ? "done_already_sent"
            : res.writableEnded
              ? "response_already_closed"
              : streamState.clientDisconnected
                ? "client_disconnected"
                : isSseResponse
                  ? "unknown"
                  : "not_sse_response",
        });
      }
      releaseInFlightOnce();
      releaseAdmissionOnce();
      emitPipelineMetrics();
      (res as unknown as { flush?: () => void }).flush?.();
    }
    return originalEnd(chunk as Parameters<Response["end"]>[0], encoding as Parameters<Response["end"]>[1], cb as Parameters<Response["end"]>[2]);
  }) as Response["end"];
  const releaseInFlightOnce = (error?: unknown) => {
    clearDisconnectReleaseTimer();
    const release = finishInFlight;
    finishInFlight = null;
    if (!release) return;
    release(error);
  };
  const releaseAdmissionOnce = () => {
    clearDisconnectReleaseTimer();
    const release = releaseAdmission;
    releaseAdmission = null;
    if (!release) return;
    release();
  };
  const finalizeStream = (reason: string) => {
    sampleRequestLag();
    emitWebParseProfileSummary("finalize_stream");
    if (!terminalReason) {
      terminalReason = reason;
    }
    const resolvedReason = terminalReason ?? reason;
    if (streamState.ended || res.writableEnded) {
      pendingDoneReason = resolvedReason;
      logDoneEvent("skipped", {
        emit_path: "finalize_stream",
        skip_reason: streamState.ended ? "stream_already_ended" : "response_already_closed",
      });
      return;
    }
    pendingDoneReason = resolvedReason;
    logDoneEvent("attempt", {
      emit_path: "finalize_stream",
    });
    if (!streamState.doneSent && !streamState.clientDisconnected) {
      const stabilityMeta = buildStabilityMeta();
      const {
        terminalReason: _terminalReason,
        degradedMode: _degradedMode,
        stage0Winner: _stage0Winner,
        stage0StartCount: _stage0StartCount,
        stage0ReplaceCount: _stage0ReplaceCount,
        ...stabilityMetaForDone
      } = stabilityMeta;
      const webParseProfile = buildWebParseProfileSnapshot(3);
      const emitted = safeSendSse(res, "done", {
        barcode: streamBarcode,
        reason: pendingDoneReason ?? "finalize_stream",
        terminalReason: resolvedReason,
        degradedMode,
        stage0Winner: activeStage0Winner,
        stage0StartCount,
        stage0ReplaceCount,
        ...stabilityMetaForDone,
        ...(webParseProfile ? { webParseProfile } : null),
      });
      if (emitted) {
        streamState.doneSent = true;
        streamState.tDone = Date.now();
        recordScanStreamTerminal?.({
          terminal: "DONE",
          reason: resolvedReason,
          degradedMode,
          sourceType: streamState.latestSourceType ?? null,
        });
        markPipelineStepEnd("emit", "ok");
        logDoneEvent("success", { emit_path: "finalize_stream_send_done" });
      } else {
        markPipelineStepEnd("emit", "failed", "done_send_failed");
        logDoneEvent("skipped", {
          emit_path: "finalize_stream_send_done",
          skip_reason: "safe_send_failed",
        });
      }
    }
    emitPipelineMetrics(
      streamState.latestSourceType === "lnhpd" || streamState.latestSourceType === "dsld" || streamState.latestSourceType === "web"
        ? (streamState.latestSourceType as "lnhpd" | "dsld" | "web")
        : undefined,
    );
    logSseLifecycle({
      requestId: requestId || null,
      phase: "finalize",
      reason: resolvedReason,
      rev0Sent: streamState.rev0Sent,
      rev1Sent: streamState.rev1Sent,
      doneSent: streamState.doneSent,
      sourceType: streamState.latestSourceType,
    });
    abortPipelineOnce(new Error("stream_finalized"));
    clearWatchdogs();
    res.end();
  };
  const scheduleBundleOnlyFinalize = () => {
    if (streamState.doneSent || streamState.ended || res.writableEnded || streamState.clientDisconnected) return;
    if (!streamState.rev1Sent) return;

    const rev1DonePolicy = resolveScanStreamRev1DonePolicy({
      analysisBundleOnly: streamAnalysisBundleOnly,
      bundleOnlyDoneDelayMs: ENRICH_STREAM_BUNDLE_ONLY_DONE_DELAY_MS,
      fullRev1DoneDelayMs: ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS,
    });
    if (!rev1DonePolicy) return;

    if (rev1DonePolicy.timerKind === "bundle_only_done" && bundleOnlyDoneTimer) return;
    if (rev1DonePolicy.timerKind === "full_rev1_watchdog" && webRev1DoneTimer) return;

    doneTimerKind = rev1DonePolicy.timerKind;
    doneTimerPlannedDelayMs = rev1DonePolicy.delayMs;
    doneTimerScheduledAtMs = Date.now();
    doneTimerDriftMs = null;

    const timer = setTimeout(() => {
      if (rev1DonePolicy.timerKind === "bundle_only_done") {
        bundleOnlyDoneTimer = null;
      } else {
        webRev1DoneTimer = null;
      }
      const plannedDelayMs = Number(doneTimerPlannedDelayMs ?? rev1DonePolicy.delayMs);
      const scheduledAtMs = Number(doneTimerScheduledAtMs ?? Date.now());
      doneTimerDriftMs = Math.max(0, Date.now() - scheduledAtMs - plannedDelayMs);
      if (streamState.doneSent || streamState.ended || res.writableEnded || streamState.clientDisconnected) return;
      finalizeStream(rev1DonePolicy.finalizeReason);
    }, rev1DonePolicy.delayMs);
    (timer as { unref?: () => void }).unref?.();

    if (rev1DonePolicy.timerKind === "bundle_only_done") {
      bundleOnlyDoneTimer = timer;
    } else {
      webRev1DoneTimer = timer;
    }
  };
  type NotFoundStage = "v2_gate" | "negative_cache" | "search" | "cheap_pass" | "facts";
  const NOT_FOUND_ERROR_SCHEMA_VERSION = 1 as const;
  const isRetryableNotFoundReason = (reasonCode: string | null | undefined): boolean => {
    const normalizedReasonCode = String(reasonCode ?? "").trim().toUpperCase();
    return (
      normalizedReasonCode === "TIMEOUT" ||
      normalizedReasonCode === "BUDGET_EXHAUSTED" ||
      normalizedReasonCode === "BREAKER_OPEN" ||
      normalizedReasonCode === "MARKETPLACE_ONLY_TIMEOUT"
    );
  };
  const emitTerminalErrorAndFinalize = (params: {
    code?: string;
    stage?: string;
    reasonCode?: string | null;
    retryable?: boolean;
    retryAfterMs?: number | null;
    admissionLane?: EnrichStreamAdmissionLane;
    admissionGateState?: ReturnType<EnrichStreamAdmissionGate["getState"]> | null;
    message: string;
    finalizeReason: string;
    releaseError?: unknown;
    schemaVersion?: number;
  }) => {
    const terminalSnapshot = {
      sourceType: streamState.latestSourceType,
      sourceTypeFinal: streamState.latestSourceTypeFinal,
      identityType: streamState.latestIdentityType,
      revision: streamState.latestRevision,
      rev0Sent: streamState.rev0Sent,
      rev1Sent: streamState.rev1Sent,
      persistedSent: streamState.persistedSent,
      doneSent: streamState.doneSent,
      finalizeReason: params.finalizeReason,
      ...buildStabilityMeta(),
    };
    const payload: Record<string, unknown> = {
      message: params.message,
      requestId: requestId || null,
      terminalSnapshot,
    };
    if (typeof params.schemaVersion === "number") {
      payload.schemaVersion = params.schemaVersion;
    }
    if (typeof params.code === "string" && params.code.trim().length > 0) {
      payload.code = params.code.trim();
    }
    if (typeof params.stage === "string" && params.stage.trim().length > 0) {
      payload.stage = params.stage.trim();
    }
    if (params.reasonCode === null || typeof params.reasonCode === "string") {
      payload.reasonCode = params.reasonCode;
    }
    if (typeof params.retryable === "boolean") {
      payload.retryable = params.retryable;
    }
    if (Number.isFinite(params.retryAfterMs) && Number(params.retryAfterMs) >= 0) {
      payload.retryAfterMs = Number(params.retryAfterMs);
    }
    if (params.admissionLane) {
      payload.admissionLane = params.admissionLane;
    }
    if (params.admissionGateState) {
      payload.admissionGateState = params.admissionGateState;
    }
    sendSSE(res, "error", payload);
    recordScanStreamTerminal?.({
      terminal: params.code ?? "STREAM_ERROR",
      reason: params.reasonCode ?? params.finalizeReason,
      degradedMode,
      sourceType: streamState.latestSourceType ?? null,
    });
    finalizeStream(params.finalizeReason);
    releaseInFlightOnce(params.releaseError);
    releaseAdmissionOnce();
  };
  const emitStreamBusyAndFinalize = (reasonCode: "QUEUE_FULL" | "QUEUE_WAIT_TIMEOUT" | "SERVER_OVERLOAD") => {
    const retryAfterMs = reasonCode === "SERVER_OVERLOAD" ? ENRICH_STREAM_OVERLOAD_RETRY_AFTER_MS : undefined;
    const admissionGateState = streamAdmissionGate.getState();
    emitTerminalErrorAndFinalize({
      schemaVersion: 1,
      code: "STREAM_BUSY",
      stage: "admission",
      reasonCode,
      retryable: true,
      retryAfterMs,
      admissionLane: streamAdmissionLane,
      admissionGateState,
      message: "Server is busy, please retry shortly",
      finalizeReason: `stream_busy_${reasonCode.toLowerCase()}`,
      releaseError: new Error(`stream_busy:${reasonCode}`),
    });
  };
  const emitProductNotFoundAndFinalize = (params: {
    stage: NotFoundStage;
    reasonCode?: string | null;
  }) => {
    const reasonCode =
      typeof params.reasonCode === "string" && params.reasonCode.trim().length > 0
        ? params.reasonCode.trim()
        : null;
    if (!streamState.rev1Sent && !streamState.clientDisconnected && !res.writableEnded) {
      const baseSkeleton =
        latestSkeletonBundle ??
        (streamBarcode
          ? buildProvisionalAnalysisBundle({
            bundleId,
            locale: streamLocale,
            barcodeGtin14: streamBarcode.padStart(14, "0"),
            revision: 0,
            phase: "skeleton",
          })
          : null);
      if (baseSkeleton) {
        const productLabel =
          latestNotFoundHint.product?.trim() ||
          baseSkeleton.sections.overview.cover?.summary?.trim() ||
          "this product";
        const hasSourceHints = Array.isArray(latestNotFoundHint.sources) && latestNotFoundHint.sources.length > 0;
        const limitedSummary = `${productLabel} could not be fully verified from authoritative sources. This limited view is based on partial evidence and should be confirmed on the package label.`;
        const limitedBundle: AnalysisBundle = {
          ...baseSkeleton,
          meta: {
            ...baseSkeleton.meta,
            sourceType: "web",
            sourceTypeFinal: false,
            detailReady: false,
          },
          sections: {
            ...baseSkeleton.sections,
            overview: {
              ...baseSkeleton.sections.overview,
              cover: {
                summary: limitedSummary,
                bullets: [
                  buildSectionBullet(
                    hasSourceHints
                      ? "We found partial listing signals, but we could not verify a trusted product match."
                      : "We could not verify a trusted product listing for this barcode.",
                    ["general_advice"],
                  ),
                  buildSectionBullet(
                    "Scan Supplement Facts and Directions panels to unlock product-level analysis.",
                    ["general_advice"],
                  ),
                ],
              },
              detail: {
                summary: limitedSummary,
                bullets: [
                  buildSectionBullet(
                    "This result is limited because authoritative product verification was not completed.",
                    ["general_advice"],
                  ),
                  buildSectionBullet(
                    "Use package-label details as the source of truth before making decisions.",
                    ["general_advice"],
                  ),
                ],
              },
              dataStatus: "limited",
            },
            usage: {
              ...baseSkeleton.sections.usage,
              cover: {
                bullets: [
                  buildSectionBullet("Follow package label directions for timing and dosing.", ["general_advice"]),
                  buildSectionBullet("Capture the Directions panel to improve usage guidance.", ["general_advice"]),
                ],
                bestTimeToTake: {
                  text: "Anytime (follow package directions).",
                  basisTags: ["general_advice"],
                },
                withFood: {
                  value: null,
                  text: "Take with food if needed for tolerance unless label says otherwise.",
                  basisTags: ["general_advice"],
                },
                dosage: {
                  text: "Follow the product label directions.",
                  basisTags: ["general_advice"],
                },
              },
              dataStatus: "limited",
            },
            safety: {
              ...baseSkeleton.sections.safety,
              cover: {
                verdict: "Safety details are not included in this source record.",
                bullets: [
                  buildSectionBullet(
                    "Label-specific safety details were not verified. Consult a clinician if pregnant, nursing, or on medication.",
                    ["general_advice"],
                  ),
                ],
              },
              dataStatus: "limited",
            },
          },
        };
        emitRev1Once(limitedBundle, "fallback", "product_not_found_limited");
      }
    }
    emitTerminalErrorAndFinalize({
      schemaVersion: NOT_FOUND_ERROR_SCHEMA_VERSION,
      code: "NOT_FOUND",
      stage: params.stage,
      reasonCode,
      retryable: isRetryableNotFoundReason(reasonCode),
      message: "Product not found",
      finalizeReason: "product_not_found",
      releaseError: new Error(reasonCode ? `product_not_found:${reasonCode}` : "product_not_found"),
    });
  };
  const emitRev0Once = (bundle: AnalysisBundle): boolean => {
    if (streamState.rev0Sent || res.writableEnded || streamState.clientDisconnected) return false;
    const normalizedBase: AnalysisBundle = {
      ...bundle,
      meta: {
        ...bundle.meta,
        phase: "skeleton",
        revision: 0,
        sourceTypeFinal: false,
        detailReady: false,
      },
      sections: {
        ...bundle.sections,
        ingredients: {
          ...bundle.sections.ingredients,
          cover: { items: [], totalCount: 0 },
          detail: null,
          dataStatus: "pending",
        },
      },
    };
    const normalized = attachStabilityMeta(attachProductIdentityMeta(normalizedBase));
    latestSkeletonBundle = normalized;
    streamState.latestRevision = Number(normalized.meta.revision);
    streamState.latestSourceType =
      typeof normalized.meta.sourceType === "string" ? normalized.meta.sourceType : streamState.latestSourceType;
    streamState.latestSourceTypeFinal =
      typeof normalized.meta.sourceTypeFinal === "boolean"
        ? normalized.meta.sourceTypeFinal
        : streamState.latestSourceTypeFinal;
    streamState.latestIdentityType =
      typeof normalized.meta.authoritativeIdentity?.type === "string"
        ? normalized.meta.authoritativeIdentity.type
        : streamState.latestIdentityType;
    sendSSE(res, "analysis_bundle", normalized);
    streamState.rev0Sent = true;
    streamState.tRev0 = Date.now();
    recordStreamTimingOnce("time_to_rev0_ms", "rev0");
    logSseLifecycle({
      requestId: requestId || null,
      phase: "rev0",
      sourceType: normalized.meta.sourceType,
      identityType: normalized.meta.authoritativeIdentity?.type ?? null,
    });
    return true;
  };
  const emitRev1Once = (
    bundle: AnalysisBundle,
    source: "fast_ai" | "fallback",
    fallbackReason?: string,
  ): boolean => {
    if (res.writableEnded || streamState.clientDisconnected) return false;
    if (source === "fast_ai" && streamState.fallbackRev1Locked) {
      console.info("[analysis_bundle] dropping late fast rev1 after fallback lock");
      return false;
    }
    if (streamState.rev1Sent) return false;
    const normalizedBase: AnalysisBundle = {
      ...bundle,
      meta: {
        ...bundle.meta,
        phase: "fast_ai",
        revision: 1,
        sourceTypeFinal: source === "fast_ai" ? true : Boolean(bundle.meta.sourceTypeFinal),
        detailReady: source === "fast_ai" ? Boolean(bundle.meta.detailReady) : false,
        fallback:
          source === "fallback"
            ? { code: fallbackReason ?? "watchdog_fast_timeout" }
            : bundle.meta.fallback ?? undefined,
        fallbackReason: source === "fallback" ? (fallbackReason ?? "watchdog_fast_timeout") : undefined,
      },
    };
    const normalized = attachStabilityMeta(attachProductIdentityMeta(attachWebPipelineMeta(normalizedBase)));
    streamState.latestRevision = Number(normalized.meta.revision);
    streamState.latestSourceType =
      typeof normalized.meta.sourceType === "string" ? normalized.meta.sourceType : streamState.latestSourceType;
    streamState.latestSourceTypeFinal =
      typeof normalized.meta.sourceTypeFinal === "boolean"
        ? normalized.meta.sourceTypeFinal
        : streamState.latestSourceTypeFinal;
    streamState.latestIdentityType =
      typeof normalized.meta.authoritativeIdentity?.type === "string"
        ? normalized.meta.authoritativeIdentity.type
        : streamState.latestIdentityType;
    sendSSE(res, "analysis_bundle", normalized);
    streamState.rev1Sent = true;
    stage0Rev1Locked = true;
    streamState.tRev1 = Date.now();
    recordStreamTimingOnce("time_to_rev1_ms", "rev1");
    streamState.rev1Source = source;
    logSseLifecycle({
      requestId: requestId || null,
      phase: source === "fallback" ? "rev1_limited" : "rev1",
      sourceType: normalized.meta.sourceType,
      fallbackReason: fallbackReason ?? null,
      identityType: normalized.meta.authoritativeIdentity?.type ?? null,
    });
    scheduleBundleOnlyFinalize();
    if (source === "fallback") {
      streamState.fallbackRev1Locked = true;
      fallbackRev1LockedCount += 1;
    }
    return true;
  };
  const getDegradedReasonCopy = (
    reasonCode: "DEGRADED_WEB_BUDGET" | "DEGRADED_EVENTLOOP" | "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH",
  ): string => {
    if (reasonCode === "DEGRADED_EVENTLOOP") {
      return "System load was high, so we returned partial results to keep scan latency stable.";
    }
    if (reasonCode === "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH") {
      return "No authoritative match was confirmed in bundle-only mode, so web expansion was skipped.";
    }
    return "Web evidence budget was reached, so we returned partial results to keep scan latency stable.";
  };
  const clearNegativeCacheAllVariants = (
    barcodeGtin14Value: string | null | undefined,
    barcodeRawValue: string | null | undefined,
    options?: { context?: string },
  ): void => {
    const gtin14Digits = String(barcodeGtin14Value ?? "").replace(/\D/g, "");
    const barcodeGtin14Normalized = gtin14Digits.length >= 8
      ? (gtin14Digits.length > 14 ? gtin14Digits.slice(-14) : gtin14Digits.padStart(14, "0"))
      : null;
    if (!barcodeGtin14Normalized) return;
    const barcodeRawNormalized = String(barcodeRawValue ?? "").replace(/\D/g, "") || null;
    const context = options?.context ?? "unknown";
    void clearNegativeCache(
      barcodeGtin14Normalized,
      barcodeRawNormalized,
      {
        timeoutMs: 500,
        retry: {
          maxAttempts: 2,
          baseDelayMs: 80,
          maxDelayMs: 220,
          jitterRatio: 0.2,
        },
      },
    ).catch((error) => {
      if (SSE_LIFECYCLE_LOG_ENABLED) {
        console.warn("[ResolutionV2] primary negative-cache clear failed", {
          barcode: barcodeGtin14Normalized,
          context,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return clearNegativeCache(
        barcodeGtin14Normalized,
        barcodeRawNormalized,
        {
          timeoutMs: 1200,
          queueTimeoutMs: 0,
          breaker: undefined,
          semaphore: undefined,
          retry: { maxAttempts: 1 },
        },
      );
    }).catch((error) => {
      console.warn("[ResolutionV2] fallback negative-cache clear failed", {
        barcode: barcodeGtin14Normalized,
        context,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  const emitDegradedLimitedRev1AndFinalize = (
    reasonCode: "DEGRADED_WEB_BUDGET" | "DEGRADED_EVENTLOOP" | "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH",
  ) => {
    try {
      if (reasonCode === "DEGRADED_WEB_BUDGET") budgetGuardTriggered = true;
      if (reasonCode === "DEGRADED_EVENTLOOP") eventLoopGuardTriggered = true;
      degradedMode = true;
      terminalReason = reasonCode;
      if (!streamState.rev1Sent && !streamState.clientDisconnected && !res.writableEnded) {
        const baseSkeleton =
          latestSkeletonBundle ??
          (streamBarcode
            ? buildProvisionalAnalysisBundle({
              bundleId,
              locale: streamLocale,
              barcodeGtin14: streamBarcode.padStart(14, "0"),
              revision: 0,
              phase: "skeleton",
            })
            : null);
        if (baseSkeleton) {
          const productLabel =
            latestNotFoundHint.product?.trim() ||
            baseSkeleton.sections.overview.cover?.summary?.trim() ||
            "this product";
          const limitedSummary = `${productLabel} is shown in limited mode. ${getDegradedReasonCopy(reasonCode)} Verify details on the package label.`;
          const fallbackCode = reasonCode.toLowerCase();
          const latestSourceType = streamState.latestSourceType;
          const latestSourceTypeFinal = streamState.latestSourceTypeFinal === true;
          const latestIdentityType = streamState.latestIdentityType;
          const hasAuthoritativeSourceHint = latestSourceType === "lnhpd" || latestSourceType === "dsld";
          const hasAuthoritativeIdentityHint = latestIdentityType === "npn" || latestIdentityType === "dsldLabelId";
          const stage0AuthoritativeWinner =
            activeStage0Winner === "verified_regulatory" || activeStage0Winner === "label_record";
          const stage0SourceTypeHint =
            stage0AuthoritativeWinner &&
              (activeStage0SourceTypeHint === "lnhpd" || activeStage0SourceTypeHint === "dsld")
              ? activeStage0SourceTypeHint
              : null;
          const stage0IdentityTypeHint =
            stage0AuthoritativeWinner &&
              (activeStage0IdentityTypeHint === "npn" || activeStage0IdentityTypeHint === "dsldLabelId")
              ? activeStage0IdentityTypeHint
              : null;
          const effectiveAuthoritativeSourceType =
            hasAuthoritativeSourceHint && (latestSourceType === "lnhpd" || latestSourceType === "dsld")
              ? latestSourceType
              : stage0SourceTypeHint;
          const effectiveAuthoritativeIdentityType =
            hasAuthoritativeIdentityHint && (latestIdentityType === "npn" || latestIdentityType === "dsldLabelId")
              ? latestIdentityType
              : stage0IdentityTypeHint;
          const shouldPreserveAuthoritativeSource =
            Boolean(effectiveAuthoritativeSourceType) &&
            Boolean(effectiveAuthoritativeIdentityType) &&
            (latestSourceTypeFinal || stage0AuthoritativeWinner);
          const degradedSourceType =
            shouldPreserveAuthoritativeSource && effectiveAuthoritativeSourceType
              ? effectiveAuthoritativeSourceType
              : "web";
          const degradedSourceTypeFinal = latestSourceTypeFinal && shouldPreserveAuthoritativeSource;
          const degradedAuthoritativeIdentity =
            shouldPreserveAuthoritativeSource &&
              stage0IdentityTypeHint &&
              activeStage0IdentityValueHint
              ? { type: stage0IdentityTypeHint, value: activeStage0IdentityValueHint }
              : baseSkeleton.meta.authoritativeIdentity;
          const candidateDigest = candidateBackfillDigest;
          const candidateFactsAvailable = Boolean(candidateDigest);
          const candidateIngredientsCover = candidateDigest ? buildIngredientsCover(candidateDigest) : null;
          const candidateScheduleFromLabel =
            candidateDigest?.labelDosing.map((dose) => ({
              population: dose.population ?? null,
              age: dose.age ?? null,
              dose: dose.dose ?? null,
              frequency: dose.frequency ?? null,
              rawText: dose.rawText ?? null,
              basisTags: ["label_fact" as const],
            })) ?? [];
          const candidateWarningItems =
            candidateDigest?.warnings.warnings.map((warning: string) =>
              buildSectionBullet(warning, ["label_fact" as const]),
            ) ?? [];
          const candidateFactBullets =
            candidateIngredientsCover?.items.slice(0, 2).map((item) => {
              const doseText =
                item.dose && item.dose.trim().length > 0
                  ? ` ${item.dose.trim()}`
                  : "";
              return buildSectionBullet(`Candidate LNHPD fact: ${item.name}${doseText}.`, ["label_fact"]);
            }) ?? [];
          const limitedBundle: AnalysisBundle = {
            ...baseSkeleton,
            meta: {
              ...baseSkeleton.meta,
              sourceType: degradedSourceType,
              sourceTypeFinal: degradedSourceTypeFinal,
              authoritativeIdentity: degradedAuthoritativeIdentity,
              detailReady: false,
              fallbackReason: fallbackCode,
            },
            sections: {
              ...baseSkeleton.sections,
              overview: {
                ...baseSkeleton.sections.overview,
                cover: {
                  summary: limitedSummary,
                  bullets: [
                    buildSectionBullet(
                      getDegradedReasonCopy(reasonCode),
                      ["general_advice"],
                    ),
                    ...(candidateFactsAvailable
                      ? [
                          buildSectionBullet(
                            "Candidate NPN lookup recovered label facts, but final authoritative match is still pending.",
                            ["label_fact"],
                          ),
                        ]
                      : []),
                    buildSectionBullet(
                      "Use the Supplement Facts and Directions panels for final confirmation.",
                      ["general_advice"],
                    ),
                    ...candidateFactBullets,
                  ],
                },
                  detail: {
                    summary: limitedSummary,
                    bullets: [
                      buildSectionBullet(
                        `Terminal reason: ${reasonCode}.`,
                        ["general_advice"],
                      ),
                    ],
                },
                dataStatus: "limited",
              },
              ingredients: {
                ...baseSkeleton.sections.ingredients,
                cover: candidateIngredientsCover ?? baseSkeleton.sections.ingredients.cover,
                detail: null,
                dataStatus: candidateFactsAvailable ? "complete" : "limited",
              },
              usage: {
                ...baseSkeleton.sections.usage,
                detail: {
                  ...(baseSkeleton.sections.usage.detail ?? {
                    timingRationale: null,
                    withFoodRationale: null,
                    scheduleFromLabel: [],
                  }),
                  scheduleFromLabel:
                    candidateScheduleFromLabel.length > 0
                      ? candidateScheduleFromLabel
                      : baseSkeleton.sections.usage.detail?.scheduleFromLabel ?? [],
                },
                dataStatus: candidateFactsAvailable ? "complete" : "limited",
              },
              safety: {
                ...baseSkeleton.sections.safety,
                detail: {
                  ...(baseSkeleton.sections.safety.detail ?? {
                    warnings: [],
                    consultDoctorIf: [],
                    redFlags: [],
                  }),
                  warnings:
                    candidateWarningItems.length > 0
                      ? candidateWarningItems
                      : baseSkeleton.sections.safety.detail?.warnings ?? [],
                },
                dataStatus: candidateFactsAvailable ? "complete" : "limited",
              },
            },
          };
          emitRev1Once(limitedBundle, "fallback", fallbackCode);
        }
      }
      if (!streamState.clientDisconnected && !res.writableEnded) {
        const evidence = {
          streamAnalysisBundleOnly,
          bundleOnlySkipWebSearch: BUNDLE_ONLY_SKIP_WEB_SEARCH,
          stage0Winner: activeStage0Winner,
          budgetGuardTriggered,
          eventLoopGuardTriggered,
        };
        sendSSE(res, "error", {
          schemaVersion: 1,
          code: "STREAM_DEGRADED",
          stage: reasonCode === "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH" ? "bundle_only" : "watchdog",
          reasonCode,
          retryable: true,
          requestId: requestId || null,
          message: "Scan degraded to limited mode",
          evidence,
        });
      }
      // If we emitted a usable degraded rev1 for full-lane fallback, stale negative-cache
      // entries should not remain active for this barcode.
      if (reasonCode === "DEGRADED_WEB_BUDGET" || reasonCode === "DEGRADED_EVENTLOOP") {
        const degradedBarcodeGtin14 =
          (streamBarcode ? streamBarcode.padStart(14, "0") : null) ??
          (normalized ? normalized.code.padStart(14, "0") : null);
        if (degradedBarcodeGtin14) {
          clearNegativeCacheAllVariants(degradedBarcodeGtin14, rawBarcode, {
            context: `degraded_${reasonCode.toLowerCase()}`,
          });
        }
      }
      finalizeStream(`degraded_${reasonCode.toLowerCase()}`);
    } catch (error) {
      console.error("[enrich-stream] degraded fallback failed", {
        requestId: requestId || null,
        reasonCode,
        error: error instanceof Error ? error.message : String(error),
      });
      emitTerminalErrorAndFinalize({
        schemaVersion: 1,
        code: "STREAM_TIMEOUT",
        stage: "watchdog",
        reasonCode: "DEGRADED_FALLBACK_FAILED",
        retryable: true,
        message: "Degraded fallback failed before a terminal revision was produced.",
        finalizeReason: "degraded_fallback_failed",
        releaseError: error,
      });
    }
  };
  const withAdmissionCoreFallbackBudget = async <T>(
    promise: Promise<T>,
    budgetMs: number,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError("admission_core_fallback_budget_exhausted"));
      }, Math.max(1, budgetMs));
      (timer as { unref?: () => void }).unref?.();
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
  const normalizeOverlayDigestText = (value: unknown): string | null => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text : null;
  };
  const buildOverlayIngredientText = (overlayClaims: DecisionSupportOverlayClaims): string | null => {
    const factLines = (Array.isArray(overlayClaims?.nutritionalFacts) ? overlayClaims.nutritionalFacts : [])
      .map((fact: Record<string, unknown>) =>
        [
          normalizeOverlayDigestText(fact?.substancy),
          normalizeOverlayDigestText(fact?.amountPerServing),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .map((line: string) => normalizeOverlayDigestText(line))
      .filter((line: string | null): line is string => Boolean(line));
    if (factLines.length > 0) return factLines.join("\n");
    return normalizeOverlayDigestText(overlayClaims?.otherIngredients);
  };
  const buildIherbOverlayFactsDigestForBarcode = (
    overlayClaims: DecisionSupportOverlayClaims | null,
    barcodeGtin14: string,
  ): FactsDigest | null => {
    if (!overlayClaims) return null;
    const ingredientText = buildOverlayIngredientText(overlayClaims);
    const title = normalizeOverlayDigestText(overlayClaims.title);
    const brandName = normalizeOverlayDigestText(overlayClaims.brandName);
    const suggestedUse = normalizeOverlayDigestText(overlayClaims.suggestedUse);
    const warnings = normalizeOverlayDigestText(overlayClaims.warnings);
    const servingSize = normalizeOverlayDigestText(overlayClaims.servingSize);
    const hasUsableOverlayFacts = Boolean(
      title ||
      brandName ||
      ingredientText ||
      suggestedUse ||
      warnings ||
      servingSize,
    );
    if (!hasUsableOverlayFacts) return null;

    const canonicalDomain = (() => {
      const link = normalizeOverlayDigestText(overlayClaims.link);
      if (!link) return null;
      try {
        return new URL(link).hostname;
      } catch {
        return null;
      }
    })();

    return buildFactsDigestFromWeb({
      facts: {
        barcode: overlayClaims.barcodeGtin14 ?? barcodeGtin14,
        canonical: {
          name: title,
          brand: brandName,
          url: normalizeOverlayDigestText(overlayClaims.link),
          domain: canonicalDomain,
        },
        identifiers: { npn: null },
        textFacts: {
          ingredientsText: ingredientText,
          directionsText: suggestedUse,
          warningsText: warnings,
          servingSizeText: servingSize,
        },
        coverageScore: 100,
        missingFields: [],
      },
      identityType: "gtin14",
      identityValue: barcodeGtin14,
      regionTags: ["us"],
    });
  };
  const emitAdmissionCoreFallbackAndFinalize = async (
    reasonCode: "QUEUE_FULL" | "QUEUE_WAIT_TIMEOUT" | "PRE_REV1_PRESSURE_GUARD" | "PRE_REV1_TERMINAL_GUARD",
  ): Promise<boolean> => {
    if (streamAnalysisBundleOnly) return false;
    if (!normalized) return false;
    if (streamState.doneSent || streamState.ended || streamState.clientDisconnected || res.writableEnded) return true;

    const fallbackCode = `admission_core_fallback_${reasonCode.toLowerCase()}`;
    const barcodeGtin14 = normalized.code.padStart(14, "0");
    streamBarcode = normalized.code;
    terminalReason = fallbackCode;

    try {
      const overlayClaims = await withAdmissionCoreFallbackBudget(
        fetchIherbOverlayClaimsByBarcode(barcodeGtin14),
        ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
      ).catch(() => null);
      const overlayDigest = buildIherbOverlayFactsDigestForBarcode(overlayClaims, barcodeGtin14);
      if (overlayDigest) {
        const identityType: FactsIdentityType = "gtin14";
        const identityValue = barcodeGtin14;
        const factsDigestHash = computeFactsDigestHash(overlayDigest);
        const deterministicSignals = DETERMINISTIC_SIGNALS_PRIMARY
          ? extractDeterministicSignalPack({
            sourceRole: overlayDigest.sourceType,
            digest: overlayDigest,
          })
          : null;
        const productIdentity = buildProductIdentityFromDigest({
          digest: overlayDigest,
          identityType,
          identityValue,
          sourceTypeFinal: false,
        });
        rememberStreamProductIdentity(productIdentity);
        const fallbackBundle = buildAnalysisBundleSkeleton({
          digest: overlayDigest,
          deterministicSignals,
          bundleId,
          revision: 1,
          phase: "fast_ai",
          locale: streamLocale,
          factsDigestHash,
          factsSourceVersion: `iherb_overlay:${overlayClaims?.productId ?? barcodeGtin14}`,
          identityType,
          identityValue,
          dataStatus: {
            overview: "limited",
            usage: "limited",
            safety: "limited",
          },
          overlayClaims,
          includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
        });
        emitRev1Once(
          {
            ...fallbackBundle,
            meta: {
              ...fallbackBundle.meta,
              productIdentity: productIdentity ?? fallbackBundle.meta.productIdentity,
              sourceTypeFinal: false,
              detailReady: overlayDigest.actives.length > 0,
              fallback: { code: fallbackCode },
              fallbackReason: fallbackCode,
              admissionFallback: {
                reasonCode,
                budgetMs: ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
                source: "iherb_overlay",
              },
            },
          },
          "fallback",
          fallbackCode,
        );
        if (!streamState.rev1Sent) return false;
        finalizeStream(fallbackCode);
        return true;
      }

      const quickDigest = await withAdmissionCoreFallbackBudget(
        buildMySupplementDigestQuick({
          supplementId: barcodeGtin14,
          barcode: normalized.code,
          brandName: "",
          productName: "",
          budgetMs: ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
        }),
        ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
      );
      const digest = quickDigest.digest;
      const identityType = digest.identity.type;
      const identityValue = String(digest.identity.value || barcodeGtin14);
      const deterministicSignals = DETERMINISTIC_SIGNALS_PRIMARY
        ? extractDeterministicSignalPack({
          sourceRole: digest.sourceType,
          digest,
        })
        : null;
      const fallbackBundle = buildAnalysisBundleSkeleton({
        digest,
        deterministicSignals,
        bundleId,
        revision: 1,
        phase: "fast_ai",
        locale: streamLocale,
        factsDigestHash: quickDigest.factsDigestHash || computeFactsDigestHash(digest),
        factsSourceVersion: quickDigest.factsSourceVersion,
        identityType,
        identityValue,
        dataStatus: {
          overview: "limited",
          usage: "limited",
          safety: "limited",
        },
        overlayClaims: null,
        includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
      });
      emitRev1Once(
        {
          ...fallbackBundle,
          meta: {
            ...fallbackBundle.meta,
            sourceTypeFinal: digest.sourceType === "lnhpd" || digest.sourceType === "dsld",
            detailReady: digest.actives.length > 0,
            fallback: { code: fallbackCode },
            fallbackReason: fallbackCode,
            admissionFallback: {
              reasonCode,
              budgetMs: ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
            },
          },
        },
        "fallback",
        fallbackCode,
      );
    } catch (error) {
      console.warn("[enrich-stream] admission core fallback used provisional bundle", {
        requestId: requestId || null,
        reasonCode,
        error: error instanceof Error ? error.message : String(error),
      });
      const provisionalBundle = buildProvisionalAnalysisBundle({
        bundleId,
        locale: streamLocale,
        barcodeGtin14,
        revision: 1,
        phase: "fast_ai",
        fallbackReason: fallbackCode,
      });
      emitRev1Once(
        {
          ...provisionalBundle,
          meta: {
            ...provisionalBundle.meta,
            admissionFallback: {
              reasonCode,
              budgetMs: ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS,
            },
          },
        },
        "fallback",
        fallbackCode,
      );
    }

    if (!streamState.rev1Sent) return false;
    finalizeStream(fallbackCode);
    return true;
  };
  const maybeDegradeForEventLoopLag = (): boolean => {
    sampleRequestLag();
    if (eventLoopLagP95DuringRequest <= EVENT_LOOP_LAG_P95_THRESHOLD_MS) {
      return false;
    }
    if (streamState.doneSent || streamState.ended || res.writableEnded) {
      return true;
    }
    if (!degradedMode) {
      emitDegradedLimitedRev1AndFinalize("DEGRADED_EVENTLOOP");
    }
    return true;
  };
  res.on("close", () => {
    streamState.clientDisconnected = true;
    abortPipelineOnce(new Error("client_disconnected"));
    if (ENRICH_STREAM_CLIENT_DISCONNECT_GRACE_MS <= 0) {
      releaseInFlightOnce(new Error("client_disconnected"));
      releaseAdmissionOnce();
    } else if (!disconnectReleaseTimer) {
      disconnectReleaseTimer = setTimeout(() => {
        disconnectReleaseTimer = null;
        releaseInFlightOnce(new Error("client_disconnected"));
        releaseAdmissionOnce();
      }, ENRICH_STREAM_CLIENT_DISCONNECT_GRACE_MS);
      (disconnectReleaseTimer as { unref?: () => void }).unref?.();
    }
    clearWatchdogs();
  });
  res.on("finish", clearWatchdogs);
  res.on("finish", clearDisconnectReleaseTimer);

  try {
    const inFlightCount = barcodeEnrichInFlight.size;
    if (
      shouldRejectEnrichStreamForServerOverload({
        inFlightCount,
        overloadInflightThreshold: ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD,
      })
    ) {
      emitStreamBusyAndFinalize("SERVER_OVERLOAD");
      return;
    }

    const admissionWaitMs = Math.max(
      0,
      Math.min(streamAdmissionQueueWaitMs, globalDeadlineAt - Date.now()),
    );
    try {
      const admissionLease = await streamAdmissionGate.acquire({
        signal: requestAbort.signal,
        waitMs: admissionWaitMs,
      });
      releaseAdmission = admissionLease.release;
      const admissionStateAfterAcquire = streamAdmissionGate.getState();
      const hasImmediatePressureFallbackDemand =
        admissionStateAfterAcquire.queue > 0 ||
        (!isRegressionRequest && admissionStateAfterAcquire.active >= admissionStateAfterAcquire.maxActive);
      const shouldUseImmediatePressureFallback =
        !streamAnalysisBundleOnly
        && hasImmediatePressureFallbackDemand;
      if (shouldUseImmediatePressureFallback) {
        const fallbackEmitted = await emitAdmissionCoreFallbackAndFinalize("PRE_REV1_PRESSURE_GUARD");
        if (fallbackEmitted) {
          return;
        }
      }
    } catch (error) {
      if (error instanceof EnrichStreamAdmissionError && error.code === "ABORTED") {
        return;
      }
      const reasonCode =
        error instanceof EnrichStreamAdmissionError && error.code === "QUEUE_FULL"
          ? "QUEUE_FULL"
          : "QUEUE_WAIT_TIMEOUT";
      if (reasonCode === "QUEUE_WAIT_TIMEOUT" || reasonCode === "QUEUE_FULL") {
        const fallbackEmitted = await emitAdmissionCoreFallbackAndFinalize(reasonCode);
        if (fallbackEmitted) {
          return;
        }
      }
      emitStreamBusyAndFinalize(reasonCode);
      return;
    }

    if (!normalized) {
      emitTerminalErrorAndFinalize({
        code: "INVALID_BARCODE",
        stage: "input",
        reasonCode: "INVALID_BARCODE",
        retryable: false,
        message: "Invalid barcode provided",
        finalizeReason: "invalid_barcode",
      });
      return;
    }
    const barcode = normalized.code;
    streamBarcode = barcode;
    const cacheKey = buildBarcodeCacheKey(barcode);
    const barcodeGtin14 = normalized.code.padStart(14, "0");
    const barcodeRawDigits = normalized.code;
    let overlayClaimsForBarcodePromise: Promise<DecisionSupportOverlayClaims | null> | null = null;
    const getOverlayClaimsForBarcode = (): Promise<DecisionSupportOverlayClaims | null> => {
      if (!overlayClaimsForBarcodePromise) {
        overlayClaimsForBarcodePromise = fetchIherbOverlayClaimsByBarcode(barcodeGtin14);
      }
      return overlayClaimsForBarcodePromise;
    };
    const buildIherbOverlayFactsDigest = (
      overlayClaims: DecisionSupportOverlayClaims | null,
    ): FactsDigest | null => buildIherbOverlayFactsDigestForBarcode(overlayClaims, barcodeGtin14);
    const authorityRegressionScenarioActive =
      isRegressionLikeRequest &&
      barcodeGtin14 === AUTHORITY_REGRESSION_SAMPLE_BARCODE;
    const lnhpdRuntimeEnabledForRequest = LNHPD_RUNTIME_ENABLED || authorityRegressionScenarioActive;

    let regulatoryMapStatus: "hit" | "stale" | "miss" | "timeout" = "miss";
    let regMapPrimaryAttempted = false;
    let regMapPrimaryStatus: "hit" | "stale" | "miss" | "timeout" = "miss";
    let regMapSecondChanceAttempted = false;
    let regMapSecondChanceResult: "not_attempted" | "hit" | "miss" | "timeout" | "error" = "not_attempted";
    let regMapSecondChanceLatencyMs: number | null = null;
    let npnCandidateSource: "map" | "snapshot" | "scan_history" | "name_match" | "web" | null = null;
    let npnCandidateStale = false;
    let npnNegativeCacheHit = false;
    let lnhpdGuardrailScore: number | null = null;
    let lnhpdGuardrailPass: boolean | null = null;
    let lnhpdFetchStatus: "success" | "not_found" | "timeout" | "error" | null = null;
    let authorityCandidateSource: "map" | "map_stale" | "snapshot" | "scan_history" | "name_match" | "web" | null = null;
    let authorityLnhpdAttempt1Status: LnhpdLookupStatus = "not_attempted";
    let authorityLnhpdAttempt2Status: LnhpdLookupStatus = "not_attempted";
    let authorityFailureReason: AuthorityFailureReason | null = null;
    let authorityNegativeCacheBypassed = false;
    let authorityRegressionScenarioHistoricalNpn: string | null = null;
    const budget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
    const streamAbort = new AbortController();
    streamAbortController = streamAbort;
    const { signal: requestSignal, cleanup } = combineSignals([
      requestAbort.signal,
      streamAbort.signal,
    ]);
    cleanupRequestSignal = cleanup;
    startLagSampler();
    const armContractWatchdogs = () => {
      if (!streamState.rev0Sent) {
        const rev0FallbackDelayMs = streamAnalysisBundleOnly
          ? ENRICH_STREAM_REV0_FALLBACK_DELAY_MS_BUNDLE_ONLY
          : ENRICH_STREAM_REV0_FALLBACK_DELAY_MS;
        setTimeout(() => {
          if (streamState.rev0Sent || res.writableEnded || streamState.clientDisconnected) return;
          emitRev0Once(
            buildProvisionalAnalysisBundle({
              bundleId,
              locale: streamLocale,
              barcodeGtin14,
              revision: 0,
              phase: "skeleton",
            }),
          );
        }, rev0FallbackDelayMs);
      }
      if (!fastWatchdog) {
        const fastMs = Math.max(250, ANALYSIS_BUNDLE_FAST_TIMEOUT_MS + SSE_FAST_GRACE_MS);
        fastWatchdog = setTimeout(() => {
          if (streamState.rev1Sent || res.writableEnded || streamState.clientDisconnected) return;
          sendSSE(res, "status", {
            stage: "watchdog_fast_timeout",
            message: "Fast analysis timed out; waiting for remaining pipeline.",
            retryable: true,
          });
        }, fastMs);
      }
      if (!globalWatchdog) {
        const remainingMs = globalDeadlineAt - Date.now();
        if (remainingMs <= 0) {
          emitTerminalErrorAndFinalize({
            code: "STREAM_TIMEOUT",
            stage: "watchdog",
            reasonCode: "GLOBAL_TIMEOUT_REV0_ONLY",
            retryable: true,
            message: "Stream timed out before a usable result was produced.",
            finalizeReason: "global_timeout_rev0_only",
            releaseError: new Error("stream_timeout"),
          });
          return;
        }
        globalWatchdog = setTimeout(() => {
          if (streamState.ended || res.writableEnded || streamState.clientDisconnected) return;
          if (!streamState.rev1Sent) {
            emitTerminalErrorAndFinalize({
              code: "STREAM_TIMEOUT",
              stage: "watchdog",
              reasonCode: "GLOBAL_TIMEOUT_REV0_ONLY",
              retryable: true,
              message: "Stream timed out before a usable result was produced.",
              finalizeReason: "global_timeout_rev0_only",
              releaseError: new Error("stream_timeout"),
            });
            return;
          }
          finalizeStream("global_timeout_after_rev1");
        }, Math.max(1, remainingMs));
      }
      if (streamAnalysisBundleOnly && !bundleOnlyTerminalGuardTimer) {
        const remainingMs = globalDeadlineAt - Date.now();
        if (remainingMs > 0) {
          const bundleOnlyGuardMs = Math.max(
            1,
            Math.min(ENRICH_STREAM_BUNDLE_ONLY_TERMINAL_GUARD_MS, remainingMs),
          );
          bundleOnlyTerminalGuardTimer = setTimeout(() => {
            bundleOnlyTerminalGuardTimer = null;
            if (streamState.ended || streamState.doneSent || res.writableEnded || streamState.clientDisconnected) return;
            if (!streamState.rev1Sent) {
              emitDegradedLimitedRev1AndFinalize("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH");
              return;
            }
            finalizeStream(terminalReason ?? "analysis_bundle_only_terminal_guard");
          }, bundleOnlyGuardMs);
          (bundleOnlyTerminalGuardTimer as { unref?: () => void }).unref?.();
        }
      }
      if (!streamAnalysisBundleOnly && !fullPressureCoreFallbackTimer) {
        fullPressureCoreFallbackTimer = setTimeout(() => {
          fullPressureCoreFallbackTimer = null;
          if (streamState.rev1Sent || streamState.doneSent || streamState.ended || res.writableEnded || streamState.clientDisconnected) return;
          const admissionState = streamAdmissionGate.getState();
          const hasQueuedPressureFallbackDemand = admissionState.queue > 0;
          const hasActivePressureFallbackDemand =
            !isRegressionRequest && admissionState.active >= admissionState.maxActive;
          if (!hasQueuedPressureFallbackDemand && !hasActivePressureFallbackDemand) return;
          void emitAdmissionCoreFallbackAndFinalize("PRE_REV1_PRESSURE_GUARD");
        }, ENRICH_STREAM_FULL_PRESSURE_CORE_FALLBACK_GUARD_MS);
        (fullPressureCoreFallbackTimer as { unref?: () => void }).unref?.();
      }
      if (!streamAnalysisBundleOnly && !fullPreRev1TerminalGuardTimer) {
        const remainingMs = globalDeadlineAt - Date.now();
        if (remainingMs > 0) {
          const preRev1GuardBudgetMs = isCrashCanaryRequest
            ? Math.min(
                ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS,
                ENRICH_STREAM_CRASH_CANARY_PRE_REV1_TERMINAL_GUARD_MS,
              )
            : ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS;
          const fullPreRev1GuardMs = Math.max(
            1,
            Math.min(preRev1GuardBudgetMs, remainingMs),
          );
          fullPreRev1TerminalGuardTimer = setTimeout(async () => {
            try {
              fullPreRev1TerminalGuardTimer = null;
              if (streamState.ended || streamState.doneSent || res.writableEnded || streamState.clientDisconnected) return;
              if (streamState.rev1Sent) return;
              // Crash canary focuses on terminal liveness, not scoring completeness.
              // If we approach the canary guard without rev1, force an explainable terminal revision.
              if (isCrashCanaryRequest) {
                emitDegradedLimitedRev1AndFinalize("DEGRADED_WEB_BUDGET");
                return;
              }
              const fallbackEmitted = await emitAdmissionCoreFallbackAndFinalize("PRE_REV1_TERMINAL_GUARD");
              if (fallbackEmitted) {
                return;
              }
              emitTerminalErrorAndFinalize({
                code: "STREAM_TIMEOUT",
                stage: "watchdog",
                reasonCode: "FULL_REV1_MISSING_GUARD_TIMEOUT",
                retryable: true,
                message: "Stream reached terminal guard before revision 1 was produced.",
                finalizeReason: "full_pre_rev1_guard_timeout",
                releaseError: new Error("full_pre_rev1_guard_timeout"),
              });
            } catch (error) {
              console.error("[enrich-stream] full pre-rev1 guard failed", {
                requestId: requestId || null,
                error: error instanceof Error ? error.message : String(error),
              });
              emitTerminalErrorAndFinalize({
                code: "STREAM_TIMEOUT",
                stage: "watchdog",
                reasonCode: "FULL_PRE_REV1_GUARD_INTERNAL_ERROR",
                retryable: true,
                message: "Stream pre-revision guard failed while building terminal fallback.",
                finalizeReason: "full_pre_rev1_guard_internal_error",
                releaseError: error,
              });
            }
          }, fullPreRev1GuardMs);
          (fullPreRev1TerminalGuardTimer as { unref?: () => void }).unref?.();
        }
      }
      if (!hardTerminalWatchdog) {
        const remainingMs = globalDeadlineAt - Date.now();
        const hardMs = Math.max(
          1,
          Math.min(
            ENRICH_STREAM_HARD_TERMINAL_FALLBACK_MS,
            Number.isFinite(remainingMs) && remainingMs > 0 ? remainingMs : ENRICH_STREAM_HARD_TERMINAL_FALLBACK_MS,
          ),
        );
        hardTerminalWatchdog = setTimeout(() => {
          try {
            hardTerminalWatchdog = null;
            if (streamState.ended || streamState.doneSent || res.writableEnded || streamState.clientDisconnected) return;
            console.warn("[enrich-stream] hard terminal fallback triggered", {
              requestId: requestId || null,
              barcode: streamBarcode ?? normalized?.code ?? null,
              rev0Sent: streamState.rev0Sent,
              rev1Sent: streamState.rev1Sent,
              sourceType: streamState.latestSourceType,
              stage0Winner: activeStage0Winner,
              stage0StartCount,
              stage0ReplaceCount,
            });
            if (!streamState.rev1Sent) {
              emitDegradedLimitedRev1AndFinalize(
                streamAnalysisBundleOnly ? "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH" : "DEGRADED_WEB_BUDGET",
              );
              return;
            }
            finalizeStream("hard_terminal_fallback_after_rev1");
          } catch (error) {
            console.error("[enrich-stream] hard terminal watchdog failed", {
              requestId: requestId || null,
              error: error instanceof Error ? error.message : String(error),
            });
            emitTerminalErrorAndFinalize({
              code: "STREAM_TIMEOUT",
              stage: "watchdog",
              reasonCode: "HARD_TERMINAL_WATCHDOG_INTERNAL_ERROR",
              retryable: true,
              message: "Hard terminal watchdog failed before finalization completed.",
              finalizeReason: "hard_terminal_watchdog_internal_error",
              releaseError: error,
            });
          }
        }, hardMs);
        (hardTerminalWatchdog as { unref?: () => void }).unref?.();
      }
    };
    armContractWatchdogs();
    requestId = String(res.getHeader("x-request-id") ?? "");
    logSseLifecycle({
      requestId: requestId || null,
      phase: "connected",
      barcode: streamBarcode || null,
      bundleOnly: streamAnalysisBundleOnly,
    });
    if (maybeDegradeForEventLoopLag()) {
      releaseInFlightOnce(new Error("degraded_eventloop"));
      releaseAdmissionOnce();
      return;
    }
    const requestPath = req.path;
    const headerClientVersion =
      typeof req.headers["x-client-version"] === "string" ? req.headers["x-client-version"].trim() : "";
    const headerAppVersion =
      typeof req.headers["x-app-version"] === "string" ? req.headers["x-app-version"].trim() : "";
    const bodyClientVersion =
      typeof parsedBody.clientVersion === "string" ? parsedBody.clientVersion.trim() : "";
    const clientVersion = headerClientVersion || headerAppVersion || bodyClientVersion || null;
    const v2Enabled = !(process.env.V2_ENGINE_ENABLE === "0" || process.env.V2_ENGINE_ENABLE === "false");
    const shadowCompareEnabled =
      process.env.SHADOW_COMPARE_ENABLE === "1" || process.env.SHADOW_COMPARE_ENABLE === "true";
    const deviceId = parsedBody.deviceId ?? null;
    const buildAuthorityMeta = (extra?: Record<string, unknown>) => ({
      reg_map_primary_status: regMapPrimaryStatus,
      reg_map_primary_attempted: regMapPrimaryAttempted,
      reg_map_second_chance_attempted: regMapSecondChanceAttempted,
      reg_map_second_chance_result: regMapSecondChanceResult,
      reg_map_second_chance_latency_ms: regMapSecondChanceLatencyMs,
      mapping_miss: regMapPrimaryAttempted ? isRegulatoryMapMiss(regulatoryMapStatus) : false,
      regulatory_map_status: regulatoryMapStatus,
      npn_candidate_source: npnCandidateSource,
      npn_candidate_stale: npnCandidateStale,
      npn_negative_cache_hit: npnNegativeCacheHit,
      lnhpd_guardrail_score: lnhpdGuardrailScore,
      lnhpd_guardrail_pass: lnhpdGuardrailPass,
      lnhpd_fetch_status: lnhpdFetchStatus,
      authorityCandidateSource,
      authorityLnhpdAttempt1Status,
      authorityLnhpdAttempt2Status,
      authorityFailureReason,
      authorityNegativeCacheBypassed,
      authorityFailMode,
      authority_candidate_source: authorityCandidateSource,
      authority_lnhpd_attempt_1_status: authorityLnhpdAttempt1Status,
      authority_lnhpd_attempt_2_status: authorityLnhpdAttempt2Status,
      authority_failure_reason: authorityFailureReason,
      authority_negative_cache_bypassed: authorityNegativeCacheBypassed,
      authority_regression_sample_active: authorityRegressionScenarioActive,
      sse_contract: {
        rev0_sent: streamState.rev0Sent,
        rev1_sent: streamState.rev1Sent,
        persisted_sent: streamState.persistedSent,
        done_sent: streamState.doneSent,
        rev1_source: streamState.rev1Source,
        rev0_at_ms: streamState.tRev0,
        rev1_at_ms: streamState.tRev1,
        persisted_at_ms: streamState.tPersisted,
        done_at_ms: streamState.tDone,
      },
      stream_stability: buildStabilityMeta(),
      ...(extra ?? {}),
    });
    const withAuthorityDiagnostics = (bundle: AnalysisBundle): AnalysisBundle => {
      const meta = {
        ...bundle.meta,
        authorityCandidateSource: authorityCandidateSource ?? undefined,
        authorityLnhpdAttempt1Status,
        authorityLnhpdAttempt2Status,
        authorityFailureReason: authorityFailureReason ?? undefined,
        authorityNegativeCacheBypassed,
        authority_candidate_source: authorityCandidateSource ?? undefined,
        authority_lnhpd_attempt_1_status: authorityLnhpdAttempt1Status,
        authority_lnhpd_attempt_2_status: authorityLnhpdAttempt2Status,
        authority_failure_reason: authorityFailureReason ?? undefined,
        authority_negative_cache_bypassed: authorityNegativeCacheBypassed,
        npn_candidate_source: npnCandidateSource ?? undefined,
        reg_map_primary_status: regMapPrimaryStatus,
        reg_map_second_chance_attempted: regMapSecondChanceAttempted,
        reg_map_second_chance_result: regMapSecondChanceResult,
        authority_regression_sample_active: authorityRegressionScenarioActive || undefined,
      } as AnalysisBundle["meta"] & Record<string, unknown>;
      return {
        ...bundle,
        meta,
      };
    };

    const emitAnalysisBundleSequence = async (params: {
      digest: FactsDigest;
      identityType: FactsDigest["identity"]["type"];
      identityValue: string;
      factsSourceVersion: string;
      allowAi: boolean;
      apiKey: string | null;
      signal?: AbortSignal;
      isRunActive?: () => boolean;
    }): Promise<{ factsDigestHash: string } | null> => {
      const factsDigestHash = computeFactsDigestHash(params.digest);
      const deterministicSignals = DETERMINISTIC_SIGNALS_PRIMARY
        ? extractDeterministicSignalPack({
          sourceRole: params.digest.sourceType,
          digest: params.digest,
        })
        : null;
      const maybePrewarmDsldDetail = () => {
        // P0 UX: DSLD ingredients detail should feel "instant". We already return a 0-LLM Base page
        // on /api/analysis-section; here we opportunistically prewarm the optional minimal enrichment
        // (whatItDoes/summary) after fast_ai is emitted so the modal is likely complete when opened.
        if (params.digest.sourceType !== "dsld") return;
        if (!params.allowAi || !params.apiKey) return;
        if (!Array.isArray(params.digest.actives) || params.digest.actives.length === 0) return;

        const requestedLimit = ANALYSIS_DETAIL_LIMIT_DSLD;
        const cursor = 0;
        const sectionKey = `ingredients_detail:${requestedLimit}:${cursor}`;

        // Mirror /api/analysis-section caching dimension: incorporate production KB package signature so
        // detail pages can refresh when the shipped KB changes (even when the LLM output is unchanged).
        let promptVersionForCache = ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED;
        const kb = getKbRuntime();
        const pkgSha = kb?.runtime?.meta?.package_sha256;
        if (typeof pkgSha === "string" && pkgSha.trim()) {
          promptVersionForCache = `${promptVersionForCache}|kb:${pkgSha.trim().slice(0, 12)}`;
        }
        const rateKey = `${params.identityType}:${params.identityValue}:${locale}:${promptVersionForCache}:${sectionKey}`;

        queueDsldDetailEnrichment({
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale,
          promptVersionForCache,
          factsDigestHash,
          factsSourceVersion: params.factsSourceVersion,
          sectionKey,
          rateKey,
          digestRowFactsDigestJson: params.digest,
          digest: params.digest,
          requestedLimit,
          cursor,
          model,
          deepseekKey: params.apiKey,
        });
      };
      const canWrite = () =>
        !params.signal?.aborted &&
        !res.writableEnded &&
        (params.isRunActive ? params.isRunActive() : true);
      const digestProductIdentity = buildProductIdentityFromDigest({
        digest: params.digest,
        identityType: params.identityType,
        identityValue: params.identityValue,
        sourceTypeFinal: false,
      });
      rememberStreamProductIdentity(digestProductIdentity);
      const dataStatus = params.allowAi
        ? { overview: "pending" as const, usage: "pending" as const, safety: "pending" as const }
        : { overview: "limited" as const, usage: "limited" as const, safety: "limited" as const };
      const overlayClaims = (() => {
        const fromStreamBarcode = normalizeBarcodeToGtin14(streamBarcode);
        if (fromStreamBarcode) return fromStreamBarcode;
        if (params.identityType === "gtin14") {
          return normalizeBarcodeToGtin14(params.identityValue);
        }
        if (params.digest.identity.type === "gtin14") {
          return normalizeBarcodeToGtin14(params.digest.identity.value);
        }
        return null;
      })();
      const overlayClaimsByBarcode = overlayClaims
        ? await fetchIherbOverlayClaimsByBarcode(overlayClaims)
        : null;
      // shared-store contract:
      // - persisted is emitted only after bundle_fast is committed
      // - /api/analysis-section reads from the same shared store keyspace
      const emitPersistedWhenReady = async (bundle: AnalysisBundle): Promise<boolean> => {
        if (streamState.persistedSent || !canWrite()) return false;
        try {
          await upsertAnalysisIdentityCache(
            {
              identityType: params.identityType,
              identityValue: params.identityValue,
              locale,
              promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
              factsDigestHash,
              factsSourceVersion: params.factsSourceVersion,
              section: "bundle_fast",
              status: "complete",
              payload: bundle,
              factsDigestJson: params.digest,
              expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
            },
            { timeoutMs: 900 },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[analysis_bundle] shared-store commit failed before persisted", message);
          return false;
        }

        if (!canWrite()) return false;
        const persistedPayload = buildPersistedEventFromBundle(bundle);
        if (!persistedPayload) return false;
        sendSSE(res, "persisted", persistedPayload);
        streamState.persistedSent = true;
        streamState.tPersisted = Date.now();
        return true;
      };
      const commitPersistedAfterRev1 = async (bundle: AnalysisBundle): Promise<void> => {
        // Web path must not keep the SSE stream open while waiting for shared-store commit.
        // Emit persisted best-effort in the background and let terminal done close promptly.
        const bundleOnlyAuthoritative =
          streamAnalysisBundleOnly
          && (params.identityType === "npn"
            || params.identityType === "dsldLabelId"
            || params.digest.sourceType === "lnhpd"
            || params.digest.sourceType === "dsld");
        if (params.digest.sourceType === "web" || bundleOnlyAuthoritative) {
          persistedCommitMode = "background_async";
          void emitPersistedWhenReady(bundle);
          return;
        }
        persistedCommitMode = "awaited";
        await emitPersistedWhenReady(bundle);
      };

      const skeletonBase = buildAnalysisBundleSkeleton({
        digest: params.digest,
        deterministicSignals,
        bundleId,
        revision: 0,
        phase: "skeleton",
        locale,
        factsDigestHash,
        factsSourceVersion: params.factsSourceVersion,
        identityType: params.identityType,
        identityValue: params.identityValue,
        dataStatus,
        overlayClaims: overlayClaimsByBarcode,
        includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
      });
      const skeleton = attachProductIdentityMeta({
        ...skeletonBase,
        meta: {
          ...skeletonBase.meta,
          productIdentity: digestProductIdentity ?? skeletonBase.meta.productIdentity,
        },
      }, digestProductIdentity);

      void upsertAnalysisIdentityCache(
        {
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale,
          promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
          factsDigestHash,
          factsSourceVersion: params.factsSourceVersion,
          section: "digest",
          status: "complete",
          payload: null,
          factsDigestJson: params.digest,
          expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
        },
        { timeoutMs: 900 },
      );

      const skeletonParsed = safeParseAnalysisBundle(skeleton);
      if (!skeletonParsed.success) {
        console.warn("[analysis_bundle] skeleton validation failed", skeletonParsed.error?.message);
      } else if (canWrite()) {
        emitRev0Once(skeletonParsed.data);
      }

      const skipCachedFastForBundleOnlyDeterministic =
        streamAnalysisBundleOnly && params.digest.sourceType !== "web" && params.allowAi === false;
      const skipCachedFastForFullDsldDeterministic =
        !streamAnalysisBundleOnly &&
        params.digest.sourceType === "dsld" &&
        params.allowAi === false;
      const skipCachedFastForDeterministicStage0 =
        skipCachedFastForBundleOnlyDeterministic || skipCachedFastForFullDsldDeterministic;
      if (skipCachedFastForFullDsldDeterministic) {
        console.info(
          "[analysis_bundle] dsld deterministic stage0 skipping cached fast",
          {
            requestId: requestId || null,
            identityType: params.identityType,
            identityValue: params.identityValue,
            factsDigestHash,
            sourceType: params.digest.sourceType,
          },
        );
      }
      let cachedFast = skipCachedFastForDeterministicStage0
        ? null
        : await getAnalysisIdentityCache(
          {
            identityType: params.identityType,
            identityValue: params.identityValue,
            locale,
            promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
            factsDigestHash,
            section: "bundle_fast",
          },
          { timeoutMs: 700 },
        ).catch(() => null);
      if (
        cachedFast?.payload &&
        typeof cachedFast.payload === "object" &&
        overlayClaimsByBarcode &&
        !bundleUsesIherbOverlaySupport(cachedFast.payload as AnalysisBundle)
      ) {
        incrementMetric("bundle_fast_cache_rejected_missing_overlay_rate");
        console.info("[telemetry] bundle_fast_cache_rejected_missing_overlay", {
          barcode: overlayClaims,
          identityType: params.identityType,
          identityValue: params.identityValue,
          factsDigestHash,
        });
        cachedFast = null;
      }
      if (!canWrite()) {
        return { factsDigestHash };
      }

      if (cachedFast?.payload && typeof cachedFast.payload === "object") {
        let fastCandidate = {
          ...(cachedFast.payload as AnalysisBundle),
          meta: {
            ...(cachedFast.payload as AnalysisBundle).meta,
            bundleId,
            revision: 1,
            phase: "fast_ai",
            factsDigestHash,
            factsSourceVersion: params.factsSourceVersion,
            serverCommitSha: SERVER_COMMIT_SHA,
          },
        } as AnalysisBundle;
        fastCandidate = sanitizeAnalysisBundleCoverFields({ bundle: fastCandidate, digest: params.digest });
        fastCandidate = applyDsldInferenceGuard(fastCandidate, params.digest);
        if (params.digest.sourceType === "web") {
          if (streamAnalysisBundleOnly) {
            const skipCode = "bundle_only_skip_web_verify";
            markPipelineStepEnd("verify", "degraded", skipCode);
            markPipelineStepEnd("revise", "degraded", skipCode);
            fastCandidate = sanitizeAnalysisBundleCoverFields({
              bundle: {
                ...fastCandidate,
                meta: {
                  ...fastCandidate.meta,
                  webVerifyMeta: {
                    verifyStatus: "degraded",
                    reviseStatus: "degraded",
                    revisedClaimsCount: 0,
                    droppedClaimsCount: 0,
                    fallbackCode: skipCode,
                  },
                },
              },
              digest: params.digest,
            });
          } else {
            markPipelineStepStart("verify");
            const verifiedCached = applyWebVerifyRevise(fastCandidate, params.digest, {
              timeBudgetMs: WEB_VERIFY_TIME_BUDGET_MS,
              includeBudgetMs: pipelineMetricsEnabled,
            });
            fastCandidate = verifiedCached.bundle;
            markPipelineStepEnd("verify", verifiedCached.verify.status, verifiedCached.verify.code);

            markPipelineStepStart("revise");
            const gatedCached = applyWebBundleEvidenceGate(fastCandidate, params.digest);
            fastCandidate = sanitizeAnalysisBundleCoverFields({ bundle: gatedCached.value, digest: params.digest });
            const reviseStatus =
              gatedCached.reasons.length > 0
                ? verifiedCached.revise.status === "failed"
                  ? "failed"
                  : "degraded"
                : verifiedCached.revise.status;
            markPipelineStepEnd(
              "revise",
              reviseStatus,
              gatedCached.reasons[0] ?? verifiedCached.revise.code,
            );
          }
        }
        const parsed = safeParseAnalysisBundle(fastCandidate);
        if (parsed.success && canWrite()) {
          const rev1Bundle = withAuthorityDiagnostics(parsed.data);
          const emittedRev1 = emitRev1Once(
            rev1Bundle,
            rev1Bundle.meta?.fallbackReason ? "fallback" : "fast_ai",
            rev1Bundle.meta?.fallbackReason,
          );
          if (emittedRev1) {
            await commitPersistedAfterRev1(rev1Bundle);
          }
          maybePrewarmDsldDetail();
          return { factsDigestHash };
        }
      }
      if (!canWrite()) {
        return { factsDigestHash };
      }

      const context = `FACTS_DIGEST_JSON: ${JSON.stringify(params.digest)}`;
      const skipAiForBundleOnlyWeb = streamAnalysisBundleOnly && params.digest.sourceType === "web";
      const canUseAi = params.allowAi && Boolean(params.apiKey) && !skipAiForBundleOnlyWeb;
      const overlayNoAiFullStreamFastPath =
        !streamAnalysisBundleOnly &&
        !canUseAi &&
        params.digest.sourceType === "web" &&
        Boolean(overlayClaimsByBarcode);
      const deterministicNoAiFastPath =
        (streamAnalysisBundleOnly || skipCachedFastForFullDsldDeterministic || overlayNoAiFullStreamFastPath) &&
        !canUseAi &&
        (params.digest.sourceType !== "web" || overlayNoAiFullStreamFastPath);
      if (deterministicNoAiFastPath && canWrite()) {
        const deterministicFallbackReason = skipCachedFastForFullDsldDeterministic
          ? "dsld_full_stream_no_ai_fast_path"
          : overlayNoAiFullStreamFastPath
            ? "iherb_overlay_full_stream_no_ai_fast_path"
          : "bundle_only_no_ai_fast_path";
        const deterministicModeCopy = skipCachedFastForFullDsldDeterministic
          ? {
            detailSummary:
              "This verified label record is summarized deterministically so the scan can finish without waiting on optional AI expansion.",
            modeBullet:
              "Deterministic label mode keeps the scan responsive while preserving trusted identity.",
            timingRationale:
              "Deterministic label mode prioritizes stable guidance before optional deeper expansion.",
          }
          : overlayNoAiFullStreamFastPath
            ? {
              detailSummary:
                "This label-backed product record is summarized deterministically so the scan can finish without waiting on optional web expansion.",
              modeBullet:
                "Label-backed deterministic mode keeps the scan responsive while preserving product-specific facts.",
              timingRationale:
                "Label-backed deterministic mode prioritizes stable directions and safety context before optional deeper expansion.",
            }
          : {
            detailSummary: `${getDegradedReasonCopy("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH")} We will keep refining this record.`,
            modeBullet:
              "Limited mode keeps the scan responsive while preserving trusted identity.",
            timingRationale:
              "Bundle-only mode prioritizes fast, stable guidance before deeper expansion.",
          };
        const productLabel = params.digest.product.name?.trim() || "This product";
        const activeCoverItems: NonNullable<
          AnalysisBundle["sections"]["ingredients"]["cover"]
        >["items"] = params.digest.actives
          .slice(0, 3)
          .map((active) => ({
            name: active.name,
            dose:
              active.amountText ??
              (active.amount != null && active.unit ? `${active.amount} ${active.unit}` : null),
            basisTags: ["label_fact"],
          }));
        const firstDose = params.digest.labelDosing.find(
          (row) => Boolean((row.dose && row.dose.trim()) || (row.frequency && row.frequency.trim())),
        );
        const dosageText = firstDose
          ? [firstDose.dose, firstDose.frequency].filter((value): value is string => Boolean(value && value.trim())).join(", ")
          : null;
        const firstSafetySignal =
          params.digest.warnings.warnings[0] ??
          params.digest.warnings.consultDoctorIf[0] ??
          params.digest.warnings.redFlags[0] ??
          null;
        const deterministicSafetyDetail = {
          warnings: firstSafetySignal
            ? [buildSectionBullet(firstSafetySignal, ["label_fact"])]
            : [],
          consultDoctorIf: [
            buildSectionBullet(
              "Pregnant, nursing, or taking medication.",
              ["general_advice"],
            ),
          ],
          redFlags: params.digest.warnings.redFlags.length
            ? params.digest.warnings.redFlags
              .slice(0, 2)
              .map((item) => buildSectionBullet(item, ["label_fact"]))
            : [],
        };
        const deterministicSafetySignals = buildBaseSafetySignalPack({
          digest: params.digest,
          safetyDetail: deterministicSafetyDetail,
          deterministicSignals,
        });
        const deterministicLimitedBundle: AnalysisBundle = {
          ...skeleton,
          meta: {
            ...skeleton.meta,
            fallbackReason: deterministicFallbackReason,
            sourceTypeFinal: true,
            detailReady: true,
            deterministicSignals: summarizeDeterministicSignals(deterministicSignals),
          },
          sections: {
            ...skeleton.sections,
            overview: {
              ...skeleton.sections.overview,
              cover: {
                summary: `${productLabel} has a verified record with limited structured fields.`,
                bullets: [
                  buildSectionBullet(
                    activeCoverItems.length > 0
                      ? `Recognized ingredients: ${activeCoverItems.map((item) => item.name).join(", ")}.`
                      : "This record does not list active ingredients in a structured format.",
                    activeCoverItems.length > 0 ? ["label_fact"] : ["not_provided"],
                  ),
                  buildSectionBullet(
                    "Use the Supplement Facts and Directions panels for final confirmation.",
                    ["general_advice"],
                  ),
                ],
              },
              detail: {
                summary: deterministicModeCopy.detailSummary,
                bullets: [
                  buildSectionBullet(
                    deterministicModeCopy.modeBullet,
                    ["general_advice"],
                  ),
                  buildSectionBullet(
                    "Retry after scanning a clearer label photo if details are still missing.",
                    ["general_advice"],
                  ),
                ],
              },
              dataStatus: "limited",
            },
            ingredients: {
              ...skeleton.sections.ingredients,
              cover: {
                items: activeCoverItems,
                totalCount: params.digest.actives.length,
              },
              dataStatus: activeCoverItems.length > 0 ? "complete" : "limited",
            },
            usage: {
              ...skeleton.sections.usage,
              cover: {
                bullets: [
                  buildSectionBullet(
                    dosageText
                      ? `Label dosage signal: ${dosageText}.`
                      : "This record does not include dosage directions yet.",
                    dosageText ? ["label_fact"] : ["not_provided"],
                  ),
                  buildSectionBullet(
                    "Follow the bottle Directions panel before adjusting your routine.",
                    ["general_advice"],
                  ),
                ],
                bestTimeToTake: {
                  text: dosageText
                    ? "Follow the label cadence and keep timing consistent day to day."
                    : "Choose a consistent routine once label directions are confirmed.",
                  basisTags: dosageText ? ["label_fact"] : ["general_advice"],
                },
                withFood: {
                  value: null,
                  text: "Use package instructions for with-food guidance.",
                  basisTags: ["general_advice"],
                },
                dosage: dosageText
                  ? {
                    text: dosageText,
                    basisTags: ["label_fact"],
                  }
                  : {
                    text: "Dose not confirmed from this record.",
                    basisTags: ["not_provided"],
                  },
              },
              detail: {
                timingRationale: {
                  text: deterministicModeCopy.timingRationale,
                  basisTags: ["general_advice"],
                },
                withFoodRationale: {
                  text: "Confirm with bottle directions before changing your intake pattern.",
                  basisTags: ["general_advice"],
                },
                scheduleFromLabel: firstDose
                  ? [
                    {
                      population: firstDose.population,
                      age: firstDose.age,
                      dose: firstDose.dose,
                      frequency: firstDose.frequency,
                      rawText: firstDose.rawText,
                      basisTags: ["label_fact"],
                    },
                  ]
                  : [],
              },
              dataStatus: "limited",
            },
            safety: {
              ...skeleton.sections.safety,
              cover: {
                verdict: firstSafetySignal
                  ? "Safety details were partially detected from label data."
                  : "Safety details are limited in this source record.",
                bullets: [
                  buildSectionBullet(
                    firstSafetySignal ?? "No specific warning text was detected in this pass.",
                    firstSafetySignal ? ["label_fact"] : ["not_provided"],
                  ),
                  buildSectionBullet(
                    "Consult a clinician if pregnant, nursing, or taking medication.",
                    ["general_advice"],
                  ),
                ],
              },
              detail: deterministicSafetyDetail,
              signals: deterministicSafetySignals,
              dataStatus: "limited",
            },
          },
        };
        const limitedBundle = withAuthorityDiagnostics(deterministicLimitedBundle);
        console.info("[analysis_bundle] cover_contract", {
          source: params.digest.sourceType,
          overviewHasSummary: Boolean(deterministicLimitedBundle.sections.overview.cover?.summary),
          overviewBulletCount: deterministicLimitedBundle.sections.overview.cover?.bullets?.length ?? 0,
          ingredientsCount: params.digest.actives.length,
          usageHasDosage: Boolean(dosageText),
          usageHasBestTime: Boolean(deterministicLimitedBundle.sections.usage.cover?.bestTimeToTake?.text),
          usageBulletCount: deterministicLimitedBundle.sections.usage.cover?.bullets?.length ?? 0,
          safetyBulletCount: deterministicLimitedBundle.sections.safety.cover?.bullets?.length ?? 0,
          safetyVerdictPresent: Boolean(deterministicLimitedBundle.sections.safety.cover?.verdict),
          fastFailed: true,
          placeholderishModelHit: false,
          deterministicFallbackUsed: true,
          deterministicFallbackReason,
        });
        const emittedRev1 = emitRev1Once(
          limitedBundle,
          "fallback",
          deterministicFallbackReason,
        );
        if (emittedRev1) {
          await commitPersistedAfterRev1(limitedBundle);
        }
        return { factsDigestHash };
      }
      let fastRaw: Record<string, unknown> | null = null;
      let fastFailed = false;
      let fastBundle: AnalysisBundle | null = null;
      try {
        if (canUseAi && params.apiKey) {
          if (!canWrite()) return { factsDigestHash };
          if (params.digest.sourceType === "web") {
            markPipelineStepStart("draft");
          }
          try {
            fastRaw = await fetchAnalysisBundleFastV3(context, model, params.apiKey, {
              breaker: deepseekBreaker,
              semaphore: deepseekSemaphore,
              timeoutMs: ANALYSIS_BUNDLE_FAST_TIMEOUT_MS,
              queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
              retry: { maxAttempts: 1 },
              signal: params.signal,
            });
          } catch (error) {
            console.warn("[analysis_bundle] fast generation failed", error);
            fastFailed = true;
          } finally {
            if (params.digest.sourceType === "web") {
              markPipelineStepEnd("draft", fastRaw ? "ok" : "degraded", fastRaw ? undefined : "fast_generation_failed");
            }
          }
          if (!fastRaw) fastFailed = true;
        } else {
          fastFailed = true;
          if (params.digest.sourceType === "web") {
            markPipelineStepEnd("draft", "degraded", "fast_generation_skipped");
          }
        }

        let fastCandidate = mergeFastAnalysisBundle({
          skeleton,
          digest: params.digest,
          deterministicSignals,
          fastOutput: fastRaw,
          overlayClaims: overlayClaimsByBarcode,
          includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
        });
        fastCandidate = sanitizeAnalysisBundleCoverFields({ bundle: fastCandidate, digest: params.digest });
        if (fastFailed) {
          fastCandidate = applyFastFailureStatus(fastCandidate);
        }
        let parsed = safeParseAnalysisBundle(fastCandidate);
        if (!parsed.success) {
          const fallbackCandidate = applyFastFailureStatus(
            mergeFastAnalysisBundle({
              skeleton,
              digest: params.digest,
              deterministicSignals,
              fastOutput: null,
              overlayClaims: overlayClaimsByBarcode,
              includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
            }),
          );
          parsed = safeParseAnalysisBundle(fallbackCandidate);
        }
        if (parsed.success) {
          fastBundle = parsed.data;
        } else {
          console.warn("[analysis_bundle] fast bundle validation failed", parsed.error?.message);
        }
      } catch (error) {
        console.warn("[analysis_bundle] fast bundle crashed", error);
        const fallbackCandidate = applyFastFailureStatus(
          mergeFastAnalysisBundle({
            skeleton,
            digest: params.digest,
            deterministicSignals,
            fastOutput: null,
            overlayClaims: overlayClaimsByBarcode,
            includeDecisionDebug: debugDecisionRequested && (authDisabled || isRegressionRequest),
          }),
        );
        const parsed = safeParseAnalysisBundle(fallbackCandidate);
        if (parsed.success) {
          fastBundle = parsed.data;
        } else {
          console.warn("[analysis_bundle] fast fallback validation failed", parsed.error?.message);
        }
      }

      if (fastBundle && canWrite()) {
        const adjustedBundle = applyDsldInferenceGuard(fastBundle, params.digest);
        let gatedBundle = adjustedBundle;
        if (params.digest.sourceType === "web") {
          if (streamAnalysisBundleOnly) {
            const skipCode = "bundle_only_skip_web_verify";
            markPipelineStepEnd("verify", "degraded", skipCode);
            markPipelineStepEnd("revise", "degraded", skipCode);
            gatedBundle = sanitizeAnalysisBundleCoverFields({
              bundle: {
                ...adjustedBundle,
                meta: {
                  ...adjustedBundle.meta,
                  webVerifyMeta: {
                    verifyStatus: "degraded",
                    reviseStatus: "degraded",
                    revisedClaimsCount: 0,
                    droppedClaimsCount: 0,
                    fallbackCode: skipCode,
                  },
                },
              },
              digest: params.digest,
            });
          } else {
            markPipelineStepStart("verify");
            const verified = applyWebVerifyRevise(adjustedBundle, params.digest, {
              timeBudgetMs: WEB_VERIFY_TIME_BUDGET_MS,
              includeBudgetMs: pipelineMetricsEnabled,
            });
            gatedBundle = verified.bundle;
            markPipelineStepEnd("verify", verified.verify.status, verified.verify.code);

            markPipelineStepStart("revise");
            const gated = applyWebBundleEvidenceGate(gatedBundle, params.digest);
            gatedBundle = sanitizeAnalysisBundleCoverFields({ bundle: gated.value, digest: params.digest });
            const reviseStatus =
              gated.reasons.length > 0
                ? verified.revise.status === "failed"
                  ? "failed"
                  : "degraded"
                : verified.revise.status;
            markPipelineStepEnd("revise", reviseStatus, gated.reasons[0] ?? verified.revise.code);
          }
        }
        const rev1Source: "fast_ai" | "fallback" =
          gatedBundle.meta?.fallbackReason || fastFailed || !fastRaw ? "fallback" : "fast_ai";
        const rev1Bundle = withAuthorityDiagnostics(gatedBundle);
        const emittedRev1 = emitRev1Once(
          rev1Bundle,
          rev1Source,
          rev1Bundle.meta?.fallbackReason ?? (rev1Source === "fallback" ? "fast_generation_failed" : undefined),
        );
        maybePrewarmDsldDetail();
        if (emittedRev1) {
          await commitPersistedAfterRev1(rev1Bundle);
        }
      }

      return { factsDigestHash };
    };
    let stage0BundlePromise: Promise<{ factsDigestHash: string } | null> | null = null;
    const resolveBundleAwaitTimeoutMs = () => {
      const remainingMs = globalDeadlineAt - Date.now();
      const cappedRemaining =
        Number.isFinite(remainingMs) && remainingMs > 0
          ? Math.min(ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS, remainingMs)
          : ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS;
      return Math.max(500, cappedRemaining);
    };
    const handleBundleAwaitTimeout = (label: "stage0" | "stage1") => {
      if (streamState.doneSent || streamState.ended || res.writableEnded || streamState.clientDisconnected) {
        return;
      }
      console.warn("[enrich-stream] bundle await timeout", {
        requestId: requestId || null,
        barcode: streamBarcode ?? normalized?.code ?? null,
        label,
        timeoutMs: resolveBundleAwaitTimeoutMs(),
        rev0Sent: streamState.rev0Sent,
        rev1Sent: streamState.rev1Sent,
        sourceType: streamState.latestSourceType,
        stage0Winner: activeStage0Winner,
        stage0SourceTypeHint: activeStage0SourceTypeHint,
        stage0IdentityTypeHint: activeStage0IdentityTypeHint,
        stage0StartCount,
        stage0ReplaceCount,
      });
      if (!streamState.rev1Sent) {
        emitDegradedLimitedRev1AndFinalize(
          streamAnalysisBundleOnly ? "BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH" : "DEGRADED_WEB_BUDGET",
        );
        return;
      }
      finalizeStream(`${label}_await_timeout_after_rev1`);
    };
    const awaitBundleWithTimeout = async (
      promise: Promise<{ factsDigestHash: string } | null> | null,
      label: "stage0" | "stage1",
    ): Promise<boolean> => {
      if (!promise) return true;
      const timeoutMs = resolveBundleAwaitTimeoutMs();
      const timeoutSignal = createTimeoutSignal(timeoutMs);
      const { signal: combinedSignal, cleanup: cleanupCombined } = combineSignals([
        requestSignal,
        timeoutSignal,
      ]);
      try {
        await abortable(promise.catch(() => null), combinedSignal);
        return true;
      } catch (error) {
        if (timeoutSignal.aborted && !requestSignal.aborted) {
          handleBundleAwaitTimeout(label);
          return false;
        }
        if (!isAbortError(error)) {
          console.warn("[enrich-stream] bundle await failed", {
            requestId: requestId || null,
            barcode: streamBarcode ?? normalized?.code ?? null,
            label,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return false;
      } finally {
        cleanupCombined();
      }
    };
    const awaitStage0Bundle = async () => {
      await awaitBundleWithTimeout(stage0BundlePromise, "stage0");
    };
    let stage1BundlePromise: Promise<{ factsDigestHash: string } | null> | null = null;
    const awaitStage1Bundle = async () => {
      await awaitBundleWithTimeout(stage1BundlePromise, "stage1");
    };
    const awaitAnalysisBundle = async () => {
      if (stage1BundlePromise) {
        await awaitStage1Bundle();
        return;
      }
      await awaitStage0Bundle();
    };
    const resolveStage0WinnerFromParams = (
      params: Omit<Parameters<typeof emitAnalysisBundleSequence>[0], "signal" | "isRunActive">,
    ): Stage0Winner => {
      if (params.identityType === "npn" || params.digest.sourceType === "lnhpd") {
        return "verified_regulatory";
      }
      if (params.identityType === "dsldLabelId" || params.digest.sourceType === "dsld") {
        return "label_record";
      }
      if (params.digest.sourceType === "web" || params.identityType === "webCanonicalId") {
        return "web_hint_unverified";
      }
      return "unknown";
    };
    const startStage0Bundle = (
      params: Omit<Parameters<typeof emitAnalysisBundleSequence>[0], "signal" | "isRunActive"> & {
        stage0Winner?: Stage0Winner;
      },
    ): boolean => {
      const nextWinner = params.stage0Winner ?? resolveStage0WinnerFromParams(params);
      const nextRank = stage0Rank(nextWinner);
      if (stage0Rev1Locked || streamState.rev1Sent) {
        return false;
      }
      const stage0CompletedWithoutRev1 = stage0StartCount > 0 && activeStage0RunId === null;
      const allowPostCompletionAuthoritativeUpgrade =
        stage0CompletedWithoutRev1
        && stage0UpgradeCount < 1
        && nextRank > activeStage0Rank
        && (nextWinner === "verified_regulatory" || nextWinner === "label_record");
      if (stage0CompletedWithoutRev1 && !allowPostCompletionAuthoritativeUpgrade) {
        return false;
      }
      const stage0AuthoritativeWinner = nextWinner === "verified_regulatory" || nextWinner === "label_record";
      const effectiveAllowAi =
        STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1 && stage0AuthoritativeWinner
          ? false
          : params.allowAi;
      const bundleOnlyStage0WinnerAllowed =
        nextWinner === "verified_regulatory"
        || (BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0 && nextWinner === "label_record");
      if (streamAnalysisBundleOnly && BUNDLE_ONLY_SKIP_WEB_SEARCH && !bundleOnlyStage0WinnerAllowed) {
        return false;
      }
      if (allowPostCompletionAuthoritativeUpgrade) {
        fastBundleReplacedCount += 1;
        stage0ReplaceCount += 1;
        stage0UpgradeCount += 1;
      }
      if (activeStage0RunId !== null) {
        if (stage0UpgradeCount >= 1) {
          return false;
        }
        if (nextRank <= activeStage0Rank) {
          return false;
        }
        fastBundleReplacedCount += 1;
        stage0ReplaceCount += 1;
        stage0UpgradeCount += 1;
        stage0BundleAbort?.abort(new Error("fast_bundle_replaced"));
        stage0BundleSignalCleanup?.();
        stage0BundleSignalCleanup = null;
        stage0BundleAbort = null;
      }
      const runId = ++stage0RunSeq;
      stage0StartCount += 1;
      activeStage0RunId = runId;
      activeStage0Winner = nextWinner;
      activeStage0SourceTypeHint = params.digest.sourceType;
      activeStage0IdentityTypeHint = params.identityType;
      activeStage0IdentityValueHint = params.identityValue;
      activeStage0Rank = nextRank;
      stage0BundleAbort = new AbortController();
      const { signal: stage0Signal, cleanup: stage0Cleanup } = combineSignals([
        requestSignal,
        stage0BundleAbort.signal,
      ]);
      stage0BundleSignalCleanup = stage0Cleanup;
      const { stage0Winner: _stage0Winner, ...runParams } = params;
      stage0BundlePromise = emitAnalysisBundleSequence({
        ...runParams,
        allowAi: effectiveAllowAi,
        signal: stage0Signal,
        isRunActive: () => activeStage0RunId === runId,
      }).finally(() => {
        stage0Cleanup();
        if (stage0BundleSignalCleanup === stage0Cleanup) {
          stage0BundleSignalCleanup = null;
        }
        if (activeStage0RunId === runId) {
          activeStage0RunId = null;
        }
      });
      return true;
    };
    const startStage1Bundle = (
      params: Omit<Parameters<typeof emitAnalysisBundleSequence>[0], "signal" | "isRunActive">,
    ): boolean => {
      // Hard rule: only emit ONE analysis_bundle sequence per request.
      // If Stage 0 already started (skeleton+fast), Stage 1 must not re-emit revision 0/1.
      if (stage0BundlePromise) return false;
      if (stage1BundleAbort) {
        fastBundleReplacedCount += 1;
        stage1BundleAbort.abort(new Error("fast_bundle_replaced"));
        stage1BundleSignalCleanup?.();
        stage1BundleSignalCleanup = null;
        stage1BundleAbort = null;
      }
      stage1BundleAbort = new AbortController();
      const { signal: stage1Signal, cleanup: stage1Cleanup } = combineSignals([
        requestSignal,
        stage1BundleAbort.signal,
      ]);
      stage1BundleSignalCleanup = stage1Cleanup;
      stage1BundlePromise = emitAnalysisBundleSequence({
        ...params,
        signal: stage1Signal,
      }).finally(() => {
        stage1Cleanup();
        if (stage1BundleSignalCleanup === stage1Cleanup) {
          stage1BundleSignalCleanup = null;
        }
      });
      return true;
    };
    const googleResilience: SearchResilienceOptions = {
      signal: requestSignal,
      budget,
      breaker: googleBreaker,
      semaphore: googleSemaphore,
      timeoutMs: RESILIENCE_GOOGLE_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 1 },
    };
    const interactiveTimeoutRaw = Number(process.env.LLM_INTERACTIVE_TIMEOUT_MS ?? '');
    const llmInteractiveTimeoutMs =
      Number.isFinite(interactiveTimeoutRaw) && interactiveTimeoutRaw > 0
        ? interactiveTimeoutRaw
        : RESILIENCE_DEEPSEEK_TIMEOUT_MS;
    const marketplaceLlmEnabled =
      process.env.MARKETPLACE_LLM_ENABLE === "1" || process.env.MARKETPLACE_LLM_ENABLE === "true";
    const marketplaceTimeoutRaw = Number(process.env.MARKETPLACE_LLM_TIMEOUT_MS ?? "");
    const marketplaceLlmTimeoutMs =
      Number.isFinite(marketplaceTimeoutRaw) && marketplaceTimeoutRaw > 0 ? marketplaceTimeoutRaw : 2000;
    const marketplaceMaxTokensRaw = Number(process.env.MARKETPLACE_LLM_MAX_TOKENS ?? "");
    const marketplaceLlmMaxTokens =
      Number.isFinite(marketplaceMaxTokensRaw) && marketplaceMaxTokensRaw > 0 ? marketplaceMaxTokensRaw : 600;

    const deepseekResilience = {
      signal: requestSignal,
      budget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: Math.min(RESILIENCE_DEEPSEEK_TIMEOUT_MS, llmInteractiveTimeoutMs),
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 1 },
    };
    const supabaseReadResilience = {
      signal: requestSignal,
      budget,
      breaker: supabaseReadBreaker,
      semaphore: supabaseReadSemaphore,
      queueTimeoutMs: RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 300,
        jitterRatio: 0.3,
      },
    };
    const supabaseWriteResilience = {
      ...supabaseReadResilience,
      timeoutMs: Number(process.env.RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS ?? 1500),
    };
    const contextResilience = {
      signal: requestSignal,
      budget,
      breaker: contextFetchBreaker,
      semaphore: contextFetchSemaphore,
      timeoutMs: RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
    };

    const pickText = (...values: (string | null | undefined)[]) => {
      for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
      }
      return null;
    };

    const passesRuleBrandSanity = (value: string): boolean => {
      const raw = value.replace(/\s+/g, " ").trim();
      if (!raw) return false;
      const tokenCount = raw.split(" ").filter(Boolean).length;
      const hasDbaChain = /\b(?:dba|doing\s+business\s+as)\b/i.test(raw);
      const hasListSeparators = /[|/;]/.test(raw);
      return tokenCount <= 5 && !hasDbaChain && !hasListSeparators;
    };

    const shouldPreferExtractedBrand = (
      brandExtraction?: SnapshotAnalysisPayload["brandExtraction"] | null,
    ) => {
      if (!brandExtraction?.brand) return false;
      if (!(brandExtraction.confidence === "high" || brandExtraction.confidence === "medium")) return false;
      if (brandExtraction.source === "ai") return true;
      if (brandExtraction.source === "rule") {
        const sanitized = sanitizeBrandCandidate(brandExtraction.brand);
        return Boolean(sanitized && passesRuleBrandSanity(sanitized));
      }
      return false;
    };

    const sanitizeBrandCandidate = (value?: string | null): string | null => {
      if (!value) return null;
      let cleaned = value.trim();
      if (!cleaned) return null;
      cleaned = cleaned.replace(/｜/g, "|");
      if (cleaned.includes("|")) {
        const [left] = cleaned.split("|");
        cleaned = left?.trim() ?? "";
      }
      const dashSplit = cleaned.split(/\s[\-\u2013\u2014]\s/);
      if (dashSplit.length > 1) {
        cleaned = dashSplit[0]?.trim() ?? cleaned;
      }
      cleaned = cleaned.replace(/[^\p{L}\p{N}\s\-’'®]/gu, " ").replace(/\s+/g, " ").trim();
      if (!cleaned || /^\d+$/.test(cleaned)) return null;
      return cleaned;
    };

    const resolveBrand = (
      brandExtraction: SnapshotAnalysisPayload["brandExtraction"] | null | undefined,
      ...candidates: (string | null | undefined)[]
    ) => {
      const preferred = shouldPreferExtractedBrand(brandExtraction)
        ? sanitizeBrandCandidate(brandExtraction?.brand ?? null)
        : null;
      const normalizedCandidates = candidates.map((candidate) => sanitizeBrandCandidate(candidate ?? null));
      return pickText(preferred, ...normalizedCandidates);
    };

    type CachedSnapshotSseMode = "full" | "analysis_bundle_only";
    const emitCachedSnapshot = (cached: {
      snapshot: SupplementSnapshot;
      analysisPayload: SnapshotAnalysisPayload | null;
      expiresAt?: string | null;
    }, catalog?: CatalogResolved | null, options?: { mode?: CachedSnapshotSseMode }) => {
      const mode: CachedSnapshotSseMode = options?.mode ?? "full";
      if (STREAM_VERBOSE_LOG_ENABLED) {
        console.log(`[Stream] Cache hit for barcode: ${barcode}`);
      }
      snapshotCacheHit = true;
      const { snapshot, analysisPayload } = cached;
      let workingAnalysisPayload = analysisPayload ?? null;
      const labelFacts = buildLabelFactsFromSnapshot(snapshot);
      if (labelFacts) {
        const labelAnalysis = buildLabelOnlyAnalysis(labelFacts);
        if (!workingAnalysisPayload) {
          workingAnalysisPayload = labelAnalysis;
        } else if (!hasAiPayload(workingAnalysisPayload)) {
          workingAnalysisPayload = { ...workingAnalysisPayload, ...labelAnalysis };
        } else {
          workingAnalysisPayload = mergeLabelFallbacks(workingAnalysisPayload, labelAnalysis);
        }
      }
      if (workingAnalysisPayload?.brandExtraction) {
        sendSSE(res, "brand_extracted", {
          ...workingAnalysisPayload.brandExtraction,
          brand: sanitizeBrandCandidate(workingAnalysisPayload.brandExtraction.brand),
        });
      }

      const catalogCategory = catalog?.category ?? catalog?.categoryRaw ?? null;

      const productInfo = {
        brand: resolveBrand(
          workingAnalysisPayload?.brandExtraction,
          catalog?.brand,
          workingAnalysisPayload?.productInfo?.brand,
          snapshot.product.brand,
        ),
        name: pickText(catalog?.productName, workingAnalysisPayload?.productInfo?.name, snapshot.product.name),
        category: pickText(catalogCategory, workingAnalysisPayload?.productInfo?.category, snapshot.product.category),
        image: pickText(catalog?.imageUrl, workingAnalysisPayload?.productInfo?.image, snapshot.product.imageUrl),
      };

      if (workingAnalysisPayload) {
        workingAnalysisPayload = {
          ...workingAnalysisPayload,
          productInfo: {
            ...workingAnalysisPayload.productInfo,
            brand: productInfo.brand ?? null,
            name: productInfo.name ?? null,
            category: productInfo.category ?? null,
            image: productInfo.image ?? null,
          },
        };
      }

      const sources = workingAnalysisPayload?.sources ?? snapshot.references.items.map((ref) => ({
        title: ref.title,
        link: ref.url,
        domain: extractDomain(ref.url),
        isHighQuality: false,
      }));

      sendSSE(res, "product_info", { productInfo, sources });

      if (mode === "full" && workingAnalysisPayload) {
        sendSSE(res, "analysis_payload", workingAnalysisPayload);
      }

      const analysisMeta = resolveAnalysisMeta({ snapshot, analysisPayload: workingAnalysisPayload, catalog });
      const snapshotToSend: SupplementSnapshot = {
        ...snapshot,
        product: {
          ...snapshot.product,
          brand: productInfo.brand ?? snapshot.product.brand,
          name: productInfo.name ?? snapshot.product.name,
          category: productInfo.category ?? snapshot.product.category,
          imageUrl: productInfo.image ?? snapshot.product.imageUrl,
        },
        analysis: snapshot.analysis ?? analysisMeta,
      };

      const payloadInfo = analysisPayload?.productInfo ?? null;
      const snapshotMismatch =
        productInfo.brand !== snapshot.product.brand ||
        productInfo.name !== snapshot.product.name ||
        productInfo.category !== snapshot.product.category ||
        productInfo.image !== snapshot.product.imageUrl;
      const payloadMismatch = payloadInfo
        ? payloadInfo.brand !== productInfo.brand ||
        payloadInfo.name !== productInfo.name ||
        payloadInfo.category !== productInfo.category ||
        payloadInfo.image !== productInfo.image
        : false;

      if (snapshotMismatch || payloadMismatch) {
        const updatedSnapshot: SupplementSnapshot = {
          ...snapshotToSend,
          updatedAt: nowIso(),
        };
        void storeSnapshotCache({
          key: cacheKey,
          source: "barcode",
          snapshot: updatedSnapshot,
          analysisPayload: workingAnalysisPayload,
          expiresAt: cached.expiresAt ?? undefined,
        });
      }

      if (mode === "full") {
        if (workingAnalysisPayload?.efficacy) {
          sendSSE(res, "result_efficacy", workingAnalysisPayload.efficacy);
        }
        if (workingAnalysisPayload?.safety) {
          sendSSE(res, "result_safety", workingAnalysisPayload.safety);
        }
        if (workingAnalysisPayload?.usagePayload) {
          sendSSE(res, "result_usage", workingAnalysisPayload.usagePayload);
        }

        sendSSE(res, "snapshot", snapshotToSend);
      }
    };

    const catalogPromise = resolveCatalogByBarcode(normalized, {
      ...supabaseReadResilience,
      // Catalog is a Stage0 authoritative path for DSLD/override hits.
      // Under concurrency, a short read-queue timeout can create false web fallback.
      // Keep parity with regulatory-map tolerance to reduce expected-final drift.
      queueTimeoutMs: Math.max(RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS, 1200),
      timeoutMs: RESILIENCE_CATALOG_TIMEOUT_MS,
    });
    const snapshotPromise = getSnapshotCache(
      { key: cacheKey, source: "barcode" },
      {
        ...supabaseReadResilience,
        timeoutMs: RESILIENCE_SNAPSHOT_TIMEOUT_MS,
      },
    );

    // Stage 0 helpers (first-party resolution). These are safe to prefetch in parallel.
    // Hard rule: negative cache has NO termination authority in Stage 0.
    const regulatoryMapPromise = getBarcodeRegulatoryMap(barcodeGtin14, barcodeRawDigits, {
      ...supabaseReadResilience,
      // Stage0 is the authoritative fork. If we miss the mapping due to a short queue timeout,
      // we incorrectly fall back to Web Stage1 ("marketplace_only" etc) and the UI looks broken.
      // So: allow this critical read to wait longer for the supabase read semaphore.
      queueTimeoutMs: Math.max(RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS, 1200),
      timeoutMs: 2000,
      includeExpired: true,
    });
    const negativeCachePromise = getNegativeCache(barcodeGtin14, barcodeRawDigits, {
      ...supabaseReadResilience,
      timeoutMs: 350,
    });

    const googleApiKey = process.env.GOOGLE_CSE_API_KEY ?? null;
    const cx = process.env.GOOGLE_CSE_CX ?? null;
    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;
    const aiAvailable = Boolean(googleApiKey && cx && deepseekKey);
    const forceStage1Raw = process.env.FORCE_STAGE1 === "1" || process.env.FORCE_STAGE1 === "true";
    const forceStage1 = process.env.NODE_ENV !== "production" && forceStage1Raw;
    const allowNeedsJs = process.env.ALLOW_NEEDS_JS === "1" || process.env.ALLOW_NEEDS_JS === "true";
    type Stage0Source = "none" | "snapshot" | "catalog" | "lnhpd" | "dsld" | "overlay";
    let stage0Delivered = false;
    let stage0Source: Stage0Source = "none";
    const maybeRunNpnCandidateBackfill = async (): Promise<void> => {
      if (candidateBackfillState.attempted) return;
      candidateBackfillState = {
        ...candidateBackfillState,
        attempted: true,
      };
      if (streamState.latestSourceTypeFinal === true) {
        candidateBackfillState = {
          ...candidateBackfillState,
          reasonCode: "CANDIDATE_MATCH_NOT_FINAL",
        };
        return;
      }
      if (budget.msLeft() < NPN_CANDIDATE_BACKFILL_MIN_BUDGET_MS) {
        candidateBackfillState = {
          ...candidateBackfillState,
          reasonCode: "CANDIDATE_LOOKUP_TIMEOUT",
        };
        return;
      }
      const topCandidate = npnCandidatesForMeta[0] ?? null;
      if (!topCandidate) {
        candidateBackfillState = {
          ...candidateBackfillState,
          reasonCode: "CANDIDATE_LOOKUP_NOT_FOUND",
        };
        return;
      }
      if (topCandidate.stableReason === "unverified") {
        candidateBackfillState = {
          ...candidateBackfillState,
          source: topCandidate.sourceKind,
          reasonCode: "CANDIDATE_LOOKUP_NOT_FOUND",
        };
        return;
      }

      if (!LNHPD_RUNTIME_ENABLED) {
        candidateBackfillState = {
          ...candidateBackfillState,
          reasonCode: "LNHPD_DISABLED",
        };
        return;
      }

      const startedAtMs = Date.now();
      const timeoutSignal = createTimeoutSignal(NPN_CANDIDATE_DIRECT_LOOKUP_TIMEOUT_MS);
      const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
      try {
        const facts = await fetchLnhpdFactsByNpn(topCandidate.value, signal);
        if (!facts) {
          const timedOut = timeoutSignal.aborted;
          candidateBackfillState = {
            ...candidateBackfillState,
            source: topCandidate.sourceKind,
            reasonCode: timedOut ? "CANDIDATE_LOOKUP_TIMEOUT" : "CANDIDATE_LOOKUP_NOT_FOUND",
            latencyMs: Date.now() - startedAtMs,
          };
          return;
        }

        if (topCandidate.stableReason === "stable_db") {
          const hintBrand =
            latestProductIdentity?.brand ??
            cachedFast?.analysisPayload?.productInfo?.brand ??
            cachedFast?.snapshot?.product?.brand ??
            null;
          const hintProduct =
            latestProductIdentity?.name ??
            cachedFast?.analysisPayload?.productInfo?.name ??
            cachedFast?.snapshot?.product?.name ??
            null;
          const check = passesStableDbIdentityCheck({
            hintBrand,
            hintProduct,
            lnhpdBrand: facts.brandName ?? null,
            lnhpdProduct: facts.productName ?? null,
          });
          if (!check.pass) {
            candidateBackfillState = {
              ...candidateBackfillState,
              source: topCandidate.sourceKind,
              reasonCode: "CANDIDATE_IDENTITY_MISMATCH",
              latencyMs: Date.now() - startedAtMs,
            };
            return;
          }
        }

        const productInfo = {
          brand: facts.brandName ?? null,
          name: facts.productName ?? null,
          category: null,
          image: null,
        };
        let lnhpdSnapshot = buildBarcodeSnapshot({
          barcode,
          productInfo,
          sources: [],
          efficacy: null,
          safety: null,
          usagePayload: null,
        });
        lnhpdSnapshot = applyLnhpdFactsToSnapshot(lnhpdSnapshot, facts);
        candidateBackfillDigest = buildFactsDigestFromLnhpd({
          facts,
          snapshot: lnhpdSnapshot,
          identityValue: normalizeNpnValue(topCandidate.value) ?? topCandidate.value,
          regionTags: lnhpdSnapshot.regulatory.regionTags,
        });
        candidateBackfillState = {
          ...candidateBackfillState,
          used: true,
          source: topCandidate.sourceKind,
          reasonCode: null,
          latencyMs: Date.now() - startedAtMs,
          scoreSuppressed: false,
        };
      } catch (error) {
        candidateBackfillState = {
          ...candidateBackfillState,
          source: topCandidate.sourceKind,
          reasonCode: timeoutSignal.aborted || isAbortError(error) ? "CANDIDATE_LOOKUP_TIMEOUT" : "CANDIDATE_LOOKUP_NOT_FOUND",
          latencyMs: Date.now() - startedAtMs,
        };
      } finally {
        cleanup();
      }
    };
    const ensureCatalogNpnCandidatesForMeta = async (snapshot: SupplementSnapshot): Promise<void> => {
      if (!LNHPD_RUNTIME_ENABLED) {
        npnCandidatesForMeta = [];
        return;
      }
      if (npnCandidatesForMeta.length > 0) return;
      if (requestSignal.aborted) return;
      const resolveMapQuickly = async (): Promise<{
        regulatoryMap: Awaited<ReturnType<typeof getBarcodeRegulatoryMap>> | null;
        mapStatus: AuthorityMapStatus;
      }> => {
        try {
          const quickWaitMs = Math.max(0, NPN_CANDIDATE_CATALOG_META_WAIT_MS);
          let regulatoryMap = await Promise.race([
            regulatoryMapPromise
              .then((value) => value ?? null)
              .catch(() => null),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), quickWaitMs),
            ),
          ]);
          if (!regulatoryMap && !requestSignal.aborted) {
            regulatoryMap = await getBarcodeRegulatoryMap(barcodeGtin14, barcodeRawDigits, {
              ...supabaseReadResilience,
              budget: undefined,
              semaphore: undefined,
              breaker: undefined,
              queueTimeoutMs: 0,
              timeoutMs: Math.max(450, NPN_CANDIDATE_CATALOG_META_SECOND_CHANCE_TIMEOUT_MS),
              includeExpired: true,
              retry: {
                maxAttempts: 2,
              },
            }).catch(() => null);
          }
          const mapStatus: AuthorityMapStatus = regulatoryMap
            ? (isExpiredAt(regulatoryMap.expires_at) ? "stale" : "hit")
            : "miss";
          return { regulatoryMap, mapStatus };
        } catch {
          return { regulatoryMap: null, mapStatus: "miss" };
        }
      };
      const { regulatoryMap, mapStatus } = await resolveMapQuickly();
      npnCandidatesForMeta = buildNpnCandidates({
        regulatoryMap,
        mapStatus,
        mapMinConfidence: REGULATORY_MAP_MIN_CONFIDENCE,
        authorityCandidate: null,
        snapshot,
        maxCandidates: NPN_CANDIDATE_MAX,
      });
    };

    if (streamAnalysisBundleOnly && !stage0Delivered && !requestSignal.aborted) {
      const dsldRecoveredPreCache = await maybeRunDsldDirectFallbackStage0();
      if (dsldRecoveredPreCache && !forceStage1) {
        await awaitStage0Bundle();
        finalizeStream("dsld_stage0_fallback_complete");
        return;
      }
    }

    const cachedFast = await snapshotPromise.catch(() => null);
    let bypassCachedFastPathForAuthority = false;
    let cachedLooksWebOnly = false;
    let prefetchedNameMatchFacts: LnhpdFacts | null = null;
    if (authorityRegressionScenarioActive) {
      bypassCachedFastPathForAuthority = true;
      console.info("[ResolutionV2] Bypassing cached snapshot for authority regression sample", {
        barcode: barcodeGtin14,
      });
    }
    if (cachedFast) {
      const cachedOverlayClaims = await getOverlayClaimsForBarcode();
      const cachedNeedsOverlayRefresh =
        Boolean(cachedOverlayClaims) &&
        !snapshotPayloadUsesIherbOverlaySupport(cachedFast.analysisPayload);
      if (cachedNeedsOverlayRefresh) {
        bypassCachedFastPathForAuthority = true;
        incrementMetric("snapshot_bypass_missing_iherb_overlay_rate");
        console.info("[ResolutionV2] Bypassing snapshot cache due to missing iHerb overlay augmentation", {
          barcode: barcodeGtin14,
          snapshotId: cachedFast.snapshot.snapshotId,
        });
      }
      const cachedLabelSource =
        normalizeLabelExtractionSource(
          cachedFast.snapshot.analysis?.labelExtraction?.source ??
          cachedFast.analysisPayload?.analysis?.labelExtraction?.source ??
          null,
        );
      const cachedSnapshotAnalysisMeta =
        cachedFast.snapshot.analysis && typeof cachedFast.snapshot.analysis === "object"
          ? (cachedFast.snapshot.analysis as Record<string, unknown>)
          : null;
      const cachedPayloadAnalysisMeta =
        cachedFast.analysisPayload?.analysis && typeof cachedFast.analysisPayload.analysis === "object"
          ? (cachedFast.analysisPayload.analysis as Record<string, unknown>)
          : null;
      const cachedSnapshotIdentity =
        cachedSnapshotAnalysisMeta?.authoritativeIdentity &&
          typeof cachedSnapshotAnalysisMeta.authoritativeIdentity === "object"
          ? (cachedSnapshotAnalysisMeta.authoritativeIdentity as Record<string, unknown>)
          : null;
      const cachedPayloadIdentity =
        cachedPayloadAnalysisMeta?.authoritativeIdentity &&
          typeof cachedPayloadAnalysisMeta.authoritativeIdentity === "object"
          ? (cachedPayloadAnalysisMeta.authoritativeIdentity as Record<string, unknown>)
          : null;
      const cachedIdentityType =
        typeof cachedSnapshotIdentity?.type === "string"
          ? cachedSnapshotIdentity.type
          : typeof cachedPayloadIdentity?.type === "string"
            ? cachedPayloadIdentity.type
            : null;
      const cachedSourceType =
        typeof cachedSnapshotAnalysisMeta?.sourceType === "string"
          ? cachedSnapshotAnalysisMeta.sourceType
          : typeof cachedPayloadAnalysisMeta?.sourceType === "string"
            ? cachedPayloadAnalysisMeta.sourceType
            : null;
      const cachedNpn = cachedFast.snapshot.regulatory.npn ?? null;
      const cachedNpnStatus = cachedFast.snapshot.regulatory.npnStatus ?? null;
      const cachedNpnVerifiedBy = cachedFast.snapshot.regulatory.npnVerifiedBy ?? null;
      const cachedSnapshotUsesLnhpd =
        Boolean(cachedNpn)
        || cachedNpnVerifiedBy === "lnhpd_fetch"
        || cachedLabelSource === "lnhpd"
        || cachedSourceType === "lnhpd"
        || cachedIdentityType === "npn";
      if (!LNHPD_RUNTIME_ENABLED && cachedSnapshotUsesLnhpd) {
        bypassCachedFastPathForAuthority = true;
        console.info("[ResolutionV2] Bypassing cached LNHPD snapshot in US-only runtime mode", {
          barcode: barcodeGtin14,
          snapshotId: cachedFast.snapshot.snapshotId,
        });
      }
      const cachedIsNpnVerified =
        LNHPD_RUNTIME_ENABLED &&
        Boolean(cachedNpn) &&
        cachedNpnStatus === "verified" &&
        cachedNpnVerifiedBy === "lnhpd_fetch";
      const cachedIsWebAuthority =
        cachedSourceType === "web" || cachedIdentityType === "webCanonicalId";
      const cachedNeedsAuthorityUpgrade = cachedIsWebAuthority && !cachedIsNpnVerified;

      cachedLooksWebOnly =
        !hasAuthoritativeIdentityFromSnapshot(cachedFast.snapshot) &&
        cachedLabelSource === null;
      if ((cachedLooksWebOnly || cachedNeedsAuthorityUpgrade) && !forceStage1) {
        const hasSeededDsldCandidate =
          STAGE0_DSLD_BARCODE_FALLBACK_ENABLED && hasPreferredStage0DsldLabelId(barcodeGtin14);
        let canonicalDsldCandidateLabelId: number | null = null;
        if (!hasSeededDsldCandidate && STAGE0_DSLD_BARCODE_FALLBACK_ENABLED && !requestSignal.aborted) {
          const timeoutSignal = createTimeoutSignal(
            Math.min(1200, Math.max(250, STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS)),
          );
          const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
          try {
            canonicalDsldCandidateLabelId = await fetchCanonicalDsldLabelIdByBarcode(barcodeGtin14, signal);
          } catch {
            canonicalDsldCandidateLabelId = null;
          } finally {
            cleanup();
          }
        }
        const hasCanonicalDsldCandidate =
          Number.isFinite(Number(canonicalDsldCandidateLabelId)) && Number(canonicalDsldCandidateLabelId) > 0;
        const [catalogProbe, regulatoryProbe] = await Promise.all([
          catalogPromise.catch(() => null),
          regulatoryMapPromise.catch(() => null),
        ]);
        const hintBrand =
          cachedFast.analysisPayload?.productInfo?.brand ??
          cachedFast.snapshot.product.brand ??
          null;
        const hintProduct =
          cachedFast.analysisPayload?.productInfo?.name ??
          cachedFast.snapshot.product.name ??
          null;
        const hasNameHints =
          (hintBrand && hintBrand.trim().length > 0) || (hintProduct && hintProduct.trim().length > 0);
        let hasNameMatchCandidate = false;

        if (
          LNHPD_RUNTIME_ENABLED &&
          !catalogProbe &&
          !regulatoryProbe?.npn &&
          hasNameHints &&
          !requestSignal.aborted
        ) {
          const timeoutSignal = createTimeoutSignal(1200);
          const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
          try {
            prefetchedNameMatchFacts = await fetchLnhpdFactsByName(
              { brand: hintBrand, product: hintProduct },
              signal,
            );
            const prefetchedNpn = prefetchedNameMatchFacts?.npn?.replace(/\D/g, "").trim() ?? "";
            hasNameMatchCandidate = prefetchedNpn.length >= 6;
          } catch (error) {
            console.warn("[ResolutionV2] Name-match prefetch probe failed", error);
          } finally {
            cleanup();
          }
        }

        const hasRegulatoryCandidate = LNHPD_RUNTIME_ENABLED && Boolean(regulatoryProbe?.npn);

        if (
          catalogProbe ||
          hasRegulatoryCandidate ||
          hasNameMatchCandidate ||
          hasSeededDsldCandidate ||
          hasCanonicalDsldCandidate
        ) {
          bypassCachedFastPathForAuthority = true;
          console.info("[ResolutionV2] Bypassing web snapshot cache due to authoritative candidate", {
            barcode: barcodeGtin14,
            cachedLooksWebOnly,
            cachedNeedsAuthorityUpgrade,
            cachedIsWebAuthority,
            cachedIsNpnVerified,
            cachedIdentityType,
            cachedSourceType,
            hasCatalogCandidate: Boolean(catalogProbe),
            hasRegulatoryCandidate,
            hasNameMatchCandidate,
            hasSeededDsldCandidate,
            hasCanonicalDsldCandidate,
            canonicalDsldCandidateLabelId,
          });
        }
      }
    }
    if (cachedFast && !bypassCachedFastPathForAuthority) {
      const snapshotIsAuthoritativeFastPath = hasBundleOnlyAuthoritativeFastPath(cachedFast.snapshot);
      if (streamAnalysisBundleOnly && !forceStage1 && !snapshotIsAuthoritativeFastPath) {
        const recoveredFromCachedFastShortCircuit = await maybeRunDsldDirectFallbackStage0();
        if (recoveredFromCachedFastShortCircuit && stage0BundlePromise) {
          await awaitStage0Bundle();
          if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
            finalizeStream("bundle_only_cached_fast_dsld_stage0_recovered");
          }
          releaseInFlightOnce();
          return;
        }
        emitDegradedLimitedRev1AndFinalize("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH");
        releaseInFlightOnce(new Error("snapshot_bundle_only_unverified_short_circuit"));
        return;
      }
      if (cachedLooksWebOnly && !hasCoreFacts(cachedFast.snapshot, cachedFast.analysisPayload)) {
        emitProductNotFoundAndFinalize({
          stage: "facts",
          reasonCode: "WEB_CACHE_EMPTY_CORE_FACTS",
        });
        return;
      }
      const hasProductName = Boolean(
        cachedFast.analysisPayload?.productInfo?.name || cachedFast.snapshot.product.name,
      );
      const needsCatalogFast = !hasProductName || !cachedFast.snapshot.regulatory.dsldLabelId;
      const catalogFast = needsCatalogFast ? await catalogPromise.catch(() => null) : null;
      // Observability contract: for cached catalog/label finals, surface npnCandidates in meta
      // before emitting cached bundles so runtime diagnostics do not flap by cache-hit path.
      await ensureCatalogNpnCandidatesForMeta(cachedFast.snapshot);
      emitCachedSnapshot(
        cachedFast,
        catalogFast,
        streamAnalysisBundleOnly ? { mode: "analysis_bundle_only" } : undefined,
      );
      stage0Delivered = true;
      stage0Source = "snapshot";

      const needsEnrichment = shouldReEnrich({
        snapshot: cachedFast.snapshot,
        analysisPayload: cachedFast.analysisPayload,
        catalog: catalogFast,
        aiAvailable,
      });

      // Cache-hit fast path: emit analysis_bundle even when Stage 1 is skipped or fails.
      // This makes cache hits deterministic for clients that rely on analysis_bundle.
      if (!forceStage1) {
        const snapshotLabelSource =
          normalizeLabelExtractionSource(
            cachedFast.snapshot.analysis?.labelExtraction?.source
            ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.source
            ?? null,
          );
        const snapshotLabelVersion =
          cachedFast.snapshot.analysis?.labelExtraction?.datasetVersion
          ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.datasetVersion
          ?? cachedFast.snapshot.analysis?.labelExtraction?.fetchedAt
          ?? null;

        const snapshotNpn = cachedFast.snapshot.regulatory.npn ?? null;
        const snapshotNpnStatus = cachedFast.snapshot.regulatory.npnStatus ?? null;
        const snapshotVerifiedBy = cachedFast.snapshot.regulatory.npnVerifiedBy ?? null;
        const snapshotIsVerified =
          LNHPD_RUNTIME_ENABLED &&
          snapshotNpnStatus === "verified" &&
          snapshotVerifiedBy === "lnhpd_fetch" &&
          Boolean(snapshotNpn);
        const snapshotIsAuthoritativeForBundleOnly =
          snapshotIsVerified || hasBundleOnlyLabelRecordIdentityFromSnapshot(cachedFast.snapshot);

        if (!snapshotIsVerified) {
          // Stability-first contract for analysis_bundle_only:
          // avoid spawning stage0 heavy work on non-verified snapshot paths.
          if (streamAnalysisBundleOnly && !snapshotIsAuthoritativeForBundleOnly) {
            const recoveredFromSnapshotSkipStage0 = await maybeRunDsldDirectFallbackStage0();
            if (recoveredFromSnapshotSkipStage0 && stage0BundlePromise) {
              await awaitStage0Bundle();
              if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
                finalizeStream("bundle_only_snapshot_skip_stage0_dsld_recovered");
              }
              releaseInFlightOnce();
              return;
            }
            emitDegradedLimitedRev1AndFinalize("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH");
            releaseInFlightOnce(new Error("snapshot_bundle_only_skip_stage0"));
            return;
          }

          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = "snapshot:unknown";

          // Prefer DSLD identity when present.
          const dsldLabelIdRaw = cachedFast.snapshot.regulatory.dsldLabelId;
          if (snapshotLabelSource === "dsld" && dsldLabelIdRaw) {
            const fallbackFacts = buildDsldFactsInputFromSnapshot(cachedFast.snapshot);
            identityType = "dsldLabelId";
            identityValue = dsldLabelIdRaw;
            factsSourceVersion = `dsld:${snapshotLabelVersion ?? "unknown"}`;
            digest = buildFactsDigestFromDsld({
              facts: fallbackFacts,
              snapshot: cachedFast.snapshot,
              identityValue,
              regionTags: cachedFast.snapshot.regulatory.regionTags,
            });
          }

          // Otherwise treat as web snapshot if we have any references.
          if (!digest) {
            const urls = cachedFast.snapshot.references.items
              .map((ref) => ref.url)
              .filter((value): value is string => typeof value === "string" && value.length > 0)
              .slice(0, 2);
            const canonicalHash = createHash("sha256").update(urls.join("|"))
              .digest("hex");
            const bestUrl = urls[0] ?? null;
            const webCanonicalId = bestUrl
              ? createHash("sha256").update(`${bestUrl}|${RESOLUTION_ENGINE_VERSION}|${barcodeGtin14}`).digest("hex")
              : barcodeGtin14;
            identityType = bestUrl ? "webCanonicalId" : "gtin14";
            identityValue = webCanonicalId;
            factsSourceVersion = urls.length
              ? `web:${RESOLUTION_ENGINE_VERSION}:${canonicalHash}`
              : `web:${RESOLUTION_ENGINE_VERSION}:none`;

            const webFactsInput = {
              barcode: barcodeGtin14,
              canonical: {
                name: cachedFast.snapshot.product.name ?? null,
                brand: cachedFast.snapshot.product.brand ?? null,
                url: bestUrl,
                domain: bestUrl ? extractDomain(bestUrl) : null,
              },
              identifiers: { npn: null },
              textFacts: {
                ingredientsText: null,
                directionsText: null,
                warningsText: null,
                servingSizeText: null,
              },
              coverageScore: 0,
              missingFields: [
                "textFacts.ingredientsText",
                "textFacts.directionsText",
                "textFacts.warningsText",
                "textFacts.servingSizeText",
              ],
            };

            digest = buildFactsDigestFromWeb({
              facts: webFactsInput,
              snapshot: cachedFast.snapshot,
              identityType,
              identityValue,
              regionTags: cachedFast.snapshot.regulatory.regionTags,
            });
          }

          if (digest) {
            startStage0Bundle({
              digest,
              identityType,
              identityValue,
              factsSourceVersion,
              allowAi: Boolean(deepseekKey),
              apiKey: deepseekKey,
            });
          }
        }
      }

      const snapshotIsVerified =
        LNHPD_RUNTIME_ENABLED &&
        cachedFast.snapshot.regulatory.npnStatus === "verified" &&
        cachedFast.snapshot.regulatory.npnVerifiedBy === "lnhpd_fetch";

      const snapshotVerifiedNpn = cachedFast.snapshot.regulatory.npn;
      const snapshotVerifiedBy = cachedFast.snapshot.regulatory.npnVerifiedBy;
      const snapshotNpnStatus = cachedFast.snapshot.regulatory.npnStatus;
      if (
        LNHPD_RUNTIME_ENABLED &&
        snapshotVerifiedNpn &&
        snapshotVerifiedBy === "lnhpd_fetch" &&
        snapshotNpnStatus === "verified"
      ) {
        void upsertBarcodeRegulatoryMap({
          barcodeGtin14,
          npn: snapshotVerifiedNpn,
          confidence: 0.9,
          source: "snapshot_verified",
          expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_LNHPD).toISOString(),
          barcodeRaw: rawBarcode,
        });
      }

      if (!needsEnrichment && snapshotIsVerified) {
        if (!forceStage1) {
          const snapshotLabelSource =
            normalizeLabelExtractionSource(
              cachedFast.snapshot.analysis?.labelExtraction?.source
              ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.source
              ?? null,
            );
          const snapshotLabelVersion =
            cachedFast.snapshot.analysis?.labelExtraction?.datasetVersion
            ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.datasetVersion
            ?? cachedFast.snapshot.analysis?.labelExtraction?.fetchedAt
            ?? null;
          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = "snapshot:unknown";

          if (
            LNHPD_RUNTIME_ENABLED &&
            (snapshotLabelSource === "lnhpd" || snapshotLabelSource === "manual") &&
            snapshotVerifiedNpn
          ) {
            identityType = "npn";
            identityValue = snapshotVerifiedNpn;
            const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
            const { signal, cleanup } = combineSignals([requestSignal, lnhpdTimeoutSignal]);
            try {
              const lnhpdFacts = await fetchLnhpdFactsByNpn(snapshotVerifiedNpn, signal);
              if (lnhpdFacts) {
                factsSourceVersion = `lnhpd:${lnhpdFacts.datasetVersion ?? lnhpdFacts.extractedAt ?? "unknown"}`;
                digest = buildFactsDigestFromLnhpd({
                  facts: lnhpdFacts,
                  snapshot: cachedFast.snapshot,
                  identityValue: snapshotVerifiedNpn,
                  regionTags: cachedFast.snapshot.regulatory.regionTags,
                });
              }
            } catch (error) {
              console.warn("[analysis_bundle] cached LNHPD fetch failed", error);
            } finally {
              cleanup();
            }
            if (!digest) {
              const fallbackFacts = buildLnhpdFactsInputFromSnapshot(cachedFast.snapshot);
              factsSourceVersion = `lnhpd:${snapshotLabelVersion ?? "unknown"}`;
              digest = buildFactsDigestFromLnhpd({
                facts: fallbackFacts,
                snapshot: cachedFast.snapshot,
                identityValue: snapshotVerifiedNpn,
                regionTags: cachedFast.snapshot.regulatory.regionTags,
              });
            }
          }

          if (!digest) {
            const dsldLabelIdRaw = cachedFast.snapshot.regulatory.dsldLabelId;
            const dsldLabelId = dsldLabelIdRaw ? Number(dsldLabelIdRaw) : Number.NaN;
            if (snapshotLabelSource === "dsld" && dsldLabelIdRaw && Number.isFinite(dsldLabelId)) {
              identityType = "dsldLabelId";
              identityValue = dsldLabelIdRaw;
              const dsldTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
              const { signal, cleanup } = combineSignals([requestSignal, dsldTimeoutSignal]);
              try {
                const dsldFacts = await fetchDsldFactsByLabelId(dsldLabelId, signal);
                if (dsldFacts) {
                  factsSourceVersion = `dsld:${dsldFacts.datasetVersion ?? dsldFacts.extractedAt ?? "unknown"}`;
                  digest = buildFactsDigestFromDsld({
                    facts: dsldFacts,
                    snapshot: cachedFast.snapshot,
                    identityValue: dsldLabelIdRaw,
                    regionTags: cachedFast.snapshot.regulatory.regionTags,
                  });
                }
              } catch (error) {
                console.warn("[analysis_bundle] cached DSLD fetch failed", error);
              } finally {
                cleanup();
              }
            }
          }

          if (!digest) {
            const fallbackFacts = buildDsldFactsInputFromSnapshot(cachedFast.snapshot);
            const fallbackLabelId = cachedFast.snapshot.regulatory.dsldLabelId;
            identityType = fallbackLabelId ? "dsldLabelId" : "gtin14";
            identityValue = fallbackLabelId ?? barcodeGtin14;
            factsSourceVersion = `dsld:${snapshotLabelVersion ?? "unknown"}`;
            digest = buildFactsDigestFromDsld({
              facts: fallbackFacts,
              snapshot: cachedFast.snapshot,
              identityValue,
              regionTags: cachedFast.snapshot.regulatory.regionTags,
            });
          }

          if (digest) {
            startStage0Bundle({
              digest,
              identityType,
              identityValue,
              factsSourceVersion,
              allowAi: Boolean(deepseekKey) && identityType !== "npn",
              apiKey: deepseekKey,
            });
            await awaitStage0Bundle();
          }

          finalizeStream("snapshot_verified_no_enrichment");

          const timingTotalMs = Math.round(performance.now() - startedAt);

          void (async () => {
            const { snapshot, analysisPayload } = cachedFast;
            const catalog = catalogFast ?? await catalogPromise.catch(() => null);
            if (catalog) {
              const before = {
                brand: snapshot.product.brand,
                name: snapshot.product.name,
                category: snapshot.product.category,
                imageUrl: snapshot.product.imageUrl,
                normalized: snapshot.product.barcode.normalized,
                normalizedFormat: snapshot.product.barcode.normalizedFormat,
                dsldLabelId: snapshot.regulatory.dsldLabelId,
              };
              const catalogCategory = catalog.category ?? catalog.categoryRaw ?? null;
              const finalProductInfo = {
                brand: resolveBrand(
                  analysisPayload?.brandExtraction,
                  catalog.brand,
                  analysisPayload?.productInfo?.brand,
                  snapshot.product.brand,
                ),
                name: pickText(catalog.productName, analysisPayload?.productInfo?.name, snapshot.product.name),
                category: pickText(catalogCategory, analysisPayload?.productInfo?.category, snapshot.product.category),
                image: pickText(catalog.imageUrl, analysisPayload?.productInfo?.image, snapshot.product.imageUrl),
              };

              snapshot.product.brand = finalProductInfo.brand;
              snapshot.product.name = finalProductInfo.name;
              snapshot.product.category = finalProductInfo.category;
              snapshot.product.imageUrl = finalProductInfo.image;
              snapshot.product.barcode.normalized = catalog.barcodeGtin14;
              snapshot.product.barcode.normalizedFormat = "gtin14";
              snapshot.regulatory.dsldLabelId = catalog.dsldLabelId
                ? String(catalog.dsldLabelId)
                : snapshot.regulatory.dsldLabelId;

              const changed =
                before.brand !== snapshot.product.brand ||
                before.name !== snapshot.product.name ||
                before.category !== snapshot.product.category ||
                before.imageUrl !== snapshot.product.imageUrl ||
                before.normalized !== snapshot.product.barcode.normalized ||
                before.normalizedFormat !== snapshot.product.barcode.normalizedFormat ||
                before.dsldLabelId !== snapshot.regulatory.dsldLabelId;
              if (changed) {
                snapshot.updatedAt = new Date().toISOString();
              }
              if (analysisPayload) {
                analysisPayload.productInfo = {
                  brand: finalProductInfo.brand,
                  name: finalProductInfo.name,
                  category: finalProductInfo.category,
                  image: finalProductInfo.image,
                };
              }

              if (changed) {
                void storeSnapshotCache({
                  key: catalog.barcodeGtin14,
                  source: "barcode",
                  snapshot,
                  analysisPayload,
                  expiresAt: cachedFast.expiresAt,
                });
              }
            }

            const servedFrom = catalog
              ? catalog.resolvedFrom === "override"
                ? "override_snapshot_cache"
                : "dsld_snapshot_cache"
              : "snapshot_cache";

            const brandName = snapshot.product.brand ?? analysisPayload?.productInfo?.brand ?? null;
            const productName = snapshot.product.name ?? analysisPayload?.productInfo?.name ?? null;

            void logBarcodeScan({
              barcodeGtin14,
              barcodeRaw: rawBarcode,
              checksumValid: normalized.isValidChecksum ?? null,
              catalogHit: Boolean(catalog),
              servedFrom,
              dsldLabelId: catalog?.dsldLabelId ?? null,
              snapshotId: cachedFast.snapshot.snapshotId,
              brandName,
              productName,
              deviceId,
              requestId,
              timingTotalMs,
              meta: buildAuthorityMeta({
                cacheKey: barcodeGtin14,
                mode: "snapshot_cache_hit_fast",
                deepseek_bundle_skipped_reason: "stage0_hit",
                timing: { stage0_ms: timingTotalMs },
              }),
            });
          })();

          return;
        }
        console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after snapshot hit");
      }
    }

    // 1) Catalog-first：overrides / DSLD
    const resolveCatalogSecondChance = async (): Promise<CatalogResolved | null> => {
      if (requestSignal.aborted) return null;
      const startedAtMs = performance.now();
      try {
        const secondChance = await resolveCatalogByBarcode(normalized, {
          ...supabaseReadResilience,
          // bypass shared read semaphore for one exact-match retry before Stage1 web fallback
          semaphore: undefined,
          queueTimeoutMs: 0,
          timeoutMs: Math.max(RESILIENCE_CATALOG_TIMEOUT_MS, 1200),
          retry: {
            maxAttempts: 1,
          },
        });
        if (secondChance) {
          console.info("[ResolutionV2] Catalog second-chance hit", {
            barcode: barcodeGtin14,
            resolvedFrom: secondChance.resolvedFrom,
            dsldLabelId: secondChance.dsldLabelId,
            latencyMs: Math.round(performance.now() - startedAtMs),
          });
        }
        return secondChance;
      } catch (error) {
        console.warn("[ResolutionV2] Catalog second-chance failed", error);
        return null;
      }
    };

    let catalog = await catalogPromise.catch(() => null);
    if (!catalog) {
      catalog = await resolveCatalogSecondChance();
    }

    if (catalog) {
      const gtin14 = catalog.barcodeGtin14;
      const servedFromCatalog = catalog.resolvedFrom === "override" ? "override" : "dsld";
      const servedFromCatalogCache = catalog.resolvedFrom === "override"
        ? "override_snapshot_cache"
        : "dsld_snapshot_cache";

      let cached = cachedFast;
      if (!cached) {
        cached = await getSnapshotCache(
          { key: gtin14, source: "barcode" },
          {
            ...supabaseReadResilience,
            timeoutMs: RESILIENCE_SNAPSHOT_TIMEOUT_MS,
          },
        ).catch(() => null);
      }

      let workingSnapshot = cached?.snapshot ?? buildCatalogBarcodeSnapshot({
        barcodeRaw: rawBarcode,
        normalized,
        catalog,
      });
      let workingAnalysisPayload: SnapshotAnalysisPayload = cached?.analysisPayload ?? {};

      const catalogCategory = catalog.category ?? catalog.categoryRaw ?? null;
      let finalProductInfo = {
        brand: resolveBrand(
          workingAnalysisPayload.brandExtraction,
          catalog.brand,
          workingAnalysisPayload.productInfo?.brand,
          workingSnapshot.product.brand,
        ),
        name: pickText(catalog.productName, workingAnalysisPayload.productInfo?.name, workingSnapshot.product.name),
        category: pickText(catalogCategory, workingAnalysisPayload.productInfo?.category, workingSnapshot.product.category),
        image: pickText(catalog.imageUrl, workingAnalysisPayload.productInfo?.image, workingSnapshot.product.imageUrl),
      };

      workingSnapshot = {
        ...workingSnapshot,
        product: {
          ...workingSnapshot.product,
          brand: finalProductInfo.brand ?? workingSnapshot.product.brand,
          name: finalProductInfo.name ?? workingSnapshot.product.name,
          category: finalProductInfo.category ?? workingSnapshot.product.category,
          imageUrl: finalProductInfo.image ?? workingSnapshot.product.imageUrl,
          barcode: {
            ...workingSnapshot.product.barcode,
            normalized: gtin14,
            normalizedFormat: "gtin14",
          },
        },
        regulatory: {
          ...workingSnapshot.regulatory,
          dsldLabelId: catalog.dsldLabelId
            ? String(catalog.dsldLabelId)
            : workingSnapshot.regulatory.dsldLabelId,
        },
      };

      let dsldFacts: DsldFacts | null = null;
      if (catalog.dsldLabelId) {
        dsldFacts = await fetchDsldFactsByLabelId(catalog.dsldLabelId, requestSignal);
      }
      if (!dsldFacts) {
        dsldFacts = await fetchDsldFactsByBarcode(gtin14, requestSignal);
      }
      const dsldLabelFacts = dsldFacts ? toLabelFactsFromDsld(dsldFacts) : null;
      if (dsldFacts) {
        workingSnapshot = applyDsldFactsToSnapshot(workingSnapshot, dsldFacts);
        catalogLabelFactsForAi = dsldLabelFacts;
        if (dsldLabelFacts) {
          const dsldBaseParseConfidence =
            dsldFacts.factsSource === 'meta_summary' ? 0.75 : 0.9;
          void upsertProductIngredientsFromLabelFacts({
            source: "dsld",
            sourceId: String(dsldFacts.dsldLabelId),
            canonicalSourceId: String(dsldFacts.dsldLabelId),
            labelFacts: dsldLabelFacts,
            basis: "label_serving",
            parseConfidence: dsldBaseParseConfidence,
          });
        }
      }

      const labelExtraction: LabelExtractionMeta | null = dsldFacts
        ? {
          source: "dsld",
          fetchedAt: dsldFacts.extractedAt ?? nowIso(),
          datasetVersion: dsldFacts.datasetVersion ?? null,
        }
        : null;

      if (dsldLabelFacts) {
        const labelAnalysis = buildLabelOnlyAnalysis(dsldLabelFacts);
        if (!hasAiPayload(workingAnalysisPayload)) {
          workingAnalysisPayload = {
            ...workingAnalysisPayload,
            ...labelAnalysis,
          };
        } else {
          workingAnalysisPayload = mergeLabelFallbacks(workingAnalysisPayload, labelAnalysis);
        }
      }

      finalProductInfo = {
        brand: resolveBrand(
          workingAnalysisPayload.brandExtraction,
          workingSnapshot.product.brand,
          catalog.brand,
          workingAnalysisPayload.productInfo?.brand,
        ),
        name: pickText(workingSnapshot.product.name, catalog.productName, workingAnalysisPayload.productInfo?.name),
        category: pickText(catalogCategory, workingAnalysisPayload.productInfo?.category, workingSnapshot.product.category),
        image: pickText(catalog.imageUrl, workingAnalysisPayload.productInfo?.image, workingSnapshot.product.imageUrl),
      };

      workingSnapshot = {
        ...workingSnapshot,
        product: {
          ...workingSnapshot.product,
          brand: finalProductInfo.brand ?? workingSnapshot.product.brand,
          name: finalProductInfo.name ?? workingSnapshot.product.name,
          category: finalProductInfo.category ?? workingSnapshot.product.category,
          imageUrl: finalProductInfo.image ?? workingSnapshot.product.imageUrl,
          barcode: {
            ...workingSnapshot.product.barcode,
            normalized: gtin14,
            normalizedFormat: "gtin14",
          },
        },
        regulatory: {
          ...workingSnapshot.regulatory,
          dsldLabelId: catalog.dsldLabelId
            ? String(catalog.dsldLabelId)
            : workingSnapshot.regulatory.dsldLabelId,
        },
      };

      const analysisStatus = buildAnalysisStatus({
        hasLabelFacts: hasLabelFacts(workingSnapshot),
        hasAi: hasAiPayload(workingAnalysisPayload),
        dsldLabelId: catalog.dsldLabelId,
      });
      const analysisMeta = buildAnalysisMeta({
        status: analysisStatus,
        labelExtraction,
        overlayClaims: await getOverlayClaimsForBarcode(),
      });

      workingSnapshot = {
        ...workingSnapshot,
        analysis: analysisMeta,
        updatedAt: nowIso(),
      };
      await ensureCatalogNpnCandidatesForMeta(workingSnapshot);

      if (dsldFacts) {
        const dsldFactsSourceVersion = `dsld:${dsldFacts.datasetVersion ?? dsldFacts.extractedAt ?? "unknown"}`;
        const dsldIdentityValue = catalog.dsldLabelId
          ? String(catalog.dsldLabelId)
          : workingSnapshot.regulatory.dsldLabelId ?? barcodeGtin14;
        const dsldIdentityType =
          catalog.dsldLabelId || workingSnapshot.regulatory.dsldLabelId ? "dsldLabelId" : "gtin14";
        const dsldDigest = buildFactsDigestFromDsld({
          facts: dsldFacts,
          snapshot: workingSnapshot,
          identityValue: dsldIdentityValue,
          regionTags: workingSnapshot.regulatory.regionTags,
        });
        startStage0Bundle({
          digest: dsldDigest,
          identityType: dsldIdentityType,
          identityValue: dsldIdentityValue,
          factsSourceVersion: dsldFactsSourceVersion,
          stage0Winner: "label_record",
          allowAi: Boolean(deepseekKey),
          apiKey: deepseekKey,
        });
      }

      const payloadSources = workingAnalysisPayload.sources ?? [];
      workingAnalysisPayload = {
        ...workingAnalysisPayload,
        analysis: analysisMeta,
        productInfo: {
          brand: finalProductInfo.brand,
          name: finalProductInfo.name,
          category: finalProductInfo.category,
          image: finalProductInfo.image,
        },
        sources: payloadSources,
      };

      sendSSE(res, "brand_extracted", {
        brand: catalog.brand,
        product: catalog.productName,
        category: catalog.category ?? catalog.categoryRaw ?? null,
        confidence: "high",
        source: "rule",
      });

      const sources =
        payloadSources.length > 0
          ? payloadSources
          : workingSnapshot.references.items.map((ref) => ({
            title: ref.title,
            link: ref.url,
            domain: extractDomain(ref.url),
            isHighQuality: false,
          }));

      sendSSE(res, "product_info", { productInfo: finalProductInfo, sources });

      if (!streamAnalysisBundleOnly) {
        if (workingAnalysisPayload.efficacy) {
          sendSSE(res, "result_efficacy", workingAnalysisPayload.efficacy);
        }
        if (workingAnalysisPayload.safety) {
          sendSSE(res, "result_safety", workingAnalysisPayload.safety);
        }
        if (workingAnalysisPayload.usagePayload) {
          sendSSE(res, "result_usage", workingAnalysisPayload.usagePayload);
        }

        sendSSE(res, "snapshot", workingSnapshot);
      }
      stage0Delivered = true;
      stage0Source = "catalog";

      const expiresAt = computeExpiresAt(analysisStatus);
      void storeSnapshotCache({
        key: gtin14,
        source: "barcode",
        snapshot: workingSnapshot,
        analysisPayload: workingAnalysisPayload,
        expiresAt,
      });

      const timingTotalMs = Math.round(performance.now() - startedAt);
      const brandName = finalProductInfo.brand ?? null;
      const productName = finalProductInfo.name ?? null;

      void logBarcodeScan({
        barcodeGtin14: gtin14,
        barcodeRaw: rawBarcode,
        checksumValid: normalized.isValidChecksum ?? null,
        catalogHit: true,
        servedFrom: cached ? servedFromCatalogCache : servedFromCatalog,
        dsldLabelId: catalog.dsldLabelId,
        snapshotId: workingSnapshot.snapshotId,
        brandName,
        productName,
        deviceId,
        requestId,
        timingTotalMs,
        meta: buildAuthorityMeta({
          cacheKey: gtin14,
          mode: cached ? "catalog_hit_with_snapshot" : "catalog_hit_no_snapshot",
          deepseek_bundle_skipped_reason: "stage0_hit",
          timing: { stage0_ms: timingTotalMs },
        }),
      });

      catalogSnapshotForAi = workingSnapshot;
      catalogAnalysisPayloadForAi = workingAnalysisPayload;
      catalogLabelExtractionForAi = labelExtraction;

      // Hard rule (Stage 0 termination authority): Catalog/DSLD/override hit ends the interactive
      // flow. Web resolution (Stage 1) must not run for first-party hits.
      if (aiAvailable && deepseekKey && analysisStatus !== "complete" && analysisStatus !== "ai_enriched") {
        queueFirstPartyAnalysisCompletion({
          cacheKey: gtin14,
          barcode,
          model,
          deepseekKey,
          snapshot: workingSnapshot,
          analysisPayload: workingAnalysisPayload,
          labelFacts: dsldLabelFacts ?? null,
        });
      }

      if (!forceStage1) {
        await awaitStage0Bundle();
        finalizeStream("catalog_stage0_complete");
        return;
      }
      console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after catalog hit");
    }

    const allowDsldFallbackProbeEarly =
      STAGE0_DSLD_BARCODE_FALLBACK_ENABLED && Boolean(barcodeGtin14);
    if (!streamAnalysisBundleOnly && !stage0Delivered && !requestSignal.aborted && allowDsldFallbackProbeEarly) {
      const dsldRecoveredSeededEarly = await maybeRunDsldDirectFallbackStage0({ allowForFullStream: true });
      if (dsldRecoveredSeededEarly && stage0BundlePromise) {
        await awaitAnalysisBundle();
        if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
          finalizeStream("dsld_barcode_stage0_full_stream_recovered");
        }
        releaseInFlightOnce();
        return;
      }
    }

    // =========================================================================
    // Stage 0: LNHPD bootstrap (first-party resolver)
    // =========================================================================
    // Hard rule: Stage 1 web resolution must not start (or short-circuit) before we
    // give first-party resolvers (A/Catalog/LNHPD) a chance to terminate.
    let regulatoryMap: Awaited<ReturnType<typeof getBarcodeRegulatoryMap>> | null = null;
    if (lnhpdRuntimeEnabledForRequest) {
      regMapPrimaryAttempted = true;
      try {
        regulatoryMap = await regulatoryMapPromise;
        if (regulatoryMap) {
          regMapPrimaryStatus = isExpiredAt(regulatoryMap.expires_at) ? "stale" : "hit";
        }
      } catch (error) {
        regulatoryMapStatus = "timeout";
        regMapPrimaryStatus = "timeout";
        console.warn("[ResolutionV2] Regulatory map lookup failed", error);
      }
    }

    if (lnhpdRuntimeEnabledForRequest && authorityRegressionScenarioActive && !requestSignal.aborted) {
      const seededNpnFromMap =
        typeof regulatoryMap?.npn === "string" ? regulatoryMap.npn.replace(/\D/g, "").trim() : "";
      authorityRegressionScenarioHistoricalNpn =
        seededNpnFromMap.length >= 6
          ? seededNpnFromMap
          : AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN.length >= 6
            ? AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN
            : null;
      regulatoryMap = null;
      regulatoryMapStatus = "miss";
      regMapPrimaryStatus = "miss";
      console.info("[ResolutionV2] Applied authority regression sample", {
        barcode: barcodeGtin14,
        historicalNpn: authorityRegressionScenarioHistoricalNpn,
      });
    }

    // Stage0 hardening: if the first map read misses (or times out), do one direct second-chance
    // read without the shared read semaphore to avoid false Web fallback during transient queue pressure.
    // Safety rule: this must stay exact-match only (same gtin14 + same raw digits), no fuzzy lookup.
    if (lnhpdRuntimeEnabledForRequest && !regulatoryMap && !requestSignal.aborted) {
      regMapSecondChanceAttempted = true;
      if (authorityRegressionScenarioActive) {
        regMapSecondChanceLatencyMs = 0;
        regMapSecondChanceResult = "timeout";
        regulatoryMapStatus = "timeout";
        console.info("[ResolutionV2] Forced map second-chance timeout for authority regression sample", {
          barcode: barcodeGtin14,
        });
      } else {
        const secondChanceStartedAt = performance.now();
        try {
          const secondChance = await getBarcodeRegulatoryMap(barcodeGtin14, barcodeRawDigits, {
            ...supabaseReadResilience,
            semaphore: undefined,
            queueTimeoutMs: 0,
            timeoutMs: REG_MAP_SECOND_CHANCE_TIMEOUT_MS,
            includeExpired: true,
            retry: {
              maxAttempts: 1,
            },
          });
          regMapSecondChanceLatencyMs = Math.round(performance.now() - secondChanceStartedAt);
          if (secondChance) {
            regMapSecondChanceResult = "hit";
            regulatoryMap = secondChance;
            console.info("[ResolutionV2] Regulatory map second-chance hit", {
              barcode: barcodeGtin14,
              npn: secondChance.npn,
              source: secondChance.source,
            });
          } else {
            regMapSecondChanceResult = "miss";
          }
        } catch (error) {
          regMapSecondChanceLatencyMs = Math.round(performance.now() - secondChanceStartedAt);
          if (error instanceof TimeoutError || isAbortError(error)) {
            regMapSecondChanceResult = "timeout";
          } else {
            regMapSecondChanceResult = "error";
          }
          if (regulatoryMapStatus !== "timeout") {
            regulatoryMapStatus = "timeout";
          }
          console.warn("[ResolutionV2] Regulatory map second-chance failed", error);
        }
      }
    }

    let historicalLnhpd: Awaited<ReturnType<typeof getHistoricalLnhpdScanNpn>> | null = null;
    let nameMatchedNpnCandidate: string | null = null;
    const resolveCandidate = (historicalNpn?: string | null) =>
      resolveAuthorityCandidate({
        regulatoryMap,
        snapshot: cachedFast?.snapshot ?? null,
        mapMinConfidence: REGULATORY_MAP_MIN_CONFIDENCE,
        staleWindowMs: REGULATORY_MAP_STALE_WINDOW_MS,
        historicalNpn: historicalNpn ?? null,
        allowLnhpd: lnhpdRuntimeEnabledForRequest,
      });

    let authority = resolveCandidate();
    let candidate = authority.candidate;
    if (regulatoryMapStatus !== "timeout") {
      regulatoryMapStatus = authority.mapStatus;
    }

    // Root-fix for cache resets: if map/snapshot are gone, recover LNHPD candidate
    // from prior successful scans of the same GTIN14 before falling into Web.
    if (lnhpdRuntimeEnabledForRequest && !candidate && !requestSignal.aborted) {
      if (authorityRegressionScenarioActive && authorityRegressionScenarioHistoricalNpn) {
        historicalLnhpd = {
          barcode_gtin14: barcodeGtin14,
          npn: authorityRegressionScenarioHistoricalNpn,
          source: "barcode_scans",
          created_at: new Date().toISOString(),
          served_from: "lnhpd",
        };
      } else {
        historicalLnhpd = await getHistoricalLnhpdScanNpn(barcodeGtin14, barcodeRawDigits, {
          ...supabaseReadResilience,
          timeoutMs: 500,
          queueTimeoutMs: 0,
          retry: { maxAttempts: 1 },
        }).catch(() => null);
      }
      if (historicalLnhpd?.npn) {
        authority = resolveCandidate(historicalLnhpd.npn);
        candidate = authority.candidate;
        if (regulatoryMapStatus !== "timeout") {
          regulatoryMapStatus = authority.mapStatus;
        }
      }
    }

    // Name/brand fallback: when barcode mapping misses but we still have stable product hints
    // (usually from cached snapshot metadata), try a strict LNHPD name match before Web Stage 1.
    if (lnhpdRuntimeEnabledForRequest && !candidate && !requestSignal.aborted) {
      const hintBrand =
        cachedFast?.analysisPayload?.productInfo?.brand ??
        cachedFast?.snapshot?.product?.brand ??
        null;
      const hintProduct =
        cachedFast?.analysisPayload?.productInfo?.name ??
        cachedFast?.snapshot?.product?.name ??
        null;
      if ((hintBrand && hintBrand.trim().length > 0) || (hintProduct && hintProduct.trim().length > 0)) {
        try {
          const nameMatchedFacts =
            prefetchedNameMatchFacts ??
            (await fetchLnhpdFactsByName(
              { brand: hintBrand, product: hintProduct },
              requestSignal,
            ));
          const matchedNpn = nameMatchedFacts?.npn?.replace(/\D/g, "").trim() ?? "";
          if (matchedNpn.length >= 6) {
            nameMatchedNpnCandidate = matchedNpn;
            candidate = {
              npn: matchedNpn,
              source: "name_match",
              isStale: true,
              // Name-match now requires dose/form-aware scoring; treat as high-confidence to avoid
              // dropping clear matches (e.g., Vitamin D 1000IU tablet variants) in sparse-label cases.
              requiresGuardrail: false,
              confidence: 0.9,
            };
            console.info("[ResolutionV2] Recovered LNHPD candidate from name match", {
              barcode: barcodeGtin14,
              npn: matchedNpn,
              hintBrand,
              hintProduct,
            });
          }
        } catch (error) {
          console.warn("[ResolutionV2] LNHPD name-match candidate lookup failed", error);
        }
      }
    }

    npnCandidatesForMeta = buildNpnCandidates({
      regulatoryMap,
      mapStatus: authority.mapStatus,
      mapMinConfidence: REGULATORY_MAP_MIN_CONFIDENCE,
      authorityCandidate: candidate,
      snapshot: cachedFast?.snapshot ?? null,
      historicalNpn: historicalLnhpd?.npn ?? null,
      nameMatchNpn: nameMatchedNpnCandidate,
      maxCandidates: NPN_CANDIDATE_MAX,
    });

    if (candidate?.source === "scan_history" && historicalLnhpd?.npn) {
      console.info("[ResolutionV2] Recovered LNHPD candidate from scan history", {
        barcode: barcodeGtin14,
        npn: historicalLnhpd.npn,
        createdAt: historicalLnhpd.created_at,
      });
    }

    if (candidate) {
      npnCandidateSource =
        candidate.source === "snapshot"
          ? "snapshot"
          : candidate.source === "scan_history"
            ? "scan_history"
            : candidate.source === "name_match"
              ? "name_match"
              : "map";
      authorityCandidateSource = candidate.source;
      npnCandidateStale = candidate.isStale;

      const npnNegative = await getNpnNegativeCache(candidate.npn, {
        ...supabaseReadResilience,
        timeoutMs: 250,
      }).catch(() => null);
      const npnNegativeReasonCode =
        typeof npnNegative?.reason_code === "string" ? npnNegative.reason_code : null;
      const highConfidenceMapCandidate =
        (candidate.source === "map" || candidate.source === "map_stale") &&
        Number(candidate.confidence ?? 0) >= 0.9;
      const shouldBypassAuthorityNegativeCache =
        Boolean(npnNegative) &&
        npnNegativeReasonCode === "lnhpd_not_found" &&
        highConfidenceMapCandidate;
      authorityNegativeCacheBypassed = shouldBypassAuthorityNegativeCache;
      if (shouldBypassAuthorityNegativeCache) {
        console.info("[ResolutionV2] Bypassing LNHPD negative cache for high-confidence map candidate", {
          barcode: barcodeGtin14,
          npn: candidate.npn,
          source: candidate.source,
          confidence: candidate.confidence ?? null,
        });
      }
      const npnNegativeIsBlocking =
        Boolean(npnNegative) &&
        npnNegativeReasonCode !== "lnhpd_timeout" &&
        !shouldBypassAuthorityNegativeCache;
      if (npnNegativeIsBlocking) {
        npnNegativeCacheHit = true;
        authorityFailureReason = "negative_cache_blocked";
      } else {
        // Older deployments wrote timeouts into the negative cache, which can "poison" Stage0
        // and make a known-good NPN fall back to Web. Ignore (and best-effort clear) timeouts.
        if (npnNegativeReasonCode === "lnhpd_timeout") {
          void clearNpnNegativeCache(candidate.npn, { ...supabaseReadResilience, timeoutMs: 500 });
        }
        try {
          const lnhpdLookup = await fetchLnhpdFactsWithSecondChance(candidate.npn, requestSignal, {
            firstTimeoutMs: RESILIENCE_LNHPD_TIMEOUT_MS,
            secondTimeoutMs: RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS,
            forceMode: authorityFailMode,
            allowWhenRuntimeDisabled: authorityRegressionScenarioActive,
          });
          authorityLnhpdAttempt1Status = lnhpdLookup.attempt1Status;
          authorityLnhpdAttempt2Status = lnhpdLookup.attempt2Status;
          lnhpdFetchStatus = lnhpdLookup.finalStatus;
          const lnhpdFacts = lnhpdLookup.facts;
          if (process.env.DEBUG_LNHPD_NAME_MATCH === "1") {
            console.info("[ResolutionV2] LNHPD candidate fetch", {
              barcode: barcodeGtin14,
              npn: candidate.npn,
              source: candidate.source,
              attempt1Status: lnhpdLookup.attempt1Status,
              attempt2Status: lnhpdLookup.attempt2Status,
              finalStatus: lnhpdLookup.finalStatus,
              hasFacts: Boolean(lnhpdFacts),
            });
          }

          if (lnhpdFacts) {
            authorityFailureReason = null;

            let guardrailPass = true;
            if (candidate.requiresGuardrail) {
              const evidence = buildCandidateEvidence({
                snapshot: cachedFast?.snapshot ?? null,
                analysisPayload: cachedFast?.analysisPayload ?? null,
                catalog,
              });
              const guardrail = computeGuardrailScore({
                lnhpdFacts,
                candidateBrands: evidence.brands,
                candidateNames: evidence.names,
                candidateIngredients: evidence.ingredients,
              });
              lnhpdGuardrailScore = guardrail.score;
              guardrailPass = guardrail.score >= GUARDRAIL_SIMILARITY_THRESHOLD;
              lnhpdGuardrailPass = guardrailPass;
            }

            if (!guardrailPass) {
              authorityFailureReason = "guardrail_failed";
              void upsertBarcodeRegulatoryMap({
                barcodeGtin14,
                npn: candidate.npn,
                confidence: 0.2,
                source: "conflict",
                expiresAt: new Date(Date.now() + REGULATORY_MAP_CONFLICT_TTL_MS).toISOString(),
                barcodeRaw: rawBarcode,
              });
            } else {
              const lnhpdLabelFacts = toLabelFactsFromLnhpd(lnhpdFacts);
              const labelExtraction: LabelExtractionMeta = {
                source: "lnhpd",
                fetchedAt: lnhpdFacts.extractedAt ?? nowIso(),
                datasetVersion: lnhpdFacts.datasetVersion ?? null,
              };

              const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);
              const lnhpdProductInfo = {
                brand: lnhpdFacts.brandName ?? null,
                name: lnhpdFacts.productName ?? null,
                category: null,
                image: null,
              };

              const lnhpdSources: { title: string; link: string; domain: string; isHighQuality: boolean }[] = [];
              const lnhpdAnalysisPayload: SnapshotAnalysisPayload = {
                ...labelAnalysis,
                brandExtraction: {
                  brand: lnhpdFacts.brandName ?? null,
                  product: lnhpdFacts.productName ?? null,
                  category: null,
                  confidence: "high",
                  source: "rule",
                },
                productInfo: lnhpdProductInfo,
                sources: lnhpdSources,
              };

              let lnhpdSnapshot = buildBarcodeSnapshot({
                barcode,
                productInfo: lnhpdProductInfo,
                sources: [],
                efficacy: lnhpdAnalysisPayload.efficacy ?? null,
                safety: lnhpdAnalysisPayload.safety ?? null,
                usagePayload: lnhpdAnalysisPayload.usagePayload ?? null,
              });
              lnhpdSnapshot = applyLnhpdFactsToSnapshot(lnhpdSnapshot, lnhpdFacts);

              const lnhpdFactsSourceVersion = `lnhpd:${lnhpdFacts.datasetVersion ?? lnhpdFacts.extractedAt ?? "unknown"}`;
              const lnhpdDigest = buildFactsDigestFromLnhpd({
                facts: lnhpdFacts,
                snapshot: lnhpdSnapshot,
                identityValue: candidate.npn,
                regionTags: lnhpdSnapshot.regulatory.regionTags,
              });
              startStage0Bundle({
                digest: lnhpdDigest,
                identityType: "npn",
                identityValue: candidate.npn,
                factsSourceVersion: lnhpdFactsSourceVersion,
                stage0Winner: "verified_regulatory",
                allowAi: false,
                apiKey: deepseekKey,
              });

              const analysisStatus = buildAnalysisStatus({
                hasLabelFacts: hasLabelFacts(lnhpdSnapshot),
                hasAi: hasAiPayload(lnhpdAnalysisPayload),
                dsldLabelId: null,
              });
              const analysisMeta = buildAnalysisMeta({
                status: analysisStatus,
                labelExtraction,
                overlayClaims: await getOverlayClaimsForBarcode(),
              });
              lnhpdAnalysisPayload.analysis = analysisMeta;
              lnhpdSnapshot.status = "resolved";
              lnhpdSnapshot.analysis = analysisMeta;
              lnhpdSnapshot.updatedAt = nowIso();

              sendSSE(res, "brand_extracted", {
                brand: lnhpdFacts.brandName ?? null,
                product: lnhpdFacts.productName ?? null,
                category: null,
                confidence: "high",
                source: "rule",
              });

              sendSSE(res, "product_info", {
                productInfo: {
                  brand: lnhpdFacts.brandName ?? null,
                  name: lnhpdFacts.productName ?? null,
                  category: null,
                  image: null,
                },
                sources: [],
              });

              if (!streamAnalysisBundleOnly) {
                sendSSE(res, "result_efficacy", lnhpdAnalysisPayload.efficacy);
                sendSSE(res, "result_safety", lnhpdAnalysisPayload.safety);
                sendSSE(res, "result_usage", lnhpdAnalysisPayload.usagePayload);
                sendSSE(res, "snapshot", lnhpdSnapshot);
              }
              stage0Delivered = true;
              stage0Source = "lnhpd";

              const expiresAt = computeExpiresAt(analysisStatus);
              void storeSnapshotCache({
                key: barcodeGtin14,
                source: "barcode",
                snapshot: lnhpdSnapshot,
                analysisPayload: lnhpdAnalysisPayload,
                expiresAt,
              });

              void upsertBarcodeRegulatoryMap({
                barcodeGtin14,
                npn: candidate.npn,
                confidence: Math.max(0.9, candidate.confidence ?? 0),
                source: "lnhpd",
                expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_LNHPD).toISOString(),
                barcodeRaw: rawBarcode,
              });

              // Stage0 may still have stale Stage1 negatives from earlier breaker/timeouts.
              // Clear both gtin/raw variants after a successful authoritative LNHPD resolution.
              clearNegativeCacheAllVariants(barcodeGtin14, rawBarcode, {
                context: "lnhpd_map_stage0_success",
              });
              void clearNpnNegativeCache(candidate.npn, { ...supabaseReadResilience, timeoutMs: 500 });

              if (aiAvailable && deepseekKey && analysisStatus !== "complete" && analysisStatus !== "ai_enriched") {
                queueFirstPartyAnalysisCompletion({
                  cacheKey: barcodeGtin14,
                  barcode,
                  model,
                  deepseekKey,
                  snapshot: lnhpdSnapshot,
                  analysisPayload: lnhpdAnalysisPayload,
                  labelFacts: lnhpdLabelFacts,
                });
              }

              const timingTotalMs = Math.round(performance.now() - startedAt);
              void logBarcodeScan({
                barcodeGtin14,
                barcodeRaw: rawBarcode,
                checksumValid: normalized.isValidChecksum ?? null,
                catalogHit: false,
                servedFrom: "lnhpd",
                dsldLabelId: null,
                snapshotId: lnhpdSnapshot.snapshotId,
                brandName: lnhpdFacts.brandName ?? null,
                productName: lnhpdFacts.productName ?? null,
                deviceId,
                requestId,
                timingTotalMs,
                meta: buildAuthorityMeta({
                  stage0: "lnhpd_map_hit",
                  npn: candidate.npn,
                  deepseek_bundle_skipped_reason: "stage0_hit",
                  timing: { stage0_ms: timingTotalMs },
                }),
              });

              if (!forceStage1) {
                await awaitStage0Bundle();
                finalizeStream("lnhpd_stage0_complete");
                return;
              }
              console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after LNHPD map hit");
            }
          } else {
            if (lnhpdLookup.finalStatus === "timeout") {
              authorityFailureReason =
                lnhpdLookup.attempt2Status === "timeout" ? "lnhpd_timeout_second" : "lnhpd_timeout_first";
            } else if (lnhpdLookup.finalStatus === "not_found") {
              authorityFailureReason = "lnhpd_not_found";
            } else {
              authorityFailureReason = "lnhpd_query_error";
            }
            if (lnhpdFetchStatus === "not_found") {
              void upsertBarcodeRegulatoryMap({
                barcodeGtin14,
                npn: candidate.npn,
                confidence: 0.2,
                source: "lnhpd_not_found",
                expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
                barcodeRaw: rawBarcode,
              }, {
                ...supabaseReadResilience,
                writeGuardMode: "enforce",
              });
            }

            if (lnhpdFetchStatus === "not_found") {
              void recordNpnNegativeAttempt(
                {
                  npn: candidate.npn,
                  reasonCode: "lnhpd_not_found",
                  windowMs: NPN_NEGATIVE_CACHE_WINDOW_HOURS * 60 * 60 * 1000,
                  threshold: NPN_NEGATIVE_CACHE_THRESHOLD,
                  ttlMs: NPN_NEGATIVE_CACHE_TTL_MS,
                },
                { ...supabaseReadResilience, timeoutMs: 500 },
              );
            }
          }
        } catch (error) {
          lnhpdFetchStatus = "error";
          authorityFailureReason = "lnhpd_query_error";
          authorityLnhpdAttempt1Status =
            authorityLnhpdAttempt1Status === "not_attempted" ? "error" : authorityLnhpdAttempt1Status;
          console.warn("[ResolutionV2] LNHPD fetch failed", error);
        }
      }
    }

    if (LNHPD_RUNTIME_ENABLED && !stage0Delivered && !requestSignal.aborted && streamState.latestSourceTypeFinal !== true) {
      await maybeRunNpnCandidateBackfill();
    }

    async function maybeRunDsldDirectFallbackStage0(params?: { allowForFullStream?: boolean }): Promise<boolean> {
      const stage0RecoveryStartedAt = performance.now();
      if (!STAGE0_DSLD_BARCODE_FALLBACK_ENABLED) return false;
      const seededLabelId = resolvePreferredStage0DsldLabelId(barcodeGtin14);
      const hasSeededLabelId = Boolean(seededLabelId && Number.isFinite(seededLabelId));
      const allowForFullStream = params?.allowForFullStream === true
        && (STAGE0_DSLD_BARCODE_FALLBACK_FULL_ENABLED || hasSeededLabelId);
      const fallbackLane = streamAnalysisBundleOnly ? "bundle_only" : "full";
      if (streamAnalysisBundleOnly) {
        if (!BUNDLE_ONLY_SKIP_WEB_SEARCH) return false;
      } else if (!allowForFullStream) {
        return false;
      }
      if (requestSignal.aborted || stage0Delivered || streamState.latestSourceTypeFinal === true) return false;

      const fetchWithSoftTimeout = async <T>(
        factory: () => Promise<T>,
        timeoutMs: number,
      ): Promise<T | null> => {
        const value = await Promise.race<T | null>([
          factory().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
        ]);
        return value;
      };

      const buildSeededFallbackFacts = (labelId: number): DsldFacts => ({
        dsldLabelId: labelId,
        brandName: null,
        productName: null,
        servingSize: null,
        servingsPerContainer: null,
        actives: [],
        inactive: [],
        proprietaryBlends: [],
        datasetVersion: null,
        extractedAt: nowIso(),
        dsldPdf: null,
        dsldThumbnail: null,
        factsSource: "meta_summary",
      });

      let dsldFacts: DsldFacts | null = null;
      const canonicalLabelId = hasSeededLabelId
        ? Number(seededLabelId)
        : await fetchWithSoftTimeout(
            () => fetchCanonicalDsldLabelIdByBarcode(barcodeGtin14, requestSignal),
            Math.min(450, STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS),
          );
      const prioritizedLabelId =
        Number.isFinite(Number(seededLabelId)) && Number(seededLabelId) > 0
          ? Number(seededLabelId)
          : Number.isFinite(Number(canonicalLabelId)) && Number(canonicalLabelId) > 0
            ? Number(canonicalLabelId)
            : null;

      if (prioritizedLabelId) {
        const seededFetchTimeoutMs = streamAnalysisBundleOnly
          ? STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS
          : Math.max(
              STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS,
              STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS,
            );
        dsldFacts = await fetchWithSoftTimeout(
          () => fetchDsldFactsByLabelId(prioritizedLabelId, requestSignal),
          seededFetchTimeoutMs,
        );
        if (!dsldFacts) {
          // For seeded/canonical-mapped barcodes, prefer deterministic authoritative identity
          // over waiting on a second blocking fetch.
          // This applies to bundle_only and full lanes to prevent web-only terminal fallback when
          // authoritative DSLD identity is already known.
          dsldFacts = buildSeededFallbackFacts(prioritizedLabelId);
          void fetchDsldFactsByLabelId(prioritizedLabelId, requestSignal).catch(() => null);
          void fetchDsldFactsByBarcode(barcodeGtin14, requestSignal).catch(() => null);
        }
      }

      if (!dsldFacts) {
        dsldFacts = await fetchWithSoftTimeout(
          () => fetchDsldFactsByBarcode(barcodeGtin14, requestSignal),
          STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS,
        );
      }
      if (!dsldFacts) return false;

      const dsldLabelFacts = toLabelFactsFromDsld(dsldFacts);
      const labelExtraction: LabelExtractionMeta = {
        source: "dsld",
        fetchedAt: dsldFacts.extractedAt ?? nowIso(),
        datasetVersion: dsldFacts.datasetVersion ?? null,
      };
      const dsldProductInfo = {
        brand: dsldFacts.brandName ?? null,
        name: dsldFacts.productName ?? null,
        category: null,
        image: null,
      };
      const dsldAnalysisPayload: SnapshotAnalysisPayload = {
        ...buildLabelOnlyAnalysis(dsldLabelFacts),
        brandExtraction: {
          brand: dsldProductInfo.brand,
          product: dsldProductInfo.name,
          category: dsldProductInfo.category,
          confidence: "high",
          source: "rule",
        },
        productInfo: dsldProductInfo,
        sources: [],
      };
      let dsldSnapshot = buildBarcodeSnapshot({
        barcode,
        productInfo: dsldProductInfo,
        sources: [],
        efficacy: dsldAnalysisPayload.efficacy ?? null,
        safety: dsldAnalysisPayload.safety ?? null,
        usagePayload: dsldAnalysisPayload.usagePayload ?? null,
      });
      dsldSnapshot = applyDsldFactsToSnapshot(dsldSnapshot, dsldFacts);

      const dsldIdentityType = Number.isFinite(Number(dsldFacts.dsldLabelId)) ? "dsldLabelId" : "gtin14";
      const dsldIdentityValue =
        dsldIdentityType === "dsldLabelId" ? String(dsldFacts.dsldLabelId) : barcodeGtin14;
      const dsldFactsSourceVersion = `dsld:${dsldFacts.datasetVersion ?? dsldFacts.extractedAt ?? "unknown"}`;
      const dsldDigest = buildFactsDigestFromDsld({
        facts: dsldFacts,
        snapshot: dsldSnapshot,
        identityValue: dsldIdentityValue,
        regionTags: dsldSnapshot.regulatory.regionTags,
      });
      const started = startStage0Bundle({
        digest: dsldDigest,
        identityType: dsldIdentityType,
        identityValue: dsldIdentityValue,
        factsSourceVersion: dsldFactsSourceVersion,
        stage0Winner: "label_record",
        allowAi: false,
        apiKey: deepseekKey,
      });
      if (!started) return false;

      const analysisStatus = buildAnalysisStatus({
        hasLabelFacts: hasLabelFacts(dsldSnapshot),
        hasAi: hasAiPayload(dsldAnalysisPayload),
        dsldLabelId: dsldFacts.dsldLabelId ?? null,
      });
      const analysisMeta = buildAnalysisMeta({
        status: analysisStatus,
        labelExtraction,
        overlayClaims: await getOverlayClaimsForBarcode(),
      });
      dsldAnalysisPayload.analysis = analysisMeta;
      dsldSnapshot.status = "resolved";
      dsldSnapshot.analysis = analysisMeta;
      dsldSnapshot.updatedAt = nowIso();
      const expiresAt = computeExpiresAt(analysisStatus);
      void storeSnapshotCache({
        key: cacheKey,
        source: "barcode",
        snapshot: dsldSnapshot,
        analysisPayload: dsldAnalysisPayload,
        expiresAt,
      });

      stage0Delivered = true;
      stage0Source = "dsld";
      clearNegativeCacheAllVariants(barcodeGtin14, rawBarcode, {
        context: "dsld_fallback_stage0_success",
      });
      const stage0RecoveryMs = performance.now() - stage0RecoveryStartedAt;
      incrementMetric("stage0_dsld_recovery_rate");
      recordMetricTiming("stage0_dsld_recovery_ms", stage0RecoveryMs);
      console.info("[telemetry] stage0_dsld_recovery", {
        barcode: barcodeGtin14,
        lane: fallbackLane,
        recoveryMs: Math.round(stage0RecoveryMs * 10) / 10,
        seededLabelId,
        canonicalLabelId: prioritizedLabelId && prioritizedLabelId !== Number(seededLabelId ?? 0)
          ? prioritizedLabelId
          : null,
        dsldLabelId: dsldFacts.dsldLabelId ?? null,
      });
      console.info("[ResolutionV2] Stage0 DSLD fallback recovered authoritative path", {
        barcode: barcodeGtin14,
        lane: fallbackLane,
        seededLabelId,
        canonicalLabelId: prioritizedLabelId && prioritizedLabelId !== Number(seededLabelId ?? 0)
          ? prioritizedLabelId
          : null,
        dsldLabelId: dsldFacts.dsldLabelId ?? null,
      });
      return true;
    }

    if (!streamAnalysisBundleOnly && !stage0Delivered && !requestSignal.aborted) {
      const dsldRecoveredFullStream = await maybeRunDsldDirectFallbackStage0({ allowForFullStream: true });
      if (dsldRecoveredFullStream && stage0BundlePromise) {
        await awaitAnalysisBundle();
        if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
          finalizeStream("dsld_stage0_full_stream_recovered");
        }
        releaseInFlightOnce();
        return;
      }
    }

    // Bundle-only stability gate:
    // If Stage 0 did not resolve to a final authoritative result, skip Stage 1 web search
    // entirely and close with limited rev1 + done. This avoids expensive regex-heavy web paths
    // under mobile soak/concurrency pressure.
    if (streamAnalysisBundleOnly && BUNDLE_ONLY_SKIP_WEB_SEARCH) {
      if (SSE_LIFECYCLE_LOG_ENABLED) {
        console.info("[ResolutionV2] bundle_only_stage1_skipped", {
          requestId: requestId || null,
          barcode: barcodeGtin14,
          stage0Delivered,
          stage0Source,
        });
      }
      if (stage0BundlePromise) {
        await awaitAnalysisBundle();
        if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
          finalizeStream("bundle_only_stage0_complete");
        }
        releaseInFlightOnce();
        return;
      }
      if (stage0Delivered) {
        if (!streamState.rev1Sent && !streamState.doneSent && !streamState.ended && !res.writableEnded) {
          markPipelineStepEnd("retrieve", "degraded", "bundle_only_stage0_no_rev1");
          emitDegradedLimitedRev1AndFinalize("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH");
          releaseInFlightOnce(new Error("bundle_only_stage0_no_rev1"));
          return;
        }
        if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
          finalizeStream("bundle_only_stage0_complete");
        }
        releaseInFlightOnce();
        return;
      }
      const dsldRecovered = await maybeRunDsldDirectFallbackStage0();
      if (dsldRecovered && stage0BundlePromise) {
        await awaitAnalysisBundle();
        if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
          finalizeStream("bundle_only_dsld_stage0_recovered");
        }
        releaseInFlightOnce();
        return;
      }
      markPipelineStepEnd("retrieve", "degraded", "bundle_only_skip_web_search");
      emitDegradedLimitedRev1AndFinalize("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH");
      releaseInFlightOnce(new Error("bundle_only_skip_web_search"));
      return;
    }

    const aiRequired = !catalog;

    if (!googleApiKey || !cx) {
      if (aiRequired) {
        emitTerminalErrorAndFinalize({
          code: "CONFIG_ERROR",
          stage: "search",
          reasonCode: "GOOGLE_CSE_NOT_CONFIGURED",
          retryable: false,
          message: "Google CSE not configured",
          finalizeReason: "google_cse_not_configured",
          releaseError: new Error("google_cse_not_configured"),
        });
        const timingTotalMs = Math.round(performance.now() - startedAt);
        void logBarcodeScan({
          barcodeGtin14,
          barcodeRaw: rawBarcode,
          checksumValid: normalized.isValidChecksum ?? null,
          catalogHit: false,
          servedFrom: "error_config",
          dsldLabelId: null,
          snapshotId: null,
          deviceId,
          requestId,
          timingTotalMs,
          meta: buildAuthorityMeta({ reason: "google_cse_env_not_set" }),
        });
        return;
      }
      finalizeStream("google_cse_missing_not_required");
      return;
    }

    if (!deepseekKey) {
      if (aiRequired) {
        emitTerminalErrorAndFinalize({
          code: "CONFIG_ERROR",
          stage: "draft",
          reasonCode: "DEEPSEEK_API_KEY_MISSING",
          retryable: false,
          message: "DeepSeek API key missing",
          finalizeReason: "deepseek_api_key_missing",
          releaseError: new Error("deepseek_api_key_missing"),
        });
        const timingTotalMs = Math.round(performance.now() - startedAt);
        void logBarcodeScan({
          barcodeGtin14,
          barcodeRaw: rawBarcode,
          checksumValid: normalized.isValidChecksum ?? null,
          catalogHit: false,
          servedFrom: "error_config",
          dsldLabelId: null,
          snapshotId: null,
          deviceId,
          requestId,
          timingTotalMs,
          meta: buildAuthorityMeta({ reason: "deepseek_api_key_missing" }),
        });
        return;
      }
      finalizeStream("deepseek_missing_not_required");
      return;
    }

    // In-flight dedup：同一 gtin14 同时被扫，只允许一个请求跑 Google/DeepSeek
    const existing = barcodeEnrichInFlight.get(cacheKey);
    if (existing) {
      sendSSE(res, "status", { stage: "wait_inflight", message: "Another analysis is in progress. Waiting..." });
      try {
        const waitMs = budget.msFor(30_000);
        if (waitMs > 0) {
          await withTimeoutPromise(existing, waitMs, requestSignal);
        }
      } catch { }

      if (requestSignal.aborted) {
        return;
      }

      const after = await getSnapshotCache(
        { key: cacheKey, source: "barcode" },
        {
          ...supabaseReadResilience,
          timeoutMs: RESILIENCE_SNAPSHOT_TIMEOUT_MS,
        },
      ).catch(() => null);
      if (after) {
        // Deterministic cache-hit contract: always emit analysis_bundle skeleton+fast,
        // even when we are returning from the in-flight wait path.
        if (!stage0BundlePromise) {
          const snapshotLabelSource =
            normalizeLabelExtractionSource(
              after.snapshot.analysis?.labelExtraction?.source ??
              after.analysisPayload?.analysis?.labelExtraction?.source ??
              null,
            );
          const snapshotLabelVersion =
            after.snapshot.analysis?.labelExtraction?.datasetVersion ??
            after.analysisPayload?.analysis?.labelExtraction?.datasetVersion ??
            after.snapshot.analysis?.labelExtraction?.fetchedAt ??
            null;

          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = `snapshot:${snapshotLabelSource ?? "unknown"}`;

          const snapshotNpn = LNHPD_RUNTIME_ENABLED ? after.snapshot.regulatory.npn ?? null : null;
          if (
            LNHPD_RUNTIME_ENABLED &&
            (snapshotLabelSource === "lnhpd" || snapshotLabelSource === "manual") &&
            snapshotNpn
          ) {
            identityType = "npn";
            identityValue = snapshotNpn;
            factsSourceVersion = `lnhpd:${snapshotLabelVersion ?? "unknown"}`;
            const fallbackFacts = buildLnhpdFactsInputFromSnapshot(after.snapshot);
            digest = buildFactsDigestFromLnhpd({
              facts: fallbackFacts,
              snapshot: after.snapshot,
              identityValue: snapshotNpn,
              regionTags: after.snapshot.regulatory.regionTags,
            });
          }

          const snapshotDsldLabelId = after.snapshot.regulatory.dsldLabelId ?? null;
          if (
            !digest &&
            snapshotLabelSource === "dsld" &&
            snapshotDsldLabelId
          ) {
            identityType = "dsldLabelId";
            identityValue = snapshotDsldLabelId;
            factsSourceVersion = `dsld:${snapshotLabelVersion ?? "unknown"}`;
            const fallbackFacts = buildDsldFactsInputFromSnapshot(after.snapshot);
            digest = buildFactsDigestFromDsld({
              facts: fallbackFacts,
              snapshot: after.snapshot,
              identityValue: snapshotDsldLabelId,
              regionTags: after.snapshot.regulatory.regionTags,
            });
          }

          if (!digest) {
            const urls = after.snapshot.references.items
              .map((ref) => ref.url)
              .filter((value): value is string => typeof value === "string" && value.length > 0)
              .slice(0, 2);
            const canonicalHash = createHash("sha256").update(urls.join("|")).digest("hex");
            const bestUrl = urls[0] ?? null;
            const webCanonicalId = bestUrl
              ? createHash("sha256")
                .update(`${bestUrl}|${RESOLUTION_ENGINE_VERSION}|${barcodeGtin14}`)
                .digest("hex")
              : barcodeGtin14;
            identityType = bestUrl ? "webCanonicalId" : "gtin14";
            identityValue = webCanonicalId;
            factsSourceVersion = urls.length
              ? `web:${RESOLUTION_ENGINE_VERSION}:${canonicalHash}`
              : `web:${RESOLUTION_ENGINE_VERSION}:none`;

            digest = buildFactsDigestFromWeb({
              facts: {
                barcode: barcodeGtin14,
                canonical: {
                  name: after.snapshot.product.name ?? null,
                  brand: after.snapshot.product.brand ?? null,
                  url: bestUrl,
                  domain: bestUrl ? extractDomain(bestUrl) : null,
                },
                identifiers: { npn: null },
                textFacts: {
                  ingredientsText: null,
                  directionsText: null,
                  warningsText: null,
                  servingSizeText: null,
                },
                coverageScore: 0,
                missingFields: [
                  "textFacts.ingredientsText",
                  "textFacts.directionsText",
                  "textFacts.warningsText",
                  "textFacts.servingSizeText",
                ],
              },
              snapshot: after.snapshot,
              identityType,
              identityValue,
              regionTags: after.snapshot.regulatory.regionTags,
            });
          }

          if (digest) {
            startStage0Bundle({
              digest,
              identityType,
              identityValue,
              factsSourceVersion,
              allowAi: Boolean(deepseekKey) && identityType !== "npn",
              apiKey: deepseekKey,
            });
          }
        }

        emitCachedSnapshot(after, null, streamAnalysisBundleOnly ? { mode: "analysis_bundle_only" } : undefined);
        await awaitAnalysisBundle();
        finalizeStream("wait_inflight_snapshot_complete");
        const timingTotalMs = Math.round(performance.now() - startedAt);
        const brandName = after.snapshot.product.brand ?? after.analysisPayload?.productInfo?.brand ?? null;
        const productName = after.snapshot.product.name ?? after.analysisPayload?.productInfo?.name ?? null;
        void logBarcodeScan({
          barcodeGtin14,
          barcodeRaw: rawBarcode,
          checksumValid: normalized.isValidChecksum ?? null,
          catalogHit: false,
          servedFrom: "wait_inflight",
          snapshotId: after.snapshot.snapshotId,
          brandName,
          productName,
          deviceId,
          requestId,
          timingTotalMs,
          meta: buildAuthorityMeta({ cacheKey: barcodeGtin14, mode: "wait_inflight_hit" }),
        });
        return;
      }
      // 如果等待后仍没有缓存（说明对方失败了），继续走你当前请求的 Google 流程
    }

    if (requestSignal.aborted) {
      return;
    }

    const deferred = createDeferred<void>();
    let inFlightActive = true;
    finishInFlight = (error?: unknown) => {
      if (!inFlightActive) return;
      inFlightActive = false;
      if (error) {
        deferred.reject(error);
      } else {
        deferred.resolve();
      }
      barcodeEnrichInFlight.delete(cacheKey);
    };

    barcodeEnrichInFlight.set(
      cacheKey,
      deferred.promise.catch(() => {
        /* swallow to avoid unhandled rejection */
      }),
    );

    // =========================================================================
    // STEP 1: Initial Barcode Search
    // =========================================================================
    if (STREAM_VERBOSE_LOG_ENABLED) {
      console.log(`[Stream] Starting analysis for barcode: ${barcode}`);
    }

    // =========================================================================
    // Stage 1 (V2): Budgeted web resolution
    // Hard rules enforced:
    // - negative_cache cannot block Stage 0 (and is ignored if snapshot cache hit)
    // - Google search calls <= RESOLUTION_SEARCH_CALLS_MAX
    // - LLM interactive calls: bundle <=1 (+ optional repair inside fetchAnalysisBundle)
    // - resolution_cache.best_url is only written on strongMatch (enforced before upsert)
    // =========================================================================

    const stage0Outcome: "snapshot" | "miss" = cachedFast ? "snapshot" : "miss";
    const stage1Start = performance.now();
    const stage1SseEnabled = stage0Source !== "lnhpd";
    const stage1SnapshotWriteEnabled = stage0Source !== "lnhpd";

    const acceptLanguage = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
    const envHl = process.env.SEARCH_HL?.trim() || null;
    const envGl = process.env.SEARCH_GL?.trim().toLowerCase() || null;
    const hl = envHl || (/^|,\s*zh\b/i.test(acceptLanguage) ? "zh-CN" : "en");
    const gl = envGl || (/\b(en|fr)-ca\b/i.test(acceptLanguage) ? "ca" : "us");
    const isCaRegion = gl?.toLowerCase() === "ca";

    const cacheHits: Record<string, boolean> = {
      negative: false,
      resolution: false,
      serp: false,
    };
    const calls: Record<string, number> = {
      google: 0,
      deepseek_bundle: 0,
      deepseek_repair: 0,
    };
    const timing: Record<string, number> = {};
    let backgroundBackfillQueued = false;
    let secondaryBackfillQueued = false;
    let shadowCompareQueued = false;
    let marketplaceRejectedCount = 0;
    let ownershipVerdict: "strong" | "weak" | "failed" = "failed";
    let providerUsed: string | null = null;
    let providerGtinMatch = false;

    const barcodeVariants = Array.from(
      new Set(
        (normalized.variants ?? [])
          .map((value) => value.replace(/\D/g, ""))
          .filter((value) => value.length >= 8 && value.length <= 14),
      ),
    );
    const scanUpc12 = barcodeVariants.find((value) => value.length === 12) ?? null;

    const truncateSnippet = (value: string, maxChars = 180): string => {
      const trimmed = value.trim();
      if (trimmed.length <= maxChars) return trimmed;
      return `${trimmed.slice(0, maxChars).trim()}…`;
    };

    const normalizeDomain = (value: string): string => value.toLowerCase().replace(/^www\./, "");

    const domainMatches = (domain: string, candidate: string): boolean =>
      domain === candidate || domain.endsWith(`.${candidate}`);

    const matchDomainList = (domain: string, list: string[]): boolean =>
      list.some((entry) => domainMatches(domain, entry));

    const isAmazonDomain = (value: string | null | undefined): boolean => {
      if (!value) return false;
      const domain = normalizeDomain(value);
      return matchDomainList(domain, AMAZON_DOMAINS);
    };

    const isAuthoritativeCaDomain = (value: string | null | undefined): boolean => {
      if (!value) return false;
      const domain = normalizeDomain(value);
      return matchDomainList(domain, AUTHORITATIVE_CA_DOMAINS);
    };

    const buildSerpCacheKey = (profileId: string): string =>
      createHash("sha256")
        .update(`${barcodeGtin14}|${profileId}|${gl}|${hl}|${RESOLUTION_ENGINE_VERSION}`)
        .digest("hex");

    const computeNegativeUntil = (reasonCode: string): string => {
      const ttlMs =
        reasonCode === "TIMEOUT" ||
          reasonCode === "BUDGET_EXHAUSTED" ||
          reasonCode === "BREAKER_OPEN" ||
          reasonCode === "MARKETPLACE_ONLY_TIMEOUT"
          ? NEGATIVE_TTL_TIMEOUT_MS
          : reasonCode === "NO_SERP"
            ? NEGATIVE_TTL_NO_SERP_MS
            : reasonCode === "ONLY_IMAGES"
              ? NEGATIVE_TTL_ONLY_IMAGES_MS
              : reasonCode === "NEEDS_JS"
                ? NEGATIVE_TTL_NEEDS_JS_MS
                : reasonCode === "NO_TEXT_FACTS"
                  ? NEGATIVE_TTL_NO_TEXT_FACTS_MS
                  : reasonCode === "MARKETPLACE_ONLY_NO_ALT_SOURCE"
                    ? NEGATIVE_TTL_MARKETPLACE_ONLY_MS
                    : NEGATIVE_TTL_NO_VALID_URL_MS;
      return new Date(Date.now() + ttlMs).toISOString();
    };

    const writeNegative = async (reasonCode: string): Promise<void> => {
      const until = computeNegativeUntil(reasonCode);
      await upsertNegativeCache(
        { barcodeGtin14, reasonCode, until, barcodeRaw: rawBarcode },
        { ...supabaseReadResilience, timeoutMs: 700 },
      );
    };

    const clearNegative = (context = "resolution_success"): void => {
      clearNegativeCacheAllVariants(barcodeGtin14, rawBarcode, { context });
    };
    const maybeRunIherbOverlayStage0 = async (context: string): Promise<boolean> => {
      if (stage0Delivered || stage0BundlePromise || requestSignal.aborted) return false;
      const overlayClaims = await getOverlayClaimsForBarcode();
      const overlayDigest = buildIherbOverlayFactsDigest(overlayClaims);
      if (!overlayClaims || !overlayDigest) return false;

      const factsDigestHash = computeFactsDigestHash(overlayDigest);
      const factsSourceVersion = `iherb_overlay:${overlayClaims.productId ?? barcodeGtin14}`;
      const started = startStage0Bundle({
        digest: overlayDigest,
        identityType: "gtin14",
        identityValue: barcodeGtin14,
        factsSourceVersion,
        stage0Winner: "web_hint_unverified",
        allowAi: false,
        apiKey: null,
      });
      if (!started) return false;

      stage0Delivered = true;
      stage0Source = "overlay";
      clearNegative("iherb_overlay_stage0_bridge");
      console.info("[ResolutionV2] using iHerb overlay Stage0 bridge", {
        requestId: requestId || null,
        barcode: barcodeGtin14,
        productId: overlayClaims.productId ?? null,
        factsDigestHash,
        context,
      });
      return true;
    };

    const trainingWriteResilience = {
      breaker: supabaseReadBreaker,
      semaphore: supabaseReadSemaphore,
      queueTimeoutMs: RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS,
      retry: {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 300,
        jitterRatio: 0.3,
      },
      timeoutMs: 2500,
    };

    const shouldSuppressStage1Error = (): boolean => forceStage1 && stage0Delivered;

    const featureFlags = {
      v2_enabled: v2Enabled,
      marketplace_llm_enabled: marketplaceLlmEnabled,
      llm_interactive_timeout_ms: llmInteractiveTimeoutMs,
      force_stage1: forceStage1,
      allow_needs_js: allowNeedsJs,
      shadow_compare_enabled: shadowCompareEnabled,
    };
    const baseSignals = {
      request_path: requestPath,
      client_version: clientVersion,
      feature_flags: featureFlags,
    };

    const overlayBridgeRecovered = await maybeRunIherbOverlayStage0("pre_stage1");
    if (overlayBridgeRecovered && stage0BundlePromise) {
      await awaitStage0Bundle();
      if (!streamState.doneSent && !streamState.ended && !res.writableEnded) {
        finalizeStream("iherb_overlay_stage0_complete");
      }
      releaseInFlightOnce();
      return;
    }

    const insertTrainingRow = (params: {
      outcome: string;
      profilesUsed?: string[] | null;
      serpTopk?: unknown | null;
      selectedUrl?: string | null;
      selectedDomain?: string | null;
      signals?: Record<string, unknown> | null;
      factsSummary?: Record<string, unknown> | null;
      factsCoverage?: number | null;
    }): void => {
      if (streamAnalysisBundleOnly) {
        return;
      }
      const mergedSignals = {
        ...baseSignals,
        background_backfill_started: backgroundBackfillQueued,
        secondary_backfill_started: secondaryBackfillQueued,
        ownership_verdict: ownershipVerdict,
        marketplace_rejected_count: marketplaceRejectedCount,
        provider_used: providerUsed,
        provider_gtin_match: providerGtinMatch,
        ...(params.signals ?? {}),
      };
      void insertBarcodeResolutionTrainingRow(
        {
          barcode_gtin14: barcodeGtin14,
          engine_version: RESOLUTION_ENGINE_VERSION,
          stage0_outcome: stage0Outcome,
          query_profiles_used: params.profilesUsed ?? null,
          serp_topk: params.serpTopk ?? null,
          selected_url: params.selectedUrl ?? null,
          selected_domain: params.selectedDomain ?? null,
          signals: mergedSignals,
          facts_summary: params.factsSummary ?? null,
          facts_coverage: params.factsCoverage ?? null,
          timing: {
            ...timing,
            stage0_ms: Math.round(stage1Start - startedAt),
            stage1_ms: Math.round(performance.now() - stage1Start),
          },
          calls,
          cache_hits: cacheHits,
          outcome: params.outcome,
        },
        trainingWriteResilience,
      );
      if (!shadowCompareQueued) {
        shadowCompareQueued = queueShadowCompare({
          barcodeGtin14,
          normalized,
          apiKey: googleApiKey ?? "",
          cx: cx ?? "",
          gl,
          hl,
          outcome: params.outcome,
          stage0Outcome,
          requestPath,
          clientVersion,
          featureFlags,
          parentProfilesUsed: params.profilesUsed ?? null,
          parentSelectedUrl: params.selectedUrl ?? null,
          parentSelectedDomain: params.selectedDomain ?? null,
        });
      }
    };

    const queueMarketplaceSecondaryBackfill = (params: {
      seedItems: SearchItem[];
      marketplaceOnly: boolean;
      extraction: BrandExtractionResult | null;
      parentOutcome: string;
      deepseekBundleSkippedReason?: string | null;
      needsAuthoritativeBackfill?: boolean;
      needsAuthoritativeReasons?: string[] | null;
      identityStrong?: boolean | null;
      identityConflict?: boolean | null;
      explicitGtinMatches?: string[] | null;
      explicitUpcMatches?: string[] | null;
      npnFound?: boolean | null;
      amazonCanonicalExceptionUsed?: boolean | null;
      noAuthoritativeDomain?: boolean | null;
      canonicalSourceDomain?: string | null;
      canonicalSourceUrl?: string | null;
    }): boolean => {
      if (!SECONDARY_SEARCH_ENABLE) return false;
      if (!params.marketplaceOnly && !params.needsAuthoritativeBackfill) return false;
      if (!googleApiKey || !cx || !deepseekKey) return false;
      if (!params.seedItems.length) return false;
      if (barcodeSecondaryBackfill.has(barcodeGtin14)) return true;

      const seedCandidates = params.seedItems
        .slice(0, 3)
        .map((item) =>
          buildMarketplaceSeedV2({
            rawTitle: item.title ?? "",
            brandHint: params.extraction?.brand ?? null,
          }),
        )
        .sort((a, b) => b.seedQualityScore - a.seedQualityScore);
      const seed = seedCandidates[0];
      if (!seed || (!seed.brandTokens.length && !seed.dosage && !seed.count)) return false;

      const queryPlan = buildSecondarySeedQueryPlan(seed, {
        region: gl?.toUpperCase() === "CA" ? "CA" : "US",
        domainLadderSites: SECONDARY_DOMAIN_LADDER_SITES,
        bannedDomains: [...SECONDARY_MARKETPLACE_EXCLUDE_DOMAINS],
        maxQueryChars: SECONDARY_QUERY_MAX_CHARS,
        maxVariantsPerGroup: SECONDARY_QUERY_MAX_VARIANTS_PER_GROUP,
        includeActivesAsShould: SECONDARY_QUERY_INCLUDE_ACTIVES_AS_SHOULD,
        excludeInQuery: SECONDARY_QUERY_EXCLUDE_DOMAINS,
      });
      const primaryQuery = queryPlan.primary.query;
      const secondaryQuery = queryPlan.secondary?.query ?? null;
      if (!primaryQuery) return false;
      const queries = secondaryQuery && secondaryQuery !== primaryQuery ? [primaryQuery, secondaryQuery] : [primaryQuery];

      const task = (async () => {
        if (shouldSkipWebParseWork()) {
          return;
        }
        const backfillStart = performance.now();
        const secondaryBudget = new DeadlineBudget(Date.now() + SECONDARY_SEARCH_TOTAL_BUDGET_MS);
        const searchResilience: SearchResilienceOptions = {
          budget: secondaryBudget,
          breaker: googleBreaker,
          semaphore: googleSemaphore,
          timeoutMs: SECONDARY_SEARCH_GOOGLE_TIMEOUT_MS,
          queueTimeoutMs: RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
          retry: { maxAttempts: 1 },
          gl,
          hl,
        };
        const supabaseWriteResilience = {
          breaker: supabaseReadBreaker,
          semaphore: supabaseReadSemaphore,
          timeoutMs: 900,
        };

        type SecondaryEvidence = {
          url: string;
          domain: string;
          contentType: string;
          barcodeHitCount: number;
          hasProductJsonLd: boolean;
          jsonLdGtinMatch: boolean;
          gtinCandidates: string[];
          gtinMismatch: boolean;
          npnCandidate: string | null;
          mpnCandidate: string | null;
          needsJs: boolean;
          onlyImages: boolean;
          strongMatch: boolean;
          regStrongMatch: boolean;
          seedVerified: boolean;
          pageMatchScore: number | null;
          pageMatchQualified: boolean;
          seedMatchScore: number | null;
          seedMatchQualified: boolean;
          seedBrandHit: boolean;
          seedNumericHits: number;
          seedOverlapRatio: number | null;
          jsonLd: {
            name?: string | null;
            brand?: string | null;
            images?: string[];
            sku?: string | null;
            gtin?: string | null;
            hasProduct?: boolean;
            gtinMatch?: boolean;
          };
          meta: { ogTitle: string | null; ogBrand: string | null };
        };

        type SecondaryFacts = {
          barcode: string;
          canonical: {
            name?: string | null;
            brand?: string | null;
            url?: string | null;
            domain?: string | null;
            images?: string[] | null;
          };
          identifiers: {
            gtin?: string | null;
            sku?: string | null;
            npn?: string | null;
            mpn?: string | null;
          };
          textFacts: {
            ingredientsText?: string | null;
            directionsText?: string | null;
            warningsText?: string | null;
            servingSizeText?: string | null;
          };
          provenance: {
            fieldSources: Record<
              string,
              Array<{ url: string; method: "jsonld" | "meta" | "dom" | "snippet"; confidence: number }>
            >;
          };
          coverageScore: number;
          missingFields: string[];
        };

        const countOccurrences = (haystack: string, needle: string): number => {
          if (!needle) return 0;
          let count = 0;
          let idx = 0;
          while (true) {
            const next = haystack.indexOf(needle, idx);
            if (next < 0) return count;
            count += 1;
            idx = next + needle.length;
          }
        };

        const isPrivateHostname = (hostname: string): boolean => {
          const host = hostname.toLowerCase();
          if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
            return true;
          }
          const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
          if (ipv4Match) {
            const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
            if (a === 10) return true;
            if (a === 127) return true;
            if (a === 169 && b === 254) return true;
            if (a === 192 && b === 168) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
          }
          if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
            return true;
          }
          return false;
        };

        const canFetchPublicUrlSecondary = (rawUrl: string): boolean => {
          try {
            const url = new URL(rawUrl);
            if (!["http:", "https:"].includes(url.protocol)) return false;
            if (isPrivateHostname(url.hostname)) return false;
            return true;
          } catch {
            return false;
          }
        };

        const metaContentRegexCacheSecondary = new Map<string, RegExp>();
        const getMetaContentRegexSecondary = (key: string): RegExp => {
          const cached = metaContentRegexCacheSecondary.get(key);
          if (cached) return cached;
          const compiled = new RegExp(
            `<meta[^>]+(?:property|name)=[\"']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
            "i",
          );
          metaContentRegexCacheSecondary.set(key, compiled);
          return compiled;
        };

        const extractMetaContentSecondary = (html: string, key: string): string | null => {
          return profileWebParseStep("secondary.extractMetaContent", html, () => {
            const match = clampRegexScanWindow(html).match(getMetaContentRegexSecondary(key));
            const value = match?.[1]?.trim();
            return value ? value : null;
          }, { fallback: () => null });
        };

        const extractJsonLdSecondary = (html: string): SecondaryEvidence["jsonLd"] =>
          profileWebParseStep("secondary.extractJsonLd", html, () => {
            const payloads = extractJsonLdScriptPayloads(clampRegexScanWindow(html));
            let name: string | null = null;
            let brand: string | null = null;
            const images: string[] = [];
            let sku: string | null = null;
            let gtin: string | null = null;
            let hasProduct = false;
            let gtinMatch = false;

            for (const payload of payloads) {
              if (!payload) continue;
              if (/\bproduct\b/i.test(payload.slice(0, 4096))) {
                hasProduct = true;
              }
              const payloadDigits = extractDigitsPrefix(payload);
              if (barcodeVariants.some((code) => payloadDigits.includes(code))) {
                gtinMatch = true;
              }

              try {
                const parsed = JSON.parse(payload) as unknown;
                const stack: unknown[] = [parsed];
                let visitedNodes = 0;
                while (stack.length) {
                  visitedNodes += 1;
                  if (visitedNodes > STAGE0_WEB_JSONLD_MAX_NODES) break;
                  const node = stack.pop();
                  if (!node || typeof node !== "object") continue;
                  if (Array.isArray(node)) {
                    node.forEach((child) => stack.push(child));
                    continue;
                  }
                  const record = node as Record<string, unknown>;
                  const typeValue = record["@type"];
                  if (typeof typeValue === "string" && typeValue.toLowerCase().includes("product")) {
                    hasProduct = true;
                  }
                  if (!name && typeof record.name === "string") name = record.name;
                  const brandValue = record.brand;
                  if (!brand) {
                    if (typeof brandValue === "string") brand = brandValue;
                    if (brandValue && typeof brandValue === "object") {
                      const brandObj = brandValue as Record<string, unknown>;
                      if (typeof brandObj.name === "string") brand = brandObj.name;
                    }
                  }
                  const imageValue = record.image;
                  if (typeof imageValue === "string") images.push(imageValue);
                  if (Array.isArray(imageValue)) {
                    for (const img of imageValue) {
                      if (typeof img === "string") images.push(img);
                    }
                  }
                  if (!sku && typeof record.sku === "string") sku = record.sku;
                  const gtinKeys = ["gtin14", "gtin13", "gtin12", "gtin", "gtin8"];
                  for (const key of gtinKeys) {
                    const value = record[key];
                    if (typeof value === "string" && value.replace(/\D/g, "")) {
                      const digitsOnly = value.replace(/\D/g, "");
                      if (!gtin) gtin = digitsOnly;
                      if (barcodeVariants.includes(digitsOnly)) {
                        gtinMatch = true;
                      }
                    }
                  }
                  Object.values(record).forEach((child) => stack.push(child));
                }
              } catch {
                // ignore parse failures for truncated JSON-LD
              }
            }

            return {
              name,
              brand,
              images: images.filter(Boolean).slice(0, 5),
              sku,
              gtin,
              hasProduct,
              gtinMatch,
            };
          }, {
            fallback: () => ({
              name: null,
              brand: null,
              images: [],
              sku: null,
              gtin: null,
              hasProduct: false,
              gtinMatch: false,
            }),
          });

        const extractNpnFromTextSecondary = (text: string): string | null =>
          profileWebParseStep("secondary.extractNpnFromText", text, () => {
            const scanText =
              text.length > Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS)
                ? text.slice(0, Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS))
                : text;
            const match = scanText.match(/\bNPN\s*[:#]?\s*(\d{8})\b/i);
            return match?.[1] ?? null;
          }, { fallback: () => null });

        const extractMpnFromTextSecondary = (text: string): string | null =>
          profileWebParseStep("secondary.extractMpnFromText", text, () => {
            const scanText = clampRegexScanWindow(text);
            const match = scanText.match(/\bMPN\s*[:#]?\s*([A-Z0-9\-]{3,})\b/i);
            return match?.[1] ?? null;
          }, { fallback: () => null });

        const normalizeGtinCandidateSecondary = (value: string): string | null => {
          const digits = value.replace(/\D/g, "");
          if (!digits) return null;
          if (digits.length < 8 || digits.length > 14) return null;
          return digits;
        };

        const extractGtinCandidatesFromTextSecondary = (text: string): string[] =>
          profileWebParseStep("secondary.extractGtinCandidatesFromText", text, () => {
            if (!text) return [];
            const scanText =
              text.length > Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS)
                ? text.slice(0, Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS))
                : text;
            if (!/\b(?:UPC|GTIN|EAN|JAN)\b/i.test(scanText)) return [];
            const matches = new Set<string>();
            const regex = /\b(?:UPC|GTIN|EAN|JAN|UPC-A|UPCA)\s*[:#]?\s*([0-9][0-9\-\s]{6,24})\b/gi;
            let match: RegExpExecArray | null = null;
            let iterations = 0;
            while ((match = regex.exec(scanText)) !== null) {
              iterations += 1;
              if (iterations > 512) break;
              const candidate = normalizeGtinCandidateSecondary(match[1] ?? "");
              if (candidate) matches.add(candidate);
              if (match.index === regex.lastIndex) regex.lastIndex += 1;
            }
            return Array.from(matches);
          }, { fallback: () => [] });

        const extractTitleTagSecondary = (html: string): string | null =>
          profileWebParseStep("secondary.extractTitleTag", html, () => {
            const match = clampRegexScanWindow(html).match(/<title[^>]*>([^<]{2,200})<\/title>/i);
            const value = match?.[1]?.replace(/\s+/g, " ").trim();
            return value ? value : null;
          }, { fallback: () => null });

        const fetchTextPrefixSecondary = async (
          rawUrl: string,
          maxBytes: number,
          timeoutMs: number,
        ): Promise<{ ok: boolean; contentType: string; finalUrl: string; text: string } | null> => {
          if (!canFetchPublicUrlSecondary(rawUrl)) return null;
          if (contextFetchBreaker && !contextFetchBreaker.canRequest()) return null;

          const budgetedTimeout = secondaryBudget.msFor(timeoutMs);
          if (budgetedTimeout <= 0) return null;

          let release: (() => void) | null = null;
          try {
            release = await contextFetchSemaphore.acquire({
              timeoutMs: RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
            });
          } catch {
            return null;
          }

          const timeoutSignal = createTimeoutSignal(budgetedTimeout);
          const { signal, cleanup } = combineSignals([timeoutSignal]);
          const parseStartedAt = performance.now();
          try {
            const effectiveMaxBytes = Math.min(maxBytes, STAGE0_WEB_MAX_BYTES);
            const readResponseText = async (response: globalThis.Response): Promise<string> => {
              const reader = response.body?.getReader();
              if (!reader) {
                const rawText = await response.text();
                const clipped = rawText.slice(0, effectiveMaxBytes);
                webBytesReadTotal += Buffer.byteLength(clipped, "utf8");
                return clipped;
              }
              const chunks: Uint8Array[] = [];
              let received = 0;
              while (received < effectiveMaxBytes) {
                if (shouldSkipWebParseWork()) {
                  try {
                    await reader.cancel();
                  } catch { }
                  break;
                }
                const { value, done } = await reader.read();
                if (done) break;
                if (!value) continue;
                const remaining = effectiveMaxBytes - received;
                chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
                received += Math.min(value.length, remaining);
                if (received >= effectiveMaxBytes) {
                  try {
                    await reader.cancel();
                  } catch { }
                  break;
                }
              }
              const buffer = Buffer.concat(chunks);
              webBytesReadTotal += received;
              return buffer.toString("utf8");
            };

            const attemptFetch = async (useRange: boolean) => {
              const headers: Record<string, string> = {
                "User-Agent": BROWSER_UA,
                Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
              };
              if (useRange) {
                headers.Range = `bytes=0-${Math.max(0, effectiveMaxBytes - 1)}`;
              }
              const response = await fetch(rawUrl, {
                method: "GET",
                headers,
                cache: "no-store",
                signal,
              });
              if (!response.ok) {
                return { ok: false as const, status: response.status };
              }
              const contentType = response.headers.get("content-type") || "";
              const text = await readResponseText(response);
              return { ok: true as const, contentType, finalUrl: response.url, text };
            };

            const primary = await attemptFetch(true);
            if (primary.ok) {
              contextFetchBreaker?.recordSuccess();
              return primary;
            }
            const fallback = await attemptFetch(false);
            if (fallback.ok) {
              contextFetchBreaker?.recordSuccess();
              return fallback;
            }
            contextFetchBreaker?.recordFailure();
            return null;
          } catch (error) {
            if (!isAbortError(error)) {
              contextFetchBreaker?.recordFailure();
            }
            return null;
          } finally {
            const elapsed = performance.now() - parseStartedAt;
            if (Number.isFinite(elapsed)) {
              webParseMsTotal += elapsed;
            }
            if (
              webParseMsTotal > STAGE0_WEB_PARSE_BUDGET_MS &&
              !streamState.rev1Sent &&
              !streamState.doneSent &&
              !streamState.ended
            ) {
              emitDegradedLimitedRev1AndFinalize("DEGRADED_WEB_BUDGET");
            }
            maybeDegradeForEventLoopLag();
            cleanup();
            release?.();
          }
        };

        const cheapPassSecondary = async (
          rawUrl: string,
          seedMatch?: SecondarySeedMatch | null,
        ): Promise<SecondaryEvidence | null> => {
          if (shouldSkipWebParseWork()) return null;
          const prefix = await fetchTextPrefixSecondary(
            rawUrl,
            SECONDARY_CHEAP_PASS_MAX_BYTES,
            SECONDARY_CHEAP_PASS_TIMEOUT_MS,
          );
          if (!prefix || !prefix.ok) return null;
          if (shouldSkipWebParseWork()) return null;
          const contentType = prefix.contentType || "";
          const lowerType = contentType.toLowerCase();
          const onlyImages =
            lowerType.includes("image/") ||
            lowerType.includes("application/pdf") ||
            lowerType.includes("application/octet-stream");
          const text = prefix.text ?? "";
          const parseText = clampRegexScanWindow(text);
          const digits = extractDigitsPrefix(parseText);
          const barcodeHitCount = barcodeVariants.reduce((sum, code) => sum + countOccurrences(digits, code), 0);
          const jsonLd = extractJsonLdSecondary(parseText);
          const metaOgTitle = extractMetaContentSecondary(parseText, "og:title");
          const titleTag = extractTitleTagSecondary(parseText);
          const metaBrand =
            extractMetaContentSecondary(parseText, "product:brand") ?? extractMetaContentSecondary(parseText, "og:site_name");
          const hasTitleEvidence = Boolean(metaOgTitle || titleTag || jsonLd.name || metaBrand);

          const npnCandidate = extractNpnFromTextSecondary(parseText);
          const mpnCandidate = extractMpnFromTextSecondary(parseText);
          const gtinCandidatesSet = new Set<string>();
          for (const candidate of extractGtinCandidatesFromTextSecondary(parseText)) {
            gtinCandidatesSet.add(candidate);
          }
          const jsonLdGtinCandidate = normalizeGtinCandidateSecondary(jsonLd.gtin ?? "");
          if (jsonLdGtinCandidate) {
            gtinCandidatesSet.add(jsonLdGtinCandidate);
          }
          const gtinCandidates = Array.from(gtinCandidatesSet);
          const gtinMismatch =
            gtinCandidates.length > 0 && !gtinCandidates.some((candidate) => barcodeVariants.includes(candidate));
          const needsJs =
            /please enable javascript|enable javascript|requires javascript|turn on javascript/i.test(parseText) ||
            (parseText.includes("<script") &&
              !parseText.includes("ingredients") &&
              barcodeHitCount === 0 &&
              !hasTitleEvidence);

          const hasProductJsonLd = Boolean(jsonLd.hasProduct);
          const jsonLdGtinMatch = Boolean(jsonLd.gtinMatch);
          const seedQualified = Boolean(seedMatch?.qualified);
          const mpnMatch = seedMpn && mpnCandidate ? seedMpn === mpnCandidate.toUpperCase() : false;
          const regStrongMatch = Boolean(npnCandidate) || Boolean(mpnMatch);
          const strongMatch =
            !onlyImages &&
            !needsJs &&
            (jsonLdGtinMatch || barcodeHitCount >= RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN || regStrongMatch);

          const pageTextRaw = `${metaOgTitle ?? ""} ${titleTag ?? ""} ${jsonLd.name ?? ""} ${parseText}`;
          const pageText =
            pageTextRaw.length > 4096
              ? pageTextRaw.slice(0, 4096).toLowerCase()
              : pageTextRaw.toLowerCase();
          const brandVariants = buildBrandVariants(seed.brandTokens);
          const dosageVariants = buildDosageVariants(seed.dosage);
          const countVariants = buildCountVariants(seed.count);

          const brandHit = brandVariants.length
            ? brandVariants.some((variant) => matchesVariantInText(pageText, variant))
            : false;
          const dosageHit = dosageVariants.length
            ? dosageVariants.some((variant) => matchesVariantInText(pageText, variant))
            : false;
          const countHit = countVariants.length
            ? countVariants.some((variant) => matchesVariantInText(pageText, variant))
            : false;

          let pageMatchScore = 0;
          if (brandHit) pageMatchScore += 0.5;
          if (dosageHit) pageMatchScore += 0.35;
          if (countHit) pageMatchScore += seed.dosage ? 0.15 : 0.3;
          pageMatchScore = Math.round(pageMatchScore * 100) / 100;

          const requireDosageHit = Boolean(seed.dosage);
          const requireCountHit = !seed.dosage && Boolean(seed.count);
          const pageMatchQualified = pageMatchScore >= SECONDARY_SEED_VERIFIED_MIN;
          const seedVerified =
            brandHit && (!requireDosageHit || dosageHit) && (!requireCountHit || countHit) && pageMatchQualified;

          return {
            url: prefix.finalUrl || rawUrl,
            domain: extractDomain(prefix.finalUrl || rawUrl),
            contentType,
            barcodeHitCount,
            hasProductJsonLd,
            jsonLdGtinMatch,
            gtinCandidates,
            gtinMismatch,
            npnCandidate,
            mpnCandidate,
            needsJs,
            onlyImages,
            strongMatch,
            regStrongMatch,
            seedVerified,
            pageMatchScore,
            pageMatchQualified,
            seedMatchScore: seedMatch?.score ?? null,
            seedMatchQualified: seedQualified,
            seedBrandHit: seedMatch?.brandHit ?? false,
            seedNumericHits: seedMatch?.numericHits ?? 0,
            seedOverlapRatio: seedMatch?.overlapRatio ?? null,
            jsonLd,
            meta: { ogTitle: metaOgTitle, ogBrand: metaBrand },
          };
        };

        const extractSectionSecondary = (
          text: string | null | undefined,
          patterns: RegExp[],
          maxChars = 600,
        ): string | null =>
          profileWebParseStep("secondary.extractSection", text, () => {
            if (!text) return null;
            const scanText = clampRegexScanWindow(text);
            for (const pattern of patterns) {
              const match = scanText.match(pattern);
              const value = match?.[1]?.trim();
              if (value) {
                const normalized = value.replace(/\s+/g, " ").trim();
                return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}…` : normalized;
              }
            }
            return null;
          }, { fallback: () => null });

        const sanitizeProductNameCandidate = (value?: string | null): string | null => {
          if (!value) return null;
          let cleaned = value.trim();
          if (!cleaned) return null;
          cleaned = cleaned.replace(/｜/g, "|");
          if (cleaned.includes("|")) {
            const [left] = cleaned.split("|");
            cleaned = left?.trim() ?? "";
          }
          const dashSplit = cleaned.split(/\s[\-\u2013\u2014]\s/);
          if (dashSplit.length > 1) {
            const right = dashSplit.slice(1).join(" ").toLowerCase();
            if (
              /(gold standard|official|vitamin|supplement|store|shop|canada|usa|site|online|health)/i.test(right)
            ) {
              cleaned = dashSplit[0]?.trim() ?? cleaned;
            }
          }
          cleaned = cleaned.replace(/\s+/g, " ").trim();
          return cleaned || null;
        };

        const buildSecondaryFacts = (candidate: {
          item: SearchItem;
          evidence: SecondaryEvidence;
          extractedText: string | null;
        }): SecondaryFacts => {
          const url = candidate.evidence.url || candidate.item.link;
          const domain = candidate.evidence.domain || extractDomain(url);
          const jsonld = candidate.evidence.jsonLd;
          const metaTitle = candidate.evidence.meta.ogTitle;
          const metaBrand = candidate.evidence.meta.ogBrand;
          const extractedText = candidate.extractedText ?? null;

          const npnFromExtracted = extractNpnFromTextSecondary(extractedText ?? "");
          const npnValue = candidate.evidence.npnCandidate ?? npnFromExtracted;

          const ingredientsText = extractSectionSecondary(extractedText, [
            /\b(?:ingredients|other ingredients|medicinal ingredients|non-?medicinal ingredients|supplement facts)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
          ]);
          const directionsText = extractSectionSecondary(extractedText, [
            /\b(?:directions|suggested use|dosage)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
          ]);
          const warningsText = extractSectionSecondary(extractedText, [
            /\b(?:warning|warnings|caution|contraindications)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
          ]);
          const servingSizeText = extractSectionSecondary(
            extractedText,
            [/\b(?:serving size|amount per serving)\b\s*[:\-]?\s*([\s\S]{10,200}?)/i],
            200,
          );

          const fieldSources: SecondaryFacts["provenance"]["fieldSources"] = {};
          const addSource = (
            field: string,
            method: "jsonld" | "meta" | "dom" | "snippet",
            confidence: number,
          ) => {
            if (!fieldSources[field]) fieldSources[field] = [];
            fieldSources[field].push({ url, method, confidence });
          };

          const name = sanitizeProductNameCandidate(jsonld.name ?? metaTitle ?? null);
          if (jsonld.name) addSource("canonical.name", "jsonld", 0.9);
          else if (metaTitle) addSource("canonical.name", "meta", 0.6);

          const brand = sanitizeBrandCandidate(jsonld.brand ?? metaBrand ?? null);
          if (jsonld.brand) addSource("canonical.brand", "jsonld", 0.85);
          else if (metaBrand) addSource("canonical.brand", "meta", 0.6);

          if (ingredientsText) addSource("textFacts.ingredientsText", "dom", 0.75);
          if (directionsText) addSource("textFacts.directionsText", "dom", 0.7);
          if (warningsText) addSource("textFacts.warningsText", "dom", 0.7);
          if (servingSizeText) addSource("textFacts.servingSizeText", "dom", 0.65);

          const facts: SecondaryFacts = {
            barcode: barcodeGtin14,
            canonical: {
              name,
              brand,
              url,
              domain,
              images: jsonld.images?.length ? jsonld.images : null,
            },
            identifiers: {
              gtin: jsonld.gtin ?? null,
              sku: jsonld.sku ?? null,
              npn: npnValue ?? null,
              mpn: candidate.evidence.mpnCandidate ?? null,
            },
            textFacts: {
              ingredientsText,
              directionsText,
              warningsText,
              servingSizeText,
            },
            provenance: { fieldSources },
            coverageScore: 0,
            missingFields: [],
          };

          const weights = {
            nameBrandUrl: 0.35,
            ingredients: 0.25,
            directions: 0.15,
            warnings: 0.15,
            serving: 0.1,
          };
          let score = 0;
          if (facts.canonical.name || facts.canonical.brand || facts.canonical.url) score += weights.nameBrandUrl;
          if (facts.textFacts.ingredientsText) score += weights.ingredients;
          if (facts.textFacts.directionsText) score += weights.directions;
          if (facts.textFacts.warningsText) score += weights.warnings;
          if (facts.textFacts.servingSizeText) score += weights.serving;

          facts.coverageScore = Math.round(score * 100) / 100;

          const missing: string[] = [];
          if (!facts.canonical.name) missing.push("canonical.name");
          if (!facts.canonical.brand) missing.push("canonical.brand");
          if (!facts.textFacts.ingredientsText) missing.push("textFacts.ingredientsText");
          if (!facts.textFacts.directionsText) missing.push("textFacts.directionsText");
          if (!facts.textFacts.warningsText) missing.push("textFacts.warningsText");
          if (!facts.textFacts.servingSizeText) missing.push("textFacts.servingSizeText");
          facts.missingFields = missing;

          return facts;
        };

        let searchMs = 0;
        let cheapPassMs = 0;
        let deepFetchMs = 0;
        let llmMs = 0;
        let failureReason: string | null = null;
        let selectedUrl: string | null = null;
        let selectedDomain: string | null = null;
        let factsCoverage: number | null = null;
        let factsSummary: Record<string, unknown> | null = null;
        let strongMatch = false;
        let repairUsed = false;
        let llmAttempted = false;
        let queriesTried: string[] = [];
        let serpTotalPrimary = 0;
        let serpTotalSecondary = 0;
        let filteredCount = 0;
        let filteredResults: SearchItem[] = [];
        let nonMarketplaceBeforeSeedMatch = 0;
        let seededCount = 0;
        let seedMatchTop: number | null = null;
        let seedMatchAvg: number | null = null;
        let afterSeedMatchCount = 0;
        let afterExtractabilityCount = 0;
        let afterSeedVerifiedCount = 0;
        let gtinMismatchCount = 0;
        let candidateTop3: Array<{ domain: string | null; seedScore: number; tier: string }> = [];
        let rejectTrace: Array<{
          domain: string | null;
          reason: string;
          pageMatchScore?: number | null;
          gtinCandidates?: string[];
        }> = [];
        let identityConflicts: Array<{ domain: string | null; reason: string; gtinCandidates: string[] }> = [];
        let outcome: "SECONDARY_BACKFILL_SUCCESS" | "SECONDARY_BACKFILL_LNHPD_SUCCESS" | "SECONDARY_BACKFILL_FAILED" =
          "SECONDARY_BACKFILL_FAILED";
        let npnCandidate: string | null = null;
        let npnSourceUrl: string | null = null;
        let npnLookupFailed = false;
        let lnhpdId: number | null = null;
        let lnhpdBrand: string | null = null;
        let lnhpdProduct: string | null = null;
        let npnFoundSecondary = false;

        const writeSecondaryNegative = async (reasonCode: string) => {
          const until = computeNegativeUntil(reasonCode);
          await upsertNegativeCache(
            { barcodeGtin14, reasonCode, until, barcodeRaw: rawBarcode },
            supabaseWriteResilience,
          );
        };

        const marketplaceSeedItems = params.seedItems.filter((item) => {
          const domain = extractDomain(item.link);
          if (!domain) return false;
          return isMarketplaceDomain(domain);
        });

        const seedMpn = (() => {
          const candidates = marketplaceSeedItems.slice(0, 2);
          for (const item of candidates) {
            const mpnFromTitle = extractMpnFromTextSecondary(`${item.title ?? ""} ${item.snippet ?? ""}`);
            if (mpnFromTitle) return mpnFromTitle.toUpperCase();
          }
          return null;
        })();

        const tryMarketplaceNpn = async (): Promise<{ npn: string; sourceUrl: string } | null> => {
          const candidates = marketplaceSeedItems.slice(0, 2);
          for (const item of candidates) {
            const npnFromTitle = extractNpnFromText(item.title);
            if (npnFromTitle) return { npn: npnFromTitle, sourceUrl: item.link };
            const npnFromSnippet = extractNpnFromText(item.snippet);
            if (npnFromSnippet) return { npn: npnFromSnippet, sourceUrl: item.link };
            const prefix = await fetchTextPrefixSecondary(
              item.link,
              SECONDARY_CHEAP_PASS_MAX_BYTES,
              SECONDARY_CHEAP_PASS_TIMEOUT_MS,
            );
            if (!prefix || !prefix.ok) continue;
            const text = `${prefix.text ?? ""}`;
            const npn = extractNpnFromText(text);
            if (npn) {
              return { npn, sourceUrl: prefix.finalUrl || item.link };
            }
          }
          return null;
        };

        const npnSeed = LNHPD_RUNTIME_ENABLED ? await tryMarketplaceNpn() : null;
        if (LNHPD_RUNTIME_ENABLED && npnSeed?.npn) {
          npnCandidate = npnSeed.npn;
          npnSourceUrl = npnSeed.sourceUrl;
          npnCandidateSource = "web";
          authorityCandidateSource = "web";
          npnCandidateStale = false;
          try {
            const lnhpdLookup = await fetchLnhpdFactsWithSecondChance(npnCandidate, undefined, {
              firstTimeoutMs: RESILIENCE_LNHPD_TIMEOUT_MS,
              secondTimeoutMs: RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS,
              forceMode: authorityFailMode,
            });
            authorityLnhpdAttempt1Status = lnhpdLookup.attempt1Status;
            authorityLnhpdAttempt2Status = lnhpdLookup.attempt2Status;
            lnhpdFetchStatus = lnhpdLookup.finalStatus;
            const lnhpdFacts = lnhpdLookup.facts;
            if (lnhpdFacts) {
              authorityFailureReason = null;
              lnhpdId = lnhpdFacts.lnhpdId;
              lnhpdBrand = lnhpdFacts.brandName ?? null;
              lnhpdProduct = lnhpdFacts.productName ?? null;
              const lnhpdLabelFacts = toLabelFactsFromLnhpd(lnhpdFacts);
              const labelExtraction: LabelExtractionMeta = {
                source: "lnhpd",
                fetchedAt: lnhpdFacts.extractedAt ?? nowIso(),
                datasetVersion: lnhpdFacts.datasetVersion ?? null,
              };
              const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);
              const lnhpdProductInfo = {
                brand: lnhpdBrand,
                name: lnhpdProduct,
                category: null,
                image: null,
              };
              const lnhpdAnalysisPayload: SnapshotAnalysisPayload = {
                ...labelAnalysis,
                brandExtraction: {
                  brand: lnhpdProductInfo.brand,
                  product: lnhpdProductInfo.name,
                  category: lnhpdProductInfo.category,
                  confidence: "high",
                  source: "rule",
                },
                productInfo: lnhpdProductInfo,
                sources: [],
              };
              let lnhpdSnapshot = buildBarcodeSnapshot({
                barcode,
                productInfo: lnhpdProductInfo,
                sources: [],
                efficacy: lnhpdAnalysisPayload.efficacy ?? null,
                safety: lnhpdAnalysisPayload.safety ?? null,
                usagePayload: lnhpdAnalysisPayload.usagePayload ?? null,
              });
              lnhpdSnapshot = applyLnhpdFactsToSnapshot(lnhpdSnapshot, lnhpdFacts);
              const analysisStatus = buildAnalysisStatus({
                hasLabelFacts: hasLabelFacts(lnhpdSnapshot),
                hasAi: hasAiPayload(lnhpdAnalysisPayload),
                dsldLabelId: null,
              });
              const analysisMeta = buildAnalysisMeta({
                status: analysisStatus,
                labelExtraction,
                overlayClaims: await getOverlayClaimsForBarcode(),
              });
              lnhpdAnalysisPayload.analysis = analysisMeta;
              lnhpdSnapshot.status = "resolved";
              lnhpdSnapshot.analysis = analysisMeta;
              lnhpdSnapshot.updatedAt = nowIso();

              const expiresAt = computeExpiresAt(analysisStatus);
              void storeSnapshotCache(
                {
                  key: cacheKey,
                  source: "barcode",
                  snapshot: lnhpdSnapshot,
                  analysisPayload: lnhpdAnalysisPayload,
                  expiresAt,
                },
                supabaseWriteResilience,
              );

              void upsertBarcodeRegulatoryMap({
                barcodeGtin14,
                npn: npnCandidate,
                confidence: 0.9,
                source: "lnhpd",
                expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_LNHPD).toISOString(),
                barcodeRaw: rawBarcode,
              });

              clearNegativeCacheAllVariants(barcodeGtin14, rawBarcode, {
                context: "secondary_backfill_lnhpd_success",
              });
              void clearNpnNegativeCache(npnCandidate, supabaseWriteResilience);
              factsSummary = {
                npn: npnCandidate,
                lnhpdId: lnhpdFacts.lnhpdId,
                brand: lnhpdBrand,
                product: lnhpdProduct,
              };
              factsCoverage = 1;
              outcome = "SECONDARY_BACKFILL_LNHPD_SUCCESS";
              failureReason = null;
            } else {
              if (lnhpdLookup.finalStatus === "timeout") {
                authorityFailureReason =
                  lnhpdLookup.attempt2Status === "timeout" ? "lnhpd_timeout_second" : "lnhpd_timeout_first";
              } else if (lnhpdLookup.finalStatus === "not_found") {
                authorityFailureReason = "lnhpd_not_found";
              } else {
                authorityFailureReason = "lnhpd_query_error";
              }
              npnLookupFailed = true;
              if (lnhpdFetchStatus === "not_found") {
                void upsertBarcodeRegulatoryMap({
                  barcodeGtin14,
                  npn: npnCandidate,
                  confidence: 0.2,
                  source: "lnhpd_not_found",
                  expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
                  barcodeRaw: rawBarcode,
                }, {
                  ...supabaseWriteResilience,
                  writeGuardMode: "enforce",
                });
              }
              if (lnhpdFetchStatus === "not_found") {
                void recordNpnNegativeAttempt(
                  {
                    npn: npnCandidate,
                    reasonCode: "lnhpd_not_found",
                    windowMs: NPN_NEGATIVE_CACHE_WINDOW_HOURS * 60 * 60 * 1000,
                    threshold: NPN_NEGATIVE_CACHE_THRESHOLD,
                    ttlMs: NPN_NEGATIVE_CACHE_TTL_MS,
                  },
                  { ...supabaseReadResilience, timeoutMs: 500 },
                );
              }
            }
          } catch (error) {
            lnhpdFetchStatus = "error";
            authorityFailureReason = "lnhpd_query_error";
            authorityLnhpdAttempt1Status =
              authorityLnhpdAttempt1Status === "not_attempted" ? "error" : authorityLnhpdAttempt1Status;
            npnLookupFailed = true;
            console.warn("[ResolutionV2] Secondary LNHPD seed lookup failed", error);
          }
        }

        if (outcome !== "SECONDARY_BACKFILL_LNHPD_SUCCESS") {
          try {
            const searchStart = performance.now();
            const search = await runSearchPlan(queries, googleApiKey, cx, {
              barcode,
              resilience: searchResilience,
            });
            searchMs = Math.round(performance.now() - searchStart);
            queriesTried = search.queriesTried;
            serpTotalPrimary = search.primary.length;
            serpTotalSecondary = search.secondary.length;

            const merged = search.merged;
            if (!merged.length) {
              failureReason =
                search.hardStop || secondaryBudget.isExpired()
                  ? "secondary_fetch_timeout"
                  : "secondary_no_candidate";
            }
            const filtered = merged.filter((item) => {
              const domain = extractDomain(item.link);
              if (!domain) return false;
              if (isSecondaryExcludedDomain(domain, queryPlan.bannedDomains)) return false;
              if (!SECONDARY_ALLOW_MARKETPLACE && isMarketplaceDomain(domain)) return false;
              return true;
            });
            filteredCount = filtered.length;
            nonMarketplaceBeforeSeedMatch = filtered.length;

            const seeded = filtered
              .map((item) => ({ item, match: computeSeedMatch(item, seed) }))
              .filter((entry) => entry.match.qualified)
              .sort((a, b) => b.match.score - a.match.score);

            seededCount = seeded.length;
            afterSeedMatchCount = seeded.length;
            seedMatchTop = seeded[0]?.match.score ?? null;
            seedMatchAvg =
              seeded.length > 0
                ? Math.round((seeded.reduce((sum, entry) => sum + entry.match.score, 0) / seeded.length) * 100) / 100
                : null;
            filteredResults = seeded.map((entry) => entry.item);
            candidateTop3 = seeded.slice(0, 3).map((entry) => ({
              domain: extractDomain(entry.item.link),
              seedScore: entry.match.score,
              tier: getExtractabilityTier(extractDomain(entry.item.link) ?? ""),
            }));

            if (!failureReason && !filtered.length) {
              failureReason = "secondary_all_filtered";
            } else if (!failureReason && !seeded.length) {
              failureReason = "secondary_seed_mismatch";
            } else if (!failureReason) {
              const cheapTargets = seeded.slice(0, SECONDARY_CHEAP_PASS_MAX_URLS);
              const cheapStart = performance.now();
              const cheapSettled = await Promise.allSettled(
                cheapTargets.map(async ({ item, match }) => {
                  const evidence = await cheapPassSecondary(item.link, match);
                  return { item, evidence, match };
                }),
              );
              cheapPassMs = Math.round(performance.now() - cheapStart);

              const evidences: Array<{ item: SearchItem; evidence: SecondaryEvidence }> = [];
              for (const result of cheapSettled) {
                if (result.status !== "fulfilled") {
                  rejectTrace.push({ domain: null, reason: "fetch_failed" });
                  continue;
                }
                if (!result.value.evidence) {
                  rejectTrace.push({
                    domain: extractDomain(result.value.item.link),
                    reason: "fetch_failed",
                  });
                  continue;
                }
                if (result.value.evidence.onlyImages) {
                  rejectTrace.push({
                    domain: result.value.evidence.domain ?? extractDomain(result.value.item.link),
                    reason: "only_images",
                    pageMatchScore: result.value.evidence.pageMatchScore,
                  });
                  continue;
                }
                if (result.value.evidence.needsJs && !allowNeedsJs) {
                  const evidenceDomain =
                    result.value.evidence.domain ?? extractDomain(result.value.item.link);
                  const tier = getExtractabilityTier(evidenceDomain ?? "");
                  const allowNeedsJsOverride =
                    (tier === "A" || tier === "B") &&
                    (result.value.evidence.pageMatchScore ?? 0) >= SECONDARY_NEEDS_JS_OVERRIDE_MIN;
                  if (!allowNeedsJsOverride) {
                    rejectTrace.push({
                      domain: evidenceDomain,
                      reason: "needs_js",
                      pageMatchScore: result.value.evidence.pageMatchScore,
                    });
                    continue;
                  }
                }
                if (result.value.evidence.gtinMismatch) {
                  gtinMismatchCount += 1;
                  identityConflicts.push({
                    domain: result.value.evidence.domain ?? extractDomain(result.value.item.link),
                    reason: "gtin_mismatch",
                    gtinCandidates: result.value.evidence.gtinCandidates,
                  });
                  rejectTrace.push({
                    domain: result.value.evidence.domain ?? extractDomain(result.value.item.link),
                    reason: "gtin_mismatch",
                    pageMatchScore: result.value.evidence.pageMatchScore,
                    gtinCandidates: result.value.evidence.gtinCandidates,
                  });
                  continue;
                }
                if (result.value.evidence.npnCandidate && !npnCandidate) {
                  npnCandidate = result.value.evidence.npnCandidate;
                  npnSourceUrl = result.value.evidence.url ?? result.value.item.link;
                  npnCandidateSource = "web";
                  npnCandidateStale = false;
                  void upsertBarcodeRegulatoryMap({
                    barcodeGtin14,
                    npn: npnCandidate,
                    confidence: 0.8,
                    source: "web_npn",
                    expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_WEB).toISOString(),
                    barcodeRaw: rawBarcode,
                  });
                }
                if (!result.value.evidence.seedVerified) {
                  rejectTrace.push({
                    domain: result.value.evidence.domain ?? extractDomain(result.value.item.link),
                    reason: "page_match_low",
                    pageMatchScore: result.value.evidence.pageMatchScore,
                  });
                }
                evidences.push({ item: result.value.item, evidence: result.value.evidence });
              }
              afterExtractabilityCount = evidences.length;
              afterSeedVerifiedCount = evidences.filter((entry) => entry.evidence.seedVerified).length;

              if (!evidences.length) {
                if (gtinMismatchCount > 0) {
                  failureReason = "secondary_gtin_mismatch";
                } else {
                  failureReason = secondaryBudget.isExpired() ? "secondary_fetch_timeout" : "secondary_fetch_blocked";
                }
              } else {
                const rankEvidence = (entry: { item: SearchItem; evidence: SecondaryEvidence }): number => {
                  const base = scoreSearchItem(entry.item, { barcode });
                  let score = base;
                  const tier = getExtractabilityTier(entry.evidence.domain);
                  if (entry.evidence.strongMatch) score += 1000;
                  if (entry.evidence.regStrongMatch) score += 600;
                  if (entry.evidence.jsonLdGtinMatch) score += 200;
                  if (entry.evidence.hasProductJsonLd) score += 80;
                  if (entry.evidence.seedMatchScore !== null) {
                    score += Math.round(entry.evidence.seedMatchScore * 200);
                  }
                  if (entry.evidence.pageMatchScore !== null) {
                    score += Math.round(entry.evidence.pageMatchScore * 150);
                  }
                  if (entry.evidence.seedBrandHit) score += 30;
                  if (entry.evidence.seedNumericHits > 0) score += Math.min(2, entry.evidence.seedNumericHits) * 15;
                  score += Math.min(10, entry.evidence.barcodeHitCount) * 20;
                  if (tier === "A") score += 40;
                  if (tier === "B") score += 15;
                  if (tier === "C") score -= 60;
                  return score;
                };

                const sorted = evidences.sort((a, b) => rankEvidence(b) - rankEvidence(a));
                const deepCandidates = sorted
                  .filter((entry) => {
                    const domain = entry.evidence.domain ?? "";
                    const tier = getExtractabilityTier(domain);
                    const domainOk =
                      (domain && SECONDARY_DOMAIN_LADDER_SITES.includes(domain)) || tier === "A" || tier === "B";
                    if (!domainOk) {
                      rejectTrace.push({
                        domain: entry.evidence.domain,
                        reason: "low_trust_domain",
                        pageMatchScore: entry.evidence.pageMatchScore,
                      });
                    }
                    return domainOk && (entry.evidence.seedVerified || entry.evidence.strongMatch || entry.evidence.regStrongMatch);
                  })
                  .slice(0, Math.min(STAGE0_WEB_MAX_SOURCES, SECONDARY_DEEP_FETCH_MAX_PAGES));

                if (!deepCandidates.length) {
                  failureReason = "secondary_no_verified_candidate";
                } else {
                  selectedUrl = deepCandidates[0]?.evidence.url ?? deepCandidates[0]?.item.link ?? null;
                  selectedDomain = selectedUrl ? extractDomain(selectedUrl) : null;
                  strongMatch = Boolean(deepCandidates[0]?.evidence.strongMatch);

                  const selectedItems = deepCandidates.map((candidate) => candidate.item);
                  const deepStart = performance.now();
                  const contextSources = await prepareContextSources(selectedItems, {
                    budget: secondaryBudget,
                    breaker: contextFetchBreaker,
                    semaphore: contextFetchSemaphore,
                    timeoutMs: SECONDARY_DEEP_FETCH_TIMEOUT_MS,
                    queueTimeoutMs: RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
                  });
                  deepFetchMs = Math.round(performance.now() - deepStart);

                  const byUrl = new Map<string, string | null>();
                  for (const src of contextSources) {
                    byUrl.set(canonicalizeUrl(src.link), src.extractedText ?? null);
                  }

                  const factsCandidatesRaw = deepCandidates.map((candidate) => ({
                    item: candidate.item,
                    evidence: candidate.evidence,
                    extractedText: byUrl.get(canonicalizeUrl(candidate.item.link)) ?? null,
                  }));

                  const factsCandidates: Array<{
                    item: SearchItem;
                    evidence: SecondaryEvidence;
                    extractedText: string | null;
                    gtinCandidates: string[];
                  }> = [];
                  for (const candidate of factsCandidatesRaw) {
                    const deepGtinCandidates = extractGtinCandidatesFromTextSecondary(
                      candidate.extractedText ?? "",
                    );
                    const mergedGtinCandidates = Array.from(
                      new Set([...(candidate.evidence.gtinCandidates ?? []), ...deepGtinCandidates]),
                    );
                    const deepGtinMismatch =
                      mergedGtinCandidates.length > 0 &&
                      !mergedGtinCandidates.some((code) => barcodeVariants.includes(code));
                    if (deepGtinMismatch) {
                      gtinMismatchCount += 1;
                      identityConflicts.push({
                        domain: candidate.evidence.domain ?? extractDomain(candidate.item.link),
                        reason: "gtin_mismatch",
                        gtinCandidates: mergedGtinCandidates,
                      });
                      rejectTrace.push({
                        domain: candidate.evidence.domain ?? extractDomain(candidate.item.link),
                        reason: "gtin_mismatch",
                        pageMatchScore: candidate.evidence.pageMatchScore,
                        gtinCandidates: mergedGtinCandidates,
                      });
                      continue;
                    }
                    factsCandidates.push({
                      ...candidate,
                      gtinCandidates: mergedGtinCandidates,
                    });
                  }

                  const factsList = factsCandidates.map(buildSecondaryFacts);
                  const bestFacts =
                    [...factsList].sort((a, b) => (b.coverageScore ?? 0) - (a.coverageScore ?? 0))[0] ?? null;
                  const bestFactsIndex = bestFacts ? factsList.indexOf(bestFacts) : -1;
                  const bestCandidate = bestFactsIndex >= 0 ? factsCandidates[bestFactsIndex] : null;
                  const bestEvidence = bestCandidate?.evidence ?? null;
                  const bestGtinCandidates = bestCandidate?.gtinCandidates ?? [];
                  if (bestEvidence?.strongMatch !== undefined) {
                    strongMatch = Boolean(bestEvidence.strongMatch);
                  }
                  const explicitGtinMatches = bestGtinCandidates.filter((code) => barcodeVariants.includes(code));
                  const explicitUpcMatches = scanUpc12
                    ? bestGtinCandidates.filter((code) => code === scanUpc12)
                    : [];
                  const identityStrongSecondary = Boolean(
                    bestFacts?.identifiers?.npn ||
                    bestEvidence?.jsonLdGtinMatch ||
                    explicitGtinMatches.length > 0 ||
                    explicitUpcMatches.length > 0,
                  );
                  const isAmazonSecondary = bestFacts ? isAmazonDomain(bestFacts.canonical.domain) : false;
                  const amazonCanonicalExceptionUsedSecondary =
                    Boolean(
                      isAmazonSecondary &&
                      identityStrongSecondary &&
                      (bestFacts?.coverageScore ?? 0) >= RESOLUTION_FACTS_MIN_COVERAGE,
                    );
                  const allowCanonicalSecondary =
                    Boolean(identityStrongSecondary && (!isAmazonSecondary || amazonCanonicalExceptionUsedSecondary));

                  if (!bestFacts) {
                    failureReason = gtinMismatchCount > 0 ? "secondary_gtin_mismatch" : "secondary_extract_no_text_facts";
                  } else {
                    factsCoverage = bestFacts.coverageScore;
                    factsSummary = {
                      missingFields: bestFacts.missingFields,
                      canonical: bestFacts.canonical,
                      identifiers: bestFacts.identifiers,
                    };
                    if (bestFacts.identifiers.npn) {
                      npnFoundSecondary = true;
                      npnCandidateSource = "web";
                      npnCandidateStale = false;
                      void upsertBarcodeRegulatoryMap({
                        barcodeGtin14,
                        npn: bestFacts.identifiers.npn,
                        confidence: 0.85,
                        source: "web_npn",
                        expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_WEB).toISOString(),
                        barcodeRaw: rawBarcode,
                      });
                    }

                    const hasIngredients = Boolean(bestFacts.textFacts.ingredientsText);
                    const hasAnyTextFacts = Boolean(
                      bestFacts.textFacts.ingredientsText ||
                      bestFacts.textFacts.directionsText ||
                      bestFacts.textFacts.warningsText ||
                      bestFacts.textFacts.servingSizeText,
                    );

                    if (!hasAnyTextFacts) {
                      failureReason = "secondary_extract_no_text_facts";
                    } else if (!hasIngredients) {
                      failureReason = "secondary_low_coverage";
                    } else if (!deepseekKey) {
                      failureReason = "secondary_missing_llm";
                    } else {
                      const evidenceSnippets = contextSources
                        .map((source) => source.extractedText)
                        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                        .flatMap((text) => {
                          const trimmed = text.trim();
                          if (trimmed.length <= 500) return [trimmed];
                          return [trimmed.slice(0, 500).trim()];
                        })
                        .slice(0, 4);

                      const analysisContext = `Return json only.
Do not invent or infer missing fields. If evidence is insufficient, set fields to null/empty and clearly note limitations in the verdict/summary text.
PRODUCT_FACTS_JSON: ${JSON.stringify(bestFacts)}
EVIDENCE_SNIPPETS_JSON: ${JSON.stringify(evidenceSnippets)}
`;

                      const llmBudget = new DeadlineBudget(Date.now() + SECONDARY_LLM_BUDGET_MS);
                      const llmResilience: DeepseekResilienceOptions = {
                        budget: llmBudget,
                        breaker: deepseekBreaker,
                        semaphore: deepseekSemaphore,
                        timeoutMs: SECONDARY_LLM_TIMEOUT_MS,
                        queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
                        retry: { maxAttempts: 2 },
                      };
                      llmAttempted = true;
                      const llmStart = performance.now();
                      const bundle = await fetchAnalysisBundle(analysisContext, model, deepseekKey, llmResilience);
                      llmMs = Math.round(performance.now() - llmStart);
                      repairUsed = Boolean((bundle as { _meta?: { repairUsed?: boolean } } | null)?._meta?.repairUsed);

                      if (!bundle) {
                        failureReason =
                          llmMs >= Math.max(200, SECONDARY_LLM_TIMEOUT_MS - 50)
                            ? "secondary_llm_timeout"
                            : "secondary_llm_failed";
                      } else if (!bundle.efficacy && !bundle.safety && !bundle.usagePayload) {
                        failureReason = "secondary_empty_bundle";
                      } else {
                        const fallbackBrand =
                          seed.brandTokens.find((token) => /[a-z]/i.test(token)) ?? seed.brandTokens[0] ?? null;
                        const fallbackName = sanitizeProductNameCandidate(seed.rawTitle) ?? null;
                        const finalProductInfo = allowCanonicalSecondary
                          ? {
                            brand: sanitizeBrandCandidate(bestFacts.canonical.brand ?? null),
                            name: sanitizeProductNameCandidate(bestFacts.canonical.name ?? null),
                            category: null,
                            image: bestFacts.canonical.images?.[0] ?? null,
                          }
                          : {
                            brand: fallbackBrand,
                            name: fallbackName,
                            category: null,
                            image: null,
                          };
                        const secondarySources = filteredResults.slice(0, MAX_RESULTS).map((item) => ({
                          title: item.title,
                          link: item.link,
                          domain: extractDomain(item.link),
                          isHighQuality: isHighQualityDomain(item.link),
                        }));

                        const analysisPayload: SnapshotAnalysisPayload = {
                          brandExtraction: {
                            brand: finalProductInfo.brand,
                            product: finalProductInfo.name,
                            category: finalProductInfo.category,
                            confidence: strongMatch ? "high" : "medium",
                            source: "rule",
                          },
                          productInfo: finalProductInfo,
                          sources: secondarySources,
                          efficacy: bundle.efficacy ?? null,
                          safety: bundle.safety ?? null,
                          usagePayload: bundle.usagePayload ?? null,
                        };

                        const snapshotCandidate = buildBarcodeSnapshot({
                          barcode,
                          productInfo: analysisPayload.productInfo ?? null,
                          sources: filteredResults.slice(0, MAX_RESULTS),
                          efficacy: analysisPayload.efficacy ?? null,
                          safety: analysisPayload.safety ?? null,
                          usagePayload: analysisPayload.usagePayload ?? null,
                        });

                        const snapshot = validateSnapshotOrFallback({
                          candidate: snapshotCandidate,
                          fallback: {
                            source: "barcode",
                            barcodeRaw: rawBarcode,
                            productInfo: {
                              brand: finalProductInfo.brand,
                              name: finalProductInfo.name,
                              category: finalProductInfo.category,
                              imageUrl: finalProductInfo.image,
                            },
                            createdAt: snapshotCandidate.createdAt,
                          },
                        });

                        const analysisStatus = buildAnalysisStatus({
                          hasLabelFacts: hasLabelFacts(snapshot),
                          hasAi: hasAiPayload(analysisPayload),
                          dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
                        });
                        const analysisMeta = buildAnalysisMeta({
                          status: analysisStatus,
                          labelExtraction: analysisPayload.analysis?.labelExtraction ?? null,
                          overlayClaims: await getOverlayClaimsForBarcode(),
                        });
                        analysisPayload.analysis = analysisMeta;
                        snapshot.analysis = analysisMeta;
                        snapshot.updatedAt = nowIso();

                        const expiresAt = computeExpiresAt(analysisStatus);
                        void storeSnapshotCache(
                          {
                            key: cacheKey,
                            source: "barcode",
                            snapshot,
                            analysisPayload,
                            expiresAt,
                          },
                          supabaseWriteResilience,
                        );

                        const bestEvidence = deepCandidates[0]?.evidence ?? null;
                        if (bestEvidence?.strongMatch && selectedDomain && !isMarketplaceDomain(selectedDomain)) {
                          void upsertResolutionCacheStrongMatch(
                            {
                              barcodeGtin14,
                              engineVersion: RESOLUTION_ENGINE_VERSION,
                              bestUrl: bestEvidence.url,
                              bestDomain: bestEvidence.domain,
                              signals: {
                                jsonLdGtinMatch: bestEvidence.jsonLdGtinMatch,
                                hasProductJsonLd: bestEvidence.hasProductJsonLd,
                                barcodeHitCount: bestEvidence.barcodeHitCount,
                                needsJs: bestEvidence.needsJs,
                                onlyImages: bestEvidence.onlyImages,
                              },
                              confidence: bestEvidence.jsonLdGtinMatch ? 0.95 : 0.8,
                              expiresAt: new Date(Date.now() + RESOLUTION_RESOLUTION_CACHE_TTL_MS).toISOString(),
                            },
                            supabaseWriteResilience,
                          );
                        }

                        clearNegativeCacheAllVariants(barcodeGtin14, rawBarcode, {
                          context: "secondary_backfill_web_success",
                        });
                        outcome = "SECONDARY_BACKFILL_SUCCESS";
                        failureReason = null;
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            if (!isAbortError(error)) {
              console.warn("[SecondaryBackfill] failed", error);
            }
            failureReason = "secondary_failed";
          }
        }

        const secondarySucceeded =
          outcome === "SECONDARY_BACKFILL_SUCCESS" || outcome === "SECONDARY_BACKFILL_LNHPD_SUCCESS";
        if (!secondarySucceeded) {
          const shouldWriteTimeout =
            failureReason === "secondary_fetch_timeout" ||
            failureReason === "secondary_llm_timeout" ||
            secondaryBudget.isExpired();
          if (
            failureReason === "secondary_no_candidate" ||
            failureReason === "secondary_all_filtered" ||
            failureReason === "secondary_seed_mismatch" ||
            failureReason === "secondary_gtin_mismatch" ||
            failureReason === "secondary_no_verified_candidate" ||
            failureReason === "secondary_extract_no_text_facts"
          ) {
            void writeSecondaryNegative("MARKETPLACE_ONLY_NO_ALT_SOURCE");
          } else if (shouldWriteTimeout) {
            void writeSecondaryNegative("MARKETPLACE_ONLY_TIMEOUT");
          }
        }

        const totalMs = Math.round(performance.now() - backfillStart);
        const seedNumericTokens = [
          seed.dosage ? `${seed.dosage.value} ${seed.dosage.unit}` : null,
          seed.count ? `${seed.count.value}${seed.count.unitHint ? ` ${seed.count.unitHint}` : ""}` : null,
        ].filter(Boolean);
        const signals = {
          ...baseSignals,
          stage: "secondary_backfill",
          parent_outcome: params.parentOutcome,
          deepseek_bundle_skipped_reason: params.deepseekBundleSkippedReason ?? null,
          needs_authoritative_backfill: params.needsAuthoritativeBackfill ?? false,
          needs_authoritative_reasons: params.needsAuthoritativeReasons ?? null,
          identity_strong: params.identityStrong ?? null,
          identity_conflict: params.identityConflict ?? null,
          explicit_gtin_matches: params.explicitGtinMatches ?? null,
          explicit_upc_matches: params.explicitUpcMatches ?? null,
          npn_found: npnFoundSecondary || Boolean(npnCandidate),
          amazon_canonical_exception_used: params.amazonCanonicalExceptionUsed ?? null,
          no_authoritative_domain: params.noAuthoritativeDomain ?? null,
          canonical_source_domain: params.canonicalSourceDomain ?? null,
          canonical_source_url: params.canonicalSourceUrl ?? null,
          secondary_backfill_started: true,
          secondary_backfill_success: secondarySucceeded,
          secondary_query: primaryQuery,
          secondary_fallback_query: secondaryQuery,
          secondary_fallback_used: queriesTried.length > 1,
          secondary_name_query: secondaryQuery,
          secondary_domain_query: primaryQuery,
          secondary_query_primary: queryPlan.primary.query,
          secondary_query_secondary: queryPlan.secondary?.query ?? null,
          secondary_query_primary_char_len: queryPlan.primary.charLen,
          secondary_query_secondary_char_len: queryPlan.secondary?.charLen ?? null,
          secondary_query_primary_dropped: queryPlan.primary.dropped,
          secondary_query_secondary_dropped: queryPlan.secondary?.dropped ?? [],
          secondary_query_primary_used_variants: queryPlan.primary.usedVariants,
          secondary_query_secondary_used_variants: queryPlan.secondary?.usedVariants ?? null,
          secondary_query_primary_must_groups: queryPlan.primary.mustGroups,
          secondary_query_primary_should_groups: queryPlan.primary.shouldGroups,
          secondary_query_secondary_must_groups: queryPlan.secondary?.mustGroups ?? null,
          secondary_query_secondary_should_groups: queryPlan.secondary?.shouldGroups ?? null,
          secondary_seed_brand_tokens: seed.brandTokens,
          secondary_seed_active_tokens: seed.activeTokens ?? null,
          secondary_seed_core_tokens: seed.keptTokens,
          secondary_seed_numeric_tokens: seedNumericTokens,
          secondary_seed_removed_tokens: seed.removedTokens,
          secondary_seed_kept_tokens: seed.keptTokens,
          secondary_seed_raw_title: seed.rawTitle,
          secondary_seed_dosage: seed.dosage ? `${seed.dosage.value} ${seed.dosage.unit}` : null,
          secondary_seed_count: seed.count
            ? `${seed.count.value}${seed.count.unitHint ? ` ${seed.count.unitHint}` : ""}`
            : null,
          secondary_seed_form: seed.form ?? null,
          secondary_seed_pack: seed.pack ?? null,
          secondary_seed_quality_score: seed.seedQualityScore,
          secondary_seed_match_min: SECONDARY_SEED_MATCH_MIN,
          secondary_seed_verified_min: SECONDARY_SEED_VERIFIED_MIN,
          secondary_seeded_count: seededCount,
          secondary_seed_match_top: seedMatchTop,
          secondary_seed_match_avg: seedMatchAvg,
          secondary_serp_total_domain: serpTotalPrimary,
          secondary_serp_total_openweb: serpTotalSecondary,
          secondary_non_marketplace_before_seedmatch: nonMarketplaceBeforeSeedMatch,
          secondary_after_seedmatch_count: afterSeedMatchCount,
          secondary_after_extractability_count: afterExtractabilityCount,
          secondary_after_seedverified_count: afterSeedVerifiedCount,
          secondary_gtin_mismatch_count: gtinMismatchCount,
          secondary_candidates_top3: candidateTop3,
          secondary_reject_trace: rejectTrace,
          secondary_identity_conflicts: identityConflicts,
          secondary_excluded_domains: queryPlan.bannedDomains,
          secondary_domain_ladder_sites: SECONDARY_DOMAIN_LADDER_SITES,
          secondary_queries_tried: queriesTried,
          secondary_filtered_count: filteredCount,
          secondary_selected_url: selectedUrl,
          secondary_selected_domain: selectedDomain,
          secondary_strong_match: strongMatch,
          secondary_failure_reason: failureReason,
          secondary_fail_reason: failureReason,
          secondary_seed_mpn: seedMpn,
          secondary_npn_candidate: npnCandidate,
          secondary_npn_source_url: npnSourceUrl,
          secondary_npn_lookup_failed: npnLookupFailed,
          secondary_lnhpd_id: lnhpdId,
          secondary_lnhpd_brand: lnhpdBrand,
          secondary_lnhpd_product: lnhpdProduct,
          secondary_search_ms: searchMs,
          secondary_cheap_pass_ms: cheapPassMs,
          secondary_deep_fetch_ms: deepFetchMs,
          secondary_llm_ms: llmMs,
          secondary_total_ms: totalMs,
        };

        const trainingSerp = (filteredResults.length ? filteredResults : params.seedItems)
          .slice(0, MAX_RESULTS)
          .map((item) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet ?? null,
            image: item.image ?? null,
          }));

        void insertBarcodeResolutionTrainingRow(
          {
            barcode_gtin14: barcodeGtin14,
            engine_version: RESOLUTION_ENGINE_VERSION,
            stage0_outcome: stage0Outcome,
            query_profiles_used: null,
            serp_topk: trainingSerp,
            selected_url: selectedUrl,
            selected_domain: selectedDomain,
            signals,
            facts_summary: factsSummary,
            facts_coverage: factsCoverage,
            timing: {
              secondary_search_ms: searchMs,
              secondary_cheap_pass_ms: cheapPassMs,
              secondary_deep_fetch_ms: deepFetchMs,
              secondary_llm_ms: llmMs,
              secondary_total_ms: totalMs,
            },
            calls: {
              google: queriesTried.length,
              deepseek_bundle: llmAttempted ? 1 : 0,
              deepseek_repair: repairUsed ? 1 : 0,
            },
            cache_hits: cacheHits,
            outcome,
          },
          supabaseWriteResilience,
        );
      })();

      barcodeSecondaryBackfill.set(barcodeGtin14, task);
      task.finally(() => {
        barcodeSecondaryBackfill.delete(barcodeGtin14);
      });
      return true;
    };

    if (!v2Enabled) {
      insertTrainingRow({
        outcome: "V2_DISABLED",
        signals: {
          stage: "v2_gate",
          deepseek_bundle_skipped_reason: "v2_disabled",
        },
      });
      if (!stage0Delivered) {
        if (!shouldSuppressStage1Error()) {
          emitProductNotFoundAndFinalize({ stage: "v2_gate", reasonCode: "V2_DISABLED" });
        } else {
          finalizeStream("stage1_not_found_suppressed");
        }
      } else {
        finalizeStream("stage0_delivered");
      }
      releaseInFlightOnce();
      return;
    }

    // Stage 1 negative short-circuit (ignored if Stage 0 had snapshot cache hit).
    if (!cachedFast && !forceStage1) {
      const negative = await negativeCachePromise.catch(() => null);
      const isActiveNegative = negative && Date.parse(negative.until) > Date.now();
      const ignoreNeedsJsNegative =
        allowNeedsJs && negative?.reason_code === "NEEDS_JS";
      const ignoreMarketplaceNegative =
        typeof negative?.reason_code === "string" &&
        negative.reason_code.startsWith("MARKETPLACE_ONLY");
      if (isActiveNegative && !ignoreNeedsJsNegative && !ignoreMarketplaceNegative) {
        const hasSeededDsldCandidate =
          STAGE0_DSLD_BARCODE_FALLBACK_ENABLED &&
          hasPreferredStage0DsldLabelId(barcodeGtin14);
        const regulatoryProbe = await regulatoryMapPromise.catch(() => null);
        const hasRegulatoryCandidate = Boolean(regulatoryProbe?.npn);
        const bypassNegativeShortCircuit =
          stage0Delivered ||
          streamState.latestSourceTypeFinal === true ||
          hasSeededDsldCandidate ||
          hasRegulatoryCandidate;
        if (bypassNegativeShortCircuit) {
          clearNegative();
          console.info("[ResolutionV2] bypassing active negative cache due to authoritative candidate", {
            barcode: barcodeGtin14,
            reasonCode: negative.reason_code,
            hasSeededDsldCandidate,
            hasRegulatoryCandidate,
            stage0Delivered,
            sourceTypeFinal: streamState.latestSourceTypeFinal,
          });
        } else {
          cacheHits.negative = true;
          insertTrainingRow({
            outcome: negative.reason_code,
            signals: {
              cacheHit: true,
              reasonCode: negative.reason_code,
              until: negative.until,
              deepseek_bundle_skipped_reason: "negative_cache",
            },
          });
          if (!shouldSuppressStage1Error()) {
            emitProductNotFoundAndFinalize({
              stage: "negative_cache",
              reasonCode: negative.reason_code,
            });
          } else {
            finalizeStream("stage1_not_found_suppressed");
          }
          const timingTotalMs = Math.round(performance.now() - startedAt);
          void logBarcodeScan({
            barcodeGtin14,
            barcodeRaw: rawBarcode,
            checksumValid: normalized.isValidChecksum ?? null,
            catalogHit: false,
            servedFrom: "error_not_found",
            dsldLabelId: null,
            snapshotId: null,
            deviceId,
            requestId,
            timingTotalMs,
            meta: buildAuthorityMeta({ reason: "negative_cache", reasonCode: negative.reason_code, until: negative.until }),
          });
          releaseInFlightOnce(new Error("negative_cache"));
          return;
        }
      }
    }

    type SerpEntry = {
      title: string;
      link: string;
      domain: string;
      snippet?: string;
      image?: string | null;
      score?: number;
    };

    const parseSerpEntries = (raw: unknown): SearchItem[] => {
      if (!Array.isArray(raw)) return [];
      const items: SearchItem[] = [];
      for (const entry of raw) {
        const record = entry as Partial<SerpEntry>;
        if (typeof record.link !== "string" || typeof record.title !== "string") continue;
        items.push({
          title: record.title,
          snippet: typeof record.snippet === "string" ? record.snippet : "",
          link: record.link,
          image: typeof record.image === "string" ? record.image : undefined,
        });
      }
      return items;
    };

    const toSerpEntriesForCache = (items: SearchItem[]): SerpEntry[] =>
      items.slice(0, MAX_RESULTS).map((item) => ({
        title: item.title,
        link: item.link,
        domain: extractDomain(item.link),
        snippet: truncateSnippet(item.snippet || ""),
        image: item.image ?? null,
        score: scoreSearchItem(item, { barcode }),
      }));

    const hasStrongSerpSignal = (item: SearchItem): boolean => {
      const text = `${item.title} ${item.snippet}`.replace(/\s+/g, " ");
      if (barcodeVariants.some((code) => text.includes(code))) return true;
      const link = item.link || "";
      if (barcodeVariants.some((code) => link.includes(code))) return true;
      if (/(upc|gtin|ean|barcode|sku)[^0-9]{0,6}\d{8,14}/i.test(link)) return true;
      return false;
    };

    const shouldEarlyStop = (items: SearchItem[]): boolean =>
      items.slice(0, 3).some((item) => hasStrongSerpSignal(item));

    type QueryProfile = { id: "A" | "B" | "C"; query: string };
    const baseCode = normalized.code;
    const profiles: Record<QueryProfile["id"], QueryProfile> = {
      A: { id: "A", query: `"${baseCode}"` },
      B: {
        id: "B",
        query: `"${baseCode}" (ingredients OR \"supplement facts\" OR directions OR warnings)`,
      },
      C: {
        id: "C",
        query: `"${baseCode}" (site:iherb.com OR site:walmart.com OR site:amazon.com OR site:gnc.com OR site:vitaminshoppe.com)`,
      },
    };

    const serpTtlExpiresAt = new Date(Date.now() + RESOLUTION_SERP_CACHE_TTL_MS).toISOString();
    const upsertSerp = (profileId: string, query: string, items: SearchItem[]): void => {
      if (!items.length) return; // do not cache empty SERP
      const cache_key = buildSerpCacheKey(profileId);
      void upsertSerpCache(
        {
          cache_key,
          barcode_gtin14: barcodeGtin14,
          profile_id: profileId,
          gl,
          hl,
          engine_version: RESOLUTION_ENGINE_VERSION,
          query,
          results: toSerpEntriesForCache(items),
          expires_at: serpTtlExpiresAt,
        },
        { ...supabaseReadResilience, timeoutMs: 700 },
      );
    };

    const pickLanguageBudgetMs = (): number => {
      const reserved = RESOLUTION_STAGE1_RESERVE_MS;
      const msLeft = budget.msLeft();
      const cap = Math.min(RESOLUTION_SEARCH_STAGE_MAX_MS, msLeft - reserved);
      return Math.max(0, cap);
    };

    const runHedgedSearch = async (): Promise<{
      items: SearchItem[];
      profilesUsed: string[];
      hadResponse: boolean;
      hardStop: boolean;
      errors: string[];
    }> => {
      const searchBudgetMs = pickLanguageBudgetMs();
      if (searchBudgetMs <= 0) {
        return { items: [], profilesUsed: [], hadResponse: false, hardStop: true, errors: ["BUDGET_EXHAUSTED"] };
      }

      const errors: string[] = [];
      const profilesUsed: string[] = [];
      const results: Partial<Record<QueryProfile["id"], SearchItem[]>> = {};
      let hadResponse = false;
      let hardStop = false;

      const controllers: Partial<Record<QueryProfile["id"], AbortController>> = {};
      const makeSignal = (id: QueryProfile["id"]) => {
        const controller = new AbortController();
        controllers[id] = controller;
        const { signal, cleanup } = combineSignals([requestSignal, controller.signal]);
        return { signal, cleanup };
      };

      const runProfile = async (profile: QueryProfile): Promise<void> => {
        const { signal, cleanup } = makeSignal(profile.id);
        try {
          const items = await performGoogleSearch(profile.query, googleApiKey, cx, {
            ...googleResilience,
            signal,
            timeoutMs: Math.min(RESILIENCE_GOOGLE_TIMEOUT_MS, searchBudgetMs),
            gl,
            hl,
          });
          calls.google += 1;
          hadResponse = true;
          profilesUsed.push(profile.id);
          results[profile.id] = items;
          upsertSerp(profile.id, profile.query, items);

          if (shouldEarlyStop(items)) {
            for (const [otherId, controller] of Object.entries(controllers)) {
              if (!controller) continue;
              if (otherId === profile.id) continue;
              controller.abort(new Error("early_stop"));
            }
          }
        } catch (error) {
          const aborted =
            isAbortError(error) ||
            (error instanceof Error && error.message === "early_stop");
          if (!aborted) {
            console.warn(`[ResolutionV2] search profile ${profile.id} failed`, error);
          }
          const reason =
            error instanceof BulkheadTimeoutError
              ? "TIMEOUT"
              : error instanceof TimeoutError
                ? error.message.includes("budget")
                  ? "BUDGET_EXHAUSTED"
                  : "TIMEOUT"
                : error instanceof Error && error.message === "google_breaker_open"
                  ? "BREAKER_OPEN"
                  : aborted
                    ? "ABORT"
                    : "ERROR";
          if (!aborted) {
            errors.push(reason);
          }
          const shouldStop =
            reason === "BUDGET_EXHAUSTED" ||
            reason === "BREAKER_OPEN" ||
            reason === "TIMEOUT";
          if (shouldStop) {
            hardStop = true;
          }
        } finally {
          cleanup();
        }
      };

      // Hard rule: total Google calls <= RESOLUTION_SEARCH_CALLS_MAX.
      const first = profiles.A;
      const second = profiles.B;
      const third = profiles.C;

      const tasks: Promise<void>[] = [];
      tasks.push(runProfile(first));

      // Hedge B after a short delay if we still don't have a strong candidate and budget allows.
      if (RESOLUTION_SEARCH_CALLS_MAX >= 2) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!requestSignal.aborted) {
          const aItems = results.A ?? [];
          const shouldUseSecond = !shouldEarlyStop(aItems);
          if (shouldUseSecond) {
            // C is a replacement strategy (still occupies the 2nd call).
            const useC = aItems.length === 0 && errors.length > 0;
            tasks.push(runProfile(useC ? third : second));
          }
        }
      }

      await Promise.allSettled(tasks);

      if (results.A && shouldEarlyStop(results.A)) return { items: results.A, profilesUsed, hadResponse, hardStop, errors };
      if (results.B && shouldEarlyStop(results.B)) return { items: results.B, profilesUsed, hadResponse, hardStop, errors };
      if (results.C && shouldEarlyStop(results.C)) return { items: results.C, profilesUsed, hadResponse, hardStop, errors };

      const merged = mergeAndDedupe(results.A ?? [], [...(results.B ?? []), ...(results.C ?? [])], { barcode });
      return { items: merged, profilesUsed, hadResponse, hardStop, errors };
    };

    const cacheReadStart = performance.now();
    let resolutionRow = await getResolutionCache(barcodeGtin14, { ...supabaseReadResilience, timeoutMs: 350 });
    if (resolutionRow && resolutionRow.engine_version !== RESOLUTION_ENGINE_VERSION) {
      void clearResolutionCacheBestUrl(barcodeGtin14, { ...supabaseReadResilience, timeoutMs: 500 });
      resolutionRow = null;
    }
    cacheHits.resolution = Boolean(resolutionRow?.best_url);

    const [serpA, serpB] = await Promise.all([
      getSerpCache(buildSerpCacheKey("A"), { ...supabaseReadResilience, timeoutMs: 350 }),
      getSerpCache(buildSerpCacheKey("B"), { ...supabaseReadResilience, timeoutMs: 350 }),
    ]);
    timing.cache_read_ms = Math.round(performance.now() - cacheReadStart);

    let initialItems: SearchItem[] = [];
    let profilesUsed: string[] = [];
    let serpTopk: unknown = null;

    const bestUrl = resolutionRow?.best_url?.trim() ?? null;
    if (!bestUrl) {
      const cachedSerp = serpA?.results ? serpA : serpB?.results ? serpB : null;
      if (cachedSerp) {
        cacheHits.serp = true;
        profilesUsed = [cachedSerp.profile_id];
        serpTopk = cachedSerp.results;
        initialItems = parseSerpEntries(cachedSerp.results).slice(0, MAX_RESULTS);
      } else {
        const searchStart = performance.now();
        const hedged = await runHedgedSearch();
        timing.search_ms = Math.round(performance.now() - searchStart);
        profilesUsed = hedged.profilesUsed;
        initialItems = hedged.items.slice(0, MAX_RESULTS);
        serpTopk = toSerpEntriesForCache(initialItems);

        if (!initialItems.length) {
          markPipelineStepEnd("retrieve", "failed", "no_serp");
          const stopReason = hedged.hardStop ? (hedged.errors[0] ?? null) : null;
          const reasonCode =
            stopReason === "BUDGET_EXHAUSTED" || stopReason === "BREAKER_OPEN" || stopReason === "TIMEOUT"
              ? stopReason
              : "NO_SERP";
          try {
            await writeNegative(reasonCode);
          } catch { }
          const deepseekSkipReason =
            reasonCode === "NO_SERP"
              ? "no_serp"
              : reasonCode === "BUDGET_EXHAUSTED" || reasonCode === "TIMEOUT" || reasonCode === "BREAKER_OPEN"
                ? "budget_reserved"
                : "no_serp";
          insertTrainingRow({
            outcome: reasonCode,
            profilesUsed,
            serpTopk,
            signals: {
              stage: "search",
              hardStop: hedged.hardStop,
              errors: hedged.errors,
              deepseek_bundle_skipped_reason: deepseekSkipReason,
            },
          });

          if (!shouldSuppressStage1Error()) {
            emitProductNotFoundAndFinalize({
              stage: "search",
              reasonCode,
            });
          } else {
            finalizeStream("stage1_not_found_suppressed");
          }
          const timingTotalMs = Math.round(performance.now() - startedAt);
          void logBarcodeScan({
            barcodeGtin14,
            barcodeRaw: rawBarcode,
            checksumValid: normalized.isValidChecksum ?? null,
            catalogHit: false,
            servedFrom: "error_not_found",
            dsldLabelId: null,
            snapshotId: null,
            deviceId,
            requestId,
            timingTotalMs,
            meta: buildAuthorityMeta({
              stage0Outcome,
              reason: reasonCode,
              profilesUsed,
              cacheHits,
              calls,
              timing,
            }),
          });
          releaseInFlightOnce(new Error("product_not_found"));
          return;
        }
      }
    }

    const marketplaceOnly =
      initialItems.length > 0 &&
      initialItems.every((item) => isMarketplaceDomain(extractDomain(item.link)));
    if (initialItems.length > 0) {
      markPipelineStepEnd("retrieve", "ok");
    }

    // Brand/product extraction: deterministic only (brand AI fallback removed).
    let extraction: BrandExtractionResult | null = null;
    let brandExtractedSent = false;
    if (initialItems.length) {
      extraction = extractBrandProduct(initialItems);
      if (extraction?.brand) {
        const sanitizedBrand = sanitizeBrandCandidate(extraction.brand);
        if (sanitizedBrand !== extraction.brand) {
          extraction = { ...extraction, brand: sanitizedBrand };
        }
      }
      if (marketplaceOnly && extraction?.brand && /^\d+$/.test(extraction.brand.trim())) {
        const seed = buildMarketplaceSeedV2({ rawTitle: initialItems[0]?.title ?? "", brandHint: null });
        const seedBrand =
          seed.brandTokens.find((token) => /[a-z]/i.test(token)) ?? seed.brandTokens[0] ?? null;
        extraction = {
          ...extraction,
          brand: seedBrand,
        };
      }
      latestNotFoundHint = {
        ...latestNotFoundHint,
        brand: extraction?.brand ?? latestNotFoundHint.brand,
        product: extraction?.product ?? latestNotFoundHint.product,
        category: extraction?.category ?? latestNotFoundHint.category,
      };
      if (stage1SseEnabled) {
        sendSSE(res, "brand_extracted", {
          brand: extraction.brand,
          product: extraction.product,
          category: extraction.category,
          confidence: extraction.confidence,
          source: extraction.source,
        });
        brandExtractedSent = true;
      }
    }

    const sourcesToSend = initialItems.map((item) => ({
      title: item.title,
      link: item.link,
      domain: extractDomain(item.link),
      isHighQuality: isHighQualityDomain(item.link),
    }));
    latestNotFoundHint = {
      ...latestNotFoundHint,
      sources: sourcesToSend.length > 0 ? sourcesToSend : latestNotFoundHint.sources,
    };

    const provisionalBrand = extraction?.brand ?? null;
    const provisionalName = extraction?.product ?? (initialItems[0]?.title ?? null);
    const provisionalCategory = extraction?.category ?? null;
    const provisionalImage = initialItems[0]?.image ?? null;
    if (stage1SseEnabled && (provisionalName || provisionalBrand)) {
      sendSSE(res, "product_info", {
        productInfo: {
          brand: provisionalBrand,
          name: provisionalName,
          category: provisionalCategory,
          image: provisionalImage,
        },
        sources: sourcesToSend,
        sourceQuality: marketplaceOnly ? "marketplace_only" : "mixed",
      });
    }

    const runSerpFallback = async (
      reasonCode: string,
      reasonSignals: Record<string, unknown> = {},
    ): Promise<boolean> => {
      if (!deepseekKey || !initialItems.length) return false;
      if (budget.isExpired()) return false;
      markPipelineStepEnd("select_evidence", "degraded", reasonCode.toLowerCase());

      const fallbackFacts = {
        barcode: barcodeGtin14,
        canonical: {
          name: provisionalName,
          brand: provisionalBrand,
          url: initialItems[0]?.link ?? null,
          domain: initialItems[0]?.link ? extractDomain(initialItems[0].link) : null,
          images: provisionalImage ? [provisionalImage] : null,
        },
        identifiers: {},
        textFacts: {},
        provenance: { fieldSources: {} },
        coverageScore: 0,
        missingFields: [
          "textFacts.ingredientsText",
          "textFacts.directionsText",
          "textFacts.warningsText",
          "textFacts.servingSizeText",
        ],
      };

      const fallbackHasBrand = Boolean(provisionalBrand);
      const fallbackHasDosage = false;
      const fallbackIdentityStrong = false;
      const fallbackIdentityConflict = false;
      const fallbackNoAuthoritativeDomain = isCaRegion
        ? !sourcesToSend.some((source) => isAuthoritativeCaDomain(source.domain))
        : false;
      const fallbackReasons: string[] = [];
      if (!fallbackHasBrand || !fallbackHasDosage) fallbackReasons.push("missing_brand_or_dosage");
      if (!fallbackIdentityStrong) fallbackReasons.push("missing_authoritative_identity");
      if (fallbackFacts.coverageScore < RESOLUTION_FACTS_MIN_COVERAGE) fallbackReasons.push("low_coverage");
      if (fallbackNoAuthoritativeDomain) fallbackReasons.push("no_authoritative_domain");
      const fallbackNeedsAuthoritativeBackfill = isCaRegion && fallbackReasons.length > 0;

      const evidenceSnippets = initialItems
        .map((item) => (item.snippet || item.title || "").trim())
        .filter((value) => value.length > 0)
        .map((value) => truncateSnippet(value, 500))
        .slice(0, 4);
      markPipelineStepStart("sanitize");
      const sanitizedEvidenceSnippets = evidenceSnippets
        .map((value) => sanitizeWebText(value, { maxChars: 500 }))
        .map((result) => result.text)
        .filter((value) => value.length > 0);
      const sanitizeFailed = evidenceSnippets.length > 0 && sanitizedEvidenceSnippets.length === 0;
      markPipelineStepEnd("sanitize", sanitizeFailed ? "failed" : "ok", sanitizeFailed ? "web_sanitize_failed" : undefined);

      const analysisContext = `Return json only.
PRODUCT_FACTS_JSON: ${JSON.stringify(fallbackFacts)}
EVIDENCE_SNIPPETS_JSON: ${JSON.stringify(sanitizedEvidenceSnippets)}
`;

      const llmStart = performance.now();
      let bundle: Awaited<ReturnType<typeof fetchAnalysisBundle>> | null = null;
      const fallbackNote = marketplaceOnly
        ? "Marketplace-only analysis; no verified sources."
        : "Analysis pending; limited verified data.";
      const fallbackBundle = buildLowConfidenceAnalysis({
        brand: provisionalBrand,
        name: provisionalName,
        note: fallbackNote,
      });
      const shouldRunLlm = !marketplaceOnly || marketplaceLlmEnabled;
      const fallbackResilience = marketplaceOnly
        ? {
          ...deepseekResilience,
          timeoutMs: Math.min(deepseekResilience.timeoutMs ?? marketplaceLlmTimeoutMs, marketplaceLlmTimeoutMs),
          maxTokens: marketplaceLlmMaxTokens,
        }
        : deepseekResilience;
      const fallbackTimeoutMs = fallbackResilience.timeoutMs ?? llmInteractiveTimeoutMs;
      const canRunLlm = shouldRunLlm && budget.msFor(fallbackTimeoutMs) > 0;
      let llmFailed = false;
      let deepseekBundleSkippedReason: string | null = null;
      if (!canRunLlm) {
        deepseekBundleSkippedReason = marketplaceOnly ? "marketplace_only" : "budget_reserved";
      }

      if (canRunLlm) {
        markPipelineStepStart("draft");
        try {
          calls.deepseek_bundle += 1;
          bundle = await fetchAnalysisBundle(analysisContext, model, deepseekKey, fallbackResilience);
          if ((bundle as any)?._meta?.repairUsed) {
            calls.deepseek_repair += 1;
          }
        } catch (error) {
          if (!isAbortError(error)) {
            console.warn("[ResolutionV2] serp fallback bundle failed", error);
          }
        } finally {
          markPipelineStepEnd("draft", bundle ? "ok" : "degraded", bundle ? undefined : "fast_generation_failed");
        }
        timing.llm_ms = Math.round(performance.now() - llmStart);
        if (!bundle) {
          llmFailed = true;
          deepseekBundleSkippedReason =
            timing.llm_ms >= Math.max(200, fallbackTimeoutMs - 50) ? "llm_timeout" : "llm_failed";
          incrementMetric("deepseek_bundle_fail_degraded");
        } else {
          incrementMetric("deepseek_bundle_success");
        }
      } else {
        timing.llm_ms = 0;
      }

      const efficacyToSend = mergeEfficacyWithFallback(bundle?.efficacy ?? null, fallbackBundle.efficacy);
      const safetyToSend = mergeSafetyWithFallback(bundle?.safety ?? null, fallbackBundle.safety);
      const usageToSend = mergeUsagePayloadWithFallback(bundle?.usagePayload ?? null, fallbackBundle.usagePayload);

      if (stage1SseEnabled && !streamAnalysisBundleOnly && !requestSignal.aborted && !res.writableEnded) {
        if (efficacyToSend) sendSSE(res, "result_efficacy", efficacyToSend);
        if (safetyToSend) sendSSE(res, "result_safety", safetyToSend);
        if (usageToSend) sendSSE(res, "result_usage", usageToSend);
      }

      const finalProductInfo = {
        brand: provisionalBrand,
        name: provisionalName,
        category: provisionalCategory,
        image: provisionalImage,
      };

      const analysisPayload: SnapshotAnalysisPayload = {
        brandExtraction: {
          brand: finalProductInfo.brand,
          product: finalProductInfo.name,
          category: finalProductInfo.category,
          confidence: extraction?.confidence ?? "low",
          source: "rule",
        },
        productInfo: finalProductInfo,
        sources: sourcesToSend,
        efficacy: efficacyToSend,
        safety: safetyToSend,
        usagePayload: usageToSend,
      };

      const snapshotCandidate = buildBarcodeSnapshot({
        barcode,
        productInfo: analysisPayload.productInfo ?? null,
        sources: initialItems,
        efficacy: efficacyToSend ?? null,
        safety: safetyToSend ?? null,
        usagePayload: usageToSend ?? null,
      });

      const snapshot = validateSnapshotOrFallback({
        candidate: snapshotCandidate,
        fallback: {
          source: "barcode",
          barcodeRaw: rawBarcode,
          productInfo: {
            brand: finalProductInfo.brand,
            name: finalProductInfo.name,
            category: finalProductInfo.category,
            imageUrl: finalProductInfo.image,
          },
          createdAt: snapshotCandidate.createdAt,
        },
      });

      const analysisStatus = buildAnalysisStatus({
        hasLabelFacts: hasLabelFacts(snapshot),
        hasAi: hasAiPayload(analysisPayload),
        dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
      });
      const analysisMeta = buildAnalysisMeta({
        status: analysisStatus,
        labelExtraction: analysisPayload.analysis?.labelExtraction ?? null,
        overlayClaims: await getOverlayClaimsForBarcode(),
      });
      analysisPayload.analysis = analysisMeta;
      snapshot.analysis = analysisMeta;
      snapshot.updatedAt = nowIso();

      const fallbackCanonicalUrls = initialItems.map((item) => item.link).slice(0, 2);
      const fallbackCanonicalHash = createHash("sha256").update(fallbackCanonicalUrls.join("|")).digest("hex");
      const fallbackFactsSourceVersion = `web:${RESOLUTION_ENGINE_VERSION}:${fallbackCanonicalHash}`;
      const fallbackCanonicalBestUrl = fallbackCanonicalUrls[0] ?? null;
      const fallbackWebCanonicalId = fallbackCanonicalBestUrl
        ? createHash("sha256").update(`${fallbackCanonicalBestUrl}|${RESOLUTION_ENGINE_VERSION}|${barcodeGtin14}`).digest("hex")
        : barcodeGtin14;
      const fallbackIdentityType = fallbackCanonicalBestUrl ? "webCanonicalId" : "gtin14";
      const fallbackDigest = buildFactsDigestFromWeb({
        facts: {
          barcode: barcodeGtin14,
          canonical: {
            name: fallbackFacts.canonical?.name ?? null,
            brand: fallbackFacts.canonical?.brand ?? null,
            url: fallbackFacts.canonical?.url ?? null,
            domain: fallbackFacts.canonical?.domain ?? null,
          },
          identifiers: { npn: null },
          textFacts: {
            ingredientsText: null,
            directionsText: null,
            warningsText: null,
            servingSizeText: null,
          },
          coverageScore: fallbackFacts.coverageScore ?? 0,
          missingFields: fallbackFacts.missingFields ?? [],
        },
        snapshot,
        identityType: fallbackIdentityType,
        identityValue: fallbackWebCanonicalId,
        regionTags: snapshot.regulatory.regionTags,
      });
      startStage1Bundle({
        digest: fallbackDigest,
        identityType: fallbackIdentityType,
        identityValue: fallbackWebCanonicalId,
        factsSourceVersion: fallbackFactsSourceVersion,
        allowAi: Boolean(deepseekKey),
        apiKey: deepseekKey,
      });

      if (stage1SnapshotWriteEnabled) {
        void storeSnapshotCache({
          key: cacheKey,
          source: "barcode",
          snapshot,
          analysisPayload,
          expiresAt: computeExpiresAt(analysisStatus),
        });
      }

      const backfillReason = deepseekBundleSkippedReason ?? (llmFailed ? "llm_failed" : null);
      const allowBackgroundBackfill =
        !degradedMode &&
        !budgetGuardTriggered &&
        !streamState.doneSent &&
        !streamState.ended;
      const shouldQueueBackfill =
        WEB_BACKGROUND_BACKFILL_ENABLE &&
        allowBackgroundBackfill &&
        !streamAnalysisBundleOnly &&
        aiAvailable &&
        !bundle &&
        Boolean(backfillReason) &&
        (!marketplaceOnly || marketplaceLlmEnabled);
      if (shouldQueueBackfill) {
        const queued = queueBarcodeAnalysisCompletion({
          cacheKey,
          barcode,
          detailItems: initialItems,
          analysisContext,
          analysisPayload,
          snapshot,
          model,
          deepseekKey,
          training: {
            barcodeGtin14,
            stage0Outcome,
            parentOutcome: marketplaceOnly ? "SERP_FALLBACK_MARKETPLACE_ONLY" : "SERP_FALLBACK",
            deepseekBundleSkippedReason: backfillReason,
            profilesUsed,
            serpTopk,
            selectedUrl: initialItems[0]?.link ?? null,
            selectedDomain: initialItems[0]?.link ? extractDomain(initialItems[0].link) : null,
            cacheHits: { ...cacheHits },
            calls: { ...calls },
            signals: {
              ...baseSignals,
              stage: "serp_fallback",
              reasonCode,
              marketplaceOnly,
              marketplaceLlmEnabled,
              marketplaceLlmUsed: shouldRunLlm && marketplaceOnly,
            },
          },
        });
        backgroundBackfillQueued = backgroundBackfillQueued || queued;
      }

      const shouldSecondaryBackfill =
        WEB_BACKGROUND_BACKFILL_ENABLE &&
        allowBackgroundBackfill &&
        !streamAnalysisBundleOnly &&
        (fallbackNeedsAuthoritativeBackfill || (!isCaRegion && marketplaceOnly));
      if (shouldSecondaryBackfill) {
        const secondaryQueued = queueMarketplaceSecondaryBackfill({
          seedItems: initialItems,
          marketplaceOnly,
          extraction,
          parentOutcome: marketplaceOnly ? "SERP_FALLBACK_MARKETPLACE_ONLY" : "SERP_FALLBACK",
          deepseekBundleSkippedReason: backfillReason,
          needsAuthoritativeBackfill: fallbackNeedsAuthoritativeBackfill,
          needsAuthoritativeReasons: fallbackReasons,
          identityStrong: fallbackIdentityStrong,
          identityConflict: fallbackIdentityConflict,
          explicitGtinMatches: [],
          explicitUpcMatches: [],
          npnFound: false,
          amazonCanonicalExceptionUsed: false,
          noAuthoritativeDomain: fallbackNoAuthoritativeDomain,
          canonicalSourceDomain: fallbackFacts.canonical.domain ?? null,
          canonicalSourceUrl: fallbackFacts.canonical.url ?? null,
        });
        secondaryBackfillQueued = secondaryBackfillQueued || secondaryQueued;
      }

      insertTrainingRow({
        outcome: marketplaceOnly ? "SERP_FALLBACK_MARKETPLACE_ONLY" : "SERP_FALLBACK",
        profilesUsed,
        serpTopk,
        signals: {
          stage: "serp_fallback",
          reasonCode,
          marketplaceOnly,
          marketplaceLlmEnabled,
          marketplaceLlmUsed: shouldRunLlm && marketplaceOnly,
          llmFailed,
          deepseek_bundle_skipped_reason: deepseekBundleSkippedReason,
          background_backfill_started: backgroundBackfillQueued,
          needs_authoritative_backfill: fallbackNeedsAuthoritativeBackfill,
          needs_authoritative_reasons: fallbackReasons,
          identity_strong: fallbackIdentityStrong,
          identity_conflict: fallbackIdentityConflict,
          explicit_gtin_matches: [],
          explicit_upc_matches: [],
          npn_found: false,
          amazon_canonical_exception_used: false,
          no_authoritative_domain: fallbackNoAuthoritativeDomain,
          canonical_source_domain: fallbackFacts.canonical.domain ?? null,
          canonical_source_url: fallbackFacts.canonical.url ?? null,
          ...reasonSignals,
        },
      });
      clearNegative();

      await awaitAnalysisBundle();
      finalizeStream("serp_fallback_complete");
      releaseInFlightOnce();
      return true;
    };

    // -------------------------------------------------------------------------
    // Cheap pass: validate candidate URLs quickly before deep fetch.
    // -------------------------------------------------------------------------
    const isPrivateHostname = (hostname: string): boolean => {
      const host = hostname.toLowerCase();
      if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
        return true;
      }
      const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipv4Match) {
        const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
      }
      if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
        return true;
      }
      return false;
    };

    const canFetchPublicUrl = (rawUrl: string): boolean => {
      try {
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol)) return false;
        if (isPrivateHostname(url.hostname)) return false;
        return true;
      } catch {
        return false;
      }
    };

    const BROWSER_UA =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    const countOccurrences = (haystack: string, needle: string): number => {
      if (!needle) return 0;
      let count = 0;
      let idx = 0;
      while (true) {
        const next = haystack.indexOf(needle, idx);
        if (next < 0) return count;
        count += 1;
        idx = next + needle.length;
      }
    };

    const metaContentRegexCache = new Map<string, RegExp>();
    const getMetaContentRegex = (key: string): RegExp => {
      const cached = metaContentRegexCache.get(key);
      if (cached) return cached;
      const compiled = new RegExp(
        `<meta[^>]+(?:property|name)=[\"']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
        "i",
      );
      metaContentRegexCache.set(key, compiled);
      return compiled;
    };

    const extractMetaContent = (html: string, key: string): string | null => {
      return profileWebParseStep("primary.extractMetaContent", html, () => {
        const match = clampRegexScanWindow(html).match(getMetaContentRegex(key));
        const value = match?.[1]?.trim();
        return value ? value : null;
      }, { fallback: () => null });
    };

    type JsonLdExtract = {
      name?: string | null;
      brand?: string | null;
      images?: string[];
      sku?: string | null;
      gtin?: string | null;
      hasProduct?: boolean;
      gtinMatch?: boolean;
    };

    const extractJsonLd = (html: string): JsonLdExtract =>
      profileWebParseStep("primary.extractJsonLd", html, () => {
        const payloads = extractJsonLdScriptPayloads(clampRegexScanWindow(html));
        let name: string | null = null;
        let brand: string | null = null;
        const images: string[] = [];
        let sku: string | null = null;
        let gtin: string | null = null;
        let hasProduct = false;
        let gtinMatch = false;

        for (const payload of payloads) {
          if (!payload) continue;
          if (/\bproduct\b/i.test(payload.slice(0, 4096))) {
            hasProduct = true;
          }
          const payloadDigits = extractDigitsPrefix(payload);
          if (barcodeVariants.some((code) => payloadDigits.includes(code))) {
            gtinMatch = true;
          }

          try {
            const parsed = JSON.parse(payload) as unknown;
            const stack: unknown[] = [parsed];
            let visitedNodes = 0;
            while (stack.length) {
              visitedNodes += 1;
              if (visitedNodes > STAGE0_WEB_JSONLD_MAX_NODES) break;
              const node = stack.pop();
              if (!node || typeof node !== "object") continue;
              if (Array.isArray(node)) {
                node.forEach((child) => stack.push(child));
                continue;
              }
              const record = node as Record<string, unknown>;
              const typeValue = record["@type"];
              if (typeof typeValue === "string" && typeValue.toLowerCase().includes("product")) {
                hasProduct = true;
              }
              if (!name && typeof record.name === "string") name = record.name;
              const brandValue = record.brand;
              if (!brand) {
                if (typeof brandValue === "string") brand = brandValue;
                if (brandValue && typeof brandValue === "object") {
                  const brandObj = brandValue as Record<string, unknown>;
                  if (typeof brandObj.name === "string") brand = brandObj.name;
                }
              }
              const imageValue = record.image;
              if (typeof imageValue === "string") images.push(imageValue);
              if (Array.isArray(imageValue)) {
                for (const img of imageValue) {
                  if (typeof img === "string") images.push(img);
                }
              }
              if (!sku && typeof record.sku === "string") sku = record.sku;
              const gtinKeys = ["gtin14", "gtin13", "gtin12", "gtin", "gtin8"];
              for (const key of gtinKeys) {
                const value = record[key];
                if (typeof value === "string" && value.replace(/\D/g, "")) {
                  const digitsOnly = value.replace(/\D/g, "");
                  if (!gtin) gtin = digitsOnly;
                  if (barcodeVariants.includes(digitsOnly)) {
                    gtinMatch = true;
                  }
                }
              }
              Object.values(record).forEach((child) => stack.push(child));
            }
          } catch {
            // ignore parse failures for truncated JSON-LD
          }
        }

        return {
          name,
          brand,
          images: images.filter(Boolean).slice(0, 5),
          sku,
          gtin,
          hasProduct,
          gtinMatch,
        };
      }, {
        fallback: () => ({
          name: null,
          brand: null,
          images: [],
          sku: null,
          gtin: null,
          hasProduct: false,
          gtinMatch: false,
        }),
      });

    const extractNpnFromText = (text: string): string | null =>
      profileWebParseStep("primary.extractNpnFromText", text, () => {
        const scanText =
          text.length > Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS)
            ? text.slice(0, Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS))
            : text;
        const match = scanText.match(/\bNPN\s*[:#]?\s*(\d{8})\b/i);
        return match?.[1] ?? null;
      }, { fallback: () => null });

    const normalizeGtinCandidate = (value: string): string | null => {
      const digits = value.replace(/\D/g, "");
      if (!digits) return null;
      if (digits.length < 8 || digits.length > 14) return null;
      return digits;
    };

    const extractGtinCandidatesFromText = (text: string): string[] =>
      profileWebParseStep("primary.extractGtinCandidatesFromText", text, () => {
        if (!text) return [];
        const scanText =
          text.length > Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS)
            ? text.slice(0, Math.min(STAGE0_WEB_DIGIT_SCAN_MAX_CHARS, STAGE0_WEB_REGEX_SCAN_MAX_CHARS))
            : text;
        if (!/\b(?:UPC|GTIN|EAN|JAN)\b/i.test(scanText)) return [];
        const matches = new Set<string>();
        const regex = /\b(?:UPC|GTIN|EAN|JAN|UPC-A|UPCA)\s*[:#]?\s*([0-9][0-9\-\s]{6,24})\b/gi;
        let match: RegExpExecArray | null = null;
        let iterations = 0;
        while ((match = regex.exec(scanText)) !== null) {
          iterations += 1;
          if (iterations > 512) break;
          const candidate = normalizeGtinCandidate(match[1] ?? "");
          if (candidate) matches.add(candidate);
          if (match.index === regex.lastIndex) regex.lastIndex += 1;
        }
        return Array.from(matches);
      }, { fallback: () => [] });

    const fetchTextPrefix = async (rawUrl: string, maxBytes: number, timeoutMs: number): Promise<{
      ok: boolean;
      contentType: string;
      finalUrl: string;
      text: string;
    } | null> => {
      if (!canFetchPublicUrl(rawUrl)) return null;
      if (contextFetchBreaker && !contextFetchBreaker.canRequest()) return null;

      const budgetedTimeout = budget.msFor(timeoutMs);
      if (budgetedTimeout <= 0) return null;

      let release: (() => void) | null = null;
      try {
        release = await contextFetchSemaphore.acquire({
          timeoutMs: RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
          signal: requestSignal,
        });
      } catch {
        return null;
      }

      const timeoutSignal = createTimeoutSignal(budgetedTimeout);
      const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
      const parseStartedAt = performance.now();
      try {
        const effectiveMaxBytes = Math.min(maxBytes, STAGE0_WEB_MAX_BYTES);
        const response = await fetch(rawUrl, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            Range: `bytes=0-${Math.max(0, effectiveMaxBytes - 1)}`,
          },
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          contextFetchBreaker?.recordFailure();
          return null;
        }
        const contentType = response.headers.get("content-type") || "";
        const reader = response.body?.getReader();
        if (!reader) {
          const rawText = await response.text();
          const clipped = rawText.slice(0, effectiveMaxBytes);
          webBytesReadTotal += Buffer.byteLength(clipped, "utf8");
          contextFetchBreaker?.recordSuccess();
          return {
            ok: true,
            contentType,
            finalUrl: response.url,
            text: clipped,
          };
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (received < effectiveMaxBytes) {
          if (shouldSkipWebParseWork()) {
            try {
              await reader.cancel();
            } catch { }
            break;
          }
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = effectiveMaxBytes - received;
          chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
          received += Math.min(value.length, remaining);
          if (received >= effectiveMaxBytes) {
            try {
              await reader.cancel();
            } catch { }
            break;
          }
        }
        const buffer = Buffer.concat(chunks);
        webBytesReadTotal += received;
        const text = buffer.toString("utf8");
        contextFetchBreaker?.recordSuccess();
        return { ok: true, contentType, finalUrl: response.url, text };
      } catch (error) {
        if (!isAbortError(error)) {
          contextFetchBreaker?.recordFailure();
        }
        return null;
      } finally {
        const elapsed = performance.now() - parseStartedAt;
        if (Number.isFinite(elapsed)) {
          webParseMsTotal += elapsed;
        }
        if (
          webParseMsTotal > STAGE0_WEB_PARSE_BUDGET_MS &&
          !streamState.rev1Sent &&
          !streamState.doneSent &&
          !streamState.ended
        ) {
          emitDegradedLimitedRev1AndFinalize("DEGRADED_WEB_BUDGET");
        }
        maybeDegradeForEventLoopLag();
        cleanup();
        release?.();
      }
    };

    type CheapEvidence = {
      url: string;
      domain: string;
      contentType: string;
      barcodeHitCount: number;
      hasProductJsonLd: boolean;
      jsonLdGtinMatch: boolean;
      npnCandidate: string | null;
      needsJs: boolean;
      onlyImages: boolean;
      strongMatch: boolean;
      jsonLd: JsonLdExtract;
      meta: { ogTitle: string | null; ogBrand: string | null };
    };

    const cheapPass = async (rawUrl: string): Promise<CheapEvidence | null> => {
      const prefix = await fetchTextPrefix(rawUrl, RESOLUTION_CHEAP_PASS_MAX_BYTES, RESOLUTION_CHEAP_PASS_TIMEOUT_MS);
      if (!prefix || !prefix.ok) return null;
      const contentType = prefix.contentType || "";
      const lowerType = contentType.toLowerCase();
      const onlyImages =
        lowerType.includes("image/") || lowerType.includes("application/pdf") || lowerType.includes("application/octet-stream");
      const text = prefix.text ?? "";
      const parseText = clampRegexScanWindow(text);
      const digits = extractDigitsPrefix(parseText);
      const barcodeHitCount = barcodeVariants.reduce((sum, code) => sum + countOccurrences(digits, code), 0);
      const jsonLd = extractJsonLd(parseText);
      const npnCandidate = extractNpnFromText(parseText);
      const needsJs =
        /please enable javascript|enable javascript|requires javascript|turn on javascript/i.test(parseText) ||
        (parseText.includes("<script") && !parseText.includes("ingredients") && barcodeHitCount === 0);

      const hasProductJsonLd = Boolean(jsonLd.hasProduct);
      const jsonLdGtinMatch = Boolean(jsonLd.gtinMatch);
      const strongMatch =
        !onlyImages &&
        !needsJs &&
        (jsonLdGtinMatch || barcodeHitCount >= RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN);

      const metaOgTitle = extractMetaContent(parseText, "og:title");
      const metaBrand = extractMetaContent(parseText, "product:brand") ?? extractMetaContent(parseText, "og:site_name");

      return {
        url: prefix.finalUrl || rawUrl,
        domain: extractDomain(prefix.finalUrl || rawUrl),
        contentType,
        barcodeHitCount,
        hasProductJsonLd,
        jsonLdGtinMatch,
        npnCandidate,
        needsJs,
        onlyImages,
        strongMatch,
        jsonLd,
        meta: { ogTitle: metaOgTitle, ogBrand: metaBrand },
      };
    };

    const candidateItems: SearchItem[] = [];
    if (bestUrl) {
      candidateItems.push({
        title: "Cached product page",
        snippet: "",
        link: bestUrl,
      });
    }
    for (const item of initialItems) {
      candidateItems.push(item);
    }

    const dedupedCandidates: SearchItem[] = [];
    const seen = new Set<string>();
    for (const item of candidateItems) {
      const url = canonicalizeUrl(item.link);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      dedupedCandidates.push({ ...item, link: url });
    }

    const cheapTargets = dedupedCandidates.slice(0, RESOLUTION_CHEAP_PASS_MAX_URLS);
    const cheapStart = performance.now();
    const cheapSettled = await Promise.allSettled(
      cheapTargets.map(async (item) => {
        const evidence = await cheapPass(item.link);
        return { item, evidence };
      }),
    );
    timing.cheap_pass_ms = Math.round(performance.now() - cheapStart);

    const evidences: Array<{ item: SearchItem; evidence: CheapEvidence }> = [];
    for (const result of cheapSettled) {
      if (result.status !== "fulfilled") continue;
      if (!result.value.evidence) continue;
      evidences.push({ item: result.value.item, evidence: result.value.evidence });
    }

    // If best_url failed cheap pass, record failure to avoid sticky bad cache.
    if (bestUrl) {
      const bestEvidence = evidences.find((entry) => canonicalizeUrl(entry.item.link) === canonicalizeUrl(bestUrl));
      if (!bestEvidence || bestEvidence.evidence.onlyImages || bestEvidence.evidence.needsJs) {
        void recordResolutionCacheFailure(barcodeGtin14, { ...supabaseReadResilience, timeoutMs: 700 });
        if ((resolutionRow?.fail_count ?? 0) >= 2) {
          void clearResolutionCacheBestUrl(barcodeGtin14, { ...supabaseReadResilience, timeoutMs: 700 });
        }
      }
    }

    const rankEvidence = (entry: { item: SearchItem; evidence: CheapEvidence }): number => {
      const base = scoreSearchItem(entry.item, { barcode });
      let score = base;
      const tier = getExtractabilityTier(entry.evidence.domain);
      if (entry.evidence.strongMatch) score += 1000;
      if (entry.evidence.jsonLdGtinMatch) score += 200;
      if (entry.evidence.hasProductJsonLd) score += 80;
      score += Math.min(10, entry.evidence.barcodeHitCount) * 20;
      if (tier === "A") score += 40;
      if (tier === "B") score += 15;
      if (tier === "C") score -= 60;
      if (isMarketplaceDomain(entry.evidence.domain)) score -= 80;
      if (entry.evidence.needsJs) score -= 150;
      if (entry.evidence.onlyImages) score -= 300;
      return score;
    };

    const scoredCandidates = evidences
      .map((entry) => ({
        entry,
        rankScore: rankEvidence(entry),
      }))
      .sort((a, b) => b.rankScore - a.rankScore);

    const selection = selectBestWebCandidates(
      scoredCandidates.map((row) => {
        const domain = row.entry.evidence.domain ?? extractDomain(row.entry.item.link);
        const strongOwnership = Boolean(
          row.entry.evidence.strongMatch ||
          row.entry.evidence.npnCandidate ||
          row.entry.evidence.jsonLdGtinMatch ||
          row.entry.evidence.barcodeHitCount >= RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN,
        );
        return {
          url: row.entry.evidence.url || row.entry.item.link,
          domain,
          isMarketplace: isMarketplaceDomain(domain),
          isAuthoritative: isAuthoritativeWebCandidate(domain),
          strongOwnership,
          rankScore: row.rankScore,
        };
      }),
      STAGE0_WEB_MAX_SOURCES,
    );
    marketplaceRejectedCount = selection.marketplaceRejectedCount;

    const selectedCandidateUrlSet = new Set(
      selection.selected.map((row) => canonicalizeUrl(row.url)).filter(Boolean),
    );
    const candidatePool = scoredCandidates
      .map((row) => row.entry)
      .filter((entry) => selectedCandidateUrlSet.has(canonicalizeUrl(entry.evidence.url || entry.item.link)));
    const effectivePool = candidatePool.length > 0 ? candidatePool : scoredCandidates.map((row) => row.entry);

    const deepCandidates = effectivePool
      .filter((entry) => {
        if (entry.evidence.onlyImages) return false;
        if (entry.evidence.needsJs && !allowNeedsJs) return false;
        return entry.evidence.hasProductJsonLd || entry.evidence.barcodeHitCount > 0 || entry.evidence.strongMatch;
      })
      .slice(0, STAGE0_WEB_MAX_SOURCES);

    if (deepCandidates.length === 0) {
      const onlyImagesCount = evidences.filter((e) => e.evidence.onlyImages).length;
      const needsJsCount = evidences.filter((e) => e.evidence.needsJs).length;
      const reasonCode =
        evidences.length === 0
          ? budget.isExpired()
            ? "BUDGET_EXHAUSTED"
            : "TIMEOUT"
          : onlyImagesCount === evidences.length
            ? "ONLY_IMAGES"
            : needsJsCount === evidences.length && !allowNeedsJs
              ? "NEEDS_JS"
              : "NO_VALID_URL";
      const fallbackUsed = await runSerpFallback(reasonCode, {
        stage: "cheap_pass",
        onlyImagesCount,
        needsJsCount,
      });
      if (fallbackUsed) return;

      try {
        await writeNegative(reasonCode);
      } catch { }
      insertTrainingRow({
        outcome: reasonCode,
        profilesUsed,
        serpTopk,
        signals: {
          stage: "cheap_pass",
          onlyImagesCount,
          needsJsCount,
          deepseek_bundle_skipped_reason: reasonCode === "NEEDS_JS" ? "marketplace_only" : "no_valid_url",
        },
      });

      if (!shouldSuppressStage1Error()) {
        emitProductNotFoundAndFinalize({
          stage: "cheap_pass",
          reasonCode,
        });
      } else {
        finalizeStream("stage1_not_found_suppressed");
      }
      const timingTotalMs = Math.round(performance.now() - startedAt);
      void logBarcodeScan({
        barcodeGtin14,
        barcodeRaw: rawBarcode,
        checksumValid: normalized.isValidChecksum ?? null,
        catalogHit: false,
        servedFrom: "error_not_found",
        dsldLabelId: null,
        snapshotId: null,
        deviceId,
        requestId,
        timingTotalMs,
        meta: buildAuthorityMeta({ stage0Outcome, reason: reasonCode, profilesUsed, cacheHits, calls, timing }),
      });
      releaseInFlightOnce(new Error("no_valid_url"));
      return;
    }

    // Opportunistic LNHPD resolution if we discovered an NPN (deterministic extraction).
    const npnCandidate =
      LNHPD_RUNTIME_ENABLED
        ? deepCandidates.map((c) => c.evidence.npnCandidate).find((value): value is string => typeof value === "string") ??
          null
        : null;
    if (LNHPD_RUNTIME_ENABLED && npnCandidate) {
      npnCandidateSource = "web";
      authorityCandidateSource = "web";
      npnCandidateStale = false;
      try {
        const lnhpdLookup = await fetchLnhpdFactsWithSecondChance(npnCandidate, requestSignal, {
          firstTimeoutMs: RESILIENCE_LNHPD_TIMEOUT_MS,
          secondTimeoutMs: RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS,
          forceMode: authorityFailMode,
        });
        authorityLnhpdAttempt1Status = lnhpdLookup.attempt1Status;
        authorityLnhpdAttempt2Status = lnhpdLookup.attempt2Status;
        lnhpdFetchStatus = lnhpdLookup.finalStatus;
        const lnhpdFacts = lnhpdLookup.facts;
        if (lnhpdFacts) {
          authorityFailureReason = null;
          const lnhpdLabelFacts = toLabelFactsFromLnhpd(lnhpdFacts);
          const labelExtraction: LabelExtractionMeta = {
            source: "lnhpd",
            fetchedAt: lnhpdFacts.extractedAt ?? nowIso(),
            datasetVersion: lnhpdFacts.datasetVersion ?? null,
          };
          const lnhpdProductInfo = {
            brand: lnhpdFacts.brandName ?? provisionalBrand ?? null,
            name: lnhpdFacts.productName ?? provisionalName ?? null,
            category: provisionalCategory ?? null,
            image: provisionalImage ?? null,
          };
          const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);
          const lnhpdAnalysisPayload: SnapshotAnalysisPayload = {
            ...labelAnalysis,
            brandExtraction: {
              brand: lnhpdProductInfo.brand,
              product: lnhpdProductInfo.name,
              category: lnhpdProductInfo.category,
              confidence: "high",
              source: "rule",
            },
            productInfo: lnhpdProductInfo,
            sources: sourcesToSend,
          };

          let lnhpdSnapshot = buildBarcodeSnapshot({
            barcode,
            productInfo: lnhpdProductInfo,
            sources: initialItems,
            efficacy: lnhpdAnalysisPayload.efficacy ?? null,
            safety: lnhpdAnalysisPayload.safety ?? null,
            usagePayload: lnhpdAnalysisPayload.usagePayload ?? null,
          });
          lnhpdSnapshot = applyLnhpdFactsToSnapshot(lnhpdSnapshot, lnhpdFacts);
          const lnhpdFactsSourceVersion = `lnhpd:${lnhpdFacts.datasetVersion ?? lnhpdFacts.extractedAt ?? "unknown"}`;
          const lnhpdDigest = buildFactsDigestFromLnhpd({
            facts: lnhpdFacts,
            snapshot: lnhpdSnapshot,
            identityValue: npnCandidate,
            regionTags: lnhpdSnapshot.regulatory.regionTags,
          });
          startStage0Bundle({
            digest: lnhpdDigest,
            identityType: "npn",
            identityValue: npnCandidate,
            factsSourceVersion: lnhpdFactsSourceVersion,
            stage0Winner: "verified_regulatory",
            allowAi: false,
            apiKey: deepseekKey,
          });
          const analysisStatus = buildAnalysisStatus({
            hasLabelFacts: hasLabelFacts(lnhpdSnapshot),
            hasAi: hasAiPayload(lnhpdAnalysisPayload),
            dsldLabelId: null,
          });
          const analysisMeta = buildAnalysisMeta({
            status: analysisStatus,
            labelExtraction,
            overlayClaims: await getOverlayClaimsForBarcode(),
          });
          lnhpdAnalysisPayload.analysis = analysisMeta;
          lnhpdSnapshot.status = "resolved";
          lnhpdSnapshot.analysis = analysisMeta;
          lnhpdSnapshot.updatedAt = nowIso();

          if (stage1SseEnabled) {
            if (!brandExtractedSent) {
              sendSSE(res, "brand_extracted", {
                brand: lnhpdProductInfo.brand,
                product: lnhpdProductInfo.name,
                category: lnhpdProductInfo.category,
                confidence: "high",
                source: "rule",
              });
              brandExtractedSent = true;
            }
            sendSSE(res, "product_info", { productInfo: lnhpdProductInfo, sources: sourcesToSend });
            if (!streamAnalysisBundleOnly) {
              sendSSE(res, "result_efficacy", lnhpdAnalysisPayload.efficacy);
              sendSSE(res, "result_safety", lnhpdAnalysisPayload.safety);
              sendSSE(res, "result_usage", lnhpdAnalysisPayload.usagePayload);
              sendSSE(res, "snapshot", lnhpdSnapshot);
            }
          }
          stage0Delivered = true;
          stage0Source = "lnhpd";

          const expiresAt = computeExpiresAt(analysisStatus);
          void storeSnapshotCache({
            key: cacheKey,
            source: "barcode",
            snapshot: lnhpdSnapshot,
            analysisPayload: lnhpdAnalysisPayload,
            expiresAt,
          });

          void upsertBarcodeRegulatoryMap({
            barcodeGtin14,
            npn: npnCandidate,
            confidence: 0.9,
            source: "lnhpd",
            expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_LNHPD).toISOString(),
            barcodeRaw: rawBarcode,
          });

          // Best-effort background enrichment for nicer copy; does not block interactive.
          if (aiAvailable && analysisStatus !== "complete" && analysisStatus !== "ai_enriched") {
            queueFirstPartyAnalysisCompletion({
              cacheKey,
              barcode,
              model,
              deepseekKey,
              snapshot: lnhpdSnapshot,
              analysisPayload: lnhpdAnalysisPayload,
              labelFacts: lnhpdLabelFacts,
            });
          }

          clearNegative();
          void clearNpnNegativeCache(npnCandidate, { ...supabaseReadResilience, timeoutMs: 500 });
          if (!forceStage1) {
            if (STAGE0_PROTOCOL_UNIFIED) {
              await awaitStage0Bundle();
            }
            finalizeStream("lnhpd_candidate_stage0_complete");
            releaseInFlightOnce();
            return;
          }
          console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after LNHPD candidate hit");
        } else {
          if (lnhpdLookup.finalStatus === "timeout") {
            authorityFailureReason =
              lnhpdLookup.attempt2Status === "timeout" ? "lnhpd_timeout_second" : "lnhpd_timeout_first";
          } else if (lnhpdLookup.finalStatus === "not_found") {
            authorityFailureReason = "lnhpd_not_found";
          } else {
            authorityFailureReason = "lnhpd_query_error";
          }
          if (lnhpdFetchStatus === "not_found") {
            void upsertBarcodeRegulatoryMap({
              barcodeGtin14,
              npn: npnCandidate,
              confidence: 0.2,
              source: "lnhpd_not_found",
              expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
              barcodeRaw: rawBarcode,
            }, {
              ...supabaseWriteResilience,
              writeGuardMode: "enforce",
            });
          }
          if (lnhpdFetchStatus === "not_found") {
            void recordNpnNegativeAttempt(
              {
                npn: npnCandidate,
                reasonCode: "lnhpd_not_found",
                windowMs: NPN_NEGATIVE_CACHE_WINDOW_HOURS * 60 * 60 * 1000,
                threshold: NPN_NEGATIVE_CACHE_THRESHOLD,
                ttlMs: NPN_NEGATIVE_CACHE_TTL_MS,
              },
              { ...supabaseWriteResilience, timeoutMs: 500 },
            );
          }
        }
      } catch (error) {
        lnhpdFetchStatus = "error";
        authorityFailureReason = "lnhpd_query_error";
        authorityLnhpdAttempt1Status =
          authorityLnhpdAttempt1Status === "not_attempted" ? "error" : authorityLnhpdAttempt1Status;
        console.warn("[ResolutionV2] Opportunistic LNHPD fetch failed", error);
      }
    }

    // Stage-0 style checkpoint using early web deterministic hints:
    // when NPN was not extracted directly, still try LNHPD name match before deep fetch/LLM.
    if (LNHPD_RUNTIME_ENABLED && !stage0Delivered && !requestSignal.aborted) {
      const nameHintBrand = typeof provisionalBrand === "string" ? provisionalBrand.trim() : "";
      const nameHintProduct = typeof provisionalName === "string" ? provisionalName.trim() : "";
      if (nameHintBrand || nameHintProduct) {
        console.info("[ResolutionV2] Stage0 name-hint probe start", {
          barcode: barcodeGtin14,
          hintBrand: nameHintBrand || null,
          hintProduct: nameHintProduct || null,
        });
        try {
          let nameMatchedFacts: LnhpdFacts | null = null;
          const sourceTitleHints = buildNameHintsFromSourceTitles([
            ...sourcesToSend.map((item) => item?.title ?? null),
            ...initialItems.map((item) => item?.title ?? null),
          ]);
          const lowConfidenceBrand = extraction?.confidence !== "high";
          const brandLooksGeneric = nameHintBrand.length > 0 && GENERIC_BRAND_HINT_REGEX.test(nameHintBrand);
          const shouldRetryBrandless =
            CA_NAME_HINT_BRANDLESS_RETRY &&
            isCaRegion &&
            nameHintBrand.length > 0 &&
            nameHintProduct.length > 0 &&
            (lowConfidenceBrand || brandLooksGeneric);
          const probeAttempts: Array<{
            brand: string | null;
            product: string | null;
            reason: string;
            timeoutMs: number;
          }> = [{ brand: nameHintBrand || null, product: nameHintProduct || null, reason: "primary", timeoutMs: 1200 }];
          if (shouldRetryBrandless) {
            probeAttempts.push({
              brand: null,
              product: nameHintProduct || null,
              reason: "brandless_retry",
              timeoutMs: 900,
            });
          }
          for (const sourceTitleHint of sourceTitleHints) {
            if (!sourceTitleHint || sourceTitleHint === nameHintProduct) continue;
            probeAttempts.push({
              brand: null,
              product: sourceTitleHint,
              reason: "source_title_hint",
              timeoutMs: 900,
            });
          }
          const dedupedAttempts = probeAttempts.filter((attempt, index, all) => {
            const key = `${attempt.brand ?? ""}::${attempt.product ?? ""}`;
            return all.findIndex((candidate) => `${candidate.brand ?? ""}::${candidate.product ?? ""}` === key) === index;
          });
          let matchedAttemptReason: string | null = null;
          for (const attempt of dedupedAttempts) {
            if (requestSignal.aborted) break;
            const timeoutSignal = createTimeoutSignal(attempt.timeoutMs);
            const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
            try {
              const matched = await fetchLnhpdFactsByName(
                { brand: attempt.brand, product: attempt.product },
                signal,
              );
              if (matched) {
                nameMatchedFacts = matched;
                matchedAttemptReason = attempt.reason;
                break;
              }
            } finally {
              cleanup();
            }
          }
          if (nameMatchedFacts && matchedAttemptReason && matchedAttemptReason !== "primary") {
            console.info("[ResolutionV2] Stage0 name-hint probe recovered via fallback", {
              barcode: barcodeGtin14,
              reason: matchedAttemptReason,
              hintBrand: nameHintBrand || null,
              hintProduct: nameHintProduct || null,
              sourceTitleHints,
            });
          }

          const nameMatchedNpn = nameMatchedFacts?.npn?.replace(/\D/g, "").trim() ?? "";
          if (nameMatchedFacts && nameMatchedNpn.length >= 6) {
            console.info("[ResolutionV2] Stage0 name-hint probe hit", {
              barcode: barcodeGtin14,
              npn: nameMatchedNpn,
              productName: nameMatchedFacts.productName ?? null,
              brandName: nameMatchedFacts.brandName ?? null,
            });
            npnCandidateSource = "name_match";
            authorityCandidateSource = "name_match";
            npnCandidateStale = false;
            lnhpdFetchStatus = "success";
            authorityFailureReason = null;

            const nameMatchLabelFacts = toLabelFactsFromLnhpd(nameMatchedFacts);
            const labelExtraction: LabelExtractionMeta = {
              source: "lnhpd",
              fetchedAt: nameMatchedFacts.extractedAt ?? nowIso(),
              datasetVersion: nameMatchedFacts.datasetVersion ?? null,
            };
            const nameMatchProductInfo = {
              brand: nameMatchedFacts.brandName ?? provisionalBrand ?? null,
              name: nameMatchedFacts.productName ?? provisionalName ?? null,
              category: provisionalCategory ?? null,
              image: provisionalImage ?? null,
            };
            const labelAnalysis = buildLabelOnlyAnalysis(nameMatchLabelFacts);
            const nameMatchAnalysisPayload: SnapshotAnalysisPayload = {
              ...labelAnalysis,
              brandExtraction: {
                brand: nameMatchProductInfo.brand,
                product: nameMatchProductInfo.name,
                category: nameMatchProductInfo.category,
                confidence: "high",
                source: "rule",
              },
              productInfo: nameMatchProductInfo,
              sources: sourcesToSend,
            };

            let nameMatchSnapshot = buildBarcodeSnapshot({
              barcode,
              productInfo: nameMatchProductInfo,
              sources: initialItems,
              efficacy: nameMatchAnalysisPayload.efficacy ?? null,
              safety: nameMatchAnalysisPayload.safety ?? null,
              usagePayload: nameMatchAnalysisPayload.usagePayload ?? null,
            });
            nameMatchSnapshot = applyLnhpdFactsToSnapshot(nameMatchSnapshot, nameMatchedFacts);

            const nameMatchFactsSourceVersion = `lnhpd:${nameMatchedFacts.datasetVersion ?? nameMatchedFacts.extractedAt ?? "unknown"}`;
            const nameMatchDigest = buildFactsDigestFromLnhpd({
              facts: nameMatchedFacts,
              snapshot: nameMatchSnapshot,
              identityValue: nameMatchedNpn,
              regionTags: nameMatchSnapshot.regulatory.regionTags,
            });
            startStage0Bundle({
              digest: nameMatchDigest,
              identityType: "npn",
              identityValue: nameMatchedNpn,
              factsSourceVersion: nameMatchFactsSourceVersion,
              stage0Winner: "verified_regulatory",
              allowAi: false,
              apiKey: deepseekKey,
            });

            const analysisStatus = buildAnalysisStatus({
              hasLabelFacts: hasLabelFacts(nameMatchSnapshot),
              hasAi: hasAiPayload(nameMatchAnalysisPayload),
              dsldLabelId: null,
            });
            const analysisMeta = buildAnalysisMeta({
              status: analysisStatus,
              labelExtraction,
              overlayClaims: await getOverlayClaimsForBarcode(),
            });
            nameMatchAnalysisPayload.analysis = analysisMeta;
            nameMatchSnapshot.status = "resolved";
            nameMatchSnapshot.analysis = analysisMeta;
            nameMatchSnapshot.updatedAt = nowIso();

            if (stage1SseEnabled) {
              if (!brandExtractedSent) {
                sendSSE(res, "brand_extracted", {
                  brand: nameMatchProductInfo.brand,
                  product: nameMatchProductInfo.name,
                  category: nameMatchProductInfo.category,
                  confidence: "high",
                  source: "rule",
                });
                brandExtractedSent = true;
              }
              sendSSE(res, "product_info", { productInfo: nameMatchProductInfo, sources: sourcesToSend });
              if (!streamAnalysisBundleOnly) {
                sendSSE(res, "result_efficacy", nameMatchAnalysisPayload.efficacy);
                sendSSE(res, "result_safety", nameMatchAnalysisPayload.safety);
                sendSSE(res, "result_usage", nameMatchAnalysisPayload.usagePayload);
                sendSSE(res, "snapshot", nameMatchSnapshot);
              }
            }
            stage0Delivered = true;
            stage0Source = "lnhpd";

            const expiresAt = computeExpiresAt(analysisStatus);
            void storeSnapshotCache({
              key: cacheKey,
              source: "barcode",
              snapshot: nameMatchSnapshot,
              analysisPayload: nameMatchAnalysisPayload,
              expiresAt,
            });

            void upsertBarcodeRegulatoryMap({
              barcodeGtin14,
              npn: nameMatchedNpn,
              confidence: 0.9,
              source: "name_match",
              expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_LNHPD).toISOString(),
              barcodeRaw: rawBarcode,
            });

            if (aiAvailable && analysisStatus !== "complete" && analysisStatus !== "ai_enriched") {
              queueFirstPartyAnalysisCompletion({
                cacheKey,
                barcode,
                model,
                deepseekKey,
                snapshot: nameMatchSnapshot,
                analysisPayload: nameMatchAnalysisPayload,
                labelFacts: nameMatchLabelFacts,
              });
            }

            clearNegative();
            void clearNpnNegativeCache(nameMatchedNpn, { ...supabaseReadResilience, timeoutMs: 500 });
            if (!forceStage1) {
              await awaitStage0Bundle();
              finalizeStream("lnhpd_name_hint_stage0_complete");
              releaseInFlightOnce();
              return;
            }
            console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after LNHPD name-hint hit");
          }
        } catch (error) {
          console.warn("[ResolutionV2] Opportunistic LNHPD name-hint fetch failed", error);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Deep fetch (max 1-2 pages) + deterministic facts extraction.
    // -------------------------------------------------------------------------
    if (maybeDegradeForEventLoopLag()) {
      releaseInFlightOnce(new Error("degraded_eventloop"));
      return;
    }
    const selectedItems = deepCandidates.map((c) => c.item);
    const deepStart = performance.now();
    const contextSources = await prepareContextSources(selectedItems, contextResilience);
    timing.deep_fetch_ms = Math.round(performance.now() - deepStart);
    if (maybeDegradeForEventLoopLag()) {
      releaseInFlightOnce(new Error("degraded_eventloop"));
      return;
    }

    type ProductFacts = {
      barcode: string;
      canonical: {
        name?: string | null;
        brand?: string | null;
        url?: string | null;
        domain?: string | null;
        images?: string[] | null;
      };
      identifiers: {
        gtin?: string | null;
        gtinCandidates?: string[] | null;
        gtinMatches?: string[] | null;
        gtinMatch?: boolean;
        upcCandidates?: string[] | null;
        upcMatches?: string[] | null;
        upcMatch?: boolean;
        sku?: string | null;
        npn?: string | null;
        identityConflict?: boolean;
      };
      textFacts: {
        ingredientsText?: string | null;
        directionsText?: string | null;
        warningsText?: string | null;
        servingSizeText?: string | null;
      };
      provenance: {
        fieldSources: Record<
          string,
          Array<{ url: string; method: "jsonld" | "meta" | "dom" | "snippet"; confidence: number }>
        >;
      };
      coverageScore: number;
      missingFields: string[];
    };

    const extractSection = (text: string | null | undefined, patterns: RegExp[], maxChars = 600): string | null => {
      return profileWebParseStep("primary.extractSection", text, () => {
        if (!text) return null;
        const scanText = clampRegexScanWindow(text);
        for (const pattern of patterns) {
          const match = scanText.match(pattern);
          const value = match?.[1]?.trim();
          if (value) {
            const normalized = value.replace(/\s+/g, " ").trim();
            return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}…` : normalized;
          }
        }
        return null;
      }, { fallback: () => null });
    };

    const buildFactsFromCandidate = (candidate: {
      item: SearchItem;
      evidence: CheapEvidence;
      extractedText: string | null;
    }): ProductFacts => {
      const url = candidate.evidence.url || candidate.item.link;
      const domain = candidate.evidence.domain || extractDomain(url);
      const jsonld = candidate.evidence.jsonLd;
      const metaTitle = candidate.evidence.meta.ogTitle;
      const metaBrand = candidate.evidence.meta.ogBrand;
      const extractedText = candidate.extractedText ?? null;

      const npnFromExtracted = extractNpnFromText(extractedText ?? "");
      const npnValue = candidate.evidence.npnCandidate ?? npnFromExtracted;

      const explicitGtinCandidatesSet = new Set<string>(
        extractGtinCandidatesFromText(extractedText ?? ""),
      );
      if (jsonld.gtin) {
        explicitGtinCandidatesSet.add(jsonld.gtin);
      }
      const explicitGtinCandidates = Array.from(explicitGtinCandidatesSet);
      const explicitGtinMatches = explicitGtinCandidates.filter((value) => barcodeVariants.includes(value));
      const explicitUpcCandidates = explicitGtinCandidates.filter((value) => value.length === 12);
      const explicitUpcMatches = scanUpc12
        ? explicitUpcCandidates.filter((value) => value === scanUpc12)
        : [];
      const gtinMatch = Boolean(jsonld.gtinMatch || explicitGtinMatches.length > 0);
      const upcMatch = Boolean(explicitUpcMatches.length > 0);
      const identityConflict = explicitGtinCandidates.length > 0 && explicitGtinMatches.length === 0;

      const ingredientsText = extractSection(extractedText, [
        /\b(?:ingredients|other ingredients|medicinal ingredients|non-?medicinal ingredients)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
      ]);
      const directionsText = extractSection(extractedText, [
        /\b(?:directions|suggested use|dosage)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
      ]);
      const warningsText = extractSection(extractedText, [
        /\b(?:warning|warnings|caution|contraindications)\b\s*[:\-]?\s*([\s\S]{20,800}?)/i,
      ]);
      const servingSizeText = extractSection(extractedText, [
        /\b(?:serving size|amount per serving)\b\s*[:\-]?\s*([\s\S]{10,200}?)/i,
      ], 200);

      const fieldSources: ProductFacts["provenance"]["fieldSources"] = {};
      const addSource = (
        field: string,
        method: "jsonld" | "meta" | "dom" | "snippet",
        confidence: number,
      ) => {
        if (!fieldSources[field]) fieldSources[field] = [];
        fieldSources[field].push({ url, method, confidence });
      };

      const name = jsonld.name ?? metaTitle ?? provisionalName ?? null;
      if (jsonld.name) addSource("canonical.name", "jsonld", 0.9);
      else if (metaTitle) addSource("canonical.name", "meta", 0.6);
      else if (provisionalName) addSource("canonical.name", "snippet", 0.4);

      const brand = jsonld.brand ?? metaBrand ?? provisionalBrand ?? null;
      if (jsonld.brand) addSource("canonical.brand", "jsonld", 0.85);
      else if (metaBrand) addSource("canonical.brand", "meta", 0.6);
      else if (provisionalBrand) addSource("canonical.brand", "snippet", 0.4);

      if (ingredientsText) addSource("textFacts.ingredientsText", "dom", 0.75);
      if (directionsText) addSource("textFacts.directionsText", "dom", 0.7);
      if (warningsText) addSource("textFacts.warningsText", "dom", 0.7);
      if (servingSizeText) addSource("textFacts.servingSizeText", "dom", 0.65);

      const facts: ProductFacts = {
        barcode: barcodeGtin14,
        canonical: {
          name,
          brand,
          url,
          domain,
          images: jsonld.images?.length ? jsonld.images : null,
        },
        identifiers: {
          gtin: jsonld.gtin ?? null,
          gtinCandidates: explicitGtinCandidates.length ? explicitGtinCandidates : null,
          gtinMatches: explicitGtinMatches.length ? explicitGtinMatches : null,
          gtinMatch,
          upcCandidates: explicitUpcCandidates.length ? explicitUpcCandidates : null,
          upcMatches: explicitUpcMatches.length ? explicitUpcMatches : null,
          upcMatch,
          sku: jsonld.sku ?? null,
          npn: npnValue ?? null,
          identityConflict,
        },
        textFacts: {
          ingredientsText,
          directionsText,
          warningsText,
          servingSizeText,
        },
        provenance: { fieldSources },
        coverageScore: 0,
        missingFields: [],
      };

      const weights = {
        nameBrandUrl: 0.35,
        ingredients: 0.25,
        directions: 0.15,
        warnings: 0.15,
        serving: 0.1,
      };
      let score = 0;
      if (facts.canonical.name || facts.canonical.brand || facts.canonical.url) score += weights.nameBrandUrl;
      if (facts.textFacts.ingredientsText) score += weights.ingredients;
      if (facts.textFacts.directionsText) score += weights.directions;
      if (facts.textFacts.warningsText) score += weights.warnings;
      if (facts.textFacts.servingSizeText) score += weights.serving;

      facts.coverageScore = Math.round(score * 100) / 100;

      const missing: string[] = [];
      if (!facts.canonical.name) missing.push("canonical.name");
      if (!facts.canonical.brand) missing.push("canonical.brand");
      if (!facts.textFacts.ingredientsText) missing.push("textFacts.ingredientsText");
      if (!facts.textFacts.directionsText) missing.push("textFacts.directionsText");
      if (!facts.textFacts.warningsText) missing.push("textFacts.warningsText");
      if (!facts.textFacts.servingSizeText) missing.push("textFacts.servingSizeText");
      facts.missingFields = missing;

      return facts;
    };

    const byUrl = new Map<string, string | null>();
    for (const src of contextSources) {
      byUrl.set(canonicalizeUrl(src.link), src.extractedText ?? null);
    }

    const factsCandidates = deepCandidates.map((candidate) => ({
      item: candidate.item,
      evidence: candidate.evidence,
      extractedText: byUrl.get(canonicalizeUrl(candidate.item.link)) ?? null,
    }));

    const factsList = factsCandidates.map(buildFactsFromCandidate);
    const nonConflictFacts = factsList.filter((facts) => !facts.identifiers.identityConflict);
    const rankedFacts = (nonConflictFacts.length ? nonConflictFacts : factsList).sort(
      (a, b) => (b.coverageScore ?? 0) - (a.coverageScore ?? 0),
    );
    const bestFacts = rankedFacts[0] ?? null;
    const bestFactsIndex = bestFacts ? factsList.indexOf(bestFacts) : -1;
    const bestCandidate = bestFactsIndex >= 0 ? factsCandidates[bestFactsIndex] : null;
    if (!bestFacts || bestFacts.coverageScore < RESOLUTION_FACTS_MIN_COVERAGE) {
      markPipelineStepEnd("select_evidence", "failed", "no_text_facts");
      const anyExtractedText = factsCandidates.some(
        (candidate) => typeof candidate.extractedText === "string" && candidate.extractedText.trim().length > 0,
      );
      const reasonCode = anyExtractedText
        ? "NO_TEXT_FACTS"
        : budget.isExpired()
          ? "BUDGET_EXHAUSTED"
          : "TIMEOUT";
      const fallbackUsed = await runSerpFallback(reasonCode, {
        stage: "facts",
        coverageScores: factsList.map((f) => f.coverageScore),
        anyExtractedText,
      });
      if (fallbackUsed) return;

      try {
        await writeNegative(reasonCode);
      } catch { }
      insertTrainingRow({
        outcome: reasonCode,
        profilesUsed,
        serpTopk,
        selectedUrl: deepCandidates[0]?.evidence.url ?? null,
        selectedDomain: deepCandidates[0]?.evidence.domain ?? null,
        signals: {
          stage: "facts",
          coverageScores: factsList.map((f) => f.coverageScore),
          anyExtractedText,
          deepseek_bundle_skipped_reason: "no_text_facts",
        },
      });
      if (!shouldSuppressStage1Error()) {
        emitProductNotFoundAndFinalize({
          stage: "facts",
          reasonCode,
        });
      } else {
        finalizeStream("stage1_not_found_suppressed");
      }
      releaseInFlightOnce(new Error("no_text_facts"));
      return;
    }
    markPipelineStepEnd("select_evidence", "ok");

    if (bestFacts.identifiers.npn) {
      npnCandidateSource = "web";
      npnCandidateStale = false;
      void upsertBarcodeRegulatoryMap({
        barcodeGtin14,
        npn: bestFacts.identifiers.npn,
        confidence: 0.8,
        source: "web_npn",
        expiresAt: new Date(Date.now() + REGULATORY_MAP_TTL_MS_WEB).toISOString(),
        barcodeRaw: rawBarcode,
      });
    }

    const providerResult = await resolveIdentityProviderLookup(barcodeGtin14, {
      enabled: WEB_IDENTITY_PROVIDER_ENABLED,
      order: WEB_IDENTITY_PROVIDER_ORDER,
      timeoutMs: WEB_IDENTITY_PROVIDER_TIMEOUT_MS,
      upcItemDbApiKey: UPCITEMDB_API_KEY,
    });
    providerUsed = providerResult?.provider ?? null;
    providerGtinMatch = Boolean(providerResult?.gtinMatched);

    const providerOwnership = buildProviderVerdict(
      {
        hasBarcodeMatch: Boolean(bestFacts.identifiers.gtinMatch || bestFacts.identifiers.upcMatch),
        hasRegulatoryIdMatch: Boolean(bestFacts.identifiers.npn),
        hasBrandSignal: Boolean(bestFacts.canonical.brand),
        hasNameSignal: Boolean(bestFacts.canonical.name),
        providerGtinMatch,
      },
      providerResult,
    );
    ownershipVerdict = providerOwnership.ownershipVerdict;

    let identityStrong = Boolean(
      bestFacts.identifiers.npn ||
      bestFacts.identifiers.gtinMatch ||
      bestFacts.identifiers.upcMatch ||
      providerGtinMatch,
    );
    const identityConflict = Boolean(bestFacts.identifiers.identityConflict);
    const explicitGtinMatches = bestFacts.identifiers.gtinMatches ?? [];
    const explicitUpcMatches = bestFacts.identifiers.upcMatches ?? [];
    const npnFound = Boolean(bestFacts.identifiers.npn);

    const dosageRegex = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|iu|i\.u\.)\b/i;
    const dosageKeywordRegexGlobal = /\b(vitamin\s*c|ascorbate|ester-?c|ascorbic)\b/gi;
    const hasDosageNearKeyword = (text: string | null | undefined): boolean => {
      if (!text) return false;
      let match: RegExpExecArray | null = null;
      dosageKeywordRegexGlobal.lastIndex = 0;
      while ((match = dosageKeywordRegexGlobal.exec(text)) !== null) {
        const start = Math.max(0, match.index - 60);
        const end = Math.min(text.length, match.index + match[0].length + 60);
        const windowText = text.slice(start, end);
        if (dosageRegex.test(windowText)) return true;
      }
      return false;
    };

    const hasDosageInServing = Boolean(
      bestFacts.textFacts.servingSizeText && dosageRegex.test(bestFacts.textFacts.servingSizeText),
    );
    const hasDosageKeywordWindow = [
      bestFacts.textFacts.ingredientsText,
      bestFacts.textFacts.directionsText,
      bestFacts.textFacts.warningsText,
      bestFacts.textFacts.servingSizeText,
    ].some((text) => hasDosageNearKeyword(text));

    const factsHasDosage = Boolean(hasDosageInServing || hasDosageKeywordWindow);
    const factsHasBrand = Boolean(bestFacts.canonical.brand);
    const hasAuthoritativeDomain = isCaRegion
      ? sourcesToSend.some((source) => isAuthoritativeCaDomain(source.domain))
      : true;
    const noAuthoritativeDomain = isCaRegion && !hasAuthoritativeDomain;

    const needsAuthoritativeReasons: string[] = [];
    if (!factsHasBrand || !factsHasDosage) needsAuthoritativeReasons.push("missing_brand_or_dosage");
    if (!identityStrong) needsAuthoritativeReasons.push("missing_authoritative_identity");
    if (bestFacts.coverageScore < RESOLUTION_FACTS_MIN_COVERAGE) needsAuthoritativeReasons.push("low_coverage");
    if (noAuthoritativeDomain) needsAuthoritativeReasons.push("no_authoritative_domain");
    const needsAuthoritativeBackfill = isCaRegion && needsAuthoritativeReasons.length > 0;

    const canonicalDomain = bestFacts.canonical.domain ?? null;
    const isAmazonCanonical = isAmazonDomain(canonicalDomain);
    const amazonCanonicalExceptionUsed =
      isAmazonCanonical && identityStrong && bestFacts.coverageScore >= RESOLUTION_FACTS_MIN_COVERAGE;
    const allowCanonical =
      identityStrong &&
      !identityConflict &&
      ownershipVerdict === "strong" &&
      (!isAmazonCanonical || amazonCanonicalExceptionUsed);

    const canonicalSourceDomain = allowCanonical ? canonicalDomain : null;
    const canonicalSourceUrl = allowCanonical ? bestFacts.canonical.url ?? null : null;

    const finalProductInfo = {
      brand: allowCanonical
        ? bestFacts.canonical.brand ?? providerOwnership.providerBrand ?? provisionalBrand ?? null
        : providerOwnership.providerBrand ?? provisionalBrand ?? null,
      name: allowCanonical
        ? bestFacts.canonical.name ?? providerOwnership.providerProductName ?? provisionalName ?? null
        : providerOwnership.providerProductName ?? provisionalName ?? null,
      category: provisionalCategory ?? null,
      image: allowCanonical
        ? provisionalImage ?? bestFacts.canonical.images?.[0] ?? null
        : provisionalImage ?? null,
    };

    let factsForAnalysis = allowCanonical
      ? bestFacts
      : {
        ...bestFacts,
        canonical: {
          ...bestFacts.canonical,
          brand: finalProductInfo.brand ?? null,
          name: finalProductInfo.name ?? null,
          url: null,
          domain: null,
        },
      };

    if (ownershipVerdict !== "strong") {
      identityStrong = false;
      factsForAnalysis = {
        ...factsForAnalysis,
        textFacts: {
          ingredientsText: null,
          directionsText: null,
          warningsText: null,
          servingSizeText: null,
        },
        coverageScore: 0,
        missingFields: [
          "textFacts.ingredientsText",
          "textFacts.directionsText",
          "textFacts.warningsText",
          "textFacts.servingSizeText",
        ],
      };
    }
    markPipelineStepStart("sanitize");
    const sanitizeField = (value: string | null | undefined, maxChars: number) => {
      if (!value || !value.trim()) {
        return { text: null, redactions: [] as string[], injectionDetected: false };
      }
      const sanitized = sanitizeWebText(value, { maxChars });
      return {
        text: sanitized.text || null,
        redactions: sanitized.redactions,
        injectionDetected: sanitized.injectionDetected,
      };
    };
    const sanitizedIngredients = sanitizeField(factsForAnalysis.textFacts?.ingredientsText ?? null, 1200);
    const sanitizedDirections = sanitizeField(factsForAnalysis.textFacts?.directionsText ?? null, 900);
    const sanitizedWarnings = sanitizeField(factsForAnalysis.textFacts?.warningsText ?? null, 900);
    const sanitizedServing = sanitizeField(factsForAnalysis.textFacts?.servingSizeText ?? null, 300);
    const sanitizeRedactions = [
      ...sanitizedIngredients.redactions,
      ...sanitizedDirections.redactions,
      ...sanitizedWarnings.redactions,
      ...sanitizedServing.redactions,
    ];
    const sanitizeInjected =
      sanitizedIngredients.injectionDetected ||
      sanitizedDirections.injectionDetected ||
      sanitizedWarnings.injectionDetected ||
      sanitizedServing.injectionDetected;
    factsForAnalysis = {
      ...factsForAnalysis,
      textFacts: {
        ...factsForAnalysis.textFacts,
        ingredientsText: sanitizedIngredients.text,
        directionsText: sanitizedDirections.text,
        warningsText: sanitizedWarnings.text,
        servingSizeText: sanitizedServing.text,
      },
    };
    const hasSanitizedEvidence = Boolean(
      factsForAnalysis.textFacts?.ingredientsText ||
      factsForAnalysis.textFacts?.directionsText ||
      factsForAnalysis.textFacts?.warningsText ||
      factsForAnalysis.textFacts?.servingSizeText,
    );
    const ownershipProtected = ownershipVerdict !== "strong";
    const sanitizeStatus: PipelineStepStatus = hasSanitizedEvidence ? "ok" : "failed";
    const sanitizeFailureCode = ownershipProtected
      ? "ownership_unverified"
      : sanitizeRedactions.length > 0 || sanitizeInjected
        ? "web_sanitize_failed"
        : "web_text_unusable";
    markPipelineStepEnd("sanitize", sanitizeStatus, hasSanitizedEvidence ? undefined : sanitizeFailureCode);

    // Update product info with higher-confidence facts (if any).
    if (stage1SseEnabled && !brandExtractedSent && (finalProductInfo.brand || finalProductInfo.name)) {
      sendSSE(res, "brand_extracted", {
        brand: finalProductInfo.brand,
        product: finalProductInfo.name,
        category: finalProductInfo.category,
        confidence: "medium",
        source: "rule",
      });
      brandExtractedSent = true;
    }
    if (stage1SseEnabled) {
      sendSSE(res, "product_info", {
        productInfo: finalProductInfo,
        sources: sourcesToSend,
        sourceQuality: marketplaceOnly ? "marketplace_only" : "mixed",
      });
    }

    const evidenceSnippets = contextSources
      .map((source) => source.extractedText)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .flatMap((text) => {
        const trimmed = text.trim();
        const cropped = trimmed.length <= 500 ? trimmed : trimmed.slice(0, 500).trim();
        const sanitized = sanitizeWebText(cropped, { maxChars: 500 });
        return sanitized.text ? [sanitized.text] : [];
      })
      .slice(0, 4);

    const analysisContext = `Return json only.
PRODUCT_FACTS_JSON: ${JSON.stringify(factsForAnalysis)}
EVIDENCE_SNIPPETS_JSON: ${JSON.stringify(evidenceSnippets)}
`;

    let mainDeepseekBundleSkippedReason: string | null = null;
    const llmStart = performance.now();
    let bundle: Awaited<ReturnType<typeof fetchAnalysisBundle>> | null = null;
    const llmTimeoutMs = deepseekResilience.timeoutMs ?? llmInteractiveTimeoutMs;
    const llmBudgetMs = budget.msFor(llmTimeoutMs);
    const canRunLlm = !marketplaceOnly && llmBudgetMs > 0 && hasSanitizedEvidence;
    if (marketplaceOnly) {
      mainDeepseekBundleSkippedReason = "marketplace_only";
    } else if (ownershipProtected) {
      mainDeepseekBundleSkippedReason = "ownership_unverified";
    } else if (!hasSanitizedEvidence) {
      mainDeepseekBundleSkippedReason = sanitizeRedactions.length > 0 || sanitizeInjected
        ? "web_sanitize_failed"
        : "web_text_unusable";
    } else if (llmBudgetMs <= 0) {
      mainDeepseekBundleSkippedReason = "budget_reserved";
    }

    if (canRunLlm) {
      markPipelineStepStart("draft");
      try {
        calls.deepseek_bundle += 1;
        bundle = await fetchAnalysisBundle(analysisContext, model, deepseekKey, deepseekResilience);
        if ((bundle as any)?._meta?.repairUsed) {
          calls.deepseek_repair += 1;
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn("[ResolutionV2] analysis bundle failed", error);
        }
      } finally {
        markPipelineStepEnd("draft", bundle ? "ok" : "degraded", bundle ? undefined : "fast_generation_failed");
      }
      timing.llm_ms = Math.round(performance.now() - llmStart);
      if (!bundle) {
        mainDeepseekBundleSkippedReason =
          timing.llm_ms >= Math.max(200, llmTimeoutMs - 50) ? "llm_timeout" : "llm_failed";
      }
    } else {
      markPipelineStepEnd("draft", "degraded", mainDeepseekBundleSkippedReason ?? "fast_generation_skipped");
      timing.llm_ms = 0;
    }

    if (bundle) {
      incrementMetric("deepseek_bundle_success");
    } else if (!requestSignal.aborted) {
      incrementMetric("deepseek_bundle_fail_degraded");
    }

    const llmFallback = bundle
      ? null
      : buildLowConfidenceAnalysis({
        brand: finalProductInfo.brand,
        name: finalProductInfo.name,
        note: marketplaceOnly
          ? "Marketplace-only analysis; no verified sources."
          : "Analysis pending; limited verified data.",
      });
    const efficacyToSend = mergeEfficacyWithFallback(bundle?.efficacy ?? null, llmFallback?.efficacy ?? null);
    const safetyToSend = mergeSafetyWithFallback(bundle?.safety ?? null, llmFallback?.safety ?? null);
    const usageToSend = mergeUsagePayloadWithFallback(bundle?.usagePayload ?? null, llmFallback?.usagePayload ?? null);

    if (stage1SseEnabled && !streamAnalysisBundleOnly && !requestSignal.aborted && !res.writableEnded) {
      if (efficacyToSend) sendSSE(res, "result_efficacy", efficacyToSend);
      if (safetyToSend) sendSSE(res, "result_safety", safetyToSend);
      if (usageToSend) sendSSE(res, "result_usage", usageToSend);
    }

    const analysisPayload: SnapshotAnalysisPayload = {
      brandExtraction: {
        brand: finalProductInfo.brand,
        product: finalProductInfo.name,
        category: finalProductInfo.category,
        confidence: extraction?.confidence ?? "low",
        source: "rule",
      },
      productInfo: finalProductInfo,
      sources: sourcesToSend,
      efficacy: efficacyToSend,
      safety: safetyToSend,
      usagePayload: usageToSend,
    };

    const snapshotCandidate = buildBarcodeSnapshot({
      barcode,
      productInfo: analysisPayload.productInfo ?? null,
      sources: initialItems.length ? initialItems : selectedItems,
      efficacy: efficacyToSend ?? null,
      safety: safetyToSend ?? null,
      usagePayload: usageToSend ?? null,
    });

    const snapshot = validateSnapshotOrFallback({
      candidate: snapshotCandidate,
      fallback: {
        source: "barcode",
        barcodeRaw: rawBarcode,
        productInfo: {
          brand: finalProductInfo.brand,
          name: finalProductInfo.name,
          category: finalProductInfo.category,
          imageUrl: finalProductInfo.image,
        },
        createdAt: snapshotCandidate.createdAt,
      },
    });

    const analysisStatus = buildAnalysisStatus({
      hasLabelFacts: hasLabelFacts(snapshot),
      hasAi: hasAiPayload(analysisPayload),
      dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
    });
    const analysisMeta = buildAnalysisMeta({
      status: analysisStatus,
      labelExtraction: analysisPayload.analysis?.labelExtraction ?? null,
      overlayClaims: await getOverlayClaimsForBarcode(),
    });
    analysisPayload.analysis = analysisMeta;
    snapshot.analysis = analysisMeta;
    snapshot.updatedAt = nowIso();


    const expiresAt = computeExpiresAt(analysisStatus);

    // Best URL caching: only on strongMatch (hard rule).
    const bestEvidence = bestCandidate?.evidence ?? deepCandidates[0]?.evidence ?? null;
    const canonicalMap = await getWebCanonicalMap(
      { barcodeGtin14, engineVersion: RESOLUTION_ENGINE_VERSION },
      { ...supabaseReadResilience, timeoutMs: 500 },
    ).catch(() => null);
    const canonicalUrls =
      canonicalMap?.canonical_urls ??
      (selectedItems.length ? selectedItems : initialItems).map((item) => item.link).slice(0, 3);
    const canonicalHash =
      canonicalMap?.canonical_hash ?? createHash("sha256").update(canonicalUrls.join("|")).digest("hex");
    const canonicalBestUrl = canonicalMap?.best_url ?? bestEvidence?.url ?? canonicalUrls[0] ?? null;
    if (!canonicalMap && canonicalUrls.length > 0) {
      void upsertWebCanonicalMap(
        {
          barcodeGtin14,
          engineVersion: RESOLUTION_ENGINE_VERSION,
          canonicalUrls,
          canonicalHash,
          bestUrl: canonicalBestUrl,
          expiresAt: new Date(Date.now() + WEB_CANONICAL_TTL_MS).toISOString(),
        },
        { ...supabaseReadResilience, timeoutMs: 700 },
      );
    }
    if (
      bestEvidence?.strongMatch &&
      !marketplaceOnly &&
      !identityConflict &&
      allowCanonical
    ) {
      void upsertResolutionCacheStrongMatch(
        {
          barcodeGtin14,
          engineVersion: RESOLUTION_ENGINE_VERSION,
          bestUrl: bestEvidence.url,
          bestDomain: bestEvidence.domain,
          signals: {
            jsonLdGtinMatch: bestEvidence.jsonLdGtinMatch,
            hasProductJsonLd: bestEvidence.hasProductJsonLd,
            barcodeHitCount: bestEvidence.barcodeHitCount,
            needsJs: bestEvidence.needsJs,
            onlyImages: bestEvidence.onlyImages,
          },
          confidence: bestEvidence.jsonLdGtinMatch ? 0.95 : 0.8,
          expiresAt: new Date(Date.now() + RESOLUTION_RESOLUTION_CACHE_TTL_MS).toISOString(),
        },
        { ...supabaseReadResilience, timeoutMs: 700 },
      );
    }

    const webFactsSourceVersion = `web:${RESOLUTION_ENGINE_VERSION}:${canonicalHash}`;
    const webCanonicalId = canonicalBestUrl
      ? createHash("sha256").update(`${canonicalBestUrl}|${RESOLUTION_ENGINE_VERSION}|${barcodeGtin14}`).digest("hex")
      : barcodeGtin14;
    const webIdentityType = canonicalBestUrl ? "webCanonicalId" : "gtin14";

    const webFactsInput = {
      barcode: barcodeGtin14,
      canonical: {
        name: factsForAnalysis.canonical?.name ?? null,
        brand: factsForAnalysis.canonical?.brand ?? null,
        url: factsForAnalysis.canonical?.url ?? null,
        domain: factsForAnalysis.canonical?.domain ?? null,
      },
      identifiers: { npn: factsForAnalysis.identifiers?.npn ?? null },
      textFacts: {
        ingredientsText: factsForAnalysis.textFacts?.ingredientsText ?? null,
        directionsText: factsForAnalysis.textFacts?.directionsText ?? null,
        warningsText: factsForAnalysis.textFacts?.warningsText ?? null,
        servingSizeText: factsForAnalysis.textFacts?.servingSizeText ?? null,
      },
      coverageScore: factsForAnalysis.coverageScore ?? 0,
      missingFields: factsForAnalysis.missingFields ?? [],
    };
    const webDigest = buildFactsDigestFromWeb({
      facts: webFactsInput,
      snapshot,
      identityType: webIdentityType,
      identityValue: webCanonicalId,
      regionTags: snapshot.regulatory.regionTags,
    });
    startStage1Bundle({
      digest: webDigest,
      identityType: webIdentityType,
      identityValue: webCanonicalId,
      factsSourceVersion: webFactsSourceVersion,
      allowAi: Boolean(deepseekKey),
      apiKey: deepseekKey,
    });

    if (stage1SnapshotWriteEnabled) {
      void storeSnapshotCache({
        key: cacheKey,
        source: "barcode",
        snapshot,
        analysisPayload,
        expiresAt,
      });
    }

    const mainBackfillReason = mainDeepseekBundleSkippedReason ?? (!bundle ? "llm_failed" : null);
    const allowBackgroundBackfill =
      !degradedMode &&
      !budgetGuardTriggered &&
      !streamState.doneSent &&
      !streamState.ended;
    const shouldQueueMainBackfill =
      WEB_BACKGROUND_BACKFILL_ENABLE &&
      allowBackgroundBackfill &&
      !streamAnalysisBundleOnly &&
      aiAvailable &&
      !bundle &&
      Boolean(mainBackfillReason) &&
      (!marketplaceOnly || marketplaceLlmEnabled);
    if (shouldQueueMainBackfill) {
      const queued = queueBarcodeAnalysisCompletion({
        cacheKey,
        barcode,
        detailItems: selectedItems,
        analysisContext,
        analysisPayload,
        snapshot,
        model,
        deepseekKey,
        training: {
          barcodeGtin14,
          stage0Outcome,
          parentOutcome: "success_extract",
          deepseekBundleSkippedReason: mainBackfillReason,
          profilesUsed,
          serpTopk,
          selectedUrl: bestEvidence?.url ?? null,
          selectedDomain: bestEvidence?.domain ?? null,
          cacheHits: { ...cacheHits },
          calls: { ...calls },
          signals: bestEvidence
            ? {
              ...baseSignals,
              strongMatch: bestEvidence.strongMatch,
              jsonLdGtinMatch: bestEvidence.jsonLdGtinMatch,
              hasProductJsonLd: bestEvidence.hasProductJsonLd,
              barcodeHitCount: bestEvidence.barcodeHitCount,
              needsJs: bestEvidence.needsJs,
              onlyImages: bestEvidence.onlyImages,
              marketplaceOnly,
            }
            : { ...baseSignals, marketplaceOnly },
        },
      });
      backgroundBackfillQueued = backgroundBackfillQueued || queued;
    }

    const shouldSecondaryBackfill =
      WEB_BACKGROUND_BACKFILL_ENABLE &&
      allowBackgroundBackfill &&
      !streamAnalysisBundleOnly &&
      (needsAuthoritativeBackfill || (!isCaRegion && marketplaceOnly));
    if (shouldSecondaryBackfill) {
      const secondaryQueued = queueMarketplaceSecondaryBackfill({
        seedItems: initialItems,
        marketplaceOnly,
        extraction,
        parentOutcome: marketplaceOnly ? "SUCCESS_MARKETPLACE_ONLY" : "success_extract",
        deepseekBundleSkippedReason: mainDeepseekBundleSkippedReason,
        needsAuthoritativeBackfill,
        needsAuthoritativeReasons,
        identityStrong,
        identityConflict,
        explicitGtinMatches,
        explicitUpcMatches,
        npnFound,
        amazonCanonicalExceptionUsed,
        noAuthoritativeDomain,
        canonicalSourceDomain,
        canonicalSourceUrl,
      });
      secondaryBackfillQueued = secondaryBackfillQueued || secondaryQueued;
    }

    insertTrainingRow({
      outcome: "success_extract",
      profilesUsed,
      serpTopk,
      selectedUrl: bestEvidence?.url ?? null,
      selectedDomain: bestEvidence?.domain ?? null,
      signals: bestEvidence
        ? {
          strongMatch: bestEvidence.strongMatch,
          jsonLdGtinMatch: bestEvidence.jsonLdGtinMatch,
          hasProductJsonLd: bestEvidence.hasProductJsonLd,
          barcodeHitCount: bestEvidence.barcodeHitCount,
          needsJs: bestEvidence.needsJs,
          onlyImages: bestEvidence.onlyImages,
          identity_strong: identityStrong,
          identity_conflict: identityConflict,
          explicit_gtin_matches: explicitGtinMatches,
          explicit_upc_matches: explicitUpcMatches,
          npn_found: npnFound,
          needs_authoritative_backfill: needsAuthoritativeBackfill,
          needs_authoritative_reasons: needsAuthoritativeReasons,
          amazon_canonical_exception_used: amazonCanonicalExceptionUsed,
          no_authoritative_domain: noAuthoritativeDomain,
          canonical_source_domain: canonicalSourceDomain,
          canonical_source_url: canonicalSourceUrl,
          deepseek_bundle_skipped_reason: mainDeepseekBundleSkippedReason,
          background_backfill_started: backgroundBackfillQueued,
        }
        : {
          identity_strong: identityStrong,
          identity_conflict: identityConflict,
          explicit_gtin_matches: explicitGtinMatches,
          explicit_upc_matches: explicitUpcMatches,
          npn_found: npnFound,
          needs_authoritative_backfill: needsAuthoritativeBackfill,
          needs_authoritative_reasons: needsAuthoritativeReasons,
          amazon_canonical_exception_used: amazonCanonicalExceptionUsed,
          no_authoritative_domain: noAuthoritativeDomain,
          canonical_source_domain: canonicalSourceDomain,
          canonical_source_url: canonicalSourceUrl,
          deepseek_bundle_skipped_reason: mainDeepseekBundleSkippedReason,
          background_backfill_started: backgroundBackfillQueued,
        },
      factsSummary: {
        missingFields: bestFacts.missingFields,
        canonical: factsForAnalysis.canonical,
        identifiers: factsForAnalysis.identifiers,
      },
      factsCoverage: bestFacts.coverageScore,
    });

    clearNegative();

    const canRespond = !streamState.clientDisconnected && !res.writableEnded;
    if (canRespond) {
      await awaitAnalysisBundle();
      if (!streamState.clientDisconnected && !res.writableEnded) {
        if (stage1SseEnabled && !streamAnalysisBundleOnly) {
          sendSSE(res, "snapshot", snapshot);
        }
        finalizeStream("success_complete");
      }
    }

    releaseInFlightOnce();

    const timingTotalMs = Math.round(performance.now() - startedAt);
    void logBarcodeScan({
      barcodeGtin14,
      barcodeRaw: rawBarcode,
      checksumValid: normalized.isValidChecksum ?? null,
      catalogHit: false,
      servedFrom: "resolution_engine_v2",
      snapshotId: snapshot.snapshotId,
      brandName: snapshot.product.brand ?? null,
      productName: snapshot.product.name ?? null,
      deviceId,
      requestId,
      timingTotalMs,
      meta: buildAuthorityMeta({
        stage0Outcome,
        profilesUsed,
        serpTopk,
        cacheHits,
        calls,
        ownership_verdict: ownershipVerdict,
        marketplace_rejected_count: marketplaceRejectedCount,
        provider_used: providerUsed,
        provider_gtin_match: providerGtinMatch,
        deepseek_bundle_skipped_reason: mainDeepseekBundleSkippedReason,
        timing: {
          ...timing,
          stage0_ms: Math.round(stage1Start - startedAt),
          stage1_ms: Math.round(performance.now() - stage1Start),
        },
      }),
    });

    if (STREAM_VERBOSE_LOG_ENABLED) {
      console.log(`[Stream] All analysis complete for barcode: ${barcode}`);
    }

  } catch (error: unknown) {
    releaseInFlightOnce(error);
    captureException(error, { route: "/api/enrich-stream" });
    console.error("Stream Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!res.writableEnded) {
      emitTerminalErrorAndFinalize({
        message,
        finalizeReason: "stream_error",
      });
    }
  }
  });
};
