#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";

import {
  createRuntimeContractReport,
  renderRuntimeContractMarkdown,
  writeRuntimeContractReport,
} from "./lib/runtime-contract-runner.mjs";
import {
  buildCuratedValidationPack,
  loadCuratedValidationConfig,
  loadCuratedValidationSourcePack,
} from "./lib/validation-governance.mjs";

const parseArgs = () => {
  const values = {
    configPath: "data/validation/runtime-result-page-contract.v0.json",
    outDir: "output/validation-runtime",
    apiBaseUrl:
      process.env.API_BASE_URL
      || process.env.SCIENCE_VALIDATION_API_BASE_URL
      || "http://127.0.0.1:3001",
    dryRun: false,
    printMarkdown: false,
    scenarioLimit: null,
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
    } else if (arg === "--api-base-url" && next) {
      values.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--scenario-limit" && next) {
      values.scenarioLimit = Number(next);
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
      total: curatedPack.summary.total,
      releaseBlocker: curatedPack.metadata.releaseBlocker,
      runner: curatedPack.metadata.runner,
      surfaces: curatedPack.summary.surfaces,
      categories: curatedPack.summary.categories,
    }, null, 2));
    return;
  }

  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
  const commonHeaders = regressionToken
    ? { "x-regression-token": regressionToken }
    : { "x-auth-disabled": "1" };

  const report = await createRuntimeContractReport({
    pack: curatedPack,
    apiBaseUrl: String(args.apiBaseUrl).replace(/\/$/, ""),
    scenarioLimit: args.scenarioLimit,
    commonHeaders,
  });
  const outputs = await writeRuntimeContractReport({
    report,
    outDir: args.outDir,
    outputBase: curatedPack.version,
  });

  if (args.printMarkdown) {
    console.log(renderRuntimeContractMarkdown(report));
  }

  console.error(`[runtime-contract] total=${report.summary.total} pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`);
  console.error(`[runtime-contract] wrote ${outputs.jsonPath}`);
  console.error(`[runtime-contract] wrote ${outputs.mdPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
