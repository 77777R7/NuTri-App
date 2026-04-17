#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  ROOT_DIR,
  normalizeBarcode,
  renderMarkdownReport,
  scientificGenericHit,
  summarizeValidationRows,
  writeJson,
  writeText,
} from "./lib/science-validation-reporting.mjs";

const API_BASE_URL = process.env.SCIENCE_VALIDATION_API_BASE_URL || "https://nutri-app-qn0u.onrender.com";
const BACKEND_ENV_PATH = path.join(ROOT_DIR, "backend", ".env");
const DEFAULT_TIMEOUT_MS = 12_000;
const SCIENCE_RETRY_BUFFER_MS = 250;
const SCIENCE_MIN_RETRY_DELAY_MS = 1_500;
const SCIENCE_MAX_RETRY_DELAY_MS = 5_000;
const SCIENCE_MAX_REVALIDATES = 28;
const SCIENCE_MAX_REVALIDATE_WINDOW_MS = 75_000;
const INGREDIENT_OVERVIEW_RETRY_DELAY_MS = 1_800;

const PERSONALIZATION_HEADER = JSON.stringify({
  profile: {
    goals: ["Sleep", "Energy", "Immunity", "Recovery", "Focus", "Stress Support"],
    preferredTypes: ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein"],
  },
  savedSupplements: [],
});

const COMMON_CLUSTERS = {
  omega3: {
    label: "Omega-3",
    terms: ["omega-3", "fish oil", "dha", "epa"],
    include: /\bomega[\s-]*3\b|\bfish oil\b|\bdha\b|\bepa\b/i,
    aligned: /\bomega[\s-]*3\b|\bfish oil\b|\bdha\b|\bepa\b/i,
  },
  five_htp: {
    label: "5-HTP",
    terms: ["5-htp", "5 htp", "hydroxytryptophan"],
    include: /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b/i,
    aligned: /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b/i,
  },
  magnesium: {
    label: "Magnesium",
    terms: ["magnesium"],
    include: /\bmagnesium\b/i,
    aligned: /\bmagnesium\b/i,
  },
  zinc: {
    label: "Zinc",
    terms: ["zinc"],
    include: /\bzinc\b/i,
    aligned: /\bzinc\b/i,
  },
  probiotics: {
    label: "Probiotics",
    terms: ["probiotic", "probiotics", "cfu"],
    include: /\bprobiotic(s)?\b|\bcfu\b|lactobacillus|bifidobacterium/i,
    aligned: /\bprobiotic(s)?\b|\bcfu\b|lactobacillus|bifidobacterium|saccharomyces/i,
  },
  cla: {
    label: "CLA",
    terms: ["cla", "conjugated linoleic acid", "tonalin"],
    include: /(^|[^a-z])cla([^a-z]|$)|conjugated linoleic acid|tonalin/i,
    aligned: /(^|[^a-z])cla([^a-z]|$)|conjugated linoleic acid|tonalin/i,
  },
  carnitine: {
    label: "Carnitine",
    terms: ["carnitine", "acetyl l-carnitine", "l-carnitine"],
    include: /\bcarnitine\b/i,
    aligned: /\bcarnitine\b/i,
  },
  green_tea: {
    label: "Green Tea Extract",
    terms: ["green tea", "egcg"],
    include: /\bgreen tea\b|\begcg\b/i,
    aligned: /\bgreen tea\b|\begcg\b|catechin/i,
  },
};

const plans = {
  targeted500: [
    {
      key: "popular_brand_residue",
      label: "Popular brand residue",
      targetCount: 100,
      terms: ["Sports Research", "California Gold Nutrition", "Swanson", "NOW Foods", "Solgar", "Nature's Way"],
      include: /\b(?:sports research|california gold nutrition|swanson|now foods|solgar|nature'?s way)\b/i,
      aligned: /.+/i,
    },
    {
      key: "mineral_multi_conflict",
      label: "Mineral/multi conflict",
      targetCount: 80,
      terms: ["calcium magnesium zinc", "cal-mag-zinc", "multivitamin", "b complex", "immune blend", "elderberry zinc"],
      include: /\b(?:calcium|magnesium|zinc|multi(?:vitamin)?|b[\s-]*complex|immune|elderberry)\b/i,
      aligned: /\b(?:calcium|magnesium|zinc|vitamin|mineral|elderberry|sambucus|b[\s-]*complex)\b/i,
    },
    {
      key: "high_value_research",
      label: "High-value research",
      targetCount: 80,
      nestedClusters: Object.entries(COMMON_CLUSTERS).map(([key, value]) => ({
        key,
        targetCount: 10,
        ...value,
      })),
    },
    {
      key: "product_type_boundary",
      label: "Product-type boundary",
      targetCount: 80,
      terms: ["greens powder", "tea bags", "juice powder", "gummies", "snack", "stroopwafel", "dragon fruit"],
      include: /greens powder|tea bags?|juice powder|gumm(?:y|ies)|snack|stroopwafel|dragon fruit|beet root/i,
      aligned: /.+/i,
    },
    {
      key: "random_residue",
      label: "Random residue",
      targetCount: 80,
      terms: ["supplement", "capsules", "tablets", "softgels", "powder", "extract"],
      include: /./i,
      aligned: /.+/i,
    },
  ],
  fresh2000: [
    {
      key: "high_value_supplement_cluster",
      label: "High-value supplement cluster",
      targetCount: 800,
      nestedClusters: Object.entries(COMMON_CLUSTERS).map(([key, value]) => ({
        key,
        targetCount: 100,
        ...value,
      })),
    },
    {
      key: "common_vitamins_minerals",
      label: "Common vitamins/minerals",
      targetCount: 500,
      terms: ["vitamin d", "vitamin c", "b complex", "iron", "calcium", "multivitamin"],
      include: /\b(?:vitamin\s*d|vitamin\s*c|b[\s-]*complex|iron|calcium|multi(?:vitamin)?)\b/i,
      aligned: /\b(?:vitamin|mineral|iron|calcium|b[\s-]*complex|ascorbic|cholecalciferol)\b/i,
    },
    {
      key: "popular_high_frequency_brands",
      label: "Popular/high-frequency brands",
      targetCount: 400,
      terms: ["Sports Research", "California Gold Nutrition", "Swanson", "NOW Foods", "Solgar", "Nature Made", "Nature's Way"],
      include: /\b(?:sports research|california gold nutrition|swanson|now foods|solgar|nature made|nature'?s way)\b/i,
      aligned: /.+/i,
    },
    {
      key: "food_like_edge_cases",
      label: "Food-like edge cases",
      targetCount: 200,
      terms: ["greens powder", "tea bags", "juice powder", "gummies", "snack", "stroopwafel"],
      include: /greens powder|tea bags?|juice powder|gumm(?:y|ies)|snack|stroopwafel|dragon fruit|beet root/i,
      aligned: /.+/i,
    },
    {
      key: "noisy_random_residue",
      label: "Noisy/random residue",
      targetCount: 100,
      terms: ["supplement", "capsules", "tablets", "softgels", "powder", "extract"],
      include: /./i,
      aligned: /.+/i,
    },
  ],
};

const launchScalePlan = (count) => [
  { ...plans.fresh2000[0], targetCount: Math.round(count * 0.4) },
  { ...plans.fresh2000[1], targetCount: Math.round(count * 0.25) },
  { ...plans.fresh2000[2], targetCount: Math.round(count * 0.2) },
  { ...plans.fresh2000[3], targetCount: Math.round(count * 0.1) },
  { ...plans.fresh2000[4], targetCount: count - Math.round(count * 0.95) },
];

const parseArgs = () => {
  const values = {
    mode: "targeted500",
    dryRun: false,
    concurrency: 3,
    sampleLimit: null,
    checkpointPath: null,
    outDir: "output/science-validation",
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--mode" && next) {
      values.mode = next;
      index += 1;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    } else if (arg === "--concurrency" && next) {
      values.concurrency = Number(next);
      index += 1;
    } else if (arg === "--sample-limit" && next) {
      values.sampleLimit = Number(next);
      index += 1;
    } else if (arg === "--checkpoint-path" && next) {
      values.checkpointPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    }
  }
  return values;
};

const readBackendEnv = async () => {
  const text = await fs.readFile(BACKEND_ENV_PATH, "utf8");
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  return values;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mapWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const uniqueBy = (rows, keyFn) => {
  const seen = new Set();
  const selected = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(row);
  }
  return selected;
};

const sampleKey = (sample) => `${sample.cluster}:${sample.barcode}`;

const queryCandidates = async (supabase, cluster, queryLimit = 1200) => {
  const rawCandidates = [];
  for (const term of cluster.terms ?? []) {
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select("product_id,brand_name,title,upc_code,barcode_gtin14")
      .ilike("title", `%${term}%`)
      .limit(queryLimit);
    if (error) throw error;
    if (Array.isArray(data)) rawCandidates.push(...data);
  }

  return uniqueBy(rawCandidates, (row) => normalizeBarcode(row.barcode_gtin14 ?? row.upc_code))
    .filter((row) => cluster.include.test(String(row.title ?? "")))
    .map((row) => ({
      cluster: cluster.key,
      clusterLabel: cluster.label,
      brandName: String(row.brand_name ?? "").trim() || null,
      title: String(row.title ?? "").trim(),
      barcode: normalizeBarcode(row.barcode_gtin14 ?? row.upc_code),
      productId: row.product_id ?? null,
      alignedPatternSource: cluster.aligned?.source ?? null,
    }))
    .filter((row) => row.barcode && row.title)
    .sort((a, b) =>
      String(a.brandName ?? "").localeCompare(String(b.brandName ?? ""))
      || a.title.localeCompare(b.title));
};

const selectClusterSamples = async (supabase, cluster) => {
  const targetCount = Number(cluster.targetCount ?? 0);
  if (targetCount <= 0) return [];
  const terms = Array.isArray(cluster.terms) && cluster.terms.length ? cluster.terms : [""];
  const perTermTarget = Math.max(1, Math.ceil(targetCount / terms.length));
  const balanced = [];

  for (const term of terms) {
    const termRows = await queryCandidates(supabase, {
      ...cluster,
      terms: term ? [term] : cluster.terms,
    });
    balanced.push(...termRows.slice(0, perTermTarget));
  }

  const dedupedBalanced = uniqueBy(balanced, (row) => row.barcode);
  if (dedupedBalanced.length >= targetCount) {
    return dedupedBalanced.slice(0, targetCount);
  }

  const fillRows = await queryCandidates(supabase, cluster);
  return uniqueBy([...dedupedBalanced, ...fillRows], (row) => row.barcode).slice(0, targetCount);
};

const expandPlan = (mode) => {
  if (mode === "launch5000") return launchScalePlan(5000);
  if (mode === "launch10000") return launchScalePlan(10000);
  if (mode === "launch20000") return launchScalePlan(20000);
  return plans[mode] ?? plans.targeted500;
};

const buildSelectedSamples = async (supabase, mode, sampleLimit) => {
  const plan = expandPlan(mode);
  const selected = [];
  for (const entry of plan) {
    if (Array.isArray(entry.nestedClusters)) {
      for (const nested of entry.nestedClusters) {
        const nestedRows = await selectClusterSamples(supabase, {
          ...nested,
          key: nested.key,
          label: nested.label,
        });
        selected.push(...nestedRows.map((row) => ({
          ...row,
          sampleGroup: entry.key,
        })));
      }
      continue;
    }
    const rows = await selectClusterSamples(supabase, entry);
    selected.push(...rows.map((row) => ({
      ...row,
      sampleGroup: entry.key,
    })));
  }

  return uniqueBy(selected, (row) => row.barcode)
    .slice(0, Number.isFinite(sampleLimit) ? sampleLimit : selected.length);
};

const buildHeaders = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "x-auth-disabled": "1",
  "x-local-personalization": PERSONALIZATION_HEADER,
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache",
});

const fetchJson = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, elapsedMs: Date.now() - startedAt, json };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      json: { error: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchDecisionSupport = async (barcode) => {
  const params = new URLSearchParams({ barcode, viewMode: "details" });
  return fetchJson(`${API_BASE_URL}/api/decision-support/v1?${params.toString()}`, {
    headers: buildHeaders(),
  });
};

const fetchIngredientOverview = async ({
  barcode,
  decisionDigest,
  decisionInputsHash,
  personalizationScopeHash,
  revalidateFallback = false,
}) =>
  fetchJson(`${API_BASE_URL}/api/ingredient-overview/v1`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      barcode,
      decisionDigest,
      decisionInputsHash,
      personalizationScopeHash,
      revalidateFallback,
    }),
  });

const fetchScientificBackground = async ({
  barcode,
  decisionDigest,
  decisionInputsHash,
  personalizationScopeHash,
  selectedIngredientName,
  revalidateFallback = false,
}) =>
  fetchJson(`${API_BASE_URL}/api/scientific-background/v1`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      barcode,
      decisionDigest,
      decisionInputsHash,
      personalizationScopeHash,
      selectedIngredientName,
      revalidateFallback,
    }),
  });

const clampScienceRetryDelay = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SCIENCE_MIN_RETRY_DELAY_MS;
  return Math.min(SCIENCE_MAX_RETRY_DELAY_MS, Math.max(SCIENCE_MIN_RETRY_DELAY_MS, Math.round(numeric)));
};

const summarizeDecisionSupport = (response, sample) => {
  const payload = response.json ?? {};
  const scienceRows = Array.isArray(payload?.scienceBlock?.ingredientRows)
    ? payload.scienceBlock.ingredientRows
    : [];
  const defaultRow = scienceRows[0] ?? null;
  const defaultIngredientName = typeof defaultRow?.name === "string" ? defaultRow.name : null;
  const alignedPattern = sample.alignedPatternSource ? new RegExp(sample.alignedPatternSource, "i") : /.+/i;
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs: response.elapsedMs,
    digest: typeof payload?.digest === "string" ? payload.digest : null,
    decisionInputsHash: typeof payload?.decisionInputsHash === "string" ? payload.decisionInputsHash : null,
    personalizationScopeHash: typeof payload?.personalizationScopeHash === "string" ? payload.personalizationScopeHash : null,
    sourceType: typeof payload?.sourceType === "string" ? payload.sourceType : null,
    defaultIngredientName,
    defaultIngredientDose: defaultRow?.dose ?? null,
    defaultIngredientAligned: defaultIngredientName ? alignedPattern.test(defaultIngredientName) : false,
    scienceRowCount: scienceRows.length,
  };
};

const runSample = async (sample) => {
  const decisionSupport = await fetchDecisionSupport(sample.barcode);
  const ds = summarizeDecisionSupport(decisionSupport, sample);
  if (!ds.ok || !ds.digest || !ds.decisionInputsHash || !ds.personalizationScopeHash) {
    return { ...sample, decisionSupport: ds, ingredientOverview: null, scientificBackground: null };
  }

  const selectedIngredientName = ds.defaultIngredientName;
  const ingredientOverviewInitial = selectedIngredientName
    ? await fetchIngredientOverview({
      barcode: sample.barcode,
      decisionDigest: ds.digest,
      decisionInputsHash: ds.decisionInputsHash,
      personalizationScopeHash: ds.personalizationScopeHash,
    })
    : null;
  let ingredientOverviewRevalidated = null;
  if (ingredientOverviewInitial?.ok && ingredientOverviewInitial?.json?.source === "fallback") {
    await sleep(INGREDIENT_OVERVIEW_RETRY_DELAY_MS);
    ingredientOverviewRevalidated = await fetchIngredientOverview({
      barcode: sample.barcode,
      decisionDigest: ds.digest,
      decisionInputsHash: ds.decisionInputsHash,
      personalizationScopeHash: ds.personalizationScopeHash,
      revalidateFallback: true,
    });
  }

  let scientificBackgroundInitial = null;
  const scientificBackgroundRevalidates = [];
  if (selectedIngredientName) {
    scientificBackgroundInitial = await fetchScientificBackground({
      barcode: sample.barcode,
      decisionDigest: ds.digest,
      decisionInputsHash: ds.decisionInputsHash,
      personalizationScopeHash: ds.personalizationScopeHash,
      selectedIngredientName,
    });
    let current = scientificBackgroundInitial;
    const revalidateStartedAt = Date.now();
    for (let attempt = 0; attempt < SCIENCE_MAX_REVALIDATES; attempt += 1) {
      const payload = current?.json ?? {};
      if (!current?.ok || payload?.source !== "fallback" || payload?.backgroundRefreshPending !== true) break;
      const elapsedWindowMs = Date.now() - revalidateStartedAt;
      if (elapsedWindowMs >= SCIENCE_MAX_REVALIDATE_WINDOW_MS) break;
      const retryAfterMs = clampScienceRetryDelay(payload?.recommendedRetryAfterMs);
      if (elapsedWindowMs + retryAfterMs > SCIENCE_MAX_REVALIDATE_WINDOW_MS) break;
      await sleep(retryAfterMs + SCIENCE_RETRY_BUFFER_MS);
      current = await fetchScientificBackground({
        barcode: sample.barcode,
        decisionDigest: ds.digest,
        decisionInputsHash: ds.decisionInputsHash,
        personalizationScopeHash: ds.personalizationScopeHash,
        selectedIngredientName,
        revalidateFallback: true,
      });
      scientificBackgroundRevalidates.push(current);
    }
  }

  const finalScientific =
    [...scientificBackgroundRevalidates].reverse().find((response) => response?.ok)
    ?? scientificBackgroundInitial;

  return {
    ...sample,
    decisionSupport: ds,
    ingredientOverview: {
      initial: ingredientOverviewInitial
        ? {
          ok: ingredientOverviewInitial.ok,
          status: ingredientOverviewInitial.status,
          elapsedMs: ingredientOverviewInitial.elapsedMs,
          source: ingredientOverviewInitial?.json?.source ?? null,
          fallbackUsed: ingredientOverviewInitial?.json?.fallbackUsed ?? null,
          promptVersion: ingredientOverviewInitial?.json?.promptVersion ?? null,
          ingredientOverview: ingredientOverviewInitial?.json?.ingredientOverview ?? null,
        }
        : null,
      revalidated: ingredientOverviewRevalidated
        ? {
          ok: ingredientOverviewRevalidated.ok,
          status: ingredientOverviewRevalidated.status,
          elapsedMs: ingredientOverviewRevalidated.elapsedMs,
          source: ingredientOverviewRevalidated?.json?.source ?? null,
          fallbackUsed: ingredientOverviewRevalidated?.json?.fallbackUsed ?? null,
          promptVersion: ingredientOverviewRevalidated?.json?.promptVersion ?? null,
          ingredientOverview: ingredientOverviewRevalidated?.json?.ingredientOverview ?? null,
        }
        : null,
    },
    scientificBackground: {
      selectedIngredientName,
      initial: scientificBackgroundInitial
        ? {
          ok: scientificBackgroundInitial.ok,
          status: scientificBackgroundInitial.status,
          elapsedMs: scientificBackgroundInitial.elapsedMs,
          source: scientificBackgroundInitial?.json?.source ?? null,
          fallbackUsed: scientificBackgroundInitial?.json?.fallbackUsed ?? null,
          mode: scientificBackgroundInitial?.json?.mode ?? null,
          backgroundRefreshPending: scientificBackgroundInitial?.json?.backgroundRefreshPending ?? null,
          recommendedRetryAfterMs: scientificBackgroundInitial?.json?.recommendedRetryAfterMs ?? null,
          genericHit: scientificGenericHit(scientificBackgroundInitial?.json?.scientificBackground),
          promptVersion: scientificBackgroundInitial?.json?.promptVersion ?? null,
          scientificBackground: scientificBackgroundInitial?.json?.scientificBackground ?? null,
        }
        : null,
      revalidates: scientificBackgroundRevalidates.map((response) => ({
        ok: response.ok,
        status: response.status,
        elapsedMs: response.elapsedMs,
        source: response?.json?.source ?? null,
        fallbackUsed: response?.json?.fallbackUsed ?? null,
        mode: response?.json?.mode ?? null,
        backgroundRefreshPending: response?.json?.backgroundRefreshPending ?? null,
        recommendedRetryAfterMs: response?.json?.recommendedRetryAfterMs ?? null,
        genericHit: scientificGenericHit(response?.json?.scientificBackground),
        promptVersion: response?.json?.promptVersion ?? null,
        scientificBackground: response?.json?.scientificBackground ?? null,
      })),
      final: finalScientific
        ? {
          ok: finalScientific.ok,
          status: finalScientific.status,
          elapsedMs: finalScientific.elapsedMs,
          source: finalScientific?.json?.source ?? null,
          fallbackUsed: finalScientific?.json?.fallbackUsed ?? null,
          mode: finalScientific?.json?.mode ?? null,
          backgroundRefreshPending: finalScientific?.json?.backgroundRefreshPending ?? null,
          recommendedRetryAfterMs: finalScientific?.json?.recommendedRetryAfterMs ?? null,
          genericHit: scientificGenericHit(finalScientific?.json?.scientificBackground),
          promptVersion: finalScientific?.json?.promptVersion ?? null,
          scientificBackground: finalScientific?.json?.scientificBackground ?? null,
        }
        : null,
    },
  };
};

const readCheckpointRows = async (filePath) => {
  const rowsByKey = new Map();
  try {
    const text = await fs.readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      rowsByKey.set(sampleKey(row), row);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return rowsByKey;
};

const appendCheckpointRow = async (filePath, row) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`);
};

const buildOutputName = (mode) => {
  if (mode === "fresh2000") return "fresh-2000";
  if (mode.startsWith("launch")) return mode;
  return "targeted-validation";
};

const main = async () => {
  const args = parseArgs();
  const generatedAt = new Date().toISOString();
  const env = await readBackendEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("missing_supabase_env");
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const samples = await buildSelectedSamples(supabase, args.mode, args.sampleLimit);
  const outputBase = buildOutputName(args.mode);
  const timestamp = Date.now();

  if (args.dryRun) {
    const outJson = path.join(args.outDir, `${outputBase}-dry-run-${timestamp}.json`);
    await writeJson(outJson, {
      generatedAt,
      reportType: "science_validation_dry_run",
      mode: args.mode,
      apiBaseUrl: API_BASE_URL,
      sampleCount: samples.length,
      samples,
    });
    console.log(path.join(ROOT_DIR, outJson));
    return;
  }

  const checkpointPath = args.checkpointPath
    ? path.resolve(ROOT_DIR, args.checkpointPath)
    : path.resolve(ROOT_DIR, args.outDir, `${outputBase}-${timestamp}.rows.jsonl`);
  const rowsByKey = await readCheckpointRows(checkpointPath);
  const pending = samples.filter((sample) => !rowsByKey.has(sampleKey(sample)));
  console.error(`[science-validation] mode=${args.mode} selected=${samples.length} completed=${rowsByKey.size} pending=${pending.length} concurrency=${args.concurrency}`);
  console.error(`[science-validation] checkpoint=${checkpointPath}`);

  await mapWithConcurrency(pending, args.concurrency, async (sample, index) => {
    console.error(`[science-validation] ${index + 1}/${pending.length} ${sample.cluster} ${sample.brandName ?? ""} ${sample.title}`);
    const row = await runSample(sample);
    rowsByKey.set(sampleKey(sample), row);
    await appendCheckpointRow(checkpointPath, row);
    return row;
  });

  const rows = samples.map((sample) => rowsByKey.get(sampleKey(sample))).filter(Boolean);
  const summary = summarizeValidationRows(rows);
  const outJson = path.join(args.outDir, `${outputBase}-${timestamp}.json`);
  const outMd = path.join(args.outDir, `${outputBase}-${timestamp}.md`);
  const failurePack = path.join(args.outDir, `${outputBase}-failure-pack-${timestamp}.json`);

  const output = {
    generatedAt,
    reportType: `science_${args.mode}_validation`,
    mode: args.mode,
    apiBaseUrl: API_BASE_URL,
    concurrency: args.concurrency,
    checkpointPath,
    summary,
    rows,
  };

  await writeJson(outJson, output);
  await writeText(outMd, renderMarkdownReport({
    title: args.mode === "fresh2000" ? "Science Fresh 2000 Validation" : "Science Targeted Validation",
    generatedAt,
    summary,
    phaseNotes: [
      args.mode === "targeted500"
        ? "Fresh 2000 should only run if this targeted validation passes the gates."
        : "If this fails, fix only the failure buckets before expanding sample size.",
    ],
  }));
  await writeJson(failurePack, {
    generatedAt,
    mode: args.mode,
    failureBuckets: summary.failureBuckets,
    topBadExamples: summary.topBadExamples,
    uxSourceCopy: summary.uxSourceCopy,
  });

  console.log(path.join(ROOT_DIR, outJson));
  console.log(path.join(ROOT_DIR, outMd));
  console.log(path.join(ROOT_DIR, failurePack));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
