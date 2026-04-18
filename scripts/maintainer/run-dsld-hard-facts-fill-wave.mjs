#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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
dotenv.config({ path: path.join(ROOT, "backend", ".env") });
dotenv.config({ path: path.join(ROOT, ".env"), override: false });

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "full_db_api_fill_queue", "1776444464175", "api_fill_queue.hard_facts.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "dsld_hard_facts_fill_wave"));
const RECOMMENDED_RUNNER = getArg("recommended-runner", "needs_brand_support_onboarding");
const BRANDS = (getArg("brands", "") ?? "")
  .split(",")
  .map((value) => normalizeText(value))
  .filter(Boolean);
const LIMIT = Math.max(0, Number(getArg("limit", "0") ?? "0"));

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeUnitLabel = (unitRaw) => {
  const normalized = normalizeLower(unitRaw);
  if (!normalized) return null;
  if (normalized.startsWith("mcg") || normalized.startsWith("ug") || normalized.startsWith("µg") || normalized.startsWith("μg")) {
    return "mcg";
  }
  if (normalized.startsWith("mg")) return "mg";
  if (normalized.startsWith("g")) return "g";
  if (normalized.startsWith("iu") || normalized.startsWith("i.u")) return "iu";
  if (normalized.startsWith("ml")) return "ml";
  if (normalized.includes("cfu") || normalized.includes("ufc")) return "cfu";
  if (normalized.startsWith("%")) return "%";
  if (normalized.startsWith("cal")) return "cal";
  if (normalized.startsWith("kcal")) return "kcal";
  return normalized;
};

const parseDelimitedList = (value) =>
  String(value ?? "")
    .split(/;|•/g)
    .map((item) => normalizeText(item))
    .filter(Boolean);

const parseActiveSummaryLine = (rawLine) => {
  const cleaned = String(rawLine ?? "").replace(/\{[^}]*\}/g, "").trim();
  if (!cleaned) return { name: normalizeText(rawLine), amount: null, unit: null };

  const npMatch = cleaned.match(/^(.*?)(?:\s+0+\s*(?:np|n\/p)|\s+(?:np|n\/p|not present))\s*$/i);
  if (npMatch) return { name: normalizeText(npMatch[1] ?? cleaned) || cleaned, amount: null, unit: "np" };

  const amountUnitMatch = cleaned.match(
    /(.*?)(\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml|cfu|ufc|kcal|cal|calorie(?:s)?|%\s*dv|%dv|%)/i,
  );
  if (amountUnitMatch) {
    const [, name, amountRaw, unitRaw] = amountUnitMatch;
    const amount = Number(amountRaw);
    return {
      name: normalizeText(name),
      amount: Number.isFinite(amount) ? amount : null,
      unit: normalizeUnitLabel(unitRaw),
    };
  }

  const numericMatch = cleaned.match(/(.*?)(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, name, amountRaw] = numericMatch;
    const amount = Number(amountRaw);
    return {
      name: normalizeText(name),
      amount: Number.isFinite(amount) ? amount : null,
      unit: null,
    };
  }

  return { name: cleaned, amount: null, unit: null };
};

const toAmountPerServing = (active) => {
  if (active?.amount == null && !active?.unit) return null;
  if (active?.amount == null) return active.unit;
  if (!active?.unit) return String(active.amount);
  return `${active.amount} ${active.unit}`;
};

const buildSupplementFactsFromFactsJson = (factsJson) => {
  const actives = Array.isArray(factsJson?.actives) ? factsJson.actives : [];
  return {
    servingSize: normalizeText(factsJson?.servingSize ?? null) || null,
    servingsPerContainer: parseNumber(factsJson?.servingsPerContainer ?? null),
    nutritionalFacts: actives
      .map((active) => ({
        substancy: normalizeText(active?.name ?? null),
        amountPerServing: toAmountPerServing({
          amount: parseNumber(active?.amount ?? null),
          unit: normalizeUnitLabel(active?.unit ?? null),
        }),
        dailyValuePercent: null,
      }))
      .filter((row) => row.substancy || row.amountPerServing),
  };
};

const buildSupplementFactsFromMeta = (meta) => {
  const actives = parseDelimitedList(meta?.active_ingredients_summary).map(parseActiveSummaryLine);
  return {
    servingSize: normalizeText(meta?.serving_size_raw ?? null) || null,
    servingsPerContainer: parseNumber(meta?.servings_per_container ?? null),
    nutritionalFacts: actives
      .map((active) => ({
        substancy: normalizeText(active?.name ?? null),
        amountPerServing: toAmountPerServing(active),
        dailyValuePercent: null,
      }))
      .filter((row) => row.substancy || row.amountPerServing),
  };
};

const chunk = (rows, size) => {
  const out = [];
  for (let idx = 0; idx < rows.length; idx += size) out.push(rows.slice(idx, idx + size));
  return out;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const fetchOverlayRowsByProductId = async (productIds) => {
  const out = new Map();
  for (const productIdChunk of chunk([...new Set(productIds.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select("*")
      .in("product_id", productIdChunk);
    if (error) throw new Error(`iherb_overlay_products query failed: ${error.message}`);
    for (const row of data ?? []) out.set(normalizeText(row.product_id), row);
  }
  return out;
};

const fetchCanonicalDsldByBarcode = async (barcodes) => {
  const out = new Map();
  for (const barcodeChunk of chunk([...new Set(barcodes.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_barcode_canonical")
      .select("barcode_normalized_gtin14,canonical_dsld_label_id")
      .in("barcode_normalized_gtin14", barcodeChunk);
    if (error) throw new Error(`dsld_barcode_canonical query failed: ${error.message}`);
    for (const row of data ?? []) {
      const barcode = toGtin14(row?.barcode_normalized_gtin14);
      const labelId = normalizeText(row?.canonical_dsld_label_id);
      if (barcode && labelId) out.set(barcode, labelId);
    }
  }
  return out;
};

const fetchDsldMetaByBarcode = async (barcodes) => {
  const out = new Map();
  for (const barcodeChunk of chunk([...new Set(barcodes.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_labels_meta")
      .select(
        "dsld_label_id,brand,product_name,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail,barcode_normalized_gtin14",
      )
      .in("barcode_normalized_gtin14", barcodeChunk);
    if (error) throw new Error(`dsld_labels_meta query failed: ${error.message}`);
    for (const row of data ?? []) {
      const barcode = toGtin14(row?.barcode_normalized_gtin14);
      if (!barcode) continue;
      if (!out.has(barcode)) out.set(barcode, []);
      out.get(barcode).push(row);
    }
  }
  return out;
};

const fetchDsldFactsByLabelId = async (labelIds) => {
  const out = new Map();
  for (const labelIdChunk of chunk([...new Set(labelIds.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_label_facts")
      .select("dsld_label_id,brand_name,product_name,facts_json")
      .in("dsld_label_id", labelIdChunk);
    if (error) throw new Error(`dsld_label_facts query failed: ${error.message}`);
    for (const row of data ?? []) out.set(normalizeText(row.dsld_label_id), row);
  }
  return out;
};

const overlayDbRowToRecord = (row) => ({
  brandName: normalizeText(row?.brand_name) || null,
  title: normalizeText(row?.title) || null,
  normalizedTitle: normalizeLower(row?.title) || null,
  productId: normalizeText(row?.product_id) || null,
  upcCode: normalizeText(row?.upc_code) || null,
  barcode_gtin14: toGtin14(row?.barcode_gtin14),
  link: normalizeText(row?.link) || null,
  productCatalogImage: normalizeText(row?.product_catalog_image) || null,
  productImages: Array.isArray(row?.product_images) ? row.product_images : [],
  categories: Array.isArray(row?.categories) ? row.categories : [],
  serving: row?.serving && typeof row.serving === "object" ? row.serving : {},
  supplementFacts: row?.supplement_facts && typeof row.supplement_facts === "object" ? row.supplement_facts : {},
  descriptionSections:
    row?.description_sections && typeof row.description_sections === "object" ? row.description_sections : {},
  sourceSummary: {
    sourceKind: "supabase_overlay_current",
    sourceTypes: ["iherb_us_product_page"],
    marketSources: ["us"],
    sourceUrls: [],
    sourceNotes: [normalizeText(row?.source_zip_path)].filter(Boolean),
    npnIgnored: false,
    hasUsIherbPage: true,
    sourceRank: 100,
  },
});

const buildDsldIncomingRecord = ({ queueRow, currentRecord, factsRow, metaRow, dsldLabelId }) => {
  const factsJson =
    factsRow?.facts_json && typeof factsRow.facts_json === "object" ? factsRow.facts_json : null;
  const supplementFacts = factsJson
    ? buildSupplementFactsFromFactsJson(factsJson)
    : buildSupplementFactsFromMeta(metaRow);
  const inactiveFromFacts = Array.isArray(factsJson?.inactive) ? factsJson.inactive : [];
  const inactiveFromMeta = parseDelimitedList(metaRow?.inactive_ingredients);
  const otherIngredients = [...new Set([...inactiveFromFacts, ...inactiveFromMeta].map(normalizeText).filter(Boolean))];
  const barcode = toGtin14(queueRow?.barcode_gtin14 ?? currentRecord?.barcode_gtin14 ?? metaRow?.barcode_normalized_gtin14);
  return extractOverlayRecordFromSeedRow(
    {
      brandName: currentRecord.brandName ?? queueRow.brandName ?? factsRow?.brand_name ?? metaRow?.brand,
      title: currentRecord.title ?? queueRow.productName ?? factsRow?.product_name ?? metaRow?.product_name,
      productId: currentRecord.productId ?? normalizeText(queueRow.productId),
      upcCode: barcode,
      barcode_gtin14: barcode,
      link: currentRecord.link,
      productCatalogImage: currentRecord.productCatalogImage,
      productImages: currentRecord.productImages,
      categories: currentRecord.categories,
      sourceTypes: ["dsld_label_api"],
      marketSources: ["US"],
      sourceUrls: [metaRow?.dsld_pdf].filter(Boolean),
      sourceNotes: [
        "dsld_hard_facts_fill_by_barcode",
        `dsld_label_id:${dsldLabelId}`,
        factsJson ? "facts_source:dsld_label_facts" : "facts_source:dsld_labels_meta",
      ],
      sections: otherIngredients.length > 0 ? { "Other ingredients": otherIngredients.join("; ") } : {},
      supplementFacts,
    },
    { seedName: "dsld_hard_facts_fill_by_barcode" },
  );
};

const hydrateRow = (row) => {
  const completeness = deriveCompleteness(row);
  const status = classifyOverlayStatus(row, completeness);
  const patchStrategy = buildPatchStrategy(row, completeness);
  return {
    ...row,
    overlayRecordKey: buildOverlayRecordKey(row),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady: qualifiesHighConfidenceUsProductPage(row, completeness),
    },
    patchStrategy,
    overlaySha256: stableHash({
      brandName: row.brandName,
      title: row.title,
      barcode_gtin14: row.barcode_gtin14,
      supplementFacts: row.supplementFacts,
      descriptionSections: row.descriptionSections,
      sourceSummary: row.sourceSummary,
    }),
  };
};

const diffFilledFields = (before, after) => {
  const beforeMissing = Array.isArray(before?.coreMissingFields) ? before.coreMissingFields : [];
  const afterMissing = Array.isArray(after?.coreMissingFields) ? after.coreMissingFields : [];
  return beforeMissing.filter((field) => !afterMissing.includes(field));
};

const toMarkdown = (report) => {
  const lines = [
    "# DSLD Hard Facts Fill Wave",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- recommendedRunner: ${report.inputs.recommendedRunner}`,
    `- selectedRows: ${report.summary.selectedRows}`,
    `- currentRowsFound: ${report.summary.currentRowsFound}`,
    `- dsldMatches: ${report.summary.dsldMatches}`,
    `- improvedRows: ${report.summary.improvedRows}`,
    `- fullReadyRows: ${report.summary.fullReadyRows}`,
    `- partialRows: ${report.summary.partialRows}`,
    `- filledIngredient: ${report.summary.filledIngredient}`,
    `- filledDosage: ${report.summary.filledDosage}`,
    "",
    "## Brand Rollup",
    "",
  ];

  for (const row of report.brandRollup) {
    lines.push(
      `- ${row.brandName}: selected=${row.selected}, improved=${row.improved}, full=${row.fullReady}, partial=${row.partial}`,
    );
  }

  lines.push("", "## Non Full-Ready Improved Rows", "");
  const partialRows = report.rows.filter((row) => row.improved && row.afterStatus !== "full_overlay_ready");
  if (partialRows.length === 0) {
    lines.push("- none");
  } else {
    for (const row of partialRows.slice(0, 80)) {
      lines.push(
        `- ${row.brandName} | ${row.productId} | ${row.title} | stillMissing=${row.afterMissingFields.join(", ") || "none"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const queueRowsRaw = await readJson(QUEUE_PATH);
  const selectedRows = (Array.isArray(queueRowsRaw) ? queueRowsRaw : [])
    .filter((row) => normalizeText(row?.recommendedRunner) === RECOMMENDED_RUNNER)
    .filter((row) => {
      const missing = Array.isArray(row?.missingFields) ? row.missingFields : [];
      return missing.includes("ingredient") || missing.includes("dosage");
    })
    .filter((row) => (BRANDS.length > 0 ? BRANDS.some((brand) => normalizeLower(brand) === normalizeLower(row?.brandName)) : true))
    .slice(0, LIMIT > 0 ? LIMIT : undefined);

  const productIds = selectedRows.map((row) => normalizeText(row?.productId)).filter(Boolean);
  const barcodes = selectedRows.map((row) => toGtin14(row?.barcode_gtin14)).filter(Boolean);
  const [currentByProductId, canonicalByBarcode, metaByBarcode] = await Promise.all([
    fetchOverlayRowsByProductId(productIds),
    fetchCanonicalDsldByBarcode(barcodes),
    fetchDsldMetaByBarcode(barcodes),
  ]);

  const labelIds = [];
  for (const barcode of barcodes) {
    const canonical = canonicalByBarcode.get(barcode);
    if (canonical) labelIds.push(canonical);
    for (const meta of metaByBarcode.get(barcode) ?? []) labelIds.push(normalizeText(meta.dsld_label_id));
  }
  const factsByLabelId = await fetchDsldFactsByLabelId(labelIds);

  const refreshedRows = [];
  const fullReadyRows = [];
  const auditRows = [];

  for (const queueRow of selectedRows) {
    const productId = normalizeText(queueRow.productId);
    const barcode = toGtin14(queueRow.barcode_gtin14);
    const currentDbRow = currentByProductId.get(productId) ?? null;
    const currentRecord = currentDbRow ? overlayDbRowToRecord(currentDbRow) : null;
    const beforeCompleteness = currentRecord ? deriveCompleteness(currentRecord) : null;
    const candidateMetas = metaByBarcode.get(barcode) ?? [];
    const canonicalLabelId = canonicalByBarcode.get(barcode) ?? null;
    const selectedMeta =
      candidateMetas.find((row) => normalizeText(row.dsld_label_id) === canonicalLabelId) ?? candidateMetas[0] ?? null;
    const dsldLabelId = normalizeText(selectedMeta?.dsld_label_id ?? canonicalLabelId);
    const factsRow = factsByLabelId.get(dsldLabelId) ?? null;

    let refreshed = null;
    if (currentRecord && selectedMeta && (factsRow || selectedMeta)) {
      const incoming = buildDsldIncomingRecord({
        queueRow,
        currentRecord,
        factsRow,
        metaRow: selectedMeta,
        dsldLabelId,
      });
      refreshed = hydrateRow(mergeOverlayRecords(currentRecord, incoming));
      refreshedRows.push(refreshed);
      if (refreshed.completeness.status === "full_overlay_ready") fullReadyRows.push(refreshed);
    }

    const afterCompleteness = refreshed?.completeness ?? null;
    const filledFields = refreshed && beforeCompleteness ? diffFilledFields(beforeCompleteness, afterCompleteness) : [];
    auditRows.push({
      productId,
      brandName: normalizeText(queueRow.brandName),
      title: refreshed?.title ?? normalizeText(queueRow.productName),
      barcode_gtin14: barcode,
      currentRowFound: Boolean(currentRecord),
      dsldMatched: Boolean(selectedMeta),
      dsldLabelId: dsldLabelId || null,
      improved: filledFields.length > 0,
      filledFields,
      beforeStatus: beforeCompleteness ? classifyOverlayStatus(currentRecord, beforeCompleteness) : "missing_current_overlay",
      afterStatus: refreshed?.completeness?.status ?? null,
      beforeMissingFields: beforeCompleteness?.coreMissingFields ?? [],
      afterMissingFields: refreshed?.completeness?.coreMissingFields ?? [],
      selectedDsldTitle: normalizeText(selectedMeta?.product_name ?? factsRow?.product_name) || null,
    });
  }

  const brandRollup = Object.values(
    auditRows.reduce((acc, row) => {
      const brandName = row.brandName || "Unknown";
      acc[brandName] ??= {
        brandName,
        selected: 0,
        improved: 0,
        fullReady: 0,
        partial: 0,
      };
      acc[brandName].selected += 1;
      if (row.improved) acc[brandName].improved += 1;
      if (row.afterStatus === "full_overlay_ready") acc[brandName].fullReady += 1;
      else if (row.afterStatus) acc[brandName].partial += 1;
      return acc;
    }, {}),
  ).sort((left, right) => right.selected - left.selected || left.brandName.localeCompare(right.brandName));

  const summary = {
    selectedRows: selectedRows.length,
    currentRowsFound: auditRows.filter((row) => row.currentRowFound).length,
    dsldMatches: auditRows.filter((row) => row.dsldMatched).length,
    improvedRows: auditRows.filter((row) => row.improved).length,
    fullReadyRows: fullReadyRows.length,
    partialRows: auditRows.filter((row) => row.afterStatus && row.afterStatus !== "full_overlay_ready").length,
    filledIngredient: auditRows.filter((row) => row.filledFields.includes("ingredient")).length,
    filledDosage: auditRows.filter((row) => row.filledFields.includes("dosage")).length,
  };

  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: "dsld_hard_facts_fill_wave.v1",
    generatedAt,
    inputs: {
      queuePath: path.relative(ROOT, QUEUE_PATH),
      outDir: path.relative(ROOT, OUT_DIR),
      recommendedRunner: RECOMMENDED_RUNNER,
      brands: BRANDS,
      limit: LIMIT || null,
    },
    summary,
    brandRollup,
    outputs: {
      allImprovedStaging: path.relative(ROOT, path.join(OUT_DIR, "staging_products.dsld_hard_facts_all_improved.json")),
      fullReadyStaging: path.relative(ROOT, path.join(OUT_DIR, "staging_products.dsld_hard_facts_full_ready.json")),
      reportJson: path.relative(ROOT, path.join(OUT_DIR, "dsld_hard_facts_fill_report.json")),
      reportMd: path.relative(ROOT, path.join(OUT_DIR, "dsld_hard_facts_fill_report.md")),
    },
    rows: auditRows,
  };

  await Promise.all([
    writeJson(path.join(OUT_DIR, "staging_products.dsld_hard_facts_all_improved.json"), { products: refreshedRows }),
    writeJson(path.join(OUT_DIR, "staging_products.dsld_hard_facts_full_ready.json"), { products: fullReadyRows }),
    writeJson(path.join(OUT_DIR, "dsld_hard_facts_fill_report.json"), report),
    writeText(path.join(OUT_DIR, "dsld_hard_facts_fill_report.md"), toMarkdown(report)),
  ]);

  console.log(JSON.stringify({ ok: true, outputs: report.outputs, summary }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
