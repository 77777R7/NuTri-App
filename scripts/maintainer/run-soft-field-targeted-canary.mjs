#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const ACTIVE_IMPORT_QUALITY_PATH = path.join(
  ROOT,
  "docs",
  "exec-plans",
  "active",
  "p0_p3_product_closure",
  "import_quality_validation_report.json",
);

const TARGETED_PACK_DIR = path.resolve(
  ROOT,
  getArg("targeted-pack-dir", path.join("output", "soft_field_priority_run_20260326", "targeted_followup_pack")),
);
const OUT_DIR = path.resolve(
  ROOT,
  getArg("out-dir", path.join("output", "soft_field_priority_run_20260326", "targeted_canary_validation")),
);
const OWNER = getArg("owner", "soft-field-targeted-canary");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}`, "utf8");
};
const toArray = (value) => (Array.isArray(value) ? value : []);

const statusOf = (row) => normalizeText(row?.completeness?.status ?? "unknown");
const missingFieldsOf = (row) => toArray(row?.completeness?.coreMissingFields).map((field) => normalizeText(field)).filter(Boolean);
const hasUsIherbPageOf = (row) => Boolean(row?.sourceSummary?.hasUsIherbPage);
const npnIgnoredOf = (row) => Boolean(row?.sourceSummary?.npnIgnored);
const strictReadyOf = (row) => statusOf(row) === "full_overlay_ready" && hasUsIherbPageOf(row) && !npnIgnoredOf(row);

const loadBaselineInputs = async () => {
  const activeReport = await readJson(ACTIVE_IMPORT_QUALITY_PATH);
  return {
    baselineStagingPath: path.resolve(ROOT, normalizeText(activeReport?.inputs?.stagingPath)),
    baselineMergeReportPath: path.resolve(ROOT, normalizeText(activeReport?.inputs?.mergeReportPath)),
    baselineSummary: activeReport?.summary ?? null,
  };
};

const buildIndex = (rows) =>
  new Map(
    rows
      .map((row, index) => [normalizeText(row?.productId), { row, index }])
      .filter(([productId]) => productId),
  );

const toMarkdown = (report) => {
  const lines = [
    "# Soft-Field Targeted Canary Validation",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- baselineStagingPath: ${report.inputs.baselineStagingPath}`,
    `- targetedPackDir: ${report.inputs.targetedPackDir}`,
    `- canaryStagingPath: ${report.outputs.canaryStagingPath}`,
    `- mergeCoveragePath: ${report.outputs.mergeCoveragePath}`,
    "",
    "## Delta",
    "",
    `- strictMergeReady: ${report.delta.strictMergeReady >= 0 ? "+" : ""}${report.delta.strictMergeReady}`,
    `- queued: ${report.delta.queued >= 0 ? "+" : ""}${report.delta.queued}`,
    `- blocked: ${report.delta.blocked >= 0 ? "+" : ""}${report.delta.blocked}`,
    `- total: ${report.delta.total >= 0 ? "+" : ""}${report.delta.total}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brand of report.brandSummaries) {
    lines.push(`### ${brand.brandName}`);
    lines.push(`- selectedRows: ${brand.selectedRows}`);
    lines.push(`- rowsPatched: ${brand.rowsPatched}`);
    lines.push(`- strictReadyBefore: ${brand.strictReadyBefore}`);
    lines.push(`- strictReadyAfter: ${brand.strictReadyAfter}`);
    lines.push(`- strictReadyDelta: ${brand.strictReadyAfter - brand.strictReadyBefore}`);
    lines.push(`- productIds: ${brand.productIds.join(", ") || "(none)"}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const { baselineStagingPath, baselineMergeReportPath } = await loadBaselineInputs();
  const baselineStagingPayload = await readJson(baselineStagingPath);
  const baselineRows = toArray(baselineStagingPayload?.products);
  const baselineIndex = buildIndex(baselineRows);
  const nextRows = [...baselineRows];
  const baselineMergeReport = await readJson(baselineMergeReportPath);
  const manifest = await readJson(path.join(TARGETED_PACK_DIR, "manifest.json"));

  const patchAuditRows = [];
  const brandSummaries = [];

  for (const brand of toArray(manifest?.brands)) {
    const productIds = toArray(brand?.summary?.productIds).map((value) => normalizeText(value)).filter(Boolean);
    const sourceReportPath = normalizeText(brand?.sourceReportPath);
    const waveDir = sourceReportPath ? path.dirname(sourceReportPath) : null;
    const refreshedStagingPath = waveDir ? path.join(waveDir, "staging_products.official_refreshed.json") : null;
    if (!refreshedStagingPath) continue;

    const refreshedPayload = await readJson(refreshedStagingPath);
    const refreshedRows = toArray(refreshedPayload?.products);
    const refreshedIndex = buildIndex(refreshedRows);

    let rowsPatched = 0;
    let strictReadyBefore = 0;
    let strictReadyAfter = 0;

    for (const productId of productIds) {
      const baselineEntry = baselineIndex.get(productId);
      const refreshedEntry = refreshedIndex.get(productId);
      if (!baselineEntry || !refreshedEntry) continue;

      const beforeRow = baselineEntry.row;
      const afterRow = refreshedEntry.row;
      nextRows[baselineEntry.index] = afterRow;
      rowsPatched += 1;
      if (strictReadyOf(beforeRow)) strictReadyBefore += 1;
      if (strictReadyOf(afterRow)) strictReadyAfter += 1;

      patchAuditRows.push({
        brandName: normalizeText(afterRow?.brandName ?? brand?.brandName),
        productId,
        title: normalizeText(afterRow?.title),
        beforeStatus: statusOf(beforeRow),
        afterStatus: statusOf(afterRow),
        beforeMissingFields: missingFieldsOf(beforeRow),
        afterMissingFields: missingFieldsOf(afterRow),
        strictReadyBefore: strictReadyOf(beforeRow),
        strictReadyAfter: strictReadyOf(afterRow),
      });
    }

    brandSummaries.push({
      brandName: normalizeText(brand?.brandName),
      selectedRows: productIds.length,
      rowsPatched,
      strictReadyBefore,
      strictReadyAfter,
      productIds,
    });
  }

  const canaryStagingPath = path.join(OUT_DIR, "staging_products.targeted_canary.json");
  await writeJson(canaryStagingPath, {
    ...baselineStagingPayload,
    products: nextRows,
  });
  await writeJson(path.join(OUT_DIR, "selected_patch_audit_rows.json"), patchAuditRows);

  const mergeOutDir = path.join(OUT_DIR, "merge_baseline");
  await fs.mkdir(mergeOutDir, { recursive: true });
  const mergeScriptPath = path.join(ROOT, "scripts", "maintainer", "merge-iherb-overlay-bulk-to-supabase.mjs");
  await execFileAsync(process.execPath, [mergeScriptPath, "--input-json", canaryStagingPath, "--out-dir", mergeOutDir, "--owner", OWNER], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024 * 16,
  });

  const canaryMergeReportPath = path.join(mergeOutDir, "overlay_merge_coverage_report.json");
  const canaryMergeReport = await readJson(canaryMergeReportPath);

  const baselineSummary = baselineMergeReport?.summary ?? {};
  const canarySummary = canaryMergeReport?.summary ?? {};
  const delta = {
    strictMergeReady: Number(canarySummary.strictMergeReady ?? 0) - Number(baselineSummary.strictMergeReady ?? 0),
    queued: Number(canarySummary.queued ?? 0) - Number(baselineSummary.queued ?? 0),
    blocked: Number(canarySummary.blocked ?? 0) - Number(baselineSummary.blocked ?? 0),
    total: Number(canarySummary.total ?? 0) - Number(baselineSummary.total ?? 0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      baselineStagingPath,
      baselineMergeReportPath,
      targetedPackDir: TARGETED_PACK_DIR,
      owner: OWNER,
    },
    outputs: {
      canaryStagingPath,
      mergeCoveragePath: canaryMergeReportPath,
      patchAuditRowsPath: path.join(OUT_DIR, "selected_patch_audit_rows.json"),
    },
    baselineSummary,
    canarySummary,
    delta,
    brandSummaries,
  };

  await writeJson(path.join(OUT_DIR, "targeted_canary_validation_report.json"), report);
  await writeText(path.join(OUT_DIR, "targeted_canary_validation_report.md"), toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        delta,
        brandSummaries: brandSummaries.map((brand) => ({
          brandName: brand.brandName,
          rowsPatched: brand.rowsPatched,
          strictReadyDelta: brand.strictReadyAfter - brand.strictReadyBefore,
        })),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
