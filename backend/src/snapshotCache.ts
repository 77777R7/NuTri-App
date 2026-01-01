import { supabase } from './supabase.js';
import type { SupplementSnapshot } from './schemas/supplementSnapshot.js';
import type { SnapshotAnalysisPayload } from './snapshot.js';
import { validateSnapshotOrFallback } from './snapshot.js';
import {
  CircuitBreaker,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
  HttpError,
} from './resilience.js';
import type { DeadlineBudget, RetryOptions, Semaphore } from './resilience.js';
import { incrementMetric } from './metrics.js';

export type SnapshotCacheRecord = {
  snapshot: SupplementSnapshot;
  analysisPayload: SnapshotAnalysisPayload | null;
  expiresAt: string | null;
};

type SnapshotCacheRow = {
  id: string;
  key: string;
  source: string;
  payload_json: SupplementSnapshot;
  analysis_json: SnapshotAnalysisPayload | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

const RESILIENCE_BREAKER_WINDOW_MS = Number(process.env.RESILIENCE_BREAKER_WINDOW_MS ?? 30_000);
const RESILIENCE_BREAKER_MIN_REQUESTS = Number(process.env.RESILIENCE_BREAKER_MIN_REQUESTS ?? 10);
const RESILIENCE_BREAKER_FAILURE_THRESHOLD = Number(process.env.RESILIENCE_BREAKER_FAILURE_THRESHOLD ?? 0.5);
const RESILIENCE_BREAKER_OPEN_MS = Number(process.env.RESILIENCE_BREAKER_OPEN_MS ?? 60_000);
const RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS ?? 1500,
);

const snapshotWriteBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});

const isExpired = (expiresAt: string | null): boolean => {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return false;
  return expiresMs <= Date.now();
};

const isMissingUpdatedAtColumn = (error: { message?: string } | null): boolean => {
  const message = error?.message?.toLowerCase();
  if (!message) return false;
  return message.includes('updated_at') && (message.includes('does not exist') || message.includes('schema cache'));
};

type ResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  budget?: DeadlineBudget;
  semaphore?: Semaphore;
  queueTimeoutMs?: number;
  breaker?: CircuitBreaker;
  retry?: Partial<RetryOptions>;
};

type WriteResilienceOptions = Pick<ResilienceOptions, "signal" | "timeoutMs" | "budget" | "breaker">;

const shouldRetrySupabaseError = (error: { status?: number; message?: string } | null): boolean => {
  if (!error) return false;
  if (typeof error.status === 'number') return isRetryableStatus(error.status);
  const message = error.message?.toLowerCase() ?? '';
  return message.includes('timeout') || message.includes('fetch') || message.includes('network');
};

export async function getSnapshotCache(params: {
  key: string;
  source: string;
}, options: ResilienceOptions = {}): Promise<SnapshotCacheRecord | null> {
  const { key, source } = params;

  if (options.signal?.aborted) {
    return null;
  }
  if (options.breaker && !options.breaker.canRequest()) {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? (options.budget ? options.budget.msLeft() : undefined);
  const budgetedTimeout =
    typeof timeoutMs === 'number' && options.budget
      ? options.budget.msFor(timeoutMs)
      : timeoutMs;
  if (typeof budgetedTimeout === 'number' && budgetedTimeout <= 0) {
    return null;
  }

  const runSnapshotQuery = (orderColumn: 'updated_at' | 'created_at', signal: AbortSignal) =>
    supabase
      .from('snapshots')
      .select('id,key,source,payload_json,analysis_json,created_at,updated_at,expires_at')
      .eq('key', key)
      .eq('source', source)
      .order(orderColumn, { ascending: false })
      .limit(1)
      .abortSignal(signal)
      .maybeSingle();

  const attemptFetch = async (): Promise<{
    data: SnapshotCacheRow | null;
    error: { message?: string; status?: number } | null;
    aborted: boolean;
  }> => {
    let release: (() => void) | null = null;
    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return { data: null, error: null, aborted: false };
      }
    }

    const timeoutSignal =
      typeof budgetedTimeout === 'number' ? createTimeoutSignal(budgetedTimeout) : undefined;
    const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);

    try {
      let { data, error } = await runSnapshotQuery('updated_at', signal);
      if (error && isMissingUpdatedAtColumn(error)) {
        ({ data, error } = await runSnapshotQuery('created_at', signal));
      }

      const aborted = Boolean(timeoutSignal?.aborted || signal.aborted);
      if (error && options.retry && shouldRetrySupabaseError(error)) {
        const rawStatus = (error as { status?: number }).status;
        const status = typeof rawStatus === 'number' ? rawStatus : 503;
        throw new HttpError(status, error.message ?? 'supabase_read_error');
      }

      if (!error) {
        options.breaker?.recordSuccess();
      } else if (!aborted && !isAbortError(error)) {
        options.breaker?.recordFailure();
      }

      return { data: data as SnapshotCacheRow | null, error, aborted };
    } catch (err) {
      if (timeoutSignal?.aborted || signal.aborted || isAbortError(err)) {
        return { data: null, error: null, aborted: true };
      }
      options.breaker?.recordFailure();
      throw err;
    } finally {
      cleanup();
      release?.();
    }
  };

  let result: {
    data: SnapshotCacheRow | null;
    error: { message?: string; status?: number } | null;
    aborted: boolean;
  };
  if (options.retry) {
    const retryConfig: RetryOptions = {
      maxAttempts: options.retry.maxAttempts ?? 2,
      baseDelayMs: options.retry.baseDelayMs ?? 100,
      maxDelayMs: options.retry.maxDelayMs ?? 300,
      jitterRatio: options.retry.jitterRatio ?? 0.3,
      shouldRetry: (error) => {
        if (isAbortError(error)) return false;
        if (error instanceof HttpError) return isRetryableStatus(error.status);
        return false;
      },
      signal: options.signal,
      budget: options.budget,
    };

    result = await withRetry(() => attemptFetch(), retryConfig).catch((error) => {
      if (!isAbortError(error)) {
        console.warn('[snapshot-cache] read retry failed', error);
      }
      return { data: null, error: null, aborted: false };
    });
  } else {
    result = await attemptFetch();
  }

  const { data, error, aborted } = result;
  if (error || !data) {
    if (error && !aborted && !options.signal?.aborted) {
      console.warn('[snapshot-cache] read failed', error.message);
    }
    return null;
  }

  const row = data as SnapshotCacheRow;
  if (isExpired(row.expires_at)) {
    return null;
  }

  const fallbackSource =
    row.source === 'barcode' || row.source === 'label' || row.source === 'mixed'
      ? row.source
      : 'mixed';

  const snapshot = validateSnapshotOrFallback({
    candidate: row.payload_json,
    fallback: {
      source: fallbackSource,
      barcodeRaw: source === 'barcode' ? key : null,
      createdAt: row.created_at,
    },
  });

  return {
    snapshot,
    analysisPayload: row.analysis_json ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

export async function storeSnapshotCache(params: {
  key: string;
  source: 'barcode' | 'label' | 'mixed';
  snapshot: SupplementSnapshot;
  analysisPayload?: SnapshotAnalysisPayload | null;
  expiresAt?: string | null;
}, options: WriteResilienceOptions = {}): Promise<void> {
  const { key, source, snapshot, analysisPayload, expiresAt } = params;
  if (options.signal?.aborted) {
    return;
  }
  const breaker = options.breaker ?? snapshotWriteBreaker;
  if (breaker && !breaker.canRequest()) {
    incrementMetric("snapshot_write_breaker_open");
    return;
  }

  const baseTimeoutMs = options.timeoutMs ?? RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS;
  const budgetedTimeoutMs = options.budget ? options.budget.msFor(baseTimeoutMs) : baseTimeoutMs;
  if (!Number.isFinite(budgetedTimeoutMs) || budgetedTimeoutMs <= 0) {
    return;
  }

  const updatedAt = snapshot.updatedAt ?? new Date().toISOString();
  const payloadSnapshot =
    snapshot.updatedAt === updatedAt
      ? snapshot
      : {
          ...snapshot,
          updatedAt,
        };
  const record: Record<string, unknown> = {
    id: snapshot.snapshotId,
    key,
    source,
    payload_json: payloadSnapshot,
    updated_at: updatedAt,
  };
  if (analysisPayload !== undefined) {
    record.analysis_json = analysisPayload;
  }
  if (expiresAt !== undefined) {
    record.expires_at = expiresAt;
  }

  const timeoutSignal = createTimeoutSignal(budgetedTimeoutMs);
  const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
  try {
    const { error } = await supabase
      .from('snapshots')
      .upsert(record, { onConflict: 'key,source' })
      .abortSignal(signal);
    const aborted = Boolean(timeoutSignal.aborted || signal.aborted);
    if (!error) {
      breaker?.recordSuccess();
      incrementMetric("snapshot_write_success");
    } else if (!aborted && !isAbortError(error)) {
      breaker?.recordFailure();
    } else if (timeoutSignal.aborted) {
      incrementMetric("snapshot_write_timeout");
    }
  } catch (err) {
    if (timeoutSignal.aborted || signal.aborted || isAbortError(err)) {
      if (timeoutSignal.aborted) {
        incrementMetric("snapshot_write_timeout");
      }
      return;
    }
    breaker?.recordFailure();
  } finally {
    cleanup();
  }
}
