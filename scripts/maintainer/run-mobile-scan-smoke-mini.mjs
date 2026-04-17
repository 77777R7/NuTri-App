#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import {
  evaluateMobileScanSmokeSummary,
  loadMobileScanSmokeConfig,
  validateMobileScanSmokeConfig,
  writeMobileScanSmokeReport,
} from "./lib/mobile-scan-smoke-mini.mjs";

const ROOT_DIR = process.cwd();

const parseArgs = () => {
  const values = {
    configPath: "data/validation/mobile-scan-smoke-mini.v0.json",
    outDir: "output/mobile-scan-smoke-mini",
    apiBaseUrl: process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001",
    enforce: false,
    dryRun: false,
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
    } else if (arg === "--enforce") {
      values.enforce = true;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    }
  }
  return values;
};

const main = async () => {
  const args = parseArgs();
  const config = await loadMobileScanSmokeConfig(args.configPath);
  const validationErrors = validateMobileScanSmokeConfig(config);
  if (validationErrors.length > 0) {
    throw new Error(`invalid mobile scan smoke config: ${JSON.stringify(validationErrors)}`);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      configPath: args.configPath,
      version: config.version,
      barcodes: config.barcodes.length,
      releaseBlocker: config.releaseBlocker,
      outDir: args.outDir,
      apiBaseUrl: args.apiBaseUrl,
    }, null, 2));
    return;
  }

  const resolvedOutDir = path.isAbsolute(args.outDir) ? args.outDir : path.join(ROOT_DIR, args.outDir);
  const runDir = path.join(resolvedOutDir, "runner");
  await fs.mkdir(runDir, { recursive: true });

  const barcodesPath = path.join(runDir, "barcodes.json");
  await fs.writeFile(barcodesPath, `${JSON.stringify({ barcodes: config.barcodes }, null, 2)}\n`, "utf8");

  const runProfile = config.runProfile ?? {};
  const runArgs = [
    path.join("scripts", "maintainer", "mobile-soak-run.mjs"),
    "--out-dir", runDir,
    "--barcodes-json", barcodesPath,
    "--api-base-url", String(args.apiBaseUrl).replace(/\/+$/, ""),
    "--serial-rounds", String(runProfile.serialRounds ?? 1),
    "--killer-cold-runs", String(runProfile.killerColdRuns ?? 0),
    "--killer-hot-runs", String(runProfile.killerHotRuns ?? 0),
    "--timeout-ms", String(runProfile.timeoutMs ?? 15000),
    "--view-mode", String(runProfile.viewMode ?? "details"),
  ];
  if (runProfile.noOpenResultScreen !== false) {
    runArgs.push("--no-open-result-screen");
  }

  const child = spawnSync(process.execPath, runArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    env: process.env,
  });

  if (child.status !== 0) {
    throw new Error(
      `mobile-soak-run failed with status ${child.status}: ${child.stderr?.trim() || child.stdout?.trim() || "unknown error"}`,
    );
  }

  const summaryPath = path.join(runDir, "rounds_summary.json");
  const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
  summary.summaryPath = summaryPath;
  const report = evaluateMobileScanSmokeSummary({ config, summary });
  const outputs = await writeMobileScanSmokeReport({
    report,
    outDir: resolvedOutDir,
  });

  console.error(`[mobile-scan-smoke-mini] pass=${report.summary.pass}/${report.summary.total} fail=${report.summary.fail}`);
  console.error(`[mobile-scan-smoke-mini] wrote ${outputs.jsonPath}`);
  console.error(`[mobile-scan-smoke-mini] wrote ${outputs.mdPath}`);

  if (args.enforce && report.summary.fail > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
