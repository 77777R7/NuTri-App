#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  ingredientOverviewGenericHit,
  scientificGenericHit,
  sourceWeakHintLeakageHit,
  ROOT_DIR,
  writeJson,
  writeText,
} from "./lib/science-validation-reporting.mjs";
import { readOfficialWaveYieldAdmission } from "./lib/full-db-api-fill-official-waves.mjs";
import { createSearchReplayReport } from "./lib/search-replay-runner.mjs";
import {
  buildScenarioHeaders,
  createRuntimeContractReport,
  fetchAnalysisBundle,
} from "./lib/runtime-contract-runner.mjs";

const execFileAsync = promisify(execFile);

const PRIORITIZED_VALIDATION_TARGETS = [
  {
    productId: "139307",
    category: "botanical_extract",
    passAnchors: ["Echinacea", "Goldenseal"],
    failAnchors: ["Serving Size", "Sugars"],
  },
  {
    productId: "2921",
    category: "botanical_extract",
    passAnchors: ["Lemon Balm"],
    failAnchors: ["Serving Size", "Sugars"],
  },
  {
    productId: "105654",
    category: "probiotic_microbiome",
    passAnchors: ["Acidophilus", "Bifidus", "Probiotic"],
    failAnchors: ["Serving Size", "Vitamin D"],
  },
  {
    productId: "144256",
    category: "sparse_title_led",
    passAnchors: ["Betaine HCI", "Betaine"],
    failAnchors: ["Serving Size", "Sugars"],
  },
  {
    productId: "23650",
    category: "probiotic_microbiome",
    passAnchors: ["OralBiotic", "Probiotic"],
    failAnchors: ["Serving Size", "Vitamin D"],
  },
  {
    productId: "59774",
    category: "protein_fiber",
    passAnchors: ["Casein", "Protein"],
    failAnchors: ["Potassium", "Sugars", "Calories"],
  },
  {
    productId: "30766",
    category: "vitamin_mineral_single",
    passAnchors: ["Vitamin C", "Ascorbic Acid"],
    failAnchors: ["Serving Size", "Sugars"],
  },
  {
    productId: "723",
    category: "omega3_source_oil",
    passAnchors: ["Omega 3-6-9", "Omega-3", "Fish Oil"],
    failAnchors: ["Serving Size", "Sugars"],
  },
];

const DYNAMIC_FAIL_ANCHORS = [
  "Serving Size",
  "Servings Per Container",
  "Calories",
  "Total Fat",
  "Total Carbohydrate",
  "Sugars",
  "Sodium",
  "Flavor",
  "Suggested Use",
  "Warnings",
];

const DYNAMIC_TITLE_ANCHOR_RULES = [
  { pattern: /\b(?:b[\s-]*complex|methyl\s+folate|methyl\s*b12)\b/i, anchors: ["B-Complex", "Vitamin B Complex", "Methyl B12"] },
  { pattern: /\bwhey\s+protein\b/i, anchors: ["Whey Protein", "Protein"] },
  { pattern: /\bvitamin\s*k2\b|\bmenaquinone\b/i, anchors: ["Vitamin K2", "Menaquinone-7"] },
  { pattern: /\bdigestion\s+enhancement\s+enzymes?\b|\bdigestive\s+enzymes?\b/i, anchors: ["Digestive Enzymes", "Enzyme Blend"] },
  { pattern: /\bspirulina\b/i, anchors: ["Spirulina"] },
  { pattern: /\bchlorella\b/i, anchors: ["Chlorella"] },
  { pattern: /\bglutamine\b/i, anchors: ["Glutamine"] },
  { pattern: /\bleucine\b/i, anchors: ["Leucine"] },
  { pattern: /\bbilberry\b|\bginkgo\b|\beyebright\b/i, anchors: ["Bilberry", "Ginkgo", "Eyebright"] },
  { pattern: /\bchromium\b/i, anchors: ["Chromium", "Chromium Picolinate"] },
  { pattern: /\bmale\s+multiple\b|\bmultivitamin\b|\bmultiple\b|\bdaily\s+multi(?:\s+formula)?\b|\b(?:women'?s|men'?s)\s+daily\s+multi\b|\bmulti\s+formula\b|\bjust\s+one\s+multi\b|\bmulti\s+with\s+iron\b/i, anchors: ["Multivitamin", "Multivitamin & Mineral Formula", "Male Multiple"] },
  { pattern: /\bjoint\s+support\b|\bno\.?\s*7\b/i, anchors: ["Joint Support Complex", "Collagen"] },
  { pattern: /\bsaw\s+palmetto\b/i, anchors: ["Saw Palmetto"] },
  { pattern: /\bvitamin\s*d3\b|\bvegan\s+vitamin\s*d3\b|\bcholecalciferol\b/i, anchors: ["Vitamin D3", "Vitamin D"] },
  { pattern: /\bmixed\s+tocopherols?\b|\bvitamin\s*e\b|\be-400\b/i, anchors: ["Vitamin E", "Mixed Tocopherols"] },
  { pattern: /\bmagnesium\b.*\bcalcium\b|\bcalcium\b.*\bmagnesium\b/i, anchors: ["Calcium Magnesium Mineral Stack", "Magnesium", "Calcium"] },
  { pattern: /\bmastic\s+gum\b/i, anchors: ["Mastic Gum"] },
  { pattern: /\bcurcumin\b|\bturmeric\b/i, anchors: ["Curcumin", "Turmeric"] },
  { pattern: /\bastaxanthin\b/i, anchors: ["Astaxanthin"] },
  { pattern: /\bmelatonin\b/i, anchors: ["Melatonin"] },
  { pattern: /\budo'?s\s+(?:choice\s+)?oil\b|\b(?:omega\s*)?3[\s-]*6[\s-]*9\b|\bdha\s+3[\s-]*6[\s-]*9\b/i, anchors: ["Omega 3-6-9", "Omega-3", "DHA", "ALA", "Essential Fatty Acids", "Omega-6", "Omega-9"] },
  { pattern: /\bpara\s*fight\b/i, anchors: ["ParaFight Herbal Blend", "ParaFight", "Intestinal Support Blend"] },
  { pattern: /\bpropolis\b/i, anchors: ["Propolis", "Astragalus", "Echinacea", "Slippery Elm"] },
  { pattern: /\bgoldenseal\b/i, anchors: ["Goldenseal", "Goldenseal Extract"] },
  { pattern: /\bcaffeine\b.*\bl[\s-]*theanine\b|\bl[\s-]*theanine\b.*\bcaffeine\b/i, anchors: ["Caffeine", "L-Theanine"] },
  { pattern: /\bthinkfast\b|\bbrain\s+performance\b|\bmemory\b/i, anchors: ["CogninSA", "Ginkgo", "Bacopa", "Chinese Skullcap"] },
];

const DEFAULT_RUN_DIRS = [
  "output/full_db_api_fill_queue/1776444464175/official_waves/runs/wave_lane_a_hard_facts_01",
  "output/full_db_api_fill_queue/1776444464175/official_waves/runs/wave_lane_b_official_top_01",
];

const parseArgs = () => {
  const values = {
    runDirs: DEFAULT_RUN_DIRS,
    outDir: "output/validation-runtime/official-wave-post-merge",
    owner: "maintainer-official-wave-post-merge",
    apiBaseUrl:
      process.env.API_BASE_URL ||
      process.env.SCIENCE_VALIDATION_API_BASE_URL ||
      "http://127.0.0.1:3001",
    selectionLimit: 8,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--run-dir" && next) {
      values.runDirs = [...values.runDirs, next];
      index += 1;
    } else if (arg === "--run-dirs" && next) {
      values.runDirs = next.split(",").map((value) => value.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--owner" && next) {
      values.owner = next;
      index += 1;
    } else if (arg === "--api-base-url" && next) {
      values.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--selection-limit" && next) {
      values.selectionLimit = Math.max(1, Number(next) || 8);
      index += 1;
    }
  }

  return values;
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const slugify = (value) =>
  normalizeLooseText(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const flattenStrings = (value, acc = [], seen = new Set()) => {
  if (value == null) return acc;
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (normalized) acc.push(normalized);
    return acc;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, acc, seen);
    return acc;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return acc;
  seen.add(value);
  for (const nested of Object.values(value)) flattenStrings(nested, acc, seen);
  return acc;
};

const tokenizeComparable = (value) =>
  normalizeLooseText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));

const uniqNormalized = (values) => {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const text = normalizeText(value);
    const key = normalizeLooseText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
};

const extractFactNames = (row) => {
  const facts = row?.supplementFacts ?? row?.supplement_facts ?? null;
  const nutritionRows =
    (Array.isArray(facts?.nutritionalFacts) ? facts.nutritionalFacts : null) ??
    (Array.isArray(facts?.nutritional_facts) ? facts.nutritional_facts : null) ??
    [];
  return nutritionRows
    .map((fact) => normalizeText(fact?.substancy ?? fact?.substance ?? fact?.name ?? fact?.ingredient))
    .filter((name) => {
      const normalized = normalizeLooseText(name);
      if (!normalized || normalized.length < 3) return false;
      return !DYNAMIC_FAIL_ANCHORS.some((anchor) => normalized === normalizeLooseText(anchor));
    });
};

export const inferDynamicPassAnchors = (row) => {
  const title = normalizeText(row?.title ?? row?.productName);
  const titleAnchors = [];
  for (const rule of DYNAMIC_TITLE_ANCHOR_RULES) {
    if (rule.pattern.test(title)) titleAnchors.push(...rule.anchors);
  }
  const titleLedAnchors = uniqNormalized(titleAnchors);
  if (titleLedAnchors.length > 0) return titleLedAnchors.slice(0, 8);
  return uniqNormalized(extractFactNames(row).slice(0, 4)).slice(0, 8);
};

const anchorMatchesAllowed = ({ selectedAnchor, allowedAnchors, disallowedAnchors }) => {
  const actual = normalizeLooseText(selectedAnchor);
  if (!actual) return false;

  const disallowedHit = (disallowedAnchors ?? []).some((anchor) => {
    const normalized = normalizeLooseText(anchor);
    return normalized && actual.includes(normalized);
  });
  if (disallowedHit) return false;

  return (allowedAnchors ?? []).some((anchor) => {
    const normalized = normalizeLooseText(anchor);
    if (!normalized) return false;
    if (actual === normalized) return true;
    if (actual.includes(normalized) || normalized.includes(actual)) return true;
    const expectedTokens = tokenizeComparable(anchor);
    return expectedTokens.length > 0 && expectedTokens.every((token) => actual.includes(token));
  });
};

const copyMentionsExpected = (copyText, expectedTerms) => {
  const joined = normalizeLooseText(copyText);
  if (!joined) return false;
  return (expectedTerms ?? []).some((term) => {
    const normalized = normalizeLooseText(term);
    if (!normalized) return false;
    if (joined.includes(normalized)) return true;
    const tokens = tokenizeComparable(term);
    return tokens.length > 0 && tokens.every((token) => joined.includes(token));
  });
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(path.resolve(ROOT_DIR, filePath), "utf8"));

const fetchJson = async ({ url, method = "GET", headers = {}, body }) => {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const extractSelectedAnchor = (payload) => {
  const rows = Array.isArray(payload?.scienceBlock?.ingredientRows)
    ? payload.scienceBlock.ingredientRows
    : [];
  for (const row of rows) {
    const name = normalizeText(row?.name ?? row?.ingredientName ?? row?.title);
    if (name) return name;
  }
  return normalizeText(payload?.defaultIngredientName) || null;
};

const buildSidecarBody = ({ barcode, decisionSupportPayload, analysisBundle }) => {
  const bundle = analysisBundle?.latestBundle ?? {};
  const authoritativeIdentity = bundle?.meta?.authoritativeIdentity ?? null;
  return {
    barcode,
    decisionDigest: normalizeText(decisionSupportPayload?.digest) || null,
    decisionInputsHash: normalizeText(decisionSupportPayload?.decisionInputsHash) || null,
    personalizationScopeHash: normalizeText(decisionSupportPayload?.personalizationScopeHash) || null,
    authoritativeIdentityType: normalizeText(authoritativeIdentity?.type) || null,
    authoritativeIdentityValue: normalizeText(authoritativeIdentity?.value) || null,
  };
};

const buildSearchScenario = (target) => ({
  id: `search_barcode_${slugify(target.brandName)}_${slugify(target.title)}`.slice(0, 120),
  surface: "search",
  category: target.category,
  input: {
    query: target.barcode,
    queryType: "barcode",
  },
  expected: {
    search: {
      expectedProductId: target.productId,
      metric: "barcode_exact",
    },
  },
  severityOnFail: "P1",
});

const buildRuntimeScenario = (target) => ({
  id: `search_origin_${slugify(target.brandName)}_${slugify(target.title)}`.slice(0, 120),
  surface: "search_origin_result",
  origin: "search_result",
  category: target.category,
  personas: [],
  input: {
    query: target.barcode,
    queryType: "barcode",
    searchResultSeed: {
      productId: target.productId,
      barcode: target.barcode,
      upcCode: target.barcode,
      name: target.title,
      brand: target.brandName,
      category: "Supplement",
      benefit: "",
      dose: "",
      factsStatus: "coverage_ready",
      coverageStatus: "coverage_ready",
    },
  },
  product: {
    productId: target.productId,
    brand: target.brandName,
    name: target.title,
    barcode: target.barcode,
  },
  expected: {
    defaultAnchor: {
      pass: target.passAnchors,
      warn: [],
      fail: target.failAnchors,
    },
  },
  gates: [
    "canonical_product_consistency",
    "selected_anchor_consistency",
  ],
  severityOnFail: "P1",
});

const collectImprovedRowsFromRunDir = async ({ runDir, admittedBrandDirs = null }) => {
  const entries = await fs.readdir(path.resolve(ROOT_DIR, runDir), { withFileTypes: true });
  const collected = [];
  const admitted = admittedBrandDirs instanceof Set ? admittedBrandDirs : null;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const brandDir = path.join(runDir, entry.name);
    if (admitted && !admitted.has(brandDir)) continue;
    const reportPath = path.join(brandDir, "official_fallback_report.json");
    const stagingPath = path.join(brandDir, "staging_products.official_refreshed.json");
    try {
      const report = await readJson(reportPath);
      const staging = await readJson(stagingPath);
      const stagingProducts = Array.isArray(staging?.products) ? staging.products : [];
      const stagingByProductId = new Map(
        stagingProducts
          .map((row) => [normalizeText(row?.productId), row])
          .filter(([productId]) => productId),
      );

      for (const row of report?.rows ?? []) {
        if (row?.improved !== true) continue;
        const productId = normalizeText(row?.productId);
        const stagingRow = stagingByProductId.get(productId);
        if (!productId || !stagingRow) continue;
        collected.push({
          productId,
          brandName: normalizeText(stagingRow?.brandName ?? row?.brandName),
          title: normalizeText(stagingRow?.title ?? row?.title),
          barcode: normalizeBarcode(stagingRow?.barcode_gtin14 ?? null),
          runDir,
          brandDir,
          reportRow: row,
          stagingRow,
        });
      }
    } catch {
      continue;
    }
  }

  return collected;
};

export const chooseValidationTargets = ({ mergedRows, combinedProducts = [], limit }) => {
  const mergedByProductId = new Map(
    mergedRows
      .map((row) => [normalizeText(row?.productId), row])
      .filter(([productId]) => productId),
  );
  const combinedByProductId = new Map(
    combinedProducts
      .map((row) => [normalizeText(row?.productId), row])
      .filter(([productId]) => productId),
  );

  const selected = [];
  const selectedProductIds = new Set();
  for (const candidate of PRIORITIZED_VALIDATION_TARGETS) {
    if (selected.length >= limit) break;
    const merged = mergedByProductId.get(candidate.productId);
    if (!merged) continue;
    const barcode = normalizeBarcode(
      merged?.barcode_gtin14
      ?? merged?.barcodeGtin14
      ?? merged?.upcCode
      ?? merged?.barcode,
    );
    if (!barcode) continue;
    selected.push({
      ...candidate,
      productId: normalizeText(merged?.productId ?? candidate.productId),
      brandName: normalizeText(merged?.brandName ?? candidate.brandName ?? ""),
      title: normalizeText(merged?.title ?? candidate.title ?? ""),
      barcode,
    });
    selectedProductIds.add(normalizeText(merged?.productId ?? candidate.productId));
  }

  for (const merged of mergedRows ?? []) {
    if (selected.length >= limit) break;
    const productId = normalizeText(merged?.productId);
    if (!productId || selectedProductIds.has(productId)) continue;
    const stagedRow = combinedByProductId.get(productId) ?? null;
    const sourceRow = stagedRow ?? merged;
    const barcode = normalizeBarcode(
      merged?.barcodeGtin14
      ?? sourceRow?.barcode_gtin14
      ?? sourceRow?.barcodeGtin14
      ?? sourceRow?.upcCode
      ?? sourceRow?.barcode,
    );
    const passAnchors = inferDynamicPassAnchors(sourceRow);
    if (!barcode || passAnchors.length === 0) continue;
    selected.push({
      productId,
      brandName: normalizeText(merged?.brandName ?? sourceRow?.brandName ?? ""),
      title: normalizeText(merged?.title ?? sourceRow?.title ?? ""),
      barcode,
      category: "dynamic_post_merge",
      passAnchors,
      failAnchors: DYNAMIC_FAIL_ANCHORS,
    });
    selectedProductIds.add(productId);
  }
  return selected;
};

const renderMarkdown = (report) => {
  const lines = [
    "# Official Wave Merge Post-Merge Validation",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- apiBaseUrl: ${report.apiBaseUrl}`,
    "",
    "## Yield Admission",
    "",
    `- admitted brand runs: ${report.admission.summary.admittedBrandRuns}`,
    `- discovery-only brand runs: ${report.admission.summary.discoveryOnlyBrandRuns}`,
    `- improved rows across wave: ${report.admission.summary.improvedRows}`,
    `- became full overlay ready: ${report.admission.summary.becameFullOverlayReady}`,
    "",
  ];

  if ((report.admission.discoveryOnlyBrandRuns ?? []).length > 0) {
    lines.push("### Discovery-Only Brand Runs", "");
    for (const row of report.admission.discoveryOnlyBrandRuns) {
      lines.push(
        `- ${row.brandName || row.brandSlug || row.brandDir || "unknown"} (${row.runDir}): ${row.admissionReason}, improvedRows=${row.summary?.improvedRows ?? 0}`,
      );
    }
    lines.push("");
  }

  if (report.merge.skipped) {
    lines.push("## Merge", "", `- skipped: ${report.merge.skipReason}`, "");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `- combinedStagingPath: ${report.outputs.combinedStagingPath}`,
    `- dryRunMergeReportPath: ${report.outputs.dryRunMergeReportPath}`,
    `- applyMergeReportPath: ${report.outputs.applyMergeReportPath}`,
    "",
    "## Merge",
    "",
    `- improved rows collected: ${report.merge.improvedRowsCollected}`,
    `- unique products staged: ${report.merge.uniqueProductsStaged}`,
    `- dry-run matched: ${report.merge.dryRunSummary.matched}`,
    `- dry-run queued: ${report.merge.dryRunSummary.queued}`,
    `- dry-run blocked: ${report.merge.dryRunSummary.blocked}`,
    `- apply merged: ${report.merge.applySummary.merged}`,
    `- apply queued: ${report.merge.applySummary.queued}`,
    `- apply blocked: ${report.merge.applySummary.blocked}`,
    "",
    "## Validation Summary",
    "",
    `- search pass/fail: ${report.validation.summary.searchPass}/${report.validation.summary.searchFail}`,
    `- runtime pass/warn/fail: ${report.validation.summary.runtimePass}/${report.validation.summary.runtimeWarn}/${report.validation.summary.runtimeFail}`,
    `- default anchor pass/fail: ${report.validation.summary.defaultAnchorPass}/${report.validation.summary.defaultAnchorFail}`,
    `- overview pass/fail: ${report.validation.summary.overviewPass}/${report.validation.summary.overviewFail}`,
    `- scientific pass/fail: ${report.validation.summary.scientificPass}/${report.validation.summary.scientificFail}`,
    `- search-detail consistency pass/warn/fail: ${report.validation.summary.consistencyPass}/${report.validation.summary.consistencyWarn}/${report.validation.summary.consistencyFail}`,
    "",
    "## Product Checks",
    "",
  );

  for (const row of report.validation.rows) {
    lines.push(`### ${row.brandName} — ${row.title}`);
    lines.push(`- productId: ${row.productId}`);
    lines.push(`- barcode: ${row.barcode}`);
    lines.push(`- selected anchor: ${row.selectedAnchor || "n/a"}`);
    lines.push(`- default anchor: ${row.defaultAnchor.status}`);
    lines.push(`- overview: ${row.overview.status}`);
    lines.push(`- scientific background: ${row.scientificBackground.status}`);
    lines.push(`- search/detail consistency: ${row.searchDetailConsistency.status}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const args = parseArgs();
  const outDir = path.resolve(ROOT_DIR, args.outDir);
  await fs.mkdir(outDir, { recursive: true });

  const admission = await readOfficialWaveYieldAdmission({ runDirs: args.runDirs, rootDir: ROOT_DIR });
  const admissionPath = path.join(outDir, "official-wave-yield-admission.json");
  await writeJson(path.relative(ROOT_DIR, admissionPath), admission);

  const admittedBrandDirs = new Set(
    (admission.admittedBrandRuns ?? []).map((row) => normalizeText(row?.brandDir)).filter(Boolean),
  );
  const collectedRows = [];
  for (const runDir of args.runDirs) {
    collectedRows.push(...(await collectImprovedRowsFromRunDir({ runDir, admittedBrandDirs })));
  }

  const uniqueProducts = new Map();
  for (const row of collectedRows) uniqueProducts.set(row.productId, row.stagingRow);
  const combinedProducts = [...uniqueProducts.values()];

  if (combinedProducts.length === 0) {
    const report = {
      reportType: "official_wave_merge_post_validate.v1",
      generatedAt: new Date().toISOString(),
      apiBaseUrl: String(args.apiBaseUrl).replace(/\/$/, ""),
      inputs: {
        runDirs: args.runDirs,
        owner: args.owner,
        selectionLimit: args.selectionLimit,
      },
      admission,
      outputs: {
        yieldAdmissionPath: path.relative(ROOT_DIR, admissionPath),
        combinedStagingPath: null,
        dryRunMergeReportPath: null,
        applyMergeReportPath: null,
        searchPackPath: null,
        runtimePackPath: null,
      },
      merge: {
        skipped: true,
        skipReason: "no_admitted_improved_rows",
        improvedRowsCollected: 0,
        uniqueProductsStaged: 0,
        mergedRowsAvailableForValidation: 0,
        dryRunSummary: {},
        applySummary: {},
      },
      validation: {
        selectedProductIds: [],
        summary: {
          searchPass: 0,
          searchFail: 0,
          runtimePass: 0,
          runtimeWarn: 0,
          runtimeFail: 0,
          defaultAnchorPass: 0,
          defaultAnchorFail: 0,
          overviewPass: 0,
          overviewFail: 0,
          scientificPass: 0,
          scientificFail: 0,
          consistencyPass: 0,
          consistencyWarn: 0,
          consistencyFail: 0,
        },
        rows: [],
      },
      searchReport: null,
      runtimeReport: null,
    };

    const stamp = Date.now();
    const reportJsonPath = path.join(outDir, `official-wave-post-merge-validation-${stamp}.json`);
    const reportMdPath = path.join(outDir, `official-wave-post-merge-validation-${stamp}.md`);
    await writeJson(path.relative(ROOT_DIR, reportJsonPath), report);
    await writeText(path.relative(ROOT_DIR, reportMdPath), renderMarkdown(report));
    console.log(JSON.stringify({
      ok: true,
      yieldFirstAdmission: true,
      mergeSkipped: true,
      reportJsonPath: path.relative(ROOT_DIR, reportJsonPath),
      reportMdPath: path.relative(ROOT_DIR, reportMdPath),
      yieldAdmissionPath: path.relative(ROOT_DIR, admissionPath),
      admissionSummary: admission.summary,
    }, null, 2));
    return;
  }

  const combinedStagingPath = path.join(outDir, "staging_products.official_refreshed.combined.json");
  await writeJson(path.relative(ROOT_DIR, combinedStagingPath), {
    schemaVersion: "official_wave_combined_staging.v1",
    generatedAt: new Date().toISOString(),
    sourceRunDirs: args.runDirs,
    products: combinedProducts,
  });

  const dryRunDir = path.join(outDir, "merge_dry_run");
  const applyDir = path.join(outDir, "merge_apply");
  await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "merge-iherb-overlay-bulk-to-supabase.mjs"),
      "--input-json",
      combinedStagingPath,
      "--out-dir",
      dryRunDir,
      "--owner",
      args.owner,
    ],
    { cwd: ROOT_DIR, env: process.env, maxBuffer: 1024 * 1024 * 32 },
  );
  await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "merge-iherb-overlay-bulk-to-supabase.mjs"),
      "--input-json",
      combinedStagingPath,
      "--out-dir",
      applyDir,
      "--owner",
      args.owner,
      "--apply",
    ],
    { cwd: ROOT_DIR, env: process.env, maxBuffer: 1024 * 1024 * 32 },
  );

  const dryRunReportPath = path.join(dryRunDir, "overlay_merge_coverage_report.json");
  const applyReportPath = path.join(applyDir, "overlay_merge_coverage_report.json");
  const dryRunReport = await readJson(dryRunReportPath);
  const applyReport = await readJson(applyReportPath);
  const mergedRows = (applyReport?.rows ?? []).filter((row) => normalizeText(row?.mergeDecision) === "merged");

  const validationTargets = chooseValidationTargets({
    mergedRows,
    combinedProducts,
    limit: args.selectionLimit,
  });

  const searchPack = {
    version: "iherb-post-merge-search.v1",
    scenarios: validationTargets.map(buildSearchScenario),
  };
  const runtimePack = {
    version: "iherb-post-merge-runtime.v1",
    scenarios: validationTargets.map(buildRuntimeScenario),
  };

  await writeJson(path.relative(ROOT_DIR, path.join(outDir, "search-pack.json")), searchPack);
  await writeJson(path.relative(ROOT_DIR, path.join(outDir, "runtime-pack.json")), runtimePack);

  const searchReport = await createSearchReplayReport({
    pack: searchPack,
    apiBaseUrl: args.apiBaseUrl,
    limit: 5,
    scenarioLimit: validationTargets.length,
    timestamp: String(Date.now()),
  });

  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
  const commonHeaders = regressionToken
    ? { "x-regression-token": regressionToken }
    : { "x-auth-disabled": "1" };

  const runtimeReport = await createRuntimeContractReport({
    pack: runtimePack,
    apiBaseUrl: String(args.apiBaseUrl).replace(/\/$/, ""),
    scenarioLimit: validationTargets.length,
    commonHeaders,
    timestamp: String(Date.now()),
  });

  const runtimeByScenarioId = new Map(
    (runtimeReport?.scenarios ?? []).map((row) => [row.scenarioId, row]),
  );
  const searchByScenarioId = new Map(
    (searchReport?.rows ?? []).map((row) => [row.id, row]),
  );

  const validationRows = [];

  for (const target of validationTargets) {
    const runtimeScenario = buildRuntimeScenario(target);
    const searchScenario = buildSearchScenario(target);
    const headers = buildScenarioHeaders({ scenario: runtimeScenario, commonHeaders });

    const decisionSupport = await fetchJson({
      url: `${String(args.apiBaseUrl).replace(/\/$/, "")}/api/decision-support/v1?barcode=${encodeURIComponent(target.barcode)}&viewMode=summary`,
      headers,
    });
    const analysisBundle = await fetchAnalysisBundle({
      apiBaseUrl: String(args.apiBaseUrl).replace(/\/$/, ""),
      barcode: target.barcode,
      headers,
    });

    const decisionSupportPayload = decisionSupport?.payload ?? {};
    const selectedAnchor = extractSelectedAnchor(decisionSupportPayload);
    const sidecarBody = buildSidecarBody({
      barcode: target.barcode,
      decisionSupportPayload,
      analysisBundle,
    });
    const ingredientOverview = await fetchJson({
      url: `${String(args.apiBaseUrl).replace(/\/$/, "")}/api/ingredient-overview/v1`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(sidecarBody),
    });
    const scientificBackground = selectedAnchor
      ? await fetchJson({
        url: `${String(args.apiBaseUrl).replace(/\/$/, "")}/api/scientific-background/v1`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          ...sidecarBody,
          selectedIngredientName: selectedAnchor,
        }),
      })
      : {
        ok: false,
        status: null,
        payload: null,
      };

    const overviewBlock = ingredientOverview?.payload?.ingredientOverview ?? ingredientOverview?.payload ?? null;
    const overviewText = flattenStrings(overviewBlock).join("\n");
    const scientificBlock =
      scientificBackground?.payload?.scientificBackground ?? scientificBackground?.payload ?? null;
    const scientificText = flattenStrings(scientificBlock).join("\n");

    const defaultAnchorPass = anchorMatchesAllowed({
      selectedAnchor,
      allowedAnchors: target.passAnchors,
      disallowedAnchors: target.failAnchors,
    });
    const overviewPass =
      ingredientOverview?.ok === true
      && !ingredientOverviewGenericHit(overviewBlock)
      && !sourceWeakHintLeakageHit(overviewBlock)
      && copyMentionsExpected(overviewText, [selectedAnchor, ...target.passAnchors].filter(Boolean));
    const scientificPass =
      scientificBackground?.ok === true
      && !scientificGenericHit(scientificBlock)
      && !sourceWeakHintLeakageHit(scientificBlock)
      && copyMentionsExpected(scientificText, [selectedAnchor, ...target.passAnchors].filter(Boolean));

    const runtimeRow = runtimeByScenarioId.get(runtimeScenario.id) ?? null;
    const searchRow = searchByScenarioId.get(searchScenario.id) ?? null;
    const consistencyFailures = (runtimeRow?.failures ?? []).filter((gate) =>
      ["canonical_product_consistency", "selected_anchor_consistency"].includes(gate.gate),
    );
    const consistencyWarnings = (runtimeRow?.warnings ?? []).filter((gate) =>
      ["canonical_product_consistency", "selected_anchor_consistency"].includes(gate.gate),
    );
    const searchDetailConsistencyStatus =
      searchRow?.status === "fail" || consistencyFailures.length > 0
        ? "fail"
        : consistencyWarnings.length > 0
          ? "warn"
          : "pass";

    validationRows.push({
      productId: target.productId,
      brandName: target.brandName,
      title: target.title,
      barcode: target.barcode,
      selectedAnchor,
      defaultAnchor: {
        status: defaultAnchorPass ? "pass" : "fail",
        passAnchors: target.passAnchors,
        failAnchors: target.failAnchors,
      },
      overview: {
        status: overviewPass ? "pass" : "fail",
        generic: ingredientOverviewGenericHit(overviewBlock),
        weakSourceLeakage: sourceWeakHintLeakageHit(overviewBlock),
        snippet: overviewText.slice(0, 280),
      },
      scientificBackground: {
        status: scientificPass ? "pass" : "fail",
        generic: scientificGenericHit(scientificBlock),
        weakSourceLeakage: sourceWeakHintLeakageHit(scientificBlock),
        snippet: scientificText.slice(0, 280),
      },
      searchDetailConsistency: {
        status: searchDetailConsistencyStatus,
        searchStatus: searchRow?.status ?? "fail",
        runtimeStatus: runtimeRow?.status ?? "fail",
        searchReason: searchRow?.reason ?? null,
        runtimeFailureGates: consistencyFailures.map((gate) => gate.gate),
        runtimeWarningGates: consistencyWarnings.map((gate) => gate.gate),
      },
    });
  }

  const report = {
    reportType: "official_wave_merge_post_validate.v1",
    generatedAt: new Date().toISOString(),
    apiBaseUrl: String(args.apiBaseUrl).replace(/\/$/, ""),
    inputs: {
      runDirs: args.runDirs,
      owner: args.owner,
      selectionLimit: args.selectionLimit,
    },
    admission,
    outputs: {
      yieldAdmissionPath: path.relative(ROOT_DIR, admissionPath),
      combinedStagingPath: path.relative(ROOT_DIR, combinedStagingPath),
      dryRunMergeReportPath: path.relative(ROOT_DIR, dryRunReportPath),
      applyMergeReportPath: path.relative(ROOT_DIR, applyReportPath),
      searchPackPath: path.relative(ROOT_DIR, path.join(outDir, "search-pack.json")),
      runtimePackPath: path.relative(ROOT_DIR, path.join(outDir, "runtime-pack.json")),
    },
    merge: {
      skipped: false,
      skipReason: null,
      improvedRowsCollected: collectedRows.length,
      uniqueProductsStaged: combinedProducts.length,
      mergedRowsAvailableForValidation: mergedRows.length,
      dryRunSummary: dryRunReport?.summary ?? {},
      applySummary: applyReport?.summary ?? {},
    },
    validation: {
      selectedProductIds: validationTargets.map((row) => row.productId),
      summary: {
        searchPass: searchReport?.summary?.pass ?? 0,
        searchFail: searchReport?.summary?.fail ?? 0,
        runtimePass: runtimeReport?.summary?.pass ?? 0,
        runtimeWarn: runtimeReport?.summary?.warn ?? 0,
        runtimeFail: runtimeReport?.summary?.fail ?? 0,
        defaultAnchorPass: validationRows.filter((row) => row.defaultAnchor.status === "pass").length,
        defaultAnchorFail: validationRows.filter((row) => row.defaultAnchor.status === "fail").length,
        overviewPass: validationRows.filter((row) => row.overview.status === "pass").length,
        overviewFail: validationRows.filter((row) => row.overview.status === "fail").length,
        scientificPass: validationRows.filter((row) => row.scientificBackground.status === "pass").length,
        scientificFail: validationRows.filter((row) => row.scientificBackground.status === "fail").length,
        consistencyPass: validationRows.filter((row) => row.searchDetailConsistency.status === "pass").length,
        consistencyWarn: validationRows.filter((row) => row.searchDetailConsistency.status === "warn").length,
        consistencyFail: validationRows.filter((row) => row.searchDetailConsistency.status === "fail").length,
      },
      rows: validationRows,
    },
    searchReport,
    runtimeReport,
  };

  const stamp = Date.now();
  const reportJsonPath = path.join(outDir, `official-wave-post-merge-validation-${stamp}.json`);
  const reportMdPath = path.join(outDir, `official-wave-post-merge-validation-${stamp}.md`);
  await writeJson(path.relative(ROOT_DIR, reportJsonPath), report);
  await writeText(path.relative(ROOT_DIR, reportMdPath), renderMarkdown(report));

  console.log(JSON.stringify({
    ok: true,
    yieldFirstAdmission: true,
    reportJsonPath: path.relative(ROOT_DIR, reportJsonPath),
    reportMdPath: path.relative(ROOT_DIR, reportMdPath),
    yieldAdmissionPath: path.relative(ROOT_DIR, admissionPath),
    dryRunMergeReportPath: path.relative(ROOT_DIR, dryRunReportPath),
    applyMergeReportPath: path.relative(ROOT_DIR, applyReportPath),
    admissionSummary: admission.summary,
    selectedProductIds: report.validation.selectedProductIds,
    validationSummary: report.validation.summary,
  }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
