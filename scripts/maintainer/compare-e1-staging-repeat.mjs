#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const hashText = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const fingerprintRows = (rows) => rows
  .map((row) => [
    row?.candidateId || "",
    row?.identityKey || "",
    row?.laneId || "",
    row?.candidateScopeId || "",
    row?.owner || "",
    row?.status || "",
  ].join("|"))
  .sort();

const setFromRows = (rows) => new Set(rows.map((row) => String(row?.candidateId || "")).filter(Boolean));

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  const larger = a.size >= b.size ? a : b;
  const smaller = a.size >= b.size ? b : a;
  let inter = 0;
  for (const key of smaller) {
    if (larger.has(key)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
};

const main = async () => {
  const run1EvalDir = resolvePath(getArg("run1-eval-dir"));
  const run2EvalDir = resolvePath(getArg("run2-eval-dir"));
  if (!run1EvalDir || !run2EvalDir) {
    console.error("[compare-e1-staging-repeat] missing --run1-eval-dir or --run2-eval-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(path.dirname(run2EvalDir), "staging_repeat_compare");
  await ensureDir(outDir);

  const minOverlap = clamp01(getArg("min-preview-overlap", 0.9));
  const run1Report = await readJson(path.join(run1EvalDir, "e1_shadow_report.json"));
  const run2Report = await readJson(path.join(run2EvalDir, "e1_shadow_report.json"));
  const run1Preview = await readJsonl(path.join(run1EvalDir, "e1_enforce_readiness_preview.jsonl"));
  const run2Preview = await readJsonl(path.join(run2EvalDir, "e1_enforce_readiness_preview.jsonl"));

  const run1Fingerprints = fingerprintRows(run1Preview);
  const run2Fingerprints = fingerprintRows(run2Preview);
  const previewHashRun1 = hashText(run1Fingerprints.join("\n"));
  const previewHashRun2 = hashText(run2Fingerprints.join("\n"));
  const previewHashEqual = previewHashRun1 === previewHashRun2;

  const run1Set = setFromRows(run1Preview);
  const run2Set = setFromRows(run2Preview);
  const previewOverlapRate = jaccard(run1Set, run2Set);
  const stabilityPass = previewHashEqual || previewOverlapRate >= minOverlap;

  const run1HardPass = run1Report?.pass === true;
  const run2HardPass = run2Report?.pass === true;
  const passes = {
    run1HardPass,
    run2HardPass,
    stabilityPass,
  };
  const pass = Object.values(passes).every(Boolean);
  const blockingReasons = [];
  if (!run1HardPass) blockingReasons.push("run1_not_pass");
  if (!run2HardPass) blockingReasons.push("run2_not_pass");
  if (!stabilityPass) blockingReasons.push("preview_stability_gate_failed");

  const latestCandidateScopeId = String(
    run2Report?.patchActivationEvidence?.candidateScopeId
      ?? run1Report?.patchActivationEvidence?.candidateScopeId
      ?? "",
  ).trim() || null;

  const compare = {
    generatedAt: new Date().toISOString(),
    run1EvalDir,
    run2EvalDir,
    thresholds: {
      minPreviewOverlap: minOverlap,
    },
    pass,
    blockingReasons,
    passes,
    previewHashRun1,
    previewHashRun2,
    previewHashEqual,
    previewOverlapRate: Number(previewOverlapRate.toFixed(6)),
    counts: {
      run1PreviewCount: run1Preview.length,
      run2PreviewCount: run2Preview.length,
    },
    metrics: {
      run1PrimaryImprovement: asNumber(run1Report?.primaryMetricRelativeImprovement, 0),
      run2PrimaryImprovement: asNumber(run2Report?.primaryMetricRelativeImprovement, 0),
      run1DoneSeenRatePatch: asNumber(run1Report?.metrics?.doneSeenRate_patch, 0),
      run2DoneSeenRatePatch: asNumber(run2Report?.metrics?.doneSeenRate_patch, 0),
      run1ScoreVisibleRatePatch: asNumber(run1Report?.metrics?.scoreVisibleRate_patch, 0),
      run2ScoreVisibleRatePatch: asNumber(run2Report?.metrics?.scoreVisibleRate_patch, 0),
    },
    latestCandidateScopeId,
  };

  await writeJson(path.join(outDir, "staging_repeat_compare.json"), compare);
  await writeText(path.join(outDir, "staging_repeat_compare.md"), [
    "# Staging Repeat Compare",
    "",
    `- pass: ${pass}`,
    `- run1HardPass: ${run1HardPass}`,
    `- run2HardPass: ${run2HardPass}`,
    `- stabilityPass: ${stabilityPass}`,
    `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
    "",
    `- previewHashRun1: ${previewHashRun1}`,
    `- previewHashRun2: ${previewHashRun2}`,
    `- previewHashEqual: ${previewHashEqual}`,
    `- previewOverlapRate: ${(previewOverlapRate * 100).toFixed(2)}%`,
    `- minPreviewOverlap: ${(minOverlap * 100).toFixed(2)}%`,
    "",
    `- latestCandidateScopeId: ${latestCandidateScopeId ?? "n/a"}`,
  ].join("\n") + "\n");

  console.log("[compare-e1-staging-repeat] completed");
  console.log(JSON.stringify({ outDir, pass, previewHashEqual, previewOverlapRate }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[compare-e1-staging-repeat] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

