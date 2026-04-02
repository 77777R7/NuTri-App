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

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "refill_mega_02", "execute_curated_01", "current_staging_products.scrapling_merged.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "refill_mega_02", "execute_curated_01", "merge_baseline_v2", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_03", "miner_v3"),
);

const HISTORY_SCAN_ROOT = getArg("history-root", path.join(ROOT, "output"));
const MIN_FULL = Math.max(1, Number(getArg("min-full", "4")) || 4);
const MIN_RATE = Math.max(0, Math.min(1, Number(getArg("min-rate", "0.8")) || 0.8));

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const BASE_PROVEN_SUPPLEMENT_BRANDS = new Set(
  [
    "NOW Foods",
    "California Gold Nutrition",
    "Swanson",
    "Source Naturals",
    "Carlson",
    "NutriBiotic",
    "Trace",
    "MRM Nutrition",
    "Solgar",
    "Doctor's Best",
    "Garden of Life",
    "Nutricost",
    "Nature's Way",
    "Natural Factors",
    "NaturesPlus",
    "Sports Research",
    "Metagenics",
    "Nature Made",
    "Life Extension",
    "Global Healing",
    "NutraChamps",
    "Dr. Mercola",
    "FutureBiotics",
    "Himalaya",
    "New Chapter",
    "Vibrant Health",
    "Protocol for Life Balance",
    "BodyBio",
    "Solaray",
    "Mason Natural",
    "Purity Products",
    "NB Pure",
    "Lactofit",
    "Nordic Naturals",
    "Qunol",
    "Flora",
    "MaryRuth's",
  ].map((value) => normalizeText(value)),
);

const EXPANSION_BRAND_DENYLIST = new Set(
  [
    "Orgain",
    "the Vitamin Shoppe",
    "Manitoba Harvest",
    "Waterboy",
    "Ketone-IQ",
    "Celsius",
    "Prime Hydration",
    "G FUEL",
    "YumEarth",
    "Frontier Co-op",
    "Preggie",
    "Shameless Snacks",
    "Simply Organic",
    "PB2 Foods",
    "Stonewall Kitchen",
    "Nature's Path",
    "Kiss My Keto",
    "Atkins",
    "Organic Traditions",
    "Boiron",
    "Aura Cacia",
    "PatchAid",
    "Hyland's Naturals",
    "Palmer's",
    "Life-flo",
    "MediNatura",
    "Mucinex",
    "Genexa",
    "Aleve",
    "Advil",
    "Vagisil",
    "L'Oréal",
    "Pixi Beauty",
    "Nexxus",
    "Palladio",
    "Maria Nila",
    "Black Radiance",
    "Covergirl",
    "Maybelline",
    "Physicians Formula",
  ].map((value) => normalizeText(value)),
);

const TIER2_SUPPLEMENT_ALLOWLIST = new Set(
  [
    "Amazing Nutrition",
    "Aurora Nutrascience",
    "BodyHealth",
    "BrainMD",
    "Christopher's Original Formulas",
    "CodeAge",
    "Creekside Natural Therapeutics",
    "Divine Health",
    "Double Wood Supplements",
    "Eclectic Herb",
    "Enzymedica",
    "Force Factor",
    "Greens First",
    "HealthForce Superfoods",
    "Herb Pharm",
    "Host Defense",
    "Micro Ingredients",
    "North American Herb & Spice",
    "Organic India",
    "Planetary Herbals",
    "Sovereign Silver",
    "Starwest Botanicals",
    "Vitacost",
    "Vitamatic",
    "Vitassium",
    "21st Century",
    "Advanced Orthomolecular Research AOR",
    "ALLMAX",
    "Amazing Herbs",
    "Arizona Natural",
    "Bluebonnet Nutrition",
    "ChildLife Essentials",
    "DaVinci Laboratories",
    "Dr. Murray's",
    "EHPlabs",
    "Econugenics",
    "Hi Tech Pharmaceuticals",
    "Jacked Factory",
    "KAL",
    "LifeTime Vitamins",
    "Michael's Health",
    "Natural Stacks",
    "Nature's Craft",
    "Nature's Truth",
    "Noor Vitamins",
    "ProHealth Longevity",
    "Pure Essence",
    "SmartyPants",
    "Sunergetic",
    "Sunwarrior",
    "Terry Naturally",
    "Vital Nutrients",
    "Zahler",
    "C4 / Cellucor",
  ].map((value) => normalizeText(value)),
);

const HARD_DENY_PATTERNS = [
  /\bfacial\b/i,
  /\bscrub\b/i,
  /\bshampoo\b/i,
  /\bconditioner\b/i,
  /\bcream\b/i,
  /\blotion\b/i,
  /\bserum\b/i,
  /\bsoap\b/i,
  /\bdeodorant\b/i,
  /\btea\b/i,
  /\bcoffee\b/i,
  /\bdrink mix\b/i,
  /\bsweet sweat\b/i,
  /\belectrolyte drink\b/i,
  /\bprotein bar\b/i,
  /\bbroth\b/i,
  /\bcoconut sugar\b/i,
  /\bxylitol\b/i,
  /\bcacao\b/i,
  /\bflax\b/i,
  /\bhemp\b/i,
  /\bmarinara\b/i,
  /\bhoney\b/i,
  /\bjerky\b/i,
  /\btoothpaste\b/i,
  /\bmouthwash\b/i,
  /\bmask\b/i,
  /\bsunscreen\b/i,
  /\blip balm\b/i,
  /\beyeliner\b/i,
  /\bmascara\b/i,
  /\bcosmetic\b/i,
  /\bmakeup\b/i,
  /\bcleanser\b/i,
  /\bmoisturizer\b/i,
  /\bsuppository\b/i,
  /\bvaginal\b/i,
  /\bpet\b/i,
  /\bdog\b/i,
  /\bcat\b/i,
  /\bpatch\b/i,
  /\bhomeopathic?\b/i,
  /\bointment\b/i,
  /\bbalm\b/i,
  /\bcough\b/i,
  /\bcold\b/i,
  /\bsinus\b/i,
  /\bpain relief\b/i,
  /\blaxative\b/i,
  /\bantacid\b/i,
  /\bbody wash\b/i,
  /\bessential oil\b/i,
  /\bmassage\b/i,
  /\bcandy\b/i,
  /\bgummy candy\b/i,
  /\bseasoning\b/i,
  /\bsauce\b/i,
  /\bsnack\b/i,
  /\bcrackers?\b/i,
  /\bchips?\b/i,
  /\bpopcorn\b/i,
  /\bsea salt\b/i,
  /\bformula\b/i,
  /\binfant\b/i,
  /\bbaby\b/i,
  /\blaundry\b/i,
  /\bdishwashing\b/i,
  /\bcleaning\b/i,
  /\bair freshener\b/i,
];

const SUPPLEMENT_SIGNAL_PATTERNS = [
  /\bcapsule(?:s)?\b/i,
  /\btablet(?:s)?\b/i,
  /\bsoftgel(?:s)?\b/i,
  /\bgumm(?:y|ies)\b/i,
  /\bpowder(?:s)?\b/i,
  /\bchewable\b/i,
  /\bdrops?\b/i,
  /\bspray\b/i,
  /\bpacket(?:s)?\b/i,
  /\bveg(?:gie)? caps?\b/i,
  /\bextract\b/i,
  /\btincture\b/i,
  /\bprobiotic\b/i,
  /\bmultivitamin\b/i,
  /\bvitamin\b/i,
  /\bmineral\b/i,
  /\bomega\b/i,
  /\bfish oil\b/i,
  /\bmagnesium\b/i,
  /\bmelatonin\b/i,
  /\bcreatine\b/i,
  /\bamino\b/i,
  /\bashwagandha\b/i,
  /\bberberine\b/i,
  /\bquercetin\b/i,
  /\bcurcumin\b/i,
  /\bnac\b/i,
  /\bcoq10\b/i,
  /\blutein\b/i,
  /\belderberry\b/i,
  /\bechinacea\b/i,
  /\bgarlic\b/i,
  /\benzyme\b/i,
  /\bdigestive\b/i,
  /\bgut health\b/i,
  /\bsleep\b/i,
  /\bimmune\b/i,
  /\burolithin\b/i,
  /\binositol\b/i,
  /\bnattokinase\b/i,
  /\belectrolyte\b/i,
  /\bherb\b/i,
  /\bherbal\b/i,
  /\bdetox\b/i,
  /\bcleanse\b/i,
  /\bbladder\b/i,
  /\bbrain\b/i,
  /\bjoint\b/i,
];

const synthesizeQueueRow = (stagingRow, mergeRow) => {
  const sourceTypes = Array.isArray(stagingRow?.sourceSummary?.sourceTypes) ? stagingRow.sourceSummary.sourceTypes : [];
  const knownProductUrls = [
    ...(Array.isArray(stagingRow?.sourceSummary?.sourceUrls) ? stagingRow.sourceSummary.sourceUrls : []),
    stagingRow?.link,
  ].filter((value) => /^https?:\/\//i.test(String(value ?? "")));

  return {
    priorityLane: "P0_refill_miner_v3",
    recommendedAction: "official_fill_core_fields",
    rationale: "Queued partial row mined from expanded proven supplement brand universe.",
    brandName: stagingRow?.brandName ?? mergeRow?.brandName ?? null,
    title: stagingRow?.title ?? mergeRow?.title ?? null,
    productId: stagingRow?.productId ?? mergeRow?.productId ?? null,
    barcode_gtin14: stagingRow?.barcode_gtin14 ?? stagingRow?.barcode ?? mergeRow?.barcodeGtin14 ?? null,
    hasUsIherbPage:
      Boolean(stagingRow?.sourceSummary?.hasUsIherbPage) ||
      sourceTypes.includes("iherb_us_product_page") ||
      /^https?:\/\/([a-z0-9-]+\.)?(?:ca\.)?iherb\.com\/pr\//i.test(String(stagingRow?.link ?? "")),
    highConfidenceUsProductPageReady:
      Boolean(mergeRow?.highConfidenceUsProductPageReady) || Boolean(stagingRow?.readiness?.highConfidenceUsProductPageReady),
    coreResolvedFields: mergeRow?.overlayResolvedFields ?? [],
    coreMissingFields: mergeRow?.stillMissingFields ?? [],
    sourceTypes,
    categories: stagingRow?.categories ?? [],
    dosageForm: stagingRow?.dosageForm ?? null,
    knownProductUrls: [...new Set(knownProductUrls)],
    recommendedMode: "reader_then_scrapling",
    policyReasons: ["refill_miner_v3"],
  };
};

const summarizeRows = (rows) => {
  const byBrand = {};
  for (const row of rows) {
    const brandName = normalizeText(row?.brandName ?? "Unknown");
    byBrand[brandName] = (byBrand[brandName] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    brandCount: Object.keys(byBrand).length,
    byBrand: Object.fromEntries(Object.entries(byBrand).sort((left, right) => right[1] - left[1])),
  };
};

const estimateStrictUplift = (summary) => {
  const counts = Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, Number(value?.rowCount ?? 0)]),
  );
  const conservative =
    counts.tier1Soft * 0.65 +
    counts.tier1FactsLite * 0.3 +
    counts.tier1FactsHeavy * 0.1 +
    counts.tier2Soft * 0.3 +
    counts.tier2FactsLite * 0.1 +
    counts.tier2FactsHeavy * 0.04;
  const target =
    counts.tier1Soft * 0.78 +
    counts.tier1FactsLite * 0.38 +
    counts.tier1FactsHeavy * 0.14 +
    counts.tier2Soft * 0.42 +
    counts.tier2FactsLite * 0.16 +
    counts.tier2FactsHeavy * 0.06;
  const aggressive =
    counts.tier1Soft * 0.88 +
    counts.tier1FactsLite * 0.48 +
    counts.tier1FactsHeavy * 0.18 +
    counts.tier2Soft * 0.56 +
    counts.tier2FactsLite * 0.22 +
    counts.tier2FactsHeavy * 0.08;

  return {
    conservative: Math.round(conservative),
    target: Math.round(target),
    aggressive: Math.round(aggressive),
  };
};

const buildMarkdownSummary = (manifest) => {
  const lines = [
    "# Refill Mega Campaign v3",
    "",
    `- generated_at: ${manifest.generatedAt}`,
    `- campaign_id: ${manifest.campaignId}`,
    `- total_selected_rows: ${manifest.totalSelectedRows}`,
    `- total_selected_brands: ${manifest.totalSelectedBrandCount}`,
    `- expanded_proven_brand_count: ${manifest.expandedProvenBrandCount}`,
    `- strict_goal: ${manifest.targetStrictDelta}`,
    `- projected_conservative: ${manifest.projectedStrictUplift.conservative}`,
    `- projected_target: ${manifest.projectedStrictUplift.target}`,
    `- projected_aggressive: ${manifest.projectedStrictUplift.aggressive}`,
    "",
  ];

  for (const [label, block] of [
    ["Tier 1 Soft", manifest.tier1Soft],
    ["Tier 1 Facts Lite", manifest.tier1FactsLite],
    ["Tier 1 Facts Heavy", manifest.tier1FactsHeavy],
    ["Tier 2 Soft", manifest.tier2Soft],
    ["Tier 2 Facts Lite", manifest.tier2FactsLite],
    ["Tier 2 Facts Heavy", manifest.tier2FactsHeavy],
  ]) {
    lines.push(`## ${label}`);
    lines.push(`- rows: ${block.summary.rowCount}`);
    lines.push(`- brands: ${block.summary.brandCount}`);
    for (const [brandName, count] of Object.entries(block.summary.byBrand).slice(0, 20)) {
      lines.push(`- ${brandName}: ${count}`);
    }
    lines.push("");
  }

  lines.push("## Expanded Proven Brands");
  for (const brand of manifest.expandedProvenBrands.slice(0, 80)) {
    lines.push(`- ${brand}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
};

const gatherSummaryJsonPaths = async (dirPath) => {
  const out = [];
  const walk = async (currentPath) => {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
      } else if (entry.isFile() && entry.name === "summary.json") {
        out.push(nextPath);
      }
    }
  };
  await walk(dirPath);
  return out;
};

const buildExpandedProvenBrands = async () => {
  const summaryPaths = await gatherSummaryJsonPaths(path.resolve(ROOT, HISTORY_SCAN_ROOT));
  const brandStats = new Map();

  for (const summaryPath of summaryPaths) {
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(summaryPath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(payload?.brandRuns)) continue;

    for (const brandRun of payload.brandRuns) {
      const brandName = normalizeText(brandRun?.brandName);
      if (!brandName || EXPANSION_BRAND_DENYLIST.has(brandName)) continue;
      const rowSummary = brandRun?.rowSummary ?? brandRun?.validationSummary ?? {};
      const processed = Number(rowSummary?.processed ?? 0);
      const full = Number(rowSummary?.becameFullOverlayReady ?? 0);
      if (!processed) continue;

      const current = brandStats.get(brandName) ?? { processed: 0, full: 0, runs: 0 };
      current.processed += processed;
      current.full += full;
      current.runs += 1;
      brandStats.set(brandName, current);
    }
  }

  const expanded = [...brandStats.entries()]
    .map(([brandName, stats]) => ({
      brandName,
      ...stats,
      rate: stats.processed > 0 ? stats.full / stats.processed : 0,
    }))
    .filter((entry) => entry.full >= MIN_FULL && entry.rate >= MIN_RATE)
    .sort((left, right) => right.full - left.full || right.rate - left.rate || left.brandName.localeCompare(right.brandName));

  return {
    stats: expanded,
    brandSet: new Set(expanded.map((entry) => normalizeText(entry.brandName))),
  };
};

const main = async () => {
  const { stats: expandedStats, brandSet: expandedProvenBrandSet } = await buildExpandedProvenBrands();
  const provenBrandSet = new Set([...BASE_PROVEN_SUPPLEMENT_BRANDS, ...expandedProvenBrandSet]);

  const stagingRows = await readJson(STAGING_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);
  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row?.productId), row]));
  const stagingByBarcode = new Map(
    stagingRows
      .map((row) => [normalizeText(row?.barcode_gtin14 ?? row?.barcode), row])
      .filter(([barcode]) => barcode),
  );

  const tier1Soft = [];
  const tier1FactsLite = [];
  const tier1FactsHeavy = [];
  const tier2Soft = [];
  const tier2FactsLite = [];
  const tier2FactsHeavy = [];

  for (const mergeRow of mergeReport?.rows ?? []) {
    if (normalizeLower(mergeRow?.status) !== "partial_overlay") continue;
    if (normalizeLower(mergeRow?.mergeDecision) !== "queued") continue;

    const stagingRow =
      stagingByProductId.get(normalizeText(mergeRow?.productId)) ||
      stagingByBarcode.get(normalizeText(mergeRow?.barcodeGtin14)) ||
      null;
    if (!stagingRow) continue;

    const corpus = [
      stagingRow?.brandName,
      stagingRow?.title,
      stagingRow?.dosageForm,
      ...(Array.isArray(stagingRow?.categories) ? stagingRow.categories : []),
    ]
      .map((value) => normalizeText(value))
      .join(" | ");

    if (HARD_DENY_PATTERNS.some((pattern) => pattern.test(corpus))) continue;
    if (!SUPPLEMENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(corpus))) continue;

    const missing = new Set((mergeRow?.stillMissingFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const resolved = new Set((mergeRow?.overlayResolvedFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const hasIngredient = resolved.has("ingredient");
    const hasDosage = resolved.has("dosage");
    const hasSuggestedUse = resolved.has("suggested_use");
    const hasWarnings = resolved.has("warnings");
    const hasImage = resolved.has("product_image");
    const onlySoftMissing = [...missing].every((field) => ["suggested_use", "warnings", "product_image"].includes(field));
    const brandName = normalizeText(stagingRow?.brandName);
    const queueRow = synthesizeQueueRow(stagingRow, mergeRow);
    const inTier1 = provenBrandSet.has(brandName);

    if (!inTier1 && !TIER2_SUPPLEMENT_ALLOWLIST.has(brandName)) continue;

    if (hasIngredient && hasDosage && hasImage && onlySoftMissing && (missing.has("warnings") || missing.has("suggested_use"))) {
      (inTier1 ? tier1Soft : tier2Soft).push(queueRow);
      continue;
    }

    const factsLite =
      hasSuggestedUse &&
      hasWarnings &&
      (
        (missing.size === 1 && (missing.has("ingredient") || missing.has("dosage"))) ||
        (missing.size === 2 && hasImage && (missing.has("ingredient") || missing.has("dosage")))
      );
    if (factsLite) {
      (inTier1 ? tier1FactsLite : tier2FactsLite).push(queueRow);
      continue;
    }

    if (missing.has("ingredient") && missing.has("dosage")) {
      (inTier1 ? tier1FactsHeavy : tier2FactsHeavy).push(queueRow);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    campaignId: "REFILL-MEGA-03",
    targetStrictDelta: 1000,
    inputs: {
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      mergeReportPath: path.resolve(ROOT, MERGE_REPORT_PATH),
      historyRoot: path.resolve(ROOT, HISTORY_SCAN_ROOT),
      minFull: MIN_FULL,
      minRate: MIN_RATE,
    },
    totalSelectedRows:
      tier1Soft.length +
      tier1FactsLite.length +
      tier1FactsHeavy.length +
      tier2Soft.length +
      tier2FactsLite.length +
      tier2FactsHeavy.length,
    totalSelectedBrandCount: new Set(
      [
        ...tier1Soft,
        ...tier1FactsLite,
        ...tier1FactsHeavy,
        ...tier2Soft,
        ...tier2FactsLite,
        ...tier2FactsHeavy,
      ].map((row) => normalizeText(row?.brandName)),
    ).size,
    expandedProvenBrandCount: expandedStats.length,
    expandedProvenBrands: expandedStats.map((entry) => entry.brandName),
    expandedProvenBrandStats: expandedStats,
    tier1Soft: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_soft.queue.rows.json"),
      summary: summarizeRows(tier1Soft),
    },
    tier1FactsLite: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_facts_lite.queue.rows.json"),
      summary: summarizeRows(tier1FactsLite),
    },
    tier1FactsHeavy: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_facts_heavy.queue.rows.json"),
      summary: summarizeRows(tier1FactsHeavy),
    },
    tier2Soft: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_soft.queue.rows.json"),
      summary: summarizeRows(tier2Soft),
    },
    tier2FactsLite: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_facts_lite.queue.rows.json"),
      summary: summarizeRows(tier2FactsLite),
    },
    tier2FactsHeavy: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_facts_heavy.queue.rows.json"),
      summary: summarizeRows(tier2FactsHeavy),
    },
  };

  manifest.projectedStrictUplift = estimateStrictUplift({
    tier1Soft: manifest.tier1Soft.summary,
    tier1FactsLite: manifest.tier1FactsLite.summary,
    tier1FactsHeavy: manifest.tier1FactsHeavy.summary,
    tier2Soft: manifest.tier2Soft.summary,
    tier2FactsLite: manifest.tier2FactsLite.summary,
    tier2FactsHeavy: manifest.tier2FactsHeavy.summary,
  });

  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_soft.queue.rows.json"), tier1Soft);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_facts_lite.queue.rows.json"), tier1FactsLite);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_facts_heavy.queue.rows.json"), tier1FactsHeavy);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_soft.queue.rows.json"), tier2Soft);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_facts_lite.queue.rows.json"), tier2FactsLite);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_facts_heavy.queue.rows.json"), tier2FactsHeavy);
  await writeJson(path.resolve(ROOT, OUT_DIR, "campaign_manifest.json"), manifest);
  await writeText(path.resolve(ROOT, OUT_DIR, "campaign_manifest.md"), buildMarkdownSummary(manifest));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        expandedProvenBrandCount: manifest.expandedProvenBrandCount,
        totalSelectedRows: manifest.totalSelectedRows,
        projectedStrictUplift: manifest.projectedStrictUplift,
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
