#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
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

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const newestDirByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_DIR);
    const dirs = names.filter((name) => name.startsWith(prefix)).sort();
    if (dirs.length === 0) return null;
    return path.join(OUTPUT_DIR, dirs[dirs.length - 1]);
  } catch {
    return null;
  }
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const main = async () => {
  const latestNightlyDir = await newestDirByPrefix("v1.6.14-new-top100-nightly-");
  const sourceDiversityAuditJson = resolvePath(getArg("source-diversity-audit-json"))
    ?? (latestNightlyDir ? path.join(latestNightlyDir, "phase_a2", "source_diversity_audit.json") : null);
  const weightingPolicyJson = resolvePath(getArg("brand-heat-weighting-policy-json"))
    ?? (latestNightlyDir ? path.join(latestNightlyDir, "phase_a2", "brand_heat_weighting_policy.json") : null);

  if (!sourceDiversityAuditJson || !weightingPolicyJson) {
    console.error("[snapshot-source-diversity-policy] missing source diversity audit or weighting policy path");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir"))
    ?? (latestNightlyDir ? path.join(latestNightlyDir, "phase_a2") : path.join(ROOT_DIR, "output", "v1.6.15-source-diversity-policy"));

  const hardNonIherb = clamp01(getArg("non-iherb-hard-threshold", 0.10));
  const warnNonIherb = clamp01(getArg("non-iherb-warn-threshold", 0.20));
  const warnMedian = clamp01(getArg("source-diversity-median-warn-threshold", 0.35));
  const normalizationRulesVersion = String(getArg("normalization-rules-version", "brand_norm_v1")).trim();

  const auditRaw = await fs.readFile(sourceDiversityAuditJson, "utf8");
  const policyRaw = await fs.readFile(weightingPolicyJson, "utf8");
  const audit = JSON.parse(auditRaw);
  const policy = JSON.parse(policyRaw);

  const rows = Array.isArray(audit?.rows) ? audit.rows : [];
  const sourceFrequency = {};
  let sourceFrequencyTotal = 0;
  for (const row of rows) {
    const set = Array.isArray(row?.sourceSet) ? row.sourceSet : [];
    for (const source of set) {
      const key = String(source || "").trim().toLowerCase();
      if (!key) continue;
      sourceFrequency[key] = (sourceFrequency[key] || 0) + 1;
      sourceFrequencyTotal += 1;
    }
  }

  const sourceWeights = {};
  for (const [source, count] of Object.entries(sourceFrequency)) {
    sourceWeights[source] = sourceFrequencyTotal > 0 ? Number((count / sourceFrequencyTotal).toFixed(6)) : 0;
  }

  const snapshot = {
    computedAt: new Date().toISOString(),
    policyVersion: String(policy?.policyVersion || "source_diversity_policy_v1").trim(),
    normalizationRulesVersion,
    thresholds: {
      non_iherb_brand_ratio: {
        hard: hardNonIherb,
        warn: warnNonIherb,
      },
      source_diversity_score_median: {
        warn: warnMedian,
      },
    },
    weights: {
      sourceWeights,
      diversityFormulaWeights: {
        uniqueSourceWeight: 0.7,
        majorSourcePresenceWeight: 0.3,
      },
      penalties: policy?.rules?.penalties ?? {},
    },
    inputs: {
      sourceDiversityAuditJson: path.resolve(sourceDiversityAuditJson),
      sourceDiversityAuditSha256: sha256(auditRaw),
      weightingPolicyJson: path.resolve(weightingPolicyJson),
      weightingPolicySha256: sha256(policyRaw),
    },
  };

  const snapshotPath = path.join(outDir, "source_diversity_policy_snapshot.json");
  await writeJson(snapshotPath, snapshot);

  const snapshotRaw = await fs.readFile(snapshotPath, "utf8");
  const snapshotSha = sha256(snapshotRaw);
  await writeText(path.join(outDir, "source_diversity_policy_snapshot.sha256"), `${snapshotSha}  ${snapshotPath}\n`);
  await writeText(
    path.join(outDir, "source_diversity_policy_snapshot.md"),
    [
      "# Source Diversity Policy Snapshot",
      "",
      `- computedAt: ${snapshot.computedAt}`,
      `- policyVersion: ${snapshot.policyVersion}`,
      `- normalizationRulesVersion: ${snapshot.normalizationRulesVersion}`,
      `- non_iherb hard/warn: ${snapshot.thresholds.non_iherb_brand_ratio.hard}/${snapshot.thresholds.non_iherb_brand_ratio.warn}`,
      `- diversity median warn: ${snapshot.thresholds.source_diversity_score_median.warn}`,
      `- snapshotSha256: ${snapshotSha}`,
      `- sourceDiversityAuditJson: ${snapshot.inputs.sourceDiversityAuditJson}`,
      `- weightingPolicyJson: ${snapshot.inputs.weightingPolicyJson}`,
    ].join("\n") + "\n",
  );

  console.log("[snapshot-source-diversity-policy] completed");
  console.log(JSON.stringify({
    outDir,
    snapshotPath,
    snapshotSha256: snapshotSha,
  }, null, 2));
};

main().catch((error) => {
  console.error("[snapshot-source-diversity-policy] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

