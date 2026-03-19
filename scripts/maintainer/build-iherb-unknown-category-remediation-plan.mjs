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
  path.join(ROOT, "output", `iherb_score_category_harness_${TODAY}`),
);
const ANOMALIES_PATH = getArg("anomalies-json", path.join(HARNESS_DIR, "anomaly_buckets.json"));
const MANIFEST_PATH = getArg("sample-manifest-json", path.join(HARNESS_DIR, "sample_manifest.json"));
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_unknown_category_remediation_${TODAY}`),
);

const FAMILY_DEFS = [
  {
    id: "collagen_connective_support",
    label: "Collagen & Connective Tissue",
    recommendedCategoryId: "collagen_connective_support",
    remediationTrack: "new_category",
    remediationEase: "high",
    rationale: "Titles and ingredients are explicit, so this is a high-ROI detector expansion.",
    patterns: [
      { re: /\bcollagen\b/, weight: 8 },
      { re: /\bcollagen peptides?\b/, weight: 10 },
      { re: /\btype ii collagen\b/, weight: 8 },
      { re: /\bbone broth\b/, weight: 5 },
      { re: /\bmarine collagen\b/, weight: 8 },
      { re: /\bconnective tissue\b/, weight: 6 },
    ],
  },
  {
    id: "amino_acids_sports_performance",
    label: "Amino Acids & Sports Performance",
    recommendedCategoryId: "sports_performance_amino_acids",
    remediationTrack: "new_category",
    remediationEase: "high",
    rationale: "Strong lexical cues like amino, BCAA, creatine, glutamine, and pre-workout make this easy to catch.",
    patterns: [
      { re: /\bamino\b/, weight: 3 },
      { re: /\bbcaa\b/, weight: 5 },
      { re: /\beaa\b/, weight: 4 },
      { re: /\bcreatine\b/, weight: 5 },
      { re: /\bglutamine\b/, weight: 4 },
      { re: /\barginine\b/, weight: 4 },
      { re: /\bcitrulline\b/, weight: 4 },
      { re: /\bbeta alanine\b/, weight: 4 },
      { re: /\bcarnitine\b/, weight: 4 },
      { re: /\bpre[- ]?workout\b/, weight: 5 },
      { re: /\bpost[- ]?workout\b/, weight: 3 },
      { re: /\bhydration\b/, weight: 3 },
      { re: /\belectrolyte\b/, weight: 3 },
      { re: /\bwhey\b/, weight: 3 },
      { re: /\bprotein powder\b/, weight: 4 },
      { re: /\bpump\b/, weight: 2 },
    ],
  },
  {
    id: "botanical_herbal_extracts",
    label: "Botanical & Herbal Extracts",
    recommendedCategoryId: "botanical_herbal_support",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "Large bucket with clear herb keywords; likely the biggest unknown reducer after sports/collagen.",
    patterns: [
      { re: /\bturmeric\b/, weight: 5 },
      { re: /\bcurcumin\b/, weight: 5 },
      { re: /\bashwagandha\b/, weight: 5 },
      { re: /\bvalerian\b/, weight: 5 },
      { re: /\byellow dock\b/, weight: 5 },
      { re: /\bblack seed\b/, weight: 5 },
      { re: /\bmilk thistle\b/, weight: 4 },
      { re: /\bechinacea\b/, weight: 4 },
      { re: /\belderberry\b/, weight: 4 },
      { re: /\bginseng\b/, weight: 4 },
      { re: /\brhodiola\b/, weight: 4 },
      { re: /\bmaca\b/, weight: 4 },
      { re: /\bherb\b/, weight: 2 },
      { re: /\bbotanical\b/, weight: 2 },
      { re: /\broot\b/, weight: 1 },
      { re: /\bextract\b/, weight: 1 },
    ],
  },
  {
    id: "sleep_stress_mood_support",
    label: "Sleep, Stress & Mood",
    recommendedCategoryId: "sleep_stress_mood_support",
    remediationTrack: "new_category",
    remediationEase: "high",
    rationale: "5-HTP, melatonin, GABA, theanine, calm, mood, and sleep are easy detector signals.",
    patterns: [
      { re: /\b5-htp\b/, weight: 5 },
      { re: /\b5 hydroxytryptophan\b/, weight: 5 },
      { re: /\bmelatonin\b/, weight: 5 },
      { re: /\bgaba\b/, weight: 5 },
      { re: /\bl-theanine\b/, weight: 4 },
      { re: /\btryptophan\b/, weight: 4 },
      { re: /\bmood\b/, weight: 3 },
      { re: /\bsleep\b/, weight: 4 },
      { re: /\bstress\b/, weight: 3 },
      { re: /\brelax\b/, weight: 3 },
      { re: /\bcalm\b/, weight: 3 },
      { re: /\badrenal\b/, weight: 3 },
    ],
  },
  {
    id: "superfoods_mushrooms_greens",
    label: "Superfoods, Mushrooms & Greens",
    recommendedCategoryId: "superfoods_mushrooms_greens",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "Mushroom and greens products carry strong product nouns and would reduce many content-ready unknowns.",
    patterns: [
      { re: /\bmushroom\b/, weight: 5 },
      { re: /\bmycobotanical\b/, weight: 5 },
      { re: /\bgreens?\b/, weight: 4 },
      { re: /\bsuperfood\b/, weight: 4 },
      { re: /\bspirulina\b/, weight: 5 },
      { re: /\bchlorella\b/, weight: 5 },
      { re: /\bwheatgrass\b/, weight: 4 },
      { re: /\bbarley grass\b/, weight: 4 },
      { re: /\bbeet root\b/, weight: 3 },
      { re: /\bmatcha\b/, weight: 3 },
    ],
  },
  {
    id: "digestive_fiber_enzymes",
    label: "Digestive, Fiber & Enzymes",
    recommendedCategoryId: "digestive_fiber_enzymes",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "Fiber and enzyme formulas are common and use consistent naming like psyllium, fiber, and digestive enzymes.",
    patterns: [
      { re: /\bpsyllium\b/, weight: 5 },
      { re: /\bfiber\b/, weight: 4 },
      { re: /\bdigestive\b/, weight: 3 },
      { re: /\benzyme\b/, weight: 4 },
      { re: /\bcolon\b/, weight: 4 },
      { re: /\bcleanse\b/, weight: 3 },
      { re: /\bwhole husk\b/, weight: 3 },
    ],
  },
  {
    id: "joint_bone_mobility",
    label: "Joint, Bone & Mobility",
    recommendedCategoryId: "joint_bone_mobility",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "Glucosamine/chondroitin/MSM style formulas are clearly named and likely deserve their own specialization.",
    patterns: [
      { re: /\bglucosamine\b/, weight: 5 },
      { re: /\bchondroitin\b/, weight: 5 },
      { re: /\bmsm\b/, weight: 4 },
      { re: /\bhyaluronic\b/, weight: 4 },
      { re: /\bjoint\b/, weight: 4 },
      { re: /\bmobility\b/, weight: 3 },
      { re: /\bcartilage\b/, weight: 3 },
    ],
  },
  {
    id: "women_hormonal_lactation",
    label: "Women's Hormonal & Lactation",
    recommendedCategoryId: "women_hormonal_support",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "A smaller but coherent bucket with strong semantic cues like estro, menopause, PMS, and breastfeeding.",
    patterns: [
      { re: /\bestro\b/, weight: 5 },
      { re: /\bmenopause\b/, weight: 5 },
      { re: /\bpms\b/, weight: 4 },
      { re: /\bbreastfeeding\b/, weight: 5 },
      { re: /\bmore milk\b/, weight: 5 },
      { re: /\blactation\b/, weight: 4 },
      { re: /\bwomen('?s)?\b/, weight: 2 },
      { re: /\bhormone\b/, weight: 3 },
    ],
  },
  {
    id: "functional_beverage_caffeine",
    label: "Functional Beverages & Caffeine",
    recommendedCategoryId: "functional_beverage_caffeine",
    remediationTrack: "new_category",
    remediationEase: "medium",
    rationale: "Coffee, tea, caffeine, and energy blends often have complete content but no matching deep category.",
    patterns: [
      { re: /\bcoffee\b/, weight: 5 },
      { re: /\bcaffeine\b/, weight: 5 },
      { re: /\benergy\b/, weight: 3 },
      { re: /\btea extract\b/, weight: 4 },
      { re: /\bgreen tea\b/, weight: 4 },
      { re: /\bmedium roast\b/, weight: 4 },
      { re: /\bslim instant coffee\b/, weight: 5 },
    ],
  },
  {
    id: "vitamin_mineral_other",
    label: "Other Vitamins & Minerals",
    recommendedCategoryId: "vitamin_mineral_other",
    remediationTrack: "detector_extension",
    remediationEase: "high",
    rationale: "A practical catch-all for non-D/non-magnesium single nutrient products such as vitamin C and PABA.",
    patterns: [
      { re: /\bvitamin c\b/, weight: 5 },
      { re: /\bcomplex c\b/, weight: 5 },
      { re: /\bpaba\b/, weight: 5 },
      { re: /\bselenium\b/, weight: 4 },
      { re: /\bchromium\b/, weight: 4 },
      { re: /\bbiotin\b/, weight: 4 },
      { re: /\bboron\b/, weight: 4 },
      { re: /\bpotassium\b/, weight: 4 },
      { re: /\bcalcium\b/, weight: 4 },
      { re: /\biron\b/, weight: 4 },
      { re: /\bzinc\b/, weight: 4 },
    ],
  },
];

const NORMALIZED_FALLBACK_FAMILY = {
  id: "misc_functional_blends",
  label: "Misc Functional Blends",
  recommendedCategoryId: "misc_functional_blends",
  remediationTrack: "manual_taxonomy_review",
  remediationEase: "low",
  rationale: "Residual bucket after clear families are removed. Use it for follow-up taxonomy design, not first-wave rule work.",
};

const EASE_SCORE = {
  high: 1,
  medium: 0.8,
  low: 0.5,
};

const collectProductText = (rowData) => {
  const categories = Array.isArray(rowData?.categories) ? rowData.categories.map(safeText).filter(Boolean) : [];
  const sections = toObjectRecord(rowData?.descriptionSections);
  const supplementFacts = toObjectRecord(rowData?.supplementFacts);
  const facts = Array.isArray(supplementFacts?.nutritionalFacts)
    ? supplementFacts.nutritionalFacts.map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name)).filter(Boolean)
    : [];
  const fields = [
    safeText(rowData?.brandName),
    safeText(rowData?.title),
    categories.join(" "),
    safeText(sections?.Description),
    safeText(sections?.["Suggested use"] ?? sections?.["Suggested Use"]),
    safeText(sections?.Warnings),
    safeText(sections?.["Other ingredients"] ?? sections?.["Other Ingredients"]),
    facts.join(" "),
  ];
  return fields.filter(Boolean).join(" ").toLowerCase();
};

const classifyFamily = (rowData) => {
  const corpus = collectProductText(rowData);
  let best = null;
  for (const family of FAMILY_DEFS) {
    let score = 0;
    const matchedPatterns = [];
    for (const pattern of family.patterns) {
      if (pattern.re.test(corpus)) {
        score += pattern.weight;
        matchedPatterns.push(pattern.re.source);
      }
    }
    if (!best || score > best.score || (score === best.score && matchedPatterns.length > best.matchedPatterns.length)) {
      best = { family, score, matchedPatterns };
    }
  }
  if (!best || best.score <= 0) {
    return {
      family: NORMALIZED_FALLBACK_FAMILY,
      score: 0,
      matchedPatterns: [],
    };
  }
  return best;
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Unknown Category Remediation Plan");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- unknownSampleCount: ${report.summary.unknownSampleCount}`);
  lines.push(`- unknownShareOfHarness: ${report.summary.unknownShareOfHarness}%`);
  lines.push("");
  lines.push("## Priority Order");
  lines.push("");
  for (const item of report.priorityFamilies) {
    lines.push(`### ${item.priorityRank}. ${item.label}`);
    lines.push(`- family_id: ${item.familyId}`);
    lines.push(`- count: ${item.count}`);
    lines.push(`- high_frequency_count: ${item.highFrequencyCount}`);
    lines.push(`- average_score: ${item.avgOverallScore}`);
    lines.push(`- remediation_track: ${item.remediationTrack}`);
    lines.push(`- recommended_category_id: ${item.recommendedCategoryId}`);
    lines.push(`- remediation_ease: ${item.remediationEase}`);
    lines.push(`- why_now: ${item.whyNow}`);
    lines.push(`- example_keywords: ${item.exampleKeywords.join(", ") || "n/a"}`);
    lines.push(`- top_brands: ${item.topBrands.map(([brand, count]) => `${brand} (${count})`).join(", ") || "n/a"}`);
    lines.push(`- representative_products: ${item.representativeProducts.map((row) => `${row.brandName} - ${row.title}`).join(" | ") || "n/a"}`);
    lines.push("");
  }
  lines.push("## Residual");
  lines.push("");
  lines.push(`- misc_functional_blends_count: ${report.summary.miscResidualCount}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [anomalies, manifest] = await Promise.all([readJson(ANOMALIES_PATH), readJson(MANIFEST_PATH)]);
  const unknownRows = Array.isArray(anomalies?.unknown_category) ? anomalies.unknown_category : [];
  const manifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const manifestBySampleId = new Map(manifestRows.map((row) => [safeText(row.sampleId), row]));

  const enriched = unknownRows.map((row) => {
    const manifestRow = manifestBySampleId.get(safeText(row.sampleId));
    const rowData = toObjectRecord(manifestRow?.rowData);
    const classified = classifyFamily(rowData);
    return {
      ...row,
      rowData,
      familyId: classified.family.id,
      familyLabel: classified.family.label,
      recommendedCategoryId: classified.family.recommendedCategoryId,
      remediationTrack: classified.family.remediationTrack,
      remediationEase: classified.family.remediationEase,
      familyMatchScore: classified.score,
      familyMatchedPatterns: classified.matchedPatterns,
    };
  });

  const familyMap = new Map();
  for (const row of enriched) {
    const key = row.familyId;
    const family = FAMILY_DEFS.find((item) => item.id === key) ?? NORMALIZED_FALLBACK_FAMILY;
    if (!familyMap.has(key)) {
      familyMap.set(key, {
        familyId: key,
        label: family.label,
        recommendedCategoryId: family.recommendedCategoryId,
        remediationTrack: family.remediationTrack,
        remediationEase: family.remediationEase,
        rationale: family.rationale,
        rows: [],
      });
    }
    familyMap.get(key).rows.push(row);
  }

  const familyBuckets = [...familyMap.values()].map((family) => {
    const topBrands = Object.entries(
      family.rows.reduce((acc, row) => {
        const key = safeText(row.brandName) || "Unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);

    const matchedPatterns = unique(family.rows.flatMap((row) => row.familyMatchedPatterns ?? [])).slice(0, 8);
    const highFrequencyCount = family.rows.filter((row) => row.isHighFrequency).length;
    const avgOverallScore = Number(
      (
        family.rows.reduce((sum, row) => sum + Number(row.overallScore ?? 0), 0) /
        Math.max(family.rows.length, 1)
      ).toFixed(1),
    );
    const readinessReadyCount = family.rows.filter((row) => row.deepContentReady && row.scoreV2Ready).length;
    const easeScore = EASE_SCORE[family.remediationEase] ?? 0.5;
    const priorityScore = Number(
      (
        family.rows.length * 1.0 +
        highFrequencyCount * 1.5 +
        readinessReadyCount * 0.2 +
        easeScore * 5
      ).toFixed(1),
    );

    return {
      familyId: family.familyId,
      label: family.label,
      count: family.rows.length,
      highFrequencyCount,
      readyButUnspecializedCount: readinessReadyCount,
      avgOverallScore,
      remediationTrack: family.remediationTrack,
      remediationEase: family.remediationEase,
      recommendedCategoryId: family.recommendedCategoryId,
      whyNow: family.rationale,
      priorityScore,
      exampleKeywords: matchedPatterns,
      topBrands,
      representativeProducts: family.rows
        .slice()
        .sort((a, b) => Number(b.isHighFrequency) - Number(a.isHighFrequency) || Number(b.overallScore ?? 0) - Number(a.overallScore ?? 0))
        .slice(0, 5)
        .map((row) => ({
          sampleId: row.sampleId,
          brandName: row.brandName,
          title: row.title,
          overallScore: row.overallScore,
          isHighFrequency: row.isHighFrequency,
        })),
      rows: family.rows,
    };
  });

  const priorityFamilies = familyBuckets
    .filter((family) => family.familyId !== NORMALIZED_FALLBACK_FAMILY.id)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.count - a.count || a.familyId.localeCompare(b.familyId))
    .map((family, idx) => ({
      priorityRank: idx + 1,
      ...family,
    }));

  const residual = familyBuckets.find((family) => family.familyId === NORMALIZED_FALLBACK_FAMILY.id) ?? null;

  const report = {
    schemaVersion: "iherb_unknown_category_remediation.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      anomaliesPath: toRelative(ANOMALIES_PATH),
      sampleManifestPath: toRelative(MANIFEST_PATH),
    },
    summary: {
      unknownSampleCount: unknownRows.length,
      unknownShareOfHarness: pct(unknownRows.length, Array.isArray(manifest?.rows) ? manifest.rows.length : 0),
      priorityFamilyCount: priorityFamilies.length,
      miscResidualCount: residual?.count ?? 0,
    },
    priorityFamilies,
    residualFamily: residual,
  };

  const outJson = path.join(OUT_DIR, "deep_category_remediation_priority.json");
  const outBuckets = path.join(OUT_DIR, "unknown_family_buckets.json");
  const outMd = path.join(OUT_DIR, "deep_category_remediation_priority.md");
  await writeJson(outJson, report);
  await writeJson(outBuckets, familyBuckets);
  await import("node:fs/promises").then((fs) => fs.mkdir(OUT_DIR, { recursive: true }));
  await import("node:fs/promises").then((fs) => fs.writeFile(outMd, toMarkdown(report), "utf8"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: report.summary,
        outputs: {
          priorityJson: toRelative(outJson),
          bucketsJson: toRelative(outBuckets),
          priorityMd: toRelative(outMd),
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
