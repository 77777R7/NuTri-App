import {
  resolveEnrichStreamAdmissionPolicy,
  type EnrichStreamAdmissionPolicy,
} from "./scanStreamAdmissionPolicy.js";
import {
  DEFAULT_BUNDLE_ONLY_DONE_DELAY_MS,
  DEFAULT_FULL_REV1_DONE_DELAY_MS,
  toNonNegativeDelayMs,
} from "./scanStreamTimingPolicy.js";

type EnvLike = Record<string, string | number | undefined>;

export type ScanStreamRuntimeConfig = {
  admissionPolicy: EnrichStreamAdmissionPolicy;
  sharedMaxActive: number;
  sharedMaxQueue: number;
  fullMaxActive: number;
  fullMaxQueue: number;
  bundleOnlyMaxActive: number;
  bundleOnlyMaxQueue: number;
  fullQueueWaitMs: number;
  bundleOnlyQueueWaitMs: number;
  admissionCoreFallbackBudgetMs: number;
  fullPressureCoreFallbackGuardMs: number;
  bundleOnlyDoneDelayMs: number;
  rev0FallbackDelayMs: number;
  rev0FallbackDelayMsBundleOnly: number;
  fullRev1DoneDelayMs: number;
  bundleOnlyTerminalGuardMs: number;
  overloadInflightThreshold: number;
  overloadRetryAfterMs: number;
  clientDisconnectGraceMs: number;
  sseClientTimeoutMs: number;
  sseTimeoutSafetyMarginMs: number;
  stageBundleAwaitTimeoutMs: number;
  fullPreRev1TerminalGuardMs: number;
  crashCanaryPreRev1TerminalGuardMs: number;
  hardTerminalFallbackMs: number;
};

const finiteNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const minNumber = (value: unknown, fallback: number, minimum: number): number =>
  Math.max(minimum, finiteNumber(value, fallback));

export const resolveScanStreamRuntimeConfig = (
  env: EnvLike = process.env,
): ScanStreamRuntimeConfig => {
  const admissionPolicy = resolveEnrichStreamAdmissionPolicy(env);
  const bundleOnlyDoneDelayMs = toNonNegativeDelayMs(
    env.ENRICH_STREAM_BUNDLE_ONLY_DONE_DELAY_MS ?? DEFAULT_BUNDLE_ONLY_DONE_DELAY_MS,
    DEFAULT_BUNDLE_ONLY_DONE_DELAY_MS,
  );
  const rev0FallbackDelayMs = minNumber(env.ENRICH_STREAM_REV0_FALLBACK_DELAY_MS, 250, 50);
  const fullRev1DoneDelayMs = toNonNegativeDelayMs(
    env.ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS ?? DEFAULT_FULL_REV1_DONE_DELAY_MS,
    DEFAULT_FULL_REV1_DONE_DELAY_MS,
  );
  const sseGlobalStreamTimeoutMs = finiteNumber(env.SSE_GLOBAL_STREAM_TIMEOUT_MS, 15000);
  const sseClientTimeoutMs = finiteNumber(
    env.SSE_CLIENT_TIMEOUT_MS ?? env.WEB_E2E_SSE_TIMEOUT_MS,
    50000,
  );
  const stageBundleAwaitTimeoutMs = minNumber(
    env.ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS,
    3500,
    500,
  );
  const fullPreRev1TerminalGuardMs = minNumber(
    env.ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS,
    3000,
    1000,
  );

  return {
    admissionPolicy,
    sharedMaxActive: admissionPolicy.shared.maxActive,
    sharedMaxQueue: admissionPolicy.shared.maxQueue,
    fullMaxActive: admissionPolicy.full.maxActive,
    fullMaxQueue: admissionPolicy.full.maxQueue,
    bundleOnlyMaxActive: admissionPolicy.bundleOnly.maxActive,
    bundleOnlyMaxQueue: admissionPolicy.bundleOnly.maxQueue,
    fullQueueWaitMs: admissionPolicy.full.queueWaitMs,
    bundleOnlyQueueWaitMs: admissionPolicy.bundleOnly.queueWaitMs,
    admissionCoreFallbackBudgetMs: minNumber(env.ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS, 400, 250),
    fullPressureCoreFallbackGuardMs: minNumber(
      env.ENRICH_STREAM_FULL_PRESSURE_CORE_FALLBACK_GUARD_MS,
      400,
      250,
    ),
    bundleOnlyDoneDelayMs,
    rev0FallbackDelayMs,
    rev0FallbackDelayMsBundleOnly: Math.max(
      rev0FallbackDelayMs,
      finiteNumber(env.ENRICH_STREAM_REV0_FALLBACK_DELAY_MS_BUNDLE_ONLY, 750),
    ),
    fullRev1DoneDelayMs,
    bundleOnlyTerminalGuardMs: Math.max(
      bundleOnlyDoneDelayMs + 1000,
      finiteNumber(env.ENRICH_STREAM_BUNDLE_ONLY_TERMINAL_GUARD_MS, 3000),
    ),
    overloadInflightThreshold: admissionPolicy.overloadInflightThreshold,
    overloadRetryAfterMs: minNumber(env.ENRICH_STREAM_OVERLOAD_RETRY_AFTER_MS, 2000, 0),
    clientDisconnectGraceMs: minNumber(env.ENRICH_STREAM_CLIENT_DISCONNECT_GRACE_MS, 2500, 0),
    sseClientTimeoutMs,
    sseTimeoutSafetyMarginMs: finiteNumber(env.SSE_TIMEOUT_SAFETY_MARGIN_MS, 3000),
    stageBundleAwaitTimeoutMs,
    fullPreRev1TerminalGuardMs,
    crashCanaryPreRev1TerminalGuardMs: minNumber(
      env.ENRICH_STREAM_CRASH_CANARY_PRE_REV1_TERMINAL_GUARD_MS,
      3500,
      500,
    ),
    hardTerminalFallbackMs: minNumber(
      env.ENRICH_STREAM_HARD_TERMINAL_FALLBACK_MS,
      Math.min(
        Math.max(sseGlobalStreamTimeoutMs + 2500, 12000),
        Math.max(2000, sseClientTimeoutMs - 1000),
      ),
      1000,
    ),
  };
};
