#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
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
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const hasRouting = (row) => Boolean(row?.owner) && Boolean(row?.status) && Boolean(row?.reasonCode);

const safeQueueRow = (row, queue, defaults = {}) => ({
  ...row,
  queue,
  owner: row?.owner || defaults.owner || "top100-ops",
  status: row?.status || defaults.status || "open",
  reasonCode: row?.reasonCode || defaults.reasonCode || `${queue}_pending`,
  eta: row?.eta || defaults.eta || "next_cycle",
});

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[finalize-new-top100-nightly-closeout] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(nightlyDir, "phase_g");
  const oldGapQueueJsonl =
    resolvePath(getArg("old-gap-queue-jsonl"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-e-plus-20260302T074048Z", "step0_to_step2_rerun", "step0_universe", "brand_alias_fix_queue.jsonl");

  const qualityGate = await readJson(path.join(nightlyDir, "phase_a1", "new_top100_crossdb_quality_gate.json"));
  const watchlist = await readJson(path.join(nightlyDir, "phase_a1", "low_ca_presence_watchlist.json"));
  const sourceAudit = await readJson(path.join(nightlyDir, "phase_a2", "source_diversity_audit.json"));
  const census = await readJson(path.join(nightlyDir, "phase_b", "new_top100_readonly_census.json"));
  const readiness = await readJson(path.join(nightlyDir, "phase_b", "new_top100_lane1_readiness.json"));
  const score = await readJson(path.join(nightlyDir, "phase_c", "new_top100_priority_scoreboard.json"));
  const tier1 = await readJson(path.join(nightlyDir, "phase_c", "new_top100_execution_slice_tier1.json"));
  const tier2 = await readJson(path.join(nightlyDir, "phase_c", "new_top100_execution_slice_tier2.json"));
  const uxCoverage = await readJson(path.join(nightlyDir, "phase_f", "new_top100_patch_ux_coverage_report.json"));

  const runtimeProof = await readJson(path.join(nightlyDir, "phase_e", "runtime_proof_expanded_new_top100.json")).catch(() => null);

  const batchesRoot = path.join(nightlyDir, "phase_d", "batches");
  const batchNames = (await fs.readdir(batchesRoot, { withFileTypes: true }).catch(() => []))
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .sort();

  const batchSummaries = [];
  const fixable = [];
  const ceiling = [];

  for (const batchName of batchNames) {
    const batchDir = path.join(batchesRoot, batchName);
    const gate = await readJson(path.join(batchDir, "batch_gate_report.json")).catch(() => null);
    const enforceDecision = await readJson(path.join(batchDir, "enforce", "enforce_report.json")).catch(() => null);
    const prefilterConflicts = await readJsonl(path.join(batchDir, "prefilter", "conflicts_queue.jsonl"));
    const postfilterRejects = await readJsonl(path.join(batchDir, "postfilter", "postfilter_rejects.jsonl"));

    batchSummaries.push({
      batchId: batchName,
      pass: Boolean(gate?.gates?.pass),
      enforceApplied: Boolean(enforceDecision?.enforceApplied),
      improvementRate: gate?.metrics?.missingDirectionsImprovementRate ?? 0,
      conflictRate: gate?.metrics?.conflict_rate ?? 0,
      conflictAbs: gate?.metrics?.conflict_abs ?? 0,
      runtimeHit: gate?.metrics?.runtimePatchHitCountDelta ?? 0,
      scopeEvidencePass: Boolean(gate?.gates?.scopeEvidencePass),
    });

    for (const row of prefilterConflicts) {
      fixable.push(safeQueueRow(row, "fixable", {
        owner: "new-top100-lane1-repair",
        status: "open",
        reasonCode: "prefilter_conflict",
      }));
    }
    for (const row of postfilterRejects) {
      ceiling.push(safeQueueRow(row, "ceiling", {
        owner: "new-top100-lane1-explain",
        status: "open",
        reasonCode: row?.rejectReason || "postfilter_reject",
      }));
    }
  }

  const watchRows = Array.isArray(watchlist?.rows) ? watchlist.rows : [];
  const watchQueue = watchRows.map((row) => safeQueueRow({
    ...row,
    execution_eligible: row?.execution_eligible,
  }, "watchlist", {
    owner: "new-top100-watchlist-ops",
    status: row?.auditPass ? "monitor" : "blocked",
    reasonCode: row?.auditPass ? "low_ca_presence_pass_tier2_only" : "low_ca_presence_audit_fail",
    eta: "next_cycle",
  }));

  const oldGapQueue = await readJsonl(oldGapQueueJsonl);
  const oldGapRouted = oldGapQueue.map((row) => safeQueueRow(row, "fixable", {
    owner: row?.owner || "old-top100-gap-ops",
    status: row?.status || "open",
    reasonCode: row?.reasonCode || "coverage_gap_pending",
    eta: row?.eta || "next_cycle",
  }));

  const dangling = [
    ...fixable.filter((row) => !hasRouting(row)),
    ...ceiling.filter((row) => !hasRouting(row)),
    ...watchQueue.filter((row) => !hasRouting(row)),
  ];

  const shadowCompleted = batchSummaries.length;
  const shadowPassCount = batchSummaries.filter((row) => row.pass).length;
  const enforceCompleted = batchSummaries.filter((row) => row.enforceApplied).length;

  const completionPass =
    Boolean(qualityGate?.summary?.gatePass)
    && asNumber(census?.summary?.dbWriteCount, 0) === 0
    && shadowCompleted >= 3
    && enforceCompleted >= 1
    && dangling.length === 0;

  const blockingReasons = [];
  if (!Boolean(qualityGate?.summary?.gatePass)) blockingReasons.push("quality_gate_fail");
  if (asNumber(census?.summary?.dbWriteCount, 0) !== 0) blockingReasons.push("readonly_db_write_nonzero");
  if (shadowCompleted < 3) blockingReasons.push("shadow_batches_lt_3");
  if (enforceCompleted < 1) blockingReasons.push("enforce_completed_lt_1");
  if (dangling.length > 0) blockingReasons.push("dangling_queue_items");

  const decision = {
    generatedAt: new Date().toISOString(),
    nightlyDir,
    pass: completionPass,
    blockingReasons,
    summary: {
      qualityGatePass: Boolean(qualityGate?.summary?.gatePass),
      sourceAuditBrandCount: asNumber(sourceAudit?.summary?.brandCount, 0),
      readOnlyDbWriteCount: asNumber(census?.summary?.dbWriteCount, 0),
      tier1Count: Array.isArray(tier1?.rows) ? tier1.rows.length : 0,
      tier2Count: Array.isArray(tier2?.rows) ? tier2.rows.length : 0,
      shadowCompleted,
      shadowPassCount,
      enforceCompleted,
      runtimeProofExpanded: Boolean(runtimeProof),
      runtimeProofBatchCount: asNumber(runtimeProof?.totalBatches, 0),
      low_ca_audit_pass_count: asNumber(qualityGate?.summary?.lowCaAuditPassCount, 0),
      low_ca_promoted_to_tier2_count: (Array.isArray(tier2?.rows) ? tier2.rows : []).filter((row) => row.low_ca_presence).length,
      low_ca_blocked_count: asNumber(qualityGate?.summary?.lowCaBlockedCount, 0),
      newPoolUxSignal: uxCoverage?.summary || null,
      oldTop100GapQueueCount: oldGapRouted.length,
      danglingQueueItems: dangling.length,
      pass: completionPass,
    },
    decisions: {
      newTop100QualityGate: completionPass ? "pass" : "partial",
      removedFromExecutionPool: (Array.isArray(qualityGate?.invalidForExecution) ? qualityGate.invalidForExecution : []).map((row) => ({
        brandName: row.brandName,
        reasonCode: row.reasonCode,
      })),
      nextPriority: [
        "continue lane1 batches with tier2 candidates",
        "resolve blocked low_ca watchlist and old top100 coverage gaps in parallel",
        "promote enforced_and_visible brands to next wave",
      ],
    },
    batchSummaries,
  };

  await writeJson(path.join(outDir, "nightly_closeout_decision.json"), decision);
  await writeJsonl(path.join(outDir, "fixable_queue_new_top100.jsonl"), [...fixable, ...oldGapRouted]);
  await writeJsonl(path.join(outDir, "ceiling_queue_new_top100.jsonl"), ceiling);
  await writeJsonl(path.join(outDir, "watchlist_queue_new_top100.jsonl"), watchQueue);

  await writeText(
    path.join(outDir, "nightly_closeout_decision.md"),
    [
      "# Nightly Closeout Decision",
      "",
      `- pass: ${decision.summary.pass}`,
      `- qualityGatePass: ${decision.summary.qualityGatePass}`,
      `- readOnlyDbWriteCount: ${decision.summary.readOnlyDbWriteCount}`,
      `- tier1Count: ${decision.summary.tier1Count}`,
      `- tier2Count: ${decision.summary.tier2Count}`,
      `- shadowCompleted: ${decision.summary.shadowCompleted}`,
      `- shadowPassCount: ${decision.summary.shadowPassCount}`,
      `- enforceCompleted: ${decision.summary.enforceCompleted}`,
      `- runtimeProofExpanded: ${decision.summary.runtimeProofExpanded}`,
      `- low_ca_audit_pass_count: ${decision.summary.low_ca_audit_pass_count}`,
      `- low_ca_promoted_to_tier2_count: ${decision.summary.low_ca_promoted_to_tier2_count}`,
      `- low_ca_blocked_count: ${decision.summary.low_ca_blocked_count}`,
      `- danglingQueueItems: ${decision.summary.danglingQueueItems}`,
      "",
      "## Next Priority",
      ...decision.decisions.nextPriority.map((line) => `- ${line}`),
    ].join("\n") + "\n",
  );

  console.log("[finalize-new-top100-nightly-closeout] completed");
  console.log(JSON.stringify({
    outDir,
    pass: decision.summary.pass,
    shadowCompleted,
    enforceCompleted,
    dangling: decision.summary.danglingQueueItems,
  }, null, 2));
};

main().catch((error) => {
  console.error("[finalize-new-top100-nightly-closeout] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
