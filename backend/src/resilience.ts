export class DeadlineBudget {
  private readonly deadlineAt: number;

  constructor(deadlineAt: number) {
    this.deadlineAt = deadlineAt;
  }

  msLeft(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }

  msFor(stageMaxMs: number): number {
    return Math.max(0, Math.min(this.msLeft(), stageMaxMs));
  }

  isExpired(): boolean {
    return this.msLeft() <= 0;
  }
}

export class TimeoutError extends Error {
  constructor(message = "timeout") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message = `http_error_${status}`) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class BulkheadTimeoutError extends Error {
  constructor(message = "bulkhead_timeout") {
    super(message);
    this.name = "BulkheadTimeoutError";
  }
}

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  return "name" in error && (error as { name?: string }).name === "AbortError";
};

export const isRetryableStatus = (status: number): boolean =>
  status === 429 || (status >= 500 && status <= 599);

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

export const createTimeoutSignal = (ms: number): AbortSignal => {
  const controller = new AbortController();
  if (!Number.isFinite(ms) || ms <= 0) {
    controller.abort(new TimeoutError());
    return controller.signal;
  }
  const timeout = setTimeout(() => controller.abort(new TimeoutError()), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
};

export const combineSignals = (
  signals: Array<AbortSignal | undefined>,
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason ?? new Error("aborted"));
      break;
    }
    const onAbort = () => controller.abort(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanups.forEach((fn) => fn()),
  };
};

type SemaphoreWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
};

export class Semaphore {
  private available: number;
  private readonly queue: SemaphoreWaiter[] = [];

  constructor(private readonly max: number) {
    this.available = max;
  }

  async acquire(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release.bind(this);
    }

    return new Promise((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
      };

      const cleanup = () => {
        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
        }
        if (waiter.cleanup) {
          waiter.cleanup();
        }
      };

      const removeFromQueue = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
      };

      if (options.timeoutMs && options.timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          removeFromQueue();
          cleanup();
          reject(new BulkheadTimeoutError());
        }, options.timeoutMs);
      }

      if (options.signal) {
        const onAbort = () => {
          removeFromQueue();
          cleanup();
          reject(options.signal?.reason ?? new Error("aborted"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
        waiter.cleanup = () => options.signal?.removeEventListener("abort", onAbort);
      }

      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.available += 1;
    this.dispatch();
  }

  private dispatch(): void {
    while (this.available > 0 && this.queue.length > 0) {
      const waiter = this.queue.shift();
      if (!waiter) return;
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      if (waiter.cleanup) {
        waiter.cleanup();
      }
      this.available -= 1;
      waiter.resolve(this.release.bind(this));
    }
  }
}

type CircuitBreakerState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private openedAt = 0;
  private halfOpenInFlight = false;
  private readonly events: Array<{ t: number; ok: boolean }> = [];

  constructor(
    private readonly options: {
      windowMs: number;
      minRequests: number;
      failureThreshold: number;
      openDurationMs: number;
    },
  ) {}

  canRequest(): boolean {
    const now = Date.now();
    if (this.state === "open") {
      if (now - this.openedAt >= this.options.openDurationMs) {
        this.state = "half_open";
        this.halfOpenInFlight = false;
      } else {
        return false;
      }
    }
    if (this.state === "half_open") {
      if (this.halfOpenInFlight) return false;
      this.halfOpenInFlight = true;
      return true;
    }
    return true;
  }

  recordSuccess(): void {
    const now = Date.now();
    if (this.state === "half_open") {
      this.state = "closed";
      this.halfOpenInFlight = false;
      this.events.length = 0;
      return;
    }
    this.events.push({ t: now, ok: true });
    this.prune(now);
  }

  recordFailure(): void {
    const now = Date.now();
    if (this.state === "half_open") {
      this.state = "open";
      this.openedAt = now;
      this.halfOpenInFlight = false;
      return;
    }
    this.events.push({ t: now, ok: false });
    this.prune(now);
    const total = this.events.length;
    if (total < this.options.minRequests) return;
    const failures = this.events.filter((e) => !e.ok).length;
    const failureRate = failures / total;
    if (failureRate >= this.options.failureThreshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.options.windowMs;
    while (this.events.length && this.events[0].t < cutoff) {
      this.events.shift();
    }
  }
}

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  shouldRetry: (error: unknown) => boolean;
  signal?: AbortSignal;
  budget?: DeadlineBudget;
};

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio,
    shouldRetry,
    signal,
    budget,
  } = options;
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (!shouldRetry(error) || attempt >= maxAttempts) {
        throw error;
      }
      const expDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = expDelay * jitterRatio;
      const delayMs = Math.max(0, expDelay - jitter + Math.random() * jitter * 2);
      if (budget && budget.msLeft() <= delayMs) {
        throw error;
      }
      await sleep(delayMs, signal);
    }
  }

  throw lastError ?? new Error("retry_failed");
}

export class TtlCache<K, V = boolean> {
  private readonly store = new Map<K, { expiresAt: number; value: V }>();

  get(key: K): V | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (ttlMs <= 0) return;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  has(key: K): boolean {
    return this.get(key) !== null;
  }
}
