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

const DETAILS_JSON = getArg(
  "details-json",
  path.join(
    ROOT,
    "output",
    "current_roi_sr_now_gol_zero_push",
    "full_validation",
    "high_frequency_validation",
    "high_frequency_hit_details.json",
  ),
);
const MERGE_REPORT_JSON = getArg(
  "merge-report-json",
  path.join(
    ROOT,
    "output",
    "current_roi_sr_now_gol_zero_push",
    "full_validation",
    "merge_report",
    "overlay_merge_coverage_report.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "strict_ready_to_complete_hit_roi"),
);
const MIN_TITLE_SCORE = Number(getArg("min-title-score", "0.45"));

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeBrand = (value) => normalizeText(value).toLowerCase();
const normalizeTitle = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTokenSet = (value) => new Set(normalizeTitle(value).split(/\s+/).filter(Boolean));

const titleJaccard = (left, right) => {
  const a = toTokenSet(left);
  const b = toTokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
};

const titleContainsBoost = (left, right) => {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.15;
  return 0;
};

const buildQueuePriorityScore = (patchPriorityScore, titleScore) =>
  Number((Number(patchPriorityScore ?? 0) + titleScore * 100).toFixed(1));

const toMarkdown = ({ summary, rows }) => {
  const lines = [
    "# Strict Ready -> Complete Hit ROI Queue",
    "",
    `- generated_from_details: ${DETAILS_JSON}`,
    `- generated_from_merge_report: ${MERGE_REPORT_JSON}`,
    `- min_title_score: ${MIN_TITLE_SCORE}`,
    "",
    "## Summary",
    "",
    `- total_candidates_reviewed: ${summary.totalCandidatesReviewed}`,
    `- non_complete_candidates: ${summary.nonCompleteCandidates}`,
    `- same_brand_strong_rows: ${summary.sameBrandStrongRows}`,
    `- roi_queue_count: ${summary.roiQueueCount}`,
    "",
    "## Top Brands",
    "",
  ];

  for (const brand of summary.topBrands) {
    lines.push(`- ${brand.brandName}: ${brand.count}`);
  }

  lines.push("", "## Queue Sample", "");
  for (const row of rows.slice(0, 50)) {
    lines.push(
      `- ${row.brandName} | ${row.productName} | score=${row.titleSimilarityScore} | best_match=${row.matchingReadyTitle} | candidate_barcode=${row.barcode_gtin14 || "n/a"} | ready_barcode=${row.matchingReadyBarcode || "n/a"}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [detailsJson, mergeReportJson] = await Promise.all([
    fs.readFile(DETAILS_JSON, "utf8").then(JSON.parse),
    fs.readFile(MERGE_REPORT_JSON, "utf8").then(JSON.parse),
  ]);

  const details = Array.isArray(detailsJson) ? detailsJson : [];
  const mergeRows = Array.isArray(mergeReportJson?.rows) ? mergeReportJson.rows : [];

  const strongRows = mergeRows.filter(
    (row) => row?.status === "full_overlay_ready" || row?.highConfidenceUsProductPageReady === true,
  );
  const strongByBrand = new Map();
  for (const row of strongRows) {
    const key = normalizeBrand(row?.brandName);
    if (!key) continue;
    if (!strongByBrand.has(key)) strongByBrand.set(key, []);
    strongByBrand.get(key).push(row);
  }

  const nonCompleteCandidates = details.filter((row) => row?.validationOutcome !== "complete_hit");
  const queueRows = [];

  for (const candidate of nonCompleteCandidates) {
    const brandKey = normalizeBrand(candidate?.brandName);
    const pool = strongByBrand.get(brandKey) ?? [];
    if (pool.length === 0) continue;

    let bestMatch = null;
    for (const strong of pool) {
      const jaccard = titleJaccard(candidate?.productName, strong?.title);
      const score = Number((jaccard + titleContainsBoost(candidate?.productName, strong?.title)).toFixed(3));
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { score, strong };
      }
    }

    if (!bestMatch || bestMatch.score < MIN_TITLE_SCORE) continue;

    queueRows.push({
      candidateId: candidate?.candidateId ?? null,
      brandName: candidate?.brandName ?? null,
      productName: candidate?.productName ?? null,
      barcode_gtin14: candidate?.barcode_gtin14 ?? null,
      sourceReasonCode: candidate?.sourceReasonCode ?? null,
      patchPriorityScore: Number(candidate?.patchPriorityScore ?? 0),
      validationOutcome: candidate?.validationOutcome ?? null,
      titleSimilarityScore: bestMatch.score,
      queuePriorityScore: buildQueuePriorityScore(candidate?.patchPriorityScore, bestMatch.score),
      matchingReadyProductId: bestMatch.strong?.productId ?? null,
      matchingReadyTitle: bestMatch.strong?.title ?? null,
      matchingReadyBarcode: bestMatch.strong?.barcodeGtin14 ?? null,
      matchingReadySourceType: bestMatch.strong?.authoritativeSourceType ?? null,
      matchingReadyStatus: bestMatch.strong?.status ?? null,
      matchingReadyIdentityKey: bestMatch.strong?.authoritativeIdentityKey ?? null,
      conversionHypothesis: "identity_bridge_to_existing_strict_ready_record",
    });
  }

  queueRows.sort((left, right) => {
    if (right.queuePriorityScore !== left.queuePriorityScore) {
      return right.queuePriorityScore - left.queuePriorityScore;
    }
    return String(left.brandName).localeCompare(String(right.brandName));
  });

  const brandCounts = new Map();
  for (const row of queueRows) {
    brandCounts.set(row.brandName, (brandCounts.get(row.brandName) ?? 0) + 1);
  }

  const summary = {
    totalCandidatesReviewed: details.length,
    nonCompleteCandidates: nonCompleteCandidates.length,
    sameBrandStrongRows: strongRows.length,
    roiQueueCount: queueRows.length,
    topBrands: [...brandCounts.entries()]
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((left, right) => right.count - left.count || left.brandName.localeCompare(right.brandName))
      .slice(0, 25),
  };

  const summaryPath = path.join(OUT_DIR, "strict_ready_to_complete_hit_roi_summary.json");
  const queuePath = path.join(OUT_DIR, "strict_ready_to_complete_hit_roi_queue.json");
  const mdPath = path.join(OUT_DIR, "strict_ready_to_complete_hit_roi_queue.md");

  await Promise.all([
    fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
    fs.writeFile(queuePath, `${JSON.stringify(queueRows, null, 2)}\n`, "utf8"),
    fs.writeFile(mdPath, toMarkdown({ summary, rows: queueRows }), "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          summaryJson: summaryPath,
          queueJson: queuePath,
          summaryMd: mdPath,
        },
        summary,
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
