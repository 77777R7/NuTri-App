#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
dotenv.config();
dotenv.config({ path: path.join(ROOT, "backend", ".env") });
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const inputPath = getArg(
  "input-json",
  path.join(ROOT, "output", "demo5_iherb", "extracted_demo5_overlay.json"),
);
const outDir = getArg("out-dir", path.join(ROOT, "output", "demo5_iherb"));
const owner = getArg("owner", "maintainer-demo5");
const reviewAfterDays = Math.max(1, Number(getArg("review-after-days", "30")) || 30);

const nowIso = () => new Date().toISOString();
const stableHash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (value) => String(value ?? "").trim();
const toGtin14 = (value) => {
  const digits = normalize(value).replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(14, "0").slice(-14);
};
const EXPECTED_CODEAGE_GTIN14 = "00853919008236";
const isCodeageHardGatePass = ({ brandName, title, barcodeGtin14 }) => {
  if (barcodeGtin14 !== EXPECTED_CODEAGE_GTIN14) return true;
  const brand = normalize(brandName).toLowerCase();
  const productTitle = normalize(title).toLowerCase();
  const brandOk = brand.includes("codeage");
  const titleOk =
    /(?:^|\b)(a\s*-?\s*d\s*-?\s*k|vitamin(?:es)?\s*a\s*-?\s*d\s*-?\s*k|vitamin\s*a.+vitamin\s*d.+vitamin\s*k)/i.test(
      productTitle,
    );
  return brandOk && titleOk;
};
const deriveOverlayCoverage = (product) => {
  const sections = product?.allDescriptionSections && typeof product.allDescriptionSections === "object"
    ? product.allDescriptionSections
    : {};
  const supplementFacts =
    product?.supplementFacts && typeof product.supplementFacts === "object"
      ? product.supplementFacts
      : {};
  const resolved = [];
  if (normalize(sections["Suggested use"])) resolved.push("directions");
  if (normalize(sections.Warnings)) resolved.push("warnings");
  if (normalize(sections["Other ingredients"])) resolved.push("other_ingredients");
  if (normalize(supplementFacts.servingSize)) resolved.push("serving_size");
  if (Number.isFinite(Number(supplementFacts.servingsPerContainer))) resolved.push("servings_per_container");
  if (Array.isArray(supplementFacts.nutritionalFacts) && supplementFacts.nutritionalFacts.length > 0) {
    resolved.push("nutritional_facts");
  }
  const required = [
    "directions",
    "warnings",
    "other_ingredients",
    "serving_size",
    "servings_per_container",
    "nutritional_facts",
  ];
  return {
    overlayResolvedFields: resolved,
    stillMissingFields: required.filter((field) => !resolved.includes(field)),
    sourceTierDistribution: {
      overlay_iherb: resolved.length,
      official_record: 0,
      scanned_label: 0,
      general_science: 0,
      inferred: 0,
    },
  };
};

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Overlay Demo5 Merge Coverage Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- runId: ${report.runId}`,
    `- inputPath: ${report.inputPath}`,
    `- products: ${report.summary.total}`,
    `- merged: ${report.summary.merged}`,
    `- queued: ${report.summary.queued}`,
    `- blocked: ${report.summary.blocked}`,
    "",
    "## Match Results",
  ];
  report.rows.forEach((row, idx) => {
    lines.push(
      `${idx + 1}. ${row.brandName} | ${row.productId} | ${row.barcodeGtin14 || "n/a"} | ${row.mergeDecision} | ${row.authoritativeIdentityKey || row.blockReasonCode || row.reasonCode || "n/a"}`,
    );
    lines.push(
      `   - overlayResolvedFields: ${row.overlayResolvedFields.length ? row.overlayResolvedFields.join(", ") : "none"}`,
    );
    lines.push(
      `   - stillMissingFields: ${row.stillMissingFields.length ? row.stillMissingFields.join(", ") : "none"}`,
    );
  });
  if (report.unmatched.length > 0) {
    lines.push("", "## Queued / Blocked");
    report.unmatched.forEach((row, idx) => {
      lines.push(`${idx + 1}. ${row.productId} | ${row.brandName} | ${row.blockReasonCode || row.reasonCode || "unknown_reason"}`);
    });
  }
  return `${lines.join("\n")}\n`;
};

const queryAuthoritativeMatch = async (supabase, barcodeGtin14) => {
  if (!barcodeGtin14) {
    return {
      matchStatus: "unmatched",
      reasonCode: "missing_gtin14",
      authoritativeSourceType: null,
      authoritativeIdentityKey: null,
      extra: {},
    };
  }

  const { data: dsldRows, error: dsldError } = await supabase
    .from("dsld_barcode_canonical")
    .select("canonical_dsld_label_id,barcode_normalized_gtin14")
    .eq("barcode_normalized_gtin14", barcodeGtin14)
    .not("canonical_dsld_label_id", "is", null)
    .limit(5);

  if (!dsldError && Array.isArray(dsldRows) && dsldRows.length > 0) {
    const canonicalLabelId = Number(
      dsldRows.find((row) => Number.isFinite(Number(row?.canonical_dsld_label_id)))?.canonical_dsld_label_id ?? 0,
    );
    if (Number.isFinite(canonicalLabelId) && canonicalLabelId > 0) {
      return {
        matchStatus: "matched",
        reasonCode: null,
        authoritativeSourceType: "dsld",
        authoritativeIdentityKey: `dsld:${canonicalLabelId}`,
        extra: {
          dsldHits: dsldRows.length,
        },
      };
    }
  }

  const { data: lnhpdRows, error: lnhpdError } = await supabase
    .from("barcode_regulatory_map")
    .select("npn,confidence,source")
    .eq("barcode_gtin14", barcodeGtin14)
    .limit(5);

  if (!lnhpdError && Array.isArray(lnhpdRows) && lnhpdRows.length > 0) {
    const best = [...lnhpdRows].sort((a, b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0))[0];
    const npn = normalize(best?.npn).replace(/\D/g, "");
    if (npn) {
      return {
        matchStatus: "matched",
        reasonCode: null,
        authoritativeSourceType: "lnhpd",
        authoritativeIdentityKey: `lnhpd:${npn}`,
        extra: {
          lnhpdHits: lnhpdRows.length,
          confidence: Number(best?.confidence ?? 0),
          mapSource: normalize(best?.source) || null,
        },
      };
    }
  }

  return {
    matchStatus: "unmatched",
    reasonCode: "authoritative_match_not_found",
    authoritativeSourceType: null,
    authoritativeIdentityKey: null,
    extra: {
      dsldQueryError: dsldError?.message ?? null,
      lnhpdQueryError: lnhpdError?.message ?? null,
    },
  };
};

const main = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  await fs.mkdir(outDir, { recursive: true });
  const input = await readJson(inputPath);
  const products = Array.isArray(input?.products) ? input.products : [];
  if (products.length === 0) {
    throw new Error(`No products found in ${inputPath}`);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const runId = `demo5_iherb_overlay_merge_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const rows = [];
  const auditRows = [];
  const unmatchedQueue = [];

  for (const product of products) {
    const productId = String(product?.productId ?? "").trim();
    const brandName = normalize(product?.brandName);
    const title = normalize(product?.title);
    const barcodeGtin14 = toGtin14(product?.barcode_gtin14 || product?.upcCode);

    const overlayPayload = {
      product_id: productId,
      brand_name: brandName || "unknown",
      title: title || "unknown",
      upc_code: normalize(product?.upcCode) || null,
      barcode_gtin14: barcodeGtin14 || null,
      link: normalize(product?.link) || null,
      product_images: Array.isArray(product?.productImages) ? product.productImages : [],
      product_catalog_image: normalize(product?.productCatalogImage) || null,
      categories: Array.isArray(product?.categories) ? product.categories : [],
      serving: product?.serving && typeof product.serving === "object" ? product.serving : {},
      supplement_facts:
        product?.supplementFacts && typeof product.supplementFacts === "object" ? product.supplementFacts : {},
      description_sections:
        product?.allDescriptionSections && typeof product.allDescriptionSections === "object"
          ? product.allDescriptionSections
          : {},
      source_zip_path: normalize(input?.input?.zipPath) || null,
      source_extracted_at: normalize(input?.generatedAt) || nowIso(),
      overlay_sha256: stableHash({
        productId,
        barcodeGtin14,
        title,
        supplementFacts: product?.supplementFacts ?? {},
        allDescriptionSections: product?.allDescriptionSections ?? {},
      }),
      updated_at: nowIso(),
    };

    const { error: upsertErr } = await supabase
      .from("iherb_overlay_products")
      .upsert(overlayPayload, { onConflict: "product_id" });

    if (upsertErr) {
      throw new Error(`Failed to upsert overlay product ${productId}: ${upsertErr.message}`);
    }

    const match = await queryAuthoritativeMatch(supabase, barcodeGtin14);
    const coverage = deriveOverlayCoverage(product);
    const codeageGatePass = isCodeageHardGatePass({ brandName, title, barcodeGtin14 });
    const isCodeageTarget = barcodeGtin14 === EXPECTED_CODEAGE_GTIN14;
    let mergeDecision = "merged";
    let blockReasonCode = null;
    if (match.matchStatus !== "matched") {
      mergeDecision = "queued";
      blockReasonCode = match.reasonCode || "authoritative_match_not_found";
    } else if (!codeageGatePass) {
      mergeDecision = "blocked";
      blockReasonCode = "no_go_for_overlay_merge";
    }

    const row = {
      productId,
      brandName: brandName || "unknown",
      title: title || "unknown",
      barcodeGtin14: barcodeGtin14 || null,
      matchStatus: match.matchStatus,
      authoritativeSourceType: match.authoritativeSourceType,
      authoritativeIdentityKey: match.authoritativeIdentityKey,
      reasonCode: match.reasonCode,
      mergeDecision,
      blockReasonCode,
      codeageHardGateApplied: isCodeageTarget,
      codeageHardGatePass: isCodeageTarget ? codeageGatePass : null,
      overlayResolvedFields: coverage.overlayResolvedFields,
      stillMissingFields: coverage.stillMissingFields,
      sourceTierDistribution: coverage.sourceTierDistribution,
      extra: match.extra,
    };
    rows.push(row);

    auditRows.push({
      run_id: runId,
      product_id: productId,
      barcode_gtin14: barcodeGtin14 || null,
      authoritative_source_type: match.authoritativeSourceType,
      authoritative_identity_key: match.authoritativeIdentityKey,
      match_status: match.matchStatus,
      reason_code: match.reasonCode,
      merge_payload: {
        brandName,
        title,
        overlayHash: overlayPayload.overlay_sha256,
        sourceTier: "overlay_iherb",
        mergeDecision,
        blockReasonCode,
        codeageHardGateApplied: isCodeageTarget,
        codeageHardGatePass: isCodeageTarget ? codeageGatePass : null,
        overlayResolvedFields: coverage.overlayResolvedFields,
        stillMissingFields: coverage.stillMissingFields,
        sourceTierDistribution: coverage.sourceTierDistribution,
        ...match.extra,
      },
      created_at: nowIso(),
    });

    if (mergeDecision !== "merged") {
      unmatchedQueue.push({
        queueType: mergeDecision === "blocked" ? "blocked" : "fixable",
        runId,
        owner,
        status: "open",
        reasonCode: blockReasonCode || match.reasonCode || "authoritative_match_not_found",
        eta: null,
        reviewAfterDays,
        productId,
        brandName,
        barcode_gtin14: barcodeGtin14 || null,
        title,
      });
    }
  }

  if (auditRows.length > 0) {
    const { error: auditErr } = await supabase.from("iherb_overlay_merge_audit").insert(auditRows);
    if (auditErr) {
      throw new Error(`Failed to insert merge audit rows: ${auditErr.message}`);
    }
  }

  const matched = rows.filter((row) => row.matchStatus === "matched");
  const merged = rows.filter((row) => row.mergeDecision === "merged");
  const queued = rows.filter((row) => row.mergeDecision === "queued");
  const blocked = rows.filter((row) => row.mergeDecision === "blocked");
  const report = {
    schemaVersion: "demo5_iherb_overlay_merge_coverage_report.v1",
    generatedAt: nowIso(),
    runId,
    inputPath,
    summary: {
      total: rows.length,
      matched: matched.length,
      unmatched: rows.length - matched.length,
      merged: merged.length,
      queued: queued.length,
      blocked: blocked.length,
      bySource: merged.reduce(
        (acc, row) => {
          const key = String(row.authoritativeSourceType || "unknown");
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        },
        {},
      ),
    },
    rows,
    unmatched: rows.filter((row) => row.mergeDecision !== "merged"),
  };

  const reportJsonPath = path.join(outDir, "overlay_merge_coverage_report.json");
  const reportMdPath = path.join(outDir, "overlay_merge_coverage_report.md");
  const compatReportJsonPath = path.join(outDir, "merge_report.json");
  const compatReportMdPath = path.join(outDir, "merge_report.md");
  const unmatchedPath = path.join(outDir, "unmatched_queue.jsonl");

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, toMarkdown(report), "utf8");
  await fs.writeFile(compatReportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(compatReportMdPath, toMarkdown(report), "utf8");
  await fs.writeFile(
    unmatchedPath,
    unmatchedQueue.map((row) => JSON.stringify(row)).join("\n") + (unmatchedQueue.length ? "\n" : ""),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        runId,
        summary: report.summary,
        output: {
          reportJsonPath,
          reportMdPath,
          compatReportJsonPath,
          compatReportMdPath,
          unmatchedPath,
        },
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
