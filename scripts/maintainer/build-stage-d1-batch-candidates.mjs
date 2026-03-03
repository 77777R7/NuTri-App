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

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const requiredFields = [
  "patchBatchId",
  "laneId",
  "identityKey",
  "barcode_gtin14",
  "sourceTier",
  "evidenceRef",
  "expiresAt",
  "reviewAfterDays",
];

const missingRequiredFields = (row) => {
  const issues = [];
  for (const field of requiredFields) {
    const value = row?.[field];
    const missing = value == null || (typeof value === "string" && value.trim().length === 0);
    if (missing) issues.push(field);
  }
  if (String(row?.sourceTier ?? "").toLowerCase() !== "scanned_label") {
    issues.push("sourceTier_not_scanned_label");
  }
  return issues;
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[build-stage-d1-batch-candidates] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.14-stage-e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const batchManifestPath = resolvePath(getArg("batch-manifest")) || path.join(stageDRoot, "d1_batches", "brand_batch_manifest.json");
  const laneId = String(getArg("lane-id", "patch_directions_text_v1")).trim() || "patch_directions_text_v1";
  const filteredCandidatesPath = resolvePath(getArg("filtered-candidates-jsonl"))
    || path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl");

  const batchManifest = await readJson(batchManifestPath);
  const batches = Array.isArray(batchManifest?.batches) ? batchManifest.batches : [];
  const batchId = String(getArg("batch-id", "")).trim();
  const batchIndex = Number(getArg("batch-index", "0")) || 0;

  let batch = null;
  if (batchId) batch = batches.find((row) => String(row?.patchBatchId) === batchId) || null;
  else if (batchIndex > 0) batch = batches[batchIndex - 1] ?? null;
  else batch = batches[0] ?? null;

  if (!batch) {
    console.error("[build-stage-d1-batch-candidates] batch not found");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d1_batches", String(batch.patchBatchId));
  await ensureDir(outDir);

  const batchBrands = new Set((batch.brands || []).map((row) => `${String(row.market || "").toUpperCase()}:${normalizeBrand(row.brandNorm || row.brand)}`));
  const rows = (await readJsonl(filteredCandidatesPath))
    .filter((row) => String(row?.laneId ?? "") === laneId)
    .filter((row) => String(row?.sourceTier ?? "").toLowerCase() === "scanned_label")
    .filter((row) => {
      const key = `${String(row?.market || "").toUpperCase()}:${normalizeBrand(row?.seedBrandNorm || row?.brandNorm || row?.brandName)}`;
      return batchBrands.has(key);
    })
    .map((row) => ({
      ...row,
      patchBatchId: String(batch.patchBatchId),
      laneId,
      identityKey: String(row?.identityKey ?? "").trim(),
      barcode_gtin14: normalizeBarcode(row?.barcode_gtin14),
      sourceTier: "scanned_label",
      evidenceRef: row?.evidenceRef || null,
      expiresAt: row?.expiresAt || null,
      reviewAfterDays: Number(row?.reviewAfterDays ?? 30) || 30,
    }))
    .filter((row) => Boolean(row.identityKey) && Boolean(row.barcode_gtin14));

  if (rows.length === 0) {
    console.error(`[build-stage-d1-batch-candidates] no rows for batch=${batch.patchBatchId} lane=${laneId}`);
    process.exit(1);
  }

  const sorted = rows
    .slice()
    .sort((a, b) => {
      const ka = `${a.identityKey}|${a.barcode_gtin14}|${a.candidateId || ""}`;
      const kb = `${b.identityKey}|${b.barcode_gtin14}|${b.candidateId || ""}`;
      return ka.localeCompare(kb);
    });

  const fieldIssues = [];
  for (const row of sorted) {
    const issues = missingRequiredFields(row);
    if (issues.length > 0) {
      fieldIssues.push({
        candidateId: row?.candidateId || null,
        issues,
      });
    }
  }

  if (fieldIssues.length > 0) {
    await writeJson(path.join(outDir, "batch_patch_candidates.validation_errors.json"), {
      generatedAt: new Date().toISOString(),
      batchId: batch.patchBatchId,
      laneId,
      issues: fieldIssues,
    });
    console.error(`[build-stage-d1-batch-candidates] candidate schema validation failed (${fieldIssues.length})`);
    process.exit(2);
  }

  const rowsHash = createHash("sha256")
    .update(sorted.map((row) => JSON.stringify(row)).join("\n"))
    .digest("hex");
  const candidateScopeId = createHash("sha256")
    .update(`${batch.patchBatchId}|${laneId}|${rowsHash}`)
    .digest("hex");

  const candidatePath = path.join(outDir, "batch_patch_candidates.jsonl");
  const metaPath = path.join(outDir, "batch_patch_candidates.meta.json");
  const scopePath = path.join(outDir, "batch_patch_scope.md");

  await writeJsonl(candidatePath, sorted);

  const markets = [...new Set(sorted.map((row) => String(row.market || "").toUpperCase()))].sort();
  const brands = [...new Set(sorted.map((row) => String(row.brandName || row.seedBrand || "unknown")))].sort();
  const uniqueBarcodes = [...new Set(sorted.map((row) => row.barcode_gtin14))].length;

  const meta = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    stageDRoot,
    laneId,
    patchBatchId: batch.patchBatchId,
    candidateScopeId,
    candidatePath,
    candidatesHash: rowsHash,
    candidatesLoaded: sorted.length,
    uniqueBarcodes,
    markets,
    brands,
    sourceTier: "scanned_label",
    requiredFields,
    inputs: {
      filteredCandidatesPath,
      batchManifestPath,
      batchId: batch.patchBatchId,
    },
  };

  const scopeMd = [
    "# Stage D1b Batch Patch Scope",
    "",
    `- patchBatchId: ${batch.patchBatchId}`,
    `- laneId: ${laneId}`,
    `- candidateScopeId: ${candidateScopeId}`,
    `- candidatesHash: ${rowsHash}`,
    `- candidatesLoaded: ${sorted.length}`,
    `- uniqueBarcodes: ${uniqueBarcodes}`,
    "- sourceTier: scanned_label (writable only)",
    `- markets: ${markets.join(", ") || "n/a"}`,
    `- brands: ${brands.length}`,
    "",
    "## Inputs",
    `- filteredCandidatesPath: ${filteredCandidatesPath}`,
    `- batchManifestPath: ${batchManifestPath}`,
  ].join("\n");

  await writeJson(metaPath, meta);
  await writeText(scopePath, `${scopeMd}\n`);

  console.log("[build-stage-d1-batch-candidates] completed");
  console.log(JSON.stringify({
    outDir,
    patchBatchId: batch.patchBatchId,
    laneId,
    candidatesLoaded: sorted.length,
    candidateScopeId,
    candidatesHash: rowsHash,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-stage-d1-batch-candidates] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
