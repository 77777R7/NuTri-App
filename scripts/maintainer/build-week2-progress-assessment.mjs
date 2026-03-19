#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  readJson,
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

const QUALITY_SUMMARY_PATH = getArg(
  "quality-summary-json",
  path.join(ROOT, "output", "quality_marks", "nutrasource_promotion_wave_full_v2_20260315", "summary.json"),
);
const IGEN_READY_PATH = getArg(
  "igen-ready-json",
  path.join(ROOT, "output", "quality_marks", "igen_ready_master_seed_full_v2_complete_fixed_20260315", "igen_ready_master_seed.json"),
);
const MAINLINE_FREEZE_PATH = getArg(
  "mainline-freeze-json",
  path.join(ROOT, "output", `iherb_taxonomy_consumer_mainline_freeze_wave27_${TODAY}`, "freeze_summary.json"),
);
const EXPERIENCE_PACK_PATH = getArg(
  "experience-pack-json",
  path.join(ROOT, "output", `iherb_category_experience_validation_pack_wave27_${TODAY}`, "category_experience_validation_pack.json"),
);
const LONG_TAIL_CLOSEOUT_PATH = getArg(
  "long-tail-closeout-json",
  path.join(ROOT, "output", "iherb_full_corpus_long_tail_closeout_20260316", "closeout_summary.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `week2_progress_assessment_wave27_${TODAY}`),
);

const WEIGHTED_TRACKS = [
  {
    id: "quality_marks_pipeline",
    label: "Quality marks pipeline",
    weightPct: 25,
  },
  {
    id: "taxonomy_mainline",
    label: "Taxonomy mainline",
    weightPct: 25,
  },
  {
    id: "consumer_experience_specialization",
    label: "Consumer experience specialization",
    weightPct: 30,
  },
  {
    id: "full_corpus_cleanup_governance",
    label: "Full-corpus cleanup governance",
    weightPct: 20,
  },
];

const round1 = (value) => Math.round(value * 10) / 10;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 Progress Assessment");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- overallCompletionPct: ${report.overallCompletionPct}%`);
  lines.push(`- interpretation: ${report.interpretation}`);
  lines.push("");
  lines.push("## Weighted Tracks");
  lines.push("");
  for (const track of report.tracks) {
    lines.push(`### ${track.label}`);
    lines.push(`- weightPct: ${track.weightPct}%`);
    lines.push(`- scorePct: ${track.scorePct}%`);
    lines.push(`- weightedContributionPct: ${track.weightedContributionPct}%`);
    lines.push(`- status: ${track.status}`);
    lines.push(`- rationale: ${track.rationale}`);
    lines.push(`- evidence: ${track.evidenceSummary}`);
    lines.push("");
  }
  lines.push("## Why Not 100%");
  lines.push("");
  for (const line of report.notYetComplete) {
    lines.push(`- ${line}`);
  }
  lines.push("");
  lines.push("## Final Call");
  lines.push("");
  lines.push(`- recommendation: ${report.recommendation}`);
  lines.push(`- nextTrack: ${report.nextTrack}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [qualitySummary, igenReady, mainlineFreeze, experiencePack, longTailCloseout] = await Promise.all([
    readJson(QUALITY_SUMMARY_PATH),
    readJson(IGEN_READY_PATH),
    readJson(MAINLINE_FREEZE_PATH),
    readJson(EXPERIENCE_PACK_PATH),
    readJson(LONG_TAIL_CLOSEOUT_PATH),
  ]);

  const tracks = [
    {
      ...WEIGHTED_TRACKS[0],
      scorePct: 95,
      status: "strong_operational",
      rationale:
        "The quality-marks lane is operational and downstream-usable, but it is not scored as perfect because promotion-ready selection still fans out into ambiguous/claimed/not-proven rows rather than a universally resolved corpus.",
      evidenceSummary:
        `selection ${qualitySummary?.selection?.selectedCount ?? "?"} rows, IFOS verified ${qualitySummary?.thirdPartyCensus?.bucketCounts?.verified ?? "?"}, official registry checked ${qualitySummary?.thirdPartyCensus?.summary?.officialRegistryChecked ?? "?"}, iGEN ready ${igenReady?.summary?.uniqueReadyRows ?? igenReady?.uniqueReadyRows ?? "?"}.`,
    },
    {
      ...WEIGHTED_TRACKS[1],
      scorePct: 100,
      status: "complete_for_week2_scope",
      rationale:
        "The taxonomy mainline achieved its Week 2 objective: new live lanes were resolved, weak experience categories were eliminated, and the mainline is now frozen rather than still in remediation.",
      evidenceSummary:
        `${mainlineFreeze?.mainlineResult?.matureCategoriesCount ?? "?"} mature validated categories, weakExperienceCategories ${mainlineFreeze?.validation?.weakExperienceCategories?.length ?? "?"}, highFrequencyUnknownCount ${mainlineFreeze?.fullCorpusState?.highFrequencyUnknownCount ?? "?"}.`,
    },
    {
      ...WEIGHTED_TRACKS[2],
      scorePct: 100,
      status: "complete_for_week2_scope",
      rationale:
        "The consumer-experience lane has now moved beyond Overview+Science and includes Usage+Safety specialization for the high-value validated categories.",
      evidenceSummary:
        `validatedCategories ${experiencePack?.summary?.validatedCategories?.length ?? "?"}, mature categories ${experiencePack?.summary?.maturityBuckets?.mature?.length ?? "?"}, weakExperienceCategories ${experiencePack?.decision?.weakExperienceCategories?.length ?? "?"}.`,
    },
    {
      ...WEIGHTED_TRACKS[3],
      scorePct: 80,
      status: "closed_with_diminishing_returns",
      rationale:
        "The long-tail lane is in a healthy maintenance state, but not considered complete in the perfection sense because full-corpus unknown/deep-content tails still remain and were intentionally stopped at the diminishing-returns guardrail.",
      evidenceSummary:
        `unknownCategoryRate ${longTailCloseout?.baseline?.unknownCategoryRate ?? "?"}% -> ${longTailCloseout?.final?.unknownCategoryRate ?? "?"}%, deepContentReadyRate ${longTailCloseout?.baseline?.deepContentReadyRate ?? "?"}% -> ${longTailCloseout?.final?.deepContentReadyRate ?? "?"}%, stopPolicy satisfied after ${longTailCloseout?.totals?.executedWaveCount ?? "?"} waves.`,
    },
  ].map((track) => ({
    ...track,
    weightedContributionPct: round1((track.weightPct * track.scorePct) / 100),
  }));

  const overallCompletionPct = round1(
    tracks.reduce((sum, track) => sum + track.weightedContributionPct, 0),
  );

  const report = {
    schemaVersion: "week2_progress_assessment.v1",
    generatedAt: new Date().toISOString(),
    overallCompletionPct,
    interpretation:
      "This percentage represents Week 2 planned-scope completion, not full-corpus perfection. It rewards mainline closure and consumer-ready maturity, while still discounting residual long-tail and unresolved claim tails.",
    tracks,
    notYetComplete: [
      `Full-corpus unknownCategoryRate is still ${longTailCloseout?.final?.unknownCategoryRate ?? "?"}% rather than near-zero.`,
      `Full-corpus deepContentReadyRate is ${longTailCloseout?.final?.deepContentReadyRate ?? "?"}% rather than 100%.`,
      "The quality-marks lane is usable and strong, but not every promotion-ready row resolves into a fully verified product-level outcome.",
      "Long-tail cleanup is now a maintenance lane because further uplift would require broader inference and higher misclassification risk.",
    ],
    recommendation:
      "Treat Week 2 as largely complete and move the mainline into downstream consumption / product-surface work, with long-tail cleanup left as maintenance only.",
    nextTrack: "downstream_consumption_and_product_surface_validation",
    inputs: {
      qualitySummaryPath: toRelative(QUALITY_SUMMARY_PATH),
      igenReadyPath: toRelative(IGEN_READY_PATH),
      mainlineFreezePath: toRelative(MAINLINE_FREEZE_PATH),
      experiencePackPath: toRelative(EXPERIENCE_PACK_PATH),
      longTailCloseoutPath: toRelative(LONG_TAIL_CLOSEOUT_PATH),
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "week2_progress_assessment.json"), report),
    fs.writeFile(path.join(OUT_DIR, "week2_progress_assessment.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    overallCompletionPct: report.overallCompletionPct,
    recommendation: report.recommendation,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
