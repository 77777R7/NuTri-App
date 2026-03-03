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

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();

const keyFrom = ({ identityKey, barcode }) => {
  const id = normalizeIdentity(identityKey);
  if (id) return `identity:${id}`;
  const bc = normalizeBarcode14(barcode);
  if (bc) return `barcode:${bc}`;
  return null;
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[build-new-top100-product-level-ux-impact] missing --nightly-dir");
    process.exit(1);
  }

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(nightlyDir, "next_phase");

  const scopeJson =
    resolvePath(getArg("scope-json"))
    ?? path.join(nightlyDir, "phase_b", "new_top100_brand_scope_products.json");
  const lane1CandidatesJsonl =
    resolvePath(getArg("lane1-candidates-jsonl"))
    ?? path.join(nightlyDir, "phase_d", "step1_candidates", "lane1_top100_patch_candidates.jsonl");
  const batchesDir =
    resolvePath(getArg("batches-dir"))
    ?? path.join(nightlyDir, "phase_d", "batches");

  const baselineDiagnosticsJson =
    resolvePath(getArg("ux-baseline-diagnostics-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T081059Z", "ux", "visibility", "ux_visibility_diagnostics.json");
  const currentDiagnosticsJson =
    resolvePath(getArg("ux-current-diagnostics-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "ux", "visibility", "ux_visibility_diagnostics.json");
  const oldTop100BaselineReportJson =
    resolvePath(getArg("old-top100-baseline-report-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "analysis", "top100_patch_ux_coverage_report.json");
  const newTop100CoverageReportJson =
    resolvePath(getArg("new-top100-coverage-report-json"))
    ?? path.join(nightlyDir, "phase_f", "new_top100_patch_ux_coverage_report.json");
  const diagnosticsAuditJson =
    resolvePath(getArg("diagnostics-audit-json"))
    ?? path.join(outDir, "top100_native_diagnostics_coverage_report.json");

  const scope = await readJson(scopeJson);
  const scopeRows = Array.isArray(scope?.rows) ? scope.rows : [];
  const lane1Candidates = await readJsonl(lane1CandidatesJsonl);

  const baselineDiag = await readJson(baselineDiagnosticsJson).catch(() => []);
  const currentDiag = await readJson(currentDiagnosticsJson).catch(() => []);
  const oldBaselineReport = await readJson(oldTop100BaselineReportJson).catch(() => null);
  const newCoverageReport = await readJson(newTop100CoverageReportJson).catch(() => null);
  const diagnosticsAudit = await readJson(diagnosticsAuditJson).catch(() => null);

  const lane1CandidateKeySet = new Set();
  for (const row of lane1Candidates) {
    const key = keyFrom({
      identityKey: row?.identityKey,
      barcode: row?.barcode_gtin14 ?? row?.barcode,
    });
    if (key) lane1CandidateKeySet.add(key);
  }

  const enforcedKeySet = new Set();
  const batchEntries = await fs.readdir(batchesDir, { withFileTypes: true }).catch(() => []);
  for (const ent of batchEntries) {
    if (!ent.isDirectory()) continue;
    const batchDir = path.join(batchesDir, ent.name);
    const enforceReport = await readJson(path.join(batchDir, "enforce", "enforce_report.json")).catch(() => null);
    if (!enforceReport?.enforceApplied) continue;
    const enforceReady = await readJsonl(path.join(batchDir, "postfilter", "enforce_ready.jsonl"));
    for (const row of enforceReady) {
      const key = keyFrom({ identityKey: row?.identityKey, barcode: row?.barcode_gtin14 ?? row?.barcode });
      if (key) enforcedKeySet.add(key);
    }
  }

  const baselineDiagMap = new Map();
  for (const row of Array.isArray(baselineDiag) ? baselineDiag : []) {
    const key = keyFrom({ identityKey: row?.identityKey, barcode: row?.barcode_gtin14 ?? row?.barcode });
    if (key) baselineDiagMap.set(key, row);
  }

  const currentDiagMap = new Map();
  for (const row of Array.isArray(currentDiag) ? currentDiag : []) {
    const key = keyFrom({ identityKey: row?.identityKey, barcode: row?.barcode_gtin14 ?? row?.barcode });
    if (key) currentDiagMap.set(key, row);
  }

  const auditByMeasurementKey = new Map();
  for (const row of Array.isArray(diagnosticsAudit?.rows) ? diagnosticsAudit.rows : []) {
    const measurementKey = String(row?.measurementKey ?? "").trim();
    if (!measurementKey) continue;
    if (!auditByMeasurementKey.has(measurementKey)) auditByMeasurementKey.set(measurementKey, row);
  }

  const products = [];
  const brandRollup = new Map();

  let bestForVisible = 0;
  let scienceVisible = 0;
  let beforeBuyVisible = 0;
  let formulaVisible = 0;
  let directionsVisible = 0;

  let bestForBaseline = 0;
  let scienceBaseline = 0;
  let beforeBuyBaseline = 0;
  let formulaBaseline = 0;
  let directionsBaseline = 0;
  let diagnosticsMatchedCount = 0;

  for (const row of scopeRows) {
    const key = keyFrom({ identityKey: row?.identityKey, barcode: row?.barcodeGtIn14 });
    const b = key ? baselineDiagMap.get(key) : null;
    const c = key ? currentDiagMap.get(key) : null;
    if (b || c) diagnosticsMatchedCount += 1;
    const auditJoin = key ? auditByMeasurementKey.get(key) : null;
    const joinBy = auditJoin?.joinBy ?? (b || c ? (String(key).startsWith("identity:") ? "identity" : "barcode") : "fallback");
    const joinConfidence = auditJoin?.joinConfidence ?? (joinBy === "identity" ? "high" : joinBy === "barcode" ? "medium" : "low");

    const baselineDirections = Boolean(row?.hasDirectionsText);
    const lane1Candidate = key ? lane1CandidateKeySet.has(key) : false;
    const lane1Enforced = key ? enforcedKeySet.has(key) : false;
    const currentDirections = baselineDirections || lane1Enforced;

    const baseBest = Boolean(b?.bestFor);
    const currBest = Boolean(c?.bestFor);
    const baseScience = Boolean(b?.scienceSpecificity);
    const currScience = Boolean(c?.scienceSpecificity);
    const baseBefore = Boolean(b?.beforeBuy);
    const currBefore = Boolean(c?.beforeBuy);
    const baseFormula = Boolean(b?.formulaExplain);
    const currFormula = Boolean(c?.formulaExplain);

    bestForVisible += currBest ? 1 : 0;
    scienceVisible += currScience ? 1 : 0;
    beforeBuyVisible += currBefore ? 1 : 0;
    formulaVisible += currFormula ? 1 : 0;
    directionsVisible += currentDirections ? 1 : 0;

    bestForBaseline += baseBest ? 1 : 0;
    scienceBaseline += baseScience ? 1 : 0;
    beforeBuyBaseline += baseBefore ? 1 : 0;
    formulaBaseline += baseFormula ? 1 : 0;
    directionsBaseline += baselineDirections ? 1 : 0;

    const product = {
      market: String(row?.seedMarket ?? "").toUpperCase(),
      brandName: row?.seedBrand ?? row?.brandName ?? "UNKNOWN",
      productName: row?.productName ?? null,
      sourceType: row?.sourceType ?? null,
      sourceId: row?.sourceId ?? null,
      matchedBy: row?.matchedBy ?? null,
      matchedTerm: row?.matchedTerm ?? null,
      matchSignals: row?.matchSignals ?? null,
      identityKey: row?.identityKey ?? null,
      barcode_gtin14: normalizeBarcode14(row?.barcodeGtIn14),
      measurementKey: key,
      joinBy,
      joinConfidence,
      lane1_candidate: lane1Candidate,
      lane1_enforced: lane1Enforced,
      baseline: {
        best_for: baseBest,
        science_specificity: baseScience,
        before_you_buy: baseBefore,
        formula_explainability: baseFormula,
        directions_visible: baselineDirections,
      },
      current: {
        best_for: currBest,
        science_specificity: currScience,
        before_you_buy: currBefore,
        formula_explainability: currFormula,
        directions_visible: currentDirections,
      },
      delta: {
        best_for_added: !baseBest && currBest,
        science_specificity_added: !baseScience && currScience,
        before_you_buy_added: !baseBefore && currBefore,
        formula_explainability_added: !baseFormula && currFormula,
        directions_added: !baselineDirections && currentDirections,
      },
    };
    products.push(product);

    const brandKey = `${product.market}::${product.brandName}`;
    const agg = brandRollup.get(brandKey) ?? {
      market: product.market,
      brandName: product.brandName,
      productCountInDB: 0,
      lane1_candidates: 0,
      lane1_enforced: 0,
      runtimeHitCount: 0,
      uiVisibleDelta: {
        best_for_added: 0,
        science_specificity_added: 0,
        directions_added: 0,
        before_you_buy_added: 0,
      },
    };
    agg.productCountInDB += 1;
    if (lane1Candidate) agg.lane1_candidates += 1;
    if (lane1Enforced) agg.lane1_enforced += 1;
    if (product.delta.best_for_added) agg.uiVisibleDelta.best_for_added += 1;
    if (product.delta.science_specificity_added) agg.uiVisibleDelta.science_specificity_added += 1;
    if (product.delta.before_you_buy_added) agg.uiVisibleDelta.before_you_buy_added += 1;
    if (product.delta.directions_added) agg.uiVisibleDelta.directions_added += 1;
    brandRollup.set(brandKey, agg);
  }

  const total = Math.max(1, products.length);
  const diagnosticsCoverageRate = diagnosticsMatchedCount / total;
  const resolvedDiagnosticsCoverageRate =
    diagnosticsAudit?.summary?.diagnosticsCoverageRate ?? diagnosticsCoverageRate;
  const resolvedFallbackUsageRate =
    diagnosticsAudit?.summary?.fallbackUsageRate ?? 0;
  const oldUi = oldBaselineReport?.summary?.ui_visible_uplift_rate ?? {};
  const newUi = newCoverageReport?.summary?.ui_visible_uplift_rate ?? {};

  const useUiRateFallback = resolvedDiagnosticsCoverageRate < 0.6;

  const rates = {
    baseline: {
      best_for_visible_rate: useUiRateFallback
        ? asNumber(oldUi?.best_for_visibility_rate, bestForBaseline / total)
        : (bestForBaseline / total),
      science_specificity_rate: useUiRateFallback
        ? asNumber(oldUi?.science_specificity_rate, scienceBaseline / total)
        : (scienceBaseline / total),
      before_you_buy_completeness_rate: useUiRateFallback
        ? asNumber(oldUi?.before_you_buy_completeness_rate, beforeBuyBaseline / total)
        : (beforeBuyBaseline / total),
      formula_explainability_rate: useUiRateFallback
        ? asNumber(oldUi?.formula_explainability_rate, formulaBaseline / total)
        : (formulaBaseline / total),
      directions_visible_rate: useUiRateFallback
        ? asNumber(oldUi?.directions_visibility_proxy_rate_on_lane1_candidates, directionsBaseline / total)
        : (directionsBaseline / total),
    },
    current: {
      best_for_visible_rate: useUiRateFallback
        ? asNumber(newUi?.best_for_visibility_rate, bestForVisible / total)
        : (bestForVisible / total),
      science_specificity_rate: useUiRateFallback
        ? asNumber(newUi?.science_specificity_rate, scienceVisible / total)
        : (scienceVisible / total),
      before_you_buy_completeness_rate: useUiRateFallback
        ? asNumber(newUi?.before_you_buy_completeness_rate, beforeBuyVisible / total)
        : (beforeBuyVisible / total),
      formula_explainability_rate: useUiRateFallback
        ? asNumber(newUi?.formula_explainability_rate, formulaVisible / total)
        : (formulaVisible / total),
      directions_visible_rate: useUiRateFallback
        ? asNumber(newUi?.directions_visibility_proxy_rate_on_lane1_candidates, directionsVisible / total)
        : (directionsVisible / total),
    },
  };

  const deltas = {
    best_for_visible_rate_delta: rates.current.best_for_visible_rate - rates.baseline.best_for_visible_rate,
    science_specificity_rate_delta: rates.current.science_specificity_rate - rates.baseline.science_specificity_rate,
    before_you_buy_completeness_rate_delta: rates.current.before_you_buy_completeness_rate - rates.baseline.before_you_buy_completeness_rate,
    formula_explainability_rate_delta: rates.current.formula_explainability_rate - rates.baseline.formula_explainability_rate,
    directions_visible_rate_delta: rates.current.directions_visible_rate - rates.baseline.directions_visible_rate,
  };

  const oldRef = oldBaselineReport?.summary?.ui_visible_uplift_rate ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      scopeJson,
      lane1CandidatesJsonl,
      batchesDir,
      baselineDiagnosticsJson,
      currentDiagnosticsJson,
      oldTop100BaselineReportJson,
      diagnosticsAuditJson,
    },
    summary: {
      totalProducts: products.length,
      lane1CandidateProducts: products.filter((p) => p.lane1_candidate).length,
      lane1EnforcedProducts: products.filter((p) => p.lane1_enforced).length,
      rates,
      deltas,
      oldTop100BaselineReference: oldRef,
      diagnosticsMatchedCount,
      diagnosticsCoverageRate: resolvedDiagnosticsCoverageRate,
      fallbackUsageRate: resolvedFallbackUsageRate,
      useUiRateFallback,
    },
    brands: [...brandRollup.values()].sort((a, b) => b.lane1_candidates - a.lane1_candidates || b.productCountInDB - a.productCountInDB || a.brandName.localeCompare(b.brandName)),
    products,
  };

  const outJson = path.join(outDir, "new_top100_product_level_ux_impact.json");
  const outMd = path.join(outDir, "new_top100_product_level_ux_impact.md");
  await writeJson(outJson, report);

  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  await writeText(
    outMd,
    [
      "# New Top100 Product-level UX Impact",
      "",
      "## Summary / 摘要",
      `- totalProducts: ${report.summary.totalProducts}`,
      `- lane1CandidateProducts: ${report.summary.lane1CandidateProducts}`,
      `- lane1EnforcedProducts: ${report.summary.lane1EnforcedProducts}`,
      "",
      "## Current Rates / 当前可见率",
      `- Best for: ${pct(rates.current.best_for_visible_rate)}`,
      `- Science specificity: ${pct(rates.current.science_specificity_rate)}`,
      `- Before you buy: ${pct(rates.current.before_you_buy_completeness_rate)}`,
      `- Formula explainability: ${pct(rates.current.formula_explainability_rate)}`,
      `- Directions visible: ${pct(rates.current.directions_visible_rate)}`,
      "",
      "## Delta vs Baseline / 相对基线增量",
      `- Best for delta: ${pct(deltas.best_for_visible_rate_delta)}`,
      `- Science specificity delta: ${pct(deltas.science_specificity_rate_delta)}`,
      `- Before you buy delta: ${pct(deltas.before_you_buy_completeness_rate_delta)}`,
      `- Formula explainability delta: ${pct(deltas.formula_explainability_rate_delta)}`,
      `- Directions visible delta: ${pct(deltas.directions_visible_rate_delta)}`,
      "",
      "## Notes / 说明",
      "- Directions visible is computed as hasDirectionsText OR lane1_enforced.",
      "- Best for / Science specificity / Before you buy / Formula are measured from visibility diagnostics mapping by identity/barcode.",
      "",
    ].join("\n"),
  );

  console.log("[build-new-top100-product-level-ux-impact] completed");
  console.log(JSON.stringify({
    outJson,
    totalProducts: report.summary.totalProducts,
    currentRates: report.summary.rates.current,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-product-level-ux-impact] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
