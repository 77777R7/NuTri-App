#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://nutri-app-qn0u.onrender.com";
const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_WARM_MS = 1500;

const trimTrailingSlash = (value) => String(value ?? "").replace(/\/+$/, "");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {
    baseUrl: process.env.PRODUCT_SEARCH_SMOKE_BASE_URL || DEFAULT_BASE_URL,
    maxWarmMs: Number.parseInt(process.env.PRODUCT_SEARCH_SMOKE_MAX_WARM_MS ?? "", 10),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") {
      parsed.baseUrl = args[index + 1] || parsed.baseUrl;
      index += 1;
    } else if (arg.startsWith("--base-url=")) {
      parsed.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--max-warm-ms") {
      parsed.maxWarmMs = Number.parseInt(args[index + 1] ?? "", 10);
      index += 1;
    } else if (arg.startsWith("--max-warm-ms=")) {
      parsed.maxWarmMs = Number.parseInt(arg.slice("--max-warm-ms=".length), 10);
    }
  }

  if (!Number.isFinite(parsed.maxWarmMs) || parsed.maxWarmMs <= 0) {
    parsed.maxWarmMs = DEFAULT_MAX_WARM_MS;
  }

  return {
    baseUrl: trimTrailingSlash(parsed.baseUrl),
    maxWarmMs: parsed.maxWarmMs,
  };
};

const searchUrl = (baseUrl, params) => {
  const query = new URLSearchParams();
  query.set("query", params.query ?? "");
  query.set("page", String(params.page ?? 1));
  query.set("limit", String(params.limit ?? DEFAULT_LIMIT));
  if (params.category) query.set("category", params.category);
  return `${baseUrl}/api/search?${query.toString()}`;
};

const timedJson = async (url, fetchImpl = globalThis.fetch) => {
  const startedAt = performance.now();
  let response = null;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      durationMs: Math.round(performance.now() - startedAt),
      json: null,
      bodyText: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  const bodyText = await response.text();
  const durationMs = Math.round(performance.now() - startedAt);
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }
  return {
    url,
    status: response.status,
    ok: response.ok,
    durationMs,
    json,
    bodyText,
  };
};

const supplementsOf = (json) => {
  const rows = json?.data?.supplements ?? json?.supplements ?? json?.results ?? [];
  return Array.isArray(rows) ? rows : [];
};

const paginationOf = (json) => json?.data?.pagination ?? json?.pagination ?? null;

const bootstrapAllRowsOf = (json) => {
  const rows = json?.data?.categories?.All ?? json?.categories?.All ?? [];
  return Array.isArray(rows) ? rows : [];
};

const bootstrapAllPaginationOf = (json) =>
  json?.data?.paginationByCategory?.All ?? json?.paginationByCategory?.All ?? null;

const productIdOf = (row) => row?.productId ?? row?.product_id ?? row?.id ?? null;

const hasDeepDiveText = (overview) =>
  Boolean(
    overview?.titleLine ||
      overview?.paragraph1 ||
      overview?.paragraph2 ||
      overview?.compareHint ||
      overview?.text,
  );

const hasScienceContent = (science) =>
  Boolean(
    science?.introLine ||
      science?.closingNote ||
      (Array.isArray(science?.sections) && science.sections.length > 0),
  );

const recordCheck = (checks, ok, label, details = {}) => {
  checks.push({ ok, label, details });
};

const expectPaginationContract = (checks, label, pagination, expected) => {
  recordCheck(checks, Boolean(pagination), `${label}: pagination object exists`, { pagination });
  if (!pagination) return;
  recordCheck(checks, pagination.page === expected.page, `${label}: page is ${expected.page}`, { pagination });
  recordCheck(checks, pagination.limit === DEFAULT_LIMIT, `${label}: limit is ${DEFAULT_LIMIT}`, { pagination });
  recordCheck(checks, Number.isFinite(Number(pagination.total)), `${label}: total is numeric`, { pagination });
  recordCheck(checks, typeof pagination.hasMore === "boolean", `${label}: hasMore is boolean`, { pagination });
  recordCheck(
    checks,
    expected.hasMore == null || pagination.hasMore === expected.hasMore,
    `${label}: hasMore matches expected`,
    { expected: expected.hasMore, actual: pagination.hasMore },
  );
  recordCheck(
    checks,
    expected.nextPage == null || pagination.nextPage === expected.nextPage,
    `${label}: nextPage is ${expected.nextPage}`,
    { pagination },
  );
  recordCheck(
    checks,
    Number(pagination.shown) >= expected.minShown,
    `${label}: shown is at least ${expected.minShown}`,
    { pagination },
  );
  recordCheck(checks, pagination.totalIsExact === true, `${label}: totalIsExact is true`, { pagination });
};

const runSearchProbe = async ({ baseUrl, query = "", page = 1, fetchImpl = globalThis.fetch }) => {
  const result = await timedJson(searchUrl(baseUrl, { query, page, limit: DEFAULT_LIMIT }), fetchImpl);
  return {
    ...result,
    rows: supplementsOf(result.json),
    pagination: paginationOf(result.json),
  };
};

const runSmoke = async ({ baseUrl, maxWarmMs, fetchImpl = globalThis.fetch }) => {
  const checks = [];

  const coldPage1 = await runSearchProbe({ baseUrl, page: 1, fetchImpl });
  const page1 = await runSearchProbe({ baseUrl, page: 1, fetchImpl });
  const page2 = await runSearchProbe({ baseUrl, page: 2, fetchImpl });
  const bootstrap = await timedJson(`${baseUrl}/api/search/bootstrap`, fetchImpl);
  const allRows = bootstrapAllRowsOf(bootstrap.json);
  const allPagination = bootstrapAllPaginationOf(bootstrap.json);

  recordCheck(checks, coldPage1.ok, "cold page 1 returns 2xx", {
    status: coldPage1.status,
    durationMs: coldPage1.durationMs,
    errorMessage: coldPage1.errorMessage ?? null,
  });
  recordCheck(checks, page1.ok, "warm page 1 returns 2xx", {
    status: page1.status,
    durationMs: page1.durationMs,
    errorMessage: page1.errorMessage ?? null,
  });
  recordCheck(checks, page2.ok, "warm page 2 returns 2xx", {
    status: page2.status,
    durationMs: page2.durationMs,
    errorMessage: page2.errorMessage ?? null,
  });
  recordCheck(checks, bootstrap.ok, "bootstrap returns 2xx", {
    status: bootstrap.status,
    durationMs: bootstrap.durationMs,
    errorMessage: bootstrap.errorMessage ?? null,
  });

  recordCheck(checks, page1.durationMs <= maxWarmMs, `warm page 1 is <= ${maxWarmMs}ms`, {
    durationMs: page1.durationMs,
  });
  recordCheck(checks, page2.durationMs <= maxWarmMs, `warm page 2 is <= ${maxWarmMs}ms`, {
    durationMs: page2.durationMs,
  });
  recordCheck(checks, bootstrap.durationMs <= maxWarmMs, `bootstrap is <= ${maxWarmMs}ms`, {
    durationMs: bootstrap.durationMs,
  });

  recordCheck(checks, page1.rows.length === DEFAULT_LIMIT, "page 1 returns 20 results", {
    rows: page1.rows.length,
  });
  recordCheck(checks, page2.rows.length === DEFAULT_LIMIT, "page 2 returns 20 results", {
    rows: page2.rows.length,
  });

  expectPaginationContract(checks, "page 1", page1.pagination, {
    page: 1,
    hasMore: true,
    nextPage: 2,
    minShown: 20,
  });
  expectPaginationContract(checks, "page 2", page2.pagination, {
    page: 2,
    hasMore: true,
    nextPage: 3,
    minShown: 40,
  });

  const page1Ids = new Set(page1.rows.map(productIdOf).filter(Boolean));
  const duplicateIds = page2.rows.map(productIdOf).filter((id) => id && page1Ids.has(id));
  recordCheck(checks, duplicateIds.length === 0, "page 1 and page 2 have no duplicate product ids", {
    duplicateIds,
  });

  recordCheck(checks, allRows.length >= 40, "bootstrap All cache exposes continuation rows", {
    allRows: allRows.length,
  });
  expectPaginationContract(checks, "bootstrap All", allPagination, {
    page: 1,
    hasMore: true,
    nextPage: 2,
    minShown: 20,
  });

  const detailProductId = productIdOf(page1.rows[0]);
  recordCheck(checks, Boolean(detailProductId), "page 1 top result has product id", {
    detailProductId,
  });

  let detail = null;
  if (detailProductId) {
    detail = await timedJson(
      `${baseUrl}/api/search/product-detail?productId=${encodeURIComponent(detailProductId)}`,
      fetchImpl,
    );
    const payload = detail.json?.data ?? detail.json ?? {};
    recordCheck(checks, detail.ok, "product detail returns 2xx", {
      status: detail.status,
      durationMs: detail.durationMs,
      detailProductId,
      errorMessage: detail.errorMessage ?? null,
    });
    recordCheck(checks, hasDeepDiveText(payload.ingredientOverview), "product detail has ingredient overview content", {
      detailProductId,
      mode: payload.ingredientOverview?.mode ?? null,
    });
    recordCheck(checks, hasScienceContent(payload.scientificBackground), "product detail has scientific background content", {
      detailProductId,
      mode: payload.scientificBackground?.mode ?? null,
      sections: Array.isArray(payload.scientificBackground?.sections) ? payload.scientificBackground.sections.length : null,
    });
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    baseUrl,
    maxWarmMs,
    status: failed.length === 0 ? "pass" : "fail",
    summary: {
      pass: checks.length - failed.length,
      fail: failed.length,
      coldPage1Ms: coldPage1.durationMs,
      warmPage1Ms: page1.durationMs,
      warmPage2Ms: page2.durationMs,
      bootstrapMs: bootstrap.durationMs,
      detailMs: detail?.durationMs ?? null,
    },
    checks,
  };
};

const main = async () => {
  const result = await runSmoke(parseArgs());
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "pass") {
    process.exitCode = 1;
  }
};

export { runSmoke as runProductSearchReleaseSmoke };

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
};

if (isDirectExecution()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
