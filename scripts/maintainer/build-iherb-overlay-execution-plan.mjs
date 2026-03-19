#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_overlay_staging", "staging_products.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_overlay_execution_plan"));
const BRAND_FILTER = getArg("brand", null);

const CORE_FIELDS = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];
const PRIORITY_ORDER = {
  P0_api_fill_us_strong_identity: 0,
  P1_api_fill_non_us_strong_identity: 1,
  P2_hold_weak_partial_or_catalog: 2,
  P3_hold_conflicted_source: 3,
};
const ACTIVE_PRIORITY_PREFIXES = ["P0_", "P1_"];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const toPercent = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);
const isActivePriorityLane = (lane) => ACTIVE_PRIORITY_PREFIXES.some((prefix) => String(lane).startsWith(prefix));
const buildPriorityCounts = (rows) =>
  rows.reduce((acc, row) => {
    acc[row.priorityLane] = (acc[row.priorityLane] ?? 0) + 1;
    return acc;
  }, {});

const buildRowKey = ({ brandName, title, productId, barcodeGtin14, barcode_gtin14 }) =>
  [
    normalizeLower(brandName),
    normalizeLower(title),
    normalizeText(productId),
    normalizeText(barcodeGtin14 ?? barcode_gtin14),
  ].join("||");

const hasStrongIdentity = (row) =>
  Boolean(normalizeText(row?.productId) || normalizeText(row?.barcode_gtin14) || normalizeText(row?.upcCode));

const hasUsIherbPath = (row) => Boolean(row?.sourceSummary?.hasUsIherbPage) && !Boolean(row?.sourceSummary?.npnIgnored);

const hasOnlyMissingFields = (row, expectedFields) => {
  const missing = Array.isArray(row?.completeness?.coreMissingFields) ? row.completeness.coreMissingFields : [];
  if (missing.length !== expectedFields.length) return false;
  return expectedFields.every((field) => missing.includes(field));
};

const classifyPriorityLane = (row) => {
  const status = row?.completeness?.status ?? "unknown";
  const strongIdentity = hasStrongIdentity(row);
  const usIherb = hasUsIherbPath(row);

  if (status === "conflicted_or_non_us") {
    return {
      lane: "P3_hold_conflicted_source",
      recommendedAction: "pause",
      rationale: "Source is conflicted or non-US. Do not invest during the current coverage phase.",
    };
  }

  if (status === "catalog_only") {
    return {
      lane: "P2_hold_weak_partial_or_catalog",
      recommendedAction: "pause",
      rationale: "Catalog-only row is missing core overlay evidence. Do not invest in this phase.",
    };
  }

  if (status !== "partial_overlay") {
    return null;
  }

  if (usIherb && strongIdentity) {
    if (hasOnlyMissingFields(row, ["suggested_use", "warnings"])) {
      return {
        lane: "P0_api_fill_us_strong_identity",
        recommendedAction: "official_fill_usage_and_warnings",
        rationale: "US iHerb path plus strong identity. Official product page or PDF should fill suggested use and warnings.",
      };
    }
    if (hasOnlyMissingFields(row, ["product_image"])) {
      return {
        lane: "P0_api_fill_us_strong_identity",
        recommendedAction: "official_fill_product_image",
        rationale: "US iHerb path plus strong identity. Official product page should supply the product image.",
      };
    }
    return {
      lane: "P0_api_fill_us_strong_identity",
      recommendedAction: "official_fill_core_fields",
      rationale: "US iHerb path plus strong identity. Highest-ROI official fallback target.",
    };
  }

  if (strongIdentity) {
    return {
      lane: "P1_api_fill_non_us_strong_identity",
      recommendedAction: "api_fill_after_p0",
      rationale: "Strong identity is present, but there is no US iHerb path. Keep as second-wave queue.",
    };
  }

  return {
    lane: "P2_hold_weak_partial_or_catalog",
    recommendedAction: "pause",
    rationale: "Partial overlay lacks strong identity. Do not spend current-cycle effort here.",
  };
};

const buildCoverage = (rows) => {
  const coverage = {};
  for (const field of CORE_FIELDS) {
    const present = rows.filter((row) =>
      Array.isArray(row?.completeness?.coreResolvedFields) && row.completeness.coreResolvedFields.includes(field),
    ).length;
    coverage[field] = {
      present,
      total: rows.length,
      percent: toPercent(present, rows.length),
    };
  }
  return coverage;
};

const sortPriorityQueue = (rows) =>
  [...rows].sort((left, right) => {
    const leftOrder = PRIORITY_ORDER[left.priorityLane] ?? 99;
    const rightOrder = PRIORITY_ORDER[right.priorityLane] ?? 99;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const leftMissing = left.coreMissingFields.length;
    const rightMissing = right.coreMissingFields.length;
    if (leftMissing !== rightMissing) return leftMissing - rightMissing;

    const leftIdentityStrength = Number(Boolean(left.barcode_gtin14)) + Number(Boolean(left.productId));
    const rightIdentityStrength = Number(Boolean(right.barcode_gtin14)) + Number(Boolean(right.productId));
    if (leftIdentityStrength !== rightIdentityStrength) return rightIdentityStrength - leftIdentityStrength;

    return String(left.title).localeCompare(String(right.title));
  });

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Overlay Execution Plan",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- mergeReportPath: ${report.inputs.mergeReportPath}`,
    `- brandFilter: ${report.inputs.brandFilter || "all"}`,
    "",
    "## Execution Guardrail",
    "",
    "- Merge only `authoritative_overlay_ready` and `high_confidence_product_page_ready`.",
    "- Keep every `partial_overlay` in API fill queues until all five core fields are complete.",
    "- Pause `catalog_only_missing_core_overlay` and `non_us_or_conflicted_source` during this phase.",
    "",
    "## Import Quality",
    "",
    `- imported_total: ${report.importQuality.importedTotal}`,
    `- imported_complete: ${report.importQuality.importedCompleteCount} (${report.importQuality.importedCompleteRate}%)`,
    `- imported_unexpected_partial: ${report.importQuality.importedUnexpectedPartialCount}`,
    `- imported_unexpected_catalog_or_conflicted: ${report.importQuality.importedUnexpectedBlockedCount}`,
    `- strict_policy_pass: ${report.importQuality.strictPolicyPass}`,
    "",
    "## Staging Summary",
    "",
    `- total: ${report.summary.total}`,
    `- full_overlay_ready: ${report.summary.statusCounts.full_overlay_ready}`,
    `- partial_overlay: ${report.summary.statusCounts.partial_overlay}`,
    `- catalog_only: ${report.summary.statusCounts.catalog_only}`,
    `- conflicted_or_non_us: ${report.summary.statusCounts.conflicted_or_non_us}`,
    "",
    "## Core Coverage",
    "",
  ];

  for (const field of CORE_FIELDS) {
    const row = report.summary.coreCoverage[field];
    lines.push(`- ${field}: ${row.present}/${row.total} (${row.percent}%)`);
  }

  lines.push("", "## Active Queue", "");
  for (const [lane, count] of Object.entries(report.priorityQueue.activeCounts)) {
    lines.push(`- ${lane}: ${count}`);
  }

  lines.push("", "## Paused Queue", "");
  for (const [lane, count] of Object.entries(report.priorityQueue.pausedCounts)) {
    lines.push(`- ${lane}: ${count}`);
  }

  if (report.priorityQueue.rows.length > 0) {
    lines.push("", "## Top Queue Samples", "");
    for (const row of report.priorityQueue.rows.slice(0, 25)) {
      lines.push(
        `- ${row.priorityLane} | ${row.title} | ${row.productId || row.barcode_gtin14 || "n/a"} | action=${row.recommendedAction} | missing=${row.coreMissingFields.join(", ") || "none"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const staging = await readJson(STAGING_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);
  const stagingRows = Array.isArray(staging?.products) ? staging.products : [];
  const mergeRows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];

  const filteredStagingRows = stagingRows.filter((row) =>
    BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true,
  );
  const filteredMergeRows = mergeRows.filter((row) =>
    BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true,
  );

  const mergeRowKeys = new Set(
    filteredMergeRows
      .filter((row) => row?.mergeDecision === "merged" || row?.mergeDecision === "matched")
      .map((row) => buildRowKey(row)),
  );

  const importedRows = filteredStagingRows.filter((row) => mergeRowKeys.has(buildRowKey(row)));
  const importedUnexpectedPartialCount = importedRows.filter(
    (row) => row?.completeness?.status === "partial_overlay",
  ).length;
  const importedUnexpectedBlockedCount = importedRows.filter((row) => {
    const status = row?.completeness?.status;
    return status === "catalog_only" || status === "conflicted_or_non_us";
  }).length;
  const importedCompleteCount = importedRows.filter(
    (row) => (Array.isArray(row?.completeness?.coreMissingFields) ? row.completeness.coreMissingFields.length : 0) === 0,
  ).length;

  const statusCounts = filteredStagingRows.reduce(
    (acc, row) => {
      const status = row?.completeness?.status ?? "unknown";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {
      full_overlay_ready: 0,
      partial_overlay: 0,
      catalog_only: 0,
      conflicted_or_non_us: 0,
    },
  );

  const priorityRows = sortPriorityQueue(
    filteredStagingRows
      .map((row) => {
        const priority = classifyPriorityLane(row);
        if (!priority) return null;
        return {
          priorityLane: priority.lane,
          recommendedAction: priority.recommendedAction,
          rationale: priority.rationale,
          brandName: row.brandName,
          title: row.title,
          productId: normalizeText(row.productId) || null,
          barcode_gtin14: normalizeText(row.barcode_gtin14) || null,
          upcCode: normalizeText(row.upcCode) || null,
          hasUsIherbPage: hasUsIherbPath(row),
          highConfidenceUsProductPageReady: Boolean(row?.readiness?.highConfidenceUsProductPageReady),
          coreResolvedFields: Array.isArray(row?.completeness?.coreResolvedFields) ? row.completeness.coreResolvedFields : [],
          coreMissingFields: Array.isArray(row?.completeness?.coreMissingFields) ? row.completeness.coreMissingFields : [],
          sourceTypes: Array.isArray(row?.sourceSummary?.sourceTypes) ? row.sourceSummary.sourceTypes : [],
        };
      })
      .filter(Boolean),
  );

  const priorityCounts = buildPriorityCounts(priorityRows);
  const activePriorityRows = priorityRows.filter((row) => isActivePriorityLane(row.priorityLane));
  const pausedPriorityRows = priorityRows.filter((row) => !isActivePriorityLane(row.priorityLane));
  const activeCounts = buildPriorityCounts(activePriorityRows);
  const pausedCounts = buildPriorityCounts(pausedPriorityRows);

  const report = {
    schemaVersion: "iherb_overlay_execution_plan.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: STAGING_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
      brandFilter: BRAND_FILTER,
    },
    summary: {
      total: filteredStagingRows.length,
      statusCounts,
      coreCoverage: buildCoverage(filteredStagingRows),
    },
    importQuality: {
      importedTotal: importedRows.length,
      importedCompleteCount,
      importedCompleteRate: toPercent(importedCompleteCount, importedRows.length),
      importedUnexpectedPartialCount,
      importedUnexpectedBlockedCount,
      strictPolicyPass: importedUnexpectedPartialCount === 0 && importedUnexpectedBlockedCount === 0,
      importedCoreCoverage: buildCoverage(importedRows),
    },
    priorityQueue: {
      priorityCounts,
      activeCounts,
      pausedCounts,
      rows: priorityRows,
    },
  };

  const reportJsonPath = path.join(OUT_DIR, "execution_plan_summary.json");
  const reportMdPath = path.join(OUT_DIR, "execution_plan_summary.md");
  const priorityQueueJsonPath = path.join(OUT_DIR, "api_fill_priority_queue.json");
  const priorityQueueJsonlPath = path.join(OUT_DIR, "api_fill_priority_queue.jsonl");
  const activePriorityQueueJsonPath = path.join(OUT_DIR, "active_priority_queue.json");
  const activePriorityQueueJsonlPath = path.join(OUT_DIR, "active_priority_queue.jsonl");
  const pausedPriorityQueueJsonPath = path.join(OUT_DIR, "paused_priority_queue.json");
  const pausedPriorityQueueJsonlPath = path.join(OUT_DIR, "paused_priority_queue.jsonl");

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, toMarkdown(report), "utf8");
  await fs.writeFile(priorityQueueJsonPath, `${JSON.stringify(priorityRows, null, 2)}\n`, "utf8");
  await fs.writeFile(
    priorityQueueJsonlPath,
    `${priorityRows.map((row) => JSON.stringify(row)).join("\n")}${priorityRows.length > 0 ? "\n" : ""}`,
    "utf8",
  );
  await fs.writeFile(activePriorityQueueJsonPath, `${JSON.stringify(activePriorityRows, null, 2)}\n`, "utf8");
  await fs.writeFile(
    activePriorityQueueJsonlPath,
    `${activePriorityRows.map((row) => JSON.stringify(row)).join("\n")}${activePriorityRows.length > 0 ? "\n" : ""}`,
    "utf8",
  );
  await fs.writeFile(pausedPriorityQueueJsonPath, `${JSON.stringify(pausedPriorityRows, null, 2)}\n`, "utf8");
  await fs.writeFile(
    pausedPriorityQueueJsonlPath,
    `${pausedPriorityRows.map((row) => JSON.stringify(row)).join("\n")}${pausedPriorityRows.length > 0 ? "\n" : ""}`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          summaryJson: reportJsonPath,
          summaryMd: reportMdPath,
          priorityQueueJson: priorityQueueJsonPath,
          priorityQueueJsonl: priorityQueueJsonlPath,
          activePriorityQueueJson: activePriorityQueueJsonPath,
          activePriorityQueueJsonl: activePriorityQueueJsonlPath,
          pausedPriorityQueueJson: pausedPriorityQueueJsonPath,
          pausedPriorityQueueJsonl: pausedPriorityQueueJsonlPath,
        },
        importQuality: report.importQuality,
        priorityCounts,
        activeCounts,
        pausedCounts,
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
