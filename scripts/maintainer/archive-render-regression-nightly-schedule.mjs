#!/usr/bin/env node
/**
 * Archive the latest scheduled "Render Regression (Nightly)" run artifacts locally and
 * append a compact row into:
 *   output/stability-evidence/render-regression-nightly/schedule/runs.json
 *
 * This is intentionally "repo-root relative" so it can run on any machine.
 *
 * Usage:
 *   node scripts/maintainer/archive-render-regression-nightly-schedule.mjs --init-baseline
 *   node scripts/maintainer/archive-render-regression-nightly-schedule.mjs
 *   node scripts/maintainer/archive-render-regression-nightly-schedule.mjs --wait-ms 7200000 --poll-ms 30000
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_WORKFLOW = "Render Regression (Nightly)";
const DEFAULT_BRANCH = "main";
const DEFAULT_EVENT = "schedule";

function exitWithError(message) {
  console.error(`[archive-schedule] ${message}`);
  process.exit(1);
}

function execText(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...options });
}

function execInherit(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function execJson(cmd, args, options = {}) {
  const raw = execText(cmd, args, options);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse JSON from ${cmd} ${args.join(" ")}: ${(error && error.message) || error}`,
    );
  }
}

function parseArgs(argv) {
  const out = {
    initBaseline: false,
    force: false,
    maxRuns: 1,
    waitMs: 0,
    pollMs: 30_000,
    workflow: DEFAULT_WORKFLOW,
    branch: DEFAULT_BRANCH,
    event: DEFAULT_EVENT,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--init-baseline") out.initBaseline = true;
    else if (token === "--force") out.force = true;
    else if (token === "--max" || token === "--max-runs") out.maxRuns = Number(argv[++i] ?? "1");
    else if (token === "--wait-ms") out.waitMs = Number(argv[++i] ?? "0");
    else if (token === "--poll-ms") out.pollMs = Number(argv[++i] ?? "30000");
    else if (token === "--workflow") out.workflow = argv[++i] ?? DEFAULT_WORKFLOW;
    else if (token === "--branch") out.branch = argv[++i] ?? DEFAULT_BRANCH;
    else if (token === "--event") out.event = argv[++i] ?? DEFAULT_EVENT;
    else exitWithError(`Unknown argument: ${token}`);
  }

  if (!Number.isFinite(out.maxRuns) || out.maxRuns <= 0) {
    exitWithError(`--max must be a positive number (got ${out.maxRuns})`);
  }
  if (!Number.isFinite(out.waitMs) || out.waitMs < 0) {
    exitWithError(`--wait-ms must be >= 0 (got ${out.waitMs})`);
  }
  if (!Number.isFinite(out.pollMs) || out.pollMs <= 0) {
    exitWithError(`--poll-ms must be a positive number (got ${out.pollMs})`);
  }

  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveRepoRoot() {
  try {
    return execText("git", ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return process.cwd();
  }
}

function listScheduleRuns({ workflow, branch, event, limit = 20 }) {
  return execJson("gh", [
    "run",
    "list",
    "--workflow",
    workflow,
    "--event",
    event,
    "--branch",
    branch,
    "--limit",
    String(limit),
    "--json",
    "databaseId,headSha,status,conclusion,createdAt,url",
  ]);
}

function getWaitStepConclusion(runId) {
  try {
    const view = execJson("gh", ["run", "view", String(runId), "--json", "jobs"]);
    const jobs = Array.isArray(view.jobs) ? view.jobs : [];
    for (const job of jobs) {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      const waitStep = steps.find((step) => step?.name === "Wait for Render Deploy Commit");
      if (waitStep) return waitStep?.conclusion ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function findCandidateSummaryPaths(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name === "summary.json") out.push(fullPath);
    }
  }
  return out;
}

function loadBestRootSummary(rootDir) {
  const candidates = findCandidateSummaryPaths(rootDir);
  let best = null;
  let bestCasesLen = -1;

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch {
      continue;
    }
    const cases = Array.isArray(parsed?.cases) ? parsed.cases : null;
    if (!cases || cases.length === 0) continue;

    // Root summary has the largest cases[] array; per-case summaries are smaller or lack cases[].
    if (cases.length > bestCasesLen) {
      best = { path: candidate, summary: parsed };
      bestCasesLen = cases.length;
    }
  }

  return best;
}

function normalizeSummaryCounts(summary) {
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  const isObserve = (c) => c?.observeOnly === true;

  const computedFailCount = cases.filter((c) => c?.pass === false && !isObserve(c)).length;
  const computedObserveFailCount = cases.filter((c) => c?.pass === false && isObserve(c)).length;
  const computedObserveCaseCount = cases.filter((c) => isObserve(c)).length;

  return {
    failCount:
      typeof summary?.failCount === "number" && Number.isFinite(summary.failCount)
        ? summary.failCount
        : computedFailCount,
    observeFailCount:
      typeof summary?.observeFailCount === "number" && Number.isFinite(summary.observeFailCount)
        ? summary.observeFailCount
        : computedObserveFailCount,
    observeCaseCount:
      typeof summary?.observeCaseCount === "number" && Number.isFinite(summary.observeCaseCount)
        ? summary.observeCaseCount
        : computedObserveCaseCount,
  };
}

function extractCase(summary, caseId) {
  const cases = Array.isArray(summary?.cases) ? summary.cases : [];
  const found = cases.find((c) => c?.caseId === caseId);
  if (!found) return null;

  return {
    pass: found?.pass === true,
    observeOnly: found?.observeOnly === true,
    usedBarcode: found?.usedBarcode ?? null,
    primaryBarcode: found?.primaryBarcode ?? null,
    primaryFailedReason: found?.primaryFailedReason ?? null,
    expectedSourceType: found?.expectedSourceType ?? null,
    sourceType: found?.sourceType ?? null,
    fallbackUsed: found?.fallbackUsed ?? null,
    fallbackReason: found?.fallbackReason ?? null,
    detail429Count: typeof found?.detail429Count === "number" ? found.detail429Count : 0,
    errors: Array.isArray(found?.errors) ? found.errors : [],
  };
}

function extractRagQuadrantMetricsSubset(summary) {
  const rag =
    summary?.ragQuadrantMetrics && typeof summary.ragQuadrantMetrics === "object"
      ? summary.ragQuadrantMetrics
      : {};
  return {
    sampleSize: typeof rag?.sampleSize === "number" ? rag.sampleSize : null,
    cacheHitRate: typeof rag?.cacheHitRate === "number" ? rag.cacheHitRate : null,
    watchdogFastTimeoutRateNoCache:
      typeof rag?.watchdogFastTimeoutRateNoCache === "number"
        ? rag.watchdogFastTimeoutRateNoCache
        : null,
    watchdogFastTimeoutBucketCounts:
      rag?.watchdogFastTimeoutBucketCounts && typeof rag.watchdogFastTimeoutBucketCounts === "object"
        ? rag.watchdogFastTimeoutBucketCounts
        : {},
    retrievalFailureCodeCounts:
      rag?.retrievalFailureCodeCounts && typeof rag.retrievalFailureCodeCounts === "object"
        ? rag.retrievalFailureCodeCounts
        : {},
    abstainTriggeredCount: typeof rag?.abstainTriggeredCount === "number" ? rag.abstainTriggeredCount : null,
    abstainEvaluatedCount: typeof rag?.abstainEvaluatedCount === "number" ? rag.abstainEvaluatedCount : null,
    abstainCorrectCount: typeof rag?.abstainCorrectCount === "number" ? rag.abstainCorrectCount : null,
    abstainUnknownCount: typeof rag?.abstainUnknownCount === "number" ? rag.abstainUnknownCount : null,
    abstainCorrectnessRate: typeof rag?.abstainCorrectnessRate === "number" ? rag.abstainCorrectnessRate : null,
    abstainSignalLost: typeof rag?.abstainSignalLost === "boolean" ? rag.abstainSignalLost : null,
  };
}

function stringifyErrors(errors) {
  if (!Array.isArray(errors)) return "";
  const strings = [];
  for (const error of errors) {
    if (typeof error === "string") strings.push(error);
    else if (error && typeof error === "object") strings.push(JSON.stringify(error));
  }
  return strings.join("\n");
}

function classifyRun({ waitStepConclusion, summary }) {
  // 1) Deploy drift has the highest priority.
  if (waitStepConclusion && waitStepConclusion !== "success") {
    return { bucket: "deploy_drift", details: { waitStepConclusion } };
  }

  const cases = Array.isArray(summary?.cases) ? summary.cases : [];

  // 2) 429 storm (often script pressure or backoff missing) should be highlighted.
  const detail429Total = cases.reduce((acc, c) => acc + (typeof c?.detail429Count === "number" ? c.detail429Count : 0), 0);
  if (detail429Total > 0) {
    return { bucket: "detail_429_storm", details: { detail429Total } };
  }

  // 3) Source drift (expected authoritative but ended up web/unknown) is usually sample/identity governance.
  const drifted = cases.filter((c) => {
    const expected = c?.expectedSourceType;
    const actual = c?.sourceType;
    if (!expected || !actual) return false;
    if (expected === actual) return false;
    return (
      (expected === "lnhpd" || expected === "dsld") &&
      (actual === "web" || actual === "unknown" || actual === "marketplace_only")
    );
  });
  if (drifted.length > 0) {
    return {
      bucket: "source_drift",
      details: {
        driftedCount: drifted.length,
        driftedCaseIds: drifted.map((c) => c?.caseId).filter(Boolean),
      },
    };
  }

  // 4) Transient jitter signals: 5xx/timeout/AbortError.
  const allErrorsText = stringifyErrors(cases.flatMap((c) => (Array.isArray(c?.errors) ? c.errors : [])));
  const jitterPattern =
    /\bHTTP\s*5\d\d\b|\b5\d\d\b|\btimeout\b|\bAbortError\b|\bETIMEDOUT\b|\bECONNRESET\b|\bEAI_AGAIN\b/i;
  if (jitterPattern.test(allErrorsText)) {
    return { bucket: "transient_5xx_or_timeout", details: {} };
  }

  // 5) If failCount is non-zero and we didn't bucket it above, treat as a real regression.
  const { failCount } = normalizeSummaryCounts(summary);
  if (failCount > 0) {
    return { bucket: "true_regression", details: {} };
  }

  return { bucket: "pass", details: {} };
}

function computeConsecutivePasses(runs) {
  // A "pass" means no blocking fail and no observe fail (regardless of observeCaseCount).
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    const failCount = typeof r?.failCount === "number" ? r.failCount : null;
    const observeFailCount = typeof r?.observeFailCount === "number" ? r.observeFailCount : null;
    if (failCount === 0 && observeFailCount === 0) streak += 1;
    else break;
  }
  return streak;
}

function computeConsecutiveAbstainSignalLost(runs) {
  let streak = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    const lost = r?.ragQuadrantMetricsSubset?.abstainSignalLost === true;
    if (lost) streak += 1;
    else break;
  }
  return streak;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  process.chdir(repoRoot);

  const evidenceRoot = path.join(
    repoRoot,
    "output",
    "stability-evidence",
    "render-regression-nightly",
    "schedule",
  );
  const statePath = path.join(evidenceRoot, "state.json");
  const runsPath = path.join(evidenceRoot, "runs.json");

  ensureDir(evidenceRoot);

  if (args.initBaseline) {
    if (fs.existsSync(statePath) && !args.force) {
      exitWithError(`Baseline already initialized at ${statePath} (use --force to overwrite).`);
    }
    const baseline = {
      version: 1,
      workflow: args.workflow,
      branch: args.branch,
      event: args.event,
      minCreatedAtUtc: new Date().toISOString(),
      initializedAtUtc: new Date().toISOString(),
    };
    writeJson(statePath, baseline);
    if (!fs.existsSync(runsPath)) writeJson(runsPath, []);
    console.log(`[archive-schedule] Baseline initialized: minCreatedAtUtc=${baseline.minCreatedAtUtc}`);
    return;
  }

  const state = readJsonIfExists(statePath);
  if (!state?.minCreatedAtUtc) {
    exitWithError(
      `Missing baseline state at ${statePath}. Run with --init-baseline before archiving schedule runs.`,
    );
  }

  const minCreatedAtUtc = String(state.minCreatedAtUtc);
  const minCreatedAtMs = Date.parse(minCreatedAtUtc);
  if (!Number.isFinite(minCreatedAtMs)) {
    exitWithError(`Invalid state.minCreatedAtUtc: ${minCreatedAtUtc}`);
  }

  const existingRuns = readJsonIfExists(runsPath) ?? [];
  const existingRunIds = new Set(existingRuns.map((r) => r?.runId).filter((v) => typeof v === "number"));

  const startMs = Date.now();
  let archived = 0;

  while (true) {
    const runs = listScheduleRuns({
      workflow: args.workflow,
      branch: args.branch,
      event: args.event,
      limit: 30,
    });

    const eligible = runs
      .filter((run) => {
        if (!run?.createdAt) return false;
        const createdAtMs = Date.parse(run.createdAt);
        if (!Number.isFinite(createdAtMs)) return false;
        return createdAtMs >= minCreatedAtMs;
      })
      .filter((run) => typeof run?.databaseId === "number" && !existingRunIds.has(run.databaseId))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    const completedEligible = eligible.filter((run) => run.status === "completed");

    if (completedEligible.length === 0) {
      const waitedMs = Date.now() - startMs;
      if (args.waitMs > 0 && waitedMs < args.waitMs) {
        const newest = eligible[eligible.length - 1];
        const newestStatus = newest ? `${newest.databaseId} (${newest.status})` : "none";
        console.log(
          `[archive-schedule] No new completed schedule runs yet (newest eligible: ${newestStatus}); waiting ${args.pollMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, args.pollMs));
        continue;
      }
      break;
    }

    const toProcess = completedEligible.slice(0, args.maxRuns);

    for (const run of toProcess) {
      const runId = run.databaseId;
      const outDir = path.join(evidenceRoot, `run-${runId}`);
      ensureDir(outDir);

      // Download artifacts (idempotent: re-download can be useful if partial).
      execInherit("gh", ["run", "download", String(runId), "--dir", outDir]);

      const best = loadBestRootSummary(outDir);
      const waitStepConclusion = getWaitStepConclusion(runId);

      let record = {
        runId,
        url: run.url ?? null,
        headSha: run.headSha ?? null,
        createdAt: run.createdAt ?? null,
        conclusion: run.conclusion ?? null,
        summaryPath: best?.path ?? null,
        generatedAt: best?.summary?.generatedAt ?? null,
        failCount: null,
        observeFailCount: null,
        lnhpd_with_form_observe: null,
        dsld_with_form_bisglycinate: null,
        ragQuadrantMetricsSubset: null,
        bucket: null,
        bucketDetails: null,
      };

      if (!best) {
        const bucketInfo =
          waitStepConclusion && waitStepConclusion !== "success"
            ? { bucket: "deploy_drift", details: { waitStepConclusion } }
            : { bucket: "artifact_missing", details: { waitStepConclusion } };
        record = { ...record, bucket: bucketInfo.bucket, bucketDetails: bucketInfo.details };
      } else {
        const { summary } = best;
        const counts = normalizeSummaryCounts(summary);
        const lnhpd = extractCase(summary, "lnhpd_with_form_observe");
        const bis = extractCase(summary, "dsld_with_form_bisglycinate");
        const ragSubset = extractRagQuadrantMetricsSubset(summary);
        const bucketInfo = classifyRun({ waitStepConclusion, summary });

        record = {
          ...record,
          failCount: counts.failCount,
          observeFailCount: counts.observeFailCount,
          lnhpd_with_form_observe: lnhpd,
          dsld_with_form_bisglycinate: bis,
          ragQuadrantMetricsSubset: ragSubset,
          bucket: bucketInfo.bucket,
          bucketDetails: bucketInfo.details,
        };
      }

      existingRuns.push(record);
      existingRunIds.add(runId);
      archived += 1;
      console.log(`[archive-schedule] Archived run ${runId} (${record.bucket})`);
    }

    break;
  }

  // Keep runs.json stable and readable.
  existingRuns.sort((a, b) => Date.parse(a.createdAt ?? "1970-01-01") - Date.parse(b.createdAt ?? "1970-01-01"));
  writeJson(runsPath, existingRuns);

  const streak = computeConsecutivePasses(existingRuns);
  const signalLostStreak = computeConsecutiveAbstainSignalLost(existingRuns);
  console.log(
    `[archive-schedule] Done. Archived=${archived}. Total tracked=${existingRuns.length}. Consecutive PASS=${streak}.`,
  );
  console.log(`[archive-schedule] Consecutive abstainSignalLost=${signalLostStreak}.`);
  console.log(`[archive-schedule] Evidence: ${evidenceRoot}`);
}

main().catch((error) => {
  exitWithError((error && error.stack) || String(error));
});
