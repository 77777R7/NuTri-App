#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";

import {
  pct,
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
  path.join(ROOT, "output", `iherb_score_category_harness_post_category_expansion_${TODAY}`),
);
const SUMMARY_PATH = getArg("quality-summary-json", path.join(HARNESS_DIR, "quality_summary.json"));
const MANIFEST_PATH = getArg("sample-manifest-json", path.join(HARNESS_DIR, "sample_manifest.json"));
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_unknown_category_precision_pass_${TODAY}`),
);

const CLUSTERS = [
  {
    id: "antioxidant_cellular_energy",
    label: "Antioxidant & Cellular Energy Actives",
    suggestedAction: "candidate_new_category_or_shared_specialization",
    rationale:
      "CoQ10, alpha lipoic acid, lutein, astaxanthin, quercetin, resveratrol, and fisetin look like a coherent family that likely needs shared science/overview handling.",
    patterns: [
      { re: /\bcoq10\b|\bcoenzyme q10\b|\bubiquinol\b|\bubiquinone\b/, weight: 8 },
      { re: /\balpha lipoic acid\b|\bala\b/, weight: 8 },
      { re: /\bciticoline\b|\bcdp choline\b/, weight: 6 },
      { re: /\blutein\b|\bzeaxanthin\b/, weight: 7 },
      { re: /\bastaxanthin\b/, weight: 8 },
      { re: /\bquercetin\b/, weight: 7 },
      { re: /\bresveratrol\b/, weight: 7 },
      { re: /\bfisetin\b/, weight: 7 },
      { re: /\bblueberry extract\b/, weight: 6 },
      { re: /\bpomegranate\b/, weight: 5 },
      { re: /\bcranberry\b/, weight: 5 },
      { re: /\bgrapefruit seed extract\b/, weight: 5 },
    ],
  },
  {
    id: "nootropic_memory_cognition",
    label: "Nootropic, Memory & Cognitive Support",
    suggestedAction: "candidate_new_category",
    rationale:
      "Citicoline, memory, cognitive, and related cognition-positioned products likely deserve their own specialization instead of being forced into beverage or mood buckets.",
    patterns: [
      { re: /\bciticoline\b|\bcdp choline\b/, weight: 8 },
      { re: /\bcognium\b/, weight: 7 },
      { re: /\bmemory\b/, weight: 5 },
      { re: /\bcognitive\b|\bbrain\b|\bfocus\b/, weight: 4 },
      { re: /\bsharpmind\b/, weight: 6 },
      { re: /\bnootropic\b/, weight: 7 },
    ],
  },
  {
    id: "specialty_vitamins_other",
    label: "Specialty Vitamins & B-family",
    suggestedAction: "detector_extension",
    rationale:
      "B12, benfotiamine, vitamin A, and other non-D specialty vitamins still remain unknown after the first pass.",
    patterns: [
      { re: /\bvitamin b-?12\b|\bcobalamin\b/, weight: 8 },
      { re: /\bvitamin a\b/, weight: 7 },
      { re: /\bbenfotiamine\b/, weight: 8 },
      { re: /\bniacinamide\b/, weight: 7 },
      { re: /\bbiotin\b/, weight: 6 },
      { re: /\bvitamin e\b/, weight: 6 },
    ],
  },
  {
    id: "fatty_acids_specialty_lipids",
    label: "Specialty Fatty Acids & Lipids",
    suggestedAction: "candidate_new_category",
    rationale:
      "MCT oil, evening primrose, coconut oil, and similar lipid-positioned products are not fish oil but still share enough structure to justify a category decision.",
    patterns: [
      { re: /\bmct oil\b/, weight: 8 },
      { re: /\bevening primrose\b/, weight: 8 },
      { re: /\bcoconut oil\b/, weight: 8 },
      { re: /\bphospholipid\b/, weight: 7 },
      { re: /\bpc\b/, weight: 4 },
      { re: /\bsoftgels?\b/, weight: 1 },
    ],
  },
  {
    id: "womens_hormonal_and_lactation",
    label: "Women's Hormonal & Lactation",
    suggestedAction: "candidate_new_category",
    rationale:
      "These rows remain coherent and likely deserve a dedicated women's hormonal support branch.",
    patterns: [
      { re: /\bmeta-balance\b/, weight: 7 },
      { re: /\bblack cohosh\b/, weight: 8 },
      { re: /\bmenopause\b/, weight: 8 },
      { re: /\bpms\b/, weight: 7 },
      { re: /\bestro\b/, weight: 8 },
      { re: /\bevening primrose\b/, weight: 5 },
      { re: /\blactation\b|\bbreastfeeding\b|\bmore milk\b/, weight: 8 },
    ],
  },
  {
    id: "mens_prostate_and_hormonal",
    label: "Men's Prostate & Hormonal Support",
    suggestedAction: "candidate_new_category",
    rationale:
      "Saw palmetto and similar men's support products are recurring enough to split from generic botanicals.",
    patterns: [
      { re: /\bsaw palmetto\b/, weight: 8 },
      { re: /\bprostate\b/, weight: 8 },
      { re: /\bmen('?s)?\b/, weight: 4 },
      { re: /\btestosterone\b/, weight: 7 },
      { re: /\bandro\b/, weight: 6 },
    ],
  },
  {
    id: "specialty_single_amino_and_neuro",
    label: "Single Aminos & Neuro Actives",
    suggestedAction: "candidate_refined_subcategory",
    rationale:
      "L-lysine, taurine, L-tyrosine and similar single-ingredient amino/neuro products need a cleaner split from sports blends.",
    patterns: [
      { re: /\bl-lysine\b|\blysine\b/, weight: 8 },
      { re: /\btaurine\b/, weight: 8 },
      { re: /\bl-tyrosine\b|\btyrosine\b/, weight: 8 },
      { re: /\bnac\b|\bn-acetyl cysteine\b/, weight: 7 },
      { re: /\bciticoline\b/, weight: 3 },
      { re: /\bbenfotiamine\b/, weight: 3 },
    ],
  },
  {
    id: "digestive_and_gastro_functional",
    label: "Digestive & Gastro Functional",
    suggestedAction: "manual_boundary_review",
    rationale:
      "Papaya, Keep It Movin', and similar products suggest a broader digestive/gastro lane beyond fiber/enzyme labels.",
    patterns: [
      { re: /\bpapaya\b/, weight: 8 },
      { re: /\bkeep it movin\b/, weight: 8 },
      { re: /\bdigestive\b/, weight: 5 },
      { re: /\bbowel\b/, weight: 6 },
      { re: /\bconstipation\b/, weight: 6 },
      { re: /\bmovin\b/, weight: 5 },
    ],
  },
];

const FALLBACK_CLUSTER = {
  id: "misc_residual_unknowns",
  label: "Misc Residual Unknowns",
  suggestedAction: "manual_review",
  rationale: "Residual rows after precision clustering. These are best handled by manual taxonomy design or future semantic modeling.",
};

const collectCorpus = (rowData) => {
  const categories = Array.isArray(rowData?.categories) ? rowData.categories.map(safeText).filter(Boolean) : [];
  const sections = toObjectRecord(rowData?.descriptionSections);
  const supplementFacts = toObjectRecord(rowData?.supplementFacts);
  const facts = Array.isArray(supplementFacts?.nutritionalFacts)
    ? supplementFacts.nutritionalFacts.map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name)).filter(Boolean)
    : [];
  return [
    safeText(rowData?.brandName),
    safeText(rowData?.title),
    categories.join(" "),
    safeText(sections?.Description),
    safeText(sections?.["Suggested use"] ?? sections?.["Suggested Use"]),
    safeText(sections?.Warnings),
    facts.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
};

const classifyCluster = (rowData) => {
  const corpus = collectCorpus(rowData);
  let best = { cluster: FALLBACK_CLUSTER, score: 0, matchedPatterns: [] };
  for (const cluster of CLUSTERS) {
    let score = 0;
    const matchedPatterns = [];
    for (const pattern of cluster.patterns) {
      if (pattern.re.test(corpus)) {
        score += pattern.weight;
        matchedPatterns.push(pattern.re.source);
      }
    }
    if (score > best.score || (score === best.score && matchedPatterns.length > best.matchedPatterns.length)) {
      best = { cluster, score, matchedPatterns };
    }
  }
  return best;
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Unknown Category Precision Pass");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- unknownShareOfHarness: ${report.summary.unknownShareOfHarness}%`);
  lines.push("");
  for (const item of report.priorityClusters) {
    lines.push(`## ${item.priorityRank}. ${item.label}`);
    lines.push(`- cluster_id: ${item.clusterId}`);
    lines.push(`- count: ${item.count}`);
    lines.push(`- high_frequency_count: ${item.highFrequencyCount}`);
    lines.push(`- suggested_action: ${item.suggestedAction}`);
    lines.push(`- why_now: ${item.rationale}`);
    lines.push(`- representative_products: ${item.representativeProducts.map((row) => `${row.brandName} - ${row.title}`).join(" | ") || "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [summary, manifest] = await Promise.all([readJson(SUMMARY_PATH), readJson(MANIFEST_PATH)]);
  const unknownRows = Array.isArray(summary?.anomalyBuckets?.unknown_category) ? summary.anomalyBuckets.unknown_category : [];
  const manifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const manifestBySampleId = new Map(manifestRows.map((row) => [safeText(row.sampleId), row]));

  const clusteredRows = unknownRows.map((row) => {
    const manifestRow = manifestBySampleId.get(safeText(row?.sampleId));
    const rowData = toObjectRecord(manifestRow?.rowData);
    const classified = classifyCluster(rowData);
    return {
      ...row,
      rowData,
      clusterId: classified.cluster.id,
      clusterLabel: classified.cluster.label,
      suggestedAction: classified.cluster.suggestedAction,
      rationale: classified.cluster.rationale,
      clusterScore: classified.score,
      matchedPatterns: classified.matchedPatterns,
    };
  });

  const clusters = Object.values(
    clusteredRows.reduce((acc, row) => {
      const key = row.clusterId;
      acc[key] ??= {
        clusterId: key,
        label: row.clusterLabel,
        suggestedAction: row.suggestedAction,
        rationale: row.rationale,
        rows: [],
      };
      acc[key].rows.push(row);
      return acc;
    }, {}),
  ).map((cluster) => {
    const highFrequencyCount = cluster.rows.filter((row) => row.isHighFrequency).length;
    return {
      clusterId: cluster.clusterId,
      label: cluster.label,
      suggestedAction: cluster.suggestedAction,
      rationale: cluster.rationale,
      count: cluster.rows.length,
      highFrequencyCount,
      avgOverallScore: Number(
        (
          cluster.rows.reduce((sum, row) => sum + Number(row.overallScore ?? 0), 0) /
          Math.max(cluster.rows.length, 1)
        ).toFixed(1),
      ),
      topBrands: Object.entries(
        cluster.rows.reduce((acc, row) => {
          const key = safeText(row.brandName) || "Unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 6),
      representativeProducts: cluster.rows
        .slice()
        .sort((a, b) => Number(b.isHighFrequency) - Number(a.isHighFrequency) || Number(b.overallScore ?? 0) - Number(a.overallScore ?? 0))
        .slice(0, 6)
        .map((row) => ({
          sampleId: row.sampleId,
          brandName: row.brandName,
          title: row.title,
          overallScore: row.overallScore,
          isHighFrequency: row.isHighFrequency,
        })),
      rows: cluster.rows,
    };
  });

  const priorityClusters = clusters
    .filter((cluster) => cluster.clusterId !== FALLBACK_CLUSTER.id)
    .sort((a, b) => b.count + b.highFrequencyCount * 0.5 - (a.count + a.highFrequencyCount * 0.5))
    .map((cluster, idx) => ({
      priorityRank: idx + 1,
      ...cluster,
    }));

  const residualCluster = clusters.find((cluster) => cluster.clusterId === FALLBACK_CLUSTER.id) ?? null;

  const report = {
    schemaVersion: "iherb_unknown_category_precision_pass.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      qualitySummaryPath: toRelative(SUMMARY_PATH),
      sampleManifestPath: toRelative(MANIFEST_PATH),
    },
    summary: {
      unknownSampleCount: unknownRows.length,
      unknownShareOfHarness: pct(unknownRows.length, Number(summary?.summary?.sampleCount ?? 0)),
      priorityClusterCount: priorityClusters.length,
      residualCount: residualCluster?.count ?? 0,
    },
    priorityClusters,
    residualCluster,
  };

  const outJson = path.join(OUT_DIR, "unknown_category_precision_pass.json");
  const outClusters = path.join(OUT_DIR, "unknown_category_precision_clusters.json");
  const outMd = path.join(OUT_DIR, "unknown_category_precision_pass.md");

  await writeJson(outJson, report);
  await writeJson(outClusters, clusters);
  await import("node:fs/promises").then((fs) => fs.mkdir(OUT_DIR, { recursive: true }));
  await import("node:fs/promises").then((fs) => fs.writeFile(outMd, toMarkdown(report), "utf8"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outputs: {
          reportJson: toRelative(outJson),
          clustersJson: toRelative(outClusters),
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
