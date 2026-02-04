import { supabase } from "./supabase.js";
import { incrementMetric } from "./metrics.js";
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

type ResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  budget?: DeadlineBudget;
  semaphore?: Semaphore;
  breaker?: CircuitBreaker;
  retry?: Partial<RetryOptions>;
};

const shouldRetrySupabaseError = (error: { status?: number; message?: string } | null): boolean => {
  if (!error) return false;
  if (typeof error.status === "number") return isRetryableStatus(error.status);
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("fetch") || message.includes("network");
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

const buildBarcodeKeyList = (barcodeGtin14: string, barcodeRaw?: string | null): string[] => {
  const keys = [barcodeGtin14, barcodeRaw].filter((value): value is string => Boolean(value));
  return Array.from(new Set(keys));
};

const selectNegativeCacheRow = async (
  barcodeGtin14: string,
  signal: AbortSignal,
  barcodeRaw?: string | null,
): Promise<NegativeCacheRow | null> => {
  const keys = buildBarcodeKeyList(barcodeGtin14, barcodeRaw);
  let query = supabase
    .from("negative_cache")
    .select("barcode_gtin14,barcode_raw,reason_code,until,attempt_count,last_attempt_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (keys.length > 1) {
    query = query.in("barcode_gtin14", keys);
  } else if (keys.length === 1) {
    query = query.eq("barcode_gtin14", keys[0]);
  } else {
    return null;
  }
  query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
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
    const keys = buildBarcodeKeyList(barcodeGtin14, barcodeRaw);
    let query = supabase
      .from("negative_cache")
      .select("barcode_gtin14,barcode_raw,reason_code,until,attempt_count,last_attempt_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (keys.length > 1) {
      query = query.in("barcode_gtin14", keys);
    } else if (keys.length === 1) {
      query = query.eq("barcode_gtin14", keys[0]);
    } else {
      return null;
    }
    query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "negative_cache_read_error");
    }
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
    const existing = await selectNegativeCacheRow(input.barcodeGtin14, signal, input.barcodeRaw ?? null);
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      barcode_gtin14: input.barcodeGtin14,
      barcode_raw: input.barcodeRaw ?? existing?.barcode_raw ?? null,
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
  options: ResilienceOptions = {},
): Promise<void> {
  await runWithResilience(async (signal) => {
    const { error } = await supabase
      .from("negative_cache")
      .delete()
      .eq("barcode_gtin14", barcodeGtin14)
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "negative_cache_delete_error");
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
    const keys = buildBarcodeKeyList(barcodeGtin14, barcodeRaw);
    let query = supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,barcode_raw,npn,confidence,source,last_seen_at,expires_at,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (keys.length > 1) {
      query = query.in("barcode_gtin14", keys);
    } else if (keys.length === 1) {
      query = query.eq("barcode_gtin14", keys[0]);
    } else {
      return null;
    }
    query = query.abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    if (error && resilience.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "barcode_regulatory_map_read_error");
    }
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
  await runWithResilience(async (signal) => {
    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      barcode_gtin14: input.barcodeGtin14,
      barcode_raw: input.barcodeRaw ?? null,
      npn: input.npn,
      confidence: input.confidence,
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
