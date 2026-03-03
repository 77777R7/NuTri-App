#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
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

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
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

const classifyReason = (reasonCode) => {
  const reason = String(reasonCode ?? "").toLowerCase();
  if (reason.includes("extract") || reason.includes("pending_scanned_label_extraction")) return "extraction_gap";
  if (reason.includes("identity") || reason.includes("mismatch")) return "identity_mismatch";
  if (reason.includes("missing_scanned_label") || reason.includes("evidence")) return "evidence_instability";
  if (reason.includes("postfilter") || reason.includes("global_stability_guard_lane2")) return "postfilter_too_strict";
  return "other";
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-d1-5-lane2-triage] missing --stage-c-dir and no stage-c outputs found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d1_5_lane2");

  const fixableQueuePath = resolvePath(getArg("fixable-queue"))
    || path.join(stageCDir, "c4_to_c6", "c6_closeout", "stage_c_fixable_repair_queue.jsonl");
  const rejectPath = resolvePath(getArg("postfilter-rejects"))
    || path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_postfilter_rejects.jsonl");
  const laneReadinessPath = resolvePath(getArg("lane-readiness"))
    || path.join(stageCDir, "c1a_top100_census", "lane_readiness_matrix.json");

  const fixableRows = (await readJsonl(fixableQueuePath)).filter((row) => String(row?.laneId ?? "") === "patch_fish_oil_breakdown_v1");
  const rejectRows = (await readJsonl(rejectPath)).filter((row) => String(row?.laneId ?? "") === "patch_fish_oil_breakdown_v1");
  const laneReadiness = await readJson(laneReadinessPath).catch(() => []);

  const triageRows = [];
  const buckets = {
    extraction_gap: 0,
    identity_mismatch: 0,
    evidence_instability: 0,
    postfilter_too_strict: 0,
    other: 0,
  };

  for (const row of [...fixableRows, ...rejectRows]) {
    const reasonCode = row?.reasonCode || row?.breachType || row?.rejectReasons?.join("|") || "unknown";
    const rootCause = classifyReason(reasonCode);
    buckets[rootCause] += 1;
    triageRows.push({
      barcode: row?.barcode_gtin14 || row?.barcode || null,
      identityKey: row?.identityKey || null,
      laneId: "patch_fish_oil_breakdown_v1",
      reasonCode,
      rootCause,
      owner: row?.owner || "unassigned",
      status: row?.status || "open",
      targetRelease: row?.targetRelease || "v1.6.13-stage-d-followup",
    });
  }

  const total = triageRows.length;
  const dominantRootCause = total > 0
    ? Object.entries(buckets).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const lane2Candidates = (Array.isArray(laneReadiness) ? laneReadiness : [])
    .filter((row) => String(row?.lane_group || "") === "lane2_candidate")
    .map((row) => ({
      laneId: row?.lane_id,
      selection_pass: row?.selection_pass === true,
      expected_missing_reduction: Number(row?.expected_missing_reduction || 0),
      projected_execution_reach: Number(row?.projected_execution_reach || 0),
      product_count_covered: Number(row?.product_count_covered || 0),
      recommended_rank: Number(row?.recommended_rank || 999),
    }))
    .sort((a, b) => a.recommended_rank - b.recommended_rank);

  const fishOil = lane2Candidates.find((row) => row.laneId === "patch_fish_oil_breakdown_v1") || null;
  const replacement = lane2Candidates.find((row) => row.laneId !== "patch_fish_oil_breakdown_v1" && row.selection_pass);

  let decision = "retire";
  let decisionReason = "lane2_no_viable_path";

  if (total === 0) {
    decision = "retire";
    decisionReason = "lane2_no_backlog_detected";
  } else if ((buckets.postfilter_too_strict + buckets.extraction_gap) / Math.max(1, total) >= 0.6) {
    decision = "recover";
    decisionReason = "dominant_root_causes_fixable_for_fish_oil";
  } else if (replacement && fishOil && replacement.expected_missing_reduction >= fishOil.expected_missing_reduction) {
    decision = "replace";
    decisionReason = `replacement_lane_${replacement.laneId}_shows_better_or_equal_readiness`;
  } else if (replacement && !fishOil) {
    decision = "replace";
    decisionReason = `fish_oil_unavailable_replace_with_${replacement.laneId}`;
  }

  const lane2Decision = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    totalLane2Items: total,
    dominantRootCause,
    rootCauseCounts: buckets,
    decision,
    decisionReason,
    replacementLaneCandidate: decision === "replace" ? replacement?.laneId || null : null,
    fishOilReadiness: fishOil,
    replacementReadiness: replacement || null,
  };

  const rootcause = {
    generatedAt: lane2Decision.generatedAt,
    totalLane2Items: total,
    dominantRootCause,
    rootCauseCounts: buckets,
    rows: triageRows,
  };

  const repairPlan = triageRows.map((row, index) => ({
    id: `lane2_repair_${String(index + 1).padStart(3, "0")}`,
    ...row,
    action:
      row.rootCause === "postfilter_too_strict" ? "tune_postfilter_guard" :
      row.rootCause === "extraction_gap" ? "improve_scanned_label_extraction" :
      row.rootCause === "identity_mismatch" ? "repair_identity_mapping" :
      row.rootCause === "evidence_instability" ? "stabilize_evidence_linking" :
      "manual_triage",
  }));

  await writeJson(path.join(outDir, "stage_d1_5_lane2_rootcause_report.json"), rootcause);
  await writeJsonl(path.join(outDir, "stage_d1_5_lane2_repair_plan.jsonl"), repairPlan);
  await writeJson(path.join(outDir, "lane2_decision.json"), lane2Decision);

  console.log("[run-stage-d1-5-lane2-triage] completed");
  console.log(JSON.stringify({ outDir, decision, totalLane2Items: total, dominantRootCause }, null, 2));
};

main().catch((error) => {
  console.error("[run-stage-d1-5-lane2-triage] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
