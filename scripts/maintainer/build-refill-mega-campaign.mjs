#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText, normalizeLower } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const MASTER_QUEUE_PATH = getArg(
  "master-queue-json",
  path.join(ROOT, "output", "refill_mega_01", "hygiene", "human_supplement_master_queue.rows.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "reseed_campaign_01", "run", "overlay_merge_coverage_report.updated.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_01", "miner"),
);

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const R1_BRAND_ALLOWLIST = new Set(
  [
    "ALPHA LION",
    "Aurora Nutrascience",
    "BodyBio",
    "California Gold Nutrition",
    "Carlson",
    "Doctor's Best",
    "Double Wood Supplements",
    "Dr. Mercola",
    "FutureBiotics",
    "Garden of Life",
    "Global Healing",
    "HealthForce Superfoods",
    "Himalaya",
    "Host Defense",
    "MRM Nutrition",
    "Natural Factors",
    "Nature's Way",
    "NaturesPlus",
    "New Chapter",
    "NOW Foods",
    "NutraChamps",
    "NutriBiotic",
    "Nutricost",
    "Organic India",
    "Probase Nutrition",
    "Protocol for Life Balance",
    "Solgar",
    "Source Naturals",
    "Sports Research",
    "Swanson",
    "Trace",
    "Vibrant Health",
    "Yunnan Baiyao",
  ].map((value) => normalizeText(value)),
);

const R2_BRAND_ALLOWLIST = new Set(
  [
    "California Gold Nutrition",
    "Carlson",
    "Eclectic Herb",
    "Metagenics",
    "Natural Factors",
    "Nature Made",
    "Nature's Way",
    "NaturesPlus",
    "NOW Foods",
    "Protocol for Life Balance",
    "Source Naturals",
    "Sports Research",
    "Swanson",
    "Vitacost",
  ].map((value) => normalizeText(value)),
);

const R3_BRAND_ALLOWLIST = new Set(
  [
    "California Gold Nutrition",
    "Carlson",
    "Natural Factors",
    "Nature's Way",
    "NaturesPlus",
    "NOW Foods",
    "Source Naturals",
    "Swanson",
  ].map((value) => normalizeText(value)),
);

const HARD_DENY_BRANDS = new Set(
  [
    "Waterboy",
    "Ketone-IQ",
    "Celsius",
    "Prime Hydration",
    "G FUEL",
    "Earth Circle Organics",
    "Organic Traditions",
    "PB2 Foods",
    "RxSugar",
    "Julian Bakery",
    "Laird Superfood",
    "Lawry's",
    "Knorr",
    "Miss Jones Baking Co",
    "Manitoba Harvest",
    "Perk Energy",
    "Craftmix",
    "Ultima Replenisher",
    "JUNP Hydration",
  ].map((value) => normalizeText(value)),
);

const HARD_DENY_TITLE_PATTERNS = [
  /\bhydrat(?:e|ion)\b/i,
  /\belectrolyte\b/i,
  /\bdrink mix\b/i,
  /\btea\b/i,
  /\bcoffee\b/i,
  /\bscrub\b/i,
  /\bfacial\b/i,
  /\bshampoo\b/i,
  /\bconditioner\b/i,
  /\bprotein bar\b/i,
  /\bbroth\b/i,
  /\bsyrup\b/i,
  /\bcoconut sugar\b/i,
  /\bxylitol\b/i,
  /\bcacao\b/i,
  /\bflax\b/i,
  /\bhemp\b/i,
  /\bsweet sweat\b/i,
  /\bempty capsules?\b/i,
  /\bsolutions\b/i,
  /\benergy drink\b/i,
  /\bmarinara\b/i,
  /\bhoney\b/i,
  /\bjerky\b/i,
  /\btoothpaste\b/i,
  /\bmouthwash\b/i,
  /\bsoap\b/i,
  /\bcream\b/i,
  /\blotion\b/i,
  /\bserum\b/i,
  /\bmask\b/i,
  /\bsunscreen\b/i,
];

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const hasDeniedSignals = (brandName, title) => {
  if (HARD_DENY_BRANDS.has(normalizeText(brandName))) return true;
  return HARD_DENY_TITLE_PATTERNS.some((pattern) => pattern.test(String(title ?? "")));
};

const summarizeRows = (rows) => {
  const byBrand = {};
  for (const row of rows) {
    const brand = normalizeText(row?.brandName ?? "Unknown");
    byBrand[brand] = (byBrand[brand] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    brandCount: Object.keys(byBrand).length,
    byBrand: Object.fromEntries(Object.entries(byBrand).sort((left, right) => right[1] - left[1])),
  };
};

const buildMarkdownSummary = (manifest) => {
  const lines = [
    "# Refill Mega Campaign",
    "",
    `- generated_at: ${manifest.generatedAt}`,
    `- campaign_id: ${manifest.campaignId}`,
    `- total_selected_rows: ${manifest.selectedRows}`,
    `- total_selected_brands: ${manifest.selectedBrandCount}`,
    `- r1_rows: ${manifest.r1.summary.rowCount}`,
    `- r2_rows: ${manifest.r2.summary.rowCount}`,
    `- r3_rows: ${manifest.r3.summary.rowCount}`,
    "",
    "## R1 Top Brands",
  ];
  for (const [brandName, count] of Object.entries(manifest.r1.summary.byBrand).slice(0, 20)) {
    lines.push(`- ${brandName}: ${count}`);
  }
  lines.push("", "## R2 Top Brands");
  for (const [brandName, count] of Object.entries(manifest.r2.summary.byBrand).slice(0, 20)) {
    lines.push(`- ${brandName}: ${count}`);
  }
  lines.push("", "## R3 Top Brands");
  for (const [brandName, count] of Object.entries(manifest.r3.summary.byBrand).slice(0, 20)) {
    lines.push(`- ${brandName}: ${count}`);
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const queueRows = await readJson(MASTER_QUEUE_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);
  const mergeByProductId = new Map((mergeReport?.rows ?? []).map((row) => [normalizeText(row?.productId), row]));

  const r1Rows = [];
  const r2Rows = [];
  const r3Rows = [];
  const seen = new Set();

  for (const queueRow of queueRows) {
    const productId = normalizeText(queueRow?.productId);
    const mergeRow = mergeByProductId.get(productId);
    if (!mergeRow) continue;
    if (normalizeLower(mergeRow?.status) !== "partial_overlay") continue;
    if (normalizeLower(mergeRow?.mergeDecision) !== "queued") continue;

    const brandName = normalizeText(queueRow?.brandName);
    const title = normalizeText(queueRow?.title);
    if (hasDeniedSignals(brandName, title)) continue;

    const missing = new Set((mergeRow?.stillMissingFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const resolved = new Set((mergeRow?.overlayResolvedFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const hasIngredient = resolved.has("ingredient");
    const hasDosage = resolved.has("dosage");
    const hasSuggestedUse = resolved.has("suggested_use");
    const hasWarnings = resolved.has("warnings");
    const hasImage = resolved.has("product_image");
    const highConfidenceUsPath = Boolean(mergeRow?.highConfidenceUsProductPageReady);
    const onlySoftMissing = [...missing].every((field) => ["suggested_use", "warnings", "product_image"].includes(field));

    if (
      R1_BRAND_ALLOWLIST.has(brandName) &&
      hasIngredient &&
      hasDosage &&
      hasImage &&
      onlySoftMissing &&
      (missing.has("suggested_use") || missing.has("warnings"))
    ) {
      const key = `r1:${productId}`;
      if (!seen.has(key)) {
        r1Rows.push(queueRow);
        seen.add(key);
      }
      continue;
    }

    if (
      R3_BRAND_ALLOWLIST.has(brandName) &&
      highConfidenceUsPath &&
      hasIngredient &&
      hasDosage &&
      missing.size > 0 &&
      missing.size <= 2 &&
      (missing.has("suggested_use") || missing.has("warnings") || missing.has("product_image"))
    ) {
      const key = `r3:${productId}`;
      if (!seen.has(key)) {
        r3Rows.push(queueRow);
        seen.add(key);
      }
      continue;
    }

    const singleFactsLite =
      hasSuggestedUse &&
      hasWarnings &&
      (
        (missing.size === 1 && (missing.has("ingredient") || missing.has("dosage"))) ||
        (missing.size === 2 && hasImage && (missing.has("ingredient") || missing.has("dosage")))
      );

    if (R2_BRAND_ALLOWLIST.has(brandName) && singleFactsLite) {
      const key = `r2:${productId}`;
      if (!seen.has(key)) {
        r2Rows.push(queueRow);
        seen.add(key);
      }
    }
  }

  const allRows = [...r1Rows, ...r3Rows, ...r2Rows];
  const manifest = {
    generatedAt: new Date().toISOString(),
    campaignId: "REFILL-MEGA-01",
    inputs: {
      masterQueuePath: path.resolve(ROOT, MASTER_QUEUE_PATH),
      mergeReportPath: path.resolve(ROOT, MERGE_REPORT_PATH),
    },
    selectedRows: allRows.length,
    selectedBrandCount: new Set(allRows.map((row) => normalizeText(row?.brandName))).size,
    r1: {
      laneId: "lane_a_soft_field",
      queuePath: path.resolve(ROOT, OUT_DIR, "r1.queue.rows.json"),
      summary: summarizeRows(r1Rows),
      brandAllowlist: [...R1_BRAND_ALLOWLIST].sort(),
    },
    r2: {
      laneId: "lane_b_facts_recovery",
      queuePath: path.resolve(ROOT, OUT_DIR, "r2.queue.rows.json"),
      summary: summarizeRows(r2Rows),
      brandAllowlist: [...R2_BRAND_ALLOWLIST].sort(),
    },
    r3: {
      laneId: "lane_a_soft_field",
      queuePath: path.resolve(ROOT, OUT_DIR, "r3.queue.rows.json"),
      summary: summarizeRows(r3Rows),
      brandAllowlist: [...R3_BRAND_ALLOWLIST].sort(),
    },
    combinedQueuePath: path.resolve(ROOT, OUT_DIR, "combined.queue.rows.json"),
    hardDenyBrands: [...HARD_DENY_BRANDS].sort(),
  };

  await writeJson(path.resolve(ROOT, OUT_DIR, "combined.queue.rows.json"), allRows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "r1.queue.rows.json"), r1Rows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "r2.queue.rows.json"), r2Rows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "r3.queue.rows.json"), r3Rows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "campaign_manifest.json"), manifest);
  await writeText(path.resolve(ROOT, OUT_DIR, "campaign_manifest.md"), buildMarkdownSummary(manifest));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        selectedRows: manifest.selectedRows,
        r1Rows: manifest.r1.summary.rowCount,
        r2Rows: manifest.r2.summary.rowCount,
        r3Rows: manifest.r3.summary.rowCount,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
