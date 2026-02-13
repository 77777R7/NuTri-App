import { supabase } from "./supabase.js";
import { incrementMetric, recordLabelScanMetricsWriteRejected } from "./metrics.js";
import { TimeoutError, combineSignals, createTimeoutSignal, isAbortError } from "./resilience.js";

const LABEL_SCAN_METRICS_TIMEOUT_MS = Number(process.env.LABEL_SCAN_METRICS_TIMEOUT_MS ?? 5000);
const LABEL_SCAN_CLIENT_TIMING_MAX_MS = Number(
  process.env.LABEL_SCAN_CLIENT_TIMING_MAX_MS ?? 30 * 60 * 1000,
);

function normalizeNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.round(value);
}

function normalizeTimingMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  // Some upstream timing uses seconds. Anything under 1 is almost certainly seconds, not ms.
  const asMs = value > 0 && value < 1 ? value * 1000 : value;
  return Math.round(asMs);
}

export interface LabelScanMetricInput {
  requestId: string;
  imageHash: string;
  jobId?: string | null;
  parserVersion: string;
  preprocessProfile: string;
  flagVariant?: "control" | "draft_first_async";
  cacheMode?: "strict" | "legacy_read";
  ocrCacheHit?: boolean;
  parseCacheHit?: boolean | null;
  analysisCacheHit?: boolean | null;
  ocrCallCount?: number;
  analysisForDraftRevision?: number | null;
  patchId?: string | null;
  patchType?: "partial" | "final" | null;
  laneSplitTriggered?: boolean;
  laneSplitChosen?: "baseline" | "lane_split" | null;
  laneSplitRevertedReason?: string | null;
  lockedFieldConflictCount?: number;
  responseStatus: string;
  analysisStatus?: string | null;
  parseCoverage?: number | null;
  needsConfirmation?: boolean;
  issueTypes?: string[];
  timing: {
    tDecodeMs?: number | null;
    tOcrMs?: number | null;
    tParseMs?: number | null;
    tLlmMs?: number | null;
    tFirstDraftServerMs?: number | null;
  };
  clientStartedAtMs?: number | null;
  meta?: Record<string, unknown> | null;
}

type LogOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function logLabelScanMetric(
  input: LabelScanMetricInput,
  options: LogOptions = {},
): Promise<void> {
  if (options.signal?.aborted) return;

  const timeoutSignal = createTimeoutSignal(options.timeoutMs ?? LABEL_SCAN_METRICS_TIMEOUT_MS);
  const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);

  try {
    const nowMs = Date.now();
    const clientRoundtripMs =
      typeof input.clientStartedAtMs === "number" && Number.isFinite(input.clientStartedAtMs)
        ? Math.max(0, nowMs - input.clientStartedAtMs)
        : null;

    const { error } = await supabase
      .from("label_scan_metrics")
      .insert({
        request_id: input.requestId,
        image_hash: input.imageHash,
        job_id: input.jobId ?? null,
        parser_version: input.parserVersion,
        preprocess_profile: input.preprocessProfile,
        flag_variant: input.flagVariant ?? "control",
        cache_mode: input.cacheMode ?? "strict",
        ocr_cache_hit: input.ocrCacheHit ?? false,
        parse_cache_hit: input.parseCacheHit ?? null,
        analysis_cache_hit: input.analysisCacheHit ?? null,
        ocr_call_count: normalizeNonNegativeInt(input.ocrCallCount) ?? 0,
        analysis_for_draft_revision: normalizeNonNegativeInt(input.analysisForDraftRevision) ?? null,
        patch_id: input.patchId ?? null,
        patch_type: input.patchType ?? null,
        lane_split_triggered: input.laneSplitTriggered ?? null,
        lane_split_chosen: input.laneSplitChosen ?? null,
        lane_split_reverted_reason: input.laneSplitRevertedReason ?? null,
        locked_field_conflict_count: normalizeNonNegativeInt(input.lockedFieldConflictCount) ?? 0,
        response_status: input.responseStatus,
        analysis_status: input.analysisStatus ?? null,
        parse_coverage: input.parseCoverage ?? null,
        needs_confirmation: input.needsConfirmation ?? false,
        issue_types: input.issueTypes ?? [],
        t_decode_ms: normalizeTimingMs(input.timing.tDecodeMs),
        t_ocr_ms: normalizeTimingMs(input.timing.tOcrMs),
        t_parse_ms: normalizeTimingMs(input.timing.tParseMs),
        t_llm_ms: normalizeTimingMs(input.timing.tLlmMs),
        t_first_draft_server_ms: normalizeTimingMs(input.timing.tFirstDraftServerMs),
        client_started_at_ms: normalizeNonNegativeInt(input.clientStartedAtMs),
        t_client_roundtrip_ms: normalizeTimingMs(clientRoundtripMs),
        meta: input.meta ?? null,
      })
      .abortSignal(signal);
    if (error) {
      incrementMetric("label_scan_metrics_write_rejected");
      recordLabelScanMetricsWriteRejected(
        [error.message, error.details, error.hint].filter(Boolean).join(" | "),
        error.code ?? null,
      );
      console.warn("[LabelScanMetrics] write rejected", error.message);
      return;
    }
    incrementMetric("label_scan_metrics_write_success");
  } catch (error) {
    if (timeoutSignal.aborted && timeoutSignal.reason instanceof TimeoutError) {
      incrementMetric("label_scan_metrics_write_timeout");
      return;
    }
    if (signal.aborted || isAbortError(error)) {
      return;
    }
    incrementMetric("label_scan_metrics_write_rejected");
    recordLabelScanMetricsWriteRejected(error instanceof Error ? error.message : String(error));
    console.warn("[LabelScanMetrics] write failed", error);
  } finally {
    cleanup();
  }
}

export interface LabelScanClientTimingInput {
  requestId: string;
  appState?: "active" | "background" | "inactive" | "unknown";
  timingClient?: {
    tClickToDraftRenderMs?: number | null;
    tClickToAnalysisCompleteRenderMs?: number | null;
    tClickToDraftResponseMs?: number | null;
  };
  lockedFieldConflictCount?: number;
}

function normalizeClientTimingValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.min(LABEL_SCAN_CLIENT_TIMING_MAX_MS, Math.round(value));
}

export async function updateLabelScanClientTiming(
  input: LabelScanClientTimingInput,
  options: LogOptions = {},
): Promise<void> {
  if (!input.requestId) return;
  if (options.signal?.aborted) return;

  const timeoutSignal = createTimeoutSignal(options.timeoutMs ?? LABEL_SCAN_METRICS_TIMEOUT_MS);
  const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);

  try {
    const patch: Record<string, unknown> = {};
    const isActive = input.appState === undefined || input.appState === "active";
    const tDraftRender = normalizeClientTimingValue(input.timingClient?.tClickToDraftRenderMs);
    const tAnalysisComplete = normalizeClientTimingValue(input.timingClient?.tClickToAnalysisCompleteRenderMs);
    const tDraftResponse = normalizeClientTimingValue(input.timingClient?.tClickToDraftResponseMs);
    if (isActive && tDraftRender != null) {
      patch.t_click_to_draft_render_ms = tDraftRender;
    }
    if (isActive && tAnalysisComplete != null) {
      patch.t_click_to_analysis_complete_render_ms = tAnalysisComplete;
    }
    if (isActive && tDraftResponse != null) {
      patch.t_click_to_draft_response_ms = tDraftResponse;
    }
    if (typeof input.lockedFieldConflictCount === "number") {
      patch.locked_field_conflict_count = Math.max(0, Math.round(input.lockedFieldConflictCount));
    }
    if (input.appState) {
      patch.app_state = input.appState;
    }
    if (Object.keys(patch).length === 0) return;

    const { error } = await supabase
      .from("label_scan_metrics")
      .update(patch)
      .eq("request_id", input.requestId)
      .abortSignal(signal);

    if (error) {
      console.warn("[LabelScanMetrics] client timing update rejected", error.message);
    }
  } catch (error) {
    if (timeoutSignal.aborted || signal.aborted || isAbortError(error)) {
      return;
    }
    console.warn("[LabelScanMetrics] client timing update failed", error);
  } finally {
    cleanup();
  }
}
