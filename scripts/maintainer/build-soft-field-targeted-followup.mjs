#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const RUN_ROOT = path.resolve(
  ROOT,
  getArg("run-root", path.join("output", "soft_field_priority_run_20260326")),
);
const OUT_DIR = path.resolve(
  ROOT,
  getArg("out-dir", path.join(RUN_ROOT, "targeted_followup_pack")),
);

const FRONTIER_EXCLUDED_PAGE_MISMATCHES = new Map([
  ["30797", "dandelion root row resolved to thyme leaf page"],
  ["141389", "meadowsweet row resolved to thyme leaf page"],
  ["141383", "white willow bark row resolved to cilantro leaf page"],
  ["141359", "lemon peel row resolved to cilantro leaf page"],
  ["30987", "wheat grass powder row resolved to barley grass page"],
]);

const BRAND_CONFIGS = [
  {
    brandName: "Carlson",
    slug: "carlson",
    waveDir: path.join(RUN_ROOT, "waves", "p0_carlson"),
    queuePath: path.join(RUN_ROOT, "queues", "p0_carlson.json"),
    rationale: "Keep all rows. This lane was clean and converted 2/2 to full_overlay_ready.",
    selectRows: (rows) =>
      rows.map((row) => ({
        ...row,
        selectionReason: "retain_all_clean_hits",
      })),
    excludeRows: () => [],
  },
  {
    brandName: "Frontier Co-op",
    slug: "frontier-co-op",
    waveDir: path.join(RUN_ROOT, "waves", "p0_frontier-co-op"),
    queuePath: path.join(RUN_ROOT, "queues", "p0_frontier-co-op.json"),
    rationale:
      "Keep improved rows except the explicit wrong-page matches. This preserves the strongest uplift while dropping known cross-product search landings.",
    selectRows: (rows) =>
      rows
        .filter((row) => row.improved === true)
        .filter((row) => !FRONTIER_EXCLUDED_PAGE_MISMATCHES.has(normalizeText(row?.productId)))
        .map((row) => ({
          ...row,
          selectionReason: "improved_row_without_known_page_mismatch",
        })),
    excludeRows: (rows) =>
      rows
        .filter((row) => FRONTIER_EXCLUDED_PAGE_MISMATCHES.has(normalizeText(row?.productId)))
        .map((row) => ({
          ...row,
          exclusionReason: FRONTIER_EXCLUDED_PAGE_MISMATCHES.get(normalizeText(row?.productId)),
        })),
  },
  {
    brandName: "NOW Foods",
    slug: "now-foods",
    waveDir: path.join(RUN_ROOT, "waves", "p0_now-foods"),
    queuePath: path.join(RUN_ROOT, "queues", "p0_now-foods.json"),
    rationale:
      "Keep only improved rows with strong evidence from OCR or page hits. This trims away broad category and no-signal rows.",
    selectRows: (rows) =>
      rows
        .filter((row) => row.improved === true)
        .filter((row) => row.imageOcrHit === true || row.pageHit === true)
        .map((row) => ({
          ...row,
          selectionReason: row.pageHit === true ? "improved_with_page_signal" : "improved_with_ocr_signal",
        })),
    excludeRows: (rows) =>
      rows
        .filter((row) => !(row.improved === true && (row.imageOcrHit === true || row.pageHit === true)))
        .map((row) => ({
          ...row,
          exclusionReason: row.improved === true ? "missing_page_or_ocr_signal" : "no_observed_uplift",
        })),
  },
];

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}`, "utf8");
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const loadBrandRun = async (config) => {
  const report = await readJson(path.join(config.waveDir, "official_fallback_report.json"));
  const seed = await readJson(path.join(config.waveDir, "official_fallback_seed.json"));
  const queueRows = await readJson(config.queuePath);
  return {
    report,
    seedProducts: toArray(seed?.products),
    queueRows: toArray(queueRows),
  };
};

const indexByProductId = (rows) =>
  new Map(
    rows
      .map((row) => [normalizeText(row?.productId), row])
      .filter(([productId]) => productId),
  );

const toSummary = (rows) => ({
  selectedCount: rows.length,
  selectedFullOverlayReadyCount: rows.filter((row) => toArray(row?.afterMissingFields).length === 0).length,
  selectedFilledSuggestedUseCount: rows.filter((row) => toArray(row?.filledFields).includes("suggested_use")).length,
  selectedFilledWarningsCount: rows.filter((row) => toArray(row?.filledFields).includes("warnings")).length,
  productIds: rows.map((row) => normalizeText(row?.productId)).filter(Boolean),
});

const toMarkdown = ({ generatedAt, runRoot, brands, totals }) => {
  const lines = [
    "# Soft-Field Targeted Follow-up Pack",
    "",
    `- generatedAt: ${generatedAt}`,
    `- runRoot: ${runRoot}`,
    `- selectedRows: ${totals.selectedRows}`,
    `- selectedAlreadyFullOverlayReady: ${totals.selectedFullOverlayReady}`,
    `- selectedFilledSuggestedUse: ${totals.selectedFilledSuggestedUse}`,
    `- selectedFilledWarnings: ${totals.selectedFilledWarnings}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of brands) {
    lines.push(`### ${brand.brandName}`);
    lines.push(`- rationale: ${brand.rationale}`);
    lines.push(`- selectedRows: ${brand.summary.selectedCount}`);
    lines.push(`- selectedAlreadyFullOverlayReady: ${brand.summary.selectedFullOverlayReadyCount}`);
    lines.push(`- selectedFilledSuggestedUse: ${brand.summary.selectedFilledSuggestedUseCount}`);
    lines.push(`- selectedFilledWarnings: ${brand.summary.selectedFilledWarningsCount}`);
    lines.push(`- selectedProductIds: ${brand.summary.productIds.join(", ") || "(none)"}`);
    if (brand.excludedRows.length > 0) {
      lines.push(`- explicitExclusions: ${brand.excludedRows.map((row) => `${row.productId}:${row.exclusionReason}`).join(" | ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const generatedAt = new Date().toISOString();
  const brandOutputs = [];
  const combinedQueueRows = [];
  const combinedSelectedRows = [];
  const combinedSeedProducts = [];

  for (const config of BRAND_CONFIGS) {
    const { report, seedProducts, queueRows } = await loadBrandRun(config);
    const reportRows = toArray(report?.rows);
    const selectedRows = config.selectRows(reportRows);
    const excludedRows = config.excludeRows(reportRows);
    const selectedIds = new Set(selectedRows.map((row) => normalizeText(row?.productId)).filter(Boolean));
    const queueIndex = indexByProductId(queueRows);
    const seedIndex = indexByProductId(seedProducts);
    const selectedQueueRows = [...selectedIds]
      .map((productId) => queueIndex.get(productId))
      .filter(Boolean);
    const selectedSeedProducts = [...selectedIds]
      .map((productId) => seedIndex.get(productId))
      .filter(Boolean);
    const summary = toSummary(selectedRows);

    const brandOutDir = path.join(OUT_DIR, config.slug);
    await writeJson(path.join(brandOutDir, "selected_rows.json"), selectedRows);
    await writeJson(path.join(brandOutDir, "selected_queue_rows.json"), selectedQueueRows);
    await writeJson(path.join(brandOutDir, "selected_seed_products.json"), { products: selectedSeedProducts });
    await writeJson(path.join(brandOutDir, "excluded_rows.json"), excludedRows);
    await writeJson(path.join(brandOutDir, "product_ids.json"), summary.productIds);

    brandOutputs.push({
      brandName: config.brandName,
      slug: config.slug,
      rationale: config.rationale,
      sourceReportPath: path.join(config.waveDir, "official_fallback_report.json"),
      sourceQueuePath: config.queuePath,
      summary,
      excludedRows,
    });
    combinedQueueRows.push(...selectedQueueRows);
    combinedSelectedRows.push(...selectedRows);
    combinedSeedProducts.push(...selectedSeedProducts);
  }

  const totals = {
    selectedRows: combinedSelectedRows.length,
    selectedFullOverlayReady: combinedSelectedRows.filter((row) => toArray(row?.afterMissingFields).length === 0).length,
    selectedFilledSuggestedUse: combinedSelectedRows.filter((row) => toArray(row?.filledFields).includes("suggested_use")).length,
    selectedFilledWarnings: combinedSelectedRows.filter((row) => toArray(row?.filledFields).includes("warnings")).length,
  };

  const manifest = {
    generatedAt,
    runRoot: RUN_ROOT,
    outDir: OUT_DIR,
    totals,
    brands: brandOutputs,
  };

  await writeJson(path.join(OUT_DIR, "manifest.json"), manifest);
  await writeJson(path.join(OUT_DIR, "combined_selected_queue_rows.json"), combinedQueueRows);
  await writeJson(path.join(OUT_DIR, "combined_selected_rows.json"), combinedSelectedRows);
  await writeJson(path.join(OUT_DIR, "combined_selected_seed_products.json"), { products: combinedSeedProducts });
  await writeText(path.join(OUT_DIR, "summary.md"), toMarkdown({ generatedAt, runRoot: RUN_ROOT, brands: brandOutputs, totals }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        totals,
        brands: brandOutputs.map((brand) => ({
          brandName: brand.brandName,
          selectedRows: brand.summary.selectedCount,
          selectedFullOverlayReady: brand.summary.selectedFullOverlayReadyCount,
        })),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
