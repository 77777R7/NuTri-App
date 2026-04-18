#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

import { createClient } from "@supabase/supabase-js";
import { qualifiesHighConfidenceUsProductPage, resolveCurrentCompleteness } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
dotenv.config();
dotenv.config({ path: path.join(ROOT, "backend", ".env") });

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const INPUT_PATH = getArg(
  "input-json",
  path.join(ROOT, "output", "iherb_overlay_staging", "staging_products.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_overlay_bulk_merge"));
const OWNER = getArg("owner", "maintainer-week2");
const APPLY = hasFlag("apply");

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stableHash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const chunk = (rows, size) => {
  const out = [];
  for (let idx = 0; idx < rows.length; idx += size) out.push(rows.slice(idx, idx + size));
  return out;
};

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Overlay Bulk Merge Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- apply: ${report.apply}`,
    `- inputPath: ${report.inputPath}`,
    `- owner: ${report.owner}`,
    "",
    "## Summary",
    "",
    `- total: ${report.summary.total}`,
    `- eligible: ${report.summary.eligible}`,
    `- strict_merge_ready: ${report.summary.strictMergeReady}`,
    `- matched: ${report.summary.matched}`,
    `- merged: ${report.summary.merged}`,
    `- queued: ${report.summary.queued}`,
    `- queued_api_fill: ${report.summary.queuedApiFill}`,
    `- blocked: ${report.summary.blocked}`,
    `- merged_authoritative_dsld: ${report.summary.mergedAuthoritativeDsld}`,
    `- merged_high_confidence_product_page: ${report.summary.mergedHighConfidenceProductPage}`,
    "",
    "## Match Results",
    "",
  ];
  for (const row of report.rows.slice(0, 200)) {
    lines.push(
      `- ${row.brandName} | ${row.title} | ${row.barcodeGtin14 || "n/a"} | ${row.mergeDecision} | ${row.authoritativeIdentityKey || row.reasonCode || row.blockReasonCode || "n/a"}`,
    );
    lines.push(`  - status: ${row.status}`);
    lines.push(`  - overlayResolvedFields: ${row.overlayResolvedFields.join(", ") || "none"}`);
    lines.push(`  - stillMissingFields: ${row.stillMissingFields.join(", ") || "none"}`);
  }
  return `${lines.join("\n")}\n`;
};

const buildOverlayPayload = (row, sourceExtractedAt) => ({
  product_id: normalizeText(row.productId) || row.overlayRecordKey,
  brand_name: normalizeText(row.brandName) || "unknown",
  title: normalizeText(row.title) || "unknown",
  upc_code: normalizeText(row.upcCode) || null,
  barcode_gtin14: normalizeText(row.barcode_gtin14) || null,
  link: normalizeText(row.link) || null,
  product_images: Array.isArray(row.productImages) ? row.productImages : [],
  product_catalog_image: normalizeText(row.productCatalogImage) || null,
  categories: Array.isArray(row.categories) ? row.categories : [],
  serving: row.serving && typeof row.serving === "object" ? row.serving : {},
  supplement_facts: row.supplementFacts && typeof row.supplementFacts === "object" ? row.supplementFacts : {},
  description_sections:
    row.descriptionSections && typeof row.descriptionSections === "object" ? row.descriptionSections : {},
  source_zip_path: normalizeText(row?.sourceSummary?.sourceNotes?.join(" | ")) || null,
  source_extracted_at: sourceExtractedAt,
  overlay_sha256: stableHash({
    overlayRecordKey: row.overlayRecordKey,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts ?? {},
    descriptionSections: row.descriptionSections ?? {},
    sourceSummary: row.sourceSummary ?? {},
  }),
  updated_at: new Date().toISOString(),
});

const buildHighConfidenceIdentityKey = (row) => {
  const gtin14 = normalizeText(row?.barcode_gtin14);
  if (gtin14) return `product_page:gtin14:${gtin14}`;
  const productId = normalizeText(row?.productId);
  if (productId) return `product_page:iherb:${productId}`;
  return null;
};

const queryDsldMatches = async (supabase, gtin14Values) => {
  const out = new Map();
  for (const values of chunk([...new Set(gtin14Values.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_barcode_canonical")
      .select("barcode_normalized_gtin14,canonical_dsld_label_id")
      .in("barcode_normalized_gtin14", values)
      .not("canonical_dsld_label_id", "is", null);
    if (error) {
      throw new Error(`dsld_barcode_canonical query failed: ${error.message}`);
    }
    for (const row of data ?? []) {
      const gtin14 = normalizeText(row?.barcode_normalized_gtin14);
      const labelId = Number(row?.canonical_dsld_label_id ?? 0);
      if (!gtin14 || !Number.isFinite(labelId) || labelId <= 0) continue;
      if (!out.has(gtin14)) out.set(gtin14, []);
      out.get(gtin14).push(labelId);
    }
  }
  return out;
};

const main = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.parse(await fs.readFile(INPUT_PATH, "utf8"));
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const sourceExtractedAt = new Date().toISOString();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const dsldMatches = await queryDsldMatches(
    supabase,
    products.map((row) => normalizeText(row.barcode_gtin14)),
  );

  const rows = [];
  const upserts = [];
  const auditRows = [];

  for (const row of products) {
    const gtin14 = normalizeText(row.barcode_gtin14);
    const completeness = resolveCurrentCompleteness(row);
    const status = completeness.status;
    const overlayResolvedFields = completeness.coreResolvedFields;
    const stillMissingFields = completeness.coreMissingFields;
    const matchIds = dsldMatches.get(gtin14) ?? [];
    const highConfidenceUsProductPageReady =
      row?.readiness?.highConfidenceUsProductPageReady ??
      qualifiesHighConfidenceUsProductPage(row, completeness);
    const hasUsIherbPage = Boolean(row?.sourceSummary?.hasUsIherbPage);
    const npnIgnored = Boolean(row?.sourceSummary?.npnIgnored);
    const sourceTypes = new Set(Array.isArray(row?.sourceSummary?.sourceTypes) ? row.sourceSummary.sourceTypes : []);
    const fullOfficialProductPageReady =
      !npnIgnored &&
      Boolean(gtin14) &&
      stillMissingFields.length === 0 &&
      sourceTypes.has("official_product_page");
    const fullAuthoritativeDsldReady =
      !npnIgnored &&
      Boolean(gtin14) &&
      stillMissingFields.length === 0 &&
      sourceTypes.has("dsld_label_api");
    const strictMergeReady = status === "full_overlay_ready" && hasUsIherbPage && !npnIgnored;
    const apiFillReady = status === "partial_overlay" && hasUsIherbPage && !npnIgnored && !fullOfficialProductPageReady;
    const mergeReady = strictMergeReady || fullOfficialProductPageReady || fullAuthoritativeDsldReady;

    let mergeDecision = "queued";
    let blockReasonCode = null;
    let authoritativeIdentityKey = null;
    let authoritativeSourceType = null;
    let reasonCode = null;

    if (status === "conflicted_or_non_us") {
      mergeDecision = "blocked";
      blockReasonCode = "non_us_or_conflicted_source";
    } else if (status === "catalog_only") {
      mergeDecision = "blocked";
      blockReasonCode = "catalog_only_missing_core_overlay";
    } else if (apiFillReady) {
      mergeDecision = "queued";
      reasonCode = "partial_overlay_requires_api_fill";
    } else if (!mergeReady) {
      mergeDecision = "blocked";
      blockReasonCode =
        status === "full_overlay_ready"
          ? "not_us_iherb_overlay_ready"
          : sourceTypes.has("official_product_page")
            ? "official_product_page_not_ready"
            : "unsupported_overlay_status";
    } else if (!gtin14) {
      mergeDecision = "blocked";
      blockReasonCode = "missing_gtin14";
    } else if (matchIds.length === 0) {
      if (fullOfficialProductPageReady || highConfidenceUsProductPageReady) {
        mergeDecision = APPLY ? "merged" : "matched";
        authoritativeSourceType = "product_page";
        authoritativeIdentityKey = buildHighConfidenceIdentityKey(row);
      } else {
        mergeDecision = "queued";
        reasonCode = "authoritative_match_required";
      }
    } else {
      mergeDecision = APPLY ? "merged" : "matched";
      authoritativeSourceType = "dsld";
      authoritativeIdentityKey = `dsld:${matchIds[0]}`;
    }

    if ((mergeDecision === "merged" || mergeDecision === "matched") && authoritativeIdentityKey) {
      const overlayPayload = buildOverlayPayload(row, sourceExtractedAt);
      upserts.push(overlayPayload);
      auditRows.push({
        run_id: `iherb_overlay_bulk_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`,
        product_id: overlayPayload.product_id,
        barcode_gtin14: overlayPayload.barcode_gtin14,
        authoritative_source_type: authoritativeSourceType,
        authoritative_identity_key: authoritativeIdentityKey,
        match_status: mergeDecision,
        reason_code: null,
        merge_payload: {
          owner: OWNER,
          completenessStatus: status,
          overlayResolvedFields,
          stillMissingFields,
          highConfidenceUsProductPageReady,
        },
      });
    }

    rows.push({
      productId: row.productId,
      brandName: row.brandName,
      title: row.title,
      barcodeGtin14: gtin14 || null,
      status,
      mergeDecision,
      blockReasonCode,
      reasonCode,
      authoritativeSourceType,
      authoritativeIdentityKey,
      highConfidenceUsProductPageReady,
      overlayResolvedFields,
      stillMissingFields,
    });
  }

  if (APPLY && upserts.length > 0) {
    for (const part of chunk(upserts, 250)) {
      const { error } = await supabase.from("iherb_overlay_products").upsert(part, {
        onConflict: "product_id",
      });
      if (error) {
        throw new Error(`Failed to upsert iherb_overlay_products batch: ${error.message}`);
      }
    }
    for (const part of chunk(auditRows, 500)) {
      const { error } = await supabase.from("iherb_overlay_merge_audit").insert(part);
      if (error) {
        throw new Error(`Failed to insert iherb_overlay_merge_audit batch: ${error.message}`);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    inputPath: INPUT_PATH,
    owner: OWNER,
    summary: {
      total: rows.length,
      eligible: rows.filter((row) => row.status === "full_overlay_ready" || row.status === "partial_overlay").length,
      strictMergeReady: rows.filter(
        (row) => row.status === "full_overlay_ready" && !row.blockReasonCode && row.reasonCode !== "partial_overlay_requires_api_fill",
      ).length,
      matched: rows.filter((row) => row.mergeDecision === "matched").length,
      merged: rows.filter((row) => row.mergeDecision === "merged").length,
      queued: rows.filter((row) => row.mergeDecision === "queued").length,
      queuedApiFill: rows.filter((row) => row.reasonCode === "partial_overlay_requires_api_fill").length,
      blocked: rows.filter((row) => row.mergeDecision === "blocked").length,
      mergedAuthoritativeDsld: rows.filter(
        (row) =>
          (row.mergeDecision === "matched" || row.mergeDecision === "merged") &&
          row.authoritativeSourceType === "dsld",
      ).length,
      mergedHighConfidenceProductPage: rows.filter(
        (row) =>
          (row.mergeDecision === "matched" || row.mergeDecision === "merged") &&
          row.authoritativeSourceType === "product_page",
      ).length,
    },
    rows,
  };

  const reportJson = path.join(OUT_DIR, "overlay_merge_coverage_report.json");
  const reportMd = path.join(OUT_DIR, "overlay_merge_coverage_report.md");

  await fs.writeFile(reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMd, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        apply: APPLY,
        outputs: {
          json: reportJson,
          md: reportMd,
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
