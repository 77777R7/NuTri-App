#!/usr/bin/env node
/* eslint-disable no-console */

import process from "node:process";
import path from "node:path";

import {
  buildCuratedValidationPack,
  loadCuratedValidationConfig,
  loadCuratedValidationSourcePack,
  loadStableGateBaseline,
  renderCuratedValidationMarkdown,
  writeCuratedValidationPack,
} from "./lib/validation-governance.mjs";
import {
  createRuntimeContractReport,
  renderRuntimeContractMarkdown,
  writeRuntimeContractReport,
} from "./lib/runtime-contract-runner.mjs";
import {
  createSearchReplayReport,
  renderSearchReplayMarkdown,
  waitForSearchReplayWarmReady,
  writeSearchReplayReport,
} from "./lib/search-replay-runner.mjs";
import { ROOT_DIR, writeJson, writeText } from "./lib/science-validation-reporting.mjs";

const DEFAULT_API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.SCIENCE_VALIDATION_API_BASE_URL ||
  "http://127.0.0.1:3001";

const DEFAULT_OUT_DIR = "output/quality-system-release";
const DEFAULT_SEARCH_PACK = "data/validation/golden-journey-pack.v1.json";
const DEFAULT_BASELINE_PATH = "data/validation/stable-gate-baseline.v1.json";
const DEFAULT_CURATED_BASELINE_CONFIG = "data/validation/live-replay-release-slice.v1.json";

const DEFAULT_RUNTIME_CONFIGS = [
  "data/validation/runtime-result-page-contract.v0.json",
  "data/validation/scan-smoke.v0.json",
  "data/validation/persona-blocker-pack.v0.json",
  "data/validation/consistency-pack.v0.json",
];

const parseArgs = () => {
  const values = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    baselinePath: DEFAULT_BASELINE_PATH,
    curatedBaselineConfigPath: DEFAULT_CURATED_BASELINE_CONFIG,
    searchPackPath: DEFAULT_SEARCH_PACK,
    dryRun: false,
    printMarkdown: false,
    skipSearchWarmWait: false,
    searchWarmTimeoutMs: 180_000,
    searchWarmPollMs: 5_000,
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--api-base-url" && next) {
      values.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--out-dir" && next) {
      values.outDir = next;
      index += 1;
    } else if (arg === "--baseline" && next) {
      values.baselinePath = next;
      index += 1;
    } else if (arg === "--curated-baseline-config" && next) {
      values.curatedBaselineConfigPath = next;
      index += 1;
    } else if (arg === "--search-pack" && next) {
      values.searchPackPath = next;
      index += 1;
    } else if (arg === "--search-warm-timeout-ms" && next) {
      values.searchWarmTimeoutMs = Number(next);
      index += 1;
    } else if (arg === "--search-warm-poll-ms" && next) {
      values.searchWarmPollMs = Number(next);
      index += 1;
    } else if (arg === "--skip-search-warm-wait") {
      values.skipSearchWarmWait = true;
    } else if (arg === "--dry-run") {
      values.dryRun = true;
    } else if (arg === "--print-markdown") {
      values.printMarkdown = true;
    }
  }
  return values;
};

const buildCommonHeaders = () => {
  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
  return regressionToken ? { "x-regression-token": regressionToken } : { "x-auth-disabled": "1" };
};

const summarizeRuntimeReport = (report, outputs, configPath) => ({
  id: report.packVersion,
  type: "runtime_contract",
  configPath,
  total: report.summary.total,
  pass: report.summary.pass,
  warn: report.summary.warn,
  fail: report.summary.fail,
  failedGates: report.summary.failedGates,
  warningGates: report.summary.warningGates,
  jsonPath: outputs.jsonPath,
  mdPath: outputs.mdPath,
});

const summarizeSearchReport = (report, outputs, packPath) => ({
  id: "search-golden-replay",
  type: "search_replay",
  configPath: packPath,
  total: report.summary.total,
  pass: report.summary.pass,
  warn: report.summary.warn,
  fail: report.summary.fail,
  failureBuckets: report.summary.failureBuckets,
  jsonPath: outputs.jsonPath,
  mdPath: outputs.mdPath,
});

const summarizeCuratedBaseline = (curatedPack, outputs, configPath) => ({
  id: curatedPack.version,
  type: "frozen_curated_baseline",
  configPath,
  total: curatedPack.summary.total,
  pass: curatedPack.summary.total,
  warn: 0,
  fail: 0,
  jsonPath: outputs.jsonPath,
  mdPath: outputs.mdPath,
});

const renderAggregateMarkdown = (summary) => {
  const lines = [];
  lines.push(`# Quality System Release Gates`);
  lines.push("");
  lines.push(`- generatedAt: ${summary.generatedAt}`);
  lines.push(`- apiBaseUrl: ${summary.apiBaseUrl}`);
  lines.push(`- baselineId: ${summary.baseline?.baselineId ?? "unknown"}`);
  lines.push(`- releaseVerdict: ${summary.releaseVerdict}`);
  lines.push("");
  lines.push(`## Frozen Baseline`);
  lines.push("");
  lines.push(`- sourcePackPath: ${summary.baseline?.sourcePackPath ?? "n/a"}`);
  for (const packPath of summary.baseline?.stablePackPaths ?? []) {
    lines.push(`- stablePack: ${packPath}`);
  }
  lines.push("");
  lines.push(`## Suites`);
  lines.push("");
  lines.push(`| Suite | Type | Total | Pass | Warn | Fail |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: |`);
  for (const suite of summary.suites) {
    lines.push(`| ${suite.id} | ${suite.type} | ${suite.total} | ${suite.pass} | ${suite.warn} | ${suite.fail} |`);
  }
  lines.push("");
  lines.push(`## Notes`);
  lines.push("");
  lines.push(`- Frozen curated baseline is materialized for PR/handoff evidence, not re-scored as a runtime blocker.`);
  lines.push(`- Runtime/search suites block this runner when any suite reports fail > 0.`);
  lines.push(`- Search replay uses warm-index polling unless --skip-search-warm-wait is passed.`);
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const args = parseArgs();
  const baseline = await loadStableGateBaseline(args.baselinePath);
  const commonHeaders = buildCommonHeaders();

  if (args.dryRun) {
    console.log(JSON.stringify({
      apiBaseUrl: args.apiBaseUrl,
      outDir: args.outDir,
      baselineId: baseline.baselineId,
      baselinePath: args.baselinePath,
      curatedBaselineConfigPath: args.curatedBaselineConfigPath,
      runtimeConfigs: DEFAULT_RUNTIME_CONFIGS,
      searchPackPath: args.searchPackPath,
    }, null, 2));
    return;
  }

  const suites = [];

  const curatedBaselineConfig = await loadCuratedValidationConfig(args.curatedBaselineConfigPath);
  const curatedBaselineSource = await loadCuratedValidationSourcePack(curatedBaselineConfig);
  const curatedBaselinePack = buildCuratedValidationPack({
    pack: curatedBaselineSource,
    config: curatedBaselineConfig,
  });
  const curatedBaselineOutputs = await writeCuratedValidationPack({
    curatedPack: curatedBaselinePack,
    outDir: path.join(args.outDir, "curated"),
    outputBase: curatedBaselinePack.version,
  });
  suites.push(summarizeCuratedBaseline(curatedBaselinePack, curatedBaselineOutputs, args.curatedBaselineConfigPath));

  for (const configPath of DEFAULT_RUNTIME_CONFIGS) {
    const config = await loadCuratedValidationConfig(configPath);
    const sourcePack = await loadCuratedValidationSourcePack(config);
    const runtimePack = buildCuratedValidationPack({ pack: sourcePack, config });
    const report = await createRuntimeContractReport({
      pack: runtimePack,
      apiBaseUrl: String(args.apiBaseUrl).replace(/\/+$/, ""),
      commonHeaders,
    });
    const outputs = await writeRuntimeContractReport({
      report,
      outDir: path.join(args.outDir, "runtime"),
      outputBase: runtimePack.version,
    });
    suites.push(summarizeRuntimeReport(report, outputs, configPath));
  }

  const searchPack = await loadCuratedValidationSourcePack({
    sourcePackPath: args.searchPackPath,
    additionalPackPaths: [],
  });
  let warmup = null;
  if (!args.skipSearchWarmWait) {
    warmup = await waitForSearchReplayWarmReady({
      pack: searchPack,
      apiBaseUrl: args.apiBaseUrl,
      timeoutMs: args.searchWarmTimeoutMs,
      pollIntervalMs: args.searchWarmPollMs,
    });
  }
  const searchReport = await createSearchReplayReport({
    pack: searchPack,
    apiBaseUrl: args.apiBaseUrl,
  });
  if (warmup) searchReport.warmup = warmup;
  const searchOutputs = await writeSearchReplayReport({
    report: searchReport,
    outDir: path.join(args.outDir, "search"),
  });
  suites.push(summarizeSearchReport(searchReport, searchOutputs, args.searchPackPath));

  const blockingSuites = suites.filter((suite) => suite.type !== "frozen_curated_baseline");
  const releaseVerdict = blockingSuites.some((suite) => suite.fail > 0) ? "block" : "pass";
  const summary = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: String(args.apiBaseUrl).replace(/\/+$/, ""),
    baseline,
    suites,
    releaseVerdict,
  };

  const reportJsonPath = path.join(args.outDir, "quality_system_release_report.json");
  const reportMdPath = path.join(args.outDir, "quality_system_release_report.md");
  await writeJson(reportJsonPath, summary);
  await writeText(reportMdPath, renderAggregateMarkdown(summary));

  if (args.printMarkdown) {
    console.log(renderAggregateMarkdown(summary));
  }

  console.error(`[quality-system-release] verdict=${releaseVerdict}`);
  console.error(`[quality-system-release] wrote ${reportJsonPath}`);
  console.error(`[quality-system-release] wrote ${reportMdPath}`);

  if (releaseVerdict !== "pass") {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
