import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./iherb-overlay-utils.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const SOURCE_RISK_RULES = [
  { tag: "source_whey_dairy", pattern: /\b(?:whey|dairy|milk protein|casein)\b/i },
  { tag: "source_soy", pattern: /\b(?:soy|soya|soybean|soy lecithin|soy protein)\b/i },
  { tag: "omega_shellfish_source", pattern: /\b(?:krill|shellfish)\b/i },
  { tag: "omega_fish_source", pattern: /\b(?:fish oil|cod liver|salmon oil|anchovy|sardine)\b/i },
  { tag: "omega_algal_source", pattern: /\b(?:algal|algae oil|plant based omega|plant-based omega)\b/i },
  { tag: "probiotic_microbiome", pattern: /\b(?:probiotic|prebiotic|microbiome|acidophilus|bifidus|floraphage|protectis|osfortis|cfu)\b/i },
  { tag: "sleep_melatonin", pattern: /\b(?:sleep|melatonin|5-htp|theanine|gaba)\b/i },
  { tag: "duplicate_stack_prone", pattern: /\b(?:zinc|magnesium|calcium|vitamin d|d3|multivitamin|b-complex|electrolyte)\b/i },
  { tag: "food_like_boundary", pattern: /\b(?:bar|gel|drink mix|hydration|coconut aminos|soy sauce replacement|cookie|snack|chips|tea bags?)\b/i },
  { tag: "sparse_title_led", pattern: /\b(?:liquid|drops|spray|blend|formula|complex|proprietary)\b/i },
];

const RUNNER_LABELS = {
  "refresh-iherb-overlay-p0-by-official-fallback": "official_fallback",
  "run-iherb-missing-brand-rapidapi-wave": "rapidapi_brand_catalog",
  route_honesty_audit_only: "route_honesty",
  needs_brand_support_onboarding: "needs_brand_support",
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const asCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const increment = (map, key, delta = 1) => {
  const normalized = normalizeText(key) || "unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + delta);
};

const topEntries = (map, keyName, limit = 20) =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));

export const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const detectSourceRiskTags = (row) => {
  const haystack = [
    row?.brandName,
    row?.title,
    row?.classification?.productKind,
    ...(row?.classification?.reasonCodes ?? []),
    ...(row?.missingFields ?? []),
    ...(row?.coreMissingFields ?? []),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" | ");

  return SOURCE_RISK_RULES.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.tag);
};

export const groupQueueRowsByBrand = (queueRows) => {
  const byBrand = new Map();
  for (const row of queueRows ?? []) {
    const brandName = normalizeText(row?.brandName) || "Unknown Brand";
    const key = normalizeLower(brandName) || "unknown brand";
    if (!byBrand.has(key)) {
      byBrand.set(key, {
        brandKey: key,
        brandName,
        rows: [],
      });
    }
    byBrand.get(key).rows.push(row);
  }
  return byBrand;
};

export const indexYieldAdmissionByBrand = (admission) => {
  const byBrand = new Map();
  for (const run of admission?.brandRuns ?? []) {
    const brandName = normalizeText(run?.brandName ?? run?.brandSlug);
    const key = normalizeLower(brandName);
    if (!key) continue;
    if (!byBrand.has(key)) {
      byBrand.set(key, {
        brandName,
        runs: [],
        improvedRows: 0,
        becameFullOverlayReady: 0,
        admittedRuns: 0,
        discoveryOnlyRuns: 0,
      });
    }
    const indexed = byBrand.get(key);
    indexed.runs.push(run);
    indexed.improvedRows += asCount(run?.summary?.improvedRows);
    indexed.becameFullOverlayReady += asCount(run?.summary?.becameFullOverlayReady);
    if (run?.admissionStatus === "admitted") indexed.admittedRuns += 1;
    else indexed.discoveryOnlyRuns += 1;
  }
  return byBrand;
};

export const indexKnownZeroYieldByBrand = (registry) => {
  const byBrand = new Map();
  const brands = Array.isArray(registry) ? registry : registry?.brands;
  for (const row of brands ?? []) {
    const brandName = normalizeText(row?.brandName ?? row);
    const key = normalizeLower(brandName);
    if (!key) continue;
    byBrand.set(key, {
      brandName,
      reason: normalizeText(row?.reason) || "known_zero_yield",
      source: normalizeText(row?.source) || null,
      lastChecked: normalizeText(row?.lastChecked) || null,
    });
  }
  return byBrand;
};

const summarizeBrandRows = (rows, samplePerBrand = 3) => {
  const lanes = new Map();
  const runners = new Map();
  const missingFields = new Map();
  const sourceRiskTags = new Map();

  for (const row of rows) {
    increment(lanes, row?.lane);
    increment(runners, row?.recommendedRunner);
    for (const field of row?.coreMissingFields ?? row?.missingFields ?? []) {
      increment(missingFields, field);
    }
    for (const tag of detectSourceRiskTags(row)) {
      increment(sourceRiskTags, tag);
    }
  }

  return {
    queuedRows: rows.length,
    laneCounts: Object.fromEntries(lanes),
    runnerCounts: Object.fromEntries(runners),
    missingFieldCounts: Object.fromEntries(missingFields),
    sourceRiskTags: topEntries(sourceRiskTags, "tag", 12).map((row) => row.tag),
    sampleRows: rows.slice(0, samplePerBrand).map((row) => ({
      productId: normalizeText(row?.productId) || null,
      brandName: normalizeText(row?.brandName) || null,
      title: normalizeText(row?.title) || null,
      lane: normalizeText(row?.lane) || null,
      missingFields: row?.coreMissingFields ?? row?.missingFields ?? [],
      recommendedRunner: normalizeText(row?.recommendedRunner) || null,
      recommendedConfigPath: normalizeText(row?.recommendedConfigPath) || null,
      rapidApiBrandSlug: normalizeText(row?.rapidApiBrandSlug) || null,
      link: normalizeText(row?.link) || null,
      sourceRiskTags: detectSourceRiskTags(row),
    })),
  };
};

const hasRunner = (summary, runner) => Object.prototype.hasOwnProperty.call(summary.runnerCounts, runner);
const hasLane = (summary, lane) => Object.prototype.hasOwnProperty.call(summary.laneCounts, lane);

const pickPrimaryRunner = (summary) =>
  Object.entries(summary.runnerCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([runner]) => runner)[0] ?? "unknown";

const buildOfficialCommand = ({ brand, outputRoot, samplePerBrand }) => {
  const sampleRows = brand.summary?.sampleRows ?? [];
  const sample = sampleRows.find((row) => normalizeText(row.recommendedConfigPath)) ?? sampleRows[0] ?? null;
  if (!sample?.recommendedConfigPath) return null;
  const brandSlug = slugify(brand.brandName);
  const queuePath = path.join(outputRoot, "brand_queues", `${brandSlug}.queue.json`);
  const stagingPath = path.join(outputRoot, "staging_products.json");
  const outDir = path.join(outputRoot, "runs", brandSlug);
  return [
    "node scripts/maintainer/run-scrapling-official-fallback-wave.mjs",
    `--config-json ${sample.recommendedConfigPath}`,
    `--queue-json ${queuePath}`,
    `--staging-json ${stagingPath}`,
    `--out-dir ${outDir}`,
    `--limit ${Math.max(1, samplePerBrand)}`,
    "--execute true",
    "--mode stealthy",
  ].join(" ");
};

const buildRapidApiCommand = ({ brand, samplePerBrand }) => {
  const rapidSlug = brand.summary?.sampleRows?.find((row) => normalizeText(row.rapidApiBrandSlug))?.rapidApiBrandSlug ?? null;
  if (!rapidSlug) return null;
  return [
    "IHERB_RAPIDAPI_KEY=$IHERB_RAPIDAPI_KEY",
    "node scripts/maintainer/run-iherb-missing-brand-rapidapi-wave.mjs",
    `--brands "${brand.brandName}"`,
    "--no-merge",
    `--max-pages ${Math.max(1, samplePerBrand)}`,
  ].join(" ");
};

const decideBrandAdmission = ({ brand, historicalYield, knownZeroYield, toolReadiness }) => {
  const summary = brand.summary;
  const primaryRunner = pickPrimaryRunner(summary);

  if (historicalYield?.improvedRows > 0) {
    return {
      admissionStatus: "admitted",
      admissionReason: "yield_positive_history",
      nextAction: "merge_validate",
      blocker: false,
    };
  }

  if (historicalYield && historicalYield.runs.length > 0 && historicalYield.improvedRows <= 0) {
    const canCanary = summary.sourceRiskTags.length > 0 || brand.queuedRows >= 8;
    return {
      admissionStatus: "discovery_only",
      admissionReason: "historical_zero_yield",
      nextAction: canCanary ? "agent_browser_canary_or_skip" : "skip_zero_yield",
      blocker: false,
    };
  }

  if (knownZeroYield) {
    const canCanary = summary.sourceRiskTags.length > 0 || brand.queuedRows >= 8;
    return {
      admissionStatus: "discovery_only",
      admissionReason: "known_zero_yield_registry",
      nextAction: canCanary ? "agent_browser_canary_or_skip" : "skip_zero_yield",
      blocker: false,
      registryReason: knownZeroYield.reason,
    };
  }

  if (hasLane(summary, "lane_c_food_like_route_honesty") || hasRunner(summary, "route_honesty_audit_only")) {
    return {
      admissionStatus: "discovery_only",
      admissionReason: "food_like_route_honesty_not_data_fill",
      nextAction: "route_honesty_nightly",
      blocker: false,
    };
  }

  if (hasRunner(summary, "needs_brand_support_onboarding")) {
    return {
      admissionStatus: "discovery_only",
      admissionReason: "brand_support_missing",
      nextAction: "expand_brand_support_or_api_map",
      blocker: false,
    };
  }

  if (hasRunner(summary, "run-iherb-missing-brand-rapidapi-wave")) {
    if (!toolReadiness?.rapidapi?.keyPresent) {
      return {
        admissionStatus: "blocked",
        admissionReason: "rapidapi_key_missing",
        nextAction: "set_rapidapi_key_then_prefetch",
        blocker: true,
      };
    }
    return {
      admissionStatus: "pending_preflight",
      admissionReason: "rapidapi_ready_no_yield_history",
      nextAction: "rapidapi_prefetch",
      blocker: false,
    };
  }

  if (hasRunner(summary, "refresh-iherb-overlay-p0-by-official-fallback")) {
    if (toolReadiness?.scrapling?.ready047) {
      return {
        admissionStatus: "pending_preflight",
        admissionReason: "official_scrapling_ready_no_yield_history",
        nextAction: "scrapling_sample_preflight",
        blocker: false,
      };
    }
    return {
      admissionStatus: "setup_required",
      admissionReason: "scrapling_047_not_ready",
      nextAction: "install_scrapling_047_sidecar_then_sample",
      blocker: true,
    };
  }

  return {
    admissionStatus: "discovery_only",
    admissionReason: `unsupported_runner_${RUNNER_LABELS[primaryRunner] ?? primaryRunner}`,
    nextAction: "manual_triage",
    blocker: false,
  };
};

const computePriorityScore = (brand) => {
  const sourceRiskScore = brand.summary.sourceRiskTags.length * 8;
  const laneAScore = asCount(brand.summary.laneCounts.lane_a_hard_facts) * 20;
  const laneBScore = asCount(brand.summary.laneCounts.lane_b_soft_fields_supplement_like) * 2;
  const foodLikeScore = asCount(brand.summary.laneCounts.lane_c_food_like_route_honesty);
  return laneAScore + laneBScore + sourceRiskScore + Math.min(foodLikeScore, 10);
};

export const buildOverlayYieldPreflightReport = ({
  queueRows,
  admission = null,
  knownZeroYieldBrands = null,
  toolReadiness = {},
  samplePerBrand = 3,
  maxBrands = 40,
  outputRoot = "output/overlay_yield_preflight",
} = {}) => {
  const yieldByBrand = indexYieldAdmissionByBrand(admission);
  const knownZeroYieldByBrand = indexKnownZeroYieldByBrand(knownZeroYieldBrands);
  const grouped = groupQueueRowsByBrand(queueRows);
  const brands = [];

  for (const group of grouped.values()) {
    const summary = summarizeBrandRows(group.rows, samplePerBrand);
    const brand = {
      brandKey: group.brandKey,
      brandName: group.brandName,
      queuedRows: group.rows.length,
      sampleQueueRows: group.rows.slice(0, samplePerBrand),
      summary,
    };
    const historicalYield = yieldByBrand.get(group.brandKey) ?? null;
    const knownZeroYield = knownZeroYieldByBrand.get(group.brandKey) ?? null;
    const admissionDecision = decideBrandAdmission({
      brand,
      historicalYield,
      knownZeroYield,
      toolReadiness,
    });
    const row = {
      ...brand,
      priorityScore: computePriorityScore(brand),
      historicalYield: historicalYield
        ? {
            runs: historicalYield.runs.length,
            improvedRows: historicalYield.improvedRows,
            becameFullOverlayReady: historicalYield.becameFullOverlayReady,
            admittedRuns: historicalYield.admittedRuns,
            discoveryOnlyRuns: historicalYield.discoveryOnlyRuns,
          }
        : null,
      knownZeroYield,
      admission: admissionDecision,
      commands: {
        officialScraplingPreflight: buildOfficialCommand({ brand, outputRoot, samplePerBrand }),
        rapidApiPrefetch: buildRapidApiCommand({ brand, samplePerBrand }),
      },
    };
    brands.push(row);
  }

  brands.sort(
    (left, right) =>
      (right.admission.admissionStatus === "admitted") - (left.admission.admissionStatus === "admitted") ||
      right.priorityScore - left.priorityScore ||
      right.queuedRows - left.queuedRows ||
      left.brandName.localeCompare(right.brandName),
  );

  const selectedBrands = brands.slice(0, maxBrands);
  const statusCounts = new Map();
  const actionCounts = new Map();
  for (const brand of brands) {
    increment(statusCounts, brand.admission.admissionStatus);
    increment(actionCounts, brand.admission.nextAction);
  }

  return {
    schemaVersion: "overlay_yield_preflight.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      queueRows: queueRows?.length ?? 0,
      samplePerBrand,
      maxBrands,
      outputRoot,
      knownZeroYieldBrands: knownZeroYieldByBrand.size,
    },
    toolReadiness,
    summary: {
      brands: brands.length,
      selectedBrands: selectedBrands.length,
      admittedBrands: statusCounts.get("admitted") ?? 0,
      pendingPreflightBrands: statusCounts.get("pending_preflight") ?? 0,
      setupRequiredBrands: statusCounts.get("setup_required") ?? 0,
      blockedBrands: statusCounts.get("blocked") ?? 0,
      discoveryOnlyBrands: statusCounts.get("discovery_only") ?? 0,
      statusCounts: Object.fromEntries(statusCounts),
      nextActionCounts: Object.fromEntries(actionCounts),
    },
    brands: selectedBrands,
  };
};

export const renderOverlayYieldPreflightMarkdown = (report) => {
  const lines = [
    "# Overlay Yield Preflight",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- queueRows: ${report.inputs.queueRows}`,
    `- brands: ${report.summary.brands}`,
    `- selectedBrands: ${report.summary.selectedBrands}`,
    `- admittedBrands: ${report.summary.admittedBrands}`,
    `- pendingPreflightBrands: ${report.summary.pendingPreflightBrands}`,
    `- setupRequiredBrands: ${report.summary.setupRequiredBrands}`,
    `- blockedBrands: ${report.summary.blockedBrands}`,
    `- discoveryOnlyBrands: ${report.summary.discoveryOnlyBrands}`,
    "",
    "## Tool Readiness",
    "",
    `- rapidapi: ${report.toolReadiness?.rapidapi?.keyPresent ? "ready" : "missing_key"}`,
    `- scrapling: ${report.toolReadiness?.scrapling?.ready047 ? "ready_0.4.7+" : `not_ready (${report.toolReadiness?.scrapling?.version ?? "unknown"})`}`,
    `- agentBrowser: ${report.toolReadiness?.agentBrowser?.available ? "available" : "not_available"}`,
    "",
    "## Next Actions",
    "",
  ];

  for (const [action, count] of Object.entries(report.summary.nextActionCounts ?? {})) {
    lines.push(`- ${action}: ${count}`);
  }

  lines.push("", "## Brand Decisions", "");
  for (const brand of report.brands ?? []) {
    lines.push(
      `- ${brand.brandName}: status=${brand.admission.admissionStatus}, reason=${brand.admission.admissionReason}, next=${brand.admission.nextAction}, queued=${brand.queuedRows}, score=${brand.priorityScore}`,
    );
    if (brand.summary.sourceRiskTags.length > 0) {
      lines.push(`  - riskTags: ${brand.summary.sourceRiskTags.join(", ")}`);
    }
    if (brand.historicalYield) {
      lines.push(
        `  - historicalYield: improvedRows=${brand.historicalYield.improvedRows}, runs=${brand.historicalYield.runs}`,
      );
    }
    if (brand.knownZeroYield) {
      lines.push(`  - knownZeroYield: ${brand.knownZeroYield.reason}`);
    }
    const command = brand.commands.officialScraplingPreflight ?? brand.commands.rapidApiPrefetch;
    if (command && ["pending_preflight", "setup_required", "blocked"].includes(brand.admission.admissionStatus)) {
      lines.push(`  - candidateCmd: ${command}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
};

export const writeOverlayYieldPreflightOutputs = async ({ report, outDir }) => {
  const outputDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(path.join(outputDir, "brand_queues"), { recursive: true });

  const stagingRowsByKey = new Map();
  for (const brand of report.brands ?? []) {
    const queueRows = brand.sampleQueueRows ?? [];
    await writeJson(path.join(outputDir, "brand_queues", `${slugify(brand.brandName)}.queue.json`), queueRows);
    for (const row of queueRows) {
      const key = normalizeText(row?.productId) || normalizeText(row?.barcode_gtin14) || `${brand.brandName}:${stagingRowsByKey.size}`;
      stagingRowsByKey.set(key, row);
    }
  }
  await writeJson(path.join(outputDir, "staging_products.json"), {
    schemaVersion: "overlay_yield_preflight_staging.v1",
    generatedAt: report.generatedAt,
    products: [...stagingRowsByKey.values()],
  });

  const reportJsonPath = path.join(outputDir, "overlay_yield_preflight_report.json");
  const reportMdPath = path.join(outputDir, "overlay_yield_preflight_report.md");
  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, renderOverlayYieldPreflightMarkdown(report));

  return {
    outputDir,
    reportJsonPath,
    reportMdPath,
  };
};

export const discoverOfficialWaveRunDirs = async ({ queueDir, rootDir = ROOT_DIR } = {}) => {
  const absoluteQueueDir = path.resolve(rootDir, queueDir);
  let entries = [];
  try {
    entries = await fs.readdir(absoluteQueueDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("overlay_yield_preflight_")) {
      const runsDir = path.join(absoluteQueueDir, entry.name, "runs");
      try {
        await fs.access(runsDir);
        runDirs.push(path.relative(rootDir, runsDir));
      } catch {
        // no runs yet
      }
      continue;
    }

    if (!entry.name.startsWith("official_waves")) continue;
    const runsDir = path.join(absoluteQueueDir, entry.name, "runs");
    let waveEntries = [];
    try {
      waveEntries = await fs.readdir(runsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const waveEntry of waveEntries) {
      if (!waveEntry.isDirectory()) continue;
      runDirs.push(path.relative(rootDir, path.join(runsDir, waveEntry.name)));
    }
  }
  return [...new Set(runDirs)].sort();
};
