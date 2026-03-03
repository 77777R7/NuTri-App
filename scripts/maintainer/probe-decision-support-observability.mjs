#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const asNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const apiBaseUrl = String(
  getArg("api-base-url")
  || process.env.API_BASE_URL
  || process.env.RENDER_BASE_URL
  || "http://127.0.0.1:3001",
).replace(/\/$/, "");

const timeoutMs = Math.max(1000, asNumber(getArg("timeout-ms"), 8000));
const maxSamples = Math.max(1, Math.min(50, asNumber(getArg("max-samples"), 20)));
const viewMode = String(getArg("view-mode") || "simple").trim().toLowerCase() === "details"
  ? "details"
  : "simple";
const maxUnexpected409Rate = Math.max(0, asNumber(getArg("max-unexpected409-rate"), 0.001));
const minRetrySuccessRate = Math.min(1, Math.max(0, asNumber(getArg("min-retry-success-rate"), 0.99)));
const maxInlineFallbackRate = Math.max(0, asNumber(getArg("max-inline-fallback-rate"), 0.001));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const listFullStableDirs = async () => {
  const outputDir = path.join(ROOT_DIR, "output");
  const names = await fs.readdir(outputDir);
  return names
    .filter((name) => name.startsWith("v1.6.12-r2d-full-stable-"))
    .sort();
};

const resolveBulkSummaryPath = async () => {
  const argPath = getArg("bulk-summary");
  if (argPath) {
    return path.isAbsolute(argPath) ? argPath : path.join(ROOT_DIR, argPath);
  }
  const dirs = await listFullStableDirs();
  if (dirs.length === 0) {
    throw new Error("no_full_stable_output_found");
  }
  const latest = dirs[dirs.length - 1];
  return path.join(ROOT_DIR, "output", latest, "bulk-barcode-e2e", "summary.json");
};

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length === 12) return `00${digits}`;
  return null;
};

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-auth-disabled": "1",
      },
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      json,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      json: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
};

const buildEndpoint = ({ barcode, digest }) => {
  const params = new URLSearchParams();
  params.set("barcode", barcode);
  params.set("viewMode", viewMode);
  if (digest) params.set("digest", digest);
  return `${apiBaseUrl}/api/decision-support/v1?${params.toString()}`;
};

const main = async () => {
  const bulkSummaryPath = await resolveBulkSummaryPath();
  const bulkRows = await readJson(bulkSummaryPath);
  const rows = Array.isArray(bulkRows) ? bulkRows : [];

  const selected = [];
  const seen = new Set();
  for (const row of rows) {
    const barcode = toGtin14(row?.barcode);
    if (!barcode) continue;
    if (seen.has(barcode)) continue;
    seen.add(barcode);
    selected.push({
      barcode,
      sourceType: row?.sourceType ?? null,
      sourceTypeFinal: row?.sourceTypeFinal === true,
    });
    if (selected.length >= maxSamples) break;
  }

  const detailRows = [];
  let initialOkCount = 0;
  let stableDigestUnexpected409Count = 0;
  let forced409ContractCount = 0;
  let forced409RetrySuccessCount = 0;
  let forced409RetryFailureCount = 0;
  const unexpected409Barcodes = [];
  const retryFailureBarcodes = [];
  const inlineFallbackProxyBarcodes = [];

  for (const row of selected) {
    const initial = await fetchJson(buildEndpoint({ barcode: row.barcode, digest: null }));
    const digest = typeof initial?.json?.digest === "string" ? initial.json.digest : null;
    if (initial.ok && digest) initialOkCount += 1;

    let stableRead = null;
    if (digest) {
      stableRead = await fetchJson(buildEndpoint({ barcode: row.barcode, digest }));
      if (stableRead.status === 409) {
        stableDigestUnexpected409Count += 1;
        unexpected409Barcodes.push(row.barcode);
      }
    }

    let forcedMismatch = null;
    let forcedRetry = null;
    if (digest) {
      forcedMismatch = await fetchJson(buildEndpoint({ barcode: row.barcode, digest: `${digest}-stale` }));
      const latestDigest = typeof forcedMismatch?.json?.latestDigest === "string"
        ? forcedMismatch.json.latestDigest
        : null;
      if (forcedMismatch.status === 409 && latestDigest) {
        forced409ContractCount += 1;
        forcedRetry = await fetchJson(buildEndpoint({ barcode: row.barcode, digest: latestDigest }));
        if (forcedRetry.ok) forced409RetrySuccessCount += 1;
        else {
          forced409RetryFailureCount += 1;
          retryFailureBarcodes.push(row.barcode);
        }
      }
    }

    if (!initial.ok || (forcedMismatch?.status === 409 && forcedRetry && !forcedRetry.ok)) {
      inlineFallbackProxyBarcodes.push(row.barcode);
    }

    detailRows.push({
      ...row,
      initial,
      stableRead,
      forcedMismatch,
      forcedRetry,
    });
  }

  const sampleCount = selected.length;
  const initialErrorCount = sampleCount - initialOkCount;
  const stableDigestUnexpected409Rate = sampleCount > 0
    ? Number((stableDigestUnexpected409Count / sampleCount).toFixed(4))
    : null;
  const forced409RetrySuccessRate = forced409ContractCount > 0
    ? Number((forced409RetrySuccessCount / forced409ContractCount).toFixed(4))
    : null;
  const inlineFallbackProxyRate = sampleCount > 0
    ? Number(((initialErrorCount + forced409RetryFailureCount) / sampleCount).toFixed(4))
    : null;
  const metrics = {
    sampleCount,
    initialOkCount,
    initialErrorCount,
    initialErrorRate: sampleCount > 0 ? Number((initialErrorCount / sampleCount).toFixed(4)) : null,
    stableDigestUnexpected409Count,
    stableDigestUnexpected409Rate,
    forced409ContractCount,
    forced409ContractRate: sampleCount > 0 ? Number((forced409ContractCount / sampleCount).toFixed(4)) : null,
    forced409RetrySuccessCount,
    forced409RetryFailureCount,
    forced409RetrySuccessRate,
    inlineFallbackProxyRate,
  };

  const thresholds = {
    maxUnexpected409Rate,
    minRetrySuccessRate,
    maxInlineFallbackRate,
  };
  const breachMetrics = {
    stableDigestUnexpected409Rate:
      stableDigestUnexpected409Rate != null && stableDigestUnexpected409Rate > maxUnexpected409Rate,
    forced409RetrySuccessRate:
      forced409RetrySuccessRate != null && forced409RetrySuccessRate < minRetrySuccessRate,
    inlineFallbackProxyRate:
      inlineFallbackProxyRate != null && inlineFallbackProxyRate > maxInlineFallbackRate,
  };
  const breachBarcodeLists = {
    unexpected409: Array.from(new Set(unexpected409Barcodes)),
    retryFailure: Array.from(new Set(retryFailureBarcodes)),
    inlineFallbackProxy: Array.from(new Set(inlineFallbackProxyBarcodes)),
  };

  const output = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    viewMode,
    timeoutMs,
    maxSamples,
    bulkSummaryPath,
    thresholds,
    metrics,
    breachMetrics,
    breachBarcodeLists,
    rows: detailRows,
  };

  const outputArg = getArg("out");
  const outPath = outputArg
    ? (path.isAbsolute(outputArg) ? outputArg : path.join(ROOT_DIR, outputArg))
    : path.join(path.dirname(path.dirname(bulkSummaryPath)), "phase_a_decision_support_observability_report.json");
  await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(outPath);
  console.log(JSON.stringify(metrics, null, 2));
};

main().catch((error) => {
  console.error("[probe-decision-support-observability] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
