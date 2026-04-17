#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const normalizeBarcode = (value) => {
  const digits = normalizeText(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const percent = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0);

const envCandidates = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "backend/.env"),
  path.join(path.dirname(ROOT), ".env"),
];
for (const candidate of envCandidates) dotenv.config({ path: candidate, override: false });

const BUNDLE_PATH = resolvePath(
  getArg(
    "bundle-json",
    path.join(ROOT, "output", "current_roi_sr_now_gol_zero_push", "full_validation", "goal_navigator_candidate_bundle.json"),
  ),
);
const HIGH_FREQUENCY_DETAILS_PATH = resolvePath(
  getArg(
    "high-frequency-details-json",
    path.join(
      ROOT,
      "output",
      "current_roi_sr_now_gol_zero_push",
      "full_validation",
      "high_frequency_validation",
      "high_frequency_hit_details.json",
    ),
  ),
);
const MERGE_REPORT_PATH = resolvePath(
  getArg(
    "merge-report-json",
    path.join(
      ROOT,
      "output",
      "current_roi_sr_now_gol_zero_push",
      "full_validation",
      "merge_report",
      "overlay_merge_coverage_report.json",
    ),
  ),
);
const OUT_DIR = resolvePath(getArg("out-dir", path.join(ROOT, "output", "iherb_hit_ready_closure_audit")));
const SUPABASE_URL = getArg("supabase-url") || process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = getArg("service-role-key") || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const EXPECT_HOST = getArg("expect-host", "dlwlobgmjzcmpirwvetq.supabase.co");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[build-iherb-hit-ready-closure-audit] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (EXPECT_HOST && !String(SUPABASE_URL).includes(EXPECT_HOST)) {
  console.error(
    `[build-iherb-hit-ready-closure-audit] refusing to run against unexpected Supabase host: ${SUPABASE_URL}`,
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const fetchAllLatestAuditRows = async (trackedProductIds) => {
  const pageSize = 5000;
  const latestByProductId = new Map();
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("iherb_overlay_merge_audit")
      .select("product_id,barcode_gtin14,authoritative_source_type,authoritative_identity_key,match_status,reason_code,created_at")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read iherb_overlay_merge_audit: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const productId = normalizeText(row?.product_id);
      if (!productId || !trackedProductIds.has(productId) || latestByProductId.has(productId)) continue;
      latestByProductId.set(productId, {
        productId,
        barcode: normalizeBarcode(row?.barcode_gtin14),
        authoritativeSourceType: normalizeText(row?.authoritative_source_type) || null,
        authoritativeIdentityKey: normalizeText(row?.authoritative_identity_key) || null,
        matchStatus: normalizeText(row?.match_status) || null,
        reasonCode: normalizeText(row?.reason_code) || null,
        createdAt: normalizeText(row?.created_at) || null,
      });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return latestByProductId;
};

const classifyClosure = ({ product, mergeRow, highFrequencyDetail }) => {
  const barcode = normalizeBarcode(product?.barcode);
  if (!barcode) return "missing_barcode";
  if (!mergeRow) return "missing_merge_report_row";

  const mergeDecision = normalizeLower(mergeRow.mergeDecision);
  const reasonCode = normalizeLower(mergeRow.reasonCode);
  const blockReasonCode = normalizeLower(mergeRow.blockReasonCode);

  if (["matched", "merged"].includes(mergeDecision)) {
    if (!normalizeText(mergeRow.authoritativeIdentityKey)) return "missing_authoritative_identity";
    if (!normalizeText(mergeRow.authoritativeSourceType)) return "missing_authoritative_source_type";

    if (highFrequencyDetail && normalizeLower(highFrequencyDetail.validationOutcome) !== "complete_hit") {
      return "authoritative_mapped_but_high_frequency_not_closed";
    }

    return "hit_ready";
  }

  if (mergeDecision === "queued") {
    if (reasonCode === "authoritative_match_required") return "authoritative_match_required";
    if (reasonCode === "partial_overlay_requires_api_fill") return "partial_overlay_requires_api_fill";
    return `queued_${reasonCode || "unknown"}`;
  }

  if (mergeDecision === "blocked") {
    return `blocked_${blockReasonCode || "unknown"}`;
  }

  return `unexpected_${mergeDecision || "unknown"}`;
};

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Hit-Ready Closure Audit",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- bundlePath: ${report.inputs.bundlePath}`,
    `- highFrequencyDetailsPath: ${report.inputs.highFrequencyDetailsPath}`,
    `- supabaseUrl: ${report.inputs.supabaseUrl}`,
    `- mergeReportPath: ${report.inputs.mergeReportPath}`,
    "",
    "## Core Counts",
    "",
    `- overlay_products_live: ${report.summary.overlayProductsLive}`,
    `- active_prepared_candidates: ${report.summary.activePreparedCandidates}`,
    `- active_full_support_candidates: ${report.summary.activeFullSupportCandidates}`,
    `- hit_ready_count: ${report.summary.hitReadyCount}`,
    `- hit_ready_rate_within_full_support: ${report.summary.hitReadyRateWithinFullSupport}%`,
    `- unresolved_full_support_count: ${report.summary.unresolvedFullSupportCount}`,
    `- hit_ready_with_persisted_audit_count: ${report.summary.hitReadyWithPersistedAuditCount}`,
    `- hit_ready_missing_persisted_audit_count: ${report.summary.hitReadyMissingPersistedAuditCount}`,
    "",
    "## High-Frequency Overlay",
    "",
    `- high_frequency_rows_in_full_support: ${report.summary.highFrequencyRowsInFullSupport}`,
    `- high_frequency_complete_hit: ${report.summary.highFrequencyCompleteHit}`,
    `- high_frequency_not_complete: ${report.summary.highFrequencyNotComplete}`,
    "",
    "## Closure Buckets",
    "",
  ];

  for (const bucket of report.bucketRollup) {
    lines.push(`- ${bucket.bucket}: ${bucket.count}`);
  }

  if (report.topUnresolvedBrands.length > 0) {
    lines.push("", "## Top Unresolved Brands", "");
    for (const brand of report.topUnresolvedBrands.slice(0, 25)) {
      lines.push(`- ${brand.brandName}: unresolved=${brand.unresolvedCount}, high_frequency=${brand.highFrequencyCount}`);
    }
  }

  if (report.queuePreview.length > 0) {
    lines.push("", "## Queue Preview", "");
    for (const row of report.queuePreview) {
      lines.push(
        `- ${row.brandName} | ${row.title} | ${row.barcode || "n/a"} | ${row.closureBucket} | audit=${row.authoritativeSourceType || "none"} | hf=${row.highFrequencyOutcome || "n/a"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await ensureDir(OUT_DIR);

  const [bundle, highFrequencyDetails, mergeReport] = await Promise.all([
    readJson(BUNDLE_PATH),
    readJson(HIGH_FREQUENCY_DETAILS_PATH).catch(() => []),
    readJson(MERGE_REPORT_PATH),
  ]);

  const preparedCandidates = Array.isArray(bundle?.preparedCandidates) ? bundle.preparedCandidates : [];
  const preparedProducts = preparedCandidates
    .map((entry) => entry?.preparedProduct ?? null)
    .filter(Boolean);
  const fullSupportProducts = preparedProducts.filter((product) => normalizeLower(product?.factsStatus) === "full");
  const trackedProductIds = new Set(fullSupportProducts.map((product) => normalizeText(product?.productId)).filter(Boolean));
  const latestAuditByProductId = await fetchAllLatestAuditRows(trackedProductIds);
  const mergeRows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];
  const mergeByProductId = new Map(mergeRows.map((row) => [normalizeText(row?.productId), row]));

  const highFrequencyByBarcode = new Map();
  for (const row of Array.isArray(highFrequencyDetails) ? highFrequencyDetails : []) {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    if (!barcode) continue;
    if (!highFrequencyByBarcode.has(barcode)) highFrequencyByBarcode.set(barcode, row);
  }

  const overlayProductsLive = Number(bundle?.sourceRowCount ?? 0);
  const bucketCounts = new Map();
  const unresolvedBrandCounts = new Map();
  const unresolvedHighFrequencyBrandCounts = new Map();

  const rows = fullSupportProducts.map((product) => {
    const productId = normalizeText(product?.productId);
    const barcode = normalizeBarcode(product?.barcode);
    const brandName = normalizeText(product?.brandName) || "Unknown";
    const latestAudit = latestAuditByProductId.get(productId) ?? null;
    const mergeRow = mergeByProductId.get(productId) ?? null;
    const highFrequencyDetail = highFrequencyByBarcode.get(barcode) ?? null;
    const closureBucket = classifyClosure({ product, mergeRow, highFrequencyDetail });

    bucketCounts.set(closureBucket, (bucketCounts.get(closureBucket) || 0) + 1);

    if (closureBucket !== "hit_ready") {
      unresolvedBrandCounts.set(brandName, (unresolvedBrandCounts.get(brandName) || 0) + 1);
      if (highFrequencyDetail) {
        unresolvedHighFrequencyBrandCounts.set(
          brandName,
          (unresolvedHighFrequencyBrandCounts.get(brandName) || 0) + 1,
        );
      }
    }

    return {
      productId,
      sourceProductId: normalizeText(product?.sourceProductId) || null,
      brandName,
      title: normalizeText(product?.title) || null,
      barcode: barcode || null,
      factsStatus: normalizeText(product?.factsStatus) || null,
      closureBucket,
      authoritativeSourceType: normalizeText(mergeRow?.authoritativeSourceType) || null,
      authoritativeIdentityKey: normalizeText(mergeRow?.authoritativeIdentityKey) || null,
      mergeDecision: normalizeText(mergeRow?.mergeDecision) || null,
      mergeReasonCode: normalizeText(mergeRow?.reasonCode) || null,
      mergeBlockReasonCode: normalizeText(mergeRow?.blockReasonCode) || null,
      latestAuditCreatedAt: latestAudit?.createdAt ?? null,
      auditPersisted: Boolean(latestAudit?.authoritativeIdentityKey),
      highFrequencyOutcome: highFrequencyDetail?.validationOutcome ?? null,
      highFrequencyCandidateId: highFrequencyDetail?.candidateId ?? null,
    };
  });

  const unresolvedRows = rows.filter((row) => row.closureBucket !== "hit_ready");
  unresolvedRows.sort((left, right) => {
    const leftHighFrequency = left.highFrequencyOutcome ? 1 : 0;
    const rightHighFrequency = right.highFrequencyOutcome ? 1 : 0;
    if (rightHighFrequency !== leftHighFrequency) return rightHighFrequency - leftHighFrequency;
    const leftBrandCount = unresolvedBrandCounts.get(left.brandName) || 0;
    const rightBrandCount = unresolvedBrandCounts.get(right.brandName) || 0;
    if (rightBrandCount !== leftBrandCount) return rightBrandCount - leftBrandCount;
    return String(left.title ?? "").localeCompare(String(right.title ?? ""));
  });

  const bucketRollup = [...bucketCounts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.bucket.localeCompare(right.bucket);
    });

  const topUnresolvedBrands = [...unresolvedBrandCounts.entries()]
    .map(([brandName, unresolvedCount]) => ({
      brandName,
      unresolvedCount,
      highFrequencyCount: unresolvedHighFrequencyBrandCounts.get(brandName) || 0,
    }))
    .sort((left, right) => {
      if (right.highFrequencyCount !== left.highFrequencyCount) return right.highFrequencyCount - left.highFrequencyCount;
      if (right.unresolvedCount !== left.unresolvedCount) return right.unresolvedCount - left.unresolvedCount;
      return left.brandName.localeCompare(right.brandName);
    });

  const highFrequencyRowsInFullSupport = rows.filter((row) => row.highFrequencyOutcome).length;
  const highFrequencyCompleteHit = rows.filter((row) => row.highFrequencyOutcome === "complete_hit").length;
  const highFrequencyNotComplete = rows.filter(
    (row) => row.highFrequencyOutcome && row.highFrequencyOutcome !== "complete_hit",
  ).length;
  const hitReadyRows = rows.filter((row) => row.closureBucket === "hit_ready");
  const hitReadyWithPersistedAuditCount = hitReadyRows.filter((row) => row.auditPersisted).length;
  const hitReadyMissingPersistedAuditCount = hitReadyRows.filter((row) => !row.auditPersisted).length;

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      bundlePath: BUNDLE_PATH,
      highFrequencyDetailsPath: HIGH_FREQUENCY_DETAILS_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
      supabaseUrl: SUPABASE_URL,
    },
    summary: {
      overlayProductsLive,
      activePreparedCandidates: preparedProducts.length,
      activeFullSupportCandidates: fullSupportProducts.length,
      hitReadyCount: bucketCounts.get("hit_ready") || 0,
      hitReadyRateWithinFullSupport: percent(bucketCounts.get("hit_ready") || 0, fullSupportProducts.length),
      unresolvedFullSupportCount: unresolvedRows.length,
      hitReadyWithPersistedAuditCount,
      hitReadyMissingPersistedAuditCount,
      highFrequencyRowsInFullSupport,
      highFrequencyCompleteHit,
      highFrequencyNotComplete,
    },
    bucketRollup,
    topUnresolvedBrands,
    queuePreview: unresolvedRows.slice(0, 50),
  };

  await writeJson(path.join(OUT_DIR, "hit_ready_closure_audit.json"), report);
  await writeJson(path.join(OUT_DIR, "hit_ready_closure_audit_queue.json"), unresolvedRows);
  await writeText(path.join(OUT_DIR, "hit_ready_closure_audit.md"), toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        fullSupport: fullSupportProducts.length,
        hitReady: report.summary.hitReadyCount,
        unresolved: unresolvedRows.length,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-iherb-hit-ready-closure-audit] failed", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
