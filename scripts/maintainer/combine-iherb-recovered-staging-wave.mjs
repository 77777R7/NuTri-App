#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildOverlayRecordKey,
  classifyOverlayStatus,
  deriveCompleteness,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const getArgs = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    if (args[idx] === flag && idx + 1 < args.length) values.push(args[idx + 1]);
  }
  return values;
};

const BASE_STAGING_PATH = getArg(
  "base-staging-json",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const RECOVERED_STAGING_PATHS = [
  ...getArgs("recovered-staging-json"),
  ...(getArg("recovered-staging-jsons", "") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "p0_p3_combined_missing_recovery_wave"));

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const toMarkdown = (report) => {
  const lines = [
    "# Combined iHerb Recovered Staging Wave",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- baseStagingPath: ${report.inputs.baseStagingPath}`,
    `- recoveredStagingCount: ${report.inputs.recoveredStagingPaths.length}`,
    "",
    "## Summary",
    "",
    `- base_rows: ${report.summary.baseRows}`,
    `- output_rows: ${report.summary.outputRows}`,
    `- changed_existing_rows: ${report.summary.changedExistingRows}`,
    `- added_rows: ${report.summary.addedRows}`,
    "",
    "## Applied Waves",
    "",
  ];

  for (const wave of report.waves) {
    lines.push(
      `- ${wave.label}: changed_existing=${wave.changedExistingRows}, added=${wave.addedRows}, unchanged_skipped=${wave.unchangedSkipped}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const summarizeCompleteness = (row) => {
  const completeness = row?.completeness?.coreResolvedFields
    ? row.completeness
    : deriveCompleteness(row);
  const coreResolvedCount = Array.isArray(completeness?.coreResolvedFields) ? completeness.coreResolvedFields.length : 0;
  const secondaryResolvedCount = Array.isArray(completeness?.secondaryResolvedFields)
    ? completeness.secondaryResolvedFields.length
    : 0;
  const completenessScore = Number(completeness?.completenessScore ?? 0);
  const hasUsIherbPage = Boolean(row?.sourceSummary?.hasUsIherbPage);
  return {
    coreResolvedCount,
    secondaryResolvedCount,
    completenessScore,
    hasUsIherbPage,
  };
};

const shouldApplyRecoveredRow = (currentRow, candidateRow) => {
  if (!currentRow) return true;
  const current = summarizeCompleteness(currentRow);
  const candidate = summarizeCompleteness(candidateRow);

  if (candidate.coreResolvedCount !== current.coreResolvedCount) {
    return candidate.coreResolvedCount > current.coreResolvedCount;
  }
  if (candidate.secondaryResolvedCount !== current.secondaryResolvedCount) {
    return candidate.secondaryResolvedCount > current.secondaryResolvedCount;
  }
  if (candidate.completenessScore !== current.completenessScore) {
    return candidate.completenessScore > current.completenessScore;
  }
  if (candidate.hasUsIherbPage !== current.hasUsIherbPage) {
    return candidate.hasUsIherbPage;
  }
  return false;
};

const finalizeRow = (row) => {
  const completeness = deriveCompleteness(row);
  return {
    ...row,
    completeness: {
      ...completeness,
      status: classifyOverlayStatus(row, completeness),
    },
    readiness: {
      ...(row?.readiness && typeof row.readiness === "object" ? row.readiness : {}),
      highConfidenceUsProductPageReady: qualifiesHighConfidenceUsProductPage(row, completeness),
    },
  };
};

const main = async () => {
  if (RECOVERED_STAGING_PATHS.length === 0) {
    throw new Error("At least one --recovered-staging-json path is required");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const basePayload = await readJson(BASE_STAGING_PATH);
  const baseRows = Array.isArray(basePayload?.products) ? basePayload.products : [];

  const mergedByKey = new Map();
  const keyOrder = [];
  const baseHashByKey = new Map();

  for (const row of baseRows) {
    const key = buildOverlayRecordKey(row);
    if (!mergedByKey.has(key)) keyOrder.push(key);
    mergedByKey.set(key, row);
    baseHashByKey.set(key, stableHash(row));
  }

  const waves = [];
  let changedExistingRows = 0;
  let addedRows = 0;

  for (const recoveredPath of RECOVERED_STAGING_PATHS) {
    const payload = await readJson(recoveredPath);
    const recoveredRows = Array.isArray(payload?.products) ? payload.products : [];

    let waveChangedExistingRows = 0;
    let waveAddedRows = 0;
    let waveUnchangedSkipped = 0;

    for (const row of recoveredRows) {
      const key = buildOverlayRecordKey(row);
      const rowHash = stableHash(row);
      const baseHash = baseHashByKey.get(key) ?? null;

      if (baseHash && baseHash === rowHash) {
        waveUnchangedSkipped += 1;
        continue;
      }

      const currentRow = mergedByKey.get(key) ?? null;
      if (!shouldApplyRecoveredRow(currentRow, row)) {
        waveUnchangedSkipped += 1;
        continue;
      }

      if (currentRow) {
        mergedByKey.set(key, finalizeRow(row));
        waveChangedExistingRows += 1;
        changedExistingRows += 1;
      } else {
        mergedByKey.set(key, finalizeRow(row));
        keyOrder.push(key);
        waveAddedRows += 1;
        addedRows += 1;
      }
    }

    waves.push({
      label: path.basename(path.dirname(recoveredPath)) || path.basename(recoveredPath),
      recoveredStagingPath: recoveredPath,
      changedExistingRows: waveChangedExistingRows,
      addedRows: waveAddedRows,
      unchangedSkipped: waveUnchangedSkipped,
    });
  }

  const combinedRows = keyOrder.map((key) => mergedByKey.get(key)).filter(Boolean);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    inputs: {
      baseStagingPath: path.relative(ROOT, BASE_STAGING_PATH),
      recoveredStagingPaths: RECOVERED_STAGING_PATHS.map((value) => path.relative(ROOT, value)),
    },
    summary: {
      baseRows: baseRows.length,
      outputRows: combinedRows.length,
      changedExistingRows,
      addedRows,
    },
    waves,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.combined_recovered.json");
  const reportJsonOut = path.join(OUT_DIR, "combined_recovery_report.json");
  const reportMdOut = path.join(OUT_DIR, "combined_recovery_report.md");

  await writeJson(stagingOut, { products: combinedRows });
  await writeJson(reportJsonOut, report);
  await fs.writeFile(reportMdOut, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          stagingJson: path.relative(ROOT, stagingOut),
          reportJson: path.relative(ROOT, reportJsonOut),
          reportMd: path.relative(ROOT, reportMdOut),
        },
        summary: report.summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[combine-iherb-recovered-staging-wave] failed", error);
  process.exitCode = 1;
});
