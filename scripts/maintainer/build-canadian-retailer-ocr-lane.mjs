#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const DEFAULT_INPUTS = [
  "output/canadian_brand_full_coverage_wave_v0/wave_set_2_parser_lane_02_final/image_ocr_retailer_facts_candidates.canadian_wave_set_2_parser_lane_02_final.json",
  "output/canadian_brand_full_coverage_wave_v0/wave_set_2_canprev_aor_canary_01/image_ocr_retailer_facts_candidates.canadian_wave_set_2_canprev_aor_canary_01.json",
];
const DEFAULT_EXCLUDE_STAGING_JSONS = [];
const DEFAULT_OUT_DIR = "output/canadian_brand_full_coverage_wave_v0/retailer_ocr_lane_01";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseCsvList = (value) =>
  String(value ?? "")
    .split(",")
    .map(normalizeText)
    .filter(Boolean);

const normalizeGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeId = (value) => normalizeText(value).toLowerCase();

const classifyCandidate = (row) => {
  const gtin = normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode);
  const facts = Number(row?.parsed?.facts ?? 0) || 0;
  const hasUse = Boolean(row?.parsed?.suggestedUse);
  const hasWarnings = Boolean(row?.parsed?.warnings);

  if (gtin && facts > 0 && hasUse && hasWarnings) {
    return {
      bucket: "merge_canary_gtin_ready",
      nextAction: "build_retailer_ocr_staging_and_product_surface_validate",
      priority: 100 + Math.min(facts, 12),
      reason: "has_gtin_plus_machine_readable_facts_use_warnings",
    };
  }
  if (!gtin && facts > 0 && hasUse && hasWarnings) {
    return {
      bucket: "retailer_upc_needed",
      nextAction: "find_upc_from_amazon_ca_nationalnutrition_vitamart_then_merge_canary",
      priority: 85 + Math.min(facts, 12),
      reason: "has_facts_use_warnings_but_no_upc",
    };
  }
  if (gtin && facts > 0) {
    return {
      bucket: "ocr_or_retailer_soft_fields_needed",
      nextAction: "fill_missing_use_or_warnings_from_ocr_or_retailer",
      priority: 70 + Math.min(facts, 12),
      reason: "has_gtin_and_some_facts_but_missing_use_or_warnings",
    };
  }
  if (gtin) {
    return {
      bucket: "ocr_facts_needed",
      nextAction: "extract_facts_from_official_image_or_retailer_facts",
      priority: 55 + (hasUse ? 5 : 0) + (hasWarnings ? 5 : 0),
      reason: "has_gtin_but_no_machine_readable_fact_rows",
    };
  }
  if (facts > 0) {
    return {
      bucket: "retailer_upc_and_soft_fields_needed",
      nextAction: "find_upc_and_missing_soft_fields_from_retailers",
      priority: 45 + Math.min(facts, 12) + (hasUse ? 5 : 0) + (hasWarnings ? 5 : 0),
      reason: "has_some_facts_but_no_upc",
    };
  }
  return {
    bucket: "residual_retailer_discovery_needed",
    nextAction: "skip_main_wave_until_retailer_or_ocr_has_real_yield",
    priority: 10 + (hasUse ? 5 : 0) + (hasWarnings ? 5 : 0),
    reason: "missing_upc_and_machine_readable_facts",
  };
};

const readQueue = async (inputPath) => {
  const payload = JSON.parse(await fs.readFile(path.resolve(ROOT, inputPath), "utf8"));
  return (Array.isArray(payload?.candidates) ? payload.candidates : []).map((row) => ({
    ...row,
    sourceQueuePath: inputPath,
    sourceWaveId: payload.waveId ?? null,
  }));
};

const readCompletedKeys = async (inputPaths) => {
  const completedGtins = new Set();
  const completedProductIds = new Set();
  const completedLinks = new Set();
  const completedBrandTitles = new Set();

  for (const inputPath of inputPaths) {
    const payload = JSON.parse(await fs.readFile(path.resolve(ROOT, inputPath), "utf8"));
    const products = Array.isArray(payload?.products)
      ? payload.products
      : Array.isArray(payload?.rows)
        ? payload.rows
        : [];

    for (const product of products) {
      const gtin = normalizeGtin14(product?.barcode_gtin14 ?? product?.upcCode ?? product?.gtin);
      const productId = normalizeId(product?.productId ?? product?.id);
      const link = normalizeId(product?.link);
      const brandTitle = `${normalizeId(product?.brandName)}|${normalizeId(product?.title)}`;
      if (gtin) completedGtins.add(gtin);
      if (productId) completedProductIds.add(productId);
      if (link) completedLinks.add(link);
      if (brandTitle !== "|") completedBrandTitles.add(brandTitle);
    }
  }

  return { completedGtins, completedProductIds, completedLinks, completedBrandTitles };
};

const renderMarkdown = (report) => {
  const lines = [
    "# Canadian Retailer/OCR Lane Queue",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- total: ${report.summary.total}`,
    "",
    "## Buckets",
    "",
  ];

  for (const [bucket, details] of Object.entries(report.summary.byBucket)) {
    lines.push(`- ${bucket}: ${details.count}`);
  }

  lines.push("", "## Promote First", "");
  for (const row of report.promoteFirst.slice(0, 40)) {
    lines.push(
      `- ${row.bucket} | ${row.brandName} | ${row.title || row.link} | gtin=${row.barcode_gtin14 || "missing"} | facts=${row.parsed?.facts ?? 0} | use=${row.parsed?.suggestedUse ? "yes" : "no"} | warnings=${row.parsed?.warnings ? "yes" : "no"}`,
    );
  }

  lines.push("", "## Rows", "");
  for (const row of report.rows.slice(0, 180)) {
    lines.push(
      `- ${row.bucket} | ${row.brandName} | ${row.title || row.link} | action=${row.nextAction} | reason=${row.reason}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const inputPaths = parseCsvList(getArg("input-jsons", DEFAULT_INPUTS.join(",")));
  const excludeStagingPaths = parseCsvList(
    getArg("exclude-staging-jsons", DEFAULT_EXCLUDE_STAGING_JSONS.join(",")),
  );
  const outDir = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));
  const fileStem = getArg("file-stem", "canadian_retailer_ocr_lane_queue");

  const sourceRows = (await Promise.all(inputPaths.map(readQueue))).flat();
  const { completedGtins, completedProductIds, completedLinks, completedBrandTitles } =
    await readCompletedKeys(excludeStagingPaths);
  const seen = new Set();
  const rows = [];
  for (const row of sourceRows) {
    const gtin = normalizeGtin14(row?.barcode_gtin14 ?? row?.upcCode);
    const productId = normalizeId(row?.productId);
    const link = normalizeId(row?.link);
    const brandTitle = `${normalizeId(row?.brandName)}|${normalizeId(row?.title)}`;
    if (
      (gtin && completedGtins.has(gtin)) ||
      (productId && completedProductIds.has(productId)) ||
      (link && completedLinks.has(link)) ||
      (brandTitle !== "|" && completedBrandTitles.has(brandTitle))
    ) {
      continue;
    }
    const key = `${row.brandName}|${gtin || ""}|${row.link || ""}|${row.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const classification = classifyCandidate(row);
    rows.push({
      ...row,
      barcode_gtin14: gtin,
      bucket: classification.bucket,
      nextAction: classification.nextAction,
      priority: classification.priority,
      reason: classification.reason,
    });
  }

  rows.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return `${left.brandName}|${left.title}`.localeCompare(`${right.brandName}|${right.title}`);
  });

  const summary = {
    total: rows.length,
    byBucket: rows.reduce((acc, row) => {
      acc[row.bucket] ??= { count: 0, byBrand: {} };
      acc[row.bucket].count += 1;
      acc[row.bucket].byBrand[row.brandName] = (acc[row.bucket].byBrand[row.brandName] ?? 0) + 1;
      return acc;
    }, {}),
    byBrand: rows.reduce((acc, row) => {
      acc[row.brandName] = (acc[row.brandName] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const report = {
    schemaVersion: "canadian-retailer-ocr-lane-queue.v1",
    generatedAt: new Date().toISOString(),
    inputPaths,
    excludeStagingPaths,
    summary,
    promoteFirst: rows.filter((row) =>
      ["merge_canary_gtin_ready", "retailer_upc_needed"].includes(row.bucket),
    ),
    rows,
  };

  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${fileStem}.json`);
  const mdPath = path.join(outDir, `${fileStem}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: { json: jsonPath, md: mdPath },
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
