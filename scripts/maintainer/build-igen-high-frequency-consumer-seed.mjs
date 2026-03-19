#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const ROLLOUT_PLAN_PATH = getArg(
  "rollout-plan",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_official_signal_rollout_plan_full_v2_${TODAY}`,
    "igen_official_signal_rollout_plan.json",
  ),
);
const STAGING_PATH = getArg(
  "staging",
  path.join(
    ROOT,
    "output",
    "iherb_header_facts_week2_closure_v2_20260313",
    "staging_products.parser_enriched.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_high_frequency_consumer_seed_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_high_frequency_consumer_seed.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_high_frequency_consumer_seed.md"));

const safeText = (value) => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    }),
  );

const isFullOverlayReady = (row) =>
  safeText(row?.completeness?.status) === "full_overlay_ready" &&
  Array.isArray(row?.completeness?.coreMissingFields) &&
  row.completeness.coreMissingFields.length === 0;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN High-Frequency Consumer Seed");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Rollout plan: ${report.inputs.rolloutPlanPath}`);
  lines.push(`Staging path: ${report.inputs.stagingPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- candidate rows from rollout plan: ${report.summary.rolloutCandidates}`);
  lines.push(`- consumer-ready rows: ${report.summary.consumerReadyRows}`);
  lines.push(`- high-frequency complete rows: ${report.summary.highFrequencyCompleteRows}`);
  lines.push(`- stale P0 rows recovered by staging check: ${report.summary.staleP0RecoveredRows}`);
  lines.push("");
  lines.push("## Brand Mix");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Rows");
  lines.push("");
  for (const row of report.rows) {
    lines.push(`- ${row.brandName} | ${row.productName} | productId=${row.productId} | barcode=${row.barcode} | evidence=${row.officialRegistryEvidenceUrl}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const rolloutPlan = JSON.parse(await fs.readFile(ROLLOUT_PLAN_PATH, "utf8"));
  const stagingPayload = JSON.parse(await fs.readFile(STAGING_PATH, "utf8"));
  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];

  const stagingByProductId = new Map(
    stagingRows
      .filter((row) => safeText(row?.productId))
      .map((row) => [safeText(row.productId), row]),
  );

  const rolloutRows = [
    ...(Array.isArray(rolloutPlan?.p0Rows) ? rolloutPlan.p0Rows : []),
    ...(Array.isArray(rolloutPlan?.p1Rows) ? rolloutPlan.p1Rows : []),
  ];

  const rows = [];
  let staleP0RecoveredRows = 0;

  for (const row of rolloutRows) {
    const stagingRow = stagingByProductId.get(safeText(row?.productId)) ?? null;
    const completeByHighFrequency = safeText(row?.validationOutcome) === "complete_hit";
    const completeByCurrentStaging = Boolean(stagingRow) && isFullOverlayReady(stagingRow);
    if (!completeByHighFrequency && !completeByCurrentStaging) continue;

    if (!completeByHighFrequency && completeByCurrentStaging) {
      staleP0RecoveredRows += 1;
    }

    rows.push({
      key: row.key ?? null,
      productId: row.productId ?? null,
      barcode: row.barcode ?? null,
      brandName: row.brandName ?? null,
      productName: row.productName ?? null,
      iherbUrl: row.iherbUrl ?? null,
      officialSignalProgramId: row.officialSignalProgramId ?? "igen",
      officialSignalProgramLabel: row.officialSignalProgramLabel ?? "iGEN",
      officialSignalState: row.officialSignalState ?? null,
      officialRegistryEvidenceUrl: row.officialRegistryEvidenceUrl ?? null,
      officialRegistryMatchStatus: row.officialRegistryMatchStatus ?? null,
      officialRegistryMatchLevel: row.officialRegistryMatchLevel ?? null,
      sourceReasonCode: row.sourceReasonCode ?? null,
      patchPriorityScore: row.patchPriorityScore ?? null,
      validationOutcome: row.validationOutcome ?? null,
      currentStagingStatus: stagingRow?.completeness?.status ?? null,
      currentCoreMissingFields: Array.isArray(stagingRow?.completeness?.coreMissingFields)
        ? stagingRow.completeness.coreMissingFields
        : [],
      sourceClassification:
        completeByHighFrequency
          ? "high_frequency_complete_hit"
          : "stale_high_frequency_gap_recovered_by_current_staging",
    });
  }

  rows.sort((a, b) => {
    const brandDelta = safeText(a.brandName).localeCompare(safeText(b.brandName));
    if (brandDelta !== 0) return brandDelta;
    return safeText(a.productName).localeCompare(safeText(b.productName));
  });

  const brandCounts = {};
  for (const row of rows) increment(brandCounts, safeText(row.brandName) || "unknown");

  const report = {
    schemaVersion: "igen_high_frequency_consumer_seed.v1",
    generatedAt: nowIso(),
    inputs: {
      rolloutPlanPath: ROLLOUT_PLAN_PATH,
      stagingPath: STAGING_PATH,
    },
    summary: {
      rolloutCandidates: rolloutRows.length,
      consumerReadyRows: rows.length,
      highFrequencyCompleteRows: rows.filter((row) => row.sourceClassification === "high_frequency_complete_hit").length,
      staleP0RecoveredRows,
    },
    brandCounts: sortCounts(brandCounts),
    rows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        consumerReadyRows: report.summary.consumerReadyRows,
        highFrequencyCompleteRows: report.summary.highFrequencyCompleteRows,
        staleP0RecoveredRows: report.summary.staleP0RecoveredRows,
        outJson: OUT_JSON,
        outMd: OUT_MD,
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
