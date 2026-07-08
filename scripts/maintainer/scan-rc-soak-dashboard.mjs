#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_API_BASE_URL = "https://nutri-app-qn0u.onrender.com";
const DEFAULT_MIN_STREAMS = 100;
const DEFAULT_MIN_SCORE_EVENTS = 25;

const args = process.argv.slice(2);

const getArg = (flag, fallback = "") => {
  const inline = args.find((entry) => entry.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
};

const hasArg = (flag) => args.includes(flag);

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPath = (input, keys, fallback = undefined) => {
  let current = input;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return fallback;
    current = current[key];
  }
  return current === undefined ? fallback : current;
};

const countAt = (input, keys) => Math.max(0, asNumber(getPath(input, keys, 0), 0));

const resolvePath = (value) => {
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeText = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
};

const fetchMetrics = async (apiBaseUrl) => {
  const baseUrl = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/internal/metrics`, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`metrics_http_${response.status}`);
  }
  return response.json();
};

const pct = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
};

const delta = (current, previous, keys) => {
  if (!previous) return null;
  return countAt(current, keys) - countAt(previous, keys);
};

const terminalCount = (metrics, scope, name) =>
  countAt(metrics, ["streamTerminals", scope, "terminalCounts", name]);

const duplicateFetchCount = (metrics, scope) =>
  countAt(metrics, ["scanUx", "decisionSupportFetch", scope, "duplicateFetchEvents"]);

export const buildScanRcSoakDashboard = (
  metrics,
  {
    previousMetrics = null,
    minStreams = DEFAULT_MIN_STREAMS,
    minScoreEvents = DEFAULT_MIN_SCORE_EVENTS,
    generatedAt = new Date().toISOString(),
    apiBaseUrl = DEFAULT_API_BASE_URL,
  } = {},
) => {
  const streamTotal = countAt(metrics, ["streamTerminals", "totals", "total"]);
  const streamWindowTotal = countAt(metrics, ["streamTerminals", "window", "total"]);
  const scoreEvents = countAt(metrics, ["scanUx", "totals", "time_to_score_visible", "count"]);
  const coreCardsEvents = countAt(metrics, ["scanUx", "totals", "time_to_core_cards_visible", "count"]);
  const done = terminalCount(metrics, "totals", "DONE");
  const notFound = terminalCount(metrics, "totals", "NOT_FOUND");
  const badTotals = {
    STREAM_BUSY: terminalCount(metrics, "totals", "STREAM_BUSY"),
    STREAM_TIMEOUT: terminalCount(metrics, "totals", "STREAM_TIMEOUT"),
    HTTP_ERROR: terminalCount(metrics, "totals", "HTTP_ERROR"),
  };
  const badWindow = {
    STREAM_BUSY: terminalCount(metrics, "window", "STREAM_BUSY"),
    STREAM_TIMEOUT: terminalCount(metrics, "window", "STREAM_TIMEOUT"),
    HTTP_ERROR: terminalCount(metrics, "window", "HTTP_ERROR"),
  };
  const badDeltas = Object.fromEntries(
    Object.keys(badTotals).map((name) => [
      name,
      delta(metrics, previousMetrics, ["streamTerminals", "totals", "terminalCounts", name]),
    ]),
  );
  const duplicateFetchEvents = duplicateFetchCount(metrics, "totals");
  const duplicateFetchWindow = duplicateFetchCount(metrics, "window");
  const duplicateFetchDelta = delta(
    metrics,
    previousMetrics,
    ["scanUx", "decisionSupportFetch", "totals", "duplicateFetchEvents"],
  );
  const degradedTotal = countAt(metrics, ["streamTerminals", "totals", "degradedCount"]);
  const degradedWindow = countAt(metrics, ["streamTerminals", "window", "degradedCount"]);
  const degradedDelta = delta(metrics, previousMetrics, ["streamTerminals", "totals", "degradedCount"]);
  const decisionSupport = getPath(metrics, ["sidecars", "totals", "decision_support"], {}) ?? {};
  const decisionSupportWindow = getPath(metrics, ["sidecars", "window", "decision_support"], {}) ?? {};
  const enoughNaturalTraffic = streamTotal >= minStreams && scoreEvents >= minScoreEvents;

  const redReasons = [];
  for (const [name, count] of Object.entries(badWindow)) {
    if (count > 0) redReasons.push(`${name}_window_${count}`);
  }
  for (const [name, count] of Object.entries(badDeltas)) {
    if (count != null && count > 0) redReasons.push(`${name}_delta_${count}`);
  }
  if (duplicateFetchWindow > 0) redReasons.push(`duplicate_fetch_window_${duplicateFetchWindow}`);
  if (duplicateFetchDelta != null && duplicateFetchDelta > 0) redReasons.push(`duplicate_fetch_delta_${duplicateFetchDelta}`);
  if (degradedWindow > 0) redReasons.push(`degraded_window_${degradedWindow}`);
  if (degradedDelta != null && degradedDelta >= 5) redReasons.push(`degraded_delta_${degradedDelta}`);

  const warningReasons = [];
  if (!enoughNaturalTraffic) {
    warningReasons.push(`sample_insufficient_streams_${streamTotal}_score_events_${scoreEvents}`);
  }
  if (!previousMetrics) {
    warningReasons.push("no_previous_snapshot_for_delta");
  }
  const infoReasons = [];
  if (degradedTotal > 0 && degradedWindow === 0) {
    infoReasons.push(`historical_degraded_total_${degradedTotal}`);
  }
  if (duplicateFetchEvents > 0 && duplicateFetchWindow === 0 && !(duplicateFetchDelta != null && duplicateFetchDelta > 0)) {
    infoReasons.push(`historical_duplicate_fetch_total_${duplicateFetchEvents}`);
  }

  const status = redReasons.length ? "red" : warningReasons.length ? "yellow" : "green";

  return {
    schemaVersion: "scan_rc_soak_dashboard.v1",
    generatedAt,
    source: {
      apiBaseUrl,
      startedAt: metrics?.startedAt ?? null,
      lastFlushAt: metrics?.lastFlushAt ?? null,
      naturalTrafficOnly: true,
      previousSnapshotCompared: Boolean(previousMetrics),
    },
    status,
    redReasons,
    warningReasons,
    infoReasons,
    traffic: {
      enoughNaturalTraffic,
      minStreams,
      minScoreEvents,
      streamTotal,
      streamWindowTotal,
      scoreEvents,
      coreCardsEvents,
    },
    streamTerminals: {
      totals: {
        DONE: done,
        STREAM_BUSY: badTotals.STREAM_BUSY,
        STREAM_TIMEOUT: badTotals.STREAM_TIMEOUT,
        HTTP_ERROR: badTotals.HTTP_ERROR,
        NOT_FOUND: notFound,
        degradedCount: degradedTotal,
        doneRatePct: pct(done, streamTotal),
      },
      window: {
        DONE: terminalCount(metrics, "window", "DONE"),
        STREAM_BUSY: badWindow.STREAM_BUSY,
        STREAM_TIMEOUT: badWindow.STREAM_TIMEOUT,
        HTTP_ERROR: badWindow.HTTP_ERROR,
        NOT_FOUND: terminalCount(metrics, "window", "NOT_FOUND"),
        degradedCount: degradedWindow,
      },
      deltas: {
        STREAM_BUSY: badDeltas.STREAM_BUSY,
        STREAM_TIMEOUT: badDeltas.STREAM_TIMEOUT,
        HTTP_ERROR: badDeltas.HTTP_ERROR,
        degradedCount: degradedDelta,
      },
    },
    scanUx: {
      timeToScoreVisibleRecentP95Ms: getPath(metrics, ["scanUx", "totals", "time_to_score_visible", "recentP95Ms"], null),
      timeToCoreCardsVisibleRecentP95Ms: getPath(metrics, ["scanUx", "totals", "time_to_core_cards_visible", "recentP95Ms"], null),
      duplicateFetchEvents,
      duplicateFetchWindow,
      duplicateFetchDelta,
    },
    sidecars: {
      decisionSupport: {
        priority: decisionSupport.priority ?? null,
        fetchCount: countAt(decisionSupport, ["fetchCount"]),
        cacheHitCount: countAt(decisionSupport, ["cacheHitCount"]),
        cacheMissCount: countAt(decisionSupport, ["cacheMissCount"]),
        windowFetchCount: countAt(decisionSupportWindow, ["fetchCount"]),
        windowCacheHitCount: countAt(decisionSupportWindow, ["cacheHitCount"]),
        windowCacheMissCount: countAt(decisionSupportWindow, ["cacheMissCount"]),
        avgLatencyMs: getPath(decisionSupport, ["latency", "avgMs"], null),
        lastLatencyMs: getPath(decisionSupport, ["latency", "lastMs"], null),
      },
    },
  };
};

const formatValue = (value) => (value === null || value === undefined ? "n/a" : String(value));

export const renderMarkdownDashboard = (dashboard) => {
  const lines = [];
  lines.push("# Scan RC Natural Traffic Soak Dashboard");
  lines.push("");
  lines.push(`- generatedAt: ${dashboard.generatedAt}`);
  lines.push(`- apiBaseUrl: ${dashboard.source.apiBaseUrl}`);
  lines.push(`- metricsStartedAt: ${dashboard.source.startedAt ?? "n/a"}`);
  lines.push(`- metricsLastFlushAt: ${dashboard.source.lastFlushAt ?? "n/a"}`);
  lines.push(`- status: ${dashboard.status.toUpperCase()}`);
  lines.push(`- naturalTrafficOnly: ${dashboard.source.naturalTrafficOnly ? "yes" : "no"}`);
  lines.push(`- enoughNaturalTraffic: ${dashboard.traffic.enoughNaturalTraffic ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Stream Terminals");
  lines.push("");
  lines.push("| metric | total | window | delta |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const key of ["DONE", "STREAM_BUSY", "STREAM_TIMEOUT", "HTTP_ERROR", "NOT_FOUND", "degradedCount"]) {
    lines.push(`| ${key} | ${formatValue(dashboard.streamTerminals.totals[key])} | ${formatValue(dashboard.streamTerminals.window[key])} | ${formatValue(dashboard.streamTerminals.deltas[key])} |`);
  }
  lines.push("");
  lines.push("## User-Visible Timing");
  lines.push("");
  lines.push(`- streamTotal: ${dashboard.traffic.streamTotal}`);
  lines.push(`- streamWindowTotal: ${dashboard.traffic.streamWindowTotal}`);
  lines.push(`- scoreEvents: ${dashboard.traffic.scoreEvents}`);
  lines.push(`- coreCardsEvents: ${dashboard.traffic.coreCardsEvents}`);
  lines.push(`- time_to_score_visible recentP95Ms: ${formatValue(dashboard.scanUx.timeToScoreVisibleRecentP95Ms)}`);
  lines.push(`- time_to_core_cards_visible recentP95Ms: ${formatValue(dashboard.scanUx.timeToCoreCardsVisibleRecentP95Ms)}`);
  lines.push(`- duplicateFetchEvents total/window/delta: ${dashboard.scanUx.duplicateFetchEvents}/${dashboard.scanUx.duplicateFetchWindow}/${formatValue(dashboard.scanUx.duplicateFetchDelta)}`);
  lines.push("");
  lines.push("## Decision Support Sidecar");
  lines.push("");
  lines.push(`- priority: ${formatValue(dashboard.sidecars.decisionSupport.priority)}`);
  lines.push(`- fetch/cacheHit/cacheMiss: ${dashboard.sidecars.decisionSupport.fetchCount}/${dashboard.sidecars.decisionSupport.cacheHitCount}/${dashboard.sidecars.decisionSupport.cacheMissCount}`);
  lines.push(`- window fetch/cacheHit/cacheMiss: ${dashboard.sidecars.decisionSupport.windowFetchCount}/${dashboard.sidecars.decisionSupport.windowCacheHitCount}/${dashboard.sidecars.decisionSupport.windowCacheMissCount}`);
  lines.push(`- avgLatencyMs/lastLatencyMs: ${formatValue(dashboard.sidecars.decisionSupport.avgLatencyMs)}/${formatValue(dashboard.sidecars.decisionSupport.lastLatencyMs)}`);
  lines.push("");
  lines.push("## Gate Notes");
  lines.push("");
  lines.push(`- redReasons: ${dashboard.redReasons.length ? dashboard.redReasons.join(", ") : "none"}`);
  lines.push(`- warningReasons: ${dashboard.warningReasons.length ? dashboard.warningReasons.join(", ") : "none"}`);
  lines.push(`- infoReasons: ${dashboard.infoReasons.length ? dashboard.infoReasons.join(", ") : "none"}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const renderHtmlDashboard = (dashboard) => {
  const statusClass = dashboard.status;
  const cards = [
    ["Status", dashboard.status.toUpperCase()],
    ["DONE", dashboard.streamTerminals.totals.DONE],
    ["STREAM_BUSY", dashboard.streamTerminals.totals.STREAM_BUSY],
    ["TIMEOUT", dashboard.streamTerminals.totals.STREAM_TIMEOUT],
    ["HTTP_ERROR", dashboard.streamTerminals.totals.HTTP_ERROR],
    ["Score p95", `${formatValue(dashboard.scanUx.timeToScoreVisibleRecentP95Ms)}ms`],
    ["Core cards p95", `${formatValue(dashboard.scanUx.timeToCoreCardsVisibleRecentP95Ms)}ms`],
    ["Decision cache", `${dashboard.sidecars.decisionSupport.cacheHitCount}/${dashboard.sidecars.decisionSupport.cacheMissCount}`],
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scan RC Soak Dashboard</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1b1c1f; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    .meta { color: #5b616a; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .card { background: #fff; border: 1px solid #dfdfdb; border-radius: 8px; padding: 14px; }
    .label { color: #666d75; font-size: 13px; }
    .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .green { color: #117744; }
    .yellow { color: #9a6400; }
    .red { color: #b42318; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; background: #fff; border: 1px solid #dfdfdb; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #ececea; text-align: right; }
    th:first-child, td:first-child { text-align: left; }
    pre { white-space: pre-wrap; background: #fff; border: 1px solid #dfdfdb; border-radius: 8px; padding: 12px; }
  </style>
</head>
<body>
<main>
  <h1>Scan RC Natural Traffic Soak Dashboard</h1>
  <div class="meta">Generated ${escapeHtml(dashboard.generatedAt)} from ${escapeHtml(dashboard.source.apiBaseUrl)}. Metrics started ${escapeHtml(dashboard.source.startedAt ?? "n/a")}, last flush ${escapeHtml(dashboard.source.lastFlushAt ?? "n/a")}.</div>
  <section class="grid">
    ${cards.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value ${label === "Status" ? statusClass : ""}">${escapeHtml(value)}</div></div>`).join("\n    ")}
  </section>
  <table>
    <thead><tr><th>Metric</th><th>Total</th><th>Window</th><th>Delta</th></tr></thead>
    <tbody>
      ${["DONE", "STREAM_BUSY", "STREAM_TIMEOUT", "HTTP_ERROR", "NOT_FOUND", "degradedCount"].map((key) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(formatValue(dashboard.streamTerminals.totals[key]))}</td><td>${escapeHtml(formatValue(dashboard.streamTerminals.window[key]))}</td><td>${escapeHtml(formatValue(dashboard.streamTerminals.deltas[key]))}</td></tr>`).join("\n      ")}
    </tbody>
  </table>
  <h2>Gate Notes</h2>
  <pre>${escapeHtml(JSON.stringify({
    enoughNaturalTraffic: dashboard.traffic.enoughNaturalTraffic,
    redReasons: dashboard.redReasons,
    warningReasons: dashboard.warningReasons,
    infoReasons: dashboard.infoReasons,
    duplicateFetchEvents: {
      total: dashboard.scanUx.duplicateFetchEvents,
      window: dashboard.scanUx.duplicateFetchWindow,
      delta: dashboard.scanUx.duplicateFetchDelta,
    },
    decisionSupport: dashboard.sidecars.decisionSupport,
  }, null, 2))}</pre>
</main>
</body>
</html>
`;
};

const main = async () => {
  const apiBaseUrl = getArg("--api-base-url", process.env.API_BASE_URL || DEFAULT_API_BASE_URL);
  const metricsJsonPath = resolvePath(getArg("--metrics-json", ""));
  const previousJsonPath = resolvePath(getArg("--previous-json", ""));
  const outDir = resolvePath(getArg("--out-dir", path.join("output", `scan-rc-soak-dashboard-${Date.now()}`)));
  const minStreams = asNumber(getArg("--min-streams", String(DEFAULT_MIN_STREAMS)), DEFAULT_MIN_STREAMS);
  const minScoreEvents = asNumber(getArg("--min-score-events", String(DEFAULT_MIN_SCORE_EVENTS)), DEFAULT_MIN_SCORE_EVENTS);
  const enforce = hasArg("--enforce");

  const metrics = metricsJsonPath ? await readJson(metricsJsonPath) : await fetchMetrics(apiBaseUrl);
  const previousMetrics = previousJsonPath ? await readJson(previousJsonPath) : null;
  const dashboard = buildScanRcSoakDashboard(metrics, {
    previousMetrics,
    minStreams,
    minScoreEvents,
    apiBaseUrl,
  });

  const jsonPath = path.join(outDir, "dashboard.json");
  const mdPath = path.join(outDir, "dashboard.md");
  const htmlPath = path.join(outDir, "dashboard.html");
  const snapshotPath = path.join(outDir, "metrics-snapshot.json");
  await writeJson(snapshotPath, metrics);
  await writeJson(jsonPath, dashboard);
  await writeText(mdPath, renderMarkdownDashboard(dashboard));
  await writeText(htmlPath, renderHtmlDashboard(dashboard));

  console.log(`[scan-rc-soak-dashboard] status=${dashboard.status} enoughNaturalTraffic=${dashboard.traffic.enoughNaturalTraffic}`);
  console.log(`[scan-rc-soak-dashboard] wrote ${snapshotPath}`);
  console.log(`[scan-rc-soak-dashboard] wrote ${jsonPath}`);
  console.log(`[scan-rc-soak-dashboard] wrote ${mdPath}`);
  console.log(`[scan-rc-soak-dashboard] wrote ${htmlPath}`);

  if (enforce && dashboard.status === "red") {
    console.error(`[scan-rc-soak-dashboard] redReasons=${dashboard.redReasons.join(", ")}`);
    process.exit(1);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("[scan-rc-soak-dashboard] failed", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export const __filename = fileURLToPath(import.meta.url);
