import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as Sentry from "@sentry/node";
import { z } from "zod";

import { buildBarcodeSearchQueries, normalizeBarcodeInput, type NormalizedBarcode } from "./barcode.js";
import { resolveCatalogByBarcode, type CatalogResolved } from "./catalogResolver.js";
import { buildCatalogBarcodeSnapshot } from "./catalogSnapshot.js";
import { logBarcodeScan } from "./scanLog.js";
import { extractBrandProduct, type BrandExtractionResult } from "./brandExtractor.js";
import {
  buildCombinedContext,
  fetchAnalysisBundle,
  fetchAnalysisBundleFastV3,
  fetchIngredientsDetailV3,
  fetchMySupplementOverviewCard,
  prepareContextSources,
} from "./deepseek.js";
import { getKbRuntime, lookupKbFormExplain } from "./kbRuntime.js";
import { buildRuleBasedOverview } from "./overviewRuleBased.js";
import {
  IngredientsDetailSchema,
  UsageFieldSchema,
  safeParseAnalysisBundle,
  type AnalysisBundle,
  type BasisTag,
  type IngredientsDetail,
} from "./analysisBundle.js";
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
import { getAnalysisIdentityCache, getWebCanonicalMap, insertAnalysisIdentityPending, updateAnalysisIdentityCache, upsertAnalysisIdentityCache, upsertWebCanonicalMap } from "./analysisIdentityCache.js";
import {
  clearNegativeCache,
  clearNpnNegativeCache,
  clearResolutionCacheBestUrl,
  getBarcodeRegulatoryMap,
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
import { analyzeLabelDraft, analyzeLabelDraftWithDiagnostics, formatForDeepSeek, needsConfirmation, validateIngredient, type LabelAnalysisDiagnostics, type LabelDraft } from "./labelAnalysis.js";
import { getCachedResult, hasCompletedAnalysis, setCachedResult, updateCachedAnalysis } from "./ocrCache.js";
import { upsertProductIngredientsFromDraft, upsertProductIngredientsFromLabelFacts } from "./productIngredients.js";
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
import type { RetryOptions } from "./resilience.js";
import {
  constructFallbackQuery,
  extractDomain,
  getExtractabilityTier,
  getUrlSignalScore,
  isHighQualityDomain,
  isMarketplaceDomain,
  scoreSearchItem,
  scoreSearchQuality,
} from "./searchQuality.js";
import { computeScoreBundleV4, computeV4InputsHash, V4_SCORE_VERSION } from "./scoring/v4ScoreEngine.js";
import { buildBarcodeSnapshot, buildLabelSnapshot, validateSnapshotOrFallback, type SnapshotAnalysisPayload } from "./snapshot.js";
import { getSnapshotCache, storeSnapshotCache } from "./snapshotCache.js";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import { supabase } from "./supabase.js";
import { getNutriTipsData } from "./nutriTips.js";
import type {
  AiSupplementAnalysis,
  ErrorResponse,
  IngredientAnalysis,
  PrimaryActive,
  RatingScore,
  SearchItem,
  SearchResponse,
  ScoreBundleResponse,
  ScoreBundleV4,
  ScoreGoalFit,
  ScoreHighlight,
  ScoreFlag,
} from "./types.js";
import { callVisionOcr } from "./visionOcr.js";
import { getMetricsSnapshot, incrementMetric, startMetricsFlush } from "./metrics.js";

dotenv.config();

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
const LABEL_SCAN_OUTPUT_RULES = `LABEL-SCAN OUTPUT RULES:
1) overviewSummary must include serving unit (e.g., per softgel/caplet/serving) and 2-3 key ingredients with doses if present.
2) coreBenefits must list 3 items in "Ingredient - dose per unit" format; if dose missing, say "dose not specified".
3) overallAssessment must include a transparency note (e.g., proprietary blend or missing doses).
4) marketingVsReality must mention "Label-only analysis; no price/brand verification".
5) Do NOT mention price/cost; value should reflect formula transparency.
6) If data is missing, say "Not specified on label" instead of guessing.`;

const RESILIENCE_TOTAL_BUDGET_MS = Number(process.env.RESILIENCE_TOTAL_BUDGET_MS ?? 25_000);
const RESILIENCE_CATALOG_TIMEOUT_MS = Number(process.env.RESILIENCE_CATALOG_TIMEOUT_MS ?? 900);
const RESILIENCE_SNAPSHOT_TIMEOUT_MS = Number(process.env.RESILIENCE_SNAPSHOT_TIMEOUT_MS ?? 900);
const RESILIENCE_LNHPD_TIMEOUT_MS = Number(process.env.RESILIENCE_LNHPD_TIMEOUT_MS ?? 900);
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
const SECONDARY_QUERY_TOKEN_LIMIT = Math.max(6, Number(process.env.SECONDARY_QUERY_TOKEN_LIMIT ?? 10));
const SECONDARY_EXCLUDE_RETAILERS = parseBooleanEnv(process.env.SECONDARY_EXCLUDE_RETAILERS, true);
const SECONDARY_ALLOW_MARKETPLACE = parseBooleanEnv(process.env.SECONDARY_ALLOW_MARKETPLACE, false);
const SECONDARY_NEEDS_JS_OVERRIDE_MIN = Number(process.env.SECONDARY_NEEDS_JS_OVERRIDE_MIN ?? 0.85);

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
const ANALYSIS_BUNDLE_FAST_TIMEOUT_MS = Number(process.env.ANALYSIS_BUNDLE_FAST_TIMEOUT_MS ?? 3500);
const ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS = Number(process.env.ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS ?? 7000);
const ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD = Number(
  process.env.ANALYSIS_BUNDLE_DETAIL_TIMEOUT_MS_DSLD ?? 4500,
);
const ANALYSIS_DETAIL_LIMIT_DEFAULT = Number(process.env.ANALYSIS_DETAIL_LIMIT_DEFAULT ?? 8);
const ANALYSIS_DETAIL_LIMIT_MAX = Number(process.env.ANALYSIS_DETAIL_LIMIT_MAX ?? 12);
const ANALYSIS_DETAIL_LIMIT_RESCUE = Number(process.env.ANALYSIS_DETAIL_LIMIT_RESCUE ?? 6);
const ANALYSIS_DETAIL_LIMIT_DSLD = Number(process.env.ANALYSIS_DETAIL_LIMIT_DSLD ?? 6);
const ANALYSIS_DETAIL_MAX_TOKENS = Number(process.env.ANALYSIS_DETAIL_MAX_TOKENS ?? 1000);
const ANALYSIS_DETAIL_RESCUE_MAX_TOKENS = Number(process.env.ANALYSIS_DETAIL_RESCUE_MAX_TOKENS ?? 700);
const ANALYSIS_DETAIL_MAX_TOKENS_DSLD = Number(process.env.ANALYSIS_DETAIL_MAX_TOKENS_DSLD ?? 500);
const ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD = Number(process.env.ANALYSIS_DETAIL_RESCUE_MAX_TOKENS_DSLD ?? 350);
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

const GUARDRAIL_SIMILARITY_THRESHOLD = Number(process.env.GUARDRAIL_SIMILARITY_THRESHOLD ?? 0.6);


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
  source: 'dsld' | 'label_scan' | 'lnhpd' | 'manual';
  fetchedAt: string | null;
  datasetVersion: string | null;
};

type AnalysisMeta = {
  status: AnalysisStatus;
  version: number;
  labelExtraction: LabelExtractionMeta | null;
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
): AnalysisBundle["sections"]["ingredients"]["cover"] => {
  const basisTag = resolveSourceBasisTag(digest.sourceType);
  const items = digest.actives.slice(0, 6).map((active) => ({
    name: active.name,
    dose: active.amountText ?? (active.amount != null && active.unit ? `${active.amount} ${active.unit}` : null),
    basisTags: [basisTag],
  }));
  return {
    items,
    totalCount: digest.actives.length,
  };
};

const buildFallbackOverviewSummary = (digest: FactsDigest): string => {
  const primary = digest.actives[0]?.name ?? null;
  if (primary) return `A supplement centered on ${primary}.`;
  if (digest.product.name) return `${digest.product.name} supplement overview.`;
  return "Supplement overview unavailable.";
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

const buildFastFailureBundle = (skeleton: AnalysisBundle): AnalysisBundle => ({
  ...skeleton,
  meta: {
    ...skeleton.meta,
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

const extractFormKeywords = (text: string): string[] => {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  let match: RegExpExecArray | null;
  const globalRe = new RegExp(FORM_KEYWORD_RE.source, "gi");
  while ((match = globalRe.exec(lower))) {
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
    return buildNotProvidedField();
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
    const doseParts = [perServing];
    if (labelDosingText) doseParts.push(`Label dosing: ${labelDosingText}.`);
    const doseContext = buildLabelField(doseParts.join(" "));

    const whatItDoes = whatItDoesFromPurpose ?? buildNotProvidedField();

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
      whatItDoes: buildNotProvidedField(),
      doseContext: doseField,
      chemicalFormExplain: buildNotProvidedField("Chemical form not provided by source."),
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
          whatItDoes: buildNotProvidedField(),
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
        : { text: "Chemical form not provided by source.", basisTags: ["not_provided"] as BasisTag[] };
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
}): AnalysisBundle => {
  const { digest } = params;
  return {
    meta: {
      schemaVersion: 4,
      promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION,
      sourceType: digest.sourceType,
      authoritativeIdentity: { type: params.identityType, value: params.identityValue },
      locale: params.locale,
      phase: params.phase,
      bundleId: params.bundleId,
      revision: params.revision,
      factsDigestHash: params.factsDigestHash,
      factsSourceVersion: params.factsSourceVersion,
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
        cover: buildIngredientsCover(digest),
        detail: null,
        dataStatus: digest.actives.length > 0 ? "complete" : "not_provided",
      },
      usage: {
        layout: "usage_bullets",
        cover: null,
        detail: {
          timingRationale: null,
          withFoodRationale: null,
          scheduleFromLabel: digest.labelDosing.map((dose) => ({
            population: dose.population ?? null,
            age: dose.age ?? null,
            dose: dose.dose ?? null,
            frequency: dose.frequency ?? null,
            rawText: dose.rawText ?? null,
            basisTags: ["label_fact"],
          })),
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
        dataStatus: params.dataStatus.safety,
      },
    },
  };
};

const mergeFastAnalysisBundle = (params: {
  skeleton: AnalysisBundle;
  digest: FactsDigest;
  fastOutput: Record<string, unknown> | null;
}): AnalysisBundle => {
  const { skeleton, digest, fastOutput } = params;
  const allowedFormKeywords = buildAllowedFormKeywordSet(digest);
  const fallbackSummary = buildFallbackOverviewSummary(digest);
  const fallbackBullets = buildFallbackOverviewBullets(digest);
  const overviewRaw = (fastOutput?.overview ?? {}) as Record<string, unknown>;
  const overviewSummaryCandidateRaw =
    typeof overviewRaw.summary === "string" && overviewRaw.summary.trim()
      ? clampText(overviewRaw.summary.trim(), 180)
      : fallbackSummary;
  const overviewSummaryCandidate =
    hasForbiddenFormKeyword(overviewSummaryCandidateRaw, allowedFormKeywords)
      ? fallbackSummary
      : overviewSummaryCandidateRaw;
  const overviewBulletsRaw = Array.isArray(overviewRaw.bullets) ? overviewRaw.bullets : [];
  const overviewBullets = overviewBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text : "",
      basisTags: normalizeBasisTags(item?.basisTags, "ingredient_inference"),
    }))
    .filter((item) => item.text)
    .filter((item) => !hasForbiddenFormKeyword(item.text, allowedFormKeywords))
    .slice(0, 2);
  const overviewBulletsFinal = overviewBullets.length > 0 ? overviewBullets : fallbackBullets;
  const dsldNeedsInference =
    digest.sourceType === "dsld" &&
    overviewBulletsFinal.length > 0 &&
    overviewBulletsFinal.every((bullet) => isContainsBullet(bullet.text));
  const dsldForceInference =
    digest.sourceType === "dsld" &&
    (overviewBulletsFinal.length === 0 || dsldNeedsInference);
  const dsldInference = dsldForceInference ? buildDsldInferenceOverview(digest) : null;

  const usageRaw = (fastOutput?.usage ?? {}) as Record<string, unknown>;
  const usageBulletsRaw = Array.isArray(usageRaw.bullets) ? usageRaw.bullets : [];
  const usageBulletsFromModel = usageBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text : "",
      basisTags: normalizeBasisTags(item?.basisTags, "general_advice"),
    }))
    .filter((item) => item.text)
    .slice(0, 3);
  const bestTimeToTake =
    usageRaw.bestTimeToTake && typeof usageRaw.bestTimeToTake === "object"
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
        text: typeof withFoodRaw.text === "string" ? withFoodRaw.text : null,
        basisTags: normalizeBasisTags(withFoodRaw.basisTags, "general_advice"),
      }
    : null;
  const dosageField = buildUsageDosageField(digest);
  const labelDosingText = buildLabelDosingText(digest);
  const isLnhpd = digest.sourceType === "lnhpd";
  const bestTimeToTakeFinal =
    isLnhpd
      ? buildLnhpdDeterministicTiming(labelDosingText)
      : bestTimeToTake && bestTimeToTake.text
        ? bestTimeToTake
        : null;
  const withFoodFinal =
    isLnhpd
      ? buildLnhpdDeterministicWithFood(labelDosingText, digest.actives)
      : withFoodFromModel;
  // Since the UI shows dosage/bestTime/withFood as fixed rows, avoid template repetition in LNHPD usage bullets.
  const usageBulletsFinal = isLnhpd ? [] : usageBulletsFromModel;

  const safetyRaw = (fastOutput?.safety ?? {}) as Record<string, unknown>;
  const safetyVerdict =
    typeof safetyRaw.verdict === "string" && safetyRaw.verdict.trim()
      ? safetyRaw.verdict.trim()
      : digest.warnings.missingFlag
        ? "Not provided by source"
        : "Safety summary unavailable";
  const safetyBulletsRaw = Array.isArray(safetyRaw.bullets) ? safetyRaw.bullets : [];
  const safetyBullets = safetyBulletsRaw
    .map((item) => ({
      text: typeof item?.text === "string" ? item.text : "",
      basisTags: normalizeBasisTags(item?.basisTags, digest.warnings.missingFlag ? "not_provided" : "general_advice"),
    }))
    .filter((item) => item.text)
    .slice(0, 3);
  const safetyBulletsFinal =
    safetyBullets.length > 0
      ? safetyBullets
      : digest.warnings.missingFlag
        ? [
            buildSectionBullet(
              "Not provided by source. General reminder: if pregnant/nursing, have a condition, or take medications, check with a clinician.",
              ["general_advice"],
            ),
          ]
        : [];

  const overviewStatus = overviewBulletsFinal.length > 0 ? "complete" : "limited";
  const usageStatus =
    usageBulletsFinal.length > 0 || bestTimeToTakeFinal || withFoodFinal || dosageField ? "complete" : "limited";
  const safetyStatus = digest.warnings.missingFlag ? "not_provided" : safetyBulletsFinal.length > 0 ? "complete" : "limited";
  const safetyTag = resolveSourceBasisTag(digest.sourceType);

  return {
    ...skeleton,
    meta: {
      ...skeleton.meta,
      phase: "fast_ai",
      revision: skeleton.meta.revision + 1,
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
      ingredients: skeleton.sections.ingredients,
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
          scheduleFromLabel: skeleton.sections.usage.detail?.scheduleFromLabel ?? [],
        },
        dataStatus: usageStatus,
      },
      safety: {
        ...skeleton.sections.safety,
        cover: {
          verdict: safetyVerdict,
          bullets: safetyBulletsFinal,
        },
        detail: {
          warnings: digest.warnings.warnings.map((warning) => buildSectionBullet(warning, [safetyTag])),
          consultDoctorIf: digest.warnings.consultDoctorIf.map((item) => buildSectionBullet(item, [safetyTag])),
          redFlags: digest.warnings.redFlags.map((item) => buildSectionBullet(item, [safetyTag])),
        },
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

const buildAnalysisMeta = (params: { status: AnalysisStatus; labelExtraction?: LabelExtractionMeta | null }): AnalysisMeta => ({
  status: params.status,
  version: ANALYSIS_VERSION,
  labelExtraction: params.labelExtraction ?? null,
});

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

const fetchDsldFactsByLabelId = async (
  labelId: number,
  signal?: AbortSignal,
): Promise<DsldFacts | null> => {
  if (signal?.aborted) return null;

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
};

const fetchDsldFactsByBarcode = async (
  barcodeGtin14: string,
  signal?: AbortSignal,
): Promise<DsldFacts | null> => {
  if (signal?.aborted) return null;

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
    return null;
  }
  return buildDsldFactsFromMeta(meta);
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

  const actives = extractLnhpdIngredients(factsJson.medicinalIngredients, {
    nameKeys: LNHPD_MEDICINAL_NAME_KEYS,
    amountKeys: LNHPD_AMOUNT_KEYS,
    unitKeys: LNHPD_UNIT_KEYS,
  });
  const inactive = extractTextList(factsJson.nonMedicinalIngredients, LNHPD_NON_MEDICINAL_NAME_KEYS);
  const purposes = extractTextList(factsJson.purposes, LNHPD_PURPOSE_KEYS);
  const routes = extractTextList(factsJson.routes, LNHPD_ROUTE_KEYS);
  const doses = extractLnhpdDoses(factsJson.doses);
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
    if (error || !data || data.length === 0) return null;
    return data[0] as LnhpdFactsRecord;
  };

  const record = await runQuery('lnhpd_facts_complete') ?? await runQuery('lnhpd_facts');
  if (!record) return null;

  return buildLnhpdFactsFromRecord(record);
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
  if (!brand && !product) return null;

  const runQuery = async (table: string) => {
    let query = supabase
      .from(table)
      .select('lnhpd_id,facts_json,dataset_version,extracted_at,brand_name,product_name,npn,is_on_market')
      .limit(8);

    if (product) {
      query = query.ilike('product_name', `%${product}%`);
    }
    if (brand) {
      query = query.ilike('brand_name', `%${brand}%`);
    }
    if (table === 'lnhpd_facts') {
      query = query.eq('is_on_market', true);
    }

    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    if (error || !data || data.length === 0) return null;
    return data as LnhpdFactsRecord[];
  };

  let records = await runQuery('lnhpd_facts_complete');
  if (!records) {
    records = await runQuery('lnhpd_facts');
  }
  if (!records) return null;

  let bestRecord: LnhpdFactsRecord | null = null;
  let bestScore = -1;
  for (const record of records) {
    const score =
      scoreTextMatch(product, record.product_name) * 2 +
      scoreTextMatch(brand, record.brand_name);
    if (score > bestScore) {
      bestScore = score;
      bestRecord = record;
    }
  }

  if (!bestRecord) return null;
  if (product && bestScore < 2) return null;

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

type AuthorityCandidate = {
  npn: string;
  source: "map" | "map_stale" | "snapshot";
  isStale: boolean;
  requiresGuardrail: boolean;
  confidence: number | null;
};

const resolveAuthorityCandidate = (params: {
  regulatoryMap: { npn: string; confidence: number; source: string; expires_at: string | null } | null;
  snapshot: SupplementSnapshot | null;
}): { candidate: AuthorityCandidate | null; mapStatus: "hit" | "stale" | "miss" } => {
  const mapRow = params.regulatoryMap;
  let mapStatus: "hit" | "stale" | "miss" = "miss";
  let mapCandidate: AuthorityCandidate | null = null;

  if (mapRow && mapRow.npn) {
    const mapNpn = mapRow.npn.trim();
    if (mapNpn) {
      const expired = isExpiredAt(mapRow.expires_at);
      mapStatus = expired ? "stale" : "hit";
      const isConflict = mapRow.source === "conflict";
      const hasMinConfidence =
        Number.isFinite(mapRow.confidence) && mapRow.confidence >= REGULATORY_MAP_MIN_CONFIDENCE;
      if (!isConflict && hasMinConfidence) {
        if (!expired) {
          mapCandidate = {
            npn: mapNpn,
            source: "map",
            isStale: false,
            requiresGuardrail: false,
            confidence: mapRow.confidence,
          };
        } else if (mapRow.expires_at) {
          const expiresMs = Date.parse(mapRow.expires_at);
          const withinWindow =
            Number.isFinite(expiresMs) && Date.now() - expiresMs <= REGULATORY_MAP_STALE_WINDOW_MS;
          const isHighConfidence =
            mapRow.source === "lnhpd" || mapRow.source === "snapshot_verified" || mapRow.confidence >= 0.9;
          if (withinWindow && isHighConfidence) {
            mapCandidate = {
              npn: mapNpn,
              source: "map_stale",
              isStale: true,
              requiresGuardrail: true,
              confidence: mapRow.confidence,
            };
          }
        }
      }
    }
  }

  if (mapCandidate) {
    return { candidate: mapCandidate, mapStatus };
  }

  const snapshotNpn = params.snapshot?.regulatory?.npn?.trim() ?? null;
  const snapshotVerified =
    params.snapshot?.regulatory?.npnStatus === "verified" &&
    params.snapshot?.regulatory?.npnVerifiedBy === "lnhpd_fetch";
  if (snapshotNpn && snapshotVerified) {
    return {
      candidate: {
        npn: snapshotNpn,
        source: "snapshot",
        isStale: true,
        requiresGuardrail: true,
        confidence: 0.9,
      },
      mapStatus,
    };
  }

  return { candidate: null, mapStatus };
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
app.use(cors());
app.use(express.json({ limit: "10mb" })); // P0-2: Increased from 1mb for image base64

// Minimal request logging (no body / no secrets)
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    // Avoid noisy health check logs (Render pings this frequently).
    if (req.path === "/health") return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const durationLabel = `${durationMs.toFixed(1)}ms`;
    console.log(`[HTTP] ${res.statusCode} ${req.method} ${req.path} (${durationLabel}) id=${requestId}`);
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
const regressionAuthRoutes = new Set(["/api/enrich-stream", "/api/analysis-section"]);

const verifySupabaseToken = async (req: Request, res: Response, next: NextFunction) => {
  if (authDisabled) {
    return next();
  }
  const authBypassHeader = req.headers["x-auth-disabled"];
  const allowBypass =
    (Array.isArray(authBypassHeader)
      ? authBypassHeader.includes("1")
      : authBypassHeader === "1") &&
    (process.env.NODE_ENV !== "production" || allowAuthBypass);
  if (allowBypass) {
    return next();
  }

  // CI regression path: scoped token only for non-destructive analysis endpoints.
  if (regressionAuthToken && regressionAuthRoutes.has(req.path)) {
    const regressionHeader = req.headers["x-regression-token"];
    const hasRegressionToken = Array.isArray(regressionHeader)
      ? regressionHeader.includes(regressionAuthToken)
      : regressionHeader === regressionAuthToken;
    if (hasRegressionToken) {
      (req as AuthenticatedRequest).regressionAuth = true;
      return next();
    }
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

const sendSSE = (res: Response, type: string, data: unknown) => {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
      status: analysisSnapshot.scores ? analysisSnapshot.status : params.snapshot.status,
      scores: analysisSnapshot.scores ?? params.snapshot.scores,
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

${LABEL_SCAN_OUTPUT_RULES}`;

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
      status: analysisSnapshot.scores ? analysisSnapshot.status : params.snapshot.status,
      scores: analysisSnapshot.scores ?? params.snapshot.scores,
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

const buildValidatedLabelSnapshot = (input: {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  message?: string;
}): SupplementSnapshot => {
  const candidate = buildLabelSnapshot({
    status: input.status,
    analysis: input.analysis ?? null,
    draft: input.draft ?? null,
    message: input.message,
  });

  return validateSnapshotOrFallback({
    candidate,
    fallback: {
      source: "label",
      barcodeRaw: null,
      productInfo: {
        brand: input.analysis?.status === "success" ? input.analysis.productInfo?.brand ?? null : null,
        name: input.analysis?.status === "success" ? input.analysis.productInfo?.name ?? null : null,
        category: input.analysis?.status === "success" ? input.analysis.productInfo?.category ?? null : null,
        imageUrl: input.analysis?.status === "success" ? input.analysis.productInfo?.image ?? null : null,
      },
      createdAt: candidate.createdAt,
    },
  });
};

const buildBarcodeCacheKey = (barcode: string): string => {
  const normalized = normalizeBarcodeInput(barcode);
  return normalized ? normalized.code.padStart(14, "0") : barcode;
};

const buildAndCacheLabelSnapshot = async (input: {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  message?: string;
  imageHash: string;
}): Promise<SupplementSnapshot> => {
  const snapshot = buildValidatedLabelSnapshot({
    status: input.status,
    draft: input.draft,
    analysis: input.analysis,
    message: input.message,
  });

  void storeSnapshotCache({
    key: input.imageHash,
    source: "label",
    snapshot,
  });

  return snapshot;
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
  section: z.enum(["ingredients_detail"]),
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
  if (params.supplementId) {
    return {
      supplementId: params.supplementId,
      fingerprint: buildSupplementFingerprint({
        brandName: params.brandName,
        productName: params.productName,
        dosageText: params.dosageText,
      }),
    };
  }

  const barcodeCandidates = buildBarcodeCandidates(params.barcode);
  const fingerprint = buildSupplementFingerprint({
    brandName: params.brandName,
    productName: params.productName,
    dosageText: params.dosageText,
  });

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

const inflightPublicOverviewBySupplementId = new Map<string, Promise<EnsurePublicOverviewResult>>();

const ensurePublicOverview = async (params: {
  supplementId: string;
  productName: string;
  dosageText: string | null;
  brandName?: string | null;
  barcode?: string | null;
}): Promise<EnsurePublicOverviewResult> => {
  const inflight = inflightPublicOverviewBySupplementId.get(params.supplementId);
  if (inflight) return inflight;

  const promise = (async (): Promise<EnsurePublicOverviewResult> => {
  const { data, error } = await supabase
    .from("ai_analyses")
    .select("id")
    .eq("supplement_id", params.supplementId)
    .is("user_id", null)
    .limit(1)
    .maybeSingle();

  if (error && !isNotFoundError(error)) {
    console.warn("[ensure-overview] ai_analyses lookup failed", error.message);
    return { analysisReady: false, source: "none" };
  }

  if (data?.id) return { analysisReady: true, source: "cache" };

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

  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const contextLines: string[] = [`Product name: ${params.productName}`];
  const cleanedBrand = safeTrim(params.brandName) ?? null;
  if (cleanedBrand && cleanedBrand !== DEFAULT_BRAND_NAME) contextLines.push(`Brand: ${cleanedBrand}`);
  const cleanedBarcode = safeTrim(params.barcode) ?? null;
  if (cleanedBarcode) contextLines.push(`Barcode: ${cleanedBarcode}`);
  const cleanedDosage = safeTrim(params.dosageText) ?? null;
  if (cleanedDosage) contextLines.push(`Dosage: ${cleanedDosage}`);

  const deepseekOverview = deepseekKey
    ? deepseekBreaker.canRequest()
      ? await fetchMySupplementOverviewCard(contextLines.join("\n"), model, deepseekKey, {
          timeoutMs: MY_SUPP_OVERVIEW_TIMEOUT_MS,
          queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
          breaker: deepseekBreaker,
          semaphore: deepseekSemaphore,
        })
      : null
    : null;

  // If DeepSeek is configured, ONLY cache DeepSeek output.
  // Rule-based is used only when DeepSeek is not configured (local/dev environments).
  if (deepseekKey && !deepseekOverview) {
    return { analysisReady: false, source: "none" };
  }

  const overview = deepseekOverview
    ? {
        overviewSummary: normalizeTwoSentenceSummary(deepseekOverview.overviewSummary, ruleOverview.overviewSummary),
        coreBenefits: deepseekOverview.coreBenefits.length > 0 ? deepseekOverview.coreBenefits : ruleOverview.coreBenefits,
        timing: safeTrim(deepseekOverview.timing) ?? ruleOverview.timing,
        withFood: deepseekOverview.withFood,
        usageSummary: deepseekOverview.withFood ? "Take with food." : "Take on an empty stomach.",
      }
    : ruleOverview;

  // Ensure a stable shape even if DeepSeek returns an empty benefits list.
  overview.coreBenefits = overview.coreBenefits.filter(Boolean).slice(0, 3);
  if (overview.coreBenefits.length === 0) {
    overview.coreBenefits = ruleOverview.coreBenefits.slice(0, 3);
  }

  const analysisData = {
    efficacy: {
      score: 3 as RatingScore,
      benefits: overview.coreBenefits,
      dosageAssessment: {
        text: overview.usageSummary,
        isUnderDosed: false,
      },
      overviewSummary: overview.overviewSummary,
      coreBenefits: overview.coreBenefits,
    },
    usage: {
      timing: overview.timing,
      withFood: overview.withFood,
      summary: overview.usageSummary,
      conflicts: [],
      sourceType: "general_knowledge",
    },
  } satisfies Partial<AiSupplementAnalysis>;

  const { error: insertError } = await supabase.from("ai_analyses").insert({
    supplement_id: params.supplementId,
    user_id: null,
    analysis_data: analysisData,
  });

  if (insertError) {
    if (isUniqueViolation(insertError)) return { analysisReady: true, source: "cache" };
    console.warn("[ensure-overview] ai_analyses insert failed", insertError.message);
    return { analysisReady: false, source: "none" };
  }

  return {
    analysisReady: true,
    source: deepseekOverview ? "deepseek" : "rule",
    analysisData,
  };
  })();

  inflightPublicOverviewBySupplementId.set(params.supplementId, promise);
  try {
    return await promise;
  } finally {
    inflightPublicOverviewBySupplementId.delete(params.supplementId);
  }
};

const scoreSourceSchema = z.enum(["dsld", "lnhpd", "ocr", "manual"]);

const coerceScoreGoalFits = (value: unknown): ScoreGoalFit[] => {
  if (!Array.isArray(value)) return [];
  const output: ScoreGoalFit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const goal = (item as { goal?: unknown }).goal;
    const score = parseNumber((item as { score?: unknown }).score);
    if (typeof goal !== "string" || score == null) continue;
    const label = (item as { label?: unknown }).label;
    output.push({
      goal,
      score,
      label: typeof label === "string" ? label : undefined,
    });
  }
  return output;
};

const coerceScoreFlags = (value: unknown): ScoreFlag[] => {
  if (!Array.isArray(value)) return [];
  const output: ScoreFlag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const code = (item as { code?: unknown }).code;
    const message = (item as { message?: unknown }).message;
    if (typeof code !== "string" || typeof message !== "string") continue;
    const severity = (item as { severity?: unknown }).severity;
    output.push({
      code,
      message,
      severity:
        severity === "info" || severity === "warning" || severity === "risk"
          ? severity
          : undefined,
    });
  }
  return output;
};

const coerceScoreHighlights = (value: unknown): ScoreHighlight[] => {
  if (!Array.isArray(value)) return [];
  const output: ScoreHighlight[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const message = (item as { message?: unknown }).message;
    if (typeof message !== "string") continue;
    const code = (item as { code?: unknown }).code;
    output.push({
      message,
      code: typeof code === "string" ? code : undefined,
    });
  }
  return output;
};

const coerceScoreExplain = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * NuTri daily tips dataset
 */
app.get("/api/nutri-tips", async (_req: Request, res: Response) => {
  try {
    const data = await getNutriTipsData();
    return res.json({ success: true, data });
  } catch (error) {
    captureException(error, { route: "/api/nutri-tips" });
    console.error("/api/nutri-tips unexpected error", error);
    return res.status(500).json({ success: false, message: "Failed to load tips." });
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

/**
 * v4 score bundle (cached)
 */
app.get("/api/score/v4/:source/:id", verifySupabaseToken, async (req: Request, res: Response) => {
  const sourceParsed = scoreSourceSchema.safeParse(req.params.source);
  const sourceId = typeof req.params.id === "string" ? req.params.id.trim() : "";

  if (!sourceParsed.success || !sourceId) {
    return res
      .status(400)
      .json({ error: "invalid_request", detail: "Invalid score source or id" } satisfies ErrorResponse);
  }

  const source = sourceParsed.data;

  try {
    const selectScoreColumns =
      "source,source_id,canonical_source_id,score_version,overall_score,effectiveness_score,safety_score,integrity_score,confidence,best_fit_goals,flags_json,highlights_json,explain_json,inputs_hash,computed_at";
    const fetchScoreRow = async () => {
      const { data } = await supabase
        .from("product_scores")
        .select(selectScoreColumns)
        .eq("source", source)
        .eq("source_id", sourceId)
        .maybeSingle();
      if (data) return data;
      const { data: canonical } = await supabase
        .from("product_scores")
        .select(selectScoreColumns)
        .eq("source", source)
        .eq("canonical_source_id", sourceId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return canonical ?? null;
    };

    const [scoreRow, currentHash] = await Promise.all([
      fetchScoreRow(),
      computeV4InputsHash({ source, sourceId }),
    ]);
    const isCacheHit =
      scoreRow &&
      scoreRow.score_version === V4_SCORE_VERSION &&
      Boolean(scoreRow.inputs_hash) &&
      Boolean(currentHash) &&
      scoreRow.inputs_hash === currentHash;

    if (isCacheHit && scoreRow) {
      const bundle: ScoreBundleV4 = {
        overallScore: parseNumber(scoreRow.overall_score),
        pillars: {
          effectiveness: parseNumber(scoreRow.effectiveness_score),
          safety: parseNumber(scoreRow.safety_score),
          integrity: parseNumber(scoreRow.integrity_score),
        },
        confidence: parseNumber(scoreRow.confidence),
        bestFitGoals: coerceScoreGoalFits(scoreRow.best_fit_goals),
        flags: coerceScoreFlags(scoreRow.flags_json),
        highlights: coerceScoreHighlights(scoreRow.highlights_json),
        provenance: {
          source,
          sourceId,
          canonicalSourceId: scoreRow.canonical_source_id ?? null,
          scoreVersion: String(scoreRow.score_version),
          computedAt: String(scoreRow.computed_at),
          inputsHash: scoreRow.inputs_hash ?? null,
          datasetVersion: null,
          extractedAt: null,
        },
        explain: coerceScoreExplain(scoreRow.explain_json),
      };

      const response: ScoreBundleResponse = {
        status: "ok",
        source,
        sourceId,
        bundle,
      };
      return res.json(response);
    }

    const computed = await computeScoreBundleV4({ source, sourceId });
    if (computed) {
      const { bundle, inputsHash, canonicalSourceId, sourceIdForWrite } = computed;
      const scorePayload = {
        source,
        source_id: sourceIdForWrite,
        canonical_source_id: canonicalSourceId,
        score_version: V4_SCORE_VERSION,
        overall_score: bundle.overallScore,
        effectiveness_score: bundle.pillars.effectiveness,
        safety_score: bundle.pillars.safety,
        integrity_score: bundle.pillars.integrity,
        confidence: bundle.confidence,
        best_fit_goals: bundle.bestFitGoals,
        flags_json: bundle.flags,
        highlights_json: bundle.highlights,
        explain_json: bundle.explain,
        inputs_hash: inputsHash,
        computed_at: bundle.provenance.computedAt,
      };
      const { error: upsertError } = await supabase
        .from("product_scores")
        .upsert(scorePayload, { onConflict: "source,source_id" });
      if (upsertError) {
        console.warn("[ScoreV4] Upsert failed", upsertError.message);
      }
      const response: ScoreBundleResponse = {
        status: "ok",
        source,
        sourceId,
        bundle,
      };
      return res.json(response);
    }

    const { data: ingredientRow, error: ingredientError } = await supabase
      .from("product_ingredients")
      .select("id")
      .eq("source", source)
      .eq("source_id", sourceId)
      .limit(1)
      .maybeSingle();

    if (ingredientError) {
      throw ingredientError;
    }

    let hasIngredients = Boolean(ingredientRow?.id);
    if (!hasIngredients) {
      const { data: canonicalIngredientRow, error: canonicalIngredientError } = await supabase
        .from("product_ingredients")
        .select("id")
        .eq("source", source)
        .eq("canonical_source_id", sourceId)
        .limit(1)
        .maybeSingle();
      if (canonicalIngredientError) {
        throw canonicalIngredientError;
      }
      hasIngredients = Boolean(canonicalIngredientRow?.id);
    }

    const status: ScoreBundleResponse["status"] = hasIngredients ? "pending" : "not_found";
    const response: ScoreBundleResponse = {
      status,
      source,
      sourceId,
    };
    return res.json(response);
  } catch (error) {
    captureException(error, { route: "/api/score/v4" });
    console.error("/api/score/v4 unexpected error", error);
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

/**
 * On-demand analysis section endpoint (ingredients detail)
 */
app.post("/api/analysis-section", verifySupabaseToken, async (req: Request, res: Response) => {
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

  const { identity, section, locale, promptVersion, factsDigestHash } = parsedBody;
  const rawRequestedLimit = Math.min(
    Math.max(parsedBody.limit ?? ANALYSIS_DETAIL_LIMIT_DEFAULT, 1),
    ANALYSIS_DETAIL_LIMIT_MAX,
  );
  const cursor = Math.max(0, parsedBody.cursor ?? 0);
  const requestId = String(res.getHeader("x-request-id") ?? "");

  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;

  const digestRow = await getAnalysisIdentityCache(
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
    res.status(404).json({ error: "facts_digest_missing" } satisfies ErrorResponse);
    return;
  }

  const digest = digestRow.facts_digest_json as FactsDigest;
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

	  // Rate limiting is for end-users. CI/regression calls can legitimately issue many requests in a tight window
	  // (primary+fallback barcodes, pagination, retries). Don't allow the limiter to introduce flaky 429s in CI.
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
	        // End-user UX: never return 429 for analysis-section. The client can accidentally spam this endpoint
	        // (open/close modal, retries, auto-refresh) and a hard 429 results in blank cards.
	        // Instead: return a cheap limited response (no LLM) and tell the UI when to retry.
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
	              fallbackUsed: "skeleton",
	              fallbackReason: "rate_limited",
	              retryAfterMs: retryAfterSec * 1000,
	              requestId,
	            },
	            timingMs: 0,
	          });
	          return;
	        }

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
        fallbackReason: "deepseek_api_key_missing",
      },
      timingMs: 0,
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
    { timeoutMs: 800 },
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
            factsDigestJson: cachedDetail.facts_digest_json ?? digestRow.facts_digest_json,
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
        hideDsldFallbackMarker ? "complete" : cachedFallback || dsldTreatAsLimited ? "limited" : "complete",
      page: buildDetailPage(Array.isArray(detailPayload.items) ? detailPayload.items.length : cachedItemsCount),
      meta: {
        bundleId: randomUUID(),
        revision: 2,
        factsDigestHash,
        fallbackUsed: hideDsldFallbackMarker ? undefined : cachedFallback ?? undefined,
        fallbackReason: hideDsldFallbackMarker
          ? undefined
          : cachedFallback
            ? cachedDetail.last_error ?? cachedDetail.error_code ?? null
            : undefined,
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
        factsSourceVersion: digestRow.facts_source_version ?? "",
        sectionKey,
        rateKey,
        digestRowFactsDigestJson: digestRow.facts_digest_json,
        digest,
        requestedLimit,
        cursor,
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        deepseekKey,
      });
    }
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
          fallbackReason: "job_pending",
          requestId,
        },
        timingMs: 0,
      });
      return;
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
        factsSourceVersion: digestRow.facts_source_version ?? "",
        section: sectionKey,
        status: "running",
        attempts,
        lockedUntil: lockUntil,
        factsDigestJson: digestRow.facts_digest_json,
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
      whatItDoes: { text: "Not provided by source.", basisTags: ["not_provided"] satisfies BasisTag[] },
      doseContext: { text: "Not provided by source.", basisTags: ["not_provided"] satisfies BasisTag[] },
      chemicalFormExplain: { text: "Chemical form not provided by source.", basisTags: ["not_provided"] satisfies BasisTag[] },
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

  const detailStatus: "complete" | "error" = detailPayload ? "complete" : "error";
  const detailDataStatus = fallbackUsed ? "limited" : detailPayload ? "complete" : "error";
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
      factsSourceVersion: digestRow.facts_source_version ?? "",
      section: sectionKey,
      status: detailStatus,
      payload: detailPayload,
      factsDigestJson: digestRow.facts_digest_json,
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
      fallbackReason: fallbackReason ?? undefined,
      whatItDoesStatus: isDsldDetail ? dsldWhatItDoesStatus : undefined,
      whatItDoesReason: isDsldDetail && dsldWhatItDoesStatus !== "llm" ? dsldWhatItDoesReason : undefined,
    },
    timingMs,
    debug: debugPayload,
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
	  const normalized = normalizeBarcodeInput(rawBarcode);
	  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
	  const acceptLanguageHeader =
	    typeof req.headers["accept-language"] === "string" ? req.headers["accept-language"] : null;
	  const locale = resolveLocale(acceptLanguageHeader);
  const bundleId = randomUUID();
  let finishInFlight: ((error?: unknown) => void) | null = null;
  let catalogSnapshotForAi: SupplementSnapshot | null = null;
  let catalogAnalysisPayloadForAi: SnapshotAnalysisPayload | null = null;
  let catalogLabelExtractionForAi: LabelExtractionMeta | null = null;
  let catalogLabelFactsForAi: LabelFacts | null = null;

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Default to a short keepalive because some mobile SSE polyfills time out aggressively.
  // Can be overridden via SSE_KEEPALIVE_MS (min 5000ms).
  const keepAliveMsRaw = Number(process.env.SSE_KEEPALIVE_MS ?? "5000");
  const keepAliveMs =
    Number.isFinite(keepAliveMsRaw) && keepAliveMsRaw >= 5000 ? keepAliveMsRaw : 15000;
  const keepAlive = setInterval(() => {
    if (res.writableEnded) return;
    // Some SSE clients (notably certain React Native polyfills) do not tolerate comment keepalives (": ping").
    // Use a standard SSE event instead so both mobile clients and our CI parsers stay stable.
    res.write("event: keepalive\n");
    res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
  }, keepAliveMs);
  (keepAlive as any).unref?.();
  const clearKeepAlive = () => clearInterval(keepAlive);
  res.on("close", clearKeepAlive);
  res.on("finish", clearKeepAlive);

  try {
    if (!normalized) {
      sendSSE(res, "error", { message: "Invalid barcode provided" });
      res.end();
      return;
    }
    const barcode = normalized.code;
    const cacheKey = buildBarcodeCacheKey(barcode);
    const barcodeGtin14 = normalized.code.padStart(14, "0");
    const barcodeRawDigits = normalized.code;

    let regulatoryMapStatus: "hit" | "stale" | "miss" | "timeout" = "miss";
    let npnCandidateSource: "map" | "snapshot" | "web" | null = null;
    let npnCandidateStale = false;
    let npnNegativeCacheHit = false;
    let lnhpdGuardrailScore: number | null = null;
    let lnhpdGuardrailPass: boolean | null = null;
    let lnhpdFetchStatus: "success" | "not_found" | "timeout" | "error" | null = null;

    const startedAt = performance.now();
    const budget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
    const requestAbort = createRequestAbort(res);
    const requestId = String(res.getHeader("x-request-id") ?? "");
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
    const requestSignal = requestAbort.signal;
    const buildAuthorityMeta = (extra?: Record<string, unknown>) => ({
      regulatory_map_status: regulatoryMapStatus,
      npn_candidate_source: npnCandidateSource,
      npn_candidate_stale: npnCandidateStale,
      npn_negative_cache_hit: npnNegativeCacheHit,
      lnhpd_guardrail_score: lnhpdGuardrailScore,
      lnhpd_guardrail_pass: lnhpdGuardrailPass,
      lnhpd_fetch_status: lnhpdFetchStatus,
      ...(extra ?? {}),
    });

    const emitAnalysisBundleSequence = async (params: {
      digest: FactsDigest;
      identityType: FactsDigest["identity"]["type"];
      identityValue: string;
      factsSourceVersion: string;
      allowAi: boolean;
      apiKey: string | null;
      signal?: AbortSignal;
      llmSignal?: AbortSignal;
    }): Promise<{ factsDigestHash: string } | null> => {
      const factsDigestHash = computeFactsDigestHash(params.digest);
      const canWrite = () => !params.signal?.aborted && !res.writableEnded;
      const dataStatus = params.allowAi
        ? { overview: "pending" as const, usage: "pending" as const, safety: "pending" as const }
        : { overview: "limited" as const, usage: "limited" as const, safety: "limited" as const };

      const skeleton = buildAnalysisBundleSkeleton({
        digest: params.digest,
        bundleId,
        revision: 0,
        phase: "skeleton",
        locale,
        factsDigestHash,
        factsSourceVersion: params.factsSourceVersion,
        identityType: params.identityType,
        identityValue: params.identityValue,
        dataStatus,
      });

      void upsertAnalysisIdentityCache(
        {
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale,
          promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION,
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
      if (skeletonParsed.success && canWrite()) {
        sendSSE(res, "analysis_bundle", skeletonParsed.data);
      } else {
        console.warn("[analysis_bundle] skeleton validation failed", skeletonParsed.error?.message);
      }

      const cachedFast = await getAnalysisIdentityCache(
        {
          identityType: params.identityType,
          identityValue: params.identityValue,
          locale,
          promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION,
          factsDigestHash,
          section: "bundle_fast",
        },
        { timeoutMs: 700 },
      ).catch(() => null);

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
        fastCandidate = applyDsldInferenceGuard(fastCandidate, params.digest);
        const parsed = safeParseAnalysisBundle(fastCandidate);
        if (parsed.success && canWrite()) {
          sendSSE(res, "analysis_bundle", parsed.data);
          return { factsDigestHash };
        }
      }

      const context = `FACTS_DIGEST_JSON: ${JSON.stringify(params.digest)}`;
      const canUseAi = params.allowAi && Boolean(params.apiKey);
      let fastRaw: Record<string, unknown> | null = null;
      let fastFailed = false;
      let fastBundle: AnalysisBundle | null = null;
      try {
        if (canUseAi && params.apiKey) {
          const combined = params.llmSignal ? combineSignals([params.signal, params.llmSignal]) : null;
          const llmSignal = combined?.signal ?? params.signal;
          try {
            fastRaw = await fetchAnalysisBundleFastV3(context, model, params.apiKey, {
              breaker: deepseekBreaker,
              semaphore: deepseekSemaphore,
              timeoutMs: ANALYSIS_BUNDLE_FAST_TIMEOUT_MS,
              queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
              retry: { maxAttempts: 1 },
              signal: llmSignal,
            });
          } catch (error) {
            console.warn("[analysis_bundle] fast generation failed", error);
            fastFailed = true;
          } finally {
            combined?.cleanup();
          }
          if (!fastRaw) fastFailed = true;
        } else {
          fastFailed = true;
        }

        let fastCandidate = mergeFastAnalysisBundle({ skeleton, digest: params.digest, fastOutput: fastRaw });
        if (fastFailed) {
          fastCandidate = applyFastFailureStatus(fastCandidate);
        }
        let parsed = safeParseAnalysisBundle(fastCandidate);
        if (!parsed.success) {
          const fallbackCandidate = applyFastFailureStatus(
            mergeFastAnalysisBundle({ skeleton, digest: params.digest, fastOutput: null }),
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
          mergeFastAnalysisBundle({ skeleton, digest: params.digest, fastOutput: null }),
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
        sendSSE(res, "analysis_bundle", adjustedBundle);
        void upsertAnalysisIdentityCache(
          {
            identityType: params.identityType,
            identityValue: params.identityValue,
            locale,
            promptVersion: ANALYSIS_BUNDLE_PROMPT_VERSION,
            factsDigestHash,
            factsSourceVersion: params.factsSourceVersion,
            section: "bundle_fast",
            status: "complete",
            payload: adjustedBundle,
            factsDigestJson: params.digest,
            expiresAt: new Date(Date.now() + ANALYSIS_IDENTITY_CACHE_TTL_MS).toISOString(),
          },
          { timeoutMs: 900 },
        );
      }

      return { factsDigestHash };
    };
    let stage0BundlePromise: Promise<{ factsDigestHash: string } | null> | null = null;
    let stage0BundleAbort: AbortController | null = null;
    const awaitStage0Bundle = async () => {
      if (!stage0BundlePromise) return;
      try {
        await abortable(stage0BundlePromise.catch(() => null), requestSignal);
      } catch {
        // ignore (client disconnect)
      }
    };
    let stage1BundlePromise: Promise<{ factsDigestHash: string } | null> | null = null;
    let stage1BundleAbort: AbortController | null = null;
    const awaitStage1Bundle = async () => {
      if (!stage1BundlePromise) return;
      try {
        await abortable(stage1BundlePromise.catch(() => null), requestSignal);
      } catch {
        // ignore (client disconnect)
      }
    };
    const awaitAnalysisBundle = async () => {
      if (stage1BundlePromise) {
        await awaitStage1Bundle();
        return;
      }
      await awaitStage0Bundle();
    };
    const startStage0Bundle = (
      params: Omit<Parameters<typeof emitAnalysisBundleSequence>[0], "signal" | "llmSignal">,
    ) => {
      stage0BundleAbort?.abort(new Error("fast_bundle_replaced"));
      stage0BundleAbort = new AbortController();
      stage0BundlePromise = emitAnalysisBundleSequence({
        ...params,
        signal: requestSignal,
        llmSignal: stage0BundleAbort.signal,
      });
    };
    const startStage1Bundle = (
      params: Omit<Parameters<typeof emitAnalysisBundleSequence>[0], "signal" | "llmSignal">,
    ) => {
      // Hard rule: only emit ONE analysis_bundle sequence per request.
      // If Stage 0 already started (skeleton+fast), Stage 1 must not re-emit revision 0/1.
      if (stage0BundlePromise) return;
      stage1BundleAbort?.abort(new Error("fast_bundle_replaced"));
      stage1BundleAbort = new AbortController();
      stage1BundlePromise = emitAnalysisBundleSequence({
        ...params,
        signal: requestSignal,
        llmSignal: stage1BundleAbort.signal,
      });
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

    const shouldPreferExtractedBrand = (
      brandExtraction?: SnapshotAnalysisPayload["brandExtraction"] | null,
    ) =>
      Boolean(brandExtraction?.brand) &&
      (brandExtraction?.confidence === "high" || brandExtraction?.confidence === "medium");

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
	      console.log(`[Stream] Cache hit for barcode: ${barcode}`);
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

      const fallbackScore = (value: number | undefined) =>
        typeof value === "number" ? Math.round(value / 10) : 5;

      const fallbackEfficacy = snapshot.scores
        ? {
          score: fallbackScore(snapshot.scores.effectiveness),
          verdict: "Cached snapshot analysis.",
          primaryActive: null,
          ingredients: [],
          overviewSummary: null,
          coreBenefits: [],
          overallAssessment: "",
          marketingVsReality: "",
        }
        : null;

      const fallbackSafety = snapshot.scores
        ? {
          score: fallbackScore(snapshot.scores.safety),
          verdict: "Cached snapshot analysis.",
          risks: [],
          redFlags: [],
          recommendation: "Cached snapshot analysis.",
        }
        : null;

      const fallbackUsagePayload = snapshot.scores
        ? {
          usage: {
            summary: "Cached snapshot analysis.",
            timing: "",
            withFood: null,
            frequency: "",
            interactions: [],
          },
          value: {
            score: fallbackScore(snapshot.scores.value),
            verdict: "Cached snapshot analysis.",
            analysis: "Cached snapshot analysis.",
            costPerServing: null,
            alternatives: [],
          },
          social: {
            score: 3,
            summary: "Cached snapshot analysis.",
          },
        }
        : null;

	      if (mode === "full") {
	        if (workingAnalysisPayload?.efficacy || fallbackEfficacy) {
	          sendSSE(res, "result_efficacy", workingAnalysisPayload?.efficacy ?? fallbackEfficacy);
	        }
	        if (workingAnalysisPayload?.safety || fallbackSafety) {
	          sendSSE(res, "result_safety", workingAnalysisPayload?.safety ?? fallbackSafety);
	        }
	        if (workingAnalysisPayload?.usagePayload || fallbackUsagePayload) {
	          sendSSE(res, "result_usage", workingAnalysisPayload?.usagePayload ?? fallbackUsagePayload);
	        }

	        sendSSE(res, "snapshot", snapshotToSend);
	      }
	    };

    const catalogPromise = resolveCatalogByBarcode(normalized, {
      ...supabaseReadResilience,
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
    type Stage0Source = "none" | "snapshot" | "catalog" | "lnhpd";
    let stage0Delivered = false;
    let stage0Source: Stage0Source = "none";

	    const cachedFast = await snapshotPromise.catch(() => null);
	    if (cachedFast) {
      const hasProductName = Boolean(
        cachedFast.analysisPayload?.productInfo?.name || cachedFast.snapshot.product.name,
      );
      const needsCatalogFast = !hasProductName || !cachedFast.snapshot.regulatory.dsldLabelId;
      const catalogFast = needsCatalogFast ? await catalogPromise.catch(() => null) : null;
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
          cachedFast.snapshot.analysis?.labelExtraction?.source
          ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.source
          ?? null;
        const snapshotLabelVersion =
          cachedFast.snapshot.analysis?.labelExtraction?.datasetVersion
          ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.datasetVersion
          ?? cachedFast.snapshot.analysis?.labelExtraction?.fetchedAt
          ?? null;

        const snapshotNpn = cachedFast.snapshot.regulatory.npn ?? null;
        const snapshotNpnStatus = cachedFast.snapshot.regulatory.npnStatus ?? null;
        const snapshotVerifiedBy = cachedFast.snapshot.regulatory.npnVerifiedBy ?? null;
        const snapshotIsVerified =
          snapshotNpnStatus === "verified" &&
          snapshotVerifiedBy === "lnhpd_fetch" &&
          Boolean(snapshotNpn);

        if (!snapshotIsVerified) {
          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = "snapshot:unknown";

          // Prefer DSLD identity when present.
          const dsldLabelIdRaw = cachedFast.snapshot.regulatory.dsldLabelId;
          if ((snapshotLabelSource === "dsld" || snapshotLabelSource === "label_scan") && dsldLabelIdRaw) {
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
        cachedFast.snapshot.regulatory.npnStatus === "verified" &&
        cachedFast.snapshot.regulatory.npnVerifiedBy === "lnhpd_fetch";

      const snapshotVerifiedNpn = cachedFast.snapshot.regulatory.npn;
      const snapshotVerifiedBy = cachedFast.snapshot.regulatory.npnVerifiedBy;
      const snapshotNpnStatus = cachedFast.snapshot.regulatory.npnStatus;
      if (snapshotVerifiedNpn && snapshotVerifiedBy === "lnhpd_fetch" && snapshotNpnStatus === "verified") {
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
            cachedFast.snapshot.analysis?.labelExtraction?.source
            ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.source
            ?? null;
          const snapshotLabelVersion =
            cachedFast.snapshot.analysis?.labelExtraction?.datasetVersion
            ?? cachedFast.analysisPayload?.analysis?.labelExtraction?.datasetVersion
            ?? cachedFast.snapshot.analysis?.labelExtraction?.fetchedAt
            ?? null;
          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = "snapshot:unknown";

          if ((snapshotLabelSource === "lnhpd" || snapshotLabelSource === "manual") && snapshotVerifiedNpn) {
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
            if ((snapshotLabelSource === "dsld" || snapshotLabelSource === "label_scan") && dsldLabelIdRaw && Number.isFinite(dsldLabelId)) {
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
          allowAi: Boolean(deepseekKey),
          apiKey: deepseekKey,
        });
            await awaitStage0Bundle();
          }

          sendSSE(res, "done", { barcode });
          res.end();

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
    const catalog = await catalogPromise.catch(() => null);

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
      const analysisMeta = buildAnalysisMeta({ status: analysisStatus, labelExtraction });

      workingSnapshot = {
        ...workingSnapshot,
        analysis: analysisMeta,
        updatedAt: nowIso(),
      };

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
        sendSSE(res, "done", { barcode });
        res.end();
        return;
      }
	      console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after catalog hit");
	    }

	    // =========================================================================
	    // Stage 0: LNHPD bootstrap (first-party resolver)
	    // =========================================================================
	    // Hard rule: Stage 1 web resolution must not start (or short-circuit) before we
	    // give first-party resolvers (A/Catalog/LNHPD) a chance to terminate.
	    let regulatoryMap: Awaited<ReturnType<typeof getBarcodeRegulatoryMap>> | null = null;
	    try {
	      regulatoryMap = await regulatoryMapPromise;
	    } catch (error) {
	      regulatoryMapStatus = "timeout";
	      console.warn("[ResolutionV2] Regulatory map lookup failed", error);
	    }

	    const { candidate, mapStatus } = resolveAuthorityCandidate({
	      regulatoryMap,
	      snapshot: cachedFast?.snapshot ?? null,
	    });
	    if (regulatoryMapStatus !== "timeout") {
	      regulatoryMapStatus = mapStatus;
	    }

	    if (candidate) {
	      npnCandidateSource = candidate.source === "snapshot" ? "snapshot" : "map";
	      npnCandidateStale = candidate.isStale;

	      const npnNegative = await getNpnNegativeCache(candidate.npn, {
	        ...supabaseReadResilience,
	        timeoutMs: 250,
	      }).catch(() => null);
	      if (npnNegative) {
	        npnNegativeCacheHit = true;
	      } else {
	        const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
	        const { signal: lnhpdSignal, cleanup } = combineSignals([requestSignal, lnhpdTimeoutSignal]);
	        try {
	          const lnhpdFacts = await fetchLnhpdFactsByNpn(candidate.npn, lnhpdSignal);
	          const timedOut = lnhpdTimeoutSignal.aborted;

	          if (lnhpdFacts) {
	            lnhpdFetchStatus = "success";

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
                allowAi: Boolean(deepseekKey),
                apiKey: deepseekKey,
              });

	              const analysisStatus = buildAnalysisStatus({
	                hasLabelFacts: hasLabelFacts(lnhpdSnapshot),
	                hasAi: hasAiPayload(lnhpdAnalysisPayload),
	                dsldLabelId: null,
	              });
	              const analysisMeta = buildAnalysisMeta({ status: analysisStatus, labelExtraction });
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
	                sendSSE(res, "done", { barcode });
	                res.end();
	                return;
	              }
	              console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after LNHPD map hit");
	            }
	          } else {
	            lnhpdFetchStatus = timedOut ? "timeout" : "not_found";
	            if (lnhpdFetchStatus === "not_found") {
	              void upsertBarcodeRegulatoryMap({
	                barcodeGtin14,
	                npn: candidate.npn,
	                confidence: 0.2,
	                source: "lnhpd_not_found",
	                expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
	                barcodeRaw: rawBarcode,
	              });
	            }

	            if (lnhpdFetchStatus === "timeout" || lnhpdFetchStatus === "not_found") {
	              void recordNpnNegativeAttempt(
	                {
	                  npn: candidate.npn,
	                  reasonCode: lnhpdFetchStatus === "timeout" ? "lnhpd_timeout" : "lnhpd_not_found",
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
	          console.warn("[ResolutionV2] LNHPD fetch failed", error);
	        } finally {
	          cleanup();
	        }
	      }
	    }

	    const aiRequired = !catalog;

    if (!googleApiKey || !cx) {
      if (aiRequired) {
        sendSSE(res, "error", { message: "Google CSE not configured" });
        res.end();
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
      sendSSE(res, "done", { barcode });
      res.end();
      return;
    }

    if (!deepseekKey) {
      if (aiRequired) {
        sendSSE(res, "error", { message: "DeepSeek API key missing" });
        res.end();
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
      sendSSE(res, "done", { barcode });
      res.end();
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
      } catch {}

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
            after.snapshot.analysis?.labelExtraction?.source ??
            after.analysisPayload?.analysis?.labelExtraction?.source ??
            null;
          const snapshotLabelVersion =
            after.snapshot.analysis?.labelExtraction?.datasetVersion ??
            after.analysisPayload?.analysis?.labelExtraction?.datasetVersion ??
            after.snapshot.analysis?.labelExtraction?.fetchedAt ??
            null;

          let digest: FactsDigest | null = null;
          let identityType: FactsDigest["identity"]["type"] = "gtin14";
          let identityValue = barcodeGtin14;
          let factsSourceVersion = `snapshot:${snapshotLabelSource ?? "unknown"}`;

          const snapshotNpn = after.snapshot.regulatory.npn ?? null;
          if ((snapshotLabelSource === "lnhpd" || snapshotLabelSource === "manual") && snapshotNpn) {
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
            (snapshotLabelSource === "dsld" || snapshotLabelSource === "label_scan") &&
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
              allowAi: Boolean(deepseekKey),
              apiKey: deepseekKey,
            });
          }
        }

	        emitCachedSnapshot(after, null, streamAnalysisBundleOnly ? { mode: "analysis_bundle_only" } : undefined);
	        await awaitAnalysisBundle();
	        sendSSE(res, "done", { barcode });
	        res.end();
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
    console.log(`[Stream] Starting analysis for barcode: ${barcode}`);

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

    const clearNegative = (): void => {
      void clearNegativeCache(barcodeGtin14, { ...supabaseReadResilience, timeoutMs: 500 });
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
      const mergedSignals = {
        ...baseSignals,
        background_backfill_started: backgroundBackfillQueued,
        secondary_backfill_started: secondaryBackfillQueued,
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

        const extractMetaContentSecondary = (html: string, key: string): string | null => {
          const regex = new RegExp(
            `<meta[^>]+(?:property|name)=[\"']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
            "i",
          );
          const match = html.match(regex);
          const value = match?.[1]?.trim();
          return value ? value : null;
        };

        const extractJsonLdSecondary = (html: string): SecondaryEvidence["jsonLd"] => {
          const scripts = Array.from(
            html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
          );
          let name: string | null = null;
          let brand: string | null = null;
          const images: string[] = [];
          let sku: string | null = null;
          let gtin: string | null = null;
          let hasProduct = false;
          let gtinMatch = false;

          for (const match of scripts) {
            const payload = (match[1] ?? "").trim();
            if (!payload) continue;
            const lower = payload.toLowerCase();
            if (lower.includes("product")) {
              hasProduct = true;
            }
            const digits = payload.replace(/\D/g, "");
            if (barcodeVariants.some((code) => digits.includes(code))) {
              gtinMatch = true;
            }

            try {
              const parsed = JSON.parse(payload) as unknown;
              const stack: unknown[] = [parsed];
              while (stack.length) {
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
        };

        const extractNpnFromTextSecondary = (text: string): string | null => {
          const match = text.match(/\bNPN\s*[:#]?\s*(\d{8})\b/i);
          return match?.[1] ?? null;
        };

        const extractMpnFromTextSecondary = (text: string): string | null => {
          const match = text.match(/\bMPN\s*[:#]?\s*([A-Z0-9\-]{3,})\b/i);
          return match?.[1] ?? null;
        };

        const normalizeGtinCandidateSecondary = (value: string): string | null => {
          const digits = value.replace(/\D/g, "");
          if (!digits) return null;
          if (digits.length < 8 || digits.length > 14) return null;
          return digits;
        };

        const extractGtinCandidatesFromTextSecondary = (text: string): string[] => {
          if (!text) return [];
          const matches = new Set<string>();
          const regex = /\b(?:UPC|GTIN|EAN|JAN|UPC-A|UPCA)\s*[:#]?\s*([0-9][0-9\-\s]{6,24})\b/gi;
          let match: RegExpExecArray | null = null;
          while ((match = regex.exec(text)) !== null) {
            const candidate = normalizeGtinCandidateSecondary(match[1] ?? "");
            if (candidate) matches.add(candidate);
          }
          return Array.from(matches);
        };

        const extractTitleTagSecondary = (html: string): string | null => {
          const match = html.match(/<title[^>]*>([^<]{2,200})<\/title>/i);
          const value = match?.[1]?.replace(/\s+/g, " ").trim();
          return value ? value : null;
        };

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
          try {
            const readResponseText = async (response: globalThis.Response): Promise<string> => {
              const reader = response.body?.getReader();
              if (!reader) {
                const rawText = await response.text();
                return rawText.slice(0, maxBytes);
              }
              const chunks: Uint8Array[] = [];
              let received = 0;
              while (received < maxBytes) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!value) continue;
                const remaining = maxBytes - received;
                chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
                received += Math.min(value.length, remaining);
                if (received >= maxBytes) {
                  try {
                    await reader.cancel();
                  } catch {}
                  break;
                }
              }
              const buffer = Buffer.concat(chunks);
              return buffer.toString("utf8");
            };

            const attemptFetch = async (useRange: boolean) => {
              const headers: Record<string, string> = {
                "User-Agent": BROWSER_UA,
                Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
              };
              if (useRange) {
                headers.Range = `bytes=0-${Math.max(0, maxBytes - 1)}`;
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
            cleanup();
            release?.();
          }
        };

        const cheapPassSecondary = async (
          rawUrl: string,
          seedMatch?: SecondarySeedMatch | null,
        ): Promise<SecondaryEvidence | null> => {
          const prefix = await fetchTextPrefixSecondary(
            rawUrl,
            SECONDARY_CHEAP_PASS_MAX_BYTES,
            SECONDARY_CHEAP_PASS_TIMEOUT_MS,
          );
          if (!prefix || !prefix.ok) return null;
          const contentType = prefix.contentType || "";
          const lowerType = contentType.toLowerCase();
          const onlyImages =
            lowerType.includes("image/") ||
            lowerType.includes("application/pdf") ||
            lowerType.includes("application/octet-stream");
          const text = prefix.text ?? "";
          const digits = text.replace(/\D/g, "");
          const barcodeHitCount = barcodeVariants.reduce((sum, code) => sum + countOccurrences(digits, code), 0);
          const jsonLd = extractJsonLdSecondary(text);
          const metaOgTitle = extractMetaContentSecondary(text, "og:title");
          const titleTag = extractTitleTagSecondary(text);
          const metaBrand =
            extractMetaContentSecondary(text, "product:brand") ?? extractMetaContentSecondary(text, "og:site_name");
          const hasTitleEvidence = Boolean(metaOgTitle || titleTag || jsonLd.name || metaBrand);

          const npnCandidate = extractNpnFromTextSecondary(text);
          const mpnCandidate = extractMpnFromTextSecondary(text);
          const gtinCandidatesSet = new Set<string>();
          for (const candidate of extractGtinCandidatesFromTextSecondary(text)) {
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
            /please enable javascript|enable javascript|requires javascript|turn on javascript/i.test(text) ||
            (text.includes("<script") &&
              !text.includes("ingredients") &&
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

          const pageText = `${metaOgTitle ?? ""} ${titleTag ?? ""} ${jsonLd.name ?? ""} ${text}`.toLowerCase();
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
        ): string | null => {
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
            /\b(?:ingredients|other ingredients|medicinal ingredients|non-?medicinal ingredients|supplement facts)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
          ]);
          const directionsText = extractSectionSecondary(extractedText, [
            /\b(?:directions|suggested use|dosage)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
          ]);
          const warningsText = extractSectionSecondary(extractedText, [
            /\b(?:warning|warnings|caution|contraindications)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
          ]);
          const servingSizeText = extractSectionSecondary(
            extractedText,
            [/\b(?:serving size|amount per serving)\b\s*[:\-]?\s*([\s\S]{10,200})/i],
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

        const npnSeed = await tryMarketplaceNpn();
        if (npnSeed?.npn) {
          npnCandidate = npnSeed.npn;
          npnSourceUrl = npnSeed.sourceUrl;
          npnCandidateSource = "web";
          npnCandidateStale = false;
          const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
          const { signal: lnhpdSignal, cleanup } = combineSignals([lnhpdTimeoutSignal]);
          try {
            const lnhpdFacts = await fetchLnhpdFactsByNpn(npnCandidate, lnhpdSignal);
            const timedOut = lnhpdTimeoutSignal.aborted;
            if (lnhpdFacts) {
              lnhpdFetchStatus = "success";
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
              const analysisMeta = buildAnalysisMeta({ status: analysisStatus, labelExtraction });
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

              void clearNegativeCache(barcodeGtin14, supabaseWriteResilience);
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
              lnhpdFetchStatus = timedOut ? "timeout" : "not_found";
              npnLookupFailed = true;
              if (lnhpdFetchStatus === "not_found") {
                void upsertBarcodeRegulatoryMap({
                  barcodeGtin14,
                  npn: npnCandidate,
                  confidence: 0.2,
                  source: "lnhpd_not_found",
                  expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
                  barcodeRaw: rawBarcode,
                });
              }
              if (lnhpdFetchStatus === "timeout" || lnhpdFetchStatus === "not_found") {
                void recordNpnNegativeAttempt(
                  {
                    npn: npnCandidate,
                    reasonCode: lnhpdFetchStatus === "timeout" ? "lnhpd_timeout" : "lnhpd_not_found",
                    windowMs: NPN_NEGATIVE_CACHE_WINDOW_HOURS * 60 * 60 * 1000,
                    threshold: NPN_NEGATIVE_CACHE_THRESHOLD,
                    ttlMs: NPN_NEGATIVE_CACHE_TTL_MS,
                  },
                  { ...supabaseReadResilience, timeoutMs: 500 },
                );
              }
            }
          } finally {
            cleanup();
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
                  .slice(0, SECONDARY_DEEP_FETCH_MAX_PAGES);

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

                        void clearNegativeCache(barcodeGtin14, supabaseWriteResilience);
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
          sendSSE(res, "error", { message: "Product not found" });
          res.end();
        } else {
          sendSSE(res, "done", { barcode });
          res.end();
        }
      } else {
        sendSSE(res, "done", { barcode });
        res.end();
      }
      finishInFlight?.();
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
          sendSSE(res, "error", { message: "Product not found" });
          res.end();
        } else {
          sendSSE(res, "done", { barcode });
          res.end();
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
        finishInFlight?.(new Error("negative_cache"));
        return;
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
	          const stopReason = hedged.hardStop ? (hedged.errors[0] ?? null) : null;
	          const reasonCode =
	            stopReason === "BUDGET_EXHAUSTED" || stopReason === "BREAKER_OPEN" || stopReason === "TIMEOUT"
	              ? stopReason
	              : "NO_SERP";
	          try {
	            await writeNegative(reasonCode);
	          } catch {}
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
            sendSSE(res, "error", { message: "Product not found" });
            res.end();
          } else {
            sendSSE(res, "done", { barcode });
            res.end();
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
          finishInFlight?.(new Error("product_not_found"));
          return;
        }
      }
    }

    const marketplaceOnly =
      initialItems.length > 0 &&
      initialItems.every((item) => isMarketplaceDomain(extractDomain(item.link)));

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

      const analysisContext = `Return json only.
PRODUCT_FACTS_JSON: ${JSON.stringify(fallbackFacts)}
EVIDENCE_SNIPPETS_JSON: ${JSON.stringify(evidenceSnippets)}
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
      const shouldQueueBackfill =
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
        fallbackNeedsAuthoritativeBackfill || (!isCaRegion && marketplaceOnly);
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
      sendSSE(res, "done", { barcode });
      res.end();
      finishInFlight?.();
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

    const extractMetaContent = (html: string, key: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]+(?:property|name)=[\"']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
        "i",
      );
      const match = html.match(regex);
      const value = match?.[1]?.trim();
      return value ? value : null;
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

    const extractJsonLd = (html: string): JsonLdExtract => {
      const scripts = Array.from(
        html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
      );
      let name: string | null = null;
      let brand: string | null = null;
      const images: string[] = [];
      let sku: string | null = null;
      let gtin: string | null = null;
      let hasProduct = false;
      let gtinMatch = false;

      for (const match of scripts) {
        const payload = (match[1] ?? "").trim();
        if (!payload) continue;
        const lower = payload.toLowerCase();
        if (lower.includes("product")) {
          hasProduct = true;
        }
        const digits = payload.replace(/\D/g, "");
        if (barcodeVariants.some((code) => digits.includes(code))) {
          gtinMatch = true;
        }

        try {
          const parsed = JSON.parse(payload) as unknown;
          const stack: unknown[] = [parsed];
          while (stack.length) {
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
    };

    const extractNpnFromText = (text: string): string | null => {
      const match = text.match(/\bNPN\s*[:#]?\s*(\d{8})\b/i);
      return match?.[1] ?? null;
    };

    const normalizeGtinCandidate = (value: string): string | null => {
      const digits = value.replace(/\D/g, "");
      if (!digits) return null;
      if (digits.length < 8 || digits.length > 14) return null;
      return digits;
    };

    const extractGtinCandidatesFromText = (text: string): string[] => {
      if (!text) return [];
      const matches = new Set<string>();
      const regex = /\b(?:UPC|GTIN|EAN|JAN|UPC-A|UPCA)\s*[:#]?\s*([0-9][0-9\-\s]{6,24})\b/gi;
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(text)) !== null) {
        const candidate = normalizeGtinCandidate(match[1] ?? "");
        if (candidate) matches.add(candidate);
      }
      return Array.from(matches);
    };

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
      try {
        const response = await fetch(rawUrl, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
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
          contextFetchBreaker?.recordSuccess();
          return {
            ok: true,
            contentType,
            finalUrl: response.url,
            text: rawText.slice(0, maxBytes),
          };
        }
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (received < maxBytes) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = maxBytes - received;
          chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
          received += Math.min(value.length, remaining);
          if (received >= maxBytes) {
            try {
              await reader.cancel();
            } catch {}
            break;
          }
        }
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        contextFetchBreaker?.recordSuccess();
        return { ok: true, contentType, finalUrl: response.url, text };
      } catch (error) {
        if (!isAbortError(error)) {
          contextFetchBreaker?.recordFailure();
        }
        return null;
      } finally {
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
      const digits = text.replace(/\D/g, "");
      const barcodeHitCount = barcodeVariants.reduce((sum, code) => sum + countOccurrences(digits, code), 0);
      const jsonLd = extractJsonLd(text);
      const npnCandidate = extractNpnFromText(text);
      const needsJs =
        /please enable javascript|enable javascript|requires javascript|turn on javascript/i.test(text) ||
        (text.includes("<script") && !text.includes("ingredients") && barcodeHitCount === 0);

      const hasProductJsonLd = Boolean(jsonLd.hasProduct);
      const jsonLdGtinMatch = Boolean(jsonLd.gtinMatch);
      const strongMatch =
        !onlyImages &&
        !needsJs &&
        (jsonLdGtinMatch || barcodeHitCount >= RESOLUTION_STRONG_MATCH_BARCODE_HITS_MIN);

      const metaOgTitle = extractMetaContent(text, "og:title");
      const metaBrand = extractMetaContent(text, "product:brand") ?? extractMetaContent(text, "og:site_name");

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

    const sorted = evidences.sort((a, b) => rankEvidence(b) - rankEvidence(a));
    const nonMarketplaceCandidates = sorted.filter(
      (entry) => !isMarketplaceDomain(entry.evidence.domain),
    );
    const candidatePool = nonMarketplaceCandidates.length ? nonMarketplaceCandidates : sorted;
    const deepCandidates = candidatePool
      .filter((entry) => {
        if (entry.evidence.onlyImages) return false;
        if (entry.evidence.needsJs && !allowNeedsJs) return false;
        return entry.evidence.hasProductJsonLd || entry.evidence.barcodeHitCount > 0 || entry.evidence.strongMatch;
      })
      .slice(0, 2);

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
      } catch {}
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
        sendSSE(res, "error", { message: "Product not found" });
        res.end();
      } else {
        sendSSE(res, "done", { barcode });
        res.end();
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
      finishInFlight?.(new Error("no_valid_url"));
      return;
    }

    // Opportunistic LNHPD resolution if we discovered an NPN (deterministic extraction).
    const npnCandidate =
      deepCandidates.map((c) => c.evidence.npnCandidate).find((value): value is string => typeof value === "string") ??
      null;
    if (npnCandidate) {
      npnCandidateSource = "web";
      npnCandidateStale = false;
      const lnhpdTimeoutSignal = createTimeoutSignal(RESILIENCE_LNHPD_TIMEOUT_MS);
      const { signal: lnhpdSignal, cleanup } = combineSignals([requestSignal, lnhpdTimeoutSignal]);
      try {
        const lnhpdFacts = await fetchLnhpdFactsByNpn(npnCandidate, lnhpdSignal);
        const timedOut = lnhpdTimeoutSignal.aborted;
	        if (lnhpdFacts) {
          lnhpdFetchStatus = "success";
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
          const analysisStatus = buildAnalysisStatus({
            hasLabelFacts: hasLabelFacts(lnhpdSnapshot),
            hasAi: hasAiPayload(lnhpdAnalysisPayload),
            dsldLabelId: null,
          });
          const analysisMeta = buildAnalysisMeta({ status: analysisStatus, labelExtraction });
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
	            sendSSE(res, "done", { barcode });
	            res.end();
	            finishInFlight?.();
	            return;
	          }
	          console.log("[ResolutionV2] FORCE_STAGE1 enabled; continuing after LNHPD candidate hit");
        } else {
          lnhpdFetchStatus = timedOut ? "timeout" : "not_found";
          if (lnhpdFetchStatus === "not_found") {
            void upsertBarcodeRegulatoryMap({
              barcodeGtin14,
              npn: npnCandidate,
              confidence: 0.2,
              source: "lnhpd_not_found",
              expiresAt: new Date(Date.now() + REGULATORY_MAP_NOT_FOUND_TTL_MS).toISOString(),
              barcodeRaw: rawBarcode,
            });
          }
          if (lnhpdFetchStatus === "timeout" || lnhpdFetchStatus === "not_found") {
            void recordNpnNegativeAttempt(
              {
                npn: npnCandidate,
                reasonCode: lnhpdFetchStatus === "timeout" ? "lnhpd_timeout" : "lnhpd_not_found",
                windowMs: NPN_NEGATIVE_CACHE_WINDOW_HOURS * 60 * 60 * 1000,
                threshold: NPN_NEGATIVE_CACHE_THRESHOLD,
                ttlMs: NPN_NEGATIVE_CACHE_TTL_MS,
              },
              { ...supabaseWriteResilience, timeoutMs: 500 },
            );
          }
        }
      } finally {
        cleanup();
      }
    }

    // -------------------------------------------------------------------------
    // Deep fetch (max 1-2 pages) + deterministic facts extraction.
    // -------------------------------------------------------------------------
    const selectedItems = deepCandidates.map((c) => c.item);
    const deepStart = performance.now();
    const contextSources = await prepareContextSources(selectedItems, contextResilience);
    timing.deep_fetch_ms = Math.round(performance.now() - deepStart);

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
        /\b(?:ingredients|other ingredients|medicinal ingredients|non-?medicinal ingredients)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
      ]);
      const directionsText = extractSection(extractedText, [
        /\b(?:directions|suggested use|dosage)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
      ]);
      const warningsText = extractSection(extractedText, [
        /\b(?:warning|warnings|caution|contraindications)\b\s*[:\-]?\s*([\s\S]{20,800})/i,
      ]);
      const servingSizeText = extractSection(extractedText, [
        /\b(?:serving size|amount per serving)\b\s*[:\-]?\s*([\s\S]{10,200})/i,
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
      } catch {}
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
        sendSSE(res, "error", { message: "Product not found" });
        res.end();
      } else {
        sendSSE(res, "done", { barcode });
        res.end();
      }
      finishInFlight?.(new Error("no_text_facts"));
      return;
    }

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

    const identityStrong = Boolean(
      bestFacts.identifiers.npn ||
        bestFacts.identifiers.gtinMatch ||
        bestFacts.identifiers.upcMatch,
    );
    const identityConflict = Boolean(bestFacts.identifiers.identityConflict);
    const explicitGtinMatches = bestFacts.identifiers.gtinMatches ?? [];
    const explicitUpcMatches = bestFacts.identifiers.upcMatches ?? [];
    const npnFound = Boolean(bestFacts.identifiers.npn);

    const dosageRegex = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|iu|i\.u\.)\b/i;
    const dosageKeywordRegex = /\b(vitamin\s*c|ascorbate|ester-?c|ascorbic)\b/i;
    const hasDosageNearKeyword = (text: string | null | undefined): boolean => {
      if (!text) return false;
      const lower = text.toLowerCase();
      let match: RegExpExecArray | null = null;
      const keyword = new RegExp(dosageKeywordRegex, "ig");
      while ((match = keyword.exec(lower)) !== null) {
        const start = Math.max(0, match.index - 60);
        const end = Math.min(lower.length, match.index + match[0].length + 60);
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
      identityStrong && !identityConflict && (!isAmazonCanonical || amazonCanonicalExceptionUsed);

    const canonicalSourceDomain = allowCanonical ? canonicalDomain : null;
    const canonicalSourceUrl = allowCanonical ? bestFacts.canonical.url ?? null : null;

	    const finalProductInfo = {
	      brand: allowCanonical ? bestFacts.canonical.brand ?? provisionalBrand ?? null : provisionalBrand ?? null,
	      name: allowCanonical ? bestFacts.canonical.name ?? provisionalName ?? null : provisionalName ?? null,
	      category: provisionalCategory ?? null,
	      image: allowCanonical
        ? provisionalImage ?? bestFacts.canonical.images?.[0] ?? null
        : provisionalImage ?? null,
	    };

    const factsForAnalysis = allowCanonical
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
        if (trimmed.length <= 500) return [trimmed];
        return [trimmed.slice(0, 500).trim()];
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
    const canRunLlm = !marketplaceOnly && llmBudgetMs > 0;
    if (marketplaceOnly) {
      mainDeepseekBundleSkippedReason = "marketplace_only";
    } else if (llmBudgetMs <= 0) {
      mainDeepseekBundleSkippedReason = "budget_reserved";
    }

    if (canRunLlm) {
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
      }
      timing.llm_ms = Math.round(performance.now() - llmStart);
      if (!bundle) {
        mainDeepseekBundleSkippedReason =
          timing.llm_ms >= Math.max(200, llmTimeoutMs - 50) ? "llm_timeout" : "llm_failed";
      }
    } else {
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
    const shouldQueueMainBackfill =
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
      needsAuthoritativeBackfill || (!isCaRegion && marketplaceOnly);
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

    const canRespond = !requestSignal.aborted && !res.writableEnded;
    if (canRespond) {
      await awaitAnalysisBundle();
      if (!requestSignal.aborted && !res.writableEnded) {
        if (stage1SseEnabled && !streamAnalysisBundleOnly) {
          sendSSE(res, "snapshot", snapshot);
        }
        sendSSE(res, "done", { barcode });
        res.end();
      }
    }

    finishInFlight?.();

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
        deepseek_bundle_skipped_reason: mainDeepseekBundleSkippedReason,
        timing: {
          ...timing,
          stage0_ms: Math.round(stage1Start - startedAt),
          stage1_ms: Math.round(performance.now() - stage1Start),
        },
      }),
	    });

    console.log(`[Stream] All analysis complete for barcode: ${barcode}`);

  } catch (error: unknown) {
    if (finishInFlight) {
      finishInFlight(error);
    }
    captureException(error, { route: "/api/enrich-stream" });
    console.error("Stream Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!res.writableEnded) {
      sendSSE(res, "error", { message });
      res.end();
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

    const overview = await ensurePublicOverview({
      supplementId,
      productName,
      dosageText,
      brandName,
      barcode,
    });

    return res.json({
      supplementId,
      analysisReady: overview.analysisReady,
      source: overview.source,
      analysisData: overview.analysisData ?? null,
    });
  } catch (error) {
    captureException(error, { route: "/api/ensure-overview" });
    console.error("/api/ensure-overview error", error);
    return res.status(500).json({ error: "ensure_overview_failed" } satisfies ErrorResponse);
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

  const extractPrimaryDoseText = (snapshot: SupplementSnapshot): string | null => {
    for (const active of snapshot.label.actives) {
      if (active.amountUnknown) continue;
      if (active.isProprietaryBlend) continue;
      if (active.amount == null) continue;
      const unit =
        active.amountUnitNormalized ??
        active.amountUnit ??
        active.amountUnitRaw ??
        null;
      if (!unit) continue;
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
      return res.json({
        status: "ok",
        barcodeGtin14,
        productInfo: {
          brand: snapshot.product.brand ?? null,
          name: snapshot.product.name ?? null,
        },
        primaryDoseText: extractPrimaryDoseText(snapshot),
        npn: snapshot.regulatory.npn ?? null,
        dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
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
      const analysisMeta = buildAnalysisMeta({ status: analysisStatus, labelExtraction });
      analysisPayload.analysis = analysisMeta;
      snapshot.status = "resolved";
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
        { timeoutMs: 1500 },
      );

      return res.json({
        status: "ok",
        barcodeGtin14,
        productInfo: {
          brand: snapshot.product.brand ?? null,
          name: snapshot.product.name ?? null,
        },
        primaryDoseText: extractPrimaryDoseText(snapshot),
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

// ============================================================================
// RATE LIMITING FOR LABEL SCAN
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMinute = new Map<string, RateLimitEntry>();
const rateLimitDay = new Map<string, RateLimitEntry>();

const OCR_RATE_LIMIT_PER_MINUTE = Number(process.env.OCR_RATE_LIMIT_PER_MINUTE ?? 10);
const OCR_RATE_LIMIT_PER_DAY = Number(process.env.OCR_RATE_LIMIT_PER_DAY ?? 50);

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const minuteKey = `${userId}:minute`;
  const dayKey = `${userId}:day`;

  // Check minute limit
  let minuteEntry = rateLimitMinute.get(minuteKey);
  if (!minuteEntry || now > minuteEntry.resetAt) {
    minuteEntry = { count: 0, resetAt: now + 60000 };
    rateLimitMinute.set(minuteKey, minuteEntry);
  }
  if (minuteEntry.count >= OCR_RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, retryAfter: Math.ceil((minuteEntry.resetAt - now) / 1000) };
  }

  // Check day limit
  let dayEntry = rateLimitDay.get(dayKey);
  if (!dayEntry || now > dayEntry.resetAt) {
    dayEntry = { count: 0, resetAt: now + 86400000 };
    rateLimitDay.set(dayKey, dayEntry);
  }
  if (dayEntry.count >= OCR_RATE_LIMIT_PER_DAY) {
    return { allowed: false, retryAfter: Math.ceil((dayEntry.resetAt - now) / 1000) };
  }

  // Increment counters
  minuteEntry.count++;
  dayEntry.count++;

  return { allowed: true };
}

// P1-2: Cleanup expired rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMinute) {
    if (now > entry.resetAt) rateLimitMinute.delete(key);
  }
  for (const [key, entry] of rateLimitDay) {
    if (now > entry.resetAt) rateLimitDay.delete(key);
  }
}, 10 * 60 * 1000);

// ============================================================================
// LABEL SCAN ENDPOINTS
// ============================================================================

const validationIssueTypeSchema = z.enum([
  "unit_invalid",
  "value_anomaly",
  "missing_serving_size",
  "header_not_found",
  "low_coverage",
  "incomplete_ingredients",
  "non_ingredient_line_detected",
  "unit_boundary_suspect",
  "dose_inconsistency_or_claim",
]);

const parsedIngredientSchema = z.object({
  name: z.string(),
  amount: z.number().nullable(),
  unit: z.string().nullable(),
  dvPercent: z.number().nullable(),
  confidence: z.number(),
  rawLine: z.string(),
});

const labelDraftSchema = z.object({
  servingSize: z.string().nullable(),
  ingredients: z.array(parsedIngredientSchema),
  parseCoverage: z.number(),
  confidenceScore: z.number(),
  issues: z.array(
    z.object({
      type: validationIssueTypeSchema,
      message: z.string(),
    }),
  ),
});

const analyzeLabelBodySchema = z
  .object({
    imageBase64: z.string().nullable().optional(),
    imageHash: z.string().min(1),
    saveImage: z.boolean().optional(),
    deviceId: z.string().optional(),
    debug: z.boolean().optional(),
    includeAnalysis: z.union([z.boolean(), z.string()]).optional(),
    async: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

const analyzeLabelConfirmBodySchema = z
  .object({
    imageHash: z.string().min(1),
    confirmedDraft: labelDraftSchema,
  })
  .passthrough();

type AnalyzeLabelRequest = z.infer<typeof analyzeLabelBodySchema>;

interface LabelAnalysisResponse {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  analysisStatus?: "complete" | "partial" | "pending" | "skipped" | "unavailable";
  analysisIssues?: string[];
  message?: string;
  suggestion?: string;
  issues?: { type: string; message: string }[]; // P0-2: Return validation issues to frontend
  snapshot?: SupplementSnapshot;
  debug?: LabelAnalysisDebug;
}

interface LabelAnalysisDebug {
  timing: {
    decodeMs: number | null;
    preprocessMs: number | null;
    requestBodyMs: number | null;
    visionClientInitMs: number | null;
    visionMs: number | null;
    postprocessMs: number | null;
    llmMs: number | null;
    totalMs: number | null;
  };
  image: {
    inputBytes: number | null;
    inputMime: string | null;
    inputWidth: number | null;
    inputHeight: number | null;
    preprocessedBytes: number | null;
    preprocessedWidth: number | null;
    preprocessedHeight: number | null;
  };
  vision: {
    languageHints: string[];
    fullTextLength: number;
    fullTextPreview: string;
    tokenCount: number;
    avgTokenConfidence: number | null;
    p10TokenConfidence: number | null;
    p50TokenConfidence: number | null;
    p90TokenConfidence: number | null;
    medianTokenHeight: number | null;
  };
  heuristics: LabelAnalysisDiagnostics["heuristics"] | null;
  drafts: LabelAnalysisDiagnostics["drafts"] | null;
}

const FULL_TEXT_PREVIEW_LIMIT = 500;

interface TokenStats {
  tokenCount: number;
  avgTokenConfidence: number | null;
  p10TokenConfidence: number | null;
  p50TokenConfidence: number | null;
  p90TokenConfidence: number | null;
  medianTokenHeight: number | null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const index = Math.floor((percentileValue / 100) * (values.length - 1));
  return values[Math.max(0, Math.min(index, values.length - 1))] ?? null;
}

function computeTokenStats(tokens: { confidence: number; height: number }[]): TokenStats {
  const tokenCount = tokens.length;
  if (tokenCount === 0) {
    return {
      tokenCount,
      avgTokenConfidence: null,
      p10TokenConfidence: null,
      p50TokenConfidence: null,
      p90TokenConfidence: null,
      medianTokenHeight: null,
    };
  }

  const confidences = tokens.map((token) => token.confidence).sort((a, b) => a - b);
  const heights = tokens.map((token) => token.height).sort((a, b) => a - b);
  const avgTokenConfidence = confidences.reduce((sum, value) => sum + value, 0) / tokenCount;

  return {
    tokenCount,
    avgTokenConfidence,
    p10TokenConfidence: percentile(confidences, 10),
    p50TokenConfidence: percentile(confidences, 50),
    p90TokenConfidence: percentile(confidences, 90),
    medianTokenHeight: heights[Math.floor(heights.length / 2)] ?? null,
  };
}

const labelAnalysisInFlight = new Map<string, Promise<void>>();

async function buildLabelScanAnalysis(options: {
  draft: LabelDraft;
  imageHash: string;
  model: string;
  apiKey: string;
  contextLabel?: string;
  disclaimer?: string;
  resilience?: DeepseekResilienceOptions;
}): Promise<{ analysis: AiSupplementAnalysis; analysisIssues: string[]; analysisStatus: "complete" | "partial"; llmMs: number }> {
  const { draft, imageHash, model, apiKey, resilience } = options;
  const contextLabel = options.contextLabel ?? "from OCR";
  const disclaimer =
    options.disclaimer ?? "This analysis is based on label information only. Not a substitute for medical advice.";
  const llmStart = performance.now();
  const ingredientContext = formatForDeepSeek(draft);
  const labelContext = `PRODUCT INFORMATION (${contextLabel}):
${ingredientContext}

TASK: Analyze this supplement based on the ingredient list above.
Focus on: ingredient forms, dosage adequacy, evidence strength.
If information is not available, use null instead of guessing.

${LABEL_SCAN_OUTPUT_RULES}`;

  let bundle: Awaited<ReturnType<typeof fetchAnalysisBundle>> | null = null;
  try {
    bundle = await fetchAnalysisBundle(labelContext, model, apiKey, resilience);
  } catch (error) {
    if (!isAbortError(error)) {
      console.warn("[LabelScan] analysis bundle failed", error);
    }
  }
  if (bundle) {
    incrementMetric("deepseek_bundle_success");
  } else if (!resilience?.signal?.aborted) {
    incrementMetric("deepseek_bundle_fail_degraded");
  }
  const efficacyRaw = bundle?.efficacy ?? null;
  const safetyRaw = bundle?.safety ?? null;
  const usageRaw = bundle?.usagePayload ?? null;

  const efficacy = efficacyRaw as {
    score?: number;
    verdict?: string;
    coreBenefits?: string[];
    overallAssessment?: string;
    overviewSummary?: string;
    marketingVsReality?: string;
    primaryActive?: {
      name?: string;
      form?: string | null;
      formQuality?: string;
      formNote?: string | null;
      dosageValue?: number | null;
      dosageUnit?: string | null;
      evidenceLevel?: string;
      evidenceSummary?: string | null;
    };
    ingredients?: {
      name?: string;
      dosageValue?: number | null;
      dosageUnit?: string | null;
      dosageAssessment?: string;
      evidenceLevel?: string;
      formQuality?: string;
    }[];
  } | null;
  const safety = safetyRaw as { score?: number; verdict?: string; risks?: string[]; redFlags?: string[] } | null;
  const usage = usageRaw as { usage?: { summary?: string; timing?: string; withFood?: boolean; interactions?: string[] }; value?: { score?: number; verdict?: string; analysis?: string }; social?: { score?: number; summary?: string } } | null;
  const analysisIssues: string[] = [];
  if (!efficacy) analysisIssues.push("efficacy_parse_failed");
  if (!safety) analysisIssues.push("safety_parse_failed");
  if (!usage) analysisIssues.push("usage_parse_failed");

  const normalizeNameKey = (value?: string | null) =>
    value?.toLowerCase().replace(/[^a-z0-9]+/g, "").trim() ?? "";
  const clampTextField = (value?: string | null) => (value && value.trim().length ? value.trim() : null);
  const mergeList = (primary: string[] | undefined, fallback: string[], limit: number) => {
    const results: string[] = [];
    const seen = new Set<string>();
    const add = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push(trimmed);
    };
    (primary ?? []).forEach(add);
    fallback.forEach(add);
    return results.slice(0, limit);
  };

  const labelActives = (() => {
    const results: { name: string; doseText: string; dosageValue: number | null; dosageUnit: string | null }[] = [];
    const seen = new Set<string>();
    for (const ing of draft.ingredients) {
      const name = ing.name?.trim();
      if (!name) continue;
      const key = normalizeNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const doseText =
        ing.amount != null && ing.unit
          ? `${ing.amount} ${ing.unit}`
          : ing.dvPercent != null
            ? `${ing.dvPercent}% DV`
            : "dose not specified";
      results.push({
        name,
        doseText,
        dosageValue: ing.amount ?? null,
        dosageUnit: ing.unit ?? null,
      });
    }
    return results;
  })();

  const labelActivesSummary = labelActives.slice(0, 3);
  const labelActivesForList = labelActives.slice(0, 8);
  const labelActivesByKey = new Map(labelActives.map((active) => [normalizeNameKey(active.name), active]));

  const labelPrimary = labelActivesSummary[0];
  const labelCoreBenefits = labelActivesSummary.map((active) => `${active.name} - ${active.doseText}`);
  const labelSummary = labelActivesSummary.length
    ? `Label-only summary${draft.servingSize ? ` (${draft.servingSize})` : ''}: ${labelActivesSummary
        .map((active) => `${active.name} ${active.doseText}`)
        .join(', ')}.`
    : "Label-only summary based on listed ingredients.";
  const transparencyNote = draft.issues.some((issue) =>
    ["incomplete_ingredients", "header_not_found", "non_ingredient_line_detected", "unit_boundary_suspect", "dose_inconsistency_or_claim"].includes(issue.type)
  )
    ? "Ingredient disclosure may be incomplete or require review."
    : "Ingredient disclosure appears clear on the label.";

  const transparencyScore = (() => {
    const base = Math.round(4 + draft.confidenceScore * 6);
    let penalty = 0;
    if (draft.parseCoverage < 0.7) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "incomplete_ingredients")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "non_ingredient_line_detected")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "unit_boundary_suspect")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "dose_inconsistency_or_claim")) penalty += 2;
    const score = Math.max(1, Math.min(10, base - penalty));
    return score;
  })();
  const transparencyVerdict =
    transparencyScore >= 8
      ? "Clear ingredient disclosure"
      : transparencyScore >= 6
        ? "Moderate ingredient transparency"
        : "Limited ingredient transparency";
  const transparencyAnalysis = transparencyNote;

  const toFormQuality = (value?: string | null): IngredientAnalysis["formQuality"] => {
    if (value === "high" || value === "medium" || value === "low" || value === "unknown") return value;
    return "unknown";
  };

  const toEvidenceLevel = (value?: string | null): IngredientAnalysis["evidenceLevel"] => {
    if (value === "strong" || value === "moderate" || value === "weak" || value === "none") return value;
    return "none";
  };

  const toDosageAssessment = (value?: string | null): IngredientAnalysis["dosageAssessment"] => {
    if (value === "adequate" || value === "underdosed" || value === "overdosed" || value === "unknown") return value;
    return "unknown";
  };

  const normalizePrimaryActive = (active?: any): PrimaryActive | null => {
    if (!active?.name) return null;
    return {
      name: String(active.name),
      form: active.form ?? null,
      formQuality: toFormQuality(active.formQuality),
      formNote: active.formNote ?? null,
      dosageValue: typeof active.dosageValue === "number" ? active.dosageValue : null,
      dosageUnit: active.dosageUnit ?? null,
      evidenceLevel: toEvidenceLevel(active.evidenceLevel),
      evidenceSummary: active.evidenceSummary ?? null,
    };
  };

  const normalizeIngredient = (ingredient?: any): IngredientAnalysis | null => {
    if (!ingredient?.name) return null;
    return {
      name: String(ingredient.name),
      form: ingredient.form ?? null,
      formQuality: toFormQuality(ingredient.formQuality),
      formNote: ingredient.formNote ?? null,
      dosageValue: typeof ingredient.dosageValue === "number" ? ingredient.dosageValue : null,
      dosageUnit: ingredient.dosageUnit ?? null,
      recommendedMin: typeof ingredient.recommendedMin === "number" ? ingredient.recommendedMin : null,
      recommendedMax: typeof ingredient.recommendedMax === "number" ? ingredient.recommendedMax : null,
      recommendedUnit: ingredient.recommendedUnit ?? null,
      dosageAssessment: toDosageAssessment(ingredient.dosageAssessment),
      evidenceLevel: toEvidenceLevel(ingredient.evidenceLevel),
      evidenceSummary: ingredient.evidenceSummary ?? null,
      rdaSource: ingredient.rdaSource ?? null,
      ulValue: typeof ingredient.ulValue === "number" ? ingredient.ulValue : null,
      ulUnit: ingredient.ulUnit ?? null,
    };
  };

  const llmPrimaryActive = normalizePrimaryActive(efficacy?.primaryActive);
  const labelPrimaryActive = labelPrimary
    ? normalizePrimaryActive({
        name: labelPrimary.name,
        form: null,
        formQuality: "unknown",
        formNote: null,
        dosageValue: labelPrimary.dosageValue,
        dosageUnit: labelPrimary.dosageUnit,
        evidenceLevel: "none",
        evidenceSummary: "Not specified on label",
      })
    : null;
  const fillPrimaryFromLabel = (active: PrimaryActive | null) => {
    if (!active?.name) return active;
    const match = labelActivesByKey.get(normalizeNameKey(active.name));
    if (!match) return active;
    return {
      ...active,
      dosageValue: active.dosageValue ?? match.dosageValue ?? null,
      dosageUnit: active.dosageUnit ?? match.dosageUnit ?? null,
    };
  };
  const primaryActive = fillPrimaryFromLabel(llmPrimaryActive ?? labelPrimaryActive);

  const llmIngredients = (Array.isArray(efficacy?.ingredients) ? efficacy.ingredients : [])
    .map((ingredient: any) => normalizeIngredient(ingredient))
    .filter((item): item is IngredientAnalysis => Boolean(item));
  const labelIngredientFallbacks = labelActivesForList
    .map((active) =>
      normalizeIngredient({
        name: active.name,
        form: null,
        formQuality: "unknown",
        formNote: null,
        dosageValue: active.dosageValue,
        dosageUnit: active.dosageUnit,
        recommendedMin: null,
        recommendedMax: null,
        recommendedUnit: null,
        dosageAssessment: "unknown",
        evidenceLevel: "none",
        evidenceSummary: "Not specified on label",
        rdaSource: null,
        ulValue: null,
        ulUnit: null,
      })
    )
    .filter((item): item is IngredientAnalysis => Boolean(item));
  const applyLabelDose = (ingredient: IngredientAnalysis) => {
    const match = labelActivesByKey.get(normalizeNameKey(ingredient.name));
    if (!match) return ingredient;
    return {
      ...ingredient,
      dosageValue: ingredient.dosageValue ?? match.dosageValue ?? null,
      dosageUnit: ingredient.dosageUnit ?? match.dosageUnit ?? null,
    };
  };
  const mergedIngredients = (() => {
    const results: IngredientAnalysis[] = [];
    const seen = new Set<string>();
    const add = (ingredient: IngredientAnalysis) => {
      const key = normalizeNameKey(ingredient.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      results.push(ingredient);
    };
    llmIngredients.map(applyLabelDose).forEach(add);
    labelIngredientFallbacks.forEach(add);
    return results;
  })();

  const legacyBenefits = (efficacy as { benefits?: unknown } | null)?.benefits;
  const rawBenefits: string[] =
    Array.isArray(efficacy?.coreBenefits) && efficacy.coreBenefits.length
      ? efficacy.coreBenefits
      : Array.isArray(legacyBenefits)
        ? legacyBenefits.filter((benefit): benefit is string => typeof benefit === "string")
        : [];
  const preferLabelBenefits =
    rawBenefits.length === 0 || rawBenefits.every((benefit) => !/\d/.test(benefit));
  const llmCoreBenefits = mergeList(
    preferLabelBenefits ? [...labelCoreBenefits, ...rawBenefits] : rawBenefits,
    labelCoreBenefits,
    3
  );
  const overviewSummary = (() => {
    const llmSummary = clampTextField(efficacy?.overviewSummary);
    if (!llmSummary) return labelSummary;
    if (llmSummary.length >= 60) return llmSummary;
    return labelSummary ? `${llmSummary} ${labelSummary}` : llmSummary;
  })();
  const overallAssessment = clampTextField(efficacy?.overallAssessment) ?? transparencyNote;
  const marketingRequirement = "Label-only analysis; no price/brand verification.";
  const marketingBase = clampTextField(efficacy?.marketingVsReality);
  const marketingVsReality = marketingBase
    ? (marketingBase.toLowerCase().includes("label-only analysis")
        ? marketingBase
        : `${marketingBase} ${marketingRequirement}`)
    : marketingRequirement;
  const valueVerdict = clampTextField(usage?.value?.verdict) ?? transparencyVerdict;
  const valueAnalysis = clampTextField(usage?.value?.analysis) ?? transparencyAnalysis;

  const analysis: AiSupplementAnalysis = {
    schemaVersion: 1,
    barcode: `label:${imageHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    model,
    status: "success",
    overallScore: efficacy?.score ?? 5,
    confidence: draft.confidenceScore > 0.8 ? "high" : draft.confidenceScore > 0.5 ? "medium" : "low",
    productInfo: {
      brand: null,
      name: "Label Scan Result",
      category: "supplement",
      image: null,
    },
    efficacy: {
      score: (efficacy?.score ?? 5) as RatingScore,
      benefits: llmCoreBenefits,
      dosageAssessment: {
        text: overallAssessment,
        isUnderDosed: false,
      },
      verdict: clampTextField(efficacy?.verdict) ?? undefined,
      highlights: llmCoreBenefits.length ? llmCoreBenefits : undefined,
      warnings: [],
      coreBenefits: llmCoreBenefits.length ? llmCoreBenefits : undefined,
      overviewSummary,
      overallAssessment,
      marketingVsReality,
      primaryActive,
      ingredients: mergedIngredients,
    },
    value: {
      score: transparencyScore as RatingScore,
      verdict: valueVerdict,
      analysis: valueAnalysis,
    },
    safety: {
      score: (safety?.score ?? 5) as RatingScore,
      risks: safety?.risks ?? [],
      redFlags: safety?.redFlags ?? [],
      additivesInfo: null,
      verdict: safety?.verdict ?? undefined,
    },
    social: {
      score: (usage?.social?.score ?? 3) as RatingScore,
      tier: "unknown",
      summary: usage?.social?.summary ?? "Brand reputation unknown from label scan.",
      tags: [],
    },
    usage: {
      summary: usage?.usage?.summary ?? "Follow label directions",
      timing: usage?.usage?.timing ?? null,
      withFood: usage?.usage?.withFood ?? null,
      conflicts: usage?.usage?.interactions ?? [],
      sourceType: "product_label",
    },
    sources: [],
    disclaimer,
    analysisIssues: analysisIssues.length ? analysisIssues : undefined,
  };

  const analysisStatus = analysisIssues.length ? "partial" : "complete";
  const llmMs = performance.now() - llmStart;

  return { analysis, analysisIssues, analysisStatus, llmMs };
}

/**
 * POST /api/analyze-label
 * Analyze a supplement label image using Vision OCR + DeepSeek
 */
app.post("/api/analyze-label", verifySupabaseToken, async (req: Request, res: Response) => {
  try {
    const totalStart = performance.now();
    const parsedBody = parseRequestBody(analyzeLabelBodySchema, req, res);
    if (!parsedBody) {
      return;
    }
    const body: AnalyzeLabelRequest = parsedBody;
    const imageBase64 = body.imageBase64 ?? undefined;
    const { imageHash, deviceId } = body;
    const labelBudget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
    const labelAbort = createRequestAbort(res);
    const labelDeepseekResilience: DeepseekResilienceOptions = {
      signal: labelAbort.signal,
      budget: labelBudget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: RESILIENCE_DEEPSEEK_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
    };
    const debugEnabled =
      body.debug === true
      || (Array.isArray(req.query.debug)
        ? req.query.debug.includes("true")
        : req.query.debug === "true");
    const includeAnalysisQuery = Array.isArray(req.query.includeAnalysis)
      ? req.query.includeAnalysis
      : req.query.includeAnalysis
        ? [String(req.query.includeAnalysis)]
        : [];
    const includeAnalysisBody =
      typeof body.includeAnalysis === "string"
        ? body.includeAnalysis === "true" || body.includeAnalysis === "1"
        : body.includeAnalysis === true;
    const includeAnalysis =
      includeAnalysisBody
      || includeAnalysisQuery.some((value) => value === "true" || value === "1")
      || (typeof body.includeAnalysis === "undefined" && includeAnalysisQuery.length === 0 && Boolean(imageBase64));
    const asyncQuery = Array.isArray(req.query.async)
      ? req.query.async
      : req.query.async
        ? [String(req.query.async)]
        : [];
    const asyncBody =
      typeof body.async === "string"
        ? body.async === "true" || body.async === "1"
        : body.async === true;
    const asyncAnalysis =
      asyncBody || asyncQuery.some((value) => value === "true" || value === "1");

    // Validate input
    if (!imageHash) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required field: imageHash",
      } satisfies LabelAnalysisResponse);
    }

    // Rate limiting
    const userId = deviceId ?? req.ip ?? "anonymous";
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      res.setHeader("Retry-After", String(rateCheck.retryAfter ?? 60));
      return res.status(429).json({
        status: "failed",
        message: "Rate limit exceeded. Please try again later.",
        suggestion: `Wait ${rateCheck.retryAfter ?? 60} seconds before trying again.`,
      } satisfies LabelAnalysisResponse);
    }

    const cached = !debugEnabled ? await getCachedResult(imageHash) : null;

    if (!imageBase64 && !cached) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required field: imageBase64",
      } satisfies LabelAnalysisResponse);
    }

    if (cached && !debugEnabled) {
      if (hasCompletedAnalysis(cached)) {
        console.log(`[LabelScan] Cache hit with analysis for ${imageHash.slice(0, 8)}...`);
        const cachedAnalysisIssues =
          (cached.analysis as { analysisIssues?: string[] } | null)?.analysisIssues ?? [];
        const cachedAnalysisStatus = cachedAnalysisIssues.length ? "partial" : "complete";
        if (cached.parsedIngredients) {
          void upsertProductIngredientsFromDraft({
            sourceId: imageHash,
            draft: cached.parsedIngredients,
            basis: "label_serving",
          });
        }
        const snapshot = await buildAndCacheLabelSnapshot({
          status: "ok",
          draft: cached.parsedIngredients ?? null,
          analysis: cached.analysis ?? null,
          imageHash,
        });
        return res.json({
          status: "ok",
          draft: cached.parsedIngredients ?? undefined,
          analysis: cached.analysis,
          analysisStatus: cachedAnalysisStatus,
          analysisIssues: cachedAnalysisIssues.length ? cachedAnalysisIssues : undefined,
          snapshot,
        } satisfies LabelAnalysisResponse);
      }

      if (cached.parsedIngredients) {
        const cachedDraft = cached.parsedIngredients;
        void upsertProductIngredientsFromDraft({
          sourceId: imageHash,
          draft: cachedDraft,
          basis: "label_serving",
        });
        const cachedNeedsConfirmation = needsConfirmation(cachedDraft);
        const cachedStatus = cachedNeedsConfirmation ? "needs_confirmation" : "ok";

        if (!includeAnalysis) {
          console.log(`[LabelScan] Cache hit with draft only for ${imageHash.slice(0, 8)}...`);
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            analysisStatus: "skipped",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        const deepseekKey = process.env.DEEPSEEK_API_KEY;
        const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

        if (!deepseekKey) {
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: "Analysis service unavailable. Please try again later.",
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            message: "Analysis service unavailable. Please try again later.",
            analysisStatus: "unavailable",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        if (asyncAnalysis) {
          console.log(`[LabelScan] Deferring DeepSeek analysis for ${imageHash.slice(0, 8)}...`);
          if (!labelAnalysisInFlight.has(imageHash)) {
            const task = (async () => {
              try {
                const backgroundBudget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
                const backgroundResilience: DeepseekResilienceOptions = {
                  budget: backgroundBudget,
                  breaker: deepseekBreaker,
                  semaphore: deepseekSemaphore,
                  timeoutMs: RESILIENCE_DEEPSEEK_TIMEOUT_MS,
                  queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
                };
                const { analysis, llmMs } = await buildLabelScanAnalysis({
                  draft: cachedDraft,
                  imageHash,
                  model,
                  apiKey: deepseekKey,
                  resilience: backgroundResilience,
                });
                await updateCachedAnalysis(imageHash, analysis);
                console.log(`[LabelScan] Async analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(llmMs)}ms...`);
              } catch (error) {
                console.error(`[LabelScan] Async analysis failed for ${imageHash.slice(0, 8)}:`, error);
              }
            })();
            labelAnalysisInFlight.set(imageHash, task);
            task.finally(() => labelAnalysisInFlight.delete(imageHash));
          }
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            analysisStatus: "pending",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        console.log(`[LabelScan] Running DeepSeek analysis from cache...`);
        const { analysis, analysisIssues, analysisStatus, llmMs } = await buildLabelScanAnalysis({
          draft: cachedDraft,
          imageHash,
          model,
          apiKey: deepseekKey,
          resilience: labelDeepseekResilience,
        });
        await updateCachedAnalysis(imageHash, analysis);

        console.log(`[LabelScan] Analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(llmMs)}ms...`);
        const snapshot = await buildAndCacheLabelSnapshot({
          status: cachedStatus,
          draft: cachedDraft,
          analysis,
          imageHash,
        });
        return res.json({
          status: cachedStatus,
          draft: cachedDraft,
          analysis,
          analysisStatus,
          analysisIssues: analysisIssues.length ? analysisIssues : undefined,
          snapshot,
        } satisfies LabelAnalysisResponse);
      }
    }

    // Call Vision OCR
    console.log(`[LabelScan] Calling Vision OCR for ${imageHash.slice(0, 8)}...`);
    const requestBodyMs = performance.now() - totalStart;
    let visionResult;
    try {
      visionResult = await callVisionOcr({ imageBase64 }, { debug: debugEnabled });
    } catch (visionError) {
      console.error("[LabelScan] Vision OCR failed:", visionError);
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: undefined,
        analysis: null,
        message: "OCR processing failed. Please try again.",
        imageHash,
      });
      return res.status(500).json({
        status: "failed",
        message: "OCR processing failed. Please try again.",
        suggestion: "Try taking a clearer photo with better lighting and less glare.",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    const fullText = visionResult.fullText ?? "";
    const tokenStats = computeTokenStats(visionResult.tokens);

    const buildDebugPayload = (
      postprocessMs: number | null,
      diagnostics: LabelAnalysisDiagnostics | null,
      llmMs: number | null,
      requestBodyMs: number | null
    ): LabelAnalysisDebug | undefined => {
      if (!debugEnabled) return undefined;
      const timing = visionResult.diagnostics?.timing;
      const image = visionResult.diagnostics?.image;
      return {
        timing: {
          decodeMs: timing?.decodeMs ?? null,
          preprocessMs: timing?.preprocessMs ?? null,
          requestBodyMs,
          visionClientInitMs: timing?.visionClientInitMs ?? null,
          visionMs: timing?.visionMs ?? null,
          postprocessMs,
          llmMs,
          totalMs: performance.now() - totalStart,
        },
        image: {
          inputBytes: image?.inputBytes ?? null,
          inputMime: image?.inputMime ?? null,
          inputWidth: image?.inputWidth ?? null,
          inputHeight: image?.inputHeight ?? null,
          preprocessedBytes: image?.preprocessedBytes ?? null,
          preprocessedWidth: image?.preprocessedWidth ?? null,
          preprocessedHeight: image?.preprocessedHeight ?? null,
        },
        vision: {
          languageHints: visionResult.diagnostics?.languageHints ?? [],
          fullTextLength: fullText.length,
          fullTextPreview: fullText.slice(0, FULL_TEXT_PREVIEW_LIMIT),
          tokenCount: tokenStats.tokenCount,
          avgTokenConfidence: tokenStats.avgTokenConfidence,
          p10TokenConfidence: tokenStats.p10TokenConfidence,
          p50TokenConfidence: tokenStats.p50TokenConfidence,
          p90TokenConfidence: tokenStats.p90TokenConfidence,
          medianTokenHeight: tokenStats.medianTokenHeight,
        },
        heuristics: diagnostics?.heuristics ?? null,
        drafts: diagnostics?.drafts ?? null,
      };
    };

    if (tokenStats.tokenCount === 0 && fullText.trim().length === 0) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: undefined,
        analysis: null,
        message: "Could not detect any text in the image.",
        imageHash,
      });
      return res.json({
        status: "failed",
        message: "Could not detect any text in the image.",
        suggestion: "Make sure the Supplement Facts label is clearly visible and in focus.",
        debug: buildDebugPayload(null, null, null, requestBodyMs),
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    // Post-processing: infer rows and extract ingredients
    console.log(`[LabelScan] Processing ${visionResult.tokens.length} tokens...`);
    const postprocessStart = performance.now();
    let draft: LabelDraft;
    let analysisDiagnostics: LabelAnalysisDiagnostics | null = null;
    if (debugEnabled) {
      const analyzed = analyzeLabelDraftWithDiagnostics(visionResult.tokens, fullText);
      draft = analyzed.draft;
      analysisDiagnostics = analyzed.diagnostics;
    } else {
      draft = analyzeLabelDraft(visionResult.tokens, fullText);
    }
    const postprocessMs = performance.now() - postprocessStart;
    let llmMs: number | null = null;
    let debugPayload = buildDebugPayload(postprocessMs, analysisDiagnostics, llmMs, requestBodyMs);
    console.log(`[LabelScan] Extracted ${draft.ingredients.length} ingredients, confidence: ${draft.confidenceScore.toFixed(2)}`);

    // Cache the draft
    // P0-5: Only store visionRaw in debug mode to save space and protect privacy
    const shouldStoreVisionRaw = process.env.OCR_STORE_VISION_RAW === "true";
    await setCachedResult(imageHash, {
      visionRaw: shouldStoreVisionRaw ? visionResult.rawResponse : null,
      parsedIngredients: draft,
      confidence: draft.confidenceScore,
    });
    void upsertProductIngredientsFromDraft({
      sourceId: imageHash,
      draft,
      basis: "label_serving",
    });

    const needsReview = needsConfirmation(draft);
    // Check if confirmation needed
    if (needsReview && !includeAnalysis) {
      console.log(`[LabelScan] Low confidence, requesting confirmation`);
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "needs_confirmation",
        draft,
        analysis: null,
        message: "Please review the extracted ingredients.",
        imageHash,
      });
      return res.json({
        status: "needs_confirmation",
        draft,
        message: "Please review the extracted ingredients.",
        debug: debugPayload,
        analysisStatus: "skipped",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    if (!includeAnalysis) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "ok",
        draft,
        analysis: null,
        imageHash,
      });
      return res.json({
        status: "ok",
        draft,
        debug: debugPayload,
        analysisStatus: "skipped",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    // High confidence: proceed with DeepSeek analysis
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!deepseekKey) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        analysis: null,
        message: "Analysis service unavailable. Please try again later.",
        imageHash,
      });
      return res.json({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        message: "Analysis service unavailable. Please try again later.",
        debug: debugPayload,
        analysisStatus: "unavailable",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    if (asyncAnalysis) {
      console.log(`[LabelScan] Deferring DeepSeek analysis for ${imageHash.slice(0, 8)}...`);
      if (!labelAnalysisInFlight.has(imageHash)) {
        const task = (async () => {
          try {
            const backgroundBudget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
            const backgroundResilience: DeepseekResilienceOptions = {
              budget: backgroundBudget,
              breaker: deepseekBreaker,
              semaphore: deepseekSemaphore,
              timeoutMs: RESILIENCE_DEEPSEEK_TIMEOUT_MS,
              queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
            };
            const { analysis, llmMs: asyncLlmMs } = await buildLabelScanAnalysis({
              draft,
              imageHash,
              model,
              apiKey: deepseekKey,
              resilience: backgroundResilience,
            });
            await updateCachedAnalysis(imageHash, analysis);
            console.log(`[LabelScan] Async analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(asyncLlmMs)}ms...`);
          } catch (error) {
            console.error(`[LabelScan] Async analysis failed for ${imageHash.slice(0, 8)}:`, error);
          }
        })();
        labelAnalysisInFlight.set(imageHash, task);
        task.finally(() => labelAnalysisInFlight.delete(imageHash));
      }
      const snapshot = await buildAndCacheLabelSnapshot({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        analysis: null,
        message: needsReview ? "Please review the extracted ingredients." : undefined,
        imageHash,
      });
      return res.json({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        message: needsReview ? "Please review the extracted ingredients." : undefined,
        debug: debugPayload,
        analysisStatus: "pending",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    console.log(`[LabelScan] Running DeepSeek analysis...`);
    const { analysis, analysisIssues, analysisStatus, llmMs: resolvedLlmMs } = await buildLabelScanAnalysis({
      draft,
      imageHash,
      model,
      apiKey: deepseekKey,
      resilience: labelDeepseekResilience,
    });

    llmMs = resolvedLlmMs;

    // Update cache with analysis
    await updateCachedAnalysis(imageHash, analysis);
    debugPayload = buildDebugPayload(postprocessMs, analysisDiagnostics, llmMs, requestBodyMs);

    console.log(`[LabelScan] Analysis complete for ${imageHash.slice(0, 8)}...`);
    const snapshot = await buildAndCacheLabelSnapshot({
      status: needsReview ? "needs_confirmation" : "ok",
      draft,
      analysis,
      message: needsReview ? "Please review the extracted ingredients." : undefined,
      imageHash,
    });
    return res.json({
      status: needsReview ? "needs_confirmation" : "ok",
      draft,
      analysis,
      message: needsReview ? "Please review the extracted ingredients." : undefined,
      debug: debugPayload,
      analysisStatus,
      analysisIssues: analysisIssues.length ? analysisIssues : undefined,
      snapshot,
    } satisfies LabelAnalysisResponse);

  } catch (error) {
    captureException(error, { route: "/api/analyze-label" });
    console.error("[LabelScan] Unexpected error:", error);
    return res.status(500).json({
      status: "failed",
      message: "An unexpected error occurred.",
      suggestion: "Please try again. If the problem persists, try a different photo.",
    } satisfies LabelAnalysisResponse);
  }
});

/**
 * POST /api/analyze-label/confirm
 * Confirm edited ingredients and run DeepSeek analysis
 */
app.post("/api/analyze-label/confirm", verifySupabaseToken, async (req: Request, res: Response) => {
  try {
    const parsedBody = parseRequestBody(analyzeLabelConfirmBodySchema, req, res);
    if (!parsedBody) {
      return;
    }
    const { imageHash, confirmedDraft } = parsedBody;
    const confirmBudget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
    const confirmAbort = createRequestAbort(res);
    const confirmDeepseekResilience: DeepseekResilienceOptions = {
      signal: confirmAbort.signal,
      budget: confirmBudget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: RESILIENCE_DEEPSEEK_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
    };

    if (!imageHash || !confirmedDraft) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields: imageHash and confirmedDraft",
      } satisfies LabelAnalysisResponse);
    }

    // P0-4: Validate confirmed ingredients before analysis
    const validationIssues: { type: string; message: string }[] = [];
    for (const ing of confirmedDraft.ingredients) {
      const ingIssues = validateIngredient(ing);
      validationIssues.push(...ingIssues);
    }

    const hasBlockingIssues = validationIssues.some(
      (i) => i.type === 'unit_invalid' || i.type === 'value_anomaly'
    );

    if (hasBlockingIssues) {
      // P0-2: Return 200 with needs_confirmation, not 400 (frontend treats 400 as system error)
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "needs_confirmation",
        draft: confirmedDraft,
        analysis: null,
        message: "Some ingredients have validation issues. Please review and correct.",
        imageHash,
      });
      return res.json({
        status: "needs_confirmation",
        draft: confirmedDraft,
        message: "Some ingredients have validation issues. Please review and correct.",
        issues: validationIssues, // Return specific issues so user knows what to fix
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    void upsertProductIngredientsFromDraft({
      sourceId: imageHash,
      draft: confirmedDraft,
      basis: "label_serving",
    });

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!deepseekKey) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: confirmedDraft,
        analysis: null,
        message: "Analysis service unavailable.",
        imageHash,
      });
      return res.status(503).json({
        status: "failed",
        message: "Analysis service unavailable.",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    console.log(`[LabelScan/Confirm] Running analysis for ${imageHash.slice(0, 8)}...`);
    const { analysis, analysisIssues, analysisStatus } = await buildLabelScanAnalysis({
      draft: confirmedDraft,
      imageHash,
      model,
      apiKey: deepseekKey,
      contextLabel: "user-confirmed from OCR",
      disclaimer: "This analysis is based on user-confirmed label information. Not a substitute for medical advice.",
      resilience: confirmDeepseekResilience,
    });

    // P1-1: Use updateCachedAnalysis instead of setCachedResult to preserve created_at (TTL)
    await updateCachedAnalysis(imageHash, analysis);

    console.log(`[LabelScan/Confirm] Complete for ${imageHash.slice(0, 8)}...`);
    const snapshot = await buildAndCacheLabelSnapshot({
      status: "ok",
      draft: confirmedDraft,
      analysis,
      imageHash,
    });
    return res.json({
      status: "ok",
      draft: confirmedDraft,
      analysis,
      analysisStatus,
      analysisIssues: analysisIssues.length ? analysisIssues : undefined,
      snapshot,
    } satisfies LabelAnalysisResponse);

  } catch (error) {
    captureException(error, { route: "/api/analyze-label/confirm" });
    console.error("[LabelScan/Confirm] Unexpected error:", error);
    return res.status(500).json({
      status: "failed",
      message: "An unexpected error occurred.",
    } satisfies LabelAnalysisResponse);
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
});
