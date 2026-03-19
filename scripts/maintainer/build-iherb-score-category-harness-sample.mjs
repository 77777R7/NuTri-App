#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";

import {
  buildImportedRows,
  buildHighFrequencyLookup,
  buildRowAnalysis,
  buildSampleKey,
  createSeededRng,
  normalizeBarcode,
  safeText,
  shuffleDeterministic,
  toRelative,
  writeJson,
} from "./lib/iherb-score-category-harness.mjs";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const SOURCE_PATH = getArg(
  "source-jsonl",
  path.join(
    ROOT,
    "output",
    "v1.6.14-top100-lane1-scale-20260302T032052Z",
    "step1_candidates",
    "lane1_top100_patch_candidates.jsonl",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`),
);
const SAMPLE_SIZE = Number(getArg("sample-size", 500)) || 500;
const SEED = getArg("seed", "iherb_score_category_harness_v1");
const BRAND_CAP = Number(getArg("brand-cap", 25)) || 25;

const pickRows = ({ candidates, count, layer, reason, selectedKeys, brandCounts, rng, output }) => {
  for (const row of shuffleDeterministic(candidates, rng)) {
    if (output.length >= count) break;
    const key = buildSampleKey(row);
    const brand = safeText(row?.brandName) || "Unknown";
    if (!key || selectedKeys.has(key)) continue;
    if ((brandCounts.get(brand) ?? 0) >= BRAND_CAP) continue;
    selectedKeys.add(key);
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    output.push({
      sampleId: `${layer}:${output.length + 1}`.padEnd(0),
      layer,
      samplingReason: reason,
      isHighFrequency: Boolean(row.isHighFrequency),
      productId: safeText(row.productId) || null,
      barcode_gtin14: safeText(row.barcode_gtin14) || null,
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      predictedCategoryId: row.predictedCategoryId,
      sourceType: row.sourceType,
      dosageForm: row.dosageForm,
      activeCount: row.activeCount,
      patchPriorityScore: row.patchPriorityScore,
      rowData: row.rowData,
    });
  }
};

const main = async () => {
  const importedRows = await buildImportedRows({
    stagingPath: STAGING_PATH,
    mergeReportPath: MERGE_REPORT_PATH,
  });
  const { barcodeSet: highFrequencyBarcodeSet, scoreByBarcode } = await buildHighFrequencyLookup(SOURCE_PATH);

  const metadataRows = importedRows.map((row) => {
    const analysis = buildRowAnalysis(row);
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    const dosageForm = safeText(analysis.digest?.product?.dosageForm) || safeText(row?.dosageForm) || "unknown";
    const activeCount = Array.isArray(analysis.digest?.actives) ? analysis.digest.actives.length : 0;
    return {
      productId: safeText(row?.productId) || null,
      barcode_gtin14: barcode || null,
      brandName: safeText(row?.brandName) || "Unknown",
      title: safeText(row?.title) || "Unknown",
      predictedCategoryId: analysis.categoryId,
      sourceType: analysis.sourceType,
      dosageForm,
      activeCount,
      isHighFrequency: highFrequencyBarcodeSet.has(barcode),
      patchPriorityScore: scoreByBarcode.get(barcode) ?? 0,
      rowData: row,
    };
  });

  const rng = createSeededRng(SEED);
  const selectedKeys = new Set();
  const brandCounts = new Map();
  const manifestRows = [];

  pickRows({
    candidates: metadataRows.filter((row) => row.isHighFrequency),
    count: 150,
    layer: "LayerA_high_frequency_complete",
    reason: "high_frequency_complete",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });

  pickRows({
    candidates: metadataRows.filter((row) => !row.isHighFrequency),
    count: 300,
    layer: "LayerB_random_long_tail_complete",
    reason: "random_long_tail_complete",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });

  const categoryTargets = [
    "fish_oil_omega3",
    "vitamin_d",
    "magnesium",
    "probiotics",
    "unknown",
  ];
  for (const categoryId of categoryTargets) {
    const before = manifestRows.length;
    pickRows({
      candidates: metadataRows.filter((row) => row.predictedCategoryId === categoryId),
      count: before + 30,
      layer: "LayerC_category_balanced",
      reason: `category_balanced:${categoryId}`,
      selectedKeys,
      brandCounts,
      rng,
      output: manifestRows,
    });
  }

  pickRows({
    candidates: metadataRows.filter((row) => row.predictedCategoryId === "unknown"),
    count: manifestRows.length + 20,
    layer: "LayerD_edge_cases",
    reason: "edge_unknown_category",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });
  pickRows({
    candidates: metadataRows.filter((row) => !/capsule|softgel/i.test(row.dosageForm) && row.dosageForm !== "unknown"),
    count: manifestRows.length + 15,
    layer: "LayerD_edge_cases",
    reason: "edge_non_capsule_form",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });
  pickRows({
    candidates: metadataRows.filter((row) => row.activeCount <= 1),
    count: manifestRows.length + 15,
    layer: "LayerD_edge_cases",
    reason: "edge_sparse_actives",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });

  pickRows({
    candidates: metadataRows,
    count: SAMPLE_SIZE,
    layer: "LayerFill_backfill",
    reason: "backfill_remaining",
    selectedKeys,
    brandCounts,
    rng,
    output: manifestRows,
  });

  const trimmedRows = manifestRows.slice(0, SAMPLE_SIZE).map((row, index) => ({
    ...row,
    sampleId: `sample_${String(index + 1).padStart(4, "0")}`,
  }));

  const layerCounts = trimmedRows.reduce((acc, row) => {
    acc[row.layer] = (acc[row.layer] ?? 0) + 1;
    return acc;
  }, {});
  const categoryCounts = trimmedRows.reduce((acc, row) => {
    acc[row.predictedCategoryId] = (acc[row.predictedCategoryId] ?? 0) + 1;
    return acc;
  }, {});

  const report = {
    schemaVersion: "iherb_score_category_harness_sample.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: toRelative(STAGING_PATH),
      mergeReportPath: toRelative(MERGE_REPORT_PATH),
      sourcePath: toRelative(SOURCE_PATH),
      sampleSize: SAMPLE_SIZE,
      seed: SEED,
      brandCap: BRAND_CAP,
    },
    summary: {
      importedRows: metadataRows.length,
      sampledRows: trimmedRows.length,
      highFrequencyRows: trimmedRows.filter((row) => row.isHighFrequency).length,
    },
    layerCounts,
    categoryCounts,
    rows: trimmedRows,
  };

  const outJson = path.join(OUT_DIR, "sample_manifest.json");
  await writeJson(outJson, report);

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        layerCounts: report.layerCounts,
        categoryCounts: report.categoryCounts,
        output: toRelative(outJson),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
