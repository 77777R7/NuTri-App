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

const WAVE8_HARNESS_DIR = getArg(
  "wave8-harness-dir",
  path.join(ROOT, "output", `iherb_score_category_harness_post_category_expansion_wave8_${TODAY}`),
);
const WAVE8_CLOSEOUT_DIR = getArg(
  "wave8-closeout-dir",
  path.join(ROOT, "output", `iherb_category_closeout_decision_route_wave8_${TODAY}`),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_wave8_taxonomy_freeze_${TODAY}`),
);

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Wave8 Taxonomy Freeze");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownCategoryRate: ${report.summary.unknownCategoryRate}%`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- highFrequencyUnknownCount: ${report.summary.highFrequencyUnknownCount}`);
  lines.push(`- scoreV2ReadyRate: ${report.summary.scoreV2ReadyRate}%`);
  lines.push(`- deepContentReadyRate: ${report.summary.deepContentReadyRate}%`);
  lines.push("");
  lines.push("## Locked Decisions");
  lines.push("");
  lines.push(`- liveNewCategories: ${report.decisions.liveNewCategories.join(", ") || "none"}`);
  lines.push(`- confirmedExcludeCount: ${report.decisions.confirmedExcludeCount}`);
  lines.push(`- keepUnknownCount: ${report.decisions.keepUnknownCount}`);
  lines.push(`- taxonomyCandidateCount: ${report.decisions.taxonomyCandidateCount}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- harness: ${report.inputs.wave8HarnessSummaryPath}`);
  lines.push(`- closeout: ${report.inputs.wave8CloseoutRoutePath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [qualitySummary, decisionRoute, excludeReviewed, keepUnknownPolicy, taxonomyDesign] = await Promise.all([
    readJson(path.join(WAVE8_HARNESS_DIR, "quality_summary.json")),
    readJson(path.join(WAVE8_CLOSEOUT_DIR, "category_closeout_decision_route.json")),
    readJson(path.join(WAVE8_CLOSEOUT_DIR, "exclude_non_supplement_reviewed.json")),
    readJson(path.join(WAVE8_CLOSEOUT_DIR, "keep_unknown_backlog_policy.json")),
    readJson(path.join(WAVE8_CLOSEOUT_DIR, "taxonomy_vnext_design.json")),
  ]);

  const report = {
    schemaVersion: "iherb_wave8_taxonomy_freeze.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      wave8HarnessSummaryPath: toRelative(path.join(WAVE8_HARNESS_DIR, "quality_summary.json")),
      wave8CloseoutRoutePath: toRelative(path.join(WAVE8_CLOSEOUT_DIR, "category_closeout_decision_route.json")),
      wave8ExcludeReviewPath: toRelative(path.join(WAVE8_CLOSEOUT_DIR, "exclude_non_supplement_reviewed.json")),
      wave8KeepUnknownPolicyPath: toRelative(path.join(WAVE8_CLOSEOUT_DIR, "keep_unknown_backlog_policy.json")),
      wave8TaxonomyDesignPath: toRelative(path.join(WAVE8_CLOSEOUT_DIR, "taxonomy_vnext_design.json")),
    },
    summary: {
      unknownCategoryRate: qualitySummary?.summary?.unknownCategoryRate ?? null,
      unknownSampleCount: decisionRoute?.summary?.unknownSampleCount ?? null,
      highFrequencyUnknownCount: decisionRoute?.summary?.highFrequencyUnknownCount ?? null,
      scoreV2ReadyRate: qualitySummary?.summary?.scoreV2ReadyRate ?? null,
      deepContentReadyRate: qualitySummary?.summary?.deepContentReadyRate ?? null,
      categoryMismatchRate: qualitySummary?.summary?.categoryMismatchRate ?? null,
    },
    decisions: {
      liveNewCategories: ["metabolic_glucose_support", "sports_anabolic_support"],
      confirmedExcludeCount: excludeReviewed?.summary?.confirmedExclude ?? null,
      keepUnknownCount: keepUnknownPolicy?.summary?.backlogCount ?? null,
      taxonomyCandidateCount: taxonomyDesign?.summary?.taxonomyCandidateCount ?? null,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "wave8_taxonomy_freeze.json"), report),
    fs.writeFile(path.join(OUT_DIR, "wave8_taxonomy_freeze.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    summary: report.summary,
    decisions: report.decisions,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
