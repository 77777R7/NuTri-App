import assert from "node:assert/strict";
import test from "node:test";

import {
  type SearchDetailDeepDiveSettled,
  SearchDetailDeepDiveSectionRuntime,
} from "../../backend/src/searchDetailDeepDiveAsync.ts";

type Payload = { text: string };
type Diagnostics = { fallbackReason: string | null };

const makeSettled = (
  source: "api" | "fallback",
  text: string,
): SearchDetailDeepDiveSettled<Payload, Diagnostics> => ({
  payload: { text },
  source,
  diagnostics: { fallbackReason: source === "fallback" ? "llm_timeout" : null },
  fallbackUsed: source === "fallback",
  fallbackReason: source === "fallback" ? "llm_timeout" : null,
  promptVersion: "v-test",
});

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("cache miss returns fallback immediately and marks background refresh pending", async () => {
  const runtime = new SearchDetailDeepDiveSectionRuntime<Payload, Diagnostics>({
    cacheLimit: 64,
    fallbackTtlMs: 20_000,
    recommendedRetryAfterMs: 1_500,
  });
  const deferred = createDeferred<SearchDetailDeepDiveSettled<Payload, Diagnostics> | null>();

  const resolved = await runtime.resolve({
    cacheKey: "k1",
    revalidateFallback: false,
    computeFallback: async () => makeSettled("fallback", "fallback-now"),
    scheduleBackgroundRefresh: async () => deferred.promise,
    resolveTtlMs: () => 600_000,
  });

  assert.equal(resolved.source, "fallback");
  assert.equal(resolved.payload.text, "fallback-now");
  assert.equal(resolved.backgroundRefreshPending, true);
  assert.equal(resolved.recommendedRetryAfterMs, 1_500);

  deferred.resolve(makeSettled("api", "api-ready"));
  await flushMicrotasks();
});

test("warm read returns api cache after background refresh completes", async () => {
  const runtime = new SearchDetailDeepDiveSectionRuntime<Payload, Diagnostics>({
    cacheLimit: 64,
    fallbackTtlMs: 20_000,
    recommendedRetryAfterMs: 1_500,
  });
  const deferred = createDeferred<SearchDetailDeepDiveSettled<Payload, Diagnostics> | null>();
  let fallbackCalls = 0;

  await runtime.resolve({
    cacheKey: "k2",
    revalidateFallback: false,
    computeFallback: async () => {
      fallbackCalls += 1;
      return makeSettled("fallback", "fallback-cold");
    },
    scheduleBackgroundRefresh: async () => deferred.promise,
    resolveTtlMs: () => 600_000,
  });

  deferred.resolve(makeSettled("api", "api-warm"));
  await flushMicrotasks();

  const warm = await runtime.resolve({
    cacheKey: "k2",
    revalidateFallback: false,
    computeFallback: async () => {
      fallbackCalls += 1;
      return makeSettled("fallback", "should-not-run");
    },
    scheduleBackgroundRefresh: async () => null,
    resolveTtlMs: () => 600_000,
  });

  assert.equal(fallbackCalls, 1);
  assert.equal(warm.source, "api");
  assert.equal(warm.payload.text, "api-warm");
  assert.equal(warm.backgroundRefreshPending, false);
  assert.equal(warm.recommendedRetryAfterMs, null);
});

test("revalidateFallback=1 bypasses fallback cache and schedules a fresh background refresh", async () => {
  const runtime = new SearchDetailDeepDiveSectionRuntime<Payload, Diagnostics>({
    cacheLimit: 64,
    fallbackTtlMs: 20_000,
    recommendedRetryAfterMs: 1_500,
  });
  let backgroundCalls = 0;

  await runtime.resolve({
    cacheKey: "k3",
    revalidateFallback: false,
    computeFallback: async () => makeSettled("fallback", "cached-fallback"),
    scheduleBackgroundRefresh: async () => null,
    resolveTtlMs: () => 600_000,
  });

  const deferred = createDeferred<SearchDetailDeepDiveSettled<Payload, Diagnostics> | null>();
  const refreshed = await runtime.resolve({
    cacheKey: "k3",
    revalidateFallback: true,
    computeFallback: async () => makeSettled("fallback", "should-not-run"),
    scheduleBackgroundRefresh: async () => {
      backgroundCalls += 1;
      return deferred.promise;
    },
    resolveTtlMs: () => 600_000,
  });

  assert.equal(backgroundCalls, 1);
  assert.equal(refreshed.source, "fallback");
  assert.equal(refreshed.payload.text, "cached-fallback");
  assert.equal(refreshed.backgroundRefreshPending, true);

  deferred.resolve(makeSettled("api", "api-after-revalidate"));
  await flushMicrotasks();
});

test("missing live writer never marks pending refresh", async () => {
  const runtime = new SearchDetailDeepDiveSectionRuntime<Payload, Diagnostics>({
    cacheLimit: 64,
    fallbackTtlMs: 20_000,
    recommendedRetryAfterMs: 1_500,
  });

  const resolved = await runtime.resolve({
    cacheKey: "k4",
    revalidateFallback: false,
    backgroundRefreshEnabled: false,
    computeFallback: async () => makeSettled("fallback", "fallback-only"),
    scheduleBackgroundRefresh: async () => null,
    resolveTtlMs: () => 600_000,
  });

  assert.equal(resolved.source, "fallback");
  assert.equal(resolved.backgroundRefreshPending, false);
  assert.equal(resolved.recommendedRetryAfterMs, null);
});
