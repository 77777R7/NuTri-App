#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { decideOfficialFetchPolicy } from "./lib/official-fetch-policy.mjs";
import { fetchViaScrapling } from "./lib/scrapling-fetcher.mjs";
import {
  buildOverlayCandidateFromScrapling,
  normalizeScraplingResult,
} from "./lib/scrapling-normalizers.mjs";
import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const CONFIG_PATH = getArg("config-json", null);

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const toArray = (value) => (Array.isArray(value) ? value : []);
const toStringSet = (value) =>
  new Set(toArray(value).map((entry) => normalizeText(entry)).filter(Boolean));

const isOfficialProductUrl = (value) => {
  const url = String(value ?? "").toLowerCase();
  return (
    /^https?:\/\/(www\.)?codeage\.com\/products\//i.test(url) ||
    /^https?:\/\/(www\.)?pureencapsulationspro\.com\/.+\.html(?:[?#].*)?$/i.test(url) ||
    /^https?:\/\/smartq\.pureforyou\.com\/products\//i.test(url) ||
    /^https?:\/\/www\.atriumpro\.ca\//i.test(url) ||
    /\/products?\//i.test(url)
  );
};

const isIherbProductUrl = (value) => {
  const url = String(value ?? "").toLowerCase();
  return /^https?:\/\/([a-z0-9-]+\.)?(?:ca\.)?iherb\.com\/pr\//i.test(url);
};

const rankKnownUrl = (value, sourcePreference = "auto") => {
  const url = String(value ?? "").toLowerCase();
  if (!/^https?:\/\//i.test(url)) return 999;
  if (sourcePreference === "official") {
    if (isOfficialProductUrl(url)) return 0;
    return 999;
  }
  if (sourcePreference === "smartq") {
    if (/^https?:\/\/smartq\.pureforyou\.com\/products\//i.test(url)) return 0;
    return 999;
  }
  if (sourcePreference === "official-browser") {
    if (/^https?:\/\/smartq\.pureforyou\.com\/products\//i.test(url)) return 0;
    if (/^https?:\/\/(www\.)?pureencapsulationspro\.com\/.+\.html(?:[?#].*)?$/i.test(url)) return 1;
    if (/^https?:\/\/(www\.)?pureencapsulationspro\.com\/sitemap(?:[/?#].*)?$/i.test(url)) return 2;
    if (isOfficialProductUrl(url)) return 3;
    return 999;
  }
  if (sourcePreference === "atriumpro") {
    if (/^https?:\/\/www\.atriumpro\.ca\//i.test(url)) return 0;
    return 999;
  }
  if (sourcePreference === "iherb") {
    if (isIherbProductUrl(url)) return 0;
    return 999;
  }
  if (/^https?:\/\/([a-z0-9-]+\.)?iherb\.com\/pr\//i.test(url)) return 0;
  if (/^https?:\/\/([a-z0-9-]+\.)?ca\.iherb\.com\/pr\//i.test(url)) return 1;
  if (/^https?:\/\/([^/]+\.)?iherb\.com\//i.test(url)) return 2;
  if (isOfficialProductUrl(url)) return 3;
  if (/\/products?\//i.test(url)) return 3;
  if (/\/pr\//i.test(url)) return 4;
  return 10;
};

const chooseBestKnownUrl = (values, sourcePreference = "auto") =>
  [...new Set((Array.isArray(values) ? values : []).filter((value) => /^https?:\/\//i.test(String(value ?? ""))))]
    .sort((left, right) => rankKnownUrl(left, sourcePreference) - rankKnownUrl(right, sourcePreference))
    .filter((value) => rankKnownUrl(value, sourcePreference) < 999);

const isStaleKnownUrlResult = (normalized) => {
  const title = normalizeText(normalized?.title ?? null).toLowerCase();
  const bodyText = normalizeText(normalized?.bodyText ?? null).toLowerCase();
  const finalUrl = normalizeText(normalized?.finalUrl ?? normalized?.pageUrl ?? null).toLowerCase();
  return (
    title === "the page is not found!" ||
    title.includes("page not found") ||
    bodyText.includes("the page is not found") ||
    bodyText.includes("404 not found") ||
    /\/404(?:[/?#]|$)/.test(finalUrl)
  );
};

const buildStagingIndex = (rows) => {
  const byProductId = new Map();
  const byBarcode = new Map();
  for (const row of rows) {
    const productId = normalizeText(row?.productId ?? null);
    const barcode = normalizeText(row?.barcode_gtin14 ?? row?.barcode ?? null);
    if (productId) byProductId.set(productId, row);
    if (barcode) byBarcode.set(barcode, row);
  }
  return { byProductId, byBarcode };
};

const getKnownUrls = (row, queueEntry, sourcePreference = "auto") => {
  const urls = [];
  urls.push(...toArray(row?.sourceSummary?.sourceUrls));
  if (row?.link) urls.push(row.link);
  urls.push(...toArray(queueEntry?.knownProductUrls));
  return chooseBestKnownUrl(urls, sourcePreference);
};

const main = async () => {
  const config = CONFIG_PATH ? await readJson(path.resolve(ROOT, CONFIG_PATH)) : {};
  const stagingPath = getArg("staging-json", config.stagingPath ?? path.join(ROOT, "output", "iherb_overlay_staging", "staging_products.json"));
  const queuePath = getArg("queue-json", config.queuePath ?? path.join(ROOT, "output", "iherb_overlay_execution_plan_full", "active_priority_queue.json"));
  const outDir = getArg("out-dir", config.outDir ?? path.join(ROOT, "output", `scrapling_official_fallback_wave_${Date.now()}`));
  const brandFilter = normalizeText(getArg("brand", config.brandFilter ?? ""));
  const limit = Number(getArg("limit", String(config.limit ?? 10))) || 10;
  const execute = getArg("execute", String(config.execute ?? "false")) === "true";
  const scraplingMode = normalizeText(getArg("mode", config.scraplingMode ?? "plain")).toLowerCase() || "plain";
  const sourcePreference = normalizeText(getArg("source-preference", config.sourcePreference ?? "auto")).toLowerCase() || "auto";
  const includeProductIds = toStringSet(config.includeProductIds);
  const excludeProductIds = toStringSet(config.excludeProductIds);

  const stagingRaw = await readJson(path.resolve(ROOT, stagingPath));
  const queue = await readJson(path.resolve(ROOT, queuePath));
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (stagingRaw.products ?? []);
  const index = buildStagingIndex(stagingRows);

  const selected = [];
  for (const entry of queue) {
    if (brandFilter && normalizeText(entry?.brandName).toLowerCase() !== brandFilter.toLowerCase()) {
      continue;
    }
    const productId = normalizeText(entry?.productId ?? null);
    const barcode = normalizeText(entry?.barcode_gtin14 ?? null);
    if (includeProductIds.size > 0 && !includeProductIds.has(productId)) {
      continue;
    }
    if (productId && excludeProductIds.has(productId)) {
      continue;
    }
    const staged =
      (productId && index.byProductId.get(productId)) ||
      (barcode && index.byBarcode.get(barcode)) ||
      null;
    const knownProductUrls = getKnownUrls(staged, entry, sourcePreference);
    const policy = decideOfficialFetchPolicy({
      knownProductUrls,
      coreMissingFields: entry?.coreMissingFields,
      sourceTypes: entry?.sourceTypes,
      hasUsIherbPage: entry?.hasUsIherbPage,
      highConfidenceUsProductPageReady: entry?.highConfidenceUsProductPageReady,
    });
    if (!knownProductUrls.length) continue;
    if (policy.mode === "manual_only" || policy.mode === "reader_only") continue;
    selected.push({
      entry,
      staged,
      knownProductUrls,
      policy,
    });
    if (selected.length >= limit) break;
  }

  const results = [];
  for (const item of selected) {
    const targetUrl = item.knownProductUrls[0];
    const base = {
      productId: item.entry?.productId ?? null,
      barcode_gtin14: item.entry?.barcode_gtin14 ?? null,
      brandName: item.entry?.brandName ?? null,
      title: item.entry?.title ?? null,
      targetUrl,
      recommendedMode: item.policy.mode,
      policyReasons: item.policy.reasons,
      executeAttempted: execute,
    };
    if (!execute) {
      results.push({ ...base, outcome: "planned_only" });
      continue;
    }
    try {
      const raw = await fetchViaScrapling({
        url: targetUrl,
        productId: item.entry?.productId ?? null,
        title: item.entry?.title ?? null,
        brandName: item.entry?.brandName ?? null,
        mode: scraplingMode,
      });
      if (!raw?.ok) {
        results.push({ ...base, outcome: raw?.errorCode ?? "scrapling_failed", raw });
        continue;
      }
      const normalized = normalizeScraplingResult(raw);
      if (isStaleKnownUrlResult(normalized)) {
        results.push({
          ...base,
          outcome: "stale_known_url",
          pageUrl: normalized.finalUrl ?? normalized.pageUrl ?? targetUrl,
          title: normalized.title ?? null,
          extractionWarnings: normalized.sourceDiagnostics?.extractionWarnings ?? [],
        });
        continue;
      }
      const candidate = buildOverlayCandidateFromScrapling({
        normalizedResult: normalized,
        queueEntry: item.entry,
        brandName: item.entry?.brandName,
      });
      results.push({
        ...base,
        outcome: "scrapling_candidate_built",
        pageUrl: normalized.finalUrl ?? normalized.pageUrl ?? targetUrl,
        sectionKeys: Object.keys(candidate.descriptionSections ?? {}),
        factRows: candidate.supplementFacts?.nutritionalFacts?.length ?? 0,
        hasPrimaryImage: Boolean(candidate.productCatalogImage),
        extractionWarnings: candidate.fetchDiagnostics?.extractionWarnings ?? [],
        candidate,
      });
    } catch (error) {
      results.push({
        ...base,
        outcome: "scrapling_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      configPath: CONFIG_PATH ? path.resolve(ROOT, CONFIG_PATH) : null,
      stagingPath: stagingPath,
      queuePath: queuePath,
      brandFilter: brandFilter || null,
      limit: limit,
      execute: execute,
      scraplingMode: scraplingMode,
      sourcePreference,
      includeProductIds: [...includeProductIds],
      excludeProductIds: [...excludeProductIds],
    },
    selectedCount: selected.length,
    results,
  };

  await fs.mkdir(path.resolve(ROOT, outDir), { recursive: true });
  await fs.writeFile(
    path.resolve(ROOT, outDir, "scrapling_official_fallback_report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`Wrote Scrapling wave report to ${path.resolve(ROOT, outDir, "scrapling_official_fallback_report.json")}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
