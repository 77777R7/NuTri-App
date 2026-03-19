#!/usr/bin/env node
/* eslint-disable no-console */
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

const TRUTH_SET_PATH = getArg(
  "truth-set-json",
  path.join(ROOT, "output", `iherb_unknown_category_truth_set_pack_wave7_${TODAY}`, "unknown_category_truth_set_pack.json"),
);
const QUALITY_SUMMARY_PATH = getArg(
  "quality-summary-json",
  path.join(ROOT, "output", `iherb_score_category_harness_post_category_expansion_wave7_${TODAY}`, "quality_summary.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_unknown_category_closeout_pack_${TODAY}`),
);

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Unknown Category Closeout Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownCategoryRate: ${report.summary.unknownCategoryRate}%`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- promoteToExistingCategoryRemaining: ${report.summary.promoteToExistingCategoryRemaining}`);
  lines.push(`- newTaxonomyCandidates: ${report.summary.newTaxonomyCandidates}`);
  lines.push(`- excludeNonSupplement: ${report.summary.excludeNonSupplement}`);
  lines.push(`- keepUnknownForNow: ${report.summary.keepUnknownForNow}`);
  lines.push("");
  lines.push("## Action Files");
  lines.push("");
  lines.push(`- exclude_seed: ${report.outputs.excludeSeed}`);
  lines.push(`- taxonomy_candidates: ${report.outputs.taxonomyCandidates}`);
  lines.push(`- keep_unknown_backlog: ${report.outputs.keepUnknownBacklog}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [truthSet, qualitySummary] = await Promise.all([
    readJson(TRUTH_SET_PATH),
    readJson(QUALITY_SUMMARY_PATH),
  ]);

  const rows = Array.isArray(truthSet?.rows) ? truthSet.rows : [];
  const excludeSeed = rows.filter((row) => row.truthDisposition === "exclude_non_supplement");
  const taxonomyCandidates = rows.filter((row) => row.truthDisposition === "needs_new_taxonomy");
  const keepUnknownBacklog = rows.filter((row) => row.truthDisposition === "keep_unknown_for_now");
  const promoteRemaining = rows.filter((row) => row.truthDisposition === "promote_to_existing_category");

  const report = {
    schemaVersion: "iherb_unknown_category_closeout_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      truthSetPath: toRelative(TRUTH_SET_PATH),
      qualitySummaryPath: toRelative(QUALITY_SUMMARY_PATH),
    },
    summary: {
      unknownCategoryRate: qualitySummary?.summary?.unknownCategoryRate ?? null,
      unknownSampleCount: rows.length,
      promoteToExistingCategoryRemaining: promoteRemaining.length,
      newTaxonomyCandidates: taxonomyCandidates.length,
      excludeNonSupplement: excludeSeed.length,
      keepUnknownForNow: keepUnknownBacklog.length,
      highFrequencyUnknownCount: rows.filter((row) => row.isHighFrequency).length,
    },
    outputs: {
      excludeSeed: "exclude_non_supplement_seed.json",
      taxonomyCandidates: "new_taxonomy_candidates.json",
      keepUnknownBacklog: "keep_unknown_backlog.json",
    },
  };

  await writeJson(path.join(OUT_DIR, "unknown_category_closeout_pack.json"), report);
  await writeJson(path.join(OUT_DIR, "exclude_non_supplement_seed.json"), excludeSeed);
  await writeJson(path.join(OUT_DIR, "new_taxonomy_candidates.json"), taxonomyCandidates);
  await writeJson(path.join(OUT_DIR, "keep_unknown_backlog.json"), keepUnknownBacklog);
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(path.join(OUT_DIR, "unknown_category_closeout_pack.md"), toMarkdown(report), "utf8"),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outputs: {
          closeoutJson: "unknown_category_closeout_pack.json",
          excludeSeed: "exclude_non_supplement_seed.json",
          taxonomyCandidates: "new_taxonomy_candidates.json",
          keepUnknownBacklog: "keep_unknown_backlog.json",
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
