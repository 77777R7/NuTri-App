import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import {
  IngredientsDetailSchema,
  UsageFieldSchema,
  type AnalysisBundle,
  type BasisTag,
  type IngredientsDetail,
} from "../analysisBundle.js";
import type { FactsDigest } from "../factsDigest.js";
import { resolveDeepSeekModel } from "../deepseekConfig.js";
import type { ErrorResponse } from "../types.js";

type ParseRequestBody = <T>(schema: z.ZodType<T>, req: Request, res: Response) => T | null;

type AnyFn = (...args: any[]) => any;

type AnalysisSectionRouteConfig = {
  analysisDetailLimitDefault: number;
  analysisDetailLimitMax: number;
  analysisDetailLimitDsld: number;
  analysisSectionDigestLookupTimeoutMs: number;
  analysisDetailStaleMs: number;
  analysisDetailErrorRetryMs: number;
  analysisSectionRateLimitPerMinute: number;
  analysisDetailLockMs: number;
  analysisIdentityCacheTtlMs: number;
  analysisDetailFallbackTtlMs: number;
  analysisBundleDetailTimeoutMs: number;
  analysisBundleDetailTimeoutMsDsld: number;
  analysisDetailMaxTokens: number;
  analysisDetailMaxTokensDsld: number;
  analysisDetailRescueMaxTokens: number;
  analysisDetailRescueMaxTokensDsld: number;
  analysisDetailLimitRescue: number;
  resilienceDeepseekDsldMinQueueTimeoutMs: number;
  resilienceDeepseekQueueTimeoutMsDetail: number;
};

export type AnalysisSectionRouteDependencies = {
  verifySupabaseToken: RequestHandler;
  applyLegacyShadowHeaders: (req: Request, res: Response, route: string) => unknown;
  parseRequestBody: ParseRequestBody;
  isRegressionRequest: (req: Request) => boolean;
  config: AnalysisSectionRouteConfig;
  supabase: any;
  getAnalysisIdentityCache: AnyFn;
  insertAnalysisIdentityPending: AnyFn;
  updateAnalysisIdentityCache: AnyFn;
  upsertAnalysisIdentityCache: AnyFn;
  withTimeoutPromise: AnyFn;
  isExpiredAt: (value?: string | null) => boolean;
  safeParseAnalysisBundle: AnyFn;
  getKbRuntime: AnyFn;
  resolveDigestScoreMeta: AnyFn;
  getScoreAvailableFromSourceType: AnyFn;
  buildFallbackOverviewSection: AnyFn;
  enforceOverviewSectionContract: AnyFn;
  buildFallbackUsageSection: AnyFn;
  buildIdentityFallbackOverviewSection: AnyFn;
  buildIdentityFallbackUsageSection: AnyFn;
  enforceUsageSectionContract: AnyFn;
  buildLabelDosingText: AnyFn;
  buildLnhpdIngredientsDetailKbFirst: AnyFn;
  buildDsldKbFallbackDetail: AnyFn;
  normalizeIngredientName: (value: string) => string;
  applyWebIngredientsDetailEvidenceGate: AnyFn;
  resolveFallbackUsed: AnyFn;
  resolveDsldWhatItDoesStatus: AnyFn;
  buildDetailSkeleton: AnyFn;
  queueDsldDetailEnrichment: AnyFn;
  fetchIngredientsDetailV3: AnyFn;
  deepseekBreaker: any;
  deepseekSemaphore: any;
  deepseekDsldMinimalSemaphore: any;
  sanitizeDetailDoseContext: AnyFn;
  applyFormExplainGuard: AnyFn;
  mergeDsldWhatItDoes: AnyFn;
  buildIngredientWhatItDoesFallback: AnyFn;
};

const DsldDetailMinimalSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      whatItDoes: UsageFieldSchema,
    }),
  ),
  overallSummary: UsageFieldSchema.nullable().optional(),
  overlapNotes: UsageFieldSchema.nullable().optional(),
});

type DsldDetailMinimal = z.infer<typeof DsldDetailMinimalSchema>;

const buildAnalysisSectionBodySchema = (config: AnalysisSectionRouteConfig) => z.object({
  identity: z.object({
    type: z.enum(["npn", "dsldLabelId", "webCanonicalId", "gtin14"]),
    value: z.string().min(1),
  }),
  section: z.enum(["ingredients_detail", "overview", "usage"]),
  locale: z.enum(["zh", "en"]),
  promptVersion: z.string().min(1),
  factsDigestHash: z.string().min(8),
  limit: z.number().int().min(1).max(config.analysisDetailLimitMax).optional().default(config.analysisDetailLimitDefault),
  cursor: z.number().int().min(0).optional().default(0),
});

const analysisSectionRateLimit = new Map<string, { count: number; windowStart: number }>();

export const registerAnalysisSectionRoute = (
  app: Express,
  deps: AnalysisSectionRouteDependencies,
): void => {
  const {
    applyLegacyShadowHeaders,
    parseRequestBody,
    getAnalysisIdentityCache,
    withTimeoutPromise,
    supabase,
    isExpiredAt,
    safeParseAnalysisBundle,
    getKbRuntime,
    resolveDigestScoreMeta,
    getScoreAvailableFromSourceType,
    buildFallbackOverviewSection,
    enforceOverviewSectionContract,
    buildFallbackUsageSection,
    buildIdentityFallbackOverviewSection,
    buildIdentityFallbackUsageSection,
    enforceUsageSectionContract,
    buildLabelDosingText,
    buildLnhpdIngredientsDetailKbFirst,
    buildDsldKbFallbackDetail,
    normalizeIngredientName,
    applyWebIngredientsDetailEvidenceGate,
    resolveFallbackUsed,
    resolveDsldWhatItDoesStatus,
    buildDetailSkeleton,
    queueDsldDetailEnrichment,
    fetchIngredientsDetailV3,
    deepseekBreaker,
    deepseekSemaphore,
    deepseekDsldMinimalSemaphore,
    sanitizeDetailDoseContext,
    applyFormExplainGuard,
    mergeDsldWhatItDoes,
    buildIngredientWhatItDoesFallback,
    insertAnalysisIdentityPending,
    updateAnalysisIdentityCache,
    upsertAnalysisIdentityCache,
  } = deps;
  const {
    analysisDetailLimitDefault: ANALYSIS_DETAIL_LIMIT_DEFAULT,
    analysisDetailLimitMax: ANALYSIS_DETAIL_LIMIT_MAX,
    analysisDetailLimitDsld: ANALYSIS_DETAIL_LIMIT_DSLD,
    analysisSectionDigestLookupTimeoutMs: ANALYSIS_SECTION_DIGEST_LOOKUP_TIMEOUT_MS,
    analysisDetailStaleMs: ANALYSIS_DETAIL_STALE_MS,
    analysisDetailErrorRetryMs: ANALYSIS_DETAIL_ERROR_RETRY_MS,
    analysisSectionRateLimitPerMinute: ANALYSIS_SECTION_RATE_LIMIT_PER_MINUTE,
    analysisDetailLockMs: ANALYSIS_DETAIL_LOCK_MS,
    analysisIdentityCacheTtlMs: ANALYSIS_IDENTITY_CACHE_TTL_MS,
    analysisDetailFallbackTtlMs: ANALYSIS_DETAIL_FALLBACK_TTL_MS,
    analysisBundleDetailTimeoutMs: ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS,
    analysisBundleDetailTimeoutMsDsld: ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD,
    analysisDetailMaxTokens: ANALYSIS_DETAIL_MAX_TOKENS,
    analysisDetailMaxTokensDsld: ANALYSIS_DETAIL_MAX_TOKENS_DSLD,
    analysisDetailRescueMaxTokens: ANALYSIS_DETAIL_RESCUE_MAX_TOKENS,
    analysisDetailRescueMaxTokensDsld: ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD,
    analysisDetailLimitRescue: ANALYSIS_DETAIL_LIMIT_RESCUE,
    resilienceDeepseekDsldMinQueueTimeoutMs: RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS,
    resilienceDeepseekQueueTimeoutMsDetail: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL,
  } = deps.config;
  const analysisSectionBodySchema = buildAnalysisSectionBodySchema(deps.config);

  app.post("/api/analysis-section", deps.verifySupabaseToken, async (req: Request, res: Response) => {
  applyLegacyShadowHeaders(req, res, "/api/analysis-section");
  const parsedBody = parseRequestBody(analysisSectionBodySchema, req, res);
  if (!parsedBody) {
    return;
  }

  const isRegressionRequest = deps.isRegressionRequest(req);
  const regressionDebugHeader = req.headers["x-regression-debug"];
  const wantsRegressionDebug = Array.isArray(regressionDebugHeader)
    ? regressionDebugHeader.includes("1")
    : regressionDebugHeader === "1";
  const deepseekDebugEnabled =
    process.env.DEEPSEEK_DEBUG === "1" || process.env.DEEPSEEK_DEBUG === "true";
  // Internal debug/audit fields (sentence/excerpt/reference IDs) must not leak to normal users.
  // Allow only for CI/regression token, and only when explicitly requested (x-regression-debug: 1).
  // This gives us a stable regression invariant:
  // - With regression token + x-regression-debug: include audit/debug fields
  // - With regression token only: no audit/debug fields
  const allowInternalDebug = isRegressionRequest && wantsRegressionDebug;

  const { identity, section, locale, promptVersion } = parsedBody;
  let { factsDigestHash } = parsedBody;
  const requestedFactsDigestHash = factsDigestHash;
  const rawRequestedLimit = Math.min(
    Math.max(parsedBody.limit ?? ANALYSIS_DETAIL_LIMIT_DEFAULT, 1),
    ANALYSIS_DETAIL_LIMIT_MAX,
  );
  const cursor = Math.max(0, parsedBody.cursor ?? 0);
  const requestId = String(res.getHeader("x-request-id") ?? "");

  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;

  let digestRow = await getAnalysisIdentityCache(
    {
      identityType: identity.type,
      identityValue: identity.value,
      locale,
      promptVersion,
      factsDigestHash,
      section: "digest",
    },
    { timeoutMs: 800 },
  ).catch(() => null);

  if (!digestRow) {
    let latestDigestRow: Record<string, unknown> | null = null;
    let latestDigestError: unknown = null;
    try {
      const latestDigestResult = (await withTimeoutPromise(
        (async () =>
          await supabase
            .from("analysis_identity_cache")
            .select(
              "identity_type,identity_value,locale,prompt_version,facts_digest_hash,facts_source_version,section,status,payload,facts_digest_json,attempts,locked_until,last_error,error_code,updated_at,created_at,expires_at",
            )
            .eq("identity_type", identity.type)
            .eq("identity_value", identity.value)
            .eq("locale", locale)
            .eq("prompt_version", promptVersion)
            .eq("section", "digest")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle())(),
        ANALYSIS_SECTION_DIGEST_LOOKUP_TIMEOUT_MS,
      )) as {
        data: Record<string, unknown> | null;
        error: unknown;
      };
      latestDigestRow = (latestDigestResult.data as Record<string, unknown> | null) ?? null;
      latestDigestError = latestDigestResult.error ?? null;
    } catch (error) {
      latestDigestError = error;
      console.warn("[analysis-section] digest lookup timeout/failure", {
        identityType: identity.type,
        identityValue: identity.value,
        timeoutMs: ANALYSIS_SECTION_DIGEST_LOOKUP_TIMEOUT_MS,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const latestDigestRowValid =
      !latestDigestError &&
      latestDigestRow &&
      !isExpiredAt((latestDigestRow as { expires_at?: string | null }).expires_at);

    if (latestDigestRowValid) {
      digestRow = latestDigestRow as any;
      factsDigestHash = String((latestDigestRow as { facts_digest_hash?: string }).facts_digest_hash ?? factsDigestHash);
    } else {
      if (section === "overview" || section === "usage") {
        const identityFallbackSection =
          section === "overview"
            ? buildIdentityFallbackOverviewSection(identity)
            : buildIdentityFallbackUsageSection();
        const fallbackScoreAvailable = identity.type === "webCanonicalId" ? false : null;
        res.status(200).json({
          section,
          cover: identityFallbackSection.cover,
          detail: identityFallbackSection.detail,
          dataStatus: identityFallbackSection.dataStatus,
          meta: {
            bundleId: randomUUID(),
            revision: 1,
            factsDigestHash: requestedFactsDigestHash,
            fallbackUsed: "skeleton",
            fallback: { code: "facts_digest_missing" },
            fallbackReason: "facts_digest_missing",
            scoreAvailable: fallbackScoreAvailable,
          },
          timingMs: 0,
        });
        return;
      }

      const terminalNoDigestIdentity =
        identity.type === "webCanonicalId" || identity.type === "gtin14";
      if (terminalNoDigestIdentity) {
        res.status(200).json({
          section: "ingredients",
          detail: { items: [], overallSummary: null, overlapNotes: null },
          dataStatus: "not_provided",
          page: {
            limit: rawRequestedLimit,
            cursor,
            nextCursor: null,
            hasMore: false,
            totalActives: 0,
          },
          meta: {
            bundleId: randomUUID(),
            revision: 1,
            factsDigestHash: requestedFactsDigestHash,
            fallbackUsed: "skeleton",
            fallback: { code: "facts_digest_missing" },
            fallbackReason: "facts_digest_missing",
            scoreAvailable: false,
          },
          timingMs: 0,
        });
        return;
      }

      res.status(200).json({
        section: "ingredients",
        detail: null,
        dataStatus: "pending",
        page: {
          limit: rawRequestedLimit,
          cursor,
          nextCursor: null,
          hasMore: false,
          totalActives: 0,
        },
        meta: {
          bundleId: randomUUID(),
          revision: 0,
          factsDigestHash: requestedFactsDigestHash,
          retryAfterMs: 1200,
          fallbackUsed: "skeleton",
          fallback: { code: "facts_digest_missing" },
          fallbackReason: "facts_digest_missing",
        },
        timingMs: 0,
      });
      return;
    }
  }

  const resolvedDigestRow = digestRow as NonNullable<typeof digestRow>;
  const digest = resolvedDigestRow.facts_digest_json as FactsDigest;
  const isDsldDetail = digest.sourceType === "dsld";
  // DSLD detail is KB-first and can improve as the shipped KB package changes.
  // To avoid "locking in" stale detail pages for long TTLs, incorporate the production KB package
  // signature into the cache dimension (promptVersionForCache) so new KB packages naturally re-gen.
  // The client still sends the stable promptVersion (e.g. reg_v4.0); this only affects server-side caching.
  let promptVersionForCache = promptVersion;
  if (isDsldDetail) {
    const kb = getKbRuntime();
    const pkgSha = kb?.runtime?.meta?.package_sha256;
    if (typeof pkgSha === "string" && pkgSha.trim()) {
      promptVersionForCache = `${promptVersion}|kb:${pkgSha.trim().slice(0, 12)}`;
    }
  }
  const scoreMeta = resolveDigestScoreMeta(digest);
  const scoreAvailable = scoreMeta.scoreAvailable;
  const cachedFastBundleRow = await getAnalysisIdentityCache(
    {
      identityType: identity.type,
      identityValue: identity.value,
      locale,
      promptVersion: promptVersionForCache,
      factsDigestHash,
      section: "bundle_fast",
    },
    { timeoutMs: 600 },
  ).catch(() => null);
  const parsedFastBundle = cachedFastBundleRow?.payload
    ? safeParseAnalysisBundle(cachedFastBundleRow.payload)
    : null;
  const fastBundleForGate = parsedFastBundle?.success ? parsedFastBundle.data : null;

  if (section === "overview" || section === "usage") {
    if (fastBundleForGate) {
      const sectionPayload =
        section === "overview"
          ? enforceOverviewSectionContract(fastBundleForGate.sections.overview, digest)
          : enforceUsageSectionContract(fastBundleForGate.sections.usage, digest);
      res.status(200).json({
        section,
        cover: sectionPayload.cover,
        detail: sectionPayload.detail,
        dataStatus: sectionPayload.dataStatus,
        meta: {
          bundleId: fastBundleForGate.meta.bundleId,
          revision: fastBundleForGate.meta.revision,
          factsDigestHash,
          scoreAvailable:
            fastBundleForGate.meta.scoreAvailable ??
            getScoreAvailableFromSourceType(fastBundleForGate.meta.sourceType) ??
            scoreAvailable,
          scoreReasonCode:
            typeof fastBundleForGate.meta.scoreReasonCode === "string"
              ? fastBundleForGate.meta.scoreReasonCode
              : scoreMeta.scoreReasonCode ?? null,
          inferenceOnly:
            typeof fastBundleForGate.meta.inferenceOnly === "boolean"
              ? fastBundleForGate.meta.inferenceOnly
              : scoreMeta.inferenceOnly,
        },
        timingMs: 0,
      });
      return;
    }

    const fallbackSection =
      section === "overview"
        ? buildFallbackOverviewSection(digest)
        : enforceUsageSectionContract(buildFallbackUsageSection(digest), digest);
    res.status(200).json({
      section,
      cover: fallbackSection.cover,
      detail: fallbackSection.detail,
      dataStatus: fallbackSection.dataStatus,
      meta: {
        bundleId: randomUUID(),
        revision: 1,
        factsDigestHash,
        fallbackUsed: "skeleton",
        fallback: { code: "bundle_fast_missing" },
        fallbackReason: "bundle_fast_missing",
        scoreAvailable,
        scoreReasonCode: scoreMeta.scoreReasonCode ?? null,
        inferenceOnly: scoreMeta.inferenceOnly,
      },
      timingMs: 0,
    });
    return;
  }

  const requestedLimit =
    isDsldDetail ? Math.min(rawRequestedLimit, ANALYSIS_DETAIL_LIMIT_DSLD) : rawRequestedLimit;
  const sectionKey = `${section}:${requestedLimit}:${cursor}`;
  const rateKey = `${identity.type}:${identity.value}:${locale}:${promptVersionForCache}:${sectionKey}`;
  const totalActives = digest.actives.length;
  const buildDetailPage = (returnedCount: number) => {
    const nextCursor = cursor + returnedCount;
    const hasMore = totalActives > nextCursor;
    return {
      limit: requestedLimit,
      cursor,
      nextCursor: hasMore ? nextCursor : null,
      hasMore,
      totalActives,
    };
  };
  const gateBundle = fastBundleForGate;
  const isSkeletonBundleOnly = gateBundle
    ? gateBundle.meta.revision < 1 ||
    gateBundle.meta.phase === "skeleton" ||
    gateBundle.meta.sourceTypeFinal === false ||
    gateBundle.meta.detailReady === false ||
    gateBundle.sections.ingredients.dataStatus === "pending"
    : false;

  if (gateBundle && isSkeletonBundleOnly) {
    res.status(200).json({
      section: "ingredients",
      detail: null,
      dataStatus: "pending",
      page: buildDetailPage(0),
      meta: {
        bundleId: gateBundle.meta.bundleId ?? randomUUID(),
        revision: gateBundle.meta.revision ?? 0,
        factsDigestHash,
        retryAfterMs: 1200,
        fallbackUsed: "skeleton",
        fallback: { code: "detail_not_ready_until_revision1" },
        fallbackReason: "detail_not_ready_until_revision1",
      },
      timingMs: 0,
    });
    return;
  }

  if (totalActives === 0) {
    res.status(200).json({
      section: "ingredients",
      detail: null,
      dataStatus: "not_provided",
      page: buildDetailPage(0),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
      },
      timingMs: 0,
    });
    return;
  }

  if (cursor >= totalActives) {
    res.status(200).json({
      section: "ingredients",
      detail: { items: [], overallSummary: null, overlapNotes: null },
      dataStatus: "complete",
      page: buildDetailPage(0),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
      },
      timingMs: 0,
    });
    return;
  }

  // LNHPD ingredient detail can be deterministic and KB-first:
  // - fast (no LLM latency)
  // - auditable (KB sentence/excerpt/reference governs chemicalFormExplain)
  // - conservative (no form token unless label evidence is present)
  if (digest.sourceType === "lnhpd") {
    const labelDosingText = buildLabelDosingText(digest);
    const sliceStart = Math.min(cursor, totalActives);
    const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
    const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
    const built = buildLnhpdIngredientsDetailKbFirst({
      digest: detailDigest,
      labelDosingText,
      allowInternalDebug,
    });
    res.status(200).json({
      section: "ingredients",
      detail: built.detail,
      dataStatus: "complete",
      page: buildDetailPage(Array.isArray(built.detail.items) ? built.detail.items.length : 0),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
      },
      timingMs: 0,
      ...(allowInternalDebug ? { debug: built.debug } : {}),
    });
    return;
  }

  const cachedDetail = await getAnalysisIdentityCache(
    {
      identityType: identity.type,
      identityValue: identity.value,
      locale,
      promptVersion: promptVersionForCache,
      factsDigestHash,
      section: sectionKey,
    },
    // DSLD must return a readable base page immediately; don't let cache reads block UX.
    { timeoutMs: isDsldDetail ? 150 : 800 },
  ).catch(() => null);

  const nowMs = Date.now();
  const jobId = createHash("sha256").update(rateKey + factsDigestHash).digest("hex");
  const pendingAgeMs = cachedDetail?.updated_at ? Math.max(0, nowMs - Date.parse(cachedDetail.updated_at)) : null;
  const lockedUntilMs =
    cachedDetail?.locked_until ? Date.parse(cachedDetail.locked_until) : null;
  const isStaleJob = cachedDetail
    ? pendingAgeMs !== null && pendingAgeMs > ANALYSIS_DETAIL_STALE_MS
      ? true
      : lockedUntilMs !== null && Number.isFinite(lockedUntilMs) && lockedUntilMs <= nowMs
    : false;
  const shouldRetryError =
    cachedDetail?.status === "error" &&
    (ANALYSIS_DETAIL_ERROR_RETRY_MS <= 0 ||
      (pendingAgeMs !== null && pendingAgeMs >= ANALYSIS_DETAIL_ERROR_RETRY_MS));

  if (cachedDetail?.status === "complete" && cachedDetail.payload) {
    const cachedItemsCount = Array.isArray((cachedDetail.payload as { items?: unknown }).items)
      ? (cachedDetail.payload as { items: unknown[] }).items.length
      : 0;
    const cachedFallback = resolveFallbackUsed(cachedDetail.error_code ?? null);
    const isDsldDetail = digest.sourceType === "dsld";
    // DSLD detail is KB-first; older cache rows may still carry the legacy FALLBACK_KB_DSLD marker.
    // Treat those as complete to avoid permanently "locking in" a limited UI state.
    const hideDsldFallbackMarker = isDsldDetail && cachedFallback === "kb_dsld";
    let detailPayload = cachedDetail.payload as IngredientsDetail;
    let debug: Record<string, unknown> | undefined;
    const gateSliceStart = Math.min(cursor, totalActives);
    const gateSliceEnd = Math.min(gateSliceStart + requestedLimit, totalActives);
    const gateDetailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(gateSliceStart, gateSliceEnd) };
    let webDetailGateReason: string | null = null;
    if (isDsldDetail) {
      // DSLD detail is KB-first for dose/form fields. Even when we hit a cached LLM payload, we should
      // refresh KB-first fields so:
      // - new/approved KB sentences take effect immediately (no long-lived stale cache)
      // - CI/nightly regressions observe true KB hits after a deploy
      const sliceStart = Math.min(cursor, totalActives);
      const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
      const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
      const dsldBase = buildDsldKbFallbackDetail(detailDigest);

      const baseByName = new Map<string, IngredientsDetail["items"][number]>();
      for (const item of dsldBase.detail.items) {
        baseByName.set(normalizeIngredientName(item.name), item);
      }

      let changed = false;
      const patchedItems = Array.isArray(detailPayload.items)
        ? detailPayload.items.map((item) => {
          const base = baseByName.get(normalizeIngredientName(item.name));
          if (!base) return item;
          const next = {
            ...item,
            doseContext: base.doseContext,
            chemicalFormExplain: base.chemicalFormExplain,
            deliveryFormExplain: base.deliveryFormExplain,
          };
          if (
            item.doseContext?.text !== next.doseContext?.text ||
            item.chemicalFormExplain?.text !== next.chemicalFormExplain?.text
          ) {
            changed = true;
          }
          return next;
        })
        : detailPayload.items;

      detailPayload = { ...detailPayload, items: patchedItems };

      if (changed) {
        void upsertAnalysisIdentityCache(
          {
            identityType: identity.type,
            identityValue: identity.value,
            locale,
            promptVersion: promptVersionForCache,
            factsDigestHash,
            factsSourceVersion: cachedDetail.facts_source_version ?? "",
            section: sectionKey,
            status: "complete",
            payload: detailPayload,
            factsDigestJson: cachedDetail.facts_digest_json ?? resolvedDigestRow.facts_digest_json,
            attempts: cachedDetail.attempts ?? 0,
            lockedUntil: null,
            lastError: cachedDetail.last_error ?? null,
            errorCode: cachedDetail.error_code ?? null,
            expiresAt: cachedDetail.expires_at ?? new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
          },
          { timeoutMs: 900 },
        );
      }

      if (allowInternalDebug) {
        const byName = new Map<string, IngredientsDetail["items"][number]>();
        if (Array.isArray(detailPayload.items)) {
          for (const item of detailPayload.items) {
            byName.set(normalizeIngredientName(item.name), item);
          }
        }
        const sentenceIds: Record<string, string | null> = {};
        const excerptIds: Record<string, string | null> = {};
        const referenceIds: Record<string, string | null> = {};
        const evidenceGrades: Record<string, string | null> = {};
        const supportStrengths: Record<string, "strong" | "moderate" | "weak" | null> = {};
        for (const [name, sentenceId] of Object.entries(dsldBase.formSentenceIds)) {
          const item = byName.get(normalizeIngredientName(name));
          const tags = item?.chemicalFormExplain?.basisTags;
          const isKbSentence = Array.isArray(tags) && tags.includes("ingredient_inference");
          sentenceIds[name] = isKbSentence && typeof sentenceId === "string" ? sentenceId : null;
          excerptIds[name] = isKbSentence ? dsldBase.formExcerptIds[name] ?? null : null;
          referenceIds[name] = isKbSentence ? dsldBase.formReferenceIds[name] ?? null : null;
          evidenceGrades[name] = isKbSentence ? dsldBase.formEvidenceGrades[name] ?? null : null;
          supportStrengths[name] = isKbSentence ? dsldBase.formSupportStrengths[name] ?? null : null;
        }
        debug = {
          formResolveSources: dsldBase.formResolveSources,
          formEvidenceTexts: dsldBase.formEvidenceTexts,
          formSentenceIds: sentenceIds,
          formExcerptIds: excerptIds,
          formReferenceIds: referenceIds,
          formEvidenceGrades: evidenceGrades,
          formSupportStrengths: supportStrengths,
        };
      }
    } else if (digest.sourceType === "web") {
      const gatedWebDetail = applyWebIngredientsDetailEvidenceGate(detailPayload, gateDetailDigest);
      detailPayload = gatedWebDetail.value;
      if (gatedWebDetail.reasons.length > 0) {
        webDetailGateReason = gatedWebDetail.reasons[0] ?? "web_claim_without_evidence";
      }
    }
    const dsldWhatItDoesStatusFromCache = isDsldDetail
      ? resolveDsldWhatItDoesStatus(cachedDetail.error_code ?? null)
      : null;
    const dsldTreatAsLimited =
      isDsldDetail && dsldWhatItDoesStatusFromCache && dsldWhatItDoesStatusFromCache.status !== "llm";

    res.json({
      section: "ingredients",
      detail: detailPayload,
      dataStatus:
        hideDsldFallbackMarker
          ? "complete"
          : cachedFallback || dsldTreatAsLimited || Boolean(webDetailGateReason)
            ? "limited"
            : "complete",
      page: buildDetailPage(Array.isArray(detailPayload.items) ? detailPayload.items.length : cachedItemsCount),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        fallbackUsed: hideDsldFallbackMarker ? undefined : cachedFallback ?? undefined,
        fallback:
          hideDsldFallbackMarker || !cachedFallback
            ? webDetailGateReason
              ? {
                code: webDetailGateReason,
              }
              : undefined
            : {
              code: cachedDetail.last_error ?? cachedDetail.error_code ?? "cache_fallback",
            },
        fallbackReason: hideDsldFallbackMarker
          ? webDetailGateReason ?? undefined
          : cachedFallback
            ? cachedDetail.last_error ?? cachedDetail.error_code ?? null
            : webDetailGateReason ?? undefined,
        whatItDoesStatus: dsldWhatItDoesStatusFromCache?.status,
        whatItDoesReason:
          dsldWhatItDoesStatusFromCache && dsldWhatItDoesStatusFromCache.status !== "llm"
            ? (cachedDetail.last_error ?? null)
            : undefined,
      },
      timingMs: 0,
      debug,
    });
    return;
  }

  if (isDsldDetail) {
    // P0 UX: DSLD ingredients detail must always return readable content immediately (no 202 loop).
    // We return a KB-first Base page (limited) and queue an async enrichment job (whatItDoes/summary)
    // to be filled into the identity cache.
    const sliceStart = Math.min(cursor, totalActives);
    const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
    const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
    const dsldBase = buildDsldKbFallbackDetail(detailDigest);

    let debug: Record<string, unknown> | undefined;
    if (allowInternalDebug) {
      const byName = new Map<string, IngredientsDetail["items"][number]>();
      for (const item of dsldBase.detail.items) {
        byName.set(normalizeIngredientName(item.name), item);
      }
      const sentenceIds: Record<string, string | null> = {};
      const excerptIds: Record<string, string | null> = {};
      const referenceIds: Record<string, string | null> = {};
      const evidenceGrades: Record<string, string | null> = {};
      const supportStrengths: Record<string, "strong" | "moderate" | "weak" | null> = {};
      for (const [name, sentenceId] of Object.entries(dsldBase.formSentenceIds)) {
        const item = byName.get(normalizeIngredientName(name));
        const tags = item?.chemicalFormExplain?.basisTags;
        const isKbSentence = Array.isArray(tags) && tags.includes("ingredient_inference");
        sentenceIds[name] = isKbSentence && typeof sentenceId === "string" ? sentenceId : null;
        excerptIds[name] = isKbSentence ? dsldBase.formExcerptIds[name] ?? null : null;
        referenceIds[name] = isKbSentence ? dsldBase.formReferenceIds[name] ?? null : null;
        evidenceGrades[name] = isKbSentence ? dsldBase.formEvidenceGrades[name] ?? null : null;
        supportStrengths[name] = isKbSentence ? dsldBase.formSupportStrengths[name] ?? null : null;
      }
      debug = {
        formResolveSources: dsldBase.formResolveSources,
        formEvidenceTexts: dsldBase.formEvidenceTexts,
        formSentenceIds: sentenceIds,
        formExcerptIds: excerptIds,
        formReferenceIds: referenceIds,
        formEvidenceGrades: evidenceGrades,
        formSupportStrengths: supportStrengths,
      };
    }

    res.status(200).json({
      section: "ingredients",
      detail: dsldBase.detail,
      dataStatus: "limited",
      page: buildDetailPage(dsldBase.detail.items.length),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        jobId,
        jobStatus: cachedDetail?.status ?? (deepseekKey ? "pending" : "skipped"),
        attempts: cachedDetail?.attempts ?? 0,
        updatedAt: cachedDetail?.updated_at ?? null,
        pendingAgeMs,
        fallbackUsed: "kb_dsld",
        fallback: { code: deepseekKey ? "enrichment_queued" : "deepseek_api_key_missing" },
        fallbackReason: deepseekKey ? "enrichment_queued" : "deepseek_api_key_missing",
        whatItDoesStatus: deepseekKey ? "queued" : "skipped",
        whatItDoesReason: deepseekKey ? undefined : "DEEPSEEK_API_KEY_MISSING",
      },
      timingMs: 0,
      ...(allowInternalDebug ? { debug } : {}),
    });

    if (deepseekKey) {
      queueDsldDetailEnrichment({
        identityType: identity.type,
        identityValue: identity.value,
        locale,
        promptVersionForCache,
        factsDigestHash,
        factsSourceVersion: resolvedDigestRow.facts_source_version ?? "",
        sectionKey,
        rateKey,
        digestRowFactsDigestJson: resolvedDigestRow.facts_digest_json,
        digest,
        requestedLimit,
        cursor,
        model: resolveDeepSeekModel(process.env.DEEPSEEK_MODEL),
        deepseekKey,
      });
    }
    return;
  }

  if (!deepseekKey) {
    const labelDosingText = buildLabelDosingText(digest);
    const sliceStart = Math.min(cursor, totalActives);
    const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
    const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
    const skeletonDetail = buildDetailSkeleton(detailDigest, labelDosingText);
    res.status(200).json({
      section: "ingredients",
      detail: skeletonDetail,
      dataStatus: "limited",
      page: buildDetailPage(Array.isArray(skeletonDetail.items) ? skeletonDetail.items.length : 0),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        fallbackUsed: "skeleton",
        fallback: { code: "deepseek_api_key_missing" },
        fallbackReason: "deepseek_api_key_missing",
        jobId,
        jobStatus: cachedDetail?.status ?? "skipped",
        attempts: cachedDetail?.attempts ?? 0,
        updatedAt: cachedDetail?.updated_at ?? null,
        pendingAgeMs,
      },
      timingMs: 0,
    });
    return;
  }

  if (cachedDetail?.status === "error" && !shouldRetryError) {
    res.status(200).json({
      section: "ingredients",
      detail: null,
      dataStatus: "error",
      errorCode: cachedDetail.error_code ?? "DETAIL_ERROR",
      retryable: true,
      page: buildDetailPage(0),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        jobId,
        jobStatus: cachedDetail.status,
        attempts: cachedDetail.attempts ?? 0,
        updatedAt: cachedDetail.updated_at,
        pendingAgeMs,
      },
      timingMs: 0,
    });
    return;
  }

  if (cachedDetail?.status === "pending" || cachedDetail?.status === "running") {
    if (!isStaleJob) {
      // Never return 202 to end-users. A 202 "pending" loop is easy to accidentally DDoS from the client
      // (auto-refresh effects, retries, modal open/close, etc) and quickly trips rate limiting.
      //
      // Instead: return a limited skeleton immediately + include job status so the UI can optionally
      // refresh once (or show a small "more insights may load" hint) without spamming.
      const labelDosingText = buildLabelDosingText(digest);
      const sliceStart = Math.min(cursor, totalActives);
      const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
      const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
      const skeletonDetail = buildDetailSkeleton(detailDigest, labelDosingText);
      res.status(200).json({
        section: "ingredients",
        detail: skeletonDetail,
        dataStatus: "limited",
        page: buildDetailPage(Array.isArray(skeletonDetail.items) ? skeletonDetail.items.length : 0),
        meta: {
          bundleId: randomUUID(),
          revision: 2,
          factsDigestHash,
          jobId,
          jobStatus: cachedDetail.status,
          attempts: cachedDetail.attempts ?? 0,
          updatedAt: cachedDetail.updated_at,
          pendingAgeMs,
          retryAfterMs: 2000,
          fallbackUsed: "skeleton",
          fallback: { code: "job_pending" },
          fallbackReason: "job_pending",
          requestId,
        },
        timingMs: 0,
      });
      return;
    }
  }

  // Rate limiting only applies when we are about to start (or re-claim) a job.
  // Requests that hit complete/pending cache paths above are cheap and should not be counted
  // toward the limiter, otherwise the UI can get stuck in 429 loops while polling.
  if (!isRegressionRequest) {
    const now = Date.now();
    const existingRate = analysisSectionRateLimit.get(rateKey);
    if (!existingRate || now - existingRate.windowStart > 60_000) {
      analysisSectionRateLimit.set(rateKey, { count: 1, windowStart: now });
    } else {
      existingRate.count += 1;
      if (existingRate.count > ANALYSIS_SECTION_RATE_LIMIT_PER_MINUTE) {
        const retryAfterSec = Math.max(
          1,
          Math.ceil((existingRate.windowStart + 60_000 - now) / 1000),
        );
        res.setHeader("Retry-After", String(retryAfterSec));

        const sliceStart = Math.min(cursor, totalActives);
        const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
        const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };

        if (isDsldDetail) {
          const dsldBase = buildDsldKbFallbackDetail(detailDigest);
          res.status(200).json({
            section: "ingredients",
            detail: dsldBase.detail,
            dataStatus: "limited",
            page: buildDetailPage(dsldBase.detail.items.length),
            meta: {
              bundleId: randomUUID(),
              revision: 2,
              factsDigestHash,
              fallbackUsed: "kb_dsld",
              fallback: { code: "rate_limited" },
              fallbackReason: "rate_limited",
              retryAfterMs: retryAfterSec * 1000,
              requestId,
            },
            timingMs: 0,
          });
          return;
        }

        const labelDosingText = buildLabelDosingText(digest);
        const skeletonDetail = buildDetailSkeleton(detailDigest, labelDosingText);
        res.status(200).json({
          section: "ingredients",
          detail: skeletonDetail,
          dataStatus: "limited",
          page: buildDetailPage(Array.isArray(skeletonDetail.items) ? skeletonDetail.items.length : 0),
          meta: {
            bundleId: randomUUID(),
            revision: 2,
            factsDigestHash,
            fallbackUsed: "skeleton",
            fallback: { code: "rate_limited" },
            fallbackReason: "rate_limited",
            retryAfterMs: retryAfterSec * 1000,
            requestId,
          },
          timingMs: 0,
        });
        return;
      }
    }
  }

  const lockUntil = new Date(nowMs + ANALYSIS_DETAIL_LOCK_MS).toISOString();
  const attempts = (cachedDetail?.attempts ?? 0) + 1;

  let claimed = false;
  if (cachedDetail) {
    claimed = await updateAnalysisIdentityCache(
      {
        identityType: identity.type,
        identityValue: identity.value,
        locale,
        promptVersion: promptVersionForCache,
        factsDigestHash,
        section: sectionKey,
        status: "running",
        payload: null,
        attempts,
        lockedUntil: lockUntil,
        lastError: null,
        errorCode: null,
        expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
      },
      { timeoutMs: 1200 },
    ).catch(() => false);
  } else {
    claimed = await insertAnalysisIdentityPending(
      {
        identityType: identity.type,
        identityValue: identity.value,
        locale,
        promptVersion: promptVersionForCache,
        factsDigestHash,
        factsSourceVersion: resolvedDigestRow.facts_source_version ?? "",
        section: sectionKey,
        status: "running",
        attempts,
        lockedUntil: lockUntil,
        factsDigestJson: resolvedDigestRow.facts_digest_json,
        expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
      },
      { timeoutMs: 1200 },
    ).catch(() => false);
  }

  if (!claimed) {
    // If we can't coordinate via the identity cache (write timeout, conflict, etc), don't leave callers stuck
    // in a 202 loop. Return a terminal response:
    // - DSLD: KB-first detail is cheap and deterministic, so compute inline.
    // - Others: return a minimal limited skeleton.
    if (isDsldDetail) {
      const sliceStart = Math.min(cursor, totalActives);
      const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
      const detailDigest: FactsDigest = { ...digest, actives: digest.actives.slice(sliceStart, sliceEnd) };
      const dsldBase = buildDsldKbFallbackDetail(detailDigest);

      let debug: Record<string, unknown> | undefined;
      if (allowInternalDebug) {
        debug = {
          formResolveSources: dsldBase.formResolveSources,
          formEvidenceTexts: dsldBase.formEvidenceTexts,
          formSentenceIds: dsldBase.formSentenceIds,
          formExcerptIds: dsldBase.formExcerptIds,
          formReferenceIds: dsldBase.formReferenceIds,
          formEvidenceGrades: dsldBase.formEvidenceGrades,
          formSupportStrengths: dsldBase.formSupportStrengths,
        };
      }

      res.status(200).json({
        section: "ingredients",
        detail: dsldBase.detail,
        dataStatus: "complete",
        page: buildDetailPage(Array.isArray(dsldBase.detail.items) ? dsldBase.detail.items.length : 0),
        meta: {
          bundleId: randomUUID(),
          revision: 2,
          factsDigestHash,
          fallbackUsed: "skeleton",
          fallback: { code: "cache_claim_failed" },
          fallbackReason: "cache_claim_failed",
          jobId,
          jobStatus: cachedDetail?.status ?? "pending",
          attempts: cachedDetail?.attempts ?? 0,
          updatedAt: cachedDetail?.updated_at ?? null,
          pendingAgeMs,
        },
        timingMs: 0,
        debug,
      });
      return;
    }

    const sliceStart = Math.min(cursor, totalActives);
    const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
    const items = digest.actives.slice(sliceStart, sliceEnd).map((active) => ({
      name: active.name,
      whatItDoes: buildIngredientWhatItDoesFallback(active.name),
      doseContext: { text: "Dose details are not listed in this source record.", basisTags: ["not_provided"] satisfies BasisTag[] },
      chemicalFormExplain: {
        text: "Chemical form details are not listed in this source record.",
        basisTags: ["not_provided"] satisfies BasisTag[],
      },
      deliveryFormExplain: null,
    }));

    res.status(200).json({
      section: "ingredients",
      detail: { items, overallSummary: null, overlapNotes: null },
      dataStatus: "limited",
      page: buildDetailPage(items.length),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        fallbackUsed: "skeleton",
        fallback: { code: "cache_claim_failed" },
        fallbackReason: "cache_claim_failed",
        jobId,
        jobStatus: cachedDetail?.status ?? "pending",
        attempts: cachedDetail?.attempts ?? 0,
        updatedAt: cachedDetail?.updated_at ?? null,
        pendingAgeMs,
      },
      timingMs: 0,
    });
    return;
  }

  const model = resolveDeepSeekModel(process.env.DEEPSEEK_MODEL);
  const sliceStart = Math.min(cursor, totalActives);
  const sliceEnd = Math.min(sliceStart + requestedLimit, totalActives);
  const detailDigest: FactsDigest = {
    ...digest,
    actives: digest.actives.slice(sliceStart, sliceEnd),
  };
  const buildDetailContext = (detailFacts: FactsDigest, limitValue: number) =>
    `DETAIL_PAGE: ${JSON.stringify({
      limit: limitValue,
      cursor: sliceStart,
      totalActives,
    })}\nFACTS_DIGEST_JSON: ${JSON.stringify(detailFacts)}`;
  const detailTimeoutMs = isDsldDetail ? ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD : ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS;
  const detailMaxTokens = isDsldDetail ? ANALYSIS_DETAIL_MAX_TOKENS_DSLD : ANALYSIS_DETAIL_MAX_TOKENS;
  const detailRescueMaxTokens = isDsldDetail
    ? ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD
    : ANALYSIS_DETAIL_RESCUE_MAX_TOKENS;
  const primaryPromptOverride = isDsldDetail ? "dsld_short" : undefined;
  const rescuePromptOverride = isDsldDetail ? "dsld_rescue" : "rescue";

  const start = performance.now();
  let detailRaw: Record<string, unknown> | null = null;
  let detailDebug: Record<string, unknown> | null = null;
  let detailPayload: IngredientsDetail | null = null;
  let parsedDetail: ReturnType<typeof IngredientsDetailSchema.safeParse> | null = null;
  let dsldParsed: ReturnType<typeof DsldDetailMinimalSchema.safeParse> | null = null;
  let dsldMinimal: DsldDetailMinimal | null = null;
  let formResolveSources: Record<string, string> | null = null;
  let formEvidenceTexts: Record<string, string | null> | null = null;
  let formSentenceIds: Record<string, string | null> | null = null;
  let formExcerptIds: Record<string, string | null> | null = null;
  let formReferenceIds: Record<string, string | null> | null = null;
  let formEvidenceGrades: Record<string, string | null> | null = null;
  let formSupportStrengths: Record<string, "strong" | "moderate" | "weak" | null> | null = null;
  let errorCode: string | null = null;
  let rescueAttempted = false;
  let dsldLlmSkipReason: string | null = null;
  let dsldLlmAttempted = false;
  const getDebugErrorCode = (raw: Record<string, unknown> | null): string | null => {
    if (!raw) return null;
    if (typeof raw === "object" && "__deepseek_error" in raw) {
      return String((raw as { __deepseek_error?: string }).__deepseek_error ?? "");
    }
    return null;
  };
  const isParseFailure = (code: string | null): boolean =>
    Boolean(
      code &&
      (code === "detail_v3_content_parse_failed" ||
        code === "detail_v3_response_parse_failed" ||
        code === "detail_v3_missing_content"),
    );

  try {
    if (isDsldDetail) {
      let release: (() => void) | null = null;
      try {
        release = await deepseekDsldMinimalSemaphore.acquire({ timeoutMs: RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS });
      } catch {
        dsldLlmSkipReason = "semaphore_busy";
      }
      if (release) {
        dsldLlmAttempted = true;
        try {
          // DSLD minimal prompt does not require the heavy global semaphore; this call is protected by the
          // dedicated minimal semaphore above.
          detailRaw = await fetchIngredientsDetailV3(buildDetailContext(detailDigest, requestedLimit), model, deepseekKey, {
            breaker: deepseekBreaker,
            timeoutMs: detailTimeoutMs,
            retry: { maxAttempts: 1 },
            maxTokens: detailMaxTokens,
            debugOnError: true,
            promptOverride: primaryPromptOverride,
          });
        } finally {
          release();
        }
      }
    } else {
      detailRaw = await fetchIngredientsDetailV3(buildDetailContext(detailDigest, requestedLimit), model, deepseekKey, {
        breaker: deepseekBreaker,
        semaphore: deepseekSemaphore,
        timeoutMs: detailTimeoutMs,
        queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL,
        retry: { maxAttempts: 1 },
        maxTokens: detailMaxTokens,
        debugOnError: true,
        promptOverride: primaryPromptOverride,
      });
    }
  } catch (error) {
    console.warn("[analysis-section] detail fetch failed", error);
    errorCode = "LLM_REQUEST_FAILED";
  }

  if (detailRaw) {
    if (isDsldDetail) {
      dsldParsed = DsldDetailMinimalSchema.safeParse(detailRaw);
      dsldMinimal = dsldParsed.success ? dsldParsed.data : null;
    } else {
      parsedDetail = IngredientsDetailSchema.safeParse(detailRaw);
      detailPayload = parsedDetail.success ? parsedDetail.data : null;
    }
  }
  detailDebug =
    detailRaw && typeof detailRaw === "object" && "__deepseek_error" in (detailRaw as Record<string, unknown>)
      ? (detailRaw as Record<string, unknown>)
      : null;

  const debugErrorCode = getDebugErrorCode(detailRaw);
  const shouldRescue = isDsldDetail
    ? !dsldMinimal && (isParseFailure(debugErrorCode) || (detailRaw !== null && !dsldParsed?.success))
    : !detailPayload && (isParseFailure(debugErrorCode) || (detailRaw !== null && !parsedDetail?.success));

  if (shouldRescue) {
    rescueAttempted = true;
    const rescueLimit = Math.min(requestedLimit, ANALYSIS_DETAIL_LIMIT_RESCUE);
    const rescueSliceEnd = Math.min(sliceStart + rescueLimit, totalActives);
    const rescueDigest: FactsDigest = {
      ...digest,
      actives: digest.actives.slice(sliceStart, rescueSliceEnd),
    };
    try {
      const rescueRaw = await fetchIngredientsDetailV3(
        buildDetailContext(rescueDigest, rescueLimit),
        model,
        deepseekKey,
        {
          breaker: deepseekBreaker,
          semaphore: deepseekSemaphore,
          timeoutMs: detailTimeoutMs,
          queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL,
          retry: { maxAttempts: 1 },
          maxTokens: detailRescueMaxTokens,
          debugOnError: true,
          promptOverride: rescuePromptOverride,
        },
      );
      if (rescueRaw) {
        if (isDsldDetail) {
          const rescueParsed = DsldDetailMinimalSchema.safeParse(rescueRaw);
          if (rescueParsed.success) {
            dsldMinimal = rescueParsed.data;
            detailDebug = null;
          } else {
            detailDebug =
              rescueRaw && typeof rescueRaw === "object" && "__deepseek_error" in (rescueRaw as Record<string, unknown>)
                ? (rescueRaw as Record<string, unknown>)
                : detailDebug;
          }
        } else {
          const rescueParsed = IngredientsDetailSchema.safeParse(rescueRaw);
          if (rescueParsed.success) {
            detailPayload = rescueParsed.data;
            detailDebug = null;
          } else {
            detailDebug =
              rescueRaw && typeof rescueRaw === "object" && "__deepseek_error" in (rescueRaw as Record<string, unknown>)
                ? (rescueRaw as Record<string, unknown>)
                : detailDebug;
          }
        }
      }
    } catch (error) {
      console.warn("[analysis-section] detail rescue failed", error);
      if (!errorCode) {
        errorCode = "LLM_REQUEST_FAILED";
      }
    }
  }

  const labelDosingText = buildLabelDosingText(digest);
  if (isDsldDetail) {
    const dsldBase = buildDsldKbFallbackDetail(detailDigest);
    formResolveSources = dsldBase.formResolveSources;
    formEvidenceTexts = dsldBase.formEvidenceTexts;
    formSentenceIds = dsldBase.formSentenceIds;
    formExcerptIds = dsldBase.formExcerptIds;
    formReferenceIds = dsldBase.formReferenceIds;
    formEvidenceGrades = dsldBase.formEvidenceGrades;
    formSupportStrengths = dsldBase.formSupportStrengths;
    detailPayload = mergeDsldWhatItDoes(dsldBase.detail, dsldMinimal);
  } else {
    if (detailPayload && labelDosingText) {
      detailPayload = sanitizeDetailDoseContext(detailPayload, detailDigest, labelDosingText);
    }
    if (detailPayload) {
      detailPayload = applyFormExplainGuard(detailPayload, detailDigest);
    }
  }

  const timingMs = Math.round(performance.now() - start);
  const dsldWhatItDoesUsed = isDsldDetail && Boolean(dsldMinimal);
  const dsldWhatItDoesStatus = isDsldDetail
    ? dsldWhatItDoesUsed
      ? "llm"
      : dsldLlmSkipReason
        ? "skipped"
        : dsldLlmAttempted
          ? "failed"
          : "skipped"
    : null;
  const dsldWhatItDoesReason = isDsldDetail
    ? dsldWhatItDoesUsed
      ? null
      : dsldLlmSkipReason ??
      errorCode ??
      (detailDebug?.__deepseek_error ? String(detailDebug.__deepseek_error) : null) ??
      "LLM_UNAVAILABLE"
    : null;

  const resolvedErrorCode = detailPayload
    ? null
    : errorCode ??
    (detailDebug?.__deepseek_error
      ? String(detailDebug.__deepseek_error)
      : detailRaw
        ? isDsldDetail
          ? dsldParsed?.success
            ? null
            : "LLM_PARSE_FAILED"
          : parsedDetail?.success
            ? null
            : "LLM_PARSE_FAILED"
        : "LLM_EMPTY_RESPONSE");

  let fallbackUsed: "kb_dsld" | "skeleton" | null = null;
  let fallbackReason: string | null = null;

  if (!detailPayload) {
    fallbackReason = resolvedErrorCode ?? "LLM_DETAIL_FAILED";
    if (isDsldDetail) {
      const dsldBase = buildDsldKbFallbackDetail(detailDigest);
      detailPayload = dsldBase.detail;
      formResolveSources = dsldBase.formResolveSources;
      formEvidenceTexts = dsldBase.formEvidenceTexts;
      formSentenceIds = dsldBase.formSentenceIds;
      formExcerptIds = dsldBase.formExcerptIds;
      formReferenceIds = dsldBase.formReferenceIds;
      formEvidenceGrades = dsldBase.formEvidenceGrades;
      formSupportStrengths = dsldBase.formSupportStrengths;
      fallbackUsed = "kb_dsld";
    } else {
      detailPayload = buildDetailSkeleton(detailDigest, labelDosingText);
      fallbackUsed = "skeleton";
    }
  }
  let webGateReason: string | null = null;
  if (digest.sourceType === "web" && detailPayload) {
    const gatedWebDetail = applyWebIngredientsDetailEvidenceGate(detailPayload, detailDigest);
    detailPayload = gatedWebDetail.value;
    if (gatedWebDetail.reasons.length > 0) {
      webGateReason = gatedWebDetail.reasons[0] ?? "web_claim_without_evidence";
    }
  }

  const detailStatus: "complete" | "error" = detailPayload ? "complete" : "error";
  const detailDataStatus = fallbackUsed || webGateReason ? "limited" : detailPayload ? "complete" : "error";
  const fallbackMarker =
    fallbackUsed === "kb_dsld" ? "FALLBACK_KB_DSLD" : fallbackUsed === "skeleton" ? "FALLBACK_SKELETON" : null;
  const shouldUseShortTtl = Boolean(fallbackUsed) || (isDsldDetail && !dsldWhatItDoesUsed);
  const detailExpiresAt = new Date(Date.now() + (shouldUseShortTtl ? ANALYSIS_DETAIL_FALLBACK_TTL_MS : ANALYSIS_IDENTITY_CACHE_TTL_MS)).toISOString();

  void upsertAnalysisIdentityCache(
    {
      identityType: identity.type,
      identityValue: identity.value,
      locale,
      promptVersion: promptVersionForCache,
      factsDigestHash,
      factsSourceVersion: resolvedDigestRow.facts_source_version ?? "",
      section: sectionKey,
      status: detailStatus,
      payload: detailPayload,
      factsDigestJson: resolvedDigestRow.facts_digest_json,
      attempts,
      lockedUntil: null,
      lastError: fallbackUsed
        ? fallbackReason
        : isDsldDetail && !dsldWhatItDoesUsed
          ? dsldWhatItDoesReason
          : detailPayload
            ? null
            : resolvedErrorCode ?? "LLM_DETAIL_FAILED",
      errorCode: fallbackUsed
        ? fallbackMarker
        : isDsldDetail && !dsldWhatItDoesUsed
          ? `DSLD_WHATITDOES_${dsldWhatItDoesStatus ?? "skipped"}`
          : detailPayload
            ? null
            : resolvedErrorCode ?? "LLM_DETAIL_FAILED",
      expiresAt: detailExpiresAt,
    },
    { timeoutMs: 1200 },
  );

  const includeFormResolve = allowInternalDebug && isDsldDetail && formResolveSources;
  const includeFormEvidence = allowInternalDebug && isDsldDetail && formEvidenceTexts;
  const includeFormSentenceIds = allowInternalDebug && isDsldDetail && formSentenceIds;
  const includeFormExcerptIds = allowInternalDebug && isDsldDetail && formExcerptIds;
  const includeFormReferenceIds = allowInternalDebug && isDsldDetail && formReferenceIds;
  const includeFormEvidenceGrades = allowInternalDebug && isDsldDetail && formEvidenceGrades;
  const includeFormSupportStrengths = allowInternalDebug && isDsldDetail && formSupportStrengths;
  const includeDebug = allowInternalDebug && deepseekDebugEnabled && detailDataStatus !== "complete";
  const debugPayload =
    includeDebug ||
      includeFormResolve ||
      includeFormEvidence ||
      includeFormSentenceIds ||
      includeFormExcerptIds ||
      includeFormReferenceIds ||
      includeFormEvidenceGrades ||
      includeFormSupportStrengths
      ? {
        deepseekError: includeDebug ? (detailDebug?.__deepseek_error ?? null) : undefined,
        snippet: includeDebug ? (detailDebug?.__deepseek_snippet ?? null) : undefined,
        meta: includeDebug ? (detailDebug?.__deepseek_meta ?? null) : undefined,
        parseIssues: includeDebug
          ? isDsldDetail
            ? dsldParsed?.success
              ? null
              : dsldParsed?.error?.issues ?? null
            : parsedDetail?.success
              ? null
              : parsedDetail?.error?.issues ?? null
          : undefined,
        rescueAttempted: includeDebug ? rescueAttempted : undefined,
        formResolveSources: includeFormResolve ? formResolveSources : undefined,
        formEvidenceTexts: includeFormEvidence ? formEvidenceTexts : undefined,
        formSentenceIds: includeFormSentenceIds ? formSentenceIds : undefined,
        formExcerptIds: includeFormExcerptIds ? formExcerptIds : undefined,
        formReferenceIds: includeFormReferenceIds ? formReferenceIds : undefined,
        formEvidenceGrades: includeFormEvidenceGrades ? formEvidenceGrades : undefined,
        formSupportStrengths: includeFormSupportStrengths ? formSupportStrengths : undefined,
      }
      : undefined;

  res.json({
    section: "ingredients",
    detail: detailPayload,
    dataStatus: detailDataStatus,
    page: buildDetailPage(detailPayload!.items.length),
    meta: {
      bundleId: randomUUID(),
      revision: 2,
      factsDigestHash,
      jobId,
      jobStatus: detailStatus,
      attempts,
      updatedAt: new Date().toISOString(),
      pendingAgeMs: null,
      fallbackUsed: fallbackUsed ?? undefined,
      fallback: fallbackReason || webGateReason ? { code: fallbackReason ?? webGateReason ?? "web_claim_without_evidence" } : undefined,
      fallbackReason: fallbackReason ?? webGateReason ?? undefined,
      whatItDoesStatus: isDsldDetail ? dsldWhatItDoesStatus : undefined,
      whatItDoesReason: isDsldDetail && dsldWhatItDoesStatus !== "llm" ? dsldWhatItDoesReason : undefined,
    },
    timingMs,
    debug: debugPayload,
  });
  });
};
