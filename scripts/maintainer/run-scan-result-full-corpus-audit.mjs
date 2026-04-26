#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import {
  appendJsonl,
  buildFamilyCoverageRows,
  classifyRetryOutcome,
  ensureDir,
  evaluateAiSummary,
  evaluateContentValue,
  extractCoreScoreSnapshot,
  flattenText,
  inferFamily,
  isServer5xxStatus,
  isRetryableStreamTerminationAttempt,
  latencyStats,
  loadRuntimeFamilyCatalog,
  mapWithConcurrency,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  safeText,
  sleep,
  selectProducts,
  summarizeCoreRows,
  summarizeSidecarRows,
  truncate,
  writeCsv,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const PERSONALIZATION_HEADER = JSON.stringify({
  profile: {
    goals: ["Sleep", "Energy", "Immunity", "Recovery", "Focus", "Stress Support"],
    preferredTypes: ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein"],
  },
  savedSupplements: [],
});

const SIDE_CAR_ROUTES = [
  "decision_support",
  "scan_facts",
  "ingredient_overview",
  "scientific_background",
  "product_overview_ai",
  "summary_safety",
];

const AI_ROUTES = new Set(["ingredient_overview", "scientific_background", "product_overview_ai"]);

const buildHeaders = ({ sse = false } = {}) => ({
  Accept: sse ? "text/event-stream" : "application/json",
  "Content-Type": "application/json",
  "x-auth-disabled": "1",
  "x-local-personalization": PERSONALIZATION_HEADER,
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache",
});

const fetchJson = async (url, options = {}, timeoutMs = 15_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { ok: response.ok, status: response.status, json, text, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: "", latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchSseCore = async ({ apiBaseUrl, barcode, timeoutMs }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();
  const eventsSeen = [];
  let rev0Ms = null;
  let rev1Ms = null;
  let doneMs = null;
  let terminal = null;
  let latestBundle = null;
  let latestMeta = null;
  let httpStatus = null;
  let serverError = null;
  let clientTimeout = false;
  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers: buildHeaders({ sse: true }),
      body: JSON.stringify({ barcode }),
      signal: controller.signal,
    });
    httpStatus = response.status;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { httpStatus, terminal: "HTTP_ERROR", serverError: truncate(text, 400), clientTimeout, eventsSeen, rev0Ms, rev1Ms, doneMs, latestBundle, latestMeta };
    }
    if (!response.body) return { httpStatus, terminal: "HTTP_ERROR", serverError: "missing_sse_body", clientTimeout, eventsSeen, rev0Ms, rev1Ms, doneMs, latestBundle, latestMeta };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const flush = () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      let payload = raw;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
      const elapsed = Date.now() - startedAt;
      eventsSeen.push(currentEvent);
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        latestBundle = payload;
        latestMeta = payload.meta ?? null;
        const revision = Number(payload?.meta?.revision);
        if (revision === 0 && rev0Ms == null) rev0Ms = elapsed;
        if (revision >= 1 && rev1Ms == null) rev1Ms = elapsed;
      }
      if (currentEvent === "done") {
        terminal = "DONE";
        doneMs = elapsed;
      }
      if (currentEvent === "error") {
        terminal = safeText(payload?.code ?? payload?.reasonCode ?? payload?.message) || "ERROR";
        serverError = truncate(payload?.message ?? raw, 400);
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
    return { httpStatus, terminal: terminal ?? "NO_TERMINAL", serverError, clientTimeout, eventsSeen, rev0Ms, rev1Ms, doneMs, latestBundle, latestMeta };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    clientTimeout = /timeout|abort/i.test(message);
    return { httpStatus, terminal: clientTimeout ? "CLIENT_TIMEOUT" : "REQUEST_ERROR", serverError: truncate(message, 400), clientTimeout, eventsSeen, rev0Ms, rev1Ms, doneMs, latestBundle, latestMeta };
  } finally {
    clearTimeout(timeout);
  }
};

const hasCoreScore = (bundle, detailPayload = null) => {
  return extractCoreScoreSnapshot(bundle, detailPayload).available;
};

const hasCoreCards = (bundle, detailPayload = null) => {
  const sections = bundle?.sections ?? detailPayload?.data ?? detailPayload ?? {};
  const text = flattenText(sections).join(" ");
  return Boolean(sections?.overview || sections?.ingredients || sections?.usage || sections?.safety || /overview|ingredient|warning|score/i.test(text));
};

const classifyCoreFailure = (row) => {
  if (row.httpStatus >= 500) return "server_5xx";
  if (row.clientTimeout) return "client_timeout";
  if (/product not found|not_found/i.test(String(row.serverError ?? row.terminal ?? ""))) return "data_gap_not_found";
  if (row.terminal === "STREAM_BUSY") return "STREAM_BUSY";
  if (row.terminal === "DEGRADED_EVENTLOOP") return "DEGRADED_EVENTLOOP";
  if (row.terminal && row.terminal !== "DONE" && row.terminal !== "PRODUCT_DETAIL_OK") return "terminal_state";
  if (!row.productIdentityPresent) return "blank_product_identity";
  if (!row.scoreAvailable && !row.limitedDataReason) return "blank_score";
  if (!row.coreCardsAvailable) return "blank_core_cards";
  return null;
};

const probeHealthcheck = async (url, timeoutMs = 6_000) => {
  if (!url) return { status: null, ok: null, latencyMs: null, error: "healthcheck_unavailable" };
  const response = await fetchJson(url, { headers: { Accept: "application/json, text/plain, */*" } }, timeoutMs);
  return {
    status: response.status,
    ok: Boolean(response.ok),
    latencyMs: response.latencyMs,
    error: response.error ?? (!response.ok ? truncate(response.text, 180) : null),
  };
};

const detectHealthcheckUrl = async (args) => {
  if (args.healthcheckUrl) return args.healthcheckUrl;
  const candidates = ["/api/health", "/health", "/api/status", "/status"];
  for (const candidate of candidates) {
    const url = `${args.stagingUrl}${candidate}`;
    const probe = await probeHealthcheck(url, Math.min(args.timeoutMs, 4_000));
    if (probe.ok) return url;
  }
  return null;
};

const createCoreServiceState = (args) => ({
  consecutive5xx: 0,
  serviceWindowSeq: 0,
  activeServiceWindowId: null,
  nextAllowedStartAt: 0,
  args,
});

const waitForCircuitBreaker = async (state) => {
  const waitMs = Math.max(0, Number(state?.nextAllowedStartAt ?? 0) - Date.now());
  if (waitMs > 0) await sleep(waitMs);
};

const noteCoreResultForCircuitBreaker = async (state, row) => {
  if (!state) return null;
  const status = row?.finalHttpStatus ?? row?.httpStatus;
  if (isServer5xxStatus(status)) {
    state.consecutive5xx += 1;
    if (!state.activeServiceWindowId && state.consecutive5xx >= state.args.maxConsecutive5xx) {
      state.serviceWindowSeq += 1;
      state.activeServiceWindowId = `sw-${state.serviceWindowSeq}`;
    }
    if (state.consecutive5xx >= state.args.maxConsecutive5xx && state.args.circuitBreakerSleepMs > 0) {
      state.nextAllowedStartAt = Date.now() + state.args.circuitBreakerSleepMs;
    }
    return state.activeServiceWindowId;
  }
  state.consecutive5xx = 0;
  state.activeServiceWindowId = null;
  return null;
};

const runCoreProductOnce = async ({ product, args, runOrder = null, observedLine = null, batchId = null, healthcheckStatus = null }) => {
  if (product.barcode) {
    const sse = await fetchSseCore({ apiBaseUrl: args.stagingUrl, barcode: product.barcode, timeoutMs: args.timeoutMs });
    const identity = sse.latestMeta?.productIdentity ?? null;
    const scoreSnapshot = extractCoreScoreSnapshot(sse.latestBundle);
    const row = {
      phase: "core",
      runOrder,
      observedLine,
      batchId,
      productKey: productKey(product),
      productId: product.productId,
      barcode: product.barcode,
      productName: product.productName,
      brand: product.brand,
      family: product.family,
      category: product.category,
      sourceTier: product.sourceTier,
      factsStatus: product.factsStatus,
      streamEventsSeen: [...new Set(sse.eventsSeen)],
      rev0Ms: sse.rev0Ms,
      rev1Ms: sse.rev1Ms,
      doneMs: sse.doneMs,
      terminal: sse.terminal,
      scoreAvailable: scoreSnapshot.available,
      scorePath: scoreSnapshot.path,
      scoreOverall: scoreSnapshot.overallScore,
      scoreBand: scoreSnapshot.overallBand,
      scoreModuleCount: scoreSnapshot.moduleCount,
      coreCardsAvailable: hasCoreCards(sse.latestBundle),
      productIdentityPresent: Boolean(identity?.name || identity?.brand || product.productName),
      limitedDataReason: sse.latestMeta?.terminalReason ?? (/product not found/i.test(String(sse.serverError ?? "")) ? "product_not_found" : null),
      httpStatus: sse.httpStatus,
      initialHttpStatus: sse.httpStatus,
      finalHttpStatus: sse.httpStatus,
      serverError: sse.serverError,
      clientTimeout: sse.clientTimeout,
      streamBusy: sse.terminal === "STREAM_BUSY",
      degradedEventLoop: sse.terminal === "DEGRADED_EVENTLOOP",
      fallbackTerminalState: sse.terminal && sse.terminal !== "DONE" ? sse.terminal : null,
      healthcheckStatus,
      retryCount: 0,
      failureSubtype: null,
      serviceWindowId: null,
      retryBehavior: null,
      decisionSupportDigest: sse.latestMeta?.decisionSupportDigest ?? null,
      scanFactsDigest: sse.latestMeta?.factsDigestHash ?? null,
      inlineRev1FactsOrDecisionSupport: Boolean(sse.rev1Ms != null && sse.latestBundle),
    };
    row.failureClass = classifyCoreFailure(row);
    row.pass = !row.failureClass;
    return row;
  }

  if (product.productId) {
    const response = await fetchJson(`${args.stagingUrl}/api/search/product-detail?productId=${encodeURIComponent(product.productId)}`, {
      headers: buildHeaders(),
    }, args.timeoutMs);
    const payload = response.json;
    const scoreSnapshot = extractCoreScoreSnapshot(null, payload);
    const row = {
      phase: "core",
      runOrder,
      observedLine,
      batchId,
      productKey: productKey(product),
      productId: product.productId,
      barcode: null,
      productName: product.productName,
      brand: product.brand,
      family: product.family,
      category: product.category,
      sourceTier: product.sourceTier,
      factsStatus: product.factsStatus,
      streamEventsSeen: [],
      rev0Ms: null,
      rev1Ms: response.latencyMs,
      doneMs: response.latencyMs,
      terminal: response.ok ? "PRODUCT_DETAIL_OK" : "PRODUCT_DETAIL_ERROR",
      scoreAvailable: scoreSnapshot.available,
      scorePath: scoreSnapshot.path,
      scoreOverall: scoreSnapshot.overallScore,
      scoreBand: scoreSnapshot.overallBand,
      scoreModuleCount: scoreSnapshot.moduleCount,
      coreCardsAvailable: hasCoreCards(null, payload),
      productIdentityPresent: Boolean(payload?.data?.product?.name || product.productName),
      limitedDataReason: payload?.data?.product?.coverageStatus ?? null,
      httpStatus: response.status,
      initialHttpStatus: response.status,
      finalHttpStatus: response.status,
      serverError: response.error ?? (!response.ok ? truncate(response.text, 400) : null),
      clientTimeout: /timeout/i.test(String(response.error ?? "")),
      streamBusy: false,
      degradedEventLoop: false,
      fallbackTerminalState: null,
      healthcheckStatus,
      retryCount: 0,
      failureSubtype: null,
      serviceWindowId: null,
      retryBehavior: null,
      decisionSupportDigest: payload?.data?.decisionDigest ?? null,
      scanFactsDigest: null,
      inlineRev1FactsOrDecisionSupport: Boolean(payload?.data?.decisionDigest),
    };
    row.failureClass = classifyCoreFailure(row);
    row.pass = !row.failureClass;
    return row;
  }

  return {
    phase: "core",
    runOrder,
    observedLine,
    batchId,
    productKey: productKey(product),
    productId: product.productId,
    barcode: product.barcode,
    productName: product.productName,
    brand: product.brand,
    family: product.family,
    terminal: "NOT_RUNNABLE",
    failureClass: "missing_barcode_and_product_id",
    healthcheckStatus,
    retryCount: 0,
    failureSubtype: null,
    serviceWindowId: null,
    pass: false,
  };
};

const runCoreProduct = async ({ product, args, runOrder = null, observedLine = null, batchId = null, serviceState = null }) => {
  await waitForCircuitBreaker(serviceState);
  const shouldProbeHealth = args.resolvedHealthcheckUrl && ((runOrder ?? 1) - 1) % args.batchSize === 0;
  const healthcheck = shouldProbeHealth ? await probeHealthcheck(args.resolvedHealthcheckUrl, Math.min(args.timeoutMs, 6_000)) : null;
  let row = null;
  const attempts = [];
  for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
    row = await runCoreProductOnce({
      product,
      args,
      runOrder,
      observedLine,
      batchId,
      healthcheckStatus: healthcheck?.status ?? null,
    });
    attempts.push({
      attempt,
      httpStatus: row.httpStatus,
      terminal: row.terminal,
      failureClass: row.failureClass,
      serverError: row.serverError,
      clientTimeout: row.clientTimeout,
      eventCount: Array.isArray(row.streamEventsSeen) ? row.streamEventsSeen.length : 0,
    });
    const retryable = isServer5xxStatus(row.httpStatus) || isRetryableStreamTerminationAttempt(row);
    if (!retryable) break;
    if (attempt < args.maxRetries) {
      const delayMs = args.backoffBaseMs * (2 ** attempt);
      await sleep(delayMs);
    }
  }
  const initial = attempts[0] ?? {};
  const serviceWindowId = await noteCoreResultForCircuitBreaker(serviceState, row);
  const retryCount = Math.max(0, attempts.length - 1);
  row.retryCount = retryCount;
  row.initialHttpStatus = initial.httpStatus ?? row.httpStatus ?? null;
  row.finalHttpStatus = row.httpStatus ?? null;
  row.retryBehavior = attempts;
  row.serviceWindowId = serviceWindowId;
  const retryOutcome = retryCount > 0 ? classifyRetryOutcome(attempts) : null;
  row.failureSubtype = row.failureClass === "server_5xx"
    ? (serviceWindowId ? "service_window_5xx" : retryCount > 0 ? "server_5xx_after_retry" : "single_5xx")
    : retryOutcome && retryOutcome !== "not_retried" ? retryOutcome : null;
  return row;
};

const summarizeDecisionSupportPayload = (response) => {
  const payload = response.json ?? {};
  const rows = Array.isArray(payload?.scienceBlock?.ingredientRows) ? payload.scienceBlock.ingredientRows : [];
  return {
    ok: response.ok,
    status: response.status,
    latencyMs: response.latencyMs,
    payload,
    digest: safeText(payload.digest) || null,
    decisionInputsHash: safeText(payload.decisionInputsHash) || null,
    personalizationScopeHash: safeText(payload.personalizationScopeHash) || null,
    selectedIngredientName: safeText(rows[0]?.name) || null,
    sourceType: safeText(payload.sourceType) || null,
  };
};

const FAMILY_ALIASES = new Map([
  ["tribulus", "tribulus_terrestris"],
  ["garlic", "garlic_extract"],
  ["ginger", "ginger_root"],
  ["zeaxanthin", "lutein_zeaxanthin"],
]);

const canonicalFamily = (value) => {
  const normalized = safeText(value).toLowerCase();
  return FAMILY_ALIASES.get(normalized) ?? normalized;
};

const inferRowFamilyForAudit = (row, product) =>
  canonicalFamily(
    inferFamily({
      productName: safeText(row?.name),
      brand: product.brand,
      category: product.category,
      categories: product.categories ?? [],
      ingredientRows: [{ name: safeText(row?.name), form: null }],
      activeIngredientNames: [safeText(row?.name)].filter(Boolean),
      otherIngredients: null,
    }).family,
  );

const selectFamilyAlignedIngredientRow = (product, rows) => {
  const normalizedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      name: safeText(row?.name),
      dose: safeText(row?.dose) || null,
      row,
    }))
    .filter((row) => row.name);
  if (normalizedRows.length === 0) return null;

  const productFamily = canonicalFamily(product.family);
  const familyMatch = normalizedRows.find(
    (row) => inferRowFamilyForAudit(row, product) === productFamily,
  );
  if (familyMatch) return familyMatch.row;

  const activeNames = new Set(
    (product.activeIngredientNames ?? [])
      .map((name) => safeText(name).toLowerCase())
      .filter((name) => name.length >= 4),
  );
  const activeMatch = normalizedRows.find((row) => {
    const rowName = row.name.toLowerCase();
    return [...activeNames].some(
      (name) => rowName.includes(name) || name.includes(rowName),
    );
  });
  if (activeMatch) return activeMatch.row;

  const firstRow = normalizedRows[0];
  const firstFamily = inferRowFamilyForAudit(firstRow, product);
  const firstLooksLikeSupportMineral =
    ["calcium", "magnesium", "zinc", "iron", "sodium", "potassium", "electrolyte_hydration", "vitamin_d", "vitamin_c"].includes(firstFamily)
    && productFamily
    && productFamily !== firstFamily;
  const blendRow = normalizedRows.find((row) =>
    /\b(?:blend|complex|matrix|formula|proprietary)\b/i.test(row.name),
  );
  if (firstLooksLikeSupportMineral && blendRow) return blendRow.row;

  return firstRow.row;
};

const runSidecarsForProduct = async ({ product, args }) => {
  const rows = [];
  const aiRows = [];
  const productKeyValue = productKey(product);

  if (!product.barcode) {
    const response = product.productId
      ? await fetchJson(`${args.stagingUrl}/api/search/product-detail?productId=${encodeURIComponent(product.productId)}`, { headers: buildHeaders() }, args.timeoutMs)
      : { ok: false, status: 0, latencyMs: 0, json: null, error: "missing_product_id" };
    const payload = response.json?.data ?? response.json ?? null;
    const sidecarSummaries = [
      ["ingredient_overview", payload?.ingredientOverview, payload?.ingredientOverviewSource, payload?.ingredientOverviewDiagnostics],
      ["scientific_background", payload?.scientificBackground, payload?.scientificBackgroundSource, payload?.scientificBackgroundDiagnostics],
    ];
    for (const [route, block, source, diagnostics] of sidecarSummaries) {
      const sidecar = buildSidecarRow({ product, route, response, payload: block, source, fallbackUsed: source === "fallback", fallbackReason: diagnostics?.fallbackReason ?? null });
      rows.push(sidecar);
      if (AI_ROUTES.has(route)) aiRows.push({ ...evaluateAiSummary({ type: route, product, payload: block, source, fallbackUsed: source === "fallback", fallbackReason: diagnostics?.fallbackReason ?? null }), productKey: productKeyValue, productId: product.productId, barcode: product.barcode, family: product.family, productName: product.productName, brand: product.brand });
    }
    return { rows, aiRows, decisionSupport: null, productDetail: payload };
  }

  const dsResponse = await fetchJson(`${args.stagingUrl}/api/decision-support/v1?barcode=${encodeURIComponent(product.barcode)}&viewMode=details&scanSessionId=${encodeURIComponent(`audit-${args.runId}`)}`, {
    headers: buildHeaders(),
  }, args.timeoutMs);
  const ds = summarizeDecisionSupportPayload(dsResponse);
  rows.push(buildSidecarRow({ product, route: "decision_support", response: dsResponse, payload: ds.payload, source: ds.ok ? "api" : "missing" }));

  if (!ds.ok || !ds.digest || !ds.decisionInputsHash || !ds.personalizationScopeHash) {
    for (const route of SIDE_CAR_ROUTES.filter((route) => route !== "decision_support")) {
      rows.push(buildSkippedSidecarRow(product, route, "decision_support_unavailable"));
    }
    return { rows, aiRows, decisionSupport: ds.payload, productDetail: null };
  }

  const scanFactsUrl = buildScanFactsUrl({ args, product, decisionSupport: ds });
  if (scanFactsUrl) {
    const scanFactsResponse = await fetchJson(scanFactsUrl, { headers: buildHeaders() }, args.timeoutMs);
    rows.push(buildSidecarRow({ product, route: "scan_facts", response: scanFactsResponse, payload: scanFactsResponse.json, source: scanFactsResponse.ok ? "api" : "missing" }));
  } else {
    rows.push(buildSkippedSidecarRow(product, "scan_facts", "source_id_unavailable"));
  }

  const commonBody = {
    barcode: product.barcode,
    decisionDigest: ds.digest,
    decisionInputsHash: ds.decisionInputsHash,
    personalizationScopeHash: ds.personalizationScopeHash,
    cacheOnly: !args.confirmLiveAi,
  };
  const ingredientResponse = await fetchJson(`${args.stagingUrl}/api/ingredient-overview/v1`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(commonBody),
  }, args.timeoutMs);
  rows.push(buildSidecarRow({ product, route: "ingredient_overview", response: ingredientResponse, payload: ingredientResponse.json?.ingredientOverview, source: ingredientResponse.json?.source, fallbackUsed: ingredientResponse.json?.fallbackUsed, fallbackReason: ingredientResponse.json?.fallbackReason, backgroundRefreshPending: ingredientResponse.json?.backgroundRefreshPending, recommendedRetryAfterMs: ingredientResponse.json?.recommendedRetryAfterMs }));
  aiRows.push({ ...evaluateAiSummary({ type: "ingredient_overview", product, payload: ingredientResponse.json?.ingredientOverview, source: ingredientResponse.json?.source, fallbackUsed: ingredientResponse.json?.fallbackUsed, fallbackReason: ingredientResponse.json?.fallbackReason, backgroundRefreshPending: ingredientResponse.json?.backgroundRefreshPending, recommendedRetryAfterMs: ingredientResponse.json?.recommendedRetryAfterMs }), productKey: productKeyValue, productId: product.productId, barcode: product.barcode, family: product.family, productName: product.productName, brand: product.brand });

  const selectedScientificRow = selectFamilyAlignedIngredientRow(product, ds.payload?.scienceBlock?.ingredientRows);
  const selectedScientificIngredientName =
    safeText(selectedScientificRow?.name) || ds.selectedIngredientName;
  if (selectedScientificIngredientName) {
    const scientificResponse = await fetchJson(`${args.stagingUrl}/api/scientific-background/v1`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ ...commonBody, selectedIngredientName: selectedScientificIngredientName }),
    }, args.timeoutMs);
    const sciPayload = scientificResponse.json?.scientificBackground;
    rows.push(buildSidecarRow({ product, route: "scientific_background", response: scientificResponse, payload: sciPayload, source: scientificResponse.json?.source, fallbackUsed: scientificResponse.json?.fallbackUsed, fallbackReason: scientificResponse.json?.fallbackReason, backgroundRefreshPending: scientificResponse.json?.backgroundRefreshPending, recommendedRetryAfterMs: scientificResponse.json?.recommendedRetryAfterMs, mode: sciPayload?.mode, selectedLabel: sciPayload?.selectedLabel }));
    aiRows.push({ ...evaluateAiSummary({ type: "scientific_background", product, payload: sciPayload, source: scientificResponse.json?.source, fallbackUsed: scientificResponse.json?.fallbackUsed, fallbackReason: scientificResponse.json?.fallbackReason, backgroundRefreshPending: scientificResponse.json?.backgroundRefreshPending, recommendedRetryAfterMs: scientificResponse.json?.recommendedRetryAfterMs }), productKey: productKeyValue, productId: product.productId, barcode: product.barcode, family: product.family, productName: product.productName, brand: product.brand });
  } else {
    rows.push(buildSkippedSidecarRow(product, "scientific_background", "selected_ingredient_missing"));
  }

  const productOverviewBody = buildProductOverviewAiBody({ product, decisionSupport: ds.payload });
  const productOverviewResponse = await fetchJson(`${args.stagingUrl}/api/product-overview-ai/v1`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ ...productOverviewBody, cacheOnly: !args.confirmLiveAi }),
  }, args.timeoutMs);
  rows.push(buildSidecarRow({ product, route: "product_overview_ai", response: productOverviewResponse, payload: productOverviewResponse.json?.overviewAi, source: productOverviewResponse.json?.source, fallbackUsed: productOverviewResponse.json?.fallbackUsed, fallbackReason: productOverviewResponse.json?.fallbackReason }));
  aiRows.push({ ...evaluateAiSummary({ type: "product_overview_ai", product, payload: productOverviewResponse.json?.overviewAi, source: productOverviewResponse.json?.source, fallbackUsed: productOverviewResponse.json?.fallbackUsed, fallbackReason: productOverviewResponse.json?.fallbackReason }), productKey: productKeyValue, productId: product.productId, barcode: product.barcode, family: product.family, productName: product.productName, brand: product.brand });

  rows.push(buildSkippedSidecarRow(product, "summary_safety", "monitor_only_payload_shape_not_replayed"));
  return { rows, aiRows, decisionSupport: ds.payload, productDetail: null };
};

const buildScanFactsUrl = ({ args, product, decisionSupport }) => {
  const source = decisionSupport.sourceType === "web" || !decisionSupport.sourceType ? "web" : decisionSupport.sourceType;
  const sourceId = product.productId;
  if (source === "dsld" && !/^\d+$/.test(safeText(sourceId))) return null;
  if (!source || !sourceId) return null;
  return `${args.stagingUrl}/api/scan-facts/v1/${encodeURIComponent(source)}/${encodeURIComponent(sourceId)}`;
};

const buildProductOverviewAiBody = ({ product, decisionSupport }) => {
  const ingredientRows = Array.isArray(decisionSupport?.scienceBlock?.ingredientRows) ? decisionSupport.scienceBlock.ingredientRows : [];
  const selectedPrimaryRow = selectFamilyAlignedIngredientRow(product, ingredientRows);
  const keyIngredients = ingredientRows.slice(0, 6).map((row) => ({ name: safeText(row.name) || "Ingredient", dose: safeText(row.dose) || null }));
  return {
    digest: safeText(decisionSupport?.digest) || `${productKey(product)}-audit`,
    productName: product.productName || "Supplement product",
    brandName: product.brand ?? null,
    productTypeHint: product.category ?? product.family ?? null,
    primaryIngredient:
      safeText(selectedPrimaryRow?.name) ||
      keyIngredients[0]?.name ||
      product.activeIngredientNames?.[0] ||
      null,
    keyIngredients: keyIngredients.length ? keyIngredients : (product.activeIngredients ?? []).slice(0, 6).map((row) => ({ name: row.name, dose: [row.amount, row.unit].filter(Boolean).join(" ") || null })),
    sourceContextHint: product.sourceTier ?? null,
    chemicalFormHint: product.activeIngredients?.find((row) => row.form)?.form ?? null,
    allIngredientRows: (product.activeIngredients ?? []).slice(0, 12).map((row) => ({ name: row.name, dose: [row.amount, row.unit].filter(Boolean).join(" ") || null })),
    descriptionHighlights: [],
    warningHighlights: product.warnings ? [truncate(product.warnings, 180)] : [],
    strengthClaim: null,
    servingStrength: null,
    form: null,
    count: null,
    isLikelySingleIngredient: (product.activeIngredients ?? []).length === 1,
  };
};

const buildSidecarRow = ({ product, route, response, payload, source = null, fallbackUsed = false, fallbackReason = null, backgroundRefreshPending = false, recommendedRetryAfterMs = null, mode = null, selectedLabel = null }) => {
  const text = flattenText(payload ?? response?.json).join(" ");
  const visibleUnavailableText = route === "decision_support"
    ? Boolean(response?.ok && payload == null)
    : route === "scan_facts"
      ? false
      : /\b(?:unavailable|not available|undefined|null|\[object Object\])\b/i.test(text) || !text;
  const status = response?.ok ? (payload == null && route !== "decision_support" && route !== "scan_facts" ? "unavailable" : "ready") : "error";
  return {
    phase: "sidecar",
    productKey: productKey(product),
    productId: product.productId,
    barcode: product.barcode,
    productName: product.productName,
    brand: product.brand,
    family: product.family,
    route,
    priority: route === "decision_support" || route === "scan_facts" ? "core" : route === "summary_safety" ? "monitor" : "deferred",
    status,
    source: source ?? (response?.ok ? "api" : "missing"),
    fallbackUsed: Boolean(fallbackUsed),
    fallbackReason: fallbackReason ?? null,
    backgroundRefreshPending: Boolean(backgroundRefreshPending),
    recommendedRetryAfterMs: recommendedRetryAfterMs ?? null,
    latencyMs: response?.latencyMs ?? null,
    cacheStatus: null,
    digestInputMismatch: response?.status === 409,
    responseShapeValid: response?.ok && !visibleUnavailableText,
    visibleUnavailableText,
    userVisibleFieldCompleteness: visibleUnavailableText ? 0 : text.length > 500 ? 3 : text.length > 120 ? 2 : 1,
    httpStatus: response?.status ?? null,
    error: response?.error ?? (!response?.ok ? truncate(response?.text, 300) : null),
    mode,
    selectedLabel,
    genericCopyScore: text && !new RegExp(product.family.replace(/_/g, "[ _-]"), "i").test(text) ? 1 : 0,
    pass: Boolean(response?.ok && !visibleUnavailableText),
  };
};

const buildSkippedSidecarRow = (product, route, reason) => ({
  phase: "sidecar",
  productKey: productKey(product),
  productId: product.productId,
  barcode: product.barcode,
  productName: product.productName,
  brand: product.brand,
  family: product.family,
  route,
  priority: route === "decision_support" || route === "scan_facts" ? "core" : route === "summary_safety" ? "monitor" : "deferred",
  status: "skipped",
  source: "missing",
  fallbackUsed: false,
  fallbackReason: reason,
  backgroundRefreshPending: false,
  recommendedRetryAfterMs: null,
  latencyMs: null,
  cacheStatus: null,
  digestInputMismatch: false,
  responseShapeValid: null,
  visibleUnavailableText: false,
  userVisibleFieldCompleteness: null,
  httpStatus: null,
  error: null,
  mode: null,
  selectedLabel: null,
  genericCopyScore: null,
  pass: null,
});

const readCompletedKeys = async (filePath, phase) => {
  const rows = await readJsonl(filePath);
  return new Set(rows.filter((row) => row.phase === phase).map((row) => `${row.productKey}:${row.route ?? phase}`));
};

const renderCoreSummary = (summary, rows) => {
  const worstDone = [...rows].sort((a, b) => Number(b.doneMs ?? -1) - Number(a.doneMs ?? -1)).slice(0, 25);
  const missingCore = rows.filter((row) => !row.scoreAvailable || !row.coreCardsAvailable || !row.productIdentityPresent).slice(0, 25);
  return [
    "# Core Scan Contract Summary",
    "",
    `- total: ${summary.total}`,
    `- pass: ${summary.pass}`,
    `- fail: ${summary.fail}`,
    `- score available rate: ${summary.scoreAvailableRate}%`,
    `- core cards available rate: ${summary.coreCardsAvailableRate}%`,
    `- rev0 p50/p75/p95/p99: ${summary.rev0Ms.p50}/${summary.rev0Ms.p75}/${summary.rev0Ms.p95}/${summary.rev0Ms.p99}`,
    `- rev1 p50/p75/p95/p99: ${summary.rev1Ms.p50}/${summary.rev1Ms.p75}/${summary.rev1Ms.p95}/${summary.rev1Ms.p99}`,
    `- done p50/p75/p95/p99: ${summary.doneMs.p50}/${summary.doneMs.p75}/${summary.doneMs.p95}/${summary.doneMs.p99}`,
    "",
    "## Failure Classes",
    ...Object.entries(summary.failureClasses).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Worst 25 Products By Done Ms",
    ...worstDone.map((row) => `- ${row.doneMs ?? "n/a"}ms | ${row.family} | ${row.brand ?? ""} ${row.productName ?? ""} | ${row.barcode ?? row.productId}`),
    "",
    "## Worst 25 Products By Missing Core Fields",
    ...missingCore.map((row) => `- ${row.failureClass ?? "missing_core"} | score=${row.scoreAvailable} cards=${row.coreCardsAvailable} identity=${row.productIdentityPresent} | ${row.family} | ${row.productName ?? row.productId}`),
    "",
  ].join("\n");
};

const renderSidecarSummary = (summary) => [
  "# Sidecar Contract Summary",
  "",
  `- total rows: ${summary.total}`,
  `- latency p50/p95/p99: ${summary.latencyMs.p50}/${summary.latencyMs.p95}/${summary.latencyMs.p99}`,
  "",
  "## By Status",
  ...Object.entries(summary.byStatus).map(([key, count]) => `- ${key}: ${count}`),
  "",
  "## By Source",
  ...Object.entries(summary.bySource).map(([key, count]) => `- ${key}: ${count}`),
  "",
  "## Fallback Reasons",
  ...Object.entries(summary.byFallbackReason).map(([key, count]) => `- ${key}: ${count}`),
  "",
].join("\n");

const renderAiSummary = (aiRows) => {
  const totalByType = {};
  const fallbackByType = {};
  const unavailableByType = {};
  for (const row of aiRows) {
    totalByType[row.type] = (totalByType[row.type] ?? 0) + 1;
    if (row.fallbackUsed || row.source === "fallback") fallbackByType[row.type] = (fallbackByType[row.type] ?? 0) + 1;
    if (row.visibleUnavailableText) unavailableByType[row.type] = (unavailableByType[row.type] ?? 0) + 1;
  }
  const worst = [...aiRows].sort((a, b) => (a.severity ?? "P9").localeCompare(b.severity ?? "P9") || (b.genericCopyScore ?? 0) - (a.genericCopyScore ?? 0)).slice(0, 50);
  return [
    "# AI Summary Audit Summary",
    "",
    "## Fallback Rate By Type",
    ...Object.entries(totalByType).map(([type, total]) => `- ${type}: ${fallbackByType[type] ?? 0}/${total}`),
    "",
    "## Unavailable Rate By Type",
    ...Object.entries(totalByType).map(([type, total]) => `- ${type}: ${unavailableByType[type] ?? 0}/${total}`),
    "",
    "## Top 50 Worst AI Summary Quality Products",
    ...worst.map((row) => `- ${row.severity} | ${row.type} | ${row.family} | ${row.productName ?? row.productId} | source=${row.source} reason=${row.fallbackReason ?? "none"} | ${row.preview ?? ""}`),
    "",
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), { mode: "full", concurrency: 2 });
  await ensureDir(args.runDir);
  const manifest = await readJson(args.manifestPath);
  const runtimeFamilyCatalog = await loadRuntimeFamilyCatalog();
  const familyCatalog = runtimeFamilyCatalog;
  const products = selectProducts(manifest.products ?? [], args);
  const manifestOrder = new Map();
  (manifest.products ?? []).forEach((product, index) => {
    const key = productKey(product);
    manifestOrder.set(`${key}::${safeText(product.productId)}`, index + 1);
    if (!manifestOrder.has(key)) manifestOrder.set(key, index + 1);
  });
  const corePath = path.join(args.runDir, "core-results.jsonl");
  const sidecarPath = path.join(args.runDir, "sidecar-results.jsonl");
  const aiPath = path.join(args.runDir, "ai-summary-audit.jsonl");
  console.error(`[scan-result-full-corpus-audit] runId=${args.runId} mode=${args.mode} selected=${products.length} concurrency=${args.concurrency} confirmLiveAi=${args.confirmLiveAi}`);

  if (["core", "full", "performance"].includes(args.mode)) {
    const completed = args.resume ? await readCompletedKeys(corePath, "core") : new Set();
    const existingCoreRows = args.resume ? await readJsonl(corePath) : [];
    let appendedCoreRows = 0;
    args.resolvedHealthcheckUrl = args.dryRun ? null : await detectHealthcheckUrl(args);
    const pending = products.filter((product) => !completed.has(`${productKey(product)}:core`));
    if (args.dryRun) {
      await writeJson(path.join(args.runDir, "core-dry-run.json"), { selected: products.length, pending: pending.length, sample: pending.slice(0, 10) });
    } else {
      const serviceState = createCoreServiceState(args);
      await mapWithConcurrency(pending, args.concurrency, async (product, index) => {
        console.error(`[core] ${index + 1}/${pending.length} ${product.family} ${product.brand ?? ""} ${product.productName ?? product.productId}`);
        const key = productKey(product);
        const runOrder = manifestOrder.get(`${key}::${safeText(product.productId)}`) ?? manifestOrder.get(key) ?? index + 1;
        const batchId = Math.floor((runOrder - 1) / args.batchSize) + 1;
        const observedLine = existingCoreRows.length + appendedCoreRows + 1;
        appendedCoreRows += 1;
        const row = await runCoreProduct({ product, args, runOrder, observedLine, batchId, serviceState });
        await appendJsonl(corePath, row);
      });
    }
  }

  if (["sidecar", "full", "ai", "ux"].includes(args.mode)) {
    const completed = args.resume ? await readCompletedKeys(sidecarPath, "sidecar") : new Set();
    const pending = products.filter((product) => SIDE_CAR_ROUTES.some((route) => !completed.has(`${productKey(product)}:${route}`)));
    if (args.dryRun) {
      await writeJson(path.join(args.runDir, "sidecar-dry-run.json"), { selected: products.length, pending: pending.length, confirmLiveAi: args.confirmLiveAi, estimatedLiveAiCalls: args.confirmLiveAi ? pending.length * 3 : 0 });
    } else {
      await mapWithConcurrency(pending, args.concurrency, async (product, index) => {
        console.error(`[sidecar] ${index + 1}/${pending.length} ${product.family} ${product.brand ?? ""} ${product.productName ?? product.productId}`);
        const result = await runSidecarsForProduct({ product, args });
        for (const row of result.rows) await appendJsonl(sidecarPath, row);
        for (const row of result.aiRows) await appendJsonl(aiPath, row);
      });
    }
  }

  const coreRows = await readJsonl(corePath);
  const sidecarRows = await readJsonl(sidecarPath);
  const aiRows = await readJsonl(aiPath);

  if (coreRows.length > 0) {
    const summary = summarizeCoreRows(coreRows);
    await writeCsv(path.join(args.runDir, "core-results.csv"), coreRows);
    await writeText(path.join(args.runDir, "core-contract-summary.md"), renderCoreSummary(summary, coreRows));
  }
  if (sidecarRows.length > 0) {
    const summary = summarizeSidecarRows(sidecarRows);
    await writeCsv(path.join(args.runDir, "sidecar-results.csv"), sidecarRows);
    await writeText(path.join(args.runDir, "sidecar-contract-summary.md"), renderSidecarSummary(summary));
  }
  if (aiRows.length > 0) {
    await writeJson(path.join(args.runDir, "ai-summary-audit.json"), { reportType: "ai_summary_audit", generatedAt: new Date().toISOString(), rows: aiRows });
    await writeCsv(path.join(args.runDir, "ai-summary-audit.csv"), aiRows);
    await writeText(path.join(args.runDir, "ai-summary-summary.md"), renderAiSummary(aiRows));
    await writeText(path.join(args.runDir, "ai-summary-p0-p1-failures.md"), renderAiSummary(aiRows.filter((row) => row.severity === "P0" || row.severity === "P1")));
  }

  if (sidecarRows.length > 0 || coreRows.length > 0) {
    const contentRows = products.map((product) => ({
      productKey: productKey(product),
      productId: product.productId,
      barcode: product.barcode,
      productName: product.productName,
      brand: product.brand,
      family: product.family,
      ...evaluateContentValue({ product }),
    }));
    await writeCsv(path.join(args.runDir, "content-value-scores.csv"), contentRows);
    await writeJson(path.join(args.runDir, "content-value-scores.json"), { reportType: "content_value_scores", generatedAt: new Date().toISOString(), rows: contentRows });
    const familyRows = buildFamilyCoverageRows({ products: manifest.products ?? [], coreRows, sidecarRows, contentRows, catalog: familyCatalog });
    await writeCsv(path.join(args.runDir, "family-coverage-matrix.csv"), familyRows);
    await writeJson(path.join(args.runDir, "family-coverage-matrix.json"), { reportType: "family_coverage_matrix", generatedAt: new Date().toISOString(), rows: familyRows });
    await writeText(path.join(args.runDir, "family-coverage-summary.md"), renderFamilyCoverageSummary(familyRows));
    await writeText(path.join(args.runDir, "family-gap-priority-list.md"), renderFamilyGapPriorityList(familyRows));
    await writeJson(path.join(args.runDir, "ux-issues.json"), { rows: buildUxIssues({ coreRows, sidecarRows, aiRows, contentRows }) });
    await writeText(path.join(args.runDir, "ux-issues.md"), renderUxIssues(buildUxIssues({ coreRows, sidecarRows, aiRows, contentRows })));
    await writeText(path.join(args.runDir, "ux-priority-fixes.md"), renderUxIssues(buildUxIssues({ coreRows, sidecarRows, aiRows, contentRows }).filter((row) => row.severity === "P0" || row.severity === "P1")));
  }

  if (coreRows.length > 0) {
    await writeText(path.join(args.runDir, "performance-summary.md"), renderPerformanceSummary(coreRows, sidecarRows));
    await writeCsv(path.join(args.runDir, "performance-by-family.csv"), buildPerformanceByFamily(coreRows));
    await writeText(path.join(args.runDir, "performance-worst-products.md"), renderWorstPerformance(coreRows));
    await writeText(path.join(args.runDir, "repeat-consistency-summary.md"), "# Repeat Consistency Summary\n\n- Warm repeat was not run by this pass unless the command was executed twice with the same run id and `--resume`.\n- Use the same manifest and a subset/family filter to compare cold-ish and warm rows.\n");
  }

  console.log(`[scan-result-full-corpus-audit] complete runId=${args.runId} out=${args.runDir}`);
};

const renderFamilyCoverageSummary = (rows) => [
  "# Family Coverage Summary",
  "",
  `- families: ${rows.length}`,
  `- families with products: ${rows.filter((row) => row.product_count > 0).length}`,
  `- families with dedicated plan signal: ${rows.filter((row) => row.dedicated_plan_exists).length}`,
  `- families with reviewed evidence signal: ${rows.filter((row) => row.reviewed_evidence_exists).length}`,
  "",
  "## Top Product Families",
  ...rows.filter((row) => row.product_count > 0).sort((a, b) => b.product_count - a.product_count).slice(0, 40).map((row) => `- ${row.family}: products=${row.product_count} scanned=${row.scanned_count} genericFallback=${row.generic_fallback_count} avgValue=${row.average_content_value_score ?? "n/a"}`),
  "",
].join("\n");

const renderFamilyGapPriorityList = (rows) => [
  "# Family Gap Priority List",
  "",
  ...rows
    .filter((row) => row.product_count > 0 && (!row.dedicated_plan_exists || !row.reviewed_evidence_exists))
    .sort((a, b) => (b.generic_fallback_count - a.generic_fallback_count) || (b.product_count - a.product_count))
    .slice(0, 80)
    .map((row) => `- ${row.family}: products=${row.product_count}, plan=${row.dedicated_plan_exists}, evidence=${row.reviewed_evidence_exists}, unavailable=${row.unavailable_count}, topMissing=${row.top_missing_data_reason ?? "none"}`),
  "",
].join("\n");

const buildUxIssues = ({ coreRows, sidecarRows, aiRows, contentRows }) => {
  const issues = [];
  const hasCoreRows = coreRows.length > 0;
  for (const row of coreRows) {
    if (!row.productIdentityPresent) issues.push({ severity: "P0", productKey: row.productKey, family: row.family, issue: "blank_product_identity" });
    if (!row.scoreAvailable && !row.limitedDataReason) issues.push({ severity: "P0", productKey: row.productKey, family: row.family, issue: "blank_score_without_limited_data_reason" });
    if (!row.coreCardsAvailable) issues.push({ severity: "P0", productKey: row.productKey, family: row.family, issue: "blank_core_cards" });
  }
  for (const row of sidecarRows) {
    if (row.visibleUnavailableText) issues.push({ severity: "P0", productKey: row.productKey, family: row.family, issue: `${row.route}_visible_unavailable` });
    if (row.route === "scientific_background" && row.pass === true && row.genericCopyScore >= 1) issues.push({ severity: "P1", productKey: row.productKey, family: row.family, issue: "scientific_background_may_be_generic" });
  }
  for (const row of aiRows) {
    if (row.severity === "P0" || row.severity === "P1") issues.push({ severity: row.severity, productKey: row.productKey, family: row.family, issue: `${row.type}_${row.severity.toLowerCase()}_quality`, preview: row.preview });
  }
  for (const row of contentRows) {
    if (hasCoreRows && Number(row.overall_scan_result_value_score) < 45) issues.push({ severity: "P1", productKey: row.productKey, family: row.family, issue: "low_overall_content_value", score: row.overall_scan_result_value_score });
  }
  return issues;
};

const renderUxIssues = (issues) => [
  "# UX Issues",
  "",
  `- total: ${issues.length}`,
  ...issues.slice(0, 120).map((row) => `- ${row.severity} | ${row.family ?? "unknown"} | ${row.productKey} | ${row.issue}${row.score != null ? ` | score=${row.score}` : ""}`),
  "",
].join("\n");

const renderPerformanceSummary = (coreRows, sidecarRows) => [
  "# Performance Summary",
  "",
  `- core rev0 p50/p95/p99: ${latencyStats(coreRows.map((row) => row.rev0Ms)).p50}/${latencyStats(coreRows.map((row) => row.rev0Ms)).p95}/${latencyStats(coreRows.map((row) => row.rev0Ms)).p99}`,
  `- core rev1 p50/p95/p99: ${latencyStats(coreRows.map((row) => row.rev1Ms)).p50}/${latencyStats(coreRows.map((row) => row.rev1Ms)).p95}/${latencyStats(coreRows.map((row) => row.rev1Ms)).p99}`,
  `- core done p50/p95/p99: ${latencyStats(coreRows.map((row) => row.doneMs)).p50}/${latencyStats(coreRows.map((row) => row.doneMs)).p95}/${latencyStats(coreRows.map((row) => row.doneMs)).p99}`,
  `- sidecar latency p50/p95/p99: ${latencyStats(sidecarRows.map((row) => row.latencyMs)).p50}/${latencyStats(sidecarRows.map((row) => row.latencyMs)).p95}/${latencyStats(sidecarRows.map((row) => row.latencyMs)).p99}`,
  `- server 5xx count: ${coreRows.filter((row) => row.httpStatus >= 500).length}`,
  `- client timeout count: ${coreRows.filter((row) => row.clientTimeout).length}`,
  `- STREAM_BUSY count: ${coreRows.filter((row) => row.streamBusy).length}`,
  `- DEGRADED_EVENTLOOP count: ${coreRows.filter((row) => row.degradedEventLoop).length}`,
  "",
].join("\n");

const buildPerformanceByFamily = (coreRows) => Object.entries(coreRows.reduce((map, row) => {
  const key = row.family ?? "unknown";
  const list = map[key] ?? [];
  list.push(row);
  map[key] = list;
  return map;
}, {})).map(([family, rows]) => ({
  family,
  count: rows.length,
  rev1_p95: latencyStats(rows.map((row) => row.rev1Ms)).p95,
  done_p95: latencyStats(rows.map((row) => row.doneMs)).p95,
  pass_rate: rows.length ? Math.round((rows.filter((row) => row.pass).length / rows.length) * 1000) / 10 : 0,
}));

const renderWorstPerformance = (coreRows) => [
  "# Performance Worst Products",
  "",
  ...[...coreRows].sort((a, b) => Number(b.doneMs ?? -1) - Number(a.doneMs ?? -1)).slice(0, 50).map((row) => `- ${row.doneMs ?? "n/a"}ms | ${row.family} | ${row.brand ?? ""} ${row.productName ?? ""} | ${row.barcode ?? row.productId} | terminal=${row.terminal}`),
  "",
].join("\n");

main().catch((error) => {
  console.error("[scan-result-full-corpus-audit] failed", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
