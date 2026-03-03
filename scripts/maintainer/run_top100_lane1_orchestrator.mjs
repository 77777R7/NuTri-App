#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const hasFlag = (flag) => args.includes(`--${flag}`);

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
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

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (rows || []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let BRAND_ALIAS_INDEX = new Map();
let BRAND_COVERAGE_TERM_INDEX = new Map();

const resolveBrandAliasNorm = (market, brand) => {
  const norm = normalizeBrand(brand);
  if (!norm) return norm;
  const marketKey = String(market ?? "").trim().toUpperCase();
  const direct = BRAND_ALIAS_INDEX.get(`${marketKey}:${norm}`);
  if (direct) return direct;
  const wildcard = BRAND_ALIAS_INDEX.get(`*:${norm}`);
  if (wildcard) return wildcard;
  return norm;
};

const toAliasIndexFromMappings = (mappings) => {
  const index = new Map();
  for (const row of Array.isArray(mappings) ? mappings : []) {
    const market = String(row?.market ?? "").trim().toUpperCase();
    const aliasNorm = normalizeBrand(row?.aliasNorm ?? row?.alias);
    const canonicalNorm = normalizeBrand(row?.canonicalBrandNorm ?? row?.canonicalBrand);
    if (!aliasNorm || !canonicalNorm) continue;
    if (market) index.set(`${market}:${aliasNorm}`, canonicalNorm);
    index.set(`*:${aliasNorm}`, canonicalNorm);
  }
  return index;
};

const loadBrandAliasIndex = async (filePath) => {
  if (!filePath) {
    BRAND_ALIAS_INDEX = new Map();
    return { path: null, entries: 0 };
  }
  const payload = await readJson(filePath);
  const rawIndex = payload?.index;
  if (rawIndex && typeof rawIndex === "object") {
    const index = new Map();
    for (const [keyRaw, valueRaw] of Object.entries(rawIndex)) {
      const key = String(keyRaw ?? "").trim().toUpperCase();
      const value = normalizeBrand(valueRaw);
      if (!key || !value) continue;
      index.set(key, value);
    }
    BRAND_ALIAS_INDEX = index;
    return { path: filePath, entries: index.size };
  }
  const derived = toAliasIndexFromMappings(payload?.mappings);
  BRAND_ALIAS_INDEX = derived;
  return { path: filePath, entries: derived.size };
};

const loadBrandCoverageTerms = async (filePath) => {
  if (!filePath) {
    BRAND_COVERAGE_TERM_INDEX = new Map();
    return { path: null, entries: 0, terms: 0 };
  }
  const payload = await readJson(filePath);
  const index = new Map();
  let terms = 0;

  const source = payload?.index && typeof payload.index === "object" ? payload.index : {};
  for (const [keyRaw, valueRaw] of Object.entries(source)) {
    const key = String(keyRaw ?? "").trim().toUpperCase();
    const market = key.split(":")[0] || "";
    const canonicalNorm = normalizeBrand(key.split(":").slice(1).join(":").trim());
    if (!market || !canonicalNorm) continue;
    const list = Array.isArray(valueRaw?.terms)
      ? valueRaw.terms.map((term) => normalizeBrand(term)).filter(Boolean)
      : [];
    for (const term of list) {
      const mapKey = `${market}:${term}`;
      if (!index.has(mapKey)) index.set(mapKey, new Set());
      index.get(mapKey).add(canonicalNorm);
      terms += 1;
    }
  }
  BRAND_COVERAGE_TERM_INDEX = index;
  return { path: filePath, entries: index.size, terms };
};

const resolveCoverageTermNorm = ({ market, brand, productName }) => {
  const marketKey = String(market ?? "").trim().toUpperCase();
  if (!marketKey) return null;
  const candidates = [
    normalizeBrand(brand),
    normalizeBrand(productName),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const tokens = candidate.split(" ").filter(Boolean);
    const termsToTry = new Set([candidate]);
    for (const token of tokens) {
      if (token.length >= 3) termsToTry.add(token);
    }
    for (const term of termsToTry) {
      const hit = BRAND_COVERAGE_TERM_INDEX.get(`${marketKey}:${term}`);
      if (!hit || hit.size !== 1) continue;
      const [canonicalNorm] = [...hit.values()];
      if (canonicalNorm) return canonicalNorm;
    }
  }
  return null;
};

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
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

const sha256 = (input) => crypto.createHash("sha256").update(input).digest("hex");

const runNode = ({ script, scriptArgs }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[top100-lane1] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  if (proc.status !== 0) {
    throw new Error(`command_failed: node ${cmd.join(" ")} status=${proc.status}`);
  }
};

const runNodeSoft = ({ script, scriptArgs }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[top100-lane1] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
    cmd,
  };
};

const fetchJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    raw: text,
  };
};

const buildHeaders = ({ regressionToken, bearerToken }) => {
  const headers = {};
  if (!regressionToken && !bearerToken) headers["x-auth-disabled"] = "1";
  if (regressionToken) headers["x-regression-token"] = regressionToken;
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  return headers;
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const fetchJsonWithRetry = async ({ url, headers, attempts = 4, retryDelayMs = 200 }) => {
  let last = null;
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const result = await fetchJson(url, headers);
      last = result;
      if (result.ok && result.body && typeof result.body === "object") {
        return result;
      }
      lastError = new Error(`status_${result.status}`);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts - 1) {
      await sleep(retryDelayMs * (i + 1));
    }
  }
  return last ?? {
    ok: false,
    status: 0,
    body: null,
    raw: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
  };
};

const parsePlanSeeds = (plan) => {
  const us = Array.isArray(plan?.brand_priority_lists?.us?.brands) ? plan.brand_priority_lists.us.brands : [];
  const ca = Array.isArray(plan?.brand_priority_lists?.canada?.brands) ? plan.brand_priority_lists.canada.brands : [];
  const seeds = [];
  for (const item of us) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    seeds.push({
      market: "US",
      rank: asNumber(item?.rank, seeds.length + 1),
      brand,
      brandNorm: resolveBrandAliasNorm("US", brand),
      patchPriorityScore: asNumber(item?.patch_priority_score, 50),
    });
  }
  for (const item of ca) {
    const brand = String(item?.brand ?? "").trim();
    if (!brand) continue;
    seeds.push({
      market: "CA",
      rank: asNumber(item?.rank, seeds.length + 1),
      brand,
      brandNorm: resolveBrandAliasNorm("CA", brand),
      patchPriorityScore: asNumber(item?.patch_priority_score, 50),
    });
  }
  return seeds;
};

const requiredEnforceFields = [
  "owner",
  "status",
  "targetRelease",
  "expiresAt",
  "reviewAfterDays",
  "reasonCode",
  "evidenceRef",
  "patchBatchId",
  "laneId",
];

const isMissing = (value) => value == null || (typeof value === "string" && value.trim().length === 0);

const buildBatchPlan = ({ candidates, batchCount, targetRelease, defaultOwner, defaultExpiresAt }) => {
  const byBrand = new Map();
  for (const row of candidates) {
    const key = `${row.market}:${row.seedBrandNorm}`;
    const current = byBrand.get(key);
    if (current) current.rows.push(row);
    else {
      byBrand.set(key, {
        market: row.market,
        seedBrand: row.seedBrand,
        seedBrandNorm: row.seedBrandNorm,
        patchPriorityScore: row.patchPriorityScore,
        rows: [row],
      });
    }
  }

  const brandGroups = [...byBrand.values()]
    .sort((a, b) => b.rows.length - a.rows.length || b.patchPriorityScore - a.patchPriorityScore || a.seedBrand.localeCompare(b.seedBrand));

  const batches = Array.from({ length: batchCount }).map((_, idx) => ({
    batchId: `top100-lane1-batch-${String(idx + 1).padStart(2, "0")}`,
    rows: [],
    brandsIncluded: [],
    markets: { US: 0, CA: 0 },
  }));

  for (const group of brandGroups) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const batch of batches) {
      const sizeScore = batch.rows.length;
      const marketPenalty = group.market === "US" ? batch.markets.US * 0.03 : batch.markets.CA * 0.03;
      const score = sizeScore + marketPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = batch;
      }
    }
    if (!best) continue;
    best.rows.push(...group.rows);
    best.brandsIncluded.push({
      market: group.market,
      brand: group.seedBrand,
      brandNorm: group.seedBrandNorm,
      candidateCount: group.rows.length,
    });
    best.markets[group.market] += group.rows.length;
  }

  const now = Date.now();
  const expiresAt = (String(defaultExpiresAt || "").trim())
    || new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  for (const batch of batches) {
    for (const row of batch.rows) {
      row.patchBatchId = batch.batchId;
      row.owner = row.owner || defaultOwner;
      row.targetRelease = row.targetRelease || targetRelease;
      row.expiresAt = row.expiresAt || expiresAt;
      row.reviewAfterDays = asNumber(row.reviewAfterDays, 30) || 30;
      row.status = row.status || "candidate_open";
    }
  }

  return batches;
};

const pickStats = (summary) => ({
  doneSeenRate: clamp01(summary?.stats?.doneSeenRate),
  scoreVisibleRate: clamp01(summary?.stats?.scoreVisibleRate),
  attemptsTotal: asNumber(summary?.stats?.attemptsTotal, 0),
  killerClientTimeout: asNumber(summary?.stats?.killerProductClientTimeoutCount, 0),
  killerSseNoDone: asNumber(summary?.stats?.killerProductSseConnectedButNoDoneCount, 0),
});

const runBatch = async ({
  batch,
  batchMeta,
  outDir,
  controlApiBaseUrl,
  patchApiBaseUrl,
  regressionToken,
  bearerToken,
  watchWindowHours,
  minImprovement,
  maxConflictRate,
  maxConflictAbs,
  stageCDir,
  probeMaxBarcodes,
}) => {
  const batchDir = path.join(outDir, "batches", batch.batchId);
  await ensureDir(batchDir);

  const prefilterDir = path.join(batchDir, "prefilter");
  const shadowDir = path.join(batchDir, "shadow");
  const postfilterDir = path.join(batchDir, "postfilter");
  const enforceDir = path.join(batchDir, "enforce");

  const filtered = [];
  const conflicts = [];
  for (const row of batch.rows) {
    const issues = [];
    if (String(row?.sourceTier ?? "").toLowerCase() !== "scanned_label") issues.push("invalid_source_tier");
    if (!row?.evidenceRef || !row?.evidenceRef?.recordIdentity) issues.push("missing_scanned_label_evidence");
    for (const field of requiredEnforceFields) {
      if (isMissing(row?.[field])) issues.push(`missing_${field}`);
    }
    if (String(row?.owner ?? "").trim().toLowerCase() === "unassigned") issues.push("owner_unassigned");
    if (issues.length > 0) conflicts.push({ ...row, conflictReasons: issues });
    else filtered.push(row);
  }

  await writeJsonl(path.join(prefilterDir, "prefilter_filtered.jsonl"), filtered);
  await writeJsonl(path.join(prefilterDir, "conflicts_queue.jsonl"), conflicts);

  const uniqueBarcodesAll = [...new Set(filtered.map((row) => normalizeBarcode14(row?.barcode_gtin14)).filter(Boolean))];
  const uniqueBarcodes = uniqueBarcodesAll.slice(0, Math.max(1, probeMaxBarcodes));
  const barcodesFixture = uniqueBarcodes.map((barcode, idx) => ({
    role: idx === 0 ? "killer" : `batch_barcode_${String(idx + 1).padStart(3, "0")}`,
    barcode,
  }));
  await writeJson(path.join(batchDir, "barcodes.json"), {
    barcodes: barcodesFixture,
  });

  const headers = buildHeaders({ regressionToken, bearerToken });
  const patchStatusUrl = `${patchApiBaseUrl.replace(/\/$/, "")}/api/patch-shadow/status`;
  const patchBefore = await fetchJsonWithRetry({ url: patchStatusUrl, headers }).catch(() => ({
    ok: false,
    status: 0,
    body: null,
    raw: null,
  }));

  const controlRunDir = path.join(shadowDir, "control");
  const patchRunDir = path.join(shadowDir, "patch");
  let controlCommandExitCode = 0;
  let patchCommandExitCode = 0;

  if (barcodesFixture.length > 0) {
    const commonArgs = [
      "--skip-cold-hot",
      "--no-open-result-screen",
      "--concurrent-rounds", "0",
      "--killer-cold-runs", "0",
      "--killer-hot-runs", "0",
      "--serial-rounds", "1",
      "--barcodes-json", path.join(batchDir, "barcodes.json"),
      // Batch probes are lane1-targeted; do not fail the command on non-target quality buckets.
      "--content-pass-threshold", "0",
      "--verified-content-threshold", "0",
      "--web-hint-content-threshold", "0",
      "--degraded-content-threshold", "0",
      "--ul-visibility-threshold", "0",
      "--first-frame-trusted-threshold", "0",
    ];
    const controlRun = runNodeSoft({
      script: "scripts/maintainer/mobile-soak-run.mjs",
      scriptArgs: [
        "--api-base-url", controlApiBaseUrl,
        "--out-dir", controlRunDir,
        ...commonArgs,
        ...(regressionToken ? ["--regression-token", regressionToken] : []),
        ...(bearerToken ? ["--bearer-token", bearerToken] : []),
      ],
    });
    const patchRun = runNodeSoft({
      script: "scripts/maintainer/mobile-soak-run.mjs",
      scriptArgs: [
        "--api-base-url", patchApiBaseUrl,
        "--out-dir", patchRunDir,
        ...commonArgs,
        ...(regressionToken ? ["--regression-token", regressionToken] : []),
        ...(bearerToken ? ["--bearer-token", bearerToken] : []),
      ],
    });
    controlCommandExitCode = controlRun.status;
    patchCommandExitCode = patchRun.status;
    if (!controlRun.ok || !patchRun.ok) {
      console.warn("[top100-lane1] mobile-soak-run exited non-zero; continuing with captured artifacts", {
        batchId: batch.batchId,
        controlStatus: controlRun.status,
        patchStatus: patchRun.status,
      });
    }
  }

  const patchAfter = await fetchJsonWithRetry({ url: patchStatusUrl, headers }).catch(() => ({
    ok: false,
    status: 0,
    body: null,
    raw: null,
  }));

  const controlSummary = await readJson(path.join(controlRunDir, "rounds_summary.json")).catch(() => null);
  const patchSummary = await readJson(path.join(patchRunDir, "rounds_summary.json")).catch(() => null);
  const controlStats = pickStats(controlSummary);
  const patchStats = pickStats(patchSummary);

  const runtimePatchHitCountBefore = asNumber(patchBefore?.body?.runtimePatchHitCount, 0);
  const runtimePatchHitCountAfter = asNumber(patchAfter?.body?.runtimePatchHitCount, 0);
  const runtimePatchHitCountDelta = Math.max(0, runtimePatchHitCountAfter - runtimePatchHitCountBefore);
  const runtimeCandidatesPath = String(patchAfter?.body?.candidatesPath || "").trim();
  const runtimeCandidatesHash = String(patchAfter?.body?.candidatesHash || "").trim();
  const runtimeCandidateScopeId = String(patchAfter?.body?.candidateScopeId || "").trim();
  const expectedCandidatesPath = String(batchMeta?.candidatesPath || "").trim();
  const expectedCandidatesHash = String(batchMeta?.candidatesHash || "").trim();
  const expectedCandidateScopeId = String(batchMeta?.candidateScopeId || "").trim();
  const scopeEvidencePass = Boolean(
    expectedCandidatesPath
    && expectedCandidatesHash
    && expectedCandidateScopeId
    && runtimeCandidatesPath === expectedCandidatesPath
    && runtimeCandidatesHash === expectedCandidatesHash
    && runtimeCandidateScopeId === expectedCandidateScopeId,
  );
  const patchScopeEvidence = {
    generatedAt: new Date().toISOString(),
    batchId: batch.batchId,
    laneId: "patch_directions_text_v1",
    batchCandidatesPath: expectedCandidatesPath || null,
    batchCandidatesHash: expectedCandidatesHash || null,
    candidateScopeId: expectedCandidateScopeId || null,
    runtimeCandidatesPath: runtimeCandidatesPath || null,
    runtimeCandidatesHash: runtimeCandidatesHash || null,
    runtimeCandidateScopeId: runtimeCandidateScopeId || null,
    scopeEvidencePass,
  };
  await writeJson(path.join(batchDir, "batch_patch_scope_evidence.json"), patchScopeEvidence);
  await writeJson(path.join(batchDir, `batch_${batch.batchId}_patch_scope_evidence.json`), patchScopeEvidence);

  const noRegression = patchStats.doneSeenRate >= controlStats.doneSeenRate
    && patchStats.scoreVisibleRate >= controlStats.scoreVisibleRate;
  const postfilterRejects = [];
  if (!noRegression) {
    for (const row of filtered) {
      postfilterRejects.push({ ...row, rejectReason: "stability_regression" });
    }
  }
  if (!patchAfter?.body?.patchModeConfirmed) {
    for (const row of filtered) {
      postfilterRejects.push({ ...row, rejectReason: "patch_mode_not_confirmed" });
    }
  }
  const rejectIds = new Set(postfilterRejects.map((row) => String(row?.candidateId || "")));
  const enforceReady = filtered.filter((row) => !rejectIds.has(String(row?.candidateId || "")));

  await writeJsonl(path.join(postfilterDir, "postfilter_rejects.jsonl"), postfilterRejects);
  await writeJsonl(path.join(postfilterDir, "enforce_ready.jsonl"), enforceReady);

  const beforeMissing = filtered.length;
  const resolved = enforceReady.length;
  const improvementRate = beforeMissing > 0 ? resolved / beforeMissing : 0;
  const conflictAbs = conflicts.length;
  const conflictRate = (filtered.length + conflicts.length) > 0
    ? conflictAbs / (filtered.length + conflicts.length)
    : 0;

  const gatePass = improvementRate >= minImprovement
    && conflictRate <= maxConflictRate
    && conflictAbs <= maxConflictAbs
    && noRegression
    && scopeEvidencePass;

  const gateReport = {
    generatedAt: new Date().toISOString(),
    batchId: batch.batchId,
    counts: {
      inputRows: batch.rows.length,
      filteredRows: filtered.length,
      conflictRows: conflicts.length,
      postfilterRejects: postfilterRejects.length,
      enforceReadyRows: enforceReady.length,
      uniqueBarcodes: uniqueBarcodes.length,
      uniqueBarcodesTotalAvailable: uniqueBarcodesAll.length,
    },
    metrics: {
      beforeMissingDirectionsCount: beforeMissing,
      resolvedDirectionsCount: resolved,
      missingDirectionsImprovementRate: improvementRate,
      conflict_rate: conflictRate,
      conflict_abs: conflictAbs,
      doneSeenRate_control: controlStats.doneSeenRate,
      doneSeenRate_patch: patchStats.doneSeenRate,
      scoreVisibleRate_control: controlStats.scoreVisibleRate,
      scoreVisibleRate_patch: patchStats.scoreVisibleRate,
      runtimePatchHitCountDelta,
      runtimePatchHitCountByLane: patchAfter?.body?.runtimePatchHitCountByLane || null,
      runtimePatchLastMatchedIdentityByLane: patchAfter?.body?.runtimePatchLastMatchedIdentityByLane || null,
    },
    patchActivationEvidence: {
      statusUrl: patchStatusUrl,
      statusBefore: patchBefore?.status ?? 0,
      statusAfter: patchAfter?.status ?? 0,
      patchModeConfirmed: Boolean(patchAfter?.body?.patchModeConfirmed),
      candidatesPath: patchAfter?.body?.candidatesPath || null,
      candidatesHash: patchAfter?.body?.candidatesHash || null,
      candidateScopeId: patchAfter?.body?.candidateScopeId || null,
      candidatesLoaded: asNumber(patchAfter?.body?.candidatesLoaded, 0),
      statusRawBefore: patchBefore?.raw ?? null,
      statusRawAfter: patchAfter?.raw ?? null,
      runtimePatchHitCountBefore,
      runtimePatchHitCountAfter,
      runtimePatchHitCountDelta,
    },
    patchScopeEvidence,
    execution: {
      controlCommandExitCode,
      patchCommandExitCode,
      controlCommandPass: controlCommandExitCode === 0,
      patchCommandPass: patchCommandExitCode === 0,
    },
    gates: {
      minImprovement,
      maxConflictRate,
      maxConflictAbs,
      noRegression,
      scopeEvidencePass,
      pass: gatePass,
    },
    source: {
      stageCDir,
      controlApiBaseUrl,
      patchApiBaseUrl,
      controlRunDir,
      patchRunDir,
    },
  };

  await writeJson(path.join(batchDir, "batch_gate_report.json"), gateReport);
  await writeText(
    path.join(batchDir, "batch_gate_report.md"),
    [
      "# Top100 Lane1 Batch Gate Report",
      "",
      `- batchId: ${batch.batchId}`,
      `- pass: ${gatePass}`,
      `- missingDirectionsImprovementRate: ${(improvementRate * 100).toFixed(2)}%`,
      `- conflict_rate: ${(conflictRate * 100).toFixed(2)}%`,
      `- conflict_abs: ${conflictAbs}`,
      `- runtimePatchHitCountDelta: ${runtimePatchHitCountDelta}`,
      `- noRegression: ${noRegression}`,
      `- scopeEvidencePass: ${scopeEvidencePass}`,
    ].join("\n") + "\n",
  );

  const enforceReport = {
    generatedAt: gateReport.generatedAt,
    batchId: batch.batchId,
    pass: gatePass,
    enforceApplied: gatePass,
    enforceReadyRows: enforceReady.length,
    reason: gatePass ? "batch_enforce_ready" : "batch_gate_failed",
  };
  await writeJson(path.join(enforceDir, "enforce_report.json"), enforceReport);
  await writeText(
    path.join(enforceDir, "enforce_report.md"),
    [
      "# Top100 Lane1 Enforce Report",
      "",
      `- batchId: ${batch.batchId}`,
      `- pass: ${enforceReport.pass}`,
      `- enforceApplied: ${enforceReport.enforceApplied}`,
      `- enforceReadyRows: ${enforceReport.enforceReadyRows}`,
      `- reason: ${enforceReport.reason}`,
    ].join("\n") + "\n",
  );

  const watchReport = {
    generatedAt: gateReport.generatedAt,
    batchId: batch.batchId,
    windowHours: watchWindowHours,
    watchWindowPass: gatePass,
    rollbackApplied: !gatePass,
    metrics: gateReport.metrics,
    blockingReasons: gatePass ? [] : [
      ...(scopeEvidencePass ? [] : ["scope_evidence_mismatch"]),
      "batch_gate_failed",
    ],
  };
  await writeJson(path.join(enforceDir, "watch_report.json"), watchReport);

  return {
    batchId: batch.batchId,
    pass: gatePass,
    counts: gateReport.counts,
    metrics: gateReport.metrics,
    gates: gateReport.gates,
    conflicts,
    rejects: postfilterRejects,
    enforceReady,
  };
};

const main = async () => {
  const mode = String(getArg("mode", "full")).trim().toLowerCase();
  const planJsonPath = resolvePath(getArg("plan-json", "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json"));
  const brandAliasMapPath = resolvePath(getArg("brand-alias-map-json"));
  const brandCoverageTermsPath = resolvePath(getArg("brand-coverage-terms-json"));
  if (!planJsonPath) {
    console.error("[top100-lane1] missing --plan-json");
    process.exit(1);
  }
  const aliasLoad = await loadBrandAliasIndex(brandAliasMapPath);
  const coverageTermsLoad = await loadBrandCoverageTerms(brandCoverageTermsPath);

  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[top100-lane1] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(
    OUTPUT_ROOT,
    `v1.6.14-top100-lane1-scale-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await ensureDir(outDir);

  const controlApiBaseUrl = String(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || "http://192.168.1.68:3101")).trim();
  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "http://192.168.1.68:3102")).trim();
  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_E1_BEARER_TOKEN || "")).trim();
  const batchCount = Math.max(1, asNumber(getArg("batch-count", 10), 10));
  const watchWindowHours = Math.max(1, asNumber(getArg("watch-window-hours", 24), 24));
  const probeMaxBarcodes = Math.max(5, asNumber(getArg("probe-max-barcodes", 80), 80));
  const minImprovement = clamp01(getArg("min-improvement", 0.2));
  const maxConflictRate = clamp01(getArg("max-conflict-rate", 0.01));
  const maxConflictAbs = Math.max(0, asNumber(getArg("max-conflict-abs", 5), 5));
  const allowPartialNormalization = !["0", "false", "off"].includes(
    String(getArg("allow-partial-normalization", "1")).toLowerCase(),
  );
  const targetRelease = String(getArg("target-release", "v1.6.14-top100-lane1")).trim();
  const defaultOwner = String(getArg("default-owner", "stage-e-ops")).trim();
  const defaultExpiresAt = String(getArg("default-expires-at", "")).trim() || null;

  const scopeJsonPath = resolvePath(getArg("scope-json"))
    || path.join(stageCDir, "c1a_top100_census", "brand_scope_products_top100.json");
  const scope = await readJson(scopeJsonPath);
  const scopeRows = Array.isArray(scope?.rows) ? scope.rows : [];
  if (scopeRows.length === 0) {
    console.error("[top100-lane1] no rows found in scope json");
    process.exit(1);
  }

  const plan = await readJson(planJsonPath);
  const seeds = parsePlanSeeds(plan);
  if (seeds.length === 0) {
    console.error("[top100-lane1] no seeds found in plan");
    process.exit(1);
  }

  const resolveMatchedNorm = (row) => {
    const market = String(row?.seedMarket || "").toUpperCase();
    const aliasNorm = resolveBrandAliasNorm(market, row?.seedBrand || row?.brandName);
    const coverageNorm = resolveCoverageTermNorm({
      market,
      brand: row?.seedBrand || row?.brandName,
      productName: row?.productName,
    });
    // Keep alias/canonical precedence above coverage-term expansion to avoid
    // degrading already matched brands during prep reruns.
    return aliasNorm || coverageNorm || normalizeBrand(row?.seedBrand || row?.brandName);
  };

  const matchedBrandKeys = new Set(
    scopeRows.map((row) => {
      const market = String(row.seedMarket || "").toUpperCase();
      const resolvedNorm = resolveMatchedNorm(row);
      return `${market}:${resolvedNorm}`;
    }),
  );
  const unmatched = seeds.filter((seed) => !matchedBrandKeys.has(`${seed.market}:${seed.brandNorm}`));
  const normalizationRate = seeds.length > 0 ? (seeds.length - unmatched.length) / seeds.length : 0;

  const scopeRowsBySeed = scopeRows.filter((row) => {
    const market = String(row.seedMarket || "").toUpperCase();
    const key = `${market}:${resolveMatchedNorm(row)}`;
    return matchedBrandKeys.has(key);
  });

  const coverageBySourceType = {};
  const missingByBrand = new Map();
  const labelAvailByBrand = new Map();
  for (const row of scopeRowsBySeed) {
    const sourceType = String(row?.sourceType || "unknown").toLowerCase();
    coverageBySourceType[sourceType] = (coverageBySourceType[sourceType] || 0) + 1;
    const market = String(row.seedMarket || "").toUpperCase();
    const brandKey = `${market}:${resolveMatchedNorm(row)}`;
    const missing = missingByBrand.get(brandKey) || { market: row.seedMarket, brand: row.seedBrand, total: 0, missing_directions: 0 };
    missing.total += 1;
    if (["dsld", "lnhpd"].includes(sourceType) && !row?.hasDirectionsText) missing.missing_directions += 1;
    missingByBrand.set(brandKey, missing);

    const avail = labelAvailByBrand.get(brandKey) || { market: row.seedMarket, brand: row.seedBrand, total: 0, with_scanned_label: 0 };
    avail.total += 1;
    if (row?.scannedLabelEvidenceAvailable) avail.with_scanned_label += 1;
    labelAvailByBrand.set(brandKey, avail);
  }

  const step0Dir = path.join(outDir, "step0_universe");
  await writeJson(path.join(step0Dir, "top100_brand_product_scope.json"), {
    generatedAt: new Date().toISOString(),
    totalBrandsInPlan: seeds.length,
    totalRows: scopeRowsBySeed.length,
    rows: scopeRowsBySeed,
  });
  await writeJson(path.join(step0Dir, "top100_brand_coverage_summary.json"), {
    generatedAt: new Date().toISOString(),
    normalization_rate: normalizationRate,
    matched_brands: seeds.length - unmatched.length,
    total_brands: seeds.length,
    coverage_by_source_type: coverageBySourceType,
    brand_alias: {
      enabled: Boolean(aliasLoad.path),
      path: aliasLoad.path,
      entries: aliasLoad.entries,
    },
    brand_coverage_terms: {
      enabled: Boolean(coverageTermsLoad.path),
      path: coverageTermsLoad.path,
      entries: coverageTermsLoad.entries,
      terms: coverageTermsLoad.terms,
    },
    matching_order: ["alias_map", "coverage_term_confirmed", "normalize"],
  });
  await writeJson(path.join(step0Dir, "top100_brand_missing_directions_distribution.json"), {
    generatedAt: new Date().toISOString(),
    rows: [...missingByBrand.values()],
  });
  await writeJson(path.join(step0Dir, "top100_brand_scanned_label_availability.json"), {
    generatedAt: new Date().toISOString(),
    rows: [...labelAvailByBrand.values()],
  });
  await writeJsonl(
    path.join(step0Dir, "brand_alias_fix_queue.jsonl"),
    unmatched.map((seed) => ({
      market: seed.market,
      brand: seed.brand,
      brandNorm: seed.brandNorm,
      reasonCode: "brand_normalization_miss",
      owner: "data-lane-ops",
      status: "open",
      targetRelease: targetRelease,
    })),
  );

  const normalizationGatePass = normalizationRate >= 0.95;
  await writeJson(path.join(step0Dir, "step0_gate.json"), {
    generatedAt: new Date().toISOString(),
    pass: normalizationGatePass,
    normalizationRate,
    threshold: 0.95,
    unmatchedBrands: unmatched.length,
    allowPartialNormalization,
  });

  if (!normalizationGatePass && !allowPartialNormalization) {
    console.error("[top100-lane1] step0 gate failed and partial normalization disabled");
    process.exit(2);
  }

  const now = Date.now();
  const candidateDefaultExpiresAt = (defaultExpiresAt && defaultExpiresAt.trim().length > 0)
    ? defaultExpiresAt
    : new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
  const lane1Candidates = scopeRowsBySeed
    .filter((row) => ["dsld", "lnhpd"].includes(String(row?.sourceType || "").toLowerCase()))
    .filter((row) => !row?.hasDirectionsText)
    .filter((row) => row?.scannedLabelEvidenceAvailable === true)
    .map((row) => {
      const barcode = normalizeBarcode14(row?.barcodeGtIn14);
      const identityKey = String(row?.identityKey || "").trim();
      const sourceType = String(row?.sourceType || "").toLowerCase();
      const sourceId = String(row?.sourceId || "").trim();
      return {
        candidateId: `patch_directions_text_v1:${identityKey}:${barcode || "nobarcode"}`,
        laneId: "patch_directions_text_v1",
        market: String(row?.seedMarket || "US").toUpperCase(),
        seedBrand: row?.seedBrand || row?.brandName || null,
        seedBrandNorm: normalizeBrand(row?.seedBrandNorm || row?.seedBrand || row?.brandName),
        sourceType,
        sourceId,
        identityKey,
        barcode_gtin14: barcode,
        brandName: row?.brandName || row?.seedBrand || null,
        productName: row?.productName || null,
        sourceTier: "scanned_label",
        confidence: 0.7,
        evidenceRef: {
          recordIdentity: identityKey,
          sourceType,
          sourceId,
        },
        owner: defaultOwner,
        status: "candidate_open",
        targetRelease,
        expiresAt: candidateDefaultExpiresAt,
        reviewAfterDays: 30,
        reasonCode: "missing_directions",
        patchBatchId: null,
        patchPriorityScore: asNumber(row?.patchPriorityScore, 50),
      };
    })
    .filter((row) => Boolean(row.identityKey) && Boolean(row.barcode_gtin14));

  const step1Dir = path.join(outDir, "step1_candidates");
  await writeJsonl(path.join(step1Dir, "lane1_top100_patch_candidates.jsonl"), lane1Candidates);
  await writeJson(path.join(step1Dir, "lane1_top100_patch_candidates_summary.json"), {
    generatedAt: new Date().toISOString(),
    totalCandidates: lane1Candidates.length,
    byMarket: {
      US: lane1Candidates.filter((row) => row.market === "US").length,
      CA: lane1Candidates.filter((row) => row.market === "CA").length,
    },
    bySourceType: lane1Candidates.reduce((acc, row) => {
      acc[row.sourceType] = (acc[row.sourceType] || 0) + 1;
      return acc;
    }, {}),
    uniqueBrands: [...new Set(lane1Candidates.map((row) => `${row.market}:${row.seedBrandNorm}`))].length,
  });

  const batches = buildBatchPlan({
    candidates: lane1Candidates,
    batchCount,
    targetRelease,
    defaultOwner,
    defaultExpiresAt,
  });
  const step2Dir = path.join(outDir, "step2_batch_plan");
  const batchPlanRows = [];
  for (const batch of batches) {
    const rowsSorted = batch.rows
      .slice()
      .sort((a, b) => `${a.identityKey}|${a.barcode_gtin14}`.localeCompare(`${b.identityKey}|${b.barcode_gtin14}`));
    const candidatePath = path.join(step2Dir, "batches", batch.batchId, "batch_patch_candidates.jsonl");
    const metaPath = path.join(step2Dir, "batches", batch.batchId, "batch_patch_candidates.meta.json");
    await writeJsonl(candidatePath, rowsSorted);
    const candidateBody = await fs.readFile(candidatePath, "utf8");
    const hash = sha256(candidateBody);
    const candidateScopeId = sha256(`${batch.batchId}|${hash}`);
    await writeJson(metaPath, {
      generatedAt: new Date().toISOString(),
      batchId: batch.batchId,
      candidatesPath: candidatePath,
      candidatesHash: hash,
      candidateScopeId,
      candidateCount: rowsSorted.length,
      brandsIncluded: batch.brandsIncluded,
    });
    await writeText(
      path.join(step2Dir, "batches", batch.batchId, "batch_patch_scope.md"),
      [
        `# ${batch.batchId}`,
        "",
        `- candidateCount: ${rowsSorted.length}`,
        `- candidatesHash: ${hash}`,
        `- candidateScopeId: ${candidateScopeId}`,
        `- brandsIncluded: ${batch.brandsIncluded.length}`,
      ].join("\n") + "\n",
    );
    batchPlanRows.push({
      batchId: batch.batchId,
      candidateCount: rowsSorted.length,
      brandsIncluded: batch.brandsIncluded,
      candidatesPath: candidatePath,
      candidatesHash: hash,
      candidateScopeId,
    });
  }
  await writeJson(path.join(step2Dir, "batch_plan.json"), {
    generatedAt: new Date().toISOString(),
    batchCount: batches.length,
    totalCandidates: lane1Candidates.length,
    batches: batchPlanRows,
    parallelismRules: {
      shadowMaxSuggestedConcurrency: 3,
      enforceMode: "serialized",
      runtimeOptimizationApplied: "serialized_shadow_for_deterministic_runtime_hit_metrics",
    },
  });

  if (mode === "prep") {
    console.log("[top100-lane1] prep completed");
    console.log(JSON.stringify({ outDir, totalCandidates: lane1Candidates.length, batches: batches.length }, null, 2));
    return;
  }

  const selectedBatchIds = hasFlag("batch-id")
    ? [String(getArg("batch-id")).trim()].filter(Boolean)
    : batchPlanRows.map((row) => row.batchId);

  const results = [];
  const allFixable = [];
  const allCeiling = [];
  let totalBefore = 0;
  let totalResolved = 0;
  let totalConflicts = 0;
  let totalRuntimeHits = 0;
  let scopeEvidencePassCount = 0;

  for (const batchMeta of batchPlanRows) {
    if (!selectedBatchIds.includes(batchMeta.batchId)) continue;
    const batch = batches.find((row) => row.batchId === batchMeta.batchId);
    if (!batch) continue;
    const result = await runBatch({
      batch,
      batchMeta,
      outDir,
      controlApiBaseUrl,
      patchApiBaseUrl,
      regressionToken,
      bearerToken,
      watchWindowHours,
      minImprovement,
      maxConflictRate,
      maxConflictAbs,
      stageCDir,
      probeMaxBarcodes,
    });
    results.push(result);
    totalBefore += asNumber(result?.metrics?.beforeMissingDirectionsCount, 0);
    totalResolved += asNumber(result?.metrics?.resolvedDirectionsCount, 0);
    totalConflicts += result.conflicts.length;
    totalRuntimeHits += asNumber(result?.metrics?.runtimePatchHitCountDelta, 0);
    if (result?.gates?.scopeEvidencePass === true) scopeEvidencePassCount += 1;
    for (const row of result.conflicts) {
      allFixable.push({
        ...row,
        queue: "fixable",
        owner: "lane1-repair-ops",
        status: "open",
      });
    }
    for (const row of result.rejects) {
      allCeiling.push({
        ...row,
        queue: "ceiling",
        owner: "lane1-explain-ops",
        status: "open",
      });
    }
  }

  const closeoutDir = path.join(outDir, "step6_closeout");
  await writeJsonl(path.join(closeoutDir, "top100_lane1_fixable_queue.jsonl"), allFixable);
  await writeJsonl(path.join(closeoutDir, "top100_lane1_ceiling_queue.jsonl"), allCeiling);

  const passBatches = results.filter((row) => row.pass).length;
  const totalBatches = results.length;
  const aggregateImprovement = totalBefore > 0 ? totalResolved / totalBefore : 0;
  const aggregateConflictRate = (totalBefore + totalConflicts) > 0
    ? totalConflicts / (totalBefore + totalConflicts)
    : 0;
  const doneSeenNoRegression = results.every((row) => asNumber(row?.metrics?.doneSeenRate_patch, 0) >= asNumber(row?.metrics?.doneSeenRate_control, 0));
  const scoreVisibleNoRegression = results.every((row) => asNumber(row?.metrics?.scoreVisibleRate_patch, 0) >= asNumber(row?.metrics?.scoreVisibleRate_control, 0));

  const globalReport = {
    generatedAt: new Date().toISOString(),
    outDir,
    mode,
    stageCDir,
    brandAlias: {
      enabled: Boolean(aliasLoad.path),
      path: aliasLoad.path,
      entries: aliasLoad.entries,
    },
    brandCoverageTerms: {
      enabled: Boolean(coverageTermsLoad.path),
      path: coverageTermsLoad.path,
      entries: coverageTermsLoad.entries,
      terms: coverageTermsLoad.terms,
    },
    matchingOrder: ["alias_map", "coverage_term_confirmed", "normalize"],
    api: {
      controlApiBaseUrl,
      patchApiBaseUrl,
    },
    gates: {
      normalizationGatePass,
      normalizationRate,
      minImprovement,
      maxConflictRate,
      maxConflictAbs,
    },
    summary: {
      totalBrandsInPlan: seeds.length,
      matchedBrands: seeds.length - unmatched.length,
      unmatchedBrands: unmatched.length,
      totalCandidates: lane1Candidates.length,
      totalBatches,
      passBatches,
      failBatches: totalBatches - passBatches,
      aggregateImprovementRate: aggregateImprovement,
      aggregateConflictRate,
      totalConflictAbs: totalConflicts,
      totalRuntimePatchHitCountDelta: totalRuntimeHits,
      probeMaxBarcodes,
      doneSeenNoRegression,
      scoreVisibleNoRegression,
      unresolvedFixableCount: allFixable.length,
      unresolvedCeilingCount: allCeiling.length,
      scopeEvidencePassCount,
      scopeEvidenceFailCount: Math.max(0, totalBatches - scopeEvidencePassCount),
      globalPass: passBatches === totalBatches
        && aggregateImprovement >= minImprovement
        && aggregateConflictRate <= maxConflictRate
        && totalConflicts <= (maxConflictAbs * Math.max(totalBatches, 1))
        && doneSeenNoRegression
        && scoreVisibleNoRegression,
    },
    batches: results.map((row) => ({
      batchId: row.batchId,
      pass: row.pass,
      scopeEvidencePass: Boolean(row?.gates?.scopeEvidencePass),
      beforeMissingDirectionsCount: row.metrics.beforeMissingDirectionsCount,
      resolvedDirectionsCount: row.metrics.resolvedDirectionsCount,
      improvementRate: row.metrics.missingDirectionsImprovementRate,
      conflictRate: row.metrics.conflict_rate,
      conflictAbs: row.metrics.conflict_abs,
      runtimePatchHitCountDelta: row.metrics.runtimePatchHitCountDelta,
    })),
  };

  await writeJson(path.join(closeoutDir, "top100_lane1_global_closeout_report.json"), globalReport);
  await writeText(
    path.join(closeoutDir, "top100_lane1_global_closeout_report.md"),
    [
      "# Top100 Lane1 Global Closeout",
      "",
      `- globalPass: ${globalReport.summary.globalPass}`,
      `- normalizationGatePass: ${normalizationGatePass} (rate=${(normalizationRate * 100).toFixed(2)}%)`,
      `- brands covered: ${globalReport.summary.matchedBrands}/${globalReport.summary.totalBrandsInPlan}`,
      `- totalCandidates: ${globalReport.summary.totalCandidates}`,
      `- batch pass: ${globalReport.summary.passBatches}/${globalReport.summary.totalBatches}`,
      `- aggregate improvement: ${(aggregateImprovement * 100).toFixed(2)}%`,
      `- aggregate conflict rate: ${(aggregateConflictRate * 100).toFixed(2)}%`,
      `- total conflict abs: ${totalConflicts}`,
      `- runtime patch hit delta: ${totalRuntimeHits}`,
      `- doneSeen no regression: ${doneSeenNoRegression}`,
      `- scoreVisible no regression: ${scoreVisibleNoRegression}`,
      `- scope evidence pass: ${scopeEvidencePassCount}/${totalBatches}`,
      `- unresolved fixable: ${allFixable.length}`,
      `- unresolved ceiling: ${allCeiling.length}`,
    ].join("\n") + "\n",
  );

  console.log("[top100-lane1] completed");
  console.log(JSON.stringify({
    outDir,
    totalCandidates: lane1Candidates.length,
    totalBatches,
    passBatches,
    globalPass: globalReport.summary.globalPass,
    normalizationRate,
  }, null, 2));
};

main().catch((error) => {
  console.error("[top100-lane1] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
