import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as Sentry from "@sentry/node";
import { z } from "zod";

import { buildBarcodeSearchQueries, normalizeBarcodeInput } from "./barcode.js";
import { resolveCatalogByBarcode, type CatalogResolved } from "./catalogResolver.js";
import { buildCatalogBarcodeSnapshot } from "./catalogSnapshot.js";
import { logBarcodeScan } from "./scanLog.js";
import { extractBrandProduct, extractBrandWithAI, type BrandExtractionResult } from "./brandExtractor.js";
import { buildCombinedContext, fetchAnalysisBundle, prepareContextSources } from "./deepseek.js";
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
  TtlCache,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
} from "./resilience.js";
import type { RetryOptions } from "./resilience.js";
import { constructFallbackQuery, extractDomain, isHighQualityDomain, scoreSearchItem, scoreSearchQuality } from "./searchQuality.js";
import { computeScoreBundleV4, V4_SCORE_VERSION } from "./scoring/v4ScoreEngine.js";
import { buildBarcodeSnapshot, buildLabelSnapshot, validateSnapshotOrFallback, type SnapshotAnalysisPayload } from "./snapshot.js";
import { getSnapshotCache, storeSnapshotCache } from "./snapshotCache.js";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import { supabase } from "./supabase.js";
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
const RESILIENCE_GOOGLE_TIMEOUT_MS = Number(process.env.RESILIENCE_GOOGLE_TIMEOUT_MS ?? 2500);
const RESILIENCE_DEEPSEEK_TIMEOUT_MS = Number(process.env.RESILIENCE_DEEPSEEK_TIMEOUT_MS ?? 10_000);
const RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS = Number(
  process.env.RESILIENCE_DEEPSEEK_BACKGROUND_BUDGET_MS ?? 12_000,
);
const RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS = Number(
  process.env.RESILIENCE_DEEPSEEK_BACKGROUND_TIMEOUT_MS ?? 8_000,
);
const RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS = Number(process.env.RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS ?? 4500);
const RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS ?? 300);
const RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS ?? 300);
const RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS = Number(process.env.RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS ?? 300);
const RESILIENCE_GOOGLE_CONCURRENCY = Number(process.env.RESILIENCE_GOOGLE_CONCURRENCY ?? 3);
const RESILIENCE_DEEPSEEK_CONCURRENCY = Number(process.env.RESILIENCE_DEEPSEEK_CONCURRENCY ?? 2);
const RESILIENCE_CONTEXT_FETCH_CONCURRENCY = Number(process.env.RESILIENCE_CONTEXT_FETCH_CONCURRENCY ?? 4);
const RESILIENCE_SUPABASE_READ_CONCURRENCY = Number(process.env.RESILIENCE_SUPABASE_READ_CONCURRENCY ?? 10);
const RESILIENCE_BREAKER_WINDOW_MS = Number(process.env.RESILIENCE_BREAKER_WINDOW_MS ?? 30_000);
const RESILIENCE_BREAKER_MIN_REQUESTS = Number(process.env.RESILIENCE_BREAKER_MIN_REQUESTS ?? 10);
const RESILIENCE_BREAKER_FAILURE_THRESHOLD = Number(process.env.RESILIENCE_BREAKER_FAILURE_THRESHOLD ?? 0.5);
const RESILIENCE_BREAKER_OPEN_MS = Number(process.env.RESILIENCE_BREAKER_OPEN_MS ?? 60_000);
const RESILIENCE_NEGATIVE_NOT_FOUND_TTL_MS = Number(process.env.RESILIENCE_NEGATIVE_NOT_FOUND_TTL_MS ?? 15 * 60 * 1000);
const RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_SUPABASE_READ_QUEUE_TIMEOUT_MS ?? 80,
);

const googleSemaphore = new Semaphore(RESILIENCE_GOOGLE_CONCURRENCY);
const deepseekSemaphore = new Semaphore(RESILIENCE_DEEPSEEK_CONCURRENCY);
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

const negativeBarcodeCache = new TtlCache<string, true>();

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

const pickUnitField = (record: Record<string, unknown>, keys: string[]): string | null => {
  const raw = pickStringField(record, keys);
  return normalizeUnitLabel(raw) ?? raw;
};

const extractTextList = (payload: unknown, nameKeys: string[]): string[] => {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  payload.forEach((item) => {
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
}): { name: string; amount: number | null; unit: string | null }[] => {
  if (!Array.isArray(payload)) return [];
  const map = new Map<string, { name: string; amount: number | null; unit: string | null }>();
  payload.forEach((item) => {
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
    const candidate = {
      name,
      amount: normalizedAmount ?? null,
      unit: unit ?? null,
    };
    if (!existing) {
      map.set(key, candidate);
      return;
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

const fetchLnhpdFactsByNpn = async (npn?: string | null): Promise<LnhpdFacts | null> => {
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

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    return data[0] as LnhpdFactsRecord;
  };

  const record = await runQuery('lnhpd_facts_complete') ?? await runQuery('lnhpd_facts');
  if (!record) return null;

  return buildLnhpdFactsFromRecord(record);
};

const fetchLnhpdFactsByName = async (params: {
  brand?: string | null;
  product?: string | null;
}): Promise<LnhpdFacts | null> => {
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

    const { data, error } = await query;
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
      regionTags: Array.from(updatedRegionTags),
      lastCheckedAt: nowIso(),
    },
  };

  return updated;
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
  const usageSummaryBase = firstNonEmptyText(doseHint, servingSizeHint);
  const usageSummary = usageSummaryBase
    ? `${ensureSentence(usageSummaryBase)} Follow label directions.`
    : 'Follow label directions.';
  const dosage = firstNonEmptyText(doseHint, servingSizeHint) ?? '';
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
};

type DeepseekResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
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
    maxAttempts: options.retry?.maxAttempts ?? 2,
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
};

const verifySupabaseToken = async (req: Request, res: Response, next: NextFunction) => {
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const queueBarcodeAnalysisCompletion = (params: {
  cacheKey: string;
  barcode: string;
  detailItems: SearchItem[];
  analysisContext: string;
  analysisPayload: SnapshotAnalysisPayload;
  snapshot: SupplementSnapshot;
  model: string;
  deepseekKey: string;
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
    };

    const bundle = await fetchAnalysisBundle(
      params.analysisContext,
      params.model,
      params.deepseekKey,
      backgroundResilience,
    );
    if (!bundle) {
      return;
    }

    const efficacyResult = bundle.efficacy ?? null;
    const safetyResult = bundle.safety ?? null;
    const usageResult = bundle.usagePayload ?? null;
    if (!efficacyResult && !safetyResult && !usageResult) {
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
    const queries = buildBarcodeSearchQueries(normalized);
    const initial = await runSearchPlan(queries, apiKey, cx, { barcode });
    const qualityScore = scoreSearchQuality(initial.merged, { barcode });
    console.log(`[Search] Barcode: ${barcode}, Initial Score: ${qualityScore}, Queries: ${initial.queriesTried.length}`);

    let finalPrimary = initial.primary;
    let finalSecondary = [...initial.secondary];
    let finalItems = initial.merged;

    // Step 2: Fallback if quality is low
    if (qualityScore < QUALITY_THRESHOLD && finalItems.length > 0) {
      const extraction = extractBrandProduct(finalItems);
      const fallbackQueries: string[] = [];

      if (extraction.brand && extraction.product) {
        fallbackQueries.push(
          `"${extraction.brand}" "${extraction.product}" "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" ingredients "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" "other ingredients"`,
          `"${extraction.brand}" "${extraction.product}" "nutrition facts"`,
          `"${extraction.brand}" "${extraction.product}" site:amazon.com "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" site:iherb.com "supplement facts"`,
        );
      }

      const titleFallback = constructFallbackQuery(finalItems);
      if (titleFallback) {
        fallbackQueries.push(titleFallback);
      }

      if (fallbackQueries.length > 0) {
        console.log(`[Search] Fallback queries: ${fallbackQueries.length}`);
        try {
          const fallbackPlan = await runSearchPlan(fallbackQueries, apiKey, cx, { barcode });
          finalSecondary = [...finalSecondary, ...fallbackPlan.primary, ...fallbackPlan.secondary];
          finalItems = mergeAndDedupe(finalPrimary, finalSecondary, { barcode });
        } catch (error) {
          console.warn("[Search] Fallback search failed", error);
        }
      }
    }

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

    const scoreRow = await fetchScoreRow();
    const shouldCompute =
      !scoreRow || scoreRow.score_version !== V4_SCORE_VERSION || !scoreRow.inputs_hash;
    const computed = shouldCompute ? await computeScoreBundleV4({ source, sourceId }) : null;

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

    if (scoreRow) {
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
 * Main streaming endpoint: Two-step search + AI analysis
 */
app.post("/api/enrich-stream", verifySupabaseToken, async (req: Request, res: Response) => {
  const parsedBody = parseRequestBody(enrichStreamBodySchema, req, res);
  if (!parsedBody) {
    return;
  }
  const rawBarcode = parsedBody.barcode;
  const normalized = normalizeBarcodeInput(rawBarcode);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  let finishInFlight: ((error?: unknown) => void) | null = null;
  let catalogSnapshotForAi: SupplementSnapshot | null = null;
  let catalogAnalysisPayloadForAi: SnapshotAnalysisPayload | null = null;
  let catalogLabelExtractionForAi: LabelExtractionMeta | null = null;
  let catalogLabelFactsForAi: LabelFacts | null = null;

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    if (!normalized) {
      sendSSE(res, "error", { message: "Invalid barcode provided" });
      res.end();
      return;
    }
    const barcode = normalized.code;
    const cacheKey = buildBarcodeCacheKey(barcode);
    const barcodeGtin14 = normalized.code.padStart(14, "0");

    const startedAt = performance.now();
    const budget = new DeadlineBudget(Date.now() + RESILIENCE_TOTAL_BUDGET_MS);
    const requestAbort = createRequestAbort(res);
    const requestId = String(res.getHeader("x-request-id") ?? "");
    const deviceId = parsedBody.deviceId ?? null;
    const requestSignal = requestAbort.signal;
    const googleResilience: SearchResilienceOptions = {
      signal: requestSignal,
      budget,
      breaker: googleBreaker,
      semaphore: googleSemaphore,
      timeoutMs: RESILIENCE_GOOGLE_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_GOOGLE_QUEUE_TIMEOUT_MS,
    };
    const deepseekResilience = {
      signal: requestSignal,
      budget,
      breaker: deepseekBreaker,
      semaphore: deepseekSemaphore,
      timeoutMs: RESILIENCE_DEEPSEEK_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_DEEPSEEK_QUEUE_TIMEOUT_MS,
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
    const brandAiResilience = {
      ...deepseekResilience,
      timeoutMs: Math.min(RESILIENCE_DEEPSEEK_TIMEOUT_MS, 3000),
    };
    const contextResilience = {
      signal: requestSignal,
      budget,
      breaker: contextFetchBreaker,
      semaphore: contextFetchSemaphore,
      timeoutMs: RESILIENCE_CONTEXT_FETCH_TIMEOUT_MS,
      queueTimeoutMs: RESILIENCE_CONTEXT_FETCH_QUEUE_TIMEOUT_MS,
    };

    const emitCachedSnapshot = (cached: {
      snapshot: SupplementSnapshot;
      analysisPayload: SnapshotAnalysisPayload | null;
    }, catalog?: CatalogResolved | null) => {
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
        sendSSE(res, "brand_extracted", workingAnalysisPayload.brandExtraction);
      }

      const pickField = (...values: (string | null | undefined)[]) => {
        for (const value of values) {
          if (typeof value !== "string") continue;
          const trimmed = value.trim();
          if (trimmed.length > 0) return trimmed;
        }
        return null;
      };

      const catalogCategory = catalog?.category ?? catalog?.categoryRaw ?? null;

      const productInfo = {
        brand: pickField(catalog?.brand, workingAnalysisPayload?.productInfo?.brand, snapshot.product.brand),
        name: pickField(catalog?.productName, workingAnalysisPayload?.productInfo?.name, snapshot.product.name),
        category: pickField(catalogCategory, workingAnalysisPayload?.productInfo?.category, snapshot.product.category),
        image: pickField(catalog?.imageUrl, workingAnalysisPayload?.productInfo?.image, snapshot.product.imageUrl),
      };

      const sources = workingAnalysisPayload?.sources ?? snapshot.references.items.map((ref) => ({
        title: ref.title,
        link: ref.url,
        domain: extractDomain(ref.url),
        isHighQuality: false,
      }));

      sendSSE(res, "product_info", { productInfo, sources });

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

    const googleApiKey = process.env.GOOGLE_CSE_API_KEY ?? null;
    const cx = process.env.GOOGLE_CSE_CX ?? null;
    const deepseekKey = process.env.DEEPSEEK_API_KEY ?? null;
    const aiAvailable = Boolean(googleApiKey && cx && deepseekKey);

    const cachedFast = await snapshotPromise.catch(() => null);
    if (cachedFast) {
      const hasProductName = Boolean(
        cachedFast.analysisPayload?.productInfo?.name || cachedFast.snapshot.product.name,
      );
      const needsCatalogFast = !hasProductName || !cachedFast.snapshot.regulatory.dsldLabelId;
      const catalogFast = needsCatalogFast ? await catalogPromise.catch(() => null) : null;
      emitCachedSnapshot(cachedFast, catalogFast);

      const needsEnrichment = shouldReEnrich({
        snapshot: cachedFast.snapshot,
        analysisPayload: cachedFast.analysisPayload,
        catalog: catalogFast,
        aiAvailable,
      });

      if (!needsEnrichment) {
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
            const pickField = (...values: (string | null | undefined)[]) => {
              for (const value of values) {
                if (typeof value !== "string") continue;
                const trimmed = value.trim();
                if (trimmed.length > 0) return trimmed;
              }
              return null;
            };
            const finalProductInfo = {
              brand: pickField(catalog.brand, analysisPayload?.productInfo?.brand, snapshot.product.brand),
              name: pickField(catalog.productName, analysisPayload?.productInfo?.name, snapshot.product.name),
              category: pickField(catalogCategory, analysisPayload?.productInfo?.category, snapshot.product.category),
              image: pickField(catalog.imageUrl, analysisPayload?.productInfo?.image, snapshot.product.imageUrl),
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
            meta: { cacheKey: barcodeGtin14, mode: "snapshot_cache_hit_fast" },
          });
        })();

        return;
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
      const pickField = (...values: (string | null | undefined)[]) => {
        for (const value of values) {
          if (typeof value !== "string") continue;
          const trimmed = value.trim();
          if (trimmed.length > 0) return trimmed;
        }
        return null;
      };
      const finalProductInfo = {
        brand: pickField(catalog.brand, workingAnalysisPayload.productInfo?.brand, workingSnapshot.product.brand),
        name: pickField(catalog.productName, workingAnalysisPayload.productInfo?.name, workingSnapshot.product.name),
        category: pickField(catalogCategory, workingAnalysisPayload.productInfo?.category, workingSnapshot.product.category),
        image: pickField(catalog.imageUrl, workingAnalysisPayload.productInfo?.image, workingSnapshot.product.imageUrl),
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
          void upsertProductIngredientsFromLabelFacts({
            source: "dsld",
            sourceId: String(dsldFacts.dsldLabelId),
            canonicalSourceId: String(dsldFacts.dsldLabelId),
            labelFacts: dsldLabelFacts,
            basis: "label_serving",
            parseConfidence: 1,
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
        meta: { cacheKey: gtin14, mode: cached ? "catalog_hit_with_snapshot" : "catalog_hit_no_snapshot" },
      });

      catalogSnapshotForAi = workingSnapshot;
      catalogAnalysisPayloadForAi = workingAnalysisPayload;
      catalogLabelExtractionForAi = labelExtraction;

      if (!aiAvailable || analysisStatus === "complete" || analysisStatus === "ai_enriched") {
        sendSSE(res, "done", { barcode });
        res.end();
        return;
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
          meta: { reason: "google_cse_env_not_set" },
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
          meta: { reason: "deepseek_api_key_missing" },
        });
        return;
      }
      sendSSE(res, "done", { barcode });
      res.end();
      return;
    }

    if (negativeBarcodeCache.has(cacheKey)) {
      if (aiRequired) {
        sendSSE(res, "error", { message: "Product not found" });
        res.end();
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
          meta: { reason: "negative_cache" },
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
        emitCachedSnapshot(after);
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
          meta: { cacheKey: barcodeGtin14, mode: "wait_inflight_hit" },
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

    barcodeEnrichInFlight.set(cacheKey, deferred.promise);

    // =========================================================================
    // STEP 1: Initial Barcode Search
    // =========================================================================
    console.log(`[Stream] Starting analysis for barcode: ${barcode}`);

    const queries = buildBarcodeSearchQueries(normalized);
    const initial = await runSearchPlan(queries, googleApiKey, cx, { barcode, resilience: googleResilience });
    let initialItems = initial.merged;

    if (requestSignal.aborted) {
      finishInFlight?.(requestSignal.reason ?? new Error("client_disconnected"));
      return;
    }

    if (!initialItems.length) {
      if (aiRequired) {
        sendSSE(res, "error", { message: "Product not found" });
        res.end();
        if (!initial.hardStop && initial.hadResponse) {
          negativeBarcodeCache.set(cacheKey, true, RESILIENCE_NEGATIVE_NOT_FOUND_TTL_MS);
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
          meta: {
            reason: initial.hardStop ? "search_unavailable" : "not_found",
            queriesTried: initial.queriesTried,
          },
        });
        finishInFlight?.(new Error("product_not_found"));
        return;
      }

      sendSSE(res, "done", { barcode });
      res.end();
      finishInFlight?.();
      return;
    }

    // =========================================================================
    // STEP 1.5: Brand/Product Extraction
    // =========================================================================
    let extraction: BrandExtractionResult = extractBrandProduct(initialItems);
    console.log(`[Stream] Initial extraction:`, extraction);

    // If confidence is low, use AI to extract brand/product
    if (extraction.confidence === "low") {
      console.log(`[Stream] Low confidence (${extraction.score}), using AI extraction`);
      extraction = await extractBrandWithAI(initialItems, deepseekKey, model, brandAiResilience);
      console.log(`[Stream] AI extraction result:`, extraction);
    }

    // Send brand extraction result to frontend
    sendSSE(res, "brand_extracted", {
      brand: extraction.brand,
      product: extraction.product,
      category: extraction.category,
      confidence: extraction.confidence,
      source: extraction.source,
    });

    if (!catalogSnapshotForAi) {
      const npnCandidate = extractNpnFromItems(initialItems);
      let lnhpdFacts: LnhpdFacts | null = null;

      if (npnCandidate) {
        lnhpdFacts = await fetchLnhpdFactsByNpn(npnCandidate);
      }
      if (!lnhpdFacts && (extraction.brand || extraction.product)) {
        lnhpdFacts = await fetchLnhpdFactsByName({
          brand: extraction.brand,
          product: extraction.product,
        });
      }

      if (lnhpdFacts) {
        const lnhpdLabelFacts = toLabelFactsFromLnhpd(lnhpdFacts);
        const lnhpdSourceId = lnhpdFacts.npn?.trim() || String(lnhpdFacts.lnhpdId);
        const lnhpdCanonicalId = String(lnhpdFacts.lnhpdId);
        void upsertProductIngredientsFromLabelFacts({
          source: "lnhpd",
          sourceId: lnhpdSourceId,
          canonicalSourceId: lnhpdCanonicalId,
          labelFacts: lnhpdLabelFacts,
          basis: "label_serving",
          parseConfidence: 1,
        });
        const labelExtraction: LabelExtractionMeta = {
          source: "lnhpd",
          fetchedAt: lnhpdFacts.extractedAt ?? nowIso(),
          datasetVersion: lnhpdFacts.datasetVersion ?? null,
        };
        const lnhpdProductInfo = {
          brand: lnhpdFacts.brandName ?? extraction.brand ?? null,
          name: lnhpdFacts.productName ?? extraction.product ?? initialItems[0]?.title ?? null,
          category: extraction.category ?? null,
          image: initialItems[0]?.image ?? null,
        };
        const lnhpdSources = initialItems.map((item) => ({
          title: item.title,
          link: item.link,
          domain: extractDomain(item.link),
          isHighQuality: isHighQualityDomain(item.link),
        }));
        const labelAnalysis = buildLabelOnlyAnalysis(lnhpdLabelFacts);
        const lnhpdAnalysisPayload: SnapshotAnalysisPayload = {
          ...labelAnalysis,
          brandExtraction: {
            brand: extraction.brand,
            product: extraction.product,
            category: extraction.category,
            confidence: extraction.confidence,
            source: extraction.source,
          },
          productInfo: lnhpdProductInfo,
          sources: lnhpdSources,
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

        sendSSE(res, "result_efficacy", lnhpdAnalysisPayload.efficacy);
        sendSSE(res, "result_safety", lnhpdAnalysisPayload.safety);
        sendSSE(res, "result_usage", lnhpdAnalysisPayload.usagePayload);
        sendSSE(res, "snapshot", lnhpdSnapshot);

        const expiresAt = computeExpiresAt(analysisStatus);
        void storeSnapshotCache({
          key: cacheKey,
          source: "barcode",
          snapshot: lnhpdSnapshot,
          analysisPayload: lnhpdAnalysisPayload,
          expiresAt,
        });

        catalogSnapshotForAi = lnhpdSnapshot;
        catalogAnalysisPayloadForAi = lnhpdAnalysisPayload;
        catalogLabelExtractionForAi = labelExtraction;
        catalogLabelFactsForAi = lnhpdLabelFacts;
      }
    }

    const catalogBrand = catalogSnapshotForAi?.product.brand ?? null;
    const catalogProduct = catalogSnapshotForAi?.product.name ?? null;
    const catalogCategory = catalogSnapshotForAi?.product.category ?? null;

    const brand = catalogBrand || extraction.brand || "Unknown Brand";
    const product = catalogProduct || extraction.product || initialItems[0].title;

    // Send product info immediately (user sees something fast)
    const catalogImage = catalogSnapshotForAi?.product.imageUrl ?? null;
    const initialSources = initialItems.map((item) => ({
      title: item.title,
      link: item.link,
      domain: extractDomain(item.link),
      isHighQuality: isHighQualityDomain(item.link),
    }));
    const catalogSources = catalogSnapshotForAi
      ? catalogSnapshotForAi.references.items.map((ref) => ({
          title: ref.title,
          link: ref.url,
          domain: extractDomain(ref.url),
          isHighQuality: false,
        }))
      : [];
    const mergedSources = (() => {
      const seen = new Set<string>();
      const combined: typeof initialSources = [];
      const add = (source: (typeof initialSources)[number]) => {
        if (!source.link) return;
        if (seen.has(source.link)) return;
        seen.add(source.link);
        combined.push(source);
      };
      initialSources.forEach(add);
      catalogSources.forEach(add);
      return combined;
    })();

    sendSSE(res, "product_info", {
      productInfo: {
        brand: brand,
        name: product,
        category: catalogCategory ?? extraction.category ?? null,
        image: catalogImage ?? initialItems[0].image ?? null,
      },
      sources: mergedSources,
    });

    // =========================================================================
    // STEP 2: Detailed Search (for ingredient information)
    // =========================================================================
    let detailItems = initialItems;
    const initialQuality = scoreSearchQuality(initialItems, { barcode });
    console.log(`[Stream] Initial search quality: ${initialQuality}`);

    // If quality is not good enough, do a second search focused on ingredients
    if (initialQuality < QUALITY_THRESHOLD) {
      const detailQueries: string[] = [];

      if (extraction.brand && extraction.product) {
        detailQueries.push(
          `"${extraction.brand}" "${extraction.product}" "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" ingredients "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" "other ingredients"`,
          `"${extraction.brand}" "${extraction.product}" "nutrition facts"`,
          `"${extraction.brand}" "${extraction.product}" site:amazon.com "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" site:iherb.com "supplement facts"`,
        );
      }

      const titleFallback = constructFallbackQuery(initialItems);
      if (titleFallback) {
        detailQueries.push(titleFallback);
      }

      if (detailQueries.length > 0) {
        console.log(`[Stream] Running detail search plan (${detailQueries.length} queries)`);
        try {
          const detailPlan = await runSearchPlan(detailQueries, googleApiKey, cx, {
            barcode,
            resilience: googleResilience,
          });
          const extraItems = [...detailPlan.primary, ...detailPlan.secondary];
          detailItems = mergeAndDedupe(initialItems, extraItems, { barcode });
          console.log(
            `[Stream] Detail search quality: ${scoreSearchQuality(detailItems, { barcode })}`,
          );
        } catch (detailError) {
          console.warn("[Stream] Detail search failed", detailError);
        }
      }
    }

    console.log(`[Stream] Final items count: ${detailItems.length}`);

    // =========================================================================
    // STEP 3: AI Analysis
    // =========================================================================
    const sources = await prepareContextSources(detailItems, contextResilience);
    const analysisContext = buildCombinedContext({ brand, product, barcode, sources });

    console.log(`[Stream] Starting AI analysis...`);

    let bundle: Awaited<ReturnType<typeof fetchAnalysisBundle>> | null = null;
    try {
      bundle = await fetchAnalysisBundle(analysisContext, model, deepseekKey, deepseekResilience);
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn("[Stream] analysis bundle failed", error);
      }
    }
    if (bundle) {
      incrementMetric("deepseek_bundle_success");
    } else if (!requestSignal.aborted) {
      incrementMetric("deepseek_bundle_fail_degraded");
    }
    const efficacyResult = bundle?.efficacy ?? null;
    const safetyResult = bundle?.safety ?? null;
    const usageResult = bundle?.usagePayload ?? null;
    const labelAnalysisForAi = catalogLabelFactsForAi ? buildLabelOnlyAnalysis(catalogLabelFactsForAi) : null;
    const efficacyToSend = mergeEfficacyWithFallback(efficacyResult, labelAnalysisForAi?.efficacy);
    const safetyToSend = mergeSafetyWithFallback(safetyResult, labelAnalysisForAi?.safety);
    const usageToSend = mergeUsagePayloadWithFallback(usageResult, labelAnalysisForAi?.usagePayload);

    if (!requestSignal.aborted && !res.writableEnded) {
      if (efficacyToSend) sendSSE(res, "result_efficacy", efficacyToSend);
      if (safetyToSend) sendSSE(res, "result_safety", safetyToSend);
      if (usageToSend) sendSSE(res, "result_usage", usageToSend);
    }

    const resolvedImage = catalogImage ?? detailItems[0]?.image ?? initialItems[0]?.image ?? null;
    const resolvedCategory = catalogCategory ?? extraction.category ?? null;
    const detailSources = detailItems.map((item) => ({
      title: item.title,
      link: item.link,
      domain: extractDomain(item.link),
      isHighQuality: isHighQualityDomain(item.link),
    }));
    const combinedSources = (() => {
      if (!catalogSnapshotForAi) return detailSources;
      const seen = new Set<string>();
      const combined: typeof detailSources = [];
      const add = (source: (typeof detailSources)[number]) => {
        if (!source.link) return;
        if (seen.has(source.link)) return;
        seen.add(source.link);
        combined.push(source);
      };
      detailSources.forEach(add);
      catalogSnapshotForAi.references.items.forEach((ref) => {
        add({
          title: ref.title,
          link: ref.url,
          domain: extractDomain(ref.url),
          isHighQuality: false,
        });
      });
      return combined;
    })();

    const analysisPayloadDraft: SnapshotAnalysisPayload = {
      brandExtraction: {
        brand: extraction.brand,
        product: extraction.product,
        category: extraction.category,
        confidence: extraction.confidence,
        source: extraction.source,
      },
      productInfo: {
        brand,
        name: product,
        category: resolvedCategory,
        image: resolvedImage,
      },
      sources: combinedSources,
      efficacy: efficacyToSend,
      safety: safetyToSend,
      usagePayload: usageToSend,
    };

    const snapshotCandidate = buildBarcodeSnapshot({
      barcode,
      productInfo: analysisPayloadDraft.productInfo ?? null,
      sources: detailItems,
      efficacy: efficacyToSend ?? null,
      safety: safetyToSend ?? null,
      usagePayload: usageToSend ?? null,
    });

    const pickField = (...values: (string | null | undefined)[]) => {
      for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
      }
      return null;
    };

    const mergedCandidate = catalogSnapshotForAi
      ? {
          ...catalogSnapshotForAi,
          product: {
            ...catalogSnapshotForAi.product,
            brand: pickField(catalogSnapshotForAi.product.brand, snapshotCandidate.product.brand),
            name: pickField(catalogSnapshotForAi.product.name, snapshotCandidate.product.name),
            category: pickField(catalogSnapshotForAi.product.category, snapshotCandidate.product.category),
            imageUrl: pickField(catalogSnapshotForAi.product.imageUrl, snapshotCandidate.product.imageUrl),
          },
          references: mergeReferenceItems(catalogSnapshotForAi.references, snapshotCandidate.references),
          scores: snapshotCandidate.scores ?? catalogSnapshotForAi.scores,
          status: snapshotCandidate.scores ? snapshotCandidate.status : catalogSnapshotForAi.status,
          updatedAt: nowIso(),
        }
      : snapshotCandidate;

    const snapshot = validateSnapshotOrFallback({
      candidate: mergedCandidate,
      fallback: {
        source: "barcode",
        barcodeRaw: barcode,
        productInfo: {
          brand,
          name: product,
          category: resolvedCategory,
          imageUrl: resolvedImage,
        },
        createdAt: mergedCandidate.createdAt,
      },
    });

    let analysisPayload: SnapshotAnalysisPayload = {
      ...catalogAnalysisPayloadForAi,
      ...analysisPayloadDraft,
      efficacy: efficacyToSend ?? catalogAnalysisPayloadForAi?.efficacy ?? null,
      safety: safetyToSend ?? catalogAnalysisPayloadForAi?.safety ?? null,
      usagePayload: usageToSend ?? catalogAnalysisPayloadForAi?.usagePayload ?? null,
    };
    if (catalogLabelFactsForAi) {
      const labelAnalysis = labelAnalysisForAi ?? buildLabelOnlyAnalysis(catalogLabelFactsForAi);
      analysisPayload = mergeLabelFallbacks(analysisPayload, labelAnalysis);
    }

    const analysisStatus = buildAnalysisStatus({
      hasLabelFacts: hasLabelFacts(snapshot),
      hasAi: hasAiPayload(analysisPayload),
      dsldLabelId: snapshot.regulatory.dsldLabelId ?? null,
    });
    const analysisMeta = buildAnalysisMeta({
      status: analysisStatus,
      labelExtraction: catalogLabelExtractionForAi ?? analysisPayload.analysis?.labelExtraction ?? null,
    });
    analysisPayload.analysis = analysisMeta;
    snapshot.analysis = analysisMeta;
    snapshot.updatedAt = nowIso();

    const expiresAt = computeExpiresAt(analysisStatus);

    const canRespond = !requestSignal.aborted && !res.writableEnded;

    if (canRespond) {
      sendSSE(res, "snapshot", snapshot);
      sendSSE(res, "done", { barcode });
      res.end();
    }

    if (!bundle && !requestSignal.aborted) {
      queueBarcodeAnalysisCompletion({
        cacheKey,
        barcode,
        detailItems,
        analysisContext,
        analysisPayload,
        snapshot,
        model,
        deepseekKey,
      });
    }

    void storeSnapshotCache({
      key: cacheKey,
      source: "barcode",
      snapshot,
      analysisPayload,
      expiresAt,
    });
    finishInFlight?.();

    const timingTotalMs = Math.round(performance.now() - startedAt);
    const brandName = snapshot.product.brand ?? null;
    const productName = snapshot.product.name ?? null;
    void logBarcodeScan({
      barcodeGtin14,
      barcodeRaw: rawBarcode,
      checksumValid: normalized.isValidChecksum ?? null,
      catalogHit: false,
      servedFrom: "google_ai",
      snapshotId: snapshot.snapshotId,
      brandName,
      productName,
      deviceId,
      requestId,
      timingTotalMs,
      meta: {
        queriesTried: initial.queriesTried,
        initialQuality,
        extraction: {
          brand: extraction.brand,
          product: extraction.product,
          confidence: extraction.confidence,
          source: extraction.source,
          score: extraction.score,
        },
      },
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

app.listen(PORT, () => {
  console.log(`Search backend listening on http://localhost:${PORT}`);
});
