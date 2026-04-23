export const DEFAULT_BUNDLE_ONLY_DONE_DELAY_MS = 250;
export const DEFAULT_FULL_REV1_DONE_DELAY_MS = 1000;

export type ScanStreamDoneTimerKind =
  | "bundle_only_done"
  | "full_rev1_watchdog";

export type ScanStreamRev1DonePolicy = {
  delayMs: number;
  finalizeReason:
    | "analysis_bundle_only_rev1_complete"
    | "full_rev1_watchdog_complete";
  timerKind: ScanStreamDoneTimerKind;
};

export const toNonNegativeDelayMs = (
  rawValue: unknown,
  fallbackMs: number,
): number => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackMs;
  return parsed;
};

export const resolveScanStreamRev1DonePolicy = (params: {
  analysisBundleOnly: boolean;
  bundleOnlyDoneDelayMs: number;
  fullRev1DoneDelayMs: number;
}): ScanStreamRev1DonePolicy | null => {
  if (params.analysisBundleOnly) {
    return {
      delayMs: toNonNegativeDelayMs(params.bundleOnlyDoneDelayMs, 0),
      finalizeReason: "analysis_bundle_only_rev1_complete",
      timerKind: "bundle_only_done",
    };
  }

  const fullDelayMs = toNonNegativeDelayMs(params.fullRev1DoneDelayMs, 0);
  if (fullDelayMs <= 0) return null;

  return {
    delayMs: fullDelayMs,
    finalizeReason: "full_rev1_watchdog_complete",
    timerKind: "full_rev1_watchdog",
  };
};
