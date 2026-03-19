#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildImportedRows,
  buildRowAnalysis,
  pct,
  safeText,
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
const FULL_AUDIT_PATH = getArg(
  "full-audit-json",
  path.join(ROOT, "output", "iherb_full_category_census_audit_wave13_20260316", "full_category_census_audit.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_category_experience_validation_pack_${TODAY}`),
);

const TARGET_SPECS = [
  {
    categoryId: "probiotics",
    type: "established",
    whyNow: "We need to verify whether probiotic products read like a mature strain-and-CFU lane rather than generic supplement copy.",
    cueRegex: /\b(probiotic|probiotics|cfu|lactobacillus|bifidobacterium|saccharomyces|gut|digestive flora)\b/i,
    usageCueRegex: /\b(daily|capsule|before meals?|with meals?|empty stomach|refrigerat)\b/i,
    safetyCueRegex: /\b(immunocompromised|refrigerat|pregnant|medication|consult)\b/i,
  },
  {
    categoryId: "magnesium",
    type: "established",
    whyNow: "We need to verify whether magnesium products read like a mature form-sensitive mineral lane rather than generic mineral copy.",
    cueRegex: /\bmagnesium|glycinate|citrate|oxide|malate|threonate|taurate|chloride\b/i,
    usageCueRegex: /\b(daily|at bedtime|with meals?|with food|serving)\b/i,
    safetyCueRegex: /\b(diarrhea|laxative|kidney|pregnant|medication|consult)\b/i,
  },
  {
    categoryId: "sleep_stress_mood_support",
    type: "established",
    whyNow: "We need to verify whether sleep and mood products read like a real timing-and-calming lane rather than generic wellness copy.",
    cueRegex: /\b(sleep|stress|mood|calm|relax|melatonin|gaba|theanine|5-htp|ashwagandha)\b/i,
    usageCueRegex: /\b(at bedtime|before sleep|before bedtime|night|stress|calm|relax)\b/i,
    safetyCueRegex: /\b(drows|sedat|driv|pregnant|medication|consult)\b/i,
  },
  {
    categoryId: "botanical_herbal_support",
    type: "established",
    whyNow: "We need to verify whether botanical products read like an herb-specific lane or still fall back to generic supplement language.",
    cueRegex: /\b(herbal|extract|turmeric|ashwagandha|milk thistle|cinnamon|oregano|ginseng|elderberry|olive leaf)\b/i,
    usageCueRegex: /\b(daily|herbal|extract|tea|capsule|serving)\b/i,
    safetyCueRegex: /\b(herb|pregnant|medication|consult|allerg)\b/i,
  },
  {
    categoryId: "metabolic_glucose_support",
    type: "new",
    whyNow: "We need to know whether berberine / glucose-support products now read like a coherent metabolic lane, not just a resolved taxonomy label.",
    cueRegex: /\b(berberine|glucose|blood sugar|glycemic|insulin)\b/i,
    usageCueRegex: /\b(before (a )?meal|with (a )?meal|blood sugar|glucose)\b/i,
    safetyCueRegex: /\b(glucose|blood sugar|diabetes|medication|hypoglyc)\b/i,
  },
  {
    categoryId: "cholesterol_lipid_support",
    type: "new",
    whyNow: "We need to know whether red-yeast-rice / lipid-support products now read like a dedicated cholesterol lane rather than generic herb copy.",
    cueRegex: /\b(red yeast rice|cholesterol|lipid|monacolin|coq-?10|coenzyme q10)\b/i,
    usageCueRegex: /\b(with (any )?meal|with food|cholesterol|lipid)\b/i,
    safetyCueRegex: /\b(cholesterol|liver|statin|pregnant|birth defects)\b/i,
  },
  {
    categoryId: "liver_bile_support",
    type: "new",
    whyNow: "We need to know whether TUDCA / ox-bile products now read like a liver-bile lane rather than a vague digestive catch-all.",
    cueRegex: /\b(tudca|tauroursodeoxycholic|ox bile|bile|liver|gallbladder)\b/i,
    usageCueRegex: /\b(with meals? containing fat|with food|bile|fat)\b/i,
    safetyCueRegex: /\b(liver|bile|gallbladder|healthcare practitioner)\b/i,
  },
  {
    categoryId: "fish_oil_omega3",
    type: "baseline",
    whyNow: "Mature baseline lane used to compare how category-specific a known-good consumer experience looks.",
    cueRegex: /\b(omega-?3|epa|dha|fish oil|vascular|heart)\b/i,
    usageCueRegex: /\b(with (any )?meal|omega|fish oil)\b/i,
    safetyCueRegex: /\b(blood thinners|surgical|fish oil|omega)\b/i,
  },
];

const GENERIC_OVERVIEW_REGEX =
  /\bcomparing ingredient support based on clear label disclosure\b|\bproducts with clear per-serving disclosure so comparisons are easier\b/i;
const GENERIC_SCIENCE_REGEX =
  /\boften used for goal-oriented supplement support\b|\bgeneral science\b/i;
const GENERIC_SAFETY_REGEX =
  /\bif you are pregnant, breastfeeding, or using medications, review watch-outs before use\b|\bgeneral watch-outs are ingredient-level guidance\b/i;

const joinLines = (value) => (Array.isArray(value) ? value.map((item) => safeText(item)).filter(Boolean).join(" ") : "");

const normalizeText = (value) => safeText(value).replace(/\s+/g, " ").trim();

const toSectionTexts = (payload) => {
  const overviewBullets = Array.isArray(payload?.overviewBlock?.bestForBullets)
    ? payload.overviewBlock.bestForBullets.map((item) => safeText(item)).filter(Boolean)
    : [];
  const keyIngredients = Array.isArray(payload?.overviewBlock?.providesVerified?.keyIngredients)
    ? payload.overviewBlock.providesVerified.keyIngredients.map((item) => `${safeText(item?.name)} ${safeText(item?.dose)}`.trim()).filter(Boolean)
    : [];
  const ingredientRows = Array.isArray(payload?.scienceBlock?.ingredientRows)
    ? payload.scienceBlock.ingredientRows.map((item) => `${safeText(item?.name)} ${safeText(item?.dose)}`.trim()).filter(Boolean)
    : [];
  const scienceSummary = Array.isArray(payload?.scienceBlock?.aiSummaryContract3)
    ? payload.scienceBlock.aiSummaryContract3.map((item) => safeText(item)).filter(Boolean)
    : [];
  const usageLines = Array.isArray(payload?.usageBlock?.directions?.lines)
    ? payload.usageBlock.directions.lines.map((item) => safeText(item)).filter(Boolean)
    : [];
  const safetyLines = [
    ...(Array.isArray(payload?.safetyBlock?.labelWarnings) ? payload.safetyBlock.labelWarnings : []),
    ...(Array.isArray(payload?.safetyBlock?.generalWatchouts) ? payload.safetyBlock.generalWatchouts : []),
    ...(Array.isArray(payload?.safetyBlock?.ulGuidance) ? payload.safetyBlock.ulGuidance : []),
  ].map((item) => safeText(item)).filter(Boolean);

  return {
    overviewText: normalizeText([...overviewBullets, ...keyIngredients].join(" ")),
    scienceText: normalizeText([...ingredientRows, ...scienceSummary].join(" ")),
    usageText: normalizeText(usageLines.join(" ")),
    safetyText: normalizeText(safetyLines.join(" ")),
    overviewBullets,
    keyIngredients,
    scienceSummary,
    usageLines,
    safetyLines,
  };
};

const sortRows = (rows) =>
  [...rows].sort((a, b) =>
    b.score - a.score
    || a.brandName.localeCompare(b.brandName)
    || a.title.localeCompare(b.title));

const computeMaturityTier = (category) => {
  const overviewStrong = category.overviewSpecificityRate >= 80 && category.overviewGenericRate <= 20;
  const scienceStrong = category.scienceSpecificityRate >= 80 && category.scienceGenericRate <= 20;
  const safetyStrong = category.safetySpecificityRate >= 80 && category.safetyGenericRate <= 20;

  if (overviewStrong && scienceStrong && safetyStrong) return "mature";
  if (overviewStrong && scienceStrong) return "specialized_core";
  if (overviewStrong || scienceStrong || safetyStrong) return "partial_specialization";
  return "generic_heavy";
};

const toExamples = (rows) =>
  rows.slice(0, 3).map((row) => ({
    productId: row.productId,
    brandName: row.brandName,
    title: row.title,
    score: row.score,
    overviewExcerpt: row.overviewBullets.slice(0, 2),
    scienceExcerpt: row.scienceSummary,
    usageExcerpt: row.usageLines.slice(0, 2),
    safetyExcerpt: row.safetyLines.slice(0, 2),
  }));

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Category Experience Validation Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- importedRowCount: ${report.summary.importedRowCount}`);
  lines.push(`- fullCorpusUnknownCategoryRate: ${report.summary.fullCorpusUnknownCategoryRate}%`);
  lines.push(`- fullCorpusDeepContentReadyRate: ${report.summary.fullCorpusDeepContentReadyRate}%`);
  lines.push(`- recommendation: ${report.summary.recommendation}`);
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- mainlineNextStep: ${report.decision.mainlineNextStep}`);
  lines.push(`- longTailCleanupDecision: ${report.decision.longTailCleanupDecision}`);
  lines.push(`- why: ${report.decision.why}`);
  lines.push("");
  lines.push("## Category Experience");
  lines.push("");
  for (const category of report.categories) {
    lines.push(`### ${category.categoryId}`);
    lines.push(`- type: ${category.type}`);
    lines.push(`- count: ${category.count}`);
    lines.push(`- avgScore: ${category.avgScore}`);
    lines.push(`- overviewSpecificityRate: ${category.overviewSpecificityRate}%`);
    lines.push(`- scienceSpecificityRate: ${category.scienceSpecificityRate}%`);
    lines.push(`- usageSpecificityRate: ${category.usageSpecificityRate}%`);
    lines.push(`- safetySpecificityRate: ${category.safetySpecificityRate}%`);
    lines.push(`- overviewGenericRate: ${category.overviewGenericRate}%`);
    lines.push(`- scienceGenericRate: ${category.scienceGenericRate}%`);
    lines.push(`- safetyGenericRate: ${category.safetyGenericRate}%`);
    lines.push(`- allSectionsSpecificRate: ${category.allSectionsSpecificRate}%`);
    lines.push(`- maturityTier: ${category.maturityTier}`);
    lines.push(`- whyNow: ${category.whyNow}`);
    lines.push("");
    for (const sample of category.examples) {
      lines.push(`- ${sample.brandName} / ${sample.title}`);
      lines.push(`  - score: ${sample.score}`);
      lines.push(`  - overview: ${sample.overviewExcerpt.join(" | ") || "none"}`);
      lines.push(`  - science: ${sample.scienceExcerpt.join(" | ") || "none"}`);
      lines.push(`  - usage: ${sample.usageExcerpt.join(" | ") || "none"}`);
      lines.push(`  - safety: ${sample.safetyExcerpt.join(" | ") || "none"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [importedRows, fullAudit] = await Promise.all([
    buildImportedRows({
      stagingPath: STAGING_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
    }),
    fs.readFile(FULL_AUDIT_PATH, "utf8").then((raw) => JSON.parse(raw)),
  ]);

  const buckets = new Map(TARGET_SPECS.map((spec) => [spec.categoryId, []]));

  for (const row of importedRows) {
    const analysis = buildRowAnalysis(row);
    const categoryId = safeText(analysis.categoryId);
    if (!buckets.has(categoryId)) continue;

    const spec = TARGET_SPECS.find((item) => item.categoryId === categoryId);
    const text = toSectionTexts(analysis.payload);

    const overviewSpecific = spec.cueRegex.test(text.overviewText) && !GENERIC_OVERVIEW_REGEX.test(text.overviewText);
    const scienceSpecific = spec.cueRegex.test(text.scienceText) && !GENERIC_SCIENCE_REGEX.test(text.scienceText);
    const usageSpecific = spec.usageCueRegex.test(text.usageText);
    const safetySpecific = spec.safetyCueRegex.test(text.safetyText) && !GENERIC_SAFETY_REGEX.test(text.safetyText);

    buckets.get(categoryId).push({
      productId: safeText(row.productId),
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      score: Number(analysis.payload?.nutriScoreCardV2?.overallScore ?? 0),
      overviewSpecific,
      scienceSpecific,
      usageSpecific,
      safetySpecific,
      overviewGeneric: GENERIC_OVERVIEW_REGEX.test(text.overviewText),
      scienceGeneric: GENERIC_SCIENCE_REGEX.test(text.scienceText),
      safetyGeneric: GENERIC_SAFETY_REGEX.test(text.safetyText),
      ...text,
    });
  }

  const categories = TARGET_SPECS.map((spec) => {
    const rows = sortRows(buckets.get(spec.categoryId) ?? []);
    return {
      categoryId: spec.categoryId,
      type: spec.type,
      whyNow: spec.whyNow,
      count: rows.length,
      avgScore: rows.length > 0
        ? Number((rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(1))
        : 0,
      overviewSpecificityRate: pct(rows.filter((row) => row.overviewSpecific).length, rows.length),
      scienceSpecificityRate: pct(rows.filter((row) => row.scienceSpecific).length, rows.length),
      usageSpecificityRate: pct(rows.filter((row) => row.usageSpecific).length, rows.length),
      safetySpecificityRate: pct(rows.filter((row) => row.safetySpecific).length, rows.length),
      overviewGenericRate: pct(rows.filter((row) => row.overviewGeneric).length, rows.length),
      scienceGenericRate: pct(rows.filter((row) => row.scienceGeneric).length, rows.length),
      safetyGenericRate: pct(rows.filter((row) => row.safetyGeneric).length, rows.length),
      allSectionsSpecificRate: pct(
        rows.filter((row) => row.overviewSpecific && row.scienceSpecific && row.usageSpecific && row.safetySpecific).length,
        rows.length,
      ),
      examples: toExamples(rows),
    };
  }).map((category) => ({
    ...category,
    maturityTier: computeMaturityTier(category),
  }));

  const newCategories = categories.filter((item) => item.type === "new");
  const establishedCategories = categories.filter((item) => item.type === "established");
  const weakExperienceCategories = newCategories
    .filter((item) => item.overviewSpecificityRate < 50 || item.scienceSpecificityRate < 50)
    .map((item) => item.categoryId);

  const recommendation = weakExperienceCategories.length > 0
    ? "Move to category-specific consumer-copy specialization; do not make full-corpus long-tail cleanup the mainline yet."
    : "Consumer experience is strong enough to justify considering a background long-tail cleanup project.";

  const report = {
    schemaVersion: "iherb_category_experience_validation_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: toRelative(STAGING_PATH),
      mergeReportPath: toRelative(MERGE_REPORT_PATH),
      fullAuditPath: toRelative(FULL_AUDIT_PATH),
    },
    summary: {
      importedRowCount: Number(fullAudit?.summary?.importedRowCount ?? importedRows.length),
      fullCorpusUnknownCategoryRate: Number(fullAudit?.summary?.unknownCategoryRate ?? 0),
      fullCorpusDeepContentReadyRate: Number(fullAudit?.summary?.deepContentReadyRate ?? 0),
      validatedCategories: TARGET_SPECS.map((item) => item.categoryId),
      maturityBuckets: {
        mature: categories.filter((item) => item.maturityTier === "mature").map((item) => item.categoryId),
        specialized_core: categories.filter((item) => item.maturityTier === "specialized_core").map((item) => item.categoryId),
        partial_specialization: categories.filter((item) => item.maturityTier === "partial_specialization").map((item) => item.categoryId),
        generic_heavy: categories.filter((item) => item.maturityTier === "generic_heavy").map((item) => item.categoryId),
      },
      recommendation,
    },
    categories,
    decision: {
      mainlineNextStep: weakExperienceCategories.length > 0
        ? "Run a category-specific copy specialization pass for new live categories."
        : "Shift the taxonomy lane to maintenance and open long-tail cleanup as a background project if needed.",
      longTailCleanupDecision: weakExperienceCategories.length > 0
        ? "Do not start full-corpus long-tail cleanup as the next mainline project."
        : "Optional background project only.",
      why: weakExperienceCategories.length > 0
        ? `New live categories still resolve taxonomy better than before, but ${weakExperienceCategories.join(", ")} remain too generic in overview/science copy. Product experience is the higher-ROI next fix than corpus-wide long-tail cleanup.`
        : "New live categories are both resolved and consumer-specific enough, so remaining unknown rows are mostly long-tail cleanup work.",
      weakExperienceCategories,
      establishedCategoryMaturity: establishedCategories.map((item) => ({
        categoryId: item.categoryId,
        maturityTier: item.maturityTier,
        overviewSpecificityRate: item.overviewSpecificityRate,
        scienceSpecificityRate: item.scienceSpecificityRate,
        usageSpecificityRate: item.usageSpecificityRate,
        safetySpecificityRate: item.safetySpecificityRate,
        overviewGenericRate: item.overviewGenericRate,
        scienceGenericRate: item.scienceGenericRate,
        safetyGenericRate: item.safetyGenericRate,
      })),
      highFrequencyUnknownCount: Number(fullAudit?.summary?.highFrequencyUnknownCount ?? 0),
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "category_experience_validation_pack.json"), report),
    fs.writeFile(path.join(OUT_DIR, "category_experience_validation_pack.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    recommendation: report.summary.recommendation,
    weakExperienceCategories: report.decision.weakExperienceCategories,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
