#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildCuratedValidationPack,
  loadCuratedValidationConfig,
  loadCuratedValidationSourcePack,
} from "./lib/validation-governance.mjs";
import {
  buildRuntimeCanaryPack,
  classifyStablePromotionCandidates,
  collectPromotionCandidateScenarios,
  renderStablePromotionCandidateMarkdown,
  writeRuntimeCanaryPackOutputs,
  writeStablePromotionCandidateOutputs,
} from "./lib/stable-promotion-candidate-selector.mjs";
import { ROOT_DIR } from "./lib/science-validation-reporting.mjs";

const DEFAULT_FOOD_LIKE_PROBE_DIR = "output/food_like_route_honesty/default_latest_probe";

const parseArgs = () => {
  const values = {
    candidatePaths: [],
    stableConfigPath: "data/validation/food-like-route-honesty-stable.v0.json",
    outDir: "output/stable_promotion_candidate_selector",
    maxPromote: 4,
    perBucketPromoteLimit: 1,
    printMarkdown: false,
    emitRuntimeCanaryPack: false,
    canaryConfigOut: "",
    canaryAdditionsOut: "",
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if ((arg === "--candidate" || arg === "--candidates") && next) {
      values.candidatePaths.push(...next.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if (arg === "--stable-config" && next) {
      values.stableConfigPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--max-promote" && next) {
      values.maxPromote = Math.max(0, Number(next) || 0);
      index += 1;
    } else if (arg === "--per-bucket-promote-limit" && next) {
      values.perBucketPromoteLimit = Math.max(1, Number(next) || 1);
      index += 1;
    } else if (arg === "--print-markdown") {
      values.printMarkdown = true;
    } else if (arg === "--emit-runtime-canary-pack") {
      values.emitRuntimeCanaryPack = true;
    } else if (arg === "--canary-config-out" && next) {
      values.canaryConfigOut = next;
      values.emitRuntimeCanaryPack = true;
      index += 1;
    } else if (arg === "--canary-additions-out" && next) {
      values.canaryAdditionsOut = next;
      index += 1;
    }
  }
  return values;
};

const pathExists = async (filePath) => {
  try {
    await fs.access(path.resolve(ROOT_DIR, filePath));
    return true;
  } catch {
    return false;
  }
};

const defaultCandidatePaths = async () => {
  const paths = [
    path.join(DEFAULT_FOOD_LIKE_PROBE_DIR, "food_like_route_honesty_stable_candidates.json"),
    path.join(DEFAULT_FOOD_LIKE_PROBE_DIR, "food_like_route_honesty_nightly_seeds.json"),
  ];
  const existing = [];
  for (const candidatePath of paths) {
    if (await pathExists(candidatePath)) existing.push(candidatePath);
  }
  return existing;
};

const loadStableScenarios = async (stableConfigPath) => {
  const config = await loadCuratedValidationConfig(stableConfigPath);
  const sourcePack = await loadCuratedValidationSourcePack(config);
  return buildCuratedValidationPack({ pack: sourcePack, config }).scenarios;
};

const main = async () => {
  const args = parseArgs();
  const candidatePaths = args.candidatePaths.length > 0
    ? args.candidatePaths
    : await defaultCandidatePaths();

  if (candidatePaths.length === 0) {
    throw new Error("No candidate paths provided and no default food-like discovery candidates were found.");
  }

  const [candidates, stableScenarios] = await Promise.all([
    collectPromotionCandidateScenarios(candidatePaths),
    loadStableScenarios(args.stableConfigPath),
  ]);
  const report = classifyStablePromotionCandidates({
    candidates,
    stableScenarios,
    maxPromote: args.maxPromote,
    perBucketPromoteLimit: args.perBucketPromoteLimit,
  });
  const outputs = await writeStablePromotionCandidateOutputs({
    report: {
      ...report,
      inputs: {
        candidatePaths,
        stableConfigPath: args.stableConfigPath,
      },
    },
    outDir: args.outDir,
  });

  if (args.printMarkdown) {
    console.log(renderStablePromotionCandidateMarkdown(report));
  }
  if (args.emitRuntimeCanaryPack) {
    const canaryConfigPath = args.canaryConfigOut
      || path.join(args.outDir, "live_canary", "stable-promotion-live-canary.json");
    const canaryPack = buildRuntimeCanaryPack({
      report,
      configPath: canaryConfigPath,
      additionsPath: args.canaryAdditionsOut || null,
    });
    const canaryOutputs = await writeRuntimeCanaryPackOutputs({
      pack: canaryPack,
      configPath: canaryConfigPath,
      additionsPath: args.canaryAdditionsOut || null,
    });
    console.error(`[stable-promotion-selector] wrote canary config ${canaryOutputs.configRelativePath}`);
    console.error(`[stable-promotion-selector] wrote canary additions ${canaryOutputs.additionsRelativePath}`);
  }
  console.error(`[stable-promotion-selector] total=${report.summary.totalCandidates}`);
  console.error(`[stable-promotion-selector] promote_now=${report.summary.promote_now}`);
  console.error(`[stable-promotion-selector] keep_nightly=${report.summary.keep_nightly}`);
  console.error(`[stable-promotion-selector] residual=${report.summary.residual}`);
  console.error(`[stable-promotion-selector] needs_data_fix=${report.summary.needs_data_fix}`);
  console.error(`[stable-promotion-selector] skip_duplicate_coverage=${report.summary.skip_duplicate_coverage}`);
  console.error(`[stable-promotion-selector] wrote ${outputs.jsonPath}`);
  console.error(`[stable-promotion-selector] wrote ${outputs.markdownPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
