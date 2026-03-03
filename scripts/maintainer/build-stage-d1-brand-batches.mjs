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

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[build-stage-d1-brand-batches] missing --stage-c-dir and no stage-c outputs found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d1_batches");
  const enforceReadyPath = resolvePath(getArg("enforce-ready-jsonl"))
    || path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_enforce_ready.jsonl");
  const coverageSummaryPath = resolvePath(getArg("brand-coverage-summary"))
    || path.join(stageCDir, "c1a_top100_census", "brand_coverage_summary_top100.json");
  const ownerCapacityPath = resolvePath(getArg("owner-capacity-json"));

  const batchSize = Math.max(1, asNumber(getArg("batch-size-brands"), 4));
  const maxBatches = Math.max(1, asNumber(getArg("max-batches"), 3));
  const marketFloorUs = Math.max(0, asNumber(getArg("market-floor-us"), 10));
  const marketFloorCa = Math.max(0, asNumber(getArg("market-floor-ca"), 10));

  const rows = (await readJsonl(enforceReadyPath))
    .filter((row) => row?.laneId === "patch_directions_text_v1")
    .filter((row) => String(row?.sourceTier ?? "").toLowerCase() === "scanned_label");

  if (rows.length === 0) {
    console.error("[build-stage-d1-brand-batches] no lane1 enforce-ready rows found");
    process.exit(1);
  }

  const coverageRows = await readJson(coverageSummaryPath).catch(() => []);
  const coverageMap = new Map();
  for (const row of Array.isArray(coverageRows) ? coverageRows : []) {
    const key = `${String(row?.market ?? "").toUpperCase()}:${normalizeBrand(row?.brand)}`;
    coverageMap.set(key, {
      rank: asNumber(row?.rank, 100),
      patchPriorityScore: asNumber(row?.patchPriorityScore, 0),
    });
  }

  const ownerCapacityConfig = ownerCapacityPath ? await readJson(ownerCapacityPath).catch(() => ({})) : {};
  const ownerCapacityDefault = Math.max(1, asNumber(ownerCapacityConfig?.defaultCapacity, 200));

  const brandAgg = new Map();
  for (const row of rows) {
    const market = String(row?.market || "US").toUpperCase();
    const brand = String(row?.brandName ?? "unknown").trim() || "unknown";
    const brandNorm = normalizeBrand(brand);
    const key = `${market}:${brandNorm}`;
    if (!brandAgg.has(key)) {
      brandAgg.set(key, {
        market,
        brand,
        brandNorm,
        candidate_count: 0,
        productKeys: new Set(),
        evidence_count: 0,
        sourceTier_count: 0,
      });
    }
    const agg = brandAgg.get(key);
    agg.candidate_count += 1;
    agg.productKeys.add(String(row?.identityKey ?? ""));
    if (row?.evidenceRef) agg.evidence_count += 1;
    if (String(row?.sourceTier ?? "").toLowerCase() === "scanned_label") agg.sourceTier_count += 1;
  }

  const maxCandidateCount = Math.max(...[...brandAgg.values()].map((row) => row.candidate_count));
  const brandRows = [...brandAgg.values()].map((row) => {
    const mapKey = `${row.market}:${row.brandNorm}`;
    const coverage = coverageMap.get(mapKey) || { rank: 100, patchPriorityScore: 0 };
    const brand_heat = Math.max(0, Math.min(1, coverage.patchPriorityScore > 0 ? coverage.patchPriorityScore / 100 : (101 - coverage.rank) / 100));
    const candidate_density = row.candidate_count / Math.max(1, maxCandidateCount);
    const evidence_availability = row.evidence_count / Math.max(1, row.candidate_count);
    const low_conflict_factor = 0.98;
    const ownerCapacityFit = ownerCapacityDefault > 0 ? Math.min(1, row.candidate_count / ownerCapacityDefault) : 1;

    const batch_priority =
      0.35 * brand_heat
      + 0.25 * evidence_availability
      + 0.20 * low_conflict_factor
      + 0.20 * ownerCapacityFit;

    return {
      market: row.market,
      brand: row.brand,
      brandNorm: row.brandNorm,
      rank: coverage.rank,
      patchPriorityScore: coverage.patchPriorityScore,
      candidate_count: row.candidate_count,
      product_count: row.productKeys.size,
      evidence_availability,
      low_conflict_factor,
      owner_capacity_fit: ownerCapacityFit,
      brand_heat,
      candidate_density,
      batch_priority: Number(batch_priority.toFixed(6)),
    };
  }).sort((a, b) => b.batch_priority - a.batch_priority || b.candidate_count - a.candidate_count);

  const selected = brandRows.slice(0, batchSize * maxBatches);
  const batches = [];
  for (let i = 0; i < selected.length; i += batchSize) {
    const chunk = selected.slice(i, i + batchSize);
    if (chunk.length === 0) continue;
    const batchId = `d1-batch-${String(batches.length + 1).padStart(2, "0")}`;
    batches.push({
      patchBatchId: batchId,
      batchIndex: batches.length + 1,
      brandCount: chunk.length,
      markets: [...new Set(chunk.map((row) => row.market))],
      brands: chunk.map((row) => ({
        market: row.market,
        brand: row.brand,
        brandNorm: row.brandNorm,
        candidate_count: row.candidate_count,
        product_count: row.product_count,
        batch_priority: row.batch_priority,
      })),
      batch_priority_avg: Number((chunk.reduce((sum, row) => sum + row.batch_priority, 0) / chunk.length).toFixed(6)),
    });
    if (batches.length >= maxBatches) break;
  }

  const selectedUs = selected.filter((row) => row.market === "US").length;
  const selectedCa = selected.filter((row) => row.market === "CA").length;
  let override_reason = null;
  if (selectedUs < marketFloorUs || selectedCa < marketFloorCa) {
    override_reason = `market_floor_unmet_us_${selectedUs}_ca_${selectedCa}_required_us_${marketFloorUs}_ca_${marketFloorCa}`;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    inputs: {
      enforceReadyPath,
      coverageSummaryPath,
      ownerCapacityPath,
    },
    formula: "batch_priority = 0.35*brand_heat + 0.25*evidence_availability + 0.20*low_conflict + 0.20*owner_capacity_fit",
    constraints: {
      market_floor_us: marketFloorUs,
      market_floor_ca: marketFloorCa,
      override_reason,
    },
    selectedBrandCount: selected.length,
    batches,
    selectedBrands: selected,
  };

  const stateMachine = {
    generatedAt: manifest.generatedAt,
    states: [
      "open",
      "triaged",
      "candidate_ready",
      "shadow_applied",
      "postfilter_rejected",
      "enforce_ready",
      "enforced",
      "review_due",
      "expired",
      "closed_ceiling",
    ],
    transitions: {
      open: ["triaged", "closed_ceiling"],
      triaged: ["candidate_ready", "closed_ceiling"],
      candidate_ready: ["shadow_applied", "postfilter_rejected", "closed_ceiling"],
      shadow_applied: ["enforce_ready", "postfilter_rejected", "closed_ceiling"],
      postfilter_rejected: ["triaged", "closed_ceiling"],
      enforce_ready: ["enforced", "postfilter_rejected", "closed_ceiling"],
      enforced: ["review_due", "expired", "closed_ceiling"],
      review_due: ["enforced", "expired", "closed_ceiling"],
      expired: ["triaged", "closed_ceiling"],
      closed_ceiling: [],
    },
  };

  const report = [
    "# Stage D1 Brand Batch Selection",
    "",
    `- generatedAt: ${manifest.generatedAt}`,
    `- selectedBrandCount: ${selected.length}`,
    `- batchCount: ${batches.length}`,
    `- market_floor_us: ${marketFloorUs}`,
    `- market_floor_ca: ${marketFloorCa}`,
    `- override_reason: ${override_reason || "none"}`,
    "",
    "## Batches",
    ...batches.map((batch) => `- ${batch.patchBatchId}: ${batch.brands.map((row) => `${row.market}:${row.brand}`).join(", ")}`),
  ].join("\n");

  await writeJson(path.join(outDir, "brand_batch_manifest.json"), manifest);
  await writeJson(path.join(outDir, "stage_d1_state_machine.json"), stateMachine);
  await writeText(path.join(outDir, "brand_batch_selection_report.md"), `${report}\n`);

  console.log("[build-stage-d1-brand-batches] completed");
  console.log(JSON.stringify({ outDir, selectedBrandCount: selected.length, batchCount: batches.length, override_reason }, null, 2));
};

main().catch((error) => {
  console.error("[build-stage-d1-brand-batches] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
