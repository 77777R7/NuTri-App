#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, "-");
const normalizeText = (value) => (value == null ? "" : String(value).trim());
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const toArray = (value) => (Array.isArray(value) ? value : []);
const VALID_STATUSES = new Set(["GO", "HOLD", "STOP"]);
const VALID_EXECUTION_MODES = new Set(["sequential", "brand-by-brand"]);

const MANIFEST_PATH = getArg(
  "manifest-json",
  path.join(ROOT, "output", "scrapling_wave_manifest_20260320", "scrapling_wave_manifest.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `scrapling_bulk_program_${timestampSlug()}`),
);
const REGISTRY_PATH = getArg(
  "registry-json",
  path.join(
    ROOT,
    "docs",
    "exec-plans",
    "active",
    "p0_p3_product_closure",
    "scrapling_lane_registry.v1.json",
  ),
);
const EXECUTION_MODE = (() => {
  const value = normalizeLower(getArg("execution-mode", "brand-by-brand"));
  if (!VALID_EXECUTION_MODES.has(value)) {
    throw new Error(`Unsupported execution mode: ${value}`);
  }
  return value;
})();
const EXECUTE = normalizeLower(getArg("execute", "true")) === "true";
const CONTINUE_ON_WAVE_ERROR = normalizeLower(getArg("continue-on-wave-error", "true")) === "true";
const SKIP_MERGED_STAGING = normalizeLower(getArg("skip-merged-staging", "true")) === "true";
const CONCURRENCY = Math.max(1, Number.parseInt(getArg("concurrency", "1"), 10) || 1);
const STATUS_OVERRIDES_PATH = getArg("lane-status-overrides-json", null);

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
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

const normalizeStatus = (value, fallback = "GO") => {
  const normalized = normalizeText(value).toUpperCase();
  if (VALID_STATUSES.has(normalized)) return normalized;
  return fallback;
};

const loadRegistry = async () => {
  const payload = await readJson(REGISTRY_PATH);
  const defaults = {
    status: normalizeStatus(payload?.defaults?.status, "GO"),
    reason: normalizeText(payload?.defaults?.reason ?? ""),
  };
  const brands = {};
  const lanes = {};
  for (const entry of toArray(payload?.laneStatuses)) {
    const brandName = normalizeText(entry?.brandName);
    if (!brandName) continue;
    const sourceBucket = normalizeText(entry?.sourceBucket);
    const normalized = {
      status: normalizeStatus(entry?.status, defaults.status),
      reason: normalizeText(entry?.reason ?? ""),
    };
    if (sourceBucket) {
      lanes[brandLaneKey(brandName, { sourceBucket })] = normalized;
    } else {
      brands[brandName] = normalized;
    }
  }
  return { defaults, brands, lanes };
};

const loadOverrides = async () => {
  if (!STATUS_OVERRIDES_PATH) {
    return {
      brands: {},
      lanes: {},
      waves: {},
    };
  }
  const payload = await readJson(STATUS_OVERRIDES_PATH);
  return {
    brands: payload?.brands ?? {},
    lanes: payload?.lanes ?? {},
    waves: payload?.waves ?? {},
  };
};

const brandLaneKey = (brandName, lane) => `${normalizeText(brandName)}::${normalizeText(lane?.sourceBucket)}`;

const pickStatus = (...values) => {
  for (const value of values) {
    const normalized = normalizeText(value).toUpperCase();
    if (VALID_STATUSES.has(normalized)) return normalized;
  }
  return "GO";
};

const buildExecutionPlan = (manifest, registry, overrides) => {
  const rootStatus = pickStatus(
    manifest?.status,
    manifest?.defaultStatus,
    registry?.defaults?.status,
    "GO",
  );
  const brands = [];

  for (const brand of toArray(manifest?.brands)) {
    const brandName = normalizeText(brand?.brandName);
    const brandStatus = pickStatus(
      overrides.brands?.[brandName],
      registry.brands?.[brandName]?.status,
      brand?.status,
      brand?.brandStatus,
      rootStatus,
    );
    const lanes = [];

    for (const lane of toArray(brand?.lanes)) {
      const laneKey = brandLaneKey(brandName, lane);
      const laneStatus = pickStatus(
        overrides.lanes?.[laneKey],
        registry.lanes?.[laneKey]?.status,
        lane?.status,
        lane?.laneStatus,
        brandStatus,
      );
      const waves = toArray(lane?.waves).map((wave) => {
        const waveStatus = pickStatus(
          overrides.waves?.[normalizeText(wave?.waveId)],
          wave?.status,
          wave?.waveStatus,
          laneStatus,
        );
        return {
          ...wave,
          effectiveStatus: waveStatus,
        };
      });

      lanes.push({
        ...lane,
        effectiveStatus: laneStatus,
        waves,
      });
    }

    brands.push({
      ...brand,
      effectiveStatus: brandStatus,
      lanes,
    });
  }

  return {
    ...manifest,
    effectiveStatus: rootStatus,
    brands,
  };
};

const flattenWaves = (manifest) =>
  toArray(manifest?.brands).flatMap((brand) =>
    toArray(brand?.lanes).flatMap((lane) =>
      toArray(lane?.waves).map((wave) => ({
        brandName: brand.brandName,
        brandStatus: brand.effectiveStatus,
        laneKey: lane.sourceBucket,
        laneStatus: lane.effectiveStatus,
        sourcePreference: lane.sourcePreference,
        wave,
      })),
    ),
  );

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

const mapWithConcurrency = async (items, concurrency, task) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  let abortError = null;

  const worker = async () => {
    while (abortError == null) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      try {
        results[currentIndex] = await task(items[currentIndex], currentIndex);
      } catch (error) {
        abortError = error;
        return;
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (abortError) throw abortError;
  return results;
};

const countBy = (items, field) =>
  items.reduce((acc, item) => {
    const key = normalizeText(item?.[field] ?? "unknown") || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const summarizeWaveReport = (report) => {
  const results = toArray(report?.results);
  return {
    selectedCount: Number(report?.selectedCount ?? 0),
    outcomeCounts: countBy(results, "outcome"),
    candidateBuiltCount: results.filter((row) => row?.outcome === "scrapling_candidate_built").length,
  };
};

const summarizeValidationReport = (report) => ({
  processed: Number(report?.summary?.processed ?? 0),
  improvedRows: Number(report?.summary?.improvedRows ?? 0),
  becameFullOverlayReady: Number(report?.summary?.becameFullOverlayReady ?? 0),
  filledIngredient: Number(report?.summary?.filledIngredient ?? 0),
  filledDosage: Number(report?.summary?.filledDosage ?? 0),
  filledSuggestedUse: Number(report?.summary?.filledSuggestedUse ?? 0),
  filledWarnings: Number(report?.summary?.filledWarnings ?? 0),
  filledProductImage: Number(report?.summary?.filledProductImage ?? 0),
  staticGatesPass: Boolean(report?.productSurfaceValidation?.staticGatesPass),
});

const buildMarkdownSummary = (summary) => {
  const lines = [
    "# Scrapling Bulk Program Summary",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- manifestPath: ${summary.inputs.manifestPath}`,
    `- executionMode: ${summary.inputs.executionMode}`,
    `- execute: ${summary.inputs.execute}`,
    `- continueOnWaveError: ${summary.inputs.continueOnWaveError}`,
    `- skipMergedStaging: ${summary.inputs.skipMergedStaging}`,
    `- programState: ${summary.programState}`,
    "",
    "## Totals",
    "",
    `- brands: ${summary.summary.brandCount}`,
    `- lanes: ${summary.summary.laneCount}`,
    `- waves: ${summary.summary.waveCount}`,
    `- executed_waves: ${summary.summary.executedWaveCount}`,
    `- held_waves: ${summary.summary.heldWaveCount}`,
    `- stopped_waves: ${summary.summary.stoppedWaveCount}`,
    `- failed_waves: ${summary.summary.failedWaveCount}`,
    `- improved_rows: ${summary.summary.improvedRows}`,
    `- became_full_overlay_ready: ${summary.summary.becameFullOverlayReady}`,
    "",
    "## Brands",
    "",
    ...summary.brands.flatMap((brand) => [
      `### ${brand.brandName} (${brand.effectiveStatus})`,
      ...brand.lanes.flatMap((lane) => [
        `- lane ${lane.sourceBucket}: status=${lane.effectiveStatus} sourcePreference=${lane.sourcePreference} waves=${lane.waveCount}`,
        ...lane.waves.map(
          (wave) =>
            `  - ${wave.waveId}: state=${wave.state} status=${wave.effectiveStatus} improvedRows=${wave.validation?.improvedRows ?? 0} becameFullOverlayReady=${wave.validation?.becameFullOverlayReady ?? 0}`,
        ),
      ]),
      "",
    ]),
  ];
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [manifest, registry, overrides] = await Promise.all([readJson(MANIFEST_PATH), loadRegistry(), loadOverrides()]);
  const executionManifest = buildExecutionPlan(manifest, registry, overrides);
  const orderedWaves = flattenWaves(executionManifest);
  const logsDir = path.resolve(ROOT, OUT_DIR, "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const results = [];

  const executionList =
    EXECUTION_MODE === "sequential"
      ? orderedWaves
      : toArray(executionManifest?.brands).flatMap((brand) =>
          toArray(brand?.lanes).flatMap((lane) =>
            toArray(lane?.waves).map((wave) => ({
              brandName: brand.brandName,
              brandStatus: brand.effectiveStatus,
              laneKey: lane.sourceBucket,
              laneStatus: lane.effectiveStatus,
              sourcePreference: lane.sourcePreference,
              wave,
            })),
          ),
        );

  const processExecutionItem = async (item) => {
    const wave = item.wave;
    const waveId = normalizeText(wave?.waveId);
    const effectiveStatus = normalizeStatus(wave?.effectiveStatus ?? item.laneStatus ?? item.brandStatus, "GO");
    const configPath = path.resolve(ROOT, wave?.configPath ?? "");
    const waveConfig = await readJson(configPath);
    const waveOutDir = path.resolve(ROOT, waveConfig?.outDir ?? path.join("output", "scrapling_bulk_program_runs", waveId));
    const validationOutDir = path.join(waveOutDir, "merge_validation");
    const waveLogPath = path.join(logsDir, `${waveId}.wave.log`);
    const validationLogPath = path.join(logsDir, `${waveId}.validation.log`);

    const result = {
      waveId,
      brandName: item.brandName,
      sourceBucket: item.laneKey,
      sourcePreference: item.sourcePreference,
      effectiveStatus,
      configPath: path.relative(ROOT, configPath),
      waveOutDir: path.relative(ROOT, waveOutDir),
      validationOutDir: path.relative(ROOT, validationOutDir),
      count: Number(wave?.count ?? waveConfig?.limit ?? 0),
      state: "planned",
      waveLogPath: path.relative(ROOT, waveLogPath),
      validationLogPath: path.relative(ROOT, validationLogPath),
    };

    if (effectiveStatus === "HOLD") {
      result.state = "held";
      return result;
    }
    if (effectiveStatus === "STOP") {
      result.state = "stopped_by_status";
      return result;
    }

    const waveCommandArgs = [
      path.join(ROOT, "scripts", "maintainer", "run-scrapling-official-fallback-wave.mjs"),
      "--config-json",
      configPath,
      "--execute",
      String(EXECUTE),
    ];
    result.state = "running_wave";
    const waveRun = await spawnAndCapture({
      command: process.execPath,
      commandArgs: waveCommandArgs,
      logPath: waveLogPath,
    });
    result.waveCommand = [process.execPath, ...waveCommandArgs].join(" ");
    result.waveExitCode = waveRun.code;

    const waveReportPath = path.join(waveOutDir, "scrapling_official_fallback_report.json");
    result.waveReportPath = path.relative(ROOT, waveReportPath);

    if (waveRun.code !== 0 || !(await fileExists(waveReportPath))) {
      result.state = "wave_failed";
      if (!CONTINUE_ON_WAVE_ERROR) {
        throw new Error(`Wave failed: ${waveId}`);
      }
      return result;
    }

    const waveReport = await readJson(waveReportPath);
    result.wave = summarizeWaveReport(waveReport);

    if (!EXECUTE) {
      result.state = "planned_only";
      return result;
    }

    const validationCommandArgs = [
      path.join(ROOT, "scripts", "maintainer", "apply-scrapling-canary-merge-and-validate.mjs"),
      "--report-json",
      waveReportPath,
      "--staging-json",
      path.resolve(ROOT, waveConfig?.stagingPath ?? executionManifest?.inputs?.stagingPath ?? ""),
      "--out-dir",
      validationOutDir,
      "--skip-merged-staging",
      String(SKIP_MERGED_STAGING),
    ];
    result.state = "running_validation";
    const validationRun = await spawnAndCapture({
      command: process.execPath,
      commandArgs: validationCommandArgs,
      logPath: validationLogPath,
    });
    result.validationCommand = [process.execPath, ...validationCommandArgs].join(" ");
    result.validationExitCode = validationRun.code;

    const validationReportPath = path.join(validationOutDir, "scrapling_merge_validation_report.json");
    result.validationReportPath = path.relative(ROOT, validationReportPath);

    if (validationRun.code !== 0 || !(await fileExists(validationReportPath))) {
      result.state = "validation_failed";
      if (!CONTINUE_ON_WAVE_ERROR) {
        throw new Error(`Validation failed: ${waveId}`);
      }
      return result;
    }

    const validationReport = await readJson(validationReportPath);
    result.validation = summarizeValidationReport(validationReport);
    result.state = "completed";
    return result;
  };

  const processedResults = await mapWithConcurrency(executionList, CONCURRENCY, processExecutionItem);
  results.push(...processedResults.filter(Boolean));

  const brands = toArray(executionManifest?.brands).map((brand) => {
    const brandResults = results.filter((item) => item.brandName === brand.brandName);
    return {
      brandName: brand.brandName,
      effectiveStatus: brand.effectiveStatus,
      laneCount: toArray(brand.lanes).length,
      lanes: toArray(brand.lanes).map((lane) => {
        const laneResults = brandResults.filter((item) => item.sourceBucket === lane.sourceBucket);
        return {
          sourceBucket: lane.sourceBucket,
          sourcePreference: lane.sourcePreference,
          effectiveStatus: lane.effectiveStatus,
          waveCount: toArray(lane.waves).length,
          waves: laneResults,
        };
      }),
    };
  });

  const summary = {
    brandCount: brands.length,
    laneCount: brands.reduce((sum, brand) => sum + brand.lanes.length, 0),
    waveCount: results.length,
    executedWaveCount: results.filter((item) => ["completed", "validation_failed", "wave_failed", "planned_only"].includes(item.state)).length,
    heldWaveCount: results.filter((item) => item.state === "held").length,
    stoppedWaveCount: results.filter((item) => item.state === "stopped_by_status" || item.state === "not_run_due_to_stop").length,
    failedWaveCount: results.filter((item) => item.state === "wave_failed" || item.state === "validation_failed").length,
    improvedRows: results.reduce((sum, item) => sum + Number(item.validation?.improvedRows ?? 0), 0),
    becameFullOverlayReady: results.reduce((sum, item) => sum + Number(item.validation?.becameFullOverlayReady ?? 0), 0),
  };

  const finalSummary = {
    schemaVersion: "scrapling_bulk_program_summary.v1",
    generatedAt: new Date().toISOString(),
    programState: summary.failedWaveCount > 0 ? "completed_with_failures" : "completed",
    inputs: {
      manifestPath: path.resolve(ROOT, MANIFEST_PATH),
      registryPath: path.resolve(ROOT, REGISTRY_PATH),
      executionMode: EXECUTION_MODE,
      concurrency: CONCURRENCY,
      execute: EXECUTE,
      continueOnWaveError: CONTINUE_ON_WAVE_ERROR,
      skipMergedStaging: SKIP_MERGED_STAGING,
      statusOverridesPath: STATUS_OVERRIDES_PATH ? path.resolve(ROOT, STATUS_OVERRIDES_PATH) : null,
      outDir: path.resolve(ROOT, OUT_DIR),
    },
    manifestMeta: {
      schemaVersion: executionManifest?.schemaVersion ?? null,
      generatedAt: executionManifest?.generatedAt ?? null,
    },
    summary,
    brands,
  };

  const summaryJsonPath = path.resolve(ROOT, OUT_DIR, "scrapling_bulk_program_summary.json");
  const summaryMdPath = path.resolve(ROOT, OUT_DIR, "scrapling_bulk_program_summary.md");
  await writeJson(summaryJsonPath, finalSummary);
  await writeText(summaryMdPath, buildMarkdownSummary(finalSummary));

  console.log(
    JSON.stringify(
      {
        ok: true,
        programState: finalSummary.programState,
        summaryPath: summaryJsonPath,
        summaryMdPath,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
