import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.join(repoRoot, "output");
const activeDir = path.join(repoRoot, "docs/exec-plans/active/week2_5");
const historyDir = path.join(repoRoot, "docs/exec-plans/history/week2_5");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const REQUIRED_FIELDS = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];
const FIELD_LABELS = {
  ingredient: "ingredient",
  dosage: "dosage",
  suggested_use: "suggested use",
  warnings: "warnings",
  product_image: "product image",
};

const DEFAULT_MERGE_REPORT_PATH = path.join(
  repoRoot,
  "output/iherb_overlay_bulk_merge_week2_final_unified_20260313/overlay_merge_coverage_report.json",
);
const DEFAULT_HIGH_FREQUENCY_REPORT_PATH = path.join(
  repoRoot,
  "output/iherb_overlay_high_frequency_validation_full_p0p1_final/high_frequency_hit_validation.json",
);
const DEFAULT_HIGH_FREQUENCY_DETAILS_PATH = path.join(
  repoRoot,
  "output/iherb_overlay_high_frequency_validation_full_p0p1_final/high_frequency_hit_details.json",
);

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const writeText = (filePath, value) => fs.writeFileSync(filePath, `${value.replace(/\s+$/, "")}\n`, "utf8");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const readText = (filePath) => fs.readFileSync(filePath, "utf8");

const copyToCanonical = (filePath) => {
  const baseName = path.basename(filePath);
  fs.copyFileSync(filePath, path.join(activeDir, baseName));
  fs.copyFileSync(filePath, path.join(historyDir, `${timestamp}_${baseName}`));
};

const pct = (value, total) => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
};

const parseArgs = (argv) => {
  const parsed = {
    mergeReportPath: DEFAULT_MERGE_REPORT_PATH,
    highFrequencyReportPath: DEFAULT_HIGH_FREQUENCY_REPORT_PATH,
    highFrequencyDetailsPath: DEFAULT_HIGH_FREQUENCY_DETAILS_PATH,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--merge-report=")) {
      parsed.mergeReportPath = path.resolve(repoRoot, arg.slice("--merge-report=".length));
      continue;
    }
    if (arg.startsWith("--high-frequency-report=")) {
      parsed.highFrequencyReportPath = path.resolve(repoRoot, arg.slice("--high-frequency-report=".length));
      continue;
    }
    if (arg.startsWith("--high-frequency-details=")) {
      parsed.highFrequencyDetailsPath = path.resolve(repoRoot, arg.slice("--high-frequency-details=".length));
    }
  }

  return parsed;
};

const buildImportQualitySummary = (mergeReport) => {
  const rows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];
  const summary = mergeReport?.summary ?? {};
  const fieldStats = Object.fromEntries(
    REQUIRED_FIELDS.map((field) => [
      field,
      {
        field,
        label: FIELD_LABELS[field],
        resolvedCount: 0,
        missingCount: 0,
        resolvedRatePct: 0,
        missingRatePct: 0,
        fullyReadyCount: 0,
        partialResolvedCount: 0,
      },
    ]),
  );
  const statusCounts = {};
  const sourceConfidence = {
    authoritativeDsldBacked: 0,
    productPageBacked: 0,
    overlayOnlyOrUnclassified: 0,
  };

  for (const row of rows) {
    const status = typeof row?.status === "string" ? row.status : "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const resolvedFields = new Set(Array.isArray(row?.overlayResolvedFields) ? row.overlayResolvedFields : []);
    const missingFields = new Set(Array.isArray(row?.stillMissingFields) ? row.stillMissingFields : []);

    if (row?.authoritativeSourceType === "dsld") {
      sourceConfidence.authoritativeDsldBacked += 1;
    } else if (row?.authoritativeSourceType === "product_page" || row?.highConfidenceUsProductPageReady === true) {
      sourceConfidence.productPageBacked += 1;
    } else {
      sourceConfidence.overlayOnlyOrUnclassified += 1;
    }

    for (const field of REQUIRED_FIELDS) {
      if (resolvedFields.has(field)) fieldStats[field].resolvedCount += 1;
      if (missingFields.has(field)) fieldStats[field].missingCount += 1;
      if (status === "full_overlay_ready" && resolvedFields.has(field) && !missingFields.has(field)) {
        fieldStats[field].fullyReadyCount += 1;
      }
      if (status === "partial_overlay" && resolvedFields.has(field)) {
        fieldStats[field].partialResolvedCount += 1;
      }
    }
  }

  for (const field of REQUIRED_FIELDS) {
    fieldStats[field].resolvedRatePct = pct(fieldStats[field].resolvedCount, rows.length);
    fieldStats[field].missingRatePct = pct(fieldStats[field].missingCount, rows.length);
  }

  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      mergeReportGeneratedAt: mergeReport?.generatedAt ?? null,
      totalRows: rows.length,
    },
    mergeSummary: {
      total: summary?.total ?? rows.length,
      eligible: summary?.eligible ?? null,
      strictMergeReady: summary?.strictMergeReady ?? null,
      matched: summary?.matched ?? null,
      queued: summary?.queued ?? null,
      blocked: summary?.blocked ?? null,
    },
    fieldStats: REQUIRED_FIELDS.map((field) => fieldStats[field]),
    statusCounts,
    sourceConfidence,
  };
};

const buildHighFrequencySummary = (highFrequencyReport, highFrequencyDetails) => {
  const summary = highFrequencyReport?.summary ?? {};
  const brandRollup = Array.isArray(highFrequencyReport?.brandRollup) ? highFrequencyReport.brandRollup : [];
  const details = Array.isArray(highFrequencyDetails) ? highFrequencyDetails : [];

  const topGapBrands = [...brandRollup]
    .sort((left, right) => {
      const leftMissing = Number(left?.missing_from_staging ?? 0);
      const rightMissing = Number(right?.missing_from_staging ?? 0);
      if (rightMissing !== leftMissing) return rightMissing - leftMissing;
      return String(left?.brandName ?? "").localeCompare(String(right?.brandName ?? ""));
    })
    .slice(0, 10)
    .map((row) => ({
      brandName: row.brandName,
      total: row.total,
      completeHit: row.complete_hit,
      missingFromStaging: row.missing_from_staging,
      activeQueue: row.active_queue,
    }));

  const completeHitSample = details
    .filter((row) => row?.validationOutcome === "complete_hit")
    .slice(0, 12)
    .map((row) => ({
      brandName: row.brandName,
      productName: row.productName,
      barcodeGtin14: row.barcode_gtin14,
      status: row.status,
      stillMissingFields: row.stillMissingFields ?? [],
    }));

  const missingSample = details
    .filter((row) => row?.validationOutcome === "missing_from_staging")
    .slice(0, 12)
    .map((row) => ({
      brandName: row.brandName,
      productName: row.productName,
      barcodeGtin14: row.barcode_gtin14,
      recommendedAction: row.recommendedAction ?? null,
      stillMissingFields: row.stillMissingFields ?? [],
    }));

  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      reportGeneratedAt: highFrequencyReport?.generatedAt ?? null,
      uniqueCandidates: summary?.uniqueCandidates ?? null,
    },
    coreOutcome: {
      uniqueCandidates: summary?.uniqueCandidates ?? null,
      completeHitCount: summary?.completeHitCount ?? null,
      completeHitRatePct: summary?.completeHitRate ?? null,
      anyRecordHitCount: summary?.anyRecordHitCount ?? null,
      anyRecordHitRatePct: summary?.anyRecordHitRate ?? null,
      missingFromStagingCount: summary?.missingFromStagingCount ?? null,
      activeQueueCount: summary?.activeQueueCount ?? null,
    },
    topGapBrands,
    completeHitSample,
    missingSample,
  };
};

const buildCodeAudit = () => {
  const serverSource = readText(path.join(repoRoot, "backend/src/server.ts"));
  const factsSource = readText(path.join(repoRoot, "backend/src/mySupplementFacts.ts"));
  const savedContextSource = readText(path.join(repoRoot, "contexts/SavedSupplementsContext.tsx"));
  const mySupplementSource = readText(path.join(repoRoot, "components/screens/MySupplement.tsx"));

  return {
    generatedAt: new Date().toISOString(),
    gates: [
      {
        id: "overlay_image_transport",
        pass:
          /\.select\(\s*"product_id,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,description_sections,updated_at"/.test(
            serverSource,
          ) && /imageUrl: readOverlayImageUrl\(row\),/.test(serverSource),
        description: "backend overlay transport includes iHerb image fields for ensure-overview",
      },
      {
        id: "overlay_warning_consumption",
        pass:
          /const overlayWarningsText = normalizeWarningLine\(params\.overlayClaims\?\.warnings \?\? null\);/.test(
            factsSource,
          ) && /warningsText: overlayWarningsText,/.test(factsSource),
        description: "overlay warnings are consumed into MySupplement facts payload",
      },
      {
        id: "saved_image_persistence",
        pass:
          /imageUrl: supplement\?\.image_url \?\? null,/.test(savedContextSource) &&
          /if \(!local\.imageUrl && remote\.imageUrl\) updates\.imageUrl = remote\.imageUrl;/.test(savedContextSource),
        description: "Saved context persists remote image_url into the local model",
      },
      {
        id: "my_saved_image_surface",
        pass:
          /const cardImageUrl = item\.imageUrl\?\.trim\(\) \? item\.imageUrl\.trim\(\) : null;/.test(
            mySupplementSource,
          ) &&
          /const detailImageUrl = pickFirstText\(item\.imageUrl, facts\?\.overlay\?\.imageUrl\);/.test(
            mySupplementSource,
          ),
        description: "My Saved card/detail surfaces can render product image when available",
      },
      {
        id: "daily_dose_simple_daily_parse",
        pass:
          /\(\?:daily\|per day\|a day\|every day\|each day\)/.test(factsSource) &&
          /twice\\s\+\(\?:a\\s\+day\|per\\s\+day\)/.test(factsSource),
        description: "daily dose parser covers simple daily and twice-a-day wording",
      },
    ],
  };
};

const renderImportQualityMarkdown = (report) => {
  const lines = [
    "# Week 2 Import Quality Validation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Merge Summary",
    `- total: ${report.mergeSummary.total ?? 0}`,
    `- eligible: ${report.mergeSummary.eligible ?? 0}`,
    `- strict_merge_ready: ${report.mergeSummary.strictMergeReady ?? 0}`,
    `- matched: ${report.mergeSummary.matched ?? 0}`,
    `- queued: ${report.mergeSummary.queued ?? 0}`,
    `- blocked: ${report.mergeSummary.blocked ?? 0}`,
    "",
    "## Required Field Coverage",
  ];

  for (const field of report.fieldStats) {
    lines.push(`- ${field.label}: resolved=${field.resolvedCount} (${field.resolvedRatePct}%), missing=${field.missingCount} (${field.missingRatePct}%), full_ready=${field.fullyReadyCount}, partial_resolved=${field.partialResolvedCount}`);
  }

  lines.push(
    "",
    "## Source Confidence",
    `- authoritative_dsld_backed: ${report.sourceConfidence.authoritativeDsldBacked}`,
    `- product_page_backed: ${report.sourceConfidence.productPageBacked}`,
    `- overlay_only_or_unclassified: ${report.sourceConfidence.overlayOnlyOrUnclassified}`,
    "",
    "## Status Counts",
  );

  for (const [status, count] of Object.entries(report.statusCounts)) {
    lines.push(`- ${status}: ${count}`);
  }

  return lines.join("\n");
};

const renderHighFrequencyMarkdown = (report) => {
  const lines = [
    "# Week 2 High-Frequency Product-Surface Validation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Core Outcome",
    `- unique_candidates: ${report.coreOutcome.uniqueCandidates ?? 0}`,
    `- complete_hit_count: ${report.coreOutcome.completeHitCount ?? 0}`,
    `- complete_hit_rate: ${report.coreOutcome.completeHitRatePct ?? 0}%`,
    `- any_record_hit_count: ${report.coreOutcome.anyRecordHitCount ?? 0}`,
    `- any_record_hit_rate: ${report.coreOutcome.anyRecordHitRatePct ?? 0}%`,
    `- missing_from_staging_count: ${report.coreOutcome.missingFromStagingCount ?? 0}`,
    `- active_queue_count: ${report.coreOutcome.activeQueueCount ?? 0}`,
    "",
    "## Top Gap Brands",
  ];

  for (const row of report.topGapBrands) {
    lines.push(
      `- ${row.brandName}: total=${row.total}, complete_hit=${row.completeHit}, missing_from_staging=${row.missingFromStaging}, active_queue=${row.activeQueue}`,
    );
  }

  lines.push("", "## Complete Hit Sample");
  for (const row of report.completeHitSample) {
    lines.push(`- ${row.brandName} | ${row.productName} | ${row.barcodeGtin14} | status=${row.status}`);
  }

  lines.push("", "## Missing Sample");
  for (const row of report.missingSample) {
    lines.push(`- ${row.brandName} | ${row.productName} | ${row.barcodeGtin14} | action=${row.recommendedAction ?? "n/a"}`);
  }

  return lines.join("\n");
};

const renderClosureSummaryMarkdown = ({ importQuality, highFrequency, codeAudit }) => {
  const passedGates = codeAudit.gates.filter((gate) => gate.pass).length;
  const lines = [
    "# Week 2 Product-Surface Closure Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Why This Exists",
    "- Week 2 data already exists at overlay/staging scale, but the closure target is product-surface completeness rather than raw ingestion volume.",
    "- This summary combines field-level import quality, high-frequency hit validation, and non-scan code-surface readiness checks.",
    "",
    "## Import Quality Snapshot",
    `- strict_merge_ready: ${importQuality.mergeSummary.strictMergeReady ?? 0}`,
    `- queued: ${importQuality.mergeSummary.queued ?? 0}`,
    `- blocked: ${importQuality.mergeSummary.blocked ?? 0}`,
    "",
    "## High-Frequency Snapshot",
    `- complete_hit_rate: ${highFrequency.coreOutcome.completeHitRatePct ?? 0}%`,
    `- any_record_hit_rate: ${highFrequency.coreOutcome.anyRecordHitRatePct ?? 0}%`,
    `- missing_from_staging_count: ${highFrequency.coreOutcome.missingFromStagingCount ?? 0}`,
    "",
    "## Code Gates",
    `- passed_gates: ${passedGates}/${codeAudit.gates.length}`,
  ];

  for (const gate of codeAudit.gates) {
    lines.push(`- ${gate.id}: ${gate.pass ? "pass" : "fail"} (${gate.description})`);
  }

  lines.push(
    "",
    "## Final Call",
    passedGates === codeAudit.gates.length
      ? "- Product-surface hardening gates are present in code. Re-run the week3 safety harness and targeted app QA to close the remaining Saved-stack validation loop."
      : "- Product-surface hardening is still incomplete in code. Fix the failing gates before treating Week 2 consumption as closed."
  );

  return lines.join("\n");
};

const main = () => {
  ensureDir(outputDir);
  ensureDir(activeDir);
  ensureDir(historyDir);

  const args = parseArgs(process.argv);
  const importQuality = buildImportQualitySummary(readJson(args.mergeReportPath));
  const highFrequency = buildHighFrequencySummary(
    readJson(args.highFrequencyReportPath),
    readJson(args.highFrequencyDetailsPath),
  );
  const codeAudit = buildCodeAudit();

  const artifacts = [
    {
      jsonPath: path.join(outputDir, "week2_import_quality_validation.json"),
      mdPath: path.join(outputDir, "week2_import_quality_validation.md"),
      jsonValue: importQuality,
      mdValue: renderImportQualityMarkdown(importQuality),
    },
    {
      jsonPath: path.join(outputDir, "week2_high_frequency_product_surface_validation.json"),
      mdPath: path.join(outputDir, "week2_high_frequency_product_surface_validation.md"),
      jsonValue: highFrequency,
      mdValue: renderHighFrequencyMarkdown(highFrequency),
    },
    {
      jsonPath: path.join(outputDir, "week2_product_surface_code_audit.json"),
      mdPath: path.join(outputDir, "week2_product_surface_closure_summary.md"),
      jsonValue: codeAudit,
      mdValue: renderClosureSummaryMarkdown({ importQuality, highFrequency, codeAudit }),
    },
  ];

  for (const artifact of artifacts) {
    writeJson(artifact.jsonPath, artifact.jsonValue);
    writeText(artifact.mdPath, artifact.mdValue);
    copyToCanonical(artifact.jsonPath);
    copyToCanonical(artifact.mdPath);
  }
};

main();
