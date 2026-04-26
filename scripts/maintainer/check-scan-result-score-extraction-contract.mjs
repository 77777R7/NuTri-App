#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import {
  attachRunOrder,
  ensureDir,
  extractCoreScoreSnapshot,
  normalizeBarcode,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  safeText,
  truncate,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const DEFAULT_RUN_ID = "scan-result-full-corpus-core-20260425";
const DEFAULT_MANIFEST = "output/scan-result-full-corpus-audit/codex-full-corpus-manifest-20260425-v3/manifest.json";

const PERSONALIZATION_HEADER = JSON.stringify({
  profile: { goals: ["Sleep", "Energy", "Immunity", "Recovery", "Focus", "Stress Support"] },
  savedSupplements: [],
});

const headers = (sse = false) => ({
  Accept: sse ? "text/event-stream" : "application/json",
  "Content-Type": "application/json",
  "x-auth-disabled": "1",
  "x-local-personalization": PERSONALIZATION_HEADER,
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache",
});

const collectBarcodeStrings = (value, out = new Set()) => {
  if (typeof value === "string") {
    const matches = value.match(/\b\d{8,14}\b/g) ?? [];
    for (const match of matches) out.add(normalizeBarcode(match));
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectBarcodeStrings(item, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectBarcodeStrings(item, out));
  }
  return out;
};

const loadSmokeBarcodes = async () => {
  const files = [
    "data/validation/mobile-scan-smoke-mini.v0.json",
    "data/validation/scan-smoke.v0.json",
  ];
  const out = new Set();
  for (const rel of files) {
    try {
      const json = JSON.parse(await fs.readFile(path.join(process.cwd(), rel), "utf8"));
      for (const barcode of collectBarcodeStrings(json)) if (barcode) out.add(barcode);
    } catch {}
  }
  return out;
};

const findScoreCandidatePaths = (value, pathPrefix = "payload", out = []) => {
  if (!value || typeof value !== "object") return out;
  if (value.nutriScoreCardV2 && typeof value.nutriScoreCardV2 === "object") {
    const snapshot = extractCoreScoreSnapshot({ nutriScoreCardV2: value.nutriScoreCardV2 });
    out.push({ path: `${pathPrefix}.nutriScoreCardV2`, ...snapshot });
  }
  if (value.scoreCardV2 && typeof value.scoreCardV2 === "object") {
    out.push({ path: `${pathPrefix}.scoreCardV2`, valueKeys: Object.keys(value.scoreCardV2).slice(0, 20) });
  }
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== "object") continue;
    if (out.length > 40) return out;
    findScoreCandidatePaths(child, `${pathPrefix}.${key}`, out);
  }
  return out;
};

const fetchJson = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { headers: headers(false), signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, text, json, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: 0, text: "", json: null, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchSse = async ({ args, barcode }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${args.timeoutMs}ms`)), args.timeoutMs);
  const startedAt = Date.now();
  const payloads = [];
  let latestBundle = null;
  let terminal = null;
  let httpStatus = null;
  let serverError = null;
  let rev1Ms = null;
  let doneMs = null;
  try {
    const response = await fetch(`${args.stagingUrl}/api/enrich-stream`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ barcode }),
      signal: controller.signal,
    });
    httpStatus = response.status;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { httpStatus, terminal: "HTTP_ERROR", serverError: truncate(text, 800), latestBundle, payloads, rev1Ms, doneMs };
    }
    if (!response.body) return { httpStatus, terminal: "HTTP_ERROR", serverError: "missing_sse_body", latestBundle, payloads, rev1Ms, doneMs };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const flush = () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      let payload = raw;
      try { payload = raw ? JSON.parse(raw) : null; } catch {}
      const elapsed = Date.now() - startedAt;
      payloads.push({ event: currentEvent, elapsedMs: elapsed, payload });
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        latestBundle = payload;
        if (Number(payload?.meta?.revision) >= 1 && rev1Ms == null) rev1Ms = elapsed;
      }
      if (currentEvent === "done") {
        terminal = "DONE";
        doneMs = elapsed;
      }
      if (currentEvent === "error") {
        terminal = safeText(payload?.code ?? payload?.reasonCode ?? payload?.message) || "ERROR";
        serverError = truncate(payload?.message ?? raw, 800);
      }
      currentEvent = null;
      currentData = "";
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          flush();
          if (terminal === "DONE") break;
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) currentData += line.slice(5).trim();
      }
      if (terminal === "DONE") break;
    }
    flush();
    return { httpStatus, terminal: terminal ?? "NO_TERMINAL", serverError, latestBundle, payloads, rev1Ms, doneMs };
  } catch (error) {
    return { httpStatus, terminal: /timeout|abort/i.test(String(error?.message ?? error)) ? "CLIENT_TIMEOUT" : "REQUEST_ERROR", serverError: error instanceof Error ? error.message : String(error), latestBundle, payloads, rev1Ms, doneMs };
  } finally {
    clearTimeout(timeout);
  }
};

const addSample = (map, group, row, max) => {
  if (!row || map.get(group)?.length >= max) return;
  const key = `${group}:${row.productKey}`;
  if ([...(map.get(group) ?? [])].some((item) => `${group}:${item.productKey}` === key)) return;
  const rows = map.get(group) ?? [];
  rows.push({ ...row, sampleGroup: group });
  map.set(group, rows);
};

const selectSamples = async ({ rows, manifestProducts }) => {
  const sample = new Map();
  const smokeBarcodes = await loadSmokeBarcodes();
  const byBarcode = new Map(rows.filter((row) => row.barcode).map((row) => [normalizeBarcode(row.barcode), row]));
  for (const barcode of smokeBarcodes) addSample(sample, "ui_mobile_smoke_expected_score", byBarcode.get(barcode), 20);
  if ((sample.get("ui_mobile_smoke_expected_score") ?? []).length < 20) {
    for (const row of rows.filter((item) => item.pass === true && item.coreCardsAvailable === true)) addSample(sample, "ui_mobile_smoke_expected_score", row, 20);
  }
  for (const row of rows.filter((item) => item.failureClass === "blank_score")) addSample(sample, "blank_score", row, 20);
  for (const row of rows.filter((item) => item.pass === true && item.scoreAvailable === false)) addSample(sample, "passing_score_false", row, 20);
  for (const row of rows.filter((item) => !item.barcode && item.scoreAvailable === true)) addSample(sample, "product_id_score_true", row, 10);
  if ((sample.get("product_id_score_true") ?? []).length < 10) {
    const productByKey = new Map(manifestProducts.map((product) => [productKey(product), product]));
    for (const row of rows.filter((item) => !item.barcode)) {
      const product = productByKey.get(row.productKey) ?? row;
      addSample(sample, "product_id_score_true", { ...row, ...product }, 10);
    }
  }
  return [...sample.values()].flat();
};

const renderReport = ({ args, rows }) => {
  const byGroup = rows.reduce((acc, row) => {
    acc[row.sampleGroup] = acc[row.sampleGroup] ?? { total: 0, rawScoreFound: 0, frontendInlinePathFound: 0, originalFalseButRawFound: 0 };
    acc[row.sampleGroup].total += 1;
    if (row.rawScoreFound) acc[row.sampleGroup].rawScoreFound += 1;
    if (row.frontendInlinePathFound) acc[row.sampleGroup].frontendInlinePathFound += 1;
    if (row.originalScoreAvailable === false && row.rawScoreFound) acc[row.sampleGroup].originalFalseButRawFound += 1;
    return acc;
  }, {});
  const falsePositiveLikely = rows.filter((row) => row.originalScoreAvailable === false && row.rawScoreFound);
  const service5xxRows = rows.filter((row) => Number(row.httpStatus) >= 500);
  const serviceBlocked = rows.length > 0 && service5xxRows.length / rows.length >= 0.5;
  return [
    "# Score Extraction Contract Report",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- runId: ${args.runId}`,
    `- stagingUrl: ${args.stagingUrl}`,
    `- sample rows: ${rows.length}`,
    `- original scoreAvailable=false but raw score found: ${falsePositiveLikely.length}`,
    `- service_5xx rows during sample: ${service5xxRows.length}`,
    `- score extraction status: ${serviceBlocked ? "blocked_by_service_5xx_window" : "sample_completed"}`,
    "- frontend contract checked: `decisionTemplatePayload?.nutriScoreCardV2?.overallScore` and inline decision-support score paths.",
    "",
    "## By Sample Group",
    ...Object.entries(byGroup).map(([group, stats]) => `- ${group}: total=${stats.total} rawScoreFound=${stats.rawScoreFound} frontendInlinePathFound=${stats.frontendInlinePathFound} originalFalseButRawFound=${stats.originalFalseButRawFound}`),
    "",
    "## Interpretation",
    serviceBlocked
      ? "- This score extraction run is blocked by a live service 5xx window. Do not classify these rows as score bugs until the core route is healthy and the same sample is replayed."
      : falsePositiveLikely.length > 0
      ? "- Harness extraction was likely undercounting score availability for at least part of the corpus; update extraction to include inline decision-support `nutriScoreCardV2` paths."
      : "- This sample did not prove a harness-only score extraction miss; rows without raw score should be treated as possible backend score contract gaps.",
    "",
    "## Sample Rows",
    ...rows.map((row) => `- ${row.sampleGroup} | ${row.productKey} | original=${row.originalScoreAvailable} raw=${row.rawScoreFound} path=${row.primaryScorePath ?? "none"} status=${row.httpStatus}/${row.terminal}`),
    "",
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), {
    runId: DEFAULT_RUN_ID,
    manifestPath: DEFAULT_MANIFEST,
    mode: "score-extraction-contract",
    concurrency: 1,
    timeoutMs: 45_000,
  });
  await ensureDir(args.runDir);
  const manifest = await readJson(args.manifestPath);
  const coreRows = attachRunOrder(await readJsonl(path.join(args.runDir, "core-results.jsonl")), manifest.products ?? []);
  let samples = await selectSamples({ rows: coreRows, manifestProducts: manifest.products ?? [] });
  if (args.limit) samples = samples.slice(0, args.limit);
  if (args.dryRun) {
    await writeJson(path.join(args.runDir, "score-extraction-sample-dry-run.json"), { selected: samples.length, samples });
    console.log(`[score-extraction-contract] dry-run selected=${samples.length}`);
    return;
  }
  const jsonlPath = path.join(args.runDir, "score-extraction-sample.jsonl");
  if (args.resume) {
    const existingRows = await readJsonl(jsonlPath);
    if (existingRows.length > 0) {
      await writeText(path.join(args.runDir, "score-extraction-contract-report.md"), renderReport({ args, rows: existingRows }));
      console.log(`[score-extraction-contract] resume regenerated report rows=${existingRows.length}`);
      return;
    }
  }
  const outRows = [];
  let consecutive5xx = 0;
  for (const [index, sample] of samples.entries()) {
    if (consecutive5xx >= args.maxConsecutive5xx && args.circuitBreakerSleepMs > 0) {
      console.error(`[score-extraction-contract] circuit breaker sleeping ${args.circuitBreakerSleepMs}ms after ${consecutive5xx} consecutive 5xx`);
      await new Promise((resolve) => setTimeout(resolve, args.circuitBreakerSleepMs));
      consecutive5xx = 0;
    }
    console.error(`[score-extraction-contract] ${index + 1}/${samples.length} ${sample.sampleGroup} ${sample.productKey}`);
    let response;
    let scoreSnapshot;
    let candidatePaths = [];
    if (sample.barcode) {
      response = await fetchSse({ args, barcode: sample.barcode });
      scoreSnapshot = extractCoreScoreSnapshot(response.latestBundle);
      candidatePaths = response.payloads.flatMap((entry) => findScoreCandidatePaths(entry.payload, `event:${entry.event}`));
    } else if (sample.productId) {
      response = await fetchJson(`${args.stagingUrl}/api/search/product-detail?productId=${encodeURIComponent(sample.productId)}`, args.timeoutMs);
      scoreSnapshot = extractCoreScoreSnapshot(null, response.json);
      candidatePaths = findScoreCandidatePaths(response.json, "productDetail");
    } else {
      response = { status: null, terminal: "NOT_RUNNABLE", serverError: "missing_barcode_and_product_id" };
      scoreSnapshot = { available: false, path: null };
    }
    const frontendInlinePathFound = candidatePaths.some((item) => /decisionSupportInline\.nutriScoreCardV2|decisionTemplatePayload\.nutriScoreCardV2|nutriScoreCardV2/.test(item.path));
    outRows.push({
      sampleGroup: sample.sampleGroup,
      productKey: sample.productKey,
      productId: sample.productId,
      barcode: sample.barcode,
      productName: sample.productName,
      brand: sample.brand,
      family: sample.family,
      sourceTier: sample.sourceTier,
      factsStatus: sample.factsStatus,
      originalScoreAvailable: sample.scoreAvailable,
      originalFailureClass: sample.failureClass,
      httpStatus: response.httpStatus ?? response.status ?? null,
      terminal: response.terminal ?? null,
      serverError: response.serverError ?? response.error ?? null,
      rev1Ms: response.rev1Ms ?? null,
      doneMs: response.doneMs ?? null,
      rawScoreFound: Boolean(scoreSnapshot.available || candidatePaths.length),
      primaryScorePath: scoreSnapshot.path ?? candidatePaths[0]?.path ?? null,
      frontendInlinePathFound,
      scoreOverall: scoreSnapshot.overallScore ?? null,
      scoreBand: scoreSnapshot.overallBand ?? null,
      scoreModuleCount: scoreSnapshot.moduleCount ?? null,
      candidateScorePaths: candidatePaths.slice(0, 20),
    });
    const last = outRows.at(-1);
    consecutive5xx = Number(last.httpStatus) >= 500 ? consecutive5xx + 1 : 0;
  }
  await writeJson(path.join(args.runDir, "score-extraction-sample.jsonl.json"), { rows: outRows });
  await writeText(jsonlPath, outRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  await writeText(path.join(args.runDir, "score-extraction-contract-report.md"), renderReport({ args, rows: outRows }));
  console.log(`[score-extraction-contract] complete selected=${outRows.length}`);
};

main().catch((error) => {
  console.error("[score-extraction-contract] failed", error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
