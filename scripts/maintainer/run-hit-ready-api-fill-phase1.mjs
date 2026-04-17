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

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const PHASE1_QUEUE_PATH = resolvePath(
  getArg(
    "phase1-queue-json",
    path.join(ROOT, "output", "iherb_hit_ready_closure_audit_current", "hit_ready_closure_audit_queue.json"),
  ),
);
const PRIORITY_PATH = resolvePath(
  getArg(
    "priority-json",
    path.join(ROOT, "output", "iherb_hit_ready_closure_audit_current", "next_roi_api_fill_priority.json"),
  ),
);
const MERGE_REPORT_PATH = resolvePath(
  getArg(
    "merge-report-json",
    path.join(
      ROOT,
      "output",
      "current_roi_sr_now_gol_zero_push",
      "full_validation",
      "merge_report",
      "overlay_merge_coverage_report.json",
    ),
  ),
);
const STAGING_PATH = resolvePath(
  getArg(
    "staging-json",
    path.join(ROOT, "output", "current_roi_sr_now_gol_zero_push", "full_validation", "staging_products.current_full.json"),
  ),
);
const CONFIG_DIR = resolvePath(getArg("config-dir", path.join(ROOT, "data", "iherb_official_fallback_configs")));
const OUT_DIR = resolvePath(
  getArg("out-dir", path.join(ROOT, "output", `hit_ready_api_fill_phase1_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`)),
);
const DELAY_MS = Number(getArg("delay-ms", "1200")) || 1200;
const REQUEST_TIMEOUT_MS = Number(getArg("request-timeout-ms", "45000")) || 45000;
const FETCH_CONCURRENCY = Math.max(1, Number(getArg("fetch-concurrency", "4")) || 4);

const runNodeScript = (scriptPath, scriptArgs) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
    child.on("error", reject);
  });

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

const toMarkdown = (report) => {
  const lines = [
    "# Hit-Ready API Fill Phase 1",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- phase1QueuePath: ${report.inputs.phase1QueuePath}`,
    `- priorityPath: ${report.inputs.priorityPath}`,
    `- mergeReportPath: ${report.inputs.mergeReportPath}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- fetchConcurrency: ${report.inputs.fetchConcurrency}`,
    "",
    "## Summary",
    "",
    `- queued_rows: ${report.summary.queuedRows}`,
    `- queued_brands: ${report.summary.queuedBrands}`,
    `- processed_brands: ${report.summary.processedBrands}`,
    `- processed_rows: ${report.summary.processedRows}`,
    `- improved_rows: ${report.summary.improvedRows}`,
    `- became_full_overlay_ready: ${report.summary.becameFullOverlayReady}`,
    `- filled_ingredient: ${report.summary.filledIngredient}`,
    `- filled_dosage: ${report.summary.filledDosage}`,
    `- filled_suggested_use: ${report.summary.filledSuggestedUse}`,
    `- filled_warnings: ${report.summary.filledWarnings}`,
    `- filled_product_image: ${report.summary.filledProductImage}`,
    "",
    "## Brand Runs",
    "",
  ];

  for (const brand of report.brandRuns) {
    lines.push(
      `- ${brand.brandName}: queued=${brand.queuedRows}, processed=${brand.summary.processed}, improved=${brand.summary.improvedRows}, full_overlay_ready=${brand.summary.becameFullOverlayReady}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await ensureDir(OUT_DIR);
  await ensureDir(path.join(OUT_DIR, "brand_queues"));
  await ensureDir(path.join(OUT_DIR, "brand_runs"));

  const [phase1Queue, priority, mergeReport, configEntries] = await Promise.all([
    readJson(PHASE1_QUEUE_PATH),
    readJson(PRIORITY_PATH),
    readJson(MERGE_REPORT_PATH),
    fs.readdir(CONFIG_DIR),
  ]);

  const configMap = new Map();
  for (const entry of configEntries) {
    if (!entry.endsWith(".json") || entry === "template.brand.json") continue;
    const configPath = path.join(CONFIG_DIR, entry);
    const config = await readJson(configPath);
    const brandName = normalizeText(config?.brandName);
    if (!brandName) continue;
    configMap.set(normalizeLower(brandName), {
      brandName,
      path: configPath,
      config,
    });
  }

  const mergeRows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];
  const mergeByProductId = new Map(
    mergeRows
      .map((row) => [normalizeText(row?.productId), row])
      .filter(([productId]) => productId),
  );

  const queueRows = (Array.isArray(phase1Queue) ? phase1Queue : [])
    .filter((row) => normalizeLower(row?.closureBucket) === "partial_overlay_requires_api_fill")
    .filter((row) => configMap.has(normalizeLower(row?.brandName)));

  const queueByBrand = new Map();
  for (const row of queueRows) {
    const brandName = normalizeText(row?.brandName);
    const productId = normalizeText(row?.productId);
    const mergeRow = mergeByProductId.get(productId);
    if (!brandName || !productId || !mergeRow) continue;
    if (!queueByBrand.has(brandName)) queueByBrand.set(brandName, []);
    queueByBrand.get(brandName).push({
      productId,
      brandName,
      title: normalizeText(row?.title),
      barcode_gtin14: normalizeText(row?.barcode),
      priorityLane: "P0_api_fill_us_strong_identity",
      coreMissingFields: Array.isArray(mergeRow?.stillMissingFields) ? mergeRow.stillMissingFields : [],
      sourceTypes: ["iherb_us_product_page"],
      hasUsIherbPage: true,
      highConfidenceUsProductPageReady: Boolean(mergeRow?.highConfidenceUsProductPageReady),
    });
  }

  const priorityBrands = Array.isArray(priority?.topBrands) ? priority.topBrands.map((row) => normalizeText(row?.brandName)) : [];
  const executionOrder = [...queueByBrand.keys()].sort((left, right) => {
    const leftPriority = priorityBrands.indexOf(left);
    const rightPriority = priorityBrands.indexOf(right);
    const leftOrder = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const rightOrder = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.localeCompare(right);
  });

  const brandJobs = [];
  for (const brandName of executionOrder) {
    const brandSlug = slugify(brandName);
    const configEntry = configMap.get(normalizeLower(brandName));
    const brandQueue = queueByBrand.get(brandName) ?? [];
    const brandRoot = path.join(OUT_DIR, "brand_runs", brandSlug);
    const queuePath = path.join(OUT_DIR, "brand_queues", `${brandSlug}.json`);
    await writeJson(queuePath, brandQueue);

    brandJobs.push({
      brandName,
      configPath: configEntry.path,
      queuePath,
      outDir: brandRoot,
      queuedRows: brandQueue.length,
      productIds: brandQueue.map((row) => normalizeText(row.productId)).filter(Boolean),
    });
  }

  const brandRuns = await runWithConcurrency(
    brandJobs.map((job) => async () => {
      const reportPath = path.join(job.outDir, "official_fallback_report.json");
      const stagingPath = path.join(job.outDir, "staging_products.official_refreshed.json");
      if ((await pathExists(reportPath)) && (await pathExists(stagingPath))) {
        const brandReport = await readJson(reportPath);
        return {
          ...job,
          reusedExisting: true,
          summary: brandReport.summary,
        };
      }
      await runNodeScript(path.join(ROOT, "scripts", "maintainer", "refresh-iherb-overlay-p0-by-official-fallback.mjs"), [
        "--config-json",
        job.configPath,
        "--staging-json",
        STAGING_PATH,
        "--queue-json",
        job.queuePath,
        "--out-dir",
        job.outDir,
        "--brand",
        job.brandName,
        "--priority-lane",
        "P0_api_fill_us_strong_identity",
        "--delay-ms",
        String(DELAY_MS),
        "--request-timeout-ms",
        String(REQUEST_TIMEOUT_MS),
        "--limit",
        String(job.queuedRows),
      ]);
      const brandReport = await readJson(reportPath);
      return {
        ...job,
        reusedExisting: false,
        summary: brandReport.summary,
      };
    }),
    FETCH_CONCURRENCY,
  );

  const summary = brandRuns.reduce(
    (acc, brand) => {
      acc.processedBrands += 1;
      acc.processedRows += Number(brand.summary?.processed ?? 0);
      acc.improvedRows += Number(brand.summary?.improvedRows ?? 0);
      acc.becameFullOverlayReady += Number(brand.summary?.becameFullOverlayReady ?? 0);
      acc.filledIngredient += Number(brand.summary?.filledIngredient ?? 0);
      acc.filledDosage += Number(brand.summary?.filledDosage ?? 0);
      acc.filledSuggestedUse += Number(brand.summary?.filledSuggestedUse ?? 0);
      acc.filledWarnings += Number(brand.summary?.filledWarnings ?? 0);
      acc.filledProductImage += Number(brand.summary?.filledProductImage ?? 0);
      return acc;
    },
    {
      queuedRows: queueRows.length,
      queuedBrands: executionOrder.length,
      processedBrands: 0,
      processedRows: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
      filledIngredient: 0,
      filledDosage: 0,
      filledSuggestedUse: 0,
      filledWarnings: 0,
      filledProductImage: 0,
    },
  );

  const baseStagingRaw = await readJson(STAGING_PATH);
  const baseStagingRows = Array.isArray(baseStagingRaw) ? baseStagingRaw : baseStagingRaw.products ?? [];
  const finalRows = [...baseStagingRows];
  const rowIndexByProductId = new Map(
    finalRows
      .map((row, idx) => [normalizeText(row?.productId), idx])
      .filter(([productId]) => productId),
  );

  for (const brandRun of brandRuns) {
    const refreshedRaw = await readJson(path.join(brandRun.outDir, "staging_products.official_refreshed.json"));
    const refreshedRows = Array.isArray(refreshedRaw) ? refreshedRaw : refreshedRaw.products ?? [];
    const refreshedByProductId = new Map(
      refreshedRows
        .map((row) => [normalizeText(row?.productId), row])
        .filter(([productId]) => productId),
    );
    for (const productId of brandRun.productIds) {
      const idx = rowIndexByProductId.get(productId);
      const refreshed = refreshedByProductId.get(productId);
      if (typeof idx === "number" && refreshed) {
        finalRows[idx] = refreshed;
      }
    }
  }

  const finalStagingPath = path.join(OUT_DIR, "phase1_staging_products.official_refreshed.json");
  await writeJson(finalStagingPath, { products: finalRows });

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      phase1QueuePath: PHASE1_QUEUE_PATH,
      priorityPath: PRIORITY_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
      stagingPath: STAGING_PATH,
      configDir: CONFIG_DIR,
      fetchConcurrency: FETCH_CONCURRENCY,
    },
    summary,
    finalStagingPath,
    brandRuns,
  };

  await writeJson(path.join(OUT_DIR, "phase1_manifest.json"), report);
  await writeText(path.join(OUT_DIR, "phase1_summary.md"), toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        finalStagingPath,
        summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[run-hit-ready-api-fill-phase1] failed", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
