#!/usr/bin/env -S node --import tsx

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assessNonSupplementGoalGate,
  getNonSupplementGoalGatingRules,
} from "../../lib/personalization/core/nonSupplementGoalGating.ts";

type SplitLane =
  | "likely_non_supplement_surface"
  | "likely_parser_failure_supplement_surface"
  | "manual_review";

type SplitRow = {
  splitLane: SplitLane;
  productId: string;
  brandName: string;
  title: string;
  sourceZipPath: string | null;
  firstRawRows: string[];
};

type GateEvaluationRow = SplitRow & {
  gated: boolean;
  matchedRules: string[];
};

type BucketSummary = {
  total: number;
  gated: number;
  ungated: number;
  gatedRate: number;
  topMatchedRules: { rule: string; count: number }[];
  sampleGated: { productId: string; brandName: string; title: string; sourceZipPath: string | null }[];
  sampleUngated: { productId: string; brandName: string; title: string; sourceZipPath: string | null }[];
};

type GatingPackReport = {
  generatedAt: string;
  inputSplitJsonl: string;
  rulesVersion: string;
  totals: {
    rowsPresentButUnparsed: number;
    gatedRows: number;
  };
  bucketSummary: Record<SplitLane, BucketSummary>;
};

function getArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

const resolveLatestSplitJsonl = async (): Promise<string> => {
  const maintainerRoot = path.join(process.cwd(), "output", "maintainer-gates");
  const entries = await fs.readdir(maintainerRoot, { withFileTypes: true });
  const candidateDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("_iherb_rows_present_unparsed_split"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const latestDir = candidateDirs[0];
  if (!latestDir) {
    throw new Error("No previous iHerb rows-present-unparsed split run found under output/maintainer-gates.");
  }
  return path.join(maintainerRoot, latestDir, "iherb_rows_present_unparsed_split.jsonl");
};

const inputSplitJsonlPromise = getArg("split-jsonl")
  ? Promise.resolve(path.resolve(getArg("split-jsonl") as string))
  : resolveLatestSplitJsonl();

const outputDirPromise = (async (): Promise<string> => {
  const explicit = getArg("out-dir");
  if (explicit) return path.resolve(explicit);
  return path.join(
    process.cwd(),
    "output",
    "maintainer-gates",
    `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_non_supplement_goal_gating_pack`,
  );
})();

const increment = (map: Map<string, number>, key: string, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const toTopEntries = <TKey extends string>(
  map: Map<TKey, number>,
  keyName: string,
  limit = 12,
): Record<string, string | number>[] =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));

const SPLIT_LANES: readonly SplitLane[] = [
  "likely_non_supplement_surface",
  "likely_parser_failure_supplement_surface",
  "manual_review",
] as const;

const run = async () => {
  const inputSplitJsonl = await inputSplitJsonlPromise;
  const outputDir = await outputDirPromise;
  await fs.mkdir(outputDir, { recursive: true });

  const raw = await fs.readFile(inputSplitJsonl, "utf8");
  const splitRows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SplitRow);

  const evaluatedRows: GateEvaluationRow[] = splitRows.map((row) => {
    const decision = assessNonSupplementGoalGate({
      title: row.title,
      brandName: row.brandName,
      sourceZipPath: row.sourceZipPath,
    });
    return {
      ...row,
      gated: decision.shouldGate,
      matchedRules: decision.matchedRules.map((rule) => `${rule.type}:${rule.value}`),
    };
  });

  const bucketSummary = Object.fromEntries(
    SPLIT_LANES.map((lane) => {
      const rows = evaluatedRows.filter((row) => row.splitLane === lane);
      const gatedRows = rows.filter((row) => row.gated);
      const ungatedRows = rows.filter((row) => !row.gated);
      const ruleCounts = new Map<string, number>();
      for (const row of gatedRows) {
        for (const rule of row.matchedRules) {
          increment(ruleCounts, rule);
        }
      }
      return [
        lane,
        {
          total: rows.length,
          gated: gatedRows.length,
          ungated: ungatedRows.length,
          gatedRate: rows.length === 0 ? 0 : Number(((gatedRows.length / rows.length) * 100).toFixed(2)),
          topMatchedRules: toTopEntries(ruleCounts, "rule", 12) as { rule: string; count: number }[],
          sampleGated: gatedRows.slice(0, 12).map((row) => ({
            productId: row.productId,
            brandName: row.brandName,
            title: row.title,
            sourceZipPath: row.sourceZipPath,
          })),
          sampleUngated: ungatedRows.slice(0, 12).map((row) => ({
            productId: row.productId,
            brandName: row.brandName,
            title: row.title,
            sourceZipPath: row.sourceZipPath,
          })),
        },
      ];
    }),
  ) as Record<SplitLane, BucketSummary>;

  const rules = getNonSupplementGoalGatingRules();
  const gatedRows = evaluatedRows.filter((row) => row.gated);
  const report: GatingPackReport = {
    generatedAt: new Date().toISOString(),
    inputSplitJsonl,
    rulesVersion: rules.version,
    totals: {
      rowsPresentButUnparsed: evaluatedRows.length,
      gatedRows: gatedRows.length,
    },
    bucketSummary,
  };

  const jsonPath = path.join(outputDir, "iherb_non_supplement_goal_gating_pack.json");
  const mdPath = path.join(outputDir, "iherb_non_supplement_goal_gating_pack.md");
  const jsonlPath = path.join(outputDir, "iherb_non_supplement_goal_gating_candidates.jsonl");

  const markdownLines: string[] = [
    "# iHerb Non-Supplement Goal Gating Pack",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Input split: ${report.inputSplitJsonl}`,
    `- Rules version: ${report.rulesVersion}`,
    `- rowsPresentButUnparsed: ${report.totals.rowsPresentButUnparsed}`,
    `- gatedRows: ${report.totals.gatedRows}`,
    "",
    "## Rule Sources",
    `- excludedSourceZipPaths: ${rules.excludedSourceZipPaths.join(", ")}`,
    `- excludedBrandPhrases: ${rules.excludedBrandPhrases.join(", ")}`,
    `- excludedTitlePhrases: ${rules.excludedTitlePhrases.join(", ")}`,
    `- supplementOverrideTitlePhrases: ${rules.supplementOverrideTitlePhrases.join(", ")}`,
    "",
  ];

  for (const lane of SPLIT_LANES) {
    const summary = bucketSummary[lane];
    markdownLines.push(`## ${lane}`);
    markdownLines.push(`- total: ${summary.total}`);
    markdownLines.push(`- gated: ${summary.gated} (${summary.gatedRate}%)`);
    markdownLines.push(`- ungated: ${summary.ungated}`);
    markdownLines.push(...summary.topMatchedRules.map((entry) => `- matched rule: ${entry.rule} (${entry.count})`));
    markdownLines.push(...summary.sampleGated.map((row) => `- gated sample: ${row.brandName} — ${row.title} [${row.productId}]`));
    markdownLines.push(
      ...summary.sampleUngated.map((row) => `- ungated sample: ${row.brandName} — ${row.title} [${row.productId}]`),
    );
    markdownLines.push("");
  }

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(jsonlPath, `${gatedRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await fs.writeFile(mdPath, `${markdownLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        jsonlPath,
        mdPath,
        totals: report.totals,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[iherb-non-supplement-goal-gating-pack] failed", error);
  process.exitCode = 1;
});
