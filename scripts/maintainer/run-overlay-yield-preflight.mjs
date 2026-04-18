#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

import dotenv from "dotenv";

import {
  buildOverlayYieldPreflightReport,
  discoverOfficialWaveRunDirs,
  writeOverlayYieldPreflightOutputs,
} from "./lib/overlay-yield-preflight.mjs";
import {
  findLatestApiFillQueueDir,
  readOfficialWaveYieldAdmission,
} from "./lib/full-db-api-fill-official-waves.mjs";
import { resolveDefaultScraplingPythonBin } from "./lib/scrapling-fetcher.mjs";
import { ROOT_DIR } from "./lib/science-validation-reporting.mjs";

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: false });

const parseArgs = () => {
  const values = {
    queueJsonPath: null,
    outDir: null,
    runDirs: null,
    autoRunDirs: true,
    samplePerBrand: 3,
    maxBrands: 40,
    checkTools: true,
    scraplingPythonBin: process.env.SCRAPLING_PYTHON_BIN || null,
    zeroYieldRegistryPath: path.join("data", "validation", "official-yield-first-zero-yield-brands.v0.json"),
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
    } else if (arg === "--run-dirs" && next) {
      values.runDirs = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--no-auto-run-dirs") {
      values.autoRunDirs = false;
    } else if (arg === "--sample-per-brand" && next) {
      values.samplePerBrand = Math.max(1, Number(next) || 3);
      index += 1;
    } else if (arg === "--max-brands" && next) {
      values.maxBrands = Math.max(1, Number(next) || 40);
      index += 1;
    } else if (arg === "--skip-tool-check") {
      values.checkTools = false;
    } else if (arg === "--scrapling-python-bin" && next) {
      values.scraplingPythonBin = next;
      index += 1;
    } else if (arg === "--zero-yield-registry" && next) {
      values.zeroYieldRegistryPath = next === "none" ? null : next;
      index += 1;
    } else if (arg === "--print-json") {
      values.printJson = true;
    }
  }
  return values;
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const parseVersion = (value) =>
  String(value ?? "")
    .trim()
    .split(".")
    .map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);

const versionAtLeast = (actual, expected) => {
  const left = parseVersion(actual);
  const right = parseVersion(expected);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
};

const runCapture = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf8",
    timeout: options.timeoutMs ?? 10_000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim(),
    error: result.error ? String(result.error.message ?? result.error) : null,
  };
};

const detectScraplingReadiness = ({ scraplingPythonBin }) => {
  const pythonBin = scraplingPythonBin || resolveDefaultScraplingPythonBin({ root: ROOT_DIR });
  const result = runCapture(pythonBin, [
    "-c",
    "import scrapling; print(getattr(scrapling, '__version__', 'unknown'))",
  ]);
  const version = result.ok ? result.stdout.split(/\s+/)[0] : null;
  return {
    pythonBin,
    importOk: result.ok,
    version,
    ready047: Boolean(version && versionAtLeast(version, "0.4.7")),
    setupHint: result.ok && !versionAtLeast(version, "0.4.7")
      ? "Install a sidecar venv with scrapling[all]>=0.4.7 and pass --scrapling-python-bin."
      : null,
    error: result.ok ? null : result.error || result.stderr || "scrapling_import_failed",
  };
};

const detectAgentBrowserReadiness = () => {
  const direct = runCapture("agent-browser", ["--version"], { timeoutMs: 5_000 });
  if (direct.ok) {
    return {
      available: true,
      invocation: "agent-browser",
      version: direct.stdout || null,
    };
  }
  const npx = runCapture("npx", ["--yes", "agent-browser", "--version"], { timeoutMs: 20_000 });
  return {
    available: npx.ok,
    invocation: npx.ok ? "npx --yes agent-browser" : null,
    version: npx.ok ? npx.stdout || null : null,
    error: npx.ok ? null : npx.error || npx.stderr || direct.error || direct.stderr || "agent_browser_unavailable",
  };
};

const detectToolReadiness = ({ checkTools, scraplingPythonBin }) => {
  const rapidApiEnvNames = ["IHERB_RAPIDAPI_KEY", "RAPIDAPI_KEY", "X_RAPIDAPI_KEY", "RAPID_API_KEY"];
  const rapidApiKeyNamesPresent = rapidApiEnvNames.filter((name) => Boolean(process.env[name]));
  return {
    rapidapi: {
      keyPresent: rapidApiKeyNamesPresent.length > 0,
      keyEnvNamesPresent: rapidApiKeyNamesPresent,
    },
    scrapling: checkTools
      ? detectScraplingReadiness({ scraplingPythonBin })
      : { importOk: null, version: null, ready047: false, skipped: true },
    agentBrowser: checkTools
      ? detectAgentBrowserReadiness()
      : { available: null, skipped: true },
  };
};

const main = async () => {
  const args = parseArgs();
  const latestQueueDir = args.queueJsonPath ? null : await findLatestApiFillQueueDir();
  const queueJsonPath = args.queueJsonPath
    ? path.resolve(ROOT_DIR, args.queueJsonPath)
    : path.join(latestQueueDir, "api_fill_queue.all.json");
  const queueDir = path.dirname(queueJsonPath);
  const outDir = args.outDir
    ? path.resolve(ROOT_DIR, args.outDir)
    : path.join(queueDir, `overlay_yield_preflight_${Date.now()}`);
  const relativeOutDir = path.relative(ROOT_DIR, outDir);

  const queueRows = await readJson(queueJsonPath);
  const knownZeroYieldBrands = args.zeroYieldRegistryPath
    ? await readJson(path.resolve(ROOT_DIR, args.zeroYieldRegistryPath)).catch(() => null)
    : null;
  const autoRunDirs = args.autoRunDirs ? await discoverOfficialWaveRunDirs({ queueDir }) : [];
  const runDirs = args.runDirs ?? autoRunDirs;
  const admission = runDirs.length > 0
    ? await readOfficialWaveYieldAdmission({ runDirs, rootDir: ROOT_DIR })
    : null;
  const toolReadiness = detectToolReadiness({
    checkTools: args.checkTools,
    scraplingPythonBin: args.scraplingPythonBin,
  });

  const report = buildOverlayYieldPreflightReport({
    queueRows,
    admission,
    knownZeroYieldBrands,
    toolReadiness,
    samplePerBrand: args.samplePerBrand,
    maxBrands: args.maxBrands,
    outputRoot: relativeOutDir,
  });
  report.inputs.queueJsonPath = path.relative(ROOT_DIR, queueJsonPath);
  report.inputs.runDirs = runDirs;
  report.inputs.autoRunDirs = args.autoRunDirs;
  report.inputs.zeroYieldRegistryPath = args.zeroYieldRegistryPath;

  const outputs = await writeOverlayYieldPreflightOutputs({
    report,
    outDir: relativeOutDir,
  });

  const response = {
    ok: true,
    outputs: {
      outputDir: path.relative(ROOT_DIR, outputs.outputDir),
      reportJsonPath: path.relative(ROOT_DIR, outputs.reportJsonPath),
      reportMdPath: path.relative(ROOT_DIR, outputs.reportMdPath),
    },
    summary: report.summary,
    toolReadiness: report.toolReadiness,
  };

  if (args.printJson) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    console.error(`[overlay-yield-preflight] queue=${path.relative(ROOT_DIR, queueJsonPath)}`);
    console.error(`[overlay-yield-preflight] runDirs=${runDirs.length}`);
    console.error(`[overlay-yield-preflight] brands=${report.summary.brands}`);
    console.error(`[overlay-yield-preflight] admitted=${report.summary.admittedBrands}`);
    console.error(`[overlay-yield-preflight] pendingPreflight=${report.summary.pendingPreflightBrands}`);
    console.error(`[overlay-yield-preflight] setupRequired=${report.summary.setupRequiredBrands}`);
    console.error(`[overlay-yield-preflight] blocked=${report.summary.blockedBrands}`);
    console.error(`[overlay-yield-preflight] discoveryOnly=${report.summary.discoveryOnlyBrands}`);
    console.error(`[overlay-yield-preflight] wrote ${response.outputs.reportJsonPath}`);
    console.error(`[overlay-yield-preflight] wrote ${response.outputs.reportMdPath}`);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
