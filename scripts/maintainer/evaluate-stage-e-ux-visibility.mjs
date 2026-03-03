#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
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

const asNumber = (value, fallback = 0) => {
  if (value == null) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));
const normalizeText = (value) => String(value ?? "").trim();
const normalizeToken = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const GENERIC_SCIENCE_PATTERN = /key body functions linked to this ingredient|general science|day-to-day wellness|normal function/i;

const getRowsFromInput = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.selected)) return payload.selected;
  return [];
};

const inferIngredientToken = (row) => {
  const rawName = normalizeText(row?.productName || row?.product_name || row?.ingredient || row?.activeIngredient).toLowerCase();
  const candidates = [
    row?.ingredient_id,
    row?.ingredient,
    row?.activeIngredient,
    row?.keyIngredient,
    row?.categoryBucket,
    row?.category_bucket,
    row?.productName,
    row?.product_name,
  ]
    .map((value) => normalizeToken(value))
    .filter(Boolean);

  for (const token of candidates) {
    if (token === "fish_oil" || token.includes("omega_3")) return "fish_oil_omega3";
    if (token.includes("flaxseed")) return "flaxseed_oil";
    if (token.includes("vitamin_d") || token === "vitamin_d") return "vitamin_d";
    if (token.includes("alpha_lipoic") || token === "ala") return "alpha_lipoic_acid";
    if (token.includes("biotin") || token.includes("hair_skin_nails")) return "biotin";
    if (token.includes("melatonin")) return "melatonin";
    if (token.includes("coq10") || token.includes("coenzyme_q10") || token.includes("ubiquinol") || token.includes("ubiquinone")) return "coq10";
    if (token.includes("vitamin_c") || token.includes("ascorbic") || token.includes("ascorbate")) return "vitamin_c";
    if (token.includes("magnesium")) return "magnesium";
    if (token.includes("zinc")) return "zinc";
    if (token.includes("probiotic") || token.includes("lactobacillus") || token.includes("bifidobacterium")) return "probiotics";
  }
  if (/^c\s*\d+\s*mg\b/.test(rawName) || /^vitamin\s*c\b/.test(rawName) || /\bascorbic\b|\bascorbate\b/.test(rawName)) {
    return "vitamin_c";
  }
  return candidates[0] ?? null;
};

const resolveSignal = ({ row, signalsByIngredient, fallbackSignalsByIngredient }) => {
  const buildResult = (signal, ingredientId, signalSource, fallbackType = null) => ({
    signal,
    ingredientId,
    signalSource,
    fallbackType,
  });

  const directIngredientId = normalizeToken(row?.ingredient_id || row?.ingredientId || row?.activeIngredientId);
  if (directIngredientId && signalsByIngredient[directIngredientId]) {
    return buildResult(signalsByIngredient[directIngredientId], directIngredientId, "subset", null);
  }
  if (directIngredientId && fallbackSignalsByIngredient[directIngredientId]) {
    return buildResult(fallbackSignalsByIngredient[directIngredientId], directIngredientId, "fallback", "best_for");
  }

  const inferred = inferIngredientToken(row);
  if (inferred && signalsByIngredient[inferred]) {
    return buildResult(signalsByIngredient[inferred], inferred, "subset", null);
  }
  if (inferred && fallbackSignalsByIngredient[inferred]) {
    return buildResult(fallbackSignalsByIngredient[inferred], inferred, "fallback", "best_for");
  }

  const normalizedName = normalizeToken(row?.ingredient || row?.activeIngredient || row?.product_name || row?.productName);
  if (normalizedName && signalsByIngredient[normalizedName]) {
    return buildResult(signalsByIngredient[normalizedName], normalizedName, "subset", null);
  }
  if (normalizedName && fallbackSignalsByIngredient[normalizedName]) {
    return buildResult(fallbackSignalsByIngredient[normalizedName], normalizedName, "fallback", "best_for");
  }

  const rawName = normalizeText(row?.productName || row?.product_name).toLowerCase();
  if (rawName) {
    const aliasPairs = [
      [/coenzyme\s*q\s*10|\bco\s*q\s*10\b|\bcoq10\b|\bubiquinol\b|\bubiquinone\b/, "coq10"],
      [/^c\s*\d+\s*mg\b|^vitamin\s*c\b|\bascorbic\b|\bascorbate\b/, "vitamin_c"],
      [/\bflaxseed\b/, "flaxseed_oil"],
      [/alpha\s*lipoic|\bala\b/, "alpha_lipoic_acid"],
      [/\bbiotin\b|hair\s*[-,& ]?\s*skin\s*[-,& ]?\s*nails?/, "biotin"],
      [/\bmelatonin\b/, "melatonin"],
      [/\bzinc\b/, "zinc"],
      [/\bmagnesium\b/, "magnesium"],
    ];
    for (const [pattern, token] of aliasPairs) {
      if (pattern.test(rawName) && signalsByIngredient[token]) {
        return buildResult(signalsByIngredient[token], token, "subset", null);
      }
      if (pattern.test(rawName) && fallbackSignalsByIngredient[token]) {
        return buildResult(fallbackSignalsByIngredient[token], token, "fallback", "best_for");
      }
    }
  }

  return {
    signal: null,
    ingredientId: null,
    signalSource: "none",
    fallbackType: null,
  };
};

const hasSpecificScience = (signal) => {
  const lines = [
    ...(Array.isArray(signal?.best_for_bullets) ? signal.best_for_bullets : []),
    ...(Array.isArray(signal?.best_for_fallback) ? signal.best_for_fallback : []),
    signal?.form_impact_line,
    ...(Array.isArray(signal?.comparison_fallback) ? signal.comparison_fallback : []),
    ...(Array.isArray(signal?.evidence_lines) ? signal.evidence_lines : []),
  ]
    .map((line) => normalizeText(line))
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.some((line) => !GENERIC_SCIENCE_PATTERN.test(line));
};

const main = async () => {
  const scopePath = resolvePath(getArg("scope-json"));
  const safeSubsetPath = resolvePath(getArg("safe-science-subset-json"));
  const fallbackPath =
    resolvePath(getArg("safe-fallback-json")) ??
    path.join(ROOT_DIR, "data", "kb", "safe_science_fallbacks.v1.json");
  if (!scopePath || !safeSubsetPath) {
    console.error("[evaluate-stage-e-ux-visibility] missing --scope-json or --safe-science-subset-json");
    process.exit(1);
  }

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "ux");

  const maxRows = Math.max(1, asNumber(getArg("max-rows"), 53));
  const baselineReportPath = resolvePath(getArg("baseline-report-json"));

  const upliftThresholds = {
    newlyVisibleBestForCount: Math.max(0, asNumber(getArg("min-uplift-best-for-count", 15))),
    newlyVisibleFormulaExplainabilityCount: Math.max(0, asNumber(getArg("min-uplift-formula-count", 15))),
    newlyVisibleBeforeYouBuyCount: Math.max(0, asNumber(getArg("min-uplift-before-buy-count", 20))),
    scienceSpecificityRate: clamp01(getArg("min-uplift-science-specificity-rate", 0.25)),
  };
  const closureThresholds = {
    bestForVisibilityRate: clamp01(getArg("min-best-for-rate", 0.7)),
    scienceSpecificityRate: clamp01(getArg("min-science-specificity-rate", 0.65)),
    formulaExplainabilityRate: clamp01(getArg("min-formula-explainability-rate", 0.75)),
    beforeYouBuyCompletenessRate: clamp01(getArg("min-before-buy-rate", 0.85)),
  };

  const scopePayload = await readJson(scopePath);
  const scopeRowsAll = getRowsFromInput(scopePayload);
  const scopeRows = scopeRowsAll.slice(0, maxRows);

  const safeSubset = await readJson(safeSubsetPath);
  const signalsByIngredient = safeSubset?.signalsByIngredient && typeof safeSubset.signalsByIngredient === "object"
    ? safeSubset.signalsByIngredient
    : {};
  const safeFallback = await readJson(fallbackPath).catch(() => null);
  const fallbackSignalsByIngredient = safeFallback?.signalsByIngredient && typeof safeFallback.signalsByIngredient === "object"
    ? safeFallback.signalsByIngredient
    : {};

  if (scopeRows.length === 0) {
    console.error("[evaluate-stage-e-ux-visibility] scope rows empty");
    process.exit(1);
  }

  const baselineReport = baselineReportPath ? await readJson(baselineReportPath).catch(() => null) : null;
  const baselineCounts = {
    bestForVisible: asNumber(baselineReport?.counts?.bestForVisible, 0),
    scienceSpecific: asNumber(baselineReport?.counts?.scienceSpecific, 0),
    formulaExplainable: asNumber(baselineReport?.counts?.formulaExplainable, 0),
    beforeBuyComplete: asNumber(baselineReport?.counts?.beforeBuyComplete, 0),
  };

  const diagnostics = [];
  let bestForVisible = 0;
  let scienceSpecific = 0;
  let formulaExplainable = 0;
  let beforeBuyComplete = 0;

  for (const row of scopeRows) {
    const resolved = resolveSignal({ row, signalsByIngredient, fallbackSignalsByIngredient });
    const signal = resolved.signal;

    const bestForSourceBullets = Array.isArray(signal?.best_for_bullets)
      ? signal.best_for_bullets
      : Array.isArray(signal?.best_for_fallback)
        ? signal.best_for_fallback
        : [];
    const bestFor = Boolean(bestForSourceBullets.length > 0);
    const scienceSpecificity = Boolean(signal && hasSpecificScience(signal));

    const formText = normalizeText(row?.formText || row?.form_text || row?.form || "");
    const formulaLine = normalizeText(signal?.form_impact_line || (Array.isArray(signal?.comparison_fallback) ? signal.comparison_fallback[0] : ""));
    const formulaExplain = Boolean(formulaLine || formText);

    const warningsMissing = row?.hasLabelWarnings === false || row?.has_label_warnings === false;
    const beforeLine = normalizeText(signal?.before_you_buy_line);
    const beforeBuy = Boolean(beforeLine || warningsMissing || row?.hasDirectionsText === false);

    if (bestFor) bestForVisible += 1;
    if (scienceSpecificity) scienceSpecific += 1;
    if (formulaExplain) formulaExplainable += 1;
    if (beforeBuy) beforeBuyComplete += 1;

    diagnostics.push({
      identityKey: row?.identityKey ?? row?.identity_key ?? null,
      barcode_gtin14: row?.barcodeGtIn14 ?? row?.barcode_gtin14 ?? null,
      productName: row?.productName ?? row?.product_name ?? null,
      ingredientToken: inferIngredientToken(row),
      matchedSafeSignal: resolved.ingredientId ?? signal?.ingredient_id ?? null,
      signalSource: resolved.signalSource,
      fallbackType: resolved.fallbackType,
      bestFor,
      scienceSpecificity,
      formulaExplain,
      beforeBuy,
    });
  }

  const total = scopeRows.length;
  const rates = {
    best_for_visibility_rate: total > 0 ? bestForVisible / total : 0,
    science_specificity_rate: total > 0 ? scienceSpecific / total : 0,
    formula_explainability_rate: total > 0 ? formulaExplainable / total : 0,
    before_you_buy_completeness_rate: total > 0 ? beforeBuyComplete / total : 0,
  };

  const newlyVisible = {
    newly_visible_best_for_count: Math.max(0, bestForVisible - baselineCounts.bestForVisible),
    newly_visible_science_specificity_count: Math.max(0, scienceSpecific - baselineCounts.scienceSpecific),
    newly_visible_formula_explainability_count: Math.max(0, formulaExplainable - baselineCounts.formulaExplainable),
    newly_visible_before_you_buy_count: Math.max(0, beforeBuyComplete - baselineCounts.beforeBuyComplete),
  };

  const upliftGateChecks = {
    newly_visible_best_for_pass: newlyVisible.newly_visible_best_for_count >= upliftThresholds.newlyVisibleBestForCount,
    newly_visible_formula_explainability_pass:
      newlyVisible.newly_visible_formula_explainability_count >= upliftThresholds.newlyVisibleFormulaExplainabilityCount,
    newly_visible_before_you_buy_pass:
      newlyVisible.newly_visible_before_you_buy_count >= upliftThresholds.newlyVisibleBeforeYouBuyCount,
    uplift_science_specificity_pass: rates.science_specificity_rate >= upliftThresholds.scienceSpecificityRate,
  };
  const closureGateChecks = {
    best_for_visibility_pass: rates.best_for_visibility_rate >= closureThresholds.bestForVisibilityRate,
    science_specificity_pass: rates.science_specificity_rate >= closureThresholds.scienceSpecificityRate,
    formula_explainability_pass: rates.formula_explainability_rate >= closureThresholds.formulaExplainabilityRate,
    before_you_buy_completeness_pass: rates.before_you_buy_completeness_rate >= closureThresholds.beforeYouBuyCompletenessRate,
  };

  const upliftGatePass = Object.values(upliftGateChecks).every(Boolean);
  const closureGatePass = Object.values(closureGateChecks).every(Boolean);
  const pass = upliftGatePass;
  const blockingReasons = [
    ...Object.entries(upliftGateChecks).filter(([, ok]) => !ok).map(([key]) => `UX_uplift_gate:${key}`),
  ];

  const fixableQueue = diagnostics
    .filter((row) => !(row.bestFor && row.scienceSpecificity && row.formulaExplain && row.beforeBuy))
    .map((row) => ({
      ...row,
      issueType:
        !row.bestFor && !row.scienceSpecificity
          ? "missing_best_for_and_science_specificity"
          : !row.bestFor
            ? "missing_best_for"
            : !row.scienceSpecificity
              ? "low_science_specificity"
              : !row.formulaExplain
                ? "missing_formula_explainability"
                : "missing_before_you_buy",
      queue: "fixable",
      owner: "ux-e-plus",
      status: "open",
      reasonCode: "ux_visibility_gap",
      targetRelease: "v1.6.14-e-plus-followup",
    }));

  if (!upliftGateChecks.newly_visible_formula_explainability_pass) {
    fixableQueue.push({
      queue: "fixable",
      owner: "ux-e-plus",
      status: "open",
      reasonCode: "formula_explainability_visibility_gap",
      targetRelease: "v1.6.14-e-plus-followup",
      newly_visible_formula_explainability_count: newlyVisible.newly_visible_formula_explainability_count,
      min_required: upliftThresholds.newlyVisibleFormulaExplainabilityCount,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scopePath,
    safeSubsetPath,
    baselineReportPath: baselineReportPath ?? null,
    fallbackPath,
    evaluatedRows: total,
    thresholds: {
      UX_uplift_gate: upliftThresholds,
      UX_closure_gate: closureThresholds,
    },
    rates,
    gateChecks: {
      UX_uplift_gate: upliftGateChecks,
      UX_closure_gate: closureGateChecks,
    },
    newlyVisible,
    UX_uplift_gate: {
      pass: upliftGatePass,
      blockingReasons: Object.entries(upliftGateChecks).filter(([, ok]) => !ok).map(([key]) => key),
    },
    UX_closure_gate: {
      pass: closureGatePass,
      blockingReasons: Object.entries(closureGateChecks).filter(([, ok]) => !ok).map(([key]) => key),
    },
    pass,
    blockingReasons,
    counts: {
      bestForVisible,
      scienceSpecific,
      formulaExplainable,
      beforeBuyComplete,
      fixableCount: fixableQueue.length,
    },
  };

  await writeJson(path.join(outDir, "ux_visibility_report.json"), report);
  await writeText(
    path.join(outDir, "ux_visibility_report.md"),
    [
      "# UX Visibility Report",
      "",
      `- pass: ${pass}`,
      `- UX_uplift_gate_pass: ${upliftGatePass}`,
      `- UX_closure_gate_pass: ${closureGatePass}`,
      `- evaluatedRows: ${total}`,
      `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
      "",
      `- best_for_visibility_rate: ${(rates.best_for_visibility_rate * 100).toFixed(2)}%`,
      `- science_specificity_rate: ${(rates.science_specificity_rate * 100).toFixed(2)}%`,
      `- formula_explainability_rate: ${(rates.formula_explainability_rate * 100).toFixed(2)}%`,
      `- before_you_buy_completeness_rate: ${(rates.before_you_buy_completeness_rate * 100).toFixed(2)}%`,
      "",
      `- newly_visible_best_for_count: ${newlyVisible.newly_visible_best_for_count}`,
      `- newly_visible_formula_explainability_count: ${newlyVisible.newly_visible_formula_explainability_count}`,
      `- newly_visible_before_you_buy_count: ${newlyVisible.newly_visible_before_you_buy_count}`,
      `- newly_visible_science_specificity_count: ${newlyVisible.newly_visible_science_specificity_count}`,
    ].join("\n") + "\n",
  );
  await writeJson(path.join(outDir, "ux_visibility_diagnostics.json"), diagnostics);
  await writeJson(path.join(outDir, "ux_visibility_fixable_queue.json"), fixableQueue);

  console.log("[evaluate-stage-e-ux-visibility] completed");
  console.log(JSON.stringify({ outDir, pass, evaluatedRows: total, rates }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[evaluate-stage-e-ux-visibility] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
