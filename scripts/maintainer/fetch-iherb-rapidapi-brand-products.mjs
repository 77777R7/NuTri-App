#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import {
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromZipRow,
  normalizeText,
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

const BRAND_SLUG = normalizeText(getArg("brand-slug"));
const OUT_DIR = getArg(
  "out-dir",
  path.join(
    ROOT,
    "output",
    `iherb_rapidapi_brand_fetch_${(BRAND_SLUG || "brand").replace(/[^a-z0-9-]+/gi, "_")}`,
  ),
);
const MAX_PAGES = Number(getArg("max-pages", 0)) || null;
const DELAY_MS = Number(getArg("delay-ms", 300)) || 0;
const RAPIDAPI_KEY =
  process.env.IHERB_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.X_RAPIDAPI_KEY ||
  process.env.RAPID_API_KEY ||
  getArg("rapidapi-key");

if (!BRAND_SLUG) {
  throw new Error("Missing --brand-slug.");
}

if (!RAPIDAPI_KEY) {
  throw new Error("Missing RapidAPI key. Set IHERB_RAPIDAPI_KEY/RAPIDAPI_KEY or pass --rapidapi-key.");
}

const API_HOST = "iherb-product-data-api.p.rapidapi.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, text) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
};

const fetchBrandPage = async (brandSlug, page) => {
  const url = `https://${API_HOST}/api/IHerb/brands/${brandSlug}/products?page=${page}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": API_HOST,
      "x-rapidapi-key": RAPIDAPI_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RapidAPI request failed (${response.status}) for ${brandSlug} page ${page}: ${body.slice(0, 500)}`);
  }

  return response.json();
};

const toMarkdown = (report) => {
  const lines = [
    "# iHerb RapidAPI Brand Fetch",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- brandSlug: ${report.inputs.brandSlug}`,
    `- totalPagesFetched: ${report.summary.totalPagesFetched}`,
    `- totalProducts: ${report.summary.totalProducts}`,
    `- full_overlay_ready: ${report.summary.statusCounts.full_overlay_ready}`,
    `- partial_overlay: ${report.summary.statusCounts.partial_overlay}`,
    `- catalog_only: ${report.summary.statusCounts.catalog_only}`,
    `- conflicted_or_non_us: ${report.summary.statusCounts.conflicted_or_non_us}`,
    `- high_confidence_product_page_ready: ${report.summary.highConfidenceUsProductPageReady}`,
    "",
    "## Samples",
    "",
  ];

  for (const row of report.samples) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.brandName || "n/a"} | ${row.title || "n/a"} | status=${row.status} | missing=${row.coreMissingFields.join(", ") || "none"} | barcode=${row.barcode_gtin14 || "n/a"}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const firstPage = await fetchBrandPage(BRAND_SLUG, 1);
  const totalPages = Number(firstPage?.totalPages ?? 1);
  const pagesToFetch = MAX_PAGES ? Math.min(totalPages, MAX_PAGES) : totalPages;
  const pages = [firstPage];

  for (let page = 2; page <= pagesToFetch; page += 1) {
    if (DELAY_MS > 0) await sleep(DELAY_MS);
    pages.push(await fetchBrandPage(BRAND_SLUG, page));
  }

  const rawProducts = pages.flatMap((page) => (Array.isArray(page?.products) ? page.products : []));
  const overlayRecords = rawProducts.map((row) => {
    const record = extractOverlayRecordFromZipRow(row, {
      entryName: `rapidapi:${BRAND_SLUG}:page_fetch`,
      marketSource: "US",
    });
    const completeness = deriveCompleteness(record);
    const status = classifyOverlayStatus(record, completeness);
    const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(record, completeness);
    return {
      ...record,
      completeness: {
        ...completeness,
        status,
      },
      readiness: {
        highConfidenceUsProductPageReady,
      },
      overlaySha256: stableHash({
        brandName: record.brandName,
        title: record.title,
        barcode_gtin14: record.barcode_gtin14,
        supplementFacts: record.supplementFacts,
        descriptionSections: record.descriptionSections,
        sourceSummary: record.sourceSummary,
      }),
    };
  });

  const statusCounts = overlayRecords.reduce(
    (acc, row) => {
      const status = row?.completeness?.status ?? "unknown";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {
      full_overlay_ready: 0,
      partial_overlay: 0,
      catalog_only: 0,
      conflicted_or_non_us: 0,
    },
  );

  const report = {
    schemaVersion: "iherb_rapidapi_brand_fetch.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      brandSlug: BRAND_SLUG,
      maxPages: MAX_PAGES,
      delayMs: DELAY_MS,
    },
    summary: {
      totalPagesAvailable: totalPages,
      totalPagesFetched: pagesToFetch,
      totalProducts: rawProducts.length,
      statusCounts,
      highConfidenceUsProductPageReady: overlayRecords.filter(
        (row) => row?.readiness?.highConfidenceUsProductPageReady,
      ).length,
    },
    samples: overlayRecords.slice(0, 25).map((row) => ({
      productId: row.productId,
      brandName: row.brandName,
      title: row.title,
      barcode_gtin14: row.barcode_gtin14,
      status: row?.completeness?.status ?? "unknown",
      coreMissingFields: row?.completeness?.coreMissingFields ?? [],
    })),
  };

  const rawPath = path.join(OUT_DIR, "raw_brand_products.json");
  const overlayPath = path.join(OUT_DIR, "overlay_records.json");
  const reportJsonPath = path.join(OUT_DIR, "brand_fetch_report.json");
  const reportMdPath = path.join(OUT_DIR, "brand_fetch_report.md");

  await writeJson(rawPath, {
    schemaVersion: "iherb_rapidapi_brand_products.v1",
    brandSlug: BRAND_SLUG,
    fetchedAt: report.generatedAt,
    totalPagesAvailable: totalPages,
    totalPagesFetched: pagesToFetch,
    products: rawProducts,
  });
  await writeJson(overlayPath, {
    schemaVersion: "iherb_rapidapi_overlay_records.v1",
    brandSlug: BRAND_SLUG,
    fetchedAt: report.generatedAt,
    records: overlayRecords,
  });
  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          rawProducts: rawPath,
          overlayRecords: overlayPath,
          reportJson: reportJsonPath,
          reportMd: reportMdPath,
        },
        summary: report.summary,
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
