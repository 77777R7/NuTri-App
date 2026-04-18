#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildOfficialWavePlan,
  findLatestApiFillQueueDir,
  writeOfficialWaveOutputs,
} from "./lib/full-db-api-fill-official-waves.mjs";
import { ROOT_DIR } from "./lib/science-validation-reporting.mjs";

const parseArgs = () => {
  const values = {
    queueJsonPath: null,
    outDir: null,
    topBrandCount: 12,
    maxWaveRows: 140,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--queue-json" && next) {
      values.queueJsonPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--top-brands" && next) {
      values.topBrandCount = Math.max(1, Number(next) || 12);
      index += 1;
    } else if (arg === "--max-wave-rows" && next) {
      values.maxWaveRows = Math.max(20, Number(next) || 140);
      index += 1;
    }
  }
  return values;
};

const main = async () => {
  const args = parseArgs();
  const latestQueueDir = args.queueJsonPath
    ? null
    : await findLatestApiFillQueueDir();
  const queueJsonPath = args.queueJsonPath
    ? path.resolve(ROOT_DIR, args.queueJsonPath)
    : path.join(latestQueueDir, "api_fill_queue.all.json");

  const queueRows = JSON.parse(await fs.readFile(queueJsonPath, "utf8"));
  const outputDir = args.outDir
    ? path.resolve(ROOT_DIR, args.outDir)
    : path.join(path.dirname(queueJsonPath), "official_waves");

  const plan = buildOfficialWavePlan({
    queueRows,
    topBrandCount: args.topBrandCount,
    maxWaveRows: args.maxWaveRows,
  });

  const outputs = await writeOfficialWaveOutputs({
    plan,
    outDir: outputDir,
  });

  console.error(`[official-waves] queue=${path.relative(ROOT_DIR, queueJsonPath)}`);
  console.error(`[official-waves] officialReadyRows=${plan.summary.officialReadyRows}`);
  console.error(`[official-waves] laneAHardFactsOfficialReadyRows=${plan.summary.laneAHardFactsOfficialReadyRows}`);
  console.error(`[official-waves] laneBSoftFieldOfficialReadyRows=${plan.summary.laneBSoftFieldOfficialReadyRows}`);
  console.error(`[official-waves] selectedLaneBTopBrands=${plan.summary.selectedLaneBTopBrands}`);
  console.error(`[official-waves] waves=${plan.summary.waves}`);
  console.error(`[official-waves] wrote ${outputs.planJsonPath}`);
  console.error(`[official-waves] wrote ${outputs.planMarkdownPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
