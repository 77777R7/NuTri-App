#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const LANE_A_BRANDS = [
  "Carlson",
  "MRM Nutrition",
  "Nutricost",
  "Garden of Life",
  "Solgar",
  "Doctor's Best",
];

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const normalizeText = (value) => (value == null ? "" : String(value).trim());
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, "-");
const toArray = (value) => (Array.isArray(value) ? value : []);
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const MANIFEST_DIR = path.resolve(
  ROOT,
  getArg("manifest-dir", path.join("output", "scrapling_wave_manifest_stop-fix-v11")),
);
const LANE_CONFIGS_DIR = path.join(MANIFEST_DIR, "lane_configs");
const EXISTING_RUNS_DIR = path.resolve(
  ROOT,
  getArg("existing-runs-dir", path.join("output", "scrapling_bulk_program_runs")),
);
const STAGING_PATH_DEFAULT = path.resolve(
  ROOT,
  getArg(
    "staging-json",
    path.join(
      "output",
      "p0_p3_codeage_remaining_six_closure_20260317",
      "unified_wave",
      "staging_products.official_refreshed.sanitized.json",
    ),
  ),
);
const EXECUTE = normalizeLower(getArg("execute", "false")) === "true";
const FORCE_RERUN_ALL = normalizeLower(getArg("force-rerun-all", "false")) === "true";
const OUT_DIR = path.resolve(
  ROOT,
  getArg("out-dir", path.join("output", `lane_a_soft_field_closeout_${timestampSlug()}`)),
);
const LOGS_DIR = path.join(OUT_DIR, "logs");

const spawnAndCapture = async ({ command, commandArgs, logPath }) =>
  new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", async (code) => {
      const body = [
        `$ ${[command, ...commandArgs].join(" ")}`,
        "",
        "## stdout",
        stdout || "(empty)",
        "",
        "## stderr",
        stderr || "(empty)",
        "",
        `exitCode: ${code}`,
        "",
      ].join("\n");
      await writeText(logPath, body);
      resolve({ code, stdout, stderr, logPath });
    });
  });

const waveIdToBrand = (waveId) => {
  const normalized = normalizeText(waveId).toLowerCase();
  return LANE_A_BRANDS.find((brand) => normalized.startsWith(brand.toLowerCase().replace(/'/g, "").replace(/\s+/g, "-")));
};

const summarizeMergeReport = (report) => {
  const rows = toArray(report?.rows).filter((row) => row?.outcome !== "staging_row_not_found");
  const remainSoftRows = rows.filter((row) =>
    toArray(row?.afterMissingFields).some((field) => field === "suggested_use" || field === "warnings"),
  );
  return {
    processedRows: Number(report?.summary?.processed ?? rows.length),
    improvedRows: Number(report?.summary?.improvedRows ?? 0),
    becameFullOverlayReady: Number(report?.summary?.becameFullOverlayReady ?? 0),
    filledSuggestedUse: Number(report?.summary?.filledSuggestedUse ?? 0),
    filledWarnings: Number(report?.summary?.filledWarnings ?? 0),
    remainSoftRows: remainSoftRows.length,
    staticGatesPass: Boolean(report?.productSurfaceValidation?.staticGatesPass),
  };
};

const buildMarkdownSummary = (summary) => {
  const lines = [
    "# Lane A Soft-Field Closeout",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- manifestDir: ${summary.inputs.manifestDir}`,
    `- execute: ${summary.inputs.execute}`,
    `- forceRerunAll: ${summary.inputs.forceRerunAll}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of summary.brands) {
    lines.push(`### ${brand.brandName}`);
    lines.push(`- existing_processed_rows: ${brand.existing.processedRows}`);
    lines.push(`- existing_remain_soft_rows: ${brand.existing.remainSoftRows}`);
    lines.push(`- rerun_performed: ${brand.rerun.performed}`);
    if (brand.rerun.performed) {
      lines.push(`- rerun_processed_rows: ${brand.rerun.processedRows}`);
      lines.push(`- rerun_remain_soft_rows: ${brand.rerun.remainSoftRows}`);
    }
    lines.push(`- final_processed_rows: ${brand.final.processedRows}`);
    lines.push(`- final_remain_soft_rows: ${brand.final.remainSoftRows}`);
    lines.push(`- final_filled_suggested_use: ${brand.final.filledSuggestedUse}`);
    lines.push(`- final_filled_warnings: ${brand.final.filledWarnings}`);
    lines.push(`- final_became_full_overlay_ready: ${brand.final.becameFullOverlayReady}`);
    lines.push(`- static_gates_pass: ${brand.final.staticGatesPass}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(LOGS_DIR, { recursive: true });

  const laneConfigFiles = (await fs.readdir(LANE_CONFIGS_DIR))
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(LANE_CONFIGS_DIR, name));

  const brandWaveConfigs = new Map(LANE_A_BRANDS.map((brand) => [brand, []]));
  for (const configPath of laneConfigFiles) {
    const config = await readJson(configPath);
    const brandName = normalizeText(config?.brandFilter ?? null);
    if (!brandWaveConfigs.has(brandName)) continue;
    const waveId = path.basename(configPath, ".json");
    brandWaveConfigs.get(brandName).push({
      waveId,
      configPath,
      config,
      existingRunDir: path.join(EXISTING_RUNS_DIR, waveId),
    });
  }

  for (const waves of brandWaveConfigs.values()) {
    waves.sort((left, right) => left.waveId.localeCompare(right.waveId));
  }

  const summaryBrands = [];

  for (const brandName of LANE_A_BRANDS) {
    const waves = brandWaveConfigs.get(brandName) ?? [];
    let existingProcessedRows = 0;
    let existingImprovedRows = 0;
    let existingBecameFullOverlayReady = 0;
    let existingFilledSuggestedUse = 0;
    let existingFilledWarnings = 0;
    let existingRemainSoftRows = 0;
    let existingStaticGatesPass = true;

    for (const wave of waves) {
      const reportPath = path.join(wave.existingRunDir, "merge_validation", "scrapling_merge_validation_report.json");
      if (!(await fileExists(reportPath))) continue;
      const report = await readJson(reportPath);
      const waveSummary = summarizeMergeReport(report);
      existingProcessedRows += waveSummary.processedRows;
      existingImprovedRows += waveSummary.improvedRows;
      existingBecameFullOverlayReady += waveSummary.becameFullOverlayReady;
      existingFilledSuggestedUse += waveSummary.filledSuggestedUse;
      existingFilledWarnings += waveSummary.filledWarnings;
      existingRemainSoftRows += waveSummary.remainSoftRows;
      existingStaticGatesPass = existingStaticGatesPass && waveSummary.staticGatesPass;
    }

    const shouldRerun = EXECUTE && (FORCE_RERUN_ALL || existingRemainSoftRows > 0);
    let rerunProcessedRows = 0;
    let rerunImprovedRows = 0;
    let rerunBecameFullOverlayReady = 0;
    let rerunFilledSuggestedUse = 0;
    let rerunFilledWarnings = 0;
    let rerunRemainSoftRows = 0;
    let rerunStaticGatesPass = true;
    const rerunWaveResults = [];

    if (shouldRerun) {
      for (const wave of waves) {
        const rerunWaveDir = path.join(OUT_DIR, "runs", wave.waveId);
        const rerunReportPath = path.join(rerunWaveDir, "scrapling_official_fallback_report.json");
        const validationOutDir = path.join(rerunWaveDir, "merge_validation");
        const validationReportPath = path.join(validationOutDir, "scrapling_merge_validation_report.json");
        const waveLogPath = path.join(LOGS_DIR, `${wave.waveId}.wave.log`);
        const validationLogPath = path.join(LOGS_DIR, `${wave.waveId}.validation.log`);
        const waveResult = {
          waveId: wave.waveId,
          waveRun: null,
          validationRun: null,
          summary: null,
        };

        if (await fileExists(validationReportPath)) {
          const validationReport = await readJson(validationReportPath);
          const waveSummary = summarizeMergeReport(validationReport);
          waveResult.summary = waveSummary;
          waveResult.waveRun = {
            code: 0,
            command: "(reused existing rerun wave output)",
            logPath: (await fileExists(waveLogPath)) ? path.relative(ROOT, waveLogPath) : null,
          };
          waveResult.validationRun = {
            code: 0,
            command: "(reused existing rerun validation output)",
            logPath: (await fileExists(validationLogPath)) ? path.relative(ROOT, validationLogPath) : null,
          };
          rerunProcessedRows += waveSummary.processedRows;
          rerunImprovedRows += waveSummary.improvedRows;
          rerunBecameFullOverlayReady += waveSummary.becameFullOverlayReady;
          rerunFilledSuggestedUse += waveSummary.filledSuggestedUse;
          rerunFilledWarnings += waveSummary.filledWarnings;
          rerunRemainSoftRows += waveSummary.remainSoftRows;
          rerunStaticGatesPass = rerunStaticGatesPass && waveSummary.staticGatesPass;
          rerunWaveResults.push(waveResult);
          continue;
        }

        const waveCommandArgs = [
          path.join(ROOT, "scripts", "maintainer", "run-scrapling-official-fallback-wave.mjs"),
          "--config-json",
          wave.configPath,
          "--out-dir",
          rerunWaveDir,
          "--execute",
          "true",
        ];
        const waveRun = await spawnAndCapture({
          command: process.execPath,
          commandArgs: waveCommandArgs,
          logPath: waveLogPath,
        });
        waveResult.waveRun = {
          code: waveRun.code,
          command: [process.execPath, ...waveCommandArgs].join(" "),
          logPath: path.relative(ROOT, waveLogPath),
        };
        if (waveRun.code !== 0) {
          rerunWaveResults.push(waveResult);
          continue;
        }

        const validationCommandArgs = [
          path.join(ROOT, "scripts", "maintainer", "apply-scrapling-canary-merge-and-validate.mjs"),
          "--report-json",
          rerunReportPath,
          "--staging-json",
          wave.config?.stagingPath ? path.resolve(ROOT, wave.config.stagingPath) : STAGING_PATH_DEFAULT,
          "--out-dir",
          validationOutDir,
          "--skip-merged-staging",
          "true",
        ];
        const validationRun = await spawnAndCapture({
          command: process.execPath,
          commandArgs: validationCommandArgs,
          logPath: validationLogPath,
        });
        waveResult.validationRun = {
          code: validationRun.code,
          command: [process.execPath, ...validationCommandArgs].join(" "),
          logPath: path.relative(ROOT, validationLogPath),
        };
        if (validationRun.code === 0) {
          const validationReportPath = path.join(validationOutDir, "scrapling_merge_validation_report.json");
          const validationReport = await readJson(validationReportPath);
          const waveSummary = summarizeMergeReport(validationReport);
          waveResult.summary = waveSummary;
          rerunProcessedRows += waveSummary.processedRows;
          rerunImprovedRows += waveSummary.improvedRows;
          rerunBecameFullOverlayReady += waveSummary.becameFullOverlayReady;
          rerunFilledSuggestedUse += waveSummary.filledSuggestedUse;
          rerunFilledWarnings += waveSummary.filledWarnings;
          rerunRemainSoftRows += waveSummary.remainSoftRows;
          rerunStaticGatesPass = rerunStaticGatesPass && waveSummary.staticGatesPass;
        }
        rerunWaveResults.push(waveResult);
      }
    }

    const finalSummary = shouldRerun
      ? {
          processedRows: rerunProcessedRows,
          improvedRows: rerunImprovedRows,
          becameFullOverlayReady: rerunBecameFullOverlayReady,
          filledSuggestedUse: rerunFilledSuggestedUse,
          filledWarnings: rerunFilledWarnings,
          remainSoftRows: rerunRemainSoftRows,
          staticGatesPass: rerunStaticGatesPass,
        }
      : {
          processedRows: existingProcessedRows,
          improvedRows: existingImprovedRows,
          becameFullOverlayReady: existingBecameFullOverlayReady,
          filledSuggestedUse: existingFilledSuggestedUse,
          filledWarnings: existingFilledWarnings,
          remainSoftRows: existingRemainSoftRows,
          staticGatesPass: existingStaticGatesPass,
        };

    summaryBrands.push({
      brandName,
      waveCount: waves.length,
      existing: {
        processedRows: existingProcessedRows,
        improvedRows: existingImprovedRows,
        becameFullOverlayReady: existingBecameFullOverlayReady,
        filledSuggestedUse: existingFilledSuggestedUse,
        filledWarnings: existingFilledWarnings,
        remainSoftRows: existingRemainSoftRows,
        staticGatesPass: existingStaticGatesPass,
      },
      rerun: {
        performed: shouldRerun,
        processedRows: rerunProcessedRows,
        improvedRows: rerunImprovedRows,
        becameFullOverlayReady: rerunBecameFullOverlayReady,
        filledSuggestedUse: rerunFilledSuggestedUse,
        filledWarnings: rerunFilledWarnings,
        remainSoftRows: rerunRemainSoftRows,
        staticGatesPass: rerunStaticGatesPass,
        waves: rerunWaveResults,
      },
      final: finalSummary,
    });
  }

  const summary = {
    schemaVersion: "lane_a_soft_field_closeout.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      manifestDir: path.relative(ROOT, MANIFEST_DIR),
      laneConfigsDir: path.relative(ROOT, LANE_CONFIGS_DIR),
      existingRunsDir: path.relative(ROOT, EXISTING_RUNS_DIR),
      execute: EXECUTE,
      forceRerunAll: FORCE_RERUN_ALL,
      outDir: path.relative(ROOT, OUT_DIR),
    },
    brands: summaryBrands,
  };

  await writeJson(path.join(OUT_DIR, "lane_a_soft_field_closeout_summary.json"), summary);
  await writeText(path.join(OUT_DIR, "lane_a_soft_field_closeout_summary.md"), buildMarkdownSummary(summary));
  console.log(
    `Wrote Lane A soft-field closeout summary to ${path.join(OUT_DIR, "lane_a_soft_field_closeout_summary.json")}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
