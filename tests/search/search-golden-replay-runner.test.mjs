import assert from "node:assert/strict";
import test from "node:test";
import {
  createSearchReplayReport,
  renderSearchReplayMarkdown,
  waitForSearchReplayWarmReady,
} from "../../scripts/maintainer/lib/search-replay-runner.mjs";

const buildScenario = (overrides = {}) => ({
  id: overrides.id ?? "search_exact_fixture",
  surface: "search",
  origin: "search_result",
  category: "omega3_source_oil",
  personas: [],
  input: {
    query: overrides.query ?? "Sports Research Omega-3",
    queryType: overrides.queryType ?? "exact_title",
    ...(overrides.inputCategory ? { category: overrides.inputCategory } : {}),
    ...(overrides.page ? { page: overrides.page } : {}),
  },
  product: {
    productId: overrides.productId ?? "core-sr-omega3",
    brand: "Sports Research",
    name: "Omega-3 1040 mg Fish Oil 1250 mg",
    barcode: "00023249011835",
  },
  expected: {
    search: {
      expectedProductId: overrides.productId ?? "core-sr-omega3",
      metric: overrides.metric ?? "top1",
      intent: overrides.intent ?? "brand_product",
      tier: overrides.tier ?? 0,
      ...(overrides.mustMatchTerms ? { mustMatchTerms: overrides.mustMatchTerms } : {}),
      ...(overrides.expectedSearch ? overrides.expectedSearch : {}),
    },
  },
  gates: ["search_relevance"],
  severityOnFail: "P1",
});

const apiResponse = (supplements, pagination = {}) => ({
  success: true,
  data: {
    supplements,
    pagination: {
      total: supplements.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasMore: false,
      nextPage: null,
      shown: supplements.length,
      totalIsExact: true,
      ...pagination,
    },
    suggestions: {
      categories: [],
      brands: [],
      popularSearches: [],
    },
  },
});

const supplement = (productId, overrides = {}) => ({
  id: productId,
  productId,
  barcode: overrides.barcode ?? null,
  upcCode: overrides.upcCode ?? null,
  name: overrides.name ?? productId,
  brand: overrides.brand ?? "Fixture Brand",
  category: overrides.category ?? "Supplement",
  benefit: overrides.benefit ?? "Fixture",
  dose: overrides.dose ?? "",
  factsStatus: "partial",
  coverageStatus: "coverage_ready",
});

test("search replay report calls /api/search and scores passing search scenarios", async () => {
  const scenario = buildScenario();
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () =>
        apiResponse([
          supplement("core-sr-omega3", {
            barcode: "00023249011835",
            name: "Omega-3 1040 mg Fish Oil 1250 mg",
            brand: "Sports Research",
          }),
          supplement("decoy"),
        ]),
    };
  };

  const report = await createSearchReplayReport({
    pack: { version: "fixture-pack", scenarios: [scenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    timestamp: "fixed",
  });

  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.pass, 1);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.rows[0].status, "pass");
  assert.equal(report.rows[0].httpStatus, 200);
  assert.equal(report.rows[0].rank, 1);
  assert.equal(report.rows[0].expectedIntent, "brand_product");
  assert.equal(report.rows[0].expectedTier, 0);
  assert.match(requestedUrls[0], /^http:\/\/127\.0\.0\.1:3000\/api\/search\?/);
  assert.match(requestedUrls[0], /[?&]q=Sports\+Research\+Omega-3/);
  assert.doesNotMatch(requestedUrls[0], /[?&]query=/);
  assert.match(requestedUrls[0], /limit=20/);
});

test("search replay report supports category, page, and zero-result release checks", async () => {
  const categoryScenario = buildScenario({
    id: "search_category_page_fixture",
    query: "magnesium",
    inputCategory: "Minerals",
    page: 2,
    metric: "recall5",
    productId: "term-match:magnesium",
    mustMatchTerms: ["Magnesium"],
  });
  const zeroScenario = buildScenario({
    id: "search_zero_fixture",
    query: "zzzxxy unavailable supplement",
    metric: "zero_results",
    productId: "zero-results",
  });
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes("zzzxxy")) {
      return { ok: true, status: 200, json: async () => apiResponse([]) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => apiResponse([
        supplement("magnesium-term-match", {
          name: "Magnesium Glycinate",
          category: "Minerals",
        }),
      ]),
    };
  };

  const report = await createSearchReplayReport({
    pack: { version: "fixture-pack", scenarios: [categoryScenario, zeroScenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    timestamp: "fixed",
  });

  assert.equal(report.summary.pass, 2);
  assert.match(requestedUrls[0], /[?&]category=Minerals/);
  assert.match(requestedUrls[0], /[?&]page=2/);
  assert.equal(report.rows[1].reason, "search_expectation_met");
  assert.equal(report.rows[1].resultCount, 0);
});

test("search replay report enforces continuation pagination and duplicate contracts", async () => {
  const scenario = buildScenario({
    id: "search_page3_continuation_fixture",
    query: "magnesium glycinate",
    queryType: "ingredient_form",
    page: 3,
    metric: "recall5",
    productId: "term-match-magnesium",
    mustMatchTerms: ["Magnesium"],
    expectedSearch: {
      pagination: { page: 3, hasMore: false },
      noDuplicateProductIds: true,
    },
  });
  const duplicateScenario = buildScenario({
    id: "search_duplicate_continuation_fixture",
    query: "vitamin d",
    queryType: "ingredient_family",
    metric: "recall5",
    productId: "term-match-vitamin-d",
    mustMatchTerms: ["Vitamin D"],
    expectedSearch: {
      noDuplicateProductIds: true,
    },
  });
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          apiResponse([
            supplement("magnesium-page3", { name: "Magnesium Glycinate" }),
          ], {
            total: 60,
            page: 3,
            limit: 20,
            totalPages: 3,
            hasMore: false,
            shown: 60,
          }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () =>
        apiResponse([
          supplement("vitamin-d-dup", { name: "Vitamin D3 1000 IU" }),
          supplement("vitamin-d-dup", { name: "Vitamin D3 1000 IU" }),
        ]),
    };
  };

  const report = await createSearchReplayReport({
    pack: { version: "fixture-pack", scenarios: [scenario, duplicateScenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    timestamp: "fixed",
  });

  assert.equal(report.rows[0].status, "pass");
  assert.equal(report.rows[1].status, "fail");
  assert.equal(report.rows[1].reason, "search_duplicate_product_ids");
});

test("search replay report records scorer failures with representative details", async () => {
  const scenario = buildScenario({ id: "search_exact_miss" });
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () =>
      apiResponse([
        supplement("decoy-top"),
        supplement("core-sr-omega3", { barcode: "00023249011835" }),
      ]),
  });

  const report = await createSearchReplayReport({
    pack: { version: "fixture-pack", scenarios: [scenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    timestamp: "fixed",
  });

  assert.equal(report.summary.pass, 0);
  assert.equal(report.summary.fail, 1);
  assert.equal(report.rows[0].status, "fail");
  assert.equal(report.rows[0].reason, "search_top1_miss");
  assert.equal(report.rows[0].rank, 2);
  assert.deepEqual(report.summary.failureBuckets, [
    { reason: "search_top1_miss", count: 1 },
  ]);
});

test("search replay report converts HTTP failures into route failures", async () => {
  const scenario = buildScenario({ id: "search_http_500" });
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => "backend exploded",
  });

  const report = await createSearchReplayReport({
    pack: { version: "fixture-pack", scenarios: [scenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    timestamp: "fixed",
  });

  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.fail, 1);
  assert.equal(report.rows[0].status, "fail");
  assert.equal(report.rows[0].reason, "search_route_failure");
  assert.equal(report.rows[0].httpStatus, 500);
  assert.equal(report.rows[0].errorMessage, "backend exploded");
});

test("search replay markdown renders headline and failure buckets", () => {
  const markdown = renderSearchReplayMarkdown({
    summary: {
      total: 2,
      pass: 1,
      warn: 0,
      fail: 1,
      failureBuckets: [{ reason: "search_top1_miss", count: 1 }],
    },
    rows: [
      {
        id: "search_exact_miss",
        query: "Sports Research Omega-3",
        status: "fail",
        reason: "search_top1_miss",
        rank: 2,
        expectedProductId: "core-sr-omega3",
        expectedIntent: "brand_product",
        expectedTier: 0,
      },
    ],
  });

  assert.match(markdown, /# Search Golden Replay/);
  assert.match(markdown, /- pass: 1\/2/);
  assert.match(markdown, /search_top1_miss/);
  assert.match(markdown, /Sports Research Omega-3/);
  assert.match(markdown, /intent brand_product; tier 0/);
});

test("warm-ready polling waits until probe scenarios stop failing", async () => {
  const scenario = buildScenario({
    id: "search_barcode_sr_omega3",
    query: "00023249011835",
    queryType: "barcode",
    metric: "barcode_exact",
  });

  let nowMs = 0;
  let fetchCount = 0;
  const sleepCalls = [];
  const fetchImpl = async () => {
    fetchCount += 1;
    const passing = fetchCount >= 3;
    return {
      ok: true,
      status: 200,
      json: async () =>
        apiResponse([
          passing
            ? supplement("core-sr-omega3", {
                barcode: "00023249011835",
                name: "Alaskan Omega-3 Fish Oil, 90 Softgels",
                brand: "Sports Research",
              })
            : supplement("decoy-top", {
                barcode: "00000000000001",
                name: "Decoy Product",
              }),
        ]),
    };
  };

  const warmup = await waitForSearchReplayWarmReady({
    pack: { version: "fixture-pack", scenarios: [scenario] },
    apiBaseUrl: "http://127.0.0.1:3000",
    fetchImpl,
    pollIntervalMs: 5000,
    timeoutMs: 20000,
    nowImpl: () => nowMs,
    sleepImpl: async (delayMs) => {
      sleepCalls.push(delayMs);
      nowMs += delayMs;
    },
  });

  assert.equal(warmup.status, "warm_ready");
  assert.equal(warmup.attempts, 3);
  assert.deepEqual(warmup.probeScenarioIds, ["search_barcode_sr_omega3"]);
  assert.equal(warmup.lastSummary.fail, 0);
  assert.deepEqual(sleepCalls, [5000, 5000]);
});

test("warm-ready polling throws after timeout with last failing probe summary", async () => {
  const scenario = buildScenario({
    id: "search_alias_matcha_green_tea",
    query: "matcha camellia sinensis",
    queryType: "alias",
    metric: "recall5",
  });

  let nowMs = 0;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => apiResponse([supplement("decoy-top")]),
  });

  await assert.rejects(
    () =>
      waitForSearchReplayWarmReady({
        pack: { version: "fixture-pack", scenarios: [scenario] },
        apiBaseUrl: "http://127.0.0.1:3000",
        fetchImpl,
        pollIntervalMs: 4000,
        timeoutMs: 8000,
        nowImpl: () => nowMs,
        sleepImpl: async (delayMs) => {
          nowMs += delayMs;
        },
      }),
    (error) => {
      assert.match(String(error?.message ?? error), /warm-ready timeout/i);
      assert.match(String(error?.message ?? error), /search_alias_matcha_green_tea/);
      assert.match(String(error?.message ?? error), /search_recall5_miss/);
      return true;
    },
  );
});
