#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromZipRow,
  mergeOverlayRecords,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
dotenv.config();
dotenv.config({ path: path.join(ROOT, "backend", ".env") });

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_overlay_staging_pure_refresh", "staging_products.json"),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "pure_execution_plan_strict", "api_fill_priority_queue.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "pure_p0_productid_refresh"));
const BRAND_SLUG = getArg("brand-slug", "pure-encapsulations");
const BRAND_FILTER = getArg("brand", "Pure Encapsulations");
const PRIORITY_LANE = getArg("priority-lane", "P0_api_fill_us_strong_identity");
const LIMIT = Number(getArg("limit", 0)) || null;
const DELAY_MS = Number(getArg("delay-ms", 1300)) || 0;
const RAPIDAPI_KEY =
  process.env.IHERB_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.X_RAPIDAPI_KEY ||
  process.env.RAPID_API_KEY ||
  getArg("rapidapi-key");

if (!RAPIDAPI_KEY) {
  throw new Error("Missing RapidAPI key. Set RAPIDAPI_KEY or pass --rapidapi-key.");
}

const API_HOST = "iherb-product-data-api.p.rapidapi.com";

const CORE_FIELDS = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildOverlayHash = (row) =>
  stableHash({
    brandName: row.brandName,
    title: row.title,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts,
    descriptionSections: row.descriptionSections,
    sourceSummary: row.sourceSummary,
  });

const renderMissing = (fields) => (fields.length > 0 ? fields.join(", ") : "none");

const buildMarkdownReport = (report) => {
  const lines = [
    "# Pure P0 ProductId Refresh",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- brandSlug: ${report.inputs.brandSlug}`,
    `- priorityLane: ${report.inputs.priorityLane}`,
    `- delayMs: ${report.inputs.delayMs}`,
    "",
    "## Summary",
    "",
    `- queued: ${report.summary.queued}`,
    `- processed: ${report.summary.processed}`,
    `- api_hits: ${report.summary.apiHits}`,
    `- api_misses: ${report.summary.apiMisses}`,
    `- improved_rows: ${report.summary.improvedRows}`,
    `- became_full_overlay_ready: ${report.summary.becameFullOverlayReady}`,
    `- filled_suggested_use: ${report.summary.filledSuggestedUse}`,
    `- filled_warnings: ${report.summary.filledWarnings}`,
    `- filled_product_image: ${report.summary.filledProductImage}`,
    `- still_missing_suggested_use: ${report.summary.stillMissingSuggestedUse}`,
    `- still_missing_warnings: ${report.summary.stillMissingWarnings}`,
    `- still_missing_product_image: ${report.summary.stillMissingProductImage}`,
    "",
    "## Sample Results",
    "",
  ];

  for (const row of report.rows.slice(0, 40)) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.title} | apiHit=${row.apiHit} | before=${renderMissing(
        row.beforeMissingFields,
      )} | after=${renderMissing(row.afterMissingFields)} | changed=${row.improved}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const fetchProductById = async (brandSlug, productId) => {
  const url = new URL(`https://${API_HOST}/api/IHerb/brands/${brandSlug}/products`);
  url.searchParams.set("page", "1");
  url.searchParams.set("productId", productId);

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": API_HOST,
      "x-rapidapi-key": RAPIDAPI_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RapidAPI request failed (${response.status}) for productId ${productId}: ${body.slice(0, 500)}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.products) ? payload.products : [];
};

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);

  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: buildOverlayHash(mergedRecord),
  };
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const stagingPayload = await readJson(STAGING_PATH);
  const queueRows = await readJson(QUEUE_PATH);
  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const requestedRows = (Array.isArray(queueRows) ? queueRows : [])
    .filter((row) => normalizeText(row?.priorityLane) === PRIORITY_LANE)
    .filter((row) => (BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true))
    .filter((row) => Boolean(normalizeText(row?.productId)));

  const selectedRows = LIMIT ? requestedRows.slice(0, LIMIT) : requestedRows;
  const buildStagingKey = (brandName, productId) => `${normalizeLower(brandName)}||${normalizeText(productId)}`;
  const stagingByProductId = new Map();
  stagingRows.forEach((row, idx) => {
    const productId = normalizeText(row?.productId);
    if (!productId) return;
    stagingByProductId.set(buildStagingKey(row?.brandName, productId), { row, idx });
  });

  const refreshedRows = [...stagingRows];
  const auditRows = [];

  for (let idx = 0; idx < selectedRows.length; idx += 1) {
    const queueRow = selectedRows[idx];
    const productId = normalizeText(queueRow.productId);
    const stagedEntry = stagingByProductId.get(buildStagingKey(queueRow?.brandName ?? BRAND_FILTER, productId));
    if (!stagedEntry) {
      auditRows.push({
        productId,
        title: queueRow.title,
        apiHit: false,
        apiMatchCount: 0,
        improved: false,
        reason: "missing_staging_row",
        beforeMissingFields: queueRow.coreMissingFields ?? [],
        afterMissingFields: queueRow.coreMissingFields ?? [],
      });
      if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const beforeMissingFields = Array.isArray(stagedEntry.row?.completeness?.coreMissingFields)
      ? stagedEntry.row.completeness.coreMissingFields
      : [];

    let apiProducts = [];
    let requestError = null;
    try {
      apiProducts = await fetchProductById(BRAND_SLUG, productId);
    } catch (error) {
      requestError = error instanceof Error ? error.message : String(error);
    }

    const matchedApiRow = apiProducts.find((row) => normalizeText(row?.productId) === productId) ?? apiProducts[0] ?? null;

    if (!matchedApiRow || requestError) {
      auditRows.push({
        productId,
        title: stagedEntry.row.title,
        apiHit: false,
        apiMatchCount: apiProducts.length,
        improved: false,
        reason: requestError ? "request_failed" : "api_product_not_found",
        requestError,
        beforeMissingFields,
        afterMissingFields: beforeMissingFields,
      });
      if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const incomingRecord = extractOverlayRecordFromZipRow(matchedApiRow, {
      entryName: `rapidapi:${BRAND_SLUG}:productId:${productId}`,
      marketSource: "US",
    });
    const mergedRecord = mergeOverlayRecords(stagedEntry.row, incomingRecord);
    const hydratedRow = hydrateMergedRow(stagedEntry.row, mergedRecord);
    refreshedRows[stagedEntry.idx] = hydratedRow;

    const afterMissingFields = Array.isArray(hydratedRow?.completeness?.coreMissingFields)
      ? hydratedRow.completeness.coreMissingFields
      : [];

    const filledFields = CORE_FIELDS.filter(
      (field) => beforeMissingFields.includes(field) && !afterMissingFields.includes(field),
    );

    auditRows.push({
      productId,
      title: hydratedRow.title,
      apiHit: true,
      apiMatchCount: apiProducts.length,
      improved: filledFields.length > 0,
      filledFields,
      beforeStatus: stagedEntry.row?.completeness?.status ?? "unknown",
      afterStatus: hydratedRow?.completeness?.status ?? "unknown",
      beforeMissingFields,
      afterMissingFields,
      apiHasSuggestedUse: /Suggested use/i.test(normalizeText(matchedApiRow?.allDescription)),
      apiHasWarnings: /Warnings/i.test(normalizeText(matchedApiRow?.allDescription)),
      apiImageCount: Array.isArray(matchedApiRow?.productImages) ? matchedApiRow.productImages.length : 0,
      apiProductCatalogImage: normalizeText(matchedApiRow?.productCatalogImage) || null,
      apiPreview: normalizeText(matchedApiRow?.allDescription).slice(0, 300),
    });

    if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
  }

  const summary = auditRows.reduce(
    (acc, row) => {
      acc.processed += 1;
      if (row.apiHit) acc.apiHits += 1;
      else acc.apiMisses += 1;
      if (row.improved) acc.improvedRows += 1;
      if (row.afterStatus === "full_overlay_ready" && row.beforeStatus !== "full_overlay_ready") {
        acc.becameFullOverlayReady += 1;
      }
      if ((row.filledFields ?? []).includes("suggested_use")) acc.filledSuggestedUse += 1;
      if ((row.filledFields ?? []).includes("warnings")) acc.filledWarnings += 1;
      if ((row.filledFields ?? []).includes("product_image")) acc.filledProductImage += 1;
      if ((row.afterMissingFields ?? []).includes("suggested_use")) acc.stillMissingSuggestedUse += 1;
      if ((row.afterMissingFields ?? []).includes("warnings")) acc.stillMissingWarnings += 1;
      if ((row.afterMissingFields ?? []).includes("product_image")) acc.stillMissingProductImage += 1;
      return acc;
    },
    {
      queued: selectedRows.length,
      processed: 0,
      apiHits: 0,
      apiMisses: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
      filledSuggestedUse: 0,
      filledWarnings: 0,
      filledProductImage: 0,
      stillMissingSuggestedUse: 0,
      stillMissingWarnings: 0,
      stillMissingProductImage: 0,
    },
  );

  const report = {
    schemaVersion: "pure_p0_productid_refresh.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
      brandSlug: BRAND_SLUG,
      brandFilter: BRAND_FILTER,
      priorityLane: PRIORITY_LANE,
      delayMs: DELAY_MS,
      limit: LIMIT,
    },
    summary,
    rows: auditRows,
  };

  const refreshedStagingPath = path.join(OUT_DIR, "staging_products.p0_refreshed.json");
  const reportJsonPath = path.join(OUT_DIR, "productid_refresh_report.json");
  const reportMdPath = path.join(OUT_DIR, "productid_refresh_report.md");

  await fs.writeFile(refreshedStagingPath, `${JSON.stringify({ products: refreshedRows }, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, buildMarkdownReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          refreshedStaging: refreshedStagingPath,
          reportJson: reportJsonPath,
          reportMd: reportMdPath,
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
