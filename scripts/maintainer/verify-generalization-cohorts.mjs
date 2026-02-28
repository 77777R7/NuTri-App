#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

import {
  buildGeneralizationCohortReport,
  extractCohortEntriesFromResidualReport,
  extractCohortEntriesFromRoundsSummary,
  extractCohortEntriesFromSurfaceConsistencyReport,
} from "./lib/generalization-cohorts.mjs";
import { deriveRegulatoryRichSignals } from "./lib/regulatory-richness-gate.mjs";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);

const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const hasFlag = (flag) => args.includes(`--${flag}`);

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/verify-generalization-cohorts.mjs [options]

Options:
  --out-dir <path>             Output directory (default: output/maintainer-gates/<timestamp>)
  --latest-run <path>          Preferred latest rounds_summary.json path
  --history-root <path>        Root directory to scan historical artifacts (default: output)
  --seed-dir <path>            Cohort seed directory (default: scripts/maintainer/fixtures/cohort_seeds)
  --min-samples <n>            Minimum required samples per cohort (default: 20)
  --api-base-url <url>         Probe API base URL (default: API_BASE_URL/RENDER_BASE_URL/http://127.0.0.1:3001)
  --inferred-fixture <path>    Fixed inferred-only fixture (default: scripts/maintainer/fixtures/inferred_only_consistency_barcodes.v1.json)
  --probe-timeout-ms <n>       Probe timeout per barcode (default: 12000)
  --probe-concurrency <n>      Probe concurrency (default: 4)
  --skip-inferred-probe        Disable fixed inferred-only active probing
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outPath = path.join(outDir, "generalization_cohorts_report.json");
const outMdPath = path.join(outDir, "generalization_cohorts_report.md");
const inferredProbePath = path.join(outDir, "inferred_only_consistency_probe_report.json");
const historyRootArg = getArg("history-root") || "output";
const historyRoot = path.isAbsolute(historyRootArg) ? historyRootArg : path.join(ROOT_DIR, historyRootArg);
const latestRunArg = getArg("latest-run");
const latestRunPath = latestRunArg
  ? (path.isAbsolute(latestRunArg) ? latestRunArg : path.join(ROOT_DIR, latestRunArg))
  : null;
const minSamplesRaw = Number(getArg("min-samples") || process.env.GENERALIZATION_COHORT_MIN_SAMPLES || 20);
const minSamples = Number.isFinite(minSamplesRaw) ? Math.max(1, Math.floor(minSamplesRaw)) : 20;
const apiBaseUrl = String(
  getArg("api-base-url")
  || process.env.API_BASE_URL
  || process.env.RENDER_BASE_URL
  || "http://127.0.0.1:3001",
).replace(/\/$/, "");
const inferredFixtureArg =
  getArg("inferred-fixture")
  || process.env.GENERALIZATION_INFERRED_FIXTURE
  || path.join("scripts", "maintainer", "fixtures", "inferred_only_consistency_barcodes.v1.json");
const inferredFixturePath = path.isAbsolute(inferredFixtureArg)
  ? inferredFixtureArg
  : path.join(ROOT_DIR, inferredFixtureArg);
const seedDirArg =
  getArg("seed-dir")
  || process.env.GENERALIZATION_COHORT_SEED_DIR
  || path.join("scripts", "maintainer", "fixtures", "cohort_seeds");
const seedDirPath = path.isAbsolute(seedDirArg)
  ? seedDirArg
  : path.join(ROOT_DIR, seedDirArg);
const probeTimeoutRaw = Number(getArg("probe-timeout-ms") || process.env.GENERALIZATION_INFERRED_PROBE_TIMEOUT_MS || 12000);
const probeTimeoutMs = Number.isFinite(probeTimeoutRaw) && probeTimeoutRaw > 0 ? Math.floor(probeTimeoutRaw) : 12000;
const probeConcurrencyRaw = Number(getArg("probe-concurrency") || process.env.GENERALIZATION_INFERRED_PROBE_CONCURRENCY || 4);
const probeConcurrency = Number.isFinite(probeConcurrencyRaw) && probeConcurrencyRaw > 0 ? Math.max(1, Math.floor(probeConcurrencyRaw)) : 4;
const skipInferredProbe = hasFlag("skip-inferred-probe")
  || ["1", "true", "yes", "on"].includes(String(process.env.GENERALIZATION_SKIP_INFERRED_PROBE || "").toLowerCase());

const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const commonHeaders = regressionToken
  ? { "x-regression-token": regressionToken }
  : { "x-auth-disabled": "1" };

const readJson = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const walkFiles = async (dirPath, matcher, results = []) => {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      await walkFiles(nextPath, matcher, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (matcher(entry.name, nextPath)) {
      results.push(nextPath);
    }
  }
  return results;
};

const sortByNewestMtime = async (paths) => {
  const stats = await Promise.all(
    paths.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    }),
  );
  return stats.sort((a, b) => b.mtimeMs - a.mtimeMs).map((item) => item.filePath);
};

const toLabel = (filePath) => path.relative(ROOT_DIR, filePath) || filePath;

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const normalizeFixtureBarcodes = (payload) => {
  const rows = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.barcodes) ? payload.barcodes : []);
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const value = typeof row === "string" ? row : row?.barcode;
    const barcode = normalizeBarcode(value);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    out.push(barcode);
  }
  return out;
};

const seedFileMap = {
  negative_cache_residual: "negative_cache_residual.seeds.jsonl",
  inferred_only_consistency: "inferred_only_consistency.seeds.jsonl",
  historical_dsld_web_fallback: "web_fallback_history.seeds.jsonl",
  score_pending_timeout: "score_pending_timeout.seeds.jsonl",
};

const readSeedEntries = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    const rows = [];
    for (const line of lines) {
      try {
        const payload = JSON.parse(line);
        const barcode = normalizeBarcode(payload?.barcode ?? payload?.gtin14 ?? payload?.value);
        if (!barcode) continue;
        rows.push({
          ...payload,
          barcode,
          source: `seed:${path.basename(filePath)}`,
        });
      } catch {
        // ignore malformed row
      }
    }
    return rows;
  } catch {
    return [];
  }
};

const resolveSourceAttribution = (bundle) => {
  const sourceType = String(bundle?.meta?.sourceType ?? "").trim().toLowerCase();
  if (sourceType === "lnhpd" || sourceType === "dsld") return "verified_regulatory";
  if (sourceType === "label" || sourceType === "label_scan") return "label_record";
  if (sourceType === "web") return "web_hint_unverified";
  return "unknown";
};

const runEnrichStreamProbe = async ({ barcode, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader = null;
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
        streamMode: "analysis_bundle_only",
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      return { ok: false, error: `http_${response.status}`, terminalReason: `HTTP_${response.status}` };
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines = [];
    let latestBundle = null;
    let terminalReason = null;
    let errorCode = null;

    const flush = () => {
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      dataLines = [];
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        const revision = Number(payload?.meta?.revision);
        if (Number.isFinite(revision) && revision >= 1) {
          latestBundle = payload;
        }
      } else if (currentEvent === "done") {
        terminalReason = payload?.terminalReason ?? payload?.reasonCode ?? terminalReason;
      } else if (currentEvent === "error") {
        errorCode = payload?.code ?? errorCode;
        terminalReason = payload?.reasonCode ?? payload?.code ?? terminalReason;
      }
      currentEvent = "message";
    };

    while (true) {
      const { value, done } = await reader.read();
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
      if (latestBundle) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    flush();
    if (!latestBundle) {
      return {
        ok: false,
        error: "no_revision1_bundle",
        terminalReason: terminalReason || errorCode || "NO_REV1",
      };
    }
    return {
      ok: true,
      bundle: latestBundle,
      terminalReason: terminalReason || null,
      errorCode: errorCode || null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      terminalReason: "REQUEST_ERROR",
    };
  } finally {
    clearTimeout(timer);
    try {
      await reader?.cancel();
    } catch {
      // best effort
    }
    controller.abort();
  }
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const out = Array(items.length).fill(null);
  let cursor = 0;
  const count = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
};

const probeInferredOnlyFixture = async (fixturePath) => {
  const payload = await readJson(fixturePath);
  const barcodes = normalizeFixtureBarcodes(payload);
  if (barcodes.length === 0) {
    return {
      enabled: false,
      reason: "fixture_empty_or_missing",
      fixturePath,
      fixtureCount: 0,
      warningObservedCount: 0,
      rows: [],
      cohortEntries: [],
    };
  }

  const sourceLabel = `fixture_probe:${toLabel(fixturePath)}`;
  const rows = await mapWithConcurrency(barcodes, probeConcurrency, async (barcode) => {
    const probe = await runEnrichStreamProbe({ barcode, timeoutMs: probeTimeoutMs });
    if (!probe.ok || !probe.bundle) {
      return {
        barcode,
        status: "request_error",
        sourceAttribution: "unknown",
        sourceTypeFinal: false,
        warningReasons: [],
        warningObserved: false,
        consistencyFailReason: null,
        terminalReason: probe.terminalReason ?? null,
        error: probe.error ?? null,
      };
    }
    const sourceAttribution = resolveSourceAttribution(probe.bundle);
    const sourceTypeFinal = probe.bundle?.meta?.sourceTypeFinal === true;
    const regulatoryRichSignals =
      sourceAttribution === "verified_regulatory" || sourceAttribution === "label_record"
        ? deriveRegulatoryRichSignals({
          analysisBundle: probe.bundle,
          scoreInfo: null,
          moduleValue: null,
        })
        : null;
    const warningReasons = Array.isArray(regulatoryRichSignals?.consistencyWarningReasons)
      ? regulatoryRichSignals.consistencyWarningReasons
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    const warningObserved = warningReasons.some((reason) => reason.startsWith("INFERRED_ONLY_"));
    return {
      barcode,
      status: "ok",
      sourceAttribution,
      sourceTypeFinal,
      warningReasons,
      warningObserved,
      consistencyFailReason: regulatoryRichSignals?.consistencyFailReason ?? null,
      terminalReason: probe.terminalReason ?? null,
      error: null,
    };
  });

  const cohortEntries = rows.map((row) => ({
    barcode: row.barcode,
    source: sourceLabel,
    warningReasons: row.warningReasons,
    sourceTypeFinal: row.sourceTypeFinal === true,
    consistencyFailReason: row.consistencyFailReason ?? null,
    probeStatus: row.status,
    probeError: row.error ?? null,
    warningObserved: row.warningObserved === true,
  }));

  return {
    enabled: true,
    reason: null,
    apiBaseUrl,
    fixturePath,
    fixtureCount: barcodes.length,
    probeCount: rows.length,
    warningObservedCount: rows.filter((row) => row.warningObserved === true).length,
    timeoutMs: probeTimeoutMs,
    concurrency: probeConcurrency,
    rows,
    cohortEntries,
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Generalization Cohorts Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- minSamples: ${report.minSamples}`);
  lines.push(`- pass: ${report.pass ? "true" : "false"}`);
  if (report?.inferredOnlyProbe) {
    lines.push(
      `- inferredOnlyProbe: enabled=${report.inferredOnlyProbe.enabled ? "true" : "false"} fixtureCount=${report.inferredOnlyProbe.fixtureCount ?? 0} warningObservedCount=${report.inferredOnlyProbe.warningObservedCount ?? 0}`,
    );
  }
  lines.push("");
  lines.push("| cohort | sampleCount | availableCount | requiredMin | insufficientPool |");
  lines.push("| --- | ---: | ---: | ---: | --- |");
  for (const [type, row] of Object.entries(report.cohorts ?? {})) {
    lines.push(
      `| ${type} | ${Number(row?.sampleCount ?? 0)} | ${Number(row?.availableCount ?? 0)} | ${Number(row?.requiredMin ?? report.minSamples)} | ${row?.insufficientPool ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("| cohort | sourceBreakdown (sample) | seedBackfillCount |");
  lines.push("| --- | --- | ---: |");
  for (const [type, row] of Object.entries(report.cohorts ?? {})) {
    lines.push(
      `| ${type} | \`${JSON.stringify(row?.sampleSourceBreakdown ?? {})}\` | ${Number(row?.seedBackfillCount ?? 0)} |`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });

  const roundsSummaryCandidates = await walkFiles(historyRoot, (name) => name === "rounds_summary.json");
  const residualReportCandidates = await walkFiles(
    historyRoot,
    (name) => name === "negative_cache_residual_report.json",
  );
  const surfaceConsistencyCandidates = await walkFiles(
    historyRoot,
    (name) => name === "surface_consistency_report.json",
  );
  const roundsSummaryPaths = await sortByNewestMtime(roundsSummaryCandidates);
  const residualReportPaths = await sortByNewestMtime(residualReportCandidates);
  const surfaceConsistencyPaths = await sortByNewestMtime(surfaceConsistencyCandidates);

  const latestRoundsPath = latestRunPath && roundsSummaryPaths.includes(latestRunPath)
    ? latestRunPath
    : (latestRunPath ?? roundsSummaryPaths[0] ?? null);

  const latestRounds = latestRoundsPath ? await readJson(latestRoundsPath) : null;
  const latestRoundsEntries = extractCohortEntriesFromRoundsSummary(
    latestRounds,
    latestRoundsPath ? toLabel(latestRoundsPath) : "latest_missing",
  );
  const historyRoundsEntries = {
    inferred_only_consistency: [],
    historical_dsld_web_fallback: [],
    score_pending_timeout: [],
  };
  for (const filePath of roundsSummaryPaths) {
    if (latestRoundsPath && filePath === latestRoundsPath) continue;
    const payload = await readJson(filePath);
    const extracted = extractCohortEntriesFromRoundsSummary(payload, toLabel(filePath));
    historyRoundsEntries.inferred_only_consistency.push(...extracted.inferred_only_consistency);
    historyRoundsEntries.historical_dsld_web_fallback.push(...extracted.historical_dsld_web_fallback);
    historyRoundsEntries.score_pending_timeout.push(...(extracted.score_pending_timeout ?? []));
  }

  const latestSurfaceConsistencyPath = surfaceConsistencyPaths[0] ?? null;
  const latestSurfaceConsistencyPayload = latestSurfaceConsistencyPath
    ? await readJson(latestSurfaceConsistencyPath)
    : null;
  const latestSurfaceEntries = extractCohortEntriesFromSurfaceConsistencyReport(
    latestSurfaceConsistencyPayload,
    latestSurfaceConsistencyPath ? toLabel(latestSurfaceConsistencyPath) : "latest_missing",
  );
  const historySurfaceEntries = {
    inferred_only_consistency: [],
    historical_dsld_web_fallback: [],
    score_pending_timeout: [],
  };
  for (const filePath of surfaceConsistencyPaths.slice(latestSurfaceConsistencyPath ? 1 : 0)) {
    const payload = await readJson(filePath);
    const extracted = extractCohortEntriesFromSurfaceConsistencyReport(payload, toLabel(filePath));
    historySurfaceEntries.inferred_only_consistency.push(...extracted.inferred_only_consistency);
  }
  latestRoundsEntries.inferred_only_consistency.push(...latestSurfaceEntries.inferred_only_consistency);
  historyRoundsEntries.inferred_only_consistency.push(...historySurfaceEntries.inferred_only_consistency);

  const inferredOnlyProbe = skipInferredProbe
    ? {
      enabled: false,
      reason: "skip_inferred_probe",
      apiBaseUrl,
      fixturePath: inferredFixturePath,
      fixtureCount: 0,
      probeCount: 0,
      warningObservedCount: 0,
      timeoutMs: probeTimeoutMs,
      concurrency: probeConcurrency,
      rows: [],
      cohortEntries: [],
    }
    : await probeInferredOnlyFixture(inferredFixturePath);
  if (Array.isArray(inferredOnlyProbe?.cohortEntries) && inferredOnlyProbe.cohortEntries.length > 0) {
    latestRoundsEntries.inferred_only_consistency.push(...inferredOnlyProbe.cohortEntries);
  }
  await fs.writeFile(inferredProbePath, JSON.stringify(inferredOnlyProbe, null, 2), "utf8");

  const latestResidualPath = residualReportPaths[0] ?? null;
  const latestResidualPayload = latestResidualPath ? await readJson(latestResidualPath) : null;
  const latestResidualEntries = extractCohortEntriesFromResidualReport(
    latestResidualPayload,
    latestResidualPath ? toLabel(latestResidualPath) : "latest_missing",
  );
  const historyResidualEntries = [];
  for (const filePath of residualReportPaths.slice(latestResidualPath ? 1 : 0)) {
    const payload = await readJson(filePath);
    historyResidualEntries.push(...extractCohortEntriesFromResidualReport(payload, toLabel(filePath)));
  }

  const seedEntriesByType = {};
  for (const [type, fileName] of Object.entries(seedFileMap)) {
    const seedPath = path.join(seedDirPath, fileName);
    seedEntriesByType[type] = await readSeedEntries(seedPath);
  }

  const cohortReport = buildGeneralizationCohortReport({
    latestRoundEntries: latestRoundsEntries,
    historyRoundEntries: historyRoundsEntries,
    latestResidualEntries,
    historyResidualEntries,
    seedEntriesByType,
    minSamples,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    minSamples,
    latestRunPath: latestRoundsPath ? toLabel(latestRoundsPath) : null,
    latestResidualPath: latestResidualPath ? toLabel(latestResidualPath) : null,
    latestSurfaceConsistencyPath: latestSurfaceConsistencyPath ? toLabel(latestSurfaceConsistencyPath) : null,
    historyRoundsScanned: roundsSummaryPaths.length,
    historyResidualScanned: residualReportPaths.length,
    historySurfaceConsistencyScanned: surfaceConsistencyPaths.length,
    seedDirPath: toLabel(seedDirPath),
    seedEntryCountByType: Object.fromEntries(
      Object.entries(seedEntriesByType).map(([type, rows]) => [type, Array.isArray(rows) ? rows.length : 0]),
    ),
    inferredOnlyProbe: {
      enabled: inferredOnlyProbe?.enabled === true,
      reason: inferredOnlyProbe?.reason ?? null,
      apiBaseUrl,
      fixturePath: toLabel(inferredFixturePath),
      fixtureCount: Number(inferredOnlyProbe?.fixtureCount ?? 0),
      probeCount: Number(inferredOnlyProbe?.probeCount ?? 0),
      warningObservedCount: Number(inferredOnlyProbe?.warningObservedCount ?? 0),
      timeoutMs: probeTimeoutMs,
      concurrency: probeConcurrency,
      reportPath: toLabel(inferredProbePath),
    },
    ...cohortReport,
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(outMdPath, toMarkdown(report), "utf8");
  console.log(`[verify-generalization-cohorts] wrote ${outPath}`);
  console.log(`[verify-generalization-cohorts] pass=${report.pass ? "true" : "false"}`);
};

main().catch((error) => {
  console.error(
    "[verify-generalization-cohorts] failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
