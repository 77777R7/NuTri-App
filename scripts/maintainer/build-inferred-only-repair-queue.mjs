#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const findLatestSurfaceReport = async () => {
  const outputRoot = path.join(ROOT_DIR, "output");
  try {
    const entries = await fs.readdir(outputRoot, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const reportPath = path.join(outputRoot, entry.name, "surface_consistency_report.json");
      try {
        const stat = await fs.stat(reportPath);
        candidates.push({ reportPath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.reportPath ?? null;
  } catch {
    return null;
  }
};

const classifyRootCause = (row) => {
  const rootCause = String(row?.rootCause ?? "").trim();
  if (
    rootCause === "parser_gap_fixable"
    || rootCause === "data_ceiling"
    || rootCause === "inference_only_expected"
    || rootCause === "unknown"
  ) {
    return rootCause;
  }
  return "unknown";
};

const toJsonl = (rows) =>
  rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");

const main = async () => {
  if (hasFlag("help")) {
    console.log(`Usage:
  node scripts/maintainer/build-inferred-only-repair-queue.mjs [options]

Options:
  --surface-report <path>   surface_consistency_report.json (default: latest from output/*)
  --out-dir <path>          output dir (default: same dir as surface report)
`);
    process.exit(0);
  }

  const reportArg = getArg("surface-report");
  const reportPath = reportArg
    ? (path.isAbsolute(reportArg) ? reportArg : path.join(ROOT_DIR, reportArg))
    : await findLatestSurfaceReport();
  if (!reportPath) throw new Error("surface_report_not_found");

  const report = await readJson(reportPath);
  if (!report) throw new Error(`surface_report_invalid:${reportPath}`);
  const outDirArg = getArg("out-dir") || path.dirname(reportPath);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  const rows = Array.isArray(report?.inferredOnlyContradictionRows)
    ? report.inferredOnlyContradictionRows
    : [];
  const generatedAt = new Date().toISOString();

  const inferredOnlyRepairQueue = [];
  const dataCeilingExplainQueue = [];
  const unknownQueue = [];

  for (const row of rows) {
    const rootCause = classifyRootCause(row);
    const payload = {
      barcode: row?.barcode ?? null,
      rootCause,
      scanSourceDataset: row?.scanSourceDataset ?? null,
      scanVerificationStatus: row?.scanVerificationStatus ?? null,
      mySupplementSourceDataset: row?.mySupplementSourceDataset ?? null,
      mySupplementVerificationStatus: row?.mySupplementVerificationStatus ?? null,
      scanStrictIngredientCount: row?.scanStrictIngredientCount ?? null,
      scanStrictDoseCount: row?.scanStrictDoseCount ?? null,
      scanInferredIngredientCount: row?.scanInferredIngredientCount ?? null,
      scanInferredDoseCount: row?.scanInferredDoseCount ?? null,
      mySupplementIngredientCount: row?.mySupplementIngredientCount ?? null,
      mySupplementDoseCount: row?.mySupplementDoseCount ?? null,
      generatedAt,
    };
    if (rootCause === "parser_gap_fixable") {
      inferredOnlyRepairQueue.push({ ...payload, queue: "inferred_only_repair_queue" });
    } else if (rootCause === "data_ceiling" || rootCause === "inference_only_expected") {
      dataCeilingExplainQueue.push({ ...payload, queue: "data_ceiling_explain_queue" });
    } else {
      unknownQueue.push({ ...payload, queue: "inferred_only_unknown_queue" });
    }
  }

  const summary = {
    generatedAt,
    sourceReportPath: reportPath,
    totalRows: rows.length,
    inferredOnlyRepairQueueCount: inferredOnlyRepairQueue.length,
    dataCeilingExplainQueueCount: dataCeilingExplainQueue.length,
    unknownQueueCount: unknownQueue.length,
    rootCauseCounts: {
      parser_gap_fixable: inferredOnlyRepairQueue.length,
      data_ceiling: dataCeilingExplainQueue.filter((row) => row.rootCause === "data_ceiling").length,
      inference_only_expected: dataCeilingExplainQueue.filter((row) => row.rootCause === "inference_only_expected").length,
      unknown: unknownQueue.length,
    },
  };

  const summaryPath = path.join(outDir, "inferred_only_queue_summary.json");
  const repairQueuePath = path.join(outDir, "inferred_only_repair_queue.jsonl");
  const explainQueuePath = path.join(outDir, "data_ceiling_explain_queue.jsonl");
  const unknownQueuePath = path.join(outDir, "inferred_only_unknown_queue.jsonl");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(repairQueuePath, toJsonl(inferredOnlyRepairQueue), "utf8");
  await fs.writeFile(explainQueuePath, toJsonl(dataCeilingExplainQueue), "utf8");
  await fs.writeFile(unknownQueuePath, toJsonl(unknownQueue), "utf8");
  console.log(`[build-inferred-only-repair-queue] wrote ${summaryPath}`);
  console.log(`[build-inferred-only-repair-queue] wrote ${repairQueuePath}`);
  console.log(`[build-inferred-only-repair-queue] wrote ${explainQueuePath}`);
  console.log(`[build-inferred-only-repair-queue] wrote ${unknownQueuePath}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[build-inferred-only-repair-queue] failed", message);
  process.exit(1);
});

