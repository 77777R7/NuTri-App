type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type RetryErrorMeta = {
  status: number | null;
  code: string | null;
  message: string | null;
  rayId: string | null;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractStatus = (error: unknown, fallback?: number | null): number | null => {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  if (!error || typeof error !== "object") return null;
  const candidate =
    (error as { status?: number; statusCode?: number }).status ??
    (error as { statusCode?: number }).statusCode ??
    null;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
};

const extractRayId = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const response =
    (error as { response?: { headers?: unknown } }).response ??
    (error as { cause?: { response?: { headers?: unknown } } }).cause?.response ??
    null;
  const headers = response?.headers as
    | { get?: (key: string) => string | null }
    | Record<string, string>
    | null
    | undefined;
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get("cf-ray");
  }
  return headers["cf-ray"] ?? headers["CF-Ray"] ?? null;
};

const isRetryableError = (error: unknown, status?: number | null): boolean => {
  const resolvedStatus = extractStatus(error, status ?? null);
  if (resolvedStatus && RETRYABLE_STATUS.has(resolvedStatus)) return true;
  const message = (error as { message?: string })?.message?.toLowerCase() ?? "";
  if (message.includes("fetch failed") || message.includes("network")) return true;
  if (message.includes("bad gateway") || message.includes("gateway")) return true;
  if (message.includes("timeout")) return true;
  return false;
};

const computeDelay = (attempt: number, options?: RetryOptions): number => {
  const base = options?.baseDelayMs ?? 250;
  const max = options?.maxDelayMs ?? 4000;
  const raw = Math.min(base * Math.pow(2, attempt - 1), max);
  const jitter = raw * 0.2 * Math.random();
  return Math.round(raw + jitter);
};

export const extractErrorMeta = (
  error: unknown,
  status?: number | null,
  rayId?: string | null,
): RetryErrorMeta => {
  const resolvedStatus = extractStatus(error, status ?? null);
  const resolvedRay = rayId ?? extractRayId(error);
  const code =
    (error as { code?: string })?.code ??
    (error as { error?: string })?.error ??
    null;
  const message =
    (error as { message?: string })?.message ??
    (error as { hint?: string })?.hint ??
    null;
  return {
    status: resolvedStatus,
    code: code ? String(code) : null,
    message: message ? String(message) : null,
    rayId: resolvedRay,
  };
};

export const withRetry = async <T>(
  operation: () => PromiseLike<{ data: T | null; error: unknown | null; status?: number | null }>,
  options?: RetryOptions,
): Promise<{ data: T | null; error: unknown | null; status: number | null; attempts: number; rayId: string | null }> => {
  const maxRetries = options?.retries ?? 5;
  let lastError: unknown | null = null;
  let lastStatus: number | null = null;
  let lastRay: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await operation();
      const status = extractStatus(result.error, result.status ?? null);
      const rayId = extractRayId(result.error);
      if (!result.error || !isRetryableError(result.error, status)) {
        return {
          data: result.data ?? null,
          error: result.error ?? null,
          status,
          attempts: attempt,
          rayId,
        };
      }
      lastError = result.error;
      lastStatus = status;
      lastRay = rayId;
    } catch (error) {
      const status = extractStatus(error, null);
      const rayId = extractRayId(error);
      if (!isRetryableError(error, status)) {
        return {
          data: null,
          error,
          status,
          attempts: attempt,
          rayId,
        };
      }
      lastError = error;
      lastStatus = status;
      lastRay = rayId;
    }
    if (attempt < maxRetries) {
      await sleep(computeDelay(attempt, options));
    }
  }

  return {
    data: null,
    error: lastError,
    status: lastStatus,
    attempts: maxRetries,
    rayId: lastRay,
  };
};

export type { RetryOptions };
