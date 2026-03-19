#!/usr/bin/env node
/* eslint-disable no-console */
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  DEFAULT_IDENTITY_BRANDS,
  buildPositiveControlDebugSet,
  createDiscoveryHarness,
  fileExists,
  readJson,
  readOptionalJson,
  writeJson,
  writeText,
  copyFile,
  normalizeText,
} from "./lib/iherb-discovery-harness.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const BASELINE_STAGING_PATH = getArg(
  "baseline-staging-json",
  path.join(ROOT, "output", "week2_5_root_cause", "now_retarget_20260314T082518Z", "staging_products.official_refreshed.json"),
);
const BASELINE_MERGE_REPORT_PATH = getArg(
  "baseline-merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_5_now_retarget_20260314T082518Z", "overlay_merge_coverage_report.json"),
);
const BASELINE_HIGH_FREQUENCY_PATH = getArg(
  "baseline-high-frequency-json",
  path.join(ROOT, "output", "iherb_overlay_high_frequency_validation_week2_5_now_retarget_20260314T082518Z", "high_frequency_hit_validation.json"),
);
const OUTPUT_DIR = getArg("output-dir", path.join(ROOT, "output"));
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "week3_phase1_discovery"));
const ACTIVE_CANONICAL_DIR = getArg(
  "canonical-dir",
  path.join(ROOT, "docs", "exec-plans", "active", "week3_phase1"),
);
const HISTORY_CANONICAL_DIR = getArg(
  "history-canonical-dir",
  path.join(ROOT, "docs", "exec-plans", "history", "week3_phase1"),
);
const OUTPUT_WAVES_DIR = getArg("waves-dir", path.join(ROOT, "output", "waves"));

const WAVE_TS = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const SOURCE_COMPARE_WAVE_ID = `week3_phase1_source_family_compare_${WAVE_TS}`;
const QUERY_COMPARE_WAVE_ID = `week3_phase1_query_family_compare_${WAVE_TS}`;
const PATH_PROOF_WAVE_ID = `week3_phase1_discovery_path_proof_${WAVE_TS}`;

const CURRENT_MANIFEST_PATH = path.join(OUTPUT_DIR, "wave_manifest_current.json");
const CURRENT_RESULT_PATH = path.join(OUTPUT_DIR, "wave_result_current.json");

const SOURCE_COMPARE_JSON_PATH = path.join(OUTPUT_DIR, "discovery_source_family_comparison.json");
const SOURCE_COMPARE_MD_PATH = path.join(OUTPUT_DIR, "discovery_source_family_comparison.md");
const QUERY_COMPARE_JSON_PATH = path.join(OUTPUT_DIR, "discovery_query_family_comparison.json");
const QUERY_COMPARE_MD_PATH = path.join(OUTPUT_DIR, "discovery_query_family_comparison.md");
const PATH_PROOF_JSON_PATH = path.join(OUTPUT_DIR, "discovery_path_proof.json");
const PATH_PROOF_MD_PATH = path.join(OUTPUT_DIR, "discovery_path_proof.md");
const FINAL_SUMMARY_PATH = path.join(OUTPUT_DIR, "week3_phase1_discovery_rewrite_summary.md");
const NO_EXECUTABLE_COVERAGE_BATCH_PATH = path.join(OUTPUT_DIR, "no_executable_coverage_batch.md");

const runtimeBlockerPath = path.join(OUTPUT_DIR, "blocker_registry.json");
const runtimeRoiPath = path.join(OUTPUT_DIR, "brand_path_roi_registry.json");
const canonicalBlockerPath = path.join(ACTIVE_CANONICAL_DIR, "blocker_registry.json");
const canonicalRoiPath = path.join(ACTIVE_CANONICAL_DIR, "brand_path_roi_registry.json");

const execNode = (scriptPath, scriptArgs = []) =>
  execFileSync("node", [scriptPath, ...scriptArgs], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const computePatternFromPrevious = (previousEntry, uplift) => {
  if (!previousEntry || !Number(previousEntry.totalBatchesRun ?? 0)) {
    return uplift > 0 ? "single_positive" : "single_zero";
  }
  const previousLast = Number(previousEntry.lastBatchUplift ?? 0);
  if (previousLast > 0 && uplift > 0) return "positive_then_positive";
  if (previousLast > 0 && uplift === 0) return "positive_then_zero";
  if (previousLast === 0 && uplift === 0) return "zero_then_zero";
  return uplift > 0 ? "single_positive" : "single_zero";
};

const chooseDiscoveryOnlyRoiDecision = (previousEntry, uplift = 0) => {
  const pattern = computePatternFromPrevious(previousEntry, uplift);
  if (pattern === "zero_then_zero") return "pause";
  if (pattern === "positive_then_zero") return "pause";
  if (pattern === "single_zero") return "retarget";
  if (pattern === "not_enough_history") return "retarget";
  return uplift > 0 ? "retarget" : "pause";
};

const toDecisionSummary = (proofReport) => (proofReport.summary.proven ? "retargetable" : "exhausted");

const buildSourceCompareMarkdown = (report) => {
  const lines = [
    "# Discovery Source Family Comparison",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- waveId: ${report.waveId}`,
    `- attemptedRows: ${report.summary.attempted}`,
    "",
    "## Source Families",
    "",
  ];
  for (const [sourceFamily, summary] of Object.entries(report.summary.sourceFamilies ?? {})) {
    lines.push(`### ${sourceFamily}`);
    lines.push(`- expectedPageSeenRows: ${summary.expectedPageSeenRows}/${summary.attemptedRows}`);
    lines.push(`- finalAcceptedRows: ${summary.finalAcceptedRows}/${summary.attemptedRows}`);
    lines.push(`- candidateExtractionCount: ${summary.candidateExtractionCount}`);
    lines.push(`- expectedInRawButNotEmittedRows: ${summary.expectedInRawButNotEmittedRows}`);
    lines.push(`- telemetry: http429=${summary.http429}, aborted=${summary.aborted}, blocked=${summary.blockedOrCaptchaDetected}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const buildQueryCompareMarkdown = (report) => {
  const lines = [
    "# Discovery Query Family Comparison",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- waveId: ${report.waveId}`,
    `- primarySourceFamilyUsed: ${report.primarySourceFamilyUsed}`,
    `- secondarySourceFamilyUsed: ${report.secondarySourceFamilyUsed ?? "none"}`,
    "",
  ];
  for (const sourceEntry of report.sourceFamilies ?? []) {
    lines.push(`## ${sourceEntry.sourceFamily}`);
    lines.push("");
    for (const [queryFamily, summary] of Object.entries(sourceEntry.families ?? {})) {
      lines.push(`### ${queryFamily}`);
      lines.push(`- hitRate: ${summary.hitRate}`);
      lines.push(`- expectedPageVisibility: ${summary.expectedPageVisibility}`);
      lines.push(`- falsePositiveRisk: ${summary.falsePositiveRisk}`);
      lines.push(`- bestRankOfExpectedPage: ${summary.bestRankOfExpectedPage ?? "n/a"}`);
      lines.push(`- brandsWhereUseful: ${(summary.brandsWhereUseful ?? []).join(", ") || "none"}`);
      lines.push(`- brandsWhereNoisy: ${(summary.brandsWhereNoisy ?? []).join(", ") || "none"}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
};

const buildPathProofMarkdown = (report) => {
  const lines = [
    "# Discovery Path Proof",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- waveId: ${report.waveId}`,
    `- pathKind: ${report.chosenPath.pathKind}`,
    `- sourceFamily: ${report.chosenPath.sourceFamily}`,
    `- queryFamily: ${report.chosenPath.queryFamily}`,
    `- classification: ${report.summary.classification}`,
    `- discoveryHits: ${report.summary.discoveryHits}/${report.summary.attempted}`,
    `- expectedPageVisibility: ${report.summary.expectedPageVisibility}`,
    `- falsePositiveRisk: ${report.summary.falsePositiveRisk}`,
    `- currentExpectedPageVisibility: ${report.summary.currentExpectedPageVisibility}`,
    `- noBaselineDelta: ${report.summary.noBaselineDelta}`,
    `- noMergeStateChange: ${report.summary.noMergeStateChange}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const chooseBestSourceFamily = (report) =>
  Object.entries(report.summary.sourceFamilies ?? {})
    .map(([sourceFamily, summary]) => ({
      sourceFamily,
      expectedPageSeenRows: Number(summary.expectedPageSeenRows ?? 0),
      expectedInRawButNotEmittedRows: Number(summary.expectedInRawButNotEmittedRows ?? 0),
      noise: Number(summary.http429 ?? 0) + Number(summary.aborted ?? 0) + Number(summary.blockedOrCaptchaDetected ?? 0),
    }))
    .sort(
      (left, right) =>
        right.expectedPageSeenRows - left.expectedPageSeenRows ||
        right.expectedInRawButNotEmittedRows - left.expectedInRawButNotEmittedRows ||
        left.noise - right.noise ||
        left.sourceFamily.localeCompare(right.sourceFamily),
    )[0] ?? null;

const chooseBestQueryFamily = (report) =>
  (report.sourceFamilies ?? [])
    .flatMap((sourceEntry) =>
      Object.entries(sourceEntry.families ?? {}).map(([queryFamily, summary]) => ({
        sourceFamily: sourceEntry.sourceFamily,
        queryFamily,
        expectedPageVisibility: Number(summary.expectedPageVisibility ?? 0),
        falsePositiveRisk: Number(summary.falsePositiveRisk ?? 0),
        hitRate: Number(summary.hitRate ?? 0),
        noise: Number(summary.http429 ?? 0) + Number(summary.aborted ?? 0) + Number(summary.blockedOrCaptchaDetected ?? 0),
      })),
    )
    .sort(
      (left, right) =>
        right.expectedPageVisibility - left.expectedPageVisibility ||
        left.falsePositiveRisk - right.falsePositiveRisk ||
        right.hitRate - left.hitRate ||
        left.noise - right.noise ||
        left.sourceFamily.localeCompare(right.sourceFamily) ||
        left.queryFamily.localeCompare(right.queryFamily),
    )[0] ?? null;

const buildSummaryMarkdown = ({ startingBaseline, endingBaseline, bestSourceFamily, bestQueryFamily, proofReport, coverageExecutable }) => {
  const lines = [
    "# Week 3 Phase 1 Discovery Rewrite Summary",
    "",
    "## Starting Baseline",
    "",
    `- strictMergeReady: \`${startingBaseline.strictMergeReady}\``,
    `- queued: \`${startingBaseline.queued}\``,
    `- completeHitCount: \`${startingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${startingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${startingBaseline.activeQueueCount}\``,
    "",
    "## Ending Baseline",
    "",
    `- strictMergeReady: \`${endingBaseline.strictMergeReady}\``,
    `- queued: \`${endingBaseline.queued}\``,
    `- completeHitCount: \`${endingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${endingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${endingBaseline.activeQueueCount}\``,
    `- noBaselineDelta: \`${proofReport.summary.noBaselineDelta}\``,
    "",
    "## Discovery Verdict",
    "",
    `- bestSourceFamily: \`${bestSourceFamily?.sourceFamily ?? "none"}\``,
    `- bestQueryFamily: \`${bestQueryFamily ? `${bestQueryFamily.sourceFamily} / ${bestQueryFamily.queryFamily}` : "none"}\``,
    `- newDiscoveryPathProven: \`${proofReport.summary.proven}\``,
    `- official_fetch_unresolved: \`${toDecisionSummary(proofReport)}\``,
    `- continueWithSourceExpansion: \`${proofReport.summary.classification === "exhausted"}\``,
    `- executableCoveragePathRemained: \`${coverageExecutable}\``,
    "",
  ];
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [baselineStaging, baselineMerge, baselineHighFrequency, runtimeBlocker, runtimeRoi] = await Promise.all([
    readJson(BASELINE_STAGING_PATH),
    readJson(BASELINE_MERGE_REPORT_PATH),
    readJson(BASELINE_HIGH_FREQUENCY_PATH),
    readOptionalJson(runtimeBlockerPath),
    readOptionalJson(runtimeRoiPath),
  ]);

  const startingBaseline = {
    strictMergeReady: Number(baselineMerge?.summary?.strictMergeReady ?? 26635),
    queued: Number(baselineMerge?.summary?.queued ?? 23983),
    completeHitCount: Number(baselineHighFrequency?.summary?.completeHitCount ?? 666),
    completeHitRate: Number(baselineHighFrequency?.summary?.completeHitRate ?? 40.3),
    activeQueueCount: Number(baselineHighFrequency?.summary?.activeQueueCount ?? 0),
  };
  const endingBaseline = { ...startingBaseline };

  const stagingRows = Array.isArray(baselineStaging?.products) ? baselineStaging.products : [];
  const positiveControlSelection = buildPositiveControlDebugSet(stagingRows, { brands: DEFAULT_IDENTITY_BRANDS, limit: 8 });
  const positiveControls = positiveControlSelection.rows;

  const harness = createDiscoveryHarness({
    root: ROOT,
    requestTimeoutMs: 2000,
    pageTimeoutMs: 8000,
    fetchBackoffMs: 500,
    discoveryQueryLimit: 2,
    discoveryFallbackQueryLimit: 1,
    discoveryCandidateLimit: 2,
    useSitemap: false,
  });

  const updateHarnessRegistries = async ({ manifest, result, blockerStatus, blockerClass, evidencePath, coverageEvidencePath }) => {
    const blockerRegistry = runtimeBlocker ?? (await readOptionalJson(runtimeBlockerPath)) ?? {};
    const roiRegistry = runtimeRoi ?? (await readOptionalJson(runtimeRoiPath)) ?? {};

    blockerRegistry["kpi:official_fetch_unresolved/iherb_identity_v2"] = {
      blockerClass,
      lane: "kpi",
      evidencePath,
      unpauseCondition:
        blockerStatus === "hold"
          ? "Run a later positive-control-backed micro-canary before any unresolved recovery."
          : blockerStatus === "exhausted"
            ? "Require a genuinely new discovery source or non-iHerb source expansion."
            : "Require a stronger discovery path under current strict methods.",
      status: blockerStatus,
      lastReviewedWaveId: manifest.waveId,
      canonicalPath: canonicalBlockerPath,
    };
    blockerRegistry["coverage:now_foods/official_warnings_path_light_retarget"] = {
      blockerClass: "no_executable_coverage_path",
      lane: "coverage",
      evidencePath: coverageEvidencePath,
      unpauseCondition: "Only reopen if a fresh non-exhausted proven path appears in the ROI registry.",
      status: "paused",
      lastReviewedWaveId: manifest.waveId,
      canonicalPath: canonicalBlockerPath,
    };

    const updateRoiEntry = (pathKey, decision, waveId) => {
      const previousEntry = roiRegistry[pathKey];
      const uplift = 0;
      roiRegistry[pathKey] = {
        totalBatchesRun: Number(previousEntry?.totalBatchesRun ?? 0) + 1,
        totalCompleteUplift: Number(previousEntry?.totalCompleteUplift ?? 0) + uplift,
        lastBatchUplift: uplift,
        lastTwoBatchPattern: computePatternFromPrevious(previousEntry, uplift),
        currentDecision: decision,
        lastWaveId: waveId,
      };
    };

    updateRoiEntry(
      "official_fetch_unresolved:iherb_discovery_source_family_compare",
      chooseDiscoveryOnlyRoiDecision(roiRegistry["official_fetch_unresolved:iherb_discovery_source_family_compare"]),
      SOURCE_COMPARE_WAVE_ID,
    );
    updateRoiEntry(
      "official_fetch_unresolved:iherb_discovery_query_family_compare",
      chooseDiscoveryOnlyRoiDecision(roiRegistry["official_fetch_unresolved:iherb_discovery_query_family_compare"]),
      QUERY_COMPARE_WAVE_ID,
    );
    updateRoiEntry(
      "official_fetch_unresolved:iherb_discovery_path_proof",
      result.decision,
      PATH_PROOF_WAVE_ID,
    );

    await writeJson(runtimeBlockerPath, blockerRegistry);
    await writeJson(runtimeRoiPath, roiRegistry);
    await copyFile(runtimeBlockerPath, canonicalBlockerPath);
    await copyFile(runtimeRoiPath, canonicalRoiPath);
  };

  const runValidator = () =>
    execNode(path.join(ROOT, "scripts", "maintainer", "validate-wave-harness-state.mjs"), [
      "--canonical-dir",
      ACTIVE_CANONICAL_DIR,
      "--canonical-history-dir",
      HISTORY_CANONICAL_DIR,
    ]);

  await writeJson(path.join(OUT_DIR, "positive_control_set.json"), positiveControls);

  const sourceCompareManifest = {
    waveId: SOURCE_COMPARE_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_discovery_source_family_compare",
    cohortSource: path.join(OUT_DIR, "positive_control_set.json"),
    brands: DEFAULT_IDENTITY_BRANDS,
    queryStrategy: "source_family_comparison",
    sourcePriority: [
      "iherb_reader_search",
      "repo_composite_v2",
      "search_engine_site_fallback",
      "sitemap_source",
      "brand_specific_source_path",
    ],
    stopRules: ["Do not run unresolved recovery in this phase.", "Compare only positive-control rows."],
    successMetric: "identify which source family surfaces the expected page and where candidate emission fails",
    newMethod: true,
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_discovery_source_family_compare"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };
  const sourceComparisonReport = await harness.buildDiscoverySourceFamilyComparisonReport({
    rows: positiveControls,
    waveId: SOURCE_COMPARE_WAVE_ID,
  });
  await writeJson(SOURCE_COMPARE_JSON_PATH, sourceComparisonReport);
  await writeText(SOURCE_COMPARE_MD_PATH, buildSourceCompareMarkdown(sourceComparisonReport));
  const sourceCompareResult = {
    waveId: SOURCE_COMPARE_WAVE_ID,
    lane: "kpi",
    pathKey: sourceCompareManifest.pathKey,
    attempted: sourceComparisonReport.summary.attempted,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: Object.fromEntries(
      Object.entries(sourceComparisonReport.summary.sourceFamilies ?? {}).map(([sourceFamily, summary]) => [
        sourceFamily,
        summary.expectedInRawButNotEmittedRows ?? 0,
      ]),
    ),
    decision: "retarget",
    outcomeClass: "diagnostic_success",
    evidencePath: SOURCE_COMPARE_JSON_PATH,
    executionHealth: sourceComparisonReport.executionHealth,
    executed: true,
  };
  await harness.syncCurrentAndHistory({
    manifest: sourceCompareManifest,
    result: sourceCompareResult,
    currentManifestPath: CURRENT_MANIFEST_PATH,
    currentResultPath: CURRENT_RESULT_PATH,
    historyManifestPath: path.join(OUTPUT_WAVES_DIR, `${SOURCE_COMPARE_WAVE_ID}_manifest.json`),
    historyResultPath: path.join(OUTPUT_WAVES_DIR, `${SOURCE_COMPARE_WAVE_ID}_result.json`),
    activeCanonicalDir: ACTIVE_CANONICAL_DIR,
    historyCanonicalDir: HISTORY_CANONICAL_DIR,
    markdownCopies: [{ sourcePath: SOURCE_COMPARE_MD_PATH, canonicalName: "discovery_source_family_comparison.md" }],
    currentJsonCopies: [
      { sourcePath: runtimeBlockerPath, canonicalName: "blocker_registry.json" },
      { sourcePath: runtimeRoiPath, canonicalName: "brand_path_roi_registry.json" },
    ],
  });
  await updateHarnessRegistries({
    manifest: sourceCompareManifest,
    result: sourceCompareResult,
    blockerStatus: "paused",
    blockerClass: "source_selection_defect",
    evidencePath: SOURCE_COMPARE_JSON_PATH,
    coverageEvidencePath: NO_EXECUTABLE_COVERAGE_BATCH_PATH,
  });
  runValidator();

  const queryCompareManifest = {
    waveId: QUERY_COMPARE_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_discovery_query_family_compare",
    cohortSource: path.join(OUT_DIR, "positive_control_set.json"),
    brands: DEFAULT_IDENTITY_BRANDS,
    queryStrategy: "query_family_comparison_source_normalized",
    sourcePriority: ["iherb_reader_search", "search_engine_site_fallback"],
    stopRules: ["Keep query-family comparison source-normalized.", "Do not mix source families in one score."],
    successMetric: "identify which query family best surfaces expected pages without raising false-positive risk",
    newMethod: true,
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_discovery_query_family_compare"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };
  const queryComparisonReport = await harness.buildDiscoveryQueryFamilyComparisonReport({
    rows: positiveControls,
    waveId: QUERY_COMPARE_WAVE_ID,
    primarySourceFamily: "iherb_reader_search",
  });
  await writeJson(QUERY_COMPARE_JSON_PATH, queryComparisonReport);
  await writeText(QUERY_COMPARE_MD_PATH, buildQueryCompareMarkdown(queryComparisonReport));
  const queryCompareResult = {
    waveId: QUERY_COMPARE_WAVE_ID,
    lane: "kpi",
    pathKey: queryCompareManifest.pathKey,
    attempted: positiveControls.length,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: Object.fromEntries(
      (queryComparisonReport.sourceFamilies ?? []).map((sourceEntry) => [
        sourceEntry.sourceFamily,
        Object.values(sourceEntry.families ?? {}).filter((family) => Number(family.expectedPageVisibility ?? 0) === 0).length,
      ]),
    ),
    decision: "retarget",
    outcomeClass: "diagnostic_success",
    evidencePath: QUERY_COMPARE_JSON_PATH,
    executionHealth: queryComparisonReport.executionHealth,
    executed: true,
  };
  await harness.syncCurrentAndHistory({
    manifest: queryCompareManifest,
    result: queryCompareResult,
    currentManifestPath: CURRENT_MANIFEST_PATH,
    currentResultPath: CURRENT_RESULT_PATH,
    historyManifestPath: path.join(OUTPUT_WAVES_DIR, `${QUERY_COMPARE_WAVE_ID}_manifest.json`),
    historyResultPath: path.join(OUTPUT_WAVES_DIR, `${QUERY_COMPARE_WAVE_ID}_result.json`),
    activeCanonicalDir: ACTIVE_CANONICAL_DIR,
    historyCanonicalDir: HISTORY_CANONICAL_DIR,
    markdownCopies: [{ sourcePath: QUERY_COMPARE_MD_PATH, canonicalName: "discovery_query_family_comparison.md" }],
    currentJsonCopies: [
      { sourcePath: runtimeBlockerPath, canonicalName: "blocker_registry.json" },
      { sourcePath: runtimeRoiPath, canonicalName: "brand_path_roi_registry.json" },
    ],
  });
  await updateHarnessRegistries({
    manifest: queryCompareManifest,
    result: queryCompareResult,
    blockerStatus: "paused",
    blockerClass: "source_selection_defect",
    evidencePath: QUERY_COMPARE_JSON_PATH,
    coverageEvidencePath: NO_EXECUTABLE_COVERAGE_BATCH_PATH,
  });
  runValidator();

  const pathProofManifest = {
    waveId: PATH_PROOF_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_discovery_path_proof",
    cohortSource: path.join(OUT_DIR, "positive_control_set.json"),
    brands: DEFAULT_IDENTITY_BRANDS,
    queryStrategy: "one_new_discovery_path_proof",
    sourcePriority: ["mechanically_selected_from_source_and_query_comparison"],
    stopRules: ["Positive controls only.", "No unresolved micro-canary in this phase.", "No staging mutation by default."],
    successMetric: "raise discoveryHits above 0 with zero falsePositiveRisk",
    newMethod: true,
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_discovery_path_proof"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };
  const pathProofReport = await harness.runDiscoveryPathProof({
    rows: positiveControls,
    waveId: PATH_PROOF_WAVE_ID,
    sourceComparisonReport,
    queryComparisonReport,
  });
  await writeJson(PATH_PROOF_JSON_PATH, pathProofReport);
  await writeText(PATH_PROOF_MD_PATH, buildPathProofMarkdown(pathProofReport));
  const pathProofResult = {
    waveId: PATH_PROOF_WAVE_ID,
    lane: "kpi",
    pathKey: pathProofManifest.pathKey,
    attempted: pathProofReport.summary.attempted,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: {
      discoveryHits: pathProofReport.summary.discoveryHits,
      falsePositiveRisk: pathProofReport.summary.falsePositiveRisk,
    },
    decision: pathProofReport.summary.proven ? "retarget" : "pause",
    outcomeClass: pathProofReport.summary.proven ? "strategy_proof" : "diagnostic_success",
    evidencePath: PATH_PROOF_JSON_PATH,
    executionHealth: pathProofReport.executionHealth,
    executed: true,
  };
  await harness.syncCurrentAndHistory({
    manifest: pathProofManifest,
    result: pathProofResult,
    currentManifestPath: CURRENT_MANIFEST_PATH,
    currentResultPath: CURRENT_RESULT_PATH,
    historyManifestPath: path.join(OUTPUT_WAVES_DIR, `${PATH_PROOF_WAVE_ID}_manifest.json`),
    historyResultPath: path.join(OUTPUT_WAVES_DIR, `${PATH_PROOF_WAVE_ID}_result.json`),
    activeCanonicalDir: ACTIVE_CANONICAL_DIR,
    historyCanonicalDir: HISTORY_CANONICAL_DIR,
    markdownCopies: [{ sourcePath: PATH_PROOF_MD_PATH, canonicalName: "discovery_path_proof.md" }],
    currentJsonCopies: [
      { sourcePath: runtimeBlockerPath, canonicalName: "blocker_registry.json" },
      { sourcePath: runtimeRoiPath, canonicalName: "brand_path_roi_registry.json" },
    ],
  });

  const coverageExecutable = false;
  await writeText(
    NO_EXECUTABLE_COVERAGE_BATCH_PATH,
    [
      "# No Executable Coverage Batch",
      "",
      `- generatedAt: ${new Date().toISOString()}`,
      "- Week 3 Phase 1 is discovery/search infrastructure work only.",
      "- No truly new executable non-exhausted proven coverage path appeared in the ROI registry.",
      "- Coverage remained intentionally skipped.",
      "",
    ].join("\n"),
  );

  await updateHarnessRegistries({
    manifest: pathProofManifest,
    result: pathProofResult,
    blockerStatus: pathProofReport.summary.proven ? "hold" : "exhausted",
    blockerClass: pathProofReport.summary.proven ? "retargetable_discovery_path_proven" : "current_strict_iherb_discovery_exhausted",
    evidencePath: PATH_PROOF_JSON_PATH,
    coverageEvidencePath: NO_EXECUTABLE_COVERAGE_BATCH_PATH,
  });
  runValidator();

  const bestSourceFamily = chooseBestSourceFamily(sourceComparisonReport);
  const bestQueryFamily = chooseBestQueryFamily(queryComparisonReport);
  await writeText(
    FINAL_SUMMARY_PATH,
    buildSummaryMarkdown({
      startingBaseline,
      endingBaseline,
      bestSourceFamily,
      bestQueryFamily,
      proofReport: pathProofReport,
      coverageExecutable,
    }),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          sourceComparisonJson: SOURCE_COMPARE_JSON_PATH,
          queryComparisonJson: QUERY_COMPARE_JSON_PATH,
          discoveryPathProofJson: PATH_PROOF_JSON_PATH,
          summaryMd: FINAL_SUMMARY_PATH,
          blockerRegistry: runtimeBlockerPath,
          brandPathRoiRegistry: runtimeRoiPath,
          waveManifestCurrent: CURRENT_MANIFEST_PATH,
          waveResultCurrent: CURRENT_RESULT_PATH,
        },
        startingBaseline,
        endingBaseline,
        noBaselineDelta: true,
        classification: pathProofReport.summary.classification,
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
