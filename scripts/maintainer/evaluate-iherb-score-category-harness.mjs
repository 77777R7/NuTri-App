#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";

import {
  pct,
  readJson,
  readJsonl,
  toRelative,
  writeJson,
} from "./lib/iherb-score-category-harness.mjs";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const MANIFEST_PATH = getArg(
  "sample-manifest-json",
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`, "sample_manifest.json"),
);
const RESULTS_PATH = getArg(
  "results-jsonl",
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`, "decision_support_results.jsonl"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`),
);

const bucketScore = (score) => {
  if (score >= 90) return "90_100";
  if (score >= 80) return "80_89";
  if (score >= 70) return "70_79";
  if (score >= 60) return "60_69";
  if (score >= 50) return "50_59";
  if (score >= 40) return "40_49";
  return "0_39";
};

const mean = (values) => (values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const stddev = (values) => {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
};

const topCounts = (rows, keyFn, limit = 20) =>
  Object.entries(
    rows.reduce((acc, row) => {
      const key = keyFn(row);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Score & Deep Category Harness Evaluation");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- sampleManifestPath: ${report.inputs.sampleManifestPath}`);
  lines.push(`- resultsPath: ${report.inputs.resultsPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- sample_count: ${report.summary.sampleCount}`);
  lines.push(`- score_v2_ready_rate: ${report.summary.scoreV2ReadyRate}%`);
  lines.push(`- deep_content_ready_rate: ${report.summary.deepContentReadyRate}%`);
  lines.push(`- unknown_category_rate: ${report.summary.unknownCategoryRate}%`);
  lines.push(`- category_mismatch_rate: ${report.summary.categoryMismatchRate}%`);
  lines.push("");
  lines.push("## Band Distribution");
  lines.push("");
  for (const [key, value] of Object.entries(report.bandDistribution)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Category Distribution");
  lines.push("");
  for (const [key, value] of Object.entries(report.categoryDistribution)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Anomaly Buckets");
  lines.push("");
  for (const [key, rows] of Object.entries(report.anomalyBuckets)) {
    lines.push(`- ${key}: ${rows.length}`);
  }
  lines.push("");
  lines.push("## Intra-category Spread");
  lines.push("");
  for (const row of report.intraCategorySpread) {
    lines.push(`- ${row.categoryId}: count=${row.count}, avg=${row.avgScore}, min=${row.minScore}, max=${row.maxScore}, stddev=${row.stddev}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [manifest, results] = await Promise.all([readJson(MANIFEST_PATH), readJsonl(RESULTS_PATH)]);
  const sampleRows = Array.isArray(manifest?.rows) ? manifest.rows : [];

  const scoreDistribution = {};
  const bandDistribution = {};
  const categoryDistribution = {};

  for (const row of results) {
    scoreDistribution[bucketScore(Number(row.overallScore ?? 0))] =
      (scoreDistribution[bucketScore(Number(row.overallScore ?? 0))] ?? 0) + 1;
    bandDistribution[row.overallBand] = (bandDistribution[row.overallBand] ?? 0) + 1;
    categoryDistribution[row.categoryId] = (categoryDistribution[row.categoryId] ?? 0) + 1;
  }

  const anomalyBuckets = {
    unknown_category: results.filter((row) => row.categoryId === "unknown"),
    category_mismatch: results.filter((row) => row.categoryMatchesManifest === false && row.categoryId !== "error"),
    score_without_deep_content: results.filter((row) => row.overallScore >= 80 && !row.deepContentReady),
    deep_content_without_category_specialization: results.filter((row) => row.deepContentReady && row.categoryId === "unknown"),
    high_score_with_major_blockers: results.filter((row) => row.overallScore >= 80 && (row.topBlockers?.length ?? 0) > 0),
    low_score_but_complete_data: results.filter((row) => row.overallScore <= 55 && row.scoreV2Ready && row.deepContentReady),
  };

  const intraCategorySpread = Object.entries(
    results.reduce((acc, row) => {
      const key = row.categoryId;
      acc[key] ??= [];
      acc[key].push(Number(row.overallScore ?? 0));
      return acc;
    }, {}),
  )
    .map(([categoryId, values]) => ({
      categoryId,
      count: values.length,
      avgScore: Number(mean(values).toFixed(1)),
      minScore: Math.min(...values),
      maxScore: Math.max(...values),
      stddev: Number(stddev(values).toFixed(1)),
    }))
    .sort((a, b) => b.count - a.count || a.categoryId.localeCompare(b.categoryId));

  const report = {
    schemaVersion: "iherb_score_category_harness_evaluation.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      sampleManifestPath: toRelative(MANIFEST_PATH),
      resultsPath: toRelative(RESULTS_PATH),
    },
    summary: {
      sampleCount: sampleRows.length,
      scoreV2ReadyRate: pct(results.filter((row) => row.scoreV2Ready).length, sampleRows.length),
      deepContentReadyRate: pct(results.filter((row) => row.deepContentReady).length, sampleRows.length),
      unknownCategoryRate: pct(results.filter((row) => row.categoryId === "unknown").length, sampleRows.length),
      categoryMismatchRate: pct(results.filter((row) => row.categoryMatchesManifest === false && row.categoryId !== "error").length, sampleRows.length),
      topBlockerDistribution: topCounts(
        results.flatMap((row) => row.topBlockers?.map((blocker) => ({ code: blocker.code })) ?? []),
        (row) => row.code || "unknown",
      ),
    },
    scoreDistribution,
    bandDistribution,
    categoryDistribution,
    intraCategorySpread,
    anomalyBuckets,
  };

  const outSummary = path.join(OUT_DIR, "quality_summary.json");
  const outAnomalies = path.join(OUT_DIR, "anomaly_buckets.json");
  const outMd = path.join(OUT_DIR, "quality_summary.md");
  await writeJson(outSummary, report);
  await writeJson(outAnomalies, anomalyBuckets);
  await writeJson(outMd, { markdown: toMarkdown(report) });
  await import("node:fs/promises").then((fs) => fs.writeFile(outMd, toMarkdown(report), "utf8"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outputs: {
          qualitySummaryJson: toRelative(outSummary),
          anomalyBucketsJson: toRelative(outAnomalies),
          qualitySummaryMd: toRelative(outMd),
        },
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
