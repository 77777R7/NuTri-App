#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";

import {
  buildCuratedValidationPack,
  loadCuratedValidationConfig,
  loadCuratedValidationSourcePack,
  renderCuratedValidationMarkdown,
  writeCuratedValidationPack,
} from "./lib/validation-governance.mjs";

const parseArgs = () => {
  const values = {
    configPath: "data/validation/live-replay-release-slice.v1.json",
    outDir: "output/validation-curated",
    dryRun: false,
    printMarkdown: false,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--config" && next) {
      values.configPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    } else if (arg === "--print-markdown") {
      values.printMarkdown = true;
    }
  }
  return values;
};

const main = async () => {
  const args = parseArgs();
  const config = await loadCuratedValidationConfig(args.configPath);
  const pack = await loadCuratedValidationSourcePack(config);
  const curatedPack = buildCuratedValidationPack({ pack, config });

  if (args.dryRun) {
    console.log(JSON.stringify({
      configPath: args.configPath,
      sourcePackPath: config.sourcePackPath,
      total: curatedPack.summary.total,
      releaseBlocker: curatedPack.metadata.releaseBlocker,
      surfaces: curatedPack.summary.surfaces,
      categories: curatedPack.summary.categories,
    }, null, 2));
    return;
  }

  const outputs = await writeCuratedValidationPack({
    curatedPack,
    outDir: args.outDir,
    outputBase: config.version,
  });

  if (args.printMarkdown) {
    console.log(renderCuratedValidationMarkdown(curatedPack));
  }

  console.error(`[curated-validation] total=${curatedPack.summary.total}`);
  console.error(`[curated-validation] wrote ${outputs.jsonPath}`);
  console.error(`[curated-validation] wrote ${outputs.mdPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
