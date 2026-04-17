#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";
import {
  createSearchReplayReport,
  renderSearchReplayMarkdown,
  waitForSearchReplayWarmReady,
  writeSearchReplayReport,
} from "./lib/search-replay-runner.mjs";
import { loadGoldenJourneyPack } from "./lib/cross-surface-quality-reporting.mjs";

const DEFAULT_API_BASE_URL =
  process.env.SEARCH_REPLAY_API_BASE_URL ||
  process.env.SEARCH_VALIDATION_API_BASE_URL ||
  process.env.SCIENCE_VALIDATION_API_BASE_URL ||
  "http://127.0.0.1:3000";

const parseArgs = () => {
  const values = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    packPath: "data/validation/golden-journey-pack.v0.json",
    outDir: "output/search-validation",
    limit: 20,
    scenarioLimit: null,
    dryRun: false,
    printMarkdown: false,
    waitForWarm: true,
    warmTimeoutMs: 180000,
    warmPollMs: 5000,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--api-base-url" && next) {
      values.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--pack" && next) {
      values.packPath = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      values.limit = Number(next);
      index += 1;
    } else if (arg === "--scenario-limit" && next) {
      values.scenarioLimit = Number(next);
      index += 1;
    } else if (arg === "--warm-timeout-ms" && next) {
      values.warmTimeoutMs = Number(next);
      index += 1;
    } else if (arg === "--warm-poll-ms" && next) {
      values.warmPollMs = Number(next);
      index += 1;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    } else if (arg === "--print-markdown") {
      values.printMarkdown = true;
    } else if (arg === "--no-warm-wait") {
      values.waitForWarm = false;
    }
  }
  return values;
};

const main = async () => {
  const args = parseArgs();
  const pack = await loadGoldenJourneyPack(args.packPath);
  const searchScenarioCount = pack.scenarios.filter((scenario) => scenario.surface === "search").length;
  if (args.dryRun) {
    console.log(JSON.stringify({
      apiBaseUrl: args.apiBaseUrl,
      packPath: args.packPath,
      searchScenarioCount,
      limit: args.limit,
      scenarioLimit: args.scenarioLimit,
      waitForWarm: args.waitForWarm,
      warmTimeoutMs: args.warmTimeoutMs,
      warmPollMs: args.warmPollMs,
    }, null, 2));
    return;
  }

  console.error(`[search-replay] api=${args.apiBaseUrl} scenarios=${searchScenarioCount}`);
  let warmup = null;
  if (args.waitForWarm) {
    warmup = await waitForSearchReplayWarmReady({
      pack,
      apiBaseUrl: args.apiBaseUrl,
      limit: args.limit,
      timeoutMs: args.warmTimeoutMs,
      pollIntervalMs: args.warmPollMs,
    });
    console.error(
      `[search-replay] warm-ready status=${warmup.status} attempts=${warmup.attempts} elapsedMs=${warmup.elapsedMs}`,
    );
  }
  const report = await createSearchReplayReport({
    pack,
    apiBaseUrl: args.apiBaseUrl,
    limit: args.limit,
    scenarioLimit: args.scenarioLimit,
  });
  if (warmup) {
    report.warmup = warmup;
  }
  const outputs = await writeSearchReplayReport({
    report,
    outDir: args.outDir,
  });

  if (args.printMarkdown) {
    console.log(renderSearchReplayMarkdown(report));
  }

  console.error(`[search-replay] pass=${report.summary.pass}/${report.summary.total} fail=${report.summary.fail}`);
  console.error(`[search-replay] wrote ${outputs.jsonPath}`);
  console.error(`[search-replay] wrote ${outputs.mdPath}`);

  if (report.summary.fail > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
