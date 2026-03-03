#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
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

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
};

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

const normalizeToken = (value) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const keyFrom = ({ identityKey, barcode }) => {
  const id = normalizeIdentity(identityKey);
  if (id) return `identity:${id}`;
  const bc = normalizeBarcode14(barcode);
  if (bc) return `barcode:${bc}`;
  return null;
};

const getRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.selected)) return payload.selected;
  return [];
};

const inferJoinConfidence = (joinBy) => {
  if (joinBy === "identity") return "high";
  if (joinBy === "barcode") return "medium";
  if (joinBy === "fallback") return "low";
  return "low";
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[build-top100-diagnostics-coverage-audit] missing --nightly-dir");
    process.exit(1);
  }

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(nightlyDir, "next_phase");

  const scopeJson =
    resolvePath(getArg("scope-json"))
    ?? path.join(nightlyDir, "phase_b", "new_top100_brand_scope_products.json");
  const baselineDiagJson =
    resolvePath(getArg("ux-baseline-diagnostics-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T081059Z", "ux", "visibility", "ux_visibility_diagnostics.json");
  const currentDiagJson =
    resolvePath(getArg("ux-current-diagnostics-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "ux", "visibility", "ux_visibility_diagnostics.json");

  const defaultOwner = String(getArg("default-owner", "measurement-hardening")).trim() || "measurement-hardening";
  const targetRelease = String(getArg("target-release", "v1.6.14-f-measurement-hardening")).trim() || "v1.6.14-f-measurement-hardening";
  const eta = String(getArg("eta", "2026-03-09")).trim() || "2026-03-09";

  const scope = await readJson(scopeJson);
  const scopeRows = getRows(scope);
  const baselineRows = getRows(await readJson(baselineDiagJson).catch(() => []));
  const currentRows = getRows(await readJson(currentDiagJson).catch(() => []));

  const baselineByIdentity = new Map();
  const baselineByBarcode = new Map();
  for (const row of baselineRows) {
    const identity = normalizeIdentity(row?.identityKey ?? row?.identity_key);
    const barcode = normalizeBarcode14(row?.barcode_gtin14 ?? row?.barcode);
    if (identity) baselineByIdentity.set(identity, row);
    if (barcode) baselineByBarcode.set(barcode, row);
  }

  const currentByIdentity = new Map();
  const currentByBarcode = new Map();
  const currentByToken = new Map();
  for (const row of currentRows) {
    const identity = normalizeIdentity(row?.identityKey ?? row?.identity_key);
    const barcode = normalizeBarcode14(row?.barcode_gtin14 ?? row?.barcode);
    const token = normalizeToken(row?.productName ?? row?.product_name ?? row?.ingredientToken);
    if (identity) currentByIdentity.set(identity, row);
    if (barcode) currentByBarcode.set(barcode, row);
    if (token && !currentByToken.has(token)) currentByToken.set(token, row);
  }

  const audited = [];
  const unmatchedQueue = [];

  let coveredCount = 0;
  let fallbackCount = 0;
  let noneCount = 0;
  let identityJoinCount = 0;
  let barcodeJoinCount = 0;

  for (const row of scopeRows) {
    const identity = normalizeIdentity(row?.identityKey);
    const barcode = normalizeBarcode14(row?.barcodeGtIn14 ?? row?.barcode_gtin14);
    const measurementKey = keyFrom({ identityKey: identity, barcode });

    let joinBy = "none";
    let baselineDiag = null;
    let currentDiag = null;
    let fallbackToken = null;

    if (identity && currentByIdentity.has(identity)) {
      joinBy = "identity";
      currentDiag = currentByIdentity.get(identity);
      baselineDiag = baselineByIdentity.get(identity) ?? null;
      identityJoinCount += 1;
      coveredCount += 1;
    } else if (barcode && currentByBarcode.has(barcode)) {
      joinBy = "barcode";
      currentDiag = currentByBarcode.get(barcode);
      baselineDiag = baselineByBarcode.get(barcode) ?? null;
      barcodeJoinCount += 1;
      coveredCount += 1;
    } else {
      fallbackToken = normalizeToken(row?.productName ?? row?.product_name);
      if (fallbackToken && currentByToken.has(fallbackToken)) {
        joinBy = "fallback";
        currentDiag = currentByToken.get(fallbackToken);
        fallbackCount += 1;
      } else {
        noneCount += 1;
      }
    }

    const joinConfidence = inferJoinConfidence(joinBy);

    const record = {
      market: String(row?.seedMarket ?? "").toUpperCase(),
      seedBrand: row?.seedBrand ?? row?.brandName ?? null,
      productName: row?.productName ?? null,
      sourceType: row?.sourceType ?? null,
      sourceId: row?.sourceId ?? null,
      identityKey: row?.identityKey ?? null,
      barcode_gtin14: barcode,
      measurementKey,
      joinBy,
      joinConfidence,
      fallbackToken,
      diagnosticsFound: joinBy === "identity" || joinBy === "barcode",
      diagnosticsBaselineFound: Boolean(baselineDiag),
      diagnosticsCurrentFound: Boolean(currentDiag),
      bestFor: Boolean(currentDiag?.bestFor),
      scienceSpecificity: Boolean(currentDiag?.scienceSpecificity),
      beforeBuy: Boolean(currentDiag?.beforeBuy),
      formulaExplain: Boolean(currentDiag?.formulaExplain),
    };

    audited.push(record);

    if (joinBy === "none") {
      unmatchedQueue.push({
        identityKey: row?.identityKey ?? null,
        barcode_gtin14: barcode,
        productName: row?.productName ?? null,
        seedBrand: row?.seedBrand ?? row?.brandName ?? null,
        market: String(row?.seedMarket ?? "").toUpperCase(),
        measurementKey,
        joinBy,
        joinConfidence,
        queue: "fixable",
        owner: defaultOwner,
        status: "open",
        reasonCode: "missing_native_diagnostics_join",
        eta,
        targetRelease,
      });
    }
  }

  const total = Math.max(1, scopeRows.length);
  const diagnosticsCoverageRate = coveredCount / total;
  const fallbackUsageRate = fallbackCount / total;

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      scopeJson,
      baselineDiagJson,
      currentDiagJson,
    },
    summary: {
      totalProducts: scopeRows.length,
      diagnosticsCoveredCount: coveredCount,
      diagnosticsCoverageRate,
      identityJoinCount,
      barcodeJoinCount,
      fallbackJoinCount: fallbackCount,
      unmatchedCount: noneCount,
      fallbackUsageRate,
      useUiRateFallbackRecommended: diagnosticsCoverageRate < 0.6,
    },
    gates: {
      hard: {
        diagnosticsCoverageMin: 0.6,
        pass: diagnosticsCoverageRate >= 0.6 && unmatchedQueue.every((row) => row.owner && row.status && row.reasonCode && row.eta),
      },
      soft: {
        diagnosticsCoverageTarget: 0.8,
        fallbackUsageMax: 0.2,
        pass: diagnosticsCoverageRate >= 0.8 || fallbackUsageRate < 0.2,
      },
    },
    rows: audited,
  };

  const reportJson = path.join(outDir, "top100_native_diagnostics_coverage_report.json");
  const reportMd = path.join(outDir, "top100_native_diagnostics_coverage_report.md");
  const unmatchedJsonl = path.join(outDir, "top100_native_diagnostics_unmatched_queue.jsonl");

  await writeJson(reportJson, report);
  await writeJsonl(unmatchedJsonl, unmatchedQueue);

  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  await writeText(
    reportMd,
    [
      "# Top100 Native Diagnostics Coverage Report",
      "",
      `- total products: ${report.summary.totalProducts}`,
      `- diagnosticsCoverageRate: ${pct(report.summary.diagnosticsCoverageRate)}`,
      `- identity joins: ${report.summary.identityJoinCount}`,
      `- barcode joins: ${report.summary.barcodeJoinCount}`,
      `- fallback joins: ${report.summary.fallbackJoinCount}`,
      `- unmatched: ${report.summary.unmatchedCount}`,
      `- fallbackUsageRate: ${pct(report.summary.fallbackUsageRate)}`,
      `- hard gate pass (>=60% + no dangling): ${report.gates.hard.pass}`,
      `- soft gate pass (>=80% or fallback<20%): ${report.gates.soft.pass}`,
      "",
      "## Notes",
      "- measurement key precedence: identity -> barcode -> fallback token.",
      "- unmatched queue is fixable-routed with owner/status/reasonCode/eta.",
      "",
    ].join("\n"),
  );

  console.log("[build-top100-diagnostics-coverage-audit] completed");
  console.log(JSON.stringify({
    reportJson,
    unmatchedJsonl,
    diagnosticsCoverageRate,
    hardPass: report.gates.hard.pass,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-top100-diagnostics-coverage-audit] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
