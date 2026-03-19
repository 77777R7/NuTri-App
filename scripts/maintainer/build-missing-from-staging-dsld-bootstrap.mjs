#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
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

const getArgs = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    if (args[idx] === flag && idx + 1 < args.length) values.push(args[idx + 1]);
  }
  return values;
};

const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "p0_p3_current_missing_from_staging_queue_20260317.json"),
);
const BASE_STAGING_PATH = getArg(
  "base-staging-json",
  path.join(
    ROOT,
    "output",
    "week2_p0_rescue_executor",
    "week2-p0-rescue-20260317-warnings_only-carlson-2026-03-17-035746",
    "staging_products.official_refreshed.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "p0_p3_missing_from_staging_dsld_bootstrap_20260317"),
);
const BRAND_FILTERS = [
  ...getArgs("brand"),
  ...(getArg("brands", "") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];
const LIMIT = Math.max(0, Number(getArg("limit", "0") ?? "0"));

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const toGtin14 = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const parseNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeUnitLabel = (unitRaw) => {
  if (!unitRaw) return null;
  const normalized = normalizeText(unitRaw).toLowerCase();
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
    .map((item) => item.trim())
    .filter(Boolean);

const parseActiveSummaryLine = (rawLine) => {
  const cleaned = String(rawLine ?? "").replace(/\{[^}]*\}/g, "").trim();
  if (!cleaned) {
    return { name: normalizeText(rawLine), amount: null, unit: null };
  }

  const npMatch = cleaned.match(/^(.*?)(?:\s+0+\s*(?:np|n\/p)|\s+(?:np|n\/p|not present))\s*$/i);
  if (npMatch) {
    const name = normalizeText(npMatch[1] ?? cleaned) || cleaned;
    return { name, amount: null, unit: "np" };
  }

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

const parseDsldLabelId = (row) => {
  const explicit = normalizeText(row?.sourceId ?? null);
  if (/^\d+$/.test(explicit)) return explicit;
  const candidateId = normalizeText(row?.candidateId ?? null);
  return candidateId.match(/:dsldLabelId:(\d+):/)?.[1] ?? null;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const chunk = (rows, size) => {
  const out = [];
  for (let idx = 0; idx < rows.length; idx += size) out.push(rows.slice(idx, idx + size));
  return out;
};

const fetchDsldFactsMap = async (labelIds) => {
  const out = new Map();
  for (const labelIdChunk of chunk([...new Set(labelIds.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_label_facts")
      .select("dsld_label_id,brand_name,product_name,facts_json")
      .in("dsld_label_id", labelIdChunk);
    if (error) throw new Error(`dsld_label_facts query failed: ${error.message}`);
    for (const row of data ?? []) {
      out.set(String(row.dsld_label_id), row);
    }
  }
  return out;
};

const fetchDsldMetaMap = async (labelIds) => {
  const out = new Map();
  for (const labelIdChunk of chunk([...new Set(labelIds.filter(Boolean))], 400)) {
    const { data, error } = await supabase
      .from("dsld_labels_meta")
      .select(
        "dsld_label_id,brand,product_name,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail,barcode_normalized_gtin14",
      )
      .in("dsld_label_id", labelIdChunk);
    if (error) throw new Error(`dsld_labels_meta query failed: ${error.message}`);
    for (const row of data ?? []) {
      out.set(String(row.dsld_label_id), row);
    }
  }
  return out;
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

const buildSyntheticSeedRow = (queueRow, factsRow, metaRow, dsldLabelId) => {
  const factsJson =
    factsRow?.facts_json && typeof factsRow.facts_json === "object" ? factsRow.facts_json : null;
  const supplementFacts = factsJson
    ? buildSupplementFactsFromFactsJson(factsJson)
    : buildSupplementFactsFromMeta(metaRow);
  const inactiveFromFacts = Array.isArray(factsJson?.inactive) ? factsJson.inactive : [];
  const inactiveFromMeta = parseDelimitedList(metaRow?.inactive_ingredients);
  const otherIngredients = [...new Set([...inactiveFromFacts, ...inactiveFromMeta].map(normalizeText).filter(Boolean))];
  const barcode = toGtin14(queueRow?.barcode_gtin14 ?? metaRow?.barcode_normalized_gtin14 ?? null);
  return {
    brandName:
      normalizeText(factsJson?.brandName ?? factsRow?.brand_name ?? metaRow?.brand ?? queueRow?.brandName) || null,
    title:
      normalizeText(factsJson?.productName ?? factsRow?.product_name ?? metaRow?.product_name ?? queueRow?.productName) ||
      null,
    productId: String(dsldLabelId),
    upcCode: barcode,
    barcode_gtin14: barcode,
    sourceTypes: ["dsld_label_facts"],
    marketSources: ["US"],
    sourceUrls: [],
    sourceNotes: [
      "missing_from_staging_dsld_bootstrap",
      factsJson ? "facts_source:dsld_label_facts" : "facts_source:dsld_labels_meta",
    ],
    sections: otherIngredients.length > 0 ? { "Other ingredients": otherIngredients.join("; ") } : {},
    supplementFacts,
  };
};

const main = async () => {
  const [queueRows, baseStagingPayload] = await Promise.all([readJson(QUEUE_PATH), readJson(BASE_STAGING_PATH)]);
  const baseStagingRows = Array.isArray(baseStagingPayload?.products) ? baseStagingPayload.products : [];
  const baseBarcodeSet = new Set(baseStagingRows.map((row) => toGtin14(row?.barcode_gtin14)).filter(Boolean));

  const targetRows = (Array.isArray(queueRows) ? queueRows : [])
    .filter((row) => normalizeText(row?.validationOutcome) === "missing_from_staging")
    .filter((row) =>
      BRAND_FILTERS.length > 0 ? BRAND_FILTERS.some((brand) => normalizeLower(brand) === normalizeLower(row?.brandName)) : true,
    )
    .map((row) => ({
      ...row,
      dsldLabelId: parseDsldLabelId(row),
    }))
    .filter((row) => row.dsldLabelId && toGtin14(row?.barcode_gtin14))
    .slice(0, LIMIT > 0 ? LIMIT : undefined);

  const dsldLabelIds = targetRows.map((row) => row.dsldLabelId);
  const [factsMap, metaMap] = await Promise.all([fetchDsldFactsMap(dsldLabelIds), fetchDsldMetaMap(dsldLabelIds)]);

  const addedRows = [];
  const fallbackQueueRows = [];
  const unresolvedRows = [];
  const stats = {
    requested: targetRows.length,
    existingInBaseStaging: 0,
    bootstrappedFromFacts: 0,
    bootstrappedFromMeta: 0,
    missingDsldSupport: 0,
  };

  for (const row of targetRows) {
    const dsldLabelId = row.dsldLabelId;
    const barcode = toGtin14(row?.barcode_gtin14);
    if (!dsldLabelId || !barcode) continue;

    if (baseBarcodeSet.has(barcode)) {
      stats.existingInBaseStaging += 1;
      continue;
    }

    const factsRow = factsMap.get(String(dsldLabelId)) ?? null;
    const metaRow = metaMap.get(String(dsldLabelId)) ?? null;
    if (!factsRow && !metaRow) {
      stats.missingDsldSupport += 1;
      unresolvedRows.push({
        candidateId: row.candidateId,
        brandName: row.brandName,
        productName: row.productName,
        barcode_gtin14: barcode,
        dsldLabelId,
        reason: "missing_dsld_facts_and_meta",
      });
      continue;
    }

    const seedRow = buildSyntheticSeedRow(row, factsRow, metaRow, dsldLabelId);
    const overlayRow = extractOverlayRecordFromSeedRow(seedRow, { seedName: "missing_from_staging_dsld_bootstrap" });
    const completeness = deriveCompleteness(overlayRow);
    const finalizedRow = {
      ...overlayRow,
      completeness: {
        ...completeness,
        status: classifyOverlayStatus(overlayRow, completeness),
      },
      readiness: {
        highConfidenceUsProductPageReady: false,
      },
    };

    addedRows.push(finalizedRow);
    baseBarcodeSet.add(barcode);
    fallbackQueueRows.push({
      productId: String(dsldLabelId),
      brandName: finalizedRow.brandName,
      title: finalizedRow.title,
      barcode_gtin14: finalizedRow.barcode_gtin14,
      priorityLane: "P0_api_fill_us_strong_identity",
      coreMissingFields: finalizedRow.completeness.coreMissingFields,
      validationOutcome: "missing_from_staging",
      sourceReasonCode: normalizeText(row?.sourceReasonCode) || "missing_directions",
      candidateId: row.candidateId ?? null,
    });
    if (factsRow?.facts_json) stats.bootstrappedFromFacts += 1;
    else stats.bootstrappedFromMeta += 1;
  }

  const augmentedStaging = {
    products: [...baseStagingRows, ...addedRows],
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      queuePath: path.relative(ROOT, QUEUE_PATH),
      baseStagingPath: path.relative(ROOT, BASE_STAGING_PATH),
      brandFilters: BRAND_FILTERS,
      limit: LIMIT || null,
    },
    summary: {
      ...stats,
      addedRows: addedRows.length,
      fallbackQueueRows: fallbackQueueRows.length,
      unresolvedRows: unresolvedRows.length,
    },
    brandRollup: Object.values(
      addedRows.reduce((acc, row) => {
        const brandName = row.brandName || "Unknown";
        acc[brandName] ??= {
          brandName,
          count: 0,
          fullCoreFieldsReady: 0,
          stillMissingFields: 0,
        };
        acc[brandName].count += 1;
        if ((row?.completeness?.coreMissingFields?.length ?? 0) === 0) acc[brandName].fullCoreFieldsReady += 1;
        else acc[brandName].stillMissingFields += 1;
        return acc;
      }, {}),
    ).sort((left, right) => right.count - left.count || left.brandName.localeCompare(right.brandName)),
    unresolvedRows,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "staging_products.dsld_bootstrap.json"), augmentedStaging),
    writeJson(path.join(OUT_DIR, "official_fallback_bootstrap_queue.json"), fallbackQueueRows),
    writeJson(path.join(OUT_DIR, "dsld_bootstrap_report.json"), report),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          staging: path.join(OUT_DIR, "staging_products.dsld_bootstrap.json"),
          queue: path.join(OUT_DIR, "official_fallback_bootstrap_queue.json"),
          report: path.join(OUT_DIR, "dsld_bootstrap_report.json"),
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
