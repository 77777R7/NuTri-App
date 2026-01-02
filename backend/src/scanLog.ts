import { supabase } from "./supabase.js";
import { CircuitBreaker, combineSignals, createTimeoutSignal, isAbortError } from "./resilience.js";
import type { DeadlineBudget } from "./resilience.js";
import { incrementMetric } from "./metrics.js";

const RESILIENCE_BREAKER_WINDOW_MS = Number(process.env.RESILIENCE_BREAKER_WINDOW_MS ?? 30_000);
const RESILIENCE_BREAKER_MIN_REQUESTS = Number(process.env.RESILIENCE_BREAKER_MIN_REQUESTS ?? 10);
const RESILIENCE_BREAKER_FAILURE_THRESHOLD = Number(process.env.RESILIENCE_BREAKER_FAILURE_THRESHOLD ?? 0.5);
const RESILIENCE_BREAKER_OPEN_MS = Number(process.env.RESILIENCE_BREAKER_OPEN_MS ?? 60_000);
const RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS = Number(
  process.env.RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS ?? 1500,
);

const scanWriteBreaker = new CircuitBreaker({
  windowMs: RESILIENCE_BREAKER_WINDOW_MS,
  minRequests: RESILIENCE_BREAKER_MIN_REQUESTS,
  failureThreshold: RESILIENCE_BREAKER_FAILURE_THRESHOLD,
  openDurationMs: RESILIENCE_BREAKER_OPEN_MS,
});

type LogWriteOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  budget?: DeadlineBudget;
  breaker?: CircuitBreaker;
};

export async function logBarcodeScan(input: {
  barcodeGtin14: string;
  barcodeRaw: string | null;
  checksumValid: boolean | null;

  catalogHit: boolean;
  servedFrom: string; // "override" | "dsld" | "snapshot_cache" | "google_ai" | "wait_inflight" | "error"
  dsldLabelId?: number | null;
  snapshotId?: string | null;
  brandName?: string | null;
  productName?: string | null;

  deviceId?: string | null;
  requestId?: string | null;
  timingTotalMs?: number | null;

  meta?: Record<string, unknown> | null;
}, options: LogWriteOptions = {}): Promise<void> {
  if (options.signal?.aborted) {
    return;
  }
  const breaker = options.breaker ?? scanWriteBreaker;
  if (breaker && !breaker.canRequest()) {
    incrementMetric("scanlog_write_breaker_open");
    return;
  }

  const baseTimeoutMs = options.timeoutMs ?? RESILIENCE_SUPABASE_WRITE_TIMEOUT_MS;
  const budgetedTimeoutMs = options.budget ? options.budget.msFor(baseTimeoutMs) : baseTimeoutMs;
  if (!Number.isFinite(budgetedTimeoutMs) || budgetedTimeoutMs <= 0) {
    return;
  }

  const timeoutSignal = createTimeoutSignal(budgetedTimeoutMs);
  const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
  try {
    const { error } = await supabase
      .from("barcode_scans")
      .insert({
        barcode_gtin14: input.barcodeGtin14,
        barcode_raw: input.barcodeRaw,
        checksum_valid: input.checksumValid,
        catalog_hit: input.catalogHit,
        served_from: input.servedFrom,
        dsld_label_id: input.dsldLabelId ?? null,
        snapshot_id: input.snapshotId ?? null,
        brand_name: input.brandName ?? null,
        product_name: input.productName ?? null,
        device_id: input.deviceId ?? null,
        request_id: input.requestId ?? null,
        timing_total_ms: input.timingTotalMs ?? null,
        meta: input.meta ?? null,
      })
      .abortSignal(signal);
    const aborted = Boolean(timeoutSignal.aborted || signal.aborted);
    if (!error) {
      breaker?.recordSuccess();
      incrementMetric("scanlog_write_success");
    } else if (!aborted && !isAbortError(error)) {
      breaker?.recordFailure();
    } else if (timeoutSignal.aborted) {
      incrementMetric("scanlog_write_timeout");
    }
  } catch (err) {
    if (timeoutSignal.aborted || signal.aborted || isAbortError(err)) {
      if (timeoutSignal.aborted) {
        incrementMetric("scanlog_write_timeout");
      }
      return;
    }
    breaker?.recordFailure();
  } finally {
    cleanup();
  }
}
