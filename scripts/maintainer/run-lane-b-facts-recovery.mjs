#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { normalizeLower, normalizeText } from "./lib/iherb-overlay-utils.mjs";

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
  path.join(
    ROOT,
    "output",
    "p0_p3_codeage_remaining_six_closure_20260317",
    "unified_wave",
    "staging_products.official_refreshed.sanitized.json",
  ),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "scrapling_human_supplement_master_queue_hold-push-v10", "human_supplement_master_queue.rows.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `lane_b_facts_recovery_${new Date().toISOString().replace(/[:.]/g, "-")}`),
);
const EXECUTE = getArg("execute", "true") === "true";
const ENABLE_AGENT_BROWSER_FALLBACK = getArg("agent-browser-fallback", "false") === "true";
const DELAY_MS = Number(getArg("delay-ms", 500)) || 0;
const REQUEST_TIMEOUT_MS = Number(getArg("request-timeout-ms", 10000)) || 10000;
const MAX_RETRIES = Number(getArg("max-retries", 1)) || 1;

const BRAND_CONFIG_PATHS = {
  "Sports Research": path.join(ROOT, "data", "iherb_official_fallback_configs", "sports-research.json"),
  "California Gold Nutrition": path.join(ROOT, "data", "iherb_official_fallback_configs", "california-gold-nutrition.json"),
  Swanson: path.join(ROOT, "data", "iherb_official_fallback_configs", "swanson.json"),
};

const BRANDS = [
  {
    brandName: "Sports Research",
    laneKey: "sports-research",
    source: "iherb-confirmed",
    exclusions: [
      { kind: "title", pattern: /\bsweet sweat\b/i, reason: "sports_research_sweet_sweat_non_supplement" },
      { kind: "title", pattern: /\bab wheel\b/i, reason: "sports_research_equipment_non_supplement" },
      { kind: "title", pattern: /\bjump rope\b/i, reason: "sports_research_equipment_non_supplement" },
      { kind: "title", pattern: /\btrimmer\b/i, reason: "sports_research_equipment_non_supplement" },
      { kind: "title", pattern: /\bpush up bars\b/i, reason: "sports_research_equipment_non_supplement" },
      { kind: "title", pattern: /\bbands?\b/i, reason: "sports_research_equipment_non_supplement" },
      { kind: "title", pattern: /\bavocado\b/i, reason: "sports_research_food_oil_non_lane_b" },
      {
        kind: "category",
        pattern: /\bexercise & fitness accessories\b/i,
        reason: "sports_research_accessory_category_non_supplement",
      },
    ],
  },
  {
    brandName: "California Gold Nutrition",
    laneKey: "california-gold-nutrition",
    source: "iherb-confirmed",
    exclusions: [
      { kind: "title", pattern: /\bfoods,\b/i, reason: "cgn_foods_line_non_lane_b" },
      { kind: "title", pattern: /\bfreeze-dried\b/i, reason: "cgn_food_snack_non_lane_b" },
      { kind: "title", pattern: /\borganic parsley\b/i, reason: "cgn_spice_non_lane_b" },
      { kind: "title", pattern: /\bsaigon cinnamon\b/i, reason: "cgn_spice_non_lane_b" },
      { kind: "title", pattern: /\bchia seeds?\b/i, reason: "cgn_seed_food_non_lane_b" },
      { kind: "title", pattern: /\b3-seed blend\b/i, reason: "cgn_seed_food_non_lane_b" },
      { kind: "title", pattern: /\bpet\b/i, reason: "cgn_pet_non_human" },
      { kind: "title", pattern: /\bbeauty,\b/i, reason: "cgn_beauty_topical_non_lane_b" },
      { kind: "title", pattern: /\bserum\b/i, reason: "cgn_topical_non_lane_b" },
      { kind: "title", pattern: /\bshampoo\b/i, reason: "cgn_topical_non_lane_b" },
      { kind: "title", pattern: /\bconditioner\b/i, reason: "cgn_topical_non_lane_b" },
      { kind: "title", pattern: /\bbalm\b/i, reason: "cgn_topical_non_lane_b" },
      { kind: "title", pattern: /\bcream\b/i, reason: "cgn_topical_non_lane_b" },
    ],
  },
  {
    brandName: "Swanson",
    laneKey: "swanson",
    source: "iherb-confirmed",
    exclusions: [
      { kind: "title", pattern: /\bmagnesium oil\b/i, reason: "swanson_topical_non_lane_b" },
      { kind: "title", pattern: /\bmagnesium chloride flakes\b/i, reason: "swanson_bath_topical_non_lane_b" },
      { kind: "title", pattern: /\btea bags?\b/i, reason: "swanson_tea_non_lane_b" },
      { kind: "title", pattern: /\bcoffee\b/i, reason: "swanson_coffee_non_lane_b" },
      { kind: "title", pattern: /\bcream\b/i, reason: "swanson_topical_non_lane_b" },
      { kind: "title", pattern: /\blotion\b/i, reason: "swanson_topical_non_lane_b" },
      { kind: "title", pattern: /\bsoap\b/i, reason: "swanson_topical_non_lane_b" },
      { kind: "title", pattern: /\boil\b/i, reason: "swanson_topical_non_lane_b", unless: /\bfish oil\b|\bkrill oil\b|\bomega\b/i },
      { kind: "category", pattern: /\bface moisturizers? & creams\b/i, reason: "swanson_topical_category_non_lane_b" },
    ],
  },
  {
    brandName: "Source Naturals",
    laneKey: "source-naturals",
    source: "iherb-confirmed",
    runtimeConfig: {
      schemaVersion: "iherb_official_fallback_config.v1",
      brandName: "Source Naturals",
      priorityLane: "P0_api_fill_us_strong_identity",
      siteOrigin: "https://www.sourcenaturals.com",
      readerPrefix: "https://r.jina.ai/http://",
      searchPathTemplate: "/search?q={query}",
      enableAgentBrowserFallback: true,
      enableImageOcrFallback: true,
      enableStagedImageOcr: true,
      ocrMaxImages: 6,
      brochureFilenameOverrides: {},
      manualSectionOverrides: {},
      manualSupplementFactsOverrides: {},
      productPageUrlOverrides: {},
      searchQueryOverrides: {},
    },
    exclusions: [
      { kind: "title", pattern: /\bwellguard\b/i, reason: "source_naturals_homeopathy_non_lane_b" },
      { kind: "title", pattern: /\bhomeopathic\b/i, reason: "source_naturals_homeopathy_non_lane_b" },
      { kind: "title", pattern: /\bcough syrup\b/i, reason: "source_naturals_otc_non_lane_b" },
      { kind: "title", pattern: /\bserum\b/i, reason: "source_naturals_topical_non_lane_b" },
      { kind: "title", pattern: /\bcream\b/i, reason: "source_naturals_topical_non_lane_b" },
      { kind: "title", pattern: /\boil of oregano\b/i, reason: "source_naturals_otc_non_lane_b" },
      { kind: "category", pattern: /\bhomeopathy\b/i, reason: "source_naturals_homeopathy_non_lane_b" },
      { kind: "category", pattern: /\bmedicine cabinet\b/i, reason: "source_naturals_otc_non_lane_b" },
      { kind: "category", pattern: /\bcombination remedies\b/i, reason: "source_naturals_otc_non_lane_b" },
    ],
  },
];

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const runNodeScript = (scriptPath, scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
      },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
    child.on("error", reject);
  });

const toArray = (value) => (Array.isArray(value) ? value : []);

const cleanupSearchText = (value, brandName) =>
  normalizeText(value)
    .replace(new RegExp(`^${brandName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")},\\s*`, "i"), "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[®™•]/g, " ")
    .replace(/\+/g, " ")
    .replace(/[']/g, "")
    .replace(/\b\d+\s+(capsules?|softgel capsules?|softgels?|packets?|packet|tablets?|lozenges?|wafers?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchQueries = (title, brandName) => {
  const withoutBrand = normalizeText(title).replace(
    new RegExp(`^${brandName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")},\\s*`, "i"),
    "",
  );
  const parts = withoutBrand
    .replace(/\([^)]*\)/g, " ")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const nonPackagingParts = parts.filter(
    (item) =>
      !/^\d+\s+(capsules?|softgel capsules?|softgels?|packets?|packet|tablets?|lozenges?|wafers?)$/i.test(item),
  );

  const candidates = [
    cleanupSearchText(nonPackagingParts.join(" "), brandName),
    cleanupSearchText(nonPackagingParts.slice(0, 2).join(" "), brandName),
    cleanupSearchText(nonPackagingParts[0] ?? "", brandName),
    cleanupSearchText(withoutBrand, brandName),
  ].filter(Boolean);

  const extras = [];
  for (const candidate of candidates) {
    extras.push(candidate.replace(/\s+/g, " ").trim());
    extras.push(candidate.replace(/\bplus\b/gi, " ").replace(/\s+/g, " ").trim());
    extras.push(candidate.replace(/-/g, " ").replace(/\s+/g, " ").trim());
  }

  return [...new Set([...candidates, ...extras].filter(Boolean))];
};

const rowNeedsFactsRecovery = (row) => {
  const missing = new Set(toArray(row?.coreMissingFields));
  return missing.has("ingredient") || missing.has("dosage");
};

const matchExclusion = (row, exclusion) => {
  const title = normalizeText(row?.title);
  const categories = toArray(row?.categories).join(" | ");
  const haystack = exclusion.kind === "category" ? categories : title;
  if (!exclusion.pattern.test(haystack)) return false;
  if (exclusion.unless && exclusion.unless.test(haystack)) return false;
  return true;
};

const buildLaneRows = (queueRows, brandDef) => {
  const brandRows = queueRows.filter(
    (row) => normalizeText(row?.brandName) === brandDef.brandName && rowNeedsFactsRecovery(row),
  );

  const kept = [];
  const excluded = [];
  for (const row of brandRows) {
    const hit = brandDef.exclusions.find((exclusion) => matchExclusion(row, exclusion));
    if (hit) {
      excluded.push({
        productId: row.productId ?? null,
        title: row.title ?? null,
        exclusionReason: hit.reason,
        coreMissingFields: toArray(row?.coreMissingFields),
        knownProductUrls: toArray(row?.knownProductUrls),
      });
      continue;
    }
    kept.push(row);
  }

  return { brandRows, kept, excluded };
};

const loadBaseConfig = async (brandDef) => {
  if (brandDef.runtimeConfig) {
    return JSON.parse(JSON.stringify(brandDef.runtimeConfig));
  }
  const configPath = BRAND_CONFIG_PATHS[brandDef.brandName];
  if (!configPath) {
    throw new Error(`Missing config path for ${brandDef.brandName}`);
  }
  return readJson(configPath);
};

const buildRuntimeConfig = async (brandDef, queueRows) => {
  const config = await loadBaseConfig(brandDef);
  const mergedOverrides = { ...(config.searchQueryOverrides ?? {}) };
  for (const row of queueRows) {
    const productId = normalizeText(row?.productId);
    if (!productId) continue;
    if (mergedOverrides[productId]) continue;
    mergedOverrides[productId] = buildSearchQueries(row?.title ?? "", brandDef.brandName);
  }
  config.brandName = brandDef.brandName;
  config.enableAgentBrowserFallback = ENABLE_AGENT_BROWSER_FALLBACK;
  config.searchQueryOverrides = mergedOverrides;
  return config;
};

const buildStagingIndex = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const productId = normalizeText(row?.productId);
    if (!productId) continue;
    map.set(`${normalizeLower(row?.brandName ?? "")}||${productId}`, row);
  }
  return map;
};

const getMissingFields = (row) => toArray(row?.completeness?.coreMissingFields);

const compareBrandRows = (beforeRows, afterRows, brandName, targetIds) => {
  const beforeIndex = buildStagingIndex(beforeRows);
  const afterIndex = buildStagingIndex(afterRows);
  const rows = [];
  const summary = {
    processed: 0,
    improvedRows: 0,
    becameFullOverlayReady: 0,
    filledIngredient: 0,
    filledDosage: 0,
    filledSuggestedUse: 0,
    filledWarnings: 0,
    filledProductImage: 0,
  };

  for (const productId of targetIds) {
    const key = `${normalizeLower(brandName)}||${normalizeText(productId)}`;
    const before = beforeIndex.get(key);
    const after = afterIndex.get(key);
    if (!before || !after) continue;
    const beforeMissing = getMissingFields(before);
    const afterMissing = getMissingFields(after);
    const filledFields = beforeMissing.filter((field) => !afterMissing.includes(field));
    const beforeStatus = before?.completeness?.status ?? null;
    const afterStatus = after?.completeness?.status ?? null;
    const improved = filledFields.length > 0 || beforeStatus !== afterStatus;
    rows.push({
      productId,
      title: after?.title ?? before?.title ?? null,
      beforeMissingFields: beforeMissing,
      afterMissingFields: afterMissing,
      filledFields,
      beforeStatus,
      afterStatus,
      improved,
    });
    summary.processed += 1;
    if (improved) summary.improvedRows += 1;
    if (beforeStatus !== "full_overlay_ready" && afterStatus === "full_overlay_ready") summary.becameFullOverlayReady += 1;
    if (filledFields.includes("ingredient")) summary.filledIngredient += 1;
    if (filledFields.includes("dosage")) summary.filledDosage += 1;
    if (filledFields.includes("suggested_use")) summary.filledSuggestedUse += 1;
    if (filledFields.includes("warnings")) summary.filledWarnings += 1;
    if (filledFields.includes("product_image")) summary.filledProductImage += 1;
  }
  return { rows, summary };
};

const buildMarkdownReport = (report) => {
  const lines = [
    "# Lane B Facts Recovery",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- execute: ${report.execute}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of report.brands) {
    lines.push(`### ${brand.brandName}`);
    lines.push(`- facts_candidates_before_hygiene: ${brand.factsCandidatesBeforeHygiene}`);
    lines.push(`- excluded_by_hygiene: ${brand.excludedByHygiene}`);
    lines.push(`- queued_for_execution: ${brand.queuedForExecution}`);
    lines.push(`- status: ${brand.status}`);
    if (brand.waveReportPath) lines.push(`- wave_report: ${brand.waveReportPath}`);
    if (brand.skipReason) lines.push(`- skip_reason: ${brand.skipReason}`);
    if (brand.validationSummary) {
      lines.push(`- improved_rows: ${brand.validationSummary.improvedRows}`);
      lines.push(`- became_full_overlay_ready: ${brand.validationSummary.becameFullOverlayReady}`);
      lines.push(`- filled_ingredient: ${brand.validationSummary.filledIngredient}`);
      lines.push(`- filled_dosage: ${brand.validationSummary.filledDosage}`);
    }
    if (brand.excludedRows?.length) {
      lines.push("- excluded_rows:");
      for (const row of brand.excludedRows.slice(0, 8)) {
        lines.push(`  - ${row.productId} | ${row.title} | ${row.exclusionReason}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const runRoot = path.resolve(ROOT, OUT_DIR);
  await fs.mkdir(runRoot, { recursive: true });

  const stagingPayload = await readJson(STAGING_PATH);
  const initialStagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const queueRows = await readJson(QUEUE_PATH);

  const report = {
    generatedAt: new Date().toISOString(),
    execute: EXECUTE,
    inputs: {
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      queuePath: path.resolve(ROOT, QUEUE_PATH),
      outDir: runRoot,
      delayMs: DELAY_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      enableAgentBrowserFallback: ENABLE_AGENT_BROWSER_FALLBACK,
    },
    brands: [],
  };

  let currentStagingPath = path.resolve(ROOT, STAGING_PATH);
  let currentStagingRows = initialStagingRows;

  for (const brandDef of BRANDS) {
    const brandRoot = path.join(runRoot, slugify(brandDef.brandName));
    const { brandRows, kept, excluded } = buildLaneRows(queueRows, brandDef);

    const laneReport = {
      brandName: brandDef.brandName,
      factsCandidatesBeforeHygiene: brandRows.length,
      excludedByHygiene: excluded.length,
      queuedForExecution: kept.length,
      excludedRows: excluded,
      status: "planned",
    };

    await writeJson(path.join(brandRoot, "facts_candidates_before_hygiene.json"), brandRows);
    await writeJson(path.join(brandRoot, "excluded_rows.json"), excluded);
    await writeJson(path.join(brandRoot, "queue_rows.cleaned.json"), kept);

    if (!kept.length) {
      laneReport.status = "skipped";
      laneReport.skipReason = "no_human_oral_supplement_rows_after_hygiene";
      report.brands.push(laneReport);
      continue;
    }

    const runtimeConfig = await buildRuntimeConfig(brandDef, kept);
    const configPath = path.join(brandRoot, "runtime_config.json");
    await writeJson(configPath, runtimeConfig);

    if (!EXECUTE) {
      laneReport.status = "planned";
      laneReport.runtimeConfigPath = configPath;
      report.brands.push(laneReport);
      continue;
    }

    const waveOutDir = path.join(brandRoot, "wave");
    await runNodeScript(path.join(ROOT, "scripts", "maintainer", "run-iherb-official-fallback-wave.mjs"), [
      "--config-json",
      configPath,
      "--staging-json",
      currentStagingPath,
      "--queue-json",
      path.join(brandRoot, "queue_rows.cleaned.json"),
      "--out-dir",
      waveOutDir,
      "--brand",
      brandDef.brandName,
      "--delay-ms",
      String(DELAY_MS),
      "--request-timeout-ms",
      String(REQUEST_TIMEOUT_MS),
      "--max-retries",
      String(MAX_RETRIES),
      "--limit",
      String(kept.length),
    ]);

    const waveReportPath = path.join(waveOutDir, "official_fallback_report.json");
    const refreshedStagingPath = path.join(waveOutDir, "staging_products.official_refreshed.json");
    const waveReport = await readJson(waveReportPath);
    const nextStagingPayload = await readJson(refreshedStagingPath);
    const nextStagingRows = Array.isArray(nextStagingPayload?.products) ? nextStagingPayload.products : [];
    const validation = compareBrandRows(
      currentStagingRows,
      nextStagingRows,
      brandDef.brandName,
      kept.map((row) => normalizeText(row?.productId)).filter(Boolean),
    );
    await writeJson(path.join(brandRoot, "lane_b_validation.json"), validation);

    laneReport.status = "executed";
    laneReport.waveReportPath = waveReportPath;
    laneReport.waveSummary = waveReport.summary ?? null;
    laneReport.validationSummary = validation.summary;
    laneReport.validationRows = validation.rows;

    currentStagingPath = refreshedStagingPath;
    currentStagingRows = nextStagingRows;
    report.brands.push(laneReport);
  }

  report.finalStagingPath = currentStagingPath;
  await writeJson(path.join(runRoot, "lane_b_facts_recovery_report.json"), report);
  await writeText(path.join(runRoot, "lane_b_facts_recovery_report.md"), buildMarkdownReport(report));
  console.log(`Lane B facts recovery report written to ${path.join(runRoot, "lane_b_facts_recovery_report.json")}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
