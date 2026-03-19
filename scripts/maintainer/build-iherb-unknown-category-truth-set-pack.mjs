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
  path.join(ROOT, "output", `iherb_score_category_harness_post_category_expansion_wave6_${TODAY}`),
);
const SUMMARY_PATH = getArg("quality-summary-json", path.join(HARNESS_DIR, "quality_summary.json"));
const MANIFEST_PATH = getArg("sample-manifest-json", path.join(HARNESS_DIR, "sample_manifest.json"));
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_unknown_category_truth_set_pack_${TODAY}`),
);

const corpusFor = (rowData) => {
  const sections = toObjectRecord(rowData?.descriptionSections);
  const facts = toObjectRecord(rowData?.supplementFacts);
  const nutritionalFacts = Array.isArray(facts?.nutritionalFacts)
    ? facts.nutritionalFacts.map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name)).filter(Boolean).join(" ")
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

const classifyTruthDisposition = (row, rowData) => {
  const text = `${safeText(row.title).toLowerCase()} ${corpusFor(rowData)}`;
  const test = (re) => re.test(text);

  if (test(/\bsweetener\b|\bsugar\b|\bhoney\b|\brub\b|\bstroopwafel\b|\bstroopwafels\b|\bturbinado\b|\bstevia\b/)) {
    return {
      truthDisposition: "exclude_non_supplement",
      suggestedCategoryId: null,
      proposedTaxonomyKey: null,
      rationale: "This looks like pantry/grocery merchandise rather than a supplement deep-category target.",
    };
  }

  if (test(/\btheromega\b|\bfish oil\b|\bomega-3\b|\bepa\b|\bdha\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "fish_oil_omega3",
      proposedTaxonomyKey: null,
      rationale: "This appears to be a fish-oil product that escaped the omega-3 detector because of naming/marketing text.",
    };
  }

  if (test(/\bcoq-?10\b|\bcoenzyme q10\b|\blycopene\b|\bglutathione\b|\bpolicosanol\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "antioxidant_cellular_energy",
      proposedTaxonomyKey: null,
      rationale: "This fits the antioxidant/cellular-energy family more than true unknown.",
    };
  }

  if (test(/\bred yeast rice\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "cholesterol_lipid_support",
      rationale: "Red yeast rice behaves more like a cardiometabolic/cholesterol-support lane than current botanical or unknown buckets.",
    };
  }

  if (test(/\bberberine\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "metabolic_glucose_support",
      rationale: "Berberine products are recurring enough to justify a dedicated metabolic/glucose-support taxonomy instead of forcing them into existing buckets.",
    };
  }

  if (test(/\btudca\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "liver_bile_support",
      rationale: "TUDCA is a specialty hepatic/bile-support product and does not map cleanly to the current categories.",
    };
  }

  if (test(/\bdry mouth\b|\bxylimelts?\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "oral_dental_support",
      rationale: "Dry-mouth/oral support is a specialty use case that likely deserves its own taxonomy branch.",
    };
  }

  if (test(/\becdysterone\b|\banabol\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "sports_anabolic_support",
      rationale: "These look like specialty sports/anabolic products, not a clean fit for the current amino/performance lane.",
    };
  }

  if (test(/\bnucleotide\b|\brna\b|\bdna\b/)) {
    return {
      truthDisposition: "needs_new_taxonomy",
      suggestedCategoryId: null,
      proposedTaxonomyKey: "cellular_nucleotide_support",
      rationale: "This is a specialty nucleotide/cellular-support concept that should be reviewed as its own taxonomy candidate.",
    };
  }

  if (test(/\b5[- ]hydroxytryptophan\b|\b5-htp\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "sleep_stress_mood_support",
      proposedTaxonomyKey: null,
      rationale: "This is a clear sleep/stress/mood support product and should not remain unknown.",
    };
  }

  if (test(/\bastragalus\b|\bwormwood\b|\bfenugreek\b|\bolive leaf\b|\bshilajit\b|\bginger\b|\blicorice\b|\bcinnamon\b|\bchanca piedra\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "botanical_herbal_support",
      proposedTaxonomyKey: null,
      rationale: "This looks like a clean botanical/herbal product that can be absorbed into the existing herbal lane.",
    };
  }

  if (test(/\bmushrooms?\b|\bcordyceps\b|\bcordychi\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "superfoods_mushrooms_greens",
      proposedTaxonomyKey: null,
      rationale: "This is a mushroom-centered product and fits the existing superfoods/mushrooms lane.",
    };
  }

  if (test(/\bniacin\b|\bvitamin b-?3\b/)) {
    return {
      truthDisposition: "promote_to_existing_category",
      suggestedCategoryId: "specialty_vitamins_other",
      proposedTaxonomyKey: null,
      rationale: "This is a straightforward specialty vitamin/B3 product.",
    };
  }

  if (test(/\bflat tummy\b|\bshakes?\b/)) {
    return {
      truthDisposition: "keep_unknown_for_now",
      suggestedCategoryId: null,
      proposedTaxonomyKey: null,
      rationale: "This is a hybrid functional-food/weight-management concept and is safer to keep unknown until a broader taxonomy decision is made.",
    };
  }

  return {
    truthDisposition: "keep_unknown_for_now",
    suggestedCategoryId: null,
    proposedTaxonomyKey: null,
    rationale: "This row remains mixed enough that forcing a taxonomy label would likely add noise.",
  };
};

const rankPriority = (row) => {
  if (row.isHighFrequency) return 0;
  if (row.truthDisposition === "promote_to_existing_category") return 1;
  if (row.truthDisposition === "needs_new_taxonomy") return 2;
  if (row.truthDisposition === "exclude_non_supplement") return 3;
  return 4;
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Unknown Category Truth Set Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- promoteToExistingCategory: ${report.summary.promoteToExistingCategory}`);
  lines.push(`- needsNewTaxonomy: ${report.summary.needsNewTaxonomy}`);
  lines.push(`- excludeNonSupplement: ${report.summary.excludeNonSupplement}`);
  lines.push(`- keepUnknownForNow: ${report.summary.keepUnknownForNow}`);
  lines.push("");
  lines.push("## Top Review Queues");
  lines.push("");
  for (const queue of report.reviewQueues) {
    lines.push(`### ${queue.truthDisposition}`);
    lines.push(`- count: ${queue.count}`);
    lines.push(`- sample_titles: ${queue.sampleTitles.join(" | ") || "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [summary, manifest] = await Promise.all([readJson(SUMMARY_PATH), readJson(MANIFEST_PATH)]);
  const unknownRows = Array.isArray(summary?.anomalyBuckets?.unknown_category) ? summary.anomalyBuckets.unknown_category : [];
  const manifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const manifestBySampleId = new Map(manifestRows.map((row) => [safeText(row.sampleId), row]));

  const rows = unknownRows
    .map((row) => {
      const manifestRow = manifestBySampleId.get(safeText(row.sampleId));
      const rowData = toObjectRecord(manifestRow?.rowData);
      const decision = classifyTruthDisposition(row, rowData);
      return {
        sampleId: safeText(row.sampleId),
        productId: safeText(manifestRow?.productId) || null,
        barcode_gtin14: safeText(manifestRow?.barcode_gtin14) || null,
        brandName: safeText(row.brandName),
        title: safeText(row.title),
        overallScore: Number(row.overallScore ?? 0),
        isHighFrequency: Boolean(row.isHighFrequency),
        truthDisposition: decision.truthDisposition,
        suggestedCategoryId: decision.suggestedCategoryId,
        proposedTaxonomyKey: decision.proposedTaxonomyKey,
        rationale: decision.rationale,
        manualLabel: null,
        reviewerNotes: null,
      };
    })
    .sort((a, b) => rankPriority(a) - rankPriority(b) || b.overallScore - a.overallScore || a.brandName.localeCompare(b.brandName));

  const countBy = (value) => rows.filter((row) => row.truthDisposition === value).length;
  const reviewQueues = Object.entries(
    rows.reduce((acc, row) => {
      acc[row.truthDisposition] ??= [];
      acc[row.truthDisposition].push(row);
      return acc;
    }, {}),
  )
    .map(([truthDisposition, queueRows]) => ({
      truthDisposition,
      count: queueRows.length,
      sampleTitles: queueRows.slice(0, 8).map((row) => `${row.brandName} - ${row.title}`),
    }))
    .sort((a, b) => b.count - a.count || a.truthDisposition.localeCompare(b.truthDisposition));

  const report = {
    schemaVersion: "iherb_unknown_category_truth_set_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      qualitySummaryPath: toRelative(SUMMARY_PATH),
      sampleManifestPath: toRelative(MANIFEST_PATH),
    },
    summary: {
      unknownSampleCount: rows.length,
      promoteToExistingCategory: countBy("promote_to_existing_category"),
      needsNewTaxonomy: countBy("needs_new_taxonomy"),
      excludeNonSupplement: countBy("exclude_non_supplement"),
      keepUnknownForNow: countBy("keep_unknown_for_now"),
      highFrequencyUnknownCount: rows.filter((row) => row.isHighFrequency).length,
    },
    reviewQueues,
    rows,
  };

  const outJson = path.join(OUT_DIR, "unknown_category_truth_set_pack.json");
  const outMd = path.join(OUT_DIR, "unknown_category_truth_set_pack.md");
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
