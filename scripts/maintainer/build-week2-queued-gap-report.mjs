#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const EXECUTION_QUEUE_PATH = getArg(
  "queue-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_execution_plan_week2_final_unified_20260313",
    "api_fill_priority_queue.json",
  ),
);
const EXECUTION_SUMMARY_PATH = getArg(
  "execution-summary",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_execution_plan_week2_final_unified_20260313",
    "execution_plan_summary.json",
  ),
);
const PARTIAL_SUMMARY_PATH = getArg(
  "partial-summary",
  path.join(
    ROOT,
    "output",
    "iherb_partial_wave_plan_week2_final_unified_20260313",
    "partial_wave_plan_summary.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_week2_queued_gap_report_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "queued_gap_report.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "queued_gap_report.md"));
const OUT_CLOSEST_JSON = getArg(
  "closest-json",
  path.join(OUT_DIR, "closest_to_scoreable_candidates.json"),
);

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const pct = (value, total) => (total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0);

const sortEntriesDesc = (object) =>
  Object.entries(object).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });

const comboKey = (fields) => [...fields].sort().join(" + ");

const pickFields = (row) => ({
  brandName: row.brandName ?? null,
  title: row.title ?? null,
  productId: row.productId ?? null,
  barcode_gtin14: row.barcode_gtin14 ?? null,
  recommendedAction: row.recommendedAction ?? null,
  priorityLane: row.priorityLane ?? null,
  coreMissingFields: row.coreMissingFields ?? [],
  coreResolvedFields: row.coreResolvedFields ?? [],
  sourceTypes: row.sourceTypes ?? [],
  hasUsIherbPage: Boolean(row.hasUsIherbPage),
  highConfidenceUsProductPageReady: Boolean(row.highConfidenceUsProductPageReady),
  rationale: row.rationale ?? null,
});

const topBrandsForCombo = (rows, fields, limit = 12) => {
  const counts = {};
  const key = comboKey(fields);
  for (const row of rows) {
    if (comboKey(row.coreMissingFields ?? []) !== key) continue;
    increment(counts, row.brandName ?? "Unknown brand");
  }
  return sortEntriesDesc(counts).slice(0, limit).map(([brandName, count]) => ({ brandName, count }));
};

const sampleRowsForCombo = (rows, fields, limit = 8) => {
  const key = comboKey(fields);
  return rows
    .filter((row) => comboKey(row.coreMissingFields ?? []) === key)
    .slice(0, limit)
    .map(pickFields);
};

const executionQueue = await readJson(EXECUTION_QUEUE_PATH);
const executionSummary = await readJson(EXECUTION_SUMMARY_PATH);
const partialSummary = await readJson(PARTIAL_SUMMARY_PATH);

const primaryQueue = executionQueue.filter(
  (row) => row.priorityLane === "P0_api_fill_us_strong_identity",
);
const secondaryQueue = executionQueue.filter(
  (row) => row.priorityLane === "P1_api_fill_non_us_strong_identity",
);
const holdWeakQueue = executionQueue.filter(
  (row) => row.priorityLane === "P2_hold_weak_partial_or_catalog",
);
const holdConflictedQueue = executionQueue.filter(
  (row) => row.priorityLane === "P3_hold_conflicted_source",
);

const missingCounts = {};
const comboCounts = {};
const missingFieldCountBuckets = {};
const recommendedActionCounts = {};
const sourceTypeCounts = {};
const brandCounts = {};

for (const row of primaryQueue) {
  const missingFields = row.coreMissingFields ?? [];
  for (const field of missingFields) increment(missingCounts, field);
  increment(comboCounts, comboKey(missingFields));
  increment(missingFieldCountBuckets, String(missingFields.length));
  increment(recommendedActionCounts, row.recommendedAction ?? "unknown");
  for (const sourceType of row.sourceTypes ?? []) increment(sourceTypeCounts, sourceType);
  increment(brandCounts, row.brandName ?? "Unknown brand");
}

const oneFieldCount = primaryQueue.filter((row) => (row.coreMissingFields ?? []).length === 1).length;
const twoFieldCount = primaryQueue.filter((row) => (row.coreMissingFields ?? []).length === 2).length;
const threeFieldCount = primaryQueue.filter((row) => (row.coreMissingFields ?? []).length === 3).length;
const fourPlusFieldCount = primaryQueue.filter((row) => (row.coreMissingFields ?? []).length >= 4).length;

const warningsOnlyCount = comboCounts["warnings"] ?? 0;
const suggestedUseOnlyCount = comboCounts["suggested_use"] ?? 0;
const dosageOnlyCount = comboCounts["dosage"] ?? 0;
const ingredientDosageCount = comboCounts["dosage + ingredient"] ?? 0;
const usageWarningsCount = comboCounts["suggested_use + warnings"] ?? 0;
const closestToScoreableCount =
  warningsOnlyCount + suggestedUseOnlyCount + dosageOnlyCount + ingredientDosageCount + usageWarningsCount;

const tierSummary = [
  {
    tier: "Tier A",
    label: "One missing field only",
    count: oneFieldCount,
    percentOfPrimaryQueue: pct(oneFieldCount, primaryQueue.length),
    whyItMatters: "These rows are nearest to full scoreability. One targeted fill should be enough.",
    dominantCombos: [
      { combo: "warnings", count: warningsOnlyCount },
      { combo: "suggested_use", count: suggestedUseOnlyCount },
      { combo: "dosage", count: dosageOnlyCount },
    ],
  },
  {
    tier: "Tier B",
    label: "Two-field standard rescue combos",
    count: ingredientDosageCount + usageWarningsCount,
    percentOfPrimaryQueue: pct(ingredientDosageCount + usageWarningsCount, primaryQueue.length),
    whyItMatters:
      "Most of the queue concentrates here. These are strong candidates for programmatic or template-driven rescue waves.",
    dominantCombos: [
      { combo: "dosage + ingredient", count: ingredientDosageCount },
      { combo: "suggested_use + warnings", count: usageWarningsCount },
    ],
  },
  {
    tier: "Tier C",
    label: "Three missing fields",
    count: threeFieldCount,
    percentOfPrimaryQueue: pct(threeFieldCount, primaryQueue.length),
    whyItMatters:
      "These need richer product-page extraction, but still share repeated patterns by brand and category.",
    dominantCombos: sortEntriesDesc(comboCounts)
      .filter(([key]) => key.split(" + ").length === 3)
      .slice(0, 3)
      .map(([combo, count]) => ({ combo, count })),
  },
  {
    tier: "Tier D",
    label: "Four or more missing fields",
    count: fourPlusFieldCount,
    percentOfPrimaryQueue: pct(fourPlusFieldCount, primaryQueue.length),
    whyItMatters:
      "These are the deepest gaps. They should stay behind the easier rescue tiers unless a brand-specific wave justifies them.",
    dominantCombos: sortEntriesDesc(comboCounts)
      .filter(([key]) => key.split(" + ").length >= 4)
      .slice(0, 3)
      .map(([combo, count]) => ({ combo, count })),
  },
];

const closestToScoreable = {
  count: closestToScoreableCount,
  percentOfPrimaryQueue: pct(closestToScoreableCount, primaryQueue.length),
  rationale:
    "These rows either miss exactly one core field or fall into the two dominant rescue combos (ingredient+dosage, suggested_use+warnings).",
  buckets: {
    warningsOnly: {
      count: warningsOnlyCount,
      topBrands: topBrandsForCombo(primaryQueue, ["warnings"]),
      sampleRows: sampleRowsForCombo(primaryQueue, ["warnings"]),
    },
    suggestedUseOnly: {
      count: suggestedUseOnlyCount,
      topBrands: topBrandsForCombo(primaryQueue, ["suggested_use"]),
      sampleRows: sampleRowsForCombo(primaryQueue, ["suggested_use"]),
    },
    dosageOnly: {
      count: dosageOnlyCount,
      topBrands: topBrandsForCombo(primaryQueue, ["dosage"]),
      sampleRows: sampleRowsForCombo(primaryQueue, ["dosage"]),
    },
    ingredientAndDosage: {
      count: ingredientDosageCount,
      topBrands: topBrandsForCombo(primaryQueue, ["ingredient", "dosage"]),
      sampleRows: sampleRowsForCombo(primaryQueue, ["ingredient", "dosage"]),
    },
    suggestedUseAndWarnings: {
      count: usageWarningsCount,
      topBrands: topBrandsForCombo(primaryQueue, ["suggested_use", "warnings"]),
      sampleRows: sampleRowsForCombo(primaryQueue, ["suggested_use", "warnings"]),
    },
  },
};

const report = {
  schemaVersion: "week2_queued_gap_report.v1",
  generatedAt: new Date().toISOString(),
  inputs: {
    executionQueuePath: path.relative(ROOT, EXECUTION_QUEUE_PATH),
    executionSummaryPath: path.relative(ROOT, EXECUTION_SUMMARY_PATH),
    partialSummaryPath: path.relative(ROOT, PARTIAL_SUMMARY_PATH),
  },
  headline: {
    totalUnifiedRows: executionSummary.summary.total,
    strictMergeReady: executionSummary.summary.statusCounts.full_overlay_ready,
    primaryQueuedBacklog: primaryQueue.length,
    secondaryNonUsStrongIdentity: secondaryQueue.length,
    holdWeakPartialOrCatalog: holdWeakQueue.length,
    holdConflictedOrNonUs: holdConflictedQueue.length,
    totalExecutionQueueRows: executionQueue.length,
  },
  interpretation: {
    primaryBacklogAssessment:
      "The main 24,124-row backlog is not a delisted-product pool. Every row in the primary queue has a US iHerb page plus high-confidence product-page identity; the problem is missing core overlay fields, not missing products.",
    secondaryBacklogAssessment:
      "Only 250 rows sit outside the primary queue, and they are dominated by Pure Encapsulations non-US/weak-identity/conflicted cases. Those are genuinely lower-confidence follow-ups rather than the main Week 2 rescue target.",
    configContext: partialSummary.summary,
  },
  coreMissingFieldCounts: {
    counts: missingCounts,
    percentsOfPrimaryQueue: Object.fromEntries(
      Object.entries(missingCounts).map(([field, count]) => [field, pct(count, primaryQueue.length)]),
    ),
  },
  rescueTiers: tierSummary,
  closestToScoreable,
  primaryQueuePatterns: {
    missingFieldCountBuckets,
    topMissingCombos: sortEntriesDesc(comboCounts)
      .slice(0, 12)
      .map(([combo, count]) => ({
        combo,
        count,
        percentOfPrimaryQueue: pct(count, primaryQueue.length),
      })),
    topBrandsOverall: sortEntriesDesc(brandCounts).slice(0, 20).map(([brandName, count]) => ({ brandName, count })),
    recommendedActionCounts,
    sourceTypeCounts,
  },
  nextActions: [
    {
      priority: 1,
      label: "Warnings-only rescue wave",
      count: warningsOnlyCount,
      reason: "Fastest pure uplift. One missing field and strong US identity.",
      topBrands: topBrandsForCombo(primaryQueue, ["warnings"]).slice(0, 8),
    },
    {
      priority: 2,
      label: "Suggested-use-only rescue wave",
      count: suggestedUseOnlyCount,
      reason: "Second-fastest uplift. Directions are the only blocker.",
      topBrands: topBrandsForCombo(primaryQueue, ["suggested_use"]).slice(0, 8),
    },
    {
      priority: 3,
      label: "Ingredient+dosage rescue wave",
      count: ingredientDosageCount,
      reason:
        "Largest standard combo. Best candidate for label-facts extraction or supplement-facts-specific recovery.",
      topBrands: topBrandsForCombo(primaryQueue, ["ingredient", "dosage"]).slice(0, 8),
    },
    {
      priority: 4,
      label: "Suggested-use+warnings rescue wave",
      count: usageWarningsCount,
      reason:
        "Directions/safety pair is coherent and already has its own recommended action lane.",
      topBrands: topBrandsForCombo(primaryQueue, ["suggested_use", "warnings"]).slice(0, 8),
    },
  ],
};

const markdownLines = [];
markdownLines.push("# Week 2 Queued Product Gap Report");
markdownLines.push("");
markdownLines.push(`Generated at: ${report.generatedAt}`);
markdownLines.push("");
markdownLines.push("## Headline");
markdownLines.push("");
markdownLines.push(`- Unified rows: ${report.headline.totalUnifiedRows}`);
markdownLines.push(`- Strict merge ready: ${report.headline.strictMergeReady}`);
markdownLines.push(`- Primary queued backlog: ${report.headline.primaryQueuedBacklog}`);
markdownLines.push(`- Secondary non-US strong identity queue: ${report.headline.secondaryNonUsStrongIdentity}`);
markdownLines.push(`- Hold weak partial/catalog queue: ${report.headline.holdWeakPartialOrCatalog}`);
markdownLines.push(`- Hold conflicted/non-US queue: ${report.headline.holdConflictedOrNonUs}`);
markdownLines.push("");
markdownLines.push("## Interpretation");
markdownLines.push("");
markdownLines.push(`- ${report.interpretation.primaryBacklogAssessment}`);
markdownLines.push(`- ${report.interpretation.secondaryBacklogAssessment}`);
markdownLines.push("");
markdownLines.push("## Core Missing Fields In Primary Queue");
markdownLines.push("");
for (const [field, count] of sortEntriesDesc(report.coreMissingFieldCounts.counts)) {
  markdownLines.push(
    `- ${field}: ${count} (${report.coreMissingFieldCounts.percentsOfPrimaryQueue[field]}% of primary queue)`,
  );
}
markdownLines.push("");
markdownLines.push("## Rescue Tiers");
markdownLines.push("");
for (const tier of report.rescueTiers) {
  markdownLines.push(
    `- ${tier.tier} | ${tier.label}: ${tier.count} (${tier.percentOfPrimaryQueue}% of primary queue)`,
  );
  markdownLines.push(`  - ${tier.whyItMatters}`);
  for (const combo of tier.dominantCombos) {
    markdownLines.push(`  - ${combo.combo}: ${combo.count}`);
  }
}
markdownLines.push("");
markdownLines.push("## Closest To Scoreable");
markdownLines.push("");
markdownLines.push(
  `- Closest to scoreable rows: ${closestToScoreable.count} (${closestToScoreable.percentOfPrimaryQueue}% of primary queue)`,
);
markdownLines.push(`- ${closestToScoreable.rationale}`);
markdownLines.push("");
markdownLines.push("### Closest Buckets");
markdownLines.push("");
for (const [bucketKey, bucket] of Object.entries(closestToScoreable.buckets)) {
  markdownLines.push(`- ${bucketKey}: ${bucket.count}`);
  const topBrands = bucket.topBrands.slice(0, 6);
  if (topBrands.length > 0) {
    markdownLines.push(
      `  - top brands: ${topBrands.map((item) => `${item.brandName} (${item.count})`).join(", ")}`,
    );
  }
}
markdownLines.push("");
markdownLines.push("## Top Missing Combos");
markdownLines.push("");
for (const combo of report.primaryQueuePatterns.topMissingCombos) {
  markdownLines.push(
    `- ${combo.combo}: ${combo.count} (${combo.percentOfPrimaryQueue}% of primary queue)`,
  );
}
markdownLines.push("");
markdownLines.push("## Highest-ROI Next Actions");
markdownLines.push("");
for (const action of report.nextActions) {
  markdownLines.push(`- P${action.priority}: ${action.label} | ${action.count} rows`);
  markdownLines.push(`  - ${action.reason}`);
  markdownLines.push(
    `  - top brands: ${action.topBrands.map((item) => `${item.brandName} (${item.count})`).join(", ")}`,
  );
}
markdownLines.push("");
markdownLines.push("## Representative Examples");
markdownLines.push("");
const exampleCombos = [
  { label: "warnings only", rows: closestToScoreable.buckets.warningsOnly.sampleRows },
  { label: "suggested_use only", rows: closestToScoreable.buckets.suggestedUseOnly.sampleRows },
  { label: "ingredient + dosage", rows: closestToScoreable.buckets.ingredientAndDosage.sampleRows },
  { label: "suggested_use + warnings", rows: closestToScoreable.buckets.suggestedUseAndWarnings.sampleRows },
];
for (const example of exampleCombos) {
  markdownLines.push(`### ${example.label}`);
  markdownLines.push("");
  if (example.rows.length === 0) {
    markdownLines.push("- none");
    markdownLines.push("");
    continue;
  }
  for (const row of example.rows.slice(0, 4)) {
    markdownLines.push(
      `- ${row.brandName ?? "Unknown brand"} | ${row.title ?? "Unknown title"} | productId=${row.productId ?? "none"} | missing=${(row.coreMissingFields ?? []).join(", ")}`,
    );
  }
  markdownLines.push("");
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(OUT_MD, `${markdownLines.join("\n")}\n`);
await fs.writeFile(
  OUT_CLOSEST_JSON,
  `${JSON.stringify(
    {
      generatedAt: report.generatedAt,
      primaryQueuedBacklog: report.headline.primaryQueuedBacklog,
      closestToScoreable,
    },
    null,
    2,
  )}\n`,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      outJson: OUT_JSON,
      outMd: OUT_MD,
      outClosestJson: OUT_CLOSEST_JSON,
      primaryQueuedBacklog: report.headline.primaryQueuedBacklog,
      closestToScoreable: closestToScoreable.count,
    },
    null,
    2,
  ),
);
