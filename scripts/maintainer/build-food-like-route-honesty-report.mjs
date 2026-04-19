#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildFoodLikeRouteHonestyReport,
  findLatestFoodLikeQueuePath,
  writeFoodLikeRouteHonestyOutputs,
} from "./lib/food-like-route-honesty-report.mjs";
import { ROOT_DIR } from "./lib/science-validation-reporting.mjs";

const parseArgs = () => {
  const values = {
    queueJsonPath: null,
    outDir: null,
    maxStableCandidates: 24,
    maxNightlySeeds: 80,
    stablePerBucket: 4,
    nightlyPerBucket: 12,
    printJson: false,
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
    } else if (arg === "--max-stable-candidates" && next) {
      values.maxStableCandidates = Math.max(1, Number(next) || values.maxStableCandidates);
      index += 1;
    } else if (arg === "--max-nightly-seeds" && next) {
      values.maxNightlySeeds = Math.max(1, Number(next) || values.maxNightlySeeds);
      index += 1;
    } else if (arg === "--stable-per-bucket" && next) {
      values.stablePerBucket = Math.max(1, Number(next) || values.stablePerBucket);
      index += 1;
    } else if (arg === "--nightly-per-bucket" && next) {
      values.nightlyPerBucket = Math.max(1, Number(next) || values.nightlyPerBucket);
      index += 1;
    } else if (arg === "--print-json") {
      values.printJson = true;
    }
  }

  return values;
};

const main = async () => {
  const args = parseArgs();
  const queueJsonPath = args.queueJsonPath
    ? path.resolve(ROOT_DIR, args.queueJsonPath)
    : await findLatestFoodLikeQueuePath();
  const queueRows = JSON.parse(await fs.readFile(queueJsonPath, "utf8"));
  const report = buildFoodLikeRouteHonestyReport({
    queueRows,
    maxStableCandidates: args.maxStableCandidates,
    maxNightlySeeds: args.maxNightlySeeds,
    stablePerBucket: args.stablePerBucket,
    nightlyPerBucket: args.nightlyPerBucket,
  });
  const outputs = await writeFoodLikeRouteHonestyOutputs({
    report,
    outDir: args.outDir,
  });

  const result = {
    ok: true,
    queueJsonPath: path.relative(ROOT_DIR, queueJsonPath),
    outputs,
    summary: report.summary,
  };

  if (args.printJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`[food-like-route-honesty] totalLaneRows=${report.summary.totalLaneRows}`);
    console.error(`[food-like-route-honesty] stableGateCandidates=${report.summary.stableGateCandidates}`);
    console.error(`[food-like-route-honesty] nightlySeeds=${report.summary.nightlySeeds}`);
    console.error(`[food-like-route-honesty] report=${outputs.reportJsonPath}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
