#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
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

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
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

const asNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const runNode = ({ script, scriptArgs }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-d1-batch] node ${cmd.join(" ")}`);
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
  console.log(`[stage-d1-batch] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
  };
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-d1-batch] missing --stage-c-dir and no stage-c outputs found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const batchManifestPath = resolvePath(getArg("batch-manifest")) || path.join(stageDRoot, "d1_batches", "brand_batch_manifest.json");
  const enforceReadyPath = resolvePath(getArg("enforce-ready-jsonl"))
    || path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_enforce_ready.jsonl");

  const controlApiBaseUrl = String(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || "")).trim();
  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "")).trim();
  if (!controlApiBaseUrl || !patchApiBaseUrl) {
    console.error("[run-stage-d1-batch] missing control/patch api base url");
    process.exit(1);
  }

  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_D1_BEARER_TOKEN || "")).trim();
  const fastGates = !["0", "false", "off"].includes(
    String(getArg("fast-gates", process.env.STAGE_D_FAST_GATES || "1")).toLowerCase(),
  );
  const allowUnassigned = hasFlag("allow-unassigned");
  const allowDrift = hasFlag("allow-drift");
  const allowIsolationFail = hasFlag("allow-isolation-fail");
  const ownerDefault = String(getArg("owner-default", process.env.STAGE_D1_OWNER_DEFAULT || "stage-d-ops")).trim();
  const targetReleaseDefault = String(
    getArg("target-release-default", process.env.STAGE_D1_TARGET_RELEASE || "v1.6.13-stage-d"),
  ).trim();

  const batchManifest = await readJson(batchManifestPath);
  const batches = Array.isArray(batchManifest?.batches) ? batchManifest.batches : [];

  const batchId = getArg("batch-id", null);
  const batchIndex = asNumber(getArg("batch-index", 0), 0);
  let batch = null;
  if (batchId) batch = batches.find((row) => String(row?.patchBatchId) === String(batchId));
  else if (batchIndex > 0) batch = batches[batchIndex - 1] ?? null;
  else batch = batches[0] ?? null;

  if (!batch) {
    console.error("[run-stage-d1-batch] batch not found");
    process.exit(1);
  }

  const batchOutDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d1_batches", batch.patchBatchId);
  await ensureDir(batchOutDir);

  const targetBrands = new Set((batch.brands || []).map((row) => `${String(row.market || "").toUpperCase()}:${normalizeBrand(row.brand)}`));
  const rows = (await readJsonl(enforceReadyPath))
    .filter((row) => row?.laneId === "patch_directions_text_v1")
    .filter((row) => {
      const key = `${String(row?.market || "US").toUpperCase()}:${normalizeBrand(row?.brandName)}`;
      return targetBrands.has(key);
    });

  if (rows.length === 0) {
    console.error(`[run-stage-d1-batch] no enforce-ready rows for ${batch.patchBatchId}`);
    process.exit(1);
  }

  const expectedCandidateCount = (batch.brands || []).reduce(
    (sum, row) => sum + asNumber(row?.candidate_count, 0),
    0,
  );
  const candidateRefreshDelta = expectedCandidateCount > 0
    ? Math.abs(rows.length - expectedCandidateCount) / expectedCandidateCount
    : 0;
  if (!allowDrift && candidateRefreshDelta > 0.2) {
    await writeJson(path.join(batchOutDir, "stage_d1_batch_candidate_refresh_guard.json"), {
      generatedAt: new Date().toISOString(),
      batchId: batch.patchBatchId,
      expectedCandidateCount,
      actualCandidateCount: rows.length,
      candidateRefreshDelta,
      guard: "abs_delta_gt_20pct",
    });
    console.error(`[run-stage-d1-batch] candidate refresh drift guard failed for ${batch.patchBatchId}`);
    process.exit(2);
  }

  const rowsEnriched = rows.map((row) => ({
    ...row,
    owner: String(row?.owner || "").trim().toLowerCase() === "unassigned" || !String(row?.owner || "").trim()
      ? ownerDefault
      : row.owner,
    targetRelease: String(row?.targetRelease || "").trim() || targetReleaseDefault,
    patchBatchId: String(row?.patchBatchId || "").trim() || batch.patchBatchId,
  }));

  const requiredFields = ["owner", "status", "targetRelease", "expiresAt", "reviewAfterDays", "reasonCode", "patchBatchId", "evidenceRef"];
  const missingFieldRows = [];
  for (const row of rowsEnriched) {
    for (const field of requiredFields) {
      const value = row?.[field];
      const missing = value == null || (typeof value === "string" && value.trim().length === 0);
      if (missing) {
        missingFieldRows.push({ candidateId: row?.candidateId || null, field });
      }
    }
    if (!allowUnassigned && String(row?.owner || "").trim().toLowerCase() === "unassigned") {
      missingFieldRows.push({ candidateId: row?.candidateId || null, field: "owner_not_unassigned" });
    }
  }

  if (missingFieldRows.length > 0) {
    await writeJson(path.join(batchOutDir, "stage_d1_batch_field_validation_errors.json"), {
      generatedAt: new Date().toISOString(),
      batchId: batch.patchBatchId,
      totalRows: rowsEnriched.length,
      missingFieldRows,
    });
    console.error(`[run-stage-d1-batch] enforce field validation failed for ${batch.patchBatchId}`);
    process.exit(2);
  }

  const unassignedCount = rowsEnriched.filter((row) => String(row?.owner || "").trim().toLowerCase() === "unassigned").length;
  const ownerCoverageRate = rowsEnriched.length > 0 ? Number(((rowsEnriched.length - unassignedCount) / rowsEnriched.length).toFixed(6)) : 0;

  const barcodes = [...new Set(rowsEnriched.map((row) => normalizeBarcode(row?.barcode_gtin14)).filter(Boolean))];
  if (barcodes.length === 0) {
    console.error(`[run-stage-d1-batch] no barcodes for ${batch.patchBatchId}`);
    process.exit(1);
  }

  const batchBarcodesPath = path.join(batchOutDir, "stage_d1_batch_barcodes.json");
  await writeJson(batchBarcodesPath, barcodes.map((barcode, idx) => ({ role: idx === 0 ? "killer" : `batch_${idx}`, barcode })));

  const batchCandidatesMetaPath = path.join(batchOutDir, "batch_patch_candidates.meta.json");
  const batchCandidatesJsonlPath = path.join(batchOutDir, "batch_patch_candidates.jsonl");
  runNode({
    script: "scripts/maintainer/build-stage-d1-batch-candidates.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", stageDRoot,
      "--batch-manifest", batchManifestPath,
      "--batch-id", batch.patchBatchId,
      "--lane-id", "patch_directions_text_v1",
      "--out-dir", batchOutDir,
    ],
  });

  const isolationProofOutDir = path.join(batchOutDir, "d1b_isolation");
  const isolationProofRun = runNodeSoft({
    script: "scripts/maintainer/run-stage-d1-batch-isolation-proof.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", stageDRoot,
      "--batch-candidates-meta", batchCandidatesMetaPath,
      "--batch-candidates-jsonl", batchCandidatesJsonlPath,
      "--patch-api-base-url", patchApiBaseUrl,
      "--lane-id", "patch_directions_text_v1",
      "--out-dir", isolationProofOutDir,
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });
  if (!allowIsolationFail && !isolationProofRun.ok) {
    console.error(`[run-stage-d1-batch] isolation proof failed for ${batch.patchBatchId}`);
    process.exit(2);
  }

  const isolationProofPath = path.join(isolationProofOutDir, "stage_d1b_batch_isolation_proof.json");
  const isolationProof = await readJson(isolationProofPath).catch(() => null);

  const controlSeqDir = path.join(batchOutDir, "runA_control_current");
  const patchSeqDir = path.join(batchOutDir, "runB_patch_shadow");
  const focusedProbeDir = path.join(batchOutDir, "focused_probe");
  const c4ToC6Dir = path.join(batchOutDir, "c4_to_c6");

  const commonSequenceArgs = [
    "--stage-c-dir", stageCDir,
    "--barcodes-json", batchBarcodesPath,
  ];

  runNode({
    script: "scripts/maintainer/run-stage-c-sequence.mjs",
    scriptArgs: [
      ...commonSequenceArgs,
      "--api-base-url", controlApiBaseUrl,
      "--out-dir", controlSeqDir,
      "--mode", "control",
      ...(fastGates ? ["--fast-gates"] : []),
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });

  runNode({
    script: "scripts/maintainer/run-stage-c-sequence.mjs",
    scriptArgs: [
      ...commonSequenceArgs,
      "--api-base-url", patchApiBaseUrl,
      "--out-dir", patchSeqDir,
      "--mode", "patch",
      ...(fastGates ? ["--fast-gates"] : []),
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });

  runNode({
    script: "scripts/maintainer/run-stage-c-focused-probe.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--control-api-base-url", controlApiBaseUrl,
      "--patch-api-base-url", patchApiBaseUrl,
      "--out-dir", focusedProbeDir,
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });

  runNode({
    script: "scripts/maintainer/evaluate-stage-c-shadow.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--control-seq-dir", controlSeqDir,
      "--patch-seq-dir", patchSeqDir,
      "--out-dir", c4ToC6Dir,
      "--focused-probe-diff", path.join(focusedProbeDir, "focused_probe_diff.json"),
    ],
  });

  const gateReportPath = path.join(c4ToC6Dir, "c6_closeout", "stage_c_gate_report.json");
  const gate = await readJson(gateReportPath);

  const rollbackReasons = [];
  const noStabilityRegression =
    asNumber(gate?.metrics?.doneSeenRate_patch, 0) >= asNumber(gate?.metrics?.doneSeenRate_control, 0)
    && asNumber(gate?.metrics?.scoreVisibleRate_patch, 0) >= asNumber(gate?.metrics?.scoreVisibleRate_control, 0);
  if (!noStabilityRegression) rollbackReasons.push("stability_regression");
  if (asNumber(gate?.metrics?.conflict_rate, 1) > 0.01) rollbackReasons.push("conflict_rate_exceeded");
  if (asNumber(gate?.metrics?.conflict_abs, 999) > 5) rollbackReasons.push("conflict_abs_exceeded");
  if (asNumber(gate?.metrics?.lane1_improvement_rate, 0) < 0.2) rollbackReasons.push("lane1_improvement_below_threshold");

  const rollbackApplied = rollbackReasons.length > 0;
  const rollbackManifest = {
    generatedAt: new Date().toISOString(),
    batchId: batch.patchBatchId,
    rollbackApplied,
    rollbackReason: rollbackReasons.length > 0 ? rollbackReasons.join("|") : null,
    sourceGateReport: gateReportPath,
  };

  await writeJson(path.join(batchOutDir, "stage_d1_batch_rollback_manifest.json"), rollbackManifest);

  const batchGateReport = {
    generatedAt: rollbackManifest.generatedAt,
    batchId: batch.patchBatchId,
    stageCDir,
    batchOutDir,
    barcodesCount: barcodes.length,
    candidateRefreshDelta,
    ownerCoverageRate,
    unassignedCount,
    rollbackApplied,
    batchRollbackApplied: rollbackApplied,
    rollbackReasons,
    batchIsolationPass: isolationProof?.batchIsolationPass === true,
    outOfBatchFalseHitRate: asNumber(isolationProof?.metrics?.outOfBatchFalseHitRate, 0),
    patchScopeEvidence: isolationProof?.patchScopeEvidence || null,
    laneOperationalState: gate?.laneResults?.lane1_directions?.enforceDecision === "pass" ? "active" : "degraded",
    source: {
      gateReportPath,
      controlSeqDir,
      patchSeqDir,
      focusedProbeDir,
      isolationProofPath,
    },
    fastGates,
    gate,
  };

  await writeJson(path.join(batchOutDir, "stage_d1_batch_gate_report.json"), batchGateReport);

  const md = [
    "# Stage D1 Batch Gate Report",
    "",
    `- batchId: ${batch.patchBatchId}`,
    `- barcodesCount: ${barcodes.length}`,
    `- rollbackApplied: ${rollbackApplied}`,
    `- rollbackReasons: ${rollbackReasons.length > 0 ? rollbackReasons.join(", ") : "none"}`,
    `- lane1EnforceDecision: ${gate?.laneResults?.lane1_directions?.enforceDecision || "unknown"}`,
    `- lane1ImprovementRate: ${gate?.metrics?.lane1_improvement_rate ?? "n/a"}`,
    `- conflict_rate: ${gate?.metrics?.conflict_rate ?? "n/a"}`,
    `- conflict_abs: ${gate?.metrics?.conflict_abs ?? "n/a"}`,
  ].join("\n");

  await writeText(path.join(batchOutDir, "stage_d1_batch_gate_report.md"), `${md}\n`);
  await writeText(path.join(batchOutDir, "stage_d1_batch_release_note.md"), `${md}\n`);

  console.log("[run-stage-d1-batch] completed");
  console.log(JSON.stringify({ batchId: batch.patchBatchId, outDir: batchOutDir, rollbackApplied }, null, 2));
};

main().catch((error) => {
  console.error("[run-stage-d1-batch] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
