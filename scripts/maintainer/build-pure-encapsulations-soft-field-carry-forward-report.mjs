#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildPureSoftFieldRecoveryBundle,
  canRecoverPureSoftFieldRow,
} from "./lib/pure-soft-field-recovery.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_QUEUE_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_browser_executor_v3_final",
  "soft_field_non_browser_queue.json",
);
const DEFAULT_STAGING_JSON = path.join(
  ROOT,
  "output",
  "p0_p3_codeage_remaining_six_closure_20260317",
  "unified_wave",
  "staging_products.official_refreshed.sanitized.json",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  "pure_encapsulations_soft_field_carry_forward_v2",
);

const QUEUE_JSON = path.resolve(ROOT, getArg("queue-json", DEFAULT_QUEUE_JSON));
const STAGING_JSON = path.resolve(ROOT, getArg("staging-json", DEFAULT_STAGING_JSON));
const OUT_DIR = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));
const HISTORY_JSON = path.resolve(
  ROOT,
  getArg(
    "history-json",
    path.join("output", "p0_p3_v1_strict_only_merge_cohort_20260318", "v1_strict_only_full_staging.json"),
  ),
);
const READER_PREFIX = getArg("reader-prefix", "https://r.jina.ai/http://");

const normalizeText = (value) => String(value ?? "").trim();
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const main = async () => {
  const queueRows = await readJson(QUEUE_JSON);
  const stagingRaw = await readJson(STAGING_JSON);
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (stagingRaw.products ?? []);
  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row?.productId), row]));

  const matchedRows = [];
  const stillUnresolvedRows = [];

  for (const row of queueRows) {
    const currentRow = stagingByProductId.get(normalizeText(row?.productId));
    if (!currentRow || !canRecoverPureSoftFieldRow(row)) {
      stillUnresolvedRows.push(row);
      continue;
    }

    try {
      const bundle = await buildPureSoftFieldRecoveryBundle({
        row,
        currentRow,
        historyJsonPath: HISTORY_JSON,
        readerPrefix: READER_PREFIX,
        includeExtendedSections: true,
      });
      if (!bundle) {
        stillUnresolvedRows.push(row);
        continue;
      }
      matchedRows.push(bundle);
    } catch (error) {
      stillUnresolvedRows.push({
        ...row,
        softFieldRecoveryAttempted: true,
        softFieldRecoveryError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    selectedCount: matchedRows.length,
    results: matchedRows.map((row) => row.result),
  };
  const summary = {
    generatedAt: report.generatedAt,
    inputCount: queueRows.length,
    matchedCarryForwardCount: matchedRows.length,
    stillUnresolvedCount: stillUnresolvedRows.length,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "summary.json"), summary);
  await writeJson(path.join(OUT_DIR, "matched_rows.json"), matchedRows);
  await writeJson(path.join(OUT_DIR, "still_unresolved_rows.json"), stillUnresolvedRows);
  await writeJson(path.join(OUT_DIR, "scrapling_official_fallback_report.json"), report);

  const md = [
    "# Pure Encapsulations Soft Field Carry Forward",
    "",
    `- inputCount: ${summary.inputCount}`,
    `- matchedCarryForwardCount: ${summary.matchedCarryForwardCount}`,
    `- stillUnresolvedCount: ${summary.stillUnresolvedCount}`,
    "",
    "## Matched Rows",
    ...matchedRows.map((row) => {
      if (row.recoveryStrategy === "history") {
        return `- ${row.unresolvedTitle} -> ${row.matchedHistoryTitle} (${row.matchedHistoryProductId})`;
      }
      return `- ${row.unresolvedTitle} -> ${row.exactPageUrl}`;
    }),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
