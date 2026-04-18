#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
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
const hasFlag = (name) => args.includes(`--${name}`);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const BRAND_MAP_PATH = getArg("brand-map-json", path.join(ROOT, "data", "iherb_rapidapi_brand_map.json"));
const TARGET_BRANDS = (getArg("brands", "Healthy Origins,Schiff,Natrol,Centrum"))
  .split(",")
  .map((item) => normalizeText(item))
  .filter(Boolean);
const OUT_DIR = getArg(
  "out-dir",
  path.join(
    ROOT,
    "output",
    `iherb_missing_brand_rapidapi_wave_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
  ),
);
const DELAY_MS = Number(getArg("delay-ms", 300)) || 0;
const MAX_PAGES = Number(getArg("max-pages", 0)) || null;
const RUN_MERGE = !hasFlag("no-merge");
const APPLY_MERGE = hasFlag("apply");
const RAPIDAPI_KEY =
  process.env.IHERB_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  process.env.X_RAPIDAPI_KEY ||
  process.env.RAPID_API_KEY ||
  getArg("rapidapi-key");

if (!RAPIDAPI_KEY) {
  throw new Error("Missing RapidAPI key. Set IHERB_RAPIDAPI_KEY/RAPIDAPI_KEY or pass --rapidapi-key.");
}

const API_HOST = "iherb-product-data-api.p.rapidapi.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const runNodeScript = (scriptPath, scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
    child.on("error", reject);
  });

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

const fetchAllBrandProducts = async (brandSlug) => {
  const firstPage = await fetchBrandPage(brandSlug, 1);
  const totalPagesAvailable = Number(firstPage?.totalPages ?? 1);
  const pagesToFetch = MAX_PAGES ? Math.min(totalPagesAvailable, MAX_PAGES) : totalPagesAvailable;
  const pages = [firstPage];
  for (let page = 2; page <= pagesToFetch; page += 1) {
    if (DELAY_MS > 0) await sleep(DELAY_MS);
    pages.push(await fetchBrandPage(brandSlug, page));
  }
  return {
    totalPagesAvailable,
    totalPagesFetched: pagesToFetch,
    products: pages.flatMap((page) => (Array.isArray(page?.products) ? page.products : [])),
  };
};

const summarizeStatusCounts = (records) =>
  records.reduce(
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

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Missing Brand RapidAPI Wave",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- targetBrands: ${report.inputs.targetBrands.join(", ")}`,
    `- fetchedBrands: ${report.summary.fetchedBrands}`,
    `- blockedBrands: ${report.summary.blockedBrands}`,
    `- totalProducts: ${report.summary.totalProducts}`,
    `- full_overlay_ready: ${report.summary.statusCounts.full_overlay_ready}`,
    `- partial_overlay: ${report.summary.statusCounts.partial_overlay}`,
    `- catalog_only: ${report.summary.statusCounts.catalog_only}`,
    `- conflicted_or_non_us: ${report.summary.statusCounts.conflicted_or_non_us}`,
    "",
    "## Brand Results",
    "",
  ];

  for (const row of report.brandResults) {
    lines.push(
      `- ${row.brandName}: status=${row.status}, slug=${row.brandSlug || "n/a"}, products=${row.products}, pages=${row.totalPagesFetched}/${row.totalPagesAvailable}, full=${row.statusCounts?.full_overlay_ready ?? 0}, partial=${row.statusCounts?.partial_overlay ?? 0}`,
    );
    if (row.note) lines.push(`  - note: ${row.note}`);
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const brandMapPayload = await readJson(BRAND_MAP_PATH);
  const brandMap = new Map(
    (Array.isArray(brandMapPayload?.brands) ? brandMapPayload.brands : []).map((row) => [
      normalizeText(row?.brandName).toLowerCase(),
      row,
    ]),
  );

  const brandResults = [];
  const rawBrandFetches = [];
  const overlayRecords = [];

  for (const brandName of TARGET_BRANDS) {
    const brandEntry = brandMap.get(brandName.toLowerCase()) ?? null;
    if (!brandEntry || brandEntry.status !== "available" || !brandEntry.brandSlug) {
      brandResults.push({
        brandName,
        brandSlug: brandEntry?.brandSlug ?? null,
        status: "blocked",
        note: brandEntry?.note ?? "No usable RapidAPI brand slug is configured.",
        totalPagesAvailable: 0,
        totalPagesFetched: 0,
        products: 0,
        statusCounts: {
          full_overlay_ready: 0,
          partial_overlay: 0,
          catalog_only: 0,
          conflicted_or_non_us: 0,
        },
      });
      continue;
    }

    console.error(`[iherb-missing-brand-wave] fetching ${brandName} via ${brandEntry.brandSlug}`);
    const fetched = await fetchAllBrandProducts(brandEntry.brandSlug);
    rawBrandFetches.push({
      brandName,
      brandSlug: brandEntry.brandSlug,
      ...fetched,
    });

    const brandRecords = fetched.products.map((row) => {
      const record = extractOverlayRecordFromZipRow(row, {
        entryName: `rapidapi:${brandEntry.brandSlug}:missing_brand_wave`,
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
    overlayRecords.push(...brandRecords);

    brandResults.push({
      brandName,
      brandSlug: brandEntry.brandSlug,
      status: "completed",
      note: null,
      totalPagesAvailable: fetched.totalPagesAvailable,
      totalPagesFetched: fetched.totalPagesFetched,
      products: fetched.products.length,
      statusCounts: summarizeStatusCounts(brandRecords),
    });
  }

  const statusCounts = summarizeStatusCounts(overlayRecords);
  const generatedAt = new Date().toISOString();
  const stagingPayload = {
    schemaVersion: "iherb_missing_brand_rapidapi_wave.v1",
    generatedAt,
    products: overlayRecords,
  };
  const report = {
    schemaVersion: "iherb_missing_brand_rapidapi_wave_report.v1",
    generatedAt,
    inputs: {
      brandMapPath: BRAND_MAP_PATH,
      targetBrands: TARGET_BRANDS,
      maxPages: MAX_PAGES,
      delayMs: DELAY_MS,
      runMerge: RUN_MERGE,
      applyMerge: APPLY_MERGE,
    },
    summary: {
      fetchedBrands: brandResults.filter((row) => row.status === "completed").length,
      blockedBrands: brandResults.filter((row) => row.status === "blocked").length,
      totalProducts: overlayRecords.length,
      statusCounts,
    },
    brandResults,
  };

  const rawFetchesPath = path.join(OUT_DIR, "raw_brand_fetches.json");
  const stagingPath = path.join(OUT_DIR, "staging_products.rapidapi_missing_brand_wave.json");
  const reportJsonPath = path.join(OUT_DIR, "rapidapi_missing_brand_wave_report.json");
  const reportMdPath = path.join(OUT_DIR, "rapidapi_missing_brand_wave_report.md");

  await writeJson(rawFetchesPath, {
    schemaVersion: "iherb_missing_brand_rapidapi_raw_fetches.v1",
    generatedAt,
    brands: rawBrandFetches,
  });
  await writeJson(stagingPath, stagingPayload);
  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, toMarkdown(report));

  if (RUN_MERGE) {
    const mergeArgs = [
      path.join(ROOT, "scripts", "maintainer", "merge-iherb-overlay-bulk-to-supabase.mjs"),
      "--input-json",
      stagingPath,
      "--out-dir",
      path.join(OUT_DIR, "merge_report"),
      "--owner",
      "maintainer-rapidapi-missing-brand-wave",
    ];
    if (APPLY_MERGE) mergeArgs.push("--apply");
    await runNodeScript(mergeArgs[0], mergeArgs.slice(1));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          rawFetches: rawFetchesPath,
          staging: stagingPath,
          reportJson: reportJsonPath,
          reportMd: reportMdPath,
          mergeReportDir: RUN_MERGE ? path.join(OUT_DIR, "merge_report") : null,
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
