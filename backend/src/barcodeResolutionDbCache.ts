import { supabase } from "./supabase.js";
import { incrementMetric, recordRegulatoryWritePolicyDecision } from "./metrics.js";
import { buildBarcodeVariantKeys, normalizeBarcodeKey } from "./barcodeKey.js";
import {
  HttpError,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
} from "./resilience.js";
import type { CircuitBreaker, DeadlineBudget, RetryOptions, Semaphore } from "./resilience.js";

export type SerpCacheRow = {
  cache_key: string;
  barcode_gtin14: string;
  profile_id: string;
  gl: string | null;
  hl: string | null;
  engine_version: string;
  query: string;
  results: unknown;
  fetched_at: string;
  expires_at: string;
};

export type ResolutionCacheRow = {
  barcode_gtin14: string;
  engine_version: string;
  best_url: string | null;
  best_domain: string | null;
  signals: Record<string, unknown> | null;
  confidence: number | null;
  success_count: number;
  fail_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  expires_at: string | null;
  updated_at: string;
};

export type NegativeCacheRow = {
  barcode_gtin14: string;
  barcode_raw?: string | null;
  reason_code: string;
  until: string;
  attempt_count: number;
  last_attempt_at: string;
  updated_at: string;
};

export type NpnNegativeCacheRow = {
  npn: string;
  reason_code: string;
  until: string | null;
  attempt_count: number;
  last_attempt_at: string;
  updated_at: string;
};

export type BarcodeRegulatoryMapRow = {
  barcode_gtin14: string;
  barcode_raw?: string | null;
  npn: string;
  confidence: number;
  source: string;
  last_seen_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BarcodeRegulatoryMapWriteOutcome = {
  status: "upserted" | "blocked";
  reason:
    | "insert"
    | "rank_upgrade"
    | "equal_rank_better"
    | "lower_rank"
    | "equal_rank_not_better"
    | "negative_signal"
    | "write_skipped";
  existing: BarcodeRegulatoryMapRow | null;
  incomingRank: number;
  existingRank: number | null;
};

export type RegulatoryMapWriteDecision = {
  allowWrite: boolean;
  reason: "insert" | "rank_upgrade" | "equal_rank_better" | "lower_rank" | "equal_rank_not_better" | "negative_signal";
  incomingRank: number;
  existingRank: number | null;
};

export type BarcodeHistoricalLnhpdCandidate = {
  barcode_gtin14: string;
  npn: string;
  source: "barcode_scans";
  created_at: string;
  served_from: "lnhpd";
};

export type BarcodeResolutionTrainingRow = {
  id: number;
  barcode_gtin14: string;
  engine_version: string;
  stage0_outcome: string;
  query_profiles_used: string[] | null;
  serp_topk: unknown | null;
  selected_url: string | null;
  selected_domain: string | null;
  signals: Record<string, unknown> | null;
  facts_summary: Record<string, unknown> | null;
  facts_coverage: number | null;
  timing: Record<string, unknown> | null;
  calls: Record<string, unknown> | null;
  cache_hits: Record<string, unknown> | null;
  outcome: string;
  created_at: string;
};

type ContractMode = "off" | "shadow" | "enforce";

type ResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  budget?: DeadlineBudget;
  semaphore?: Semaphore;
  breaker?: CircuitBreaker;
  retry?: Partial<RetryOptions>;
  keyContractMode?: ContractMode;
  writeGuardMode?: ContractMode;
};

const shouldRetrySupabaseError = (error: { status?: number; message?: string } | null): boolean => {
  if (!error) return false;
  if (typeof error.status === "number") return isRetryableStatus(error.status);
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("fetch") || message.includes("network");
};

const normalizeNpn = (value: string | null | undefined): string =>
  String(value ?? "").replace(/\D/g, "").trim();

const normalizeConfidence = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
};

const parseIsoTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const resolveCanonicalGtin14 = (value: string): string | null => normalizeBarcodeKey(value).gtin14;

const resolveContractMode = (value: unknown, fallback: ContractMode): ContractMode => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "off") return "off";
  if (raw === "shadow") return "shadow";
  if (raw === "enforce") return "enforce";
  return fallback;
};

const resolveKeyContractMode = (override?: ContractMode): ContractMode =>
  resolveContractMode(override ?? process.env.KEY_CONTRACT_V2, "enforce");

const resolveWriteGuardMode = (override?: ContractMode): ContractMode =>
  resolveContractMode(override ?? process.env.WRITE_GUARD_V2, "enforce");

const mapSourceToRank = (source: string): number => {
  const normalized = String(source ?? "").trim().toLowerCase();
  if (!normalized) return 100;
  if (
    normalized === "verified_regulatory" ||
    normalized === "lnhpd" ||
    normalized === "name_match" ||
    normalized === "manual_verified" ||
    normalized === "barcode_scans"
  ) {
    return 400;
  }
  if (
    normalized === "label_record" ||
    normalized === "dsld" ||
    normalized === "label_scan" ||
    normalized === "catalog_label"
  ) {
    return 300;
  }
  if (
    normalized === "stable_db" ||
    normalized === "scan_history" ||
    normalized === "map" ||
    normalized === "map_stale"
  ) {
    return 200;
  }
  if (normalized === "lnhpd_not_found") {
    return 10;
  }
  return 100;
};

export const evaluateRegulatoryMapWritePolicy = (params: {
  existing: BarcodeRegulatoryMapRow | null;
  incoming: {
    npn: string;
    confidence: number;
    source: string;
    expiresAt: string | null;
  };
}): RegulatoryMapWriteDecision => {
  const incomingRank = mapSourceToRank(params.incoming.source);
  const existing = params.existing;
  if (!existing) {
    return {
      allowWrite: true,
      reason: "insert",
      incomingRank,
      existingRank: null,
    };
  }

  const existingRank = mapSourceToRank(existing.source);
  const incomingSource = String(params.incoming.source ?? "").trim().toLowerCase();
  const incomingIsNegativeSignal = incomingSource === "lnhpd_not_found";
  const existingIsPositive = existingRank > 10;
  if (incomingIsNegativeSignal && existingIsPositive) {
    return {
      allowWrite: false,
      reason: "negative_signal",
      incomingRank,
      existingRank,
    };
  }

  if (incomingRank > existingRank) {
    return {
      allowWrite: true,
      reason: "rank_upgrade",
      incomingRank,
      existingRank,
    };
  }

  if (incomingRank < existingRank) {
    return {
      allowWrite: false,
      reason: "lower_rank",
      incomingRank,
      existingRank,
    };
  }

  const incomingConfidence = normalizeConfidence(params.incoming.confidence);
  const existingConfidence = normalizeConfidence(existing.confidence);
  const existingNpn = normalizeNpn(existing.npn);
  const incomingNpn = normalizeNpn(params.incoming.npn);
  const sameNpn = existingNpn === incomingNpn;
  const confidenceThreshold = sameNpn ? 0.01 : 0.1;
  const confidenceImproved = incomingConfidence >= existingConfidence + confidenceThreshold;
  const incomingExpiryMs = parseIsoTime(params.incoming.expiresAt);
  const existingExpiryMs = parseIsoTime(existing.expires_at);
  const fresherForSameNpn =
    sameNpn &&
    incomingExpiryMs !== null &&
    (existingExpiryMs === null || incomingExpiryMs > existingExpiryMs);

  if (confidenceImproved || fresherForSameNpn) {
    return {
      allowWrite: true,
      reason: "equal_rank_better",
      incomingRank,
      existingRank,
    };
  }

  return {
    allowWrite: false,
    reason: "equal_rank_not_better",
    incomingRank,
    existingRank,
  };
};

const recordWriteGuardObservation = (params: {
  mode: ContractMode;
  source: string;
  decision: RegulatoryMapWriteDecision;
}): void => {
  if (params.mode !== "shadow" && params.mode !== "enforce") return;
  const sourceKind = String(params.source ?? "").trim().toLowerCase() || "unknown";
  const reason = String(params.decision.reason ?? "unknown");
  const incomingRank = Number.isFinite(params.decision.incomingRank) ? params.decision.incomingRank : -1;

  if (!params.decision.allowWrite) {
    recordRegulatoryWritePolicyDecision({
      mode: params.mode,
      decision: "wouldBlock",
      sourceKind,
      incomingRank,
      reason,
    });
    recordRegulatoryWritePolicyDecision({
      mode: params.mode,
      decision: "wouldWriteCandidateOnly",
      sourceKind,
      incomingRank,
      reason,
    });
    return;
  }

  if (params.decision.reason === "rank_upgrade") {
    recordRegulatoryWritePolicyDecision({
      mode: params.mode,
      decision: "wouldUpgrade",
      sourceKind,
      incomingRank,
      reason,
    });
    return;
  }

  if (params.decision.reason === "equal_rank_better") {
    recordRegulatoryWritePolicyDecision({
      mode: params.mode,
      decision: "wouldReplaceSameRank",
      sourceKind,
      incomingRank,
      reason,
    });
  }
};

const selectResolutionCacheRow = async (
  barcodeGtin14: string,
  signal: AbortSignal,
): Promise<ResolutionCacheRow | null> => {
  const query = supabase
    .from("resolution_cache")
    .select(
      "barcode_gtin14,engine_version,best_url,best_domain,signals,confidence,success_count,fail_count,last_success_at,last_failure_at,expires_at,updated_at",
    )
    .eq("barcode_gtin14", barcodeGtin14)
    .abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  if (isExpired((data as { expires_at?: string | null }).expires_at)) return null;
  return data as ResolutionCacheRow;
};

const buildBarcodeKeyList = (
  barcodeGtin14: string,
  barcodeRaw?: string | null,
  mode: ContractMode = resolveKeyContractMode(),
): string[] => {
  const canonical = resolveCanonicalGtin14(barcodeGtin14);
  if (!canonical) return [];
  if (mode === "enforce") {
    return buildBarcodeVariantKeys({ gtin14: canonical, raw: barcodeRaw ?? null });
  }
  const legacy = new Set<string>([canonical]);
  const rawNormalized = normalizeBarcodeKey(barcodeRaw ?? "").rawNormalized;
  if (rawNormalized) legacy.add(rawNormalized);
  return Array.from(legacy);
};

const selectNegativeCacheRow = async (
  barcodeGtin14: string,
  signal: AbortSignal,
  barcodeRaw?: string | null,
  keyContractMode?: ContractMode,
): Promise<NegativeCacheRow | null> => {
  const keys = buildBarcodeKeyList(barcodeGtin14, barcodeRaw, resolveKeyContractMode(keyContractMode));
  if (!keys.length) return null;
  const readBy = async (column: "barcode_gtin14" | "barcode_raw") => {
    let query = supabase
      .from("negative_cache")
      .select("barcode_gtin14,barcode_raw,reason_code,until,attempt_count,last_attempt_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (keys.length > 1) {
      query = query.in(column, keys);
    } else {
      query = query.eq(column, keys[0]);
    }
    return await query.abortSignal(signal).maybeSingle();
  };

  const byGtin = await readBy("barcode_gtin14");
  const byRaw = byGtin.data ? { data: null, error: null } : await readBy("barcode_raw");
  const data = byGtin.data ?? byRaw.data;
  if (!data) return null;
  if (isExpired((data as { until?: string }).until)) return null;
  return data as NegativeCacheRow;
};

const isExpired = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms <= Date.now();
};

const selectNpnNegativeCacheRow = async (
  npn: string,
  signal: AbortSignal,
): Promise<NpnNegativeCacheRow | null> => {
  const query = supabase
    .from("npn_negative_cache")
    .select("npn,reason_code,until,attempt_count,last_attempt_at,updated_at")
    .eq("npn", npn)
    .abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  if (isExpired((data as { until?: string | null }).until ?? null)) return null;
  return data as NpnNegativeCacheRow;
};

const selectBarcodeRegulatoryMapByPrimaryKey = async (
  barcodeGtin14: string,
  signal: AbortSignal,
): Promise<BarcodeRegulatoryMapRow | null> => {
  const { data, error } = await supabase
    .from("barcode_regulatory_map")
    .select("barcode_gtin14,barcode_raw,npn,confidence,source,last_seen_at,expires_at,created_at,updated_at")
    .eq("barcode_gtin14", barcodeGtin14)
    .abortSignal(signal)
    .maybeSingle();
  if (error || !data) return null;
  return data as BarcodeRegulatoryMapRow;
};

const insertBlockedRegulatoryCandidate = async (
  input: {
    barcodeGtin14: string;
    barcodeRaw?: string | null;
    npn: string;
    confidence: number;
    source: string;
    expiresAt: string | null;
  },
  existing: BarcodeRegulatoryMapRow | null,
  policy: {
    reason: "lower_rank" | "equal_rank_not_better" | "negative_signal";
    incomingRank: number;
    existingRank: number | null;
  },
  signal: AbortSignal,
): Promise<void> => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("barcode_regulatory_map_candidates")
    .insert({
      barcode_gtin14: input.barcodeGtin14,
      barcode_raw: input.barcodeRaw ?? null,
      incoming_npn: input.npn,
      incoming_source: input.source,
      incoming_confidence: normalizeConfidence(input.confidence),
      incoming_expires_at: input.expiresAt,
      incoming_rank: policy.incomingRank,
      existing_npn: existing?.npn ?? null,
      existing_source: existing?.source ?? null,
      existing_confidence: existing?.confidence ?? null,
      existing_expires_at: existing?.expires_at ?? null,
      existing_rank: policy.existingRank,
      reason_code: policy.reason,
      created_at: now,
    })
    .abortSignal(signal);
  if (!error) return;

  const errorCode = String((error as { code?: string }).code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  // Missing migration should not break the primary write-path behavior.
  if (errorCode === "42P01" || message.includes("does not exist")) {
    return;
  }
  console.warn("[barcode-regulatory-map] blocked-candidate insert failed", {
    barcodeGtin14: input.barcodeGtin14,
    source: input.source,
    reason: policy.reason,
    error: error.message ?? "unknown_error",
  });
};

const shouldPersistBlockedCandidate = (params: {
  reason: "lower_rank" | "equal_rank_not_better" | "negative_signal";
  incomingRank: number;
  existingRank: number | null;
}): boolean => {
  if (params.reason !== "lower_rank") return true;
  if (!Number.isFinite(params.incomingRank)) return true;
  if (!Number.isFinite(Number(params.existingRank))) return true;
  const existingRank = Number(params.existingRank);
  // Keep candidate audit focused on actionable conflicts:
  // suppress low-rank noise when a strong authoritative mapping already exists.
  if (existingRank >= 300 && params.incomingRank <= 100) {
    return false;
  }
  return true;
};

const runWithResilience = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: ResilienceOptions,
): Promise<T | null> => {
  if (options.signal?.aborted) return null;
  if (options.breaker && !options.breaker.canRequest()) return null;

  const timeoutMs = options.timeoutMs ?? (options.budget ? options.budget.msLeft() : undefined);
  const budgetedTimeout =
    typeof timeoutMs === "number" && options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
  if (typeof budgetedTimeout === "number" && budgetedTimeout <= 0) return null;

  let release: (() => void) | null = null;
  if (options.semaphore) {
    try {
      release = await options.semaphore.acquire({
        timeoutMs: options.queueTimeoutMs ?? 0,
        signal: options.signal,
      });
    } catch {
      return null;
    }
  }

  const retryConfig: RetryOptions = {
    maxAttempts: options.retry?.maxAttempts ?? 1,
    baseDelayMs: options.retry?.baseDelayMs ?? 80,
    maxDelayMs: options.retry?.maxDelayMs ?? 200,
    jitterRatio: options.retry?.jitterRatio ?? 0.3,
    shouldRetry: (error) => {
      if (isAbortError(error)) return false;
      if (error instanceof HttpError) return isRetryableStatus(error.status);
      return false;
    },
    signal: options.signal,
    budget: options.budget,
  };

  try {
    const result = await withRetry(async () => {
      const timeoutSignal =
        typeof budgetedTimeout === "number" ? createTimeoutSignal(budgetedTimeout) : undefined;
      const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
      try {
        return await fn(signal);
      } finally {
        cleanup();
      }
    }, retryConfig);
    options.breaker?.recordSuccess();
    return result;
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    return null;
  } finally {
    release?.();
  }
};

export async function getSerpCache(
  cacheKey: string,
  options: ResilienceOptions = {},
): Promise<SerpCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const query = supabase
      .from("serp_cache")
      .select("cache_key,barcode_gtin14,profile_id,gl,hl,engine_version,query,results,fetched_at,expires_at")
      .eq("cache_key", cacheKey)
      .abortSignal(signal);
    const { data, error } = await query.maybeSingle();

    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "serp_cache_read_error");
    }
    if (error || !data) return null;
    if (isExpired(data.expires_at)) return null;
    return data as SerpCacheRow;
  }, options);
}

export async function upsertSerpCache(
  row: Omit<SerpCacheRow, "fetched_at"> & { fetched_at?: string },
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const record = {
      ...row,
      fetched_at: row.fetched_at ?? new Date().toISOString(),
    };
    const { error } = await supabase
      .from("serp_cache")
      .upsert(record, { onConflict: "cache_key" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "serp_cache_write_error");
    }
    return null;
  }, options);
}

export async function getResolutionCache(
  barcodeGtin14: string,
  options: ResilienceOptions = {},
): Promise<ResolutionCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const query = supabase
      .from("resolution_cache")
      .select(
        "barcode_gtin14,engine_version,best_url,best_domain,signals,confidence,success_count,fail_count,last_success_at,last_failure_at,expires_at,updated_at",
      )
      .eq("barcode_gtin14", barcodeGtin14)
      .abortSignal(signal);
    const { data, error } = await query.maybeSingle();

    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "resolution_cache_read_error");
    }
    if (error || !data) return null;
    if (isExpired(data.expires_at ?? null)) return null;
    return data as ResolutionCacheRow;
  }, options);
}

export async function upsertResolutionCacheStrongMatch(
  input: {
    barcodeGtin14: string;
    engineVersion: string;
    bestUrl: string;
    bestDomain: string | null;
    signals: Record<string, unknown> | null;
    confidence: number;
    expiresAt: string | null;
    lastSuccessAt?: string;
  },
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      barcode_gtin14: input.barcodeGtin14,
      engine_version: input.engineVersion,
      best_url: input.bestUrl,
      best_domain: input.bestDomain,
      signals: input.signals,
      confidence: input.confidence,
      updated_at: now,
      last_success_at: input.lastSuccessAt ?? now,
      expires_at: input.expiresAt,
    };

    const existing = await selectResolutionCacheRow(input.barcodeGtin14, signal);
    record.success_count = (existing?.success_count ?? 0) + 1;
    record.fail_count = existing?.fail_count ?? 0;

    const { error } = await supabase
      .from("resolution_cache")
      .upsert(record, { onConflict: "barcode_gtin14" })
      .abortSignal(signal);

    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "resolution_cache_write_error");
    }
    return null;
  }, options);
}

export async function recordResolutionCacheFailure(
  barcodeGtin14: string,
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const existing = await selectResolutionCacheRow(barcodeGtin14, signal);
    if (!existing) return null;
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      ...existing,
      fail_count: (existing.fail_count ?? 0) + 1,
      last_failure_at: now,
      updated_at: now,
    };
    const { error } = await supabase
      .from("resolution_cache")
      .upsert(record, { onConflict: "barcode_gtin14" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "resolution_cache_failure_write_error");
    }
    return null;
  }, options);
}

export async function clearResolutionCacheBestUrl(
  barcodeGtin14: string,
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const existing = await selectResolutionCacheRow(barcodeGtin14, signal);
    if (!existing) return null;
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      ...existing,
      best_url: null,
      best_domain: null,
      confidence: null,
      updated_at: now,
    };
    const { error } = await supabase
      .from("resolution_cache")
      .upsert(record, { onConflict: "barcode_gtin14" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "resolution_cache_clear_write_error");
    }
    return null;
  }, options);
}

export async function getNegativeCache(
  barcodeGtin14: string,
  barcodeRaw?: string | null,
  options: ResilienceOptions = {},
): Promise<NegativeCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const keys = buildBarcodeKeyList(
      barcodeGtin14,
      barcodeRaw,
      resolveKeyContractMode(options.keyContractMode),
    );
    if (!keys.length) return null;

    const readBy = async (column: "barcode_gtin14" | "barcode_raw") => {
      let query = supabase
        .from("negative_cache")
        .select("barcode_gtin14,barcode_raw,reason_code,until,attempt_count,last_attempt_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (keys.length > 1) {
        query = query.in(column, keys);
      } else {
        query = query.eq(column, keys[0]);
      }
      const { data, error } = await query.abortSignal(signal).maybeSingle();
      if (error && options.retry && shouldRetrySupabaseError(error)) {
        const rawStatus = (error as { status?: number }).status;
        const status = typeof rawStatus === "number" ? rawStatus : 503;
        throw new HttpError(status, error.message ?? "negative_cache_read_error");
      }
      return { data, error };
    };

    const byGtin = await readBy("barcode_gtin14");
    const byRaw = byGtin.data ? { data: null, error: null } : await readBy("barcode_raw");
    const data = byGtin.data ?? byRaw.data;
    const error = byGtin.error ?? byRaw.error;
    if (error || !data) return null;
    if (isExpired(data.until)) return null;
    return data as NegativeCacheRow;
  }, options);
}

export async function upsertNegativeCache(
  input: {
    barcodeGtin14: string;
    reasonCode: string;
    until: string;
    barcodeRaw?: string | null;
  },
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const canonicalGtin14 = resolveCanonicalGtin14(input.barcodeGtin14);
    if (!canonicalGtin14) return null;
    const normalizedRaw = normalizeBarcodeKey(input.barcodeRaw ?? "").rawNormalized || null;
    const existing = await selectNegativeCacheRow(
      canonicalGtin14,
      signal,
      normalizedRaw,
      resolveKeyContractMode(options.keyContractMode),
    );
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      barcode_gtin14: canonicalGtin14,
      barcode_raw: normalizedRaw ?? existing?.barcode_raw ?? null,
      reason_code: input.reasonCode,
      until: input.until,
      attempt_count: (existing?.attempt_count ?? 0) + 1,
      last_attempt_at: now,
      updated_at: now,
    };
    const { error } = await supabase
      .from("negative_cache")
      .upsert(record, { onConflict: "barcode_gtin14" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "negative_cache_write_error");
    }
    return null;
  }, options);
}

export async function clearNegativeCache(
  barcodeGtin14: string,
  barcodeRaw: string | null = null,
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const keys = buildBarcodeKeyList(
      barcodeGtin14,
      barcodeRaw,
      resolveKeyContractMode(options.keyContractMode),
    );
    if (!keys.length) return null;

    const deleteBy = async (column: "barcode_gtin14" | "barcode_raw") => {
      let query = supabase.from("negative_cache").delete();
      if (keys.length > 1) {
        query = query.in(column, keys);
      } else {
        query = query.eq(column, keys[0]);
      }
      const { error } = await query.abortSignal(signal);
      if (error && options.retry && shouldRetrySupabaseError(error)) {
        const rawStatus = (error as { status?: number }).status;
        const status = typeof rawStatus === "number" ? rawStatus : 503;
        throw new HttpError(status, error.message ?? "negative_cache_delete_error");
      }
      return error;
    };

    const primaryError = await deleteBy("barcode_gtin14");
    const secondaryError = await deleteBy("barcode_raw");
    if (primaryError && !secondaryError) {
      return null;
    }
    return null;
  }, options);
}

export async function getNpnNegativeCache(
  npn: string,
  options: ResilienceOptions = {},
): Promise<NpnNegativeCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const query = supabase
      .from("npn_negative_cache")
      .select("npn,reason_code,until,attempt_count,last_attempt_at,updated_at")
      .eq("npn", npn)
      .abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "npn_negative_cache_read_error");
    }
    if (error || !data) return null;
    if (!data.until) return null;
    if (isExpired(data.until ?? null)) return null;
    return data as NpnNegativeCacheRow;
  }, options);
}

export async function recordNpnNegativeAttempt(
  input: {
    npn: string;
    reasonCode: string;
    windowMs: number;
    threshold: number;
    ttlMs: number;
  },
  options: ResilienceOptions = {},
): Promise<NpnNegativeCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const existing = await selectNpnNegativeCacheRow(input.npn, signal);
    const now = new Date().toISOString();
    const lastAttemptMs = existing?.last_attempt_at ? Date.parse(existing.last_attempt_at) : null;
    const withinWindow = lastAttemptMs !== null && Date.now() - lastAttemptMs <= input.windowMs;
    const attemptCount = withinWindow ? (existing?.attempt_count ?? 0) + 1 : 1;
    const shouldBlock = attemptCount >= Math.max(1, input.threshold);
    const until = shouldBlock ? new Date(Date.now() + input.ttlMs).toISOString() : existing?.until ?? null;
    const record: Record<string, unknown> = {
      npn: input.npn,
      reason_code: input.reasonCode,
      attempt_count: attemptCount,
      last_attempt_at: now,
      until,
      updated_at: now,
    };
    const { error } = await supabase
      .from("npn_negative_cache")
      .upsert(record, { onConflict: "npn" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "npn_negative_cache_write_error");
    }
    if (error) return null;
    return record as NpnNegativeCacheRow;
  }, options);
}

export async function clearNpnNegativeCache(
  npn: string,
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const { error } = await supabase
      .from("npn_negative_cache")
      .delete()
      .eq("npn", npn)
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "npn_negative_cache_delete_error");
    }
    return null;
  }, options);
}

export async function getBarcodeRegulatoryMap(
  barcodeGtin14: string,
  barcodeRaw?: string | null,
  options: (ResilienceOptions & { includeExpired?: boolean }) = {},
): Promise<BarcodeRegulatoryMapRow | null> {
  const { includeExpired, ...resilience } = options;
  return await runWithResilience(async (signal) => {
    const keys = buildBarcodeKeyList(
      barcodeGtin14,
      barcodeRaw,
      resolveKeyContractMode(resilience.keyContractMode),
    );
    if (!keys.length) return null;

    const readBy = async (column: "barcode_gtin14" | "barcode_raw") => {
      let query = supabase
        .from("barcode_regulatory_map")
        .select("barcode_gtin14,barcode_raw,npn,confidence,source,last_seen_at,expires_at,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (keys.length > 1) {
        query = query.in(column, keys);
      } else {
        query = query.eq(column, keys[0]);
      }
      const { data, error } = await query.abortSignal(signal).maybeSingle();
      if (error && resilience.retry && shouldRetrySupabaseError(error)) {
        const rawStatus = (error as { status?: number }).status;
        const status = typeof rawStatus === "number" ? rawStatus : 503;
        throw new HttpError(status, error.message ?? "barcode_regulatory_map_read_error");
      }
      return { data, error };
    };

    const byGtin = await readBy("barcode_gtin14");
    const byRaw = byGtin?.data ? { data: null, error: null } : await readBy("barcode_raw");
    const data = byGtin?.data ?? byRaw?.data ?? null;
    const error = byGtin?.error ?? byRaw?.error ?? null;
    if (error || !data) return null;
    if (!includeExpired && isExpired(data.expires_at ?? null)) return null;
    return data as BarcodeRegulatoryMapRow;
  }, resilience);
}

export async function upsertBarcodeRegulatoryMap(
  input: {
    barcodeGtin14: string;
    npn: string;
    confidence: number;
    source: string;
    expiresAt: string | null;
    barcodeRaw?: string | null;
  },
  options: ResilienceOptions = {},
): Promise<void> {
  await upsertRegulatoryMapWithPolicy(input, options);
}

export async function upsertRegulatoryMapWithPolicy(
  input: {
    barcodeGtin14: string;
    npn: string;
    confidence: number;
    source: string;
    expiresAt: string | null;
    barcodeRaw?: string | null;
  },
  options: ResilienceOptions = {},
): Promise<BarcodeRegulatoryMapWriteOutcome> {
  const writeGuardMode = resolveWriteGuardMode(options.writeGuardMode);
  const writeOutcome = await runWithResilience(async (signal) => {
    const canonicalGtin14 = resolveCanonicalGtin14(input.barcodeGtin14);
    const normalizedNpn = normalizeNpn(input.npn);
    if (!canonicalGtin14 || !normalizedNpn) {
      return {
        status: "blocked",
        reason: "write_skipped",
        existing: null,
        incomingRank: mapSourceToRank(input.source),
        existingRank: null,
      } as BarcodeRegulatoryMapWriteOutcome;
    }

    const existing = await selectBarcodeRegulatoryMapByPrimaryKey(canonicalGtin14, signal);
    const decision = evaluateRegulatoryMapWritePolicy({
      existing,
      incoming: {
        npn: normalizedNpn,
        confidence: input.confidence,
        source: input.source,
        expiresAt: input.expiresAt,
      },
    });
    recordWriteGuardObservation({
      mode: writeGuardMode,
      source: input.source,
      decision,
    });

    if (!decision.allowWrite) {
      const blockedReason =
        decision.reason === "lower_rank" ||
        decision.reason === "equal_rank_not_better" ||
        decision.reason === "negative_signal"
          ? decision.reason
          : "equal_rank_not_better";
      if (writeGuardMode === "enforce") {
        const persistBlockedCandidate = shouldPersistBlockedCandidate({
          reason: blockedReason,
          incomingRank: decision.incomingRank,
          existingRank: decision.existingRank,
        });
        if (persistBlockedCandidate) {
          await insertBlockedRegulatoryCandidate(
            {
              barcodeGtin14: canonicalGtin14,
              barcodeRaw: input.barcodeRaw ?? null,
              npn: normalizedNpn,
              confidence: input.confidence,
              source: input.source,
              expiresAt: input.expiresAt,
            },
            existing,
            {
              reason: blockedReason,
              incomingRank: decision.incomingRank,
              existingRank: decision.existingRank,
            },
            signal,
          );
        } else {
          incrementMetric("regulatory_candidate_write_suppressed_low_signal");
        }
        return {
          status: "blocked",
          reason: blockedReason,
          existing,
          incomingRank: decision.incomingRank,
          existingRank: decision.existingRank,
        } as BarcodeRegulatoryMapWriteOutcome;
      }
    }

    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      barcode_gtin14: canonicalGtin14,
      barcode_raw: normalizeBarcodeKey(input.barcodeRaw ?? "").rawNormalized || null,
      npn: normalizedNpn,
      confidence: normalizeConfidence(input.confidence),
      source: input.source,
      last_seen_at: now,
      expires_at: input.expiresAt,
      updated_at: now,
    };
    const { error } = await supabase
      .from("barcode_regulatory_map")
      .upsert(record, { onConflict: "barcode_gtin14" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "barcode_regulatory_map_write_error");
    }
    if (error) {
      return {
        status: "blocked",
        reason: "write_skipped",
        existing,
        incomingRank: decision.incomingRank,
        existingRank: decision.existingRank,
      } as BarcodeRegulatoryMapWriteOutcome;
    }
    return {
      status: "upserted",
      reason: decision.reason,
      existing,
      incomingRank: decision.incomingRank,
      existingRank: decision.existingRank,
    } as BarcodeRegulatoryMapWriteOutcome;
  }, options);

  return (
    writeOutcome ?? {
      status: "blocked",
      reason: "write_skipped",
      existing: null,
      incomingRank: mapSourceToRank(input.source),
      existingRank: null,
    }
  );
}

export async function getHistoricalLnhpdScanNpn(
  barcodeGtin14: string,
  barcodeRaw?: string | null,
  options: ResilienceOptions = {},
): Promise<BarcodeHistoricalLnhpdCandidate | null> {
  return await runWithResilience(async (signal) => {
    const keys = buildBarcodeKeyList(
      barcodeGtin14,
      barcodeRaw,
      resolveKeyContractMode(options.keyContractMode),
    );
    if (!keys.length) return null;

    let query = supabase
      .from("barcode_scans")
      .select("barcode_gtin14,served_from,meta,created_at")
      .eq("served_from", "lnhpd")
      .order("created_at", { ascending: false })
      .limit(30);

    if (keys.length > 1) {
      query = query.in("barcode_gtin14", keys);
    } else {
      query = query.eq("barcode_gtin14", keys[0]);
    }

    const { data, error } = await query.abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "barcode_scans_lnhpd_read_error");
    }
    if (error || !Array.isArray(data) || data.length === 0) return null;

    for (const row of data as Array<Record<string, unknown>>) {
      const meta =
        row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : null;
      const rawNpn = meta && typeof meta.npn === "string" ? meta.npn : "";
      const npn = rawNpn.replace(/\D/g, "").trim();
      if (!npn) continue;
      if (npn.length < 6 || npn.length > 10) continue;

      const lnhpdFetchStatus =
        meta && typeof meta.lnhpd_fetch_status === "string" ? meta.lnhpd_fetch_status : null;
      const stage0 = meta && typeof meta.stage0 === "string" ? meta.stage0.toLowerCase() : "";
      // Accept historical rows only when they were actually resolved through LNHPD.
      if (lnhpdFetchStatus && lnhpdFetchStatus !== "success") continue;
      if (!lnhpdFetchStatus && !stage0.includes("lnhpd")) continue;

      const createdAt =
        typeof row.created_at === "string" && row.created_at.trim().length > 0
          ? row.created_at
          : new Date().toISOString();
      return {
        barcode_gtin14:
          typeof row.barcode_gtin14 === "string" && row.barcode_gtin14.trim().length > 0
            ? row.barcode_gtin14
            : barcodeGtin14,
        npn,
        source: "barcode_scans",
        created_at: createdAt,
        served_from: "lnhpd",
      };
    }

    return null;
  }, options);
}

export async function insertBarcodeResolutionTrainingRow(
  input: Omit<BarcodeResolutionTrainingRow, "id" | "created_at">,
  options: ResilienceOptions = {},
): Promise<void> {
  if (options.signal?.aborted) {
    return;
  }
  if (options.breaker && !options.breaker.canRequest()) {
    incrementMetric("training_write_breaker_open");
    return;
  }
  await runWithResilience(async (signal) => {
    const { error } = await supabase
      .from("barcode_resolution_training")
      .insert({
        ...input,
      })
      .abortSignal(signal);
    const aborted = Boolean(signal.aborted);
    if (!error) {
      incrementMetric("training_write_success");
    } else if (aborted) {
      incrementMetric("training_write_timeout");
    } else {
      const err = error as {
        status?: number;
        message?: string;
        details?: string | null;
        hint?: string | null;
        code?: string | null;
      };
      console.error("[training_write_error]", {
        barcode_gtin14: input.barcode_gtin14,
        outcome: input.outcome,
        status: err.status,
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        hint: err.hint ?? null,
      });
    }
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "barcode_resolution_training_write_error");
    }
    return null;
  }, options);
}
