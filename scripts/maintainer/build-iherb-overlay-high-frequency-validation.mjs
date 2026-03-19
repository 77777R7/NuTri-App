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
const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "pure_p0_official_fallback_final", "staging_products.official_refreshed.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_bulk_merge_pure_p0_official_fallback_final",
    "overlay_merge_coverage_report.json",
  ),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "iherb_overlay_execution_plan", "api_fill_priority_queue.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_overlay_high_frequency_validation"));
const BRAND_FILTER = getArg("brand", null);
const LABEL = getArg("label", "full");

const ACTIVE_PRIORITY_PREFIXES = ["P0_", "P1_"];
const OUTCOME_ORDER = {
  complete_hit: 0,
  active_queue: 1,
  paused_queue: 2,
  staging_present_not_complete: 3,
  missing_from_staging: 4,
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const normalizeBarcode = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};
const toPercent = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);
const isActivePriorityLane = (lane) => ACTIVE_PRIORITY_PREFIXES.some((prefix) => String(lane).startsWith(prefix));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const readJsonl = async (filePath) =>
  (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const pickPreferredCandidate = (current, candidate) => {
  if (!current) return candidate;
  const currentScore = Number(current.patchPriorityScore ?? 0);
  const candidateScore = Number(candidate.patchPriorityScore ?? 0);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  const currentConfidence = Number(current.confidence ?? 0);
  const candidateConfidence = Number(candidate.confidence ?? 0);
  if (candidateConfidence !== currentConfidence) return candidateConfidence > currentConfidence ? candidate : current;
  return current;
};

const buildIndex = (rows, getKey, prefer = (current) => current) => {
  const map = new Map();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, row);
      continue;
    }
    map.set(key, prefer(map.get(key), row));
  }
  return map;
};

const sortCountsDesc = (value) =>
  Object.entries(value).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });

const toMarkdown = (report) => {
  const lines = [
    "# iHerb High-Frequency Hit Validation",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- label: ${report.inputs.label}`,
    `- sourcePath: ${report.inputs.sourcePath}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- mergeReportPath: ${report.inputs.mergeReportPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- brandFilter: ${report.inputs.brandFilter || "all"}`,
    "",
    "## Core Outcome",
    "",
    `- unique_candidates: ${report.summary.uniqueCandidates}`,
    `- complete_hit_count: ${report.summary.completeHitCount}`,
    `- complete_hit_rate: ${report.summary.completeHitRate}%`,
    `- any_record_hit_count: ${report.summary.anyRecordHitCount}`,
    `- any_record_hit_rate: ${report.summary.anyRecordHitRate}%`,
    "",
    "## Queue Pressure",
    "",
    `- active_queue_count: ${report.summary.activeQueueCount}`,
    `- paused_queue_count: ${report.summary.pausedQueueCount}`,
    `- staging_present_not_complete_count: ${report.summary.stagingPresentNotCompleteCount}`,
    `- missing_from_staging_count: ${report.summary.missingFromStagingCount}`,
    "",
    "## Outcome Counts",
    "",
  ];

  for (const [outcome, count] of sortCountsDesc(report.summary.outcomeCounts)) {
    lines.push(`- ${outcome}: ${count}`);
  }

  if (report.summary.activeLaneCounts.length > 0) {
    lines.push("", "## Active Lane Counts", "");
    for (const [lane, count] of report.summary.activeLaneCounts) {
      lines.push(`- ${lane}: ${count}`);
    }
  }

  if (report.brandRollup.length > 0) {
    lines.push("", "## Top Gap Brands", "");
    for (const brand of report.brandRollup.slice(0, 20)) {
      lines.push(
        `- ${brand.brandName}: total=${brand.total}, complete=${brand.complete_hit}, active=${brand.active_queue}, paused=${brand.paused_queue}, missing=${brand.missing_from_staging}`,
      );
    }
  }

  if (report.detailsSample.length > 0) {
    lines.push("", "## Detail Sample", "");
    for (const row of report.detailsSample) {
      lines.push(
        `- ${row.validationOutcome} | ${row.brandName} | ${row.productName} | ${row.barcode_gtin14 || "n/a"} | lane=${row.priorityLane || "n/a"} | missing=${row.stillMissingFields.join(", ") || "none"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [sourceRows, stagingJson, mergeReport, queueRows] = await Promise.all([
    readJsonl(SOURCE_PATH),
    readJson(STAGING_PATH),
    readJson(MERGE_REPORT_PATH),
    readJson(QUEUE_PATH),
  ]);

  const sourceMap = new Map();
  for (const row of sourceRows) {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    const key = barcode || normalizeText(row?.candidateId);
    if (!key) continue;
    const brandName = row?.brandName ?? row?.seedBrand;
    if (BRAND_FILTER && normalizeLower(brandName) !== normalizeLower(BRAND_FILTER)) continue;
    sourceMap.set(key, pickPreferredCandidate(sourceMap.get(key), row));
  }
  const uniqueSourceRows = [...sourceMap.values()];

  const stagingRows = Array.isArray(stagingJson?.products) ? stagingJson.products : [];
  const mergeRows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];
  const filteredStagingRows = stagingRows.filter((row) =>
    BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true,
  );
  const filteredMergeRows = mergeRows.filter((row) =>
    BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true,
  );
  const filteredQueueRows = (Array.isArray(queueRows) ? queueRows : []).filter((row) =>
    BRAND_FILTER ? normalizeLower(row?.brandName) === normalizeLower(BRAND_FILTER) : true,
  );

  const stagingByBarcode = buildIndex(filteredStagingRows, (row) => normalizeBarcode(row?.barcode_gtin14));
  const mergeByBarcode = buildIndex(filteredMergeRows, (row) => normalizeBarcode(row?.barcodeGtin14));
  const queueByBarcode = buildIndex(filteredQueueRows, (row) => normalizeBarcode(row?.barcode_gtin14));

  const details = uniqueSourceRows
    .map((candidate) => {
      const barcode = normalizeBarcode(candidate?.barcode_gtin14);
      const stagingRow = stagingByBarcode.get(barcode) ?? null;
      const mergeRow = mergeByBarcode.get(barcode) ?? null;
      const queueRow = queueByBarcode.get(barcode) ?? null;
      const stillMissingFields = Array.isArray(mergeRow?.stillMissingFields)
        ? mergeRow.stillMissingFields
        : Array.isArray(stagingRow?.completeness?.coreMissingFields)
          ? stagingRow.completeness.coreMissingFields
          : [];
      const mergeDecision = normalizeText(mergeRow?.mergeDecision);
      const hasAnyRecordHit = Boolean(stagingRow || mergeRow || queueRow);

      let validationOutcome = "missing_from_staging";
      if ((mergeDecision === "matched" || mergeDecision === "merged") && stillMissingFields.length === 0) {
        validationOutcome = "complete_hit";
      } else if (queueRow && isActivePriorityLane(queueRow.priorityLane)) {
        validationOutcome = "active_queue";
      } else if (queueRow) {
        validationOutcome = "paused_queue";
      } else if (stagingRow || mergeRow) {
        validationOutcome = "staging_present_not_complete";
      }

      return {
        candidateId: candidate?.candidateId ?? null,
        barcode_gtin14: barcode || null,
        brandName: normalizeText(candidate?.brandName ?? candidate?.seedBrand ?? stagingRow?.brandName ?? mergeRow?.brandName),
        productName: normalizeText(candidate?.productName ?? stagingRow?.title ?? mergeRow?.title),
        patchPriorityScore: Number(candidate?.patchPriorityScore ?? 0),
        sourceReasonCode: normalizeText(candidate?.reasonCode),
        validationOutcome,
        hasAnyRecordHit,
        mergeDecision: mergeDecision || null,
        status: normalizeText(mergeRow?.status ?? stagingRow?.completeness?.status) || null,
        priorityLane: queueRow?.priorityLane ?? null,
        recommendedAction: queueRow?.recommendedAction ?? null,
        stillMissingFields,
      };
    })
    .sort((left, right) => {
      const leftOrder = OUTCOME_ORDER[left.validationOutcome] ?? 99;
      const rightOrder = OUTCOME_ORDER[right.validationOutcome] ?? 99;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (right.patchPriorityScore !== left.patchPriorityScore) return right.patchPriorityScore - left.patchPriorityScore;
      return String(left.productName).localeCompare(String(right.productName));
    });

  const outcomeCounts = details.reduce((acc, row) => {
    acc[row.validationOutcome] = (acc[row.validationOutcome] ?? 0) + 1;
    return acc;
  }, {});
  const activeLaneCounts = sortCountsDesc(
    details
      .filter((row) => row.validationOutcome === "active_queue" && row.priorityLane)
      .reduce((acc, row) => {
        acc[row.priorityLane] = (acc[row.priorityLane] ?? 0) + 1;
        return acc;
      }, {}),
  );
  const brandRollup = Object.values(
    details.reduce((acc, row) => {
      const brandName = row.brandName || "Unknown";
      acc[brandName] ??= {
        brandName,
        total: 0,
        complete_hit: 0,
        active_queue: 0,
        paused_queue: 0,
        staging_present_not_complete: 0,
        missing_from_staging: 0,
      };
      acc[brandName].total += 1;
      acc[brandName][row.validationOutcome] += 1;
      return acc;
    }, {}),
  ).sort((left, right) => {
    const leftGap = left.total - left.complete_hit;
    const rightGap = right.total - right.complete_hit;
    if (rightGap !== leftGap) return rightGap - leftGap;
    return left.brandName.localeCompare(right.brandName);
  });

  const report = {
    schemaVersion: "iherb_overlay_high_frequency_validation.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      label: LABEL,
      sourcePath: SOURCE_PATH,
      stagingPath: STAGING_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
      queuePath: QUEUE_PATH,
      brandFilter: BRAND_FILTER,
    },
    summary: {
      uniqueCandidates: details.length,
      completeHitCount: outcomeCounts.complete_hit ?? 0,
      completeHitRate: toPercent(outcomeCounts.complete_hit ?? 0, details.length),
      anyRecordHitCount: details.filter((row) => row.hasAnyRecordHit).length,
      anyRecordHitRate: toPercent(
        details.filter((row) => row.hasAnyRecordHit).length,
        details.length,
      ),
      activeQueueCount: outcomeCounts.active_queue ?? 0,
      pausedQueueCount: outcomeCounts.paused_queue ?? 0,
      stagingPresentNotCompleteCount: outcomeCounts.staging_present_not_complete ?? 0,
      missingFromStagingCount: outcomeCounts.missing_from_staging ?? 0,
      outcomeCounts,
      activeLaneCounts,
    },
    brandRollup,
    detailsSample: details.slice(0, 50),
  };

  const reportJsonPath = path.join(OUT_DIR, "high_frequency_hit_validation.json");
  const reportMdPath = path.join(OUT_DIR, "high_frequency_hit_validation.md");
  const detailsJsonPath = path.join(OUT_DIR, "high_frequency_hit_details.json");
  const detailsJsonlPath = path.join(OUT_DIR, "high_frequency_hit_details.jsonl");

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, toMarkdown(report), "utf8");
  await fs.writeFile(detailsJsonPath, `${JSON.stringify(details, null, 2)}\n`, "utf8");
  await fs.writeFile(
    detailsJsonlPath,
    `${details.map((row) => JSON.stringify(row)).join("\n")}${details.length > 0 ? "\n" : ""}`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          summaryJson: reportJsonPath,
          summaryMd: reportMdPath,
          detailsJson: detailsJsonPath,
          detailsJsonl: detailsJsonlPath,
        },
        summary: report.summary,
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
