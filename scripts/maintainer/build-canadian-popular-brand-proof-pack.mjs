#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const SOURCES = {
  jamieson_pack: "data/validation/canadian-jamieson-promotion-pack.v0.json",
  merge_wave_05: "output/canadian_brand_full_coverage_wave_v0/merge_wave_05/staging_products.canadian_official_wave_05.json",
  merge_wave_19: "output/canadian_brand_full_coverage_wave_v0/merge_wave_19/staging_products.canadian_official_wave_19.json",
  wave2_final:
    "output/canadian_brand_full_coverage_wave_v0/wave_set_2_parser_lane_02_final/staging_products.canadian_wave_set_2_parser_lane_02_final.json",
  consolidated_04:
    "output/canadian_brand_full_coverage_wave_v0/retailer_ocr_lane_01/current_session_consolidated_validation_04/staging_products.canadian_current_session_consolidated_validation_04.json",
  canprev_13:
    "output/canadian_brand_full_coverage_wave_v0/retailer_ocr_lane_01/canprev_official_html_canary_13/clean_staging/staging_products.canadian_retailer_ocr_canprev_official_html_canary_13.json",
  mixed_21:
    "output/canadian_brand_full_coverage_wave_v0/retailer_ocr_lane_01/mixed_exact_upc_retailer_canary_21/staging_products.canadian_retailer_ocr_mixed_exact_upc_canary_21.json",
};

const PICKS = [
  { source: "jamieson_pack", brandName: "Jamieson", title: "100 % Pure Magnesium L-Threonate" },
  {
    source: "jamieson_pack",
    brandName: "Jamieson",
    title: "Jamieson Vitamin B12 2,500 mcg Fast‑Dissolving Tablets",
  },
  { source: "jamieson_pack", brandName: "Jamieson", title: "Vitamin D3 for Babies: Liquid Drops" },

  { source: "merge_wave_19", brandName: "Webber Naturals", title: "The Right Fibre4 Tablets" },
  { source: "merge_wave_19", brandName: "Webber Naturals", title: "Vitamin B12 Methylcobalamin 1000 mcg" },
  { source: "merge_wave_05", brandName: "Webber Naturals", title: "Triple Strength Omega-3 with CoQ10" },

  {
    source: "merge_wave_05",
    brandName: "Progressive",
    title: "Non-GMO Fermented Vegan Protein",
  },
  {
    source: "merge_wave_05",
    brandName: "Progressive",
    title: "Ultra Strength Probiotic 120 Billion",
  },
  {
    source: "merge_wave_05",
    brandName: "Progressive",
    title: "Progressive Kids Multi Chewables | Children’s Multivitamin",
  },

  {
    source: "wave2_final",
    brandName: "Natural Factors",
    title: "Raw, Organic, 100% Plant-Based Protein",
  },
  {
    source: "wave2_final",
    brandName: "Natural Factors",
    title: "Total Body Collagen Bioactive Peptides Powder (Vanilla)",
  },
  {
    source: "mixed_21",
    brandName: "Natural Factors",
    title: "Natural Factors Magnesium Bisglycinate 200mg Pure - 290g",
  },

  { source: "canprev_13", brandName: "CanPrev", title: "ACES + Zinc & Copper" },
  { source: "canprev_13", brandName: "CanPrev", title: "Ashwagandha Body & Mind" },
  { source: "canprev_13", brandName: "CanPrev", title: "B12 Methyl 500mcg Drops - Blueberry" },

  { source: "consolidated_04", brandName: "AOR", title: "AOR 5-HTP 50mg - 90 V-Caps" },
  { source: "consolidated_04", brandName: "AOR", title: "AOR Advanced B-Complex - 180 Caps" },
  { source: "consolidated_04", brandName: "AOR", title: "AOR Berberine - 60 Caps" },

  { source: "wave2_final", brandName: "Organika", title: "Belli-Bliss Glucose Fibre" },
  { source: "wave2_final", brandName: "Organika", title: "Black Cumin Seed Oil" },

  { source: "wave2_final", brandName: "New Roots Herbal", title: "active mag" },
  { source: "wave2_final", brandName: "New Roots Herbal", title: "alpha lipoic 250 mg" },
  { source: "wave2_final", brandName: "New Roots Herbal", title: "ashwagandha" },

  {
    source: "consolidated_04",
    brandName: "Prairie Naturals",
    title: "Prairie Naturals Astaxanthin Plus - 60 Softgels",
  },
  {
    source: "consolidated_04",
    brandName: "Prairie Naturals",
    title: "Prairie Naturals Activated B-Force 50 - 60 V-Caps",
  },
  {
    source: "consolidated_04",
    brandName: "Prairie Naturals",
    title: "Prairie Naturals Vitamin K2 MK-7 100mcg - 60 V-Caps",
  },

  {
    source: "consolidated_04",
    brandName: "Genuine Health",
    title: "Genuine Health high fibre gut superfoods+ unflavoured unsweetened, stevia free",
  },
  {
    source: "consolidated_04",
    brandName: "Genuine Health",
    title: "Genuine Health clean collagen bovine unflavoured unsweetened, stevia free",
  },
  {
    source: "consolidated_04",
    brandName: "Genuine Health",
    title: "Genuine Health clean collagen marine unflavoured unsweetened, stevia free",
  },

  { source: "consolidated_04", brandName: "Genestra", title: "Genestra HMF Super Powder - 138g" },
  { source: "consolidated_04", brandName: "Genestra", title: "Genestra Super EFA Caps - 120 Caps" },
  { source: "consolidated_04", brandName: "Genestra", title: "Genestra HMF Multi Strain Powder - 60g" },

  { source: "consolidated_04", brandName: "Sisu", title: "Sisu Vitamin D 1000 IU - 400 Tabs" },
  {
    source: "consolidated_04",
    brandName: "Sisu",
    title: "Sisu Ester-C 500mg Chewable Wildberry - 90 Tabs",
  },
  {
    source: "consolidated_04",
    brandName: "Sisu",
    title: "Sisu Cal Mag Citrate Creamy Strawberry - 450ml",
  },

  {
    source: "consolidated_04",
    brandName: "NOW Canada",
    title: "NOW Calcium Magnesium with Vitamin D and Zinc - 120 Softgels",
  },
  {
    source: "consolidated_04",
    brandName: "NOW Canada",
    title: "NOW Magnesium Citrate 133mg - 120 V-Caps",
  },
  {
    source: "consolidated_04",
    brandName: "NOW Canada",
    title: "NOW Magnesium Bisglycinate 100mg - 180 Tabs",
  },

  {
    source: "consolidated_04",
    brandName: "Codeage Canada",
    title: "Codeage ADK Vitamins - 180 Capsules",
  },
];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getRows = (payload) => payload?.products ?? payload?.rows ?? [];

const main = async () => {
  const loaded = new Map();

  for (const [alias, relativePath] of Object.entries(SOURCES)) {
    const absolutePath = path.resolve(ROOT, relativePath);
    const payload = JSON.parse(await fs.readFile(absolutePath, "utf8"));
    loaded.set(alias, {
      relativePath,
      rows: getRows(payload),
    });
  }

  const products = [];
  const missing = [];

  for (const pick of PICKS) {
    const source = loaded.get(pick.source);
    if (!source) {
      missing.push({ ...pick, reason: "missing_source_alias" });
      continue;
    }
    const row = source.rows.find(
      (candidate) =>
        normalizeText(candidate.brandName) === normalizeText(pick.brandName) &&
        normalizeText(candidate.title) === normalizeText(pick.title),
    );
    if (!row) {
      missing.push({ ...pick, sourcePath: source.relativePath, reason: "missing_row" });
      continue;
    }
    products.push({
      ...JSON.parse(JSON.stringify(row)),
      proofPackSource: {
        alias: pick.source,
        path: source.relativePath,
      },
    });
  }

  if (missing.length > 0) {
    console.error(JSON.stringify({ ok: false, missing }, null, 2));
    process.exit(1);
  }

  const byBrand = products.reduce((acc, row) => {
    acc[row.brandName] = (acc[row.brandName] ?? 0) + 1;
    return acc;
  }, {});

  const payload = {
    schemaVersion: "canadian_popular_brand_proof_pack.v0",
    generatedAt: new Date().toISOString(),
    purpose:
      "Fresh popular-brand Canadian proof pack spanning the current release-grade Canadian brands across official, parser, and retailer/OCR lanes.",
    sources: SOURCES,
    summary: {
      selected: products.length,
      brandCount: Object.keys(byBrand).length,
      byBrand,
    },
    products,
  };

  const outJson = path.resolve(ROOT, "data/validation/canadian-popular-brand-proof-pack.v0.json");
  const outMd = path.resolve(ROOT, "data/validation/canadian-popular-brand-proof-pack.v0.md");

  const md = [
    "# canadian-popular-brand-proof-pack.v0",
    "",
    `- selected: ${products.length}`,
    `- brandCount: ${Object.keys(byBrand).length}`,
    "",
    "## By Brand",
    "",
    ...Object.entries(byBrand).map(([brand, count]) => `- ${brand}: ${count}`),
    "",
    "## Products",
    "",
    ...products.map(
      (row) =>
        `- ${row.brandName} | ${row.title} | ${normalizeText(row.barcode_gtin14 ?? row.upcCode) || "no-barcode"} | ${row.proofPackSource.path}`,
    ),
    "",
  ].join("\n");

  await fs.writeFile(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, `${md}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          json: path.relative(ROOT, outJson),
          md: path.relative(ROOT, outMd),
        },
        summary: payload.summary,
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
