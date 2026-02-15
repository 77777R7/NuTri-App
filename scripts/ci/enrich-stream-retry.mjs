// Bounded, deterministic retry for transient enrich-stream HTTP failures (infra jitter).
//
// This file is intentionally standalone so it can be unit-tested without importing
// scripts/ci/render-regression.mjs (which executes main() on import).

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_RETRY_HTTP_STATUSES = [502, 503, 504];
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_MS = [500, 1500];

export function extractHttpStatus(err) {
  const direct = Number(err?.httpStatus ?? err?.status ?? NaN);
  return Number.isFinite(direct) ? direct : null;
}

export function computeEnrichStreamRetryTotal(summary) {
  const base = Number(summary?.enrichStreamRetryCount ?? 0) || 0;
  const attempts = Array.isArray(summary?.fallbackAttempts) ? summary.fallbackAttempts : null;
  if (!attempts || attempts.length === 0) return base;

  const attemptsSum = attempts.reduce(
    (acc, a) => acc + (Number(a?.enrichStreamRetryCount ?? 0) || 0),
    0,
  );

  // When fallback succeeded, fallbackAttempts includes the primary + the successful fallback attempt.
  // In that case, attemptsSum already includes the current attempt; do not add base again.
  //
  // When all attempts failed, the canonical summary is the primary attempt and fallbackAttempts excludes primary.
  // In that case, total = base(primary) + sum(fallback attempts).
  const primary = summary?.primaryBarcode ?? null;
  const includesPrimary = typeof primary === "string" && attempts.some((a) => a?.barcode === primary);
  return includesPrimary ? attemptsSum : base + attemptsSum;
}

export function collectEnrichStreamSeenStatuses(summary) {
  const out = [];
  const push = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) {
      const n = Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
  };

  push(summary?.enrichStreamSeen5xxStatuses);
  const attempts = Array.isArray(summary?.fallbackAttempts) ? summary.fallbackAttempts : null;
  if (attempts) {
    for (const a of attempts) push(a?.enrichStreamSeen5xxStatuses);
  }
  return out;
}

export function collectEnrichStreamErrorStrings(summary) {
  const out = [];
  const push = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) if (typeof v === "string") out.push(v);
  };
  push(summary?.errors);
  const attempts = Array.isArray(summary?.fallbackAttempts) ? summary.fallbackAttempts : null;
  if (attempts) {
    for (const a of attempts) push(a?.errors);
  }
  return out;
}

export async function withEnrichStreamBoundedRetry(
  fn,
  {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryHttpStatuses = DEFAULT_RETRY_HTTP_STATUSES,
    backoffMs = DEFAULT_BACKOFF_MS,
    sleepFn = defaultSleep,
  } = {},
) {
  const seen5xxStatuses = [];
  let retryCount = 0;

  while (true) {
    try {
      const value = await fn();
      return { value, retryCount, seen5xxStatuses };
    } catch (err) {
      const status = extractHttpStatus(err);
      const retryable = status != null && retryHttpStatuses.includes(status);
      if (!retryable || retryCount >= maxRetries) {
        // Attach for auditability (used by render-regression summary artifacts).
        err.enrichStreamRetryCount = retryCount;
        err.enrichStreamSeen5xxStatuses = seen5xxStatuses;
        throw err;
      }

      retryCount += 1;
      seen5xxStatuses.push(status);

      const delayMs = Number(backoffMs[retryCount - 1] ?? backoffMs.at(-1) ?? 0) || 0;
      await sleepFn(delayMs);
    }
  }
}
