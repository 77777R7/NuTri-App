#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import {
  buildOverlayRecordKey,
  classifyOverlayStatus,
  deriveCompleteness,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";
import { ROOT_DIR, writeJson } from "./lib/science-validation-reporting.mjs";

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: false });

const parseArgs = () => {
  const values = {
    manifestJson: null,
    outPath: null,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--manifest-json" && next) {
      values.manifestJson = next;
      index += 1;
    } else if (arg === "--out-path" && next) {
      values.outPath = next;
      index += 1;
    }
  }
  return values;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT_DIR, filePath), "utf8"));

const inferDosageForm = (title) => {
  const text = normalizeText(title).toLowerCase();
  if (!text) return null;
  if (text.includes("softgel")) return "softgels";
  if (text.includes("capsule")) return "capsules";
  if (text.includes("tablet")) return "tablets";
  if (text.includes("powder")) return "powder";
  if (text.includes("liquid")) return "liquid";
  if (text.includes("spray")) return "spray";
  if (text.includes("gummy")) return "gummies";
  if (text.includes("tea")) return "tea";
  return null;
};

const fetchRowsByProductIds = async ({ supabase, productIds, batchSize = 200 }) => {
  const rows = [];
  for (let index = 0; index < productIds.length; index += batchSize) {
    const chunk = productIds.slice(index, index + batchSize);
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select("product_id,brand_name,title,barcode_gtin14,upc_code,link,product_catalog_image,product_images,categories,supplement_facts,description_sections")
      .in("product_id", chunk);
    if (error) {
      throw new Error(`Failed to fetch wave staging rows: ${error.message}`);
    }
    rows.push(...(Array.isArray(data) ? data : []));
  }
  return rows;
};

const toStagingRow = (row) => {
  const base = {
    brandName: normalizeText(row?.brand_name) || null,
    title: normalizeText(row?.title) || null,
    normalizedTitle: normalizeText(row?.title) || null,
    productId: normalizeText(row?.product_id) || null,
    upcCode: normalizeText(row?.upc_code) || null,
    barcode_gtin14: normalizeText(row?.barcode_gtin14) || null,
    link: normalizeText(row?.link) || null,
    productCatalogImage: normalizeText(row?.product_catalog_image) || null,
    productImages: Array.isArray(row?.product_images) ? row.product_images.filter(Boolean) : [],
    categories: Array.isArray(row?.categories) ? row.categories.filter(Boolean) : [],
    count: null,
    dosageForm: inferDosageForm(row?.title),
    serving: {
      servingType: null,
      servingDescription: null,
      servingSize: normalizeText(row?.supplement_facts?.servingSize ?? row?.supplement_facts?.serving_size ?? null) || null,
      servingsPerContainer: null,
    },
    supplementFacts:
      row?.supplement_facts && typeof row.supplement_facts === "object"
        ? row.supplement_facts
        : { nutritionalFacts: [] },
    descriptionSections:
      row?.description_sections && typeof row.description_sections === "object"
        ? row.description_sections
        : {},
    sourceSummary: {
      sourceKind: "db_overlay_snapshot",
      sourceTypes: ["iherb_us_product_page"],
      marketSources: ["us"],
      sourceUrls: normalizeText(row?.link) ? [normalizeText(row.link)] : [],
      sourceNotes: ["full_db_api_fill_wave_staging"],
      npnIgnored: false,
      hasUsIherbPage: true,
      sourceRank: 100,
    },
  };

  const completeness = deriveCompleteness(base);
  const status = classifyOverlayStatus(base, completeness);
  const readiness = {
    highConfidenceUsProductPageReady: qualifiesHighConfidenceUsProductPage(base, completeness),
  };

  return {
    ...base,
    overlayRecordKey: buildOverlayRecordKey(base),
    completeness: {
      ...completeness,
      status,
    },
    readiness,
    patchStrategy: null,
    overlaySha256: stableHash({
      brandName: base.brandName,
      title: base.title,
      barcode_gtin14: base.barcode_gtin14,
      supplementFacts: base.supplementFacts,
      descriptionSections: base.descriptionSections,
      sourceSummary: base.sourceSummary,
    }),
  };
};

const main = async () => {
  const args = parseArgs();
  if (!args.manifestJson) {
    throw new Error("Missing --manifest-json");
  }
  const manifest = await readJson(args.manifestJson);
  const outPath = args.outPath
    ? path.resolve(ROOT_DIR, args.outPath)
    : path.join(path.dirname(path.resolve(ROOT_DIR, args.manifestJson)), "staging_products.json");

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const productIds = [...new Set((manifest?.brands ?? []).flatMap((brand) => brand?.productIds ?? []).map((value) => normalizeText(value)).filter(Boolean))];
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows = await fetchRowsByProductIds({ supabase, productIds });
  const stagingRows = rows.map(toStagingRow);

  await writeJson(path.relative(ROOT_DIR, outPath), {
    schemaVersion: "official_wave_staging_from_db.v1",
    generatedAt: new Date().toISOString(),
    manifestPath: path.relative(ROOT_DIR, path.resolve(ROOT_DIR, args.manifestJson)),
    totalProducts: stagingRows.length,
    products: stagingRows,
  });

  console.error(`[official-wave-staging] manifest=${path.relative(ROOT_DIR, path.resolve(ROOT_DIR, args.manifestJson))}`);
  console.error(`[official-wave-staging] products=${stagingRows.length}`);
  console.error(`[official-wave-staging] wrote ${path.relative(ROOT_DIR, outPath)}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
