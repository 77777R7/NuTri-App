import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type FailCode =
  | "D2_NEEDS_REVIEW"
  | "INFRA_RETRYABLE"
  | "LOGIC_FAIL_STOP"
  | "C_NO_ACTIONABLE"
  | "D_NO_PLAN";

type BatchDecision =
  | "PASS"
  | "FAIL_STOP"
  | "NO_WORK"
  | "BLOCKED_BY_REVIEW"
  | "APPLIED_BUT_FAILED"
  | "SKIPPED_PASS";

type RootCauseProduct = {
  sourceId?: string | null;
  source_id?: string | null;
  canonicalSourceId?: string | null;
  canonical_source_id?: string | null;
  primaryReason?: string | null;
  primary_reason?: string | null;
};

type RootCausePayload = {
  zeroCoverageCount?: number;
  summary?: {
    total?: number;
    counts?: Record<string, number>;
  };
  products?: RootCauseProduct[];
};

type TargetSummary = {
  targetCount?: number;
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

type D2GateSummary = {
  pass?: boolean;
  riskySingletonCount?: number;
  fingerprint?: string;
};

type ApplySummary = {
  counts?: {
    aliasesToInsert?: number;
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
  status?: number | null;
  errorCode?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type SourceIdsPayload =
  | string[]
  | {
      sourceIds?: unknown[];
    };

type BatchGateReport = {
  batch: string;
  lane: "mismatch_lane";
  inputs: {
    beforeJson: string;
    afterJson: string;
    fixedIds: string;
    targetIds: string;
    impactTargetIds: string;
    fanoutJson: string;
    mainRebackfillSummary: string;
    replaySummary: string | null;
  };
  impactKeyMode: "canonical_or_source_int_normalized";
  impactSubset: {
    impactSize: number;
    zeroCoverage: { before: number; after: number };
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
    finalFailed: number;
    finalExisting: number;
  };
  rules: {
    impact_zero_strict_drop: boolean;
    global_zero_non_increase: boolean;
    global_unknown_non_increase: boolean;
    rebackfill_integrity_ok: boolean;
  };
  pass: boolean;
  decision: "PASS" | "FAIL_STOP";
  reason?: string;
  generatedAt: string;
};

type BatchState = {
  lane: "mismatch_lane";
  batchId: string;
  status: "running" | "stopped" | "failed" | "passed";
  currentStep: string;
  apply_done: boolean;
  decision: BatchDecision | null;
  updatedAt: string;
  artifacts: Record<string, string>;
  dbWrites: {
    aliasesToInsert: number;
    insertedAliases: number;
    rollbackSql: string | null;
    applySummary: string | null;
  };
  resumeFromStep: string | null;
  failCode: FailCode | null;
};

type StopDecisionPayload = {
  timestamp: string;
  lane: "mismatch_lane";
  batchId: string;
  step: string;
  decision: BatchDecision;
  failCode: FailCode;
  reason: string;
  reasonHash: string;
  fingerprint: string | null;
  artifacts: Record<string, string>;
  extra?: Record<string, unknown>;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((value) => value.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const hasFlag = (flag: string) => args.includes(`--${flag}`);

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
const gitCommit = (process.env.GIT_COMMIT ?? "").trim() || "unknown";

const DEFAULT_RUN_DIR = path.join(
  repoRoot,
  "output/p1d/post_force156_zero_cov_20260220/step_followup_p0_p2_20260221/p1_missingVerified_wave2_20260221",
);
const DEFAULT_FIXED_IDS = path.join(
  repoRoot,
  "output/p1d/post_force156_zero_cov_20260220/lnhpd_sample_ids_limit1000_seed42_after_p0p2_fixedfetch_v3.json",
);
const DEFAULT_B03_BEFORE = path.join(DEFAULT_RUN_DIR, "B02/after_fixedfetch.json");

const RUN_DIR = path.resolve(getArg("run-dir") ?? DEFAULT_RUN_DIR);
const BATCH_ID = (getArg("batch-id") ?? "B03").trim();
const BATCH_DIR = path.resolve(getArg("batch-dir") ?? path.join(RUN_DIR, BATCH_ID));
const FIXED_IDS = path.resolve(getArg("fixed-ids") ?? DEFAULT_FIXED_IDS);
const BEFORE_JSON = path.resolve(getArg("before-json") ?? DEFAULT_B03_BEFORE);
const MAX_RESUME_RETRIES = Math.max(1, toFiniteInt(getArg("max-resume-retries") ?? "5", 5));

const TARGET_IDS = path.join(BATCH_DIR, "target_ids.json");
const TARGET_SUMMARY = path.join(BATCH_DIR, "target_summary.json");
const IMPACT_TARGET_IDS = path.join(BATCH_DIR, "target_ids_impact_key.json");
const IMPACT_TARGET_SUMMARY = path.join(BATCH_DIR, "target_summary_impact_key.json");

const MISMATCH_DIAG_DIR = path.join(BATCH_DIR, "mismatch_diag");
const MISMATCH_SUMMARY = path.join(MISMATCH_DIAG_DIR, "mismatch_summary_lnhpd.json");
const STEP_C_GATE = path.join(BATCH_DIR, "step_c_actionable_gate.json");

const REMEDIATION_PLAN = path.join(BATCH_DIR, "mismatch_remediation_plan_lnhpd.json");
const HARVEST_SUMMARY = path.join(BATCH_DIR, "mismatch_alias_harvest_summary.json");
const D2_PLAN_RISK_GATE = path.join(BATCH_DIR, "d2_plan_risk_gate.json");
const D2_REVIEW = path.join(BATCH_DIR, "d2_risky_singletons_review.json");

const APPLY_SUMMARY = path.join(BATCH_DIR, "mismatch_apply_summary.json");
const ROLLBACK_SQL = path.join(BATCH_DIR, "rollback.sql");

const TOUCHED_INGREDIENT_IDS = path.join(BATCH_DIR, "touched_ingredient_ids.json");
const FANOUT_SOURCE_IDS = path.join(BATCH_DIR, "fanout_source_ids.json");
const FANOUT_SUMMARY = path.join(BATCH_DIR, "fanout_summary.json");

const MAIN_CHECKPOINT = path.join(BATCH_DIR, "force_rebackfill_checkpoint.json");
const MAIN_SUMMARY = path.join(BATCH_DIR, "force_rebackfill_summary.json");
const MAIN_FAILURES = path.join(BATCH_DIR, "force_rebackfill_failures.jsonl");

const REPLAY_SOURCE_IDS = path.join(BATCH_DIR, "replay_source_ids.json");
const REPLAY_CHECKPOINT = path.join(BATCH_DIR, "replay_checkpoint.json");
const REPLAY_SUMMARY = path.join(BATCH_DIR, "replay_summary.json");
const REPLAY_FAILURES = path.join(BATCH_DIR, "replay_failures.jsonl");

const AFTER_FIXEDFETCH = path.join(BATCH_DIR, "after_fixedfetch.json");
const BATCH_GATE_REPORT = path.join(BATCH_DIR, "batch_gate_report.json");
const BATCH_STATE_FILE = path.join(BATCH_DIR, "batch_state.json");
const STOP_DECISION_FILE = path.join(BATCH_DIR, "stop_decision.json");

const artifacts: Record<string, string> = {
  batchDir: BATCH_DIR,
  beforeJson: BEFORE_JSON,
  fixedIds: FIXED_IDS,
  targetIds: TARGET_IDS,
  targetSummary: TARGET_SUMMARY,
  impactTargetIds: IMPACT_TARGET_IDS,
  impactTargetSummary: IMPACT_TARGET_SUMMARY,
  mismatchDiagDir: MISMATCH_DIAG_DIR,
  mismatchSummary: MISMATCH_SUMMARY,
  stepCActionableGate: STEP_C_GATE,
  mismatchPlan: REMEDIATION_PLAN,
  mismatchPlanSummary: HARVEST_SUMMARY,
  d2Gate: D2_PLAN_RISK_GATE,
  d2Review: D2_REVIEW,
  applySummary: APPLY_SUMMARY,
  rollbackSql: ROLLBACK_SQL,
  touchedIngredientIds: TOUCHED_INGREDIENT_IDS,
  fanoutSourceIds: FANOUT_SOURCE_IDS,
  fanoutSummary: FANOUT_SUMMARY,
  mainCheckpoint: MAIN_CHECKPOINT,
  mainSummary: MAIN_SUMMARY,
  mainFailures: MAIN_FAILURES,
  replaySourceIds: REPLAY_SOURCE_IDS,
  replayCheckpoint: REPLAY_CHECKPOINT,
  replaySummary: REPLAY_SUMMARY,
  replayFailures: REPLAY_FAILURES,
  afterFixedfetch: AFTER_FIXEDFETCH,
  batchGateReport: BATCH_GATE_REPORT,
  batchState: BATCH_STATE_FILE,
  stopDecision: STOP_DECISION_FILE,
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
          `[${BATCH_ID}] command failed: ${cmd} ${cmdArgs.join(" ")} (exit=${code ?? "null"} signal=${signal ?? "null"})`,
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
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) return String(parsed);
  }
  return text;
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const parsed = await readJson<SourceIdsPayload>(filePath);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sourceIds)
      ? parsed.sourceIds
      : [];
  return list
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};

const loadIdsSet = async (filePath: string): Promise<Set<string>> => {
  const sourceIds = await loadSourceIds(filePath);
  const set = new Set<string>();
  sourceIds.forEach((id) => {
    const key = intNorm(id);
    if (key) set.add(key);
  });
  return set;
};

const buildZeroSet = (payload: RootCausePayload): Set<string> => {
  const set = new Set<string>();
  (payload.products ?? []).forEach((product) => {
    const key = intNorm(
      product.canonicalSourceId ??
        product.canonical_source_id ??
        product.sourceId ??
        product.source_id ??
        null,
    );
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

  while (summary.processed! < params.expectedSourceIdCount && attempts < params.maxResumeRetries) {
    attempts += 1;
    await runBackfillOnce(params);
    summary = summarizeBackfill(await readJsonOrNull<BackfillSummary>(params.summaryJson));
  }

  return { summary, resumeAttempts: attempts };
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
        const entry = JSON.parse(line) as FailureEntry;
        const chosen = entry.canonicalSourceId ?? entry.sourceId ?? null;
        const key = intNorm(chosen);
        if (key) replay.add(key);
      } catch {
        // noop
      }
    });
  return Array.from(replay).sort((a, b) => a.localeCompare(b));
};

const loadFailureEntries = async (filePath: string): Promise<FailureEntry[]> => {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as FailureEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is FailureEntry => Boolean(entry));
};

const INFRA_STATUS = new Set([401, 403, 429, 500, 502, 503, 504]);
const INFRA_CODE_PATTERNS = [/ETIMEDOUT/i, /ECONN/i, /ENOTFOUND/i, /EAI_AGAIN/i, /UND_ERR/i];
const INFRA_MESSAGE_PATTERNS = [
  /network/i,
  /timeout/i,
  /timed out/i,
  /gateway/i,
  /fetch failed/i,
  /temporarily unavailable/i,
  /rate limit/i,
  /auth/i,
  /unauthor/i,
  /forbidden/i,
];

const isInfraEntry = (entry: FailureEntry): boolean => {
  const status = toFiniteInt(entry.status, 0);
  if (INFRA_STATUS.has(status)) return true;
  const code = `${entry.errorCode ?? ""}`;
  if (INFRA_CODE_PATTERNS.some((pattern) => pattern.test(code))) return true;
  const message = `${entry.message ?? ""} ${entry.details ?? ""} ${entry.hint ?? ""}`;
  return INFRA_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
};

const classifyFailureCode = async (params: {
  mainFailures: string;
  replayFailures: string | null;
  fallbackMessage?: string;
}): Promise<FailCode> => {
  const mainEntries = await loadFailureEntries(params.mainFailures);
  const replayEntries = params.replayFailures ? await loadFailureEntries(params.replayFailures) : [];
  const combined = [...mainEntries, ...replayEntries];
  if (combined.some(isInfraEntry)) return "INFRA_RETRYABLE";
  const fallback = params.fallbackMessage ?? "";
  if (INFRA_MESSAGE_PATTERNS.some((pattern) => pattern.test(fallback))) {
    return "INFRA_RETRYABLE";
  }
  return "LOGIC_FAIL_STOP";
};

const buildReasonHash = (params: {
  step: string;
  failCode: FailCode;
  reason: string;
  fingerprint?: string | null;
  targetCount?: number | null;
}): string => {
  const payload = [
    "mismatch_lane",
    BATCH_ID,
    params.step,
    params.failCode,
    params.fingerprint ?? "",
    normalizeText(params.reason),
    BEFORE_JSON,
    String(params.targetCount ?? ""),
    gitCommit,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
};

const createInitialState = (): BatchState => ({
  lane: "mismatch_lane",
  batchId: BATCH_ID,
  status: "running",
  currentStep: "INIT",
  apply_done: false,
  decision: null,
  updatedAt: new Date().toISOString(),
  artifacts,
  dbWrites: {
    aliasesToInsert: 0,
    insertedAliases: 0,
    rollbackSql: null,
    applySummary: null,
  },
  resumeFromStep: null,
  failCode: null,
});

const persistState = async (state: BatchState, patch: Partial<BatchState>) => {
  Object.assign(state, patch, { updatedAt: new Date().toISOString() });
  await writeJson(BATCH_STATE_FILE, state);
};

const writeStopDecision = async (
  state: BatchState,
  params: {
    step: string;
    failCode: FailCode;
    reason: string;
    decision: BatchDecision;
    fingerprint?: string | null;
    extra?: Record<string, unknown>;
    targetCount?: number | null;
  },
) => {
  const payload: StopDecisionPayload = {
    timestamp: new Date().toISOString(),
    lane: "mismatch_lane",
    batchId: BATCH_ID,
    step: params.step,
    decision: params.decision,
    failCode: params.failCode,
    reason: params.reason,
    reasonHash: buildReasonHash({
      step: params.step,
      failCode: params.failCode,
      reason: params.reason,
      fingerprint: params.fingerprint ?? null,
      targetCount: params.targetCount ?? null,
    }),
    fingerprint: params.fingerprint ?? null,
    artifacts,
    ...(params.extra ? { extra: params.extra } : {}),
  };
  await writeJson(STOP_DECISION_FILE, payload);

  const status =
    params.decision === "BLOCKED_BY_REVIEW" || params.decision === "NO_WORK"
      ? "stopped"
      : "failed";
  await persistState(state, {
    status,
    decision: params.decision,
    failCode: params.failCode,
    currentStep: params.step,
  });
};

const failStop = async (
  state: BatchState,
  params: {
    step: string;
    failCode: "INFRA_RETRYABLE" | "LOGIC_FAIL_STOP";
    reason: string;
    extra?: Record<string, unknown>;
    targetCount?: number | null;
  },
): Promise<never> => {
  const decision: BatchDecision = state.apply_done ? "APPLIED_BUT_FAILED" : "FAIL_STOP";
  await writeStopDecision(state, {
    step: params.step,
    failCode: params.failCode,
    reason: params.reason,
    decision,
    extra: params.extra,
    targetCount: params.targetCount ?? null,
  });
  throw new Error(`[${BATCH_ID}][${params.step}] ${params.reason}`);
};

const stopNoWork = async (
  state: BatchState,
  params: {
    step: string;
    failCode: "C_NO_ACTIONABLE" | "D_NO_PLAN";
    reason: string;
    extra?: Record<string, unknown>;
    targetCount?: number | null;
  },
) => {
  await writeStopDecision(state, {
    step: params.step,
    failCode: params.failCode,
    reason: params.reason,
    decision: "NO_WORK",
    extra: params.extra,
    targetCount: params.targetCount ?? null,
  });
};

const stopBlockedByReview = async (
  state: BatchState,
  params: {
    step: string;
    reason: string;
    fingerprint: string;
    extra?: Record<string, unknown>;
  },
) => {
  await writeStopDecision(state, {
    step: params.step,
    failCode: "D2_NEEDS_REVIEW",
    reason: params.reason,
    decision: "BLOCKED_BY_REVIEW",
    fingerprint: params.fingerprint,
    extra: params.extra,
  });
};

const run = async () => {
  await mkdir(BATCH_DIR, { recursive: true });
  const state = createInitialState();
  const existingState = await readJsonOrNull<BatchState>(BATCH_STATE_FILE);
  if (existingState) Object.assign(state, existingState, { artifacts });
  await persistState(state, { status: "running", currentStep: "INIT" });

  const existingGateReport = await readJsonOrNull<BatchGateReport>(BATCH_GATE_REPORT);
  if (existingGateReport?.decision === "PASS") {
    await persistState(state, {
      status: "passed",
      decision: "SKIPPED_PASS",
      currentStep: "SKIP_PASS",
      failCode: null,
    });
    console.log(JSON.stringify({ output: BATCH_GATE_REPORT, decision: "SKIPPED_PASS" }, null, 2));
    return;
  }

  const resumeFromApply = state.apply_done === true;
  if (resumeFromApply) {
    await persistState(state, { resumeFromStep: "F", currentStep: "F_RESUME" });
  }

  let impactTargetCount = 0;
  if (!resumeFromApply) {
    await persistState(state, { currentStep: "A_TARGETS" });
    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      BEFORE_JSON,
      "--reason",
      "mismatch",
      "--id-mode",
      "canonical_source_id",
      "--output",
      TARGET_IDS,
      "--summary",
      TARGET_SUMMARY,
    ]);
    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      BEFORE_JSON,
      "--reason",
      "mismatch",
      "--id-mode",
      "impact_key",
      "--output",
      IMPACT_TARGET_IDS,
      "--summary",
      IMPACT_TARGET_SUMMARY,
    ]);

    const impactSummary = await readJson<TargetSummary>(IMPACT_TARGET_SUMMARY);
    impactTargetCount = toFiniteInt(impactSummary.targetCount, 0);
    if (BATCH_ID === "B03") {
      if (impactTargetCount !== 64) {
        await failStop(state, {
          step: "A",
          failCode: "LOGIC_FAIL_STOP",
          reason: `B03 targetCount expected 64 but got ${impactTargetCount}`,
          extra: { impactSummary: IMPACT_TARGET_SUMMARY },
          targetCount: impactTargetCount,
        });
      }
    } else if (impactTargetCount <= 0) {
      await stopNoWork(state, {
        step: "A",
        failCode: "C_NO_ACTIONABLE",
        reason: "targetCount == 0 for mismatch lane",
        extra: { impactSummary: IMPACT_TARGET_SUMMARY },
        targetCount: impactTargetCount,
      });
      return;
    }

    await persistState(state, { currentStep: "B_DIAGNOSE", resumeFromStep: null });
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

    await persistState(state, { currentStep: "C_ACTIONABLE_GATE" });
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
      await stopNoWork(state, {
        step: "C",
        failCode: "C_NO_ACTIONABLE",
        reason: "actionable == 0 (formRawMissing + formRawNoMatch)",
        extra: { stepCGate: STEP_C_GATE },
        targetCount: impactTargetCount,
      });
      return;
    }

    await persistState(state, { currentStep: "D_BUILD_ALIAS_PLAN" });
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
    state.dbWrites.aliasesToInsert = aliasesToInsert;
    if (aliasesToInsert <= 0) {
      await persistState(state, { dbWrites: state.dbWrites });
      await stopNoWork(state, {
        step: "D",
        failCode: "D_NO_PLAN",
        reason: "aliasesToInsert == 0",
        extra: { harvestSummary: HARVEST_SUMMARY },
        targetCount: impactTargetCount,
      });
      return;
    }

    await persistState(state, { currentStep: "D2_RISK_AUDIT", dbWrites: state.dbWrites });
    await runCmd("npx", [
      "tsx",
      "scripts/audit-alias-plan-risk.ts",
      "--plan",
      REMEDIATION_PLAN,
      "--out-gate",
      D2_PLAN_RISK_GATE,
      "--out-review",
      D2_REVIEW,
    ]);
    const d2Gate = await readJson<D2GateSummary>(D2_PLAN_RISK_GATE);
    const riskySingletonCount = toFiniteInt(d2Gate.riskySingletonCount, 0);
    const fingerprint = (d2Gate.fingerprint ?? "").trim();
    if (riskySingletonCount > 0) {
      await stopBlockedByReview(state, {
        step: "D2",
        reason: `risky_singletons=${riskySingletonCount} requires manual review`,
        fingerprint: fingerprint || "missing_fingerprint",
        extra: { d2Gate: D2_PLAN_RISK_GATE, d2Review: D2_REVIEW },
      });
      return;
    }

    await persistState(state, { currentStep: "E_APPLY", dbWrites: state.dbWrites });
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
    const aliasesToInsertInApply = toFiniteInt(applySummary.counts?.aliasesToInsert, 0);
    const insertedAliases = toFiniteInt(applySummary.counts?.insertedAliases, 0);
    const rollbackExists = await fileExists(ROLLBACK_SQL);
    if (insertedAliases !== aliasesToInsertInApply || !rollbackExists) {
      await failStop(state, {
        step: "E",
        failCode: "LOGIC_FAIL_STOP",
        reason: `apply integrity failed (insertedAliases=${insertedAliases}, aliasesToInsert=${aliasesToInsertInApply}, rollbackExists=${rollbackExists})`,
        extra: { applySummary: APPLY_SUMMARY, rollbackSql: ROLLBACK_SQL },
      });
    }

    state.apply_done = true;
    state.dbWrites.insertedAliases = insertedAliases;
    state.dbWrites.rollbackSql = ROLLBACK_SQL;
    state.dbWrites.applySummary = APPLY_SUMMARY;
    await persistState(state, {
      apply_done: true,
      dbWrites: state.dbWrites,
      currentStep: "E_DONE",
      resumeFromStep: "F",
    });
  }

  await persistState(state, { currentStep: "F_FANOUT", resumeFromStep: "F" });
  const applySummary = await readJson<ApplySummary>(APPLY_SUMMARY);
  const touchedIngredientIds = Array.from(
    new Set((applySummary.touchedIngredientIds ?? []).map((value) => value.trim()).filter(Boolean)),
  );
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
    "--page-size",
    "1000",
  ]);
  const fanoutSummary = await readJson<FanoutSummary>(FANOUT_SUMMARY);
  const sourceIdCount = toFiniteInt(fanoutSummary.sourceIdCount, 0);
  if (sourceIdCount <= 0) {
    await failStop(state, {
      step: "F",
      failCode: "LOGIC_FAIL_STOP",
      reason: "fanout sourceIdCount == 0",
      extra: { fanoutSummary: FANOUT_SUMMARY },
    });
  }

  await persistState(state, { currentStep: "H_BACKFILL", resumeFromStep: "H" });
  const mainBackfill = await runBackfillUntilProcessed({
    sourceIdsFile: FANOUT_SOURCE_IDS,
    checkpointFile: MAIN_CHECKPOINT,
    summaryJson: MAIN_SUMMARY,
    failuresFile: MAIN_FAILURES,
    expectedSourceIdCount: sourceIdCount,
    maxResumeRetries: MAX_RESUME_RETRIES,
  });
  const mainSummary = mainBackfill.summary;
  if (mainSummary.processed !== sourceIdCount) {
    const failCode = await classifyFailureCode({
      mainFailures: MAIN_FAILURES,
      replayFailures: null,
      fallbackMessage: "main backfill processed mismatch",
    });
    await failStop(state, {
      step: "H",
      failCode,
      reason: `main backfill incomplete (processed=${mainSummary.processed}, sourceIdCount=${sourceIdCount})`,
      extra: { mainSummary: MAIN_SUMMARY, resumeAttempts: mainBackfill.resumeAttempts },
    });
  }

  let replaySourceIdCount = 0;
  let replaySummary: BackfillSummary | null = null;
  if (toFiniteInt(mainSummary.failed, 0) > 0) {
    const replayIds = await loadFailuresReplayIds(MAIN_FAILURES);
    replaySourceIdCount = replayIds.length;
    if (replayIds.length === 0) {
      const failCode = await classifyFailureCode({
        mainFailures: MAIN_FAILURES,
        replayFailures: null,
        fallbackMessage: "failed > 0 but replay ids is empty",
      });
      await failStop(state, {
        step: "H",
        failCode,
        reason: "main failed > 0 but replay source ids is empty",
        extra: { mainFailures: MAIN_FAILURES },
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
    if (replaySummary.processed !== replaySourceIdCount || toFiniteInt(replaySummary.failed, 0) > 0) {
      const failCode = await classifyFailureCode({
        mainFailures: MAIN_FAILURES,
        replayFailures: REPLAY_FAILURES,
        fallbackMessage: "replay backfill failed",
      });
      await failStop(state, {
        step: "H",
        failCode,
        reason: `replay integrity failed (processed=${replaySummary.processed}/${replaySourceIdCount}, failed=${replaySummary.failed})`,
        extra: { replaySummary: REPLAY_SUMMARY, resumeAttempts: replayBackfill.resumeAttempts },
      });
    }
  }

  const finalFailed = replaySummary
    ? toFiniteInt(replaySummary.failed, 0)
    : toFiniteInt(mainSummary.failed, 0);
  const finalExisting = replaySummary
    ? toFiniteInt(replaySummary.existing, 0)
    : toFiniteInt(mainSummary.existing, 0);
  const rebackfillIntegrityOk =
    mainSummary.processed === sourceIdCount &&
    finalFailed === 0 &&
    finalExisting === 0 &&
    (!replaySummary || replaySummary.processed === replaySourceIdCount);

  if (!rebackfillIntegrityOk) {
    const failCode = await classifyFailureCode({
      mainFailures: MAIN_FAILURES,
      replayFailures: replaySummary ? REPLAY_FAILURES : null,
      fallbackMessage: "rebackfill integrity gate failed",
    });
    await failStop(state, {
      step: "H",
      failCode,
      reason: `rebackfill integrity failed (processed=${mainSummary.processed}/${sourceIdCount}, failed=${finalFailed}, existing=${finalExisting})`,
      extra: {
        mainSummary: MAIN_SUMMARY,
        replaySummary: replaySummary ? REPLAY_SUMMARY : null,
      },
    });
  }

  await persistState(state, { currentStep: "I_FIXED_SAMPLE_RECHECK", resumeFromStep: "I" });
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

  await persistState(state, { currentStep: "J_GATE", resumeFromStep: "J" });
  const beforePayload = await readJson<RootCausePayload>(BEFORE_JSON);
  const afterPayload = await readJson<RootCausePayload>(AFTER_FIXEDFETCH);
  const impactIds = await loadIdsSet(IMPACT_TARGET_IDS);

  const beforeZeroSet = buildZeroSet(beforePayload);
  const afterZeroSet = buildZeroSet(afterPayload);

  const impactSize = impactIds.size;
  const impactZeroBefore = countIntersection(impactIds, beforeZeroSet);
  const impactZeroAfter = countIntersection(impactIds, afterZeroSet);

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

  const rules = {
    impact_zero_strict_drop: impactZeroAfter < impactZeroBefore,
    global_zero_non_increase: globalZeroAfter <= globalZeroBefore,
    global_unknown_non_increase: globalUnknownAfter <= globalUnknownBefore,
    rebackfill_integrity_ok: rebackfillIntegrityOk,
  };
  const pass = Object.values(rules).every(Boolean);

  const gateReport: BatchGateReport = {
    batch: BATCH_ID,
    lane: "mismatch_lane",
    generatedAt: new Date().toISOString(),
    inputs: {
      beforeJson: BEFORE_JSON,
      afterJson: AFTER_FIXEDFETCH,
      fixedIds: FIXED_IDS,
      targetIds: TARGET_IDS,
      impactTargetIds: IMPACT_TARGET_IDS,
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
      finalFailed,
      finalExisting,
    },
    rules,
    pass,
    decision: pass ? "PASS" : "FAIL_STOP",
    ...(pass ? {} : { reason: "one_or_more_gate_rules_failed" }),
  };
  await writeJson(BATCH_GATE_REPORT, gateReport);

  if (!pass) {
    await failStop(state, {
      step: "J",
      failCode: "LOGIC_FAIL_STOP",
      reason: "batch gate failed",
      extra: { gateReport: BATCH_GATE_REPORT, rules },
    });
  }

  await persistState(state, {
    status: "passed",
    currentStep: "DONE",
    decision: "PASS",
    failCode: null,
    resumeFromStep: null,
  });

  console.log(
    JSON.stringify(
      {
        output: BATCH_GATE_REPORT,
        decision: "PASS",
        batchId: BATCH_ID,
      },
      null,
      2,
    ),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${BATCH_ID}] failed:`, message);
    try {
      const state = (await readJsonOrNull<BatchState>(BATCH_STATE_FILE)) ?? createInitialState();
      const alreadyStopped = await fileExists(STOP_DECISION_FILE);
      if (!alreadyStopped) {
        await writeStopDecision(state, {
          step: state.currentStep || "UNHANDLED",
          failCode: "LOGIC_FAIL_STOP",
          reason: message || "unhandled runner error",
          decision: state.apply_done ? "APPLIED_BUT_FAILED" : "FAIL_STOP",
        });
      }
    } catch {
      // best effort only
    }
    process.exit(1);
  });
}
