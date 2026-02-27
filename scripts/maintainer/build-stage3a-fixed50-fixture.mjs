#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const FIXTURE_DIR = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures");
const OUT_PATH = path.join(FIXTURE_DIR, "stage3a_fixed50.json");
const REPORT_PATH = path.join(FIXTURE_DIR, "stage3a_fixed50_report.json");
const EXISTING_FIXED50_PATH = path.join(FIXTURE_DIR, "stage3a_fixed50.json");
const WEB_PROBE_POOL_PATH = path.join(FIXTURE_DIR, "web_probe_pool.json");
const BUILD_WEB_PROBE_POOL_CMD = `node ${path.join(ROOT_DIR, "scripts", "maintainer", "build-web-probe-pool.mjs")}`;
const BULK_GLOB_PREFIX = path.join(ROOT_DIR, "output", "bulk-barcode-e2e-");
const WEB_GLOB_PREFIX = path.join(ROOT_DIR, "output", "website-barcode-e2e-");

const numberFromEnv = (rawValue, fallback) => {
  const n = Number(rawValue);
  return Number.isFinite(n) ? n : fallback;
};

const ratioFromEnv = (rawValue, fallback) => {
  const n = numberFromEnv(rawValue, fallback);
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
};

const HISTORICAL_WEB_LOOKBACK_RUNS = Math.max(1, Math.floor(numberFromEnv(process.env.STAGE3A_WEB_LOOKBACK_RUNS, 6)));
const WEB_STABLE_MIN_OBSERVED = Math.max(1, Math.floor(numberFromEnv(process.env.STAGE3A_WEB_STABLE_MIN_OBSERVED, 2)));
const WEB_STABLE_MIN_HEALTHY_RUNS = Math.max(
  1,
  Math.floor(numberFromEnv(process.env.STAGE3A_WEB_STABLE_MIN_HEALTHY_RUNS, 2)),
);
const WEB_STABLE_MIN_WEB_RATE = ratioFromEnv(process.env.STAGE3A_WEB_STABLE_MIN_WEB_RATE, 0.9);
const WEB_STABLE_MIN_DONE_RATE = ratioFromEnv(process.env.STAGE3A_WEB_STABLE_MIN_DONE_RATE, 0.55);
const WEB_STABLE_MIN_REV1_RATE = ratioFromEnv(process.env.STAGE3A_WEB_STABLE_MIN_REV1_RATE, 0.9);
const WEB_STABLE_MAX_TERMINAL_ERROR_RATE = ratioFromEnv(
  process.env.STAGE3A_WEB_STABLE_MAX_TERMINAL_ERROR_RATE,
  0.1,
);
const WEB_STABLE_MAX_CONTRACT_FAILURE_RATE = ratioFromEnv(
  process.env.STAGE3A_WEB_STABLE_MAX_CONTRACT_FAILURE_RATE,
  0.15,
);
const WEB_STABLE_MAX_ABORT_OR_TIMEOUT_RATE = ratioFromEnv(
  process.env.STAGE3A_WEB_STABLE_MAX_ABORT_OR_TIMEOUT_RATE,
  0.15,
);

const toDigits = (value) => String(value ?? "").replace(/\D/g, "");
const toGtin14 = (value) => {
  const d = toDigits(value);
  if (!d) return null;
  if (d.length === 14) return d;
  if (d.length === 13) return `0${d}`;
  if (d.length === 12) return `00${d}`;
  if (d.length === 11) return `000${d}`;
  return null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const readJson = async (filePath) => JSON.parse(await fs.promises.readFile(filePath, "utf8"));

const maybeReadJson = async (filePath) => {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
};

const listDirs = async (prefix) => {
  const outputDir = path.dirname(prefix);
  const base = path.basename(prefix);
  let entries = [];
  try {
    entries = await fs.promises.readdir(outputDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(base))
    .map((entry) => path.join(outputDir, entry.name))
    .sort();
};

const pickLatestBulkSummary = async () => {
  const dirs = await listDirs(BULK_GLOB_PREFIX);
  const candidates = [];
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const summary = await maybeReadJson(path.join(dir, "summary.json"));
    if (Array.isArray(summary) && summary.length >= 30) {
      candidates.push({ dir, summary });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1];
};

const collectHistoricalWebRows = async () => {
  const allDirs = await listDirs(WEB_GLOB_PREFIX);
  const numericRunDirs = allDirs
    .filter((dir) => /website-barcode-e2e-\d+$/.test(path.basename(dir)))
    .sort((a, b) => {
      const aNum = Number(path.basename(a).replace("website-barcode-e2e-", ""));
      const bNum = Number(path.basename(b).replace("website-barcode-e2e-", ""));
      return aNum - bNum;
    });
  const dirs = numericRunDirs.slice(-Math.max(1, HISTORICAL_WEB_LOOKBACK_RUNS));
  const rows = [];
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const e2eRows = await maybeReadJson(path.join(dir, "e2e_results.json"));
    if (!Array.isArray(e2eRows)) continue;
    const runId = path.basename(dir);
    for (const row of e2eRows) {
      const barcode = toGtin14(row?.input?.barcode ?? row?.sse?.barcode ?? null);
      if (!barcode) continue;
      const sourceType = row?.sse?.sourceType ?? null;
      rows.push({
        runId,
        barcode,
        region: row?.input?.region ?? null,
        sourceType,
        doneSeen: Boolean(row?.sse?.doneSeen),
        rev1Seen: Boolean(row?.sse?.rev1Seen),
        terminalCode: row?.sse?.terminalCode ?? null,
        terminalErrorType: row?.sse?.terminalErrorType ?? null,
        contractFailure: row?.sse?.contractFailure ?? null,
        timedOut: Boolean(row?.sse?.timedOut),
        abortError: Boolean(row?.sse?.abortError),
        expectedScoreAvailable:
          typeof row?.input?.expectedScoreAvailable === "boolean" ? row.input.expectedScoreAvailable : null,
        sourceUrl: row?.input?.sourceUrl ?? null,
        verifiedAt: String(row?.completedAt ?? todayIso()).slice(0, 10),
        notes: `historical website e2e from ${path.basename(dir)}`,
      });
    }
  }
  return rows;
};

const stableThresholds = {
  lookbackRuns: HISTORICAL_WEB_LOOKBACK_RUNS,
  minObservedRuns: WEB_STABLE_MIN_OBSERVED,
  minHealthyRuns: WEB_STABLE_MIN_HEALTHY_RUNS,
  minWebRate: WEB_STABLE_MIN_WEB_RATE,
  minDoneRate: WEB_STABLE_MIN_DONE_RATE,
  minRev1Rate: WEB_STABLE_MIN_REV1_RATE,
  maxTerminalErrorRate: WEB_STABLE_MAX_TERMINAL_ERROR_RATE,
  maxContractFailureRate: WEB_STABLE_MAX_CONTRACT_FAILURE_RATE,
  maxAbortOrTimeoutRate: WEB_STABLE_MAX_ABORT_OR_TIMEOUT_RATE,
};

const toRate = (part, total) => (total > 0 ? part / total : 0);

const scoreHistoricalRow = (row) => {
  let score = 0;
  if (row?.sourceType === "web") score += 4;
  if (row?.rev1Seen) score += 4;
  if (row?.doneSeen) score += 3;
  if (!row?.terminalErrorType) score += 2;
  if (!row?.contractFailure || row?.contractFailure === "missing_done") score += 2;
  if (!row?.abortError && !row?.timedOut) score += 2;
  return score;
};

const dedupeHistoricalRowsByRun = (rows) => {
  const deduped = new Map();
  for (const row of rows) {
    const key = `${row?.runId ?? "unknown"}::${row?.barcode ?? ""}`;
    if (!row?.barcode) continue;
    const existing = deduped.get(key);
    if (!existing || scoreHistoricalRow(row) > scoreHistoricalRow(existing)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
};

const isHealthyWebObservation = (row) =>
  row?.sourceType === "web" &&
  row?.rev1Seen === true &&
  !row?.terminalErrorType &&
  (!row?.contractFailure || row?.contractFailure === "missing_done") &&
  !row?.abortError &&
  !row?.timedOut;

const buildWebStability = (rows) => {
  const map = new Map();
  for (const row of rows) {
    if (!row?.barcode) continue;
    const current = map.get(row.barcode) ?? {
      observedRuns: 0,
      webRuns: 0,
      rev1Runs: 0,
      doneRuns: 0,
      healthyRuns: 0,
      terminalErrorRuns: 0,
      contractFailureRuns: 0,
      hardContractFailureRuns: 0,
      abortOrTimeoutRuns: 0,
      runIds: new Set(),
    };
    current.observedRuns += 1;
    current.runIds.add(row.runId ?? "unknown");
    if (row.sourceType === "web") current.webRuns += 1;
    if (row.rev1Seen) current.rev1Runs += 1;
    if (row.doneSeen) current.doneRuns += 1;
    if (row.terminalErrorType) current.terminalErrorRuns += 1;
    if (row.contractFailure) current.contractFailureRuns += 1;
    if (row.contractFailure && row.contractFailure !== "missing_done") current.hardContractFailureRuns += 1;
    if (row.abortError || row.timedOut) current.abortOrTimeoutRuns += 1;
    if (isHealthyWebObservation(row)) current.healthyRuns += 1;
    map.set(row.barcode, current);
  }
  return map;
};

const isStableWebStats = (stats) => {
  if (!stats) return false;
  const observedRuns = stats.observedRuns;
  if (observedRuns < stableThresholds.minObservedRuns) return false;
  if (stats.healthyRuns < stableThresholds.minHealthyRuns) return false;
  if (toRate(stats.webRuns, observedRuns) < stableThresholds.minWebRate) return false;
  if (toRate(stats.doneRuns, observedRuns) < stableThresholds.minDoneRate) return false;
  if (toRate(stats.rev1Runs, observedRuns) < stableThresholds.minRev1Rate) return false;
  if (toRate(stats.terminalErrorRuns, observedRuns) > stableThresholds.maxTerminalErrorRate) return false;
  if (toRate(stats.hardContractFailureRuns, observedRuns) > stableThresholds.maxContractFailureRate) return false;
  if (toRate(stats.abortOrTimeoutRuns, observedRuns) > stableThresholds.maxAbortOrTimeoutRate) return false;
  return true;
};

const collectGenericWebCandidates = async () => {
  const outputDir = path.join(ROOT_DIR, "output");
  const jsonFiles = [];
  const queue = [outputDir];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        jsonFiles.push(fullPath);
      }
    }
  }

  const counts = new Map();
  const collect = (barcode, sourcePath) => {
    const normalized = toGtin14(barcode);
    if (!normalized) return;
    if (normalized === "00000000000000" || normalized === "99999999999999") return;
    const existing = counts.get(normalized) ?? {
      barcode: normalized,
      count: 0,
      sourceUrl: sourcePath,
      notes: "historical web sourceType sample",
    };
    existing.count += 1;
    counts.set(normalized, existing);
  };

  const walkJson = (value, context = {}) => {
    if (Array.isArray(value)) {
      for (const item of value) walkJson(item, context);
      return;
    }
    if (!value || typeof value !== "object") return;

    const nextContext = { ...context };
    if (value.barcode) nextContext.barcode = value.barcode;
    if (value.barcodeGtin14) nextContext.barcode = value.barcodeGtin14;
    if (value.barcode_gtin14) nextContext.barcode = value.barcode_gtin14;

    const sourceType = value.sourceType ?? value.source_type ?? null;
    if (sourceType === "web") {
      collect(value.barcode ?? value.barcodeGtin14 ?? value.barcode_gtin14 ?? nextContext.barcode ?? null, context.path);
    }

    for (const val of Object.values(value)) {
      walkJson(val, nextContext);
    }
  };

  for (const filePath of jsonFiles) {
    let stat = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      stat = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (!stat || stat.size > 2_000_000) continue;

    let parsed = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    walkJson(parsed, { path: filePath });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
};

const normalizeFixtureItem = (item, fallback = {}) => {
  const barcode = toGtin14(item?.barcode ?? fallback.barcode ?? null);
  if (!barcode) return null;
  const expectedSourceType = item?.expectedSourceType ?? fallback.expectedSourceType ?? null;
  const expectedScoreAvailable =
    typeof item?.expectedScoreAvailable === "boolean"
      ? item.expectedScoreAvailable
      : typeof fallback.expectedScoreAvailable === "boolean"
        ? fallback.expectedScoreAvailable
        : expectedSourceType === "lnhpd" || expectedSourceType === "dsld"
          ? true
          : expectedSourceType === "web"
            ? false
            : null;
  return {
    barcode,
    region: item?.region ?? fallback.region ?? "US",
    expectedSourceType,
    expectedScoreAvailable,
    verifiedAt: item?.verifiedAt ?? fallback.verifiedAt ?? todayIso(),
    sourceUrl: item?.sourceUrl ?? fallback.sourceUrl ?? "fixture",
    notes: item?.notes ?? fallback.notes ?? "stage3a fixture",
  };
};

const pushUnique = (bucket, item, seen) => {
  if (!item?.barcode) return false;
  if (seen.has(item.barcode)) return false;
  seen.add(item.barcode);
  bucket.push(item);
  return true;
};

const main = async () => {
  const kbFixturePath = path.join(FIXTURE_DIR, "kb_barcodes.json");

  const [kbFixtureRaw, webProbePoolRaw, existingFixedRaw, latestBulk] = await Promise.all([
    maybeReadJson(kbFixturePath),
    maybeReadJson(WEB_PROBE_POOL_PATH),
    maybeReadJson(EXISTING_FIXED50_PATH),
    pickLatestBulkSummary(),
  ]);

  if (!latestBulk) {
    throw new Error("No bulk summary found. Run bulk-barcode-e2e first.");
  }

  const historicalRows = await collectHistoricalWebRows();

  const historicalRowsDeduped = dedupeHistoricalRowsByRun(historicalRows);
  const webStability = buildWebStability(historicalRowsDeduped);
  const buildStabilityNote = (barcode) => {
    const normalized = toGtin14(barcode);
    if (!normalized) return "stability=unknown";
    const stats = webStability.get(normalized);
    if (!stats) return "stability=unobserved";
    return `stability observed=${stats.observedRuns} healthy=${stats.healthyRuns} webRate=${toRate(stats.webRuns, stats.observedRuns).toFixed(2)} rev1Rate=${toRate(stats.rev1Runs, stats.observedRuns).toFixed(2)} doneRate=${toRate(stats.doneRuns, stats.observedRuns).toFixed(2)} terminalErrRate=${toRate(stats.terminalErrorRuns, stats.observedRuns).toFixed(2)} hardContractFailRate=${toRate(stats.hardContractFailureRuns, stats.observedRuns).toFixed(2)} abortTimeoutRate=${toRate(stats.abortOrTimeoutRuns, stats.observedRuns).toFixed(2)}`;
  };
  const authoritative = [];
  const web = [];
  const authoritativeSeen = new Set();
  const webSeen = new Set();
  let selectedFromProbePoolCount = 0;

  for (const row of latestBulk.summary) {
    const normalized = normalizeFixtureItem(
      {
        barcode: row?.barcode,
        region: row?.country,
        expectedSourceType: row?.sourceType,
        expectedScoreAvailable:
          typeof row?.scoreAvailable === "boolean"
            ? row.scoreAvailable
            : row?.sourceType === "lnhpd" || row?.sourceType === "dsld",
        verifiedAt: todayIso(),
        sourceUrl: "bulk-barcode-e2e",
        notes: "same-batch bulk baseline sample",
      },
      {},
    );
    if (!normalized) continue;
    if (normalized.expectedSourceType === "lnhpd" || normalized.expectedSourceType === "dsld") {
      pushUnique(authoritative, normalized, authoritativeSeen);
    }
  }

  if (Array.isArray(kbFixtureRaw)) {
    for (const item of kbFixtureRaw) {
      if (authoritative.length >= 35) break;
      const normalized = normalizeFixtureItem(item);
      if (!normalized) continue;
      if (normalized.expectedSourceType !== "lnhpd" && normalized.expectedSourceType !== "dsld") continue;
      pushUnique(authoritative, normalized, authoritativeSeen);
    }
  }

  for (const row of historicalRows) {
    if (authoritative.length >= 35) break;
    if (row.sourceType !== "lnhpd" && row.sourceType !== "dsld") continue;
    const normalized = normalizeFixtureItem({
      barcode: row.barcode,
      region: row.region ?? "US",
      expectedSourceType: row.sourceType,
      expectedScoreAvailable:
        typeof row.expectedScoreAvailable === "boolean" ? row.expectedScoreAvailable : true,
      verifiedAt: row.verifiedAt,
      sourceUrl: row.sourceUrl ?? "historical website e2e",
      notes: row.notes,
    });
    if (!normalized) continue;
    pushUnique(authoritative, normalized, authoritativeSeen);
  }

  if (Array.isArray(existingFixedRaw)) {
    for (const item of existingFixedRaw) {
      if (authoritative.length >= 35) break;
      const normalized = normalizeFixtureItem(item);
      if (!normalized) continue;
      if (normalized.expectedSourceType !== "lnhpd" && normalized.expectedSourceType !== "dsld") continue;
      pushUnique(authoritative, normalized, authoritativeSeen);
    }
  }

  if (!Array.isArray(webProbePoolRaw)) {
    throw new Error(
      `Missing or invalid ${WEB_PROBE_POOL_PATH}. Run: ${BUILD_WEB_PROBE_POOL_CMD}`,
    );
  }

  const probePoolUnique = [];
  const probePoolUniqueSeen = new Set();
  for (const item of webProbePoolRaw) {
    const normalized = normalizeFixtureItem(item, {
      expectedSourceType: "web",
      expectedScoreAvailable: false,
    });
    if (!normalized) continue;
    if (normalized.expectedSourceType !== "web") continue;
    if (probePoolUniqueSeen.has(normalized.barcode)) continue;
    probePoolUniqueSeen.add(normalized.barcode);
    probePoolUnique.push(normalized);
  }

  for (const normalized of probePoolUnique) {
    if (web.length >= 15) break;
    if (authoritativeSeen.has(normalized.barcode)) continue;
    normalized.notes = `${normalized.notes}; ${buildStabilityNote(normalized.barcode)}`;
    if (pushUnique(web, normalized, webSeen)) {
      selectedFromProbePoolCount += 1;
    }
  }

  if (authoritative.length < 35) {
    throw new Error(`Unable to build 35 authoritative rows; only got ${authoritative.length}`);
  }
  if (web.length < 15) {
    const probePoolUniqueCount = probePoolUniqueSeen.size;
    const probePoolAvailableAfterAuthoritative = probePoolUnique.filter(
      (row) => !authoritativeSeen.has(row.barcode),
    ).length;
    throw new Error(
      `Unable to build 15 unique web rows from probe pool only; selectedUnique=${web.length}, probePoolUnique=${probePoolUniqueCount}, probePoolUniqueExcludingAuthoritative=${probePoolAvailableAfterAuthoritative}. Run: ${BUILD_WEB_PROBE_POOL_CMD}`,
    );
  }

  const selectedAuthoritative = authoritative.slice(0, 35);
  const selectedWeb = web.slice(0, 15);
  const selectedWebBarcodes = selectedWeb.map((item) => item.barcode);
  const selectedWebUniqueCount = new Set(selectedWebBarcodes).size;
  const selectedWebDuplicateCount = selectedWeb.length - selectedWebUniqueCount;
  const selectedWebFromProbePoolCount = selectedWebBarcodes.filter((barcode) =>
    probePoolUniqueSeen.has(barcode),
  ).length;

  if (selectedWebUniqueCount < 15 || selectedWebDuplicateCount > 0 || selectedWebFromProbePoolCount < 15) {
    throw new Error(
      `Web fixture contract violated: selectedWeb=${selectedWeb.length}, selectedWebUnique=${selectedWebUniqueCount}, selectedWebDuplicate=${selectedWebDuplicateCount}, selectedWebFromProbePool=${selectedWebFromProbePoolCount}. Run: ${BUILD_WEB_PROBE_POOL_CMD}`,
    );
  }

  const fixed = [...selectedAuthoritative, ...selectedWeb];
  await fs.promises.mkdir(FIXTURE_DIR, { recursive: true });
  await fs.promises.writeFile(OUT_PATH, JSON.stringify(fixed, null, 2), "utf8");

  const webStabilityRows = [...webStability.entries()]
    .map(([barcode, stats]) => ({
      barcode,
      observedRuns: stats.observedRuns,
      healthyRuns: stats.healthyRuns,
      webRuns: stats.webRuns,
      rev1Runs: stats.rev1Runs,
      doneRuns: stats.doneRuns,
      terminalErrorRuns: stats.terminalErrorRuns,
      contractFailureRuns: stats.contractFailureRuns,
      hardContractFailureRuns: stats.hardContractFailureRuns,
      abortOrTimeoutRuns: stats.abortOrTimeoutRuns,
      webRate: toRate(stats.webRuns, stats.observedRuns),
      rev1Rate: toRate(stats.rev1Runs, stats.observedRuns),
      doneRate: toRate(stats.doneRuns, stats.observedRuns),
      terminalErrorRate: toRate(stats.terminalErrorRuns, stats.observedRuns),
      contractFailureRate: toRate(stats.contractFailureRuns, stats.observedRuns),
      hardContractFailureRate: toRate(stats.hardContractFailureRuns, stats.observedRuns),
      abortOrTimeoutRate: toRate(stats.abortOrTimeoutRuns, stats.observedRuns),
      stable: isStableWebStats(stats),
      runIds: [...stats.runIds].sort(),
    }))
    .sort((a, b) => {
      if (b.healthyRuns !== a.healthyRuns) return b.healthyRuns - a.healthyRuns;
      if (b.observedRuns !== a.observedRuns) return b.observedRuns - a.observedRuns;
      return a.barcode.localeCompare(b.barcode);
    });
  const report = {
    generatedAt: new Date().toISOString(),
    thresholds: stableThresholds,
    latestBulkDir: latestBulk.dir,
    historicalRunCount: HISTORICAL_WEB_LOOKBACK_RUNS,
    historicalRowsRawCount: historicalRows.length,
    historicalRowsDedupedCount: historicalRowsDeduped.length,
    selectedAuthoritativeCount: selectedAuthoritative.length,
    selectedWebCount: selectedWeb.length,
    selectedFromProbePoolCount,
    selectedWebUniqueCount,
    selectedWebDuplicateCount,
    selectedWebFromProbePoolCount,
    selectedWebBarcodes,
    stableWebBarcodeCount: webStabilityRows.filter((row) => row.stable).length,
    webStabilityRows,
  };
  await fs.promises.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(`[stage3a-fixed50] wrote ${OUT_PATH}`);
  console.log(`[stage3a-fixed50] wrote ${REPORT_PATH}`);
  console.log(
    `[stage3a-fixed50] authoritative=${selectedAuthoritative.length} web=${selectedWeb.length} total=${fixed.length}`,
  );
};

main().catch((error) => {
  console.error("[stage3a-fixed50] failed:", error);
  process.exit(1);
});
