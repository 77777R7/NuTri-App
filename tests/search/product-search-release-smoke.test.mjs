import assert from "node:assert/strict";
import test from "node:test";

import { runProductSearchReleaseSmoke } from "../../scripts/maintainer/smoke-product-search-release.mjs";

const productRows = (prefix, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    productId: `${prefix}-${index + 1}`,
    name: `${prefix} Product ${index + 1}`,
    brand: index % 2 === 0 ? "NOW Foods" : "Solgar",
  }));

const searchResponse = ({ page, rows, pagination }) => ({
  success: true,
  data: {
    supplements: rows,
    pagination: {
      total: 1155,
      page,
      limit: 20,
      totalPages: 58,
      ...pagination,
    },
  },
});

const bootstrapResponse = ({ rows, pagination }) => ({
  success: true,
  data: {
    categories: {
      All: rows,
    },
    paginationByCategory: pagination
      ? {
          All: {
            total: 1155,
            page: 1,
            limit: 20,
            totalPages: 58,
            ...pagination,
          },
        }
      : undefined,
  },
});

const detailResponse = () => ({
  success: true,
  data: {
    product: {
      productId: "page1-1",
      name: "Fixture Product",
      brand: "Fixture Brand",
    },
    ingredientOverview: {
      mode: "multi_anchor",
      titleLine: "Ingredient overview",
      paragraph1: "This fixture has enough ingredient context.",
    },
    scientificBackground: {
      mode: "research_mode",
      introLine: "Science context",
      sections: [{ title: "Evidence", body: "Fixture science section." }],
    },
  },
});

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload),
});

const makeFetch = ({ legacyPagination = false, onePageBootstrap = false, missingDeepDive = false } = {}) => {
  const page1Rows = productRows("page1", 20);
  const page2Rows = productRows("page2", 20);
  const bootstrapRows = productRows("bootstrap", onePageBootstrap ? 20 : 60);
  return async (rawUrl) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/api/search/bootstrap") {
      return jsonResponse(
        bootstrapResponse({
          rows: bootstrapRows,
          pagination: onePageBootstrap
            ? null
            : {
                hasMore: true,
                nextPage: 2,
                shown: 20,
                totalIsExact: true,
              },
        }),
      );
    }
    if (url.pathname === "/api/search/product-detail") {
      const detail = detailResponse();
      if (missingDeepDive) {
        delete detail.data.ingredientOverview;
        delete detail.data.scientificBackground;
      }
      return jsonResponse(detail);
    }
    if (url.pathname === "/api/search") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const rows = page === 2 ? page2Rows : page1Rows;
      return jsonResponse(
        searchResponse({
          page,
          rows,
          pagination: legacyPagination
            ? {}
            : {
                hasMore: true,
                nextPage: page + 1,
                shown: page * 20,
                totalIsExact: true,
              },
        }),
      );
    }
    return jsonResponse({ error: "not found" }, 404);
  };
};

test("Product Search release smoke passes when pagination, bootstrap, and detail contracts are present", async () => {
  const result = await runProductSearchReleaseSmoke({
    baseUrl: "https://fixture.test",
    maxWarmMs: 1500,
    fetchImpl: makeFetch(),
  });

  assert.equal(result.status, "pass");
  assert.equal(result.summary.fail, 0);
  assert.ok(result.checks.every((check) => check.ok));
});

test("Product Search release smoke fails old production-style pagination and one-page bootstrap", async () => {
  const result = await runProductSearchReleaseSmoke({
    baseUrl: "https://fixture.test",
    maxWarmMs: 1500,
    fetchImpl: makeFetch({ legacyPagination: true, onePageBootstrap: true }),
  });

  assert.equal(result.status, "fail");
  const failedLabels = result.checks.filter((check) => !check.ok).map((check) => check.label);
  assert.ok(failedLabels.includes("page 1: hasMore is boolean"));
  assert.ok(failedLabels.includes("page 1: nextPage is 2"));
  assert.ok(failedLabels.includes("page 2: shown is at least 40"));
  assert.ok(failedLabels.includes("bootstrap All cache exposes continuation rows"));
  assert.ok(failedLabels.includes("bootstrap All: pagination object exists"));
});

test("Product Search release smoke fails when detail deep-dive sections are missing", async () => {
  const result = await runProductSearchReleaseSmoke({
    baseUrl: "https://fixture.test",
    maxWarmMs: 1500,
    fetchImpl: makeFetch({ missingDeepDive: true }),
  });

  assert.equal(result.status, "fail");
  const failedLabels = result.checks.filter((check) => !check.ok).map((check) => check.label);
  assert.ok(failedLabels.includes("product detail has ingredient overview content"));
  assert.ok(failedLabels.includes("product detail has scientific background content"));
});
