#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  ROOT_DIR,
  ingredientOverviewGenericHit,
  scientificGenericHit,
} from "./lib/science-validation-reporting.mjs";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
};

const API_BASE_URL = getArg(
  "api-base-url",
  process.env.SCIENCE_VALIDATION_API_BASE_URL || process.env.API_BASE_URL || "http://127.0.0.1:3001",
);
const OUT_DIR = getArg("out-dir", "output/canadian_result_page_readiness");
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", "10")) || 10);
const LIMIT = Math.max(1, Number(getArg("limit", "5000")) || 5000);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const readBackendEnv = async () => {
  const envPath = path.resolve(ROOT_DIR, "backend", ".env");
  const text = await fs.readFile(envPath, "utf8");
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

const fetchJson = async (url) => {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const json = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      json,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      json: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

const evaluateDetailPayload = (data) => {
  const hasNutriScore = Number.isFinite(Number(data?.nutriScoreCardV2?.overallScore))
    && normalizeText(data?.nutriScoreCardV2?.overallBand).length > 0;
  const hasPersonalizedInsight = normalizeText(data?.personalizedResultLane?.personalInsight?.summary).length > 0;
  const hasDefaultAnchor = normalizeText(data?.defaultAnchor?.name).length > 0;
  const hasIngredientOverview = normalizeText(data?.ingredientOverview?.paragraph1).length > 0;
  const hasScientificBackground = Array.isArray(data?.scientificBackground?.sections)
    && data.scientificBackground.sections.length > 0;
  const hasDeepDive = hasIngredientOverview && hasScientificBackground;
  const ingredientOverviewGeneric = hasIngredientOverview
    ? ingredientOverviewGenericHit(data?.ingredientOverview)
    : false;
  const scientificBackgroundGeneric = hasScientificBackground
    ? scientificGenericHit(data?.scientificBackground)
    : false;
  return {
    hasNutriScore,
    hasPersonalizedInsight,
    hasDefaultAnchor,
    hasIngredientOverview,
    hasScientificBackground,
    hasDeepDive,
    ingredientOverviewGeneric,
    scientificBackgroundGeneric,
    ingredientOverviewFallbackReason:
      normalizeText(data?.ingredientOverviewDiagnostics?.fallbackReason) || null,
    scientificBackgroundFallbackReason:
      normalizeText(data?.scientificBackgroundDiagnostics?.fallbackReason) || null,
    sources: {
      ingredientOverview: data?.ingredientOverviewSource ?? null,
      scientificBackground: data?.scientificBackgroundSource ?? null,
    },
  };
};

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

const buildRows = async () => {
  const env = await readBackendEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_env");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("iherb_overlay_products")
    .select("product_id,brand_name,title,updated_at")
    .ilike("product_id", "ca-%")
    .order("updated_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;

  const seen = new Set();
  return (data ?? [])
    .map((row) => ({
      productId: normalizeText(row.product_id),
      brandName: normalizeText(row.brand_name) || null,
      title: normalizeText(row.title) || null,
    }))
    .filter((row) => {
      if (!row.productId || seen.has(row.productId)) return false;
      seen.add(row.productId);
      return true;
    });
};

const evaluateDetailRow = async (row) => {
  const url = `${API_BASE_URL.replace(/\/+$/, "")}/api/search/product-detail?productId=${encodeURIComponent(row.productId)}`;
  const coldResponse = await fetchJson(url);
  if (!coldResponse.ok) {
    return {
      ...row,
      status: "fail",
      reason: `detail_http_${coldResponse.status}`,
      httpStatus: coldResponse.status,
      cold: {
        httpStatus: coldResponse.status,
        latencyMs: coldResponse.latencyMs ?? null,
      },
      warm: null,
    };
  }
  const coldPayload = coldResponse.json;
  const coldData = coldPayload && typeof coldPayload === "object" && coldPayload.data && typeof coldPayload.data === "object"
    ? coldPayload.data
    : coldPayload;
  const cold = evaluateDetailPayload(coldData);

  const warmResponse = await fetchJson(url);
  const warmPayload = warmResponse.json;
  const warmData = warmPayload && typeof warmPayload === "object" && warmPayload.data && typeof warmPayload.data === "object"
    ? warmPayload.data
    : warmPayload;
  const warm = warmResponse.ok ? evaluateDetailPayload(warmData) : null;

  const failureReasons = [];
  if (!cold.hasNutriScore) failureReasons.push("nutri_score_missing");
  if (!cold.hasPersonalizedInsight) failureReasons.push("personalized_insight_missing");
  if (!cold.hasDefaultAnchor) failureReasons.push("default_anchor_missing");
  if (!cold.hasIngredientOverview) failureReasons.push("ingredient_overview_missing");
  if (!cold.hasScientificBackground) failureReasons.push("scientific_background_missing");
  if (cold.ingredientOverviewGeneric) failureReasons.push("ingredient_overview_generic");
  if (cold.scientificBackgroundGeneric) failureReasons.push("scientific_background_generic");
  if (!warmResponse.ok) failureReasons.push(`warm_detail_http_${warmResponse.status}`);

  return {
    ...row,
    status: failureReasons.length === 0 ? "pass" : "fail",
    reason: failureReasons[0] ?? "ready",
    failureReasons,
    httpStatus: coldResponse.status,
    hasNutriScore: cold.hasNutriScore,
    hasPersonalizedInsight: cold.hasPersonalizedInsight,
    hasDefaultAnchor: cold.hasDefaultAnchor,
    hasIngredientOverview: cold.hasIngredientOverview,
    hasScientificBackground: cold.hasScientificBackground,
    hasDeepDive: cold.hasDeepDive,
    ingredientOverviewGeneric: cold.ingredientOverviewGeneric,
    scientificBackgroundGeneric: cold.scientificBackgroundGeneric,
    ingredientOverviewFallbackReason: cold.ingredientOverviewFallbackReason,
    scientificBackgroundFallbackReason: cold.scientificBackgroundFallbackReason,
    sources: cold.sources,
    cold: {
      httpStatus: coldResponse.status,
      latencyMs: coldResponse.latencyMs ?? null,
      sources: cold.sources,
      ingredientOverviewFallbackReason: cold.ingredientOverviewFallbackReason,
      scientificBackgroundFallbackReason: cold.scientificBackgroundFallbackReason,
    },
    warm: {
      httpStatus: warmResponse.status,
      latencyMs: warmResponse.latencyMs ?? null,
      sources: warm?.sources ?? null,
      ingredientOverviewFallbackReason: warm?.ingredientOverviewFallbackReason ?? null,
      scientificBackgroundFallbackReason: warm?.scientificBackgroundFallbackReason ?? null,
    },
  };
};

const percentile = (values, p) => {
  const sorted = values
    .filter((value) => Number.isFinite(Number(value)) && Number(value) >= 0)
    .map((value) => Number(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, position));
  return sorted[index];
};

const buildSummary = (rows) => {
  const total = rows.length;
  const pass = rows.filter((row) => row.status === "pass").length;
  const pct = (count) => (total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0);
  const count = (key) => rows.filter((row) => row[key] === true).length;
  const coldLatencies = rows.map((row) => row?.cold?.latencyMs).filter((value) => Number.isFinite(Number(value)));
  const warmLatencies = rows.map((row) => row?.warm?.latencyMs).filter((value) => Number.isFinite(Number(value)));
  const sourceDistributionForSurface = (surface, metric) =>
    Object.entries(
      rows.reduce((acc, row) => {
        const source = normalizeText(row?.[surface]?.sources?.[metric]) || "unknown";
        acc[source] = (acc[source] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([source, countValue]) => ({ source, count: countValue }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const fallbackBucketForSurface = (surface, metric) =>
    Object.entries(
      rows
        .map((row) => normalizeText(row?.[surface]?.[metric]) || null)
        .filter(Boolean)
        .reduce((acc, reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {}),
    )
      .map(([reason, countValue]) => ({ reason, count: countValue }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    total,
    pass,
    fail: total - pass,
    passRate: pct(pass),
    nutriScoreReady: count("hasNutriScore"),
    personalizedInsightReady: count("hasPersonalizedInsight"),
    defaultAnchorReady: count("hasDefaultAnchor"),
    ingredientOverviewReady: count("hasIngredientOverview"),
    scientificBackgroundReady: count("hasScientificBackground"),
    deepDiveReady: count("hasDeepDive"),
    ingredientOverviewGeneric: count("ingredientOverviewGeneric"),
    scientificBackgroundGeneric: count("scientificBackgroundGeneric"),
    rates: {
      nutriScoreReady: pct(count("hasNutriScore")),
      personalizedInsightReady: pct(count("hasPersonalizedInsight")),
      defaultAnchorReady: pct(count("hasDefaultAnchor")),
      ingredientOverviewReady: pct(count("hasIngredientOverview")),
      scientificBackgroundReady: pct(count("hasScientificBackground")),
      deepDiveReady: pct(count("hasDeepDive")),
      ingredientOverviewGeneric: pct(count("ingredientOverviewGeneric")),
      scientificBackgroundGeneric: pct(count("scientificBackgroundGeneric")),
    },
    latency: {
      coldP95Ms: percentile(coldLatencies, 95),
      warmP95Ms: percentile(warmLatencies, 95),
    },
    apiHitRate: {
      ingredientOverview: {
        cold: pct(rows.filter((row) => normalizeText(row?.cold?.sources?.ingredientOverview) === "api").length),
        warm: pct(rows.filter((row) => normalizeText(row?.warm?.sources?.ingredientOverview) === "api").length),
      },
      scientificBackground: {
        cold: pct(rows.filter((row) => normalizeText(row?.cold?.sources?.scientificBackground) === "api").length),
        warm: pct(rows.filter((row) => normalizeText(row?.warm?.sources?.scientificBackground) === "api").length),
      },
    },
    failureBuckets: Object.entries(
      rows
        .flatMap((row) => row.failureReasons ?? [])
        .reduce((acc, reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {}),
      )
      .map(([reason, countValue]) => ({ reason, count: countValue }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    sourceDistribution: {
      cold: {
        ingredientOverview: sourceDistributionForSurface("cold", "ingredientOverview"),
        scientificBackground: sourceDistributionForSurface("cold", "scientificBackground"),
      },
      warm: {
        ingredientOverview: sourceDistributionForSurface("warm", "ingredientOverview"),
        scientificBackground: sourceDistributionForSurface("warm", "scientificBackground"),
      },
    },
    fallbackReasonBuckets: {
      cold: {
        ingredientOverview: fallbackBucketForSurface("cold", "ingredientOverviewFallbackReason"),
        scientificBackground: fallbackBucketForSurface("cold", "scientificBackgroundFallbackReason"),
      },
      warm: {
        ingredientOverview: fallbackBucketForSurface("warm", "ingredientOverviewFallbackReason"),
        scientificBackground: fallbackBucketForSurface("warm", "scientificBackgroundFallbackReason"),
      },
    },
  };
};

const main = async () => {
  const selectedRows = await buildRows();
  const evaluatedRows = await mapWithConcurrency(selectedRows, CONCURRENCY, evaluateDetailRow);
  const summary = buildSummary(evaluatedRows);
  const generatedAt = new Date().toISOString();

  const report = {
    reportType: "canadian_result_page_readiness_audit",
    generatedAt,
    apiBaseUrl: API_BASE_URL,
    concurrency: CONCURRENCY,
    summary,
    rows: evaluatedRows,
  };

  const outDir = path.resolve(ROOT_DIR, OUT_DIR);
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "canadian_result_page_readiness_audit.json");
  const mdPath = path.join(outDir, "canadian_result_page_readiness_audit.md");

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const failingRows = evaluatedRows.filter((row) => row.status !== "pass").slice(0, 80);
  const md = [
    "# Canadian Result Page Readiness Audit",
    "",
    `- generatedAt: ${generatedAt}`,
    `- total: ${summary.total}`,
    `- pass: ${summary.pass}`,
    `- fail: ${summary.fail}`,
    `- passRate: ${summary.passRate}%`,
    "",
    "## Core Coverage",
    "",
    `- nutriScoreReady: ${summary.nutriScoreReady} (${summary.rates.nutriScoreReady}%)`,
    `- personalizedInsightReady: ${summary.personalizedInsightReady} (${summary.rates.personalizedInsightReady}%)`,
    `- defaultAnchorReady: ${summary.defaultAnchorReady} (${summary.rates.defaultAnchorReady}%)`,
    `- ingredientOverviewReady: ${summary.ingredientOverviewReady} (${summary.rates.ingredientOverviewReady}%)`,
    `- scientificBackgroundReady: ${summary.scientificBackgroundReady} (${summary.rates.scientificBackgroundReady}%)`,
    `- deepDiveReady: ${summary.deepDiveReady} (${summary.rates.deepDiveReady}%)`,
    "",
    "## Latency & Hit Rate",
    "",
    `- cold p95 latency: ${summary.latency.coldP95Ms ?? "n/a"} ms`,
    `- warm p95 latency: ${summary.latency.warmP95Ms ?? "n/a"} ms`,
    `- ingredientOverview api hit (cold/warm): ${summary.apiHitRate.ingredientOverview.cold}% / ${summary.apiHitRate.ingredientOverview.warm}%`,
    `- scientificBackground api hit (cold/warm): ${summary.apiHitRate.scientificBackground.cold}% / ${summary.apiHitRate.scientificBackground.warm}%`,
    "",
    "## Generic Copy",
    "",
    `- ingredientOverviewGeneric: ${summary.ingredientOverviewGeneric} (${summary.rates.ingredientOverviewGeneric}%)`,
    `- scientificBackgroundGeneric: ${summary.scientificBackgroundGeneric} (${summary.rates.scientificBackgroundGeneric}%)`,
    "",
    "## Source Distribution (Cold)",
    "",
    ...summary.sourceDistribution.cold.ingredientOverview.map(
      (row) => `- ingredientOverviewSource.${row.source}: ${row.count}`,
    ),
    ...summary.sourceDistribution.cold.scientificBackground.map(
      (row) => `- scientificBackgroundSource.${row.source}: ${row.count}`,
    ),
    "",
    "## Source Distribution (Warm)",
    "",
    ...summary.sourceDistribution.warm.ingredientOverview.map(
      (row) => `- ingredientOverviewSource.${row.source}: ${row.count}`,
    ),
    ...summary.sourceDistribution.warm.scientificBackground.map(
      (row) => `- scientificBackgroundSource.${row.source}: ${row.count}`,
    ),
    "",
    "## Fallback Reasons (Cold)",
    "",
    ...(summary.fallbackReasonBuckets.cold.ingredientOverview.length > 0
      ? summary.fallbackReasonBuckets.cold.ingredientOverview.map(
          (row) => `- ingredientOverviewFallback.${row.reason}: ${row.count}`,
        )
      : ["- ingredientOverviewFallback: none"]),
    ...(summary.fallbackReasonBuckets.cold.scientificBackground.length > 0
      ? summary.fallbackReasonBuckets.cold.scientificBackground.map(
          (row) => `- scientificBackgroundFallback.${row.reason}: ${row.count}`,
        )
      : ["- scientificBackgroundFallback: none"]),
    "",
    "## Fallback Reasons (Warm)",
    "",
    ...(summary.fallbackReasonBuckets.warm.ingredientOverview.length > 0
      ? summary.fallbackReasonBuckets.warm.ingredientOverview.map(
          (row) => `- ingredientOverviewFallback.${row.reason}: ${row.count}`,
        )
      : ["- ingredientOverviewFallback: none"]),
    ...(summary.fallbackReasonBuckets.warm.scientificBackground.length > 0
      ? summary.fallbackReasonBuckets.warm.scientificBackground.map(
          (row) => `- scientificBackgroundFallback.${row.reason}: ${row.count}`,
        )
      : ["- scientificBackgroundFallback: none"]),
    "",
    "## Failure Buckets",
    "",
    ...(summary.failureBuckets.length > 0
      ? summary.failureBuckets.map((bucket) => `- ${bucket.reason}: ${bucket.count}`)
      : ["- none"]),
    "",
    "## Failing Rows (first 80)",
    "",
    ...(failingRows.length > 0
      ? failingRows.map(
          (row) =>
            `- ${row.productId} | ${row.brandName ?? "Unknown"} | ${row.title ?? "Untitled"} | ${(
              row.failureReasons ?? []
            ).join(", ")}`,
        )
      : ["- none"]),
    "",
  ].join("\n");

  await fs.writeFile(mdPath, `${md}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          json: path.relative(ROOT_DIR, jsonPath),
          md: path.relative(ROOT_DIR, mdPath),
        },
        summary,
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
