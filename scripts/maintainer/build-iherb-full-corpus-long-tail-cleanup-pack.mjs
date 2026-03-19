#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildImportedRows,
  buildRowAnalysis,
  pct,
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

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_full_corpus_long_tail_cleanup_pack_${TODAY}`),
);

const FAMILY_DEFS = [
  {
    id: "antioxidant_cellular_energy",
    label: "Antioxidant / CoQ10 / Cellular Energy",
    track: "existing_category_rescue",
    recommendedCategoryId: "antioxidant_cellular_energy",
    rationale: "Co Q-10, ubiquinol, alpha lipoic acid, and related antioxidant support products should resolve into an existing live category.",
    patterns: [
      { re: /\bco\s*q-?10\b/, weight: 10, label: "co q-10" },
      { re: /\bcoq-?10\b/, weight: 10, label: "coq10" },
      { re: /\bcoenzyme q10\b/, weight: 10, label: "coenzyme q10" },
      { re: /\bubiquinol\b/, weight: 9, label: "ubiquinol" },
      { re: /\bubiquinone\b/, weight: 9, label: "ubiquinone" },
      { re: /\balpha lipoic acid\b/, weight: 8, label: "alpha lipoic acid" },
      { re: /\bastaxanthin\b/, weight: 8, label: "astaxanthin" },
      { re: /\blutein\b/, weight: 8, label: "lutein" },
      { re: /\blycopene\b/, weight: 8, label: "lycopene" },
      { re: /\bglutathione\b/, weight: 8, label: "glutathione" },
      { re: /\bpolicosanol\b/, weight: 8, label: "policosanol" },
    ],
  },
  {
    id: "botanical_herbal_support",
    label: "Botanical / Herbal Support",
    track: "existing_category_rescue",
    recommendedCategoryId: "botanical_herbal_support",
    rationale: "Explicit herb names should resolve into the existing botanical lane, not stay unknown.",
    patterns: [
      { re: /\bhorse chestnut\b/, weight: 9, label: "horse chestnut" },
      { re: /\bsoy isoflavones?\b/, weight: 8, label: "soy isoflavones" },
      { re: /\bcatuaba\b/, weight: 8, label: "catuaba" },
      { re: /\bturmeric\b/, weight: 7, label: "turmeric" },
      { re: /\bcurcumin\b/, weight: 7, label: "curcumin" },
      { re: /\bashwagandha\b/, weight: 7, label: "ashwagandha" },
      { re: /\bcinnamon\b/, weight: 7, label: "cinnamon" },
      { re: /\bblack seed\b/, weight: 7, label: "black seed" },
      { re: /\bmilk thistle\b/, weight: 7, label: "milk thistle" },
      { re: /\bgrape seed\b/, weight: 7, label: "grape seed" },
      { re: /\bherbal\b/, weight: 2, label: "herbal" },
      { re: /\bextract\b/, weight: 1, label: "extract" },
    ],
  },
  {
    id: "specialty_vitamins_other",
    label: "Specialty Vitamins",
    track: "existing_category_rescue",
    recommendedCategoryId: "specialty_vitamins_other",
    rationale: "B12, B3, vitamin K2, tocotrienol, and vitamin-focused specialty products should resolve into the existing specialty vitamins lane.",
    patterns: [
      { re: /\bvitamin k2\b/, weight: 9, label: "vitamin k2" },
      { re: /\btocotrienol\b/, weight: 8, label: "tocotrienol" },
      { re: /\bvitamin b-?12\b/, weight: 8, label: "vitamin b12" },
      { re: /\bniacin\b/, weight: 8, label: "niacin" },
      { re: /\bniacinamide\b/, weight: 8, label: "niacinamide" },
      { re: /\bbenfotiamine\b/, weight: 8, label: "benfotiamine" },
      { re: /\bvitamin a\b/, weight: 8, label: "vitamin a" },
      { re: /\bvitamin e\b/, weight: 8, label: "vitamin e" },
      { re: /\bunique e\b/, weight: 8, label: "unique e" },
    ],
  },
  {
    id: "nootropic_memory_cognition",
    label: "Nootropic / Memory / Cognition",
    track: "existing_category_rescue",
    recommendedCategoryId: "nootropic_memory_cognition",
    rationale: "NAD+, memory, focus, and cognition support products should resolve into the existing nootropic lane.",
    patterns: [
      { re: /\bnad\+\b/, weight: 10, label: "nad+" },
      { re: /\bmemory\b/, weight: 8, label: "memory" },
      { re: /\bcognitive\b/, weight: 8, label: "cognitive" },
      { re: /\bbrain\b/, weight: 7, label: "brain" },
      { re: /\bfocus\b/, weight: 7, label: "focus" },
      { re: /\bnootropic\b/, weight: 7, label: "nootropic" },
      { re: /\bphosphatidylserine\b/, weight: 8, label: "phosphatidylserine" },
      { re: /\bginkgo biloba\b/, weight: 8, label: "ginkgo biloba" },
    ],
  },
  {
    id: "womens_hormonal_and_lactation",
    label: "Women's Hormonal / Lactation",
    track: "existing_category_rescue",
    recommendedCategoryId: "womens_hormonal_and_lactation",
    rationale: "Menopause, PMS, and isoflavone products should resolve into the existing women's hormonal lane.",
    patterns: [
      { re: /\bsoy isoflavones?\b/, weight: 9, label: "soy isoflavones" },
      { re: /\bmenopause\b/, weight: 8, label: "menopause" },
      { re: /\bpms\b/, weight: 8, label: "pms" },
      { re: /\blactation\b/, weight: 8, label: "lactation" },
      { re: /\bbreastfeeding\b/, weight: 8, label: "breastfeeding" },
    ],
  },
  {
    id: "digestive_and_gastro_functional",
    label: "Digestive / Gastro Functional",
    track: "existing_category_rescue",
    recommendedCategoryId: "digestive_and_gastro_functional",
    rationale: "Slimming teas and gut-movement formulas may belong in an existing digestive lane when their cues are explicit.",
    patterns: [
      { re: /\bslimming tea\b/, weight: 9, label: "slimming tea" },
      { re: /\bherbal slimming tea\b/, weight: 10, label: "herbal slimming tea" },
      { re: /\bconstipation\b/, weight: 8, label: "constipation" },
      { re: /\bbowel movement\b/, weight: 8, label: "bowel movement" },
      { re: /\bpapaya\b/, weight: 7, label: "papaya" },
      { re: /\bpapain\b/, weight: 7, label: "papain" },
    ],
  },
  {
    id: "out_of_scope_non_supplement",
    label: "Out-of-Scope / Non-Supplement",
    track: "out_of_scope",
    recommendedCategoryId: "out_of_scope_non_supplement",
    rationale: "Food, sweetener, salt, and seasoning products should be tracked separately from supplement deep categories.",
    patterns: [
      { re: /\bstroopwafels?\b/, weight: 10, label: "stroopwafels" },
      { re: /\bstevia\b/, weight: 9, label: "stevia" },
      { re: /\bsweetener\b/, weight: 8, label: "sweetener" },
      { re: /\bsea salt\b/, weight: 8, label: "sea salt" },
      { re: /\bhoney\b/, weight: 8, label: "honey" },
      { re: /\brub\b/, weight: 7, label: "rub" },
      { re: /\btea bags?\b/, weight: 3, label: "tea bags" },
    ],
  },
  {
    id: "taxonomy_backlog_hold",
    label: "Backlog Hold / Borderline Taxonomy",
    track: "backlog_hold",
    recommendedCategoryId: "taxonomy_backlog_hold",
    rationale: "Meal replacements, tea-like wellness products, and similar edge cases should stay in backlog until a clearer policy exists.",
    patterns: [
      { re: /\bshakes?\b/, weight: 8, label: "shakes" },
      { re: /\bmeal replacement\b/, weight: 9, label: "meal replacement" },
      { re: /\bspearmint tea\b/, weight: 10, label: "spearmint tea" },
      { re: /\bchitosan\b/, weight: 8, label: "chitosan" },
      { re: /\bcuraphen\b/, weight: 10, label: "curaphen" },
    ],
  },
];

const EXISTING_CATEGORY_RESCUE_TRACK = "existing_category_rescue";
const MIN_HIGH_CONFIDENCE_SCORE = 8;
const MIN_HIGH_CONFIDENCE_MARGIN = 3;

const increment = (map, key, amount = 1) => {
  map[key] = (map[key] ?? 0) + amount;
};

const sortEntries = (objectMap) =>
  Object.entries(objectMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const average = (rows, field) =>
  rows.length > 0
    ? Number((rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0) / rows.length).toFixed(1))
    : 0;

const collectCorpusText = (row) => {
  const categories = Array.isArray(row?.categories) ? row.categories.map(safeText).filter(Boolean) : [];
  const descriptionSections = toObjectRecord(row?.descriptionSections);
  const supplementFacts = toObjectRecord(row?.supplementFacts);
  const nutritionalFacts = Array.isArray(supplementFacts?.nutritionalFacts)
    ? supplementFacts.nutritionalFacts.map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name)).filter(Boolean)
    : [];
  return [
    safeText(row?.brandName),
    safeText(row?.title),
    categories.join(" "),
    safeText(descriptionSections?.Description),
    safeText(descriptionSections?.["Suggested use"] ?? descriptionSections?.["Suggested Use"]),
    safeText(descriptionSections?.Warnings),
    safeText(descriptionSections?.["Other ingredients"] ?? descriptionSections?.["Other Ingredients"]),
    nutritionalFacts.join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
};

const classifyUnknownFamily = (row) => {
  const corpus = collectCorpusText(row);
  const titleCorpus = `${safeText(row?.brandName)} ${safeText(row?.title)}`.trim().toLowerCase();
  const scored = FAMILY_DEFS.map((family) => {
    let score = 0;
    const matchedPatterns = [];
    const titleMatchedPatterns = [];
    for (const pattern of family.patterns) {
      if (!pattern.re.test(corpus)) continue;
      score += pattern.weight;
      matchedPatterns.push(pattern.label);
      if (pattern.re.test(titleCorpus)) titleMatchedPatterns.push(pattern.label);
    }
    return {
      family,
      score,
      matchedPatterns,
      titleMatchedPatterns,
    };
  }).filter((item) => item.score > 0);

  if (scored.length === 0) {
    return {
      family: {
        id: "residual_mixed_bag",
        label: "Residual Mixed Bag",
        track: "manual_review",
        recommendedCategoryId: null,
        rationale: "No clear family cue matched. Keep this in residual long-tail review.",
      },
      score: 0,
      margin: 0,
      matchedPatterns: [],
      titleMatchedPatterns: [],
      confidence: "low",
    };
  }

  scored.sort((left, right) => right.score - left.score || right.matchedPatterns.length - left.matchedPatterns.length);
  const best = scored[0];
  const second = scored[1];
  const margin = best.score - (second?.score ?? 0);
  const confidence = best.score >= MIN_HIGH_CONFIDENCE_SCORE && margin >= MIN_HIGH_CONFIDENCE_MARGIN
    ? "high"
    : best.score >= 5
      ? "medium"
      : "low";

  return {
    family: best.family,
    score: best.score,
    margin,
    matchedPatterns: best.matchedPatterns,
    titleMatchedPatterns: best.titleMatchedPatterns,
    confidence,
  };
};

const getSectionStatus = (payload) => {
  const overview = payload?.overviewBlock;
  const science = payload?.scienceBlock;
  const usage = payload?.usageBlock;
  const safety = payload?.safetyBlock;

  const overviewOk =
    Array.isArray(overview?.bestForBullets) && overview.bestForBullets.length > 0
    && Array.isArray(overview?.providesVerified?.keyIngredients) && overview.providesVerified.keyIngredients.length > 0;
  const scienceOk =
    Array.isArray(science?.ingredientRows) && science.ingredientRows.length > 0
    && Array.isArray(science?.aiSummaryContract3) && science.aiSummaryContract3.length === 3;
  const usageOk =
    safeText(usage?.directions?.text).length > 0
    && Array.isArray(usage?.directions?.lines) && usage.directions.lines.length > 0;
  const safetyOk =
    (Array.isArray(safety?.labelWarnings) && safety.labelWarnings.length > 0)
    || (Array.isArray(safety?.generalWatchouts) && safety.generalWatchouts.length > 0)
    || (Array.isArray(safety?.ulGuidance) && safety.ulGuidance.length > 0);

  return {
    overviewOk,
    scienceOk,
    usageOk,
    safetyOk,
  };
};

const classifyFactType = (row) => {
  const supplementFacts = toObjectRecord(row?.supplementFacts);
  const facts = Array.isArray(supplementFacts?.nutritionalFacts) ? supplementFacts.nutritionalFacts : [];
  const namedRows = facts.filter((item) => safeText(item?.substancy ?? item?.substance ?? item?.name));
  if (facts.length === 0 || namedRows.length === 0) return "header_only_facts";

  const names = namedRows.map((item) => safeText(item?.substancy ?? item?.substance ?? item?.name).toLowerCase());
  const nutritionLike = names.every((name) => /\b(calories?|total fat|saturated fat|cholesterol|sodium|total carbohydrate|dietary fiber|total sugars?|added sugars?|protein)\b/.test(name));
  if (nutritionLike) return "nutrition_only_facts";

  const withDose = namedRows.filter((item) => safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount)).length;
  if (withDose > 0) return "has_extractable_ingredients";
  return "named_rows_unparsed";
};

const classifyDeepGap = (row, analysis) => {
  const sections = getSectionStatus(analysis.payload);
  const overlay = analysis.overlayClaims;
  const factType = classifyFactType(row);

  const usageSourceMissing = !sections.usageOk && !safeText(overlay?.suggestedUse);
  const safetySourceMissing = !sections.safetyOk && !safeText(overlay?.warnings);
  const scienceMissing = !sections.scienceOk;
  const overviewMissing = !sections.overviewOk;

  const subReasons = [];
  if (scienceMissing) {
    if (factType === "header_only_facts") subReasons.push("ingredient_source_header_only");
    else if (factType === "nutrition_only_facts") subReasons.push("ingredient_source_nutrition_only");
    else if (factType === "named_rows_unparsed") subReasons.push("ingredient_parser_unparsed_named_rows");
    else subReasons.push("ingredient_science_derivation_gap");
  }
  if (overviewMissing && !scienceMissing) subReasons.push("overview_derivation_gap");
  if (!sections.usageOk) subReasons.push(usageSourceMissing ? "usage_text_source_missing" : "usage_render_gap");
  if (!sections.safetyOk) subReasons.push(safetySourceMissing ? "safety_text_source_missing" : "safety_render_gap");

  const ingredientScienceGap = subReasons.some((reason) => reason.startsWith("ingredient_") || reason === "overview_derivation_gap");
  const textSourceGap = subReasons.some((reason) => reason.endsWith("_text_source_missing"));
  const primaryGapType = ingredientScienceGap && textSourceGap
    ? "mixed_gap"
    : ingredientScienceGap
      ? "ingredient_science_gap"
      : textSourceGap
        ? "text_source_gap"
        : "render_gap";

  return {
    primaryGapType,
    factType,
    subReasons,
    sectionStatus: sections,
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Full-Corpus Long-Tail Cleanup Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- importedRowCount: ${report.summary.importedRowCount}`);
  lines.push(`- unknownCategoryCount: ${report.summary.unknownCategoryCount}`);
  lines.push(`- unknownCategoryRate: ${report.summary.unknownCategoryRate}%`);
  lines.push(`- deepContentGapCount: ${report.summary.deepContentGapCount}`);
  lines.push(`- deepContentReadyRate: ${report.summary.deepContentReadyRate}%`);
  lines.push("");
  lines.push("## Priority Families");
  lines.push("");
  for (const family of report.cleanupPriorityFamilies.slice(0, 10)) {
    lines.push(`- ${family.familyId}: count=${family.count}, highConfidenceCount=${family.highConfidenceCount}, track=${family.track}, recommendedCategoryId=${family.recommendedCategoryId ?? "n/a"}`);
  }
  lines.push("");
  lines.push("## First Cleanup Wave");
  lines.push("");
  lines.push(`- selectedFamilyId: ${report.firstCleanupWave.familyId}`);
  lines.push(`- recommendedCategoryId: ${report.firstCleanupWave.recommendedCategoryId ?? "n/a"}`);
  lines.push(`- rowCount: ${report.firstCleanupWave.rowCount}`);
  lines.push(`- highConfidenceRowCount: ${report.firstCleanupWave.highConfidenceRowCount}`);
  lines.push(`- confidenceThreshold: score>=${MIN_HIGH_CONFIDENCE_SCORE} and margin>=${MIN_HIGH_CONFIDENCE_MARGIN}`);
  lines.push("");
  lines.push("## Deep Content Gap Attribution");
  lines.push("");
  for (const [key, value] of sortEntries(report.deepContentGap.primaryGapTypeCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Deep Content Gap Fact Types");
  lines.push("");
  for (const [key, value] of sortEntries(report.deepContentGap.factTypeCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const importedRows = await buildImportedRows({
    stagingPath: STAGING_PATH,
    mergeReportPath: MERGE_REPORT_PATH,
  });

  const unknownRows = [];
  const familyBuckets = new Map();
  const deepGapRows = [];
  const primaryGapTypeCounts = {};
  const deepGapFactTypeCounts = {};
  const deepGapSubReasonCounts = {};
  let deepContentReadyCount = 0;

  for (const row of importedRows) {
    const analysis = buildRowAnalysis(row);
    if (analysis.deepContentReady) {
      deepContentReadyCount += 1;
    } else {
      const gap = classifyDeepGap(row, analysis);
      increment(primaryGapTypeCounts, gap.primaryGapType);
      increment(deepGapFactTypeCounts, gap.factType);
      for (const reason of gap.subReasons) increment(deepGapSubReasonCounts, reason);
      deepGapRows.push({
        productId: safeText(row.productId),
        barcode_gtin14: safeText(row.barcode_gtin14),
        brandName: safeText(row.brandName),
        title: safeText(row.title),
        categoryId: safeText(analysis.categoryId),
        primaryGapType: gap.primaryGapType,
        factType: gap.factType,
        subReasons: gap.subReasons,
        sectionStatus: gap.sectionStatus,
      });
    }

    if (safeText(analysis.categoryId) !== "unknown") continue;

    const classification = classifyUnknownFamily(row);
    const familyId = classification.family.id;
    const bucket = familyBuckets.get(familyId) ?? {
      familyId,
      label: classification.family.label,
      track: classification.family.track,
      recommendedCategoryId: classification.family.recommendedCategoryId,
      rationale: classification.family.rationale,
      rows: [],
    };
    bucket.rows.push({
      productId: safeText(row.productId),
      barcode_gtin14: safeText(row.barcode_gtin14),
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      overallScore: Number(analysis.payload?.nutriScoreCardV2?.overallScore ?? 0),
      deepContentReady: analysis.deepContentReady,
      score: classification.score,
      margin: classification.margin,
      confidence: classification.confidence,
      matchedPatterns: classification.matchedPatterns,
      titleMatchedPatterns: classification.titleMatchedPatterns,
    });
    familyBuckets.set(familyId, bucket);

    unknownRows.push({
      productId: safeText(row.productId),
      barcode_gtin14: safeText(row.barcode_gtin14),
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      familyId,
      track: classification.family.track,
      recommendedCategoryId: classification.family.recommendedCategoryId,
      score: classification.score,
      margin: classification.margin,
      confidence: classification.confidence,
      matchedPatterns: classification.matchedPatterns,
      titleMatchedPatterns: classification.titleMatchedPatterns,
      overallScore: Number(analysis.payload?.nutriScoreCardV2?.overallScore ?? 0),
    });
  }

  const cleanupPriorityFamilies = [...familyBuckets.values()]
    .map((bucket, index) => ({
      priorityRank: index + 1,
      familyId: bucket.familyId,
      label: bucket.label,
      track: bucket.track,
      recommendedCategoryId: bucket.recommendedCategoryId,
      rationale: bucket.rationale,
      count: bucket.rows.length,
      avgOverallScore: average(bucket.rows, "overallScore"),
      deepContentReadyRate: pct(bucket.rows.filter((row) => row.deepContentReady).length, bucket.rows.length),
      highConfidenceCount: bucket.rows.filter((row) => row.confidence === "high").length,
      titleExplicitHighConfidenceCount: bucket.rows.filter((row) => row.confidence === "high" && row.titleMatchedPatterns.length > 0).length,
      mediumConfidenceCount: bucket.rows.filter((row) => row.confidence === "medium").length,
      lowConfidenceCount: bucket.rows.filter((row) => row.confidence === "low").length,
      topMatchedPatterns: sortEntries(
        bucket.rows.reduce((acc, row) => {
          for (const pattern of row.matchedPatterns) increment(acc, pattern);
          return acc;
        }, {}),
      ).slice(0, 6).map(([pattern, count]) => ({ pattern, count })),
      sampleRows: bucket.rows.slice(0, 10),
    }))
    .sort((left, right) =>
      right.count - left.count
      || right.titleExplicitHighConfidenceCount - left.titleExplicitHighConfidenceCount
      || right.highConfidenceCount - left.highConfidenceCount
      || (left.familyId.localeCompare(right.familyId)));

  cleanupPriorityFamilies.forEach((item, index) => {
    item.priorityRank = index + 1;
  });

  const firstCleanupFamily = cleanupPriorityFamilies.find((item) =>
    item.track === EXISTING_CATEGORY_RESCUE_TRACK && item.titleExplicitHighConfidenceCount > 0) ?? cleanupPriorityFamilies[0];

  const firstCleanupWaveRows = unknownRows
    .filter((row) =>
      row.familyId === firstCleanupFamily?.familyId
      && row.confidence === "high"
      && row.titleMatchedPatterns.length > 0)
    .sort((left, right) => right.score - left.score || right.margin - left.margin || left.title.localeCompare(right.title));

  const report = {
    schemaVersion: "iherb_full_corpus_long_tail_cleanup_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: toRelative(STAGING_PATH),
      mergeReportPath: toRelative(MERGE_REPORT_PATH),
    },
    summary: {
      importedRowCount: importedRows.length,
      unknownCategoryCount: unknownRows.length,
      unknownCategoryRate: pct(unknownRows.length, importedRows.length),
      deepContentGapCount: deepGapRows.length,
      deepContentReadyRate: pct(deepContentReadyCount, importedRows.length),
      familyCount: cleanupPriorityFamilies.length,
    },
    cleanupPriorityFamilies,
    unknownFamilyRows: unknownRows,
    firstCleanupWave: {
      familyId: firstCleanupFamily?.familyId ?? null,
      label: firstCleanupFamily?.label ?? null,
      recommendedCategoryId: firstCleanupFamily?.recommendedCategoryId ?? null,
      rowCount: firstCleanupWaveRows.length,
      highConfidenceRowCount: firstCleanupWaveRows.length,
      rows: firstCleanupWaveRows,
    },
    deepContentGap: {
      primaryGapTypeCounts,
      factTypeCounts: deepGapFactTypeCounts,
      subReasonCounts: deepGapSubReasonCounts,
      sampleRows: deepGapRows.slice(0, 100),
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "full_corpus_long_tail_cleanup_pack.json"), report),
    writeJson(path.join(OUT_DIR, "full_corpus_unknown_family_breakdown.json"), {
      generatedAt: report.generatedAt,
      summary: report.summary,
      cleanupPriorityFamilies: report.cleanupPriorityFamilies,
    }),
    writeJson(path.join(OUT_DIR, "first_cleanup_wave_seed.json"), report.firstCleanupWave),
    writeJson(path.join(OUT_DIR, "deep_content_gap_breakdown.json"), report.deepContentGap),
    fs.writeFile(path.join(OUT_DIR, "full_corpus_long_tail_cleanup_pack.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    summary: report.summary,
    firstCleanupWave: {
      familyId: report.firstCleanupWave.familyId,
      recommendedCategoryId: report.firstCleanupWave.recommendedCategoryId,
      rowCount: report.firstCleanupWave.rowCount,
    },
    topFamilies: report.cleanupPriorityFamilies.slice(0, 5).map((family) => ({
      familyId: family.familyId,
      track: family.track,
      count: family.count,
      highConfidenceCount: family.highConfidenceCount,
      recommendedCategoryId: family.recommendedCategoryId,
    })),
    deepContentGap: {
      primaryGapTypeCounts: report.deepContentGap.primaryGapTypeCounts,
      factTypeCounts: report.deepContentGap.factTypeCounts,
    },
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
