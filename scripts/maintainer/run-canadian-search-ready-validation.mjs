#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import { extractSearchSupplements } from "./lib/cross-surface-quality-reporting.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const STAGING_JSON = getArg("staging-json");
const API_BASE_URL = getArg(
  "api-base-url",
  process.env.SCIENCE_VALIDATION_API_BASE_URL || process.env.API_BASE_URL || "http://127.0.0.1:3001",
);
const OUT_DIR = getArg(
  "out-dir",
  "output/canadian_brand_full_coverage_wave_v0/search_ready_validation",
);
const LIMIT = Math.max(1, Number(getArg("limit", "10")) || 10);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const fetchJson = async (url) => {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const json = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: { error: error instanceof Error ? error.message : String(error) },
    };
  }
};

const findExpectedResult = (results, row) => {
  const expectedId = normalizeText(row.productId);
  const expectedBrand = normalizeLooseText(row.brandName);
  const expectedTitle = normalizeLooseText(row.title);
  return results.findIndex((item) => {
    if (normalizeText(item?.productId ?? item?.id) === expectedId) return true;
    const brand = normalizeLooseText(item?.brand);
    const name = normalizeLooseText(item?.name);
    return brand === expectedBrand && name === expectedTitle;
  });
};

const rowDetailReady = (row) => ({
  hasLink: Boolean(normalizeText(row?.link)),
  hasImage:
    Boolean(normalizeText(row?.productCatalogImage)) ||
    (Array.isArray(row?.productImages) && row.productImages.length > 0),
  hasContent:
    Boolean(normalizeText(row?.descriptionSections?.["Other ingredients"])) ||
    Boolean(normalizeText(row?.descriptionSections?.["Suggested use"])) ||
    Boolean(normalizeText(row?.descriptionSections?.Warnings)),
});

const resolveDetailPayload = (responseJson) =>
  responseJson && typeof responseJson === "object" && responseJson.data && typeof responseJson.data === "object"
    ? responseJson.data
    : responseJson;

const main = async () => {
  if (!STAGING_JSON) throw new Error("Missing --staging-json");
  const payload = JSON.parse(await fs.readFile(path.resolve(ROOT, STAGING_JSON), "utf8"));
  const rows = Array.isArray(payload?.products) ? payload.products : [];
  const reportRows = [];

  for (const row of rows) {
    const query = `${normalizeText(row.brandName)} ${normalizeText(row.title)}`.trim();
    const url = `${API_BASE_URL.replace(/\/+$/, "")}/api/search?q=${encodeURIComponent(query)}&limit=${LIMIT}`;
    const response = await fetchJson(url);
    const results = extractSearchSupplements(response.json);
    const rankIndex = findExpectedResult(results, row);
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;
    const detailReady = rowDetailReady(row);
    const detailResponse = await fetchJson(
      `${API_BASE_URL.replace(/\/+$/, "")}/api/search/product-detail?productId=${encodeURIComponent(row.productId)}`,
    );
    const detailPayload = resolveDetailPayload(detailResponse.json);
    const detailProductId = normalizeText(detailPayload?.product?.productId);
    const detailHasOverview = Boolean(normalizeText(detailPayload?.ingredientOverview?.paragraph1));
    const detailHasScience = Array.isArray(detailPayload?.scientificBackground?.sections)
      && detailPayload.scientificBackground.sections.length > 0;
    reportRows.push({
      brandName: row.brandName,
      title: row.title,
      productId: row.productId,
      query,
      httpStatus: response.status,
      status:
        !response.ok ? "fail" :
        rank != null && rank <= 3 ? "pass" :
        rank != null && rank <= 5 ? "warn" :
        "fail",
      reason:
        !response.ok ? `search_http_${response.status}` :
        rank == null ? "search_exact_identity_missing" :
        rank <= 3 ? "search_top3_exact_identity_hit" :
        "search_top5_exact_identity_hit",
      rank,
      resultCount: results.length,
      detailReady,
      detailRuntimeStatus:
        !detailResponse.ok ? `detail_http_${detailResponse.status}` :
        detailProductId !== normalizeText(row.productId) ? "detail_identity_mismatch" :
        !detailHasOverview ? "detail_missing_ingredient_overview" :
        !detailHasScience ? "detail_missing_scientific_background" :
        "product_id_clickthrough_supported",
      topResult: results[0]
        ? {
            productId: results[0].productId ?? results[0].id ?? null,
            name: results[0].name ?? null,
            brand: results[0].brand ?? null,
            barcode: results[0].barcode ?? results[0].upcCode ?? null,
          }
        : null,
      detailSummary: detailResponse.ok
        ? {
            productId: detailProductId || null,
            title: normalizeText(detailPayload?.product?.name) || null,
            brand: normalizeText(detailPayload?.product?.brand) || null,
            hasIngredientOverview: detailHasOverview,
            hasScientificBackground: detailHasScience,
          }
        : null,
    });
  }

  const summary = {
    total: reportRows.length,
    pass: reportRows.filter((row) => row.status === "pass").length,
    warn: reportRows.filter((row) => row.status === "warn").length,
    fail: reportRows.filter((row) => row.status === "fail").length,
    detailRuntimeReady: reportRows.filter(
      (row) => row.detailRuntimeStatus === "product_id_clickthrough_supported",
    ).length,
    detailRuntimeFailed: reportRows.filter(
      (row) => row.detailRuntimeStatus !== "product_id_clickthrough_supported",
    ).length,
  };

  const report = {
    reportType: "canadian_search_ready_validation",
    generatedAt: new Date().toISOString(),
    stagingJson: STAGING_JSON,
    apiBaseUrl: API_BASE_URL,
    summary,
    rows: reportRows,
  };

  await fs.mkdir(path.resolve(ROOT, OUT_DIR), { recursive: true });
  const jsonPath = path.resolve(ROOT, OUT_DIR, "canadian_search_ready_validation.json");
  const mdPath = path.resolve(ROOT, OUT_DIR, "canadian_search_ready_validation.md");
  const md = [
    "# Canadian Search-Ready Validation",
    "",
    `- total: ${summary.total}`,
    `- pass: ${summary.pass}`,
    `- warn: ${summary.warn}`,
    `- fail: ${summary.fail}`,
    `- detail runtime ready: ${summary.detailRuntimeReady}`,
    `- detail runtime failed: ${summary.detailRuntimeFailed}`,
    "",
    "## Rows",
    "",
    ...reportRows.map(
      (row) =>
        `- ${row.status} | ${row.brandName} | ${row.title} | rank=${row.rank ?? "miss"} | ${row.detailRuntimeStatus}`,
    ),
    "",
  ].join("\n");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, `${md}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          json: path.relative(ROOT, jsonPath),
          md: path.relative(ROOT, mdPath),
        },
        summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
