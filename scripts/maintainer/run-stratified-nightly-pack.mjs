#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";
import {
  buildStratifiedNightlyPack,
  loadStratifiedNightlyConfig,
  loadStratifiedNightlySourcePack,
  renderStratifiedNightlyMarkdown,
  writeStratifiedNightlyPack,
} from "./lib/stratified-nightly-pack.mjs";

const parseArgs = () => {
  const values = {
    configPath: "data/validation/stratified-nightly-pack.v1.json",
    outDir: "output/validation-nightly",
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
  const config = await loadStratifiedNightlyConfig(args.configPath);
  const pack = await loadStratifiedNightlySourcePack(config);
  const nightlyPack = buildStratifiedNightlyPack({ pack, config });

  if (args.dryRun) {
    console.log(JSON.stringify({
      configPath: args.configPath,
      sourcePackPath: config.sourcePackPath,
      additionalPackPaths: config.additionalPackPaths ?? [],
      targetSize: config.targetSize,
      selected: nightlyPack.summary.total,
      surfaces: nightlyPack.summary.surfaces,
      categories: nightlyPack.summary.categories,
    }, null, 2));
    return;
  }

  const outputs = await writeStratifiedNightlyPack({
    nightlyPack,
    outDir: args.outDir,
  });

  if (args.printMarkdown) {
    console.log(renderStratifiedNightlyMarkdown(nightlyPack));
  }

  console.error(`[stratified-nightly] selected=${nightlyPack.summary.total}/${nightlyPack.targetSize}`);
  console.error(`[stratified-nightly] wrote ${outputs.jsonPath}`);
  console.error(`[stratified-nightly] wrote ${outputs.mdPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
