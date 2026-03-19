#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";

import {
  buildRowAnalysis,
  pct,
  safeText,
  summarizeModuleScores,
  summarizeTopBlockers,
  toRelative,
  writeJson,
  writeJsonl,
  readJson,
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
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`),
);

const main = async () => {
  const manifest = await readJson(MANIFEST_PATH);
  const rows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const results = [];
  let errorCount = 0;

  for (const [index, sample] of rows.entries()) {
    try {
      const analysis = buildRowAnalysis(sample.rowData);
      const payload = analysis.payload;
      results.push({
        sampleId: sample.sampleId,
        layer: sample.layer,
        samplingReason: sample.samplingReason,
        isHighFrequency: sample.isHighFrequency,
        productId: sample.productId,
        barcode_gtin14: sample.barcode_gtin14,
        brandName: sample.brandName,
        title: sample.title,
        predictedCategoryId: sample.predictedCategoryId,
        categoryId: analysis.categoryId,
        categoryMatchesManifest: sample.predictedCategoryId === analysis.categoryId,
        sourceType: analysis.sourceType,
        verdict: safeText(payload?.verdict),
        overallScore: Number(payload?.nutriScoreCardV2?.overallScore ?? 0),
        overallBand: safeText(payload?.nutriScoreCardV2?.overallBand),
        confidencePct: Number(payload?.nutriScoreCardV2?.confidencePct ?? 0),
        scoreV2Ready: analysis.scoreV2Ready,
        deepContentReady: analysis.deepContentReady,
        moduleScores: summarizeModuleScores(payload),
        topBlockers: summarizeTopBlockers(payload),
        qualityMarkStatus: safeText(payload?.qualityMark?.status) || "unknown",
        extraTrustSignalsCount: Array.isArray(payload?.extraTrustSignals) ? payload.extraTrustSignals.length : 0,
      });
      if ((index + 1) % 50 === 0) {
        console.error(`[score-category-harness] processed ${index + 1}/${rows.length}`);
      }
    } catch (error) {
      errorCount += 1;
      results.push({
        sampleId: sample.sampleId,
        layer: sample.layer,
        samplingReason: sample.samplingReason,
        isHighFrequency: sample.isHighFrequency,
        productId: sample.productId,
        barcode_gtin14: sample.barcode_gtin14,
        brandName: sample.brandName,
        title: sample.title,
        predictedCategoryId: sample.predictedCategoryId,
        categoryId: "error",
        categoryMatchesManifest: false,
        sourceType: "error",
        verdict: "error",
        overallScore: 0,
        overallBand: "error",
        confidencePct: 0,
        scoreV2Ready: false,
        deepContentReady: false,
        moduleScores: [],
        topBlockers: [],
        qualityMarkStatus: "error",
        extraTrustSignalsCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = {
    sampleCount: rows.length,
    resultCount: results.length,
    errorCount,
    scoreV2ReadyRate: pct(results.filter((row) => row.scoreV2Ready).length, rows.length),
    deepContentReadyRate: pct(results.filter((row) => row.deepContentReady).length, rows.length),
    unknownCategoryRate: pct(results.filter((row) => row.categoryId === "unknown").length, rows.length),
  };

  const outJsonl = path.join(OUT_DIR, "decision_support_results.jsonl");
  const outSummary = path.join(OUT_DIR, "run_summary.json");
  await writeJsonl(outJsonl, results);
  await writeJson(outSummary, {
    schemaVersion: "iherb_score_category_harness_run.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      sampleManifestPath: toRelative(MANIFEST_PATH),
    },
    summary,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        outputs: {
          resultsJsonl: toRelative(outJsonl),
          summaryJson: toRelative(outSummary),
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
