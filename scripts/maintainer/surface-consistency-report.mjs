#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/surface-consistency-report.mjs [options]

Options:
  --api-base-url <url>   API base URL (default: API_BASE_URL or http://127.0.0.1:3001)
  --out-dir <path>       Output directory (default: output/maintainer-gates/<timestamp>)
  --lookback-hours <n>   Scan lookback window in hours (default: 48)
  --sample-size <n>      Unique barcodes sampled (default: 25)
  --sse-timeout-ms <n>   Total timeout for one enrich-stream probe (default: 15000)
  --sse-read-chunk-timeout-ms <n>  Per-read timeout while consuming SSE (default: 2000)
  --enforce              Exit non-zero when consistency checks fail
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const apiBaseUrl = (getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outPath = path.join(outDir, "surface_consistency_report.json");
const lookbackHoursRaw = Number(getArg("lookback-hours") || process.env.SURFACE_CONSISTENCY_LOOKBACK_HOURS || 48);
const sampleSizeRaw = Number(getArg("sample-size") || process.env.SURFACE_CONSISTENCY_SAMPLE_SIZE || 25);
const sseTimeoutMsRaw = Number(getArg("sse-timeout-ms") || process.env.SURFACE_CONSISTENCY_SSE_TIMEOUT_MS || 15000);
const sseReadChunkTimeoutMsRaw = Number(
  getArg("sse-read-chunk-timeout-ms") || process.env.SURFACE_CONSISTENCY_SSE_READ_CHUNK_TIMEOUT_MS || 2000,
);
const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0 ? lookbackHoursRaw : 48;
const sampleSize = Number.isFinite(sampleSizeRaw) && sampleSizeRaw > 0 ? Math.floor(sampleSizeRaw) : 25;
const sseTimeoutMs = Number.isFinite(sseTimeoutMsRaw) && sseTimeoutMsRaw > 0 ? Math.floor(sseTimeoutMsRaw) : 15000;
const sseReadChunkTimeoutMs =
  Number.isFinite(sseReadChunkTimeoutMsRaw) && sseReadChunkTimeoutMsRaw > 0
    ? Math.floor(sseReadChunkTimeoutMsRaw)
    : 2000;
const enrichStreamMode = String(process.env.ENRICH_STREAM_GATE_STREAM_MODE || "analysis_bundle_only").trim();
const enforce = hasFlag("enforce");

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("[surface-consistency-report] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const commonHeaders = regressionToken
  ? { "x-regression-token": regressionToken }
  : { "x-auth-disabled": "1" };

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();

const toVerificationStatus = (params) => {
  const dataset = String(params.sourceDataset ?? "unknown").trim().toLowerCase();
  const authoritative = dataset === "lnhpd" || dataset === "dsld" || dataset === "label_record";
  if (params.pending === true) return "pending";
  if (authoritative) {
    if (params.final === true) return "final";
    if (params.likely === true) return "likely";
    return "pending";
  }
  if (params.final === true || params.likely === true) return "web_only";
  return "pending";
};

const mapIdentityTypeToDataset = (identityType) => {
  const type = String(identityType ?? "").trim();
  if (type === "npn") return "lnhpd";
  if (type === "dsldLabelId") return "dsld";
  if (type === "webCanonicalId") return "web";
  return "unknown";
};

const fetchMetadata = async (barcode) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/barcode-metadata?barcode=${encodeURIComponent(barcode)}`, {
      method: "GET",
      headers: commonHeaders,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const parseSse = async (barcode) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), sseTimeoutMs);
  const deadlineAt = Date.now() + sseTimeoutMs;
  const readWithDeadline = async (reader) => {
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    const timeoutMs = Math.min(remainingMs, sseReadChunkTimeoutMs);
    let timeoutId = null;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("sse_read_timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...commonHeaders,
      },
      body: JSON.stringify({
        barcode,
        streamMode: enrichStreamMode,
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines = [];
    let latestBundle = null;
    let donePayload = null;
    let errorPayload = null;

    const flush = () => {
      if (!dataLines.length) return;
      const dataRaw = dataLines.join("\n");
      dataLines = [];
      let payload = null;
      try {
        payload = JSON.parse(dataRaw);
      } catch {
        payload = null;
      }
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        latestBundle = payload;
      } else if (currentEvent === "done") {
        donePayload = payload;
      } else if (currentEvent === "error") {
        errorPayload = payload;
      }
      currentEvent = "message";
    };

    while (true) {
      const { done, value } = await readWithDeadline(reader);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
    flush();
    return { latestBundle, donePayload, errorPayload };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchEnsureOverview = async ({ barcode, productName, brandName }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/ensure-overview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...commonHeaders,
      },
      body: JSON.stringify({
        barcode,
        productName: productName || "Unknown Product",
        brandName: brandName || null,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const deriveScanView = (scanSse) => {
  const meta = scanSse?.latestBundle?.meta && typeof scanSse.latestBundle.meta === "object"
    ? scanSse.latestBundle.meta
    : {};
  const sourceType = String(meta?.sourceType ?? "").trim().toLowerCase();
  const sourceDataset = sourceType === "lnhpd" || sourceType === "dsld" || sourceType === "web"
    ? sourceType
    : "unknown";
  const sourceTypeFinal = meta?.sourceTypeFinal === true;
  const deterministicSignals =
    meta?.deterministicSignals && typeof meta.deterministicSignals === "object"
      ? meta.deterministicSignals
      : {};
  const coverRows = Array.isArray(scanSse?.latestBundle?.sections?.ingredients?.cover?.items)
    ? scanSse.latestBundle.sections.ingredients.cover.items
    : [];
  const coverDoseCount = coverRows.filter((row) => String(row?.dose ?? "").trim().length > 0).length;
  const rawIngredientCount = Number(deterministicSignals?.ingredientCount ?? Number.NaN);
  const rawDoseCount = Number(deterministicSignals?.doseCount ?? Number.NaN);
  const scanStrictIngredientCount = coverRows.length;
  const scanStrictDoseCount = coverDoseCount;
  const scanInferredIngredientCount = Number.isFinite(rawIngredientCount)
    ? rawIngredientCount
    : scanStrictIngredientCount;
  const scanInferredDoseCount = Number.isFinite(rawDoseCount)
    ? rawDoseCount
    : scanStrictDoseCount;

  return {
    sourceDataset,
    verificationStatus: toVerificationStatus({
      sourceDataset,
      final: sourceTypeFinal,
      likely: Boolean(sourceType),
    }),
    ingredientCount: scanStrictIngredientCount > 0 ? scanStrictIngredientCount : 0,
    doseCount: scanStrictDoseCount > 0 ? scanStrictDoseCount : 0,
    scanStrictIngredientCount: scanStrictIngredientCount > 0 ? scanStrictIngredientCount : 0,
    scanStrictDoseCount: scanStrictDoseCount > 0 ? scanStrictDoseCount : 0,
    scanInferredIngredientCount: scanInferredIngredientCount > 0 ? scanInferredIngredientCount : 0,
    scanInferredDoseCount: scanInferredDoseCount > 0 ? scanInferredDoseCount : 0,
  };
};

const computeMySupplementDoseCounts = (facts) => {
  const factsActives = Array.isArray(facts?.actives) ? facts.actives : [];
  const activeDoseCount = factsActives.filter(
    (row) => {
      const amount = Number(row?.amount);
      const hasPositiveAmount = Number.isFinite(amount) && amount > 0;
      const hasAmountText = String(row?.amountText ?? "").trim().length > 0;
      return hasPositiveAmount || hasAmountText;
    },
  ).length;

  const rawDirections = typeof facts?.directions?.rawText === "string"
    ? facts.directions.rawText.trim()
    : "";
  const parsedDirections =
    facts?.directions?.parsed && typeof facts.directions.parsed === "object"
      ? facts.directions.parsed
      : null;
  const perDoseCount = Number(parsedDirections?.perDoseCount ?? Number.NaN);
  const timesPerDay = Number(parsedDirections?.timesPerDay ?? Number.NaN);
  const hasTimingHints =
    Array.isArray(parsedDirections?.timingHints)
    && parsedDirections.timingHints.some((hint) => typeof hint === "string" && hint.trim().length > 0);
  const hasDirectionDoseSignal =
    rawDirections.length > 0
    || (Number.isFinite(perDoseCount) && perDoseCount > 0)
    || (Number.isFinite(timesPerDay) && timesPerDay > 0)
    || hasTimingHints
    || (typeof parsedDirections?.countUnit === "string" && parsedDirections.countUnit.trim().length > 0);
  const directionDoseCount = hasDirectionDoseSignal ? 1 : 0;
  const activePresenceDoseFloor = factsActives.length > 0 ? 1 : 0;

  return {
    strict: activeDoseCount > 0 ? activeDoseCount : 0,
    inferred: Math.max(activeDoseCount, directionDoseCount, activePresenceDoseFloor),
  };
};

const deriveMySupplementView = (metadata, ensureOverview) => {
  const identityTypeRaw = ensureOverview?.facts?.identity?.type ?? null;
  const identityValueRaw = normalizeDigits(ensureOverview?.facts?.identity?.value ?? "");
  const identityType =
    identityTypeRaw === "npn" && identityValueRaw.length !== 8
      ? null
      : identityTypeRaw;
  const factsStatus = String(ensureOverview?.factsStatus ?? "").toLowerCase();
  const factsActives = Array.isArray(ensureOverview?.facts?.actives) ? ensureOverview.facts.actives : [];
  const doseCounts = computeMySupplementDoseCounts(ensureOverview?.facts);

  const metadataDataset =
    metadata?.npn
      ? "lnhpd"
      : metadata?.dsldLabelId
        ? "dsld"
        : "unknown";

  const sourceDataset = identityType ? mapIdentityTypeToDataset(identityType) : metadataDataset;
  const metadataHasAuthoritativeIdentity = Boolean(metadata?.npn || metadata?.dsldLabelId);
  const verificationStatus = toVerificationStatus({
    sourceDataset,
    final: factsStatus === "full" || (metadata?.status === "ok" && metadataHasAuthoritativeIdentity),
    likely: factsStatus === "partial" || (metadata?.status === "ok" && !metadataHasAuthoritativeIdentity),
  });

  return {
    sourceDataset,
    verificationStatus,
    ingredientCount: factsActives.length,
    // strict dose count mirrors scan strict semantics: explicit per-ingredient dose fields only.
    doseCount: doseCounts.strict,
    mySupplementStrictDoseCount: doseCounts.strict,
    mySupplementInferredDoseCount: doseCounts.inferred > 0 ? doseCounts.inferred : 0,
  };
};

const isCountContradiction = (a, b) => (a === 0 && b > 0) || (a > 0 && b === 0);

const classifyDatasetVerificationBucket = ({ scan, mySupplement }) =>
  `scan:${scan.sourceDataset}/${scan.verificationStatus}->mysupp:${mySupplement.sourceDataset}/${mySupplement.verificationStatus}`;

const classifyDoseCountBucket = (scanDoseCount, mySupplementDoseCount) => {
  if (scanDoseCount === 0 && mySupplementDoseCount > 0) return "A_scan_zero_mysupp_positive";
  if (scanDoseCount > 0 && mySupplementDoseCount === 0) return "B_scan_positive_mysupp_zero";
  if (scanDoseCount > 0 && mySupplementDoseCount > 0 && scanDoseCount !== mySupplementDoseCount) {
    return "C_both_positive_value_diff";
  }
  return null;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("barcode_scans")
    .select("barcode_gtin14,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(Math.max(sampleSize * 6, 100));
  if (error) throw new Error(`barcode_scans_query_failed: ${error.message}`);

  const barcodes = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    const gtin = normalizeDigits(row?.barcode_gtin14);
    if (gtin.length !== 14) continue;
    if (seen.has(gtin)) continue;
    seen.add(gtin);
    barcodes.push(gtin);
    if (barcodes.length >= sampleSize) break;
  }

  const comparedRows = [];
  let sourceDatasetMismatchCount = 0;
  let verificationStatusMismatchCount = 0;
  let ingredientCountContradictionCount = 0;
  let doseCountContradictionCount = 0;
  let ingredientCountInferredOnlyContradictionCount = 0;
  let doseCountInferredOnlyContradictionCount = 0;
  const datasetVerificationBucketCounts = {};
  const datasetVerificationBucketBarcodes = {};
  const doseCountBucketCounts = {
    A_scan_zero_mysupp_positive: 0,
    B_scan_positive_mysupp_zero: 0,
    C_both_positive_value_diff: 0,
  };
  const doseCountBucketBarcodes = {
    A_scan_zero_mysupp_positive: [],
    B_scan_positive_mysupp_zero: [],
    C_both_positive_value_diff: [],
  };
  const inferredOnlyContradictionRows = [];

  for (const barcode of barcodes) {
    const metadata = await fetchMetadata(barcode);
    const scanSse = await parseSse(barcode);
    const ensureOverview = await fetchEnsureOverview({
      barcode,
      productName: metadata?.productInfo?.name ?? null,
      brandName: metadata?.productInfo?.brand ?? null,
    });

    const scan = deriveScanView(scanSse);
    const mySupplement = deriveMySupplementView(metadata, ensureOverview);

    const sourceDatasetMismatch =
      scan.sourceDataset !== "unknown"
      && mySupplement.sourceDataset !== "unknown"
      && scan.sourceDataset !== mySupplement.sourceDataset;
    const verificationStatusMismatch = scan.verificationStatus !== mySupplement.verificationStatus;
    const eligibleForCountComparison =
      scan.verificationStatus === "final" && mySupplement.verificationStatus === "final";
    const ingredientCountContradiction =
      eligibleForCountComparison
      && isCountContradiction(scan.scanStrictIngredientCount, mySupplement.ingredientCount);
    const doseCountContradiction =
      eligibleForCountComparison
      && isCountContradiction(scan.scanStrictDoseCount, mySupplement.doseCount);
    const ingredientCountInferredOnlyContradiction =
      eligibleForCountComparison
      && !ingredientCountContradiction
      && isCountContradiction(scan.scanInferredIngredientCount, mySupplement.ingredientCount);
    const doseCountInferredOnlyContradiction =
      eligibleForCountComparison
      && !doseCountContradiction
      && isCountContradiction(scan.scanInferredDoseCount, mySupplement.mySupplementInferredDoseCount);
    const doseCountBucket = eligibleForCountComparison
      ? classifyDoseCountBucket(scan.scanStrictDoseCount, mySupplement.doseCount)
      : null;
    const datasetVerificationBucket =
      sourceDatasetMismatch || verificationStatusMismatch
        ? classifyDatasetVerificationBucket({ scan, mySupplement })
        : null;

    if (sourceDatasetMismatch) sourceDatasetMismatchCount += 1;
    if (verificationStatusMismatch) verificationStatusMismatchCount += 1;
    if (ingredientCountContradiction) ingredientCountContradictionCount += 1;
    if (doseCountContradiction) doseCountContradictionCount += 1;
    if (ingredientCountInferredOnlyContradiction) ingredientCountInferredOnlyContradictionCount += 1;
    if (doseCountInferredOnlyContradiction) doseCountInferredOnlyContradictionCount += 1;
    if (datasetVerificationBucket) {
      datasetVerificationBucketCounts[datasetVerificationBucket] =
        (datasetVerificationBucketCounts[datasetVerificationBucket] ?? 0) + 1;
      const existing = datasetVerificationBucketBarcodes[datasetVerificationBucket] ?? [];
      if (!existing.includes(barcode)) existing.push(barcode);
      datasetVerificationBucketBarcodes[datasetVerificationBucket] = existing;
    }
    if (doseCountBucket) {
      doseCountBucketCounts[doseCountBucket] += 1;
      if (!doseCountBucketBarcodes[doseCountBucket].includes(barcode)) {
        doseCountBucketBarcodes[doseCountBucket].push(barcode);
      }
    }
    if (ingredientCountInferredOnlyContradiction || doseCountInferredOnlyContradiction) {
      inferredOnlyContradictionRows.push({
        barcode,
        scanStrictIngredientCount: scan.scanStrictIngredientCount,
        scanStrictDoseCount: scan.scanStrictDoseCount,
        scanInferredIngredientCount: scan.scanInferredIngredientCount,
        scanInferredDoseCount: scan.scanInferredDoseCount,
        mySupplementIngredientCount: mySupplement.ingredientCount,
        mySupplementDoseCount: mySupplement.doseCount,
        ingredientCountInferredOnlyContradiction,
        doseCountInferredOnlyContradiction,
      });
    }

    comparedRows.push({
      barcode,
      scan,
      mySupplement,
      mismatch: {
        sourceDatasetMismatch,
        verificationStatusMismatch,
        datasetVerificationBucket,
        eligibleForCountComparison,
        ingredientCountContradiction,
        doseCountContradiction,
        ingredientCountInferredOnlyContradiction,
        doseCountInferredOnlyContradiction,
        doseCountBucket,
      },
    });
  }

  const mismatchRows = comparedRows
    .filter(
      (row) =>
        row.mismatch.sourceDatasetMismatch
        || row.mismatch.verificationStatusMismatch
        || row.mismatch.ingredientCountContradiction
        || row.mismatch.doseCountContradiction,
    )
    .map((row) => ({
      barcode: row.barcode,
      datasetVerificationBucket: row.mismatch.datasetVerificationBucket,
      doseCountBucket: row.mismatch.doseCountBucket,
      scan: row.scan,
      mySupplement: row.mySupplement,
      mismatch: row.mismatch,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    lookbackHours,
    sampleSize,
    comparedCount: comparedRows.length,
    sourceDatasetMismatchCount,
    verificationStatusMismatchCount,
    ingredientCountContradictionCount,
    doseCountContradictionCount,
    ingredientCountInferredOnlyContradictionCount,
    doseCountInferredOnlyContradictionCount,
    datasetVerificationBucketCounts,
    datasetVerificationBucketBarcodes,
    doseCountBucketCounts,
    doseCountBucketBarcodes,
    inferredOnlyContradictionRows,
    pass:
      sourceDatasetMismatchCount === 0
      && verificationStatusMismatchCount === 0
      && ingredientCountContradictionCount === 0
      && doseCountContradictionCount === 0,
    mismatchRows,
    rows: comparedRows,
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[surface-consistency-report] wrote ${outPath}`);
  if (enforce && !report.pass) {
    console.error(
      `[surface-consistency-report] mismatches detected: sourceDataset=${sourceDatasetMismatchCount} verificationStatus=${verificationStatusMismatchCount} ingredientCount=${ingredientCountContradictionCount} doseCount=${doseCountContradictionCount}`,
    );
    process.exit(1);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[surface-consistency-report] failed", message);
  process.exit(1);
});
