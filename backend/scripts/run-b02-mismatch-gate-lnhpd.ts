import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RootCauseProduct = {
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  primaryReason?: string | null;
};

type RootCausePayload = {
  zeroCoverageCount?: number;
  summary?: {
    total?: number;
    counts?: Record<string, number>;
  };
  products?: RootCauseProduct[];
};

type MismatchSummaryPayload = {
  counts?: {
    formRawMissing?: number;
    formRawNoMatch?: number;
    taxonomyMismatch?: number;
  };
};

type PlanHarvestSummary = {
  counts?: {
    aliasesToInsert?: number;
  };
};

type ApplySummary = {
  counts?: {
    insertedAliases?: number;
  };
  touchedIngredientIds?: string[];
};

type FanoutSummary = {
  sourceIdCount?: number;
};

type BackfillSummary = {
  processed?: number;
  failed?: number;
  scores?: number;
  existing?: number;
  skipped?: number;
  ingredientUpsertFailed?: number;
  scoreUpsertFailed?: number;
  computeScoreFailed?: number;
  sourceIdsFile?: string | null;
};

type FailureEntry = {
  sourceId?: string;
  canonicalSourceId?: string | null;
};

type SourceIdsPayload =
  | string[]
  | {
      sourceIds?: unknown[];
    };

type GateReport = {
  batch: "B02";
  inputs: {
    beforeJson: string;
    afterJson: string;
    fixedIds: string;
    targetIds: string;
    fanoutJson: string;
    mainRebackfillSummary: string;
    replaySummary: string | null;
  };
  impactKeyMode: "canonical_or_source_int_normalized";
  impactSubset: {
    impactSize: number;
    zeroCoverage: { before: number; after: number };
    mismatch: { before: number; after: number };
  };
  globalGuardrail: {
    zeroCoverageCount: { before: number; after: number };
    unknown: { before: number; after: number };
  };
  rebackfill: {
    sourceIdCount: number;
    main: BackfillSummary;
    replay: BackfillSummary | null;
    replaySourceIdCount: number;
  };
  rules: {
    impact_size_gt_0: boolean;
    impact_zero_strict_drop: boolean;
    impact_mismatch_non_increase: boolean;
    global_zero_non_increase: boolean;
    global_unknown_non_increase: boolean;
    rebackfill_integrity_ok: boolean;
  };
  pass: boolean;
  decision: "PASS" | "FAIL_STOP";
  reason?: string;
  generatedAt: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((arg) => arg.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const toFiniteInt = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(backendDir, "..");

const DEFAULT_RUN_DIR = path.join(
  repoRoot,
  "output/p1d/post_force156_zero_cov_20260220/step_followup_p0_p2_20260221/p1_missingVerified_wave2_20260221",
);
const DEFAULT_FIXED_IDS = path.join(
  repoRoot,
  "output/p1d/post_force156_zero_cov_20260220/lnhpd_sample_ids_limit1000_seed42_after_p0p2_fixedfetch_v3.json",
);

const RUN_DIR = path.resolve(getArg("run-dir") ?? DEFAULT_RUN_DIR);
const B01_DIR = path.resolve(getArg("b01-dir") ?? path.join(RUN_DIR, "B01"));
const B02_DIR = path.resolve(getArg("b02-dir") ?? path.join(RUN_DIR, "B02"));
const FIXED_IDS = path.resolve(getArg("fixed-ids") ?? DEFAULT_FIXED_IDS);
const TARGET_IDS = path.resolve(
  getArg("target-ids") ?? path.join(B02_DIR, "mismatch_target_canonical_ids.json"),
);
const BEFORE_JSON = path.resolve(
  getArg("before-json") ?? path.join(B01_DIR, "after_fixedfetch.json"),
);
const MAX_RESUME_RETRIES = Math.max(1, toFiniteInt(getArg("max-resume-retries") ?? "5", 5));

const TARGET_SUMMARY = path.join(B02_DIR, "mismatch_target_summary.json");
const MISMATCH_DIAG_DIR = path.join(B02_DIR, "mismatch_diag");
const MISMATCH_SUMMARY = path.join(MISMATCH_DIAG_DIR, "mismatch_summary_lnhpd.json");
const STEP_C_GATE = path.join(B02_DIR, "step_c_actionable_gate.json");

const REMEDIATION_PLAN = path.join(B02_DIR, "mismatch_remediation_plan_lnhpd.json");
const HARVEST_SUMMARY = path.join(B02_DIR, "mismatch_alias_harvest_summary.json");
const APPLY_SUMMARY = path.join(B02_DIR, "mismatch_apply_summary.json");
const ROLLBACK_SQL = path.join(B02_DIR, "rollback.sql");

const TOUCHED_INGREDIENT_IDS = path.join(B02_DIR, "touched_ingredient_ids.json");
const FANOUT_SOURCE_IDS = path.join(B02_DIR, "fanout_source_ids.json");
const FANOUT_SUMMARY = path.join(B02_DIR, "fanout_summary.json");

const MAIN_CHECKPOINT = path.join(B02_DIR, "force_rebackfill_checkpoint.json");
const MAIN_SUMMARY = path.join(B02_DIR, "force_rebackfill_summary.json");
const MAIN_FAILURES = path.join(B02_DIR, "force_rebackfill_failures.jsonl");

const REPLAY_SOURCE_IDS = path.join(B02_DIR, "replay_source_ids.json");
const REPLAY_CHECKPOINT = path.join(B02_DIR, "replay_checkpoint.json");
const REPLAY_SUMMARY = path.join(B02_DIR, "replay_summary.json");
const REPLAY_FAILURES = path.join(B02_DIR, "replay_failures.jsonl");

const AFTER_FIXEDFETCH = path.join(B02_DIR, "after_fixedfetch.json");
const BATCH_GATE_REPORT = path.join(B02_DIR, "batch_gate_report.json");
const EXECUTION_STATUS = path.join(B02_DIR, "b02_execution_status.json");
const STOP_DECISION = path.join(B02_DIR, "b02_stop_decision.json");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const readJsonOrNull = async <T>(filePath: string): Promise<T | null> => {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
};

const runCmd = async (cmd: string, cmdArgs: string[]) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: backendDir,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `[b02] command failed: ${cmd} ${cmdArgs.join(" ")} (exit=${code ?? "null"} signal=${signal ?? "null"})`,
        ),
      );
    });
  });
};

const intNorm = (value: unknown): string | null => {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^[+-]?\d+$/.test(text)) {
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n)) return String(n);
  }
  return text;
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const parsed = await readJson<SourceIdsPayload>(filePath);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sourceIds)
      ? parsed.sourceIds
      : [];
  return items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

const loadIdsSet = async (filePath: string): Promise<Set<string>> => {
  const ids = await loadSourceIds(filePath);
  const out = new Set<string>();
  ids.forEach((id) => {
    const key = intNorm(id);
    if (key) out.add(key);
  });
  return out;
};

const loadFailuresReplayIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  const replay = new Set<string>();
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      try {
        const parsed = JSON.parse(line) as FailureEntry;
        const chosen = parsed.canonicalSourceId ?? parsed.sourceId ?? null;
        const key = intNorm(chosen);
        if (key) replay.add(key);
      } catch {
        // Ignore malformed lines; they will surface via replay size checks.
      }
    });
  return Array.from(replay).sort();
};

const summarizeBackfill = (summary: BackfillSummary | null): BackfillSummary => ({
  processed: toFiniteInt(summary?.processed, 0),
  failed: toFiniteInt(summary?.failed, 0),
  scores: toFiniteInt(summary?.scores, 0),
  existing: toFiniteInt(summary?.existing, 0),
  skipped: toFiniteInt(summary?.skipped, 0),
  ingredientUpsertFailed: toFiniteInt(summary?.ingredientUpsertFailed, 0),
  scoreUpsertFailed: toFiniteInt(summary?.scoreUpsertFailed, 0),
  computeScoreFailed: toFiniteInt(summary?.computeScoreFailed, 0),
  sourceIdsFile: summary?.sourceIdsFile ?? null,
});

const runBackfillOnce = async (params: {
  sourceIdsFile: string;
  checkpointFile: string;
  summaryJson: string;
  failuresFile: string;
}) => {
  await runCmd("npx", [
    "tsx",
    "scripts/backfill-v4-scores.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    params.sourceIdsFile,
    "--scores-only",
    "--force",
    "--checkpoint-file",
    params.checkpointFile,
    "--summary-json",
    params.summaryJson,
    "--failures-file",
    params.failuresFile,
  ]);
};

const runBackfillUntilProcessed = async (params: {
  sourceIdsFile: string;
  checkpointFile: string;
  summaryJson: string;
  failuresFile: string;
  expectedSourceIdCount: number;
  maxResumeRetries: number;
}): Promise<{ summary: BackfillSummary; resumeAttempts: number }> => {
  await runBackfillOnce(params);
  let summary = summarizeBackfill(await readJsonOrNull<BackfillSummary>(params.summaryJson));
  let attempts = 0;

  while (
    summary.processed! < params.expectedSourceIdCount &&
    attempts < params.maxResumeRetries
  ) {
    attempts += 1;
    await runBackfillOnce(params);
    summary = summarizeBackfill(await readJsonOrNull<BackfillSummary>(params.summaryJson));
  }

  return { summary, resumeAttempts: attempts };
};

const failStop = async (step: string, reason: string, extra?: Record<string, unknown>) => {
  await writeJson(STOP_DECISION, {
    timestamp: new Date().toISOString(),
    runDir: RUN_DIR,
    b02Dir: B02_DIR,
    step,
    decision: "FAIL_STOP",
    reason,
    ...(extra ? { extra } : {}),
  });
  throw new Error(`[b02][${step}] ${reason}`);
};

const buildZeroSet = (payload: RootCausePayload): Set<string> => {
  const set = new Set<string>();
  (payload.products ?? []).forEach((product) => {
    const key = intNorm(product.canonicalSourceId ?? product.sourceId ?? null);
    if (key) set.add(key);
  });
  return set;
};

const buildReasonSet = (
  payload: RootCausePayload,
  reason: string,
): Set<string> => {
  const set = new Set<string>();
  (payload.products ?? []).forEach((product) => {
    if ((product.primaryReason ?? "") !== reason) return;
    const key = intNorm(product.canonicalSourceId ?? product.sourceId ?? null);
    if (key) set.add(key);
  });
  return set;
};

const countIntersection = (a: Set<string>, b: Set<string>): number => {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count += 1;
  }
  return count;
};

const run = async () => {
  await mkdir(B02_DIR, { recursive: true });

  // Step A: target count precheck.
  const targetSummary = await readJson<{ targetCount?: number }>(TARGET_SUMMARY);
  const targetCount = toFiniteInt(targetSummary?.targetCount, 0);
  if (targetCount !== 47) {
    await failStop("A", `targetCount expected 47 but got ${targetCount}`, {
      targetSummary: TARGET_SUMMARY,
    });
  }

  // Step B: mismatch diagnose.
  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-form-taxonomy-mismatch.ts",
    "--source",
    "lnhpd",
    "--id-column",
    "canonical_source_id",
    "--source-ids-file",
    TARGET_IDS,
    "--out-dir",
    MISMATCH_DIAG_DIR,
    "--top-n",
    "100",
  ]);

  // Step C: actionable gate.
  const mismatchSummary = await readJson<MismatchSummaryPayload>(MISMATCH_SUMMARY);
  const formRawMissing = toFiniteInt(mismatchSummary.counts?.formRawMissing, 0);
  const formRawNoMatch = toFiniteInt(mismatchSummary.counts?.formRawNoMatch, 0);
  const actionable = formRawMissing + formRawNoMatch;
  await writeJson(STEP_C_GATE, {
    generatedAt: new Date().toISOString(),
    mismatchSummaryPath: MISMATCH_SUMMARY,
    counts: {
      formRawMissing,
      formRawNoMatch,
      taxonomyMismatch: toFiniteInt(mismatchSummary.counts?.taxonomyMismatch, 0),
    },
    actionable,
    pass: actionable > 0,
  });
  if (actionable <= 0) {
    await failStop("C", "actionable == 0 (formRawMissing + formRawNoMatch)", {
      stepCGate: STEP_C_GATE,
    });
  }

  // Step D: alias-only harvest plan.
  await runCmd("npx", [
    "tsx",
    "scripts/build-formraw-alias-remediation-plan.ts",
    "--source",
    "lnhpd",
    "--id-column",
    "canonical_source_id",
    "--source-ids-file",
    TARGET_IDS,
    "--output",
    REMEDIATION_PLAN,
    "--summary",
    HARVEST_SUMMARY,
  ]);

  const harvestSummary = await readJsonOrNull<PlanHarvestSummary>(HARVEST_SUMMARY);
  const aliasesToInsert = toFiniteInt(harvestSummary?.counts?.aliasesToInsert, 0);
  if (aliasesToInsert <= 0) {
    await failStop("D", "aliasesToInsert == 0", {
      harvestSummary: HARVEST_SUMMARY,
    });
  }

  // Step E: apply + rollback.
  await runCmd("npx", [
    "tsx",
    "scripts/apply-mismatch-remediation-plan.ts",
    "--plan",
    REMEDIATION_PLAN,
    "--apply",
    "--summary",
    APPLY_SUMMARY,
    "--rollback",
    ROLLBACK_SQL,
  ]);

  const applySummary = await readJson<ApplySummary>(APPLY_SUMMARY);
  const insertedAliases = toFiniteInt(applySummary.counts?.insertedAliases, 0);
  const touchedIngredientIds = Array.from(
    new Set((applySummary.touchedIngredientIds ?? []).filter(Boolean)),
  );
  if (insertedAliases <= 0 || touchedIngredientIds.length === 0) {
    await failStop(
      "E",
      `apply validation failed (insertedAliases=${insertedAliases}, touchedIngredientIds=${touchedIngredientIds.length})`,
      {
        applySummary: APPLY_SUMMARY,
      },
    );
  }

  // Step F: fanout from touched ingredient ids.
  await writeJson(TOUCHED_INGREDIENT_IDS, { ingredientIds: touchedIngredientIds });
  await runCmd("npx", [
    "tsx",
    "scripts/build-promotion-rebackfill-lnhpd.ts",
    "--ingredient-ids-file",
    TOUCHED_INGREDIENT_IDS,
    "--output",
    FANOUT_SOURCE_IDS,
    "--summary",
    FANOUT_SUMMARY,
  ]);
  const fanoutSummary = await readJson<FanoutSummary>(FANOUT_SUMMARY);
  const sourceIdCount = toFiniteInt(fanoutSummary.sourceIdCount, 0);
  if (sourceIdCount <= 0) {
    await failStop("F", "sourceIdCount == 0", {
      fanoutSummary: FANOUT_SUMMARY,
    });
  }

  // Step G/H: backfill main + integrity gates.
  const mainBackfill = await runBackfillUntilProcessed({
    sourceIdsFile: FANOUT_SOURCE_IDS,
    checkpointFile: MAIN_CHECKPOINT,
    summaryJson: MAIN_SUMMARY,
    failuresFile: MAIN_FAILURES,
    expectedSourceIdCount: sourceIdCount,
    maxResumeRetries: MAX_RESUME_RETRIES,
  });
  const mainSummary = mainBackfill.summary;
  if (mainSummary.processed! < sourceIdCount) {
    await failStop(
      "H",
      `main backfill incomplete after retries (processed=${mainSummary.processed}, sourceIdCount=${sourceIdCount})`,
      {
        mainSummary: MAIN_SUMMARY,
        resumeAttempts: mainBackfill.resumeAttempts,
      },
    );
  }

  let replaySummary: BackfillSummary | null = null;
  let replaySourceIdCount = 0;
  if (mainSummary.processed === sourceIdCount && toFiniteInt(mainSummary.failed, 0) > 0) {
    const replayIds = await loadFailuresReplayIds(MAIN_FAILURES);
    replaySourceIdCount = replayIds.length;
    if (!replayIds.length) {
      await failStop("H", "main failed > 0 but replay source ids is empty", {
        mainFailures: MAIN_FAILURES,
      });
    }
    await writeJson(REPLAY_SOURCE_IDS, { sourceIds: replayIds });

    const replayBackfill = await runBackfillUntilProcessed({
      sourceIdsFile: REPLAY_SOURCE_IDS,
      checkpointFile: REPLAY_CHECKPOINT,
      summaryJson: REPLAY_SUMMARY,
      failuresFile: REPLAY_FAILURES,
      expectedSourceIdCount: replaySourceIdCount,
      maxResumeRetries: MAX_RESUME_RETRIES,
    });
    replaySummary = replayBackfill.summary;

    if (replaySummary.processed! < replaySourceIdCount) {
      await failStop(
        "H",
        `replay incomplete after retries (processed=${replaySummary.processed}, replaySourceIdCount=${replaySourceIdCount})`,
        {
          replaySummary: REPLAY_SUMMARY,
          resumeAttempts: replayBackfill.resumeAttempts,
        },
      );
    }
    if (toFiniteInt(replaySummary.failed, 0) > 0) {
      await failStop(
        "H",
        `replay failed > 0 (${toFiniteInt(replaySummary.failed, 0)})`,
        {
          replaySummary: REPLAY_SUMMARY,
        },
      );
    }
  }

  // Step I: fixed-sample re-check.
  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-zero-coverage-root-causes.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    FIXED_IDS,
    "--output",
    AFTER_FIXEDFETCH,
  ]);

  // Step J: gate report.
  const beforePayload = await readJson<RootCausePayload>(BEFORE_JSON);
  const afterPayload = await readJson<RootCausePayload>(AFTER_FIXEDFETCH);
  const impactIds = await loadIdsSet(TARGET_IDS);

  const beforeZeroSet = buildZeroSet(beforePayload);
  const afterZeroSet = buildZeroSet(afterPayload);
  const beforeMismatchSet = buildReasonSet(beforePayload, "mismatch");
  const afterMismatchSet = buildReasonSet(afterPayload, "mismatch");

  const impactSize = impactIds.size;
  const impactZeroBefore = countIntersection(impactIds, beforeZeroSet);
  const impactZeroAfter = countIntersection(impactIds, afterZeroSet);
  const impactMismatchBefore = countIntersection(impactIds, beforeMismatchSet);
  const impactMismatchAfter = countIntersection(impactIds, afterMismatchSet);

  const globalZeroBefore = toFiniteInt(
    beforePayload.summary?.total ?? beforePayload.zeroCoverageCount ?? beforeZeroSet.size,
    beforeZeroSet.size,
  );
  const globalZeroAfter = toFiniteInt(
    afterPayload.summary?.total ?? afterPayload.zeroCoverageCount ?? afterZeroSet.size,
    afterZeroSet.size,
  );
  const globalUnknownBefore = toFiniteInt(beforePayload.summary?.counts?.unknown, 0);
  const globalUnknownAfter = toFiniteInt(afterPayload.summary?.counts?.unknown, 0);

  const rebackfillIntegrityOk =
    mainSummary.processed === sourceIdCount &&
    (toFiniteInt(mainSummary.failed, 0) === 0 || toFiniteInt(replaySummary?.failed, 0) === 0);

  const rules = {
    impact_size_gt_0: impactSize > 0,
    impact_zero_strict_drop: impactZeroAfter < impactZeroBefore,
    impact_mismatch_non_increase: impactMismatchAfter <= impactMismatchBefore,
    global_zero_non_increase: globalZeroAfter <= globalZeroBefore,
    global_unknown_non_increase: globalUnknownAfter <= globalUnknownBefore,
    rebackfill_integrity_ok: rebackfillIntegrityOk,
  };
  const pass = Object.values(rules).every(Boolean);

  const gateReport: GateReport = {
    batch: "B02",
    generatedAt: new Date().toISOString(),
    inputs: {
      beforeJson: BEFORE_JSON,
      afterJson: AFTER_FIXEDFETCH,
      fixedIds: FIXED_IDS,
      targetIds: TARGET_IDS,
      fanoutJson: FANOUT_SOURCE_IDS,
      mainRebackfillSummary: MAIN_SUMMARY,
      replaySummary: replaySummary ? REPLAY_SUMMARY : null,
    },
    impactKeyMode: "canonical_or_source_int_normalized",
    impactSubset: {
      impactSize,
      zeroCoverage: {
        before: impactZeroBefore,
        after: impactZeroAfter,
      },
      mismatch: {
        before: impactMismatchBefore,
        after: impactMismatchAfter,
      },
    },
    globalGuardrail: {
      zeroCoverageCount: {
        before: globalZeroBefore,
        after: globalZeroAfter,
      },
      unknown: {
        before: globalUnknownBefore,
        after: globalUnknownAfter,
      },
    },
    rebackfill: {
      sourceIdCount,
      main: mainSummary,
      replay: replaySummary,
      replaySourceIdCount,
    },
    rules,
    pass,
    decision: pass ? "PASS" : "FAIL_STOP",
    ...(pass ? {} : { reason: "one_or_more_gate_rules_failed" }),
  };

  await writeJson(BATCH_GATE_REPORT, gateReport);

  if (!pass) {
    await failStop("J", "B02 gate failed", {
      gateReport: BATCH_GATE_REPORT,
      rules,
    });
  }

  await writeJson(EXECUTION_STATUS, {
    timestamp: new Date().toISOString(),
    phase: "B02 mismatch harvest",
    gateDecision: "PASS",
    notes:
      "B02 gate passed with alias-only mismatch harvest, scores-only rebackfill, and replay-integrity checks.",
    artifacts: {
      before: BEFORE_JSON,
      after: AFTER_FIXEDFETCH,
      gateReport: BATCH_GATE_REPORT,
      remediationPlan: REMEDIATION_PLAN,
      applySummary: APPLY_SUMMARY,
      fanoutSummary: FANOUT_SUMMARY,
      rebackfillSummary: MAIN_SUMMARY,
      replaySummary: replaySummary ? REPLAY_SUMMARY : null,
    },
  });

  console.log(
    JSON.stringify(
      {
        output: BATCH_GATE_REPORT,
        decision: "PASS",
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[b02] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
