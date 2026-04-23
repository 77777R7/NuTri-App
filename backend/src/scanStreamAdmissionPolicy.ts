export const DEFAULT_SHARED_STREAM_MAX_ACTIVE = 4;
export const DEFAULT_SHARED_STREAM_MAX_QUEUE = 20;
export const DEFAULT_FULL_STREAM_MAX_ACTIVE = 2;
export const DEFAULT_FULL_STREAM_MAX_QUEUE = 20;
export const DEFAULT_BUNDLE_ONLY_STREAM_MAX_ACTIVE = 12;
export const DEFAULT_BUNDLE_ONLY_STREAM_MAX_QUEUE = 50;
export const DEFAULT_FULL_STREAM_QUEUE_WAIT_MS = 1000;
export const DEFAULT_BUNDLE_ONLY_STREAM_QUEUE_WAIT_MS = 1500;
export const DEFAULT_STREAM_OVERLOAD_INFLIGHT_THRESHOLD = 4;

export type EnrichStreamAdmissionLanePolicy = {
  maxActive: number;
  maxQueue: number;
  queueWaitMs: number;
};

export type EnrichStreamAdmissionPolicy = {
  shared: Pick<EnrichStreamAdmissionLanePolicy, "maxActive" | "maxQueue">;
  full: EnrichStreamAdmissionLanePolicy;
  bundleOnly: EnrichStreamAdmissionLanePolicy;
  overloadInflightThreshold: number;
};

export const shouldRejectEnrichStreamForServerOverload = (params: {
  inFlightCount: number;
  overloadInflightThreshold: number;
}): boolean => params.inFlightCount > params.overloadInflightThreshold;

type EnvLike = Record<string, string | number | undefined>;

const toFiniteNumberOrNull = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readMinNumber = (
  value: unknown,
  fallback: number,
  minimum: number,
): number => Math.max(minimum, toFiniteNumberOrNull(value) ?? fallback);

const readCascade = (
  values: unknown[],
  fallback: number,
  minimum: number,
): number => {
  for (const value of values) {
    const parsed = toFiniteNumberOrNull(value);
    if (parsed != null) return Math.max(minimum, parsed);
  }
  return Math.max(minimum, fallback);
};

export const resolveEnrichStreamAdmissionPolicy = (
  env: EnvLike = process.env,
): EnrichStreamAdmissionPolicy => {
  const sharedMaxActive = readMinNumber(
    env.ENRICH_STREAM_MAX_ACTIVE,
    DEFAULT_SHARED_STREAM_MAX_ACTIVE,
    1,
  );
  const sharedMaxQueue = readMinNumber(
    env.ENRICH_STREAM_MAX_QUEUE,
    DEFAULT_SHARED_STREAM_MAX_QUEUE,
    0,
  );
  const fullMaxActive = readCascade(
    [env.ENRICH_STREAM_MAX_ACTIVE_FULL, env.ENRICH_STREAM_MAX_ACTIVE],
    DEFAULT_FULL_STREAM_MAX_ACTIVE,
    1,
  );
  const fullMaxQueue = readCascade(
    [env.ENRICH_STREAM_MAX_QUEUE_FULL, env.ENRICH_STREAM_MAX_QUEUE],
    DEFAULT_FULL_STREAM_MAX_QUEUE,
    0,
  );
  const bundleOnlyMaxActive = readCascade(
    [
      env.ENRICH_STREAM_MAX_ACTIVE_BUNDLE_ONLY,
      env.ENRICH_STREAM_MAX_ACTIVE,
    ],
    DEFAULT_BUNDLE_ONLY_STREAM_MAX_ACTIVE,
    1,
  );
  const bundleOnlyMaxQueue = readCascade(
    [env.ENRICH_STREAM_MAX_QUEUE_BUNDLE_ONLY, env.ENRICH_STREAM_MAX_QUEUE],
    DEFAULT_BUNDLE_ONLY_STREAM_MAX_QUEUE,
    0,
  );
  const fullQueueWaitMs = readMinNumber(
    env.ENRICH_STREAM_QUEUE_WAIT_MS,
    DEFAULT_FULL_STREAM_QUEUE_WAIT_MS,
    0,
  );
  const bundleOnlyQueueWaitMs = readCascade(
    [
      env.ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY,
      env.ENRICH_STREAM_QUEUE_WAIT_MS,
    ],
    DEFAULT_BUNDLE_ONLY_STREAM_QUEUE_WAIT_MS,
    0,
  );
  const overloadInflightThreshold = readMinNumber(
    env.ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD,
    Math.max(DEFAULT_STREAM_OVERLOAD_INFLIGHT_THRESHOLD, fullMaxActive + 1),
    1,
  );

  return {
    shared: {
      maxActive: sharedMaxActive,
      maxQueue: sharedMaxQueue,
    },
    full: {
      maxActive: fullMaxActive,
      maxQueue: fullMaxQueue,
      queueWaitMs: fullQueueWaitMs,
    },
    bundleOnly: {
      maxActive: bundleOnlyMaxActive,
      maxQueue: bundleOnlyMaxQueue,
      queueWaitMs: bundleOnlyQueueWaitMs,
    },
    overloadInflightThreshold,
  };
};
