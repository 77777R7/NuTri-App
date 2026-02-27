#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const requireArg = (flag) => {
  const value = getArg(flag);
  if (!value) {
    console.error(`[build-candidate-backfill-repair-queue] missing --${flag}`);
    process.exit(1);
  }
  return value;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const mainReportPath = path.resolve(process.cwd(), requireArg("report"));
const retryReportPath = getArg("retry-report")
  ? path.resolve(process.cwd(), getArg("retry-report"))
  : null;
const outDir = path.resolve(
  process.cwd(),
  getArg("out-dir") || `output/maintainer-gates/candidate-repair-queue-${nowTag}`,
);

const toMapByBarcode = (rows) => {
  const map = new Map();
  for (const row of rows) {
    if (!row?.barcode) continue;
    map.set(String(row.barcode), row);
  }
  return map;
};

const main = async () => {
  const primary = readJson(mainReportPath);
  const retry = retryReportPath && fs.existsSync(retryReportPath) ? readJson(retryReportPath) : null;

  const primaryRows = Array.isArray(primary?.rows) ? primary.rows : [];
  const retryRows = Array.isArray(retry?.rows) ? retry.rows : [];
  const retryMap = toMapByBarcode(retryRows);

  const buckets = {
    P0_violation: [],
    P1_persistent_timeout: [],
    P1_suppressed_guard: [],
    P1_rejected_candidate: [],
    P2_visible_observe: [],
    P3_no_signal: [],
  };

  for (const row of primaryRows) {
    const barcode = String(row.barcode);
    const retried = retryMap.get(barcode) ?? null;
    const persistentTimeout =
      row?.error === "timeout" &&
      (!retried || retried?.error === "timeout");

    const item = {
      barcode,
      sampleType: row?.sampleType ?? null,
      ok: Boolean(row?.ok),
      doneSeen: Boolean(row?.doneSeen),
      error: row?.error ?? null,
      retryError: retried?.error ?? null,
      visible: Boolean(row?.visible),
      suppressed: Boolean(row?.suppressed),
      rejected: Boolean(row?.rejected),
      successBackfill: Boolean(row?.successBackfill),
      violation: Boolean(row?.violation),
      sourceTypeFinal: row?.sourceTypeFinal ?? null,
      scoreAvailable: row?.scoreAvailable ?? null,
      scoreReasonCode: row?.scoreReasonCode ?? null,
      candidateBackfill: row?.candidateBackfill ?? null,
    };

    if (item.violation) {
      buckets.P0_violation.push(item);
      continue;
    }
    if (persistentTimeout) {
      buckets.P1_persistent_timeout.push(item);
      continue;
    }
    if (item.suppressed) {
      buckets.P1_suppressed_guard.push(item);
      continue;
    }
    if (item.rejected) {
      buckets.P1_rejected_candidate.push(item);
      continue;
    }
    if (item.visible) {
      buckets.P2_visible_observe.push(item);
      continue;
    }
    buckets.P3_no_signal.push(item);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      mainReportPath,
      retryReportPath,
    },
    totals: {
      requested: primaryRows.length,
      violation: buckets.P0_violation.length,
      persistentTimeout: buckets.P1_persistent_timeout.length,
      suppressed: buckets.P1_suppressed_guard.length,
      rejected: buckets.P1_rejected_candidate.length,
      visibleObserve: buckets.P2_visible_observe.length,
      noSignal: buckets.P3_no_signal.length,
    },
    buckets,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "candidate_backfill_repair_queue.json");
  const mdPath = path.join(outDir, "candidate_backfill_repair_queue.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const md = [
    "# Candidate Backfill Repair Queue",
    `- generatedAt: ${summary.generatedAt}`,
    `- requested: ${summary.totals.requested}`,
    `- P0 violations: ${summary.totals.violation}`,
    `- P1 persistent timeout: ${summary.totals.persistentTimeout}`,
    `- P1 suppressed guard: ${summary.totals.suppressed}`,
    `- P1 rejected candidate: ${summary.totals.rejected}`,
    `- P2 visible observe: ${summary.totals.visibleObserve}`,
    `- P3 no signal: ${summary.totals.noSignal}`,
  ].join("\n");
  fs.writeFileSync(mdPath, `${md}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        jsonPath,
        mdPath,
        totals: summary.totals,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-candidate-backfill-repair-queue] fatal:", error?.message ?? error);
  process.exit(1);
});

