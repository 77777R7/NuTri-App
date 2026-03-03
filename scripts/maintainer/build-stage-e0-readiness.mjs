#!/usr/bin/env node
/* eslint-disable no-console */

import { createHash } from "node:crypto";
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

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

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

const toRate = (count, total) => (total > 0 ? Number((count / total).toFixed(6)) : 0);

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const flattenText = (value, out = []) => {
  if (value == null) return out;
  if (typeof value === "string") {
    if (value.trim()) out.push(value.trim());
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) flattenText(v, out);
  }
  return out;
};

const probioticStrainRegex = /\b([a-z]\.[a-z]+|lactobacillus|bifidobacterium|rhamnosus|acidophilus|longum|ncfm|bb[-\s]?\d+|atcc)\b/i;
const probioticCfuRegex = /\bcfu\b/i;
const isProbioticCategory = (row) => String(row?.categoryBucket || "").toLowerCase() === "probiotics";

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[build-stage-e0-readiness] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const stageEDir = resolvePath(getArg("stage-e-dir")) || path.join(OUTPUT_ROOT, `v1.6.14-stage-e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageEDir, "e0_baseline");
  await ensureDir(outDir);

  const laneId = "patch_probiotics_strain_cfu_v1";
  const laneReadinessPath = resolvePath(getArg("lane-readiness"))
    || path.join(stageCDir, "c1a_top100_census", "lane_readiness_matrix.json");
  const scopePath = resolvePath(getArg("scope-products"))
    || path.join(stageCDir, "c1a_top100_census", "brand_scope_products_top100.json");
  const patchCandidatesPath = resolvePath(getArg("category-patch-candidates"))
    || path.join(stageCDir, "c1a_top100_census", "brand_category_patch_candidates_top100.json");

  const minCandidates = Math.max(20, asNumber(getArg("min-candidates"), 20));
  const minEvidenceAvailability = Math.max(0, Math.min(1, asNumber(getArg("min-evidence-availability"), 0.6)));
  const maxConflictRisk = Math.max(0, Math.min(1, asNumber(getArg("max-conflict-risk"), 0.05)));
  const primaryMetric = String(getArg("primary-metric", "missing_strain_rate")).trim() || "missing_strain_rate";

  const laneReadiness = await readJson(laneReadinessPath);
  const laneRow = (Array.isArray(laneReadiness) ? laneReadiness : []).find((row) => String(row?.lane_id) === laneId) || null;
  if (!laneRow) {
    console.error(`[build-stage-e0-readiness] lane row not found for ${laneId}`);
    process.exit(1);
  }

  const scopeJson = await readJson(scopePath);
  const scopeRows = Array.isArray(scopeJson?.rows) ? scopeJson.rows : (Array.isArray(scopeJson) ? scopeJson : []);
  const probioticRows = scopeRows.filter((row) => isProbioticCategory(row));

  let missingStrainCount = 0;
  let missingCfuCount = 0;
  for (const row of probioticRows) {
    const text = flattenText([row?.factsJson, row?.productName, row?.categoryName, row?.formText]).join(" | ");
    const hasStrain = probioticStrainRegex.test(text);
    const hasCfu = probioticCfuRegex.test(text);
    if (!hasStrain) missingStrainCount += 1;
    if (!hasCfu) missingCfuCount += 1;
  }

  const missingStrainRate = toRate(missingStrainCount, probioticRows.length);
  const missingCfuRate = toRate(missingCfuCount, probioticRows.length);

  const categoryPatchRows = await readJson(patchCandidatesPath);
  const probioticCandidates = (Array.isArray(categoryPatchRows) ? categoryPatchRows : [])
    .filter((row) => String(row?.candidate_patch_lane || "") === laneId)
    .filter((row) => row?.scanned_label_evidence_available === true)
    .map((row) => {
      const identityKey = String(row?.identity_key || "").trim();
      const barcode = normalizeBarcode(row?.barcode_gtin14);
      const sourceId = identityKey.includes(":") ? identityKey.split(":").slice(1).join(":") : identityKey;
      return {
        candidateId: `${laneId}:${identityKey}:${barcode || "nobarcode"}`,
        generatedAt: new Date().toISOString(),
        laneId,
        market: row?.market || null,
        seedBrand: row?.seed_brand || null,
        sourceType: row?.source_type || "dsld",
        identityKey,
        sourceId,
        barcode_gtin14: barcode,
        brandName: row?.brand || row?.seed_brand || null,
        productName: row?.product_name || null,
        categoryName: row?.category_bucket || "probiotics",
        fieldKey: null,
        fieldKeys: ["strain_name", "cfu_count"],
        patchedValue: { state: "pending_scanned_label_extraction" },
        sourceTier: "scanned_label",
        evidenceRef: {
          recordIdentity: identityKey,
        },
        confidence: 0.7,
        owner: "unassigned",
        status: "candidate_open",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        reviewAfterDays: 30,
        reasonCode: "missing_probiotics_strain_or_cfu",
      };
    })
    .filter((row) => Boolean(row.identityKey));

  const probioticsCandidatesPath = path.join(outDir, "e0_probiotics_candidates.jsonl");
  await writeJsonl(probioticsCandidatesPath, probioticCandidates);

  const candidatesHash = createHash("sha256")
    .update(probioticCandidates.map((row) => JSON.stringify(row)).join("\n"))
    .digest("hex");

  const readiness = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    laneId,
    thresholds: {
      minCandidates,
      minEvidenceAvailability,
      maxConflictRisk,
    },
    laneReadiness: {
      candidate_count: asNumber(laneRow?.candidate_count, 0),
      evidence_availability_rate: asNumber(laneRow?.evidence_availability_rate, 0),
      conflict_risk_estimate: asNumber(laneRow?.conflict_risk_estimate, 1),
      expected_missing_reduction: asNumber(laneRow?.expected_missing_reduction, 0),
      expected_verdict_lift: asNumber(laneRow?.expected_verdict_lift, 0),
      brand_count_covered: asNumber(laneRow?.brand_count_covered, 0),
      product_count_covered: asNumber(laneRow?.product_count_covered, 0),
      recommended_rank: asNumber(laneRow?.recommended_rank, 999),
    },
    baselines: {
      missing_strain_rate: missingStrainRate,
      missing_cfu_rate: missingCfuRate,
      primary_metric: primaryMetric,
      secondary_metric: primaryMetric === "missing_strain_rate" ? "missing_cfu_rate" : "missing_strain_rate",
    },
    probioticsContract: {
      tier1_required: ["strain_name", "cfu_count", "cfu_unit"],
      tier2_optional: ["multi_strain_list", "cfu_basis"],
    },
    candidateArtifacts: {
      path: probioticsCandidatesPath,
      candidatesLoaded: probioticCandidates.length,
      candidatesHash,
    },
    pass:
      asNumber(laneRow?.candidate_count, 0) >= minCandidates
      && asNumber(laneRow?.evidence_availability_rate, 0) >= minEvidenceAvailability
      && asNumber(laneRow?.conflict_risk_estimate, 1) <= maxConflictRisk,
  };

  const lockPatch = [
    "## Probiotics Patch Contract (E0)",
    "",
    "- Tier1 required: strain_name, cfu_count, cfu_unit",
    "- Tier2 optional: multi_strain_list, cfu_basis(expiry/manufacture)",
    `- Primary E1 gate metric: ${readiness.baselines.primary_metric}`,
    `- Secondary metric: ${readiness.baselines.secondary_metric}`,
  ].join("\n");

  const md = [
    "# Stage E0 Readiness",
    "",
    `- pass: ${readiness.pass}`,
    `- laneId: ${laneId}`,
    `- candidates: ${readiness.laneReadiness.candidate_count} (threshold ${minCandidates})`,
    `- evidence_availability_rate: ${readiness.laneReadiness.evidence_availability_rate} (threshold ${minEvidenceAvailability})`,
    `- conflict_risk_estimate: ${readiness.laneReadiness.conflict_risk_estimate} (threshold <=${maxConflictRisk})`,
    `- missing_strain_rate: ${missingStrainRate}`,
    `- missing_cfu_rate: ${missingCfuRate}`,
    `- primary_metric: ${readiness.baselines.primary_metric}`,
    "",
    lockPatch,
  ].join("\n");

  await writeJson(path.join(outDir, "stage_e0_readiness.json"), readiness);
  await writeJson(path.join(outDir, "stage_e0_probiotics_contract.json"), readiness.probioticsContract);
  await writeText(path.join(outDir, "stage_e0_readiness.md"), `${md}\n`);

  const scopeLockPath = path.join(outDir, "stage_e0_scope_lock.md");
  let scopeLock = "# Stage E0 Scope Lock\n\n";
  try {
    scopeLock = await fs.readFile(scopeLockPath, "utf8");
  } catch {
    // keep default
  }
  if (!scopeLock.includes("Probiotics Patch Contract")) {
    await writeText(scopeLockPath, `${scopeLock.trimEnd()}\n\n${lockPatch}\n`);
  }

  console.log("[build-stage-e0-readiness] completed");
  console.log(JSON.stringify({
    outDir,
    pass: readiness.pass,
    laneId,
    candidates: readiness.laneReadiness.candidate_count,
    candidatesLoaded: probioticCandidates.length,
    candidatesHash,
  }, null, 2));

  if (!readiness.pass) process.exit(2);
};

main().catch((error) => {
  console.error("[build-stage-e0-readiness] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
