#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { normalizeText, normalizeLower } from "./lib/iherb-overlay-utils.mjs";
import { resolveDefaultScraplingPythonBin } from "./lib/scrapling-fetcher.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "pure_encapsulations_mainline_merge_v2", "staging_products.scrapling_merged.json"),
);
const QUEUE_PATH = getArg("queue-json", null);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `partial_overlay_conversion_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`),
);
const EXECUTE = getArg("execute", "true") === "true";
const FETCH_CONCURRENCY = Math.max(1, Number(getArg("fetch-concurrency", "3")) || 3);
const SCRAPLING_PYTHON_BIN = resolveDefaultScraplingPythonBin({ root: ROOT });
const parseBrandList = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
const LANE_FILTER = new Set(parseBrandList(getArg("lane-filter", "")));
const LANE_A_BRAND_OVERRIDE = parseBrandList(getArg("lane-a-brands", ""));
const LANE_B_BRAND_OVERRIDE = parseBrandList(getArg("lane-b-brands", ""));

if (!QUEUE_PATH) {
  console.error("Missing --queue-json. Pass a master-queue rows JSON file.");
  process.exit(1);
}

const LANE_DEFS = [
  {
    id: "lane_a_soft_field",
    label: "Lane A Soft-Field Conversion",
    sourcePreference: "auto",
    brands:
      LANE_A_BRAND_OVERRIDE.length > 0
        ? LANE_A_BRAND_OVERRIDE
        : ["Carlson", "MRM Nutrition", "Nutricost", "Garden of Life", "Solgar", "Doctor's Best"],
    includeRow: (row) => {
      const missing = new Set(Array.isArray(row?.coreMissingFields) ? row.coreMissingFields : []);
      if (!missing.size) return false;
      for (const field of missing) {
        if (!["suggested_use", "warnings", "product_image"].includes(field)) return false;
      }
      return missing.has("suggested_use") || missing.has("warnings");
    },
  },
  {
    id: "lane_b_facts_recovery",
    label: "Lane B Facts Recovery",
    sourcePreference: "auto",
    brands:
      LANE_B_BRAND_OVERRIDE.length > 0
        ? LANE_B_BRAND_OVERRIDE
        : ["Sports Research", "California Gold Nutrition", "Swanson", "Source Naturals"],
    includeRow: (row) => {
      const missing = new Set(Array.isArray(row?.coreMissingFields) ? row.coreMissingFields : []);
      return missing.has("ingredient") || missing.has("dosage");
    },
  },
];

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const runNodeScript = (scriptPath, scriptArgs, extraEnv = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
    child.on("error", reject);
  });

const moveFile = async (sourcePath, targetPath) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rm(targetPath, { force: true });
  await fs.rename(sourcePath, targetPath);
};

const buildLaneRows = (queueRows, laneDef) => {
  const brandSet = new Set(laneDef.brands.map((value) => normalizeText(value)));
  return queueRows.filter((row) => brandSet.has(normalizeText(row?.brandName)) && laneDef.includeRow(row));
};

const summarizeValidationRows = (rows) => {
  const summary = {
    processed: 0,
    improvedRows: 0,
    becameFullOverlayReady: 0,
  };
  for (const row of rows) {
    if (row?.outcome === "staging_row_not_found") continue;
    summary.processed += 1;
    if (row?.improved) summary.improvedRows += 1;
    if (row?.beforeStatus !== "full_overlay_ready" && row?.afterStatus === "full_overlay_ready") {
      summary.becameFullOverlayReady += 1;
    }
  }
  return summary;
};

const runWaveFetch = async ({ stagingPath, queueJsonPath, waveOutDir, limit, sourcePreference }) => {
  await runNodeScript(
    path.join(ROOT, "scripts", "maintainer", "run-scrapling-official-fallback-wave.mjs"),
    [
      "--staging-json",
      stagingPath,
      "--queue-json",
      queueJsonPath,
      "--out-dir",
      waveOutDir,
      "--limit",
      String(limit),
      "--execute",
      "true",
      "--source-preference",
      sourcePreference,
    ],
    { SCRAPLING_PYTHON_BIN },
  );
};

const runWithConcurrency = async (tasks, concurrency) => {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
};

const main = async () => {
  const queueRows = await readJson(QUEUE_PATH);
  const runRoot = path.resolve(ROOT, OUT_DIR);
  await fs.mkdir(runRoot, { recursive: true });

  const lanePlans = [];
  for (const laneDef of LANE_DEFS.filter((lane) => LANE_FILTER.size === 0 || LANE_FILTER.has(lane.id))) {
    const laneRows = buildLaneRows(queueRows, laneDef);
    const byBrand = laneDef.brands.map((brandName) => {
      const rows = laneRows.filter((row) => normalizeText(row?.brandName) === normalizeText(brandName));
      return {
        brandName,
        count: rows.length,
        productIds: rows.map((row) => row.productId),
      };
    });
    lanePlans.push({
      id: laneDef.id,
      label: laneDef.label,
      totalRows: laneRows.length,
      brands: byBrand,
    });
  }

  await writeJson(path.join(runRoot, "lane_plan.json"), {
    generatedAt: new Date().toISOString(),
    queuePath: path.resolve(ROOT, QUEUE_PATH),
    stagingPath: path.resolve(ROOT, STAGING_PATH),
    execute: EXECUTE,
    lanePlans,
  });

  if (!EXECUTE) {
    console.log(`Wrote lane plan to ${path.join(runRoot, "lane_plan.json")}`);
    return;
  }

  let currentStagingPath = path.resolve(ROOT, STAGING_PATH);
  const brandRuns = [];
  const fetchJobs = [];
  for (const laneDef of LANE_DEFS.filter((lane) => LANE_FILTER.size === 0 || LANE_FILTER.has(lane.id))) {
    for (const brandName of laneDef.brands) {
      const laneRows = buildLaneRows(queueRows, laneDef).filter(
        (row) => normalizeText(row?.brandName) === normalizeText(brandName),
      );
      if (!laneRows.length) continue;

      const brandSlug = slugify(brandName);
      const brandRoot = path.join(runRoot, laneDef.id, brandSlug);
      const queueJsonPath = path.join(brandRoot, "queue_rows.json");
      const waveOutDir = path.join(brandRoot, "wave");
      await writeJson(queueJsonPath, laneRows);

      fetchJobs.push({
        laneDef,
        brandName,
        queueCount: laneRows.length,
        queueJsonPath,
        waveOutDir,
        validationOutDir: path.join(brandRoot, "merge_validation"),
      });
    }
  }

  await runWithConcurrency(
    fetchJobs.map((job) => async () =>
      runWaveFetch({
        stagingPath: currentStagingPath,
        queueJsonPath: job.queueJsonPath,
        waveOutDir: job.waveOutDir,
        limit: job.queueCount,
        sourcePreference: job.laneDef.sourcePreference,
      })),
    FETCH_CONCURRENCY,
  );

  for (const job of fetchJobs) {
      await runNodeScript(path.join(ROOT, "scripts", "maintainer", "apply-scrapling-canary-merge-and-validate.mjs"), [
        "--report-json",
        path.join(job.waveOutDir, "scrapling_official_fallback_report.json"),
        "--staging-json",
        currentStagingPath,
        "--out-dir",
        job.validationOutDir,
      ]);

      const validationReport = await readJson(path.join(job.validationOutDir, "scrapling_merge_validation_report.json"));
      const nextStagingTemp = path.join(job.validationOutDir, "staging_products.scrapling_merged.json");
      const currentStagingOutPath = path.join(runRoot, "current_staging_products.scrapling_merged.json");
      await moveFile(nextStagingTemp, currentStagingOutPath);
      currentStagingPath = currentStagingOutPath;

      brandRuns.push({
        laneId: job.laneDef.id,
        laneLabel: job.laneDef.label,
        brandName: job.brandName,
        queueCount: job.queueCount,
        validationSummary: validationReport.summary,
        rowSummary: summarizeValidationRows(validationReport.rows ?? []),
        reportPath: path.join(job.validationOutDir, "scrapling_merge_validation_report.json"),
      });
    }

  const finalSummary = brandRuns.reduce(
    (acc, run) => {
      acc.brandsExecuted += 1;
      acc.queueRows += run.queueCount;
      acc.processed += run.validationSummary?.processed ?? 0;
      acc.improvedRows += run.validationSummary?.improvedRows ?? 0;
      acc.becameFullOverlayReady += run.validationSummary?.becameFullOverlayReady ?? 0;
      return acc;
    },
    {
      brandsExecuted: 0,
      queueRows: 0,
      processed: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
    },
  );

  await writeJson(path.join(runRoot, "summary.json"), {
    generatedAt: new Date().toISOString(),
      inputQueuePath: path.resolve(ROOT, QUEUE_PATH),
      startingStagingPath: path.resolve(ROOT, STAGING_PATH),
      finalStagingPath: currentStagingPath,
      fetchConcurrency: FETCH_CONCURRENCY,
      summary: finalSummary,
      brandRuns,
    });

  console.log(`Wrote conversion lane summary to ${path.join(runRoot, "summary.json")}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
