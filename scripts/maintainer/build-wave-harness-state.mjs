#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const RUNTIME_DIR = getArg("runtime-dir", path.join(ROOT, "output"));
const CANONICAL_DIR = getArg("canonical-dir", path.join(ROOT, "docs", "exec-plans", "active", "week2_5"));
const CURRENT_MANIFEST_PATH = getArg("current-manifest-json", path.join(ROOT, "output", "wave_manifest_current.json"));
const CURRENT_RESULT_PATH = getArg("current-result-json", path.join(ROOT, "output", "wave_result_current.json"));
const ROOT_CAUSE_REPORT_PATH = getArg(
  "root-cause-report-json",
  path.join(ROOT, "output", "identity_recovery_root_cause_report.json"),
);
const ROOT_CAUSE_REPORT_MD_PATH = getArg(
  "root-cause-report-md",
  path.join(ROOT, "output", "identity_recovery_root_cause_report.md"),
);
const COVERAGE_REPORT_PATH = getArg("coverage-report-json", null);
const KPI_V1_REPORT_PATH = getArg(
  "kpi-v1-report-json",
  path.join(ROOT, "output", "iherb_search_recovery_week2_remaining_kpi_shard1_v2_20260313", "iherb_search_recovery_report.json"),
);
const NOW_BATCH1_REPORT_PATH = getArg(
  "now-batch1-report-json",
  path.join(ROOT, "output", "now_foods_week2_remaining_batch1_20260313", "official_fallback_report.json"),
);
const NOW_BATCH2_REPORT_PATH = getArg(
  "now-batch2-report-json",
  path.join(ROOT, "output", "now_foods_week2_remaining_batch2_20260313", "official_fallback_report.json"),
);
const POST_CLOSE_BLOCKERS_PATH = getArg(
  "post-close-blockers-md",
  path.join(ROOT, "output", "post_close_blockers_20260313.md"),
);
const WEEK2_REMAINING_BLOCKERS_PATH = getArg(
  "week2-remaining-blockers-md",
  path.join(ROOT, "output", "week2_remaining_blockers_20260313.md"),
);

const readOptionalJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const copyIfExists = async (sourcePath, targetPath) => {
  if (!(await fileExists(sourcePath))) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
};

const toPattern = (uplifts) => {
  if (!Array.isArray(uplifts) || uplifts.length === 0) return "not_enough_history";
  if (uplifts.length === 1) return uplifts[0] > 0 ? "single_positive" : "single_zero";
  const lastTwo = uplifts.slice(-2);
  if (lastTwo[0] > 0 && lastTwo[1] > 0) return "positive_then_positive";
  if (lastTwo[0] > 0 && lastTwo[1] === 0) return "positive_then_zero";
  if (lastTwo[0] === 0 && lastTwo[1] === 0) return "zero_then_zero";
  return lastTwo[lastTwo.length - 1] > 0 ? "single_positive" : "single_zero";
};

const buildDecision = (pattern, lastBatchUplift, fallback = "retarget") => {
  if (pattern === "positive_then_positive") return "scale";
  if (pattern === "positive_then_zero") return "pause";
  if (pattern === "zero_then_zero") return "pause";
  if (pattern === "single_positive") return lastBatchUplift > 0 ? "scale" : "retarget";
  if (pattern === "single_zero") return "pause";
  return fallback;
};

const buildRetargetCoverageDecision = (uplift) => {
  if (uplift >= 4) return "scale";
  if (uplift > 0) return "retarget";
  return "pause";
};

const main = async () => {
  const [rootCauseReport, currentManifest, currentResult, kpiV1Report, nowBatch1, nowBatch2, coverageReport] =
    await Promise.all([
      readOptionalJson(ROOT_CAUSE_REPORT_PATH),
      readOptionalJson(CURRENT_MANIFEST_PATH),
      readOptionalJson(CURRENT_RESULT_PATH),
      readOptionalJson(KPI_V1_REPORT_PATH),
      readOptionalJson(NOW_BATCH1_REPORT_PATH),
      readOptionalJson(NOW_BATCH2_REPORT_PATH),
      COVERAGE_REPORT_PATH ? readOptionalJson(COVERAGE_REPORT_PATH) : null,
    ]);

  const blockerRegistryPath = path.join(RUNTIME_DIR, "blocker_registry.json");
  const roiRegistryPath = path.join(RUNTIME_DIR, "brand_path_roi_registry.json");
  const canonicalBlockerPath = path.join(CANONICAL_DIR, "blocker_registry.json");
  const canonicalRoiPath = path.join(CANONICAL_DIR, "brand_path_roi_registry.json");

  const rootCauseOutcomeClass = rootCauseReport?.summary?.outcomeClass ?? "not_run";
  const rootCauseWaveId = rootCauseReport?.waveId ?? null;
  const rootCauseStatus =
    rootCauseOutcomeClass === "execution_success"
      ? "proven"
      : rootCauseOutcomeClass === "strategy_proof"
        ? "hold"
        : rootCauseOutcomeClass === "diagnostic_success"
          ? "hold"
          : "paused";

  const nowBroadUplifts = [
    Number(nowBatch1?.summary?.becameFullOverlayReady ?? 0),
    Number(nowBatch2?.summary?.becameFullOverlayReady ?? 0),
  ].filter((value, idx) => (idx === 0 ? true : nowBatch2 != null));
  const nowRetargetUplifts = coverageReport ? [Number(coverageReport?.summary?.becameFullOverlayReady ?? 0)] : [];

  const blockerRegistry = {
    "kpi:official_fetch_unresolved/iherb_identity_v1": {
      blockerClass: "strict_identity_not_proven",
      lane: "kpi",
      evidencePath: KPI_V1_REPORT_PATH,
      unpauseCondition: "Only retry with a new identity method and a passing positive-control check.",
      status: "hold",
      lastReviewedWaveId: "week2_remaining_kpi_shard1_v2",
      canonicalPath: canonicalBlockerPath,
    },
    "kpi:official_fetch_unresolved/iherb_identity_v2": {
      blockerClass:
        rootCauseOutcomeClass === "execution_success"
          ? "proven_new_identity_strategy"
          : rootCauseOutcomeClass === "strategy_proof"
            ? "query_or_normalization_gap"
            : rootCauseOutcomeClass === "diagnostic_success"
              ? "root_cause_isolated_not_scaled"
              : "strict_identity_not_proven",
      lane: "kpi",
      evidencePath: (await fileExists(ROOT_CAUSE_REPORT_PATH)) ? ROOT_CAUSE_REPORT_PATH : KPI_V1_REPORT_PATH,
      unpauseCondition:
        rootCauseOutcomeClass === "execution_success"
          ? "Scale only on the same proven sub-cause cluster."
          : "Require a new query family, stronger normalization, or a new accepted sub-brand rule.",
      status: rootCauseStatus,
      lastReviewedWaveId: rootCauseWaveId,
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:now_foods/official_warnings": {
      blockerClass: "path_exhausted_on_current_filter",
      lane: "coverage",
      evidencePath: NOW_BATCH2_REPORT_PATH,
      unpauseCondition: "Retarget to a narrower cohort with a genuinely new filter.",
      status: "paused",
      lastReviewedWaveId: "week2_remaining_now_batch2",
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:now_foods/official_warnings_retarget": {
      blockerClass:
        nowRetargetUplifts.length === 0
          ? "not_run_yet"
          : nowRetargetUplifts[0] > 0
            ? "proven_retargeted_path"
            : "retarget_zero_yield",
      lane: "coverage",
      evidencePath: COVERAGE_REPORT_PATH ?? NOW_BATCH2_REPORT_PATH,
      unpauseCondition: nowRetargetUplifts[0] > 0 ? "Retain the narrower cohort and continue only while uplift stays positive." : "Require another narrower cohort or a new extraction path.",
      status: nowRetargetUplifts.length === 0 ? "hold" : nowRetargetUplifts[0] > 0 ? "proven" : "paused",
      lastReviewedWaveId: currentResult?.waveId ?? null,
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:wet_n_wild/stable_cohort": {
      blockerClass: "stable_warning_extraction_not_proven",
      lane: "coverage",
      evidencePath: POST_CLOSE_BLOCKERS_PATH,
      unpauseCondition: "Only reopen with a new stable shade-level identity or page-level warning path.",
      status: "paused",
      lastReviewedWaveId: "post_close_wet_n_wild_stable_micro",
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:boiron/ocr": {
      blockerClass: "structured_conversion_missing",
      lane: "coverage",
      evidencePath: POST_CLOSE_BLOCKERS_PATH,
      unpauseCondition: "Only reopen when OCR converts to structured fields reliably.",
      status: "paused",
      lastReviewedWaveId: "week2_locked",
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:aura_cacia/ocr": {
      blockerClass: "structured_conversion_missing",
      lane: "coverage",
      evidencePath: POST_CLOSE_BLOCKERS_PATH,
      unpauseCondition: "Only reopen with a new non-OCR structured conversion path.",
      status: "paused",
      lastReviewedWaveId: "week2_locked",
      canonicalPath: canonicalBlockerPath,
    },
    "coverage:frontier/broad_scale": {
      blockerClass: "broad_scale_low_yield",
      lane: "coverage",
      evidencePath: POST_CLOSE_BLOCKERS_PATH,
      unpauseCondition: "Only reopen with a narrower or newly proven cohort.",
      status: "hold",
      lastReviewedWaveId: "post_close_frontier",
      canonicalPath: canonicalBlockerPath,
    },
    "partial:21st_century/rapidapi_exact_identity": {
      blockerClass: "identity_hits_without_closure_uplift",
      lane: "partial",
      evidencePath: POST_CLOSE_BLOCKERS_PATH,
      unpauseCondition: "Only reopen if RapidAPI begins recovering ingredient or dosage on exact-identity rows.",
      status: "paused",
      lastReviewedWaveId: "post_close_21st_century_rapidapi_5",
      canonicalPath: canonicalBlockerPath,
    },
    "deep_gap:category_stage1": {
      blockerClass: "no_executable_category_cohort",
      lane: "deep_gap",
      evidencePath: WEEK2_REMAINING_BLOCKERS_PATH,
      unpauseCondition: "Only reopen when a real target-category cohort reappears on the latest merged line.",
      status: "hold",
      lastReviewedWaveId: "week2_remaining_deep_gap_stage1",
      canonicalPath: canonicalBlockerPath,
    },
  };

  const roiRegistry = {
    "official_fetch_unresolved:iherb_identity_v1": {
      totalBatchesRun: kpiV1Report ? 1 : 0,
      totalCompleteUplift: Number(kpiV1Report?.summary?.recoveredComplete ?? 0),
      lastBatchUplift: Number(kpiV1Report?.summary?.recoveredComplete ?? 0),
      lastTwoBatchPattern: kpiV1Report ? "single_zero" : "not_enough_history",
      currentDecision: kpiV1Report ? "pause" : "retarget",
      lastWaveId: "week2_remaining_kpi_shard1_v2",
    },
    "official_fetch_unresolved:iherb_identity_v2": {
      totalBatchesRun: rootCauseReport ? 1 : 0,
      totalCompleteUplift: Number(rootCauseReport?.summary?.recoveredComplete ?? 0),
      lastBatchUplift: Number(rootCauseReport?.summary?.recoveredComplete ?? 0),
      lastTwoBatchPattern: rootCauseReport
        ? Number(rootCauseReport?.summary?.recoveredComplete ?? 0) > 0
          ? "single_positive"
          : "single_zero"
        : "not_enough_history",
      currentDecision:
        rootCauseOutcomeClass === "execution_success"
          ? "scale"
          : rootCauseOutcomeClass === "strategy_proof" || rootCauseOutcomeClass === "diagnostic_success"
            ? "retarget"
            : rootCauseReport
              ? "pause"
              : "retarget",
      lastWaveId: rootCauseWaveId,
    },
    "NOW Foods:official_warnings_path": {
      totalBatchesRun: nowBroadUplifts.length,
      totalCompleteUplift: nowBroadUplifts.reduce((sum, value) => sum + value, 0),
      lastBatchUplift: nowBroadUplifts.at(-1) ?? 0,
      lastTwoBatchPattern: toPattern(nowBroadUplifts),
      currentDecision: buildDecision(toPattern(nowBroadUplifts), nowBroadUplifts.at(-1) ?? 0, "pause"),
      lastWaveId: "week2_remaining_now_batch2",
    },
    "NOW Foods:official_warnings_path_retarget": {
      totalBatchesRun: nowRetargetUplifts.length,
      totalCompleteUplift: nowRetargetUplifts.reduce((sum, value) => sum + value, 0),
      lastBatchUplift: nowRetargetUplifts.at(-1) ?? 0,
      lastTwoBatchPattern: toPattern(nowRetargetUplifts),
      currentDecision: buildRetargetCoverageDecision(nowRetargetUplifts.at(-1) ?? 0),
      lastWaveId: currentResult?.waveId ?? null,
    },
    "Carlson:official_ocr_warning": {
      totalBatchesRun: 5,
      totalCompleteUplift: 35,
      lastBatchUplift: 8,
      lastTwoBatchPattern: "positive_then_positive",
      currentDecision: "close",
      lastWaveId: "post_close_carlson_facts_remaining_10",
    },
    "Wet n Wild:stable_cohort": {
      totalBatchesRun: 1,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "single_zero",
      currentDecision: "pause",
      lastWaveId: "post_close_wet_n_wild_stable_micro_1",
    },
    "21st Century:rapidapi_exact_identity": {
      totalBatchesRun: 1,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "single_zero",
      currentDecision: "pause",
      lastWaveId: "post_close_21st_century_rapidapi_5",
    },
    "deep_gap:category_stage1": {
      totalBatchesRun: 1,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "single_zero",
      currentDecision: "close",
      lastWaveId: "week2_remaining_deep_gap_stage1",
    },
  };

  await writeJson(blockerRegistryPath, blockerRegistry);
  await writeJson(roiRegistryPath, roiRegistry);
  await writeJson(canonicalBlockerPath, blockerRegistry);
  await writeJson(canonicalRoiPath, roiRegistry);

  await copyIfExists(CURRENT_MANIFEST_PATH, path.join(CANONICAL_DIR, "wave_manifest_current.json"));
  await copyIfExists(CURRENT_RESULT_PATH, path.join(CANONICAL_DIR, "wave_result_current.json"));
  await copyIfExists(ROOT_CAUSE_REPORT_MD_PATH, path.join(CANONICAL_DIR, "identity_recovery_root_cause_report.md"));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          blockerRegistryPath,
          roiRegistryPath,
          canonicalDir: CANONICAL_DIR,
        },
        stats: {
          blockerEntries: Object.keys(blockerRegistry).length,
          roiEntries: Object.keys(roiRegistry).length,
          currentManifestPresent: await fileExists(CURRENT_MANIFEST_PATH),
          currentResultPresent: await fileExists(CURRENT_RESULT_PATH),
        },
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
