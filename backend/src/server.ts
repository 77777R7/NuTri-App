import * as Sentry from "@sentry/node";
import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { z } from "zod";

import {
  IngredientsDetailSchema,
  UsageFieldSchema,
  safeParseAnalysisBundle,
  type AnalysisBundle,
  type BasisTag,
  type IngredientsDetail,
  type SafetySignalItem,
  type SafetySignalPack,
} from "./analysisBundle.js";
import { getAnalysisIdentityCache, getWebCanonicalMap, insertAnalysisIdentityPending, updateAnalysisIdentityCache, upsertAnalysisIdentityCache, upsertWebCanonicalMap } from "./analysisIdentityCache.js";
import { resolveAuthorityCandidate, type AuthorityMapStatus } from "./authorityCandidate.js";
import { buildBarcodeSearchQueries, normalizeBarcodeInput, type NormalizedBarcode } from "./barcode.js";
import {
  clearNegativeCache,
  clearNpnNegativeCache,
  clearResolutionCacheBestUrl,
  getBarcodeRegulatoryMap,
  getHistoricalLnhpdScanNpn,
  getNegativeCache,
  getNpnNegativeCache,
  getResolutionCache,
  getSerpCache,
  insertBarcodeResolutionTrainingRow,
  recordNpnNegativeAttempt,
  recordResolutionCacheFailure,
  upsertBarcodeRegulatoryMap,
  upsertNegativeCache,
  upsertResolutionCacheStrongMatch,
  upsertSerpCache,
} from "./barcodeResolutionDbCache.js";
import { extractBrandProduct, type BrandExtractionResult } from "./brandExtractor.js";
import { resolveCatalogByBarcode, type CatalogResolved } from "./catalogResolver.js";
import { buildCatalogBarcodeSnapshot } from "./catalogSnapshot.js";
import {
  buildNpnCandidates,
  normalizeNpnValue,
  type NpnCandidate,
  type NpnCandidateSourceKind,
  type NpnCandidateStableReason,
} from "./npnCandidates.js";
import {
  fetchAnalysisBundle,
  fetchAnalysisBundleFastV3,
  fetchIngredientsDetailV3,
  fetchMySupplementOverviewV2,
  fetchProductOverviewWhatIsIt,
  prepareContextSources
} from "./deepseek.js";
import {
  shouldRejectEnrichStreamForServerOverload,
} from "./scanStreamAdmissionPolicy.js";
import {
  createEventLoopLagWindowSampler,
} from "./scanEventLoopLagWindow.js";
import {
  resolveScanStreamRev1DonePolicy,
} from "./scanStreamTimingPolicy.js";
import { resolveScanStreamRuntimeConfig } from "./scanStreamRuntimeConfig.js";
import {
  buildFactsDigestFromDsld,
  buildFactsDigestFromLnhpd,
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
  type DsldFactsInput,
  type FactsDigest,
  type FactsIdentityType,
  type LnhpdFactsInput,
} from "./factsDigest.js";
import {
  buildDecisionSupportOverlayAugmentationMeta,
  compileDecisionSupport,
  DECISION_SUPPORT_CONTRACT_VERSION,
  DECISION_SUPPORT_OVERLAY_AUGMENTATION_VERSION,
  DECISION_SUPPORT_PATCH_VERSION,
  DECISION_SUPPORT_RUBRIC_VERSION,
  toDecisionSupportInline,
  type DecisionSupportAttachedAllergyContext,
  type DecisionSupportAttachedPersonalizationContext,
  type DecisionSupportOverlayClaims,
  type DecisionSupportViewMode,
} from "./decisionSupport.js";
import {
  mergeDecisionSupportProfileRows,
  type DecisionSupportProfileRow,
} from "./decisionSupportProfileMerge.js";
import { buildDecisionSupportComparisonStanding } from "./decisionSupportComparison.js";
import { applyPatchShadowToFactsDigest, getPatchShadowLookup, getPatchShadowStatus } from "./patchShadowOverlay.js";
import { sanitizeFactsDTO } from "./insights/dto.js";
import {
  mapDsldFactsToFactsDTO,
  mapLnhpdFactsToFactsDTO,
  mapWebFactsToFactsDTO,
} from "./insights/factsMapper.js";
import {
  extractDeterministicSignalPack,
  type DeterministicSignalPack,
} from "./insights/deterministicSignalExtractor.js";
import {
  fetchDsldFactsRecordByLabelId,
  fetchDsldMetaByLabelId,
  fetchLnhpdFactsRecordByNpn,
  fetchWebIngredientsBySourceId,
} from "./insights/factsRepository.js";
import { isActiveIngredient } from "./insights/ingredientPredicates.js";
import { getIngredientFallbackText } from "./insights/ingredientKnowledgeMap.js";
import {
  INFERENCE_ONLY_SCORE_REASON_CODE,
  inferLnhpdActivesFromProductName,
  isOnlyInferredLnhpdDigestActives,
} from "./lnhpd/inferredActives.js";
import { factsDtoSchemaV2 } from "./insights/scanInsightsSchema.js";
import {
  compileSafetySummaryAsync,
  compileUsageSummaryAsync,
  safetySummaryPacketSchema,
  usageSummaryPacketSchema,
} from "./insights/sectionSummaryCompiler.js";
import {
  compileIngredientOverviewAsync,
  INGREDIENT_OVERVIEW_PROMPT_VERSION,
  resolveIngredientOverviewExecutionProfile,
} from "./insights/ingredientOverviewCompiler.js";
import {
  compileScientificBackgroundAsync,
  resolveScientificBackgroundExecutionProfile,
  SCIENTIFIC_BACKGROUND_PROMPT_VERSION,
  planScientificBackgroundSections,
} from "./insights/scientificBackgroundCompiler.js";
import type {
  ScientificBackgroundExecutionProfile,
} from "./insights/scientificBackgroundCompiler.js";
import {
  buildProductOverviewWhatIsItFallback,
} from "./insights/productOverviewWhatIsItFallback.js";
import { compileIngredientSummaryAsync, ingredientSummaryPacketSchema } from "./insights/summaryCompiler.js";
import {
  buildIngredientScienceContext,
  normalizeIngredientScienceKey,
} from "./ingredientScienceContext.js";
import { normalizeIherbSupplementFactsRows } from "./iherbOverlayIngredients.js";
import { getKbRuntime, lookupKbFormExplain, lookupKbRuntimeFormInsights, lookupSafeScienceSignals } from "./kbRuntime.js";
import { type LabelDraft } from "./labelTypes.js";
import { getMetricsSnapshot, incrementMetric, recordMetricTiming, startMetricsFlush } from "./metrics.js";
import { buildMySupplementFactsV1, type MySupplementFactsV1 } from "./mySupplementFacts.js";
import { getMySupplementOverviewV2GateReason } from "./mySupplementOverviewGate.js";
import { getNutriTipsData } from "./nutriTips.js";
import { buildRuleBasedOverview } from "./overviewRuleBased.js";
import { getProductSearchBootstrap, searchProducts, warmProductSearchIndex } from "./productSearch.js";
import {
  buildScanSidecarCacheKey,
  getScanSidecarPolicy,
} from "./scanSidecarPolicy.js";
import {
  recordKnownScanSidecarRouteTimings,
  recordScanSidecarCacheStatus,
} from "./scanSidecarRouteMetrics.js";
import { createDecisionSupportFetchCounter } from "./decisionSupportFetchCounter.js";
import * as profileResolverModule from "../../lib/personalization/core/profileResolver.ts";
import {
  buildEnsureOverviewInflightKey,
  isRegulatoryMapMiss,
} from "./overviewRuntime.js";
import { finalizePipelineStepCodes } from "./pipelineMetrics.js";
import {
  upsertProductIngredientsFromDraft,
  upsertProductIngredientsFromLabelFacts,
} from "./productIngredients.js";
import type { RetryOptions } from "./resilience.js";
import {
  BulkheadTimeoutError,
  CircuitBreaker,
  DeadlineBudget,
  HttpError,
  Semaphore,
  TimeoutError,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
} from "./resilience.js";
import { logBarcodeScan } from "./scanLog.js";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import {
  extractDomain,
  getExtractabilityTier,
  getUrlSignalScore,
  isHighQualityDomain,
  isMarketplaceDomain,
  scoreSearchItem,
  scoreSearchQuality
} from "./searchQuality.js";
import { buildBarcodeSnapshot, validateSnapshotOrFallback, type SnapshotAnalysisPayload } from "./snapshot.js";
import { getSnapshotCache, storeSnapshotCache } from "./snapshotCache.js";
import { deriveDailyDoseBasis } from "./safety/dailyDoseBasis.js";
import { buildSnapshotSafetyDigestBundle } from "./safety/snapshotSafety.js";
import {
  buildStackOverlapResult,
  type StackOverlapSupplementInput,
} from "./stackOverlap.js";
import { createPersonalizationExplanationRouteHandlers } from "./personalization/routes.js";
import { createGoalNavigatorRouteHandlers } from "./personalization/goalNavigatorRoutes.js";
import { createGoalNavigatorDebugRouteHandlers } from "./personalization/goalNavigatorDebugRoutes.js";
import { supabase } from "./supabase.js";
import type {
  AiSupplementAnalysis,
  ErrorResponse,
  IngredientAnalysis,
  PrimaryActive,
  RatingScore,
  SearchItem,
  SearchResponse,
} from "./types.js";
import { callVisionOcr } from "./visionOcr.js";
import {
  applyWebBundleEvidenceGate,
  applyWebIngredientsDetailEvidenceGate,
} from "./webEvidenceGate.js";
import {
  buildProviderVerdict,
  isAuthoritativeWebCandidate,
  resolveIdentityProviderLookup,
  selectBestWebCandidates,
} from "./webIdentityProviders.js";
import { sanitizeWebText } from "./webSanitizer.js";
import { applyWebVerifyRevise } from "./webVerifyRevise.js";

dotenv.config();

const resolvePersonalizationProfileCompat =
  profileResolverModule.resolvePersonalizationProfile ??
  profileResolverModule.default?.resolvePersonalizationProfile;

if (typeof resolvePersonalizationProfileCompat !== "function") {
  throw new Error(
    "[server] Failed to load resolvePersonalizationProfile from ../../lib/personalization/core/profileResolver.ts",
  );
}

const SENTRY_DSN = process.env.SENTRY_DSN ?? "";
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
const SENTRY_ENABLED = SENTRY_DSN.length > 0;

if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
  });
}

const captureException = (error: unknown, context?: Record<string, unknown>) => {
  if (!SENTRY_ENABLED) return;
  if (context) {
    Sentry.captureException(error, { extra: context });
    return;
  }
  Sentry.captureException(error);
};

startMetricsFlush();

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const MAX_RESULTS = 5;
const QUALITY_THRESHOLD = 60; // Score below this triggers fallback search
const PORT = Number(process.env.PORT ?? 3001);
const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return fallback;
};
const PRODUCT_SEARCH_WARM_ON_STARTUP = parseBooleanEnv(process.env.PRODUCT_SEARCH_WARM_ON_STARTUP, false);
const PRODUCT_SEARCH_STARTUP_WARM_DELAY_MS = Math.max(
  0,
  Number(process.env.PRODUCT_SEARCH_STARTUP_WARM_DELAY_MS ?? 30_000),
);
const parseDebugDecisionRequested = (req: Request): boolean => {
  const queryValue = req.query.debugDecision;
  const queryRequested = Array.isArray(queryValue)
    ? queryValue.some((value) => String(value ?? "").trim() === "1")
    : String(queryValue ?? "").trim() === "1";
  if (queryRequested) return true;
  const headerValue = req.headers["x-decision-debug"];
  return Array.isArray(headerValue)
    ? headerValue.some((value) => String(value ?? "").trim() === "1")
    : String(headerValue ?? "").trim() === "1";
};
const LNHPD_RUNTIME_ENABLED = parseBooleanEnv(process.env.LNHPD_RUNTIME_ENABLED, false);
type LegacyCallerSurface = "mobile_ui" | "shadow_probe" | "regression" | "unknown";
type LegacyRuntimeUsageDayRow = {
  total: number;
  mobileUiCalls: number;
  byRoute: Record<string, number>;
  bySurface: Record<LegacyCallerSurface, number>;
};
type LegacyRuntimeUsageSessionRow = {
  sessionId: string;
  total: number;
  byRoute: Record<string, number>;
  bySurface: Record<LegacyCallerSurface, number>;
  visibleUiTouched: boolean;
  lastSeenAt: string;
};
const FREEZE_SHADOW_ONLY = parseBooleanEnv(process.env.FREEZE_SHADOW_ONLY, true);
const legacyRuntimeUsage = {
  startedAt: new Date().toISOString(),
  totalCalls: 0,
  mobileUiCalls: 0,
  byRoute: {} as Record<string, number>,
  bySurface: {
    mobile_ui: 0,
    shadow_probe: 0,
    regression: 0,
    unknown: 0,
  } as Record<LegacyCallerSurface, number>,
  byDay: {} as Record<string, LegacyRuntimeUsageDayRow>,
  bySession: {} as Record<string, LegacyRuntimeUsageSessionRow>,
};
const normalizeLegacyCallerSurface = (value: unknown): LegacyCallerSurface => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "mobile_ui") return "mobile_ui";
  if (normalized === "shadow_probe") return "shadow_probe";
  if (normalized === "regression") return "regression";
  return "unknown";
};
const resolveLegacyCallerSurface = (req: Request): LegacyCallerSurface => {
  const rawHeader = req.headers["x-legacy-caller-surface"];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const fromHeader = normalizeLegacyCallerSurface(headerValue);
  if (fromHeader !== "unknown") return fromHeader;
  const regressionAuthed = Boolean((req as Request & { regressionAuth?: boolean }).regressionAuth);
  if (regressionAuthed) return "regression";
  const userAgent = String(req.headers["user-agent"] ?? "").toLowerCase();
  if (
    userAgent.includes("expo")
    || userAgent.includes("reactnative")
    || userAgent.includes("cfnetwork")
    || userAgent.includes("okhttp")
  ) {
    return "mobile_ui";
  }
  return "unknown";
};
const resolveLegacySessionId = (req: Request): string | null => {
  const fromHeader = req.headers["x-scan-session-id"];
  const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const fromQuery = typeof req.query?.sessionId === "string" ? req.query.sessionId : null;
  const candidate = String(headerValue ?? fromQuery ?? "").trim();
  if (!candidate) return null;
  return candidate.length > 80 ? candidate.slice(0, 80) : candidate;
};
const recordLegacyRuntimeUsage = (
  route: string,
  callerSurface: LegacyCallerSurface,
  sessionId: string | null,
): void => {
  legacyRuntimeUsage.totalCalls += 1;
  legacyRuntimeUsage.byRoute[route] = (legacyRuntimeUsage.byRoute[route] ?? 0) + 1;
  legacyRuntimeUsage.bySurface[callerSurface] = (legacyRuntimeUsage.bySurface[callerSurface] ?? 0) + 1;
  if (callerSurface === "mobile_ui") legacyRuntimeUsage.mobileUiCalls += 1;
  const dayKey = new Date().toISOString().slice(0, 10);
  if (!legacyRuntimeUsage.byDay[dayKey]) {
    legacyRuntimeUsage.byDay[dayKey] = {
      total: 0,
      mobileUiCalls: 0,
      byRoute: {},
      bySurface: {
        mobile_ui: 0,
        shadow_probe: 0,
        regression: 0,
        unknown: 0,
      },
    };
  }
  const dayRow = legacyRuntimeUsage.byDay[dayKey];
  dayRow.total += 1;
  dayRow.byRoute[route] = (dayRow.byRoute[route] ?? 0) + 1;
  dayRow.bySurface[callerSurface] = (dayRow.bySurface[callerSurface] ?? 0) + 1;
  if (callerSurface === "mobile_ui") dayRow.mobileUiCalls += 1;
  if (sessionId) {
    if (!legacyRuntimeUsage.bySession[sessionId]) {
      legacyRuntimeUsage.bySession[sessionId] = {
        sessionId,
        total: 0,
        byRoute: {},
        bySurface: {
          mobile_ui: 0,
          shadow_probe: 0,
          regression: 0,
          unknown: 0,
        },
        visibleUiTouched: false,
        lastSeenAt: new Date().toISOString(),
      };
    }
    const sessionRow = legacyRuntimeUsage.bySession[sessionId];
    sessionRow.total += 1;
    sessionRow.byRoute[route] = (sessionRow.byRoute[route] ?? 0) + 1;
    sessionRow.bySurface[callerSurface] = (sessionRow.bySurface[callerSurface] ?? 0) + 1;
    if (callerSurface === "mobile_ui") sessionRow.visibleUiTouched = true;
    sessionRow.lastSeenAt = new Date().toISOString();
  }
};
const applyLegacyShadowHeaders = (req: Request, res: Response, route: string): LegacyCallerSurface => {
  const callerSurface = resolveLegacyCallerSurface(req);
  const sessionId = resolveLegacySessionId(req);
  if (FREEZE_SHADOW_ONLY) {
    res.setHeader("Deprecation", "true");
    res.setHeader("X-Legacy-Shadow-Route", "1");
    res.setHeader("X-Legacy-Caller-Surface", callerSurface);
    res.setHeader("X-Legacy-Freeze-Mode", "shadow_only");
  }
  recordLegacyRuntimeUsage(route, callerSurface, sessionId);
  return callerSurface;
};
const readScanTerminalLockEnabled = (): boolean =>
  parseBooleanEnv(
    process.env.SCAN_TERMINAL_LOCK_ENABLED ?? process.env.EXPO_PUBLIC_SCAN_TERMINAL_LOCK_ENABLED,
    false,
  );
const BUNDLE_ONLY_SKIP_WEB_SEARCH = parseBooleanEnv(process.env.BUNDLE_ONLY_SKIP_WEB_SEARCH, true);
const BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0 = parseBooleanEnv(
  process.env.BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0,
  true,
);
const STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1 = parseBooleanEnv(
  process.env.STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1,
  true,
);
const STAGE0_DSLD_BARCODE_FALLBACK_ENABLED = parseBooleanEnv(
  process.env.STAGE0_DSLD_BARCODE_FALLBACK_ENABLED,
  true,
);
const STAGE0_DSLD_BARCODE_FALLBACK_FULL_ENABLED = parseBooleanEnv(
  process.env.STAGE0_DSLD_BARCODE_FALLBACK_FULL_ENABLED,
  true,
);
const parseSeededDsldLabelMap = (value: string | undefined): Map<string, number> => {
  const map = new Map<string, number>();
  const raw = String(value ?? "").trim();
  if (!raw) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("[Stage0] invalid STAGE0_DSLD_SEEDED_LABEL_MAP_JSON (JSON parse failed)", {
      error: error instanceof Error ? error.message : String(error),
    });
    return map;
  }
  const registerEntry = (barcodeLike: unknown, labelIdLike: unknown) => {
    const normalizedBarcode = normalizeBarcodeInput(String(barcodeLike ?? ""));
    const labelIdNum = Number(labelIdLike);
    if (!normalizedBarcode || !Number.isFinite(labelIdNum) || labelIdNum <= 0) return;
    map.set(normalizedBarcode.code.padStart(14, "0"), Math.floor(labelIdNum));
  };
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (Array.isArray(item) && item.length >= 2) {
        registerEntry(item[0], item[1]);
        continue;
      }
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        registerEntry(row.barcode ?? row.key, row.labelId ?? row.value);
      }
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [barcode, labelId] of Object.entries(parsed as Record<string, unknown>)) {
      registerEntry(barcode, labelId);
    }
  }
  return map;
};
const CORE_STAGE0_DSLD_WARM_LABEL_MAP = new Map<string, number>([
  ["00023249011835".padStart(14, "0"), 326272], // Sports Research Omega-3
  ["00023249090021".padStart(14, "0"), 326292], // Sports Research Vitamin C
  ["00737870212539".padStart(14, "0"), 232334], // Life Extension GI with Phage
  ["00023249012566".padStart(14, "0"), 326237], // Sports Research Astaxanthin
]);
const STAGE0_DSLD_SEEDED_LABEL_MAP = parseSeededDsldLabelMap(
  process.env.STAGE0_DSLD_SEEDED_LABEL_MAP_JSON,
);
const STAGE0_DSLD_SEEDED_LABEL_MAP_CONFIGURED = STAGE0_DSLD_SEEDED_LABEL_MAP.size > 0;
const STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED_RAW = parseBooleanEnv(
  process.env.STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED,
  false,
);
const STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED = (() => {
  if (!STAGE0_DSLD_SEEDED_LABEL_MAP_CONFIGURED || !STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED_RAW) {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[Stage0] STAGE0_DSLD_SEEDED_LABEL_MAP_JSON configured but rejected in production (fixture-only path)",
      { configuredEntries: STAGE0_DSLD_SEEDED_LABEL_MAP.size },
    );
    return false;
  }
  return true;
})();
if (process.env.NODE_ENV === "production" && STAGE0_DSLD_SEEDED_LABEL_MAP_CONFIGURED) {
  console.warn("[Stage0] seeded barcode->label map is configured; runtime path stays disabled in production", {
    configuredEntries: STAGE0_DSLD_SEEDED_LABEL_MAP.size,
    enabled: STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED,
  });
}
const STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS ?? 350),
);
const STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.STAGE0_DSLD_BARCODE_FALLBACK_FETCH_TIMEOUT_MS ?? 900),
);
const resolvePreferredStage0DsldLabelId = (barcodeGtin14: string | null | undefined): number | null => {
  const normalized = normalizeBarcodeInput(String(barcodeGtin14 ?? ""));
  if (!normalized) return null;
  const key = normalized.code.padStart(14, "0");
  const coreWarmLabelId = CORE_STAGE0_DSLD_WARM_LABEL_MAP.get(key);
  if (Number.isFinite(Number(coreWarmLabelId)) && Number(coreWarmLabelId) > 0) {
    return Number(coreWarmLabelId);
  }
  if (!STAGE0_DSLD_SEEDED_LABEL_MAP_ENABLED) return null;
  const seededLabelId = STAGE0_DSLD_SEEDED_LABEL_MAP.get(key) ?? null;
  return Number.isFinite(Number(seededLabelId)) && Number(seededLabelId) > 0
    ? Number(seededLabelId)
    : null;
};
const hasPreferredStage0DsldLabelId = (barcodeGtin14: string | null | undefined): boolean =>
  resolvePreferredStage0DsldLabelId(barcodeGtin14) != null;
const STAGE0_PROTOCOL_UNIFIED = parseBooleanEnv(process.env.STAGE0_PROTOCOL_UNIFIED, true);
const DETERMINISTIC_SIGNALS_PRIMARY = parseBooleanEnv(
  process.env.DETERMINISTIC_SIGNALS_PRIMARY,
  true,
);
const parseDecisionSupportViewMode = (_value: string | null | undefined): DecisionSupportViewMode =>
  "details";
const DECISION_SUPPORT_DEFAULT_VIEW_MODE: DecisionSupportViewMode = parseDecisionSupportViewMode(
  process.env.DECISION_SUPPORT_DEFAULT_VIEW_MODE,
);
const collectDecisionSupportFlagsSnapshot = (): Record<string, unknown> => ({
  KEY_CONTRACT_V2: process.env.KEY_CONTRACT_V2 ?? null,
  WRITE_GUARD_V2: process.env.WRITE_GUARD_V2 ?? null,
  METADATA_READONLY: process.env.METADATA_READONLY ?? null,
  STAGE0_PROTOCOL_UNIFIED: process.env.STAGE0_PROTOCOL_UNIFIED ?? null,
  STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1:
    process.env.STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1 ?? null,
  DETERMINISTIC_SIGNALS_PRIMARY: process.env.DETERMINISTIC_SIGNALS_PRIMARY ?? null,
});
const HTTP_ACCESS_LOG_ENABLED = parseBooleanEnv(process.env.HTTP_ACCESS_LOG_ENABLED, true);
const STREAM_VERBOSE_LOG_ENABLED = parseBooleanEnv(process.env.STREAM_VERBOSE_LOG_ENABLED, false);
const LABEL_FACTS_OUTPUT_RULES = `LABEL FACTS OUTPUT RULES:
1) overviewSummary must include serving unit (e.g., per softgel/caplet/serving) and 2-3 key ingredients with doses if present.
2) coreBenefits must list 3 items in "Ingredient - dose per unit" format; if dose missing, say "dose not specified".
3) overallAssessment must include a transparency note (e.g., proprietary blend or missing doses).
4) marketingVsReality must mention "Label-only analysis; no price/brand verification".
5) Do NOT mention price/cost; value should reflect formula transparency.
6) If data is missing, say "Not specified on label" instead of guessing.`;

const RESILIENCE_TOTAL_BUDGET_MS = Number(process.env.RESILIENCE_TOTAL_BUDGET_MS ?? 25_000);
const RESILIENCE_CATALOG_TIMEOUT_MS = Number(process.env.RESILIENCE_CATALOG_TIMEOUT_MS ?? 900);
const RESILIENCE_SNAPSHOT_TIMEOUT_MS = Number(process.env.RESILIENCE_SNAPSHOT_TIMEOUT_MS ?? 900);
// LNHPD fetch is a first-party, authoritative lookup. A too-short timeout causes us to incorrectly
// fall back to Web Stage1 (often "marketplace_only") which looks broken to users.
const RESILIENCE_LNHPD_TIMEOUT_MS = Number(process.env.RESILIENCE_LNHPD_TIMEOUT_MS ?? 2500);
const RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS ?? 3200,
);
const RESILIENCE_GOOGLE_TIMEOUT_MS = Number(process.env.RESILIENCE_GOOGLE_TIMEOUT_MS ?? 2500);
const RESILIENCE_DEEPSEEK_TIMEOUT_MS = Number(process.env.RESILIENCE_DEEPSEEK_TIMEOUT_MS ?? 10_000);
const MY_SUPP_OVERVIEW_TIMEOUT_MS = Number(process.env.MY_SUPP_OVERVIEW_TIMEOUT_MS ?? 4_000);
const RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS = Number(
  process.env.RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS ?? 12_000,
);
const RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS = Number(
  process.env.RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS ?? 8_000,
);
const RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS = Number(process.env.RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS ?? 4500);
const RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS ?? 300);
const RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS ?? 300);
const REG_MAP_SECOND_CHANCE_TIMEOUT_MS = Number(process.env.REG_MAP_SECOND_CHANCE_TIMEOUT_MS ?? 450);
const authorityRegressionSampleBarcodeNormalized = normalizeBarcodeInput(
  String(process.env.AUTHORITY_REGRESSION_SAMPLE_BARCODE ?? "").trim() || "00628747100045",
);
const AUTHORITY_REGRESSION_SAMPLE_BARCODE =
  authorityRegressionSampleBarcodeNormalized?.code.padStart(14, "0") ?? "";
const AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN = String(
  String(process.env.AUTHORITY_REGRESSION_SAMPLE_HISTORICAL_NPN ?? "").trim() || "80062961",
)
  .replace(/\D/g, "")
  .trim();
const RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL = Number(
  process.env.RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL ?? 1500,
);
const RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS ?? 80,
);
const RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS ?? 300);
const RESILIENCE_GOOGLE_CONCURRENCY = Number(process.env.RESILIENCE_GOOGLE_CONCURRENCY ?? 3);
const RESILIENCE_DEEPSEEK_CONCURRENCY = Number(process.env.RESILIENCE_DEEPSEEK_CONCURRENCY ?? 2);
const RESILIENCE_DEEPSEEK_DSLD_MIN_CONCURRENCY = Number(process.env.RESILIENCE_DEEPSEEK_DSLD_MIN_CONCURRENCY ?? 1);
const RESILIENCE_CONTEXT_FETCH_CONCURRENCY = Number(process.env.RESILIENCE_CONTEXT_FETCH_CONCURRENCY ?? 4);
const RESILIENCE_SUPABASE_READ_CONCURRENCY = Number(process.env.RESILIENCE_SUPABASE_READ_CONCURRENCY ?? 10);
const RESILIENCE_BREAKER_WINDOW_MS = Number(process.env.RESILIENCE_BREAKER_WINDOW_MS ?? 30_000);
const RESILIENCE_BREAKER_MIN_REQUESTS = Number(process.env.RESILIENCE_BREAKER_MIN_REQUESTS ?? 10);
const RESILIENCE_BREAKER_FAILURE_THRESHOLD = Number(process.env.RESILIENCE_BREAKER_FAILURE_THRESHOLD ?? 0.5);
const RESILIENCE_BREAKER_OPEN_MS = Number(process.env.RESILIENCE_BREAKER_OPEN_MS ?? 60_000);
const RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS ?? 80,
);

// ============================================================================
// Budgeted Resolution Engine (V2) constants
// ============================================================================

const RESOLUTION_ENGINE_VERSION = process.env.RESOLUTION_ENGINE_VERSION ?? "v2";
const RESOLUTION_SEARCH_CALLS_MAX = Number(process.env.RESOLUTION_SEARCH_CALLS_MAX ?? 2);
const RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN = Number(
  process.env.RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN ?? 2,
);
const RESOLUTION_SEARCH_STAGE_MAX_MS = Number(process.env.RESOLUTION_SEARCH_STAGE_MAX_MS ?? 1800);
const RESOLUTION_STAGE1_RESERVE_MS = Number(process.env.RESOLUTION_STAGE1_RESERVE_MS ?? 3500);
const RESOLUTION_SERP_CACHE_TTL_MS = Number(process.env.RESOLUTION_SERP_CACHE_TTL_MS ?? 3 * 60 * 60 * 1000);
const RESOLUTION_RESOLUTION_CACHE_TTL_MS = Number(
  process.env.RESOLUTION_RESOLUTION_CACHE_TTL_MS ?? 30 * 24 * 60 * 60 * 1000,
);
const RESOLUTION_CHEAP_PASS_MAX_URLS = Number(process.env.RESOLUTION_CHEAP_PASS_MAX_URLS ?? 5);
const RESOLUTION_CHEAP_PASS_TIMEOUT_MS = Number(process.env.RESOLUTION_CHEAP_PASS_TIMEOUT_MS ?? 1200);
const RESOLUTION_CHEAP_PASS_MAX_BYTES = Number(process.env.RESOLUTION_CHEAP_PASS_MAX_BYTES ?? 16_384);
const RESOLUTION_FACTS_MIN_COVERAGE = Number(process.env.RESOLUTION_FACTS_MIN_COVERAGE ?? 0.35);
const RESOLUTION_SHADOW_BUDGET_MS = Number(process.env.RESOLUTION_SHADOW_BUDGET_MS ?? 2000);
const RESOLUTION_SHADOW_QUERY_LIMIT = Math.max(
  1,
  Number(process.env.RESOLUTION_SHADOW_QUERY_LIMIT ?? 6),
);
const SECONDARY_SEARCH_ENABLE = parseBooleanEnv(process.env.SECONDARY_SEARCH_ENABLE, true);
const SECONDARY_SEARCH_TOTAL_BUDGET_MS = Number(process.env.SECONDARY_SEARCH_TOTAL_BUDGET_MS ?? 1600);
const SECONDARY_SEARCH_GOOGLE_TIMEOUT_MS = Number(process.env.SECONDARY_SEARCH_GOOGLE_TIMEOUT_MS ?? 900);
const SECONDARY_CHEAP_PASS_MAX_URLS = Number(process.env.SECONDARY_CHEAP_PASS_MAX_URLS ?? 4);
const SECONDARY_CHEAP_PASS_TIMEOUT_MS = Number(process.env.SECONDARY_CHEAP_PASS_TIMEOUT_MS ?? 900);
const SECONDARY_CHEAP_PASS_MAX_BYTES = Number(process.env.SECONDARY_CHEAP_PASS_MAX_BYTES ?? 16_384);
const SECONDARY_DEEP_FETCH_MAX_PAGES = Math.max(1, Number(process.env.SECONDARY_DEEP_FETCH_MAX_PAGES ?? 1));
const SECONDARY_DEEP_FETCH_TIMEOUT_MS = Number(process.env.SECONDARY_DEEP_FETCH_TIMEOUT_MS ?? 1000);
const SECONDARY_FACTS_MIN_COVERAGE = Number(process.env.SECONDARY_FACTS_MIN_COVERAGE ?? 0.55);
const SECONDARY_LLM_TIMEOUT_MS = Number(process.env.SECONDARY_LLM_TIMEOUT_MS ?? 8000);
const SECONDARY_LLM_BUDGET_MS = Number(process.env.SECONDARY_LLM_BUDGET_MS ?? 10_000);
const WEB_BACKGROUND_BACKFILL_ENABLE = parseBooleanEnv(
  process.env.WEB_BACKGROUND_BACKFILL_ENABLE,
  false,
);
const SECONDARY_QUERY_TOKEN_LIMIT = Math.max(6, Number(process.env.SECONDARY_QUERY_TOKEN_LIMIT ?? 10));
const SECONDARY_EXCLUDE_RETAILERS = parseBooleanEnv(process.env.SECONDARY_EXCLUDE_RETAILERS, true);
const SECONDARY_ALLOW_MARKETPLACE = parseBooleanEnv(process.env.SECONDARY_ALLOW_MARKETPLACE, false);
const SECONDARY_NEEDS_JS_OVERRIDE_MIN = Number(process.env.SECONDARY_NEEDS_JS_OVERRIDE_MIN ?? 0.85);
const WEB_IDENTITY_PROVIDER_ENABLED = parseBooleanEnv(process.env.WEB_IDENTITY_PROVIDER_ENABLED, false);
const WEB_IDENTITY_PROVIDER_ORDER = (process.env.WEB_IDENTITY_PROVIDER_ORDER ?? "off_seed,openfoodfacts,upcitemdb")
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);
const WEB_IDENTITY_PROVIDER_TIMEOUT_MS = Number(process.env.WEB_IDENTITY_PROVIDER_TIMEOUT_MS ?? 1200);
const CA_NAME_HINT_BRANDLESS_RETRY = parseBooleanEnv(process.env.CA_NAME_HINT_BRANDLESS_RETRY, true);
const UPCITEMDB_API_KEY = process.env.UPCITEMDB_API_KEY ?? null;

const AUTHORITATIVE_CA_DOMAINS = [
  "costco.ca",
  "sameday.costco.ca",
  "well.ca",
  "shoppersdrugmart.ca",
  "pharmaprix.ca",
  "rexall.ca",
  "londondrugs.com",
  "walmart.ca",
  "ca.iherb.com",
  "healthcanada.gc.ca",
];

const AMAZON_DOMAINS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
];

const GENERIC_BRAND_HINT_REGEX = /\b(?:melatonin|vitamin|omega(?:[-\s]?\d+)?|fish\s*oil|probiotic|collagen|zinc|magnesium|calcium|iron|sleep)\b/i;
const SOURCE_TITLE_HINT_MAX = 3;

const deriveNameHintFromSourceTitle = (title: string | null | undefined): string | null => {
  const raw = typeof title === "string" ? title.trim() : "";
  if (!raw) return null;
  const stripped = raw
    .replace(/\s+\|\s+.*$/, "")
    .replace(/\s+[-–—]\s+.*$/, "")
    .replace(/\s+[|]\s+.*$/, "")
    .trim();
  if (!stripped) return null;
  if (stripped.length > 140) return stripped.slice(0, 140).trim();
  return stripped;
};

const buildNameHintsFromSourceTitles = (titles: Array<string | null | undefined>): string[] => {
  const scoredHints: Array<{ hint: string; score: number }> = [];
  const seen = new Set<string>();
  for (const title of titles) {
    const hint = deriveNameHintFromSourceTitle(title);
    if (!hint) continue;
    const normalized = hint.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    let score = 0;
    if (/\b\d+(?:\.\d+)?\s*(?:mg|mcg|iu|g)\b/i.test(hint)) score += 2;
    if (/\b(?:capsule|capsules|tablet|tablets|softgel|softgels|sublingual|veggie)\b/i.test(hint)) score += 1;
    if (/\b(?:sports research|jamieson|pure encapsulations|sisu|nestle)\b/i.test(hint)) score += 1;
    if (/\b(?:pharmacie|jean coutu|target|amazon|walmart|costco|healthtree|super c|shop)\b/i.test(hint)) score -= 1;
    score += Math.min(1, hint.length / 120);
    scoredHints.push({ hint, score });
  }
  scoredHints.sort((a, b) => b.score - a.score);
  return scoredHints.slice(0, SOURCE_TITLE_HINT_MAX).map((entry) => entry.hint);
};

// Negative cache TTLs (Stage 1 only). TIMEOUT/BUDGET/Breaker are short by design to avoid "wrongful not_found".
const NEGATIVE_TTL_TIMEOUT_MS = Number(process.env.NEGATIVE_TTL_TIMEOUT_MS ?? 15 * 60 * 1000);
const NEGATIVE_TTL_NO_SERP_MS = Number(process.env.NEGATIVE_TTL_NO_SERP_MS ?? 3 * 60 * 60 * 1000);
const NEGATIVE_TTL_NO_VALID_URL_MS = Number(process.env.NEGATIVE_TTL_NO_VALID_URL_MS ?? 24 * 60 * 60 * 1000);
const NEGATIVE_TTL_NO_TEXT_FACTS_MS = Number(process.env.NEGATIVE_TTL_NO_TEXT_FACTS_MS ?? 24 * 60 * 60 * 1000);
const NEGATIVE_TTL_ONLY_IMAGES_MS = Number(process.env.NEGATIVE_TTL_ONLY_IMAGES_MS ?? 3 * 24 * 60 * 60 * 1000);
const NEGATIVE_TTL_NEEDS_JS_MS = Number(process.env.NEGATIVE_TTL_NEEDS_JS_MS ?? 3 * 24 * 60 * 60 * 1000);
const NEGATIVE_TTL_MARKETPLACE_ONLY_MS = Number(process.env.NEGATIVE_TTL_MARKETPLACE_ONLY_MS ?? 12 * 60 * 60 * 1000);

const REGULATORY_MAP_TTL_MS_LNHPD = Number(
  process.env.REGULATORY_MAP_TTL_MS_LNHPD ?? 90 * 24 * 60 * 60 * 1000,
);
const REGULATORY_MAP_TTL_MS_WEB = Number(
  process.env.REGULATORY_MAP_TTL_MS_WEB ?? 30 * 24 * 60 * 60 * 1000,
);
const REGULATORY_MAP_STALE_MAX_DAYS = Number(process.env.REGULATORY_MAP_STALE_MAX_DAYS ?? 180);
const REGULATORY_MAP_STALE_WINDOW_MS = REGULATORY_MAP_STALE_MAX_DAYS * 24 * 60 * 60 * 1000;
const REGULATORY_MAP_CONFLICT_TTL_MS = Number(
  process.env.REGULATORY_MAP_CONFLICT_TTL_MS ?? 7 * 24 * 60 * 60 * 1000,
);
const REGULATORY_MAP_NOT_FOUND_TTL_MS = Number(
  process.env.REGULATORY_MAP_NOT_FOUND_TTL_MS ?? 24 * 60 * 60 * 1000,
);
const REGULATORY_MAP_MIN_CONFIDENCE = Number(process.env.REGULATORY_MAP_MIN_CONFIDENCE ?? 0.5);

const NPN_NEGATIVE_CACHE_TTL_MS = Number(process.env.NPN_NEGATIVE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
const NPN_NEGATIVE_CACHE_WINDOW_HOURS = Number(process.env.NPN_NEGATIVE_CACHE_WINDOW_HOURS ?? 12);
const NPN_NEGATIVE_CACHE_THRESHOLD = Number(process.env.NPN_NEGATIVE_CACHE_THRESHOLD ?? 2);

const ANALYSIS_BUNDLE_PROMPT_VERSION = process.env.ANALYSIS_BUNDLE_PROMPT_VERSION ?? "reg_v4.0";
const withDecisionContractPromptVersion = (basePromptVersion: string): string =>
  [
    basePromptVersion,
    `dc:${DECISION_SUPPORT_CONTRACT_VERSION}`,
    `overlay:${DECISION_SUPPORT_OVERLAY_AUGMENTATION_VERSION}`,
    `patch:${DECISION_SUPPORT_PATCH_VERSION}`,
    `rubric:${DECISION_SUPPORT_RUBRIC_VERSION}`,
  ].join("|");
const ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED = withDecisionContractPromptVersion(
  ANALYSIS_BUNDLE_PROMPT_VERSION,
);
const ANALYSIS_BUNDLE_FAST_TIMEOUT_MS = Number(process.env.ANALYSIS_BUNDLE_FAST_TIMEOUT_MS ?? 3500);
const SSE_FAST_GRACE_MS = Number(process.env.SSE_FAST_GRACE_MS ?? 500);
const SSE_GLOBAL_STREAM_TIMEOUT_MS = Number(process.env.SSE_GLOBAL_STREAM_TIMEOUT_MS ?? 15000);
const ENRICH_STREAM_RUNTIME_CONFIG = resolveScanStreamRuntimeConfig(process.env);
const ENRICH_STREAM_ADMISSION_POLICY = ENRICH_STREAM_RUNTIME_CONFIG.admissionPolicy;
const ENRICH_STREAM_MAX_ACTIVE = ENRICH_STREAM_RUNTIME_CONFIG.sharedMaxActive;
const ENRICH_STREAM_MAX_QUEUE = ENRICH_STREAM_RUNTIME_CONFIG.sharedMaxQueue;
const ENRICH_STREAM_MAX_ACTIVE_FULL = ENRICH_STREAM_RUNTIME_CONFIG.fullMaxActive;
const ENRICH_STREAM_MAX_QUEUE_FULL = ENRICH_STREAM_RUNTIME_CONFIG.fullMaxQueue;
const ENRICH_STREAM_MAX_ACTIVE_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG.bundleOnlyMaxActive;
const ENRICH_STREAM_MAX_QUEUE_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG.bundleOnlyMaxQueue;
const ENRICH_STREAM_QUEUE_WAIT_MS = ENRICH_STREAM_RUNTIME_CONFIG.fullQueueWaitMs;
const ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG.bundleOnlyQueueWaitMs;
const ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.admissionCoreFallbackBudgetMs;
const ENRICH_STREAM_FULL_PRESSURE_CORE_FALLBACK_GUARD_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.fullPressureCoreFallbackGuardMs;
const ENRICH_STREAM_BUNDLE_ONLY_DONE_DELAY_MS = ENRICH_STREAM_RUNTIME_CONFIG.bundleOnlyDoneDelayMs;
const ENRICH_STREAM_REV0_FALLBACK_DELAY_MS = ENRICH_STREAM_RUNTIME_CONFIG.rev0FallbackDelayMs;
const ENRICH_STREAM_REV0_FALLBACK_DELAY_MS_BUNDLE_ONLY =
  ENRICH_STREAM_RUNTIME_CONFIG.rev0FallbackDelayMsBundleOnly;
const ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS = ENRICH_STREAM_RUNTIME_CONFIG.fullRev1DoneDelayMs;
const ENRICH_STREAM_BUNDLE_ONLY_TERMINAL_GUARD_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.bundleOnlyTerminalGuardMs;
const ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD = ENRICH_STREAM_RUNTIME_CONFIG.overloadInflightThreshold;
const ENRICH_STREAM_OVERLOAD_RETRY_AFTER_MS = ENRICH_STREAM_RUNTIME_CONFIG.overloadRetryAfterMs;
const ENRICH_STREAM_CLIENT_DISCONNECT_GRACE_MS = ENRICH_STREAM_RUNTIME_CONFIG.clientDisconnectGraceMs;
const SSE_CLIENT_TIMEOUT_MS = ENRICH_STREAM_RUNTIME_CONFIG.sseClientTimeoutMs;
const SSE_TIMEOUT_SAFETY_MARGIN_MS = ENRICH_STREAM_RUNTIME_CONFIG.sseTimeoutSafetyMarginMs;
const ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.stageBundleAwaitTimeoutMs;
const ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.fullPreRev1TerminalGuardMs;
const ENRICH_STREAM_CRASH_CANARY_PRE_REV1_TERMINAL_GUARD_MS =
  ENRICH_STREAM_RUNTIME_CONFIG.crashCanaryPreRev1TerminalGuardMs;
const ENRICH_STREAM_HARD_TERMINAL_FALLBACK_MS = ENRICH_STREAM_RUNTIME_CONFIG.hardTerminalFallbackMs;
const ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS = Number(process.env.ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS ?? 7000);
const ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD = Number(
  process.env.ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD ?? 4500,
);
const WEB_VERIFY_TIME_BUDGET_MS = Number(process.env.WEB_VERIFY_TIME_BUDGET_MS ?? 200);
const STAGE0_WEB_MAX_BYTES = Math.max(16 * 1024, Number(process.env.STAGE0_WEB_MAX_BYTES ?? 524_288));
const STAGE0_WEB_PARSE_BUDGET_MS = Math.max(100, Number(process.env.STAGE0_WEB_PARSE_BUDGET_MS ?? 1200));
const STAGE0_WEB_PARSE_PROFILE_ENABLED = parseBooleanEnv(
  process.env.STAGE0_WEB_PARSE_PROFILE_ENABLED,
  false,
);
const STAGE0_WEB_PARSE_PROFILE_SLOW_MS = Math.max(
  1,
  Number(process.env.STAGE0_WEB_PARSE_PROFILE_SLOW_MS ?? 20),
);
const STAGE0_WEB_PARSE_PROFILE_MAX_EVENTS = Math.max(
  1,
  Number(process.env.STAGE0_WEB_PARSE_PROFILE_MAX_EVENTS ?? 16),
);
const STAGE0_WEB_PARSE_PROFILE_TOP_K = Math.max(
  1,
  Number(process.env.STAGE0_WEB_PARSE_PROFILE_TOP_K ?? 8),
);
const STAGE0_WEB_MAX_SOURCES = Math.max(1, Number(process.env.STAGE0_WEB_MAX_SOURCES ?? 3));
const STAGE0_WEB_PARSE_SCAN_MAX_CHARS = Math.max(
  16 * 1024,
  Number(process.env.STAGE0_WEB_PARSE_SCAN_MAX_CHARS ?? 65_536),
);
const STAGE0_WEB_REGEX_SCAN_MAX_CHARS = Math.max(
  4 * 1024,
  Number(process.env.STAGE0_WEB_REGEX_SCAN_MAX_CHARS ?? 16_384),
);
const STAGE0_WEB_DIGIT_SCAN_MAX_CHARS = Math.max(
  4 * 1024,
  Number(process.env.STAGE0_WEB_DIGIT_SCAN_MAX_CHARS ?? 65_536),
);
const STAGE0_WEB_JSONLD_MAX_SCRIPTS = Math.max(
  1,
  Number(process.env.STAGE0_WEB_JSONLD_MAX_SCRIPTS ?? 6),
);
const STAGE0_WEB_JSONLD_MAX_CHARS = Math.max(
  2 * 1024,
  Number(process.env.STAGE0_WEB_JSONLD_MAX_CHARS ?? 32_768),
);
const STAGE0_WEB_JSONLD_MAX_NODES = Math.max(
  100,
  Number(process.env.STAGE0_WEB_JSONLD_MAX_NODES ?? 400),
);
const EVENT_LOOP_LAG_P95_THRESHOLD_MS = Math.max(
  1,
  Number(process.env.EVENT_LOOP_LAG_P95_THRESHOLD_MS ?? 100),
);
const EVENT_LOOP_LAG_MONITOR_RESOLUTION_MS = Math.max(
  10,
  Number(process.env.EVENT_LOOP_LAG_MONITOR_RESOLUTION_MS ?? 20),
);
const EVENT_LOOP_LAG_SAMPLE_MS = Math.max(
  50,
  Number(process.env.EVENT_LOOP_LAG_SAMPLE_MS ?? 250),
);
const SSE_LIFECYCLE_LOG_ENABLED = parseBooleanEnv(process.env.SSE_LIFECYCLE_LOG_ENABLED, false);
const ANALYSIS_DETAIL_LIMIT_DEFAULT = Number(process.env.ANALYSIS_DETAIL_LIMIT_DEFAULT ?? 8);
const ANALYSIS_DETAIL_LIMIT_MAX = Number(process.env.ANALYSIS_DETAIL_LIMIT_MAX ?? 12);
const ANALYSIS_DETAIL_LIMIT_RESCUE = Number(process.env.ANALYSIS_DETAIL_LIMIT_RESCUE ?? 6);
const ANALYSIS_DETAIL_LIMIT_DSLD = Number(process.env.ANALYSIS_DETAIL_LIMIT_DSLD ?? 6);
const ANALYSIS_DETAIL_MAX_TOKENS = Number(process.env.ANALYSIS_DETAIL_MAX_TOKENS ?? 1000);
const ANALYSIS_DETAIL_RESCUE_MAX_TOKENS = Number(process.env.ANALYSIS_DETAIL_RESCUE_MAX_TOKENS ?? 700);
const ANALYSIS_DETAIL_MAX_TOKENS_DSLD = Number(process.env.ANALYSIS_DETAIL_MAX_TOKENS_DSLD ?? 500);
const ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD = Number(process.env.ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD ?? 350);
const ANALYSIS_SECTION_DIGEST_LOOKUP_TIMEOUT_MS = Number(
  process.env.ANALYSIS_SECTION_DIGEST_LOOKUP_TIMEOUT_MS ?? 2500,
);
const ANALYSIS_DETAIL_LOCK_MS = Number(process.env.ANALYSIS_DETAIL_LOCK_MS ?? 45_000);
const ANALYSIS_DETAIL_STALE_MS = Number(process.env.ANALYSIS_DETAIL_STALE_MS ?? 60_000);
const ANALYSIS_DETAIL_ERROR_RETRY_MS = Number(process.env.ANALYSIS_DETAIL_ERROR_RETRY_MS ?? 0);
const ANALYSIS_DETAIL_FALLBACK_TTL_MS = Number(process.env.ANALYSIS_DETAIL_FALLBACK_TTL_MS ?? 6 * 60 * 60 * 1000);
const ANALYSIS_IDENTITY_CACHE_TTL_MS = Number(
  process.env.ANALYSIS_IDENTITY_CACHE_TTL_MS ?? 30 * 24 * 60 * 60 * 1000,
);
const WEB_CANONICAL_TTL_MS = Number(process.env.WEB_CANONICAL_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);
const SERVER_COMMIT_SHA =
  process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT_SHA ?? process.env.COMMIT_SHA ?? null;

const clampParseWindow = (value: string, maxChars = STAGE0_WEB_PARSE_SCAN_MAX_CHARS): string =>
  value.length > maxChars ? value.slice(0, maxChars) : value;

const clampRegexScanWindow = (value: string): string =>
  clampParseWindow(value, STAGE0_WEB_REGEX_SCAN_MAX_CHARS);

const extractDigitsPrefix = (value: string, maxChars = STAGE0_WEB_DIGIT_SCAN_MAX_CHARS): string => {
  if (!value) return "";
  const limit = Math.min(value.length, maxChars);
  const digits: string[] = [];
  for (let idx = 0; idx < limit; idx += 1) {
    const code = value.charCodeAt(idx);
    if (code >= 48 && code <= 57) digits.push(value[idx]);
  }
  return digits.join("");
};

const JSON_LD_SCRIPT_MARKER = "application/ld+json";
const JSON_LD_SCRIPT_CLOSE_TAG = "</script>";
const extractJsonLdScriptPayloads = (
  html: string,
  maxScripts = STAGE0_WEB_JSONLD_MAX_SCRIPTS,
  maxPayloadChars = STAGE0_WEB_JSONLD_MAX_CHARS,
): string[] => {
  const htmlWindow = clampParseWindow(html);
  if (!htmlWindow) return [];
  const lower = htmlWindow.toLowerCase();
  const payloads: string[] = [];
  let searchIdx = 0;

  while (payloads.length < maxScripts) {
    const markerIdx = lower.indexOf(JSON_LD_SCRIPT_MARKER, searchIdx);
    if (markerIdx < 0) break;

    const openTagStart = lower.lastIndexOf("<script", markerIdx);
    const openTagEnd = htmlWindow.indexOf(">", markerIdx);
    if (openTagStart < 0 || openTagEnd < 0 || openTagEnd <= openTagStart) {
      searchIdx = markerIdx + JSON_LD_SCRIPT_MARKER.length;
      continue;
    }

    const closeTagIdx = lower.indexOf(JSON_LD_SCRIPT_CLOSE_TAG, openTagEnd + 1);
    if (closeTagIdx < 0) break;

    const payload = htmlWindow.slice(openTagEnd + 1, Math.min(closeTagIdx, openTagEnd + 1 + maxPayloadChars)).trim();
    if (payload) payloads.push(payload);

    searchIdx = closeTagIdx + JSON_LD_SCRIPT_CLOSE_TAG.length;
  }

  return payloads;
};

if (
  Number.isFinite(SSE_GLOBAL_STREAM_TIMEOUT_MS) &&
  Number.isFinite(SSE_CLIENT_TIMEOUT_MS) &&
  Number.isFinite(SSE_TIMEOUT_SAFETY_MARGIN_MS)
) {
  if (SSE_GLOBAL_STREAM_TIMEOUT_MS >= SSE_CLIENT_TIMEOUT_MS - SSE_TIMEOUT_SAFETY_MARGIN_MS) {
    console.warn("[SSE] timeout safety violated", {
      globalMs: SSE_GLOBAL_STREAM_TIMEOUT_MS,
      clientMs: SSE_CLIENT_TIMEOUT_MS,
      safetyMarginMs: SSE_TIMEOUT_SAFETY_MARGIN_MS,
      suggestion: "Set SSE_GLOBAL_STREAM_TIMEOUT_MS < SSE_CLIENT_TIMEOUT_MS - SSE_TIMEOUT_SAFETY_MARGIN_MS",
    });
  }
}

const GUARDRAIL_SIMILARITY_THRESHOLD = Number(process.env.GUARDRAIL_SIMILARITY_THRESHOLD ?? 0.6);
const NPN_CANDIDATE_MAX = Number(process.env.NPN_CANDIDATE_MAX ?? 3);
const NPN_CANDIDATE_DIRECT_LOOKUP_TIMEOUT_MS = Number(
  process.env.NPN_CANDIDATE_DIRECT_LOOKUP_TIMEOUT_MS ?? 400,
);
const NPN_CANDIDATE_BACKFILL_MIN_BUDGET_MS = Number(
  process.env.NPN_CANDIDATE_BACKFILL_MIN_BUDGET_MS ?? 500,
);
const NPN_CANDIDATE_CATALOG_META_WAIT_MS = Number(
  process.env.NPN_CANDIDATE_CATALOG_META_WAIT_MS ?? 120,
);
const NPN_CANDIDATE_CATALOG_META_SECOND_CHANCE_TIMEOUT_MS = Number(
  process.env.NPN_CANDIDATE_CATALOG_META_SECOND_CHANCE_TIMEOUT_MS ?? 900,
);
const CANDIDATE_SCORE_SUPPRESS_REASON_CODE = "CANDIDATE_MATCH_NOT_FINAL" as const;

const eventLoopLagMonitor = monitorEventLoopDelay({
  resolution: EVENT_LOOP_LAG_MONITOR_RESOLUTION_MS,
});
eventLoopLagMonitor.enable();

const eventLoopLagWindowSampler = createEventLoopLagWindowSampler({
  histogram: eventLoopLagMonitor,
  staleAfterMs: EVENT_LOOP_LAG_SAMPLE_MS,
});

const readEventLoopLagP95Ms = (): number =>
  eventLoopLagWindowSampler.sampleAndReset().lagP95Ms;

const resetEventLoopLagP95Window = (): void => {
  eventLoopLagWindowSampler.resetWindow();
};

const isEventLoopLagOverThreshold = (): boolean =>
  readEventLoopLagP95Ms() > EVENT_LOOP_LAG_P95_THRESHOLD_MS;


const googleSemaphore = new Semaphore(RESILIENCE_GOOGLE_CONCURRENCY);
const deepseekSemaphore = new Semaphore(RESILIENCE_DEEPSEEK_CONCURRENCY);
// DSLD detail uses a minimal prompt. Keep it on a separate semaphore so it doesn't fight with heavier prompts.
const deepseekDsldMinimalSemaphore = new Semaphore(RESILIENCE_DEEPSEEK_DSLD_MIN_CONCURRENCY);
const contextFetchSemaphore = new Semaphore(RESILIENCE_CONTEXT_FETCH_CONCURRENCY);
const supabaseReadSemaphore = new Semaphore(RESILIENCE_SUPABASE_READ_CONCURRENCY);

const googleBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});
const deepseekBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});
const contextFetchBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});
const supabaseReadBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});

const ANALYSIS_VERSION = Number(process.env.ANALYSIS_VERSION ?? 2);
const CACHE_TTL_CATALOG_ONLY_MS = Number(
  process.env.CACHE_TTL_CATALOG_ONLY_MS ?? 24 * 60 * 60 * 1000,
);
const CACHE_TTL_LABEL_ENRICHED_MS = Number(
  process.env.CACHE_TTL_LABEL_ENRICHED_MS ?? 7 * 24 * 60 * 60 * 1000,
);
const CACHE_TTL_AI_ENRICHED_MS = Number(
  process.env.CACHE_TTL_AI_ENRICHED_MS ?? 7 * 24 * 60 * 60 * 1000,
);
const CACHE_TTL_COMPLETE_MS = Number(
  process.env.CACHE_TTL_COMPLETE_MS ?? 30 * 24 * 60 * 60 * 1000,
);

type AnalysisStatus = 'catalog_only' | 'label_enriched' | 'ai_enriched' | 'complete';

type LabelExtractionMeta = {
  source: 'dsld' | 'lnhpd' | 'manual';
  fetchedAt: string | null;
  datasetVersion: string | null;
};

const normalizeLabelExtractionSource = (source?: string | null): LabelExtractionMeta['source'] | null => {
  if (source === 'label_scan') return 'dsld';
  if (source === 'dsld' || source === 'lnhpd' || source === 'manual') return source;
  return null;
};

type AnalysisMeta = {
  status: AnalysisStatus;
  version: number;
  labelExtraction: LabelExtractionMeta | null;
  overlayAugmentation: {
    provider: 'iherb' | 'none';
    version: string | null;
    claimsHash: string | null;
  } | null;
};

type NormalizedAmountUnit = 'mg' | 'mcg' | 'g' | 'iu' | 'cfu' | 'ml';

type DsldFacts = {
  dsldLabelId: number;
  brandName: string | null;
  productName: string | null;
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: {
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
  }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
  datasetVersion: string | null;
  extractedAt: string | null;
  dsldPdf: string | null;
  dsldThumbnail: string | null;
  factsSource: 'label_facts' | 'meta_summary';
};

type LabelFacts = {
  source: LabelExtractionMeta['source'];
  brandName: string | null;
  productName: string | null;
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: {
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
    lnhpdMeta?: LnhpdIngredientMeta | null;
  }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
  purposes: string[];
  doses: string[];
  datasetVersion: string | null;
  extractedAt: string | null;
};

type LnhpdIngredientMeta = {
  sourceMaterial?: string | null;
  extractTypeDesc?: string | null;
  ratioNumerator?: string | number | null;
  ratioDenominator?: string | number | null;
  potencyConstituent?: string | null;
  potencyAmount?: string | number | null;
  potencyUnit?: string | null;
  driedHerbEquivalent?: string | number | null;
  ingredientName?: string | null;
  properName?: string | null;
  inferenceSource?: string | null;
};

type LnhpdFacts = {
  lnhpdId: number;
  brandName: string | null;
  productName: string | null;
  npn: string | null;
  isOnMarket: boolean | null;
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: {
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
    lnhpdMeta?: LnhpdIngredientMeta | null;
  }[];
  inactive: string[];
  purposes: string[];
  routes: string[];
  doses: string[];
  datasetVersion: string | null;
  extractedAt: string | null;
};

type LnhpdFactsRecord = {
  lnhpd_id: number | string | null;
  facts_json: unknown;
  dataset_version: string | null;
  extracted_at: string | null;
  brand_name: string | null;
  product_name: string | null;
  npn: string | null;
  is_on_market: boolean | null;
};

const nowIso = () => new Date().toISOString();

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith('mcg') ||
    normalized.startsWith('ug') ||
    normalized.startsWith('µg') ||
    normalized.startsWith('μg') ||
    normalized.startsWith('microgram')
  ) {
    return 'mcg';
  }
  if (normalized.startsWith('mg') || normalized.startsWith('milligram')) return 'mg';
  if (normalized.startsWith('g') || normalized.startsWith('gram')) return 'g';
  if (normalized.startsWith('iu') || normalized.startsWith('i.u')) return 'iu';
  if (
    normalized.startsWith('ml') ||
    normalized.startsWith('milliliter') ||
    normalized.startsWith('millilitre')
  ) {
    return 'ml';
  }
  if (normalized.includes('cfu') || normalized.includes('ufc')) return 'cfu';
  if (normalized.startsWith('kcal')) return 'kcal';
  if (normalized.startsWith('cal')) return 'cal';
  if (normalized.startsWith('%') || normalized.includes('percent')) return '%';
  return normalized;
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes('cfu') && !unitLower.includes('ufc')) return null;
  if (unitLower.includes('trillion')) return 1_000_000_000_000;
  if (unitLower.includes('billion')) return 1_000_000_000;
  if (unitLower.includes('million')) return 1_000_000;
  return 1;
};

const normalizeAmountAndUnit = (
  amount: number | null,
  unitRaw?: string | null,
): { amount: number | null; unit: string | null } => {
  if (!unitRaw) return { amount, unit: null };
  const normalizedUnit = normalizeUnitLabel(unitRaw) ?? unitRaw.trim();
  if (amount == null) return { amount, unit: normalizedUnit };
  const unitLower = unitRaw.trim().toLowerCase();
  const cfuMultiplier = parseCfuMultiplier(unitLower);
  if (cfuMultiplier) {
    return { amount: amount * cfuMultiplier, unit: 'cfu' };
  }
  return { amount, unit: normalizedUnit };
};

const normalizeAmountUnit = (unitRaw?: string | null): NormalizedAmountUnit | null => {
  const normalized = normalizeUnitLabel(unitRaw);
  if (normalized === 'mcg') return 'mcg';
  if (normalized === 'mg') return 'mg';
  if (normalized === 'g') return 'g';
  if (normalized === 'iu') return 'iu';
  if (normalized === 'ml') return 'ml';
  if (normalized === 'cfu') return 'cfu';
  return null;
};

const parseDelimitedList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split(/;|•/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseActiveSummaryLine = (rawLine: string): { name: string; amount: number | null; unit: string | null } => {
  const cleaned = rawLine.replace(/\{[^}]*\}/g, '').trim();
  if (!cleaned) {
    return { name: rawLine.trim(), amount: null, unit: null };
  }

  const npMatch = cleaned.match(/^(.*?)(?:\s+0+\s*(?:np|n\/p)|\s+(?:np|n\/p|not present))\s*$/i);
  if (npMatch) {
    const name = npMatch[1]?.trim() || cleaned;
    return { name, amount: null, unit: 'np' };
  }

  const amountUnitMatch = cleaned.match(
    /(.*?)(\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml|cfu|ufc|kcal|cal|calorie(?:s)?|%\s*dv|%dv|%)/i,
  );
  if (amountUnitMatch) {
    const [, name, amountRaw, unitRaw] = amountUnitMatch;
    const amount = Number(amountRaw);
    const unitNormalized = normalizeUnitLabel(unitRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: unitNormalized,
    };
  }

  const numericMatch = cleaned.match(/(.*?)(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, name, amountRaw] = numericMatch;
    const amount = Number(amountRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: null,
    };
  }

  return { name: cleaned, amount: null, unit: null };
};

const normalizeMatchText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const ANALYSIS_BASIS_TAGS = new Set<BasisTag>([
  "label_fact",
  "regulatory_claim",
  "ingredient_inference",
  "web_evidence",
  "general_advice",
  "not_provided",
  "conflict",
]);

const resolveLocale = (acceptLanguage?: string | null): "zh" | "en" => {
  if (!acceptLanguage) return "en";
  return /(^|,)\s*zh\b/i.test(acceptLanguage) ? "zh" : "en";
};

const clampText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1).trim()}…`;
};

const normalizeBasisTags = (tags: unknown, fallback: BasisTag): BasisTag[] => {
  if (!Array.isArray(tags)) {
    return ANALYSIS_BASIS_TAGS.has(fallback) ? [fallback] : [];
  }
  const filtered = tags
    .map((tag) => (typeof tag === "string" ? tag : ""))
    .filter((tag): tag is BasisTag => ANALYSIS_BASIS_TAGS.has(tag as BasisTag));
  if (filtered.length > 0) return filtered;
  return ANALYSIS_BASIS_TAGS.has(fallback) ? [fallback] : [];
};

const buildSectionBullet = (text: string, basisTags: BasisTag[]): { text: string; basisTags: BasisTag[] } => ({
  text,
  basisTags,
});

const normalizeSignalText = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const buildSafetySignalId = (prefix: string, text: string): string => {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (normalized) return `${prefix}:${normalized}`;
  const digest = createHash("sha1").update(text).digest("hex").slice(0, 12);
  return `${prefix}:${digest}`;
};

const buildSafetySignalItem = (params: {
  prefix: string;
  text: string;
  scope: "label_specific" | "ods_general";
  source: "label_record" | "ul_reference" | "ods_watchout" | "ods_interaction" | "quality_note" | "unknown";
  reasonCode?: string | null;
  sourceUrl?: string | null;
  riskLevel?: string | null;
}): SafetySignalItem | null => {
  const text = normalizeSignalText(params.text);
  if (!text) return null;
  const reasonCode = normalizeSignalText(params.reasonCode);
  const sourceUrl = normalizeSignalText(params.sourceUrl);
  const riskLevel = normalizeSignalText(params.riskLevel);
  const item: SafetySignalItem = {
    id: buildSafetySignalId(params.prefix, text),
    text,
    scope: params.scope,
    source: params.source,
    ...(reasonCode ? { reasonCode } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(riskLevel ? { riskLevel } : {}),
  };
  return item;
};

const dedupeSafetySignalItems = (items: SafetySignalItem[], max = 6): SafetySignalItem[] => {
  const out: SafetySignalItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = normalizeSignalText(item?.text);
    if (!text) continue;
    const key = `${item.scope}|${item.source}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, text });
    if (out.length >= max) break;
  }
  return out;
};

const summarizeDeterministicSignals = (
  signals: DeterministicSignalPack | null | undefined,
): AnalysisBundle["meta"]["deterministicSignals"] => {
  if (!signals) return null;
  const parserDiagnosticsTop = (signals.parserDiagnostics ?? [])
    .map((item) => normalizeSignalText(item?.code))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
  return {
    schemaVersion: 1,
    ingredientCount: Array.isArray(signals.ingredientRows) ? signals.ingredientRows.length : 0,
    doseCount: Array.isArray(signals.doseSignals) ? signals.doseSignals.length : 0,
    usageStructuredCount: Array.isArray(signals.usageStructured) ? signals.usageStructured.length : 0,
    safetySignalCount: Array.isArray(signals.safetySignals) ? signals.safetySignals.length : 0,
    parserDiagnosticsTop,
  };
};

const toUsageLabelDoseRows = (
  signals: DeterministicSignalPack | null | undefined,
  fallback: FactsDigest["labelDosing"],
): NonNullable<AnalysisBundle["sections"]["usage"]["detail"]>["scheduleFromLabel"] => {
  if (DETERMINISTIC_SIGNALS_PRIMARY && signals?.usageStructured?.length) {
    return signals.usageStructured
      .map((row) => ({
        population: normalizeSignalText(row.population) || null,
        age: normalizeSignalText(row.age) || null,
        dose: normalizeSignalText(row.dose) || null,
        frequency: normalizeSignalText(row.frequency) || null,
        rawText: normalizeSignalText(row.rawText) || null,
        basisTags: ["label_fact"] as BasisTag[],
      }))
      .filter((row) => row.population || row.age || row.dose || row.frequency || row.rawText)
      .slice(0, 8);
  }
  return fallback.map((dose) => ({
    population: dose.population ?? null,
    age: dose.age ?? null,
    dose: dose.dose ?? null,
    frequency: dose.frequency ?? null,
    rawText: dose.rawText ?? null,
    basisTags: ["label_fact"],
  }));
};

const buildBaseSafetySignalPack = (params: {
  digest?: FactsDigest | null;
  safetyDetail?: AnalysisBundle["sections"]["safety"]["detail"] | null;
  deterministicSignals?: DeterministicSignalPack | null;
}): SafetySignalPack => {
  const sourceType = params.digest?.sourceType ?? "web";
  const labelTexts: string[] = [];
  const pushText = (value: unknown) => {
    const text = normalizeSignalText(value);
    if (!text) return;
    labelTexts.push(text);
  };

  for (const row of params.digest?.warnings?.warnings ?? []) pushText(row);
  for (const row of params.digest?.warnings?.consultDoctorIf ?? []) pushText(row);
  for (const row of params.digest?.warnings?.redFlags ?? []) pushText(row);
  for (const row of params.safetyDetail?.warnings ?? []) pushText((row as { text?: unknown })?.text ?? row);
  for (const row of params.safetyDetail?.consultDoctorIf ?? []) pushText((row as { text?: unknown })?.text ?? row);
  for (const row of params.safetyDetail?.redFlags ?? []) pushText((row as { text?: unknown })?.text ?? row);
  if (DETERMINISTIC_SIGNALS_PRIMARY && params.deterministicSignals?.safetySignals?.length) {
    for (const signal of params.deterministicSignals.safetySignals) {
      if (signal?.domain === "label_warning") {
        pushText(signal.text);
      }
    }
  }

  const labelWarnings = dedupeSafetySignalItems(
    labelTexts
      .map((text) =>
        buildSafetySignalItem({
          prefix: "label",
          text,
          scope: "label_specific",
          source: "label_record",
        }),
      )
      .filter((item): item is SafetySignalItem => item !== null),
    6,
  );

  const qualityNoteText =
    sourceType === "lnhpd" || sourceType === "dsld"
      ? "This regulatory record did not provide label-specific warnings."
      : "This source record did not provide label-specific warnings.";
  const qualityNotes =
    labelWarnings.length === 0
      ? [
          buildSafetySignalItem({
            prefix: "quality",
            text: qualityNoteText,
            scope: "label_specific",
            source: "quality_note",
            reasonCode: "LABEL_WARNINGS_NOT_PROVIDED",
          }),
        ].filter((item): item is SafetySignalItem => item !== null)
      : [];

  const deterministicUlSignals = DETERMINISTIC_SIGNALS_PRIMARY && params.deterministicSignals?.safetySignals?.length
    ? dedupeSafetySignalItems(
      params.deterministicSignals.safetySignals
        .filter((signal) => signal?.domain === "ul_reference")
        .map((signal) =>
          buildSafetySignalItem({
            prefix: "ul",
            text: signal.text,
            scope: "ods_general",
            source: "ul_reference",
            reasonCode: signal.reasonCode ?? null,
          }),
        )
        .filter((item): item is SafetySignalItem => item !== null),
      6,
    )
    : [];
  const deterministicInteractions = DETERMINISTIC_SIGNALS_PRIMARY && params.deterministicSignals?.safetySignals?.length
    ? dedupeSafetySignalItems(
      params.deterministicSignals.safetySignals
        .filter((signal) => signal?.domain === "interaction")
        .map((signal) =>
          buildSafetySignalItem({
            prefix: "interaction",
            text: signal.text,
            scope: "label_specific",
            source: "ods_interaction",
            reasonCode: signal.reasonCode ?? null,
          }),
        )
        .filter((item): item is SafetySignalItem => item !== null),
      6,
    )
    : [];
  const deterministicWatchouts = DETERMINISTIC_SIGNALS_PRIMARY && params.deterministicSignals?.safetySignals?.length
    ? dedupeSafetySignalItems(
      params.deterministicSignals.safetySignals
        .filter((signal) => signal?.domain === "watchout")
        .map((signal) =>
          buildSafetySignalItem({
            prefix: "watchout",
            text: signal.text,
            scope: signal.scope === "ods_general" ? "ods_general" : "label_specific",
            source: signal.scope === "ods_general" ? "ods_watchout" : "quality_note",
            reasonCode: signal.reasonCode ?? null,
          }),
        )
        .filter((item): item is SafetySignalItem => item !== null),
      6,
    )
    : [];

  return {
    schemaVersion: 1,
    labelWarnings,
    ulEntries: [],
    ulSignals: deterministicUlSignals,
    odsInteractions: deterministicInteractions,
    odsWatchouts: deterministicWatchouts,
    qualityNotes,
  };
};

const extractSectionText = (text: string | null | undefined, patterns: RegExp[], maxChars = 600): string | null => {
  if (!text) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trim()}…` : normalized;
    }
  }
  return null;
};

const resolveSourceBasisTag = (sourceType: FactsDigest["sourceType"]): BasisTag =>
  sourceType === "web" ? "web_evidence" : "label_fact";

const buildIngredientsCover = (
  digest: FactsDigest,
  deterministicSignals?: DeterministicSignalPack | null,
): AnalysisBundle["sections"]["ingredients"]["cover"] => {
  if (DETERMINISTIC_SIGNALS_PRIMARY && deterministicSignals?.ingredientRows?.length) {
    const items = deterministicSignals.ingredientRows
      .slice(0, 6)
      .map((row) => ({
        name: row.name,
        dose: row.doseText ?? null,
        basisTags: ["label_fact"] as BasisTag[],
      }));
    return {
      items,
      totalCount: deterministicSignals.ingredientRows.length,
    };
  }
  const basisTag = resolveSourceBasisTag(digest.sourceType);
  const items = digest.actives.slice(0, 6).map((active) => ({
    name: active.name,
    dose: active.amountText ?? (active.amount != null && active.unit ? `${active.amount} ${active.unit}` : null),
    basisTags: [
      digest.sourceType === "lnhpd" && typeof active.confidence === "number" && active.confidence < 0.6
        ? "ingredient_inference"
        : basisTag,
    ],
  }));
  return {
    items,
    totalCount: digest.actives.length,
  };
};

const resolveInferenceOnlyDigest = (digest: FactsDigest): boolean =>
  digest.sourceType === "lnhpd" && isOnlyInferredLnhpdDigestActives(digest.actives);

const resolveDigestScoreMeta = (digest: FactsDigest): {
  scoreAvailable: boolean;
  scoreReasonCode?: string;
  inferenceOnly: boolean;
} => {
  const hasActives = digest.actives.length > 0;
  if (digest.sourceType === "web") {
    return {
      scoreAvailable: false,
      inferenceOnly: false,
    };
  }
  const inferenceOnly = resolveInferenceOnlyDigest(digest);
  if (inferenceOnly) {
    return {
      scoreAvailable: false,
      scoreReasonCode: INFERENCE_ONLY_SCORE_REASON_CODE,
      inferenceOnly: true,
    };
  }
  return {
    scoreAvailable: hasActives,
    inferenceOnly: false,
  };
};

const buildFallbackOverviewSummary = (digest: FactsDigest): string => {
  const genericAnchorSet = new Set(["calories", "total fat", "cholesterol", "sodium", "carbohydrate", "protein"]);
  const primary =
    digest.actives
      .map((active) => active.name?.trim() ?? "")
      .find((name) => {
        const normalized = normalizeOverviewAnchor(name);
        return normalized.length >= 3 && !genericAnchorSet.has(normalized);
      }) ??
    digest.actives[0]?.name?.trim() ??
    "";
  const productName = digest.product.name?.trim() ?? "";
  const WEB_HINT_DANGEROUS_TITLE_RE = /\b(youtube|forum|forums|reddit|error|exception|traceback|uuid)\b/i;
  const WEB_HINT_UUID_LIKE_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const suspiciousWebTitle =
    digest.sourceType === "web" &&
    (WEB_HINT_DANGEROUS_TITLE_RE.test(productName) ||
      WEB_HINT_UUID_LIKE_RE.test(productName) ||
      /^[0-9a-f-]{24,}$/i.test(productName));

  if (digest.sourceType === "web") {
    const webAnchor = !suspiciousWebTitle ? primary || productName : "";
    const summary = webAnchor
      ? `This UPC appears related to ${webAnchor}, based on limited unverified web evidence. Verify all details against the package label before use.`
      : "We could not verify this UPC to a supplement label. This summary uses limited unverified web evidence and should be confirmed against the package label.";
    return summary.length < 40 ? `${summary} Capture Supplement Facts for stronger product-specific detail.` : summary;
  }

  const anchor = primary || productName || "this supplement";
  const sourcePhrase = "label facts";
  let summary = `This supplement centers on ${anchor} and is summarized from ${sourcePhrase}. Follow label directions and use this overview as general information.`;
  if (summary.length < 40) {
    summary = `${summary} Consult product labeling for product-specific guidance.`;
  }
  return summary;
};

const normalizeOverviewAnchor = (value: string | null | undefined): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasOverviewAnchorToken = (summary: string, digest: FactsDigest): boolean => {
  const normalizedSummary = normalizeOverviewAnchor(summary);
  if (!normalizedSummary) return false;
  const candidates = [digest.actives[0]?.name ?? null, digest.product.name ?? null]
    .map((value) => normalizeOverviewAnchor(value))
    .filter((value) => value.length >= 3);
  if (candidates.length === 0) return false;
  return candidates.some((token) => normalizedSummary.includes(token));
};

const buildDsldInferenceOverview = (digest: FactsDigest): { summary: string; bullets: Array<{ text: string; basisTags: BasisTag[] }> } => {
  const actives = digest.actives.map((active) => active.name).filter(Boolean);
  const primary = actives.slice(0, 2).join(" and ");
  const summary = primary
    ? `A dietary supplement providing ${primary} to support general nutrition.`
    : "A dietary supplement intended to support general wellness based on its ingredients.";
  const bullets: Array<{ text: string; basisTags: BasisTag[] }> = [];
  if (primary) {
    bullets.push(buildSectionBullet(`Supports general nutrition based on ingredients like ${primary}.`, ["ingredient_inference"]));
  }
  bullets.push(buildSectionBullet("Consider use when dietary intake may be insufficient.", ["ingredient_inference"]));
  return { summary, bullets };
};

const applyDsldInferenceGuard = (bundle: AnalysisBundle, digest: FactsDigest): AnalysisBundle => {
  if (digest.sourceType !== "dsld") return bundle;
  const bullets = bundle.sections.overview.cover?.bullets ?? [];
  const shouldReplace = bullets.length === 0 || bullets.every((bullet) => isContainsBullet(bullet.text));
  if (!shouldReplace) return bundle;
  const inference = buildDsldInferenceOverview(digest);
  return {
    ...bundle,
    sections: {
      ...bundle.sections,
      overview: {
        ...bundle.sections.overview,
        cover: {
          summary: inference.summary,
          bullets: inference.bullets,
        },
        detail: {
          summary: inference.summary,
          bullets: inference.bullets,
        },
        dataStatus: "complete",
      },
    },
  };
};

const buildFallbackOverviewBullets = (digest: FactsDigest): Array<{ text: string; basisTags: BasisTag[] }> => {
  const bullets: Array<{ text: string; basisTags: BasisTag[] }> = [];
  if (digest.claims.labelPurposes.length > 0) {
    digest.claims.labelPurposes.slice(0, 2).forEach((purpose) => {
      bullets.push(buildSectionBullet(purpose, ["regulatory_claim"]));
    });
  }
  if (bullets.length < 2 && digest.actives.length > 0) {
    const basisTag = resolveSourceBasisTag(digest.sourceType);
    for (const active of digest.actives) {
      if (bullets.length >= 2) break;
      bullets.push(buildSectionBullet(`Contains ${active.name}`, [basisTag]));
    }
  }
  return bullets;
};

const isContainsBullet = (text: string | null | undefined): boolean => {
  if (!text) return false;
  return /^contains\b/i.test(text.trim());
};

const PLACEHOLDERISH_PATTERNS = [
  /\bnot provided\b/i,
  /\bunknown\b/i,
  /\bn\/a\b/i,
  /\bmissing\b/i,
  /\bunavailable\b/i,
  /\bdetails?\s+not\b/i,
];

const isPlaceholderishText = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return true;
  return PLACEHOLDERISH_PATTERNS.some((pattern) => pattern.test(normalized));
};

const applyFastFailureStatus = (bundle: AnalysisBundle): AnalysisBundle => {
  const overviewStatus = bundle.sections.overview.cover ? "limited" : "error";
  const usageStatus = bundle.sections.usage.cover ? "limited" : "error";
  const safetyStatus = bundle.sections.safety.cover ? "limited" : "error";
  return {
    ...bundle,
    sections: {
      ...bundle.sections,
      overview: { ...bundle.sections.overview, dataStatus: overviewStatus },
      usage: { ...bundle.sections.usage, dataStatus: usageStatus },
      safety: { ...bundle.sections.safety, dataStatus: safetyStatus },
    },
  };
};

const sanitizeAnalysisBundleCoverFields = (params: {
  bundle: AnalysisBundle;
  digest: FactsDigest;
}): AnalysisBundle => {
  const { bundle, digest } = params;
  const sanitizeCoverText = (value: string | null | undefined, fallback: string): string => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || isPlaceholderishText(text)) return fallback;
    return text;
  };

  const fallbackOverviewSummary = buildFallbackOverviewSummary(digest);
  const fallbackOverviewSanitizeBullets =
    digest.sourceType === "web"
      ? [
        buildSectionBullet("Built from limited unverified web evidence for this barcode.", ["general_advice"]),
        buildSectionBullet("Scan Supplement Facts to verify this product and unlock stronger detail.", ["general_advice"]),
      ]
      : [
        buildSectionBullet("Based on verified record data.", ["general_advice"]),
        buildSectionBullet("Scan the Supplement Facts panel for richer product-specific insights.", ["general_advice"]),
      ];
  const fallbackOverviewBullets = buildFallbackOverviewBullets(digest);
  const fallbackUsage = buildFallbackUsageSection(digest);
  const fallbackUsageCover = fallbackUsage.cover ?? null;

  const sanitizeBullets = (
    bullets: Array<{ text: string; basisTags: BasisTag[] }> | undefined,
    fallback: Array<{ text: string; basisTags: BasisTag[] }>,
    max = 2,
  ) => {
    const out: Array<{ text: string; basisTags: BasisTag[] }> = [];
    const seen = new Set<string>();
    const add = (item: { text: string; basisTags: BasisTag[] }) => {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text || isPlaceholderishText(text)) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        text,
        basisTags: Array.isArray(item.basisTags) ? normalizeBasisTags(item.basisTags, "general_advice") : ["general_advice"],
      });
    };
    (bullets ?? []).forEach(add);
    fallback.forEach(add);
    return out.slice(0, max);
  };

  const overviewCover = bundle.sections.overview.cover;
  const overviewSummary = sanitizeCoverText(
    typeof overviewCover?.summary === "string" ? overviewCover.summary : null,
    fallbackOverviewSummary,
  );
  const overviewBullets = sanitizeBullets(
    overviewCover?.bullets,
    fallbackOverviewBullets.length > 0
      ? fallbackOverviewBullets
      : fallbackOverviewSanitizeBullets,
    2,
  );
  while (overviewBullets.length < 2) {
    overviewBullets.push(
      buildSectionBullet("Scan the Supplement Facts panel for richer product-specific insights.", ["general_advice"]),
    );
  }

  const usageCover = bundle.sections.usage.cover;
  const usageBestTime = usageCover?.bestTimeToTake && !isPlaceholderishText(usageCover.bestTimeToTake.text)
    ? usageCover.bestTimeToTake
    : fallbackUsageCover?.bestTimeToTake ?? { text: "Anytime (with meals).", basisTags: ["general_advice"] };
  const usageDosage = usageCover?.dosage && !isPlaceholderishText(usageCover.dosage.text)
    ? usageCover.dosage
    : fallbackUsageCover?.dosage ?? { text: "Follow label directions.", basisTags: ["general_advice"] };
  const usageWithFood =
    usageCover?.withFood &&
      (typeof usageCover.withFood.text !== "string" || !isPlaceholderishText(usageCover.withFood.text))
      ? usageCover.withFood
      : fallbackUsageCover?.withFood ??
        { value: true, text: "Prefer with food unless label states otherwise.", basisTags: ["general_advice"] };
  const usageBullets = sanitizeBullets(
    usageCover?.bullets,
    [
      buildSectionBullet("Use the product label first for dosing decisions.", ["general_advice"]),
      buildSectionBullet("Scan the Directions panel to improve product-specific guidance.", ["general_advice"]),
    ],
    3,
  );

  const safetyCover = bundle.sections.safety.cover;
  const safetyVerdict = sanitizeCoverText(
    typeof safetyCover?.verdict === "string" ? safetyCover.verdict : null,
    "Safety details are not included in this source record.",
  );
  const safetyBullets = sanitizeBullets(
    safetyCover?.bullets,
    [
      buildSectionBullet(
        "Safety details are not available from this source. If pregnant, nursing, or taking medication, consult your clinician.",
        ["general_advice"],
      ),
    ],
    3,
  );

  return {
    ...bundle,
    sections: {
      ...bundle.sections,
      overview: {
        ...bundle.sections.overview,
        cover: {
          summary: overviewSummary,
          bullets: overviewBullets,
        },
        detail: {
          ...(bundle.sections.overview.detail ?? {}),
          summary: overviewSummary,
          bullets: overviewBullets,
        },
      },
      usage: {
        ...bundle.sections.usage,
        cover: {
          ...(bundle.sections.usage.cover ?? { bullets: [] }),
          bestTimeToTake: usageBestTime,
          dosage: usageDosage,
          withFood: usageWithFood,
          bullets: usageBullets,
        },
      },
      safety: {
        ...bundle.sections.safety,
        cover: {
          ...(bundle.sections.safety.cover ?? { bullets: [] }),
          verdict: safetyVerdict,
          bullets: safetyBullets,
        },
      },
    },
  };
};

const buildFastFailureBundle = (skeleton: AnalysisBundle): AnalysisBundle => ({
  ...skeleton,
  meta: {
    ...skeleton.meta,
    sourceTypeFinal: Boolean(skeleton.meta.sourceTypeFinal),
    detailReady: Boolean(skeleton.meta.detailReady),
    phase: "fast_ai",
    revision: skeleton.meta.revision + 1,
  },
  sections: {
    ...skeleton.sections,
    overview: { ...skeleton.sections.overview, dataStatus: "error" },
    usage: { ...skeleton.sections.usage, dataStatus: "error" },
    safety: { ...skeleton.sections.safety, dataStatus: "error" },
  },
});

const pickPrimaryLabelDosingRawText = (digest: FactsDigest): string | null => {
  const rawTexts = digest.labelDosing
    .map((dose) => (typeof dose.rawText === "string" ? dose.rawText.trim() : ""))
    .filter(Boolean);
  if (!rawTexts.length) return null;
  // Prefer an "Adults:" dosing line when present, otherwise take the first available line.
  const adults = rawTexts.find((text) => /\badult(s)?\b/i.test(text));
  return (adults ?? rawTexts[0] ?? null) || null;
};

const buildUsageDosageField = (digest: FactsDigest): { text: string; basisTags: BasisTag[] } | null => {
  const raw = pickPrimaryLabelDosingRawText(digest);
  if (raw) return { text: raw, basisTags: ["label_fact"] };
  // Avoid empty/missing dosage fields; keep copy non-negative.
  return { text: "Follow label directions.", basisTags: ["general_advice"] };
};

const buildLabelDosingText = (digest: FactsDigest): string | null => {
  const raw = pickPrimaryLabelDosingRawText(digest);
  if (raw) return raw;
  const first = digest.labelDosing[0];
  if (!first) return null;
  const parts: string[] = [];
  const prefix = [first.population, first.age].filter(Boolean).join(" ");
  if (prefix) parts.push(prefix.trim());
  const doseBits = [first.dose, first.frequency].filter(Boolean).join(", ");
  if (doseBits) parts.push(doseBits.trim());
  if (!parts.length) return null;
  return parts.join(": ");
};

const UNKNOWN_DOSE_RE = /\b(unknown|not detailed|not specified|not provided|unspecified|no specific)\b/i;

const normalizeIngredientName = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

const FORM_KEYWORD_RE =
  /\b(oxide|citrate|ascorbate|glycinate|bisglycinate|picolinate|malate|sulfate|chloride|hydrochloride|hcl|phosphate|fumarate|nitrate|orotate|threonate|gluconate|carbonate)\b/i;
const FORM_KEYWORD_RE_GLOBAL =
  /\b(oxide|citrate|ascorbate|glycinate|bisglycinate|picolinate|malate|sulfate|chloride|hydrochloride|hcl|phosphate|fumarate|nitrate|orotate|threonate|gluconate|carbonate)\b/gi;

const extractFormKeywords = (text: string): string[] => {
  const hits = new Set<string>();
  let match: RegExpExecArray | null;
  FORM_KEYWORD_RE_GLOBAL.lastIndex = 0;
  while ((match = FORM_KEYWORD_RE_GLOBAL.exec(text))) {
    const token = (match[1] ?? "").toLowerCase();
    if (token) hits.add(token);
  }
  return [...hits];
};

const buildAllowedFormKeywordSet = (digest: FactsDigest): Set<string> => {
  const allowed = new Set<string>();
  digest.actives.forEach((active) => {
    if (!canMentionChemicalForm(active)) return;
    const evidence = (active.chemicalFormEvidence ?? active.evidenceText ?? active.chemicalForm ?? "").toString();
    extractFormKeywords(evidence).forEach((kw) => allowed.add(kw));
  });
  return allowed;
};

const hasForbiddenFormKeyword = (text: string, allowed: Set<string>): boolean => {
  const keywords = extractFormKeywords(text);
  if (keywords.length === 0) return false;
  if (allowed.size === 0) return true;
  return keywords.some((kw) => !allowed.has(kw));
};

const buildLnhpdDeterministicTiming = (labelDosingText: string | null): { text: string; basisTags: BasisTag[] } => {
  const raw = (labelDosingText ?? "").trim();
  const lower = raw.toLowerCase();

  // Explicit label time-of-day / meal timing words (label_fact).
  const explicit: Array<{ re: RegExp; text: string }> = [
    { re: /\b(with|after|before)\s+breakfast\b/i, text: "With breakfast." },
    { re: /\b(with|after|before)\s+lunch\b/i, text: "With lunch." },
    { re: /\b(with|after|before)\s+dinner\b/i, text: "With dinner." },
    { re: /\bafter\s+meals?\b/i, text: "After meals." },
    { re: /\bwith\s+meals?\b/i, text: "With meals." },
    { re: /\bbefore\s+meals?\b/i, text: "Before meals." },
    { re: /\bbedtime\b|\bbefore\s+bed\b|\bat\s+night\b/i, text: "At bedtime." },
    { re: /\bmorning\b/i, text: "In the morning." },
    { re: /\bevening\b/i, text: "In the evening." },
  ];
  for (const item of explicit) {
    if (item.re.test(raw)) {
      return { text: item.text, basisTags: ["label_fact"] };
    }
  }

  // Frequency templates (general_advice). Keep conservative language (suggestion, not an instruction).
  const timesMatch = lower.match(/\b(\d+)\s*(?:times|x)\s*(?:per\s*)?(?:day|daily)\b/);
  const times = timesMatch ? Number(timesMatch[1]) : NaN;
  if (Number.isFinite(times) && times > 0) {
    if (times === 1) {
      return { text: "Once daily; choose a consistent time.", basisTags: ["general_advice"] };
    }
    if (times === 2) {
      return {
        text: "Twice daily; spacing doses across the day is common (e.g., morning and evening).",
        basisTags: ["general_advice"],
      };
    }
    if (times === 3) {
      return {
        text: "Three times daily; spacing doses across the day is common (e.g., morning, midday, and evening).",
        basisTags: ["general_advice"],
      };
    }
    return { text: `${times} times daily; spacing doses across the day is common.`, basisTags: ["general_advice"] };
  }

  if (/\bdaily\b/i.test(raw)) {
    return { text: "Once daily; choose a consistent time.", basisTags: ["general_advice"] };
  }

  return { text: "Choose a consistent time that fits your routine.", basisTags: ["general_advice"] };
};

const buildLnhpdDeterministicWithFood = (
  labelDosingText: string | null,
  actives: FactsDigest["actives"],
): { value: boolean | null; text: string | null; basisTags: BasisTag[] } => {
  const raw = (labelDosingText ?? "").trim();
  if (/\b(with food|with meals?|with a meal)\b/i.test(raw)) {
    return { value: true, text: "With food.", basisTags: ["label_fact"] };
  }
  if (/\bafter\s+meals?\b/i.test(raw)) {
    return { value: true, text: "After meals.", basisTags: ["label_fact"] };
  }
  if (/\b(on an empty stomach|empty stomach)\b/i.test(raw)) {
    return { value: false, text: "On an empty stomach.", basisTags: ["label_fact"] };
  }
  if (/\bbefore\s+meals?\b/i.test(raw)) {
    return { value: false, text: "Before meals.", basisTags: ["label_fact"] };
  }

  const activeNames = actives.map((a) => normalizeIngredientName(a.name));
  const hasStomachSensitiveMineral = activeNames.some((name) => ["zinc", "iron", "magnesium"].includes(name));
  if (hasStomachSensitiveMineral) {
    return {
      value: null,
      text: "Optional; take with food if it upsets your stomach.",
      basisTags: ["general_advice"],
    };
  }
  return { value: null, text: "Optional; follow the label directions.", basisTags: ["general_advice"] };
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

const buildActiveAmountText = (active: FactsDigest["actives"][number]): string | null => {
  if (active.amount !== null && active.unit) {
    return `${active.amount} ${active.unit} per serving`;
  }
  if (active.amountText) return active.amountText;
  return null;
};

const buildNotProvidedField = (text = "Not provided by source."): { text: string; basisTags: BasisTag[] } => ({
  text,
  basisTags: ["not_provided"],
});

const buildIngredientWhatItDoesFallback = (name: string): { text: string; basisTags: BasisTag[] } => ({
  text: getIngredientFallbackText(name),
  basisTags: ["general_advice"],
});

const buildLabelField = (text: string): { text: string; basisTags: BasisTag[] } => ({
  text,
  basisTags: ["label_fact"],
});

const buildDeliveryFormExplain = (deliveryForm: string | null): { text: string; basisTags: BasisTag[] } | null => {
  if (!deliveryForm) return null;
  return { text: `Delivery form: ${deliveryForm}.`, basisTags: ["label_fact"] };
};

const buildChemicalFormExplainFallback = (
  active: FactsDigest["actives"][number],
  kbSentence: string | null,
): { text: string; basisTags: BasisTag[] } => {
  if (kbSentence) {
    return { text: kbSentence, basisTags: ["label_fact", "ingredient_inference"] };
  }
  const confidence = active.chemicalFormConfidence ?? null;
  if (!active.chemicalForm || confidence === null || confidence < 0.6) {
    return {
      text: "The label does not specify chemical form. At typical doses, dose and diet often matter more.",
      basisTags: ["not_provided", "general_advice"],
    };
  }
  return { text: `Chemical form: ${active.chemicalForm}.`, basisTags: ["label_fact"] };
};

const buildPerServingDoseContext = (
  active: FactsDigest["actives"][number],
  servingSize: string | null,
): { text: string; basisTags: BasisTag[] } => {
  const amountText = buildActiveAmountText(active);
  if (!amountText) {
    return buildNotProvidedField("Per-serving amount is not listed on this source record.");
  }
  const suffix = servingSize ? ` (Serving size: ${servingSize})` : "";
  return buildLabelField(`${amountText}${suffix}`);
};

const canMentionChemicalForm = (active: FactsDigest["actives"][number]): boolean => {
  const confidence = active.chemicalFormConfidence ?? null;
  const chemicalForm = typeof active.chemicalForm === "string" ? active.chemicalForm.trim() : "";
  if (!chemicalForm) return false;
  if (confidence === null || confidence < 0.6) return false;
  // Guard against LNHPD meta fields that repeat the ingredient name (trivial, not a form).
  if (normalizeIngredientName(chemicalForm) === normalizeIngredientName(active.name)) return false;
  const evidence = (active.chemicalFormEvidence ?? active.evidenceText ?? chemicalForm).toLowerCase();
  const token = chemicalForm.toLowerCase();
  return evidence.includes(token);
};

const buildChemicalFormExplainEvidenceOnly = (active: FactsDigest["actives"][number]): { text: string; basisTags: BasisTag[] } => {
  const evidence = (active.chemicalFormEvidence ?? active.chemicalForm ?? "").toString().trim();
  const cleaned = evidence.length > 140 ? `${evidence.slice(0, 137).trim()}...` : evidence;
  return buildLabelField(`Listed on the label as: ${cleaned}.`);
};

const buildLnhpdIngredientsDetailKbFirst = (params: {
  digest: FactsDigest;
  labelDosingText: string | null;
  allowInternalDebug: boolean;
}): {
  detail: IngredientsDetail;
  debug?: Record<string, unknown>;
} => {
  const { digest, labelDosingText, allowInternalDebug } = params;
  const kb = getKbRuntime();

  const formResolveSources: Record<string, string> = {};
  const formEvidenceTexts: Record<string, string | null> = {};
  const formSentenceIds: Record<string, string | null> = {};
  const formExcerptIds: Record<string, string | null> = {};
  const formReferenceIds: Record<string, string | null> = {};
  const formEvidenceGrades: Record<string, string | null> = {};

  const purposeText = digest.claims.labelPurposes?.[0] ?? null;
  const whatItDoesFromPurpose = purposeText
    ? { text: purposeText.endsWith(".") ? purposeText : `${purposeText}.`, basisTags: ["regulatory_claim"] as BasisTag[] }
    : null;

  const items: IngredientsDetail["items"] = digest.actives.map((active) => {
    const kbResult = kb
      ? lookupKbFormExplain({
        ingredientName: active.name,
        chemicalForm: active.chemicalForm ?? null,
        chemicalFormConfidence: active.chemicalFormConfidence ?? null,
        chemicalFormSource: active.chemicalFormSource ?? "none",
        chemicalFormEvidence: active.chemicalFormEvidence ?? null,
      })
      : {
        sentence: null,
        sentenceId: null,
        excerptId: null,
        referenceId: null,
        evidenceGrade: null,
        resolveSource: "none" as const,
        evidenceText: null,
      };

    formResolveSources[active.name] = kbResult.resolveSource;
    formEvidenceTexts[active.name] = kbResult.evidenceText ?? active.chemicalFormEvidence ?? null;
    formSentenceIds[active.name] = kbResult.sentenceId;
    formExcerptIds[active.name] = kbResult.excerptId;
    formReferenceIds[active.name] = kbResult.referenceId;
    formEvidenceGrades[active.name] = kbResult.evidenceGrade;

    const perServing = buildPerServingDoseContext(active, digest.serving.servingSize).text;
    const doseParts: string[] = [];
    if (perServing && !isPlaceholderishText(perServing)) {
      doseParts.push(perServing.endsWith(".") ? perServing : `${perServing}.`);
    }
    if (labelDosingText) doseParts.push(`Label dosing: ${labelDosingText}.`);
    const doseContext = buildLabelField(
      doseParts.length
        ? doseParts.join(" ").replace(/\s+/g, " ").trim()
        : "Label dosing details were not provided in this source record.",
    );

    const whatItDoes = whatItDoesFromPurpose ?? buildIngredientWhatItDoesFallback(active.name);

    const chemicalFormExplain = (() => {
      if (kbResult.sentence) {
        return { text: kbResult.sentence, basisTags: ["label_fact", "ingredient_inference"] as BasisTag[] };
      }
      if (canMentionChemicalForm(active)) {
        return buildChemicalFormExplainEvidenceOnly(active);
      }
      // Productized, short, and honest: no form token without evidence.
      return {
        text: "Chemical form isn't disclosed on the label, so we don't assume a specific form.",
        basisTags: ["not_provided"] as BasisTag[],
      };
    })();

    return {
      name: active.name,
      whatItDoes,
      doseContext,
      chemicalFormExplain,
      deliveryFormExplain: buildDeliveryFormExplain(active.deliveryForm ?? null),
    };
  });

  const activeSummary = digest.actives
    .map((active) => {
      const amt = buildActiveAmountText(active);
      return amt ? `${active.name} (${amt.replace(/ per serving$/i, "")})` : active.name;
    })
    .filter(Boolean)
    .join(", ");
  const summaryParts: string[] = [];
  if (activeSummary) summaryParts.push(`Actives: ${activeSummary}.`);
  if (labelDosingText) summaryParts.push(`Label dosing: ${labelDosingText}.`);
  const overallSummary = summaryParts.length ? buildLabelField(summaryParts.join(" ")) : null;

  const detail: IngredientsDetail = { items, overallSummary, overlapNotes: null };
  if (!allowInternalDebug) return { detail };

  return {
    detail,
    debug: {
      formResolveSources,
      formEvidenceTexts,
      formSentenceIds,
      formExcerptIds,
      formReferenceIds,
      formEvidenceGrades,
    },
  };
};

const buildDetailSkeleton = (digest: FactsDigest, labelDosingText: string | null): IngredientsDetail => {
  const doseField = labelDosingText ? buildLabelField(labelDosingText) : buildNotProvidedField();
  return {
    items: digest.actives.map((active) => ({
      name: active.name,
      whatItDoes: buildIngredientWhatItDoesFallback(active.name),
      doseContext: doseField,
      chemicalFormExplain: buildNotProvidedField("Chemical form is not listed on this source record."),
      deliveryFormExplain: buildDeliveryFormExplain(active.deliveryForm ?? null),
    })),
    overallSummary: null,
    overlapNotes: null,
  };
};

const buildDsldKbFallbackDetail = (
  digest: FactsDigest,
): {
  detail: IngredientsDetail;
  formResolveSources: Record<string, string>;
  formEvidenceTexts: Record<string, string | null>;
  formSentenceIds: Record<string, string | null>;
  formExcerptIds: Record<string, string | null>;
  formReferenceIds: Record<string, string | null>;
  formEvidenceGrades: Record<string, string | null>;
  formSupportStrengths: Record<string, "strong" | "moderate" | "weak" | null>;
} => {
  const kb = getKbRuntime();
  const formResolveSources: Record<string, string> = {};
  const formEvidenceTexts: Record<string, string | null> = {};
  const formSentenceIds: Record<string, string | null> = {};
  const formExcerptIds: Record<string, string | null> = {};
  const formReferenceIds: Record<string, string | null> = {};
  const formEvidenceGrades: Record<string, string | null> = {};
  const formSupportStrengths: Record<string, "strong" | "moderate" | "weak" | null> = {};

  const gradeToStrength = (grade: string | null): "strong" | "moderate" | "weak" | null => {
    if (!grade) return null;
    const normalized = String(grade).trim().toUpperCase();
    const first = normalized[0];
    if (first === "A") return "strong";
    if (first === "B") return "moderate";
    if (first === "C") return "weak";
    return null;
  };
  return {
    detail: {
      items: digest.actives.map((active) => {
        const kbResult = kb
          ? lookupKbFormExplain({
            ingredientName: active.name,
            chemicalForm: active.chemicalForm ?? null,
            chemicalFormConfidence: active.chemicalFormConfidence ?? null,
            chemicalFormSource: active.chemicalFormSource ?? "none",
            chemicalFormEvidence: active.chemicalFormEvidence ?? null,
          })
          : {
            sentence: null,
            sentenceId: null,
            excerptId: null,
            referenceId: null,
            evidenceGrade: null,
            resolveSource: "none" as const,
            evidenceText: null,
          };
        formResolveSources[active.name] = kbResult.resolveSource;
        formEvidenceTexts[active.name] = kbResult.evidenceText;
        formSentenceIds[active.name] = kbResult.sentenceId ?? null;
        formExcerptIds[active.name] = kbResult.excerptId ?? null;
        formReferenceIds[active.name] = kbResult.referenceId ?? null;
        formEvidenceGrades[active.name] = kbResult.evidenceGrade ?? null;
        formSupportStrengths[active.name] = gradeToStrength(kbResult.evidenceGrade ?? null);
        return {
          name: active.name,
          whatItDoes: buildIngredientWhatItDoesFallback(active.name),
          doseContext: buildPerServingDoseContext(active, digest.serving.servingSize ?? null),
          chemicalFormExplain: buildChemicalFormExplainFallback(active, kbResult.sentence),
          deliveryFormExplain: buildDeliveryFormExplain(active.deliveryForm ?? null),
        };
      }),
      overallSummary: null,
      overlapNotes: null,
    },
    formResolveSources,
    formEvidenceTexts,
    formSentenceIds,
    formExcerptIds,
    formReferenceIds,
    formEvidenceGrades,
    formSupportStrengths,
  };
};

const mergeDsldWhatItDoes = (baseDetail: IngredientsDetail, minimal: DsldDetailMinimal | null): IngredientsDetail => {
  if (!minimal) return baseDetail;
  const map = new Map<string, DsldDetailMinimal["items"][number]>();
  minimal.items.forEach((item) => {
    map.set(normalizeIngredientName(item.name), item);
  });
  const items = baseDetail.items.map((item) => {
    const match = map.get(normalizeIngredientName(item.name));
    if (!match) return item;
    return { ...item, whatItDoes: match.whatItDoes };
  });
  const overallSummary = minimal.overallSummary ?? baseDetail.overallSummary;
  const overlapNotes = minimal.overlapNotes ?? baseDetail.overlapNotes;
  return { ...baseDetail, items, overallSummary, overlapNotes };
};

const resolveDsldWhatItDoesStatus = (
  errorCode: string | null | undefined,
): { status: "llm" | "skipped" | "failed"; reason: string | null } | null => {
  if (!errorCode) return null;
  const trimmed = String(errorCode).trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("DSLD_WHATITDOES_")) return null;
  const suffix = trimmed.slice("DSLD_WHATITDOES_".length);
  if (suffix === "llm") return { status: "llm", reason: null };
  if (suffix === "skipped") return { status: "skipped", reason: null };
  if (suffix === "failed") return { status: "failed", reason: null };
  if (suffix.startsWith("skipped")) return { status: "skipped", reason: null };
  if (suffix.startsWith("failed")) return { status: "failed", reason: null };
  return { status: "skipped", reason: null };
};

const resolveFallbackUsed = (errorCode: string | null | undefined): "kb_dsld" | "skeleton" | null => {
  if (!errorCode) return null;
  if (errorCode === "FALLBACK_KB_DSLD") return "kb_dsld";
  if (errorCode === "FALLBACK_SKELETON") return "skeleton";
  return null;
};

type IdentityType = FactsIdentityType;
type Locale = "en" | "zh";

const queueDsldDetailEnrichment = (params: {
  identityType: IdentityType;
  identityValue: string;
  locale: Locale;
  promptVersionForCache: string;
  factsDigestHash: string;
  factsSourceVersion: string;
  sectionKey: string;
  rateKey: string;
  digestRowFactsDigestJson: unknown;
  digest: FactsDigest;
  requestedLimit: number;
  cursor: number;
  model: string;
  deepseekKey: string;
}): void => {
  const jobKey = `dsld:${params.rateKey}:${params.factsDigestHash}`;
  if (dsldDetailEnrichInFlight.has(jobKey)) return;

  const task = (async () => {
    const nowMs = Date.now();
    const cachedDetail = await getAnalysisIdentityCache(
      {
        identityType: params.identityType,
        identityValue: params.identityValue,
        locale: params.locale,
        promptVersion: params.promptVersionForCache,
        factsDigestHash: params.factsDigestHash,
        section: params.sectionKey,
      },
      { timeoutMs: 800 },
    ).catch(() => null);

    if (cachedDetail?.status === "complete" && cachedDetail.payload) {
      return;
    }

    const pendingAgeMs = cachedDetail?.updated_at
      ? Math.max(0, nowMs - Date.parse(cachedDetail.updated_at))
      : null;
    const lockedUntilMs = cachedDetail?.locked_until ? Date.parse(cachedDetail.locked_until) : null;
    const isStaleJob = cachedDetail
      ? pendingAgeMs !== null && pendingAgeMs > ANALYSIS_DETAIL_STALE_MS
        ? true
        : lockedUntilMs !== null && Number.isFinite(lockedUntilMs) && lockedUntilMs <= nowMs
      : false;

    if ((cachedDetail?.status === "pending" || cachedDetail?.status === "running") && !isStaleJob) {
      // Another instance is already working on it.
      return;
    }

    const lockUntil = new Date(nowMs + ANALYSIS_DETAIL_LOCK_MS).toISOString();
    const attempts = (cachedDetail?.attempts ?? 0) + 1;

    let claimed = false;
    if (cachedDetail) {
      claimed = await updateAnalysisIdentityCache(
        {
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale: params.locale,
          promptVersion: params.promptVersionForCache,
          factsDigestHash: params.factsDigestHash,
          section: params.sectionKey,
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
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale: params.locale,
          promptVersion: params.promptVersionForCache,
          factsDigestHash: params.factsDigestHash,
          factsSourceVersion: params.factsSourceVersion,
          section: params.sectionKey,
          status: "running",
          attempts,
          lockedUntil: lockUntil,
          factsDigestJson: params.digestRowFactsDigestJson,
          expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
        },
        { timeoutMs: 1200 },
      ).catch(() => false);
    }

    if (!claimed) {
      return;
    }

    const totalActives = params.digest.actives.length;
    const sliceStart = Math.min(params.cursor, totalActives);
    const sliceEnd = Math.min(sliceStart + params.requestedLimit, totalActives);
    const detailDigest: FactsDigest = { ...params.digest, actives: params.digest.actives.slice(sliceStart, sliceEnd) };

    const buildDetailContext = (detailFacts: FactsDigest, limitValue: number) =>
      `DETAIL_PAGE: ${JSON.stringify({
        limit: limitValue,
        cursor: sliceStart,
        totalActives,
      })}\nFACTS_DIGEST_JSON: ${JSON.stringify(detailFacts)}`;

    const detailTimeoutMs = ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD;
    const detailMaxTokens = ANALYSIS_DETAIL_MAX_TOKENS_DSLD;
    const detailRescueMaxTokens = ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD;
    const primaryPromptOverride = "dsld_short";
    const rescuePromptOverride = "dsld_rescue";

    const start = performance.now();
    let dsldMinimal: DsldDetailMinimal | null = null;
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

    let detailRaw: Record<string, unknown> | null = null;
    let dsldParsed: ReturnType<typeof DsldDetailMinimalSchema.safeParse> | null = null;
    try {
      let release: (() => void) | null = null;
      try {
        release = await deepseekDsldMinimalSemaphore.acquire({
          timeoutMs: RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS,
        });
      } catch {
        dsldLlmSkipReason = "semaphore_busy";
      }
      if (release) {
        dsldLlmAttempted = true;
        try {
          detailRaw = await fetchIngredientsDetailV3(
            buildDetailContext(detailDigest, params.requestedLimit),
            params.model,
            params.deepseekKey,
            {
              breaker: deepseekBreaker,
              timeoutMs: detailTimeoutMs,
              retry: { maxAttempts: 1 },
              maxTokens: detailMaxTokens,
              debugOnError: true,
              promptOverride: primaryPromptOverride,
            },
          );
        } finally {
          release();
        }
      }
    } catch {
      dsldLlmSkipReason = dsldLlmSkipReason ?? "LLM_REQUEST_FAILED";
    }

    if (detailRaw) {
      dsldParsed = DsldDetailMinimalSchema.safeParse(detailRaw);
      dsldMinimal = dsldParsed.success ? dsldParsed.data : null;
    }

    const debugErrorCode = getDebugErrorCode(detailRaw);
    const shouldRescue = !dsldMinimal && (isParseFailure(debugErrorCode) || (detailRaw !== null && !dsldParsed?.success));
    if (shouldRescue) {
      const rescueLimit = Math.min(params.requestedLimit, ANALYSIS_DETAIL_LIMIT_RESCUE);
      const rescueSliceEnd = Math.min(sliceStart + rescueLimit, totalActives);
      const rescueDigest: FactsDigest = {
        ...params.digest,
        actives: params.digest.actives.slice(sliceStart, rescueSliceEnd),
      };
      try {
        let release: (() => void) | null = null;
        try {
          release = await deepseekDsldMinimalSemaphore.acquire({
            timeoutMs: RESILIENCE_DEEPSEEK_DSLD_MIN_QUEUE_TIMEOUT_MS,
          });
        } catch {
          // no-op
        }
        if (release) {
          try {
            const rescueRaw = await fetchIngredientsDetailV3(
              buildDetailContext(rescueDigest, rescueLimit),
              params.model,
              params.deepseekKey,
              {
                breaker: deepseekBreaker,
                timeoutMs: detailTimeoutMs,
                retry: { maxAttempts: 1 },
                maxTokens: detailRescueMaxTokens,
                debugOnError: true,
                promptOverride: rescuePromptOverride,
              },
            );
            if (rescueRaw) {
              const rescueParsed = DsldDetailMinimalSchema.safeParse(rescueRaw);
              if (rescueParsed.success) {
                dsldMinimal = rescueParsed.data;
              }
            }
          } finally {
            release();
          }
        }
      } catch {
        // swallow
      }
    }

    const dsldBase = buildDsldKbFallbackDetail(detailDigest);
    const detailPayload = mergeDsldWhatItDoes(dsldBase.detail, dsldMinimal);

    const dsldWhatItDoesUsed = Boolean(dsldMinimal);
    const dsldWhatItDoesStatus: "llm" | "skipped" | "failed" = dsldWhatItDoesUsed
      ? "llm"
      : dsldLlmSkipReason
        ? "skipped"
        : dsldLlmAttempted
          ? "failed"
          : "skipped";
    const dsldWhatItDoesReason = dsldWhatItDoesUsed
      ? null
      : dsldLlmSkipReason ?? (detailRaw && debugErrorCode ? debugErrorCode : null) ?? "LLM_UNAVAILABLE";

    const shouldUseShortTtl = !dsldWhatItDoesUsed;
    const detailExpiresAt = new Date(
      Date.now() + (shouldUseShortTtl ? ANALYSIS_DETAIL_FALLBACK_TTL_MS : ANALYSIS_IDENTITY_CACHE_TTL_MS),
    ).toISOString();
    const timingMs = Math.round(performance.now() - start);

    void upsertAnalysisIdentityCache(
      {
        identityType: params.identityType,
        identityValue: params.identityValue,
        locale: params.locale,
        promptVersion: params.promptVersionForCache,
        factsDigestHash: params.factsDigestHash,
        factsSourceVersion: params.factsSourceVersion,
        section: params.sectionKey,
        status: "complete",
        payload: detailPayload,
        factsDigestJson: params.digestRowFactsDigestJson,
        attempts,
        lockedUntil: null,
        lastError: dsldWhatItDoesUsed ? null : dsldWhatItDoesReason,
        errorCode: dsldWhatItDoesUsed ? null : `DSLD_WHATITDOES_${dsldWhatItDoesStatus}`,
        expiresAt: detailExpiresAt,
      },
      { timeoutMs: 1200 },
    );

    // Best-effort observability.
    if (!dsldWhatItDoesUsed && dsldWhatItDoesReason) {
      console.warn("[analysis-section] dsld enrichment completed without LLM", {
        reason: dsldWhatItDoesReason,
        timingMs,
        identity: `${params.identityType}:${params.identityValue}`,
        section: params.sectionKey,
      });
    }
  })()
    .catch((error) => {
      console.warn("[analysis-section] dsld enrichment task crashed", error);
    })
    .finally(() => {
      dsldDetailEnrichInFlight.delete(jobKey);
    });

  dsldDetailEnrichInFlight.set(jobKey, task);
};

const applyFormExplainGuard = (detail: IngredientsDetail, detailDigest: FactsDigest): IngredientsDetail => {
  const items = detail.items.map((item) => {
    const match = detailDigest.actives.find(
      (active) => normalizeIngredientName(active.name) === normalizeIngredientName(item.name),
    );
    const confidence = match?.chemicalFormConfidence ?? null;
    const hasEvidence = Boolean(match?.chemicalForm) && confidence !== null && confidence >= 0.6;
    const chemicalFormExplain = hasEvidence
      ? item.chemicalFormExplain
      : match
        ? buildChemicalFormExplainFallback(match, null)
        : { text: "Chemical form is not listed on this source record.", basisTags: ["not_provided"] as BasisTag[] };
    const deliveryFormExplain = match?.deliveryForm ? item.deliveryFormExplain : null;
    return { ...item, chemicalFormExplain, deliveryFormExplain };
  });
  return { ...detail, items };
};

const sanitizeDetailDoseContext = (
  detail: IngredientsDetail,
  detailDigest: FactsDigest,
  labelDosingText: string,
): IngredientsDetail => {
  const labelLine = `Label dosing: ${labelDosingText}`;
  const missingNote = "Some details were not provided by the source (e.g., delivery form).";
  const actives = detailDigest.actives;
  const items = detail.items.map((item) => {
    if (!UNKNOWN_DOSE_RE.test(item.doseContext.text)) {
      return item;
    }
    const match = actives.find(
      (active) => normalizeIngredientName(active.name) === normalizeIngredientName(item.name),
    );
    const amountText = match ? buildActiveAmountText(match) : null;
    const parts = [];
    if (amountText) parts.push(amountText);
    parts.push(labelLine);
    const newDoseContext = `${parts.join(". ")}.`;
    return { ...item, doseContext: { text: newDoseContext, basisTags: ["label_fact"] as BasisTag[] } };
  });

  let overallSummary = detail.overallSummary;
  if (overallSummary?.text && UNKNOWN_DOSE_RE.test(overallSummary.text)) {
    const sentences = overallSummary.text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence && !UNKNOWN_DOSE_RE.test(sentence));
    let cleaned = sentences.join(" ").trim();
    const baseTags = overallSummary.basisTags ?? [];
    const nextTags = Array.from(new Set<BasisTag>([...baseTags, "not_provided"]));
    if (!cleaned) {
      cleaned = missingNote;
    } else {
      if (!cleaned.endsWith(".")) cleaned = `${cleaned}.`;
      cleaned = `${cleaned} ${missingNote}`;
    }
    overallSummary = { ...overallSummary, text: cleaned, basisTags: nextTags };
  }

  return { ...detail, items, overallSummary };
};

const buildAnalysisBundleSkeleton = (params: {
  digest: FactsDigest;
  deterministicSignals?: DeterministicSignalPack | null;
  bundleId: string;
  revision: number;
  phase: "skeleton" | "fast_ai" | "full_ai";
  locale: "zh" | "en";
  factsDigestHash: string;
  factsSourceVersion: string;
  identityType: FactsDigest["identity"]["type"];
  identityValue: string;
  dataStatus: {
    overview: "pending" | "limited";
    usage: "pending" | "limited";
    safety: "pending" | "limited";
  };
  overlayClaims?: DecisionSupportOverlayClaims | null;
  includeDecisionDebug?: boolean;
}): AnalysisBundle => {
  const patched = applyPatchShadowToFactsDigest({
    digest: params.digest,
    barcodeGtin14: params.identityType === "gtin14" ? params.identityValue : null,
  });
  const digest = patched.digest;
  const isSkeleton = params.phase === "skeleton";
  const scoreMeta = resolveDigestScoreMeta(digest);
  const decisionSupport = compileDecisionSupport({
    digest,
    factsDigestHash: params.factsDigestHash,
    viewMode: DECISION_SUPPORT_DEFAULT_VIEW_MODE,
    locale: params.locale,
    flagsSnapshot: collectDecisionSupportFlagsSnapshot(),
    patchActivation: patched.activation,
    overlayClaims: params.overlayClaims ?? null,
  });
  const baseSafetySignals = buildBaseSafetySignalPack({
    digest,
    deterministicSignals: params.deterministicSignals,
  });
  const usageScheduleRows = toUsageLabelDoseRows(params.deterministicSignals, digest.labelDosing);
  return {
    meta: {
      schemaVersion: 4,
      promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
      sourceType: digest.sourceType,
      sourceTypeFinal: !isSkeleton,
      scoreAvailable: scoreMeta.scoreAvailable,
      scoreReasonCode: scoreMeta.scoreReasonCode,
      inferenceOnly: scoreMeta.inferenceOnly,
      detailReady: !isSkeleton && digest.actives.length > 0,
      deterministicSignals: summarizeDeterministicSignals(params.deterministicSignals),
      authoritativeIdentity: { type: params.identityType, value: params.identityValue },
      locale: params.locale,
      phase: params.phase,
      bundleId: params.bundleId,
      revision: params.revision,
      factsDigestHash: params.factsDigestHash,
      factsSourceVersion: params.factsSourceVersion,
      decisionSupportDigest: decisionSupport.digest,
      decisionInputsHash: decisionSupport.decisionInputsHash,
      decisionContractVersion: decisionSupport.decisionContractVersion,
      overlayClaimsHash: decisionSupport.overlayClaimsHash,
      overlayAugmentationVersion: decisionSupport.overlayAugmentationVersion,
      overlayAugmentationSource: decisionSupport.overlayAugmentationSource,
      patchActivationCanonical: decisionSupport.patchActivationCanonical,
      ...(params.includeDecisionDebug && decisionSupport.decisionDebug
        ? {
          decisionDebug: decisionSupport.decisionDebug,
        }
        : {}),
      decisionSupportInline: toDecisionSupportInline(decisionSupport),
      serverCommitSha: SERVER_COMMIT_SHA,
    },
    sections: {
      overview: {
        layout: "overview_card",
        cover: null,
        detail: null,
        dataStatus: params.dataStatus.overview,
      },
      ingredients: {
        layout: "ingredients_list",
        cover: isSkeleton ? { items: [], totalCount: 0 } : buildIngredientsCover(digest, params.deterministicSignals),
        detail: null,
        dataStatus: isSkeleton ? "pending" : digest.actives.length > 0 ? "complete" : "not_provided",
      },
      usage: {
        layout: "usage_bullets",
        cover: null,
        detail: {
          timingRationale: null,
          withFoodRationale: null,
          scheduleFromLabel: usageScheduleRows,
        },
        dataStatus: params.dataStatus.usage,
      },
      safety: {
        layout: "safety_bullets",
        cover: null,
        detail: {
          warnings: [],
          consultDoctorIf: [],
          redFlags: [],
        },
        signals: baseSafetySignals,
        dataStatus: params.dataStatus.safety,
      },
    },
  };
};

const buildProvisionalAnalysisBundle = (params: {
  bundleId: string;
  locale: "zh" | "en";
  barcodeGtin14: string;
  revision: number;
  phase: "skeleton" | "fast_ai";
  fallbackReason?: string;
}): AnalysisBundle => {
  const factsDigestHash = createHash("sha256")
    .update(`provisional:${params.barcodeGtin14}:${params.bundleId}`)
    .digest("hex");
  const isSkeleton = params.phase === "skeleton";
  const baseSafetySignals = buildBaseSafetySignalPack({ digest: null, safetyDetail: null });
  return {
    meta: {
      schemaVersion: 4,
      promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION_VERSIONED,
      sourceType: "web",
      sourceTypeFinal: !isSkeleton,
      scoreAvailable: false,
      detailReady: false,
      deterministicSignals: null,
      authoritativeIdentity: { type: "gtin14", value: params.barcodeGtin14 },
      locale: params.locale,
      phase: params.phase,
      bundleId: params.bundleId,
      revision: params.revision,
      factsDigestHash,
      factsSourceVersion: "provisional:pending",
      fallback: params.fallbackReason ? { code: params.fallbackReason } : undefined,
      fallbackReason: params.fallbackReason,
      serverCommitSha: SERVER_COMMIT_SHA,
    },
    sections: {
      overview: {
        layout: "overview_card",
        cover: null,
        detail: null,
        dataStatus: isSkeleton ? "pending" : "limited",
      },
      ingredients: {
        layout: "ingredients_list",
        cover: { items: [], totalCount: 0 },
        detail: null,
        dataStatus: isSkeleton ? "pending" : "limited",
      },
      usage: {
        layout: "usage_bullets",
        cover: null,
        detail: {
          timingRationale: null,
          withFoodRationale: null,
          scheduleFromLabel: [],
        },
        dataStatus: isSkeleton ? "pending" : "limited",
      },
      safety: {
        layout: "safety_bullets",
        cover: null,
        detail: {
          warnings: [],
          consultDoctorIf: [],
          redFlags: [],
        },
        signals: baseSafetySignals,
        dataStatus: isSkeleton ? "pending" : "limited",
      },
    },
  };
};

const mergeFastAnalysisBundle = (params: {
  skeleton: AnalysisBundle;
  digest: FactsDigest;
  deterministicSignals?: DeterministicSignalPack | null;
  fastOutput: Record<string, unknown> | null;
  overlayClaims?: DecisionSupportOverlayClaims | null;
  includeDecisionDebug?: boolean;
}): AnalysisBundle => {
  const { skeleton, fastOutput } = params;
  const patched = applyPatchShadowToFactsDigest({
    digest: params.digest,
    barcodeGtin14:
      skeleton.meta.authoritativeIdentity?.type === "gtin14"
        ? skeleton.meta.authoritativeIdentity.value
        : null,
  });
  const digest = patched.digest;
  const canReuseInlineDecisionSupport = Boolean(
    skeleton.meta.decisionSupportInline
    && skeleton.meta.decisionSupportDigest
    && skeleton.meta.decisionInputsHash
    && skeleton.meta.decisionContractVersion
    && skeleton.meta.overlayClaimsHash
    && skeleton.meta.patchActivationCanonical,
  );
  const decisionSupport = canReuseInlineDecisionSupport
    ? null
    : compileDecisionSupport({
      digest,
      factsDigestHash: skeleton.meta.factsDigestHash,
      viewMode: DECISION_SUPPORT_DEFAULT_VIEW_MODE,
      locale: skeleton.meta.locale,
      flagsSnapshot: collectDecisionSupportFlagsSnapshot(),
      patchActivation: patched.activation,
      overlayClaims: params.overlayClaims ?? null,
    });
  const decisionSupportMeta = canReuseInlineDecisionSupport
    ? {
      decisionSupportDigest: skeleton.meta.decisionSupportDigest,
      decisionInputsHash: skeleton.meta.decisionInputsHash,
      decisionContractVersion: skeleton.meta.decisionContractVersion,
      overlayClaimsHash: skeleton.meta.overlayClaimsHash,
      overlayAugmentationVersion: skeleton.meta.overlayAugmentationVersion,
      overlayAugmentationSource: skeleton.meta.overlayAugmentationSource,
      patchActivationCanonical: skeleton.meta.patchActivationCanonical,
      decisionDebug: skeleton.meta.decisionDebug,
      decisionSupportInline: skeleton.meta.decisionSupportInline,
    }
    : {
      decisionSupportDigest: decisionSupport!.digest,
      decisionInputsHash: decisionSupport!.decisionInputsHash,
      decisionContractVersion: decisionSupport!.decisionContractVersion,
      overlayClaimsHash: decisionSupport!.overlayClaimsHash,
      overlayAugmentationVersion: decisionSupport!.overlayAugmentationVersion,
      overlayAugmentationSource: decisionSupport!.overlayAugmentationSource,
      patchActivationCanonical: decisionSupport!.patchActivationCanonical,
      decisionDebug: decisionSupport!.decisionDebug,
      decisionSupportInline: toDecisionSupportInline(decisionSupport!),
    };
  const ingredientsCover = buildIngredientsCover(digest, params.deterministicSignals);
  const ingredientsDataStatus = digest.actives.length > 0 ? "complete" : "not_provided";
  const allowedFormKeywords = buildAllowedFormKeywordSet(digest);
  const fallbackSummary = buildFallbackOverviewSummary(digest);
  const fallbackBullets = buildFallbackOverviewBullets(digest);
  const overviewRaw = (fastOutput?.overview ?? {}) as Record<string, unknown>;
  const overviewBulletsRaw = Array.isArray(overviewRaw.bullets) ? overviewRaw.bullets : [];
  const usageRaw = (fastOutput?.usage ?? {}) as Record<string, unknown>;
  const usageBulletsRaw = Array.isArray(usageRaw.bullets) ? usageRaw.bullets : [];
  const safetyRaw = (fastOutput?.safety ?? {}) as Record<string, unknown>;
  const safetyBulletsRaw = Array.isArray(safetyRaw.bullets) ? safetyRaw.bullets : [];
  const placeholderishModelHit = [
    typeof overviewRaw.summary === "string" ? overviewRaw.summary : null,
    ...overviewBulletsRaw.map((item) => (typeof item?.text === "string" ? item.text : null)),
    ...usageBulletsRaw.map((item) => (typeof item?.text === "string" ? item.text : null)),
    usageRaw.bestTimeToTake && typeof usageRaw.bestTimeToTake === "object"
      ? (usageRaw.bestTimeToTake as Record<string, unknown>).text
      : null,
    usageRaw.withFood && typeof usageRaw.withFood === "object"
      ? (usageRaw.withFood as Record<string, unknown>).text
      : null,
    typeof safetyRaw.verdict === "string" ? safetyRaw.verdict : null,
    ...safetyBulletsRaw.map((item) => (typeof item?.text === "string" ? item.text : null)),
  ].some((text) => isPlaceholderishText(text));
  const useDeterministicFallbackForCovers = !fastOutput || placeholderishModelHit;
  const overviewSummaryCandidateRaw =
    !useDeterministicFallbackForCovers && typeof overviewRaw.summary === "string" && overviewRaw.summary.trim()
      ? clampText(overviewRaw.summary.trim(), 180)
      : fallbackSummary;
  const overviewSummaryMeetsContract =
    overviewSummaryCandidateRaw.length >= 40 && hasOverviewAnchorToken(overviewSummaryCandidateRaw, digest);
  const overviewSummaryCandidate =
    hasForbiddenFormKeyword(overviewSummaryCandidateRaw, allowedFormKeywords) || !overviewSummaryMeetsContract
      ? fallbackSummary
      : overviewSummaryCandidateRaw;
  const overviewBulletsFromModel = useDeterministicFallbackForCovers
    ? []
    : overviewBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? clampText(item.text.trim(), 80) : "",
      basisTags: normalizeBasisTags(item?.basisTags, "ingredient_inference"),
    }))
    .filter((item) => item.text)
    .filter((item) => !isPlaceholderishText(item.text))
    .filter((item) => !hasForbiddenFormKeyword(item.text, allowedFormKeywords))
    .slice(0, 2);
  const fallbackBulletsClamped = fallbackBullets
    .map((bullet) => ({
      ...bullet,
      text: clampText(bullet.text.trim(), 80),
    }))
    .filter((bullet) => bullet.text)
    .filter((bullet) => !hasForbiddenFormKeyword(bullet.text, allowedFormKeywords))
    .slice(0, 2);
  const overviewBulletsCandidate =
    overviewBulletsFromModel.length > 0 ? overviewBulletsFromModel : fallbackBulletsClamped;
  const overviewBulletsFinal = (() => {
    // Contract: Overview always shows exactly 2 bullets (UI consistency).
    // If model output is partial (1 bullet), fill deterministically from fallback bullets.
    const out: Array<{ text: string; basisTags: BasisTag[] }> = [];
    const seen = new Set<string>();

    const add = (bullet: { text: string; basisTags: BasisTag[] }) => {
      const text = clampText(bullet.text.trim(), 80);
      if (!text) return;
      if (hasForbiddenFormKeyword(text, allowedFormKeywords)) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ text, basisTags: bullet.basisTags });
    };

    for (const bullet of overviewBulletsCandidate) add(bullet);
    for (const bullet of fallbackBulletsClamped) {
      if (out.length >= 2) break;
      add(bullet);
    }
    while (out.length < 2) {
      const anchor = digest.actives[0]?.name ?? digest.product.name ?? "this supplement";
      add(buildSectionBullet(
        `Review label directions for ${anchor}. Capture Supplement Facts to unlock deeper insights.`,
        ["general_advice"],
      ));
    }
    if (useDeterministicFallbackForCovers) {
      const hasActionHint = out.some((bullet) => /\b(scan|capture|label|supplement facts)\b/i.test(bullet.text));
      if (!hasActionHint) {
        out[1] = buildSectionBullet(
          "Scan the Supplement Facts panel for richer product-specific insights.",
          ["general_advice"],
        );
      }
    }
    return out.slice(0, 2);
  })();
  const dsldNeedsInference =
    digest.sourceType === "dsld" &&
    overviewBulletsFinal.length > 0 &&
    overviewBulletsFinal.every((bullet) => isContainsBullet(bullet.text));
  const dsldForceInference =
    digest.sourceType === "dsld" &&
    (overviewBulletsFinal.length === 0 || dsldNeedsInference);
  const dsldInference = dsldForceInference ? buildDsldInferenceOverview(digest) : null;

  const usageBulletsFromModel = useDeterministicFallbackForCovers
    ? []
    : usageBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text : "",
      basisTags: normalizeBasisTags(item?.basisTags, "general_advice"),
    }))
    .filter((item) => item.text)
    .filter((item) => !isPlaceholderishText(item.text))
    .slice(0, 3);
  const bestTimeToTake =
    !useDeterministicFallbackForCovers && usageRaw.bestTimeToTake && typeof usageRaw.bestTimeToTake === "object"
      ? {
        text: typeof (usageRaw.bestTimeToTake as Record<string, unknown>).text === "string"
          ? (usageRaw.bestTimeToTake as Record<string, unknown>).text as string
          : "",
        basisTags: normalizeBasisTags((usageRaw.bestTimeToTake as Record<string, unknown>).basisTags, "general_advice"),
      }
      : null;
  const withFoodRaw = usageRaw.withFood && typeof usageRaw.withFood === "object" ? usageRaw.withFood as Record<string, unknown> : null;
  const withFoodFromModel = withFoodRaw
    ? {
      value: typeof withFoodRaw.value === "boolean" || withFoodRaw.value === null ? withFoodRaw.value as boolean | null : null,
      text:
        !useDeterministicFallbackForCovers && typeof withFoodRaw.text === "string" && !isPlaceholderishText(withFoodRaw.text)
          ? withFoodRaw.text
          : null,
      basisTags: normalizeBasisTags(withFoodRaw.basisTags, "general_advice"),
    }
    : null;
  const fallbackUsage = buildFallbackUsageSection(digest);
  const fallbackBestTimeToTake = fallbackUsage.cover?.bestTimeToTake ?? {
    text: "Anytime (with meals).",
    basisTags: ["general_advice"] as BasisTag[],
  };
  const fallbackWithFood = fallbackUsage.cover?.withFood ?? {
    value: true,
    text: "Prefer with food unless label states otherwise.",
    basisTags: ["general_advice"] as BasisTag[],
  };
  const dosageField = buildUsageDosageField(digest);
  const labelDosingText = buildLabelDosingText(digest);
  const isLnhpd = digest.sourceType === "lnhpd";
  const bestTimeToTakeFinal =
    isLnhpd
      ? buildLnhpdDeterministicTiming(labelDosingText)
      : bestTimeToTake && bestTimeToTake.text
        ? bestTimeToTake
        : fallbackBestTimeToTake;
  const withFoodFinal =
    isLnhpd
      ? buildLnhpdDeterministicWithFood(labelDosingText, digest.actives)
      : withFoodFromModel && typeof withFoodFromModel.value === "boolean"
        ? withFoodFromModel
        : fallbackWithFood;
  // Since the UI shows dosage/bestTime/withFood as fixed rows, avoid template repetition in LNHPD usage bullets.
  const usageBulletsFinal = isLnhpd ? [] : usageBulletsFromModel;

  const safetyVerdict =
    !useDeterministicFallbackForCovers && typeof safetyRaw.verdict === "string" && safetyRaw.verdict.trim() && !isPlaceholderishText(safetyRaw.verdict)
      ? safetyRaw.verdict.trim()
      : digest.warnings.missingFlag
        ? "Safety details are not included in this source record."
        : "Safety summary unavailable";
  const safetyBullets = useDeterministicFallbackForCovers
    ? []
    : safetyBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text : "",
      basisTags: normalizeBasisTags(item?.basisTags, digest.warnings.missingFlag ? "not_provided" : "general_advice"),
    }))
    .filter((item) => item.text)
    .filter((item) => !isPlaceholderishText(item.text))
    .slice(0, 3);
  const safetyBulletsFinal =
    safetyBullets.length > 0
      ? safetyBullets
      : [
        buildSectionBullet(
          digest.warnings.missingFlag
            ? "Safety details are not available from this source. If pregnant, nursing, or taking medication, consult your clinician."
            : "No specific warnings found. If pregnant, nursing, or taking medication, consult your clinician before use.",
          ["general_advice"],
        ),
      ];

  const overviewStatus = overviewBulletsFinal.length > 0 ? "complete" : "limited";
  const usageStatus =
    usageBulletsFinal.length > 0 || bestTimeToTakeFinal || withFoodFinal || dosageField ? "complete" : "limited";
  const safetyStatus = digest.warnings.missingFlag ? "not_provided" : safetyBulletsFinal.length > 0 ? "complete" : "limited";
  const safetyTag = resolveSourceBasisTag(digest.sourceType);
  const safetyDetailFinal = {
    warnings: digest.warnings.warnings.map((warning) => buildSectionBullet(warning, [safetyTag])),
    consultDoctorIf: digest.warnings.consultDoctorIf.map((item) => buildSectionBullet(item, [safetyTag])),
    redFlags: digest.warnings.redFlags.map((item) => buildSectionBullet(item, [safetyTag])),
  };
  const safetySignalsFinal = buildBaseSafetySignalPack({
    digest,
    safetyDetail: safetyDetailFinal,
    deterministicSignals: params.deterministicSignals,
  });
  const usageScheduleRows = toUsageLabelDoseRows(params.deterministicSignals, digest.labelDosing);

  // P0-0: Coverage snapshot for rev1 diagnostics
  console.info("[analysis_bundle] cover_contract", {
    source: digest.sourceType,
    overviewHasSummary: Boolean(dsldInference?.summary ?? overviewSummaryCandidate),
    overviewBulletCount: (dsldInference?.bullets ?? overviewBulletsFinal).length,
    ingredientsCount: digest.actives.length,
    usageHasDosage: Boolean(dosageField),
    usageHasBestTime: Boolean(bestTimeToTakeFinal?.text),
    usageBulletCount: usageBulletsFinal.length,
    safetyBulletCount: safetyBulletsFinal.length,
    safetyVerdictPresent: Boolean(safetyVerdict),
    fastFailed: !fastOutput,
    placeholderishModelHit,
    deterministicFallbackUsed: useDeterministicFallbackForCovers,
  });

  return {
    ...skeleton,
    meta: {
      ...skeleton.meta,
      sourceType: digest.sourceType,
      sourceTypeFinal: true,
      detailReady: digest.actives.length > 0,
      deterministicSignals: summarizeDeterministicSignals(params.deterministicSignals),
      phase: "fast_ai",
      revision: skeleton.meta.revision + 1,
      decisionSupportDigest: decisionSupportMeta.decisionSupportDigest,
      decisionInputsHash: decisionSupportMeta.decisionInputsHash,
      decisionContractVersion: decisionSupportMeta.decisionContractVersion,
      overlayClaimsHash: decisionSupportMeta.overlayClaimsHash,
      overlayAugmentationVersion: decisionSupportMeta.overlayAugmentationVersion,
      overlayAugmentationSource: decisionSupportMeta.overlayAugmentationSource,
      patchActivationCanonical: decisionSupportMeta.patchActivationCanonical,
      ...(params.includeDecisionDebug && decisionSupportMeta.decisionDebug
        ? {
          decisionDebug: decisionSupportMeta.decisionDebug,
        }
        : {}),
      decisionSupportInline: decisionSupportMeta.decisionSupportInline,
    },
    sections: {
      overview: {
        ...skeleton.sections.overview,
        cover: {
          summary: dsldInference?.summary ?? overviewSummaryCandidate,
          bullets: dsldInference?.bullets ?? overviewBulletsFinal,
        },
        detail: {
          summary: dsldInference?.summary ?? overviewSummaryCandidate,
          bullets: dsldInference?.bullets ?? overviewBulletsFinal,
        },
        dataStatus: overviewStatus,
      },
      ingredients: {
        ...skeleton.sections.ingredients,
        cover: ingredientsCover,
        detail: null,
        dataStatus: ingredientsDataStatus,
      },
      usage: {
        ...skeleton.sections.usage,
        cover: {
          bullets: usageBulletsFinal,
          bestTimeToTake: bestTimeToTakeFinal,
          withFood: withFoodFinal,
          dosage: dosageField ?? null,
        },
        detail: {
          timingRationale: null,
          withFoodRationale: null,
          scheduleFromLabel: usageScheduleRows,
        },
        dataStatus: usageStatus,
      },
      safety: {
        ...skeleton.sections.safety,
        cover: {
          verdict: safetyVerdict,
          bullets: safetyBulletsFinal,
        },
        detail: safetyDetailFinal,
        signals: safetySignalsFinal,
        dataStatus: safetyStatus,
      },
    },
  };
};

const scoreTextMatch = (needle?: string | null, haystack?: string | null): number => {
  if (!needle || !haystack) return 0;
  const normalizedNeedle = normalizeMatchText(needle);
  const normalizedHaystack = normalizeMatchText(haystack);
  if (!normalizedNeedle || !normalizedHaystack) return 0;
  if (normalizedNeedle === normalizedHaystack) return 3;
  if (normalizedHaystack.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedHaystack)) return 2;
  return 0;
};

const LNHDP_PRODUCT_STOP_TOKENS = new Set([
  "count",
  "ct",
  "pack",
  "packs",
  "bottle",
  "bottles",
  "x",
]);

const tokenizeLnhpdName = (value?: string | null): string[] => {
  if (!value) return [];
  const normalized = normalizeMatchText(
    value
      .replace(/(\d+)\s*iu\b/gi, "$1 iu")
      .replace(/\bd3\b/gi, "d"),
  );
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !LNHDP_PRODUCT_STOP_TOKENS.has(token))
    .filter((token) => !/^\d{1,3}$/.test(token));
};

const extractLnhpdDoseIu = (value?: string | null): string | null => {
  if (!value) return null;
  const match = value.match(/\b(\d{2,6}(?:[.,]\d{1,2})?)\s*iu\b/i);
  if (!match?.[1]) return null;
  return match[1].replace(/,/g, "").trim() || null;
};

const extractLnhpdFormToken = (value?: string | null): string | null => {
  if (!value) return null;
  if (/\b(tablets?|tabs?)\b/i.test(value)) return "tablet";
  if (/\b(capsules?|caps?)\b/i.test(value)) return "capsule";
  if (/\bsoftgels?\b/i.test(value)) return "softgel";
  if (/\b(gummies?|gummy)\b/i.test(value)) return "gummy";
  if (/\b(chewables?|soft\s*chews?)\b/i.test(value)) return "chewable";
  if (/\b(drops?|drop)\b/i.test(value)) return "drop";
  if (/\b(mists?|sprays?)\b/i.test(value)) return "spray";
  if (/\b(liquid|emulsion)\b/i.test(value)) return "liquid";
  if (/\b(powder|scoop)\b/i.test(value)) return "powder";
  return null;
};

const tokenOverlapRatio = (needle?: string | null, haystack?: string | null): number => {
  const needleTokens = tokenizeLnhpdName(needle);
  const haystackTokens = new Set(tokenizeLnhpdName(haystack));
  if (needleTokens.length === 0 || haystackTokens.size === 0) return 0;
  let hits = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) hits += 1;
  }
  return hits / needleTokens.length;
};

const NPN_IDENTITY_HINT_STOP_TOKENS = new Set([
  "vitamin",
  "supplement",
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "mg",
  "mcg",
  "iu",
]);

const tokenizeIdentityHint = (value?: string | null): string[] =>
  tokenizeLnhpdName(value)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3)
    .filter((token) => !NPN_IDENTITY_HINT_STOP_TOKENS.has(token));

const overlapTokenCount = (leftTokens: string[], rightTokens: Set<string>): number => {
  if (leftTokens.length === 0 || rightTokens.size === 0) return 0;
  let hits = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1;
  }
  return hits;
};

const passesStableDbIdentityCheck = (params: {
  hintBrand: string | null;
  hintProduct: string | null;
  lnhpdBrand: string | null;
  lnhpdProduct: string | null;
}): {
  pass: boolean;
  hasHints: boolean;
  brandOverlap: number;
  productOverlap: number;
} => {
  const hintBrandTokens = tokenizeIdentityHint(params.hintBrand);
  const hintProductTokens = tokenizeIdentityHint(params.hintProduct);
  const lnhpdBrandTokens = new Set(tokenizeIdentityHint(params.lnhpdBrand));
  const lnhpdProductTokens = new Set(tokenizeIdentityHint(params.lnhpdProduct));
  const hasHints = hintBrandTokens.length > 0 || hintProductTokens.length > 0;
  if (!hasHints) {
    return { pass: false, hasHints: false, brandOverlap: 0, productOverlap: 0 };
  }
  const brandOverlap = overlapTokenCount(hintBrandTokens, lnhpdBrandTokens);
  const productOverlap = overlapTokenCount(hintProductTokens, lnhpdProductTokens);
  const pass = brandOverlap >= 1 || productOverlap >= 2;
  return {
    pass,
    hasHints: true,
    brandOverlap,
    productOverlap,
  };
};

const buildLnhpdProductHints = (product?: string | null): string[] => {
  const raw = product?.trim() ?? "";
  if (!raw) return [];
  const hints: string[] = [];
  const seen = new Set<string>();
  const doseIu = extractLnhpdDoseIu(raw);
  const formToken = extractLnhpdFormToken(raw);
  const isVitaminD = /\bvitamin\s*d(?:\s*3)?\b/i.test(raw);
  const add = (value?: string | null) => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length < 3) return;
    const key = normalizeMatchText(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    hints.push(trimmed);
  };

  if (isVitaminD) {
    if (doseIu) {
      add(`Vitamin D ${doseIu}IU`);
      add(`Vitamin D ${doseIu} IU`);
      add(`Vitamin D3 ${doseIu}IU`);
      add(`Vitamin D3 ${doseIu} IU`);
      if (formToken) {
        add(`Vitamin D ${doseIu}IU (${formToken})`);
        add(`Vitamin D ${doseIu} IU (${formToken})`);
      }
    }
  }

  add(raw);

  const compact = raw
    .replace(/(\d+)\s*iu\b/gi, "$1IU")
    .replace(/\s+/g, " ")
    .trim();
  add(compact);

  const spaced = raw
    .replace(/(\d+)\s*iu\b/gi, "$1 IU")
    .replace(/\s+/g, " ")
    .trim();
  add(spaced);

  const stripped = raw
    .replace(/\b\d+\s*x\s*\d+\b/gi, " ")
    .replace(/\b(tablets?|tablet|capsules?|caps?|softgels?|gummies?|count|ct|pack|packs|bottles?)\b/gi, " ")
    .replace(/[-_/(),]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  add(stripped);

  if (isVitaminD) {
    add("Vitamin D");
    add("Vitamin D3");
  }

  const maxHints = isVitaminD && doseIu ? 5 : 8;
  return hints.slice(0, maxHints);
};

const pickStringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const pickNameField = (record: Record<string, unknown>, keys: string[]): string | null => {
  const direct = pickStringField(record, keys);
  if (direct) return direct;
  for (const [key, value] of Object.entries(record)) {
    if (!key.toLowerCase().includes('name')) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickNumberField = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const parsed = parseNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
};

const pickScalarField = (
  record: Record<string, unknown>,
  keys: string[],
): string | number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

const coerceJsonListPayload = (payload: unknown, hintKeys: string[]): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return coerceJsonListPayload(parsed, hintKeys);
    } catch {
      return [];
    }
  }

  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;

  // Common wrappers: { items: [...] }, { data: [...] }, etc.
  for (const key of [
    "items",
    "data",
    "values",
    "value",
    "ingredients",
    "ingredient",
    "medicinalIngredient",
    "medicinalIngredients",
    "nonMedicinalIngredient",
    "nonMedicinalIngredients",
    "purposes",
    "routes",
    "doses",
  ]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  // Numeric-key object: { "0": {...}, "1": {...} } (common in some exports)
  const entries = Object.entries(record);
  const numericEntries = entries.filter(([k]) => /^[0-9]+$/.test(k));
  if (numericEntries.length >= 1 && numericEntries.length >= Math.max(2, Math.ceil(entries.length * 0.6))) {
    return numericEntries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v);
  }

  // If this object itself looks like one list item (has hint keys), treat as a single-item list.
  const lowerKeys = new Set(Object.keys(record).map((k) => k.toLowerCase()));
  const hasHintKey = hintKeys.some((k) => lowerKeys.has(k.toLowerCase()));
  if (hasHintKey) return [payload];

  // Otherwise, if the values look like item records, treat them as the list.
  const values = Object.values(record);
  const objectValues = values.filter((v) => v && typeof v === "object") as Array<Record<string, unknown>>;
  const allObjects = objectValues.length > 0 && objectValues.length === values.length;
  if (allObjects) {
    const hasItemLike = objectValues.some((item) => {
      const keys = Object.keys(item).map((k) => k.toLowerCase());
      const set = new Set(keys);
      return hintKeys.some((k) => set.has(k.toLowerCase()));
    });
    if (hasItemLike) return objectValues;
  }

  // Last-resort: treat as a single record (best effort).
  return [payload];
};

const extractTextList = (payload: unknown, nameKeys: string[]): string[] => {
  const items = coerceJsonListPayload(payload, nameKeys);
  if (items.length === 0) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  items.forEach((item) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) return;
      const normalized = normalizeMatchText(trimmed);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      output.push(trimmed);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const name = pickNameField(item as Record<string, unknown>, nameKeys);
    if (!name) return;
    const normalized = normalizeMatchText(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(name);
  });
  return output;
};

const extractLnhpdIngredients = (payload: unknown, options: {
  nameKeys: string[];
  amountKeys: string[];
  unitKeys: string[];
}): { name: string; amount: number | null; unit: string | null; lnhpdMeta?: LnhpdIngredientMeta | null }[] => {
  const items = coerceJsonListPayload(payload, options.nameKeys);
  if (items.length === 0) return [];
  const map = new Map<string, { name: string; amount: number | null; unit: string | null; lnhpdMeta?: LnhpdIngredientMeta | null }>();
  items.forEach((item) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) return;
      const key = normalizeMatchText(trimmed);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { name: trimmed, amount: null, unit: null, lnhpdMeta: null });
      }
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const name = pickNameField(record, options.nameKeys);
    if (!name) return;
    const amount = pickNumberField(record, options.amountKeys);
    const unitRaw = pickStringField(record, options.unitKeys);
    const { amount: normalizedAmount, unit } = normalizeAmountAndUnit(amount, unitRaw);
    const key = normalizeMatchText(name);
    if (!key) return;
    const existing = map.get(key);
    const lnhpdMeta: LnhpdIngredientMeta | null = (() => {
      const ingredientName = pickStringField(record, [
        'ingredient_name',
        'ingredient_name_en',
        'medicinal_ingredient_name',
        'medicinal_ingredient_name_en',
      ]);
      const properName = pickStringField(record, ['proper_name']);
      const sourceMaterial = pickStringField(record, LNHPD_SOURCE_MATERIAL_KEYS);
      const extractTypeDesc = pickStringField(record, LNHPD_EXTRACT_TYPE_KEYS);
      const ratioNumerator = pickScalarField(record, LNHPD_RATIO_NUMERATOR_KEYS);
      const ratioDenominator = pickScalarField(record, LNHPD_RATIO_DENOMINATOR_KEYS);
      const potencyConstituent = pickStringField(record, LNHPD_POTENCY_CONSTITUENT_KEYS);
      const potencyAmount = pickScalarField(record, LNHPD_POTENCY_AMOUNT_KEYS);
      const potencyUnit = pickStringField(record, LNHPD_POTENCY_UNIT_KEYS);
      const driedHerbEquivalent = pickScalarField(record, LNHPD_DHE_KEYS);
      const hasValue =
        sourceMaterial ||
        extractTypeDesc ||
        ratioNumerator != null ||
        ratioDenominator != null ||
        potencyConstituent ||
        potencyAmount != null ||
        potencyUnit ||
        driedHerbEquivalent != null ||
        ingredientName ||
        properName;
      if (!hasValue) return null;
      return {
        sourceMaterial,
        extractTypeDesc,
        ratioNumerator,
        ratioDenominator,
        potencyConstituent,
        potencyAmount,
        potencyUnit,
        driedHerbEquivalent,
        ingredientName,
        properName,
      };
    })();
    const candidate = {
      name,
      amount: normalizedAmount ?? null,
      unit: unit ?? null,
      lnhpdMeta,
    };
    if (!existing) {
      map.set(key, candidate);
      return;
    }
    if (!existing.lnhpdMeta && candidate.lnhpdMeta) {
      existing.lnhpdMeta = candidate.lnhpdMeta;
    }
    if (existing.amount == null && candidate.amount != null) {
      map.set(key, candidate);
    }
  });
  return Array.from(map.values());
};

const isNumericText = (value: string): boolean => /^[0-9\s.\-+/]+$/.test(value.trim());

const formatDoseNumber = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}`;
};

const formatDoseRange = (min: number | null, max: number | null, unit: string | null): string | null => {
  const minValue = min != null && Number.isFinite(min) && min > 0 ? min : null;
  const maxValue = max != null && Number.isFinite(max) && max > 0 ? max : null;
  if (minValue == null && maxValue == null) return null;
  const suffix = unit ? ` ${unit}` : '';
  if (minValue != null && maxValue != null) {
    if (Math.abs(minValue - maxValue) < 0.0001) {
      return `${formatDoseNumber(minValue)}${suffix}`;
    }
    return `${formatDoseNumber(minValue)}-${formatDoseNumber(maxValue)}${suffix}`;
  }
  const value = minValue ?? maxValue!;
  return `${formatDoseNumber(value)}${suffix}`;
};

type FrequencyUnitStyle = 'adverb' | 'per' | 'raw';

const normalizeFrequencyUnit = (
  unitRaw?: string | null,
): { unit: string; style: FrequencyUnitStyle } | null => {
  if (!unitRaw) return null;
  const trimmed = unitRaw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.includes('tba')) return null;
  if (lower.includes('daily')) return { unit: 'daily', style: 'adverb' };
  if (lower.includes('weekly')) return { unit: 'weekly', style: 'adverb' };
  if (lower.includes('monthly')) return { unit: 'monthly', style: 'adverb' };
  if (lower.includes('hourly')) return { unit: 'hourly', style: 'adverb' };
  if (lower.startsWith('per ')) {
    const unit = trimmed.slice(4).trim();
    return unit ? { unit, style: 'per' } : null;
  }
  if (lower.includes('day')) return { unit: 'day', style: 'per' };
  if (lower.includes('week')) return { unit: 'week', style: 'per' };
  if (lower.includes('month')) return { unit: 'month', style: 'per' };
  if (lower.includes('hour')) return { unit: 'hour', style: 'per' };
  if (lower.includes('minute')) return { unit: 'minute', style: 'per' };
  return { unit: trimmed, style: 'raw' };
};

const formatFrequencyText = (
  min: number | null,
  max: number | null,
  value: number | null,
  unitRaw?: string | null,
): string | null => {
  const unit = normalizeFrequencyUnit(unitRaw);
  const count = formatDoseRange(min, max, null) ?? formatDoseRange(value, null, null);
  if (!unit && !count) return null;
  if (!unit) return count;
  if (!count) {
    if (unit.style === 'adverb') return unit.unit;
    if (unit.style === 'per') return `per ${unit.unit}`;
    return unit.unit;
  }
  const isSingle = count === '1';
  if (unit.style === 'adverb') {
    return isSingle ? `once ${unit.unit}` : `${count} times ${unit.unit}`;
  }
  if (unit.style === 'per') {
    return isSingle ? `once per ${unit.unit}` : `${count} times per ${unit.unit}`;
  }
  return `${count} ${unit.unit}`;
};

const normalizeAgeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const trimmed = unitRaw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.includes('year')) return 'years';
  if (lower.includes('month')) return 'months';
  if (lower.includes('week')) return 'weeks';
  if (lower.includes('day')) return 'days';
  return trimmed;
};

const pickDoseUnitField = (record: Record<string, unknown>, keys: string[]): string | null => {
  const raw = pickStringField(record, keys);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if ((lower.includes('cfu') || lower.includes('ufc')) && (lower.includes('billion') || lower.includes('million') || lower.includes('trillion'))) {
    return trimmed;
  }
  return normalizeUnitLabel(trimmed) ?? trimmed;
};

const extractLnhpdDoses = (payload: unknown): string[] => {
  const items = Array.isArray(payload) ? payload : payload ? [payload] : [];
  if (items.length === 0) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  items.forEach((item) => {
    let doseText: string | null = null;
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) doseText = trimmed;
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const textCandidate = pickStringField(record, LNHPD_DOSE_TEXT_KEYS);
      const min = pickNumberField(record, LNHPD_DOSE_RANGE_MIN_KEYS);
      const max = pickNumberField(record, LNHPD_DOSE_RANGE_MAX_KEYS);
      const amount = pickNumberField(record, LNHPD_DOSE_AMOUNT_KEYS);
      const unit = pickDoseUnitField(record, LNHPD_DOSE_UNIT_KEYS);
      const quantityText = formatDoseRange(min, max, unit) ?? formatDoseRange(amount, null, unit);

      const freqMin = pickNumberField(record, LNHPD_DOSE_FREQUENCY_MIN_KEYS);
      const freqMax = pickNumberField(record, LNHPD_DOSE_FREQUENCY_MAX_KEYS);
      const freqValue = pickNumberField(record, LNHPD_DOSE_FREQUENCY_KEYS);
      const freqUnit = pickStringField(record, LNHPD_DOSE_FREQUENCY_UNIT_KEYS);
      const frequencyText = formatFrequencyText(freqMin, freqMax, freqValue, freqUnit);

      const population = pickStringField(record, LNHPD_DOSE_POPULATION_KEYS);
      const ageMin = pickNumberField(record, LNHPD_DOSE_AGE_MIN_KEYS);
      const ageMax = pickNumberField(record, LNHPD_DOSE_AGE_MAX_KEYS);
      const ageValue = pickNumberField(record, LNHPD_DOSE_AGE_KEYS);
      const ageUnit = normalizeAgeUnitLabel(pickStringField(record, LNHPD_DOSE_AGE_UNIT_KEYS));
      const ageText =
        formatDoseRange(ageMin, ageMax, ageUnit) ?? formatDoseRange(ageValue, null, ageUnit);
      const populationText = population
        ? ageText
          ? `${population} (age ${ageText})`
          : population
        : ageText
          ? `Age ${ageText}`
          : null;

      const detailText = [quantityText, frequencyText].filter(Boolean).join(', ');
      const combinedText =
        populationText
          ? detailText
            ? `${populationText}: ${detailText}`
            : populationText
          : detailText || null;

      const hasContext = Boolean(populationText || frequencyText);
      if (combinedText && (hasContext || !textCandidate)) {
        doseText = combinedText;
      } else {
        doseText = textCandidate ?? combinedText;
      }

      if (!doseText && textCandidate && !isNumericText(textCandidate)) {
        doseText = textCandidate;
      }
    }
    if (!doseText) return;
    const normalized = normalizeMatchText(doseText);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(doseText);
  });
  return output;
};

const toLabelFactsFromDsld = (facts: DsldFacts): LabelFacts => ({
  source: 'dsld',
  brandName: facts.brandName ?? null,
  productName: facts.productName ?? null,
  servingSize: facts.servingSize ?? null,
  servingsPerContainer: facts.servingsPerContainer ?? null,
  actives: facts.actives ?? [],
  inactive: facts.inactive ?? [],
  proprietaryBlends: facts.proprietaryBlends ?? [],
  purposes: [],
  doses: [],
  datasetVersion: facts.datasetVersion ?? null,
  extractedAt: facts.extractedAt ?? null,
});

const toLabelFactsFromLnhpd = (facts: LnhpdFacts): LabelFacts => ({
  source: 'lnhpd',
  brandName: facts.brandName ?? null,
  productName: facts.productName ?? null,
  servingSize: facts.servingSize ?? null,
  servingsPerContainer: facts.servingsPerContainer ?? null,
  actives: facts.actives ?? [],
  inactive: facts.inactive ?? [],
  proprietaryBlends: [],
  purposes: facts.purposes ?? [],
  doses: facts.doses ?? [],
  datasetVersion: facts.datasetVersion ?? null,
  extractedAt: facts.extractedAt ?? null,
});

const buildAnalysisStatus = (params: {
  hasLabelFacts: boolean;
  hasAi: boolean;
  dsldLabelId?: string | number | null;
}): AnalysisStatus => {
  const needsLabel = Boolean(params.dsldLabelId);
  if (params.hasAi && (params.hasLabelFacts || !needsLabel)) return 'complete';
  if (params.hasAi) return 'ai_enriched';
  if (params.hasLabelFacts) return 'label_enriched';
  return 'catalog_only';
};

const buildAnalysisMeta = (params: {
  status: AnalysisStatus;
  labelExtraction?: LabelExtractionMeta | null;
  overlayClaims?: DecisionSupportOverlayClaims | null;
  overlayAugmentation?: AnalysisMeta["overlayAugmentation"] | null;
}): AnalysisMeta => {
  const explicitOverlayAugmentation = params.overlayAugmentation;
  const overlayAugmentation =
    explicitOverlayAugmentation !== undefined
      ? explicitOverlayAugmentation
      : (() => {
          const computed = buildDecisionSupportOverlayAugmentationMeta(params.overlayClaims ?? null);
          return computed
            ? {
                provider: computed.source,
                version: computed.version,
                claimsHash: computed.claimsHash,
              }
            : null;
        })();
  return {
    status: params.status,
    version: ANALYSIS_VERSION,
    labelExtraction: params.labelExtraction ?? null,
    overlayAugmentation,
  };
};

const computeExpiresAt = (status: AnalysisStatus): string => {
  const ttlMs =
    status === 'complete'
      ? CACHE_TTL_COMPLETE_MS
      : status === 'label_enriched'
        ? CACHE_TTL_LABEL_ENRICHED_MS
        : status === 'ai_enriched'
          ? CACHE_TTL_AI_ENRICHED_MS
          : CACHE_TTL_CATALOG_ONLY_MS;
  return new Date(Date.now() + ttlMs).toISOString();
};

const isRpcMissing = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return (error.message ?? '').toLowerCase().includes('could not find the function');
};

const buildDsldFactsFromMeta = (meta: {
  dsld_label_id: number;
  brand: string | null;
  product_name: string | null;
  serving_size_raw: string | null;
  servings_per_container: number | null;
  active_ingredients_summary: string | null;
  inactive_ingredients: string | null;
  dsld_product_version_code: string | null;
  dsld_pdf: string | null;
  dsld_thumbnail: string | null;
}): DsldFacts => {
  const actives = parseDelimitedList(meta.active_ingredients_summary).map(parseActiveSummaryLine);
  return {
    dsldLabelId: meta.dsld_label_id,
    brandName: meta.brand ?? null,
    productName: meta.product_name ?? null,
    servingSize: meta.serving_size_raw ?? null,
    servingsPerContainer: meta.servings_per_container ?? null,
    actives,
    inactive: parseDelimitedList(meta.inactive_ingredients),
    proprietaryBlends: [],
    datasetVersion: meta.dsld_product_version_code ?? null,
    extractedAt: nowIso(),
    dsldPdf: meta.dsld_pdf ?? null,
    dsldThumbnail: meta.dsld_thumbnail ?? null,
    factsSource: 'meta_summary',
  };
};

const isDsldFactsUsable = (facts?: Partial<DsldFacts> | null): boolean => {
  if (!facts) return false;
  const hasActives = Array.isArray(facts.actives) && facts.actives.length > 0;
  const hasServing =
    typeof facts.servingSize === 'string' && facts.servingSize.trim().length > 0 ||
    typeof facts.servingsPerContainer === 'number';
  const hasInactive = Array.isArray(facts.inactive) && facts.inactive.length > 0;
  const hasBlends = Array.isArray(facts.proprietaryBlends) && facts.proprietaryBlends.length > 0;
  return hasActives || hasServing || hasInactive || hasBlends;
};

const DSDL_FACTS_CACHE_TTL_MS = 10 * 60 * 1000;
const dsldFactsByLabelIdCache = new Map<number, { expiresAt: number; value: DsldFacts | null }>();
const dsldFactsByLabelIdInFlight = new Map<number, Promise<DsldFacts | null>>();
const dsldFactsByBarcodeCache = new Map<string, { expiresAt: number; value: DsldFacts | null }>();
const dsldFactsByBarcodeInFlight = new Map<string, Promise<DsldFacts | null>>();
const DSDL_CANONICAL_LABEL_CACHE_TTL_MS = 5 * 60 * 1000;
const dsldCanonicalLabelByBarcodeCache = new Map<string, { expiresAt: number; value: number | null }>();
const dsldCanonicalLabelByBarcodeInFlight = new Map<string, Promise<number | null>>();

const fetchCanonicalDsldLabelIdByBarcode = async (
  barcodeGtin14: string,
  signal?: AbortSignal,
): Promise<number | null> => {
  if (signal?.aborted) return null;
  const cached = dsldCanonicalLabelByBarcodeCache.get(barcodeGtin14);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const existingInFlight = dsldCanonicalLabelByBarcodeInFlight.get(barcodeGtin14);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<number | null> => {
    const { data, error } = await supabase
      .from('dsld_barcode_canonical')
      .select('canonical_dsld_label_id')
      .eq('barcode_normalized_gtin14', barcodeGtin14)
      .not('canonical_dsld_label_id', 'is', null)
      .limit(5)
      .abortSignal(signal ?? AbortSignal.timeout(1000));

    if (error || !Array.isArray(data) || data.length === 0) {
      return null;
    }
    const canonicalLabelId = Number(
      data.find((row) => Number.isFinite(Number(row?.canonical_dsld_label_id)))?.canonical_dsld_label_id,
    );
    if (!Number.isFinite(canonicalLabelId) || canonicalLabelId <= 0) {
      return null;
    }
    return canonicalLabelId;
  })();

  dsldCanonicalLabelByBarcodeInFlight.set(barcodeGtin14, task);
  try {
    const result = await task;
    dsldCanonicalLabelByBarcodeCache.set(barcodeGtin14, {
      value: result,
      expiresAt: Date.now() + DSDL_CANONICAL_LABEL_CACHE_TTL_MS,
    });
    return result;
  } finally {
    dsldCanonicalLabelByBarcodeInFlight.delete(barcodeGtin14);
  }
};

const fetchDsldFactsByLabelId = async (
  labelId: number,
  signal?: AbortSignal,
): Promise<DsldFacts | null> => {
  if (signal?.aborted) return null;
  const cached = dsldFactsByLabelIdCache.get(labelId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const existingInFlight = dsldFactsByLabelIdInFlight.get(labelId);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<DsldFacts | null> => {
    let rpcResult: { data?: unknown; error?: { code?: string; message?: string } | null } | null = null;
    try {
      rpcResult = await supabase.rpc('resolve_dsld_facts_by_label_id', { p_label_id: labelId });
    } catch (error) {
      rpcResult = { error: error as { message?: string } };
    }

    if (rpcResult && 'error' in rpcResult && isRpcMissing(rpcResult.error ?? null)) {
      // fall through to meta table
    } else if (rpcResult && 'data' in rpcResult && rpcResult.data) {
      const record = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
      if (record?.facts_json) {
        const facts = record.facts_json as Partial<DsldFacts>;
        if (isDsldFactsUsable(facts)) {
          return {
            dsldLabelId: record.dsld_label_id ?? labelId,
            brandName: facts.brandName ?? null,
            productName: facts.productName ?? null,
            servingSize: facts.servingSize ?? null,
            servingsPerContainer: facts.servingsPerContainer ?? null,
            actives: Array.isArray(facts.actives) ? facts.actives : [],
            inactive: Array.isArray(facts.inactive) ? facts.inactive : [],
            proprietaryBlends: Array.isArray(facts.proprietaryBlends) ? facts.proprietaryBlends : [],
            datasetVersion: record.dataset_version ?? facts.datasetVersion ?? null,
            extractedAt: record.extracted_at ?? facts.extractedAt ?? nowIso(),
            dsldPdf: (facts as { dsldPdf?: string | null }).dsldPdf ?? null,
            dsldThumbnail: (facts as { dsldThumbnail?: string | null }).dsldThumbnail ?? null,
            factsSource: 'label_facts',
          };
        }
      }
    }

    const { data: meta, error } = await supabase
      .from('dsld_labels_meta')
      .select(
        'dsld_label_id,brand,product_name,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail',
      )
      .eq('dsld_label_id', labelId)
      .maybeSingle();
    if (error || !meta) {
      return null;
    }
    return buildDsldFactsFromMeta(meta);
  })();

  dsldFactsByLabelIdInFlight.set(labelId, task);
  try {
    const result = await task;
    dsldFactsByLabelIdCache.set(labelId, {
      value: result,
      expiresAt: Date.now() + DSDL_FACTS_CACHE_TTL_MS,
    });
    return result;
  } finally {
    dsldFactsByLabelIdInFlight.delete(labelId);
  }
};

const fetchDsldFactsByBarcode = async (
  barcodeGtin14: string,
  signal?: AbortSignal,
): Promise<DsldFacts | null> => {
  if (signal?.aborted) return null;
  const cached = dsldFactsByBarcodeCache.get(barcodeGtin14);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const existingInFlight = dsldFactsByBarcodeInFlight.get(barcodeGtin14);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<DsldFacts | null> => {
    let rpcResult: { data?: unknown; error?: { code?: string; message?: string } | null } | null = null;
    try {
      rpcResult = await supabase.rpc('resolve_dsld_facts_by_gtin14', { p_gtin14: barcodeGtin14 });
    } catch (error) {
      rpcResult = { error: error as { message?: string } };
    }

    if (rpcResult && 'error' in rpcResult && isRpcMissing(rpcResult.error ?? null)) {
      // fall through to meta table
    } else if (rpcResult && 'data' in rpcResult && rpcResult.data) {
      const record = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
      if (record?.facts_json) {
        const facts = record.facts_json as Partial<DsldFacts>;
        if (isDsldFactsUsable(facts)) {
          return {
            dsldLabelId: record.dsld_label_id ?? Number(facts.dsldLabelId ?? 0),
            brandName: facts.brandName ?? null,
            productName: facts.productName ?? null,
            servingSize: facts.servingSize ?? null,
            servingsPerContainer: facts.servingsPerContainer ?? null,
            actives: Array.isArray(facts.actives) ? facts.actives : [],
            inactive: Array.isArray(facts.inactive) ? facts.inactive : [],
            proprietaryBlends: Array.isArray(facts.proprietaryBlends) ? facts.proprietaryBlends : [],
            datasetVersion: record.dataset_version ?? facts.datasetVersion ?? null,
            extractedAt: record.extracted_at ?? facts.extractedAt ?? nowIso(),
            dsldPdf: (facts as { dsldPdf?: string | null }).dsldPdf ?? null,
            dsldThumbnail: (facts as { dsldThumbnail?: string | null }).dsldThumbnail ?? null,
            factsSource: 'label_facts',
          };
        }
      }
    }

    const { data: meta, error } = await supabase
      .from('dsld_labels_meta')
      .select(
        'dsld_label_id,brand,product_name,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail',
      )
      .eq('barcode_normalized_gtin14', barcodeGtin14)
      .maybeSingle();
    if (error || !meta) {
      const canonicalLabelId = await fetchCanonicalDsldLabelIdByBarcode(barcodeGtin14, signal);
      if (Number.isFinite(canonicalLabelId) && canonicalLabelId && canonicalLabelId > 0) {
        return fetchDsldFactsByLabelId(canonicalLabelId, signal);
      }
      return null;
    }
    return buildDsldFactsFromMeta(meta);
  })();

  dsldFactsByBarcodeInFlight.set(barcodeGtin14, task);
  try {
    const result = await task;
    dsldFactsByBarcodeCache.set(barcodeGtin14, {
      value: result,
      expiresAt: Date.now() + DSDL_FACTS_CACHE_TTL_MS,
    });
    return result;
  } finally {
    dsldFactsByBarcodeInFlight.delete(barcodeGtin14);
  }
};

const LNHPD_MEDICINAL_NAME_KEYS = [
  'medicinal_ingredient_name',
  'ingredient_name',
  'medicinal_ingredient_name_en',
  'ingredient_name_en',
  'proper_name',
  'substance_name',
  'name',
];

const LNHPD_NON_MEDICINAL_NAME_KEYS = [
  'nonmedicinal_ingredient_name',
  'non_medicinal_ingredient_name',
  'ingredient_name',
  'name',
];

const LNHPD_AMOUNT_KEYS = [
  'quantity',
  'quantity_value',
  'quantity_amount',
  'strength',
  'strength_value',
  'amount',
  'dose',
  'dosage',
];

const LNHPD_UNIT_KEYS = [
  'quantity_unit',
  'quantity_unit_of_measure',
  'unit',
  'unit_of_measure',
  'strength_unit',
  'dose_unit',
  'dosage_unit',
];

const LNHPD_SOURCE_MATERIAL_KEYS = [
  'source_material',
  'source_material_desc',
  'source_material_name',
  'source_material_en',
];
const LNHPD_EXTRACT_TYPE_KEYS = ['extract_type_desc', 'extract_type', 'extract_type_en'];
const LNHPD_RATIO_NUMERATOR_KEYS = ['ratio_numerator', 'ratio_numerator_value'];
const LNHPD_RATIO_DENOMINATOR_KEYS = ['ratio_denominator', 'ratio_denominator_value'];
const LNHPD_POTENCY_CONSTITUENT_KEYS = ['potency_constituent', 'potency_constituent_desc'];
const LNHPD_POTENCY_AMOUNT_KEYS = ['potency_amount', 'potency_amount_value'];
const LNHPD_POTENCY_UNIT_KEYS = ['potency_unit', 'potency_unit_of_measure', 'potency_uom'];
const LNHPD_DHE_KEYS = ['dried_herb_equivalent', 'dried_herb_equivalent_value'];

const LNHPD_PURPOSE_KEYS = ['purpose', 'purpose_name', 'purpose_name_en', 'purpose_text', 'name'];
const LNHPD_ROUTE_KEYS = ['route', 'route_name', 'route_name_en', 'name'];
const LNHPD_DOSE_TEXT_KEYS = ['dose_text', 'dosage', 'dose_description', 'dose', 'quantity_text'];
const LNHPD_DOSE_AMOUNT_KEYS = [
  'quantity',
  'dose',
  'dosage',
  'quantity_value',
  'dose_value',
  'quantity_dose',
];
const LNHPD_DOSE_RANGE_MIN_KEYS = [
  'quantity_minimum',
  'dose_minimum',
  'dosage_minimum',
  'quantity_min',
  'dose_min',
  'quantity_dose_minimum',
];
const LNHPD_DOSE_RANGE_MAX_KEYS = [
  'quantity_maximum',
  'dose_maximum',
  'dosage_maximum',
  'quantity_max',
  'dose_max',
  'quantity_dose_maximum',
];
const LNHPD_DOSE_UNIT_KEYS = [
  'quantity_unit_of_measure',
  'dose_unit_of_measure',
  'dosage_unit',
  'unit',
  'unit_of_measure',
  'quantity_unit',
  'uom_type_desc_quantity_dose',
];
const LNHPD_DOSE_FREQUENCY_KEYS = ['frequency', 'frequency_value'];
const LNHPD_DOSE_FREQUENCY_MIN_KEYS = ['frequency_minimum', 'frequency_min'];
const LNHPD_DOSE_FREQUENCY_MAX_KEYS = ['frequency_maximum', 'frequency_max'];
const LNHPD_DOSE_FREQUENCY_UNIT_KEYS = ['uom_type_desc_frequency', 'frequency_unit', 'frequency_unit_of_measure'];
const LNHPD_DOSE_POPULATION_KEYS = ['population_type_desc', 'population_type', 'population_desc'];
const LNHPD_DOSE_AGE_MIN_KEYS = ['age_minimum', 'age_min'];
const LNHPD_DOSE_AGE_MAX_KEYS = ['age_maximum', 'age_max'];
const LNHPD_DOSE_AGE_KEYS = ['age'];
const LNHPD_DOSE_AGE_UNIT_KEYS = ['uom_type_desc_age', 'age_unit', 'age_unit_of_measure'];
const NPN_PATTERN = /\bNPN\b[\s#:\-]*([0-9]{8})\b/i;
const NPN_COMPACT_PATTERN = /\bNPN([0-9]{8})\b/i;

const extractNpnFromText = (value?: string | null): string | null => {
  if (!value) return null;
  const match = value.match(NPN_PATTERN);
  if (match?.[1]) return match[1];
  const compact = value.match(NPN_COMPACT_PATTERN);
  return compact?.[1] ?? null;
};

const extractNpnFromItems = (items: SearchItem[]): string | null => {
  for (const item of items) {
    const fromSnippet = extractNpnFromText(item.snippet);
    if (fromSnippet) return fromSnippet;
    const fromTitle = extractNpnFromText(item.title);
    if (fromTitle) return fromTitle;
  }
  return null;
};

const parseBoolean = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
};

const pickFirstExistingJsonField = (
  record: Record<string, unknown>,
  keys: string[],
): unknown => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  const lower = new Map<string, unknown>();
  Object.entries(record).forEach(([key, value]) => lower.set(key.toLowerCase(), value));
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
};

const findFirstPayloadThatExtractsLnhpdIngredients = (
  factsJson: Record<string, unknown>,
  params: {
    kind: "medicinal" | "non_medicinal";
    knownKeys: string[];
    extract: (payload: unknown) => unknown[];
  },
): unknown => {
  const candidates: Array<{ source: string; payload: unknown }> = [];
  const seen = new Set<unknown>();
  const push = (source: string, payload: unknown) => {
    if (payload == null) return;
    if (seen.has(payload)) return;
    seen.add(payload);
    candidates.push({ source, payload });
  };

  // Known keys first.
  params.knownKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(factsJson, key) && factsJson[key] != null) {
      push(`known:${key}`, factsJson[key]);
    }
  });

  // Common dataset variants: scan keys that mention medicinal/non-medicinal + ingredient(s).
  const kindToken = params.kind === "medicinal" ? "medicinal" : "non";
  Object.entries(factsJson).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    if (!lower.includes("ingredient")) return;
    if (params.kind === "medicinal") {
      if (lower.includes("nonmedicinal") || lower.includes("non_medicinal")) return;
      if (!lower.includes("medicinal")) return;
      push(`scan:${key}`, value);
      return;
    }
    // non-medicinal
    if (!(lower.includes("nonmedicinal") || lower.includes("non_medicinal") || (lower.includes(kindToken) && lower.includes("medicinal")))) {
      return;
    }
    push(`scan:${key}`, value);
  });

  // Try each candidate and return the first that yields at least 1 ingredient.
  for (const candidate of candidates) {
    try {
      const extracted = params.extract(candidate.payload);
      if (Array.isArray(extracted) && extracted.length > 0) return candidate.payload;
    } catch {
      // ignore
    }
  }

  // No successful extract. Return the first candidate payload (best-effort) to keep behavior stable.
  return candidates[0]?.payload ?? undefined;
};

const buildLnhpdFactsFromRecord = (record: LnhpdFactsRecord): LnhpdFacts | null => {
  const lnhpdId = parseNumber(record.lnhpd_id);
  if (!lnhpdId || !record.facts_json || typeof record.facts_json !== 'object') return null;
  const factsJson = record.facts_json as {
    brandName?: string | null;
    productName?: string | null;
    npn?: string | null;
    isOnMarket?: boolean | string | null;
    medicinalIngredients?: unknown;
    nonMedicinalIngredients?: unknown;
    doses?: unknown;
    purposes?: unknown;
    routes?: unknown;
  };

  const medicinalPayload =
    findFirstPayloadThatExtractsLnhpdIngredients(factsJson as unknown as Record<string, unknown>, {
      kind: "medicinal",
      knownKeys: [
        "medicinalIngredients",
        "medicinal_ingredients",
        "medicinalIngredient",
        "medicinal_ingredient",
      ],
      extract: (payload) =>
        extractLnhpdIngredients(payload, {
          nameKeys: LNHPD_MEDICINAL_NAME_KEYS,
          amountKeys: LNHPD_AMOUNT_KEYS,
          unitKeys: LNHPD_UNIT_KEYS,
        }),
    }) ?? factsJson.medicinalIngredients;

  const nonMedicinalPayload =
    findFirstPayloadThatExtractsLnhpdIngredients(factsJson as unknown as Record<string, unknown>, {
      kind: "non_medicinal",
      knownKeys: [
        "nonMedicinalIngredients",
        "non_medicinal_ingredients",
        "nonMedicinalIngredient",
        "non_medicinal_ingredient",
        "nonmedicinalIngredients",
      ],
      extract: (payload) => extractTextList(payload, LNHPD_NON_MEDICINAL_NAME_KEYS),
    }) ?? factsJson.nonMedicinalIngredients;

  const dosesPayload = pickFirstExistingJsonField(factsJson as unknown as Record<string, unknown>, [
    "doses",
    "dose",
    "dosage",
    "dosages",
  ]) ?? factsJson.doses;
  const purposesPayload = pickFirstExistingJsonField(factsJson as unknown as Record<string, unknown>, [
    "purposes",
    "purpose",
    "claims",
    "claim",
  ]) ?? factsJson.purposes;
  const routesPayload = pickFirstExistingJsonField(factsJson as unknown as Record<string, unknown>, [
    "routes",
    "route",
  ]) ?? factsJson.routes;

  const extractedActives = extractLnhpdIngredients(medicinalPayload, {
    nameKeys: LNHPD_MEDICINAL_NAME_KEYS,
    amountKeys: LNHPD_AMOUNT_KEYS,
    unitKeys: LNHPD_UNIT_KEYS,
  });
  const inferredActives = extractedActives.length
    ? []
    : (() => {
      const candidates: string[] = [];
      const appendCandidate = (value: unknown) => {
        if (typeof value !== "string") return;
        const text = value.trim();
        if (!text) return;
        if (!candidates.includes(text)) candidates.push(text);
      };
      appendCandidate(record.product_name);
      appendCandidate(factsJson.productName);
      const productLicencesPayload = pickFirstExistingJsonField(
        factsJson as unknown as Record<string, unknown>,
        ["productLicences", "product_licences"],
      );
      const licences = Array.isArray(productLicencesPayload) ? productLicencesPayload : [];
      for (const licence of licences) {
        if (!licence || typeof licence !== "object") continue;
        appendCandidate((licence as Record<string, unknown>).product_name);
      }
      for (const candidateName of candidates) {
        const inferred = inferLnhpdActivesFromProductName(candidateName);
        if (inferred.length > 0) return inferred;
      }
      return [];
    })();
  const actives = (() => {
    const byName = new Map<string, LnhpdFacts["actives"][number]>();
    [...extractedActives, ...inferredActives].forEach((entry) => {
      const key = normalizeMatchText(entry.name);
      if (!key) return;
      if (!byName.has(key)) {
        byName.set(key, entry);
        return;
      }
      const existing = byName.get(key);
      if (!existing) return;
      const merged = {
        ...existing,
        amount: existing.amount ?? entry.amount ?? null,
        unit: existing.unit ?? entry.unit ?? null,
        lnhpdMeta: existing.lnhpdMeta ?? entry.lnhpdMeta ?? null,
      };
      byName.set(key, merged);
    });
    return Array.from(byName.values());
  })();
  const inactive = extractTextList(nonMedicinalPayload, LNHPD_NON_MEDICINAL_NAME_KEYS);
  const purposes = extractTextList(purposesPayload, LNHPD_PURPOSE_KEYS);
  const routes = extractTextList(routesPayload, LNHPD_ROUTE_KEYS);
  const doses = extractLnhpdDoses(dosesPayload);
  const isOnMarket = record.is_on_market ?? parseBoolean(factsJson.isOnMarket);

  return {
    lnhpdId,
    brandName: record.brand_name ?? factsJson.brandName ?? null,
    productName: record.product_name ?? factsJson.productName ?? null,
    npn: record.npn ?? factsJson.npn ?? null,
    isOnMarket,
    servingSize: null,
    servingsPerContainer: null,
    actives,
    inactive,
    purposes,
    routes,
    doses,
    datasetVersion: record.dataset_version ?? null,
    extractedAt: record.extracted_at ?? null,
  };
};

const fetchLnhpdFactsByNpn = async (
  npn?: string | null,
  signal?: AbortSignal,
): Promise<LnhpdFacts | null> => {
  const normalized = npn?.trim() ?? '';
  const debugNameMatch = process.env.DEBUG_LNHPD_NAME_MATCH === "1";
  const debugLog = (event: string, payload: Record<string, unknown>) => {
    if (!debugNameMatch) return;
    console.info("[ResolutionV2] LNHPD by-npn", { event, ...payload });
  };
  if (!normalized) return null;

  const runQuery = async (table: string) => {
    let query = supabase
      .from(table)
      .select('lnhpd_id,facts_json,dataset_version,extracted_at,brand_name,product_name,npn,is_on_market')
      .eq('npn', normalized)
      .limit(1);

    if (table === 'lnhpd_facts') {
      query = query.eq('is_on_market', true);
    }

    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) {
      debugLog("query_error", {
        table,
        npn: normalized,
        message: error.message ?? "unknown_error",
      });
      return null;
    }
    if (!data || data.length === 0) {
      debugLog("query_empty", { table, npn: normalized });
      return null;
    }
    debugLog("query_hit", { table, npn: normalized });
    return data[0] as LnhpdFactsRecord;
  };

  const record = await runQuery('lnhpd_facts_complete') ?? await runQuery('lnhpd_facts');
  if (!record) return null;

  return buildLnhpdFactsFromRecord(record);
};

type LnhpdLookupStatus = "not_attempted" | "success" | "not_found" | "timeout" | "error";
type AuthorityFailureReason =
  | "negative_cache_blocked"
  | "lnhpd_timeout_first"
  | "lnhpd_timeout_second"
  | "lnhpd_not_found"
  | "guardrail_failed"
  | "lnhpd_query_error";
type LnhpdForcedFailureMode = "timeout" | "not_found";

const fetchLnhpdFactsWithSecondChance = async (
  npn: string | null | undefined,
  requestSignal?: AbortSignal,
  options?: {
    firstTimeoutMs?: number;
    secondTimeoutMs?: number;
    forceMode?: LnhpdForcedFailureMode | null;
    allowWhenRuntimeDisabled?: boolean;
  },
): Promise<{
  facts: LnhpdFacts | null;
  attempt1Status: LnhpdLookupStatus;
  attempt2Status: LnhpdLookupStatus;
  finalStatus: Exclude<LnhpdLookupStatus, "not_attempted">;
  secondChanceUsed: boolean;
}> => {
  if (!LNHPD_RUNTIME_ENABLED && !options?.allowWhenRuntimeDisabled) {
    return {
      facts: null,
      attempt1Status: "not_attempted",
      attempt2Status: "not_attempted",
      finalStatus: "not_found",
      secondChanceUsed: false,
    };
  }

  const normalized = String(npn ?? "").trim();
  if (!normalized) {
    return {
      facts: null,
      attempt1Status: "not_attempted",
      attempt2Status: "not_attempted",
      finalStatus: "not_found",
      secondChanceUsed: false,
    };
  }
  if (options?.forceMode === "timeout") {
    return {
      facts: null,
      attempt1Status: "timeout",
      attempt2Status: "timeout",
      finalStatus: "timeout",
      secondChanceUsed: true,
    };
  }
  if (options?.forceMode === "not_found") {
    return {
      facts: null,
      attempt1Status: "not_found",
      attempt2Status: "not_attempted",
      finalStatus: "not_found",
      secondChanceUsed: false,
    };
  }

  const attemptFetch = async (timeoutMs: number): Promise<{ facts: LnhpdFacts | null; status: LnhpdLookupStatus }> => {
    const timeoutSignal = createTimeoutSignal(timeoutMs);
    const { signal, cleanup } = combineSignals([requestSignal, timeoutSignal]);
    try {
      const facts = await fetchLnhpdFactsByNpn(normalized, signal);
      if (facts) {
        return { facts, status: "success" };
      }
      if (timeoutSignal.aborted) {
        return { facts: null, status: "timeout" };
      }
      return { facts: null, status: "not_found" };
    } catch (error) {
      if (timeoutSignal.aborted || isAbortError(error)) {
        return { facts: null, status: "timeout" };
      }
      return { facts: null, status: "error" };
    } finally {
      cleanup();
    }
  };

  const firstTimeoutMs = Math.max(1, Number(options?.firstTimeoutMs ?? RESILIENCE_LNHPD_TIMEOUT_MS));
  const secondTimeoutMs = Math.max(
    1,
    Number(options?.secondTimeoutMs ?? RESILIENCE_LNHPD_SECOND_CHANCE_TIMEOUT_MS),
  );

  const attempt1 = await attemptFetch(firstTimeoutMs);
  if (attempt1.facts) {
    return {
      facts: attempt1.facts,
      attempt1Status: attempt1.status,
      attempt2Status: "not_attempted",
      finalStatus: "success",
      secondChanceUsed: false,
    };
  }

  if (attempt1.status === "error") {
    return {
      facts: null,
      attempt1Status: attempt1.status,
      attempt2Status: "not_attempted",
      finalStatus: "error",
      secondChanceUsed: false,
    };
  }

  const attempt2 = await attemptFetch(secondTimeoutMs);
  if (attempt2.facts) {
    return {
      facts: attempt2.facts,
      attempt1Status: attempt1.status,
      attempt2Status: attempt2.status,
      finalStatus: "success",
      secondChanceUsed: true,
    };
  }

  const finalStatus: Exclude<LnhpdLookupStatus, "not_attempted"> =
    attempt2.status === "timeout"
      ? "timeout"
      : attempt2.status === "error"
        ? "error"
        : attempt1.status === "timeout"
          ? "timeout"
          : "not_found";

  return {
    facts: null,
    attempt1Status: attempt1.status,
    attempt2Status: attempt2.status,
    finalStatus,
    secondChanceUsed: true,
  };
};

const fetchLnhpdFactsByName = async (
  params: {
    brand?: string | null;
    product?: string | null;
  },
  signal?: AbortSignal,
): Promise<LnhpdFacts | null> => {
  const brand = params.brand?.trim() ?? '';
  const product = params.product?.trim() ?? '';
  const debugNameMatch = process.env.DEBUG_LNHPD_NAME_MATCH === "1";
  const debugLog = (event: string, payload: Record<string, unknown>) => {
    if (!debugNameMatch) return;
    console.info("[ResolutionV2] LNHPD name-match", { event, ...payload });
  };

  debugLog("start", { brand, product });
  if (!brand && !product) return null;

  const runQuery = async (
    table: string,
    options: { productHint?: string | null; allowBrandOnly?: boolean; limit?: number } = {},
  ) => {
    const allowBrandOnly = Boolean(options.allowBrandOnly);
    const limit = Math.max(1, Math.min(200, options.limit ?? (allowBrandOnly ? 80 : 40)));
    let query = supabase
      .from(table)
      .select('lnhpd_id,facts_json,dataset_version,extracted_at,brand_name,product_name,npn,is_on_market')
      .limit(limit);

    if (options.productHint) {
      query = query.ilike('product_name', `%${options.productHint}%`);
    }
    if (brand) {
      query = query.ilike('brand_name', `%${brand}%`);
    }
    if (table === 'lnhpd_facts') {
      query = query.eq('is_on_market', true);
    }

    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error) {
      debugLog("query_error", {
        table,
        productHint: options.productHint ?? null,
        allowBrandOnly,
        message: error.message ?? "unknown_error",
      });
      return null;
    }
    if (!data || data.length === 0) {
      debugLog("query_empty", {
        table,
        productHint: options.productHint ?? null,
        allowBrandOnly,
        limit,
      });
      return null;
    }
    debugLog("query_hit", {
      table,
      productHint: options.productHint ?? null,
      allowBrandOnly,
      limit,
      rowCount: data.length,
    });
    return data as LnhpdFactsRecord[];
  };

  const hints = buildLnhpdProductHints(product);
  const targetDoseIu = extractLnhpdDoseIu(product);
  const targetForm = extractLnhpdFormToken(product);
  const targetHasVitaminD = /\bvitamin\s*d(?:\s*3)?\b/i.test(product);

  const runAcrossTables = async (
    productHint?: string | null,
    allowBrandOnly = false,
    limit = allowBrandOnly ? 80 : 40,
  ) => {
    // Prefer on-market LNHPD first; only fall back to complete when the on-market table misses.
    const factsRows = await runQuery('lnhpd_facts', { productHint, allowBrandOnly, limit });
    if (factsRows && factsRows.length > 0) return factsRows;
    return await runQuery('lnhpd_facts_complete', { productHint, allowBrandOnly, limit });
  };

  const uniqueCandidates = new Map<string, LnhpdFactsRecord>();
  const collectCandidates = (rows: LnhpdFactsRecord[] | null) => {
    if (!rows || rows.length === 0) return;
    for (const row of rows) {
      const key =
        (typeof row.npn === "string" && row.npn.trim().length > 0
          ? `npn:${row.npn.trim()}`
          : `name:${normalizeMatchText(row.brand_name ?? "")}:${normalizeMatchText(row.product_name ?? "")}`);
      if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, row);
    }
  };

  for (const hint of hints) {
    const hintTokenCount = tokenizeLnhpdName(hint).length;
    const isBroadHint = hintTokenCount <= 2 || hint.length <= 10;
    const hintLimit = isBroadHint ? 80 : 30;
    const rows = await runAcrossTables(hint, false, hintLimit);
    collectCandidates(rows);
    if (targetDoseIu && uniqueCandidates.size >= 4) break;
    if (uniqueCandidates.size >= 20) break;
  }
  if (uniqueCandidates.size === 0 && brand) {
    collectCandidates(await runAcrossTables(null, true, 100));
  }
  const records = Array.from(uniqueCandidates.values());
  if (!records || records.length === 0) {
    debugLog("no_candidates", { brand, product, hintCount: hints.length });
    return null;
  }

  let bestRecord: LnhpdFactsRecord | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestOverlap = 0;
  let bestBrandScore = 0;
  let bestDose: string | null = null;
  let bestForm: string | null = null;
  let secondBestScore = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    const productScore = scoreTextMatch(product, record.product_name) * 3;
    const brandScore = scoreTextMatch(brand, record.brand_name) * 2;
    const overlap = tokenOverlapRatio(product, record.product_name);
    const overlapScore = Math.round(overlap * 12);

    const candidateDoseIu = extractLnhpdDoseIu(record.product_name);
    let doseScore = 0;
    if (targetDoseIu && candidateDoseIu) {
      doseScore = targetDoseIu === candidateDoseIu ? 7 : -4;
    } else if (targetDoseIu && /\biu\b/i.test(record.product_name ?? "")) {
      doseScore = -1;
    }

    const candidateForm = extractLnhpdFormToken(record.product_name);
    let formScore = 0;
    if (targetForm && candidateForm) {
      formScore = targetForm === candidateForm ? 4 : -2;
    } else if (targetForm && !candidateForm) {
      formScore = -1;
    }

    let vitaminScore = 0;
    if (targetHasVitaminD) {
      vitaminScore = /\bvitamin\s*d(?:\s*3)?\b/i.test(record.product_name ?? "") ? 2 : -4;
    }

    const score = productScore + brandScore + overlapScore + doseScore + formScore + vitaminScore;
    if (score > secondBestScore) secondBestScore = score;
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestRecord = record;
      bestOverlap = overlap;
      bestBrandScore = brandScore;
      bestDose = candidateDoseIu;
      bestForm = candidateForm;
    }
  }

  if (!bestRecord) {
    debugLog("no_best_record", { brand, product, candidateCount: records.length });
    return null;
  }
  if (brand && bestBrandScore === 0) {
    debugLog("reject_brand_zero", { bestNpn: bestRecord.npn, bestProduct: bestRecord.product_name, bestScore });
    return null;
  }
  if (product && bestOverlap < 0.34 && bestScore < 10) {
    debugLog("reject_low_overlap", {
      bestNpn: bestRecord.npn,
      bestProduct: bestRecord.product_name,
      bestScore,
      bestOverlap,
    });
    return null;
  }
  if (targetDoseIu && bestDose && targetDoseIu !== bestDose) {
    debugLog("reject_dose_mismatch", {
      bestNpn: bestRecord.npn,
      bestProduct: bestRecord.product_name,
      bestScore,
      targetDoseIu,
      bestDose,
    });
    return null;
  }
  if (targetForm && bestForm && targetForm !== bestForm) {
    debugLog("reject_form_mismatch", {
      bestNpn: bestRecord.npn,
      bestProduct: bestRecord.product_name,
      bestScore,
      targetForm,
      bestForm,
    });
    return null;
  }
  if (bestScore < 8) {
    debugLog("reject_score_low", { bestNpn: bestRecord.npn, bestProduct: bestRecord.product_name, bestScore });
    return null;
  }
  if (secondBestScore > Number.NEGATIVE_INFINITY && bestScore - secondBestScore <= 1 && bestScore < 12) {
    debugLog("reject_ambiguous", {
      bestNpn: bestRecord.npn,
      bestProduct: bestRecord.product_name,
      bestScore,
      secondBestScore,
    });
    return null;
  }

  debugLog("selected", {
    bestNpn: bestRecord.npn,
    bestProduct: bestRecord.product_name,
    bestScore,
    secondBestScore,
    candidateCount: records.length,
    targetDoseIu,
    bestDose,
    targetForm,
    bestForm,
  });
  return buildLnhpdFactsFromRecord(bestRecord);
};

const applyDsldFactsToSnapshot = (
  snapshot: SupplementSnapshot,
  facts: DsldFacts,
): SupplementSnapshot => {
  const actives = facts.actives.map((item) => {
    const amountUnknown = item.amount == null;
    return {
      name: item.name,
      ingredientId: null,
      amount: item.amount ?? null,
      amountUnit: item.unit ?? null,
      amountUnitRaw: item.unit ?? null,
      amountUnitNormalized: normalizeAmountUnit(item.unit),
      dvPercent: null,
      form: null,
      isProprietaryBlend: false,
      amountUnknown,
      source: 'dsld' as const,
      confidence: 1,
    };
  });

  const inactive = facts.inactive.map((name) => ({
    name,
    ingredientId: null,
    source: 'label' as const,
  }));

  const proprietaryBlends = facts.proprietaryBlends.map((blend) => ({
    name: blend.name,
    totalAmount: blend.totalAmount ?? null,
    unit: blend.unit ?? null,
    ingredients: blend.ingredients ?? null,
  }));

  const updated: SupplementSnapshot = {
    ...snapshot,
    product: {
      ...snapshot.product,
      brand: facts.brandName ?? snapshot.product.brand,
      name: facts.productName ?? snapshot.product.name,
    },
    label: {
      ...snapshot.label,
      servingSize: facts.servingSize ?? snapshot.label.servingSize,
      servingsPerContainer: facts.servingsPerContainer ?? snapshot.label.servingsPerContainer,
      servingsPerContainerText: facts.servingsPerContainer != null
        ? String(facts.servingsPerContainer)
        : snapshot.label.servingsPerContainerText,
      actives: actives.length ? actives : snapshot.label.actives,
      inactive: inactive.length ? inactive : snapshot.label.inactive,
      proprietaryBlends: proprietaryBlends.length ? proprietaryBlends : snapshot.label.proprietaryBlends,
    },
    regulatory: {
      ...snapshot.regulatory,
      dsldLabelId: snapshot.regulatory.dsldLabelId ?? String(facts.dsldLabelId),
    },
  };

  const referenceUrl = facts.dsldPdf ?? facts.dsldThumbnail ?? null;
  if (referenceUrl) {
    const existing = updated.references.items.some((item) => item.url === referenceUrl);
    if (!existing) {
      updated.references.items = [
        ...updated.references.items,
        {
          id: `ref_dsld_${facts.dsldLabelId}_${Math.abs(referenceUrl.length)}`,
          sourceType: 'DSLD',
          title: 'DSLD Label',
          url: referenceUrl,
          excerpt: '',
          retrievedAt: nowIso(),
          hash: `${facts.dsldLabelId}_${referenceUrl.length}`,
          evidenceFor: 'regulatory',
        },
      ];
    }
  }

  return updated;
};

const applyLnhpdFactsToSnapshot = (
  snapshot: SupplementSnapshot,
  facts: LnhpdFacts,
): SupplementSnapshot => {
  const actives = facts.actives.map((item) => {
    const amountUnknown = item.amount == null;
    return {
      name: item.name,
      ingredientId: null,
      amount: item.amount ?? null,
      amountUnit: item.unit ?? null,
      amountUnitRaw: item.unit ?? null,
      amountUnitNormalized: normalizeAmountUnit(item.unit),
      dvPercent: null,
      form: null,
      isProprietaryBlend: false,
      amountUnknown,
      source: 'lnhpd' as const,
      confidence: 1,
    };
  });

  const inactive = facts.inactive.map((name) => ({
    name,
    ingredientId: null,
    source: 'label' as const,
  }));

  const updatedRegionTags = new Set(snapshot.regulatory.regionTags);
  updatedRegionTags.add('CA');

  const updated: SupplementSnapshot = {
    ...snapshot,
    product: {
      ...snapshot.product,
      brand: facts.brandName ?? snapshot.product.brand,
      name: facts.productName ?? snapshot.product.name,
    },
    label: {
      ...snapshot.label,
      servingSize: facts.servingSize ?? snapshot.label.servingSize,
      servingsPerContainer: facts.servingsPerContainer ?? snapshot.label.servingsPerContainer,
      actives: actives.length ? actives : snapshot.label.actives,
      inactive: inactive.length ? inactive : snapshot.label.inactive,
    },
    regulatory: {
      ...snapshot.regulatory,
      npn: facts.npn ?? snapshot.regulatory.npn,
      npnStatus: facts.npn ? 'verified' : snapshot.regulatory.npnStatus ?? 'unknown',
      npnVerifiedBy: facts.npn ? 'lnhpd_fetch' : snapshot.regulatory.npnVerifiedBy ?? null,
      regionTags: Array.from(updatedRegionTags),
      lastCheckedAt: nowIso(),
    },
  };

  return updated;
};

const buildLnhpdFactsInputFromSnapshot = (snapshot: SupplementSnapshot): LnhpdFactsInput => ({
  brandName: snapshot.product.brand ?? null,
  productName: snapshot.product.name ?? null,
  npn: snapshot.regulatory.npn ?? null,
  servingSize: snapshot.label.servingSize ?? null,
  servingsPerContainer: snapshot.label.servingsPerContainer ?? null,
  actives: snapshot.label.actives.map((item) => ({
    name: item.name,
    amount: item.amount ?? null,
    unit: item.amountUnitNormalized ?? item.amountUnit ?? null,
    formRaw: item.form ?? null,
  })),
  inactive: snapshot.label.inactive.map((item) => item.name),
  purposes: [],
  routes: [],
  doses: [],
  datasetVersion: snapshot.analysis?.labelExtraction?.datasetVersion ?? null,
  extractedAt: snapshot.analysis?.labelExtraction?.fetchedAt ?? null,
});

const buildDsldFactsInputFromSnapshot = (snapshot: SupplementSnapshot): DsldFactsInput => ({
  brandName: snapshot.product.brand ?? null,
  productName: snapshot.product.name ?? null,
  servingSize: snapshot.label.servingSize ?? null,
  servingsPerContainer: snapshot.label.servingsPerContainer ?? null,
  actives: snapshot.label.actives.map((item) => ({
    name: item.name,
    amount: item.amount ?? null,
    unit: item.amountUnitNormalized ?? item.amountUnit ?? null,
    formRaw: item.form ?? null,
  })),
  inactive: snapshot.label.inactive.map((item) => item.name),
  proprietaryBlends: snapshot.label.proprietaryBlends.map((blend) => ({
    name: blend.name,
    totalAmount: blend.totalAmount ?? null,
    unit: blend.unit ?? null,
    ingredients: blend.ingredients ?? null,
  })),
  datasetVersion: snapshot.analysis?.labelExtraction?.datasetVersion ?? null,
  extractedAt: snapshot.analysis?.labelExtraction?.fetchedAt ?? null,
});

const tryBuildCanonicalDsldDigest = async (params: {
  dsldLabelId: number | string | null | undefined;
  timeoutMs: number;
  snapshot?: SupplementSnapshot | null;
  barcodeRaw?: string | null;
  identityValueFallback?: string | null;
}): Promise<{
  digest: FactsDigest;
  factsSourceVersion: string;
  factsDigestHash: string;
  labelDirectionsRawText: string | null;
} | null> => {
  const idNum = Number(params.dsldLabelId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;

  const dsldTimeoutSignal = createTimeoutSignal(Math.max(250, params.timeoutMs));
  const { signal: dsldSignal, cleanup } = combineSignals([dsldTimeoutSignal]);
  try {
    const facts = await fetchDsldFactsByLabelId(idNum, dsldSignal);
    if (!facts) return null;

    let digestSnapshot = buildBarcodeSnapshot({
      barcode:
        params.barcodeRaw ??
        params.snapshot?.product.barcode.raw ??
        params.identityValueFallback ??
        String(idNum),
      productInfo: {
        brand: facts.brandName ?? params.snapshot?.product.brand ?? null,
        name: facts.productName ?? params.snapshot?.product.name ?? null,
        category: params.snapshot?.product.category ?? null,
        image: params.snapshot?.product.imageUrl ?? null,
      },
      sources: [],
      efficacy: null,
      safety: null,
      usagePayload: null,
    });
    digestSnapshot = applyDsldFactsToSnapshot(digestSnapshot, facts);

    const identityValue = String(
      facts.dsldLabelId ??
      params.dsldLabelId ??
      params.identityValueFallback ??
      idNum,
    );
    const factsSourceVersion = `dsld:${facts.datasetVersion ?? facts.extractedAt ?? "unknown"}`;
    const digest = buildFactsDigestFromDsld({
      facts,
      snapshot: digestSnapshot,
      identityValue,
      regionTags: digestSnapshot.regulatory.regionTags,
    });
    const factsDigestHash = computeFactsDigestHash(digest);
    const labelDirectionsRawText = buildLabelDosingText(digest);
    return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
  } finally {
    cleanup();
  }
};

const SIMILARITY_STOPWORDS = new Set([
  "supplement",
  "supplements",
  "vitamin",
  "vitamins",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "caplet",
  "caplets",
  "softgel",
  "softgels",
  "gummy",
  "gummies",
  "chewable",
  "chewables",
  "mg",
  "mcg",
  "ug",
  "iu",
  "g",
  "kg",
  "ml",
  "oz",
  "count",
  "counts",
  "bottle",
  "bottles",
  "pack",
  "packs",
  "size",
  "serving",
  "servings",
  "daily",
  "extra",
  "plus",
]);

const tokenizeForSimilarity = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !SIMILARITY_STOPWORDS.has(token) && !/^\d+$/.test(token));
};

const jaccardScore = (leftTokens: string[], rightTokens: string[]): number => {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of rightSet) {
    if (leftSet.has(token)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const computeIngredientOverlapScore = (
  lnhpdActives: Array<{ name: string }>,
  candidateIngredients: string[],
): number => {
  if (!lnhpdActives.length || candidateIngredients.length === 0) return 0;
  const candidateTokens = candidateIngredients.map((name) => tokenizeForSimilarity(name));
  for (const active of lnhpdActives) {
    const activeTokens = tokenizeForSimilarity(active.name);
    if (activeTokens.length === 0) continue;
    for (const tokens of candidateTokens) {
      if (jaccardScore(activeTokens, tokens) >= GUARDRAIL_SIMILARITY_THRESHOLD) {
        return 1;
      }
    }
  }
  return 0;
};

const computeGuardrailScore = (params: {
  lnhpdFacts: LnhpdFacts;
  candidateBrands: string[];
  candidateNames: string[];
  candidateIngredients: string[];
}): { score: number; brandScore: number; productScore: number; ingredientScore: number } => {
  const brandTokens = tokenizeForSimilarity(params.lnhpdFacts.brandName ?? null);
  const productTokens = tokenizeForSimilarity(params.lnhpdFacts.productName ?? null);
  const brandScore = params.candidateBrands.reduce((best, brand) => {
    const score = jaccardScore(brandTokens, tokenizeForSimilarity(brand));
    return Math.max(best, score);
  }, 0);
  const productScore = params.candidateNames.reduce((best, name) => {
    const score = jaccardScore(productTokens, tokenizeForSimilarity(name));
    return Math.max(best, score);
  }, 0);
  const ingredientScore = computeIngredientOverlapScore(
    params.lnhpdFacts.actives,
    params.candidateIngredients,
  );
  return {
    score: Math.max(brandScore, productScore, ingredientScore),
    brandScore,
    productScore,
    ingredientScore,
  };
};

const isExpiredAt = (value?: string | null): boolean => {
  if (!value) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return ms <= Date.now();
};

const buildCandidateEvidence = (params: {
  snapshot: SupplementSnapshot | null;
  analysisPayload: SnapshotAnalysisPayload | null;
  catalog: CatalogResolved | null;
}): { brands: string[]; names: string[]; ingredients: string[] } => {
  const brands = new Set<string>();
  const names = new Set<string>();
  const ingredients = new Set<string>();

  const addValue = (set: Set<string>, value?: string | null) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    set.add(trimmed);
  };

  addValue(brands, params.snapshot?.product.brand ?? null);
  addValue(brands, params.analysisPayload?.productInfo?.brand ?? null);
  addValue(brands, params.catalog?.brand ?? null);

  addValue(names, params.snapshot?.product.name ?? null);
  addValue(names, params.analysisPayload?.productInfo?.name ?? null);
  addValue(names, params.catalog?.productName ?? null);

  params.snapshot?.label?.actives?.forEach((active) => {
    addValue(ingredients, active.name);
  });
  const efficacyPayload = params.analysisPayload?.efficacy as
    | { ingredients?: Array<{ name?: string | null }> | null }
    | null
    | undefined;
  efficacyPayload?.ingredients?.forEach((ingredient) => {
    addValue(ingredients, ingredient?.name ?? null);
  });

  return {
    brands: Array.from(brands),
    names: Array.from(names),
    ingredients: Array.from(ingredients),
  };
};

const mergeReferenceItems = (
  base: SupplementSnapshot['references'],
  incoming: SupplementSnapshot['references'],
): SupplementSnapshot['references'] => {
  const items: SupplementSnapshot['references']['items'] = [];
  const seen = new Set<string>();
  const add = (item: SupplementSnapshot['references']['items'][number]) => {
    const key = item.url || item.id;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  base.items.forEach(add);
  incoming.items.forEach(add);
  return { items };
};

const buildLabelOnlyAnalysis = (facts: LabelFacts) => {
  const firstNonEmptyText = (...values: (string | null | undefined)[]) => {
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
    return null;
  };
  const ensureSentence = (value: string) => (/[.!?]$/.test(value) ? value : `${value}.`);

  const primary = facts.actives.find((item) => item.amount != null) ?? facts.actives[0] ?? null;
  const primaryDoseHint =
    primary && primary.amount != null
      ? primary.unit
        ? `${primary.amount} ${primary.unit}`
        : String(primary.amount)
      : null;
  const primaryActive = primary
    ? {
      name: primary.name,
      form: null,
      formQuality: 'unknown',
      formNote: null,
      dosageValue: primary.amount ?? null,
      dosageUnit: primary.unit ?? null,
      evidenceLevel: 'none',
      evidenceSummary: null,
    }
    : null;

  const ingredients = facts.actives.map((item) => ({
    name: item.name,
    form: null,
    formQuality: 'unknown',
    formNote: null,
    dosageValue: item.amount ?? null,
    dosageUnit: item.unit ?? null,
    dosageAssessment: 'unknown',
    evidenceLevel: 'none',
  }));

  const purposes = Array.isArray(facts.purposes) ? facts.purposes.filter(Boolean) : [];
  const doses = Array.isArray(facts.doses) ? facts.doses.filter(Boolean) : [];
  const coreBenefits = purposes.length
    ? purposes.slice(0, 3)
    : facts.actives.slice(0, 3).map((item) => {
      if (item.amount != null && item.unit) {
        return `${item.name} ${item.amount} ${item.unit}`;
      }
      return item.name;
    });

  const overviewSummary = coreBenefits.length
    ? `Label facts captured: ${coreBenefits.join(', ')}.`
    : 'Label facts captured.';

  const efficacy = {
    verdict: 'Label facts captured; evidence mapping not available yet.',
    primaryActive,
    ingredients,
    overviewSummary,
    coreBenefits,
    overallAssessment: 'Label-only analysis; evidence mapping pending.',
    marketingVsReality: 'Label-only analysis; no external evidence verification.',
  };

  const servingSizeHint = facts.servingSize ? `Serving size: ${facts.servingSize}` : null;
  const doseHint = firstNonEmptyText(doses[0] ?? null);
  const usageSummaryBase = firstNonEmptyText(
    doseHint,
    servingSizeHint,
    primaryDoseHint ? `Primary active: ${primaryDoseHint}` : null,
  );
  const usageSummary = usageSummaryBase
    ? `${ensureSentence(usageSummaryBase)} Follow label directions.`
    : 'Follow label directions.';
  const dosage = firstNonEmptyText(doseHint, primaryDoseHint, servingSizeHint) ?? '';
  const bestFor = firstNonEmptyText(purposes[0] ?? null) ?? '';

  const usagePayload = {
    usage: {
      summary: usageSummary,
      timing: '',
      withFood: null,
      frequency: '',
      interactions: [],
      dosage,
      bestFor,
    },
    value: {
      verdict: 'Label-only analysis; formula transparency pending full review.',
      analysis: 'Label-only analysis; no price or evidence verification.',
      costPerServing: null,
      alternatives: [],
    },
    social: {
      summary: 'Label-only analysis.',
    },
  };

  const safety = {
    verdict: 'Refer to the product label for safety guidance.',
    risks: [],
    redFlags: [],
    recommendation: 'Refer to the product label.',
  };

  return { efficacy, safety, usagePayload };
};

const buildLowConfidenceAnalysis = (params: {
  brand?: string | null;
  name?: string | null;
  note: string;
}) => {
  const label = params.name || params.brand || 'This product';
  const summary = `${label}: ${params.note}`;

  const efficacy = {
    verdict: params.note,
    primaryActive: null,
    ingredients: [],
    overviewSummary: summary,
    coreBenefits: params.name ? [params.name] : [],
    overallAssessment: params.note,
    marketingVsReality: params.note,
  };

  const safety = {
    verdict: params.note,
    risks: [],
    redFlags: [],
    recommendation: 'Refer to the product label for safety guidance.',
  };

  const usagePayload = {
    usage: {
      summary: 'Follow label directions. Detailed usage not verified.',
      timing: '',
      withFood: null,
      frequency: '',
      interactions: [],
      dosage: '',
      bestFor: '',
    },
    value: {
      verdict: 'Value unknown.',
      analysis: params.note,
      costPerServing: null,
      alternatives: [],
    },
    social: {
      summary: params.note,
    },
  };

  return { efficacy, safety, usagePayload };
};

const pickNonEmptyText = (...values: (string | null | undefined)[]): string | null => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
};

const mergeEfficacyWithFallback = (current: unknown, fallback: unknown): unknown => {
  if (!fallback) return current ?? null;
  if (!current) return fallback;

  const currentEfficacy = current as {
    verdict?: string | null;
    overviewSummary?: string | null;
    coreBenefits?: string[] | null;
    ingredients?: unknown[] | null;
    primaryActive?: unknown | null;
    overallAssessment?: string | null;
    marketingVsReality?: string | null;
  };
  const fallbackEfficacy = fallback as typeof currentEfficacy;

  return {
    ...fallbackEfficacy,
    ...currentEfficacy,
    verdict: pickNonEmptyText(currentEfficacy.verdict, fallbackEfficacy.verdict),
    overviewSummary: pickNonEmptyText(currentEfficacy.overviewSummary, fallbackEfficacy.overviewSummary),
    coreBenefits:
      Array.isArray(currentEfficacy.coreBenefits) && currentEfficacy.coreBenefits.length > 0
        ? currentEfficacy.coreBenefits
        : Array.isArray(fallbackEfficacy.coreBenefits)
          ? fallbackEfficacy.coreBenefits
          : [],
    ingredients:
      Array.isArray(currentEfficacy.ingredients) && currentEfficacy.ingredients.length > 0
        ? currentEfficacy.ingredients
        : Array.isArray(fallbackEfficacy.ingredients)
          ? fallbackEfficacy.ingredients
          : [],
    primaryActive: currentEfficacy.primaryActive ?? fallbackEfficacy.primaryActive ?? null,
    overallAssessment: pickNonEmptyText(currentEfficacy.overallAssessment, fallbackEfficacy.overallAssessment),
    marketingVsReality: pickNonEmptyText(currentEfficacy.marketingVsReality, fallbackEfficacy.marketingVsReality),
  };
};

const mergeUsagePayloadWithFallback = (current: unknown, fallback: unknown): unknown => {
  if (!fallback) return current ?? null;
  if (!current) return fallback;

  const currentPayload = current as {
    usage?: {
      summary?: string | null;
      timing?: string | null;
      frequency?: string | null;
      withFood?: boolean | null;
      interactions?: string[] | null;
      dosage?: string | null;
      bestFor?: string | null;
    };
    value?: unknown;
    social?: unknown;
  };
  const fallbackPayload = fallback as typeof currentPayload;

  const currentUsage = currentPayload.usage ?? {};
  const fallbackUsage = fallbackPayload.usage ?? {};
  const mergedUsage = {
    ...fallbackUsage,
    ...currentUsage,
    summary: pickNonEmptyText(currentUsage.summary, fallbackUsage.summary),
    timing: pickNonEmptyText(currentUsage.timing, fallbackUsage.timing),
    frequency: pickNonEmptyText(currentUsage.frequency, fallbackUsage.frequency),
    dosage: pickNonEmptyText(currentUsage.dosage, fallbackUsage.dosage),
    bestFor: pickNonEmptyText(currentUsage.bestFor, fallbackUsage.bestFor),
    withFood: currentUsage.withFood ?? fallbackUsage.withFood ?? null,
    interactions:
      Array.isArray(currentUsage.interactions) && currentUsage.interactions.length > 0
        ? currentUsage.interactions
        : Array.isArray(fallbackUsage.interactions)
          ? fallbackUsage.interactions
          : [],
  };

  const mergedValue = currentPayload.value ?? fallbackPayload.value ?? null;
  const mergedSocial = currentPayload.social ?? fallbackPayload.social ?? null;

  return {
    ...fallbackPayload,
    ...currentPayload,
    usage: mergedUsage,
    value: mergedValue,
    social: mergedSocial,
  };
};

const mergeSafetyWithFallback = (current: unknown, fallback: unknown): unknown => {
  if (!fallback) return current ?? null;
  if (!current) return fallback;

  const currentSafety = current as {
    verdict?: string | null;
    recommendation?: string | null;
    risks?: string[] | null;
    redFlags?: string[] | null;
  };
  const fallbackSafety = fallback as typeof currentSafety;

  return {
    ...fallbackSafety,
    ...currentSafety,
    verdict: pickNonEmptyText(currentSafety.verdict, fallbackSafety.verdict),
    recommendation: pickNonEmptyText(currentSafety.recommendation, fallbackSafety.recommendation),
    risks:
      Array.isArray(currentSafety.risks) && currentSafety.risks.length > 0
        ? currentSafety.risks
        : fallbackSafety.risks ?? [],
    redFlags:
      Array.isArray(currentSafety.redFlags) && currentSafety.redFlags.length > 0
        ? currentSafety.redFlags
        : fallbackSafety.redFlags ?? [],
  };
};

const mergeLabelFallbacks = (
  analysisPayload: SnapshotAnalysisPayload,
  labelAnalysis: ReturnType<typeof buildLabelOnlyAnalysis>,
): SnapshotAnalysisPayload => ({
  ...analysisPayload,
  efficacy: mergeEfficacyWithFallback(analysisPayload.efficacy ?? null, labelAnalysis.efficacy),
  usagePayload: mergeUsagePayloadWithFallback(analysisPayload.usagePayload ?? null, labelAnalysis.usagePayload),
  safety: mergeSafetyWithFallback(analysisPayload.safety ?? null, labelAnalysis.safety),
});

const hasLabelFacts = (snapshot: SupplementSnapshot): boolean => {
  const label = snapshot.label;
  if (label.actives.length > 0) return true;
  if (label.inactive.length > 0) return true;
  if (label.proprietaryBlends.length > 0) return true;
  if (label.servingSize) return true;
  return false;
};

const buildLabelFactsFromSnapshot = (snapshot: SupplementSnapshot): LabelFacts | null => {
  if (!hasLabelFacts(snapshot)) return null;
  const source = snapshot.analysis?.labelExtraction?.source ?? 'manual';
  return {
    source,
    brandName: snapshot.product.brand ?? null,
    productName: snapshot.product.name ?? null,
    servingSize: snapshot.label.servingSize ?? null,
    servingsPerContainer: snapshot.label.servingsPerContainer ?? null,
    actives: snapshot.label.actives.map((item) => ({
      name: item.name,
      amount: item.amount ?? null,
      unit: item.amountUnitNormalized ?? item.amountUnit ?? null,
    })),
    inactive: snapshot.label.inactive.map((item) => item.name),
    proprietaryBlends: snapshot.label.proprietaryBlends.map((blend) => ({
      name: blend.name,
      totalAmount: blend.totalAmount ?? null,
      unit: blend.unit ?? null,
      ingredients: blend.ingredients ?? null,
    })),
    purposes: [],
    doses: [],
    datasetVersion: snapshot.analysis?.labelExtraction?.datasetVersion ?? null,
    extractedAt: snapshot.analysis?.labelExtraction?.fetchedAt ?? null,
  };
};

const hasAiPayload = (analysisPayload?: SnapshotAnalysisPayload | null): boolean => {
  if (!analysisPayload) return false;
  const efficacyScore = (analysisPayload.efficacy as { score?: number | null } | undefined)?.score;
  const safetyScore = (analysisPayload.safety as { score?: number | null } | undefined)?.score;
  const valueScore = (analysisPayload.usagePayload as { value?: { score?: number | null } } | undefined)?.value?.score;
  if (typeof efficacyScore === 'number') return true;
  if (typeof safetyScore === 'number') return true;
  if (typeof valueScore === 'number') return true;
  return false;
};

const hasCoreAnalysis = (analysisPayload?: SnapshotAnalysisPayload | null): boolean => {
  if (!analysisPayload) return false;
  return Boolean(analysisPayload.efficacy && analysisPayload.safety && analysisPayload.usagePayload);
};

const hasAuthoritativeIdentityFromSnapshot = (snapshot: SupplementSnapshot): boolean => {
  if (snapshot.regulatory.dsldLabelId) return true;
  return Boolean(
    LNHPD_RUNTIME_ENABLED &&
    snapshot.regulatory.npn &&
    snapshot.regulatory.npnStatus === "verified" &&
    snapshot.regulatory.npnVerifiedBy === "lnhpd_fetch",
  );
};

const hasBundleOnlyLabelRecordIdentityFromSnapshot = (snapshot: SupplementSnapshot): boolean => {
  if (!BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0) return false;
  const raw = snapshot.regulatory.dsldLabelId;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (typeof raw === "number") return Number.isFinite(raw);
  return false;
};

const hasBundleOnlyAuthoritativeFastPath = (snapshot: SupplementSnapshot): boolean => {
  const isVerifiedNpn = Boolean(
    LNHPD_RUNTIME_ENABLED &&
    snapshot.regulatory.npn &&
    snapshot.regulatory.npnStatus === "verified" &&
    snapshot.regulatory.npnVerifiedBy === "lnhpd_fetch",
  );
  return isVerifiedNpn || hasBundleOnlyLabelRecordIdentityFromSnapshot(snapshot);
};

const hasCoreFacts = (snapshot: SupplementSnapshot, analysisPayload?: SnapshotAnalysisPayload | null): boolean =>
  hasLabelFacts(snapshot) || hasCoreAnalysis(analysisPayload);

const resolveAnalysisMeta = (params: {
  snapshot: SupplementSnapshot;
  analysisPayload?: SnapshotAnalysisPayload | null;
  catalog?: CatalogResolved | null;
  labelExtraction?: LabelExtractionMeta | null;
}): AnalysisMeta => {
  const current = params.snapshot.analysis ?? params.analysisPayload?.analysis ?? null;
  const dsldLabelId = params.catalog?.dsldLabelId ?? params.snapshot.regulatory.dsldLabelId ?? null;
  const status = current?.status ?? buildAnalysisStatus({
    hasLabelFacts: hasLabelFacts(params.snapshot),
    hasAi: hasAiPayload(params.analysisPayload),
    dsldLabelId,
  });
  return {
    status,
    version: current?.version ?? 0,
    labelExtraction: current?.labelExtraction ?? params.labelExtraction ?? null,
    overlayAugmentation: current?.overlayAugmentation ?? null,
  };
};

const shouldReEnrich = (params: {
  snapshot: SupplementSnapshot;
  analysisPayload?: SnapshotAnalysisPayload | null;
  catalog?: CatalogResolved | null;
  aiAvailable: boolean;
}): boolean => {
  const meta = resolveAnalysisMeta(params);
  if (meta.version < ANALYSIS_VERSION) return true;

  const dsldLabelId = params.catalog?.dsldLabelId ?? params.snapshot.regulatory.dsldLabelId ?? null;
  const needsLabel = Boolean(dsldLabelId) && !hasLabelFacts(params.snapshot);
  if (needsLabel) return true;

  if (!hasCoreAnalysis(params.analysisPayload)) return true;

  if (params.aiAvailable && (meta.status === 'catalog_only' || meta.status === 'label_enriched')) {
    return true;
  }

  return false;
};

// ============================================================================
// GOOGLE CSE UTILITIES
// ============================================================================

interface GoogleCseItem {
  title?: string;
  snippet?: string;
  link?: string;
  pagemap?: {
    cse_image?: { src?: string }[];
    cse_thumbnail?: { src?: string }[];
    imageobject?: { url?: string }[];
    metatags?: Record<string, unknown>[];
  };
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
}

type SearchResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  budget?: DeadlineBudget;
  breaker?: CircuitBreaker;
  semaphore?: Semaphore;
  retry?: Partial<RetryOptions>;
  gl?: string;
  hl?: string;
};

type DeepseekResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  maxTokens?: number;
  budget?: DeadlineBudget;
  breaker?: CircuitBreaker;
  semaphore?: Semaphore;
  retry?: Partial<RetryOptions>;
};

const pickImageFromPagemap = (pagemap: GoogleCseItem["pagemap"]): string | undefined => {
  if (!pagemap) {
    return undefined;
  }
  const candidates: unknown[] = [
    pagemap.cse_image?.[0]?.src,
    pagemap.imageobject?.[0]?.url,
    pagemap.cse_thumbnail?.[0]?.src,
    pagemap.metatags?.find(
      (tag) => typeof tag?.["og:image"] === "string" && (tag?.["og:image"] as string).trim().length,
    )?.["og:image"],
  ];
  const match = candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return match;
};

const performGoogleSearch = async (
  query: string,
  apiKey: string,
  cx: string,
  options: SearchResilienceOptions = {},
): Promise<SearchItem[]> => {
  const searchParams = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
  });
  if (options.gl) {
    searchParams.set("gl", options.gl);
  }
  if (options.hl) {
    searchParams.set("hl", options.hl);
  }
  const url = `${GOOGLE_CSE_ENDPOINT}?${searchParams.toString()}`;

  console.log(`[Search] Query: "${query}"`);

  if (options.breaker && !options.breaker.canRequest()) {
    throw new Error("google_breaker_open");
  }

  const timeoutMs = options.timeoutMs ?? RESILIENCE_GOOGLE_TIMEOUT_MS;
  const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
  if (budgetedTimeout <= 0) {
    throw new TimeoutError("google_budget_exhausted");
  }

  let release: (() => void) | null = null;
  if (options.semaphore) {
    release = await options.semaphore.acquire({
      timeoutMs: options.queueTimeoutMs ?? RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
      signal: options.signal,
    });
  }

  const retryConfig: RetryOptions = {
    maxAttempts: options.retry?.maxAttempts ?? 1,
    baseDelayMs: options.retry?.baseDelayMs ?? 300,
    maxDelayMs: options.retry?.maxDelayMs ?? 1200,
    jitterRatio: options.retry?.jitterRatio ?? 0.4,
    shouldRetry: (error) => {
      if (error instanceof TimeoutError) return true;
      if (error instanceof HttpError) return isRetryableStatus(error.status);
      if (isAbortError(error)) return false;
      return error instanceof TypeError;
    },
    signal: options.signal,
    budget: options.budget,
  };

  let response: globalThis.Response;
  try {
    response = await withRetry(async () => {
      const timeoutSignal = createTimeoutSignal(budgetedTimeout);
      const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
      try {
        const result = await fetch(url, { cache: "no-store", signal });
        if (!result.ok) {
          throw new HttpError(result.status, `Google CSE error: ${result.status}`);
        }
        return result;
      } catch (error) {
        if (timeoutSignal.aborted && !options.signal?.aborted && isAbortError(error)) {
          throw new TimeoutError("google_timeout");
        }
        throw error;
      } finally {
        cleanup();
      }
    }, retryConfig);
    options.breaker?.recordSuccess();
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    throw error;
  } finally {
    release?.();
  }

  const data = (await response.json()) as GoogleCseResponse;
  return (data.items ?? [])
    .slice(0, MAX_RESULTS)
    .map((item) => ({
      title: item.title ?? "",
      snippet: item.snippet ?? "",
      link: item.link ?? "",
      image: pickImageFromPagemap(item.pagemap),
    }))
    .filter((item) => item.title && item.link);
};

const runSearchPlan = async (
  queries: string[],
  apiKey: string,
  cx: string,
  options: { barcode?: string; resilience?: SearchResilienceOptions } = {},
): Promise<{
  primary: SearchItem[];
  secondary: SearchItem[];
  merged: SearchItem[];
  queriesTried: string[];
  hardStop: boolean;
  hadResponse: boolean;
}> => {
  let primary: SearchItem[] = [];
  const secondary: SearchItem[] = [];
  const queriesTried: string[] = [];
  let hardStop = false;
  let hadResponse = false;

  for (const query of queries) {
    if (options.resilience?.signal?.aborted) {
      hardStop = true;
      break;
    }
    if (options.resilience?.budget?.isExpired()) {
      hardStop = true;
      break;
    }
    try {
      const items = await performGoogleSearch(query, apiKey, cx, options.resilience);
      hadResponse = true;
      queriesTried.push(query);

      if (!items.length) {
        continue;
      }

      if (primary.length === 0) {
        primary = items;
      } else {
        secondary.push(...items);
      }

      const merged = mergeAndDedupe(primary, secondary, { barcode: options.barcode });
      const qualityScore = scoreSearchQuality(merged, { barcode: options.barcode });

      if (merged.length >= MAX_RESULTS && qualityScore >= QUALITY_THRESHOLD) {
        return {
          primary,
          secondary,
          merged,
          queriesTried,
          hardStop,
          hadResponse,
        };
      }
    } catch (error) {
      queriesTried.push(query);
      if (!isAbortError(error)) {
        console.warn(`[Search] Query failed: "${query}"`, error);
      }
      const shouldHardStop =
        error instanceof BulkheadTimeoutError ||
        (error instanceof TimeoutError && error.message.includes("budget")) ||
        (error instanceof Error && error.message === "google_breaker_open") ||
        isAbortError(error);
      if (shouldHardStop) {
        hardStop = true;
        break;
      }
    }
  }

  return {
    primary,
    secondary,
    merged: mergeAndDedupe(primary, secondary, { barcode: options.barcode }),
    queriesTried,
    hardStop,
    hadResponse,
  };
};

const SECONDARY_MARKETPLACE_EXCLUDE_DOMAINS = [
  "ebay.com",
  "ebay.ca",
  "ebay.co.uk",
  "ebay.de",
  "etsy.com",
  "mercari.com",
  "poshmark.com",
  "bonanza.com",
  "depop.com",
  "aliexpress.com",
  "alibaba.com",
  "temu.com",
  "shein.com",
];
const SECONDARY_RETAILER_EXCLUDE_DOMAINS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
  "walmart.com",
  "walmart.ca",
  "target.com",
  "costco.com",
  "costco.ca",
  "iherb.com",
  "gnc.com",
  "vitaminshoppe.com",
];
const SECONDARY_TITLE_REMOVE_WORDS = new Set([
  "free",
  "shipping",
  "new",
  "sealed",
  "authentic",
  "genuine",
  "bundle",
  "bulk",
  "case",
  "lot",
  "pack",
  "packs",
  "packaging",
  "sale",
  "discount",
  "promo",
  "offer",
  "exp",
  "expiry",
  "expiration",
  "expires",
  "best",
  "before",
  "by",
  "dated",
]);
const SECONDARY_TITLE_QUANTITY_PATTERN = /\b(?:\d+\s?(?:pack|packs|ct|count|pcs|pc|bottles?|box|case)|(?:pack|lot)\s?of\s?\d+)\b/i;
const SECONDARY_TITLE_DATE_PATTERN = /\b(?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{4})\b/;
const SECONDARY_TITLE_DOSAGE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:mg|g|mcg|iu|i\.u\.|ml|oz)\b/i;
const SECONDARY_TITLE_UNIT_PATTERN = /^(?:mg|g|mcg|iu|i\.u\.|ml|oz|tablet(?:s)?|capsule(?:s)?|softgel(?:s)?|gummy(?:ies)?|chewable(?:s)?)$/i;
const SECONDARY_VITAMIN_LETTERS = new Set(["A", "B", "C", "D", "E", "K"]);
const SECONDARY_GENERIC_NAME_WORDS = new Set([
  "vitamin",
  "vitamins",
  "supplement",
  "supplements",
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "gummy",
  "gummies",
  "chewable",
  "chewables",
  "powder",
  "liquid",
  "drops",
  "drop",
  "formula",
  "complex",
  "support",
  "strength",
  "extra",
  "maximum",
  "max",
  "bottle",
  "bottles",
  "pill",
  "pills",
  "number",
  "feature",
  "features",
  "help",
  "helps",
  "of",
  "for",
  "with",
  "and",
  "or",
  "to",
  "by",
]);
const SECONDARY_COUNT_WORDS = new Set([
  "bottle",
  "bottles",
  "pack",
  "packs",
  "ct",
  "count",
  "pcs",
  "pc",
  "box",
  "case",
  "lot",
]);
const SECONDARY_SEED_PACK_WORDS = new Set(["bottle", "bottles", "pack", "packs", "lot", "case", "box"]);
const SECONDARY_SEED_COUNT_UNIT_HINTS = new Map<string, "tablets" | "capsules" | "caplets" | "ct" | "count">([
  ["tablet", "tablets"],
  ["tablets", "tablets"],
  ["capsule", "capsules"],
  ["capsules", "capsules"],
  ["caplet", "caplets"],
  ["caplets", "caplets"],
  ["softgel", "capsules"],
  ["softgels", "capsules"],
  ["gummy", "ct"],
  ["gummies", "ct"],
  ["pill", "tablets"],
  ["pills", "tablets"],
  ["ct", "ct"],
  ["count", "count"],
]);
const SECONDARY_SEED_FORM_TOKENS = new Map<string, SecondarySeedV2["form"]>([
  ["tablet", "tablet"],
  ["tablets", "tablet"],
  ["caplet", "caplet"],
  ["caplets", "caplet"],
  ["capsule", "capsule"],
  ["capsules", "capsule"],
  ["gummy", "gummy"],
  ["gummies", "gummy"],
  ["softgel", "softgel"],
  ["softgels", "softgel"],
  ["powder", "powder"],
  ["liquid", "liquid"],
]);
const SECONDARY_SEED_MAX_CORE_TOKENS = 6;
const SECONDARY_SEED_MATCH_MIN = 0.6;
const SECONDARY_SEED_VERIFIED_MIN = 0.65;
const SECONDARY_QUERY_MAX_CHARS = Number(process.env.SECONDARY_QUERY_MAX_CHARS ?? 260);
const SECONDARY_QUERY_MAX_VARIANTS_PER_GROUP = Number(process.env.SECONDARY_QUERY_MAX_VARIANTS_PER_GROUP ?? 3);
const SECONDARY_QUERY_EXCLUDE_DOMAINS = ["ebay.com", "ebay.ca"];
const SECONDARY_QUERY_INCLUDE_ACTIVES_AS_SHOULD = parseBooleanEnv(
  process.env.SECONDARY_QUERY_INCLUDE_ACTIVES_AS_SHOULD,
  false,
);
const SECONDARY_DOMAIN_LADDER_SITES = [
  "walmart.ca",
  "ca.iherb.com",
  "well.ca",
  "shoppersdrugmart.ca",
  "pharmaprix.ca",
  "londondrugs.com",
  "costco.ca",
  "rexall.ca",
  "solgar.com",
];

type SecondarySeedV2 = {
  rawTitle: string;
  keptTokens: string[];
  removedTokens: string[];
  brandTokens: string[];
  activeTokens?: string[];
  dosage?: { value: number; unit: "mg" | "mcg" | "iu" };
  count?: { value: number; unitHint?: "tablets" | "capsules" | "caplets" | "ct" | "count" };
  form?: "tablet" | "caplet" | "capsule" | "gummy" | "softgel" | "powder" | "liquid";
  pack?: { qty: number; unit: "bottle" | "bottles" | "pack" | "lot" };
  seedQualityScore: number;
};

type SecondaryDosageUnit = NonNullable<SecondarySeedV2["dosage"]>["unit"];
type SecondaryPackUnit = NonNullable<SecondarySeedV2["pack"]>["unit"];

type QueryVariant = {
  id: "domain_ladder" | "open_web";
  query: string;
  mustGroups: string[];
  shouldGroups: string[];
  usedVariants: {
    brand: string[];
    dosage: string[];
    count: string[];
    form: string[];
  };
  charLen: number;
  dropped: string[];
};

type SecondaryQueryPlan = {
  primary: QueryVariant;
  secondary?: QueryVariant;
  bannedDomains: string[];
  diagnostics: {
    maxQueryChars: number;
    maxVariantsPerGroup: number;
    seedSummary: {
      brand: string[];
      dosage?: string;
      count?: string;
      form?: string;
    };
  };
};

const isSecondaryExcludedDomain = (domain: string, bannedDomains: string[]): boolean => {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return bannedDomains.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
};

const cleanMarketplaceTitle = (rawTitle: string): {
  cleanTitle: string;
  brandGuess: string | null;
  removedTokens: string[];
} => {
  const normalized = rawTitle
    .replace(/[()[\]{}]/g, " ")
    .replace(/[-–—|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return { cleanTitle: "", brandGuess: null, removedTokens: [] };
  }
  const tokens = normalized.split(" ").filter(Boolean);
  const removedTokens: string[] = [];
  const keptTokens: string[] = [];
  let sizeTokens = 0;
  let skipDateTokens = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    const lower = token.toLowerCase();
    if (!token) continue;
    if (skipDateTokens > 0) {
      removedTokens.push(token);
      skipDateTokens -= 1;
      continue;
    }
    if (SECONDARY_TITLE_REMOVE_WORDS.has(lower)) {
      removedTokens.push(token);
      if (["exp", "expiry", "expiration", "expires", "best", "before", "by", "dated"].includes(lower)) {
        skipDateTokens = 2;
      }
      continue;
    }
    if (SECONDARY_TITLE_QUANTITY_PATTERN.test(token)) {
      removedTokens.push(token);
      continue;
    }
    if (SECONDARY_TITLE_DATE_PATTERN.test(token)) {
      removedTokens.push(token);
      continue;
    }
    const isNumeric = /^\d+(?:\.\d+)?$/.test(token);
    const isDosageToken = SECONDARY_TITLE_DOSAGE_PATTERN.test(token);
    const isUnitToken = SECONDARY_TITLE_UNIT_PATTERN.test(token);

    if (isNumeric) {
      const nextToken = tokens[i + 1] ?? "";
      if (nextToken && SECONDARY_TITLE_UNIT_PATTERN.test(nextToken.toLowerCase()) && sizeTokens < 2) {
        keptTokens.push(token);
        sizeTokens += 1;
      } else {
        removedTokens.push(token);
      }
      continue;
    }

    if (isDosageToken || isUnitToken) {
      if (sizeTokens < 2) {
        keptTokens.push(token);
        sizeTokens += 1;
      } else {
        removedTokens.push(token);
      }
      continue;
    }

    if (token.length === 1 && !SECONDARY_VITAMIN_LETTERS.has(token.toUpperCase())) {
      removedTokens.push(token);
      continue;
    }

    keptTokens.push(token);
    if (keptTokens.length >= SECONDARY_QUERY_TOKEN_LIMIT) break;
  }

  const cleanTitle = keptTokens.join(" ").trim();
  const brandGuess =
    keptTokens.find((item) => {
      const lower = item.toLowerCase();
      if (SECONDARY_TITLE_UNIT_PATTERN.test(lower)) return false;
      if (SECONDARY_TITLE_DOSAGE_PATTERN.test(lower)) return false;
      return item.length > 2;
    }) ?? null;
  return { cleanTitle, brandGuess, removedTokens };
};

const normalizeSeedTitle = (rawTitle: string): string =>
  rawTitle
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[.,!?:;]+/g, " ")
    .replace(/[|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatNumericToken = (token: string): string => {
  const normalized = token.replace(/i\.u\./gi, "iu");
  const spaced = normalized.replace(/(\d)([a-z])/i, "$1 $2");
  return spaced.replace(/\s+/g, " ").toLowerCase();
};

const tokenizeSeedText = (value: string): string[] =>
  normalizeSeedTitle(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

const parseNumericValue = (token: string): number | null => {
  const cleaned = token.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
};

const parseDosageToken = (token: string): SecondarySeedV2["dosage"] | null => {
  const match = token.match(/^(\d+(?:\.\d+)?)(?:\s?)(mg|mcg|iu)$/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? "").toLowerCase() as SecondaryDosageUnit;
  if (!["mg", "mcg", "iu"].includes(unit)) return null;
  return { value, unit };
};

const isValidBrandToken = (token: string): boolean => {
  if (!token) return false;
  if (!/[a-z]/i.test(token)) return false;
  if (token.length < 3) return false;
  const lower = token.toLowerCase();
  if (SECONDARY_GENERIC_NAME_WORDS.has(lower)) return false;
  if (SECONDARY_TITLE_REMOVE_WORDS.has(lower)) return false;
  if (SECONDARY_TITLE_UNIT_PATTERN.test(lower)) return false;
  if (SECONDARY_TITLE_DOSAGE_PATTERN.test(token)) return false;
  return true;
};

const buildMarketplaceSeedV2 = (params: { rawTitle: string; brandHint?: string | null }): SecondarySeedV2 => {
  const { rawTitle, brandHint } = params;
  const tokens = tokenizeSeedText(rawTitle);
  const keptTokens: string[] = [];
  const removedTokens: string[] = [];
  const activeTokens: string[] = [];
  let dosage: SecondarySeedV2["dosage"];
  let count: SecondarySeedV2["count"];
  let form: SecondarySeedV2["form"];
  let pack: SecondarySeedV2["pack"];

  for (let idx = 0; idx < tokens.length; idx += 1) {
    const token = tokens[idx] ?? "";
    const lower = token.toLowerCase();
    if (!token) continue;
    if (SECONDARY_TITLE_REMOVE_WORDS.has(lower) || lower === "ebay") {
      removedTokens.push(token);
      continue;
    }
    if (SECONDARY_TITLE_QUANTITY_PATTERN.test(token) || SECONDARY_TITLE_DATE_PATTERN.test(token)) {
      removedTokens.push(token);
      continue;
    }

    const dosageInline = parseDosageToken(token);
    if (dosageInline && !dosage) {
      dosage = dosageInline;
      keptTokens.push(`${dosageInline.value} ${dosageInline.unit}`);
      continue;
    }

    const numericValue = parseNumericValue(token);
    const nextToken = tokens[idx + 1] ?? "";
    const nextLower = nextToken.toLowerCase();

    if (numericValue !== null) {
      if (nextToken && SECONDARY_SEED_PACK_WORDS.has(nextLower) && !pack) {
        pack = { qty: numericValue, unit: nextLower as SecondaryPackUnit };
        removedTokens.push(token, nextToken);
        idx += 1;
        continue;
      }

      if (nextToken && SECONDARY_SEED_COUNT_UNIT_HINTS.has(nextLower) && !count) {
        const unitHint = SECONDARY_SEED_COUNT_UNIT_HINTS.get(nextLower);
        count = { value: numericValue, unitHint };
        if (!form && SECONDARY_SEED_FORM_TOKENS.has(nextLower)) {
          form = SECONDARY_SEED_FORM_TOKENS.get(nextLower);
        }
        keptTokens.push(`${numericValue} ${unitHint ?? "count"}`);
        idx += 1;
        continue;
      }

      if (nextToken && SECONDARY_TITLE_UNIT_PATTERN.test(nextLower) && !dosage) {
        const unit = nextLower.replace(/\./g, "") as SecondaryDosageUnit;
        if (["mg", "mcg", "iu"].includes(unit)) {
          dosage = { value: numericValue, unit };
          keptTokens.push(`${numericValue} ${unit}`);
          idx += 1;
          continue;
        }
      }

      if (!count && numericValue >= 10 && numericValue <= 5000) {
        count = { value: numericValue };
        keptTokens.push(String(numericValue));
        continue;
      }

      removedTokens.push(token);
      continue;
    }

    if (SECONDARY_TITLE_UNIT_PATTERN.test(lower) || SECONDARY_COUNT_WORDS.has(lower)) {
      removedTokens.push(token);
      continue;
    }

    if (SECONDARY_GENERIC_NAME_WORDS.has(lower) && lower !== "vitamin" && lower !== "vitamins") {
      removedTokens.push(token);
      continue;
    }

    if (token.length === 1 && !SECONDARY_VITAMIN_LETTERS.has(token.toUpperCase())) {
      removedTokens.push(token);
      continue;
    }

    if (SECONDARY_SEED_FORM_TOKENS.has(lower) && !form) {
      form = SECONDARY_SEED_FORM_TOKENS.get(lower);
    }

    keptTokens.push(token);
  }

  for (let idx = 0; idx < keptTokens.length; idx += 1) {
    const lower = keptTokens[idx].toLowerCase();
    if (lower === "vitamin" && keptTokens[idx + 1] && keptTokens[idx + 1].length === 1) {
      activeTokens.push(`vitamin ${keptTokens[idx + 1].toLowerCase()}`);
      idx += 1;
    }
  }

  const brandHintTokens = brandHint
    ? tokenizeSeedText(brandHint).filter((token) => isValidBrandToken(token))
    : [];
  let brandTokens = brandHintTokens.slice(0, 2);
  if (!brandTokens.length) {
    for (let idx = 0; idx < keptTokens.length; idx += 1) {
      const candidate = keptTokens[idx];
      if (!isValidBrandToken(candidate)) continue;
      brandTokens = [candidate];
      const next = keptTokens[idx + 1];
      if (next && SECONDARY_VITAMIN_LETTERS.has(next.toUpperCase())) {
        brandTokens = [candidate, next];
      } else if (next && isValidBrandToken(next)) {
        brandTokens = [candidate, next];
      }
      break;
    }
  }

  let seedQualityScore = 0;
  if (brandTokens.length) seedQualityScore += 0.5;
  if (dosage) seedQualityScore += 0.3;
  if (count) seedQualityScore += 0.15;
  if (form) seedQualityScore += 0.05;
  seedQualityScore = Math.min(1, Math.round(seedQualityScore * 100) / 100);

  return {
    rawTitle,
    keptTokens,
    removedTokens,
    brandTokens,
    activeTokens: activeTokens.length ? activeTokens : undefined,
    dosage,
    count,
    form,
    pack,
    seedQualityScore,
  };
};

const buildBrandVariants = (tokens: string[]): string[] => {
  if (!tokens.length) return [];
  const phrase = tokens.join(" ");
  const variants = new Set<string>([phrase]);
  if (tokens.length > 1) {
    const hyphenated = tokens.join("-");
    variants.add(hyphenated);
  }
  return Array.from(variants);
};

const buildDosageVariants = (dosage?: SecondarySeedV2["dosage"]): string[] => {
  if (!dosage) return [];
  const value = dosage.value;
  const unit = dosage.unit;
  const normalized = Number.isInteger(value) ? String(value) : value.toString();
  const withComma = Number.isInteger(value) ? value.toLocaleString("en-US") : normalized;
  return Array.from(
    new Set<string>([`${normalized}${unit}`, `${normalized} ${unit}`, `${withComma} ${unit}`]),
  );
};

const buildCountVariants = (count?: SecondarySeedV2["count"]): string[] => {
  if (!count) return [];
  const value = Number.isInteger(count.value) ? String(count.value) : count.value.toString();
  const variants = new Set<string>([value]);
  if (count.unitHint) {
    variants.add(`${value} ${count.unitHint}`);
  }
  variants.add(`${value} ct`);
  variants.add(`${value} count`);
  return Array.from(variants);
};

const buildFormVariants = (form?: SecondarySeedV2["form"]): string[] => {
  if (!form) return [];
  const variants = new Set<string>([form]);
  if (form === "capsule") variants.add("capsules");
  if (form === "tablet") variants.add("tablets");
  if (form === "caplet") variants.add("caplets");
  if (form === "softgel") variants.add("softgels");
  if (form === "gummy") variants.add("gummies");
  return Array.from(variants);
};

const quoteVariant = (value: string): string => (/[^a-z0-9]/i.test(value) ? `"${value}"` : value);

const buildQueryVariant = (params: {
  id: QueryVariant["id"];
  mustGroups: Array<{ id: string; variants: string[] }>;
  shouldGroups: Array<{ id: string; variants: string[] }>;
  allowDomains?: string[];
  excludeInQuery?: string[];
  maxChars: number;
  maxVariantsPerGroup: number;
}): QueryVariant => {
  const { id, allowDomains, excludeInQuery, maxChars, maxVariantsPerGroup } = params;
  const dropped: string[] = [];
  const mustGroups = params.mustGroups.map((group) => ({
    ...group,
    variants: group.variants.slice(0, Math.max(1, maxVariantsPerGroup)),
  }));
  const shouldGroups = params.shouldGroups.map((group) => ({
    ...group,
    variants: group.variants.slice(0, Math.max(1, maxVariantsPerGroup)),
  }));

  const formatGroup = (group: { variants: string[] }): string => {
    if (!group.variants.length) return "";
    const items = group.variants.map((variant) => quoteVariant(variant));
    return items.length > 1 ? `(${items.join(" OR ")})` : items[0];
  };

  const buildQuery = (): string => {
    const parts: string[] = [];
    mustGroups.forEach((group) => {
      const value = formatGroup(group);
      if (value) parts.push(value);
    });
    shouldGroups.forEach((group) => {
      const value = formatGroup(group);
      if (value) parts.push(value);
    });
    if (allowDomains?.length) {
      parts.push(`(${allowDomains.map((domain) => `site:${domain}`).join(" OR ")})`);
    }
    if (excludeInQuery?.length) {
      parts.push(excludeInQuery.map((domain) => `-site:${domain}`).join(" "));
    }
    return parts.join(" ").trim();
  };

  const reduceVariants = (groupId: string, targetLength: number) => {
    const group = [...mustGroups, ...shouldGroups].find((item) => item.id === groupId);
    if (!group || group.variants.length <= targetLength) return;
    const removed = group.variants.splice(targetLength);
    dropped.push(`${groupId}_variants:${removed.join(",")}`);
  };

  const dropGroup = (groupId: string) => {
    const group = shouldGroups.find((item) => item.id === groupId);
    if (!group || !group.variants.length) return;
    dropped.push(groupId);
    group.variants = [];
  };

  const trimAllowDomains = (targetLength: number) => {
    if (!allowDomains || allowDomains.length <= targetLength) return;
    const removed = allowDomains.splice(targetLength);
    dropped.push(`domains_trimmed:${removed.join(",")}`);
  };

  let query = buildQuery();
  while (query.length > maxChars) {
    if (shouldGroups.find((group) => group.id === "active" && group.variants.length)) {
      dropGroup("active");
    } else if (shouldGroups.find((group) => group.id === "form" && group.variants.length)) {
      dropGroup("form");
    } else if (shouldGroups.find((group) => group.id === "count" && group.variants.length)) {
      dropGroup("count");
    } else if (shouldGroups.find((group) => group.id === "count")) {
      reduceVariants("count", 1);
    } else if (mustGroups.find((group) => group.id === "dosage" && group.variants.length > 1)) {
      reduceVariants("dosage", 1);
    } else if (mustGroups.find((group) => group.id === "brand" && group.variants.length > 1)) {
      reduceVariants("brand", 1);
    } else if (allowDomains && allowDomains.length > 6) {
      trimAllowDomains(6);
    } else {
      break;
    }
    query = buildQuery();
  }

  const usedVariants = {
    brand: mustGroups.find((group) => group.id === "brand")?.variants ?? [],
    dosage: mustGroups.find((group) => group.id === "dosage")?.variants ?? [],
    count: shouldGroups.find((group) => group.id === "count")?.variants ?? [],
    form: shouldGroups.find((group) => group.id === "form")?.variants ?? [],
  };
  const mustSummary = mustGroups.map((group) => `${group.id}:${group.variants.join("|")}`).filter(Boolean);
  const shouldSummary = shouldGroups.map((group) => `${group.id}:${group.variants.join("|")}`).filter(Boolean);

  return {
    id,
    query,
    mustGroups: mustSummary,
    shouldGroups: shouldSummary,
    usedVariants,
    charLen: query.length,
    dropped,
  };
};

const buildSecondarySeedQueryPlan = (
  seed: SecondarySeedV2,
  opts: {
    region: "CA" | "US";
    domainLadderSites: string[];
    bannedDomains: string[];
    maxQueryChars?: number;
    maxVariantsPerGroup?: number;
    includeActivesAsShould?: boolean;
    excludeInQuery?: string[];
  },
): SecondaryQueryPlan => {
  const maxQueryChars = opts.maxQueryChars ?? SECONDARY_QUERY_MAX_CHARS;
  const maxVariantsPerGroup = opts.maxVariantsPerGroup ?? SECONDARY_QUERY_MAX_VARIANTS_PER_GROUP;
  const brandVariants = buildBrandVariants(seed.brandTokens);
  const dosageVariants = buildDosageVariants(seed.dosage);
  const countVariants = buildCountVariants(seed.count);
  const formVariants = buildFormVariants(seed.form);
  const activeVariants = (opts.includeActivesAsShould ? seed.activeTokens ?? [] : []).slice(0, maxVariantsPerGroup);

  const mustGroups: Array<{ id: string; variants: string[] }> = [];
  const shouldGroups: Array<{ id: string; variants: string[] }> = [];

  if (brandVariants.length) {
    mustGroups.push({ id: "brand", variants: brandVariants });
  }

  if (dosageVariants.length) {
    mustGroups.push({ id: "dosage", variants: dosageVariants });
  } else if (countVariants.length) {
    mustGroups.push({ id: "count", variants: countVariants });
  }

  if (countVariants.length && !mustGroups.find((group) => group.id === "count")) {
    shouldGroups.push({ id: "count", variants: countVariants });
  }
  if (formVariants.length) {
    shouldGroups.push({ id: "form", variants: formVariants });
  }
  if (activeVariants.length) {
    shouldGroups.push({ id: "active", variants: activeVariants });
  }

  const primary = buildQueryVariant({
    id: "domain_ladder",
    mustGroups,
    shouldGroups,
    allowDomains: [...opts.domainLadderSites],
    excludeInQuery: [],
    maxChars: maxQueryChars,
    maxVariantsPerGroup,
  });

  const secondary = buildQueryVariant({
    id: "open_web",
    mustGroups: mustGroups.filter((group) => group.id !== "count"),
    shouldGroups: [],
    allowDomains: [],
    excludeInQuery: opts.excludeInQuery ?? [],
    maxChars: maxQueryChars,
    maxVariantsPerGroup,
  });

  return {
    primary,
    secondary: secondary.query ? secondary : undefined,
    bannedDomains: opts.bannedDomains,
    diagnostics: {
      maxQueryChars,
      maxVariantsPerGroup,
      seedSummary: {
        brand: seed.brandTokens,
        dosage: seed.dosage ? `${seed.dosage.value} ${seed.dosage.unit}` : undefined,
        count: seed.count ? `${seed.count.value}${seed.count.unitHint ? ` ${seed.count.unitHint}` : ""}` : undefined,
        form: seed.form,
      },
    },
  };
};

type SecondarySeedMatch = {
  score: number;
  overlapRatio: number;
  brandHit: boolean;
  numericHits: number;
  dosageHit: boolean;
  countHit: boolean;
  qualified: boolean;
};

const tokenizeForSeedMatch = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const matchesVariantInText = (candidateText: string, variant: string): boolean => {
  const lower = variant.toLowerCase();
  if (candidateText.includes(lower)) return true;
  const compact = lower.replace(/\s+/g, "");
  return compact !== lower && candidateText.includes(compact);
};

const computeSeedMatch = (item: SearchItem, seed: SecondarySeedV2): SecondarySeedMatch => {
  const candidateText = `${item.title ?? ""} ${item.snippet ?? ""} ${item.link ?? ""}`.toLowerCase();
  const candidateTokens = new Set(tokenizeForSeedMatch(candidateText));
  const brandVariants = buildBrandVariants(seed.brandTokens).map((token) => token.toLowerCase());
  const brandHit = brandVariants.length ? brandVariants.some((token) => candidateText.includes(token)) : false;

  const dosageVariants = buildDosageVariants(seed.dosage);
  const dosageHit = dosageVariants.some((variant) => matchesVariantInText(candidateText, variant));

  const countVariants = buildCountVariants(seed.count);
  const countHit = countVariants.some((variant) => matchesVariantInText(candidateText, variant));

  const numericHits = (dosageHit ? 1 : 0) + (countHit ? 1 : 0);

  const overlapTokens = new Set(
    [
      ...seed.brandTokens.map((token) => token.toLowerCase()),
      ...(seed.activeTokens ?? []).flatMap((token) => tokenizeForSeedMatch(token)),
      ...(seed.dosage ? [String(seed.dosage.value)] : []),
      ...(seed.count ? [String(seed.count.value)] : []),
      ...(seed.form ? [seed.form] : []),
    ].filter(Boolean),
  );
  let overlapHits = 0;
  overlapTokens.forEach((token) => {
    if (candidateTokens.has(token) || candidateText.includes(token)) overlapHits += 1;
  });
  const overlapRatio = overlapTokens.size ? overlapHits / overlapTokens.size : 0;

  const requireDosageHit = Boolean(seed.dosage);
  const requireCountHit = !seed.dosage && Boolean(seed.count);
  const qualified =
    (seed.brandTokens.length ? brandHit : true) &&
    (!requireDosageHit || dosageHit) &&
    (!requireCountHit || countHit) &&
    overlapRatio >= SECONDARY_SEED_MATCH_MIN;

  return {
    score: Math.round(overlapRatio * 100) / 100,
    overlapRatio: Math.round(overlapRatio * 100) / 100,
    brandHit,
    numericHits,
    dosageHit,
    countHit,
    qualified,
  };
};

// ============================================================================
// SEARCH RESULT MERGING
// ============================================================================

/**
 * Merge and deduplicate search results, prioritizing high-quality domains
 */
const TRACKING_QUERY_PARAM_PREFIXES = ["utm_"];
const TRACKING_QUERY_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "spm",
  "ref",
]);

const canonicalizeUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix)) || TRACKING_QUERY_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

function mergeAndDedupe(
  primary: SearchItem[],
  secondary: SearchItem[],
  options: { barcode?: string } = {},
): SearchItem[] {
  const candidates = new Map<
    string,
    {
      item: SearchItem;
      score: number;
      hasImage: boolean;
      sourceRank: number;
      insertionOrder: number;
    }
  >();

  const addItem = (item: SearchItem, sourceRank: number, insertionOrder: number) => {
    const key = canonicalizeUrl(item.link);
    const score = scoreSearchItem(item, { barcode: options.barcode });
    const hasImage = Boolean(item.image);
    const existing = candidates.get(key);

    if (!existing) {
      candidates.set(key, { item, score, hasImage, sourceRank, insertionOrder });
      return;
    }

    const shouldReplace =
      score > existing.score ||
      (score === existing.score && hasImage && !existing.hasImage) ||
      (score === existing.score && hasImage === existing.hasImage && sourceRank < existing.sourceRank);

    if (shouldReplace) {
      candidates.set(key, {
        item,
        score,
        hasImage,
        sourceRank,
        insertionOrder: Math.min(existing.insertionOrder, insertionOrder),
      });
    }
  };

  let insertionOrder = 0;
  for (const item of primary) {
    addItem(item, 0, insertionOrder++);
  }
  for (const item of secondary) {
    addItem(item, 1, insertionOrder++);
  }

  return [...candidates.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Number(b.hasImage) !== Number(a.hasImage)) return Number(b.hasImage) - Number(a.hasImage);
      if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
      return a.insertionOrder - b.insertionOrder;
    })
    .map((entry) => entry.item)
    .slice(0, MAX_RESULTS);
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.set("trust proxy", 1); // P1-2: Trust first proxy for correct client IP
// React Native fetch can send If-None-Match and a 304 response has no body, which can blank the UI
// if the client calls response.json(). Disable ETag to keep API responses simple and predictable.
app.set("etag", false);
app.use(cors());
app.use(express.json({ limit: "10mb" })); // P0-2: Increased from 1mb for image base64

// Minimal request logging (no body / no secrets)
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  const startedAt = process.hrtime.bigint();
  let finished = false;
  let aborted = false;
  const recordRouteTimingMetrics = (durationMs: number) => {
    recordKnownScanSidecarRouteTimings({ path: req.path, durationMs });
  };

  res.on("finish", () => {
    finished = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordRouteTimingMetrics(durationMs);
    if (!HTTP_ACCESS_LOG_ENABLED) return;
    // Avoid noisy health check logs (Render pings this frequently).
    if (req.path === "/health") return;

    const durationLabel = `${durationMs.toFixed(1)}ms`;
    console.log(`[HTTP] ${res.statusCode} ${req.method} ${req.path} (${durationLabel}) id=${requestId}`);
  });
  req.on("aborted", () => {
    aborted = true;
    if (!HTTP_ACCESS_LOG_ENABLED) return;
    if (req.path === "/health") return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const durationLabel = `${durationMs.toFixed(1)}ms`;
    console.warn(`[HTTP_ABORTED] ${req.method} ${req.path} (${durationLabel}) id=${requestId}`);
  });
  res.on("close", () => {
    if (req.path === "/api/product-overview-ai/v1" && !finished) {
      incrementMetric("product_overview_ai_closed_early_rate");
    }
    if (!HTTP_ACCESS_LOG_ENABLED) return;
    if (req.path === "/health") return;
    if (finished) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const durationLabel = `${durationMs.toFixed(1)}ms`;
    const suffix = aborted ? "aborted" : "closed_early";
    console.warn(`[HTTP_CLOSE] ${req.method} ${req.path} (${durationLabel}) id=${requestId} ${suffix}`);
  });

  next();
});

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    email?: string | null;
  };
  // Set only when the request is authenticated via REGRESSION_AUTH_TOKEN.
  // Used to gate internal debug/audit fields from normal users.
  regressionAuth?: boolean;
};

const authDisabled =
  process.env.DISABLE_AUTH === "true" || process.env.DISABLE_AUTH === "1";
const allowAuthBypass =
  process.env.ALLOW_AUTH_BYPASS === "true" || process.env.ALLOW_AUTH_BYPASS === "1";
const regressionAuthToken = process.env.REGRESSION_AUTH_TOKEN ?? null;
const regressionAuthRoutes = new Set([
  "/api/enrich-stream",
  "/api/analysis-section",
  "/api/summary/ingredient",
  "/api/summary/usage",
  "/api/summary/safety",
  "/api/kb/runtime/form-insights/batch",
  "/api/patch-shadow/status",
]);
const decisionSupportFetchCounter = createDecisionSupportFetchCounter({
  onRefetch: () => incrementMetric("decision_support_refetch_count_per_scan"),
});

const verifySupabaseToken = async (req: Request, res: Response, next: NextFunction) => {
  const authBypassHeader = req.headers["x-auth-disabled"];
  const allowBypass =
    (Array.isArray(authBypassHeader)
      ? authBypassHeader.includes("1")
      : authBypassHeader === "1") &&
    (process.env.NODE_ENV !== "production" || allowAuthBypass);
  const regressionHeader = req.headers["x-regression-token"];
  const hasRegressionTokenHeader = Array.isArray(regressionHeader)
    ? regressionHeader.some((value) => String(value ?? "").trim().length > 0)
    : String(regressionHeader ?? "").trim().length > 0;
  // CI regression requests may also carry x-auth-disabled for preview/staging convenience.
  // Mark regression auth first so internal debug/audit contracts stay gated by the token,
  // not accidentally hidden by the broader auth-bypass path. On staging/preview, auth-disabled
  // modes are the environment gate; a non-empty regression token header selects the CI contract.
  if (regressionAuthRoutes.has(req.path)) {
    const hasRegressionToken = regressionAuthToken
      ? (
        Array.isArray(regressionHeader)
          ? regressionHeader.includes(regressionAuthToken)
          : regressionHeader === regressionAuthToken
      )
      : false;
    const hasBypassRegressionMarker =
      (authDisabled || allowBypass) && hasRegressionTokenHeader;
    if (hasRegressionToken || hasBypassRegressionMarker) {
      (req as AuthenticatedRequest).regressionAuth = true;
      return next();
    }
  }

  if (authDisabled) {
    return next();
  }
  if (allowBypass) {
    const debugUserHeader = req.headers["x-debug-user-id"];
    const debugUserId = Array.isArray(debugUserHeader)
      ? String(debugUserHeader[0] ?? "").trim()
      : String(debugUserHeader ?? "").trim();
    if (debugUserId) {
      (req as AuthenticatedRequest).user = { id: debugUserId };
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .json({ error: "missing_authorization" } satisfies ErrorResponse);
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: "invalid_authorization" } satisfies ErrorResponse);
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res
        .status(403)
        .json({ error: "invalid_or_expired_token" } satisfies ErrorResponse);
    }

    (req as AuthenticatedRequest).user = data.user;
    return next();
  } catch (error) {
    captureException(error, { route: "verifySupabaseToken" });
    return res
      .status(503)
      .json({ error: "auth_unavailable" } satisfies ErrorResponse);
  }
};

const parseRequestBody = <T>(schema: z.ZodType<T>, req: Request, res: Response): T | null => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "invalid_request", detail: parsed.error.message } satisfies ErrorResponse);
    return null;
  }
  return parsed.data;
};

// ============================================================================
// SSE HELPER
// ============================================================================

const getScoreAvailableFromSourceType = (sourceType: unknown): boolean | null => {
  if (sourceType === "web") return false;
  if (sourceType === "dsld" || sourceType === "lnhpd") return true;
  return null;
};

const normalizeAnalysisBundleForStream = (candidate: unknown): unknown => {
  if (!candidate || typeof candidate !== "object") return candidate;
  const bundle = candidate as Record<string, unknown>;
  const meta = bundle.meta;
  if (!meta || typeof meta !== "object") return candidate;
  const metaRecord = meta as Record<string, unknown>;
  const fromMeta = typeof metaRecord.scoreAvailable === "boolean" ? metaRecord.scoreAvailable : null;
  const fromSource = getScoreAvailableFromSourceType(metaRecord.sourceType);
  const resolved = fromMeta ?? fromSource;
  if (resolved === null) return candidate;
  if (fromMeta === resolved) return candidate;
  return {
    ...bundle,
    meta: {
      ...metaRecord,
      scoreAvailable: resolved,
    },
  };
};

const buildPersistedEventFromBundle = (candidate: unknown): Record<string, unknown> | null => {
  if (!candidate || typeof candidate !== "object") return null;
  const bundle = candidate as Record<string, unknown>;
  const meta = bundle.meta;
  if (!meta || typeof meta !== "object") return null;
  const metaRecord = meta as Record<string, unknown>;
  const identity = metaRecord.authoritativeIdentity;
  if (!identity || typeof identity !== "object") return null;
  const identityRecord = identity as Record<string, unknown>;
  if (typeof identityRecord.type !== "string" || typeof identityRecord.value !== "string") return null;
  if (typeof metaRecord.factsDigestHash !== "string" || !metaRecord.factsDigestHash.trim()) return null;
  const revision = typeof metaRecord.revision === "number" ? metaRecord.revision : null;
  if (revision === null || revision < 1) return null;
  const scoreAvailableFromMeta =
    typeof metaRecord.scoreAvailable === "boolean" ? metaRecord.scoreAvailable : null;
  const scoreAvailable = scoreAvailableFromMeta ?? getScoreAvailableFromSourceType(metaRecord.sourceType);
  return {
    identity: {
      type: identityRecord.type,
      value: identityRecord.value,
    },
    factsDigestHash: metaRecord.factsDigestHash,
    promptVersion: typeof metaRecord.promptVersion === "string" ? metaRecord.promptVersion : null,
    bundleId: typeof metaRecord.bundleId === "string" ? metaRecord.bundleId : null,
    revision,
    phase: typeof metaRecord.phase === "string" ? metaRecord.phase : null,
    locale: typeof metaRecord.locale === "string" ? metaRecord.locale : null,
    sourceType: typeof metaRecord.sourceType === "string" ? metaRecord.sourceType : null,
    scoreAvailable: scoreAvailable ?? null,
  };
};

const buildSseFrame = (type: string, data: unknown): string =>
  `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const safeSendSse = (res: Response, type: string, data: unknown): boolean => {
  if (res.writableEnded || (res as unknown as { destroyed?: boolean }).destroyed) {
    return false;
  }
  try {
    const payload = type === "analysis_bundle" ? normalizeAnalysisBundleForStream(data) : data;
    // Single-frame write keeps event/data boundary deterministic for SSE clients.
    res.write(buildSseFrame(type, payload));
    // Best-effort flush helps reduce proxy/socket buffering of terminal frames.
    (res as unknown as { flush?: () => void }).flush?.();
    return !res.writableEnded;
  } catch {
    return false;
  }
};

const sendSSE = (res: Response, type: string, data: unknown) => {
  void safeSendSse(res, type, data);
};

const createRequestAbort = (res: Response) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort(new Error("client_disconnected")));
  return controller;
};

const abortable = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) {
    throw signal.reason ?? new Error("aborted");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

const withTimeoutPromise = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> => {
  const timeoutSignal = createTimeoutSignal(timeoutMs);
  const { signal: combined, cleanup } = combineSignals([signal, timeoutSignal]);
  try {
    return await abortable(promise, combined);
  } finally {
    cleanup();
  }
};

type EnrichStreamAdmissionRejectCode = "QUEUE_FULL" | "QUEUE_WAIT_TIMEOUT" | "ABORTED";

class EnrichStreamAdmissionError extends Error {
  readonly code: EnrichStreamAdmissionRejectCode;

  constructor(code: EnrichStreamAdmissionRejectCode, message: string) {
    super(message);
    this.name = "EnrichStreamAdmissionError";
    this.code = code;
  }
}

type EnrichStreamAdmissionLease = {
  release: () => void;
  queuedMs: number;
};

type EnrichStreamAdmissionWaiter = {
  enqueuedAt: number;
  resolve: (lease: EnrichStreamAdmissionLease) => void;
  reject: (error: EnrichStreamAdmissionError) => void;
  timeout?: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
};

class EnrichStreamAdmissionGate {
  private active = 0;
  private readonly queue: EnrichStreamAdmissionWaiter[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueue: number,
  ) { }

  getState() {
    return {
      active: this.active,
      queue: this.queue.length,
      maxActive: this.maxActive,
      maxQueue: this.maxQueue,
    };
  }

  async acquire(options: { signal?: AbortSignal; waitMs?: number } = {}): Promise<EnrichStreamAdmissionLease> {
    if (this.active < this.maxActive) {
      this.active += 1;
      return {
        release: this.createRelease(),
        queuedMs: 0,
      };
    }

    if (this.queue.length >= this.maxQueue) {
      throw new EnrichStreamAdmissionError("QUEUE_FULL", "enrich_stream_queue_full");
    }

    const waitMs = Math.max(0, Number(options.waitMs ?? ENRICH_STREAM_QUEUE_WAIT_MS));
    if (waitMs <= 0) {
      throw new EnrichStreamAdmissionError("QUEUE_WAIT_TIMEOUT", "enrich_stream_queue_wait_timeout");
    }

    return await new Promise<EnrichStreamAdmissionLease>((resolve, reject) => {
      const waiter: EnrichStreamAdmissionWaiter = {
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      const clearWaiter = () => {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
        }
        waiter.cleanup?.();
      };

      const removeWaiter = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
      };

      waiter.timeout = setTimeout(() => {
        removeWaiter();
        clearWaiter();
        reject(new EnrichStreamAdmissionError("QUEUE_WAIT_TIMEOUT", "enrich_stream_queue_wait_timeout"));
      }, waitMs);

      if (options.signal) {
        if (options.signal.aborted) {
          clearWaiter();
          reject(new EnrichStreamAdmissionError("ABORTED", "enrich_stream_request_aborted"));
          return;
        }
        const onAbort = () => {
          removeWaiter();
          clearWaiter();
          reject(new EnrichStreamAdmissionError("ABORTED", "enrich_stream_request_aborted"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        waiter.cleanup = () => options.signal?.removeEventListener("abort", onAbort);
      }

      this.queue.push(waiter);
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.dispatch();
    };
  }

  private dispatch() {
    while (this.active < this.maxActive && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) return;
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.cleanup?.();
      this.active += 1;
      waiter.resolve({
        release: this.createRelease(),
        queuedMs: Math.max(0, Date.now() - waiter.enqueuedAt),
      });
    }
  }
}

const enrichStreamAdmissionGateFull = new EnrichStreamAdmissionGate(
  ENRICH_STREAM_MAX_ACTIVE_FULL,
  ENRICH_STREAM_MAX_QUEUE_FULL,
);
const enrichStreamAdmissionGateBundleOnly = new EnrichStreamAdmissionGate(
  ENRICH_STREAM_MAX_ACTIVE_BUNDLE_ONLY,
  ENRICH_STREAM_MAX_QUEUE_BUNDLE_ONLY,
);

type EnrichStreamAdmissionLane = "full" | "bundle_only";

const selectEnrichStreamAdmissionGate = (
  lane: EnrichStreamAdmissionLane,
): EnrichStreamAdmissionGate =>
  lane === "bundle_only" ? enrichStreamAdmissionGateBundleOnly : enrichStreamAdmissionGateFull;

const barcodeEnrichInFlight = new Map<string, Promise<void>>();
const barcodeEnrichBackground = new Map<string, Promise<void>>();
const barcodeShadowInFlight = new Map<string, Promise<void>>();
const barcodeSecondaryBackfill = new Map<string, Promise<void>>();
const analysisSectionRateLimit = new Map<string, { count: number; windowStart: number }>();
// End-user guardrail: prevents accidental hot-loops from clients. This should be high enough to
// tolerate legitimate UI flows (open/close, retries) and low enough to stop runaway spam.
const ANALYSIS_SECTION_RATE_LIMIT_PER_MINUTE = Math.max(
  6,
  Number(process.env.ANALYSIS_SECTION_RATE_LIMIT_PER_MINUTE ?? 30),
);
const dsldDetailEnrichInFlight = new Map<string, Promise<void>>();

const queueShadowCompare = (params: {
  barcodeGtin14: string;
  normalized: NormalizedBarcode;
  apiKey: string;
  cx: string;
  gl: string;
  hl: string;
  outcome: string;
  stage0Outcome: string;
  requestPath: string;
  clientVersion: string | null;
  featureFlags: Record<string, unknown>;
  parentProfilesUsed?: string[] | null;
  parentSelectedUrl?: string | null;
  parentSelectedDomain?: string | null;
}): boolean => {
  const shadowEnabled =
    process.env.SHADOW_COMPARE_ENABLE === "1" || process.env.SHADOW_COMPARE_ENABLE === "true";
  if (!shadowEnabled) return false;
  if (!params.apiKey || !params.cx) return false;

  const shadowKey = params.barcodeGtin14;
  if (barcodeShadowInFlight.has(shadowKey)) {
    return true;
  }

  const queries = buildBarcodeSearchQueries(params.normalized).slice(0, RESOLUTION_SHADOW_QUERY_LIMIT);
  if (!queries.length) {
    return false;
  }

  const task = (async () => {
    const shadowBudget = new DeadlineBudget(Date.now() + RESOLUTION_SHADOW_BUDGET_MS);
    const searchResilience: SearchResilienceOptions = {
      budget: shadowBudget,
      breaker: googleBreaker,
      semaphore: googleSemaphore,
      timeoutMs: RESILIENCE_GOOGLE_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 1 },
      gl: params.gl,
      hl: params.hl,
    };

    const buildSerpEntries = (items: SearchItem[]) =>
      items.map((item) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet ?? null,
        image: item.image ?? null,
      }));

    const shadowSignalsBase = {
      stage: "shadow_compare",
      parent_outcome: params.outcome,
      parent_profiles_used: params.parentProfilesUsed ?? null,
      parent_selected_url: params.parentSelectedUrl ?? null,
      parent_selected_domain: params.parentSelectedDomain ?? null,
      request_path: params.requestPath,
      client_version: params.clientVersion,
      feature_flags: params.featureFlags,
      shadow_queries_limit: RESOLUTION_SHADOW_QUERY_LIMIT,
    };

    try {
      const searchStart = performance.now();
      const legacy = await runSearchPlan(queries, params.apiKey, params.cx, {
        barcode: params.normalized.code,
        resilience: searchResilience,
      });
      const searchMs = Math.round(performance.now() - searchStart);
      const merged = legacy.merged;
      const qualityScore = merged.length ? scoreSearchQuality(merged, { barcode: params.normalized.code }) : 0;
      const marketplaceOnly =
        merged.length > 0 && merged.every((item) => isMarketplaceDomain(extractDomain(item.link)));
      const serpTopk = merged.length ? buildSerpEntries(merged.slice(0, MAX_RESULTS)) : null;
      const selectedUrl = merged[0]?.link ?? null;
      const selectedDomain = selectedUrl ? extractDomain(selectedUrl) : null;

      const signals = {
        ...shadowSignalsBase,
        shadow_queries_tried: legacy.queriesTried,
        shadow_items_count: merged.length,
        shadow_quality_score: qualityScore,
        shadow_marketplace_only: marketplaceOnly,
        shadow_hard_stop: legacy.hardStop,
        shadow_had_response: legacy.hadResponse,
        shadow_primary_count: legacy.primary.length,
        shadow_secondary_count: legacy.secondary.length,
      };

      await insertBarcodeResolutionTrainingRow(
        {
          barcode_gtin14: params.barcodeGtin14,
          engine_version: RESOLUTION_ENGINE_VERSION,
          stage0_outcome: params.stage0Outcome,
          query_profiles_used: null,
          serp_topk: serpTopk,
          selected_url: selectedUrl,
          selected_domain: selectedDomain,
          signals,
          facts_summary: null,
          facts_coverage: null,
          timing: { shadow_search_ms: searchMs },
          calls: {
            google: legacy.queriesTried.length,
            deepseek_bundle: 0,
            deepseek_repair: 0,
          },
          cache_hits: null,
          outcome: merged.length ? "SHADOW_COMPARE" : "SHADOW_COMPARE_EMPTY",
        },
        {
          breaker: supabaseReadBreaker,
          semaphore: supabaseReadSemaphore,
          timeoutMs: 900,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertBarcodeResolutionTrainingRow(
        {
          barcode_gtin14: params.barcodeGtin14,
          engine_version: RESOLUTION_ENGINE_VERSION,
          stage0_outcome: params.stage0Outcome,
          query_profiles_used: null,
          serp_topk: null,
          selected_url: null,
          selected_domain: null,
          signals: { ...shadowSignalsBase, shadow_error: message },
          facts_summary: null,
          facts_coverage: null,
          timing: {},
          calls: {
            google: 0,
            deepseek_bundle: 0,
            deepseek_repair: 0,
          },
          cache_hits: null,
          outcome: "SHADOW_COMPARE_FAILED",
        },
        {
          breaker: supabaseReadBreaker,
          semaphore: supabaseReadSemaphore,
          timeoutMs: 900,
        },
      );
    }
  })();

  barcodeShadowInFlight.set(shadowKey, task);
  task.finally(() => {
    barcodeShadowInFlight.delete(shadowKey);
  });
  return true;
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type BackgroundBackfillContext = {
  barcodeGtin14: string;
  stage0Outcome: string;
  parentOutcome: string | null;
  deepseekBundleSkippedReason?: string | null;
  profilesUsed?: string[] | null;
  serpTopk?: unknown | null;
  selectedUrl?: string | null;
  selectedDomain?: string | null;
  cacheHits?: Record<string, unknown> | null;
  calls?: Record<string, unknown> | null;
  signals?: Record<string, unknown> | null;
};

const recordBackgroundBackfillTraining = (
  context: BackgroundBackfillContext | null | undefined,
  input: {
    success: boolean;
    llmMs: number;
    repairUsed: boolean;
    reason?: string | null;
    budget: DeadlineBudget;
  },
): void => {
  if (!context) return;
  const signals = {
    background_backfill_started: true,
    background_backfill_success: input.success,
    parent_outcome: context.parentOutcome ?? null,
    deepseek_bundle_skipped_reason: context.deepseekBundleSkippedReason ?? null,
    ...(input.reason ? { background_failure_reason: input.reason } : {}),
    ...(context.signals ?? {}),
  };
  void insertBarcodeResolutionTrainingRow(
    {
      barcode_gtin14: context.barcodeGtin14,
      engine_version: RESOLUTION_ENGINE_VERSION,
      stage0_outcome: context.stage0Outcome,
      query_profiles_used: context.profilesUsed ?? null,
      serp_topk: context.serpTopk ?? null,
      selected_url: context.selectedUrl ?? null,
      selected_domain: context.selectedDomain ?? null,
      signals,
      facts_summary: null,
      facts_coverage: null,
      timing: { background_llm_ms: input.llmMs },
      calls: {
        google: 0,
        deepseek_bundle: 1,
        deepseek_repair: input.repairUsed ? 1 : 0,
      },
      cache_hits: context.cacheHits ?? null,
      outcome: input.success ? "BACKGROUND_BACKFILL_SUCCESS" : "BACKGROUND_BACKFILL_FAILED",
    },
    {
      budget: input.budget,
      breaker: supabaseReadBreaker,
      semaphore: supabaseReadSemaphore,
      queueTimeoutMs: RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS,
      timeoutMs: 900,
    },
  );
};

const queueBarcodeAnalysisCompletion = (params: {
  cacheKey: string;
  barcode: string;
  detailItems: SearchItem[];
  analysisContext: string;
  analysisPayload: SnapshotAnalysisPayload;
  snapshot: SupplementSnapshot;
  model: string;
  deepseekKey: string;
  training?: BackgroundBackfillContext | null;
}): boolean => {
  if (barcodeEnrichBackground.has(params.cacheKey)) {
    return true;
  }
  if (!deepseekBreaker.canRequest()) {
    return false;
  }

  const task = (async () => {
    const backgroundBudget = new DeadlineBudget(Date.now() + RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS);
    const backgroundTimeoutMs = RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS;
    const backgroundResilience: DeepseekResilienceOptions = {
      budget: backgroundBudget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: backgroundTimeoutMs,
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 2 },
    };

    const llmStart = performance.now();
    const bundle = await fetchAnalysisBundle(
      params.analysisContext,
      params.model,
      params.deepseekKey,
      backgroundResilience,
    );
    const llmMs = Math.round(performance.now() - llmStart);
    const repairUsed = Boolean((bundle as { _meta?: { repairUsed?: boolean } } | null)?._meta?.repairUsed);
    if (!bundle) {
      const timedOut = llmMs >= Math.max(200, backgroundTimeoutMs - 50);
      const failureReason = backgroundBudget.isExpired()
        ? "budget_exhausted"
        : timedOut
          ? "llm_timeout"
          : "llm_failed";
      recordBackgroundBackfillTraining(params.training ?? null, {
        success: false,
        llmMs,
        repairUsed,
        reason: failureReason,
        budget: backgroundBudget,
      });
      return;
    }

    const efficacyResult = bundle.efficacy ?? null;
    const safetyResult = bundle.safety ?? null;
    const usageResult = bundle.usagePayload ?? null;
    if (!efficacyResult && !safetyResult && !usageResult) {
      recordBackgroundBackfillTraining(params.training ?? null, {
        success: false,
        llmMs,
        repairUsed,
        reason: "empty_bundle",
        budget: backgroundBudget,
      });
      return;
    }

    const efficacyMerged = mergeEfficacyWithFallback(
      efficacyResult,
      params.analysisPayload.efficacy ?? null,
    );
    const safetyMerged = mergeSafetyWithFallback(
      safetyResult,
      params.analysisPayload.safety ?? null,
    );
    const usageMerged = mergeUsagePayloadWithFallback(
      usageResult,
      params.analysisPayload.usagePayload ?? null,
    );

    const nextAnalysisPayload: SnapshotAnalysisPayload = {
      ...params.analysisPayload,
      efficacy: efficacyMerged,
      safety: safetyMerged,
      usagePayload: usageMerged,
    };

    const analysisSnapshot = buildBarcodeSnapshot({
      barcode: params.barcode,
      productInfo: nextAnalysisPayload.productInfo ?? null,
      sources: params.detailItems,
      efficacy: efficacyMerged,
      safety: safetyMerged,
      usagePayload: usageMerged,
    });

    const mergedReferences = mergeReferenceItems(
      params.snapshot.references,
      analysisSnapshot.references,
    );

    const updatedSnapshot: SupplementSnapshot = {
      ...params.snapshot,
      status: analysisSnapshot.status,
      references: mergedReferences,
      updatedAt: nowIso(),
    };

    const analysisStatus = buildAnalysisStatus({
      hasLabelFacts: hasLabelFacts(updatedSnapshot),
      hasAi: hasAiPayload(nextAnalysisPayload),
      dsldLabelId: updatedSnapshot.regulatory.dsldLabelId ?? null,
    });
    const analysisMeta = buildAnalysisMeta({
      status: analysisStatus,
      labelExtraction:
        nextAnalysisPayload.analysis?.labelExtraction ??
        params.snapshot.analysis?.labelExtraction ??
        null,
      overlayAugmentation:
        nextAnalysisPayload.analysis?.overlayAugmentation ??
        params.snapshot.analysis?.overlayAugmentation ??
        null,
    });
    nextAnalysisPayload.analysis = analysisMeta;
    updatedSnapshot.analysis = analysisMeta;

    void storeSnapshotCache(
      {
        key: params.cacheKey,
        source: "barcode",
        snapshot: updatedSnapshot,
        analysisPayload: nextAnalysisPayload,
        expiresAt: computeExpiresAt(analysisStatus),
      },
      { budget: backgroundBudget },
    );

    recordBackgroundBackfillTraining(params.training ?? null, {
      success: true,
      llmMs,
      repairUsed,
      budget: backgroundBudget,
    });
  })();

  barcodeEnrichBackground.set(params.cacheKey, task);
  task.finally(() => {
    barcodeEnrichBackground.delete(params.cacheKey);
  });
  return true;
};

const queueFirstPartyAnalysisCompletion = (params: {
  cacheKey: string;
  barcode: string;
  model: string;
  deepseekKey: string;
  snapshot: SupplementSnapshot;
  analysisPayload: SnapshotAnalysisPayload;
  labelFacts: LabelFacts | null;
}): void => {
  if (barcodeEnrichBackground.has(params.cacheKey)) {
    return;
  }
  if (!deepseekBreaker.canRequest()) {
    return;
  }

  const task = (async () => {
    const backgroundBudget = new DeadlineBudget(Date.now() + RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS);
    const backgroundResilience: DeepseekResilienceOptions = {
      budget: backgroundBudget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 2 },
    };

    const facts = params.labelFacts ?? buildLabelFactsFromSnapshot(params.snapshot);
    if (!facts) {
      return;
    }

    const brand = params.analysisPayload.productInfo?.brand ?? params.snapshot.product.brand ?? null;
    const name = params.analysisPayload.productInfo?.name ?? params.snapshot.product.name ?? null;
    const context = `PRODUCT INFORMATION (first-party label facts):
Brand: ${brand ?? "Unknown"}
Product Name: ${name ?? "Unknown"}
Barcode: ${params.barcode}

LABEL FACTS (structured json):
${JSON.stringify(facts)}

TASK: Analyze this supplement based on the label facts above.
Focus on: ingredient forms, dosage adequacy, evidence strength, safety risks/ULs, interactions, allergens, and practical usage guidance.
If information is not available, use null instead of guessing.

${LABEL_FACTS_OUTPUT_RULES}`;

    const bundle = await fetchAnalysisBundle(context, params.model, params.deepseekKey, backgroundResilience);
    if (!bundle) {
      return;
    }

    const efficacyResult = bundle.efficacy ?? null;
    const safetyResult = bundle.safety ?? null;
    const usageResult = bundle.usagePayload ?? null;
    if (!efficacyResult && !safetyResult && !usageResult) {
      return;
    }

    const efficacyMerged = mergeEfficacyWithFallback(efficacyResult, params.analysisPayload.efficacy ?? null);
    const safetyMerged = mergeSafetyWithFallback(safetyResult, params.analysisPayload.safety ?? null);
    const usageMerged = mergeUsagePayloadWithFallback(usageResult, params.analysisPayload.usagePayload ?? null);

    const nextAnalysisPayload: SnapshotAnalysisPayload = {
      ...params.analysisPayload,
      efficacy: efficacyMerged,
      safety: safetyMerged,
      usagePayload: usageMerged,
    };

    const analysisSnapshot = buildBarcodeSnapshot({
      barcode: params.barcode,
      productInfo: nextAnalysisPayload.productInfo ?? null,
      sources: [],
      efficacy: efficacyMerged,
      safety: safetyMerged,
      usagePayload: usageMerged,
    });

    const mergedReferences = mergeReferenceItems(params.snapshot.references, analysisSnapshot.references);

    const updatedSnapshot: SupplementSnapshot = {
      ...params.snapshot,
      status: analysisSnapshot.status,
      references: mergedReferences,
      updatedAt: nowIso(),
    };

    const analysisStatus = buildAnalysisStatus({
      hasLabelFacts: hasLabelFacts(updatedSnapshot),
      hasAi: hasAiPayload(nextAnalysisPayload),
      dsldLabelId: updatedSnapshot.regulatory.dsldLabelId ?? null,
    });
    const analysisMeta = buildAnalysisMeta({
      status: analysisStatus,
      labelExtraction:
        nextAnalysisPayload.analysis?.labelExtraction ??
        params.snapshot.analysis?.labelExtraction ??
        null,
      overlayAugmentation:
        nextAnalysisPayload.analysis?.overlayAugmentation ??
        params.snapshot.analysis?.overlayAugmentation ??
        null,
    });
    nextAnalysisPayload.analysis = analysisMeta;
    updatedSnapshot.analysis = analysisMeta;

    void storeSnapshotCache(
      {
        key: params.cacheKey,
        source: "barcode",
        snapshot: updatedSnapshot,
        analysisPayload: nextAnalysisPayload,
        expiresAt: computeExpiresAt(analysisStatus),
      },
      { budget: backgroundBudget },
    );
  })();

  barcodeEnrichBackground.set(params.cacheKey, task);
  task.finally(() => {
    barcodeEnrichBackground.delete(params.cacheKey);
  });
};

const buildBarcodeCacheKey = (barcode: string): string => {
  const normalized = normalizeBarcodeInput(barcode);
  return normalized ? normalized.code.padStart(14, "0") : barcode;
};

const enrichStreamBodySchema = z
  .object({
    barcode: z.string().min(1),
    deviceId: z.string().optional(),
  })
  .passthrough();

const analysisSectionBodySchema = z.object({
  identity: z.object({
    type: z.enum(["npn", "dsldLabelId", "webCanonicalId", "gtin14"]),
    value: z.string().min(1),
  }),
  section: z.enum(["ingredients_detail", "overview", "usage"]),
  locale: z.enum(["zh", "en"]),
  promptVersion: z.string().min(1),
  factsDigestHash: z.string().min(8),
  limit: z.number().int().min(1).max(ANALYSIS_DETAIL_LIMIT_MAX).optional().default(ANALYSIS_DETAIL_LIMIT_DEFAULT),
  cursor: z.number().int().min(0).optional().default(0),
});

const ensureOverviewBodySchema = z
  .object({
    barcode: z.string().optional().nullable(),
    brandName: z.string().optional().nullable(),
    productName: z.string().min(1),
    dosageText: z.string().optional().nullable(),
    userSupplementId: z.string().uuid().optional().nullable(),
    supplementId: z.string().uuid().optional().nullable(),
  })
  .passthrough();

const DEFAULT_BRAND_NAME = "Unknown brand";

const safeTrim = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const isNotFoundError = (error: { code?: string } | null | undefined) =>
  error?.code === "PGRST116";

const isUniqueViolation = (error: { code?: string } | null | undefined) =>
  error?.code === "23505";

const normalizeFingerprintComponent = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const buildSupplementFingerprint = (params: {
  brandName: string | null;
  productName: string | null;
  dosageText: string | null;
}): string | null => {
  const brandRaw = params.brandName ?? DEFAULT_BRAND_NAME;
  const productRaw = params.productName ?? "";
  const dosageRaw = params.dosageText ?? "";
  const brand = normalizeFingerprintComponent(brandRaw || DEFAULT_BRAND_NAME);
  const product = normalizeFingerprintComponent(productRaw);
  if (!product) return null;
  const dosage = normalizeFingerprintComponent(dosageRaw);
  const fingerprintInput = `${brand}|${product}|${dosage}`;
  return createHash("sha256").update(fingerprintInput).digest("hex");
};

const buildBarcodeCandidates = (barcodeRaw?: string | null): string[] => {
  if (!barcodeRaw) return [];
  const normalized = normalizeBarcodeInput(barcodeRaw);
  if (!normalized) return [];
  const candidates = new Set<string>();
  const addCandidate = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (!digits) return;
    if (digits.length >= 14) {
      candidates.add(digits.slice(-14));
      return;
    }
    if (digits.length >= 8) {
      candidates.add(digits.padStart(14, "0"));
    }
  };
  addCandidate(normalized.code);
  normalized.variants.forEach(addCandidate);
  return Array.from(candidates);
};

const resolveBrandId = async (brandName: string): Promise<string | null> => {
  const cleaned = safeTrim(brandName) ?? DEFAULT_BRAND_NAME;
  const { data: existing, error } = await supabase
    .from("brands")
    .select("id")
    .eq("name", cleaned)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    console.warn("[ensure-overview] Brand lookup failed", error.message);
    return null;
  }

  if (existing?.id) return existing.id;

  const { data: inserted, error: insertError } = await supabase
    .from("brands")
    .insert({ name: cleaned })
    .select("id")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: conflict } = await supabase
        .from("brands")
        .select("id")
        .eq("name", cleaned)
        .maybeSingle();
      return conflict?.id ?? null;
    }
    console.warn("[ensure-overview] Brand insert failed", insertError.message);
    return null;
  }

  return inserted?.id ?? null;
};

const resolveSupplementIdForOverview = async (params: {
  supplementId?: string | null;
  barcode?: string | null;
  brandName: string;
  productName: string;
  dosageText: string | null;
}): Promise<{ supplementId: string | null; fingerprint: string | null }> => {
  const barcodeCandidates = buildBarcodeCandidates(params.barcode);
  const fingerprint = buildSupplementFingerprint({
    brandName: params.brandName,
    productName: params.productName,
    dosageText: params.dosageText,
  });

  if (params.supplementId && barcodeCandidates.length === 0) {
    return {
      supplementId: params.supplementId,
      fingerprint,
    };
  }

  if (barcodeCandidates.length > 0) {
    const { data, error } = await supabase
      .from("supplements")
      .select("id, fingerprint")
      .in("barcode", barcodeCandidates)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[ensure-overview] Supplement barcode lookup failed", error.message);
    } else if (data?.[0]?.id) {
      const existing = data[0];
      if (fingerprint && !existing.fingerprint) {
        await supabase
          .from("supplements")
          .update({ fingerprint })
          .eq("id", existing.id);
      }
      return { supplementId: existing.id, fingerprint };
    }
  }

  if (fingerprint) {
    const { data, error } = await supabase
      .from("supplements")
      .select("id")
      .eq("fingerprint", fingerprint)
      .limit(1)
      .maybeSingle();

    if (error && !isNotFoundError(error)) {
      console.warn("[ensure-overview] Supplement fingerprint lookup failed", error.message);
    } else if (data?.id) {
      return { supplementId: data.id, fingerprint };
    }
  }

  const brandId = await resolveBrandId(params.brandName);
  if (!brandId) {
    return { supplementId: null, fingerprint };
  }

  const insertPayload = {
    brand_id: brandId,
    name: params.productName,
    barcode: barcodeCandidates[0] ?? null,
    fingerprint,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("supplements")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      if (barcodeCandidates.length > 0) {
        const { data: existing } = await supabase
          .from("supplements")
          .select("id")
          .in("barcode", barcodeCandidates)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (existing?.[0]?.id) {
          return { supplementId: existing[0].id, fingerprint };
        }
      }
      if (fingerprint) {
        const { data: existing } = await supabase
          .from("supplements")
          .select("id")
          .eq("fingerprint", fingerprint)
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          return { supplementId: existing.id, fingerprint };
        }
      }
    }
    console.warn("[ensure-overview] Supplement insert failed", insertError.message);
    return { supplementId: null, fingerprint };
  }

  return { supplementId: inserted?.id ?? null, fingerprint };
};

type EnsurePublicOverviewSource = "cache" | "deepseek" | "rule" | "none";

type EnsurePublicOverviewResult = {
  analysisReady: boolean;
  source: EnsurePublicOverviewSource;
  analysisData?: Partial<AiSupplementAnalysis> | null;
};

const inflightPublicOverviewByKey = new Map<string, Promise<EnsurePublicOverviewResult>>();
const ensureOverviewStartCountByKey = new Map<string, { count: number; windowStartedAt: number }>();
const ENSURE_OVERVIEW_START_WINDOW_MS = 10 * 60 * 1000;

const trackEnsureOverviewStart = (inflightKey: string): number => {
  const now = Date.now();
  const existing = ensureOverviewStartCountByKey.get(inflightKey);
  if (!existing || now - existing.windowStartedAt > ENSURE_OVERVIEW_START_WINDOW_MS) {
    ensureOverviewStartCountByKey.set(inflightKey, { count: 1, windowStartedAt: now });
    return 1;
  }
  const next = { ...existing, count: existing.count + 1 };
  ensureOverviewStartCountByKey.set(inflightKey, next);
  return next.count;
};

const MY_SUPP_OVERVIEW_V2_PROMPT_VERSION = "my_supp_overview_v2:v1";
const MY_SUPP_OVERVIEW_V2_GATE_SECTION = "my_supp_overview_v2_gate";
const MY_SUPP_OVERVIEW_V2_GATE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION = "product_overview_what_is_it:v2";

// Ensure-overview (Facts-first) budgets: facts must return fast even on cache miss.
const ENSURE_OVERVIEW_FACTS_BUDGET_MS = 1800;
const ENSURE_OVERVIEW_SNAPSHOT_READ_MS = 600;
const ENSURE_OVERVIEW_MAP_READ_MS = 600;
const STACK_OVERLAP_MAX_SUPPLEMENTS_PER_REQUEST = 30;
const STACK_OVERLAP_ACTIVES_PER_SUPPLEMENT = 6;
const STACK_OVERLAP_MAX_ITEMS = 5;
const STACK_OVERLAP_SNAPSHOT_TIMEOUT_MS = 650;
const STACK_OVERLAP_SNAPSHOT_CONCURRENCY = 5;

type EnsureOverviewFactsStatus = "full" | "partial" | "none";
type EnsureOverviewAiStatus = "ready" | "pending" | "blocked" | "none";

const computeFactsStatus = (facts: MySupplementFactsV1 | null): EnsureOverviewFactsStatus => {
  if (!facts) return "none";

  const hasActiveDose =
    (facts.actives ?? []).some((active) => {
      const amountText = typeof active?.amountText === "string" ? active.amountText.trim() : "";
      if (amountText) return true;
      if (active?.amount != null && typeof active?.unit === "string" && active.unit.trim()) return true;
      return false;
    });
  const hasDirections = typeof facts.directions?.rawText === "string" && facts.directions.rawText.trim().length > 0;
  const hasOverlayIngredients = Array.isArray(facts.overlay?.ingredients) && facts.overlay.ingredients.length > 0;
  const hasOverlaySuggestedUse =
    typeof facts.overlay?.suggestedUse === "string" && facts.overlay.suggestedUse.trim().length > 0;
  return hasActiveDose || hasDirections || hasOverlayIngredients || hasOverlaySuggestedUse ? "full" : "partial";
};

const extractFactsDigestHashFromAnalysisData = (
  analysisData: unknown,
): string | null => {
  if (!analysisData || typeof analysisData !== "object") return null;
  const root = analysisData as any;
  const rootHash =
    typeof root?.mySupplementOverviewV2?.meta?.factsDigestHash === "string"
      ? root.mySupplementOverviewV2.meta.factsDigestHash
      : null;
  if (rootHash) return rootHash;
  const nestedHash =
    typeof root?.analysis?.mySupplementOverviewV2?.meta?.factsDigestHash === "string"
      ? root.analysis.mySupplementOverviewV2.meta.factsDigestHash
      : null;
  return nestedHash ?? null;
};

const findMatchingPublicAnalysis = async (params: {
  supplementId: string;
  factsDigestHash: string;
}): Promise<Partial<AiSupplementAnalysis> | null> => {
  const { data, error } = await supabase
    .from("ai_analyses")
    .select("analysis_data, created_at")
    .eq("supplement_id", params.supplementId)
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.warn("[ensure-overview] ai_analyses lookup failed", error.message);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const analysisData = (row as any)?.analysis_data ?? null;
    const hash = extractFactsDigestHashFromAnalysisData(analysisData);
    if (hash && hash === params.factsDigestHash) {
      return analysisData as Partial<AiSupplementAnalysis>;
    }
  }
  return null;
};

const persistPublicAnalysis = async (params: {
  supplementId: string;
  analysisData: Partial<AiSupplementAnalysis>;
}): Promise<boolean> => {
  const updatePayload = { analysis_data: params.analysisData };

  const { data: updatedRows, error: updateError } = await supabase
    .from("ai_analyses")
    .update(updatePayload)
    .eq("supplement_id", params.supplementId)
    .is("user_id", null)
    .select("id")
    .limit(1);

  if (updateError) {
    console.warn("[ensure-overview] ai_analyses update failed", updateError.message);
    return false;
  }

  if (Array.isArray(updatedRows) && updatedRows.length > 0) {
    return true;
  }

  const { error: insertError } = await supabase.from("ai_analyses").insert({
    supplement_id: params.supplementId,
    user_id: null,
    analysis_data: params.analysisData,
  });

  if (!insertError) return true;

  if (isUniqueViolation(insertError)) {
    const { data: retriedRows, error: retryUpdateError } = await supabase
      .from("ai_analyses")
      .update(updatePayload)
      .eq("supplement_id", params.supplementId)
      .is("user_id", null)
      .select("id")
      .limit(1);

    if (retryUpdateError) {
      console.warn("[ensure-overview] ai_analyses retry update failed", retryUpdateError.message);
      return false;
    }

    return Array.isArray(retriedRows) && retriedRows.length > 0;
  }

  console.warn("[ensure-overview] ai_analyses insert failed", insertError.message);
  return false;
};

const computeRetryAfterSeconds = (expiresAt: string | null | undefined): number => {
  if (!expiresAt) return 0;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return 0;
  const leftMs = ms - Date.now();
  if (leftMs <= 0) return 0;
  return Math.ceil(leftMs / 1000);
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) break;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
};

const parseUserSupplementNotes = (rawNotes: string | null): Record<string, unknown> | null => {
  if (!rawNotes) return null;
  try {
    const parsed = JSON.parse(rawNotes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

type StackOverlapUserSupplementRow = {
  id: string;
  supplement_id: string | null;
  notes: string | null;
  supplements:
    | {
      id?: string | null;
      name?: string | null;
      barcode?: string | null;
    }
    | Array<{
      id?: string | null;
      name?: string | null;
      barcode?: string | null;
    }>
    | null;
};

type RemoteStackOverlapInputsResult = {
  processedInputs: StackOverlapSupplementInput[];
  processedSupplements: number;
  skippedSupplements: number;
  truncated: boolean;
  status: "ok" | "partial";
};

const fetchRemoteStackOverlapInputs = async (
  userId: string,
): Promise<RemoteStackOverlapInputsResult | null> => {
  const { data, error } = await supabase
    .from("user_supplements")
    .select("id, supplement_id, notes, supplements ( id, name, barcode )")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false })
    .limit(STACK_OVERLAP_MAX_SUPPLEMENTS_PER_REQUEST + 1);

  if (error) {
    console.warn("[stack-overlap] user_supplements query failed", error.message);
    return null;
  }

  const rows = (Array.isArray(data) ? data : []) as StackOverlapUserSupplementRow[];
  const truncated = rows.length > STACK_OVERLAP_MAX_SUPPLEMENTS_PER_REQUEST;
  const selectedRows = rows.slice(0, STACK_OVERLAP_MAX_SUPPLEMENTS_PER_REQUEST);
  let skippedSupplements = Math.max(0, rows.length - selectedRows.length);

  type CandidateResult =
    | { type: "processed"; value: StackOverlapSupplementInput }
    | { type: "skipped" };

  const candidates = await mapWithConcurrency(
    selectedRows,
    STACK_OVERLAP_SNAPSHOT_CONCURRENCY,
    async (row): Promise<CandidateResult> => {
      const linkedSupplement = Array.isArray(row.supplements)
        ? row.supplements[0] ?? null
        : row.supplements ?? null;
      const notes = parseUserSupplementNotes(row.notes ?? null);

      const supplementIdRaw =
        row.supplement_id ??
        (typeof linkedSupplement?.id === "string" ? linkedSupplement.id : null) ??
        row.id;
      const supplementId = safeTrim(supplementIdRaw);
      if (!supplementId) return { type: "skipped" };

      const notesProductName =
        notes && typeof notes.productName === "string" ? safeTrim(notes.productName) : null;
      const productName =
        safeTrim(linkedSupplement?.name ?? null) ??
        notesProductName ??
        "Unknown supplement";

      const barcode = safeTrim(linkedSupplement?.barcode ?? null);
      if (!barcode) return { type: "skipped" };

      const normalized = normalizeBarcodeInput(barcode);
      if (!normalized) return { type: "skipped" };

      const cacheKey = buildBarcodeCacheKey(normalized.code);
      const cached = await getSnapshotCache(
        { key: cacheKey, source: "barcode" },
        { timeoutMs: STACK_OVERLAP_SNAPSHOT_TIMEOUT_MS },
      ).catch(() => null);
      const snapshot = cached?.snapshot ?? null;
      if (!snapshot) return { type: "skipped" };

      const ingredientRows = (snapshot.label.actives ?? [])
        .map((active) => {
          const name = safeTrim(active.name);
          if (!name) return null;
          return {
            name,
            amount: active.amountUnknown ? null : active.amount ?? null,
            unit: active.amountUnitNormalized ?? active.amountUnit ?? active.amountUnitRaw ?? null,
            amountText:
              !active.amountUnknown && active.amount != null && (active.amountUnitNormalized ?? active.amountUnit ?? active.amountUnitRaw)
                ? `${active.amount} ${active.amountUnitNormalized ?? active.amountUnit ?? active.amountUnitRaw}`.trim()
                : null,
            chemicalForm: active.form ?? null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .slice(0, 24);
      if (ingredientRows.length === 0) return { type: "skipped" };

      const safetyBundle = buildSnapshotSafetyDigestBundle({
        snapshot,
        supplementId,
        barcodeGtin14: normalized.code.padStart(14, "0"),
        brandName: snapshot.product.brand ?? "",
        productName,
      });
      const usableIngredientRows = ingredientRows.filter((row) => row.amount != null && Boolean(row.unit));
      const dailyDoseContext = deriveDailyDoseBasis({
        labelDirectionsRawText: safetyBundle.labelDirectionsRawText,
        hasUsableActiveDose: usableIngredientRows.length > 0,
        sourceContext: "snapshot_only",
      });

      return {
        type: "processed",
        value: {
          supplementId,
          productName,
          ingredientNames: ingredientRows.map((row) => row.name),
          ingredientRows: usableIngredientRows,
          dailyMultiplier: dailyDoseContext.dailyMultiplier,
          dailyDoseBasis: dailyDoseContext.dailyDoseBasis,
          dailyDoseBasisReason: dailyDoseContext.dailyDoseBasisReason,
        },
      };
    },
  );

  const processedInputs = candidates
    .filter((candidate): candidate is { type: "processed"; value: StackOverlapSupplementInput } => candidate.type === "processed")
    .map((candidate) => candidate.value);
  skippedSupplements += candidates.length - processedInputs.length;

  return {
    processedInputs,
    processedSupplements: processedInputs.length,
    skippedSupplements,
    truncated,
    status: truncated || skippedSupplements > 0 ? "partial" : "ok",
  };
};

const buildDecisionSupportCurrentStackInput = (params: {
  digest: FactsDigest;
  barcodeGtin14: string;
}): StackOverlapSupplementInput | null => {
  const ingredientRows = (Array.isArray(params.digest.actives) ? params.digest.actives : [])
    .map((active) => {
      const name = safeTrim(active?.name ?? null);
      if (!name) return null;
      return {
        name,
        amount: typeof active?.amount === "number" && Number.isFinite(active.amount) ? active.amount : null,
        unit: safeTrim(active?.unit ?? null),
        amountText: safeTrim(active?.amountText ?? null),
        chemicalForm: safeTrim(active?.chemicalForm ?? null),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (ingredientRows.length === 0) return null;

  return {
    supplementId: params.barcodeGtin14,
    productName: safeTrim(params.digest.product.name ?? null) ?? "Current product",
    ingredientNames: ingredientRows.map((row) => row.name),
    ingredientRows: ingredientRows.filter((row) => row.amount != null && Boolean(row.unit)),
  };
};

const buildDecisionSupportPersonalizationContext = (params: {
  userProfile: UserDecisionSupportProfileRow | null;
  allergyContext: DecisionSupportAttachedAllergyContext | null;
  remoteStackInputs: RemoteStackOverlapInputsResult | null;
  currentProductInput: StackOverlapSupplementInput | null;
  fallbackSavedStackCount?: number;
}): DecisionSupportAttachedPersonalizationContext | null => {
  const hasProfile = Boolean(params.userProfile);
  const hasRemoteStack = Boolean(params.remoteStackInputs);
  const hasAllergy = Boolean(params.allergyContext);
  const fallbackSavedStackCount = Math.max(0, params.fallbackSavedStackCount ?? 0);
  if (!hasProfile && !hasRemoteStack && !hasAllergy && fallbackSavedStackCount === 0) return null;

  const declaredDiets = params.userProfile?.dietary_preferences?.length
    ? params.userProfile.dietary_preferences
    : params.userProfile?.dietary_preference
      ? [params.userProfile.dietary_preference]
      : [];

  const profile = params.userProfile
    ? resolvePersonalizationProfileCompat({
      draft: {
        ageRange: params.userProfile.age_range ?? undefined,
        sex: params.userProfile.sex ?? params.userProfile.gender ?? undefined,
        supplementExperience: params.userProfile.supplement_experience ?? undefined,
        diets: declaredDiets,
        activity: params.userProfile.activity_level ?? undefined,
        preferredTypes: params.userProfile.preferred_types ?? undefined,
        adherenceBlocker: params.userProfile.adherence_blocker ?? undefined,
        location: {
          country: params.userProfile.location_country ?? undefined,
          city: params.userProfile.location_city ?? undefined,
        },
        goals: params.userProfile.health_goals ?? undefined,
      },
      observed: {
        savedStackCount: params.remoteStackInputs?.processedSupplements ?? fallbackSavedStackCount,
        duplicateRiskLevel:
          (params.remoteStackInputs?.processedSupplements ?? fallbackSavedStackCount) >= 8
            ? "high"
            : (params.remoteStackInputs?.processedSupplements ?? fallbackSavedStackCount) >= 4
              ? "medium"
              : "none",
      },
    })
    : null;

  const currentProductOverlap = params.currentProductInput && params.remoteStackInputs
    ? (() => {
      const overlap = buildStackOverlapResult(
        [params.currentProductInput, ...params.remoteStackInputs.processedInputs],
        {
          maxPerSupplement: STACK_OVERLAP_ACTIVES_PER_SUPPLEMENT,
          maxOverlaps: STACK_OVERLAP_MAX_ITEMS,
          skippedSupplements: params.remoteStackInputs.skippedSupplements,
        },
      );

      return overlap.overlaps.filter((item) =>
        item.supplements.some((supplement) => supplement.supplementId === params.currentProductInput?.supplementId),
      );
    })()
    : [];

  return {
    profile,
    prioritizedGoals: profile?.declared.goals.map((goal) => goal.key) ?? [],
    selectedGoalKey: profile?.declared.goals[0]?.key ?? null,
    preferredTypes: profile?.declared.preferredTypes ?? [],
    supplementExperience: profile?.declared.supplementExperience ?? null,
    ageRange: profile?.declared.ageRange ?? null,
    adherenceBlocker: profile?.declared.adherenceBlocker ?? null,
    stackOverlap: params.remoteStackInputs
      ? {
        status: params.remoteStackInputs.status,
        savedStackCount: params.remoteStackInputs.processedSupplements,
        overlapCount: currentProductOverlap.length,
        overlaps: currentProductOverlap,
      }
      : null,
    allergyContext: params.allergyContext,
  };
};

const inflightSnapshotPopulateByBarcode = new Map<string, Promise<void>>();

const populateBarcodeSnapshotCache = async (barcodeDigits: string): Promise<void> => {
  const normalized = normalizeBarcodeInput(barcodeDigits);
  if (!normalized) return;

  const barcode = normalized.code;
  const barcodeGtin14 = barcode.padStart(14, "0");
  const cacheKey = buildBarcodeCacheKey(barcode);
  const overlayClaims = await fetchIherbOverlayClaimsByBarcode(barcodeGtin14);

  const existing = await getSnapshotCache(
    { key: cacheKey, source: "barcode" },
    { timeoutMs: 900 },
  ).catch(() => null);
  if (existing?.snapshot) return;
  if (!LNHPD_RUNTIME_ENABLED) return;

  const map = await getBarcodeRegulatoryMap(barcodeGtin14, barcode, {
    timeoutMs: 1200,
    includeExpired: true,
  }).catch(() => null);

  const npn = map?.npn ?? null;
  if (!npn) return;

  const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
  const { signal: lnhpdSignal, cleanup } = combineSignals([lnhpdTimeoutSignal]);
  try {
    const facts = await fetchLnhpdFactsByNpn(npn, lnhpdSignal);
    if (!facts) return;

    const lnhpdLabelFacts = toLabelFactsFromLnhpd(facts);
    const labelExtraction: LabelExtractionMeta = {
      source: "lnhpd",
      fetchedAt: facts.extractedAt ?? nowIso(),
      datasetVersion: facts.datasetVersion ?? null,
    };
    const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);

    const lnhpdProductInfo = {
      brand: facts.brandName ?? null,
      name: facts.productName ?? null,
      category: null,
      image: null,
    };

    const analysisPayload: SnapshotAnalysisPayload = {
      ...labelAnalysis,
      brandExtraction: {
        brand: lnhpdProductInfo.brand,
        product: lnhpdProductInfo.name,
        category: null,
        confidence: "high",
        source: "rule",
      },
      productInfo: lnhpdProductInfo,
      sources: [],
    };

    let snapshot = buildBarcodeSnapshot({
      barcode,
      productInfo: lnhpdProductInfo,
      sources: [],
      efficacy: (analysisPayload as any).efficacy ?? null,
      safety: (analysisPayload as any).safety ?? null,
      usagePayload: (analysisPayload as any).usagePayload ?? null,
    });
    snapshot = applyLnhpdFactsToSnapshot(snapshot, facts);

    const analysisStatus = buildAnalysisStatus({
      hasLabelFacts: hasLabelFacts(snapshot),
      hasAi: hasAiPayload(analysisPayload),
      dsldLabelId: null,
    });
    const analysisMeta = buildAnalysisMeta({
      status: analysisStatus,
      labelExtraction,
      overlayClaims,
    });
    analysisPayload.analysis = analysisMeta;
    snapshot.status = "resolved";
    snapshot.analysis = analysisMeta;
    snapshot.updatedAt = nowIso();

    const expiresAt = computeExpiresAt(analysisStatus);
    await storeSnapshotCache(
      {
        key: cacheKey,
        source: "barcode",
        snapshot,
        analysisPayload,
        expiresAt,
      },
      { timeoutMs: 1500 },
    ).catch(() => null);
  } finally {
    cleanup();
  }
};

const populateBarcodeSnapshotCacheDeduped = (barcodeDigits: string): Promise<void> => {
  const existing = inflightSnapshotPopulateByBarcode.get(barcodeDigits);
  if (existing) return existing;
  const promise = populateBarcodeSnapshotCache(barcodeDigits).finally(() => {
    inflightSnapshotPopulateByBarcode.delete(barcodeDigits);
  });
  inflightSnapshotPopulateByBarcode.set(barcodeDigits, promise);
  return promise;
};

const buildMySupplementDigestQuick = async (params: {
  supplementId: string;
  barcode: string | null;
  brandName: string;
  productName: string;
  budgetMs: number;
}): Promise<{
  digest: FactsDigest;
  factsSourceVersion: string;
  factsDigestHash: string;
  labelDirectionsRawText: string | null;
  snapshotHit: boolean;
  barcodeGtin14: string | null;
}> => {
  const startedAt = Date.now();
  const msLeft = () => Math.max(0, params.budgetMs - (Date.now() - startedAt));

  const normalizedBarcode = params.barcode ? normalizeBarcodeInput(params.barcode) : null;
  const barcodeDigits = normalizedBarcode?.code ?? null;
  const barcodeGtin14 = barcodeDigits ? barcodeDigits.padStart(14, "0") : null;
  const seededDsldLabelId =
    barcodeGtin14 && STAGE0_DSLD_BARCODE_FALLBACK_ENABLED
      ? resolvePreferredStage0DsldLabelId(barcodeGtin14)
      : null;
  let prioritizedDsldLabelIdMemo: number | null | undefined;
  const resolvePrioritizedDsldLabelId = async (): Promise<number | null> => {
    if (prioritizedDsldLabelIdMemo !== undefined) return prioritizedDsldLabelIdMemo;
    if (!STAGE0_DSLD_BARCODE_FALLBACK_ENABLED) {
      prioritizedDsldLabelIdMemo = null;
      return prioritizedDsldLabelIdMemo;
    }
    if (Number.isFinite(Number(seededDsldLabelId)) && Number(seededDsldLabelId) > 0) {
      prioritizedDsldLabelIdMemo = Number(seededDsldLabelId);
      return prioritizedDsldLabelIdMemo;
    }
    if (!barcodeGtin14 || msLeft() <= 0) {
      prioritizedDsldLabelIdMemo = null;
      return prioritizedDsldLabelIdMemo;
    }
    const canonicalTimeoutSignal = createTimeoutSignal(Math.max(250, Math.min(550, msLeft())));
    const { signal: canonicalSignal, cleanup } = combineSignals([canonicalTimeoutSignal]);
    try {
      const canonicalDsldLabelId = await fetchCanonicalDsldLabelIdByBarcode(barcodeGtin14, canonicalSignal);
      prioritizedDsldLabelIdMemo =
        Number.isFinite(Number(canonicalDsldLabelId)) && Number(canonicalDsldLabelId) > 0
          ? Number(canonicalDsldLabelId)
          : null;
      return prioritizedDsldLabelIdMemo;
    } finally {
      cleanup();
    }
  };
  const cacheKey = barcodeDigits ? buildBarcodeCacheKey(barcodeDigits) : null;

  const snapshot = cacheKey && msLeft() > 0
    ? (await getSnapshotCache(
      { key: cacheKey, source: "barcode" },
      { timeoutMs: Math.min(ENSURE_OVERVIEW_SNAPSHOT_READ_MS, msLeft()) },
    ).catch(() => null))?.snapshot ?? null
    : null;

  if (snapshot) {
    const source = normalizeLabelExtractionSource(snapshot.analysis?.labelExtraction?.source ?? null);
    if (source === "dsld") {
      const prioritizedDsldLabelIdFromCanonical = await resolvePrioritizedDsldLabelId();
      if (prioritizedDsldLabelIdFromCanonical && msLeft() > 0) {
        const canonicalDigest = await tryBuildCanonicalDsldDigest({
          dsldLabelId: prioritizedDsldLabelIdFromCanonical,
          timeoutMs: Math.min(RESILIENCE_LNHPD_TIMEOUT_MS, msLeft()),
          snapshot,
          barcodeRaw: barcodeDigits,
          identityValueFallback: snapshot.regulatory.dsldLabelId ?? (barcodeGtin14 ?? params.supplementId),
        });
        if (canonicalDigest) {
          return {
            ...canonicalDigest,
            snapshotHit: false,
            barcodeGtin14,
          };
        }
      }

      const fallbackFacts = buildDsldFactsInputFromSnapshot(snapshot);
      const factsSourceVersion = `dsld:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "unknown"}`;
      const digest = buildFactsDigestFromDsld({
        facts: fallbackFacts,
        snapshot,
        identityValue: snapshot.regulatory.dsldLabelId ?? (barcodeGtin14 ?? params.supplementId),
        regionTags: snapshot.regulatory.regionTags,
      });
      const factsDigestHash = computeFactsDigestHash(digest);
      const labelDirectionsRawText = buildLabelDosingText(digest);
      return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText, snapshotHit: true, barcodeGtin14 };
    }

    const snapshotNpn = LNHPD_RUNTIME_ENABLED
      ? normalizeNpnValue(snapshot.regulatory.npn ?? null)
      : null;
    if (snapshotNpn) {
      const fallbackFacts = buildLnhpdFactsInputFromSnapshot(snapshot);
      const factsSourceVersion = `lnhpd:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "unknown"}`;
      const digest = buildFactsDigestFromLnhpd({
        facts: fallbackFacts,
        snapshot,
        identityValue: snapshotNpn,
        regionTags: snapshot.regulatory.regionTags,
      });
      const factsDigestHash = computeFactsDigestHash(digest);
      const labelDirectionsRawText = buildLabelDosingText(digest);
      return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText, snapshotHit: true, barcodeGtin14 };
    }

    const prioritizedDsldLabelIdFromCanonical = await resolvePrioritizedDsldLabelId();
    if (prioritizedDsldLabelIdFromCanonical && msLeft() > 0) {
      const canonicalDigest = await tryBuildCanonicalDsldDigest({
        dsldLabelId: prioritizedDsldLabelIdFromCanonical,
        timeoutMs: Math.min(RESILIENCE_LNHPD_TIMEOUT_MS, msLeft()),
        barcodeRaw: barcodeDigits,
      });
      if (canonicalDigest) {
        return {
          ...canonicalDigest,
          snapshotHit: false,
          barcodeGtin14,
        };
      }
    }

    const factsSourceVersion = `web:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "snapshot"}`;
    const digest = buildFactsDigestFromWeb({
      facts: {
        barcode: barcodeGtin14 ?? "",
        canonical: {
          name: snapshot.product.name ?? params.productName,
          brand: snapshot.product.brand ?? params.brandName,
          url: null,
          domain: null,
        },
        identifiers: { npn: null },
        textFacts: {
          ingredientsText: null,
          directionsText: null,
          warningsText: null,
          servingSizeText: snapshot.label.servingSize ?? null,
        },
        coverageScore: 0,
        missingFields: [
          "textFacts.ingredientsText",
          "textFacts.directionsText",
          "textFacts.warningsText",
        ],
      },
      snapshot,
      identityType: "webCanonicalId",
      identityValue: barcodeGtin14 ?? params.supplementId,
      regionTags: snapshot.regulatory.regionTags,
    });
    const factsDigestHash = computeFactsDigestHash(digest);
    const labelDirectionsRawText = buildLabelDosingText(digest);
    return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText, snapshotHit: true, barcodeGtin14 };
  }

  const prioritizedDsldLabelId = await resolvePrioritizedDsldLabelId();

  if (prioritizedDsldLabelId && msLeft() > 0) {
    const canonicalDigest = await tryBuildCanonicalDsldDigest({
      dsldLabelId: prioritizedDsldLabelId,
      timeoutMs: Math.min(RESILIENCE_LNHPD_TIMEOUT_MS, msLeft()),
      barcodeRaw: barcodeDigits,
    });
    if (canonicalDigest) {
      return {
        ...canonicalDigest,
        snapshotHit: false,
        barcodeGtin14,
      };
    }
  }

  const map = barcodeGtin14 && msLeft() > 0
    ? await getBarcodeRegulatoryMap(barcodeGtin14, barcodeDigits ?? "", {
      timeoutMs: Math.min(ENSURE_OVERVIEW_MAP_READ_MS, msLeft()),
      includeExpired: true,
    }).catch(() => null)
    : null;
  const npn = LNHPD_RUNTIME_ENABLED ? map?.npn ?? null : null;

  const identityType: FactsIdentityType = npn ? "npn" : "webCanonicalId";
  const identityValue = npn ?? barcodeGtin14 ?? params.supplementId;

  const factsSourceVersion = npn
    ? "lnhpd:map_only"
    : barcodeGtin14
      ? "snapshot:miss"
      : "manual:missing_barcode";

  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: barcodeGtin14 ?? "",
      canonical: {
        name: params.productName,
        brand: params.brandName,
        url: null,
        domain: null,
      },
      identifiers: { npn: npn ?? null },
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
    snapshot: undefined,
    identityType,
    identityValue,
    regionTags: [],
  });

  const factsDigestHash = computeFactsDigestHash(digest);
  const labelDirectionsRawText = buildLabelDosingText(digest);
  return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText, snapshotHit: false, barcodeGtin14 };
};

const buildMySupplementDigestForEnsureOverview = async (params: {
  supplementId: string;
  barcode: string | null;
  brandName: string;
  productName: string;
}): Promise<{
  digest: FactsDigest;
  factsSourceVersion: string;
  factsDigestHash: string;
  labelDirectionsRawText: string | null;
}> => {
  const normalizedBarcode = params.barcode ? normalizeBarcodeInput(params.barcode) : null;
  const barcodeDigits = normalizedBarcode?.code ?? null;
  const barcodeGtin14 = barcodeDigits ? barcodeDigits.padStart(14, "0") : null;
  const seededDsldLabelId =
    barcodeGtin14 && STAGE0_DSLD_BARCODE_FALLBACK_ENABLED
      ? resolvePreferredStage0DsldLabelId(barcodeGtin14)
      : null;
  let prioritizedDsldLabelIdMemo: number | null | undefined;
  const resolvePrioritizedDsldLabelId = async (): Promise<number | null> => {
    if (prioritizedDsldLabelIdMemo !== undefined) return prioritizedDsldLabelIdMemo;
    if (!STAGE0_DSLD_BARCODE_FALLBACK_ENABLED) {
      prioritizedDsldLabelIdMemo = null;
      return prioritizedDsldLabelIdMemo;
    }
    if (Number.isFinite(Number(seededDsldLabelId)) && Number(seededDsldLabelId) > 0) {
      prioritizedDsldLabelIdMemo = Number(seededDsldLabelId);
      return prioritizedDsldLabelIdMemo;
    }
    if (!barcodeGtin14) {
      prioritizedDsldLabelIdMemo = null;
      return prioritizedDsldLabelIdMemo;
    }
    const canonicalTimeoutSignal = createTimeoutSignal(550);
    const { signal: canonicalSignal, cleanup } = combineSignals([canonicalTimeoutSignal]);
    try {
      const canonicalDsldLabelId = await fetchCanonicalDsldLabelIdByBarcode(barcodeGtin14, canonicalSignal);
      prioritizedDsldLabelIdMemo =
        Number.isFinite(Number(canonicalDsldLabelId)) && Number(canonicalDsldLabelId) > 0
          ? Number(canonicalDsldLabelId)
          : null;
      return prioritizedDsldLabelIdMemo;
    } finally {
      cleanup();
    }
  };
  const cacheKey = barcodeDigits ? buildBarcodeCacheKey(barcodeDigits) : null;

  const snapshot = cacheKey
    ? (await getSnapshotCache({ key: cacheKey, source: "barcode" }, { timeoutMs: 1200 }).catch(() => null))?.snapshot ??
    null
    : null;

  const npnFromSnapshot = snapshot?.regulatory?.npn ?? null;
  const map = barcodeGtin14
    ? await getBarcodeRegulatoryMap(barcodeGtin14, barcodeDigits ?? "", {
      timeoutMs: 1200,
      includeExpired: true,
    }).catch(() => null)
    : null;
  const npn = LNHPD_RUNTIME_ENABLED ? (npnFromSnapshot ?? map?.npn ?? null) : null;

  if (npn) {
    const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
    const { signal: lnhpdSignal, cleanup } = combineSignals([lnhpdTimeoutSignal]);
    try {
      const facts = await fetchLnhpdFactsByNpn(npn, lnhpdSignal);
      if (facts) {
        const factsSourceVersion = `lnhpd:${facts.datasetVersion ?? facts.extractedAt ?? "unknown"}`;
        const digest = buildFactsDigestFromLnhpd({
          facts,
          snapshot: snapshot ?? undefined,
          identityValue: npn,
          regionTags: snapshot?.regulatory?.regionTags ?? ["CA"],
        });
        const factsDigestHash = computeFactsDigestHash(digest);
        const labelDirectionsRawText = buildLabelDosingText(digest);

        // Best-effort: persist deterministic ingredient rows for future stack-safety modules.
        const labelFacts = toLabelFactsFromLnhpd(facts);
        void upsertProductIngredientsFromLabelFacts({
          source: "lnhpd",
          sourceId: npn,
          canonicalSourceId: npn,
          labelFacts,
          basis: "label_serving",
          parseConfidence: 0.9,
        }).catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[my-supp-facts] Failed to persist product ingredients from LNHPD", message);
        });

        return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
      }
    } finally {
      cleanup();
    }
  }

  const prioritizedDsldLabelId = await resolvePrioritizedDsldLabelId();
  const dsldLabelId = prioritizedDsldLabelId ?? snapshot?.regulatory?.dsldLabelId ?? null;
  if (dsldLabelId) {
    const canonicalDigest = await tryBuildCanonicalDsldDigest({
      dsldLabelId,
      timeoutMs: RESILIENCE_LNHPD_TIMEOUT_MS,
      snapshot,
      barcodeRaw: barcodeDigits,
      identityValueFallback: String(snapshot?.regulatory?.dsldLabelId ?? barcodeGtin14 ?? params.supplementId),
    });
    if (canonicalDigest) {
      return canonicalDigest;
    }
  }

  // Snapshot fallback (no LNHPD/DSLD facts found). Prefer DSLD snapshot shape when possible.
  if (snapshot) {
    const source = normalizeLabelExtractionSource(snapshot.analysis?.labelExtraction?.source ?? null);
    if (source === "dsld") {
      const fallbackFacts = buildDsldFactsInputFromSnapshot(snapshot);
      const factsSourceVersion = `dsld:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "unknown"}`;
      const digest = buildFactsDigestFromDsld({
        facts: fallbackFacts,
        snapshot,
        identityValue: snapshot.regulatory.dsldLabelId ?? (barcodeGtin14 ?? params.supplementId),
        regionTags: snapshot.regulatory.regionTags,
      });
      const factsDigestHash = computeFactsDigestHash(digest);
      const labelDirectionsRawText = buildLabelDosingText(digest);
      return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
    }

    const snapshotNpn = normalizeNpnValue(snapshot.regulatory.npn ?? null);
    if (snapshotNpn) {
      const fallbackFacts = buildLnhpdFactsInputFromSnapshot(snapshot);
      const factsSourceVersion = `lnhpd:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "unknown"}`;
      const digest = buildFactsDigestFromLnhpd({
        facts: fallbackFacts,
        snapshot,
        identityValue: snapshotNpn,
        regionTags: snapshot.regulatory.regionTags,
      });
      const factsDigestHash = computeFactsDigestHash(digest);
      const labelDirectionsRawText = buildLabelDosingText(digest);
      return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
    }

    const factsSourceVersion = `web:${snapshot.analysis?.labelExtraction?.datasetVersion ?? snapshot.analysis?.labelExtraction?.fetchedAt ?? "snapshot"}`;
    const digest = buildFactsDigestFromWeb({
      facts: {
        barcode: barcodeGtin14 ?? "",
        canonical: {
          name: snapshot.product.name ?? params.productName,
          brand: snapshot.product.brand ?? params.brandName,
          url: null,
          domain: null,
        },
        identifiers: { npn: null },
        textFacts: {
          ingredientsText: null,
          directionsText: null,
          warningsText: null,
          servingSizeText: snapshot.label.servingSize ?? null,
        },
        coverageScore: 0,
        missingFields: [
          "textFacts.ingredientsText",
          "textFacts.directionsText",
          "textFacts.warningsText",
        ],
      },
      snapshot,
      identityType: "webCanonicalId",
      identityValue: barcodeGtin14 ?? params.supplementId,
      regionTags: snapshot.regulatory.regionTags,
    });
    const factsDigestHash = computeFactsDigestHash(digest);
    const labelDirectionsRawText = buildLabelDosingText(digest);
    return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
  }

  // Minimal deterministic fallback: "web" digest with no extracted facts yet.
  const identityType: FactsIdentityType = "webCanonicalId";
  const identityValue = barcodeGtin14 ?? params.supplementId;
  const factsSourceVersion = barcodeGtin14 ? "snapshot:miss" : "manual:missing_barcode";
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: barcodeGtin14 ?? "",
      canonical: {
        name: params.productName,
        brand: params.brandName,
        url: null,
        domain: null,
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
    snapshot: undefined,
    identityType,
    identityValue,
    regionTags: [],
  });
  const factsDigestHash = computeFactsDigestHash(digest);
  const labelDirectionsRawText = buildLabelDosingText(digest);
  return { digest, factsSourceVersion, factsDigestHash, labelDirectionsRawText };
};

const ensurePublicOverview = async (params: {
  supplementId: string;
  productName: string;
  dosageText: string | null;
  brandName?: string | null;
  barcode?: string | null;
  digest: FactsDigest;
  factsSourceVersion: string;
  factsDigestHash: string;
  labelDirectionsRawText: string | null;
}): Promise<EnsurePublicOverviewResult> => {
  const inflightKey = buildEnsureOverviewInflightKey(params.supplementId, params.factsDigestHash);
  const inflight = inflightPublicOverviewByKey.get(inflightKey);
  if (inflight) {
    console.info("[ensure-overview-start]", {
      supplementId: params.supplementId,
      factsDigestHash: params.factsDigestHash,
      inflightKey,
      started: false,
      reason: "inflight_reused",
    });
    return inflight;
  }

  const startCountInWindow = trackEnsureOverviewStart(inflightKey);
  console.info("[ensure-overview-start]", {
    supplementId: params.supplementId,
    factsDigestHash: params.factsDigestHash,
    inflightKey,
    started: true,
    startCountInWindow,
    windowMs: ENSURE_OVERVIEW_START_WINDOW_MS,
  });
  if (startCountInWindow > 1) {
    console.warn("[ensure-overview-start] duplicate background start detected", {
      supplementId: params.supplementId,
      factsDigestHash: params.factsDigestHash,
      inflightKey,
      startCountInWindow,
    });
  }

  const promise = (async (): Promise<EnsurePublicOverviewResult> => {
    const cached = await findMatchingPublicAnalysis({
      supplementId: params.supplementId,
      factsDigestHash: params.factsDigestHash,
    });
    if (cached) return { analysisReady: true, source: "cache", analysisData: cached };

    const digest = params.digest;
    const labelDirectionsRawText = safeTrim(params.labelDirectionsRawText) ?? null;

    const ruleOverview = buildRuleBasedOverview({
      productName: params.productName,
      dosageText: params.dosageText,
    });

    const normalizeTwoSentenceSummary = (value: string, fallback: string): string => {
      const pick = safeTrim(value) ?? safeTrim(fallback) ?? "";
      if (!pick) {
        return "This supplement is designed to support a common wellness goal. Follow the product label for dosing.";
      }

      const parts = pick
        .split(/(?<=[.!?])\s+/)
        .map((p) => p.trim())
        .filter(Boolean);

      if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
      const only = parts[0] ?? pick;
      const first = /[.!?]$/.test(only) ? only : `${only}.`;
      return `${first} Follow the product label for dosing.`;
    };

    const buildDefaultCoreBenefits = (): string[] => {
      const fromLabel = (digest.claims?.labelPurposes ?? []).filter(Boolean).slice(0, 3);
      if (fromLabel.length > 0) return fromLabel;
      const fromRule = ruleOverview.coreBenefits.filter(Boolean).slice(0, 3);
      if (fromRule.length > 0) return fromRule;
      const primary = digest.actives?.[0]?.name ?? null;
      if (primary) return [`Supports nutrition related to ${primary}`];
      return ["General wellness support"];
    };

    const getDeterministicLabelDosing = (): string | null => {
      return labelDirectionsRawText ?? buildLabelDosingText(digest);
    };

    const labelDosingText = getDeterministicLabelDosing();
    const timingField = buildLnhpdDeterministicTiming(labelDosingText);
    const withFoodField = buildLnhpdDeterministicWithFood(labelDosingText, digest.actives);

    const withFoodReason = (() => {
      const raw = (labelDosingText ?? "").toLowerCase();
      if (/\b(with food|with meals?|with a meal|after meals?)\b/i.test(raw)) return "label_says_with_meals";
      const activeNames = digest.actives.map((a) => normalizeIngredientName(a.name));
      if (activeNames.some((name) => name.includes("astaxanthin") || name.includes("vitamin d") || name === "vitamin d")) {
        return "fat_soluble";
      }
      if (activeNames.some((name) => ["zinc", "iron", "magnesium"].includes(name))) return "reduce_nausea";
      return "unknown";
    })();

    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    const maybeGateRow = deepseekKey
      ? await getAnalysisIdentityCache(
        {
          identityType: digest.identity.type,
          identityValue: digest.identity.value,
          locale: "en",
          promptVersion: MY_SUPP_OVERVIEW_V2_PROMPT_VERSION,
          factsDigestHash: params.factsDigestHash,
          section: MY_SUPP_OVERVIEW_V2_GATE_SECTION,
        },
        { timeoutMs: 650 },
      ).catch(() => null)
      : null;

    const gatePayload = maybeGateRow?.payload as { ok?: unknown } | null;
    if (deepseekKey && maybeGateRow?.status === "complete" && gatePayload && typeof gatePayload === "object" && gatePayload.ok === false) {
      return { analysisReady: false, source: "none" };
    }

    const promptFacts = {
      identity: digest.identity,
      sourceType: digest.sourceType,
      product: digest.product,
      actives: digest.actives.slice(0, 14).map((active) => ({
        name: active.name,
        amountText: active.amountText ?? (active.amount != null && active.unit ? `${active.amount} ${active.unit}` : null),
        source: active.source,
        confidence: active.confidence ?? null,
      })),
      serving: digest.serving,
      labelDosing: digest.labelDosing.map((d) => d.rawText).filter(Boolean).slice(0, 3),
      claims: digest.claims,
      warnings: digest.warnings,
      quality: digest.quality,
    };

    const deepseekOverviewV2 = deepseekKey
      ? deepseekBreaker.canRequest()
        ? await fetchMySupplementOverviewV2(
          `FACTS_DIGEST_JSON: ${JSON.stringify(promptFacts)}\nLABEL_DIRECTIONS_RAW: ${labelDosingText ?? ""}`,
          model,
          deepseekKey,
          {
            timeoutMs: MY_SUPP_OVERVIEW_TIMEOUT_MS,
            queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
            breaker: deepseekBreaker,
            semaphore: deepseekSemaphore,
          },
        )
        : null
      : null;

    // If DeepSeek is configured, ONLY cache DeepSeek output.
    // Rule-based is used only when DeepSeek is not configured (local/dev environments).
    if (deepseekKey && !deepseekOverviewV2) {
      return { analysisReady: false, source: "none" };
    }

    const coreBenefits = buildDefaultCoreBenefits();

    if (deepseekOverviewV2) {
      const rejectReason = getMySupplementOverviewV2GateReason({
        actives: digest.actives,
        oneLiner: deepseekOverviewV2.oneLiner,
        whatItIs: deepseekOverviewV2.whatItIs,
        tips: deepseekOverviewV2.tips,
        whatYouMayNotice: deepseekOverviewV2.whatYouMayNotice,
        watchOuts: deepseekOverviewV2.watchOuts,
      });
      if (rejectReason) {
        void upsertAnalysisIdentityCache(
          {
            identityType: digest.identity.type,
            identityValue: digest.identity.value,
            locale: "en",
            promptVersion: MY_SUPP_OVERVIEW_V2_PROMPT_VERSION,
            factsDigestHash: params.factsDigestHash,
            factsSourceVersion: params.factsSourceVersion,
            section: MY_SUPP_OVERVIEW_V2_GATE_SECTION,
            status: "complete",
            payload: { ok: false, reason: rejectReason, generatedAt: nowIso() },
            factsDigestJson: digest,
            attempts: 1,
            lockedUntil: null,
            lastError: null,
            errorCode: `GATE_${rejectReason.toUpperCase()}`,
            expiresAt: new Date(Date.now() + MY_SUPP_OVERVIEW_V2_GATE_TTL_MS).toISOString(),
          },
          { timeoutMs: 1200 },
        ).catch((error) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn("[ensure-overview] Failed to persist gate negative cache", message);
        });
        return { analysisReady: false, source: "none" };
      }
    }

    const v2Meta = deepseekOverviewV2
      ? {
        promptVersion: MY_SUPP_OVERVIEW_V2_PROMPT_VERSION,
        factsDigestHash: params.factsDigestHash,
        factsSourceVersion: params.factsSourceVersion,
        generatedAt: nowIso(),
        model,
      }
      : null;

    const overviewSummary = deepseekOverviewV2
      ? normalizeTwoSentenceSummary(
        `${deepseekOverviewV2.oneLiner} ${deepseekOverviewV2.whatItIs}`,
        ruleOverview.overviewSummary,
      )
      : ruleOverview.overviewSummary;

    const analysisData = {
      efficacy: {
        score: 3 as RatingScore,
        benefits: coreBenefits,
        dosageAssessment: {
          text: typeof withFoodField.value === "boolean"
            ? withFoodField.value
              ? "Take with food."
              : "Take on an empty stomach."
            : "Follow label directions.",
          isUnderDosed: false,
        },
        overviewSummary,
        coreBenefits,
      },
      usage: {
        timing: timingField.text,
        withFood: withFoodField.value,
        summary: withFoodField.text ?? "Follow label directions.",
        conflicts: [],
        sourceType: "general_knowledge",
        withFoodReason,
      },
      mySupplementOverviewV2: deepseekOverviewV2
        ? {
          ...deepseekOverviewV2,
          meta: v2Meta,
        }
        : null,
    } satisfies Partial<AiSupplementAnalysis>;

    const persisted = await persistPublicAnalysis({
      supplementId: params.supplementId,
      analysisData,
    });

    if (!persisted) {
      return { analysisReady: false, source: "none" };
    }

    return {
      analysisReady: true,
      source: deepseekOverviewV2 ? "deepseek" : "rule",
      analysisData,
    };
  })();

  inflightPublicOverviewByKey.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    inflightPublicOverviewByKey.delete(inflightKey);
  }
};

const scanFactsSourceSchema = z.enum(["dsld", "lnhpd", "web"]);
const kbFormInsightsItemSchema = z
  .object({
    ingredientId: z.string().trim().min(1),
    formKey: z.string().trim().min(1),
    ingredientName: z.string().trim().min(1).optional(),
    ingredientCanonicalKey: z.string().trim().min(1).optional(),
  })
  .strict();
const kbFormInsightsBatchBodySchema = z
  .object({
    locale: z.string().trim().min(2).max(8).optional().default("en"),
    items: z.array(kbFormInsightsItemSchema).min(1).max(50).optional(),
    requests: z.array(kbFormInsightsItemSchema).min(1).max(50).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.items?.length || value.requests?.length), {
    message: "items or requests is required",
    path: ["items"],
  })
  .transform((value) => ({
    locale: value.locale,
    items: value.items?.length ? value.items : (value.requests ?? []),
  }));

// ============================================================================
// ENDPOINTS
// ============================================================================

const personalizationExplanationHandlers = createPersonalizationExplanationRouteHandlers();
const goalNavigatorHandlers = createGoalNavigatorRouteHandlers();
const goalNavigatorDebugHandlers = createGoalNavigatorDebugRouteHandlers();

/**
 * NuTri daily tips dataset
 */
app.get("/api/nutri-tips", async (_req: Request, res: Response) => {
  try {
    const data = await getNutriTipsData();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, data });
  } catch (error) {
    captureException(error, { route: "/api/nutri-tips" });
    console.error("/api/nutri-tips unexpected error", error);
    return res.status(500).json({ success: false, message: "Failed to load tips." });
  }
});

app.post("/api/personalization/explain", verifySupabaseToken, async (req: Request, res: Response) => {
  try {
    await personalizationExplanationHandlers.explain(req, res);
  } catch (error) {
    captureException(error, { route: "/api/personalization/explain" });
    console.error("/api/personalization/explain unexpected error", error);
    return res.status(500).json({
      error: "personalization_explanation_failed",
    } satisfies ErrorResponse);
  }
});

app.post("/api/personalization/goal-navigator", verifySupabaseToken, async (req: Request, res: Response) => {
  try {
    await goalNavigatorHandlers.goalNavigator(req, res);
  } catch (error) {
    captureException(error, { route: "/api/personalization/goal-navigator" });
    console.error("/api/personalization/goal-navigator unexpected error", error);
    return res.status(500).json({
      error: "goal_navigator_failed",
    } satisfies ErrorResponse);
  }
});

app.get(
  "/api/personalization/debug/goal-navigator-bundle",
  verifySupabaseToken,
  async (req: Request, res: Response) => {
    try {
      await goalNavigatorDebugHandlers.bundleDebug(req, res);
    } catch (error) {
      captureException(error, { route: "/api/personalization/debug/goal-navigator-bundle" });
      console.error("/api/personalization/debug/goal-navigator-bundle unexpected error", error);
      return res.status(500).json({
        error: "goal_navigator_bundle_debug_failed",
      } satisfies ErrorResponse);
    }
  },
);

app.get("/api/search", async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const brand = typeof req.query.brand === "string" ? req.query.brand : null;
    const pageRaw = typeof req.query.page === "string" ? Number.parseInt(req.query.page, 10) : 1;
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 20;

    const payload = await searchProducts({
      query,
      category,
      brand,
      page: Number.isFinite(pageRaw) ? pageRaw : 1,
      limit: Number.isFinite(limitRaw) ? limitRaw : 20,
    });

    res.setHeader("Cache-Control", "private, max-age=60");
    return res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    captureException(error, { route: "/api/search" });
    console.error("/api/search unexpected error", error);
    return res.status(500).json({
      success: false,
      message: "Search temporarily unavailable",
    });
  }
});

app.get("/api/search/bootstrap", async (_req: Request, res: Response) => {
  try {
    const payload = await getProductSearchBootstrap();
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.json({
      success: true,
      data: payload,
    });
  } catch (error) {
    captureException(error, { route: "/api/search/bootstrap" });
    console.error("/api/search/bootstrap unexpected error", error);
    return res.status(500).json({
      success: false,
      message: "Search bootstrap temporarily unavailable",
    });
  }
});

/**
 * Legacy endpoint for barcode search only (no AI analysis)
 */
app.get("/api/search-by-barcode", async (req: Request, res: Response) => {
  try {
    const barcodeRaw = req.query.code;
    const barcodeInput = typeof barcodeRaw === "string" ? barcodeRaw : "";
    const normalized = normalizeBarcodeInput(barcodeInput);

    if (!normalized) {
      return res
        .status(400)
        .json({ error: "invalid_barcode", detail: "Missing or invalid barcode 'code' query param" } satisfies ErrorResponse);
    }

    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) {
      return res
        .status(500)
        .json({ error: "google_cse_env_not_set" } satisfies ErrorResponse);
    }

    const barcode = normalized.code;
    const barcodeVariants = Array.from(
      new Set(
        (normalized.variants ?? [])
          .map((value) => value.replace(/\D/g, ""))
          .filter((value) => value.length >= 8 && value.length <= 14),
      ),
    );
    const scanUpc12 = barcodeVariants.find((value) => value.length === 12) ?? null;

    const acceptLanguage = typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : "";
    const envHl = process.env.SEARCH_HL?.trim() || null;
    const envGl = process.env.SEARCH_GL?.trim().toLowerCase() || null;
    const hl = envHl || (/^|,\s*zh\b/i.test(acceptLanguage) ? "zh-CN" : "en");
    const gl = envGl || (/\b(en|fr)-ca\b/i.test(acceptLanguage) ? "ca" : "us");

    const hasStrongSerpSignal = (item: SearchItem): boolean => {
      const link = item.link || "";
      const domain = extractDomain(link);
      if (isMarketplaceDomain(domain)) return false;

      const text = `${item.title} ${item.snippet}`.replace(/\s+/g, " ");
      if (barcodeVariants.some((code) => text.includes(code))) return true;
      if (barcodeVariants.some((code) => link.includes(code))) return true;

      const urlSignalScore = getUrlSignalScore(link);
      if (urlSignalScore >= 18) return true;

      const tier = getExtractabilityTier(domain);
      if (urlSignalScore > 0 && tier === "A") return true;
      return false;
    };

    const shouldEarlyStop = (items: SearchItem[]): boolean =>
      items.slice(0, 3).some((item) => hasStrongSerpSignal(item));

    type QueryProfile = { id: "A" | "B" | "C"; query: string };
    const profiles: QueryProfile[] = [
      { id: "A", query: `"${barcode}"` },
      {
        id: "B",
        query: `"${barcode}" (ingredients OR \"supplement facts\" OR directions OR warnings)`,
      },
      {
        id: "C",
        query: `"${barcode}" (site:iherb.com OR site:walmart.com OR site:amazon.com OR site:gnc.com OR site:vitaminshoppe.com)`,
      },
    ];

    const searchBudget = new DeadlineBudget(Date.now() + RESOLUTION_SEARCH_STAGE_MAX_MS);
    const searchResilience: SearchResilienceOptions = {
      budget: searchBudget,
      breaker: googleBreaker,
      semaphore: googleSemaphore,
      timeoutMs: RESILIENCE_GOOGLE_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
      retry: { maxAttempts: 1 },
      gl,
      hl,
    };

    let primary: SearchItem[] = [];
    const secondary: SearchItem[] = [];
    const profilesTried: string[] = [];
    let hardStop = false;
    let hadResponse = false;

    for (const profile of profiles) {
      if (profilesTried.length >= RESOLUTION_SEARCH_CALLS_MAX) break;
      if (searchBudget.isExpired()) {
        hardStop = true;
        break;
      }
      try {
        const items = await performGoogleSearch(profile.query, apiKey, cx, searchResilience);
        hadResponse = true;
        profilesTried.push(profile.id);
        if (!items.length) continue;
        if (primary.length === 0) {
          primary = items;
        } else {
          secondary.push(...items);
        }
        if (shouldEarlyStop(items)) break;
      } catch (error) {
        profilesTried.push(profile.id);
        if (!isAbortError(error)) {
          console.warn(`[Search] Query failed: "${profile.query}"`, error);
        }
        const shouldHardStop =
          error instanceof BulkheadTimeoutError ||
          (error instanceof TimeoutError && error.message.includes("budget")) ||
          (error instanceof Error && error.message === "google_breaker_open") ||
          isAbortError(error);
        if (shouldHardStop) {
          hardStop = true;
          break;
        }
      }
    }

    const finalItems = mergeAndDedupe(primary, secondary, { barcode });
    console.log(
      `[Search] Barcode: ${barcode}, Profiles: ${profilesTried.length}, Items: ${finalItems.length}, HardStop: ${hardStop}, HadResponse: ${hadResponse}`,
    );

    if (!finalItems.length) {
      return res.json({ status: "not_found", barcode } satisfies SearchResponse);
    }

    return res.json({ status: "ok", barcode, items: finalItems } satisfies SearchResponse);
  } catch (error) {
    captureException(error, { route: "/api/search-by-barcode" });
    console.error("/api/search-by-barcode unexpected error", error);
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

app.get("/api/scan-facts/v1/:source/:id", verifySupabaseToken, async (req: Request, res: Response) => {
  const sourceParsed = scanFactsSourceSchema.safeParse(req.params.source);
  const sourceId = typeof req.params.id === "string" ? req.params.id.trim() : "";
  if (!sourceParsed.success || !sourceId) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "Invalid source or id" } satisfies ErrorResponse);
  }

  const source = sourceParsed.data;
  const requestSignal = createTimeoutSignal(4_500);

  const parseMissingFields = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .filter(([, flag]) => Boolean(flag))
        .map(([key]) => key.trim())
        .filter(Boolean);
    }
    return [];
  };

  try {
    if (source === "lnhpd") {
      if (!LNHPD_RUNTIME_ENABLED) {
        return res.json({ status: "not_found", source, sourceId, facts: null });
      }
      const facts = await fetchLnhpdFactsByNpn(sourceId, requestSignal);
      if (!facts) {
        return res.json({ status: "not_found", source, sourceId, facts: null });
      }
      const row = await fetchLnhpdFactsRecordByNpn(sourceId, requestSignal);
      const dto = mapLnhpdFactsToFactsDTO({
        npn: sourceId,
        productName: facts.productName ?? null,
        brandName: facts.brandName ?? null,
        actives: facts.actives,
        inactive: facts.inactive ?? [],
        purposes: facts.purposes ?? [],
        routes: facts.routes ?? [],
        doses: facts.doses ?? [],
        datasetVersion: facts.datasetVersion ?? row?.dataset_version ?? null,
        extractedAt: facts.extractedAt ?? row?.extracted_at ?? null,
        isComplete: typeof row?.is_complete === "boolean" ? row.is_complete : null,
        missingFields: parseMissingFields(row?.missing_fields),
        factsJson: row?.facts_json,
      });
      return res.json({ status: "ok", source, sourceId, facts: factsDtoSchemaV2.parse(dto) });
    }

    if (source === "dsld") {
      const idNum = Number.parseInt(sourceId, 10);
      if (!Number.isFinite(idNum) || idNum <= 0) {
        return res.status(400).json({ error: "invalid_request", detail: "DSLD id must be numeric" } satisfies ErrorResponse);
      }

      const factsRecord = await fetchDsldFactsRecordByLabelId(idNum, requestSignal);
      if (factsRecord?.facts_json && typeof factsRecord.facts_json === "object") {
        const dsldFacts = factsRecord.facts_json as {
          dsldLabelId?: number;
          brandName?: string | null;
          productName?: string | null;
          servingSize?: string | null;
          servingsPerContainer?: number | null;
          actives?: Array<{ name: string; amount: number | null; unit: string | null; formRaw?: string | null }>;
          inactive?: string[];
          dsldPdf?: string | null;
          dsldThumbnail?: string | null;
        };
        const dto = mapDsldFactsToFactsDTO({
          dsldLabelId: dsldFacts.dsldLabelId ?? idNum,
          productName: dsldFacts.productName ?? null,
          brandName: dsldFacts.brandName ?? null,
          actives: Array.isArray(dsldFacts.actives) ? dsldFacts.actives : [],
          inactive: Array.isArray(dsldFacts.inactive) ? dsldFacts.inactive : [],
          servingSize: dsldFacts.servingSize ?? null,
          servingsPerContainer: dsldFacts.servingsPerContainer ?? null,
          datasetVersion: factsRecord.dataset_version ?? null,
          extractedAt: factsRecord.extracted_at ?? null,
          dsldPdf: dsldFacts.dsldPdf ?? null,
          dsldThumbnail: dsldFacts.dsldThumbnail ?? null,
        });
        return res.json({ status: "ok", source, sourceId, facts: factsDtoSchemaV2.parse(dto) });
      }

      const meta = await fetchDsldMetaByLabelId(idNum, requestSignal);
      if (!meta) {
        return res.json({ status: "not_found", source, sourceId, facts: null });
      }
      const dto = mapDsldFactsToFactsDTO({
        dsldLabelId: meta.dsld_label_id,
        productName: meta.product_name ?? null,
        brandName: meta.brand ?? null,
        servingSize: meta.serving_size_raw ?? null,
        servingsPerContainer: meta.servings_per_container ?? null,
        actives: parseDelimitedList(meta.active_ingredients_summary).map(parseActiveSummaryLine),
        inactive: parseDelimitedList(meta.inactive_ingredients),
        datasetVersion: meta.dsld_product_version_code ?? null,
        extractedAt: null,
        dsldPdf: meta.dsld_pdf ?? null,
        dsldThumbnail: meta.dsld_thumbnail ?? null,
      });
      return res.json({ status: "ok", source, sourceId, facts: factsDtoSchemaV2.parse(dto) });
    }

    const webRows = await fetchWebIngredientsBySourceId(sourceId, requestSignal);
    if (!webRows.length) {
      return res.json({ status: "not_found", source, sourceId, facts: null });
    }
    const dto = mapWebFactsToFactsDTO({
      sourceId,
      productName: null,
      brandName: null,
      actives: webRows
        .filter((row) => row.is_active)
        .map((row) => ({
          name: row.name_raw,
          amount: typeof row.amount === "number" ? row.amount : null,
          unit: typeof row.unit === "string" ? row.unit : null,
        })),
      inactives: webRows.filter((row) => !row.is_active).map((row) => row.name_raw),
      extractedAt: null,
      datasetVersion: null,
    });
    return res.json({ status: "ok", source, sourceId, facts: factsDtoSchemaV2.parse(dto) });
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

/**
 * KB runtime form insights (batch)
 */
app.post("/api/kb/runtime/form-insights/batch", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsed = parseRequestBody(kbFormInsightsBatchBodySchema, req, res);
  if (!parsed) return;

  const locale = (parsed.locale ?? "en").toLowerCase();
  const isRegressionRequest = (req as AuthenticatedRequest).regressionAuth === true;
  const uuidLike = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const unresolvedUuidIds = Array.from(
    new Set(
      parsed.items
        .filter(
          (item) =>
            !item.ingredientCanonicalKey &&
            !item.ingredientName &&
            typeof item.ingredientId === "string" &&
            uuidLike(item.ingredientId),
        )
        .map((item) => item.ingredientId),
    ),
  );

  const ingredientBridgeById = new Map<string, { canonicalKey: string | null; ingredientName: string | null }>();
  if (unresolvedUuidIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id,canonical_key,name")
        .in("id", unresolvedUuidIds);
      if (error) {
        console.warn("[kb-runtime-batch] uuid bridge lookup failed", error.message);
      } else if (Array.isArray(data)) {
        data.forEach((row) => {
          const id = typeof row?.id === "string" ? row.id : "";
          if (!id) return;
          ingredientBridgeById.set(id, {
            canonicalKey: typeof row?.canonical_key === "string" ? row.canonical_key : null,
            ingredientName: typeof row?.name === "string" ? row.name : null,
          });
        });
      }
    } catch (error) {
      console.warn(
        "[kb-runtime-batch] uuid bridge lookup crashed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const items = parsed.items.map((item) => {
    const bridged = ingredientBridgeById.get(item.ingredientId);
    const ingredientCanonicalKey = item.ingredientCanonicalKey ?? bridged?.canonicalKey ?? null;
    const ingredientName = item.ingredientName ?? bridged?.ingredientName ?? null;
    const result = lookupKbRuntimeFormInsights({
      ingredientId: item.ingredientId,
      formKey: item.formKey,
      ingredientName,
      ingredientCanonicalKey,
    });
    return {
      ingredientId: item.ingredientId,
      formKey: item.formKey,
      ingredientCanonicalKey,
      status: result.status,
      reason: result.reason,
      formDisplay: result.formDisplay,
      segments: result.segments,
      meta: result.meta,
      ...(isRegressionRequest
        ? {
          debug: {
            ingredientResolvePath: result.debug.ingredientResolvePath,
            formKeyResolvePath: result.debug.formKeyResolvePath,
            reviewedLookupTried: result.debug.reviewedLookupTried,
          },
        }
        : {}),
    };
  });

  const packageSha256 = items[0]?.meta?.packageSha256 ?? null;
  const reviewedAt = items[0]?.meta?.reviewedAt ?? null;
  const source = items[0]?.meta?.source ?? null;

  const payload = {
    status: "ok" as const,
    locale,
    packageSha256,
    reviewedAt,
    source,
    items,
  };

  const etag = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.json(payload);
});

let iherbOverlayFetchWarned = false;
const logIherbOverlayFetchWarningOnce = (message: string) => {
  if (iherbOverlayFetchWarned) return;
  iherbOverlayFetchWarned = true;
  console.warn("[iherb-overlay] lookup disabled:", message);
};

const toOverlayObjectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const toOverlayArrayRecord = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

const readOverlayServingSize = (
  row: Record<string, unknown>,
  supplementFacts: Record<string, unknown>,
): string | null => {
  const serving = toOverlayObjectRecord(row.serving);
  const candidates = [
    serving.servingSize,
    serving.serving_size,
    supplementFacts.servingSize,
    supplementFacts.serving_size,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized && normalized.toLowerCase() !== "n/a") return normalized;
  }
  return null;
};

const readOverlayServingsPerContainer = (
  row: Record<string, unknown>,
  supplementFacts: Record<string, unknown>,
): string | null => {
  const serving = toOverlayObjectRecord(row.serving);
  const candidates = [
    serving.servingsPerContainer,
    serving.servings_per_container,
    supplementFacts.servingsPerContainer,
    supplementFacts.servings_per_container,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized && normalized.toLowerCase() !== "n/a") return normalized;
  }
  return null;
};

const readOverlayNutritionalFacts = (
  rawSupplementFacts: unknown,
  supplementFacts: Record<string, unknown>,
): Record<string, unknown>[] => {
  const directRows = toOverlayArrayRecord(rawSupplementFacts);
  if (directRows.length > 0) return directRows;

  for (const candidate of [
    supplementFacts.nutritionalFacts,
    supplementFacts.nutritional_facts,
    supplementFacts.rows,
    supplementFacts.facts,
  ]) {
    const rows = toOverlayArrayRecord(candidate);
    if (rows.length > 0) return rows;
  }

  return [];
};

const normalizeOverlaySectionKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const readOverlaySectionText = (
  sections: Record<string, unknown>,
  aliases: string[],
): string | null => {
  const aliasKeys = new Set(aliases.map(normalizeOverlaySectionKey));
  for (const [rawKey, rawValue] of Object.entries(sections)) {
    if (!aliasKeys.has(normalizeOverlaySectionKey(rawKey))) continue;
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const readOverlayImageUrl = (row: Record<string, unknown>): string | null => {
  const directCandidates = [
    row.productCatalogImage,
    row.product_catalog_image,
    row.imageUrl,
    row.image_url,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  const imageCollections = [row.productImages, row.product_images];
  for (const collection of imageCollections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const nestedCandidates = [record.url, record.src, record.imageUrl, record.image_url];
        for (const nested of nestedCandidates) {
          if (typeof nested !== "string") continue;
          const trimmed = nested.trim();
          if (trimmed) return trimmed;
        }
      }
    }
  }

  return null;
};

const toDecisionSupportOverlayClaims = (row: Record<string, unknown>): DecisionSupportOverlayClaims => {
  const descriptionSections = toOverlayObjectRecord(
    row.allDescriptionSections ?? row.descriptionSections ?? row.description_sections,
  );
  const rawSupplementFacts = row.supplementFacts ?? row.supplement_facts;
  const supplementFacts = toOverlayObjectRecord(rawSupplementFacts);
  const nutritionalFactsRaw = readOverlayNutritionalFacts(rawSupplementFacts, supplementFacts);
  return {
    provider: "iherb",
    productId:
      typeof row.productId === "number"
        ? String(row.productId)
        : typeof row.productId === "string"
          ? row.productId
          : typeof row.product_id === "number"
            ? String(row.product_id)
            : typeof row.product_id === "string"
              ? row.product_id
              : null,
    upcCode: typeof row.upc_code === "string" ? row.upc_code : typeof row.upcCode === "string" ? row.upcCode : null,
    barcodeGtin14:
      typeof row.barcode_gtin14 === "string"
        ? row.barcode_gtin14
        : typeof row.barcodeGtin14 === "string"
          ? row.barcodeGtin14
          : null,
    brandName:
      typeof row.brandName === "string"
        ? row.brandName
        : typeof row.brand_name === "string"
          ? row.brand_name
          : null,
    title: typeof row.title === "string" ? row.title : null,
    link: typeof row.link === "string" ? row.link : null,
    imageUrl: readOverlayImageUrl(row),
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => String(item ?? "").trim()).filter(Boolean)
      : Array.isArray(row.category)
        ? row.category.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
    description: readOverlaySectionText(descriptionSections, ["Description"]),
    suggestedUse: readOverlaySectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readOverlaySectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readOverlaySectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readOverlaySectionText(descriptionSections, ["Disclaimer"]),
    servingSize: readOverlayServingSize(row, supplementFacts),
    servingsPerContainer: readOverlayServingsPerContainer(row, supplementFacts),
    sourceZipPath:
      typeof row.source_zip_path === "string"
        ? row.source_zip_path
        : typeof row.sourceZipPath === "string"
          ? row.sourceZipPath
          : null,
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: String(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name ?? "").trim(),
        amountPerServing: String(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount ?? "").trim(),
        dailyValuePercent:
          String(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue ?? "").trim() || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const fetchIherbOverlayClaimsByBarcode = async (
  barcodeGtin14: string,
): Promise<DecisionSupportOverlayClaims | null> => {
  if (!barcodeGtin14) return null;
  try {
    const barcodeDigits = String(barcodeGtin14).replace(/\D/g, "");
    const upc12 = barcodeDigits.length >= 12 ? barcodeDigits.slice(-12) : barcodeDigits;
    const ean13 = barcodeDigits.length >= 13 ? barcodeDigits.slice(-13) : barcodeDigits;
    const unpadded = barcodeDigits.replace(/^0+/, "") || barcodeDigits;
    const barcodeFilters = Array.from(
      new Set([
        `barcode_gtin14.eq.${barcodeGtin14}`,
        `barcode_gtin14.eq.${barcodeDigits}`,
        `upc_code.eq.${barcodeDigits}`,
        `upc_code.eq.${upc12}`,
        `upc_code.eq.${ean13}`,
        `upc_code.eq.${unpadded}`,
      ]),
    );
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select(
        "product_id,upc_code,barcode_gtin14,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,serving,description_sections,source_zip_path,updated_at",
      )
      .or(barcodeFilters.join(","))
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      if (error && /relation .*iherb_overlay_products.* does not exist/i.test(String(error.message ?? ""))) {
        logIherbOverlayFetchWarningOnce("table iherb_overlay_products does not exist");
      }
      return null;
    }
    return toDecisionSupportOverlayClaims(data as Record<string, unknown>);
  } catch (error) {
    logIherbOverlayFetchWarningOnce(error instanceof Error ? error.message : String(error));
    return null;
  }
};

const normalizeBarcodeToGtin14 = (rawBarcode: string | null | undefined): string | null => {
  const digits = String(rawBarcode ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(14, "0").slice(-14);
};

const bundleUsesIherbOverlaySupport = (bundle: AnalysisBundle | null | undefined): boolean => {
  if (!bundle || typeof bundle !== "object") return false;
  const overlayAugmentationSource = String(bundle.meta?.overlayAugmentationSource ?? "").trim().toLowerCase();
  const overlayAugmentationVersion = String(bundle.meta?.overlayAugmentationVersion ?? "").trim();
  if (overlayAugmentationSource === "iherb" && overlayAugmentationVersion.length > 0) {
    return true;
  }
  if (overlayAugmentationSource === "none") {
    return false;
  }
  const inline = (
    bundle.meta as {
      decisionSupportInline?: {
        overviewBlock?: { sourceStrip?: unknown } | null;
        usageBlock?: { directions?: { sourceTier?: unknown } | null } | null;
      } | null;
    } | undefined
  )?.decisionSupportInline;
  if (!inline || typeof inline !== "object") return false;
  const sourceStrip = Array.isArray(inline.overviewBlock?.sourceStrip) ? inline.overviewBlock.sourceStrip : [];
  if (sourceStrip.some((line: unknown) => /supplemental|product-page|iherb/i.test(String(line ?? "")))) {
    return true;
  }
  const directionsTier = String(inline.usageBlock?.directions?.sourceTier ?? "").trim().toLowerCase();
  return directionsTier === "overlay_iherb";
};

const snapshotPayloadUsesIherbOverlaySupport = (
  analysisPayload: SnapshotAnalysisPayload | null | undefined,
): boolean => {
  if (!analysisPayload || typeof analysisPayload !== "object") return false;
  const overlayAugmentation = analysisPayload.analysis?.overlayAugmentation;
  const explicitProvider = String(overlayAugmentation?.provider ?? "").trim().toLowerCase();
  const explicitVersion = String(overlayAugmentation?.version ?? "").trim();
  if (explicitProvider === "iherb" && explicitVersion.length > 0) {
    return true;
  }
  if (explicitProvider === "none") {
    return false;
  }
  const sources = Array.isArray(analysisPayload.sources) ? analysisPayload.sources : [];
  return sources.some((source) => {
    const title = String(source?.title ?? "").trim().toLowerCase();
    const link = String(source?.link ?? "").trim().toLowerCase();
    const domain = String(source?.domain ?? "").trim().toLowerCase();
    return title.includes("iherb") || link.includes("iherb") || domain.includes("iherb");
  });
};

const ingredientOverviewBodySchema = z.object({
  barcode: z.string().trim().min(1),
  decisionDigest: z.string().trim().min(1).nullable().optional(),
  decisionInputsHash: z.string().trim().min(1).nullable().optional(),
  personalizationScopeHash: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityType: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityValue: z.string().trim().min(1).nullable().optional(),
  revalidateFallback: z.boolean().optional(),
}).strict();

const scientificBackgroundBodySchema = z.object({
  barcode: z.string().trim().min(1),
  decisionDigest: z.string().trim().min(1).nullable().optional(),
  decisionInputsHash: z.string().trim().min(1).nullable().optional(),
  personalizationScopeHash: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityType: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityValue: z.string().trim().min(1).nullable().optional(),
  selectedIngredientName: z.string().trim().min(1),
  revalidateFallback: z.boolean().optional(),
}).strict();

const SCIENCE_SIDECAR_MAX_RETRIES = 0;
const INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT = 120;
const INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS = 90_000;
const SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT = 120;
const SCIENTIFIC_BACKGROUND_RESEARCH_FALLBACK_CACHE_TTL_MS = 90_000;
const SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS = 2_500;
const SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS = 45_000;
const SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT = 3;
const SCIENTIFIC_BACKGROUND_REFRESH_MAX_CONCURRENCY = 2;
const DECISION_SUPPORT_AUTHORITY_BUNDLE_CACHE_TTL_MS = 30_000;
const DECISION_SUPPORT_AUTHORITY_BUNDLE_CACHE_LIMIT = 180;

type ScientificBackgroundSidecarResponse = {
  status: "ok";
  digest: string;
  scientificBackground: Awaited<ReturnType<typeof compileScientificBackgroundAsync>>["scientificBackground"];
  source: Awaited<ReturnType<typeof compileScientificBackgroundAsync>>["source"];
  fallbackUsed: boolean;
  promptVersion: string;
  backgroundRefreshPending: boolean;
  recommendedRetryAfterMs: number | null;
};

type ScientificBackgroundSidecarCacheEntry = {
  expiresAt: number;
  payload: ScientificBackgroundSidecarResponse;
};

type IngredientOverviewSidecarResponse = {
  status: "ok";
  digest: string;
  ingredientOverview: Awaited<ReturnType<typeof compileIngredientOverviewAsync>>["ingredientOverview"];
  source: Awaited<ReturnType<typeof compileIngredientOverviewAsync>>["source"];
  fallbackUsed: boolean;
  promptVersion: string;
};

type IngredientOverviewSidecarCacheEntry = {
  expiresAt: number;
  payload: IngredientOverviewSidecarResponse;
};

const ingredientOverviewSidecarCache = new Map<string, IngredientOverviewSidecarCacheEntry>();
const scientificBackgroundSidecarCache = new Map<string, ScientificBackgroundSidecarCacheEntry>();
const scientificBackgroundSidecarInflight = new Map<string, Promise<ScientificBackgroundSidecarResponse>>();
const scientificBackgroundSidecarBackgroundRefresh = new Map<string, Promise<void>>();
const scientificBackgroundSidecarBackgroundRefreshCooldownUntil = new Map<string, number>();
const scientificBackgroundSidecarBackgroundRefreshFailureCount = new Map<string, number>();
type DecisionSupportAuthorityBundle = Awaited<ReturnType<typeof buildDecisionSupportAuthorityBundleUncached>>;
const decisionSupportAuthorityBundleCache = new Map<
  string,
  {
    expiresAt: number;
    bundle: DecisionSupportAuthorityBundle;
  }
>();
const decisionSupportAuthorityBundleInflight = new Map<string, Promise<DecisionSupportAuthorityBundle>>();
let activeScientificBackgroundRefreshCount = 0;
const queuedScientificBackgroundRefreshTasks: Array<() => void> = [];

const buildIngredientOverviewSidecarCacheKey = (params: {
  barcode?: string;
  decisionDigest: string;
  decisionInputsHash: string;
  personalizationScopeHash: string;
}): string =>
  buildScanSidecarCacheKey({
    route: "ingredient_overview",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
  });

const readIngredientOverviewSidecarCache = (
  cacheKey: string,
): IngredientOverviewSidecarResponse | null => {
  const entry = ingredientOverviewSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("ingredient_overview", "miss");
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    ingredientOverviewSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("ingredient_overview", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("ingredient_overview", "hit");
  return entry.payload;
};

const writeIngredientOverviewSidecarCache = (
  cacheKey: string,
  payload: IngredientOverviewSidecarResponse,
): void => {
  ingredientOverviewSidecarCache.set(cacheKey, {
    expiresAt: Date.now()
      + (getScanSidecarPolicy("ingredient_overview").defaultTtlMs || INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS),
    payload,
  });
  recordScanSidecarCacheStatus("ingredient_overview", "write");
  if (ingredientOverviewSidecarCache.size <= INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT) return;
  const oldestKey = ingredientOverviewSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    ingredientOverviewSidecarCache.delete(oldestKey);
  }
};

const runNextScientificBackgroundRefreshTask = (): void => {
  const next = queuedScientificBackgroundRefreshTasks.shift();
  if (!next) return;
  next();
};

const runWithScientificBackgroundRefreshSlot = async <T>(
  task: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const run = () => {
      activeScientificBackgroundRefreshCount += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeScientificBackgroundRefreshCount = Math.max(0, activeScientificBackgroundRefreshCount - 1);
          runNextScientificBackgroundRefreshTask();
        });
    };

    if (activeScientificBackgroundRefreshCount < SCIENTIFIC_BACKGROUND_REFRESH_MAX_CONCURRENCY) {
      run();
      return;
    }

    queuedScientificBackgroundRefreshTasks.push(run);
  });

const isScientificBackgroundBackgroundRefreshCoolingDown = (cacheKey: string): boolean => {
  const cooldownUntil = scientificBackgroundSidecarBackgroundRefreshCooldownUntil.get(cacheKey);
  if (!cooldownUntil) return false;
  if (cooldownUntil <= Date.now()) {
    scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
    return false;
  }
  return true;
};

const markScientificBackgroundBackgroundRefreshCooldown = (cacheKey: string): void => {
  scientificBackgroundSidecarBackgroundRefreshCooldownUntil.set(
    cacheKey,
    Date.now() + SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS,
  );
  if (scientificBackgroundSidecarBackgroundRefreshCooldownUntil.size <= SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) return;
  const oldestKey = scientificBackgroundSidecarBackgroundRefreshCooldownUntil.keys().next().value;
  if (typeof oldestKey === "string") {
    scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(oldestKey);
  }
};

const shouldCoolDownScientificBackgroundBackgroundRefresh = (
  cacheKey: string,
  retryLimit: number = SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT,
): boolean => {
  const nextFailureCount = (scientificBackgroundSidecarBackgroundRefreshFailureCount.get(cacheKey) ?? 0) + 1;
  scientificBackgroundSidecarBackgroundRefreshFailureCount.set(cacheKey, nextFailureCount);
  if (scientificBackgroundSidecarBackgroundRefreshFailureCount.size > SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) {
    const oldestKey = scientificBackgroundSidecarBackgroundRefreshFailureCount.keys().next().value;
    if (typeof oldestKey === "string") {
      scientificBackgroundSidecarBackgroundRefreshFailureCount.delete(oldestKey);
    }
  }
  return nextFailureCount >= retryLimit;
};

const readScientificBackgroundSidecarCache = (
  cacheKey: string,
): ScientificBackgroundSidecarResponse | null => {
  const entry = scientificBackgroundSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("scientific_background", "miss");
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    scientificBackgroundSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("scientific_background", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("scientific_background", "hit");
  return entry.payload;
};

const buildScientificBackgroundSidecarCacheKey = (params: {
  barcode?: string;
  decisionDigest: string;
  decisionInputsHash: string;
  personalizationScopeHash: string;
  selectedIngredientKey: string;
  promptVersion: string;
}): string =>
  buildScanSidecarCacheKey({
    route: "scientific_background",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    selectedIngredientKey: params.selectedIngredientKey,
    promptVersion: params.promptVersion,
  });

const findScientificBackgroundSidecarCacheByRequest = (params: {
  barcode?: string;
  decisionDigest: string;
  decisionInputsHash: string;
  personalizationScopeHash: string;
  selectedIngredientKey: string;
}): { cacheKey: string; payload: ScientificBackgroundSidecarResponse } | null => {
  const prefix = buildScanSidecarCacheKey({
    route: "scientific_background",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    selectedIngredientKey: params.selectedIngredientKey,
  }) + "|";
  for (const [cacheKey, entry] of scientificBackgroundSidecarCache.entries()) {
    if (!cacheKey.startsWith(prefix)) continue;
    if (entry.expiresAt <= Date.now()) {
      scientificBackgroundSidecarCache.delete(cacheKey);
      recordScanSidecarCacheStatus("scientific_background", "stale");
      continue;
    }
    recordScanSidecarCacheStatus("scientific_background", "hit");
    return { cacheKey, payload: entry.payload };
  }
  recordScanSidecarCacheStatus("scientific_background", "miss");
  return null;
};

const writeScientificBackgroundSidecarCache = (
  cacheKey: string,
  payload: ScientificBackgroundSidecarResponse,
  ttlMs: number,
): void => {
  scientificBackgroundSidecarCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    payload,
  });
  recordScanSidecarCacheStatus("scientific_background", "write");
  if (scientificBackgroundSidecarCache.size <= SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) return;
  const oldestKey = scientificBackgroundSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    scientificBackgroundSidecarCache.delete(oldestKey);
  }
};

const resolveScientificBackgroundCacheTtlMs = (
  payload: ScientificBackgroundSidecarResponse,
  executionProfile: ScientificBackgroundExecutionProfile,
): number => {
  const policyTtlMs = getScanSidecarPolicy("scientific_background").defaultTtlMs;
  if (payload.source === "api") return executionProfile.cacheTtlMs || policyTtlMs;
  if (payload.scientificBackground.mode === "research_mode") {
    return SCIENTIFIC_BACKGROUND_RESEARCH_FALLBACK_CACHE_TTL_MS;
  }
  return executionProfile.cacheTtlMs || policyTtlMs;
};

const withScientificBackgroundRefreshHint = (
  payload: ScientificBackgroundSidecarResponse,
  backgroundRefreshPending: boolean,
): ScientificBackgroundSidecarResponse =>
  ({
    ...payload,
    backgroundRefreshPending: backgroundRefreshPending && payload.source === "fallback",
    recommendedRetryAfterMs:
      backgroundRefreshPending && payload.source === "fallback"
        ? SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS
        : null,
  });
const stableStringifyScopeValue = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyScopeValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, itemValue]) => itemValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, itemValue]) => `${JSON.stringify(key)}:${stableStringifyScopeValue(itemValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
};

const buildPersonalizationScopeHash = (params: {
  userId: string | null;
  localDecisionSupportHeader: string | null;
  effectiveUserProfile: DecisionSupportProfileRow | null;
  allergyContext: DecisionSupportAttachedAllergyContext | null;
  personalizationContext: DecisionSupportAttachedPersonalizationContext | null;
}): string =>
  createHash("sha256")
    .update(
      stableStringifyScopeValue({
        userId: params.userId ?? "anon",
        localDecisionSupportHeader: params.localDecisionSupportHeader ?? null,
        effectiveUserProfile: params.effectiveUserProfile ?? null,
        allergyContext: params.allergyContext ?? null,
        personalizationContext: params.personalizationContext ?? null,
      }),
    )
    .digest("hex");

const buildDecisionSupportDigestMismatchPayload = (
  latestDigest: string,
  latestDecisionInputsHash: string,
  latestPersonalizationScopeHash: string,
) => ({
  error: "DECISION_SUPPORT_DIGEST_MISMATCH",
  reasonCode: "DECISION_SUPPORT_DIGEST_MISMATCH",
  message: "Decision support content has updated. Refresh with latest digest.",
  latestDigest,
  latestDecisionInputsHash,
  latestPersonalizationScopeHash,
});

const buildDeepseekJsonLlmFn = (params: {
  deepseekKey: string | null;
  deepseekModel: string;
  timeoutMs: number;
  maxTokens: number;
}): ((prompt: string) => Promise<string>) | undefined => {
  if (!params.deepseekKey) return undefined;

  return async (prompt: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.deepseekKey}`,
        },
        body: JSON.stringify({
          model: params.deepseekModel,
          messages: [
            {
              role: "system",
              content:
                "Return ONLY a valid JSON object. No markdown. No commentary. No code fences.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          stream: false,
          max_tokens: params.maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`deepseek_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("deepseek_empty_content");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
};

const buildDecisionSupportAuthorityBundleUncached = async (
  normalizedBarcode: NormalizedBarcode,
  options?: {
    req?: Request;
    viewMode?: DecisionSupportViewMode;
  },
): Promise<{
  barcodeGtin14: string;
  overlayClaims: DecisionSupportOverlayClaims | null;
  quickDigest: Awaited<ReturnType<typeof buildMySupplementDigestQuick>>;
  patched: ReturnType<typeof applyPatchShadowToFactsDigest>;
  decisionSupport: ReturnType<typeof compileDecisionSupport>;
  ingredientScienceContext: ReturnType<typeof buildIngredientScienceContext>;
  personalizationScopeHash: string;
}> => {
  const barcodeGtin14 = normalizedBarcode.code.padStart(14, "0");
  const authedReq = options?.req as AuthenticatedRequest | undefined;
  const userId = authedReq?.user?.id ?? null;
  const localDecisionSupportContext = options?.req ? parseLocalDecisionSupportContext(options.req) : null;
  const localDecisionSupportHeader =
    options?.req && typeof options.req.header === "function"
      ? String(options.req.header("x-local-personalization") ?? "").trim() || null
      : null;
  const overlayClaims = await fetchIherbOverlayClaimsByBarcode(barcodeGtin14);
  const quickDigest = await buildMySupplementDigestQuick({
    supplementId: barcodeGtin14,
    barcode: normalizedBarcode.code,
    brandName: "",
    productName: "",
    budgetMs: 4_500,
  });
  const patched = applyPatchShadowToFactsDigest({
    digest: quickDigest.digest,
    barcodeGtin14,
  });
  const [userProfile, productFlags, remoteStackInputs] = await Promise.all([
    fetchUserDecisionSupportProfile(userId),
    fetchProductAllergenFlagsForDecisionSupport(patched.digest, barcodeGtin14),
    userId ? fetchRemoteStackOverlapInputs(userId) : Promise.resolve(null),
  ]);
  const localUserProfile = buildUserDecisionSupportProfileRowFromLocalProfile(
    localDecisionSupportContext?.profile,
  );
  const effectiveUserProfile = mergeDecisionSupportProfileRows({
    remoteProfile: userProfile,
    localProfile: localUserProfile,
  });
  const allergyContext = buildDecisionSupportAllergyContext({
    userProfile: effectiveUserProfile,
    productFlags,
  });
  const personalizationContext = buildDecisionSupportPersonalizationContext({
    userProfile: effectiveUserProfile,
    allergyContext,
    remoteStackInputs,
    currentProductInput: buildDecisionSupportCurrentStackInput({
      digest: patched.digest,
      barcodeGtin14,
    }),
    fallbackSavedStackCount: userId ? 0 : (localDecisionSupportContext?.savedSupplements.length ?? 0),
  });
  const personalizationScopeHash = buildPersonalizationScopeHash({
    userId,
    localDecisionSupportHeader,
    effectiveUserProfile,
    allergyContext,
    personalizationContext,
  });
  const decisionSupport = compileDecisionSupport({
    digest: patched.digest,
    factsDigestHash: quickDigest.factsDigestHash,
    viewMode: options?.viewMode ?? DECISION_SUPPORT_DEFAULT_VIEW_MODE,
    locale: "en",
    flagsSnapshot: collectDecisionSupportFlagsSnapshot(),
    patchActivation: patched.activation,
    overlayClaims,
    allergyContext,
    personalizationContext,
  });
  const ingredientScienceContext = buildIngredientScienceContext({
    digest: patched.digest,
    overlayClaims,
  });

  return {
    barcodeGtin14,
    overlayClaims,
    quickDigest,
    patched,
    decisionSupport,
    ingredientScienceContext,
    personalizationScopeHash,
  };
};

const buildDecisionSupportAuthorityBundleCacheKey = (
  normalizedBarcode: NormalizedBarcode,
  options?: {
    req?: Request;
    viewMode?: DecisionSupportViewMode;
  },
): string => {
  const authedReq = options?.req as AuthenticatedRequest | undefined;
  const userId = authedReq?.user?.id ?? "anon";
  const localDecisionSupportHeader =
    options?.req && typeof options.req.header === "function"
      ? String(options.req.header("x-local-personalization") ?? "").trim() || "none"
      : "none";
  return createHash("sha256")
    .update(
      stableStringifyScopeValue({
        barcode: normalizedBarcode.code.padStart(14, "0"),
        userId,
        localDecisionSupportHeader,
        viewMode: options?.viewMode ?? DECISION_SUPPORT_DEFAULT_VIEW_MODE,
      }),
    )
    .digest("hex");
};

const writeDecisionSupportAuthorityBundleCache = (
  cacheKey: string,
  bundle: DecisionSupportAuthorityBundle,
): void => {
  decisionSupportAuthorityBundleCache.set(cacheKey, {
    expiresAt: Date.now() + DECISION_SUPPORT_AUTHORITY_BUNDLE_CACHE_TTL_MS,
    bundle,
  });
  recordScanSidecarCacheStatus("decision_support", "write");
  if (decisionSupportAuthorityBundleCache.size <= DECISION_SUPPORT_AUTHORITY_BUNDLE_CACHE_LIMIT) return;
  const oldestKey = decisionSupportAuthorityBundleCache.keys().next().value;
  if (typeof oldestKey === "string") {
    decisionSupportAuthorityBundleCache.delete(oldestKey);
  }
};

const readDecisionSupportAuthorityBundleCache = (
  cacheKey: string,
): DecisionSupportAuthorityBundle | null => {
  const cached = decisionSupportAuthorityBundleCache.get(cacheKey);
  if (!cached) {
    recordScanSidecarCacheStatus("decision_support", "miss");
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    decisionSupportAuthorityBundleCache.delete(cacheKey);
    recordScanSidecarCacheStatus("decision_support", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("decision_support", "hit");
  return cached.bundle;
};

const buildDecisionSupportAuthorityBundle = async (
  normalizedBarcode: NormalizedBarcode,
  options?: {
    req?: Request;
    viewMode?: DecisionSupportViewMode;
  },
): Promise<DecisionSupportAuthorityBundle> => {
  const cacheKey = buildDecisionSupportAuthorityBundleCacheKey(normalizedBarcode, options);
  const cached = readDecisionSupportAuthorityBundleCache(cacheKey);
  if (cached) return cached;

  const existingInflight = decisionSupportAuthorityBundleInflight.get(cacheKey);
  if (existingInflight) {
    recordScanSidecarCacheStatus("decision_support", "hit");
    return existingInflight;
  }

  const promise = buildDecisionSupportAuthorityBundleUncached(normalizedBarcode, options)
    .then((bundle) => {
      writeDecisionSupportAuthorityBundleCache(cacheKey, bundle);
      return bundle;
    })
    .finally(() => {
      decisionSupportAuthorityBundleInflight.delete(cacheKey);
    });
  decisionSupportAuthorityBundleInflight.set(cacheKey, promise);
  return promise;
};

type UserDecisionSupportProfileRow = DecisionSupportProfileRow;

type ProductAllergenFlagsLookupRow = {
  source: string;
  source_id: string;
  canonical_source_id: string | null;
  allergy_flags: string[] | null;
  ingredient_restrictions: string[] | null;
  coverage_status: "resolved" | "partial" | "insufficient" | null;
  match_evidence: Record<string, unknown> | null;
  updated_at: string;
};

type LocalDecisionSupportProfilePayload = {
  ageRange?: string;
  sex?: string;
  supplementExperience?: string;
  diets?: string[];
  activity?: string;
  preferredTypes?: string[];
  adherenceBlocker?: string;
  location?: {
    country?: string;
    city?: string;
  };
  goals?: string[];
  allergyFlags?: string[];
  ingredientRestrictions?: string[];
};

type LocalDecisionSupportSavedSupplementPayload = {
  supplementId?: string | null;
  barcode?: string | null;
  productName: string;
  brandName?: string | null;
  dosageText?: string | null;
};

type LocalDecisionSupportContext = {
  profile: LocalDecisionSupportProfilePayload | null;
  savedSupplements: LocalDecisionSupportSavedSupplementPayload[];
};

const localDecisionSupportProfileSchema = z.object({
  ageRange: z.string().trim().max(64).optional(),
  sex: z.string().trim().max(32).optional(),
  supplementExperience: z.string().trim().max(64).optional(),
  diets: z.array(z.string().trim().max(64)).max(12).optional(),
  activity: z.string().trim().max(64).optional(),
  preferredTypes: z.array(z.string().trim().max(64)).max(12).optional(),
  adherenceBlocker: z.string().trim().max(96).optional(),
  location: z.object({
    country: z.string().trim().max(64).optional(),
    city: z.string().trim().max(64).optional(),
  }).optional(),
  goals: z.array(z.string().trim().max(64)).max(12).optional(),
  allergyFlags: z.array(z.string().trim().max(64)).max(24).optional(),
  ingredientRestrictions: z.array(z.string().trim().max(64)).max(24).optional(),
}).strict();

const localDecisionSupportSavedSupplementSchema = z.object({
  supplementId: z.string().trim().max(128).nullable().optional(),
  barcode: z.string().trim().max(32).nullable().optional(),
  productName: z.string().trim().min(1).max(160),
  brandName: z.string().trim().max(96).nullable().optional(),
  dosageText: z.string().trim().max(200).nullable().optional(),
}).strict();

const localDecisionSupportContextSchema = z.object({
  profile: localDecisionSupportProfileSchema.nullable().optional(),
  savedSupplements: z.array(localDecisionSupportSavedSupplementSchema).max(12).default([]),
}).strict();

const LOCAL_DECISION_SUPPORT_HEADER_PREFIXES = ["uri:", "local_v1:"] as const;

const sanitizeLocalDecisionSupportStrings = (values: string[] | undefined): string[] =>
  (Array.isArray(values) ? values : [])
    .map((value) => safeTrim(value))
    .filter((value): value is string => Boolean(value));

const parseLocalDecisionSupportHeaderJson = (value: string): unknown => JSON.parse(value);

const decodeLocalDecisionSupportHeader = (value: string): unknown => {
  try {
    return parseLocalDecisionSupportHeaderJson(value);
  } catch (rawError) {
    const decodeCandidates: string[] = [];

    const matchedPrefix = LOCAL_DECISION_SUPPORT_HEADER_PREFIXES.find((prefix) => value.startsWith(prefix));

    if (matchedPrefix) {
      decodeCandidates.push(value.slice(matchedPrefix.length));
    }

    if (/%[0-9A-Fa-f]{2}/.test(value)) {
      decodeCandidates.push(value);
    }

    for (const candidate of decodeCandidates) {
      try {
        return parseLocalDecisionSupportHeaderJson(decodeURIComponent(candidate));
      } catch {
        // Try the next decode candidate below.
      }
    }

    throw rawError;
  }
};

const parseLocalDecisionSupportContext = (req: Request): LocalDecisionSupportContext | null => {
  const rawHeader = req.headers["x-local-personalization"];
  const rawValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const normalized = safeTrim(rawValue);
  if (!normalized) return null;

  try {
    const parsed = decodeLocalDecisionSupportHeader(normalized);
    const result = localDecisionSupportContextSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        "[decision-support] invalid local personalization header",
        result.error.issues[0]?.message ?? "unknown_error",
      );
      return null;
    }
    return {
      profile: result.data.profile ?? null,
      savedSupplements: result.data.savedSupplements ?? [],
    };
  } catch (error) {
    console.warn(
      "[decision-support] failed to parse local personalization header",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
};

const buildUserDecisionSupportProfileRowFromLocalProfile = (
  profile: LocalDecisionSupportProfilePayload | null | undefined,
): UserDecisionSupportProfileRow | null => {
  if (!profile) return null;

  const dietaryPreferences = sanitizeLocalDecisionSupportStrings(profile.diets);
  const preferredTypes = sanitizeLocalDecisionSupportStrings(profile.preferredTypes);
  const healthGoals = sanitizeLocalDecisionSupportStrings(profile.goals);
  const allergyFlags = sanitizeLocalDecisionSupportStrings(profile.allergyFlags);
  const ingredientRestrictions = sanitizeLocalDecisionSupportStrings(profile.ingredientRestrictions);
  const locationCountry = safeTrim(profile.location?.country);
  const locationCity = safeTrim(profile.location?.city);
  const location = [locationCity, locationCountry].filter(Boolean).join(", ") || null;

  const hasMeaningfulValue =
    Boolean(safeTrim(profile.ageRange))
    || Boolean(safeTrim(profile.sex))
    || Boolean(safeTrim(profile.supplementExperience))
    || Boolean(safeTrim(profile.activity))
    || Boolean(safeTrim(profile.adherenceBlocker))
    || Boolean(locationCountry)
    || Boolean(locationCity)
    || dietaryPreferences.length > 0
    || preferredTypes.length > 0
    || healthGoals.length > 0
    || allergyFlags.length > 0
    || ingredientRestrictions.length > 0;

  if (!hasMeaningfulValue) return null;

  return {
    age: null,
    age_range: safeTrim(profile.ageRange),
    gender: null,
    sex: safeTrim(profile.sex),
    dietary_preference: dietaryPreferences[0] ?? null,
    dietary_preferences: dietaryPreferences,
    activity_level: safeTrim(profile.activity),
    supplement_experience: safeTrim(profile.supplementExperience),
    preferred_types: preferredTypes,
    adherence_blocker: safeTrim(profile.adherenceBlocker),
    location,
    location_country: locationCountry,
    location_city: locationCity,
    health_goals: healthGoals,
    allergy_flags: allergyFlags,
    ingredient_restrictions: ingredientRestrictions,
  };
};

const coverageStatusRank = (value: ProductAllergenFlagsLookupRow["coverage_status"]): number => {
  switch (value) {
    case "resolved":
      return 3;
    case "partial":
      return 2;
    case "insufficient":
      return 1;
    default:
      return 0;
  }
};

const compareProductAllergenRows = (
  left: ProductAllergenFlagsLookupRow,
  right: ProductAllergenFlagsLookupRow,
): number => {
  const coverageDelta = coverageStatusRank(right.coverage_status) - coverageStatusRank(left.coverage_status);
  if (coverageDelta !== 0) return coverageDelta;
  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
};

const fetchUserDecisionSupportProfile = async (
  userId: string | null | undefined,
): Promise<UserDecisionSupportProfileRow | null> => {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return null;

  const { data, error } = await supabase
    .from("user_profiles")
    .select(
      "age, age_range, gender, sex, dietary_preference, dietary_preferences, activity_level, supplement_experience, preferred_types, adherence_blocker, location, location_country, location_city, health_goals, allergy_flags, ingredient_restrictions",
    )
    .eq("user_id", normalizedUserId)
    .maybeSingle();

  if (error) {
    console.warn("[decision-support] user profile query failed", error.message);
    return null;
  }

  return (data ?? null) as UserDecisionSupportProfileRow | null;
};

const fetchProductAllergenFlagsForDecisionSupport = async (
  digest: FactsDigest,
  barcodeGtin14: string,
): Promise<ProductAllergenFlagsLookupRow | null> => {
  const candidates: ProductAllergenFlagsLookupRow[] = [];

  const digestIdentityType = String(digest.identity?.type ?? "").trim();
  const digestIdentityValue = String(digest.identity?.value ?? "").trim();

  if (digest.sourceType === "dsld" && digestIdentityType === "dsldLabelId" && digestIdentityValue) {
    const { data, error } = await supabase
      .from("product_allergen_flags")
      .select(
        "source, source_id, canonical_source_id, allergy_flags, ingredient_restrictions, coverage_status, match_evidence, updated_at",
      )
      .eq("source", "dsld")
      .eq("source_id", digestIdentityValue)
      .maybeSingle();

    if (error) {
      console.warn("[decision-support] dsld allergy flags query failed", error.message);
    } else if (data) {
      candidates.push(data as ProductAllergenFlagsLookupRow);
    }
  }

  if (digest.sourceType === "lnhpd" && digestIdentityType === "npn" && digestIdentityValue) {
    const { data, error } = await supabase
      .from("product_allergen_flags")
      .select(
        "source, source_id, canonical_source_id, allergy_flags, ingredient_restrictions, coverage_status, match_evidence, updated_at",
      )
      .eq("source", "lnhpd")
      .eq("canonical_source_id", digestIdentityValue)
      .maybeSingle();

    if (error) {
      console.warn("[decision-support] lnhpd allergy flags query failed", error.message);
    } else if (data) {
      candidates.push(data as ProductAllergenFlagsLookupRow);
    }
  }

  if (barcodeGtin14) {
    const { data, error } = await supabase
      .from("product_allergen_flags")
      .select(
        "source, source_id, canonical_source_id, allergy_flags, ingredient_restrictions, coverage_status, match_evidence, updated_at",
      )
      .in("source", ["iherb_overlay", "ocr"])
      .eq("canonical_source_id", barcodeGtin14);

    if (error) {
      console.warn("[decision-support] barcode allergy flags query failed", error.message);
    } else if (Array.isArray(data)) {
      candidates.push(...(data as ProductAllergenFlagsLookupRow[]));
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort(compareProductAllergenRows);
  return candidates[0] ?? null;
};

const buildDecisionSupportAllergyContext = (params: {
  userProfile: UserDecisionSupportProfileRow | null;
  productFlags: ProductAllergenFlagsLookupRow | null;
}): DecisionSupportAttachedAllergyContext | null => {
  if (!params.userProfile && !params.productFlags) return null;

  return {
    userAllergyFlags: params.userProfile?.allergy_flags ?? [],
    userIngredientRestrictions: params.userProfile?.ingredient_restrictions ?? [],
    productAllergyFlags: params.productFlags?.allergy_flags ?? null,
    productIngredientRestrictions: params.productFlags?.ingredient_restrictions ?? null,
    productCoverageStatus: params.productFlags?.coverage_status ?? null,
    productMatchEvidence: params.productFlags?.match_evidence ?? null,
  };
};

app.get("/api/decision-support/v1", verifySupabaseToken, async (req: Request, res: Response) => {
  const barcodeRaw = typeof req.query.barcode === "string" ? req.query.barcode.trim() : "";
  const normalizedBarcode = normalizeBarcodeInput(barcodeRaw);
  if (!normalizedBarcode) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "barcode is required" } satisfies ErrorResponse);
  }

  const requestedDigestRaw = typeof req.query.digest === "string" ? req.query.digest.trim() : "";
  const requestedDigest = requestedDigestRaw.length > 0 ? requestedDigestRaw : null;
  const requestedDecisionInputsHashRaw =
    typeof req.query.decisionInputsHash === "string" ? req.query.decisionInputsHash.trim() : "";
  const requestedDecisionInputsHash =
    requestedDecisionInputsHashRaw.length > 0 ? requestedDecisionInputsHashRaw : null;
  const scanSessionIdRaw = typeof req.query.scanSessionId === "string" ? req.query.scanSessionId.trim() : "";
  const scanSessionId = scanSessionIdRaw.length > 0 ? scanSessionIdRaw : null;
  const viewMode = parseDecisionSupportViewMode(
    typeof req.query.viewMode === "string" ? req.query.viewMode : null,
  );
  const debugPatchRequested = (() => {
    const raw = req.query.debugPatch;
    if (Array.isArray(raw)) return raw.some((value) => String(value).trim() === "1");
    return String(raw ?? "").trim() === "1";
  })();
  const debugDecisionRequested = parseDebugDecisionRequested(req);

  try {
    const authedReq = req as AuthenticatedRequest;
    const barcodeGtin14 = normalizedBarcode.code.padStart(14, "0");
    const fetchCount = decisionSupportFetchCounter.record(scanSessionId, barcodeGtin14);
    const authority = await buildDecisionSupportAuthorityBundle(normalizedBarcode, { req, viewMode });
    const { overlayClaims, quickDigest, patched, decisionSupport, personalizationScopeHash } = authority;
    const debugIdentityValue = String(quickDigest.digest?.identity?.value ?? "").trim();
    const debugIdentityType = String(quickDigest.digest?.identity?.type ?? "").trim().toLowerCase();
    const debugSourceType = String(quickDigest.digest?.sourceType ?? "").trim().toLowerCase();
    const debugIdentityKeys = [
      debugSourceType && debugIdentityValue ? `${debugSourceType}:${debugIdentityValue}`.toLowerCase() : null,
      debugIdentityType && debugIdentityValue ? `${debugIdentityType}:${debugIdentityValue}`.toLowerCase() : null,
    ].filter((value): value is string => Boolean(value));
    const debugLookup = getPatchShadowLookup({
      barcodeGtin14,
      identityKeys: debugIdentityKeys,
    });

    if (
      requestedDecisionInputsHash &&
      requestedDecisionInputsHash !== decisionSupport.decisionInputsHash
    ) {
      incrementMetric("decision_inputs_hash_mismatch");
      console.warn("[telemetry] decision_inputs_hash_mismatch", {
        barcode: barcodeGtin14,
        scanSessionId,
        requestedDecisionInputsHash,
        latestDecisionInputsHash: decisionSupport.decisionInputsHash,
        latestDigest: decisionSupport.digest,
      });
    }

    if (requestedDigest && requestedDigest !== decisionSupport.digest) {
      incrementMetric("decision_support_digest_mismatch");
      console.warn("[telemetry] decision_support_digest_mismatch", {
        barcode: barcodeGtin14,
        scanSessionId,
        requestedDigest,
        latestDigest: decisionSupport.digest,
        requestedDecisionInputsHash,
        latestDecisionInputsHash: decisionSupport.decisionInputsHash,
      });
      const mismatchPayload = {
        error: "DECISION_SUPPORT_DIGEST_MISMATCH",
        reasonCode: "DECISION_SUPPORT_DIGEST_MISMATCH",
        message: "Decision support content has updated. Refresh with latest digest.",
        latestDigest: decisionSupport.digest,
        latestDecisionInputsHash: decisionSupport.decisionInputsHash,
        latestPersonalizationScopeHash: personalizationScopeHash,
      };
      return res.status(409).json(mismatchPayload);
    }

    const comparisonStanding = await buildDecisionSupportComparisonStanding({
      barcodeGtin14,
      overlayClaims,
      digest: patched.digest,
      decisionSupport,
    });
    const decisionSupportWithComparison = comparisonStanding
      ? {
        ...decisionSupport,
        personalizedResultLane: {
          ...decisionSupport.personalizedResultLane,
          productStanding: comparisonStanding,
        },
      }
      : decisionSupport;

    const allowPatchDebug = authDisabled || authedReq.regressionAuth === true;
    const allowDecisionDebug = allowPatchDebug && debugDecisionRequested;
    return res.json({
      status: "ok",
      barcode: barcodeGtin14,
      sourceType: patched.digest.sourceType,
      factsDigestHash: quickDigest.factsDigestHash,
      digest: decisionSupportWithComparison.digest,
      decisionSupportDigest: decisionSupportWithComparison.digest,
      decisionInputsHash: decisionSupportWithComparison.decisionInputsHash,
      personalizationScopeHash,
      decisionContractVersion: decisionSupportWithComparison.decisionContractVersion,
      overlayClaimsHash: decisionSupportWithComparison.overlayClaimsHash,
      overlayAugmentationVersion: decisionSupportWithComparison.overlayAugmentationVersion,
      overlayAugmentationSource: decisionSupportWithComparison.overlayAugmentationSource,
      patchActivationCanonical: decisionSupportWithComparison.patchActivationCanonical,
      rubricVersion: decisionSupportWithComparison.rubricVersion,
      categoryId: decisionSupportWithComparison.categoryId,
      categoryProfileVersion: decisionSupportWithComparison.categoryProfileVersion,
      viewMode: decisionSupportWithComparison.viewMode,
      verdict: decisionSupportWithComparison.verdict,
      verdictReason: decisionSupportWithComparison.verdictReason,
      subscores: decisionSupportWithComparison.subscores,
      checklist: decisionSupportWithComparison.checklist,
      blockers: decisionSupportWithComparison.blockers,
      topBlockers: decisionSupportWithComparison.topBlockers,
      extraTrustSignals: decisionSupportWithComparison.extraTrustSignals,
      sourceTiers: decisionSupportWithComparison.sourceTiers,
      nutriScoreCardV2: decisionSupportWithComparison.nutriScoreCardV2,
      overviewBlock: decisionSupportWithComparison.overviewBlock,
      scienceBlock: decisionSupportWithComparison.scienceBlock,
      usageBlock: decisionSupportWithComparison.usageBlock,
      safetyBlock: decisionSupportWithComparison.safetyBlock,
      personalizedResultLane: decisionSupportWithComparison.personalizedResultLane,
      qualityMark: decisionSupportWithComparison.qualityMark,
      ...(typeof fetchCount === "number" ? { decisionSupportFetchCount: fetchCount } : {}),
      ...(allowDecisionDebug && decisionSupportWithComparison.decisionDebug
        ? {
          decisionDebug: decisionSupportWithComparison.decisionDebug,
        }
        : {}),
      ...(debugPatchRequested && allowPatchDebug
        ? {
          patchDebug: {
            ...patched.activation,
            digestIdentityKeys: debugIdentityKeys,
            lookup: debugLookup,
          },
        }
        : {}),
    });
  } catch (error) {
    captureException(error, { route: "/api/decision-support/v1" });
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

app.post("/api/ingredient-overview/v1", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(ingredientOverviewBodySchema, req, res);
  if (!parsedBody) return;

  const normalizedBarcode = normalizeBarcodeInput(parsedBody.barcode);
  if (!normalizedBarcode) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "barcode is required" } satisfies ErrorResponse);
  }

  try {
    if (
      parsedBody.revalidateFallback === true
      && parsedBody.decisionDigest
      && parsedBody.decisionInputsHash
      && parsedBody.personalizationScopeHash
    ) {
      const fastCacheKey = buildIngredientOverviewSidecarCacheKey({
        barcode: normalizedBarcode.code,
        decisionDigest: parsedBody.decisionDigest,
        decisionInputsHash: parsedBody.decisionInputsHash,
        personalizationScopeHash: parsedBody.personalizationScopeHash,
      });
      const fastCached = readIngredientOverviewSidecarCache(fastCacheKey);
      if (fastCached) {
        return res.json(fastCached);
      }
    }

    const authority = await buildDecisionSupportAuthorityBundle(normalizedBarcode, { req });
    if (
      parsedBody.decisionDigest &&
      parsedBody.decisionDigest !== authority.decisionSupport.digest
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }
    if (
      parsedBody.decisionInputsHash &&
      parsedBody.decisionInputsHash !== authority.decisionSupport.decisionInputsHash
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }
    if (
      parsedBody.personalizationScopeHash &&
      parsedBody.personalizationScopeHash !== authority.personalizationScopeHash
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }

    const cacheKey = buildIngredientOverviewSidecarCacheKey({
      barcode: normalizedBarcode.code,
      decisionDigest: authority.decisionSupport.digest,
      decisionInputsHash: authority.decisionSupport.decisionInputsHash,
      personalizationScopeHash: authority.personalizationScopeHash,
    });
    const cached = readIngredientOverviewSidecarCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim() || null;
    const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
    const executionProfile = resolveIngredientOverviewExecutionProfile(authority.ingredientScienceContext);
    const shouldUseLiveWriter =
      parsedBody.revalidateFallback !== true &&
      authority.ingredientScienceContext.productArchetype !== "functional_food_like" &&
      authority.ingredientScienceContext.ingredientFamily !== "green_tea_extract";
    const llmFn = shouldUseLiveWriter
      ? buildDeepseekJsonLlmFn({
        deepseekKey,
        deepseekModel,
        timeoutMs: executionProfile.timeoutMs,
        maxTokens: executionProfile.maxTokens,
      })
      : undefined;
    const compiled = await compileIngredientOverviewAsync(authority.ingredientScienceContext, {
      llmFn,
      timeoutMs: executionProfile.timeoutMs,
      maxRetries: executionProfile.maxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
    });

    const payload: IngredientOverviewSidecarResponse = {
      status: "ok",
      digest: authority.decisionSupport.digest,
      ingredientOverview: compiled.ingredientOverview,
      source: compiled.source,
      fallbackUsed: compiled.fallbackUsed,
      promptVersion: compiled.promptVersion,
    };
    writeIngredientOverviewSidecarCache(
      cacheKey,
      payload,
    );

    return res.json(payload);
  } catch (error) {
    captureException(error, { route: "/api/ingredient-overview/v1" });
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

app.post("/api/scientific-background/v1", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(scientificBackgroundBodySchema, req, res);
  if (!parsedBody) return;

  const normalizedBarcode = normalizeBarcodeInput(parsedBody.barcode);
  if (!normalizedBarcode) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "barcode is required" } satisfies ErrorResponse);
  }

  try {
    const fastSelectedIngredientKey = normalizeIngredientScienceKey(parsedBody.selectedIngredientName);
    const fastCached =
      parsedBody.revalidateFallback === true
      && parsedBody.decisionDigest
      && parsedBody.decisionInputsHash
      && parsedBody.personalizationScopeHash
      && fastSelectedIngredientKey
        ? findScientificBackgroundSidecarCacheByRequest({
          barcode: normalizedBarcode.code,
          decisionDigest: parsedBody.decisionDigest,
          decisionInputsHash: parsedBody.decisionInputsHash,
          personalizationScopeHash: parsedBody.personalizationScopeHash,
          selectedIngredientKey: fastSelectedIngredientKey,
        })
        : null;
    if (fastCached) {
      return res.json(
        withScientificBackgroundRefreshHint(
          fastCached.payload,
          scientificBackgroundSidecarBackgroundRefresh.has(fastCached.cacheKey),
        ),
      );
    }

    const authority = await buildDecisionSupportAuthorityBundle(normalizedBarcode, { req });
    if (
      parsedBody.decisionDigest &&
      parsedBody.decisionDigest !== authority.decisionSupport.digest
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }
    if (
      parsedBody.decisionInputsHash &&
      parsedBody.decisionInputsHash !== authority.decisionSupport.decisionInputsHash
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }
    if (
      parsedBody.personalizationScopeHash &&
      parsedBody.personalizationScopeHash !== authority.personalizationScopeHash
    ) {
      return res.status(409).json(
        buildDecisionSupportDigestMismatchPayload(
          authority.decisionSupport.digest,
          authority.decisionSupport.decisionInputsHash,
          authority.personalizationScopeHash,
        ),
      );
    }

    const selectedIngredientKey = normalizeIngredientScienceKey(parsedBody.selectedIngredientName);
    const selectedDescriptor = authority.ingredientScienceContext.ingredientDescriptors.find(
      (descriptor) => descriptor.key === selectedIngredientKey,
    );

    if (!selectedDescriptor) {
      return res.status(400).json({
        error: "invalid_request",
        detail: "selectedIngredientName must match a source-locked ingredient",
      } satisfies ErrorResponse);
    }

    const plan = planScientificBackgroundSections({
      context: authority.ingredientScienceContext,
      selectedIngredientName: selectedDescriptor.name,
    });
    const executionProfile = resolveScientificBackgroundExecutionProfile(plan);
    const cacheKey = buildScientificBackgroundSidecarCacheKey({
      barcode: normalizedBarcode.code,
      decisionDigest: authority.decisionSupport.digest,
      decisionInputsHash: authority.decisionSupport.decisionInputsHash,
      personalizationScopeHash: authority.personalizationScopeHash,
      selectedIngredientKey: selectedDescriptor.key,
      promptVersion: `${plan.mode}:${SCIENTIFIC_BACKGROUND_PROMPT_VERSION}`,
    });
    const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim() || null;
    const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
    const ensureScientificBackgroundBackgroundRefresh = (): boolean => {
      if (!executionProfile.preferLiveWriter || !deepseekKey) return false;
      if (scientificBackgroundSidecarBackgroundRefresh.has(cacheKey)) return true;
      if (isScientificBackgroundBackgroundRefreshCoolingDown(cacheKey)) return false;

      const backgroundRefresh = runWithScientificBackgroundRefreshSlot(async (): Promise<void> => {
        const backgroundLlmFn = buildDeepseekJsonLlmFn({
          deepseekKey,
          deepseekModel,
          timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
          maxTokens: executionProfile.maxTokens,
        });
        if (!backgroundLlmFn) return;

        const refreshed = await compileScientificBackgroundAsync(
          authority.ingredientScienceContext,
          selectedDescriptor.name,
          {
            llmFn: backgroundLlmFn,
            timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
            maxRetries: executionProfile.backgroundRefreshMaxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
          },
        );

        const refreshedPayload: ScientificBackgroundSidecarResponse = {
          status: "ok",
          digest: authority.decisionSupport.digest,
          scientificBackground: refreshed.scientificBackground,
          source: refreshed.source,
          fallbackUsed: refreshed.fallbackUsed,
          promptVersion: refreshed.promptVersion,
          backgroundRefreshPending: false,
          recommendedRetryAfterMs: null,
        };

        if (refreshed.source !== "api") {
          const refreshFailureRetryLimit =
            plan.family === "magnesium"
              || plan.family === "zinc"
              || plan.family === "carnitine"
              || plan.family === "green_tea_extract"
              ? 3
              : SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT;
          if (shouldCoolDownScientificBackgroundBackgroundRefresh(
            cacheKey,
            refreshFailureRetryLimit,
          )) {
            markScientificBackgroundBackgroundRefreshCooldown(cacheKey);
          }
          writeScientificBackgroundSidecarCache(
            cacheKey,
            refreshedPayload,
            resolveScientificBackgroundCacheTtlMs(refreshedPayload, executionProfile),
          );
          return;
        }

        scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
        scientificBackgroundSidecarBackgroundRefreshFailureCount.delete(cacheKey);
        writeScientificBackgroundSidecarCache(
          cacheKey,
          refreshedPayload,
          resolveScientificBackgroundCacheTtlMs(refreshedPayload, executionProfile),
        );
      })
        .catch((error) => {
          captureException(error, {
            route: "/api/scientific-background/v1",
            phase: "background_refresh",
            cacheKey,
          });
        })
        .finally(() => {
          scientificBackgroundSidecarBackgroundRefresh.delete(cacheKey);
        });

      scientificBackgroundSidecarBackgroundRefresh.set(cacheKey, backgroundRefresh);
      return true;
    };
    const buildScientificBackgroundFastFallbackResponse = async (): Promise<ScientificBackgroundSidecarResponse> => {
      const compiled = await compileScientificBackgroundAsync(
        authority.ingredientScienceContext,
        selectedDescriptor.name,
        {
          llmFn: undefined,
          timeoutMs: executionProfile.timeoutMs,
          maxRetries: 0,
        },
      );

      const payload: ScientificBackgroundSidecarResponse = {
        status: "ok",
        digest: authority.decisionSupport.digest,
        scientificBackground: compiled.scientificBackground,
        source: "fallback",
        fallbackUsed: true,
        promptVersion: compiled.promptVersion,
        backgroundRefreshPending: false,
        recommendedRetryAfterMs: null,
      };

      writeScientificBackgroundSidecarCache(
        cacheKey,
        payload,
        resolveScientificBackgroundCacheTtlMs(payload, executionProfile),
      );

      return withScientificBackgroundRefreshHint(payload, ensureScientificBackgroundBackgroundRefresh());
    };
    const cached = readScientificBackgroundSidecarCache(cacheKey);
    const shouldBypassFallbackCache =
      parsedBody.revalidateFallback === true && cached?.source === "fallback";
    if (cached && !shouldBypassFallbackCache) {
      return res.json(cached);
    }
    if (shouldBypassFallbackCache) {
      const refreshedCached = readScientificBackgroundSidecarCache(cacheKey);
      if (refreshedCached && refreshedCached.source === "api") {
        return res.json(refreshedCached);
      }
      if (cached) {
        const backgroundRefreshPending = ensureScientificBackgroundBackgroundRefresh();
        return res.json(withScientificBackgroundRefreshHint(cached, backgroundRefreshPending));
      }
    }

    const existingInflight = scientificBackgroundSidecarInflight.get(cacheKey);
    if (existingInflight) {
      if (parsedBody.revalidateFallback === true) {
        return res.json(await buildScientificBackgroundFastFallbackResponse());
      }
      return res.json(await existingInflight);
    }
    if (parsedBody.revalidateFallback === true) {
      return res.json(await buildScientificBackgroundFastFallbackResponse());
    }
    const llmFn = executionProfile.preferLiveWriter
      ? buildDeepseekJsonLlmFn({
        deepseekKey,
        deepseekModel,
        timeoutMs: executionProfile.timeoutMs,
        maxTokens: executionProfile.maxTokens,
      })
      : undefined;

    const compilePromise = (async (): Promise<ScientificBackgroundSidecarResponse> => {
      const compiled = await compileScientificBackgroundAsync(
        authority.ingredientScienceContext,
        selectedDescriptor.name,
        {
          llmFn,
          timeoutMs: executionProfile.timeoutMs,
          maxRetries: executionProfile.maxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
        },
      );

      const payload: ScientificBackgroundSidecarResponse = {
        status: "ok",
        digest: authority.decisionSupport.digest,
        scientificBackground: compiled.scientificBackground,
        source: compiled.source,
        fallbackUsed: compiled.fallbackUsed,
        promptVersion: compiled.promptVersion,
        backgroundRefreshPending: false,
        recommendedRetryAfterMs: null,
      };

      writeScientificBackgroundSidecarCache(
        cacheKey,
        payload,
        resolveScientificBackgroundCacheTtlMs(payload, executionProfile),
      );

      if (payload.source === "fallback") {
        ensureScientificBackgroundBackgroundRefresh();
      }

      return withScientificBackgroundRefreshHint(
        payload,
        Boolean(payload.source === "fallback" && scientificBackgroundSidecarBackgroundRefresh.has(cacheKey)),
      );
    })();

    scientificBackgroundSidecarInflight.set(cacheKey, compilePromise);
    try {
      return res.json(await compilePromise);
    } finally {
      scientificBackgroundSidecarInflight.delete(cacheKey);
    }
  } catch (error) {
    captureException(error, { route: "/api/scientific-background/v1" });
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

app.get("/api/patch-shadow/status", verifySupabaseToken, (req: Request, res: Response) => {
  const authedReq = req as AuthenticatedRequest;
  if (!authDisabled && authedReq.regressionAuth !== true) {
    return res.status(403).json({
      error: "forbidden",
      detail: "patch-shadow status is internal maintainer-only",
    } satisfies ErrorResponse);
  }
  const patchStatus = getPatchShadowStatus();
  const barcodeRaw = typeof req.query.barcode === "string" ? req.query.barcode : null;
  const identityKeysRaw = typeof req.query.identityKey === "string"
    ? [req.query.identityKey]
    : Array.isArray(req.query.identityKey)
      ? req.query.identityKey.filter((value): value is string => typeof value === "string")
      : [];
  const lookup = getPatchShadowLookup({
    barcodeGtin14: barcodeRaw,
    identityKeys: identityKeysRaw,
  });
  return res.json({
    status: "ok",
    ...patchStatus,
    lookup,
  });
});

const productOverviewAiBodySchema = z.object({
  digest: z.string().min(1),
  productName: z.string().min(1),
  brandName: z.string().nullable().optional(),
  productTypeHint: z.string().nullable().optional(),
  primaryIngredient: z.string().nullable().optional(),
  keyIngredients: z.array(
    z.object({
      name: z.string().min(1),
      dose: z.string().nullable().optional(),
    }),
  ).max(6),
  sourceContextHint: z.string().nullable().optional(),
  chemicalFormHint: z.string().nullable().optional(),
  allIngredientRows: z.array(
    z.object({
      name: z.string().min(1),
      dose: z.string().nullable().optional(),
    }),
  ).max(12).optional(),
  descriptionHighlights: z.array(z.string().min(1)).max(4).optional(),
  warningHighlights: z.array(z.string().min(1)).max(4).optional(),
  strengthClaim: z.string().nullable().optional(),
  servingStrength: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  count: z.string().nullable().optional(),
  isLikelySingleIngredient: z.boolean().optional(),
});

type ProductOverviewAiSidecarResponse = {
  status: "ok";
  digest: string;
  source: "api" | "fallback";
  promptVersion: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  overviewAi:
    | ReturnType<typeof buildProductOverviewWhatIsItFallback>
    | NonNullable<Awaited<ReturnType<typeof fetchProductOverviewWhatIsIt>>>;
};

const PRODUCT_OVERVIEW_AI_RESULT_CACHE_LIMIT = 120;
const productOverviewAiSidecarCache = new Map<string, {
  expiresAt: number;
  payload: ProductOverviewAiSidecarResponse;
}>();

const buildProductOverviewAiSidecarCacheKey = (params: {
  decisionDigest: string;
  promptPayload: unknown;
}): string =>
  buildScanSidecarCacheKey({
    route: "product_overview_ai",
    decisionDigest: params.decisionDigest,
    decisionInputsHash: createHash("sha256")
      .update(stableStringifyScopeValue(params.promptPayload))
      .digest("hex"),
    personalizationScopeHash: "none",
    promptVersion: PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION,
  });

const readProductOverviewAiSidecarCache = (
  cacheKey: string,
): ProductOverviewAiSidecarResponse | null => {
  const entry = productOverviewAiSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("product_overview_ai", "miss");
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    productOverviewAiSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("product_overview_ai", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("product_overview_ai", "hit");
  return entry.payload;
};

const writeProductOverviewAiSidecarCache = (
  cacheKey: string,
  payload: ProductOverviewAiSidecarResponse,
): void => {
  productOverviewAiSidecarCache.set(cacheKey, {
    expiresAt: Date.now() + getScanSidecarPolicy("product_overview_ai").defaultTtlMs,
    payload,
  });
  recordScanSidecarCacheStatus("product_overview_ai", "write");
  if (productOverviewAiSidecarCache.size <= PRODUCT_OVERVIEW_AI_RESULT_CACHE_LIMIT) return;
  const oldestKey = productOverviewAiSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    productOverviewAiSidecarCache.delete(oldestKey);
  }
};

const normalizeOverviewAiToken = (value?: string | null): string =>
  safeTrim(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";

const hasOverviewAiForbiddenContent = (value: string): boolean => {
  const normalized = normalizeOverviewAiToken(value);
  if (!normalized) return true;
  return /\b(treat|treats|treating|cure|cures|curing|prevent|prevents|prevention|diagnos|therapy|heal|heals|healing|doctor|clinician|physician|pharmacist|with food|empty stomach|best form|superior bioavailability|high absorption|clinically proven)\b/i.test(
    normalized,
  );
};

const countSentenceLikeClauses = (value: string): number =>
  String(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => safeTrim(part) ?? "")
    .filter(Boolean).length;

const passesProductOverviewWhatIsItGate = (params: {
  lead: string;
  whatItIs: string;
  whyPeopleTakeIt: string;
  primaryIngredient: string | null;
  productTypeHint: string | null;
  keyIngredients: Array<{ name: string; dose?: string | null }>;
  allIngredientRows?: Array<{ name: string; dose?: string | null }>;
  servingStrength: string | null;
  form: string | null;
  count: string | null;
}): boolean => {
  const combined = [params.lead, params.whatItIs, params.whyPeopleTakeIt].join(" ");
  if ((safeTrim(combined) ?? "").length < 90) return false;
  if ([params.lead, params.whatItIs, params.whyPeopleTakeIt].some((part) => hasOverviewAiForbiddenContent(part))) {
    return false;
  }

  const normalizedCombined = normalizeOverviewAiToken(combined);
  const anchorCandidates = [
    params.primaryIngredient,
    params.productTypeHint,
    ...params.keyIngredients.map((item) => item.name),
    ...(params.allIngredientRows ?? []).map((item) => item.name),
  ]
    .map((value) => normalizeOverviewAiToken(value))
    .filter((value) => value.length >= 4);

  if (anchorCandidates.length > 0 && !anchorCandidates.some((anchor) => normalizedCombined.includes(anchor))) {
    return false;
  }

  const forbiddenFactEchoes = [params.servingStrength, params.count, params.form]
    .map((value) => normalizeOverviewAiToken(value))
    .filter((value) => value.length >= 4);
  if (forbiddenFactEchoes.some((fact) => normalizedCombined.includes(fact))) {
    return false;
  }

  if (countSentenceLikeClauses(params.whyPeopleTakeIt) > 2) {
    return false;
  }

  return true;
};

app.post("/api/product-overview-ai/v1", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(productOverviewAiBodySchema, req, res);
  if (!parsedBody) return;

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  const fallbackOverviewAi = buildProductOverviewWhatIsItFallback({
    productName: parsedBody.productName,
    productTypeHint: parsedBody.productTypeHint ?? null,
    primaryIngredient: parsedBody.primaryIngredient ?? null,
    keyIngredients: parsedBody.keyIngredients,
    sourceContextHint: parsedBody.sourceContextHint ?? null,
    chemicalFormHint: parsedBody.chemicalFormHint ?? null,
    allIngredientRows: parsedBody.allIngredientRows ?? [],
    descriptionHighlights: parsedBody.descriptionHighlights ?? [],
    warningHighlights: parsedBody.warningHighlights ?? [],
    isLikelySingleIngredient: parsedBody.isLikelySingleIngredient ?? false,
  });

  const promptPayload = {
    productName: parsedBody.productName,
    brandName: parsedBody.brandName ?? null,
    productTypeHint: parsedBody.productTypeHint ?? null,
    primaryIngredient: parsedBody.primaryIngredient ?? null,
    keyIngredients: parsedBody.keyIngredients.map((item) => ({
      name: item.name,
      dose: item.dose ?? null,
    })),
    sourceContextHint: parsedBody.sourceContextHint ?? null,
    chemicalFormHint: parsedBody.chemicalFormHint ?? null,
    allIngredientRows: (parsedBody.allIngredientRows ?? []).map((item) => ({
      name: item.name,
      dose: item.dose ?? null,
    })),
    descriptionHighlights: parsedBody.descriptionHighlights ?? [],
    warningHighlights: parsedBody.warningHighlights ?? [],
    strengthClaim: parsedBody.strengthClaim ?? null,
    servingStrength: parsedBody.servingStrength ?? null,
    form: parsedBody.form ?? null,
    count: parsedBody.count ?? null,
    isLikelySingleIngredient: parsedBody.isLikelySingleIngredient ?? false,
    writingRules: {
      language: "English only",
      shopperFacing: true,
      doNotRepeatFacts: ["serving strength", "form", "count"],
      noMedicalClaims: true,
      noDoctorAdvice: true,
      noTimingGuidance: true,
      richModeOnlyWhenSimple: true,
    },
  };
  const cacheKey = buildProductOverviewAiSidecarCacheKey({
    decisionDigest: parsedBody.digest,
    promptPayload,
  });
  const cached = readProductOverviewAiSidecarCache(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const respondWithOverviewFallback = (reason: string) => {
    const payload: ProductOverviewAiSidecarResponse = {
      status: "ok",
      digest: parsedBody.digest,
      source: "fallback",
      promptVersion: `${PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION}:fallback`,
      fallbackUsed: true,
      fallbackReason: reason,
      overviewAi: fallbackOverviewAi,
    };
    writeProductOverviewAiSidecarCache(cacheKey, payload);
    return res.json(payload);
  };

  if (!deepseekKey) {
    return respondWithOverviewFallback("ai_not_configured");
  }

  try {
    const ai = await fetchProductOverviewWhatIsIt(
      `PRODUCT_OVERVIEW_INPUT_JSON: ${JSON.stringify(promptPayload)}`,
      deepseekModel,
      deepseekKey,
      {
        timeoutMs: Math.max(MY_SUPP_OVERVIEW_TIMEOUT_MS, 5_500),
        queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS_DETAIL,
        breaker: deepseekBreaker,
        semaphore: deepseekSemaphore,
        maxTokens: 900,
      },
    );

    if (!ai) {
      return respondWithOverviewFallback("empty_or_failed");
    }

    if (
      !passesProductOverviewWhatIsItGate({
        lead: ai.lead,
        whatItIs: ai.whatItIs,
        whyPeopleTakeIt: ai.whyPeopleTakeIt,
        primaryIngredient: parsedBody.primaryIngredient ?? null,
        productTypeHint: parsedBody.productTypeHint ?? null,
        keyIngredients: parsedBody.keyIngredients,
        allIngredientRows: parsedBody.allIngredientRows ?? [],
        servingStrength: parsedBody.servingStrength ?? null,
        form: parsedBody.form ?? null,
        count: parsedBody.count ?? null,
      })
    ) {
      return respondWithOverviewFallback("gate_rejected");
    }

    const payload: ProductOverviewAiSidecarResponse = {
      status: "ok",
      digest: parsedBody.digest,
      source: "api",
      promptVersion: PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION,
      fallbackUsed: false,
      overviewAi: ai,
    };
    writeProductOverviewAiSidecarCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    captureException(error, { route: "/api/product-overview-ai/v1" });
    return respondWithOverviewFallback("unexpected_error");
  }
});

/**
 * Product-specific ingredient narrative compiler
 */
app.post("/api/summary/ingredient", verifySupabaseToken, async (req: Request, res: Response) => {
  applyLegacyShadowHeaders(req, res, "/api/summary/ingredient");
  const packet = parseRequestBody(ingredientSummaryPacketSchema, req, res);
  if (!packet) return;

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const isRegressionRequest = (req as AuthenticatedRequest).regressionAuth === true;

  const llmFn = deepseekKey
    ? async (prompt: string): Promise<string> => {
        const controller = new AbortController();
        const timeoutMs = 9_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${deepseekKey}`,
            },
            body: JSON.stringify({
              model: deepseekModel,
              messages: [
                {
                  role: "system",
                  content:
                    "Return ONLY a valid JSON object. No markdown. No commentary. No code fences.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              stream: false,
              max_tokens: 450,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`deepseek_http_${response.status}`);
          }

          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("deepseek_empty_content");
          }
          return content;
        } finally {
          clearTimeout(timer);
        }
      }
    : undefined;

  const dedupeSummaryBullets = (rows: string[], max = 6): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const text = String(row ?? "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) break;
    }
    return out;
  };

  const ingredientNameForSafe = typeof (packet as { ingredientName?: unknown })?.ingredientName === "string"
    ? String((packet as { ingredientName?: string }).ingredientName)
    : typeof (packet as { ingredient?: { name?: unknown } })?.ingredient?.name === "string"
      ? String((packet as { ingredient?: { name?: string } }).ingredient?.name)
      : null;
  const formTextForSafe = typeof (packet as { facts?: { formText?: unknown } })?.facts?.formText === "string"
    ? String((packet as { facts?: { formText?: string } }).facts?.formText)
    : typeof (packet as { ingredient?: { form?: unknown } })?.ingredient?.form === "string"
      ? String((packet as { ingredient?: { form?: string } }).ingredient?.form)
      : null;
  const safeScience = lookupSafeScienceSignals({
    ingredientName: ingredientNameForSafe,
    formText: formTextForSafe,
  });

  let packetForCompile: unknown = packet;
  if (safeScience && (Object.prototype.hasOwnProperty.call(packet as object, "ingredientName"))) {
    const packetObj = { ...(packet as Record<string, unknown>) };
    const existingSupport = Array.isArray(packetObj.supportBullets)
      ? (packetObj.supportBullets as unknown[]).map((row) => String(row ?? ""))
      : [];
    packetObj.supportBullets = dedupeSummaryBullets([
      ...safeScience.bestForBullets,
      ...existingSupport,
    ], 6);
    packetObj.safeScienceBullets = safeScience.bestForBullets.slice(0, 6);
    packetObj.safeScienceFormImpact = safeScience.formImpactLine;
    packetObj.safeScienceBeforeYouBuy = safeScience.beforeYouBuyLine;
    packetObj.safeScienceSignalSource = safeScience.signalSource;
    packetObj.safeScienceFallbackType = safeScience.fallbackType;
    packetForCompile = packetObj;
  }

  const summary = await compileIngredientSummaryAsync(packetForCompile, {
    llmFn,
    regression: isRegressionRequest,
  });

  return res.json({
    status: "ok",
    ...summary,
    summary,
  });
});

app.post("/api/summary/usage", verifySupabaseToken, async (req: Request, res: Response) => {
  applyLegacyShadowHeaders(req, res, "/api/summary/usage");
  const packet = parseRequestBody(usageSummaryPacketSchema, req, res);
  if (!packet) return;

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  const llmFn = deepseekKey
    ? async (prompt: string): Promise<string> => {
        const controller = new AbortController();
        const timeoutMs = 9_000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${deepseekKey}`,
            },
            body: JSON.stringify({
              model: deepseekModel,
              messages: [
                {
                  role: "system",
                  content:
                    "Return ONLY a valid JSON object. No markdown. No commentary. No code fences.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              stream: false,
              max_tokens: 260,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`deepseek_http_${response.status}`);
          }

          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("deepseek_empty_content");
          }
          return content;
        } finally {
          clearTimeout(timer);
        }
      }
    : undefined;

  const summary = await compileUsageSummaryAsync(packet, { llmFn });
  return res.json({
    status: "ok",
    ...summary,
    summary,
  });
});

app.post("/api/summary/safety", verifySupabaseToken, async (req: Request, res: Response) => {
  applyLegacyShadowHeaders(req, res, "/api/summary/safety");
  const packet = parseRequestBody(safetySummaryPacketSchema, req, res);
  if (!packet) return;

  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const startedAt = Date.now();

  const llmFn = deepseekKey
    ? async (prompt: string): Promise<string> => {
        const controller = new AbortController();
        const timeoutMs = 3_900;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${deepseekKey}`,
            },
            body: JSON.stringify({
              model: deepseekModel,
              messages: [
                {
                  role: "system",
                  content:
                    "Return ONLY a valid JSON object. No markdown. No commentary. No code fences.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              stream: false,
              max_tokens: 260,
              response_format: { type: "json_object" },
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`deepseek_http_${response.status}`);
          }

          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("deepseek_empty_content");
          }
          return content;
        } finally {
          clearTimeout(timer);
        }
      }
    : undefined;

  const summary = await compileSafetySummaryAsync(packet, { llmFn, timeoutMs: 3500, maxRetries: 0 });
  const latencyMs = Date.now() - startedAt;
  console.info(
    "[summary/safety]",
    JSON.stringify({
      latencyMs,
      fallbackUsed: summary.fallbackUsed,
      reasonCode: summary.reasonCode,
      sourceType: packet.sourceType ?? null,
    }),
  );
  return res.json({
    status: "ok",
    latencyMs,
    ...summary,
    summary,
  });
});

const buildFallbackOverviewSection = (digest: FactsDigest): AnalysisBundle["sections"]["overview"] => {
  const summary = buildFallbackOverviewSummary(digest);
  const bullets = buildFallbackOverviewBullets(digest);
  return {
    layout: "overview_card",
    cover: {
      summary,
      bullets,
    },
    detail: {
      summary,
      bullets,
    },
    dataStatus: "limited",
  };
};

const enforceOverviewSectionContract = (
  overviewSection: AnalysisBundle["sections"]["overview"],
  digest: FactsDigest,
): AnalysisBundle["sections"]["overview"] => {
  const fallback = buildFallbackOverviewSection(digest);
  const cover = overviewSection.cover ?? fallback.cover;
  const detail = overviewSection.detail ?? fallback.detail;
  const fallbackSummary = fallback.cover?.summary ?? buildFallbackOverviewSummary(digest);
  const fallbackBullets = fallback.cover?.bullets ?? [];

  const coverSummaryRaw =
    typeof cover?.summary === "string" && cover.summary.trim().length > 0
      ? clampText(cover.summary.trim(), 180)
      : fallbackSummary;
  const coverSummary =
    coverSummaryRaw.length >= 40 && hasOverviewAnchorToken(coverSummaryRaw, digest)
      ? coverSummaryRaw
      : fallbackSummary;

  const detailSummaryRaw =
    typeof detail?.summary === "string" && detail.summary.trim().length > 0
      ? clampText(detail.summary.trim(), 180)
      : coverSummary;
  const detailSummary =
    detailSummaryRaw.length >= 40 && hasOverviewAnchorToken(detailSummaryRaw, digest)
      ? detailSummaryRaw
      : coverSummary;

  const coverBullets = Array.isArray(cover?.bullets) && cover.bullets.length > 0 ? cover.bullets : fallbackBullets;
  const detailBullets = Array.isArray(detail?.bullets) && detail.bullets.length > 0 ? detail.bullets : coverBullets;

  return {
    ...overviewSection,
    cover: {
      ...(cover ?? {}),
      summary: coverSummary,
      bullets: coverBullets,
    },
    detail: {
      ...(detail ?? {}),
      summary: detailSummary,
      bullets: detailBullets,
    },
  };
};

const buildFallbackUsageSection = (digest: FactsDigest): AnalysisBundle["sections"]["usage"] => {
  const labelDosingText = buildLabelDosingText(digest);
  const scheduleFromLabel = digest.labelDosing.map((dose) => ({
    population: dose.population ?? null,
    age: dose.age ?? null,
    dose: dose.dose ?? null,
    frequency: dose.frequency ?? null,
    rawText: dose.rawText ?? null,
    basisTags: ["label_fact"] as BasisTag[],
  }));
  const timingText = scheduleFromLabel.length > 0 ? "Follow label schedule." : "Anytime (with meals).";
  const withFoodText = scheduleFromLabel.length > 0
    ? "Prefer with food unless label states otherwise."
    : "Take with food unless label states otherwise.";
  const bullets: Array<{ text: string; basisTags: BasisTag[] }> = [];
  if (labelDosingText && labelDosingText !== "Follow label directions.") {
    bullets.push(buildSectionBullet(labelDosingText, ["label_fact"]));
  } else if (digest.actives.length > 0) {
    bullets.push(buildSectionBullet(`Contains ${digest.actives[0].name}.`, [resolveSourceBasisTag(digest.sourceType)]));
  }
  return {
    layout: "usage_bullets",
    cover: {
      bullets,
      bestTimeToTake: {
        text: timingText,
        basisTags: ["general_advice"],
      },
      withFood: {
        value: true,
        text: withFoodText,
        basisTags: ["general_advice"],
      },
      dosage: labelDosingText
        ? {
          text: labelDosingText,
          basisTags: ["label_fact"],
        }
        : null,
    },
    detail: {
      timingRationale: null,
      withFoodRationale: null,
      scheduleFromLabel,
    },
    dataStatus: "limited",
  };
};

const buildIdentityFallbackOverviewSection = (
  identity: { type: string; value: string },
): AnalysisBundle["sections"]["overview"] => {
  const identityLabel = identity.value?.trim() || "this product";
  const summary = `Information for ${identityLabel} is still being prepared. Follow product label directions and use this as general guidance.`;
  return {
    layout: "overview_card",
    cover: {
      summary,
      bullets: [
        buildSectionBullet("Details are still syncing from source records.", ["not_provided"]),
        buildSectionBullet("Review the package label for product-specific guidance.", ["general_advice"]),
      ],
    },
    detail: {
      summary,
      bullets: [
        buildSectionBullet("Details are still syncing from source records.", ["not_provided"]),
        buildSectionBullet("Review the package label for product-specific guidance.", ["general_advice"]),
      ],
    },
    dataStatus: "limited",
  };
};

const buildIdentityFallbackUsageSection = (): AnalysisBundle["sections"]["usage"] => ({
  layout: "usage_bullets",
  cover: {
    bullets: [buildSectionBullet("Follow package directions when available.", ["general_advice"])],
    bestTimeToTake: {
      text: "Anytime (with meals).",
      basisTags: ["general_advice"],
    },
    withFood: {
      value: true,
      text: "Prefer with food unless label states otherwise.",
      basisTags: ["general_advice"],
    },
    dosage: {
      text: "Follow label directions.",
      basisTags: ["not_provided"],
    },
  },
  detail: {
    timingRationale: null,
    withFoodRationale: null,
    scheduleFromLabel: [],
  },
  dataStatus: "limited",
});

const enforceUsageSectionContract = (
  usageSection: AnalysisBundle["sections"]["usage"],
  digest: FactsDigest,
): AnalysisBundle["sections"]["usage"] => {
  const fallback = buildFallbackUsageSection(digest);
  const cover = usageSection.cover ?? fallback.cover;
  const fallbackBestTimeToTake = fallback.cover?.bestTimeToTake ?? {
    text: "Anytime (with meals).",
    basisTags: ["general_advice"] as BasisTag[],
  };
  const fallbackWithFood = fallback.cover?.withFood ?? {
    value: true,
    text: "Prefer with food unless label states otherwise.",
    basisTags: ["general_advice"] as BasisTag[],
  };

  const bestTimeText =
    typeof cover?.bestTimeToTake?.text === "string" && cover.bestTimeToTake.text.trim().length > 0
      ? cover.bestTimeToTake.text.trim()
      : fallbackBestTimeToTake.text;
  const bestTimeToTake = {
    ...(cover?.bestTimeToTake ?? fallbackBestTimeToTake),
    text: bestTimeText,
  };

  const withFoodValue =
    typeof cover?.withFood?.value === "boolean" ? cover.withFood.value : fallbackWithFood.value;
  const withFoodText =
    typeof cover?.withFood?.text === "string" && cover.withFood.text.trim().length > 0
      ? cover.withFood.text
      : fallbackWithFood.text;
  const withFood = {
    ...(cover?.withFood ?? fallbackWithFood),
    value: withFoodValue,
    text: withFoodText,
  };

  return {
    ...usageSection,
    cover: {
      ...(cover ?? {}),
      bestTimeToTake,
      withFood,
      dosage: cover?.dosage ?? fallback.cover?.dosage ?? null,
      bullets: Array.isArray(cover?.bullets) ? cover.bullets : fallback.cover?.bullets ?? [],
    },
    detail: usageSection.detail ?? fallback.detail,
  };
};

/**
 * On-demand analysis section endpoint (ingredients detail + overview + usage)
 */
app.post("/api/analysis-section", verifySupabaseToken, async (req: Request, res: Response) => {
  applyLegacyShadowHeaders(req, res, "/api/analysis-section");
  const parsedBody = parseRequestBody(analysisSectionBodySchema, req, res);
  if (!parsedBody) {
    return;
  }

  const isRegressionRequest = (req as AuthenticatedRequest).regressionAuth === true;
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
          sentenceIds[name] = isKbSentence ? sentenceId ?? null : null;
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
        sentenceIds[name] = isKbSentence ? sentenceId ?? null : null;
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
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
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

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
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
    page: buildDetailPage(detailPayload.items.length),
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

app.get("/api/client-runtime-flags", verifySupabaseToken, (_req: Request, res: Response) => {
  res.json({
    scanTerminalLockEnabled: readScanTerminalLockEnabled(),
  });
});

/**
 * Main streaming endpoint: Two-step search + AI analysis
 */
app.post("/api/enrich-stream", verifySupabaseToken, async (req: Request, res: Response) => {
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
      let cachedFast = skipCachedFastForBundleOnlyDeterministic
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
      if (streamAnalysisBundleOnly && !canUseAi && params.digest.sourceType !== "web" && canWrite()) {
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
            fallbackReason: "bundle_only_no_ai_fast_path",
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
                summary: `${getDegradedReasonCopy("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH")} We will keep refining this record.`,
                bullets: [
                  buildSectionBullet(
                    "Limited mode keeps the scan responsive while preserving trusted identity.",
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
                  text: "Bundle-only mode prioritizes fast, stable guidance before deeper expansion.",
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
        const emittedRev1 = emitRev1Once(
          limitedBundle,
          "fallback",
          "bundle_only_no_ai_fast_path",
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
    type Stage0Source = "none" | "snapshot" | "catalog" | "lnhpd" | "dsld";
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

// ============================================================================
// Ensure overview cache for MySupplement
// ============================================================================

app.post("/api/ensure-overview", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(ensureOverviewBodySchema, req, res);
  if (!parsedBody) return;

  const user = (req as AuthenticatedRequest).user;
  const brandName = safeTrim(parsedBody.brandName) ?? DEFAULT_BRAND_NAME;
  const productName = safeTrim(parsedBody.productName);
  const dosageText = safeTrim(parsedBody.dosageText);
  const barcode = safeTrim(parsedBody.barcode);

  if (!productName) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "productName is required" } satisfies ErrorResponse);
  }

  try {
    const { supplementId } = await resolveSupplementIdForOverview({
      supplementId: parsedBody.supplementId ?? null,
      barcode,
      brandName,
      productName,
      dosageText,
    });

    if (!supplementId) {
      return res
        .status(503)
        .json({ error: "supplement_unavailable" } satisfies ErrorResponse);
    }

    if (parsedBody.userSupplementId && user?.id) {
      await supabase
        .from("user_supplements")
        .update({ supplement_id: supplementId })
        .eq("id", parsedBody.userSupplementId)
        .eq("user_id", user.id);
    }

    const digestBundle = await buildMySupplementDigestQuick({
      supplementId,
      barcode: barcode ?? null,
      brandName,
      productName,
      budgetMs: ENSURE_OVERVIEW_FACTS_BUDGET_MS,
    });

    const normalizedBarcode = barcode ? normalizeBarcodeInput(barcode) : null;
    const barcodeDigits = normalizedBarcode?.code ?? null;
    const barcodeGtin14 = barcodeDigits ? barcodeDigits.padStart(14, "0") : null;
    const overlayClaims = barcodeGtin14 ? await fetchIherbOverlayClaimsByBarcode(barcodeGtin14) : null;

    const facts = buildMySupplementFactsV1({
      digest: digestBundle.digest,
      factsSourceVersion: digestBundle.factsSourceVersion,
      factsDigestHash: digestBundle.factsDigestHash,
      labelDirectionsRawText: digestBundle.labelDirectionsRawText,
      overlayClaims,
    });

    const factsStatus = computeFactsStatus(facts);
    const factsDigestHash = digestBundle.factsDigestHash;
    const factsSourceVersion = digestBundle.factsSourceVersion;

    const cachedAnalysis = await findMatchingPublicAnalysis({ supplementId, factsDigestHash });
    if (cachedAnalysis) {
      return res.json({
        supplementId,
        facts,
        factsStatus,
        factsDigestHash,
        factsSourceVersion,
        aiStatus: "ready" satisfies EnsureOverviewAiStatus,
        aiRetryAfterSec: 0,
        aiBlockedReason: null,
        analysisReady: true,
        source: "cache" satisfies EnsurePublicOverviewSource,
        analysisData: cachedAnalysis,
      });
    }

    if (factsStatus === "partial" && barcodeDigits) {
      void populateBarcodeSnapshotCacheDeduped(barcodeDigits).catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn("[ensure-overview] Failed to backfill snapshot cache", message);
      });
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;
    if (!deepseekKey) {
      return res.json({
        supplementId,
        facts,
        factsStatus,
        factsDigestHash,
        factsSourceVersion,
        aiStatus: "none" satisfies EnsureOverviewAiStatus,
        aiRetryAfterSec: 0,
        aiBlockedReason: null,
        analysisReady: false,
        source: "none" satisfies EnsurePublicOverviewSource,
        analysisData: null,
      });
    }

    if (factsStatus !== "full") {
      return res.json({
        supplementId,
        facts,
        factsStatus,
        factsDigestHash,
        factsSourceVersion,
        aiStatus: "none" satisfies EnsureOverviewAiStatus,
        aiRetryAfterSec: 0,
        aiBlockedReason: null,
        analysisReady: false,
        source: "none" satisfies EnsurePublicOverviewSource,
        analysisData: null,
      });
    }

    const maybeGateRow = await getAnalysisIdentityCache(
      {
        identityType: digestBundle.digest.identity.type,
        identityValue: digestBundle.digest.identity.value,
        locale: "en",
        promptVersion: MY_SUPP_OVERVIEW_V2_PROMPT_VERSION,
        factsDigestHash,
        section: MY_SUPP_OVERVIEW_V2_GATE_SECTION,
      },
      { timeoutMs: 650 },
    ).catch(() => null);

    const gatePayload = maybeGateRow?.payload as { ok?: unknown; reason?: unknown } | null;
    if (
      maybeGateRow?.status === "complete" &&
      gatePayload &&
      typeof gatePayload === "object" &&
      gatePayload.ok === false
    ) {
      return res.json({
        supplementId,
        facts,
        factsStatus,
        factsDigestHash,
        factsSourceVersion,
        aiStatus: "blocked" satisfies EnsureOverviewAiStatus,
        aiRetryAfterSec: computeRetryAfterSeconds(maybeGateRow.expires_at),
        aiBlockedReason: typeof gatePayload.reason === "string" ? gatePayload.reason : null,
        analysisReady: false,
        source: "none" satisfies EnsurePublicOverviewSource,
        analysisData: null,
      });
    }

    // Facts-first: return facts immediately and trigger AI generation in the background.
    void ensurePublicOverview({
      supplementId,
      productName,
      dosageText,
      brandName,
      barcode,
      ...digestBundle,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("[ensure-overview] Background ensurePublicOverview failed", message);
    });

    return res.json({
      supplementId,
      facts,
      factsStatus,
      factsDigestHash,
      factsSourceVersion,
      aiStatus: "pending" satisfies EnsureOverviewAiStatus,
      aiRetryAfterSec: 0,
      aiBlockedReason: null,
      analysisReady: false,
      source: "none" satisfies EnsurePublicOverviewSource,
      analysisData: null,
    });
  } catch (error) {
    captureException(error, { route: "/api/ensure-overview" });
    console.error("/api/ensure-overview error", error);
    return res.status(500).json({ error: "ensure_overview_failed" } satisfies ErrorResponse);
  }
});

// ============================================================================
// User stack overlap (deterministic, read-only, no external fetch, no LLM)
// ============================================================================

app.get("/api/user-stack-overlap", verifySupabaseToken, async (req: Request, res: Response) => {
  const startedAt = performance.now();
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) {
    return res.status(401).json({ error: "unauthorized" } satisfies ErrorResponse);
  }

  try {
    const remoteInputs = await fetchRemoteStackOverlapInputs(user.id);
    if (!remoteInputs) {
      return res.status(500).json({ error: "stack_overlap_failed" } satisfies ErrorResponse);
    }

    const overlap = buildStackOverlapResult(remoteInputs.processedInputs, {
      maxPerSupplement: STACK_OVERLAP_ACTIVES_PER_SUPPLEMENT,
      maxOverlaps: STACK_OVERLAP_MAX_ITEMS,
      skippedSupplements: remoteInputs.skippedSupplements,
    });
    const processedSupplements = remoteInputs.processedSupplements;
    const totalSkippedSupplements = overlap.meta.skippedSupplements;
    const status = remoteInputs.truncated || totalSkippedSupplements > 0 ? "partial" : "ok";
    const latencyMs = Math.round(performance.now() - startedAt);

    console.info("[stack-overlap]", {
      status,
      processedSupplements,
      skippedSupplements: totalSkippedSupplements,
      overlapCount: overlap.overlapCount,
      truncated: remoteInputs.truncated,
      latencyMs,
    });

    return res.json({
      status,
      overlaps: overlap.overlaps,
      summary: {
        processedSupplements,
        skippedSupplements: totalSkippedSupplements,
        overlapCount: overlap.overlapCount,
        truncated: remoteInputs.truncated,
        hiddenOverlapCount: overlap.hiddenOverlapCount,
      },
      stackLevelSummary: overlap.stackLevelSummary,
      duplicateGroups: overlap.duplicateGroups,
      meta: {
        ...overlap.meta,
        truncated: remoteInputs.truncated,
        overlapCount: overlap.overlapCount,
        hiddenOverlapCount: overlap.hiddenOverlapCount,
      },
    });
  } catch (error) {
    captureException(error, { route: "/api/user-stack-overlap" });
    console.error("/api/user-stack-overlap error", error);
    return res.status(500).json({ error: "stack_overlap_failed" } satisfies ErrorResponse);
  }
});

// ============================================================================
// Lightweight barcode metadata (deterministic, no LLM)
// ============================================================================

app.get("/api/barcode-metadata", verifySupabaseToken, async (req: Request, res: Response) => {
  const barcodeRaw = typeof req.query.barcode === "string" ? req.query.barcode : "";
  const normalized = normalizeBarcodeInput(barcodeRaw);

  if (!normalized) {
    return res.status(400).json({ error: "invalid_barcode" } satisfies ErrorResponse);
  }

  const barcode = normalized.code;
  const barcodeGtin14 = barcode.padStart(14, "0");
  const barcodeRawDigits = barcode;
  const cacheKey = buildBarcodeCacheKey(barcode);
  const overlayClaims = await fetchIherbOverlayClaimsByBarcode(barcodeGtin14);
  const seededDsldLabelId = STAGE0_DSLD_BARCODE_FALLBACK_ENABLED
    ? resolvePreferredStage0DsldLabelId(barcodeGtin14)
    : null;
  const metadataReadonly = !(
    process.env.METADATA_READONLY === "0" || process.env.METADATA_READONLY === "false"
  );

  const extractPrimaryDoseText = (
    snapshot: SupplementSnapshot,
    overlayClaimsForBarcode: DecisionSupportOverlayClaims | null,
  ): string | null => {
    const overlayRows = normalizeIherbSupplementFactsRows(overlayClaimsForBarcode?.nutritionalFacts);
    const overlayDose = overlayRows.find((row) => row.dose)?.dose?.trim() ?? "";
    if (overlayDose) return overlayDose;

    for (const active of snapshot.label.actives) {
      if (active.amountUnknown) continue;
      if (active.isProprietaryBlend) continue;
      if (active.amount == null) continue;
      const activeName = typeof active.name === "string" ? active.name.trim().toLowerCase() : "";
      if (/\bcalories?\b|\btotal fat\b|\bsaturated fat\b|\bcholesterol\b|\bsodium\b/.test(activeName)) continue;
      const unit =
        active.amountUnitNormalized ??
        active.amountUnit ??
        active.amountUnitRaw ??
        null;
      if (!unit) continue;
      if (/\bcal(?:ories?)?\b/i.test(unit)) continue;
      // Return as raw text; the client display formatter will normalize/compact if needed.
      return `${active.amount} ${unit}`.trim();
    }
    return null;
  };

  try {
    const cached = await getSnapshotCache(
      { key: cacheKey, source: "barcode" },
      {
        timeoutMs: 1200,
      },
    ).catch(() => null);

    if (cached?.snapshot) {
      const snapshot = cached.snapshot;
      const cachedSnapshotLabelSource =
        snapshot.analysis?.labelExtraction?.source ??
        cached.analysisPayload?.analysis?.labelExtraction?.source ??
        null;
      const cachedSnapshotUsesLnhpd =
        (cachedSnapshotLabelSource === "lnhpd" || cachedSnapshotLabelSource === "manual") &&
        Boolean(snapshot.regulatory.npnVerifiedBy === "lnhpd_fetch" || snapshot.regulatory.npn);
      if (!LNHPD_RUNTIME_ENABLED && cachedSnapshotUsesLnhpd) {
        // Ignore stale LNHPD-backed snapshots in US-only runtime mode.
      } else {
        return res.json({
          status: "ok",
          barcodeGtin14,
          productInfo: {
            brand: snapshot.product.brand ?? null,
            name: snapshot.product.name ?? null,
          },
          primaryDoseText: extractPrimaryDoseText(snapshot, overlayClaims),
          npn: LNHPD_RUNTIME_ENABLED ? snapshot.regulatory.npn ?? null : null,
          dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
        });
      }
    }

    // Keep metadata source alignment with scan Stage0 for curated seeded DSLD barcodes.
    if (seededDsldLabelId && Number.isFinite(Number(seededDsldLabelId))) {
      const dsldTimeoutSignal = createTimeoutSignal(
        Math.max(STAGE0_DSLD_SEEDED_FETCH_TIMEOUT_MS, 500),
      );
      const { signal: dsldSignal, cleanup: cleanupDsldSignal } = combineSignals([dsldTimeoutSignal]);
      try {
        const dsldFacts = await fetchDsldFactsByLabelId(Number(seededDsldLabelId), dsldSignal);
        if (dsldFacts) {
          const dsldLabelFacts = toLabelFactsFromDsld(dsldFacts);
          const labelExtraction: LabelExtractionMeta = {
            source: "dsld",
            fetchedAt: dsldFacts.extractedAt ?? nowIso(),
            datasetVersion: dsldFacts.datasetVersion ?? null,
          };
          const labelAnalysis = buildLabelOnlyAnalysis(dsldLabelFacts);
          const dsldProductInfo = {
            brand: dsldFacts.brandName ?? null,
            name: dsldFacts.productName ?? null,
            category: null,
            image: null,
          };
          const analysisPayload: SnapshotAnalysisPayload = {
            ...labelAnalysis,
            brandExtraction: {
              brand: dsldProductInfo.brand,
              product: dsldProductInfo.name,
              category: null,
              confidence: "high",
              source: "rule",
            },
            productInfo: dsldProductInfo,
            sources: [],
          };
          let snapshot = buildBarcodeSnapshot({
            barcode,
            productInfo: dsldProductInfo,
            sources: [],
            efficacy: (analysisPayload as any).efficacy ?? null,
            safety: (analysisPayload as any).safety ?? null,
            usagePayload: (analysisPayload as any).usagePayload ?? null,
          });
          snapshot = applyDsldFactsToSnapshot(snapshot, dsldFacts);
          const analysisStatus = buildAnalysisStatus({
            hasLabelFacts: hasLabelFacts(snapshot),
            hasAi: hasAiPayload(analysisPayload),
            dsldLabelId: dsldFacts.dsldLabelId ?? null,
          });
          const analysisMeta = buildAnalysisMeta({
            status: analysisStatus,
            labelExtraction,
            overlayClaims,
          });
          analysisPayload.analysis = analysisMeta;
          snapshot.status = "resolved";
          snapshot.analysis = analysisMeta;
          snapshot.updatedAt = nowIso();

          if (!metadataReadonly) {
            const expiresAt = computeExpiresAt(analysisStatus);
            void storeSnapshotCache(
              {
                key: cacheKey,
                source: "barcode",
                snapshot,
                analysisPayload,
                expiresAt,
              },
              { timeoutMs: 1500 },
            );
          }

          return res.json({
            status: "ok",
            barcodeGtin14,
            productInfo: {
              brand: snapshot.product.brand ?? null,
              name: snapshot.product.name ?? null,
            },
            primaryDoseText: extractPrimaryDoseText(snapshot, overlayClaims),
            npn: LNHPD_RUNTIME_ENABLED ? snapshot.regulatory.npn ?? null : null,
            dsldLabelId: snapshot.regulatory.dsldLabelId ?? String(seededDsldLabelId),
          });
        }
      } finally {
        cleanupDsldSignal();
      }
    }

    if (!LNHPD_RUNTIME_ENABLED) {
      return res.json({
        status: "not_found",
        barcodeGtin14,
        productInfo: { brand: null, name: null },
        primaryDoseText: null,
        npn: null,
        dsldLabelId: null,
      });
    }

    const map = await getBarcodeRegulatoryMap(barcodeGtin14, barcodeRawDigits, {
      timeoutMs: 1200,
      includeExpired: true,
    }).catch(() => null);

    const npn = map?.npn ?? null;
    if (!npn) {
      return res.json({
        status: "not_found",
        barcodeGtin14,
        productInfo: { brand: null, name: null },
        primaryDoseText: null,
        npn: null,
        dsldLabelId: null,
      });
    }

    const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
    const { signal: lnhpdSignal, cleanup } = combineSignals([lnhpdTimeoutSignal]);
    try {
      const facts = await fetchLnhpdFactsByNpn(npn, lnhpdSignal);
      if (!facts) {
        return res.json({
          status: "not_found",
          barcodeGtin14,
          productInfo: { brand: null, name: null },
          primaryDoseText: null,
          npn,
          dsldLabelId: null,
        });
      }

      const lnhpdLabelFacts = toLabelFactsFromLnhpd(facts);
      const labelExtraction: LabelExtractionMeta = {
        source: "lnhpd",
        fetchedAt: facts.extractedAt ?? nowIso(),
        datasetVersion: facts.datasetVersion ?? null,
      };
      const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);

      const lnhpdProductInfo = {
        brand: facts.brandName ?? null,
        name: facts.productName ?? null,
        category: null,
        image: null,
      };

      const analysisPayload: SnapshotAnalysisPayload = {
        ...labelAnalysis,
        brandExtraction: {
          brand: lnhpdProductInfo.brand,
          product: lnhpdProductInfo.name,
          category: null,
          confidence: "high",
          source: "rule",
        },
        productInfo: lnhpdProductInfo,
        sources: [],
      };

      let snapshot = buildBarcodeSnapshot({
        barcode,
        productInfo: lnhpdProductInfo,
        sources: [],
        efficacy: (analysisPayload as any).efficacy ?? null,
        safety: (analysisPayload as any).safety ?? null,
        usagePayload: (analysisPayload as any).usagePayload ?? null,
      });
      snapshot = applyLnhpdFactsToSnapshot(snapshot, facts);

      const analysisStatus = buildAnalysisStatus({
        hasLabelFacts: hasLabelFacts(snapshot),
        hasAi: hasAiPayload(analysisPayload),
        dsldLabelId: null,
      });
      const analysisMeta = buildAnalysisMeta({
        status: analysisStatus,
        labelExtraction,
        overlayClaims,
      });
      analysisPayload.analysis = analysisMeta;
      snapshot.status = "resolved";
      snapshot.analysis = analysisMeta;
      snapshot.updatedAt = nowIso();

      if (!metadataReadonly) {
        const expiresAt = computeExpiresAt(analysisStatus);
        void storeSnapshotCache(
          {
            key: cacheKey,
            source: "barcode",
            snapshot,
            analysisPayload,
            expiresAt,
          },
          { timeoutMs: 1500 },
        );
      }

      return res.json({
        status: "ok",
        barcodeGtin14,
        productInfo: {
          brand: snapshot.product.brand ?? null,
          name: snapshot.product.name ?? null,
        },
        primaryDoseText: extractPrimaryDoseText(snapshot, overlayClaims),
        npn: snapshot.regulatory.npn ?? npn,
        dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
      });
    } finally {
      cleanup();
    }
  } catch (error) {
    captureException(error, { route: "/api/barcode-metadata" });
    console.error("/api/barcode-metadata error", error);
    return res.status(500).json({ error: "barcode_metadata_failed" } satisfies ErrorResponse);
  }
});

/**
 * Deprecated endpoint
 */
app.post("/api/enrich-supplement", async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: "endpoint_deprecated",
    message: "Use /api/enrich-stream instead"
  });
});

/**
 * Internal metrics (lightweight counters)
 */
app.get("/internal/metrics", (_req: Request, res: Response) => {
  res.json(getMetricsSnapshot());
});

app.get("/internal/legacy-runtime-usage", (_req: Request, res: Response) => {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayRow = legacyRuntimeUsage.byDay[todayKey] ?? {
    total: 0,
    mobileUiCalls: 0,
    byRoute: {},
    bySurface: {
      mobile_ui: 0,
      shadow_probe: 0,
      regression: 0,
      unknown: 0,
    },
  };
  res.json({
    schemaVersion: "legacy_runtime_usage.v1",
    freezeShadowOnly: FREEZE_SHADOW_ONLY,
    generatedAt: new Date().toISOString(),
    startedAt: legacyRuntimeUsage.startedAt,
    totals: {
      totalCalls: legacyRuntimeUsage.totalCalls,
      mobileUiCalls: legacyRuntimeUsage.mobileUiCalls,
      bySurface: legacyRuntimeUsage.bySurface,
      byRoute: legacyRuntimeUsage.byRoute,
    },
    bySession: legacyRuntimeUsage.bySession,
    today: {
      date: todayKey,
      ...todayRow,
    },
    byDay: legacyRuntimeUsage.byDay,
  });
});

/**
 * Health check
 */
app.get("/health", (_req: Request, res: Response) => {
  const googleCseConfigured = Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);

  res.json({
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
    configured: {
      googleCse: googleCseConfigured,
      deepseek: deepseekConfigured,
    },
  });
});

// Minimal error logging (no secrets)
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  captureException(error, { route: req.path, method: req.method });
  if (error instanceof Error) {
    console.error(`[ERR] ${req.method} ${req.path}: ${message}\n${error.stack ?? ""}`);
  } else {
    console.error(`[ERR] ${req.method} ${req.path}: ${message}`);
  }

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "internal_error" });
});

process.on("unhandledRejection", (reason) => {
  captureException(reason, { type: "unhandledRejection" });
  console.error("[UNHANDLED_REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  captureException(err, { type: "uncaughtException" });
  console.error("[UNCAUGHT_EXCEPTION]", err);
  process.exit(1);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Search backend listening on http://0.0.0.0:${PORT}`);
  if (PRODUCT_SEARCH_WARM_ON_STARTUP) {
    const timer = setTimeout(() => {
      warmProductSearchIndex();
    }, PRODUCT_SEARCH_STARTUP_WARM_DELAY_MS);
    timer.unref?.();
  }
});
