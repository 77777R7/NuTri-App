export type SearchDetailDeepDiveSource = "api" | "fallback";

export type SearchDetailDeepDiveSettled<TPayload, TDiagnostics> = {
  payload: TPayload;
  source: SearchDetailDeepDiveSource;
  diagnostics: TDiagnostics;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  promptVersion: string;
};

export type SearchDetailDeepDiveResolved<TPayload, TDiagnostics> = SearchDetailDeepDiveSettled<TPayload, TDiagnostics> & {
  backgroundRefreshPending: boolean;
  recommendedRetryAfterMs: number | null;
};

type SearchDetailDeepDiveCacheEntry<TPayload, TDiagnostics> = {
  expiresAt: number;
  settled: SearchDetailDeepDiveSettled<TPayload, TDiagnostics>;
};

export type SearchDetailDeepDiveResolveParams<TPayload, TDiagnostics> = {
  cacheKey: string;
  revalidateFallback: boolean;
  backgroundRefreshEnabled?: boolean;
  computeFallback: () => Promise<SearchDetailDeepDiveSettled<TPayload, TDiagnostics>>;
  scheduleBackgroundRefresh: () => Promise<SearchDetailDeepDiveSettled<TPayload, TDiagnostics> | null>;
  resolveTtlMs: (settled: SearchDetailDeepDiveSettled<TPayload, TDiagnostics>) => number;
};

export class SearchDetailDeepDiveSectionRuntime<TPayload, TDiagnostics> {
  private readonly cache = new Map<string, SearchDetailDeepDiveCacheEntry<TPayload, TDiagnostics>>();
  private readonly inflight = new Map<string, Promise<SearchDetailDeepDiveSettled<TPayload, TDiagnostics>>>();
  private readonly backgroundRefresh = new Map<string, Promise<void>>();
  private readonly cacheLimit: number;
  private readonly fallbackTtlMs: number;
  private readonly recommendedRetryAfterMs: number;

  constructor(params: { cacheLimit: number; fallbackTtlMs: number; recommendedRetryAfterMs: number }) {
    this.cacheLimit = Math.max(16, params.cacheLimit);
    this.fallbackTtlMs = Math.max(1_000, params.fallbackTtlMs);
    this.recommendedRetryAfterMs = Math.max(250, params.recommendedRetryAfterMs);
  }

  private readCache(cacheKey: string): SearchDetailDeepDiveSettled<TPayload, TDiagnostics> | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }
    return entry.settled;
  }

  private writeCache(
    cacheKey: string,
    settled: SearchDetailDeepDiveSettled<TPayload, TDiagnostics>,
    ttlMs: number,
  ): void {
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + Math.max(1_000, ttlMs),
      settled,
    });
    if (this.cache.size <= this.cacheLimit) return;
    const oldestKey = this.cache.keys().next().value;
    if (typeof oldestKey === "string") {
      this.cache.delete(oldestKey);
    }
  }

  private toResolved(
    settled: SearchDetailDeepDiveSettled<TPayload, TDiagnostics>,
    backgroundRefreshPending: boolean,
  ): SearchDetailDeepDiveResolved<TPayload, TDiagnostics> {
    const pending = settled.source === "fallback" && backgroundRefreshPending;
    return {
      ...settled,
      backgroundRefreshPending: pending,
      recommendedRetryAfterMs: pending ? this.recommendedRetryAfterMs : null,
    };
  }

  private ensureBackgroundRefresh(
    cacheKey: string,
    params: SearchDetailDeepDiveResolveParams<TPayload, TDiagnostics>,
  ): boolean {
    if (params.backgroundRefreshEnabled === false) return false;
    if (this.backgroundRefresh.has(cacheKey)) return true;
    const refreshPromise = params.scheduleBackgroundRefresh();
    const run = (async (): Promise<void> => {
      const refreshed = await refreshPromise;
      if (!refreshed) return;
      const ttlMs =
        refreshed.source === "fallback"
          ? this.fallbackTtlMs
          : params.resolveTtlMs(refreshed);
      this.writeCache(cacheKey, refreshed, ttlMs);
    })()
      .finally(() => {
        this.backgroundRefresh.delete(cacheKey);
      });
    this.backgroundRefresh.set(cacheKey, run);
    return true;
  }

  async resolve(
    params: SearchDetailDeepDiveResolveParams<TPayload, TDiagnostics>,
  ): Promise<SearchDetailDeepDiveResolved<TPayload, TDiagnostics>> {
    const cached = this.readCache(params.cacheKey);
    const shouldBypassFallbackCache = params.revalidateFallback && cached?.source === "fallback";
    if (cached && !shouldBypassFallbackCache) {
      return this.toResolved(cached, this.backgroundRefresh.has(params.cacheKey));
    }

    if (shouldBypassFallbackCache && cached) {
      const refreshedCached = this.readCache(params.cacheKey);
      if (refreshedCached?.source === "api") {
        return this.toResolved(refreshedCached, false);
      }
      const backgroundRefreshPending = this.ensureBackgroundRefresh(params.cacheKey, params);
      return this.toResolved(cached, backgroundRefreshPending);
    }

    const existingInflight = this.inflight.get(params.cacheKey);
    if (existingInflight) {
      const settled = await existingInflight;
      return this.toResolved(settled, this.backgroundRefresh.has(params.cacheKey));
    }

    const compilePromise = (async (): Promise<SearchDetailDeepDiveSettled<TPayload, TDiagnostics>> => {
      const settled = await params.computeFallback();
      const ttlMs =
        settled.source === "fallback"
          ? this.fallbackTtlMs
          : params.resolveTtlMs(settled);
      this.writeCache(params.cacheKey, settled, ttlMs);
      if (settled.source === "fallback") {
        this.ensureBackgroundRefresh(params.cacheKey, params);
      }
      return settled;
    })()
      .finally(() => {
        this.inflight.delete(params.cacheKey);
      });

    this.inflight.set(params.cacheKey, compilePromise);
    const settled = await compilePromise;
    return this.toResolved(settled, this.backgroundRefresh.has(params.cacheKey));
  }
}
