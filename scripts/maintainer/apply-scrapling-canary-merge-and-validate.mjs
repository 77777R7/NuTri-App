#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const REPORT_PATH = getArg("report-json", null);
const STAGING_PATH = getArg("staging-json", null);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", `scrapling_merge_validation_${Date.now()}`));
const SKIP_MERGED_STAGING_WRITE = getArg("skip-merged-staging", "false") === "true";

if (!REPORT_PATH || !STAGING_PATH) {
  console.error(
    "Missing required args. Example: node scripts/maintainer/apply-scrapling-canary-merge-and-validate.mjs --report-json output/.../scrapling_official_fallback_report.json --staging-json output/.../staging_products.official_refreshed.sanitized.json --out-dir output/...",
  );
  process.exit(1);
}

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const readText = async (filePath) => fs.readFile(path.resolve(ROOT, filePath), "utf8");

const buildOverlayHash = (row) =>
  stableHash({
    brandName: row.brandName,
    title: row.title,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts,
    descriptionSections: row.descriptionSections,
    sourceSummary: row.sourceSummary,
  });

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);

  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: buildOverlayHash(mergedRecord),
  };
};

const buildIndex = (rows) => {
  const byProductId = new Map();
  const byBarcode = new Map();
  for (const row of rows) {
    const productId = normalizeText(row?.productId ?? null);
    const barcode = normalizeText(row?.barcode_gtin14 ?? row?.barcode ?? null);
    if (productId) byProductId.set(productId, row);
    if (barcode) byBarcode.set(barcode, row);
  }
  return { byProductId, byBarcode };
};

const matchCurrentRow = (candidate, index) => {
  const productId = normalizeText(candidate?.productId ?? null);
  const barcode = toGtin14(candidate?.barcode_gtin14 ?? null);
  return (productId && index.byProductId.get(productId)) || (barcode && index.byBarcode.get(barcode)) || null;
};

const buildMarkdown = (report) => {
  const lines = [
    "# Scrapling Canary Merge Validation",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- sourceReport: ${report.inputs.reportPath}`,
    `- sourceStaging: ${report.inputs.stagingPath}`,
    "",
    "## Summary",
    "",
    `- processed: ${report.summary.processed}`,
    `- improved_rows: ${report.summary.improvedRows}`,
    `- became_full_overlay_ready: ${report.summary.becameFullOverlayReady}`,
    `- filled_ingredient: ${report.summary.filledIngredient}`,
    `- filled_dosage: ${report.summary.filledDosage}`,
    `- filled_suggested_use: ${report.summary.filledSuggestedUse}`,
    `- filled_warnings: ${report.summary.filledWarnings}`,
    `- filled_product_image: ${report.summary.filledProductImage}`,
    "",
    "## Product Surface Validation",
    "",
    `- static_gates_pass: ${report.productSurfaceValidation.staticGatesPass}`,
    `- my_saved_detail_overlay_fields: ${report.productSurfaceValidation.staticGates.mySavedDetailConsumesOverlayFields}`,
    `- saved_stack_safety_consumer_present: ${report.productSurfaceValidation.staticGates.savedStackSafetyFlowPresent}`,
    "",
    "## Rows",
    "",
  ];

  for (const row of report.rows) {
    lines.push(
      `- ${row.productId} | ${row.title} | before=${row.beforeStatus} | after=${row.afterStatus} | filled=${row.filledFields.join(", ") || "none"} | sections=${row.sectionKeys.join(", ") || "none"} | facts=${row.factRows}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const report = await readJson(REPORT_PATH);
  const stagingRaw = await readJson(STAGING_PATH);
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (stagingRaw.products ?? []);
  const index = buildIndex(stagingRows);
  const nextRows = [...stagingRows];
  const rowIndexByProductId = new Map(nextRows.map((row, idx) => [normalizeText(row?.productId ?? null), idx]));

  const resultRows = [];

  for (const result of Array.isArray(report?.results) ? report.results : []) {
    if (result?.outcome !== "scrapling_candidate_built" || !result?.candidate) continue;
    const candidate = result.candidate;
    const currentRow = matchCurrentRow(candidate, index);
    if (!currentRow) {
      resultRows.push({
        productId: candidate.productId ?? null,
        title: candidate.title ?? null,
        outcome: "staging_row_not_found",
      });
      continue;
    }

    const beforeRecord = extractOverlayRecordFromSeedRow(currentRow, { seedName: "staging_row" });
    const beforeCompleteness = deriveCompleteness(beforeRecord);
    const beforeStatus = classifyOverlayStatus(beforeRecord, beforeCompleteness);
    const mergedRecord = mergeOverlayRecords(beforeRecord, candidate);
    const mergedRow = hydrateMergedRow(currentRow, mergedRecord);

    const rowIndex = rowIndexByProductId.get(normalizeText(currentRow?.productId ?? null));
    if (typeof rowIndex === "number") nextRows[rowIndex] = mergedRow;

    const afterCompleteness = mergedRow.completeness ?? deriveCompleteness(mergedRecord);
    const afterStatus = mergedRow.completeness?.status ?? classifyOverlayStatus(mergedRecord, afterCompleteness);
    const filledFields = beforeCompleteness.coreMissingFields.filter(
      (field) => !afterCompleteness.coreMissingFields.includes(field),
    );

    resultRows.push({
      productId: mergedRow.productId ?? null,
      barcode_gtin14: mergedRow.barcode_gtin14 ?? null,
      title: mergedRow.title ?? null,
      pageUrl: result.pageUrl ?? result.targetUrl ?? null,
      beforeStatus,
      afterStatus,
      beforeMissingFields: beforeCompleteness.coreMissingFields,
      afterMissingFields: afterCompleteness.coreMissingFields,
      filledFields,
      improved: filledFields.length > 0 || beforeStatus !== afterStatus,
      sectionKeys: result.sectionKeys ?? Object.keys(candidate.descriptionSections ?? {}),
      factRows: Number(result.factRows ?? candidate?.supplementFacts?.nutritionalFacts?.length ?? 0),
      hasPrimaryImage: Boolean(result.hasPrimaryImage ?? candidate?.productCatalogImage),
      extractionWarnings: result.extractionWarnings ?? candidate?.fetchDiagnostics?.extractionWarnings ?? [],
      completenessScore: afterCompleteness.completenessScore,
      highConfidenceUsProductPageReady: Boolean(mergedRow?.readiness?.highConfidenceUsProductPageReady),
    });
  }

  const summary = resultRows.reduce(
    (acc, row) => {
      if (row.outcome === "staging_row_not_found") return acc;
      acc.processed += 1;
      if (row.improved) acc.improvedRows += 1;
      if (row.beforeStatus !== "full_overlay_ready" && row.afterStatus === "full_overlay_ready") acc.becameFullOverlayReady += 1;
      if (row.filledFields.includes("ingredient")) acc.filledIngredient += 1;
      if (row.filledFields.includes("dosage")) acc.filledDosage += 1;
      if (row.filledFields.includes("suggested_use")) acc.filledSuggestedUse += 1;
      if (row.filledFields.includes("warnings")) acc.filledWarnings += 1;
      if (row.filledFields.includes("product_image")) acc.filledProductImage += 1;
      return acc;
    },
    {
      processed: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
      filledIngredient: 0,
      filledDosage: 0,
      filledSuggestedUse: 0,
      filledWarnings: 0,
      filledProductImage: 0,
    },
  );

  const mySupplement = await readText("components/screens/MySupplement.tsx");
  const homePage = await readText("app/main/Home-Page.tsx");
  const productSurfaceValidation = {
    staticGates: {
      mySavedDetailConsumesOverlayFields:
        /const overlaySuggestedUseRaw =/.test(mySupplement) &&
        /const howToUseText = overlaySuggestedUseRaw \|\| labelDirectionsFallbackRaw;/.test(mySupplement) &&
        /const fromFacts = \(facts\?\.warnings\?\.bullets \?\? \[\]\)/.test(mySupplement) &&
        /const nextImageUrl = pickFirstText\(ensured\.facts\.overlay\?\.imageUrl, item\.imageUrl\);/.test(mySupplement),
      saveFromHistoryPreservesDoseAndImage:
        /dosageText: item\.dosageText \?\? '',/.test(homePage) &&
        /imageUrl: item\.imageUrl \?\? null,/.test(homePage),
      savedStackSafetyFlowPresent: /SavedStackSafetySummary/.test(mySupplement),
    },
  };
  productSurfaceValidation.staticGatesPass =
    productSurfaceValidation.staticGates.mySavedDetailConsumesOverlayFields &&
    productSurfaceValidation.staticGates.saveFromHistoryPreservesDoseAndImage &&
    productSurfaceValidation.staticGates.savedStackSafetyFlowPresent;

  const finalReport = {
    generatedAt: new Date().toISOString(),
    inputs: {
      reportPath: path.resolve(ROOT, REPORT_PATH),
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      skipMergedStagingWrite: SKIP_MERGED_STAGING_WRITE,
    },
    summary,
    rows: resultRows,
    productSurfaceValidation,
  };

  await fs.mkdir(path.resolve(ROOT, OUT_DIR), { recursive: true });
  if (!SKIP_MERGED_STAGING_WRITE) {
    await fs.writeFile(
      path.resolve(ROOT, OUT_DIR, "staging_products.scrapling_merged.json"),
      `${JSON.stringify(nextRows, null, 2)}\n`,
    );
  }
  await fs.writeFile(
    path.resolve(ROOT, OUT_DIR, "scrapling_merge_validation_report.json"),
    `${JSON.stringify(finalReport, null, 2)}\n`,
  );
  await fs.writeFile(
    path.resolve(ROOT, OUT_DIR, "scrapling_merge_validation_report.md"),
    buildMarkdown(finalReport),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        reportPath: path.resolve(ROOT, OUT_DIR, "scrapling_merge_validation_report.json"),
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
