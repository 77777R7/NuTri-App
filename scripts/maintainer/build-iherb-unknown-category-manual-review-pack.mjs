#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";

import {
  readJson,
  safeText,
  toObjectRecord,
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

const HARNESS_DIR = getArg(
  "harness-dir",
  path.join(ROOT, "output", `iherb_score_category_harness_post_category_expansion_wave5_${TODAY}`),
);
const SUMMARY_PATH = getArg("quality-summary-json", path.join(HARNESS_DIR, "quality_summary.json"));
const MANIFEST_PATH = getArg("sample-manifest-json", path.join(HARNESS_DIR, "sample_manifest.json"));
const PRECISION_PATH = getArg(
  "precision-pass-json",
  path.join(ROOT, "output", `iherb_unknown_category_precision_pass_wave5_${TODAY}`, "unknown_category_precision_pass.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_unknown_category_manual_review_pack_${TODAY}`),
);

const normalizeCorpus = (rowData) => {
  const sections = toObjectRecord(rowData?.descriptionSections);
  const facts = toObjectRecord(rowData?.supplementFacts);
  const nutritionalFacts = Array.isArray(facts?.nutritionalFacts)
    ? facts.nutritionalFacts
        .map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name))
        .filter(Boolean)
        .join(" ")
    : "";
  const categories = Array.isArray(rowData?.categories)
    ? rowData.categories.map((item) => safeText(item)).filter(Boolean).join(" ")
    : "";
  return [
    safeText(rowData?.brandName),
    safeText(rowData?.title),
    categories,
    safeText(sections?.Description),
    safeText(sections?.["Suggested use"] ?? sections?.["Suggested Use"]),
    safeText(sections?.Warnings),
    nutritionalFacts,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const decideReviewAction = (row) => {
  const rowData = toObjectRecord(row.rowData);
  const title = safeText(row.title).toLowerCase();
  const corpus = normalizeCorpus(rowData);

  const matches = (re) => re.test(`${title} ${corpus}`);

  if (matches(/\b5-hydroxytryptophan\b|\b5-htp\b/)) {
    return {
      reviewLane: "existing_category_micro_fix",
      recommendedCategoryId: "sleep_stress_mood_support",
      recommendation: "promote_to_existing_category",
      confidence: "high",
      rationale: "Clear 5-HTP signal should already map to sleep/stress/mood support; this looks like a title-normalization gap.",
    };
  }

  if (matches(/\bginkgo biloba\b|\bgotu kola\b|\bphosphatidylserine\b|\bnicotinamide riboside\b|\bniagen\b|\bnad\+\b|\bcell regenerator\b/)) {
    return {
      reviewLane: "existing_category_micro_fix",
      recommendedCategoryId: "nootropic_memory_cognition",
      recommendation: "promote_to_existing_category",
      confidence: "high",
      rationale: "Cognitive/nootropic signal is explicit; this is residual boundary noise, not a new taxonomy problem.",
    };
  }

  if (matches(/\bastragalus\b|\bsweet wormwood\b|\bfenugreek\b|\bolive leaf\b|\bshilajit\b|\bginger\b|\bchanca piedra\b|\bcinnamon\b|\blicorice\b|\bbutterbur\b|\bsaffron\b|\bcoleus forskoh?lii\b|\bgrapefruit seed extract\b/)) {
    return {
      reviewLane: "existing_category_micro_fix",
      recommendedCategoryId: "botanical_herbal_support",
      recommendation: "promote_to_existing_category",
      confidence: "medium",
      rationale: "This looks like a straightforward herbal/botanical product that escaped the current detector dictionary.",
    };
  }

  if (matches(/\bmushrooms?\b|\bcordyceps\b|\bcordychi\b/)) {
    return {
      reviewLane: "existing_category_micro_fix",
      recommendedCategoryId: "superfoods_mushrooms_greens",
      recommendation: "promote_to_existing_category",
      confidence: "medium",
      rationale: "Mushroom-centered products fit the existing superfoods/mushrooms lane better than unknown.",
    };
  }

  if (matches(/\bniacin\b|\bvitamin b-?3\b/)) {
    return {
      reviewLane: "existing_category_micro_fix",
      recommendedCategoryId: "specialty_vitamins_other",
      recommendation: "promote_to_existing_category",
      confidence: "high",
      rationale: "Plain niacin/vitamin B3 products fit the current specialty vitamins lane.",
    };
  }

  if (matches(/\bsweetener\b|\bsugar\b|\bhoney\b|\brub\b|\bstroopwafel\b|\bstevia\b/)) {
    return {
      reviewLane: "out_of_scope_non_supplement",
      recommendedCategoryId: null,
      recommendation: "keep_unknown",
      confidence: "high",
      rationale: "This appears to be grocery/food/pantry merchandise rather than a supplement deep-category target.",
    };
  }

  if (matches(/\btudca\b|\bxylimelts?\b|\bdry mouth\b|\bbeta ecdysterone\b|\bnucleotide\b|\brna\b|\bdna\b|\bupsorb\b|\banabol\b/)) {
    return {
      reviewLane: "new_taxonomy_candidate",
      recommendedCategoryId: null,
      recommendation: "needs_new_taxonomy_or_semantic_layer",
      confidence: "medium",
      rationale: "This looks like a specialty functional product that does not cleanly fit the current category map.",
    };
  }

  return {
    reviewLane: "residual_unknown_keep",
    recommendedCategoryId: null,
    recommendation: "keep_unknown_for_now",
    confidence: "low",
    rationale: "This row remains mixed or ambiguous enough that forcing a detector category would likely add noise.",
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Unknown Category Manual Review Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- promoteToExistingCategory: ${report.summary.promoteToExistingCategory}`);
  lines.push(`- newTaxonomyCandidates: ${report.summary.newTaxonomyCandidates}`);
  lines.push(`- outOfScopeNonSupplement: ${report.summary.outOfScopeNonSupplement}`);
  lines.push(`- keepUnknownForNow: ${report.summary.keepUnknownForNow}`);
  lines.push("");
  lines.push("## Review Lanes");
  lines.push("");
  for (const lane of report.reviewLanes) {
    lines.push(`### ${lane.reviewLane}`);
    lines.push(`- count: ${lane.count}`);
    lines.push(`- sample_titles: ${lane.sampleTitles.join(" | ") || "n/a"}`);
    lines.push("");
  }
  lines.push("## Existing Category Micro-fix Candidates");
  lines.push("");
  for (const row of report.rows.filter((item) => item.reviewLane === "existing_category_micro_fix")) {
    lines.push(`- ${row.sampleId}: ${row.brandName} - ${row.title} -> ${row.recommendedCategoryId} (${row.confidence})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [summary, manifest, precision] = await Promise.all([
    readJson(SUMMARY_PATH),
    readJson(MANIFEST_PATH),
    readJson(PRECISION_PATH),
  ]);

  const unknownRows = Array.isArray(summary?.anomalyBuckets?.unknown_category) ? summary.anomalyBuckets.unknown_category : [];
  const manifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const manifestBySampleId = new Map(manifestRows.map((row) => [safeText(row.sampleId), row]));

  const clusterBySampleId = new Map();
  for (const cluster of Array.isArray(precision?.priorityClusters) ? precision.priorityClusters : []) {
    for (const row of Array.isArray(cluster?.rows) ? cluster.rows : []) {
      clusterBySampleId.set(safeText(row.sampleId), safeText(cluster.clusterId) || "residual");
    }
  }

  const reviewRows = unknownRows.map((row) => {
    const manifestRow = manifestBySampleId.get(safeText(row.sampleId));
    const rowData = toObjectRecord(manifestRow?.rowData);
    const decision = decideReviewAction({
      ...row,
      rowData,
    });
    return {
      sampleId: safeText(row.sampleId),
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      overallScore: Number(row.overallScore ?? 0),
      isHighFrequency: Boolean(row.isHighFrequency),
      clusterId: clusterBySampleId.get(safeText(row.sampleId)) || "residual",
      reviewLane: decision.reviewLane,
      recommendedCategoryId: decision.recommendedCategoryId,
      recommendation: decision.recommendation,
      confidence: decision.confidence,
      rationale: decision.rationale,
    };
  });

  const countBy = (predicate) => reviewRows.filter(predicate).length;

  const reviewLanes = Object.entries(
    reviewRows.reduce((acc, row) => {
      acc[row.reviewLane] ??= [];
      acc[row.reviewLane].push(row);
      return acc;
    }, {}),
  )
    .map(([reviewLane, rows]) => ({
      reviewLane,
      count: rows.length,
      sampleTitles: rows.slice(0, 6).map((row) => `${row.brandName} - ${row.title}`),
    }))
    .sort((a, b) => b.count - a.count || a.reviewLane.localeCompare(b.reviewLane));

  const report = {
    schemaVersion: "iherb_unknown_category_manual_review_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      qualitySummaryPath: toRelative(SUMMARY_PATH),
      sampleManifestPath: toRelative(MANIFEST_PATH),
      precisionPassPath: toRelative(PRECISION_PATH),
    },
    summary: {
      unknownSampleCount: reviewRows.length,
      promoteToExistingCategory: countBy((row) => row.recommendation === "promote_to_existing_category"),
      newTaxonomyCandidates: countBy((row) => row.recommendation === "needs_new_taxonomy_or_semantic_layer"),
      outOfScopeNonSupplement: countBy((row) => row.reviewLane === "out_of_scope_non_supplement"),
      keepUnknownForNow: countBy((row) => row.recommendation === "keep_unknown_for_now"),
      highFrequencyUnknownCount: countBy((row) => row.isHighFrequency),
    },
    reviewLanes,
    rows: reviewRows,
  };

  const outJson = path.join(OUT_DIR, "unknown_category_manual_review_pack.json");
  const outMd = path.join(OUT_DIR, "unknown_category_manual_review_pack.md");
  await writeJson(outJson, report);
  await import("node:fs/promises").then((fs) => fs.writeFile(outMd, toMarkdown(report), "utf8"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outputs: {
          reportJson: toRelative(outJson),
          reportMd: toRelative(outMd),
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
