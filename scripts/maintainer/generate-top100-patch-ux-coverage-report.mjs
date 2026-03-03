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

const hasArg = (flag) => args.includes(`--${flag}`);

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

const asRate = (numerator, denominator) => (denominator > 0 ? numerator / denominator : 0);

const normalizeBrand = (value) => String(value ?? "").trim() || "UNKNOWN_BRAND";
const normalizeMarket = (value) => String(value ?? "").trim().toUpperCase() || "NA";
const seedKeyOf = (market, brand) => `${normalizeMarket(market)}::${normalizeBrand(brand)}`;

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();
const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const addToSetMap = (map, key, value) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
};

const pickKey = (row) => {
  const identity = normalizeIdentity(row?.identityKey ?? row?.identity_key);
  if (identity) return `identity:${identity}`;
  const barcode = normalizeBarcode(row?.barcode_gtin14 ?? row?.barcodeGtIn14 ?? row?.barcode);
  if (barcode) return `barcode:${barcode}`;
  return null;
};

const main = async () => {
  const top100Dir =
    resolvePath(getArg("top100-dir"))
    ?? path.join(ROOT, "output", "v1.6.14-top100-lane1-scale-20260302T032106Z");
  const uxBaselineDir =
    resolvePath(getArg("ux-baseline-dir"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T081059Z", "ux", "visibility");
  const uxCurrentDir =
    resolvePath(getArg("ux-current-dir"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "ux", "visibility");
  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "analysis");
  const reportName = String(getArg("report-name", "top100_patch_ux_coverage_report")).trim() || "top100_patch_ux_coverage_report";

  const scopePath = resolvePath(getArg("scope-json"))
    ?? path.join(top100Dir, "step0_universe", "top100_brand_product_scope.json");
  const lane1CandidatesPath = resolvePath(getArg("lane1-candidates-jsonl"))
    ?? path.join(top100Dir, "step1_candidates", "lane1_top100_patch_candidates.jsonl");
  const customScopeProvided =
    hasArg("scope-json")
    || hasArg("lane1-candidates-jsonl")
    || hasArg("batches-dir")
    || hasArg("out-dir");
  const explicitGlobalCloseoutProvided = hasArg("global-closeout-json");
  const globalCloseoutPath = explicitGlobalCloseoutProvided
    ? resolvePath(getArg("global-closeout-json"))
    : customScopeProvided
      ? null
      : path.join(top100Dir, "step6_closeout", "top100_lane1_global_closeout_report.json");
  const batchesRoot = resolvePath(getArg("batches-dir"))
    ?? path.join(top100Dir, "batches");
  const uxBaselineReportPath = path.join(uxBaselineDir, "ux_visibility_report.json");
  const uxCurrentReportPath = path.join(uxCurrentDir, "ux_visibility_report.json");
  const uxBaselineDiagPath = path.join(uxBaselineDir, "ux_visibility_diagnostics.json");
  const uxCurrentDiagPath = path.join(uxCurrentDir, "ux_visibility_diagnostics.json");

  const scopePayload = await readJson(scopePath);
  const scopeRows = Array.isArray(scopePayload?.rows) ? scopePayload.rows : [];
  const lane1Candidates = await readJsonl(lane1CandidatesPath);
  const globalCloseout = globalCloseoutPath
    ? await readJson(globalCloseoutPath).catch(() => null)
    : null;
  const uxBaselineReport = await readJson(uxBaselineReportPath);
  const uxCurrentReport = await readJson(uxCurrentReportPath);
  const uxBaselineDiag = await readJson(uxBaselineDiagPath);
  const uxCurrentDiag = await readJson(uxCurrentDiagPath);

  const aliasQueuePath = path.join(top100Dir, "step0_universe", "brand_alias_fix_queue.jsonl");

  const identityToSeed = new Map();
  const barcodeToSeedCount = new Map();
  const productIdentityBySeed = new Map();
  const seedInfoByKey = new Map();
  const allSeedKeys = new Set();

  for (const row of scopeRows) {
    const market = normalizeMarket(row?.seedMarket ?? row?.market);
    const brand = normalizeBrand(row?.seedBrand ?? row?.brandName);
    const seedKey = seedKeyOf(market, brand);
    allSeedKeys.add(seedKey);
    if (!seedInfoByKey.has(seedKey)) seedInfoByKey.set(seedKey, { market, brandName: brand });
    const identity = normalizeIdentity(row?.identityKey ?? row?.identity_key);
    const barcode = normalizeBarcode(row?.barcodeGtIn14 ?? row?.barcode_gtin14 ?? row?.barcode);
    if (identity) identityToSeed.set(identity, seedKey);
    if (barcode) {
      const key = `${barcode}::${seedKey}`;
      barcodeToSeedCount.set(key, (barcodeToSeedCount.get(key) || 0) + 1);
    }
    addToSetMap(productIdentityBySeed, seedKey, identity || `${seedKey}-identity-missing`);
  }

  const aliasRows = await readJsonl(aliasQueuePath).catch(() => []);
  for (const row of aliasRows) {
    const market = normalizeMarket(row?.market);
    const brand = normalizeBrand(row?.brand);
    const seedKey = seedKeyOf(market, brand);
    allSeedKeys.add(seedKey);
    if (!seedInfoByKey.has(seedKey)) seedInfoByKey.set(seedKey, { market, brandName: brand });
  }

  const barcodeToSeed = new Map();
  for (const [key, count] of barcodeToSeedCount.entries()) {
    const sep = key.indexOf("::");
    const barcode = key.slice(0, sep);
    const seedKey = key.slice(sep + 2);
    const prev = barcodeToSeed.get(barcode);
    if (!prev || count > prev.count) {
      barcodeToSeed.set(barcode, { seedKey, count });
    }
  }

  const lane1CandidatesBySeed = new Map();
  const lane1CandidateBarcodesBySeed = new Map();
  for (const row of lane1Candidates) {
    const market = normalizeMarket(row?.market ?? row?.seedMarket);
    const brand = normalizeBrand(row?.seedBrand ?? row?.brandName);
    const seedKey = seedKeyOf(market, brand);
    allSeedKeys.add(seedKey);
    if (!seedInfoByKey.has(seedKey)) seedInfoByKey.set(seedKey, { market, brandName: brand });
    const barcode = normalizeBarcode(row?.barcode_gtin14 ?? row?.barcode);
    lane1CandidatesBySeed.set(seedKey, (lane1CandidatesBySeed.get(seedKey) || 0) + 1);
    if (barcode) addToSetMap(lane1CandidateBarcodesBySeed, seedKey, barcode);
  }

  const batchNames = (await fs.readdir(batchesRoot, { withFileTypes: true }).catch(() => []))
    .filter((ent) => ent.isDirectory())
    .map((ent) => ent.name)
    .sort();

  const lane1EnforcedBySeed = new Map();
  const runtimeHitBySeed = new Map();
  const runtimeHitBatchIdsBySeed = new Map();
  const runtimeHitBarcodesGlobal = new Set();
  let runtimeCanHitBarcodesTotal = 0;
  let runtimeHitUnattributedBarcodeCount = 0;
  const runtimeScopeMismatchBatchIds = new Set();

  for (const batchName of batchNames) {
    const batchDir = path.join(batchesRoot, batchName);
    const enforceReportPath = path.join(batchDir, "enforce", "enforce_report.json");
    const enforceReadyPath = path.join(batchDir, "postfilter", "enforce_ready.jsonl");
    const gateReportPath = path.join(batchDir, "batch_gate_report.json");
    const barcodesPath = path.join(batchDir, "barcodes.json");

    const enforceReport = await readJson(enforceReportPath).catch(() => null);
    const gateReport = await readJson(gateReportPath).catch(() => null);
    const barcodesPayload = await readJson(barcodesPath).catch(() => ({ barcodes: [] }));

    runtimeCanHitBarcodesTotal += asNumber(gateReport?.counts?.uniqueBarcodesTotalAvailable, 0);

      if (enforceReport?.enforceApplied) {
      const enforceRows = await readJsonl(enforceReadyPath).catch(() => []);
      for (const row of enforceRows) {
        const market = normalizeMarket(row?.market ?? row?.seedMarket);
        const brand = normalizeBrand(row?.seedBrand ?? row?.brandName);
        const seedKey = seedKeyOf(market, brand);
        allSeedKeys.add(seedKey);
        if (!seedInfoByKey.has(seedKey)) seedInfoByKey.set(seedKey, { market, brandName: brand });
        lane1EnforcedBySeed.set(seedKey, (lane1EnforcedBySeed.get(seedKey) || 0) + 1);
      }
    }

    const hasRuntimeHit = asNumber(gateReport?.metrics?.runtimePatchHitCountDelta, 0) > 0;
    if (hasRuntimeHit) {
      const sampledBarcodes = Array.isArray(barcodesPayload?.barcodes) ? barcodesPayload.barcodes : [];
      let mappedInBatch = 0;
      for (const item of sampledBarcodes) {
        const barcode = normalizeBarcode(item?.barcode ?? item);
        if (!barcode) continue;
        runtimeHitBarcodesGlobal.add(barcode);
        const hitSeed = barcodeToSeed.get(barcode)?.seedKey;
        if (!hitSeed) {
          runtimeHitUnattributedBarcodeCount += 1;
          continue;
        }
        mappedInBatch += 1;
        runtimeHitBySeed.set(hitSeed, (runtimeHitBySeed.get(hitSeed) || 0) + 1);
        addToSetMap(runtimeHitBatchIdsBySeed, hitSeed, batchName);
      }
      if (mappedInBatch === 0) {
        runtimeScopeMismatchBatchIds.add(batchName);
      }
    }
  }

  const baselineByKey = new Map();
  for (const row of uxBaselineDiag) {
    const key = pickKey(row);
    if (!key) continue;
    baselineByKey.set(key, row);
  }

  const uiCurrentCountsBySeed = new Map();
  const uiDeltaBySeed = new Map();
  const ensureUi = (seedKey) => {
    if (!uiCurrentCountsBySeed.has(seedKey)) {
      uiCurrentCountsBySeed.set(seedKey, {
        sampleRows: 0,
        best_for_visible: 0,
        science_specific_visible: 0,
        formula_explainable_visible: 0,
        before_you_buy_visible: 0,
      });
    }
    if (!uiDeltaBySeed.has(seedKey)) {
      uiDeltaBySeed.set(seedKey, {
        best_for_added: 0,
        science_specificity_added: 0,
        formula_explainability_added: 0,
        before_you_buy_added: 0,
      });
    }
  };

  for (const row of uxCurrentDiag) {
    const key = pickKey(row);
    const baseline = key ? baselineByKey.get(key) : null;
    const identity = normalizeIdentity(row?.identityKey ?? row?.identity_key);
    const barcode = normalizeBarcode(row?.barcode_gtin14 ?? row?.barcode);
    const seedKey =
      identityToSeed.get(identity)
      || barcodeToSeed.get(barcode)?.seedKey
      || seedKeyOf(row?.seedMarket ?? row?.market ?? "NA", row?.seedBrand ?? row?.brandName ?? row?.productName);
    if (!seedInfoByKey.has(seedKey)) {
      const [market, brandName] = seedKey.split("::");
      seedInfoByKey.set(seedKey, { market, brandName });
    }
    allSeedKeys.add(seedKey);

    ensureUi(seedKey);
    const curr = uiCurrentCountsBySeed.get(seedKey);
    curr.sampleRows += 1;
    if (row?.bestFor) curr.best_for_visible += 1;
    if (row?.scienceSpecificity) curr.science_specific_visible += 1;
    if (row?.formulaExplain) curr.formula_explainable_visible += 1;
    if (row?.beforeBuy) curr.before_you_buy_visible += 1;

    if (baseline) {
      const delta = uiDeltaBySeed.get(seedKey);
      if (!baseline.bestFor && row?.bestFor) delta.best_for_added += 1;
      if (!baseline.scienceSpecificity && row?.scienceSpecificity) delta.science_specificity_added += 1;
      if (!baseline.formulaExplain && row?.formulaExplain) delta.formula_explainability_added += 1;
      if (!baseline.beforeBuy && row?.beforeBuy) delta.before_you_buy_added += 1;
    }
  }

  const brandRows = [...allSeedKeys]
    .map((seedKey) => {
      const info = seedInfoByKey.get(seedKey) || { market: "NA", brandName: seedKey };
      const productCountInDB = productIdentityBySeed.get(seedKey)?.size || 0;
      const lane1CandidatesCount = lane1CandidatesBySeed.get(seedKey) || 0;
      const lane1EnforcedCount = lane1EnforcedBySeed.get(seedKey) || 0;
      const runtimeHitCount = runtimeHitBySeed.get(seedKey) || 0;
      const runtimeBatchIds = [...(runtimeHitBatchIdsBySeed.get(seedKey) || new Set())].sort();
      let runtimeAttributionStatus = "insufficient_sample";
      if (runtimeHitCount > 0) runtimeAttributionStatus = "attributed";
      if (runtimeHitCount === 0 && runtimeScopeMismatchBatchIds.size > 0) runtimeAttributionStatus = "scope_mismatch";
      const uiDelta = uiDeltaBySeed.get(seedKey) || {
        best_for_added: 0,
        science_specificity_added: 0,
        formula_explainability_added: 0,
        before_you_buy_added: 0,
      };
      const uiCurrent = uiCurrentCountsBySeed.get(seedKey) || {
        sampleRows: 0,
        best_for_visible: 0,
        science_specific_visible: 0,
        formula_explainable_visible: 0,
        before_you_buy_visible: 0,
      };
      return {
        seedKey,
        market: info.market,
        brandName: info.brandName,
        productCountInDB,
        lane1_candidates: lane1CandidatesCount,
        lane1_enforced: lane1EnforcedCount,
        runtimeHitCount,
        brandRuntimeHitCount: runtimeHitCount,
        runtimeAttributionStatus,
        attributedByBatchIds: runtimeBatchIds,
        uiVisibleDelta: {
          ...uiDelta,
          directions_added: lane1EnforcedCount,
        },
        uiCurrentVisibility: {
          sampleRows: uiCurrent.sampleRows,
          best_for_visible: uiCurrent.best_for_visible,
          science_specific_visible: uiCurrent.science_specific_visible,
          formula_explainable_visible: uiCurrent.formula_explainable_visible,
          before_you_buy_visible: uiCurrent.before_you_buy_visible,
        },
      };
    })
    .sort((a, b) =>
      b.lane1_candidates - a.lane1_candidates
      || b.productCountInDB - a.productCountInDB
      || a.seedKey.localeCompare(b.seedKey));

  const totalCandidates = lane1Candidates.length;
  const totalEnforced = [...lane1EnforcedBySeed.values()].reduce((a, b) => a + b, 0);
  const runtimeHitBarcodes = runtimeHitBarcodesGlobal.size;
  const runtimeHitRate = asRate(runtimeHitBarcodes, runtimeCanHitBarcodesTotal);
  const brandsWithRuntimeAttribution = brandRows.filter((r) => r.brandRuntimeHitCount > 0).length;
  const brandsWithCandidates = brandRows.filter((r) => r.lane1_candidates > 0).length;
  const brandRuntimeAttributionIntegrity = asRate(brandsWithRuntimeAttribution, brandsWithCandidates);

  const top53Rates = uxCurrentReport?.rates || {};
  const uiVisibleUpliftRate = {
    sample: {
      name: "Top53",
      size: asNumber(uxCurrentReport?.evaluatedRows, 53),
      sourceReport: uxCurrentReportPath,
    },
    best_for_visibility_rate: asNumber(top53Rates.best_for_visibility_rate, 0),
    science_specificity_rate: asNumber(top53Rates.science_specificity_rate, 0),
    formula_explainability_rate: asNumber(top53Rates.formula_explainability_rate, 0),
    before_you_buy_completeness_rate: asNumber(top53Rates.before_you_buy_completeness_rate, 0),
    directions_visibility_proxy_rate_on_lane1_candidates: asRate(totalEnforced, totalCandidates),
  };

  const thresholds = {
    directions_visibility_proxy_rate_on_lane1_candidates: 0.8,
    best_for_visibility_rate: 0.7,
    science_specificity_rate: 0.65,
    before_you_buy_completeness_rate: 0.85,
  };

  const thresholdPass = {
    directions_visibility_pass:
      uiVisibleUpliftRate.directions_visibility_proxy_rate_on_lane1_candidates
      >= thresholds.directions_visibility_proxy_rate_on_lane1_candidates,
    best_for_visibility_pass: uiVisibleUpliftRate.best_for_visibility_rate >= thresholds.best_for_visibility_rate,
    science_specificity_pass: uiVisibleUpliftRate.science_specificity_rate >= thresholds.science_specificity_rate,
    before_you_buy_pass:
      uiVisibleUpliftRate.before_you_buy_completeness_rate >= thresholds.before_you_buy_completeness_rate,
  };

  const uxPerceptiblePass = Object.values(thresholdPass).every(Boolean);
  const blockingReasons = Object.entries(thresholdPass).filter(([, ok]) => !ok).map(([k]) => k);

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      top100Dir,
      scopePath,
      lane1CandidatesPath,
      globalCloseoutPath,
      uxBaselineReportPath,
      uxCurrentReportPath,
      uxBaselineDiagPath,
      uxCurrentDiagPath,
    },
    summary: {
      totalBrandsInOldTop100: asNumber(globalCloseout?.summary?.totalBrandsInPlan, 100),
      matchedBrandsInOldTop100: asNumber(globalCloseout?.summary?.matchedBrands, 0),
      lane1_candidate_total: totalCandidates,
      lane1_enforced_total: totalEnforced,
      enforced_coverage_rate: asRate(totalEnforced, totalCandidates),
      runtime_hit_barcodes: runtimeHitBarcodes,
      runtime_can_hit_barcodes: runtimeCanHitBarcodesTotal,
      runtime_hit_rate: runtimeHitRate,
      runtime_unattributed_barcode_count: runtimeHitUnattributedBarcodeCount,
      runtime_scope_mismatch_batches: [...runtimeScopeMismatchBatchIds].sort(),
      brand_runtime_attribution_integrity: brandRuntimeAttributionIntegrity,
      ui_visible_uplift_rate: uiVisibleUpliftRate,
      thresholds,
      thresholdPass,
      uxPerceptiblePass,
      blockingReasons,
      globalCloseoutSummary: globalCloseout?.summary || null,
    },
    rollup: {
      top100_global_closeout: {
        aggregateImprovementRate: asNumber(globalCloseout?.summary?.aggregateImprovementRate, 0),
        aggregateConflictRate: asNumber(globalCloseout?.summary?.aggregateConflictRate, 0),
        totalConflictAbs: asNumber(globalCloseout?.summary?.totalConflictAbs, 0),
        totalRuntimePatchHitCountDelta: asNumber(globalCloseout?.summary?.totalRuntimePatchHitCountDelta, 0),
        doneSeenNoRegression: Boolean(globalCloseout?.summary?.doneSeenNoRegression),
        scoreVisibleNoRegression: Boolean(globalCloseout?.summary?.scoreVisibleNoRegression),
      },
      ui_newly_visible_delta: uxCurrentReport?.newlyVisible || null,
      runtime_brand_attribution: {
        brands_with_runtime_hits: brandsWithRuntimeAttribution,
        brands_with_candidates: brandsWithCandidates,
        integrity_rate: brandRuntimeAttributionIntegrity,
      },
    },
    brands: brandRows,
    conclusion: {
      oldTop100UserPerceptibleThresholdMet: uxPerceptiblePass,
      recommendation: uxPerceptiblePass
        ? "旧 Top100 品牌池已达到用户可感知提升阈值，可进入并行扩量（保持批次 rollback 与 watch）。"
        : "旧 Top100 UX 覆盖率未达标，优先继续补旧 Top100（patch lane enforce + 前台展示内容）再扩量。",
    },
  };

  const outPath = path.join(outDir, `${reportName}.json`);
  await writeJson(outPath, report);
  await writeText(
    path.join(outDir, `${reportName}.md`),
    [
      `# ${reportName}`,
      "",
      `- enforced_coverage_rate: ${(report.summary.enforced_coverage_rate * 100).toFixed(2)}%`,
      `- runtime_hit_rate: ${(report.summary.runtime_hit_rate * 100).toFixed(2)}%`,
      `- brand_runtime_attribution_integrity: ${(report.summary.brand_runtime_attribution_integrity * 100).toFixed(2)}%`,
      `- uxPerceptiblePass: ${report.summary.uxPerceptiblePass}`,
      `- blockingReasons: ${(report.summary.blockingReasons || []).join(", ") || "none"}`,
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify({
    outPath,
    enforced_coverage_rate: report.summary.enforced_coverage_rate,
    runtime_hit_rate: report.summary.runtime_hit_rate,
    uxPerceptiblePass: report.summary.uxPerceptiblePass,
    blockingReasons: report.summary.blockingReasons,
  }, null, 2));
};

main().catch((error) => {
  console.error("[generate-top100-patch-ux-coverage-report] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
