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

const BATCHES_PATH = getArg(
  "batches-json",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_consumer_rollout_pack_full_v2_${TODAY}`,
    "wave2_brand_expansion_batches.json",
  ),
);
const BATCH_LABEL = getArg("batch-label", "wave2_brand_batch_1");
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
  path.join(ROOT, "output", "quality_marks", `${BATCH_LABEL}_igen_brand_expansion_wave_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "brand_expansion_wave.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "brand_expansion_wave.md"));
const OUT_CONSUMER = getArg("consumer-json", path.join(OUT_DIR, "consumer_ready_rows.json"));
const OUT_PATCH = getArg("patch-json", path.join(OUT_DIR, "patch_queue_rows.json"));

const safeText = (value) => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();
const normalizeLower = (value) => safeText(value).toLowerCase();

const isFull = (row) =>
  safeText(row?.completeness?.status) === "full_overlay_ready" &&
  Array.isArray(row?.completeness?.coreMissingFields) &&
  row.completeness.coreMissingFields.length === 0;

const isPartial = (row) => safeText(row?.completeness?.status) === "partial_overlay";

const toMarkdown = (report) => {
  const lines = [];
  lines.push(`# iGEN Brand Expansion Wave: ${report.batch.batchLabel}`);
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Batches path: ${report.inputs.batchesPath}`);
  lines.push(`Staging path: ${report.inputs.stagingPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- brand: ${report.batch.brandName}`);
  lines.push(`- batch rows: ${report.summary.totalRows}`);
  lines.push(`- consumer-ready rows: ${report.summary.consumerReadyRows}`);
  lines.push(`- patch-queue rows: ${report.summary.patchQueueRows}`);
  lines.push(`- other rows: ${report.summary.otherRows}`);
  lines.push(`- missing staging rows: ${report.summary.missingRows}`);
  lines.push("");
  lines.push("## Patch Queue");
  lines.push("");
  for (const row of report.patchQueueRows) {
    lines.push(`- ${row.productId} | ${row.brandName} | ${row.title} | missing=${row.coreMissingFields.join(", ") || "none"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [batchPayload, stagingPayload] = await Promise.all([
    fs.readFile(BATCHES_PATH, "utf8").then(JSON.parse),
    fs.readFile(STAGING_PATH, "utf8").then(JSON.parse),
  ]);

  const batch = (Array.isArray(batchPayload?.batches) ? batchPayload.batches : []).find(
    (row) => safeText(row?.batchLabel) === BATCH_LABEL,
  );
  if (!batch) {
    throw new Error(`Batch not found: ${BATCH_LABEL}`);
  }

  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const stagingByProductId = new Map(
    stagingRows
      .filter((row) => safeText(row?.productId))
      .map((row) => [safeText(row.productId), row]),
  );

  const consumerReadyRows = [];
  const patchQueueRows = [];
  const otherRows = [];
  const missingRows = [];

  for (const row of Array.isArray(batch.rows) ? batch.rows : []) {
    const stagingRow = stagingByProductId.get(safeText(row?.productId)) ?? null;
    if (!stagingRow) {
      missingRows.push({
        ...row,
        currentStagingStatus: null,
        currentCoreMissingFields: [],
      });
      continue;
    }

    const currentStatus = safeText(stagingRow?.completeness?.status) || "unknown";
    const currentMissing = Array.isArray(stagingRow?.completeness?.coreMissingFields)
      ? stagingRow.completeness.coreMissingFields
      : [];

    const base = {
      ...row,
      currentStagingStatus: currentStatus,
      currentCoreMissingFields: currentMissing,
    };

    if (isFull(stagingRow)) {
      consumerReadyRows.push(base);
      continue;
    }

    if (isPartial(stagingRow)) {
      patchQueueRows.push({
        priorityLane: "P0_api_fill_us_strong_identity",
        productId: safeText(row?.productId),
        brandName: row?.brandName ?? null,
        title: row?.productName ?? null,
        barcode: row?.barcode ?? null,
        link: row?.iherbUrl ?? null,
        coreMissingFields: currentMissing,
        officialSignalProgramId: row?.officialSignalProgramId ?? "igen",
        officialRegistryEvidenceUrl: row?.officialRegistryEvidenceUrl ?? null,
      });
      continue;
    }

    otherRows.push(base);
  }

  const report = {
    schemaVersion: "igen_brand_expansion_wave.v1",
    generatedAt: nowIso(),
    inputs: {
      batchesPath: BATCHES_PATH,
      stagingPath: STAGING_PATH,
    },
    batch: {
      batchLabel: safeText(batch.batchLabel),
      brandName: Array.isArray(batch.brands) ? batch.brands.join(", ") : null,
    },
    summary: {
      totalRows: Array.isArray(batch.rows) ? batch.rows.length : 0,
      consumerReadyRows: consumerReadyRows.length,
      patchQueueRows: patchQueueRows.length,
      otherRows: otherRows.length,
      missingRows: missingRows.length,
    },
    consumerReadyRows,
    patchQueueRows,
    otherRows,
    missingRows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_CONSUMER, `${JSON.stringify(consumerReadyRows, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_PATCH, `${JSON.stringify(patchQueueRows, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        batchLabel: report.batch.batchLabel,
        consumerReadyRows: report.summary.consumerReadyRows,
        patchQueueRows: report.summary.patchQueueRows,
        missingRows: report.summary.missingRows,
        outJson: OUT_JSON,
        patchJson: OUT_PATCH,
        consumerJson: OUT_CONSUMER,
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
