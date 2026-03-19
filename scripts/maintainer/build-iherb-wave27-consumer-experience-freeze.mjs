#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
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

const EXPERIENCE_PACK_PATH = getArg(
  "experience-pack-json",
  path.join(ROOT, "output", `iherb_category_experience_validation_pack_wave27_${TODAY}`, "category_experience_validation_pack.json"),
);
const LONG_TAIL_CLOSEOUT_PATH = getArg(
  "long-tail-closeout-json",
  path.join(ROOT, "output", "iherb_full_corpus_long_tail_closeout_20260316", "closeout_summary.json"),
);
const PREVIOUS_FREEZE_PATH = getArg(
  "previous-freeze-json",
  path.join(ROOT, "output", "iherb_taxonomy_consumer_mainline_freeze_wave16_20260316", "freeze_summary.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_taxonomy_consumer_mainline_freeze_wave27_${TODAY}`),
);

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Taxonomy Consumer Mainline Freeze (Wave27)");
  lines.push("");
  lines.push(`- frozenAt: ${report.frozenAt}`);
  lines.push(`- baseline: ${report.baseline}`);
  lines.push(`- status: ${report.status}`);
  lines.push("");
  lines.push("## Mainline Result");
  lines.push("");
  lines.push(`- matureCategoriesCount: ${report.mainlineResult.matureCategoriesCount}`);
  lines.push(`- matureCategories: ${report.mainlineResult.matureCategories.join(", ")}`);
  lines.push(`- weakExperienceCategories: ${report.validation.weakExperienceCategories.join(", ") || "none"}`);
  lines.push(`- recommendation: ${report.validation.recommendation}`);
  lines.push("");
  lines.push("## Corpus State");
  lines.push("");
  lines.push(`- importedRowCount: ${report.fullCorpusState.importedRowCount}`);
  lines.push(`- unknownCategoryRate: ${report.fullCorpusState.unknownCategoryRate}%`);
  lines.push(`- deepContentReadyRate: ${report.fullCorpusState.deepContentReadyRate}%`);
  lines.push(`- highFrequencyUnknownCount: ${report.fullCorpusState.highFrequencyUnknownCount}`);
  lines.push("");
  lines.push("## Long-Tail State");
  lines.push("");
  lines.push(`- status: ${report.longTailMaintenanceState.status}`);
  lines.push(`- stopPolicy: ${report.longTailMaintenanceState.stopPolicy}`);
  lines.push(`- noUpliftWaves: ${report.longTailMaintenanceState.noUpliftWaves.join(", ")}`);
  lines.push(`- finalUnknownCategoryRate: ${report.longTailMaintenanceState.finalUnknownCategoryRate}%`);
  lines.push(`- finalDeepContentReadyRate: ${report.longTailMaintenanceState.finalDeepContentReadyRate}%`);
  lines.push("");
  lines.push("## Freeze Decision");
  lines.push("");
  lines.push(`- mainlineFrozen: ${report.freezeDecision.mainlineFrozen}`);
  lines.push(`- nextTrack: ${report.freezeDecision.nextTrack}`);
  lines.push(`- scanProtectedScopeModified: ${report.freezeDecision.scanProtectedScopeModified}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- experiencePack: ${report.inputs.experiencePackPath}`);
  lines.push(`- previousFreeze: ${report.inputs.previousFreezePath}`);
  lines.push(`- longTailCloseout: ${report.inputs.longTailCloseoutPath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [experiencePack, longTailCloseout, previousFreeze] = await Promise.all([
    readJson(EXPERIENCE_PACK_PATH),
    readJson(LONG_TAIL_CLOSEOUT_PATH),
    readJson(PREVIOUS_FREEZE_PATH),
  ]);

  const matureCategories = Array.isArray(experiencePack?.summary?.maturityBuckets?.mature)
    ? experiencePack.summary.maturityBuckets.mature
    : [];

  const report = {
    schemaVersion: "iherb_taxonomy_consumer_mainline_freeze.v2",
    frozenAt: new Date().toISOString().slice(0, 10),
    baseline: "wave27",
    status: "frozen_for_mainline",
    previousBaseline: previousFreeze?.baseline ?? "wave16",
    mainlineResult: {
      matureCategories,
      matureCategoriesCount: matureCategories.length,
      validatedCategoriesCount: Array.isArray(experiencePack?.summary?.validatedCategories)
        ? experiencePack.summary.validatedCategories.length
        : 0,
      allValidatedCategoriesMature:
        Array.isArray(experiencePack?.summary?.validatedCategories)
        && matureCategories.length === experiencePack.summary.validatedCategories.length,
    },
    validation: {
      experiencePackPath: toRelative(EXPERIENCE_PACK_PATH),
      weakExperienceCategories: experiencePack?.decision?.weakExperienceCategories ?? [],
      recommendation: experiencePack?.summary?.recommendation ?? null,
      establishedCategoryMaturity: experiencePack?.decision?.establishedCategoryMaturity ?? [],
    },
    fullCorpusState: {
      importedRowCount: experiencePack?.summary?.importedRowCount ?? null,
      unknownCategoryRate: experiencePack?.summary?.fullCorpusUnknownCategoryRate ?? null,
      deepContentReadyRate: experiencePack?.summary?.fullCorpusDeepContentReadyRate ?? null,
      highFrequencyUnknownCount: experiencePack?.decision?.highFrequencyUnknownCount ?? null,
    },
    longTailMaintenanceState: {
      status: longTailCloseout?.status ?? null,
      stopPolicy: longTailCloseout?.stopCondition?.policy ?? null,
      noUpliftWaves: longTailCloseout?.stopCondition?.noUpliftWaves ?? [],
      finalUnknownCategoryRate: longTailCloseout?.final?.unknownCategoryRate ?? null,
      finalDeepContentReadyRate: longTailCloseout?.final?.deepContentReadyRate ?? null,
    },
    freezeDecision: {
      mainlineFrozen: true,
      nextTrack: "downstream_consumption_and_optional_background_long_tail_maintenance",
      scanProtectedScopeModified: false,
    },
    inputs: {
      experiencePackPath: toRelative(EXPERIENCE_PACK_PATH),
      previousFreezePath: toRelative(PREVIOUS_FREEZE_PATH),
      longTailCloseoutPath: toRelative(LONG_TAIL_CLOSEOUT_PATH),
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "freeze_summary.json"), report),
    fs.writeFile(path.join(OUT_DIR, "freeze_summary.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    mainlineResult: report.mainlineResult,
    fullCorpusState: report.fullCorpusState,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
