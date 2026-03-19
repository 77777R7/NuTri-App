#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
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

const BASELINE_PATH = getArg(
  "baseline-json",
  path.join(
    ROOT,
    "output",
    "iherb_category_experience_validation_pack_wave18_20260316",
    "category_experience_validation_pack.json",
  ),
);

const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_established_category_framing_comparison_pack_${TODAY}`),
);

const TARGETS = [
  {
    categoryId: "magnesium",
    baselinePath: BASELINE_PATH,
    afterPath: path.join(
      ROOT,
      "output",
      "iherb_category_experience_validation_pack_wave19_20260317",
      "category_experience_validation_pack.json",
    ),
    wave: "wave19",
  },
  {
    categoryId: "sleep_stress_mood_support",
    baselinePath: BASELINE_PATH,
    afterPath: path.join(
      ROOT,
      "output",
      "iherb_category_experience_validation_pack_wave20_20260317",
      "category_experience_validation_pack.json",
    ),
    wave: "wave20",
  },
  {
    categoryId: "botanical_herbal_support",
    baselinePath: BASELINE_PATH,
    afterPath: path.join(
      ROOT,
      "output",
      "iherb_category_experience_validation_pack_wave21_20260317",
      "category_experience_validation_pack.json",
    ),
    wave: "wave21",
  },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function findCategory(report, categoryId) {
  const match = report.categories.find((category) => category.categoryId === categoryId);
  if (!match) {
    throw new Error(`Missing category ${categoryId} in ${report.inputs?.fullAuditPath ?? "report"}`);
  }
  return match;
}

function toMetricDelta(beforeCategory, afterCategory) {
  return {
    overviewSpecificityRate: {
      before: beforeCategory.overviewSpecificityRate,
      after: afterCategory.overviewSpecificityRate,
      delta: round(afterCategory.overviewSpecificityRate - beforeCategory.overviewSpecificityRate),
    },
    scienceSpecificityRate: {
      before: beforeCategory.scienceSpecificityRate,
      after: afterCategory.scienceSpecificityRate,
      delta: round(afterCategory.scienceSpecificityRate - beforeCategory.scienceSpecificityRate),
    },
    overviewGenericRate: {
      before: beforeCategory.overviewGenericRate,
      after: afterCategory.overviewGenericRate,
      delta: round(afterCategory.overviewGenericRate - beforeCategory.overviewGenericRate),
    },
    scienceGenericRate: {
      before: beforeCategory.scienceGenericRate,
      after: afterCategory.scienceGenericRate,
      delta: round(afterCategory.scienceGenericRate - beforeCategory.scienceGenericRate),
    },
  };
}

function gateStatus(afterCategory) {
  return {
    overviewSpecificityRate: afterCategory.overviewSpecificityRate >= 80,
    scienceSpecificityRate: afterCategory.scienceSpecificityRate >= 80,
    overviewGenericRate: afterCategory.overviewGenericRate <= 20,
    scienceGenericRate: afterCategory.scienceGenericRate <= 20,
    maturityTier: afterCategory.maturityTier === "specialized_core" || afterCategory.maturityTier === "mature",
  };
}

function firstLine(lines) {
  return Array.isArray(lines) && lines.length > 0 ? lines[0] : "";
}

function secondLine(lines) {
  return Array.isArray(lines) && lines.length > 1 ? lines[1] : "";
}

function toExamples(beforeCategory, afterCategory) {
  const beforeMap = new Map(beforeCategory.examples.map((example) => [String(example.productId), example]));

  return afterCategory.examples.slice(0, 3).map((afterExample) => {
    const beforeExample = beforeMap.get(String(afterExample.productId)) ?? beforeCategory.examples[0];
    return {
      productId: afterExample.productId,
      brandName: afterExample.brandName,
      title: afterExample.title,
      score: afterExample.score,
      overviewBefore: beforeExample.overviewExcerpt ?? [],
      overviewAfter: afterExample.overviewExcerpt ?? [],
      scienceBefore: beforeExample.scienceExcerpt ?? [],
      scienceAfter: afterExample.scienceExcerpt ?? [],
    };
  });
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Established Category Framing Comparison Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- baselinePack: ${report.inputs.baselinePath}`);
  lines.push(`- categoriesCompared: ${report.summary.categoriesCompared}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const category of report.categories) {
    lines.push(`### ${category.categoryId}`);
    lines.push(`- wave: ${category.wave}`);
    lines.push(`- maturity: ${category.before.maturityTier} -> ${category.after.maturityTier}`);
    lines.push(
      `- overviewSpecificityRate: ${category.metrics.overviewSpecificityRate.before}% -> ${category.metrics.overviewSpecificityRate.after}%`,
    );
    lines.push(
      `- scienceSpecificityRate: ${category.metrics.scienceSpecificityRate.before}% -> ${category.metrics.scienceSpecificityRate.after}%`,
    );
    lines.push(
      `- overviewGenericRate: ${category.metrics.overviewGenericRate.before}% -> ${category.metrics.overviewGenericRate.after}%`,
    );
    lines.push(
      `- scienceGenericRate: ${category.metrics.scienceGenericRate.before}% -> ${category.metrics.scienceGenericRate.after}%`,
    );
    lines.push(`- gatePassed: ${category.gatePassed ? "yes" : "no"}`);
    lines.push("");
    lines.push("#### Real Excerpts");
    lines.push("");
    for (const example of category.examples) {
      lines.push(`- ${example.brandName} / ${example.title}`);
      lines.push(`  - productId: ${example.productId}`);
      lines.push(`  - overview before: ${firstLine(example.overviewBefore) || "none"}`);
      lines.push(`  - overview after: ${firstLine(example.overviewAfter) || "none"}`);
      lines.push(`  - science before: ${firstLine(example.scienceBefore) || "none"}`);
      lines.push(`  - science after: ${firstLine(example.scienceAfter) || "none"}`);
      if (secondLine(example.overviewAfter)) {
        lines.push(`  - overview after detail: ${secondLine(example.overviewAfter)}`);
      }
      if (secondLine(example.scienceAfter)) {
        lines.push(`  - science after detail: ${secondLine(example.scienceAfter)}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const categories = TARGETS.map((target) => {
    const baselineReport = readJson(target.baselinePath);
    const afterReport = readJson(target.afterPath);
    const beforeCategory = findCategory(baselineReport, target.categoryId);
    const afterCategory = findCategory(afterReport, target.categoryId);
    const gate = gateStatus(afterCategory);

    return {
      categoryId: target.categoryId,
      wave: target.wave,
      before: {
        maturityTier: beforeCategory.maturityTier,
      },
      after: {
        maturityTier: afterCategory.maturityTier,
      },
      metrics: toMetricDelta(beforeCategory, afterCategory),
      gate,
      gatePassed: Object.values(gate).every(Boolean),
      examples: toExamples(beforeCategory, afterCategory),
      sourcePacks: {
        baselinePath: path.relative(ROOT, target.baselinePath),
        afterPath: path.relative(ROOT, target.afterPath),
      },
    };
  });

  const report = {
    schemaVersion: "iherb_established_category_framing_comparison_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      baselinePath: path.relative(ROOT, BASELINE_PATH),
    },
    summary: {
      categoriesCompared: categories.length,
      allGatePassed: categories.every((category) => category.gatePassed),
      comparedCategoryIds: categories.map((category) => category.categoryId),
    },
    categories,
  };

  ensureDir(OUT_DIR);
  fs.writeFileSync(
    path.join(OUT_DIR, "established_category_framing_comparison_pack.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "established_category_framing_comparison_pack.md"),
    toMarkdown(report),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.relative(ROOT, OUT_DIR),
        categories: categories.map((category) => ({
          categoryId: category.categoryId,
          wave: category.wave,
          gatePassed: category.gatePassed,
          maturityBefore: category.before.maturityTier,
          maturityAfter: category.after.maturityTier,
        })),
      },
      null,
      2,
    ),
  );
}

main();
