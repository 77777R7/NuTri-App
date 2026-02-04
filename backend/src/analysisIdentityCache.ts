import { supabase } from "./supabase.js";
import {
  HttpError,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
} from "./resilience.js";
import type { CircuitBreaker, DeadlineBudget, RetryOptions, Semaphore } from "./resilience.js";

export type AnalysisIdentityCacheRow = {
  identity_type: string;
  identity_value: string;
  locale: string;
  prompt_version: string;
  facts_digest_hash: string;
  facts_source_version: string;
  section: string;
  status: "pending" | "complete" | "error";
  payload: unknown | null;
  facts_digest_json: unknown;
  updated_at: string;
  created_at: string;
  expires_at: string | null;
};

export type WebCanonicalMapRow = {
  barcode_gtin14: string;
  engine_version: string;
  canonical_urls: string[];
  canonical_hash: string;
  best_url: string | null;
  expires_at: string | null;
  updated_at: string;
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

const isExpired = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms <= Date.now();
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

export async function getAnalysisIdentityCache(params: {
  identityType: string;
  identityValue: string;
  locale: string;
  promptVersion: string;
  factsDigestHash: string;
  section: string;
}, options: ResilienceOptions = {}): Promise<AnalysisIdentityCacheRow | null> {
  return await runWithResilience(async (signal) => {
    const query = supabase
      .from("analysis_identity_cache")
      .select(
        "identity_type,identity_value,locale,prompt_version,facts_digest_hash,facts_source_version,section,status,payload,facts_digest_json,updated_at,created_at,expires_at",
      )
      .eq("identity_type", params.identityType)
      .eq("identity_value", params.identityValue)
      .eq("locale", params.locale)
      .eq("prompt_version", params.promptVersion)
      .eq("facts_digest_hash", params.factsDigestHash)
      .eq("section", params.section)
      .limit(1)
      .abortSignal(signal);
    const { data, error } = await query.maybeSingle();
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "analysis_identity_cache_read_error");
    }
    if (error || !data) return null;
    if (isExpired((data as { expires_at?: string | null }).expires_at)) return null;
    return data as AnalysisIdentityCacheRow;
  }, options);
}

export async function upsertAnalysisIdentityCache(params: {
  identityType: string;
  identityValue: string;
  locale: string;
  promptVersion: string;
  factsDigestHash: string;
  factsSourceVersion: string;
  section: string;
  status: "pending" | "complete" | "error";
  payload: unknown | null;
  factsDigestJson: unknown;
  expiresAt: string | null;
}, options: ResilienceOptions = {}): Promise<void> {
  const record = {
    identity_type: params.identityType,
    identity_value: params.identityValue,
    locale: params.locale,
    prompt_version: params.promptVersion,
    facts_digest_hash: params.factsDigestHash,
    facts_source_version: params.factsSourceVersion,
    section: params.section,
    status: params.status,
    payload: params.payload,
    facts_digest_json: params.factsDigestJson,
    expires_at: params.expiresAt,
    updated_at: new Date().toISOString(),
  };

  await runWithResilience(async (signal) => {
    const { error } = await supabase
      .from("analysis_identity_cache")
      .upsert(record, {
        onConflict: "identity_type,identity_value,locale,prompt_version,facts_digest_hash,section",
      })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "analysis_identity_cache_write_error");
    }
    return null;
  }, options);
}

export async function insertAnalysisIdentityPending(params: {
  identityType: string;
  identityValue: string;
  locale: string;
  promptVersion: string;
  factsDigestHash: string;
  factsSourceVersion: string;
  section: string;
  factsDigestJson: unknown;
  expiresAt: string | null;
}, options: ResilienceOptions = {}): Promise<boolean> {
  const record = {
    identity_type: params.identityType,
    identity_value: params.identityValue,
    locale: params.locale,
    prompt_version: params.promptVersion,
    facts_digest_hash: params.factsDigestHash,
    facts_source_version: params.factsSourceVersion,
    section: params.section,
    status: "pending",
    payload: null,
    facts_digest_json: params.factsDigestJson,
    expires_at: params.expiresAt,
    updated_at: new Date().toISOString(),
  };

  const result = await runWithResilience(async (signal) => {
    const { data, error } = await supabase
      .from("analysis_identity_cache")
      .upsert(record, {
        onConflict: "identity_type,identity_value,locale,prompt_version,facts_digest_hash,section",
        ignoreDuplicates: true,
      })
      .select("identity_type")
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "analysis_identity_cache_insert_error");
    }
    return data as Array<{ identity_type: string }> | null;
  }, options);

  return Boolean(result && result.length > 0);
}

export async function getWebCanonicalMap(params: {
  barcodeGtin14: string;
  engineVersion: string;
}, options: ResilienceOptions = {}): Promise<WebCanonicalMapRow | null> {
  return await runWithResilience(async (signal) => {
    const { data, error } = await supabase
      .from("web_canonical_map")
      .select("barcode_gtin14,engine_version,canonical_urls,canonical_hash,best_url,expires_at,updated_at,created_at")
      .eq("barcode_gtin14", params.barcodeGtin14)
      .eq("engine_version", params.engineVersion)
      .limit(1)
      .abortSignal(signal)
      .maybeSingle();
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "web_canonical_map_read_error");
    }
    if (error || !data) return null;
    if (isExpired((data as { expires_at?: string | null }).expires_at)) return null;
    return data as WebCanonicalMapRow;
  }, options);
}

export async function upsertWebCanonicalMap(params: {
  barcodeGtin14: string;
  engineVersion: string;
  canonicalUrls: string[];
  canonicalHash: string;
  bestUrl: string | null;
  expiresAt: string | null;
}, options: ResilienceOptions = {}): Promise<void> {
  const record = {
    barcode_gtin14: params.barcodeGtin14,
    engine_version: params.engineVersion,
    canonical_urls: params.canonicalUrls,
    canonical_hash: params.canonicalHash,
    best_url: params.bestUrl,
    expires_at: params.expiresAt,
    updated_at: new Date().toISOString(),
  };

  await runWithResilience(async (signal) => {
    const { error } = await supabase
      .from("web_canonical_map")
      .upsert(record, { onConflict: "barcode_gtin14,engine_version" })
      .abortSignal(signal);
    if (error && options.retry && shouldRetrySupabaseError(error)) {
      const rawStatus = (error as { status?: number }).status;
      const status = typeof rawStatus === "number" ? rawStatus : 503;
      throw new HttpError(status, error.message ?? "web_canonical_map_write_error");
    }
    return null;
  }, options);
}
