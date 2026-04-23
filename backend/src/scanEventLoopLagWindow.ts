export type EventLoopLagHistogramLike = {
  percentile(percentile: number): number;
  reset?: () => void;
};

export type EventLoopLagWindowSnapshot = {
  lagP95Ms: number;
  sampledAtMs: number;
};

export const readEventLoopLagP95MsFromHistogram = (
  histogram: EventLoopLagHistogramLike,
  options: { reset?: boolean } = {},
): number => {
  try {
    const rawNs = histogram.percentile(95);
    if (!Number.isFinite(rawNs) || rawNs <= 0) return 0;
    return rawNs / 1_000_000;
  } catch {
    return 0;
  } finally {
    if (options.reset) {
      try {
        histogram.reset?.();
      } catch {
        // Event-loop lag is a guardrail signal; reset failures should not break streams.
      }
    }
  }
};

export const resolveEventLoopLagStaleAfterMs = (params: {
  sampleMs: number;
  rawValue?: unknown;
}): number => {
  const fallbackMs = Math.max(params.sampleMs * 4, 1_000);
  const parsed = Number(params.rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return Math.max(params.sampleMs, parsed);
};

export const createEventLoopLagWindowSampler = (params: {
  histogram: EventLoopLagHistogramLike;
  nowMs?: () => number;
  staleAfterMs: number;
}) => {
  const nowMs = params.nowMs ?? Date.now;
  let snapshot: EventLoopLagWindowSnapshot = {
    lagP95Ms: 0,
    sampledAtMs: 0,
  };

  const sampleAndReset = (): EventLoopLagWindowSnapshot => {
    snapshot = {
      lagP95Ms: readEventLoopLagP95MsFromHistogram(params.histogram, { reset: true }),
      sampledAtMs: nowMs(),
    };
    return snapshot;
  };

  const readFreshP95Ms = (): number => {
    if (snapshot.sampledAtMs <= 0) return 0;
    const ageMs = nowMs() - snapshot.sampledAtMs;
    if (!Number.isFinite(ageMs) || ageMs > params.staleAfterMs) return 0;
    return snapshot.lagP95Ms;
  };

  return {
    sampleAndReset,
    readFreshP95Ms,
    getSnapshot: (): EventLoopLagWindowSnapshot => snapshot,
  };
};
