#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classifyCohortBuckets } from "./lib/cohort-bucket-classifier.mjs";

const ROOT_DIR = process.cwd();
const NOW_TAG = new Date().toISOString().replace(/[:.]/g, "-");

const BUCKET_FIX_PLAN = {
  CRASH_UNCAUGHT_EXCEPTION: { fixLane: "code", owner: "A", priority: 0 },
  CLIENT_TIMEOUT: { fixLane: "code", owner: "A", priority: 0 },
  SSE_NOT_CONNECTED: { fixLane: "infra", owner: "D", priority: 0 },
  SSE_CONNECTED_NO_DONE: { fixLane: "code", owner: "A", priority: 0 },
  AUTHORITATIVE_EXPECTED_BUT_NOT_FINAL: { fixLane: "data", owner: "B", priority: 0 },
  WEB_FALLBACK_SOURCE_TYPE_FINAL_FALSE: { fixLane: "data", owner: "B", priority: 1 },
  SCORE_PENDING_TIMEOUT_AFTER_DONE: { fixLane: "code", owner: "A", priority: 1 },
  COVER_DETAIL_INCONSISTENT: { fixLane: "code", owner: "A", priority: 1 },
  NEGATIVE_CACHE_RESIDUAL: { fixLane: "code", owner: "A", priority: 1 },
  SCORE_INPUT_PURITY_LEAK: { fixLane: "code", owner: "A", priority: 1 },
  NONDETERMINISTIC_SAME_BARCODE: { fixLane: "code", owner: "A", priority: 0 },
  DATA_CEILING: { fixLane: "data", owner: "B", priority: 2 },
  HEALTHY: { fixLane: "none", owner: "none", priority: 3 },
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const hasFlag = (flag) => args.includes(`--${flag}`);
  const getArg = (flag) => {
    const idx = args.indexOf(`--${flag}`);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };
  if (hasFlag("help")) {
    console.log(`Usage:
  node scripts/maintainer/triage-cohort-results.mjs [options]

Options:
  --traces-jsonl <path>        traces.jsonl input
  --summary-json <path>        replay_summary.json input (optional)
  --out-dir <path>             Output directory (default: output/triage/<timestamp>)
  --min-attempts <n>           Evidence sufficiency threshold (default: 100)
  --min-role-samples <n>       Per-role sufficiency threshold (default: 20)
`);
    process.exit(0);
  }
  const tracesArg = getArg("traces-jsonl");
  if (!tracesArg) throw new Error("Missing required --traces-jsonl");
  const tracesPath = path.isAbsolute(tracesArg) ? tracesArg : path.join(ROOT_DIR, tracesArg);
  const summaryArg = getArg("summary-json");
  const summaryPath = summaryArg
    ? (path.isAbsolute(summaryArg) ? summaryArg : path.join(ROOT_DIR, summaryArg))
    : null;
  const outDirArg = getArg("out-dir") || path.join("output", "triage", NOW_TAG);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  const minAttemptsRaw = Number(getArg("min-attempts") || 100);
  const minRoleSamplesRaw = Number(getArg("min-role-samples") || 20);
  return {
    tracesPath,
    summaryPath,
    outDir,
    minAttempts: Number.isFinite(minAttemptsRaw) && minAttemptsRaw > 0 ? Math.floor(minAttemptsRaw) : 100,
    minRoleSamples: Number.isFinite(minRoleSamplesRaw) && minRoleSamplesRaw > 0 ? Math.floor(minRoleSamplesRaw) : 20,
  };
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readJsonl = async (filePath) => {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => JSON.parse(line));
};

const buildRoleCounts = (rows) => rows.reduce((acc, row) => {
  const role = String(row?.role ?? "unknown");
  acc[role] = (acc[role] ?? 0) + 1;
  return acc;
}, {});

const buildRepairQueue = (bucketRows) => {
  const actionable = bucketRows.filter((row) => {
    const bucket = String(row?.bucket ?? "");
    return bucket !== "HEALTHY" && bucket !== "DATA_CEILING";
  });
  const deduped = new Map();
  for (let idx = 0; idx < actionable.length; idx += 1) {
    const row = actionable[idx];
    const barcode = String(row?.barcode ?? "").trim();
    if (!barcode) continue;
    const bucket = String(row?.bucket ?? "UNKNOWN");
    const key = `${barcode}::${bucket}`;
    const traceRef = {
      traceLine: idx + 1,
      requestId: row?.requestId ?? null,
      terminalReason: row?.terminalReason ?? null,
      stabilityHash: row?.stabilityHash ?? null,
      replayProfile: row?.replayProfile ?? null,
    };
    if (deduped.has(key)) {
      const existing = deduped.get(key);
      if (Array.isArray(existing?.evidenceRefs) && existing.evidenceRefs.length < 5) {
        existing.evidenceRefs.push(traceRef);
      }
      continue;
    }
    const fix = BUCKET_FIX_PLAN[bucket] || { fixLane: "unknown", owner: "unknown", priority: 3 };
    deduped.set(key, {
      barcode,
      country: row?.country ?? null,
      expectedDatasetHint: row?.expectedDatasetHint ?? null,
      bucket,
      failureBucket: bucket,
      fixLane: fix.fixLane,
      owner: fix.owner,
      priority: fix.priority,
      sourceType: row?.rev1SourceType ?? null,
      sourceTypeFinal: row?.sourceTypeFinal === true,
      terminalReason: row?.terminalReason ?? null,
      replayProfile: row?.replayProfile ?? null,
      role: row?.role ?? null,
      stabilityHash: row?.stabilityHash ?? null,
      evidenceRefs: [traceRef],
    });
  }
  return [...deduped.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
    return a.barcode.localeCompare(b.barcode);
  });
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("# Cohort Triage Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- systemHealthVerdict: ${report.systemHealthVerdict}`);
  lines.push(`- evidenceSufficiencyVerdict: ${report.evidenceSufficiencyVerdict}`);
  lines.push(`- attemptCount: ${report.attemptCount}`);
  lines.push(`- roleCounts: \`${JSON.stringify(report.roleCounts)}\``);
  lines.push("");
  lines.push("## Buckets");
  lines.push("");
  lines.push("| bucket | count | fixLane | owner | priority |");
  lines.push("| --- | ---: | --- | --- | ---: |");
  for (const item of report.bucketTop) {
    const fix = BUCKET_FIX_PLAN[item.bucket] || { fixLane: "unknown", owner: "unknown", priority: 3 };
    lines.push(`| ${item.bucket} | ${item.count} | ${fix.fixLane} | ${fix.owner} | ${fix.priority} |`);
  }
  lines.push("");
  lines.push(`- healthReasons: \`${JSON.stringify(report.healthReasons)}\``);
  lines.push(`- evidenceReasons: \`${JSON.stringify(report.evidenceReasons)}\``);
  lines.push(`- warnings: \`${JSON.stringify(report.warnings ?? [])}\``);
  lines.push(`- roleDeficit: \`${JSON.stringify(report.roleDeficit ?? [])}\``);
  lines.push(`- nondeterministicBarcodes: \`${JSON.stringify(report.nondeterministicBarcodes)}\``);
  lines.push(`- nondeterministicDetails: \`${JSON.stringify(report.nondeterministicDetails ?? [])}\``);
  lines.push(`- repairQueueSize: ${report.repairQueueSize}`);
  lines.push(`- queuePaths: \`${JSON.stringify(report.queuePaths ?? {})}\``);
  return `${lines.join("\n")}\n`;
};

const buildGoNoGoMarkdown = (report) => {
  const lines = [];
  lines.push("# Go/No-Go");
  lines.push("");
  lines.push(`- systemHealthVerdict: ${report.systemHealthVerdict}`);
  lines.push(`- evidenceSufficiencyVerdict: ${report.evidenceSufficiencyVerdict}`);
  lines.push(`- healthReasons: ${(report.healthReasons || []).join(", ") || "none"}`);
  lines.push(`- evidenceReasons: ${(report.evidenceReasons || []).join(", ") || "none"}`);
  lines.push("");
  lines.push("## Rule");
  lines.push("");
  lines.push("- health fail => non-zero exit.");
  lines.push("- health pass + evidence insufficient => zero exit with warning.");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const opts = parseArgs();
  const traces = await readJsonl(opts.tracesPath);
  const replaySummary = opts.summaryPath ? await readJson(opts.summaryPath) : null;
  const classified = classifyCohortBuckets(traces);
  const roleCounts = buildRoleCounts(traces);
  const roleDeficit = Object.entries(roleCounts)
    .filter(([, count]) => Number(count) < opts.minRoleSamples)
    .map(([role, count]) => ({
      role,
      actual: Number(count),
      required: opts.minRoleSamples,
      deficit: Math.max(0, opts.minRoleSamples - Number(count)),
    }));

  const healthReasons = [];
  const evidenceReasons = [];
  const warnings = [];
  const blockingBuckets = [
    "CRASH_UNCAUGHT_EXCEPTION",
    "CLIENT_TIMEOUT",
    "SSE_NOT_CONNECTED",
    "SSE_CONNECTED_NO_DONE",
    "AUTHORITATIVE_EXPECTED_BUT_NOT_FINAL",
    "WEB_FALLBACK_SOURCE_TYPE_FINAL_FALSE",
    "SCORE_PENDING_TIMEOUT_AFTER_DONE",
    "COVER_DETAIL_INCONSISTENT",
    "NEGATIVE_CACHE_RESIDUAL",
    "SCORE_INPUT_PURITY_LEAK",
  ];
  for (const bucket of blockingBuckets) {
    if (Number(classified.bucketCounts[bucket] ?? 0) > 0) {
      healthReasons.push(`${bucket}_${classified.bucketCounts[bucket]}`);
    }
  }
  const nondeterministicDetails = Array.isArray(classified.nondeterministicDetails)
    ? classified.nondeterministicDetails
    : [];
  const nondeterministicBlockingCount = nondeterministicDetails.filter(
    (item) => item?.classification !== "acceptable_web_only_nondeterministic",
  ).length;
  const nondeterministicWarningCount = nondeterministicDetails.filter(
    (item) => item?.classification === "acceptable_web_only_nondeterministic",
  ).length;
  if (nondeterministicBlockingCount > 0) {
    healthReasons.push(`NONDETERMINISTIC_SAME_BARCODE_${nondeterministicBlockingCount}`);
  }
  if (nondeterministicWarningCount > 0) {
    warnings.push(`NONDETERMINISTIC_WEB_ONLY_${nondeterministicWarningCount}`);
  }
  if (traces.length < opts.minAttempts) {
    evidenceReasons.push(`attempt_count_${traces.length}_lt_${opts.minAttempts}`);
  }
  if (roleDeficit.length > 0) {
    const compact = roleDeficit.map((entry) => `${entry.role}:${entry.actual}`);
    evidenceReasons.push(`role_sample_deficit_${compact.join("|")}`);
  }
  if (replaySummary?.uiSkippedByBudget > 0 && replaySummary?.replayProfile === "full_ui") {
    evidenceReasons.push(`ui_skipped_by_budget_${replaySummary.uiSkippedByBudget}`);
  }

  const systemHealthVerdict = healthReasons.length === 0 ? "pass" : "fail";
  const evidenceSufficiencyVerdict = evidenceReasons.length === 0 ? "sufficient" : "insufficient";

  const repairQueue = buildRepairQueue(classified.bucketRows);
  const queueByLane = {
    code: repairQueue.filter((row) => row.fixLane === "code"),
    data: repairQueue.filter((row) => row.fixLane === "data"),
    infra: repairQueue.filter((row) => row.fixLane === "infra"),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    tracesPath: opts.tracesPath,
    summaryPath: opts.summaryPath,
    attemptCount: traces.length,
    roleCounts,
    bucketCounts: classified.bucketCounts,
    bucketTop: classified.bucketTop,
    nondeterministicBarcodes: classified.nondeterministicBarcodes,
    nondeterministicDetails,
    systemHealthVerdict,
    evidenceSufficiencyVerdict,
    healthReasons,
    evidenceReasons,
    warnings,
    repairQueueSize: repairQueue.length,
    roleDeficit,
    queueByLaneCounts: {
      code: queueByLane.code.length,
      data: queueByLane.data.length,
      infra: queueByLane.infra.length,
    },
  };

  await fs.mkdir(opts.outDir, { recursive: true });
  const triageJsonPath = path.join(opts.outDir, "triage_report.json");
  const triageMdPath = path.join(opts.outDir, "triage_report.md");
  const repairQueuePath = path.join(opts.outDir, "repair_queue.jsonl");
  const codeQueuePath = path.join(opts.outDir, "code_fix_queue.jsonl");
  const dataQueuePath = path.join(opts.outDir, "data_mapping_queue.jsonl");
  const infraQueuePath = path.join(opts.outDir, "infra_env_queue.jsonl");
  const nondeterministicPath = path.join(opts.outDir, "nondeterministic_barcodes.json");
  const nondeterministicExamplesPath = path.join(opts.outDir, "nondeterministic_examples.jsonl");
  const goNoGoPath = path.join(opts.outDir, "go_no_go.md");

  report.queuePaths = {
    repairQueuePath,
    codeQueuePath,
    dataQueuePath,
    infraQueuePath,
  };

  await fs.writeFile(triageJsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(triageMdPath, buildMarkdown(report), "utf8");
  await fs.writeFile(
    repairQueuePath,
    repairQueue.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(
    codeQueuePath,
    queueByLane.code.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(
    dataQueuePath,
    queueByLane.data.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(
    infraQueuePath,
    queueByLane.infra.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(nondeterministicPath, JSON.stringify(classified.nondeterministicBarcodes, null, 2), "utf8");
  await fs.writeFile(
    nondeterministicExamplesPath,
    classified.nondeterministicExamples.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
  await fs.writeFile(goNoGoPath, buildGoNoGoMarkdown(report), "utf8");

  console.log(`[triage-cohort-results] wrote ${triageJsonPath}`);
  console.log(`[triage-cohort-results] wrote ${repairQueuePath}`);
  console.log(
    `[triage-cohort-results] health=${systemHealthVerdict} evidence=${evidenceSufficiencyVerdict}`,
  );

  if (systemHealthVerdict === "fail") {
    process.exit(1);
  }
  process.exit(0);
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      "[triage-cohort-results] failed",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
