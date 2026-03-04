#!/usr/bin/env node
/* eslint-disable no-console */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const listOutputDirsByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_ROOT);
    return names.filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return [];
  }
};

const newestOutputDirByPrefix = async (prefix) => {
  const dirs = await listOutputDirsByPrefix(prefix);
  if (dirs.length === 0) return null;
  return path.join(OUTPUT_ROOT, dirs[dirs.length - 1]);
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();
const normalizeBrand = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normalizeCategory = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const asNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toRate = (count, total) => (total > 0 ? Number((count / total).toFixed(6)) : 0);

const buildHeaders = ({ regressionToken, bearerToken }) => {
  const headers = { Accept: "application/json" };
  if (regressionToken) headers["x-regression-token"] = regressionToken;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
};

const fetchJson = async (url, headers, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      raw: text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: { error: error instanceof Error ? error.message : String(error) },
      raw: "",
    };
  } finally {
    clearTimeout(timer);
  }
};

const patchStatusEndpoint = (apiBaseUrl) => `${apiBaseUrl.replace(/\/$/, "")}/api/patch-shadow/status`;
const decisionSupportEndpoint = (apiBaseUrl, barcode, viewMode) =>
  `${apiBaseUrl.replace(/\/$/, "")}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=${encodeURIComponent(viewMode)}`;

const laneHitCount = (statusJson, laneId) => asNumber(statusJson?.runtimePatchHitCountByLane?.[laneId], 0);

const takeUnique = (rows, limit, keyFn) => {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-d1-batch-isolation-proof] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.14-stage-e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const batchMetaPath = resolvePath(getArg("batch-candidates-meta"));
  const batchCandidatesPathArg = resolvePath(getArg("batch-candidates-jsonl"));

  if (!batchMetaPath && !batchCandidatesPathArg) {
    console.error("[run-stage-d1-batch-isolation-proof] provide --batch-candidates-meta or --batch-candidates-jsonl");
    process.exit(1);
  }

  const laneId = String(getArg("lane-id", "patch_directions_text_v1")).trim() || "patch_directions_text_v1";
  const hitThreshold = Math.max(0, Math.min(1, asNumber(getArg("hit-threshold"), 0.7)));
  const minPositives = Math.max(10, asNumber(getArg("min-positives"), 10));
  const maxPositives = Math.max(minPositives, asNumber(getArg("max-positives"), 20));
  const minNegatives = Math.max(10, asNumber(getArg("min-negatives"), 10));
  const timeoutMs = Math.max(2000, asNumber(getArg("timeout-ms"), 12000));
  const viewMode = "details";

  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "")).trim();
  if (!patchApiBaseUrl) {
    console.error("[run-stage-d1-batch-isolation-proof] missing --patch-api-base-url");
    process.exit(1);
  }

  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_D1_BEARER_TOKEN || "")).trim();
  const headers = buildHeaders({ regressionToken, bearerToken });

  const meta = batchMetaPath ? await readJson(batchMetaPath) : null;
  const batchCandidatesPath = batchCandidatesPathArg || resolvePath(meta?.candidatePath);
  if (!batchCandidatesPath) {
    console.error("[run-stage-d1-batch-isolation-proof] missing candidate path");
    process.exit(1);
  }

  const batchRowsRaw = await readJsonl(batchCandidatesPath);
  const batchRows = batchRowsRaw
    .filter((row) => String(row?.laneId ?? "") === laneId)
    .map((row) => ({
      ...row,
      barcode_gtin14: normalizeBarcode(row?.barcode_gtin14),
      identityKey: normalizeIdentity(row?.identityKey),
      brandNorm: normalizeBrand(row?.seedBrand || row?.brandName || row?.brandNorm),
      categoryNorm: normalizeCategory(row?.categoryBucket || row?.categoryName),
    }))
    .filter((row) => Boolean(row.barcode_gtin14) && Boolean(row.identityKey));

  if (batchRows.length < minPositives) {
    console.error(`[run-stage-d1-batch-isolation-proof] insufficient batch candidates ${batchRows.length} < ${minPositives}`);
    process.exit(1);
  }

  const positives = takeUnique(batchRows, maxPositives, (row) => `${row.identityKey}:${row.barcode_gtin14}`).map((row, idx) => ({
    sampleId: `positive_${String(idx + 1).padStart(2, "0")}`,
    laneId,
    patchBatchId: row.patchBatchId || meta?.patchBatchId || null,
    identityKey: row.identityKey,
    barcode_gtin14: row.barcode_gtin14,
    brandNorm: row.brandNorm,
    categoryNorm: row.categoryNorm,
  }));

  if (positives.length < minPositives) {
    console.error(`[run-stage-d1-batch-isolation-proof] insufficient positive sample count ${positives.length} < ${minPositives}`);
    process.exit(1);
  }

  const filteredCandidatesPath = resolvePath(getArg("filtered-candidates-jsonl"))
    || resolvePath(meta?.inputs?.filteredCandidatesPath)
    || path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl");
  const allRows = await readJsonl(filteredCandidatesPath);

  const batchBarcodes = new Set(batchRows.map((row) => row.barcode_gtin14));
  const batchIdentities = new Set(batchRows.map((row) => row.identityKey));
  const positiveBrands = new Set(positives.map((row) => row.brandNorm).filter(Boolean));
  const positiveCategories = new Set(positives.map((row) => row.categoryNorm).filter(Boolean));

  const normalizedAll = allRows
    .map((row) => ({
      barcode_gtin14: normalizeBarcode(row?.barcode_gtin14),
      identityKey: normalizeIdentity(row?.identityKey),
      laneId: String(row?.laneId ?? "").trim(),
      brandNorm: normalizeBrand(row?.seedBrand || row?.brandName || row?.brandNorm),
      categoryNorm: normalizeCategory(row?.categoryBucket || row?.categoryName),
    }))
    .filter((row) => Boolean(row.barcode_gtin14) && Boolean(row.identityKey))
    .filter((row) => !batchBarcodes.has(row.barcode_gtin14) && !batchIdentities.has(row.identityKey));

  const sameCategoryOutOfBatch = normalizedAll.filter((row) => positiveCategories.has(row.categoryNorm));
  const sameBrandOutOfBatch = normalizedAll.filter((row) => positiveBrands.has(row.brandNorm));
  const crossCategory = normalizedAll.filter((row) => !positiveCategories.has(row.categoryNorm));

  const negatives = [];
  const used = new Set();
  const addFromPool = (pool, label) => {
    for (const row of pool) {
      const key = `${row.identityKey}:${row.barcode_gtin14}`;
      if (used.has(key)) continue;
      used.add(key);
      negatives.push({
        sampleId: `negative_${String(negatives.length + 1).padStart(2, "0")}`,
        identityKey: row.identityKey,
        barcode_gtin14: row.barcode_gtin14,
        laneId: row.laneId,
        negativeBucket: label,
      });
      if (negatives.length >= minNegatives) return;
    }
  };

  addFromPool(sameCategoryOutOfBatch, "same_category_out_of_batch");
  if (negatives.length < minNegatives) addFromPool(sameBrandOutOfBatch, "same_brand_out_of_batch");
  if (negatives.length < minNegatives) addFromPool(crossCategory, "cross_category");
  if (negatives.length < minNegatives) {
    const scopeRows = await readJson(path.join(stageCDir, "c1a_top100_census", "brand_scope_products_top100.json"))
      .then((json) => Array.isArray(json?.rows) ? json.rows : (Array.isArray(json) ? json : []))
      .catch(() => []);
    const fallbackPool = scopeRows
      .map((row) => ({
        barcode_gtin14: normalizeBarcode(row?.barcodeGtIn14 || row?.barcode_gtin14),
        identityKey: normalizeIdentity(row?.identityKey),
        laneId: "scope_control",
        brandNorm: normalizeBrand(row?.seedBrandNorm || row?.seedBrand || row?.brandName),
        categoryNorm: normalizeCategory(row?.categoryBucket || row?.categoryName),
      }))
      .filter((row) => Boolean(row.barcode_gtin14) && Boolean(row.identityKey))
      .filter((row) => !batchBarcodes.has(row.barcode_gtin14) && !batchIdentities.has(row.identityKey));
    addFromPool(fallbackPool, "scope_fallback");
  }

  if (negatives.length < minNegatives) {
    console.error(`[run-stage-d1-batch-isolation-proof] insufficient negatives ${negatives.length} < ${minNegatives}`);
    process.exit(1);
  }

  const patchStatusUrl = patchStatusEndpoint(patchApiBaseUrl);
  const statusBeforeRun = await fetchJson(patchStatusUrl, headers, timeoutMs);

  const positiveRows = [];
  let inBatchHitCount = 0;
  for (const sample of positives) {
    const before = await fetchJson(patchStatusUrl, headers, timeoutMs);
    const dsResp = await fetchJson(decisionSupportEndpoint(patchApiBaseUrl, sample.barcode_gtin14, viewMode), headers, timeoutMs);
    const after = await fetchJson(patchStatusUrl, headers, timeoutMs);
    const hitDelta = laneHitCount(after?.json, laneId) - laneHitCount(before?.json, laneId);
    const sampleHit = hitDelta > 0;
    if (sampleHit) inBatchHitCount += 1;
    positiveRows.push({
      ...sample,
      decisionSupportStatus: dsResp.status,
      sampleHit,
      hitDelta,
      laneHitBefore: laneHitCount(before?.json, laneId),
      laneHitAfter: laneHitCount(after?.json, laneId),
      statusCandidatesHash: after?.json?.candidatesHash ?? null,
      statusCandidatesPath: after?.json?.candidatesPath ?? null,
      statusCandidateScopeId: after?.json?.candidateScopeId ?? null,
    });
  }

  const negativeRows = [];
  let outOfBatchFalseHits = 0;
  for (const sample of negatives) {
    const before = await fetchJson(patchStatusUrl, headers, timeoutMs);
    const dsResp = await fetchJson(decisionSupportEndpoint(patchApiBaseUrl, sample.barcode_gtin14, viewMode), headers, timeoutMs);
    const after = await fetchJson(patchStatusUrl, headers, timeoutMs);
    const hitDelta = laneHitCount(after?.json, laneId) - laneHitCount(before?.json, laneId);
    const falseHit = hitDelta > 0;
    if (falseHit) outOfBatchFalseHits += 1;
    negativeRows.push({
      ...sample,
      decisionSupportStatus: dsResp.status,
      falseHit,
      hitDelta,
      laneHitBefore: laneHitCount(before?.json, laneId),
      laneHitAfter: laneHitCount(after?.json, laneId),
    });
  }

  const statusAfterRun = await fetchJson(patchStatusUrl, headers, timeoutMs);

  const inBatchHitRate = toRate(inBatchHitCount, positives.length);
  const outOfBatchFalseHitRate = toRate(outOfBatchFalseHits, negatives.length);

  const expectedPath = batchCandidatesPath;
  const expectedBody = await fs.readFile(batchCandidatesPath, "utf8");
  const expectedHash = createHash("sha256").update(expectedBody).digest("hex");
  const expectedScopeId = String(meta?.candidateScopeId || "").trim() || null;

  const runtimePath = String(statusAfterRun?.json?.candidatesPath || "").trim() || null;
  const runtimeHash = String(statusAfterRun?.json?.candidatesHash || "").trim() || null;
  const runtimeScopeId = String(statusAfterRun?.json?.candidateScopeId || "").trim() || null;

  const scopePathMatch = expectedPath ? runtimePath === expectedPath : true;
  const scopeHashMatch = expectedHash ? runtimeHash === expectedHash : true;
  const scopeIdMatch = expectedScopeId ? runtimeScopeId === expectedScopeId : true;

  const failReasons = [];
  if (inBatchHitRate < hitThreshold) failReasons.push("in_batch_hit_rate_below_threshold");
  if (outOfBatchFalseHitRate > 0) failReasons.push("out_of_batch_false_hits_detected");
  if (!scopePathMatch) failReasons.push("runtime_candidates_path_mismatch");
  if (!scopeHashMatch) failReasons.push("runtime_candidates_hash_mismatch");
  if (!scopeIdMatch) failReasons.push("runtime_candidate_scope_id_mismatch");

  const batchIsolationPass = failReasons.length === 0;

  const outDir = resolvePath(getArg("out-dir")) || path.join(path.dirname(batchCandidatesPath), "d1b_isolation");
  await ensureDir(outDir);

  const report = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    stageDRoot,
    laneId,
    patchBatchId: meta?.patchBatchId || positives[0]?.patchBatchId || null,
    thresholds: {
      minPositives,
      maxPositives,
      minNegatives,
      hitThreshold,
    },
    counts: {
      positiveSampleCount: positives.length,
      negativeSampleCount: negatives.length,
      inBatchHitCount,
      outOfBatchFalseHits,
    },
    metrics: {
      inBatchHitRate,
      outOfBatchFalseHitRate,
    },
    patchScopeEvidence: {
      expected: {
        candidatesPath: expectedPath,
        candidatesHash: expectedHash,
        candidateScopeId: expectedScopeId,
      },
      runtime: {
        candidatesPath: runtimePath,
        candidatesHash: runtimeHash,
        candidateScopeId: runtimeScopeId,
        candidatesLoaded: asNumber(statusAfterRun?.json?.candidatesLoaded, 0),
      },
      matches: {
        candidatesPath: scopePathMatch,
        candidatesHash: scopeHashMatch,
        candidateScopeId: scopeIdMatch,
      },
    },
    patchStatus: {
      before: statusBeforeRun?.json || null,
      after: statusAfterRun?.json || null,
    },
    batchIsolationPass,
    failReasons,
    positiveRows,
    negativeRows,
  };

  const reportMd = [
    "# Stage D1b Batch Isolation Proof",
    "",
    `- batchIsolationPass: ${batchIsolationPass}`,
    `- laneId: ${laneId}`,
    `- patchBatchId: ${report.patchBatchId || "unknown"}`,
    `- inBatchHitRate: ${(inBatchHitRate * 100).toFixed(2)}% (threshold ${(hitThreshold * 100).toFixed(2)}%)`,
    `- outOfBatchFalseHitRate: ${(outOfBatchFalseHitRate * 100).toFixed(2)}%`,
    `- scopePathMatch: ${scopePathMatch}`,
    `- scopeHashMatch: ${scopeHashMatch}`,
    `- scopeIdMatch: ${scopeIdMatch}`,
    "",
    "## Fail Reasons",
    ...(failReasons.length > 0 ? failReasons.map((row) => `- ${row}`) : ["- none"]),
  ].join("\n");

  const fixableQueue = failReasons.length > 0
    ? [{
      id: `d1b_${Date.now()}`,
      breachType: "batch_scope_leakage",
      laneId,
      reasonCode: failReasons.join("|"),
      owner: "unassigned",
      status: "open",
      targetRelease: "v1.6.14-stage-e-followup",
      patchBatchId: report.patchBatchId,
    }]
    : [];

  await writeJson(path.join(outDir, "stage_d1b_batch_isolation_proof.json"), report);
  await writeText(path.join(outDir, "stage_d1b_batch_isolation_proof.md"), `${reportMd}\n`);
  await writeJsonl(path.join(outDir, "stage_d1b_positive_samples.jsonl"), positives);
  await writeJsonl(path.join(outDir, "stage_d1b_negative_samples.jsonl"), negatives);
  await writeJsonl(path.join(outDir, "stage_d1b_fixable_repair_queue.jsonl"), fixableQueue);

  console.log("[run-stage-d1-batch-isolation-proof] completed");
  console.log(JSON.stringify({
    outDir,
    batchIsolationPass,
    inBatchHitRate,
    outOfBatchFalseHitRate,
    failReasons,
  }, null, 2));

  if (!batchIsolationPass) process.exit(2);
};

main().catch((error) => {
  console.error("[run-stage-d1-batch-isolation-proof] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
