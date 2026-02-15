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

