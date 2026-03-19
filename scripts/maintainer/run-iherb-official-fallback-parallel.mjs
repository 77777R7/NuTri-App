#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const args = process.argv.slice(2);
const KNOWN_ARG_NAMES = new Set([
  "config-json",
  "staging-json",
  "queue-json",
  "out-dir",
  "concurrency",
  "shards",
  "delay-ms",
  "brand",
  "priority-lane",
]);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const CONFIG_JSON_PATH = getArg("config-json", null);
const STAGING_PATH = getArg("staging-json", null);
const QUEUE_PATH = getArg("queue-json", null);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_official_fallback_parallel"));
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", 4)) || 4);
const SHARDS = Math.max(CONCURRENCY, Number(getArg("shards", CONCURRENCY)) || CONCURRENCY);
const DELAY_MS = Number(getArg("delay-ms", 0)) || 0;
const BRAND_FILTER = getArg("brand", null);
const PRIORITY_LANE = getArg("priority-lane", null);
const PASS_THROUGH_ARGS = [];
for (let index = 0; index < args.length; index += 1) {
  const token = args[index];
  if (!token.startsWith("--")) {
    PASS_THROUGH_ARGS.push(token);
    continue;
  }
  const name = token.slice(2);
  if (KNOWN_ARG_NAMES.has(name)) {
    index += 1;
    continue;
  }
  PASS_THROUGH_ARGS.push(token);
  if (index + 1 < args.length && !args[index + 1].startsWith("--")) {
    PASS_THROUGH_ARGS.push(args[index + 1]);
    index += 1;
  }
}

if (!CONFIG_JSON_PATH || !STAGING_PATH || !QUEUE_PATH) {
  console.error(
    "Missing required args. Example: node scripts/maintainer/run-iherb-official-fallback-parallel.mjs --config-json data/...json --staging-json output/...json --queue-json output/...json --out-dir output/...",
  );
  process.exit(1);
}

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const buildOverlayHash = (row) =>
  stableHash({
    brandName: row.brandName,
    title: row.title,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts,
    descriptionSections: row.descriptionSections,
    sourceSummary: row.sourceSummary,
  });

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);

  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: buildOverlayHash(mergedRecord),
  };
};

const summarizeRows = (rows) =>
  rows.reduce(
    (acc, row) => {
      acc.processed += 1;
      if (row.searchHit) acc.searchHits += 1;
      if (row.catalogHit) acc.catalogHits += 1;
      if (row.pageHit) acc.pageHits += 1;
      if (row.pdfHit) acc.pdfHits += 1;
      if (row.imageOcrHit) acc.imageOcrHits += 1;
      if (row.improved) acc.improvedRows += 1;
      if ((row.filledFields ?? []).includes("ingredient")) acc.filledIngredient += 1;
      if ((row.filledFields ?? []).includes("dosage")) acc.filledDosage += 1;
      if ((row.filledFields ?? []).includes("suggested_use")) acc.filledSuggestedUse += 1;
      if ((row.filledFields ?? []).includes("warnings")) acc.filledWarnings += 1;
      if ((row.filledFields ?? []).includes("product_image")) acc.filledProductImage += 1;
      if ((row.afterMissingFields ?? []).includes("suggested_use")) acc.stillMissingSuggestedUse += 1;
      if ((row.afterMissingFields ?? []).includes("warnings")) acc.stillMissingWarnings += 1;
      if ((row.afterMissingFields ?? []).includes("product_image")) acc.stillMissingProductImage += 1;
      if (Array.isArray(row.afterMissingFields) && row.afterMissingFields.length === 0) acc.becameFullOverlayReady += 1;
      return acc;
    },
    {
      queued: rows.length,
      processed: 0,
      searchHits: 0,
      catalogHits: 0,
      pageHits: 0,
      pdfHits: 0,
      imageOcrHits: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
      filledIngredient: 0,
      filledDosage: 0,
      filledSuggestedUse: 0,
      filledWarnings: 0,
      filledProductImage: 0,
      stillMissingSuggestedUse: 0,
      stillMissingWarnings: 0,
      stillMissingProductImage: 0,
    },
  );

const buildMarkdownReport = (report) => {
  const lines = [
    "# iHerb Official Fallback Parallel Wave",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- configJson: ${report.inputs.configJsonPath}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- outDir: ${report.inputs.outDir}`,
    `- concurrency: ${report.inputs.concurrency}`,
    `- shards: ${report.inputs.shards}`,
    "",
    "## Summary",
    "",
    `- queued: ${report.summary.queued}`,
    `- processed: ${report.summary.processed}`,
    `- search_hits: ${report.summary.searchHits}`,
    `- catalog_hits: ${report.summary.catalogHits}`,
    `- page_hits: ${report.summary.pageHits}`,
    `- pdf_hits: ${report.summary.pdfHits}`,
    `- image_ocr_hits: ${report.summary.imageOcrHits}`,
    `- improved_rows: ${report.summary.improvedRows}`,
    `- became_full_overlay_ready: ${report.summary.becameFullOverlayReady}`,
    `- filled_ingredient: ${report.summary.filledIngredient}`,
    `- filled_dosage: ${report.summary.filledDosage}`,
    `- filled_suggested_use: ${report.summary.filledSuggestedUse}`,
    `- filled_warnings: ${report.summary.filledWarnings}`,
    "",
    "## Worker Summaries",
    "",
  ];

  for (const worker of report.workers) {
    lines.push(
      `- shard ${worker.shard}: queued=${worker.summary.queued}, improved=${worker.summary.improvedRows}, full=${worker.summary.becameFullOverlayReady}`,
    );
  }

  lines.push("", "## Sample Results", "");
  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.title || "n/a"} | after=${(row.afterMissingFields ?? []).join(", ") || "none"} | changed=${Boolean(row.improved)}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const runWorker = async ({ shardIndex, queuePath, outDir }) => {
  const scriptPath = path.join(ROOT, "scripts", "maintainer", "refresh-iherb-overlay-p0-by-official-fallback.mjs");
  const workerArgs = [
    scriptPath,
    "--config-json",
    CONFIG_JSON_PATH,
    "--staging-json",
    STAGING_PATH,
    "--queue-json",
    queuePath,
    "--out-dir",
    outDir,
    "--delay-ms",
    String(DELAY_MS),
    "--write-staging-out",
    "false",
    "--write-report-md",
    "false",
  ];
  if (BRAND_FILTER) workerArgs.push("--brand", BRAND_FILTER);
  if (PRIORITY_LANE) workerArgs.push("--priority-lane", PRIORITY_LANE);
  workerArgs.push(...PASS_THROUGH_ARGS);

  const { stdout, stderr } = await execFileAsync(process.execPath, workerArgs, {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 8,
  });
  const parsedStdout = JSON.parse(stdout.trim());
  const report = JSON.parse(await fs.readFile(path.join(outDir, "official_fallback_report.json"), "utf8"));
  const seed = JSON.parse(await fs.readFile(path.join(outDir, "official_fallback_seed.json"), "utf8"));
  return {
    shard: shardIndex,
    stdout: parsedStdout,
    stderr: stderr.trim() || null,
    report,
    seedProducts: Array.isArray(seed?.products) ? seed.products : [],
  };
};

const runWorkersWithLimit = async (workerInputs) => {
  const results = new Array(workerInputs.length);
  let cursor = 0;

  const runner = async () => {
    while (cursor < workerInputs.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await runWorker(workerInputs[current]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, workerInputs.length) }, () => runner()));
  return results;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const tmpDir = path.join(OUT_DIR, "_tmp");
  await fs.mkdir(tmpDir, { recursive: true });

  const [stagingPayload, queuePayload] = await Promise.all([readJson(STAGING_PATH), readJson(QUEUE_PATH)]);
  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const queueRows = Array.isArray(queuePayload) ? queuePayload : Array.isArray(queuePayload?.rows) ? queuePayload.rows : [];
  const selectedRows = queueRows.filter((row) => Boolean(normalizeText(row?.productId)));
  const shardBuckets = Array.from({ length: SHARDS }, () => []);
  selectedRows.forEach((row, index) => {
    shardBuckets[index % SHARDS].push(row);
  });

  const workerInputs = [];
  for (let index = 0; index < shardBuckets.length; index += 1) {
    const rows = shardBuckets[index];
    if (rows.length === 0) continue;
    const shardQueuePath = path.join(tmpDir, `shard-${index + 1}.queue.json`);
    const shardOutDir = path.join(tmpDir, `shard-${index + 1}`);
    await writeJson(shardQueuePath, rows);
    workerInputs.push({
      shardIndex: index + 1,
      queuePath: shardQueuePath,
      outDir: shardOutDir,
    });
  }

  const workerResults = await runWorkersWithLimit(workerInputs);
  const combinedRows = workerResults.flatMap((worker) => worker.report.rows ?? []);
  const combinedSeeds = workerResults.flatMap((worker) => worker.seedProducts ?? []);

  const refreshedRows = [...stagingRows];
  const stagingByProductId = new Map();
  const keyFor = (brandName, productId) => `${normalizeText(brandName).toLowerCase()}||${normalizeText(productId)}`;
  stagingRows.forEach((row, idx) => {
    if (!normalizeText(row?.productId)) return;
    stagingByProductId.set(keyFor(row?.brandName, row?.productId), { row, idx });
  });

  for (const seedRow of combinedSeeds) {
    const stagingEntry = stagingByProductId.get(keyFor(seedRow?.brandName, seedRow?.productId));
    if (!stagingEntry) continue;
    const incomingRecord = extractOverlayRecordFromSeedRow(seedRow, {
      seedName: "official_fallback_seed",
    });
    const mergedRecord = mergeOverlayRecords(stagingEntry.row, incomingRecord);
    const hydratedRow = hydrateMergedRow(stagingEntry.row, mergedRecord);
    refreshedRows[stagingEntry.idx] = hydratedRow;
  }

  const summary = summarizeRows(combinedRows);
  const report = {
    schemaVersion: "iherb_official_fallback_parallel_wave.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      configJsonPath: CONFIG_JSON_PATH,
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
      outDir: OUT_DIR,
      concurrency: CONCURRENCY,
      shards: SHARDS,
    },
    summary,
    workers: workerResults.map((worker) => ({
      shard: worker.shard,
      summary: worker.report.summary,
    })),
    rows: combinedRows,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.official_refreshed.json");
  const seedOut = path.join(OUT_DIR, "official_fallback_seed.json");
  const reportJsonOut = path.join(OUT_DIR, "official_fallback_report.json");
  const reportMdOut = path.join(OUT_DIR, "official_fallback_report.md");

  await fs.writeFile(stagingOut, `${JSON.stringify({ products: refreshedRows }, null, 2)}\n`, "utf8");
  await fs.writeFile(seedOut, `${JSON.stringify({ products: combinedSeeds }, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdOut, buildMarkdownReport(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          staging: stagingOut,
          seed: seedOut,
          reportJson: reportJsonOut,
          reportMd: reportMdOut,
        },
        summary,
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
