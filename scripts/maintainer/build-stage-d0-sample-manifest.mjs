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

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const asNumber = (value, fallback = 0) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[build-stage-d0-sample-manifest] missing --stage-c-dir and no stage-c outputs found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d0_runtime_hit");

  const enforceReadyPath = resolvePath(getArg("enforce-ready-jsonl"))
    || path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_enforce_ready.jsonl");
  const rejectPath = resolvePath(getArg("reject-jsonl"))
    || path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_postfilter_rejects.jsonl");
  const conflictPath = resolvePath(getArg("conflict-jsonl"))
    || path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_conflicts_queue.jsonl");

  const minPositive = Math.max(20, asNumber(getArg("min-positive"), 20));
  const maxPositive = Math.max(minPositive, asNumber(getArg("max-positive"), 30));
  const minBrands = Math.max(4, asNumber(getArg("min-brands"), 4));
  const negativeCount = Math.max(10, asNumber(getArg("negative-count"), 10));

  const enforceRows = await readJsonl(enforceReadyPath);
  const lane1Rows = enforceRows
    .filter((row) => row?.laneId === "patch_directions_text_v1")
    .filter((row) => String(row?.sourceTier ?? "").toLowerCase() === "scanned_label")
    .map((row) => ({ ...row, barcode: normalizeBarcode(row?.barcode_gtin14) }))
    .filter((row) => Boolean(row.barcode));

  const identityCountByBarcode = new Map();
  for (const row of lane1Rows) {
    const barcode = String(row.barcode);
    const identityKey = String(row.identityKey ?? "").trim().toLowerCase();
    if (!identityKey) continue;
    if (!identityCountByBarcode.has(barcode)) identityCountByBarcode.set(barcode, new Set());
    identityCountByBarcode.get(barcode).add(identityKey);
  }

  const uniqueLane1Rows = lane1Rows.filter((row) => {
    const barcode = String(row.barcode);
    const identities = identityCountByBarcode.get(barcode);
    return identities instanceof Set && identities.size === 1;
  });

  if (uniqueLane1Rows.length < minPositive) {
    console.error(`[build-stage-d0-sample-manifest] insufficient unique lane1 rows: ${uniqueLane1Rows.length} < ${minPositive}`);
    process.exit(1);
  }

  const byBrand = new Map();
  for (const row of uniqueLane1Rows) {
    const brand = String(row?.brandName ?? "unknown").trim() || "unknown";
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(row);
  }

  const brands = [...byBrand.entries()].sort((a, b) => b[1].length - a[1].length);
  if (brands.length < minBrands) {
    console.error(`[build-stage-d0-sample-manifest] insufficient brand diversity: ${brands.length} < ${minBrands}`);
    process.exit(1);
  }

  const selected = [];
  const seen = new Set();
  const cursors = new Map(brands.map(([brand]) => [brand, 0]));

  while (selected.length < maxPositive) {
    let progressed = false;
    for (const [brand, rows] of brands) {
      const cursor = cursors.get(brand) || 0;
      if (cursor >= rows.length) continue;
      const row = rows[cursor];
      cursors.set(brand, cursor + 1);
      const dedupeKey = `${row.identityKey}:${row.barcode}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      selected.push({
        sampleId: `positive_${String(selected.length + 1).padStart(2, "0")}`,
        laneId: row.laneId,
        barcode_gtin14: row.barcode,
        identityKey: row.identityKey,
        brandName: row.brandName,
        fieldKey: row.fieldKey || row.fieldKeys?.[0] || "directions_text",
        expectedPatchedField: row.fieldKey || row.fieldKeys?.[0] || "directions_text",
        evidenceRef: row.evidenceRef || null,
        sourceTier: row.sourceTier,
      });
      progressed = true;
      if (selected.length >= maxPositive) break;
    }
    if (!progressed) break;
  }

  if (selected.length < minPositive) {
    console.error(`[build-stage-d0-sample-manifest] selected positives too few: ${selected.length} < ${minPositive}`);
    process.exit(1);
  }

  const selectedBrands = new Set(selected.map((row) => row.brandName));
  if (selectedBrands.size < minBrands) {
    console.error(`[build-stage-d0-sample-manifest] selected brand diversity too low: ${selectedBrands.size} < ${minBrands}`);
    process.exit(1);
  }

  const selectedIdentityKeys = new Set(
    selected
      .map((row) => String(row.identityKey ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const selectedBarcodes = new Set(
    selected
      .map((row) => String(row.barcode_gtin14 ?? "").trim())
      .filter(Boolean),
  );
  const lane1IdentityKeys = new Set(
    uniqueLane1Rows
      .map((row) => String(row.identityKey ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const lane1Barcodes = new Set(
    uniqueLane1Rows
      .map((row) => String(row.barcode ?? "").trim())
      .filter(Boolean),
  );

  const rejectRows = await readJsonl(rejectPath);
  const conflictRows = await readJsonl(conflictPath);
  const negativePool = [...rejectRows, ...conflictRows]
    .map((row) => ({
      ...row,
      barcode: normalizeBarcode(row?.barcode_gtin14 || row?.barcode),
      identityKey: String(row?.identityKey ?? "").trim() || null,
    }))
    .filter((row) => row.barcode && row.identityKey)
    .filter((row) => String(row?.laneId ?? "") !== "patch_directions_text_v1");

  const isolatedNegativePool = negativePool
    .filter((row) => !selectedIdentityKeys.has(String(row.identityKey ?? "").trim().toLowerCase()))
    .filter((row) => !selectedBarcodes.has(String(row.barcode ?? "").trim()));
  const laneIsolatedNegativePool = isolatedNegativePool
    .filter((row) => !lane1IdentityKeys.has(String(row.identityKey ?? "").trim().toLowerCase()))
    .filter((row) => !lane1Barcodes.has(String(row.barcode ?? "").trim()));

  const scopeFallbackPath = path.join(stageCDir, "c1a_top100_census", "brand_scope_products_top100.json");
  const scopeFallbackRows = await readJson(scopeFallbackPath)
    .then((json) => (Array.isArray(json?.rows) ? json.rows : (Array.isArray(json) ? json : [])))
    .catch(() => []);
  const scopeFallbackPool = scopeFallbackRows
    .map((row) => ({
      barcode: normalizeBarcode(row?.barcodeGtIn14 || row?.barcode_gtin14 || row?.barcode),
      identityKey: String(row?.identityKey ?? "").trim(),
      laneId: "non_lane1_scope",
      reasonCode: "scope_negative_control",
      evidenceRef: null,
      sourceTier: null,
    }))
    .filter((row) => row.barcode && row.identityKey)
    .filter((row) => !selectedIdentityKeys.has(String(row.identityKey ?? "").trim().toLowerCase()))
    .filter((row) => !selectedBarcodes.has(String(row.barcode ?? "").trim()))
    .filter((row) => !lane1IdentityKeys.has(String(row.identityKey ?? "").trim().toLowerCase()))
    .filter((row) => !lane1Barcodes.has(String(row.barcode ?? "").trim()));

  const negatives = [];
  const negativeSeen = new Set();
  for (const row of [...laneIsolatedNegativePool, ...scopeFallbackPool]) {
    const key = `${row.identityKey}:${row.barcode}`;
    if (negativeSeen.has(key)) continue;
    negativeSeen.add(key);
    negatives.push({
      sampleId: `negative_${String(negatives.length + 1).padStart(2, "0")}`,
      barcode_gtin14: row.barcode,
      identityKey: row.identityKey,
      laneId: row.laneId || "non_lane1",
      reasonCode: row.reasonCode || row.conflictReason || "negative_control",
      evidenceRef: row.evidenceRef || null,
      sourceTier: row.sourceTier || null,
    });
    if (negatives.length >= negativeCount) break;
  }

  if (negatives.length < negativeCount) {
    console.error(
      `[build-stage-d0-sample-manifest] insufficient negative controls: ${negatives.length} < ${negativeCount}`,
    );
    process.exit(1);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    inputs: {
      enforceReadyPath,
      rejectPath,
      conflictPath,
    },
    criteria: {
      laneId: "patch_directions_text_v1",
      sourceTier: "scanned_label",
      minPositive,
      maxPositive,
      minBrands,
      negativeCount,
    },
    targetedSampleCount: selected.length,
    negativeSampleCount: negatives.length,
    selectedBrands: [...selectedBrands],
    positiveSamples: selected,
    negativeSamples: negatives,
  };

  await writeJson(path.join(outDir, "stage_d0_sample_manifest.json"), manifest);
  await writeJsonl(path.join(outDir, "stage_d0_positive_samples.jsonl"), selected);
  await writeJsonl(path.join(outDir, "stage_d0_negative_samples.jsonl"), negatives);

  console.log("[build-stage-d0-sample-manifest] completed");
  console.log(JSON.stringify({ outDir, targetedSampleCount: selected.length, negativeSampleCount: negatives.length }, null, 2));
};

main().catch((error) => {
  console.error("[build-stage-d0-sample-manifest] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
