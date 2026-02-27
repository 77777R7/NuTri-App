import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type FailCode =
  | "D2_NEEDS_REVIEW"
  | "INFRA_RETRYABLE"
  | "LOGIC_FAIL_STOP"
  | "C_NO_ACTIONABLE"
  | "D_NO_PLAN";

type LaneName =
  | "mismatch_lane"
  | "wave3_lane"
  | "unit_missing_lane"
  | "ingredient_id_missing_lane";
type SimpleRootCauseLane = "unit_missing_lane" | "ingredient_id_missing_lane";
type RootCauseReason = "missingVerified" | "unit_missing" | "ingredient_id_missing";

type LaneStatus =
  | "ready"
  | "running"
  | "cooldown"
  | "blocked_by_review"
  | "paused"
  | "done";

type LaneState = {
  name: LaneName;
  status: LaneStatus;
  nextBatchNumber: number;
  currentBatchId: string | null;
  currentBatchDir: string | null;
  cooldownUntil: string | null;
  infraRetryCount: number;
  consecutiveLogicFails: number;
  blockedFingerprint: string | null;
  blockedBatchId: string | null;
  lastFailCode: FailCode | null;
  lastReasonHash: string | null;
};

type RepeatEntry = {
  timestamps: string[];
};

type SupervisorState = {
  runId: string;
  runDir: string;
  runSessionDir: string;
  startedAt: string;
  updatedAt: string;
  lanes: {
    mismatch_lane: LaneState;
    wave3_lane: LaneState;
    unit_missing_lane: LaneState;
    ingredient_id_missing_lane: LaneState;
  };
  repeatTracker: Record<string, RepeatEntry>;
  stopReason: string | null;
};

type StopDecisionPayload = {
  timestamp: string;
  lane: LaneName;
  batchId: string;
  step: string;
  decision: string;
  failCode: FailCode;
  reason: string;
  reasonHash: string;
  fingerprint: string | null;
  artifacts: Record<string, string>;
  extra?: Record<string, unknown>;
};

type BatchStateFile = {
  lane?: LaneName;
  batchId?: string;
  status?: string;
  currentStep?: string;
  apply_done?: boolean;
  decision?: string | null;
  failCode?: FailCode | null;
  artifacts?: Record<string, string>;
  dbWrites?: {
    rollbackSql?: string | null;
    applySummary?: string | null;
    aliasesToInsert?: number;
    insertedAliases?: number;
  };
};

type GateReport = {
  pass?: boolean;
  decision?: string;
};

type RollbackQueueItem = {
  timestamp: string;
  lane: LaneName;
  batchId: string;
  rollbackSql: string;
  reasonHash: string | null;
  status: "queued" | "executed" | "failed";
  executedAt?: string;
  error?: string;
};

type RootCauseProduct = {
  sourceId?: string | null;
  source_id?: string | null;
  canonicalSourceId?: string | null;
  canonical_source_id?: string | null;
};

type RootCausePayload = {
  zeroCoverageCount?: number;
  summary?: {
    total?: number;
    counts?: Record<string, number>;
  };
  products?: RootCauseProduct[];
};

type SourceIdsPayload =
  | string[]
  | {
      sourceIds?: unknown[];
    };

type BackfillSummary = {
  processed?: number;
  failed?: number;
  existing?: number;
  scores?: number;
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

type MissingFormsPlan = {
  candidates?: Array<{
    ingredientId?: string;
    recommendedFormKey?: string | null;
  }>;
};

type UnitNormalizeSummary = {
  candidateCount?: number;
  appliedCount?: number;
  failedCount?: number;
};

type RefreshMissingIngredientSummary = {
  summary?: {
    attemptedRows?: number;
    resolvedRows?: number;
    updatedRows?: number;
    updateErrors?: number;
  };
};

type Wave3BatchResult = {
  batchId: string;
  batchDir: string;
  pass: boolean;
  failCode: FailCode | null;
  reason: string | null;
  reasonHash: string | null;
  fingerprint: string | null;
  step: string;
  decision: string;
  applyDone: boolean;
  rollbackSql: string | null;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
const DEFAULT_B03_BEFORE = path.join(DEFAULT_RUN_DIR, "B02/after_fixedfetch.json");

const RUN_DIR = path.resolve(getArg("run-dir") ?? DEFAULT_RUN_DIR);
const RUN_HOURS = Math.max(1, Number(getArg("run-hours") ?? "24"));
const POLL_INTERVAL_MS = Math.max(1, Number(getArg("poll-interval-sec") ?? "20")) * 1000;
const START_MISMATCH_BATCH = Math.max(3, toFiniteInt(getArg("start-mismatch-batch") ?? "3", 3));
const START_WAVE3_BATCH = Math.max(3, toFiniteInt(getArg("start-wave3-batch") ?? "3", 3));
const START_UNIT_MISSING_BATCH = Math.max(3, toFiniteInt(getArg("start-unit-missing-batch") ?? "3", 3));
const START_INGREDIENT_ID_MISSING_BATCH = Math.max(3, toFiniteInt(getArg("start-ingredient-id-missing-batch") ?? "3", 3));
const MAX_REPEAT_24H = Math.max(1, toFiniteInt(getArg("max-repeat-24h") ?? "3", 3));
const LOCK_TIMEOUT_MIN = Math.max(1, toFiniteInt(getArg("lock-timeout-min") ?? "10", 10));
const ENABLE_AUTO_ROLLBACK = hasFlag("enable-auto-rollback");
const FIXED_IDS = path.resolve(getArg("fixed-ids") ?? DEFAULT_FIXED_IDS);
const MISMATCH_B03_BEFORE = path.resolve(getArg("b03-before-json") ?? DEFAULT_B03_BEFORE);
const gitCommit = (process.env.GIT_COMMIT ?? "").trim() || "unknown";
const UNIT_NORMALIZE_APPLY_ACK = "I_UNDERSTAND_PROD_WRITE_2026_02_20";

const runIdFromArg = getArg("run-id");
const runId = runIdFromArg ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const runSessionDir = path.resolve(getArg("run-session-dir") ?? path.join(RUN_DIR, "supervised_runs", runId));

const supervisorStatePath = path.join(runSessionDir, "supervisor_state.json");
const supervisorLedgerPath = path.join(runSessionDir, "supervisor_ledger.jsonl");
const rollbackQueuePath = path.join(runSessionDir, "rollback_queue.json");
const supervisorStopPath = path.join(runSessionDir, "supervisor_stop.json");
const reviewUnblockPath = path.join(runSessionDir, "review_unblock.json");
const lockFilePath = path.join(RUN_DIR, "p1_supervisor.lock");

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

const padBatch = (batchNumber: number) => `B${String(batchNumber).padStart(2, "0")}`;

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

const appendLedger = async (payload: Record<string, unknown>) => {
  await ensureDir(supervisorLedgerPath);
  const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...payload })}\n`;
  await writeFile(supervisorLedgerPath, line, { flag: "a" });
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
          `[supervisor] command failed: ${cmd} ${cmdArgs.join(" ")} (exit=${code ?? "null"} signal=${signal ?? "null"})`,
        ),
      );
    });
  });
};

const processExists = (pid: number): boolean => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const acquireLock = async () => {
  await ensureDir(lockFilePath);
  const now = new Date();
  const lock = await readJsonOrNull<{
    pid?: number;
    startedAt?: string;
    lastHeartbeat?: string;
    runSessionDir?: string;
  }>(lockFilePath);

  if (lock?.pid && processExists(lock.pid)) {
    const heartbeat = lock.lastHeartbeat ? new Date(lock.lastHeartbeat).getTime() : 0;
    const ageMs = heartbeat > 0 ? Date.now() - heartbeat : Number.POSITIVE_INFINITY;
    if (ageMs <= LOCK_TIMEOUT_MIN * 60 * 1000) {
      throw new Error(
        `[supervisor] lock is active (pid=${lock.pid}, runSessionDir=${lock.runSessionDir ?? "unknown"})`,
      );
    }
    await appendLedger({
      event: "lock_stale_recovered",
      lockPid: lock.pid,
      lockRunSessionDir: lock.runSessionDir ?? null,
    });
  }

  await writeJson(lockFilePath, {
    pid: process.pid,
    startedAt: now.toISOString(),
    lastHeartbeat: now.toISOString(),
    runSessionDir,
  });
};

const updateLockHeartbeat = async () => {
  await writeJson(lockFilePath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    runSessionDir,
  });
};

const releaseLock = async () => {
  const lock = await readJsonOrNull<{ pid?: number; runSessionDir?: string }>(lockFilePath);
  if (lock?.pid === process.pid && (lock.runSessionDir ?? "") === runSessionDir) {
    await rm(lockFilePath, { force: true });
  }
};

const initialLane = (
  name: LaneName,
  startBatchNumber: number,
  status: LaneStatus,
): LaneState => ({
  name,
  status,
  nextBatchNumber: startBatchNumber,
  currentBatchId: null,
  currentBatchDir: null,
  cooldownUntil: null,
  infraRetryCount: 0,
  consecutiveLogicFails: 0,
  blockedFingerprint: null,
  blockedBatchId: null,
  lastFailCode: null,
  lastReasonHash: null,
});

const createInitialState = (): SupervisorState => ({
  runId,
  runDir: RUN_DIR,
  runSessionDir,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lanes: {
    mismatch_lane: initialLane("mismatch_lane", START_MISMATCH_BATCH, "ready"),
    wave3_lane: initialLane("wave3_lane", START_WAVE3_BATCH, "ready"),
    unit_missing_lane: initialLane("unit_missing_lane", START_UNIT_MISSING_BATCH, "ready"),
    ingredient_id_missing_lane: initialLane(
      "ingredient_id_missing_lane",
      START_INGREDIENT_ID_MISSING_BATCH,
      "ready",
    ),
  },
  repeatTracker: {},
  stopReason: null,
});

const saveState = async (state: SupervisorState) => {
  state.updatedAt = new Date().toISOString();
  await writeJson(supervisorStatePath, state);
};

const loadState = async (): Promise<SupervisorState> => {
  const existing = await readJsonOrNull<SupervisorState>(supervisorStatePath);
  if (existing) {
    const seed = createInitialState();
    const merged: SupervisorState = {
      ...seed,
      ...existing,
      lanes: {
        mismatch_lane: {
          ...seed.lanes.mismatch_lane,
          ...(existing.lanes?.mismatch_lane ?? {}),
          name: "mismatch_lane",
        },
        wave3_lane: {
          ...seed.lanes.wave3_lane,
          ...(existing.lanes?.wave3_lane ?? {}),
          name: "wave3_lane",
        },
        unit_missing_lane: {
          ...seed.lanes.unit_missing_lane,
          ...(existing.lanes?.unit_missing_lane ?? {}),
          name: "unit_missing_lane",
        },
        ingredient_id_missing_lane: {
          ...seed.lanes.ingredient_id_missing_lane,
          ...(existing.lanes?.ingredient_id_missing_lane ?? {}),
          name: "ingredient_id_missing_lane",
        },
      },
    };
    return merged;
  }
  const initial = createInitialState();
  await saveState(initial);
  return initial;
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
  const ids = await loadSourceIds(filePath);
  const set = new Set<string>();
  ids.forEach((value) => {
    const key = intNorm(value);
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
  existing: toFiniteInt(summary?.existing, 0),
  scores: toFiniteInt(summary?.scores, 0),
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
  lane: LaneName;
  batchId: string;
  step: string;
  failCode: FailCode;
  fingerprint?: string | null;
  errorCode?: string | null;
  status?: number | null;
  beforeJson?: string | null;
  targetCount?: number | null;
}): string => {
  const payload = [
    params.lane,
    params.batchId,
    params.step,
    params.failCode,
    params.fingerprint ?? "",
    params.errorCode ?? "",
    params.status == null ? "" : String(params.status),
    params.beforeJson ?? "",
    params.targetCount == null ? "" : String(params.targetCount),
    gitCommit,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
};

const updateRepeatTracker = (state: SupervisorState, key: string): number => {
  const now = new Date();
  const thresholdStart = now.getTime() - 24 * 60 * 60 * 1000;
  const entry = state.repeatTracker[key] ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((value) => new Date(value).getTime() >= thresholdStart);
  entry.timestamps.push(now.toISOString());
  state.repeatTracker[key] = entry;
  return entry.timestamps.length;
};

const normalizeReasonHashKey = (params: {
  lane: LaneName;
  batchId: string;
  step: string;
  reasonHash: string;
}) => `${params.lane}|${params.batchId}|${params.step}|${params.reasonHash}`;

const resolveMismatchBeforeJson = async (batchNumber: number): Promise<string> => {
  if (batchNumber === 3) return MISMATCH_B03_BEFORE;
  const previous = path.join(runSessionDir, padBatch(batchNumber - 1), "after_fixedfetch.json");
  if (await fileExists(previous)) return previous;
  return MISMATCH_B03_BEFORE;
};

const resolveWave3BeforeJson = async (batchNumber: number): Promise<string> => {
  if (batchNumber === 3) return MISMATCH_B03_BEFORE;
  const previous = path.join(runSessionDir, "wave3", padBatch(batchNumber - 1), "after_fixedfetch.json");
  if (await fileExists(previous)) return previous;
  return MISMATCH_B03_BEFORE;
};

const resolveLaneBeforeJson = async (params: {
  batchNumber: number;
  subdir: string;
}): Promise<string> => {
  if (params.batchNumber === 3) return MISMATCH_B03_BEFORE;
  const previous = path.join(runSessionDir, params.subdir, padBatch(params.batchNumber - 1), "after_fixedfetch.json");
  if (await fileExists(previous)) return previous;
  return MISMATCH_B03_BEFORE;
};

const readRollbackQueue = async (): Promise<RollbackQueueItem[]> =>
  (await readJsonOrNull<RollbackQueueItem[]>(rollbackQueuePath)) ?? [];

const writeRollbackQueue = async (queue: RollbackQueueItem[]) => {
  await writeJson(rollbackQueuePath, queue);
};

const enqueueRollback = async (params: {
  lane: LaneName;
  batchId: string;
  rollbackSql: string;
  reasonHash: string | null;
}) => {
  const queue = await readRollbackQueue();
  queue.push({
    timestamp: new Date().toISOString(),
    lane: params.lane,
    batchId: params.batchId,
    rollbackSql: params.rollbackSql,
    reasonHash: params.reasonHash,
    status: "queued",
  });
  await writeRollbackQueue(queue);
  await appendLedger({
    event: "rollback_enqueued",
    lane: params.lane,
    batchId: params.batchId,
    rollbackSql: params.rollbackSql,
    reasonHash: params.reasonHash,
  });
};

const processRollbackQueue = async () => {
  if (!ENABLE_AUTO_ROLLBACK) return;
  const queue = await readRollbackQueue();
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    await appendLedger({
      event: "rollback_skipped_no_database_url",
      queued: queue.filter((item) => item.status === "queued").length,
    });
    return;
  }

  let changed = false;
  for (const item of queue) {
    if (item.status !== "queued") continue;
    try {
      await runCmd("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", item.rollbackSql]);
      item.status = "executed";
      item.executedAt = new Date().toISOString();
      changed = true;
      await appendLedger({
        event: "rollback_executed",
        lane: item.lane,
        batchId: item.batchId,
        rollbackSql: item.rollbackSql,
      });
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
      changed = true;
      await appendLedger({
        event: "rollback_failed",
        lane: item.lane,
        batchId: item.batchId,
        rollbackSql: item.rollbackSql,
        error: item.error,
      });
    }
  }

  if (changed) await writeRollbackQueue(queue);
};

const classifyMismatchResult = async (params: {
  batchId: string;
  batchDir: string;
  commandError: string | null;
}): Promise<{
  pass: boolean;
  decision: string;
  failCode: FailCode | null;
  reason: string | null;
  reasonHash: string | null;
  step: string;
  fingerprint: string | null;
  applyDone: boolean;
  rollbackSql: string | null;
}> => {
  const gatePath = path.join(params.batchDir, "batch_gate_report.json");
  const statePath = path.join(params.batchDir, "batch_state.json");
  const stopPath = path.join(params.batchDir, "stop_decision.json");

  const gate = await readJsonOrNull<GateReport>(gatePath);
  if (gate?.decision === "PASS" || gate?.pass === true) {
    return {
      pass: true,
      decision: "PASS",
      failCode: null,
      reason: null,
      reasonHash: null,
      step: "J",
      fingerprint: null,
      applyDone: true,
      rollbackSql: null,
    };
  }

  const batchState = await readJsonOrNull<BatchStateFile>(statePath);
  const stop = await readJsonOrNull<StopDecisionPayload>(stopPath);
  if (stop?.failCode) {
    const reasonHash =
      stop.reasonHash ??
      buildReasonHash({
        lane: "mismatch_lane",
        batchId: params.batchId,
        step: stop.step,
        failCode: stop.failCode,
        fingerprint: stop.fingerprint,
      });
    return {
      pass: false,
      decision: stop.decision,
      failCode: stop.failCode,
      reason: stop.reason ?? "runner stopped",
      reasonHash,
      step: stop.step,
      fingerprint: stop.fingerprint ?? null,
      applyDone: Boolean(batchState?.apply_done),
      rollbackSql: batchState?.dbWrites?.rollbackSql ?? null,
    };
  }

  const reason = params.commandError ?? "runner failed without stop_decision";
  const reasonHash = buildReasonHash({
    lane: "mismatch_lane",
    batchId: params.batchId,
    step: batchState?.currentStep ?? "UNKNOWN",
    failCode: "LOGIC_FAIL_STOP",
  });
  return {
    pass: false,
    decision: batchState?.decision ?? "FAIL_STOP",
    failCode: "LOGIC_FAIL_STOP",
    reason,
    reasonHash,
    step: batchState?.currentStep ?? "UNKNOWN",
    fingerprint: null,
    applyDone: Boolean(batchState?.apply_done),
    rollbackSql: batchState?.dbWrites?.rollbackSql ?? null,
  };
};

const runMismatchBatch = async (batchNumber: number): Promise<{
  batchId: string;
  batchDir: string;
  pass: boolean;
  decision: string;
  failCode: FailCode | null;
  reason: string | null;
  reasonHash: string | null;
  step: string;
  fingerprint: string | null;
  applyDone: boolean;
  rollbackSql: string | null;
}> => {
  const batchId = padBatch(batchNumber);
  const batchDir = path.join(runSessionDir, batchId);
  const beforeJson = await resolveMismatchBeforeJson(batchNumber);
  await mkdir(batchDir, { recursive: true });

  let commandError: string | null = null;
  try {
    await runCmd("npx", [
      "tsx",
      "scripts/run-b03-mismatch-gate-lnhpd.ts",
      "--run-dir",
      RUN_DIR,
      "--batch-id",
      batchId,
      "--batch-dir",
      batchDir,
      "--before-json",
      beforeJson,
      "--fixed-ids",
      FIXED_IDS,
      "--max-resume-retries",
      "5",
    ]);
  } catch (error) {
    commandError = error instanceof Error ? error.message : String(error);
  }

  const result = await classifyMismatchResult({
    batchId,
    batchDir,
    commandError,
  });
  return { ...result, batchId, batchDir };
};

const writeLaneState = async (params: {
  filePath: string;
  lane: LaneName;
  payload: Record<string, unknown>;
}) => {
  await writeJson(params.filePath, {
    lane: params.lane,
    ...params.payload,
    updatedAt: new Date().toISOString(),
  });
};

const writeWave3StopDecision = async (params: {
  filePath: string;
  lane: LaneName;
  batchId: string;
  step: string;
  decision: string;
  failCode: FailCode;
  reason: string;
  fingerprint?: string | null;
  artifacts: Record<string, string>;
  extra?: Record<string, unknown>;
  beforeJson?: string | null;
  targetCount?: number | null;
}): Promise<StopDecisionPayload> => {
  const reasonHash = buildReasonHash({
    lane: params.lane,
    batchId: params.batchId,
    step: params.step,
    failCode: params.failCode,
    fingerprint: params.fingerprint ?? null,
    beforeJson: params.beforeJson ?? null,
    targetCount: params.targetCount ?? null,
  });
  const payload: StopDecisionPayload = {
    timestamp: new Date().toISOString(),
    lane: params.lane,
    batchId: params.batchId,
    step: params.step,
    decision: params.decision,
    failCode: params.failCode,
    reason: params.reason,
    reasonHash,
    fingerprint: params.fingerprint ?? null,
    artifacts: params.artifacts,
    ...(params.extra ? { extra: params.extra } : {}),
  };
  await writeJson(params.filePath, payload);
  return payload;
};

const runWave3Batch = async (batchNumber: number): Promise<Wave3BatchResult> => {
  const batchId = padBatch(batchNumber);
  const batchDir = path.join(runSessionDir, "wave3", batchId);
  await mkdir(batchDir, { recursive: true });
  const beforeJson = await resolveWave3BeforeJson(batchNumber);

  const targetIds = path.join(batchDir, "target_ids.json");
  const targetSummary = path.join(batchDir, "target_summary.json");
  const impactTargetIds = path.join(batchDir, "target_ids_impact_key.json");
  const impactTargetSummary = path.join(batchDir, "target_summary_impact_key.json");

  const diagnoseOutput = path.join(batchDir, "missing_forms_diag.json");
  const planOutput = path.join(batchDir, "missing_forms_plan.json");

  const formsUniverse = path.join(batchDir, "forms_universe.json");
  const formsSelected = path.join(batchDir, "forms_selected.json");
  const evidenceUniverse = path.join(batchDir, "evidence_universe.json");
  const evidenceSelected = path.join(batchDir, "evidence_selected.json");
  const applyVerifiedSummary = path.join(batchDir, "apply_verified_summary.json");
  const derivedRebackfillOutput = path.join(batchDir, "derived_rebackfill.jsonl");

  const touchedIngredientIds = path.join(batchDir, "touched_ingredient_ids.json");
  const fanoutSourceIds = path.join(batchDir, "fanout_source_ids.json");
  const fanoutSummary = path.join(batchDir, "fanout_summary.json");

  const mainCheckpoint = path.join(batchDir, "force_rebackfill_checkpoint.json");
  const mainSummary = path.join(batchDir, "force_rebackfill_summary.json");
  const mainFailures = path.join(batchDir, "force_rebackfill_failures.jsonl");
  const replaySourceIds = path.join(batchDir, "replay_source_ids.json");
  const replayCheckpoint = path.join(batchDir, "replay_checkpoint.json");
  const replaySummary = path.join(batchDir, "replay_summary.json");
  const replayFailures = path.join(batchDir, "replay_failures.jsonl");

  const afterFixedfetch = path.join(batchDir, "after_fixedfetch.json");
  const gateReportPath = path.join(batchDir, "batch_gate_report.json");
  const batchStatePath = path.join(batchDir, "batch_state.json");
  const stopDecisionPath = path.join(batchDir, "stop_decision.json");

  const artifacts = {
    batchDir,
    beforeJson,
    fixedIds: FIXED_IDS,
    targetIds,
    targetSummary,
    impactTargetIds,
    impactTargetSummary,
    diagnoseOutput,
    planOutput,
    formsUniverse,
    formsSelected,
    evidenceUniverse,
    evidenceSelected,
    applyVerifiedSummary,
    touchedIngredientIds,
    fanoutSourceIds,
    fanoutSummary,
    mainSummary,
    mainFailures,
    replaySummary,
    replayFailures,
    afterFixedfetch,
    gateReportPath,
    stopDecisionPath,
  };

  const stopAndReturn = async (params: {
    step: string;
    decision: string;
    failCode: FailCode;
    reason: string;
    fingerprint?: string | null;
    targetCount?: number | null;
    extra?: Record<string, unknown>;
    applyDone?: boolean;
  }): Promise<Wave3BatchResult> => {
    const stop = await writeWave3StopDecision({
      filePath: stopDecisionPath,
      lane: "wave3_lane",
      batchId,
      step: params.step,
      decision: params.decision,
      failCode: params.failCode,
      reason: params.reason,
      fingerprint: params.fingerprint ?? null,
      artifacts,
      extra: params.extra,
      beforeJson,
      targetCount: params.targetCount ?? null,
    });
    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: params.decision === "FAIL_STOP" || params.decision === "APPLIED_BUT_FAILED" ? "failed" : "stopped",
      currentStep: params.step,
      apply_done: Boolean(params.applyDone),
      decision: params.decision,
      failCode: params.failCode,
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: applyVerifiedSummary,
      },
      resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: false,
      failCode: params.failCode,
      reason: params.reason,
      reasonHash: stop.reasonHash,
      fingerprint: stop.fingerprint ?? null,
      step: params.step,
      decision: params.decision,
      applyDone: Boolean(params.applyDone),
      rollbackSql: null,
    };
  };

  try {
    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: "running",
      currentStep: "A_TARGETS",
      apply_done: false,
      decision: null,
      failCode: null,
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: null,
      },
      resumeFromStep: null,
      },
    });

    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      beforeJson,
      "--reason",
      "missingVerified",
      "--id-mode",
      "source_id_raw",
      "--output",
      targetIds,
      "--summary",
      targetSummary,
    ]);
    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      beforeJson,
      "--reason",
      "missingVerified",
      "--id-mode",
      "impact_key",
      "--output",
      impactTargetIds,
      "--summary",
      impactTargetSummary,
    ]);

    const impactSummary = await readJson<{ targetCount?: number }>(impactTargetSummary);
    const targetCount = toFiniteInt(impactSummary.targetCount, 0);
    if (targetCount <= 0) {
      return stopAndReturn({
        step: "A",
        decision: "NO_WORK",
        failCode: "C_NO_ACTIONABLE",
        reason: "missingVerified targetCount == 0",
        targetCount,
      });
    }

    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: "running",
      currentStep: "B_DIAGNOSE",
      apply_done: false,
      decision: null,
      failCode: null,
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: null,
      },
      resumeFromStep: null,
      },
    });

    await runCmd("npx", [
      "tsx",
      "scripts/diagnose-missing-ingredient-forms.ts",
      "--source",
      "lnhpd",
      "--source-ids-file",
      targetIds,
      "--output",
      diagnoseOutput,
      "--plan-output",
      planOutput,
      "--top-n",
      "1000",
    ]);

    const plan = await readJson<MissingFormsPlan>(planOutput);
    const candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
    const selected = candidates
      .filter((item) => (item.ingredientId ?? "").trim() && (item.recommendedFormKey ?? "").trim())
      .map((item) => ({
        ingredient_id: String(item.ingredientId).trim(),
        form_key: String(item.recommendedFormKey).trim(),
      }));
    if (selected.length === 0) {
      return stopAndReturn({
        step: "D",
        decision: "NO_WORK",
        failCode: "D_NO_PLAN",
        reason: "wave3 no selected form candidates",
        targetCount,
      });
    }

    const formsPayload = { candidates: selected };
    await writeJson(formsUniverse, formsPayload);
    await writeJson(formsSelected, formsPayload);
    await writeJson(evidenceUniverse, { candidates: [] });
    await writeJson(evidenceSelected, { candidates: [] });

    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: "running",
      currentStep: "E_APPLY_DERIVED_THEN_VERIFIED",
      apply_done: false,
      decision: null,
      failCode: null,
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: applyVerifiedSummary,
      },
      resumeFromStep: "F",
      },
    });

    await runCmd("npx", [
      "tsx",
      "scripts/apply-derived-ingredient-forms.ts",
      "--plan",
      planOutput,
      "--apply",
      "--source",
      "lnhpd",
      "--top-n",
      "1000",
      "--rebackfill-output",
      derivedRebackfillOutput,
    ]);

    await runCmd("npx", [
      "tsx",
      "scripts/apply-verified-promotion-set.ts",
      "--forms-selected",
      formsSelected,
      "--evidence-selected",
      evidenceSelected,
      "--forms-universe",
      formsUniverse,
      "--evidence-universe",
      evidenceUniverse,
      "--summary-json",
      applyVerifiedSummary,
    ]);

    const touchedIds = Array.from(new Set(selected.map((item) => item.ingredient_id))).sort((a, b) =>
      a.localeCompare(b),
    );
    if (touchedIds.length === 0) {
      return stopAndReturn({
        step: "F",
        decision: "NO_WORK",
        failCode: "D_NO_PLAN",
        reason: "wave3 touched ingredient ids == 0",
        targetCount,
        applyDone: true,
      });
    }
    await writeJson(touchedIngredientIds, { ingredientIds: touchedIds });

    await runCmd("npx", [
      "tsx",
      "scripts/build-promotion-rebackfill-lnhpd.ts",
      "--ingredient-ids-file",
      touchedIngredientIds,
      "--output",
      fanoutSourceIds,
      "--summary",
      fanoutSummary,
      "--page-size",
      "1000",
    ]);
    const fanout = await readJson<{ sourceIdCount?: number }>(fanoutSummary);
    const sourceIdCount = toFiniteInt(fanout.sourceIdCount, 0);
    if (sourceIdCount <= 0) {
      return stopAndReturn({
        step: "F",
        decision: "NO_WORK",
        failCode: "D_NO_PLAN",
        reason: "wave3 fanout sourceIdCount == 0",
        targetCount,
        applyDone: true,
      });
    }

    const mainBackfill = await runBackfillUntilProcessed({
      sourceIdsFile: fanoutSourceIds,
      checkpointFile: mainCheckpoint,
      summaryJson: mainSummary,
      failuresFile: mainFailures,
      expectedSourceIdCount: sourceIdCount,
      maxResumeRetries: 5,
    });
    const main = mainBackfill.summary;
    if (main.processed !== sourceIdCount) {
      const failCode = await classifyFailureCode({
        mainFailures,
        replayFailures: null,
        fallbackMessage: "wave3 main backfill processed mismatch",
      });
      return stopAndReturn({
        step: "H",
        decision: "APPLIED_BUT_FAILED",
        failCode,
        reason: `wave3 main backfill incomplete (${main.processed}/${sourceIdCount})`,
        targetCount,
        applyDone: true,
      });
    }

    let replaySourceIdCount = 0;
    let replay: BackfillSummary | null = null;
    if (toFiniteInt(main.failed, 0) > 0) {
      const replayIds = await loadFailuresReplayIds(mainFailures);
      replaySourceIdCount = replayIds.length;
      if (replaySourceIdCount === 0) {
        const failCode = await classifyFailureCode({
          mainFailures,
          replayFailures: null,
          fallbackMessage: "wave3 replay ids empty",
        });
        return stopAndReturn({
          step: "H",
          decision: "APPLIED_BUT_FAILED",
          failCode,
          reason: "wave3 failed > 0 but replay ids empty",
          targetCount,
          applyDone: true,
        });
      }
      await writeJson(replaySourceIds, { sourceIds: replayIds });
      const replayBackfill = await runBackfillUntilProcessed({
        sourceIdsFile: replaySourceIds,
        checkpointFile: replayCheckpoint,
        summaryJson: replaySummary,
        failuresFile: replayFailures,
        expectedSourceIdCount: replaySourceIdCount,
        maxResumeRetries: 5,
      });
      replay = replayBackfill.summary;
      if (replay.processed !== replaySourceIdCount || toFiniteInt(replay.failed, 0) > 0) {
        const failCode = await classifyFailureCode({
          mainFailures,
          replayFailures,
          fallbackMessage: "wave3 replay failed",
        });
        return stopAndReturn({
          step: "H",
          decision: "APPLIED_BUT_FAILED",
          failCode,
          reason: "wave3 replay integrity failed",
          targetCount,
          applyDone: true,
        });
      }
    }

    const finalFailed = replay ? toFiniteInt(replay.failed, 0) : toFiniteInt(main.failed, 0);
    const finalExisting = replay ? toFiniteInt(replay.existing, 0) : toFiniteInt(main.existing, 0);
    const rebackfillIntegrityOk =
      main.processed === sourceIdCount &&
      finalFailed === 0 &&
      finalExisting === 0 &&
      (!replay || replay.processed === replaySourceIdCount);
    if (!rebackfillIntegrityOk) {
      const failCode = await classifyFailureCode({
        mainFailures,
        replayFailures: replay ? replayFailures : null,
        fallbackMessage: "wave3 rebackfill integrity failed",
      });
      return stopAndReturn({
        step: "H",
        decision: "APPLIED_BUT_FAILED",
        failCode,
        reason: "wave3 rebackfill integrity failed",
        targetCount,
        applyDone: true,
      });
    }

    await runCmd("npx", [
      "tsx",
      "scripts/diagnose-zero-coverage-root-causes.ts",
      "--source",
      "lnhpd",
      "--source-ids-file",
      FIXED_IDS,
      "--output",
      afterFixedfetch,
    ]);

    const beforePayload = await readJson<RootCausePayload>(beforeJson);
    const afterPayload = await readJson<RootCausePayload>(afterFixedfetch);
    const impactIds = await loadIdsSet(impactTargetIds);
    const beforeZeroSet = buildZeroSet(beforePayload);
    const afterZeroSet = buildZeroSet(afterPayload);
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
    await writeJson(gateReportPath, {
      batch: batchId,
      lane: "wave3_lane",
      generatedAt: new Date().toISOString(),
      inputs: {
        beforeJson,
        afterJson: afterFixedfetch,
        fixedIds: FIXED_IDS,
        targetIds,
        impactTargetIds,
        fanoutSourceIds,
        mainSummary,
        replaySummary: replay ? replaySummary : null,
      },
      impactKeyMode: "canonical_or_source_int_normalized",
      impactSubset: {
        impactSize: impactIds.size,
        zeroCoverage: { before: impactZeroBefore, after: impactZeroAfter },
      },
      globalGuardrail: {
        zeroCoverageCount: { before: globalZeroBefore, after: globalZeroAfter },
        unknown: { before: globalUnknownBefore, after: globalUnknownAfter },
      },
      rebackfill: {
        sourceIdCount,
        main,
        replay,
        replaySourceIdCount,
        finalFailed,
        finalExisting,
      },
      rules,
      pass,
      decision: pass ? "PASS" : "FAIL_STOP",
      ...(pass ? {} : { reason: "one_or_more_gate_rules_failed" }),
    });

    if (!pass) {
      return stopAndReturn({
        step: "J",
        decision: "APPLIED_BUT_FAILED",
        failCode: "LOGIC_FAIL_STOP",
        reason: "wave3 gate failed",
        targetCount,
        applyDone: true,
      });
    }

    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: "passed",
      currentStep: "DONE",
      apply_done: true,
      decision: "PASS",
      failCode: null,
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: applyVerifiedSummary,
      },
      resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: true,
      failCode: null,
      reason: null,
      reasonHash: null,
      fingerprint: null,
      step: "J",
      decision: "PASS",
      applyDone: true,
      rollbackSql: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stop = await writeWave3StopDecision({
      filePath: stopDecisionPath,
      lane: "wave3_lane",
      batchId,
      step: "UNHANDLED",
      decision: "FAIL_STOP",
      failCode: "LOGIC_FAIL_STOP",
      reason: message,
      fingerprint: null,
      artifacts,
      beforeJson,
    });
    await writeLaneState({
      filePath: batchStatePath,
      lane: "wave3_lane",
      payload: {
      batchId,
      status: "failed",
      currentStep: "UNHANDLED",
      apply_done: true,
      decision: "FAIL_STOP",
      failCode: "LOGIC_FAIL_STOP",
      artifacts,
      dbWrites: {
        rollbackSql: null,
        applySummary: null,
      },
      resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: false,
      failCode: "LOGIC_FAIL_STOP",
      reason: message,
      reasonHash: stop.reasonHash,
      fingerprint: null,
      step: "UNHANDLED",
      decision: "FAIL_STOP",
      applyDone: true,
      rollbackSql: null,
    };
  }
};

const SIMPLE_LANE_SUBDIR: Record<SimpleRootCauseLane, string> = {
  unit_missing_lane: "unit_missing",
  ingredient_id_missing_lane: "ingredient_id_missing",
};

const runSimpleRootCauseBatch = async (params: {
  lane: SimpleRootCauseLane;
  reason: Extract<RootCauseReason, "unit_missing" | "ingredient_id_missing">;
  batchNumber: number;
}): Promise<Wave3BatchResult> => {
  const batchId = padBatch(params.batchNumber);
  const laneSubdir = SIMPLE_LANE_SUBDIR[params.lane];
  const batchDir = path.join(runSessionDir, laneSubdir, batchId);
  await mkdir(batchDir, { recursive: true });
  const beforeJson = await resolveLaneBeforeJson({ batchNumber: params.batchNumber, subdir: laneSubdir });

  const targetIds = path.join(batchDir, "target_ids.json");
  const targetSummary = path.join(batchDir, "target_summary.json");
  const impactTargetIds = path.join(batchDir, "target_ids_impact_key.json");
  const impactTargetSummary = path.join(batchDir, "target_summary_impact_key.json");

  const unitNormalizeOutDir = path.join(batchDir, "unit_normalize");
  const unitNormalizeSummary = path.join(unitNormalizeOutDir, "summary.json");
  const ingredientRefreshSummary = path.join(batchDir, "ingredient_refresh_summary.json");

  const mainCheckpoint = path.join(batchDir, "force_rebackfill_checkpoint.json");
  const mainSummary = path.join(batchDir, "force_rebackfill_summary.json");
  const mainFailures = path.join(batchDir, "force_rebackfill_failures.jsonl");
  const replaySourceIds = path.join(batchDir, "replay_source_ids.json");
  const replayCheckpoint = path.join(batchDir, "replay_checkpoint.json");
  const replaySummary = path.join(batchDir, "replay_summary.json");
  const replayFailures = path.join(batchDir, "replay_failures.jsonl");

  const afterFixedfetch = path.join(batchDir, "after_fixedfetch.json");
  const gateReportPath = path.join(batchDir, "batch_gate_report.json");
  const batchStatePath = path.join(batchDir, "batch_state.json");
  const stopDecisionPath = path.join(batchDir, "stop_decision.json");

  const artifacts = {
    batchDir,
    beforeJson,
    reason: params.reason,
    fixedIds: FIXED_IDS,
    targetIds,
    targetSummary,
    impactTargetIds,
    impactTargetSummary,
    unitNormalizeSummary,
    ingredientRefreshSummary,
    mainSummary,
    mainFailures,
    replaySummary,
    replayFailures,
    afterFixedfetch,
    gateReportPath,
    stopDecisionPath,
  };

  const stopAndReturn = async (stopParams: {
    step: string;
    decision: string;
    failCode: FailCode;
    reason: string;
    fingerprint?: string | null;
    targetCount?: number | null;
    extra?: Record<string, unknown>;
    applyDone?: boolean;
  }): Promise<Wave3BatchResult> => {
    const stop = await writeWave3StopDecision({
      filePath: stopDecisionPath,
      lane: params.lane,
      batchId,
      step: stopParams.step,
      decision: stopParams.decision,
      failCode: stopParams.failCode,
      reason: stopParams.reason,
      fingerprint: stopParams.fingerprint ?? null,
      artifacts,
      extra: stopParams.extra,
      beforeJson,
      targetCount: stopParams.targetCount ?? null,
    });
    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status:
          stopParams.decision === "FAIL_STOP" || stopParams.decision === "APPLIED_BUT_FAILED"
            ? "failed"
            : "stopped",
        currentStep: stopParams.step,
        apply_done: Boolean(stopParams.applyDone),
        decision: stopParams.decision,
        failCode: stopParams.failCode,
        artifacts,
        dbWrites: {
          rollbackSql: null,
          applySummary:
            params.lane === "unit_missing_lane"
              ? unitNormalizeSummary
              : ingredientRefreshSummary,
        },
        resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: false,
      failCode: stopParams.failCode,
      reason: stopParams.reason,
      reasonHash: stop.reasonHash,
      fingerprint: stop.fingerprint ?? null,
      step: stopParams.step,
      decision: stopParams.decision,
      applyDone: Boolean(stopParams.applyDone),
      rollbackSql: null,
    };
  };

  try {
    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status: "running",
        currentStep: "A_TARGETS",
        apply_done: false,
        decision: null,
        failCode: null,
        artifacts,
        dbWrites: { rollbackSql: null, applySummary: null },
        resumeFromStep: null,
      },
    });

    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      beforeJson,
      "--reason",
      params.reason,
      "--id-mode",
      "source_id_raw",
      "--output",
      targetIds,
      "--summary",
      targetSummary,
    ]);
    await runCmd("npx", [
      "tsx",
      "scripts/build-rootcause-target-ids.ts",
      "--before-json",
      beforeJson,
      "--reason",
      params.reason,
      "--id-mode",
      "impact_key",
      "--output",
      impactTargetIds,
      "--summary",
      impactTargetSummary,
    ]);

    const impactSummary = await readJson<{ targetCount?: number }>(impactTargetSummary);
    const targetCount = toFiniteInt(impactSummary.targetCount, 0);
    if (targetCount <= 0) {
      return stopAndReturn({
        step: "A",
        decision: "NO_WORK",
        failCode: "C_NO_ACTIONABLE",
        reason: `${params.reason} targetCount == 0`,
        targetCount,
      });
    }

    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status: "running",
        currentStep: "B_APPLY_FIX",
        apply_done: false,
        decision: null,
        failCode: null,
        artifacts,
        dbWrites: {
          rollbackSql: null,
          applySummary:
            params.lane === "unit_missing_lane"
              ? unitNormalizeSummary
              : ingredientRefreshSummary,
        },
        resumeFromStep: "H",
      },
    });

    let attemptedRows = 0;
    let updatedRows = 0;
    let updateErrors = 0;
    if (params.lane === "unit_missing_lane") {
      const previousAck = process.env.P1D_APPLY_ACK;
      process.env.P1D_APPLY_ACK = UNIT_NORMALIZE_APPLY_ACK;
      try {
        await runCmd("npx", [
          "tsx",
          "scripts/p1d-normalize-unit-missing.ts",
          "--source",
          "lnhpd",
          "--source-ids-file",
          targetIds,
          "--out-dir",
          unitNormalizeOutDir,
          "--apply",
          "--confirm-prod",
          UNIT_NORMALIZE_APPLY_ACK,
        ]);
      } finally {
        if (previousAck == null) {
          delete process.env.P1D_APPLY_ACK;
        } else {
          process.env.P1D_APPLY_ACK = previousAck;
        }
      }
      const unitSummary = await readJson<UnitNormalizeSummary>(unitNormalizeSummary);
      attemptedRows = toFiniteInt(unitSummary.candidateCount, 0);
      updatedRows = toFiniteInt(unitSummary.appliedCount, 0);
      updateErrors = toFiniteInt(unitSummary.failedCount, 0);
      if (attemptedRows <= 0) {
        return stopAndReturn({
          step: "D",
          decision: "NO_WORK",
          failCode: "D_NO_PLAN",
          reason: "unit_missing no normalization candidates",
          targetCount,
        });
      }
      if (updatedRows <= 0 && updateErrors <= 0) {
        return stopAndReturn({
          step: "D",
          decision: "NO_WORK",
          failCode: "D_NO_PLAN",
          reason: "unit_missing updatedRows == 0",
          targetCount,
        });
      }
      if (updatedRows <= 0 && updateErrors > 0) {
        return stopAndReturn({
          step: "D",
          decision: "APPLIED_BUT_FAILED",
          failCode: "LOGIC_FAIL_STOP",
          reason: `unit_missing apply failed (errors=${updateErrors})`,
          targetCount,
          applyDone: true,
        });
      }
    } else {
      await runCmd("npx", [
        "tsx",
        "scripts/refresh-missing-ingredient-ids.ts",
        "--source",
        "lnhpd",
        "--id-column",
        "source_id",
        "--source-ids-file",
        targetIds,
        "--trgm-min-confidence",
        "0.85",
        "--out",
        ingredientRefreshSummary,
      ]);
      const refreshSummary = await readJson<RefreshMissingIngredientSummary>(ingredientRefreshSummary);
      attemptedRows = toFiniteInt(refreshSummary.summary?.attemptedRows, 0);
      updatedRows = toFiniteInt(refreshSummary.summary?.updatedRows, 0);
      updateErrors = toFiniteInt(refreshSummary.summary?.updateErrors, 0);
      if (attemptedRows <= 0) {
        return stopAndReturn({
          step: "D",
          decision: "NO_WORK",
          failCode: "D_NO_PLAN",
          reason: "ingredient_id_missing attemptedRows == 0",
          targetCount,
        });
      }
      if (updatedRows <= 0 && updateErrors <= 0) {
        return stopAndReturn({
          step: "D",
          decision: "NO_WORK",
          failCode: "D_NO_PLAN",
          reason: "ingredient_id_missing updatedRows == 0",
          targetCount,
        });
      }
      if (updatedRows <= 0 && updateErrors > 0) {
        return stopAndReturn({
          step: "D",
          decision: "APPLIED_BUT_FAILED",
          failCode: "LOGIC_FAIL_STOP",
          reason: `ingredient_id_missing apply failed (errors=${updateErrors})`,
          targetCount,
          applyDone: true,
        });
      }
    }

    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status: "running",
        currentStep: "H_BACKFILL",
        apply_done: true,
        decision: null,
        failCode: null,
        artifacts,
        dbWrites: {
          rollbackSql: null,
          applySummary:
            params.lane === "unit_missing_lane"
              ? unitNormalizeSummary
              : ingredientRefreshSummary,
        },
        resumeFromStep: "I",
      },
    });

    const mainBackfill = await runBackfillUntilProcessed({
      sourceIdsFile: targetIds,
      checkpointFile: mainCheckpoint,
      summaryJson: mainSummary,
      failuresFile: mainFailures,
      expectedSourceIdCount: targetCount,
      maxResumeRetries: 5,
    });
    const main = mainBackfill.summary;
    if (main.processed !== targetCount) {
      const failCode = await classifyFailureCode({
        mainFailures,
        replayFailures: null,
        fallbackMessage: `${params.reason} main backfill processed mismatch`,
      });
      return stopAndReturn({
        step: "H",
        decision: "APPLIED_BUT_FAILED",
        failCode,
        reason: `${params.reason} main backfill incomplete (${main.processed}/${targetCount})`,
        targetCount,
        applyDone: true,
      });
    }

    let replaySourceIdCount = 0;
    let replay: BackfillSummary | null = null;
    if (toFiniteInt(main.failed, 0) > 0) {
      const replayIds = await loadFailuresReplayIds(mainFailures);
      replaySourceIdCount = replayIds.length;
      if (replaySourceIdCount === 0) {
        const failCode = await classifyFailureCode({
          mainFailures,
          replayFailures: null,
          fallbackMessage: `${params.reason} replay ids empty`,
        });
        return stopAndReturn({
          step: "H",
          decision: "APPLIED_BUT_FAILED",
          failCode,
          reason: `${params.reason} failed > 0 but replay ids empty`,
          targetCount,
          applyDone: true,
        });
      }
      await writeJson(replaySourceIds, { sourceIds: replayIds });
      const replayBackfill = await runBackfillUntilProcessed({
        sourceIdsFile: replaySourceIds,
        checkpointFile: replayCheckpoint,
        summaryJson: replaySummary,
        failuresFile: replayFailures,
        expectedSourceIdCount: replaySourceIdCount,
        maxResumeRetries: 5,
      });
      replay = replayBackfill.summary;
      if (replay.processed !== replaySourceIdCount || toFiniteInt(replay.failed, 0) > 0) {
        const failCode = await classifyFailureCode({
          mainFailures,
          replayFailures,
          fallbackMessage: `${params.reason} replay failed`,
        });
        return stopAndReturn({
          step: "H",
          decision: "APPLIED_BUT_FAILED",
          failCode,
          reason: `${params.reason} replay integrity failed`,
          targetCount,
          applyDone: true,
        });
      }
    }

    const finalFailed = replay ? toFiniteInt(replay.failed, 0) : toFiniteInt(main.failed, 0);
    const finalExisting = replay ? toFiniteInt(replay.existing, 0) : toFiniteInt(main.existing, 0);
    const rebackfillIntegrityOk =
      main.processed === targetCount &&
      finalFailed === 0 &&
      finalExisting === 0 &&
      (!replay || replay.processed === replaySourceIdCount);
    if (!rebackfillIntegrityOk) {
      const failCode = await classifyFailureCode({
        mainFailures,
        replayFailures: replay ? replayFailures : null,
        fallbackMessage: `${params.reason} rebackfill integrity failed`,
      });
      return stopAndReturn({
        step: "H",
        decision: "APPLIED_BUT_FAILED",
        failCode,
        reason: `${params.reason} rebackfill integrity failed`,
        targetCount,
        applyDone: true,
      });
    }

    await runCmd("npx", [
      "tsx",
      "scripts/diagnose-zero-coverage-root-causes.ts",
      "--source",
      "lnhpd",
      "--source-ids-file",
      FIXED_IDS,
      "--output",
      afterFixedfetch,
    ]);

    const beforePayload = await readJson<RootCausePayload>(beforeJson);
    const afterPayload = await readJson<RootCausePayload>(afterFixedfetch);
    const impactIds = await loadIdsSet(impactTargetIds);
    const beforeZeroSet = buildZeroSet(beforePayload);
    const afterZeroSet = buildZeroSet(afterPayload);
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
    const reasonBefore = toFiniteInt(beforePayload.summary?.counts?.[params.reason], 0);
    const reasonAfter = toFiniteInt(afterPayload.summary?.counts?.[params.reason], 0);

    const rules = {
      impact_zero_strict_drop: impactZeroAfter < impactZeroBefore,
      global_zero_non_increase: globalZeroAfter <= globalZeroBefore,
      global_unknown_non_increase: globalUnknownAfter <= globalUnknownBefore,
      reason_count_strict_drop: reasonAfter < reasonBefore,
      rebackfill_integrity_ok: rebackfillIntegrityOk,
    };
    const pass = Object.values(rules).every(Boolean);
    await writeJson(gateReportPath, {
      batch: batchId,
      lane: params.lane,
      reason: params.reason,
      generatedAt: new Date().toISOString(),
      inputs: {
        beforeJson,
        afterJson: afterFixedfetch,
        fixedIds: FIXED_IDS,
        targetIds,
        impactTargetIds,
        mainSummary,
        replaySummary: replay ? replaySummary : null,
      },
      impactKeyMode: "canonical_or_source_int_normalized",
      impactSubset: {
        impactSize: impactIds.size,
        zeroCoverage: { before: impactZeroBefore, after: impactZeroAfter },
      },
      globalGuardrail: {
        zeroCoverageCount: { before: globalZeroBefore, after: globalZeroAfter },
        unknown: { before: globalUnknownBefore, after: globalUnknownAfter },
        [params.reason]: { before: reasonBefore, after: reasonAfter },
      },
      rebackfill: {
        sourceIdCount: targetCount,
        main,
        replay,
        replaySourceIdCount,
        finalFailed,
        finalExisting,
      },
      apply: {
        attemptedRows,
        updatedRows,
        updateErrors,
      },
      rules,
      pass,
      decision: pass ? "PASS" : "FAIL_STOP",
      ...(pass ? {} : { reason: "one_or_more_gate_rules_failed" }),
    });

    if (!pass) {
      return stopAndReturn({
        step: "J",
        decision: "APPLIED_BUT_FAILED",
        failCode: "LOGIC_FAIL_STOP",
        reason: `${params.reason} gate failed`,
        targetCount,
        applyDone: true,
      });
    }

    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status: "passed",
        currentStep: "DONE",
        apply_done: true,
        decision: "PASS",
        failCode: null,
        artifacts,
        dbWrites: {
          rollbackSql: null,
          applySummary:
            params.lane === "unit_missing_lane"
              ? unitNormalizeSummary
              : ingredientRefreshSummary,
        },
        resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: true,
      failCode: null,
      reason: null,
      reasonHash: null,
      fingerprint: null,
      step: "J",
      decision: "PASS",
      applyDone: true,
      rollbackSql: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stop = await writeWave3StopDecision({
      filePath: stopDecisionPath,
      lane: params.lane,
      batchId,
      step: "UNHANDLED",
      decision: "FAIL_STOP",
      failCode: "LOGIC_FAIL_STOP",
      reason: message,
      fingerprint: null,
      artifacts,
      beforeJson,
    });
    await writeLaneState({
      filePath: batchStatePath,
      lane: params.lane,
      payload: {
        batchId,
        status: "failed",
        currentStep: "UNHANDLED",
        apply_done: true,
        decision: "FAIL_STOP",
        failCode: "LOGIC_FAIL_STOP",
        artifacts,
        dbWrites: { rollbackSql: null, applySummary: null },
        resumeFromStep: null,
      },
    });
    return {
      batchId,
      batchDir,
      pass: false,
      failCode: "LOGIC_FAIL_STOP",
      reason: message,
      reasonHash: stop.reasonHash,
      fingerprint: null,
      step: "UNHANDLED",
      decision: "FAIL_STOP",
      applyDone: true,
      rollbackSql: null,
    };
  }
};

const laneReadyForRun = (lane: LaneState): boolean => lane.status === "ready";

const applyCooldown = (lane: LaneState) => {
  if (lane.status !== "cooldown" || !lane.cooldownUntil) return;
  if (Date.now() >= new Date(lane.cooldownUntil).getTime()) {
    lane.status = "ready";
    lane.cooldownUntil = null;
    lane.infraRetryCount = 0;
  }
};

const setCooldown = (lane: LaneState, minutes: number) => {
  lane.status = "cooldown";
  lane.cooldownUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
};

const consumeReviewUnblock = async (state: SupervisorState): Promise<boolean> => {
  if (state.lanes.mismatch_lane.status !== "blocked_by_review") return false;
  if (!(await fileExists(reviewUnblockPath))) return false;
  const payload = await readJsonOrNull<{
    unblockMismatchLane?: boolean;
    ack?: string;
    fingerprint?: string;
    action?: string;
  }>(reviewUnblockPath);
  if (!payload?.unblockMismatchLane) return false;
  if (payload.ack !== "I_UNDERSTAND_ALIAS_RISK") return false;
  const blockedFingerprint = state.lanes.mismatch_lane.blockedFingerprint;
  if (!blockedFingerprint || payload.fingerprint !== blockedFingerprint) return false;

  const blockedBatchId = state.lanes.mismatch_lane.blockedBatchId;
  state.lanes.mismatch_lane.status = "ready";
  state.lanes.mismatch_lane.blockedFingerprint = null;
  state.lanes.mismatch_lane.lastFailCode = null;
  if (payload.action === "rerun_batch" && blockedBatchId) {
    state.lanes.mismatch_lane.nextBatchNumber = toFiniteInt(blockedBatchId.slice(1), state.lanes.mismatch_lane.nextBatchNumber);
  }
  await rm(reviewUnblockPath, { force: true });
  await appendLedger({
    event: "review_unblocked",
    lane: "mismatch_lane",
    blockedBatchId,
  });
  return true;
};

const allLanesNoExecutable = (state: SupervisorState): boolean => {
  const mismatchTerminal = ["done", "paused", "blocked_by_review"].includes(state.lanes.mismatch_lane.status);
  const wave3Terminal = ["done", "paused"].includes(state.lanes.wave3_lane.status);
  const unitMissingTerminal = ["done", "paused"].includes(state.lanes.unit_missing_lane.status);
  const ingredientIdMissingTerminal = ["done", "paused"].includes(
    state.lanes.ingredient_id_missing_lane.status,
  );
  return mismatchTerminal && wave3Terminal && unitMissingTerminal && ingredientIdMissingTerminal;
};

const chooseLaneToRun = (state: SupervisorState): LaneName | null => {
  if (laneReadyForRun(state.lanes.mismatch_lane)) return "mismatch_lane";
  if (laneReadyForRun(state.lanes.wave3_lane)) return "wave3_lane";
  if (laneReadyForRun(state.lanes.unit_missing_lane)) return "unit_missing_lane";
  if (laneReadyForRun(state.lanes.ingredient_id_missing_lane)) return "ingredient_id_missing_lane";
  return null;
};

const applyRepeatProtection = async (
  state: SupervisorState,
  lane: LaneState,
  result: {
    batchId: string;
    step: string;
    reasonHash: string | null;
    failCode: FailCode | null;
  },
) => {
  if (!result.reasonHash || !result.failCode) return;
  const key = normalizeReasonHashKey({
    lane: lane.name,
    batchId: result.batchId,
    step: result.step,
    reasonHash: result.reasonHash,
  });
  const count = updateRepeatTracker(state, key);
  if (count > MAX_REPEAT_24H) {
    lane.status = "paused";
    await appendLedger({
      event: "lane_paused_repeat_hash",
      lane: lane.name,
      batchId: result.batchId,
      step: result.step,
      reasonHash: result.reasonHash,
      repeatCount: count,
    });
  }
};

const handleMismatchResult = async (
  state: SupervisorState,
  result: Awaited<ReturnType<typeof runMismatchBatch>>,
) => {
  const lane = state.lanes.mismatch_lane;
  lane.currentBatchId = result.batchId;
  lane.currentBatchDir = result.batchDir;

  await appendLedger({
    event: "mismatch_batch_result",
    batchId: result.batchId,
    decision: result.decision,
    pass: result.pass,
    failCode: result.failCode,
    reasonHash: result.reasonHash,
  });

  if (result.pass) {
    lane.status = "ready";
    lane.nextBatchNumber += 1;
    lane.infraRetryCount = 0;
    lane.consecutiveLogicFails = 0;
    lane.lastFailCode = null;
    lane.lastReasonHash = null;
    return;
  }

  lane.lastFailCode = result.failCode;
  lane.lastReasonHash = result.reasonHash;
  await applyRepeatProtection(state, lane, {
    batchId: result.batchId,
    step: result.step,
    reasonHash: result.reasonHash,
    failCode: result.failCode,
  });

  if (result.rollbackSql && result.decision === "APPLIED_BUT_FAILED") {
    await enqueueRollback({
      lane: "mismatch_lane",
      batchId: result.batchId,
      rollbackSql: result.rollbackSql,
      reasonHash: result.reasonHash,
    });
  }

  if (result.failCode === "D2_NEEDS_REVIEW") {
    lane.status = "blocked_by_review";
    lane.blockedFingerprint = result.fingerprint ?? null;
    lane.blockedBatchId = result.batchId;
    state.lanes.wave3_lane.status = state.lanes.wave3_lane.status === "done" ? "done" : "ready";
    return;
  }

  if (result.failCode === "C_NO_ACTIONABLE" || result.failCode === "D_NO_PLAN") {
    lane.status = "paused";
    state.lanes.wave3_lane.status = state.lanes.wave3_lane.status === "done" ? "done" : "ready";
    return;
  }

  if (result.failCode === "INFRA_RETRYABLE") {
    if (lane.infraRetryCount < 2) {
      const backoffMs = lane.infraRetryCount === 0 ? 2 * 60 * 1000 : 5 * 60 * 1000;
      lane.infraRetryCount += 1;
      lane.status = "running";
      await appendLedger({
        event: "infra_retry_scheduled",
        lane: lane.name,
        batchId: result.batchId,
        retryCount: lane.infraRetryCount,
        backoffMs,
      });
      await saveState(state);
      await sleep(backoffMs);
      lane.status = "ready";
      return;
    }
    lane.infraRetryCount = 0;
    setCooldown(lane, 30);
    return;
  }

  if (result.failCode === "LOGIC_FAIL_STOP") {
    lane.consecutiveLogicFails += 1;
    if (lane.consecutiveLogicFails >= 3) {
      lane.status = "paused";
      return;
    }
    lane.status = "ready";
    return;
  }
};

const handleWave3Result = async (state: SupervisorState, result: Wave3BatchResult) => {
  const lane = state.lanes.wave3_lane;
  lane.currentBatchId = result.batchId;
  lane.currentBatchDir = result.batchDir;

  await appendLedger({
    event: "wave3_batch_result",
    batchId: result.batchId,
    decision: result.decision,
    pass: result.pass,
    failCode: result.failCode,
    reasonHash: result.reasonHash,
  });

  if (result.pass) {
    lane.status = "ready";
    lane.nextBatchNumber += 1;
    lane.infraRetryCount = 0;
    lane.consecutiveLogicFails = 0;
    lane.lastFailCode = null;
    lane.lastReasonHash = null;
    return;
  }

  lane.lastFailCode = result.failCode;
  lane.lastReasonHash = result.reasonHash;
  await applyRepeatProtection(state, lane, {
    batchId: result.batchId,
    step: result.step,
    reasonHash: result.reasonHash,
    failCode: result.failCode,
  });

  if (result.failCode === "C_NO_ACTIONABLE" || result.failCode === "D_NO_PLAN") {
    lane.status = "done";
    return;
  }

  if (result.failCode === "INFRA_RETRYABLE") {
    if (lane.infraRetryCount < 2) {
      const backoffMs = lane.infraRetryCount === 0 ? 2 * 60 * 1000 : 5 * 60 * 1000;
      lane.infraRetryCount += 1;
      lane.status = "running";
      await saveState(state);
      await sleep(backoffMs);
      lane.status = "ready";
      return;
    }
    lane.infraRetryCount = 0;
    setCooldown(lane, 30);
    return;
  }

  if (result.failCode === "LOGIC_FAIL_STOP") {
    lane.consecutiveLogicFails += 1;
    if (lane.consecutiveLogicFails >= 3) {
      lane.status = "paused";
      return;
    }
    lane.status = "ready";
    return;
  }
};

const handleSimpleRootCauseResult = async (
  state: SupervisorState,
  laneName: SimpleRootCauseLane,
  result: Wave3BatchResult,
) => {
  const lane = state.lanes[laneName];
  lane.currentBatchId = result.batchId;
  lane.currentBatchDir = result.batchDir;

  await appendLedger({
    event: `${laneName}_batch_result`,
    batchId: result.batchId,
    decision: result.decision,
    pass: result.pass,
    failCode: result.failCode,
    reasonHash: result.reasonHash,
  });

  if (result.pass) {
    lane.status = "ready";
    lane.nextBatchNumber += 1;
    lane.infraRetryCount = 0;
    lane.consecutiveLogicFails = 0;
    lane.lastFailCode = null;
    lane.lastReasonHash = null;
    return;
  }

  lane.lastFailCode = result.failCode;
  lane.lastReasonHash = result.reasonHash;
  await applyRepeatProtection(state, lane, {
    batchId: result.batchId,
    step: result.step,
    reasonHash: result.reasonHash,
    failCode: result.failCode,
  });

  if (result.failCode === "C_NO_ACTIONABLE" || result.failCode === "D_NO_PLAN") {
    lane.status = "done";
    return;
  }

  if (result.failCode === "INFRA_RETRYABLE") {
    if (lane.infraRetryCount < 2) {
      const backoffMs = lane.infraRetryCount === 0 ? 2 * 60 * 1000 : 5 * 60 * 1000;
      lane.infraRetryCount += 1;
      lane.status = "running";
      await saveState(state);
      await sleep(backoffMs);
      lane.status = "ready";
      return;
    }
    lane.infraRetryCount = 0;
    setCooldown(lane, 30);
    return;
  }

  if (result.failCode === "LOGIC_FAIL_STOP") {
    lane.consecutiveLogicFails += 1;
    if (lane.consecutiveLogicFails >= 3) {
      lane.status = "paused";
      return;
    }
    lane.status = "ready";
    return;
  }
};

const supervisorRun = async () => {
  await mkdir(runSessionDir, { recursive: true });
  await acquireLock();
  let state = await loadState();
  await appendLedger({
    event: "supervisor_started",
    runId: state.runId,
    runSessionDir: state.runSessionDir,
    enableAutoRollback: ENABLE_AUTO_ROLLBACK,
  });

  const startedAt = Date.now();
  const maxDurationMs = RUN_HOURS * 60 * 60 * 1000;

  try {
    while (Date.now() - startedAt < maxDurationMs) {
      await updateLockHeartbeat();
      if (await fileExists(supervisorStopPath)) {
        state.stopReason = "supervisor_stop_file";
        await appendLedger({ event: "supervisor_stop_file_detected", path: supervisorStopPath });
        break;
      }

      const reviewUnblocked = await consumeReviewUnblock(state);
      if (reviewUnblocked) await saveState(state);

      applyCooldown(state.lanes.mismatch_lane);
      applyCooldown(state.lanes.wave3_lane);
      applyCooldown(state.lanes.unit_missing_lane);
      applyCooldown(state.lanes.ingredient_id_missing_lane);

      if (allLanesNoExecutable(state)) {
        state.stopReason = "all_lanes_no_executable_work";
        await appendLedger({
          event: "supervisor_stopped_no_executable_lanes",
          mismatchStatus: state.lanes.mismatch_lane.status,
          wave3Status: state.lanes.wave3_lane.status,
          unitMissingStatus: state.lanes.unit_missing_lane.status,
          ingredientIdMissingStatus: state.lanes.ingredient_id_missing_lane.status,
        });
        break;
      }

      const laneToRun = chooseLaneToRun(state);
      if (!laneToRun) {
        await saveState(state);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (laneToRun === "mismatch_lane") {
        const lane = state.lanes.mismatch_lane;
        lane.status = "running";
        lane.currentBatchId = padBatch(lane.nextBatchNumber);
        lane.currentBatchDir = path.join(runSessionDir, lane.currentBatchId);
        await saveState(state);
        const result = await runMismatchBatch(lane.nextBatchNumber);
        await handleMismatchResult(state, result);
      } else if (laneToRun === "wave3_lane") {
        const lane = state.lanes.wave3_lane;
        lane.status = "running";
        lane.currentBatchId = padBatch(lane.nextBatchNumber);
        lane.currentBatchDir = path.join(runSessionDir, "wave3", lane.currentBatchId);
        await saveState(state);
        const result = await runWave3Batch(lane.nextBatchNumber);
        await handleWave3Result(state, result);
      } else if (laneToRun === "unit_missing_lane") {
        const lane = state.lanes.unit_missing_lane;
        lane.status = "running";
        lane.currentBatchId = padBatch(lane.nextBatchNumber);
        lane.currentBatchDir = path.join(runSessionDir, "unit_missing", lane.currentBatchId);
        await saveState(state);
        const result = await runSimpleRootCauseBatch({
          lane: "unit_missing_lane",
          reason: "unit_missing",
          batchNumber: lane.nextBatchNumber,
        });
        await handleSimpleRootCauseResult(state, "unit_missing_lane", result);
      } else {
        const lane = state.lanes.ingredient_id_missing_lane;
        lane.status = "running";
        lane.currentBatchId = padBatch(lane.nextBatchNumber);
        lane.currentBatchDir = path.join(runSessionDir, "ingredient_id_missing", lane.currentBatchId);
        await saveState(state);
        const result = await runSimpleRootCauseBatch({
          lane: "ingredient_id_missing_lane",
          reason: "ingredient_id_missing",
          batchNumber: lane.nextBatchNumber,
        });
        await handleSimpleRootCauseResult(state, "ingredient_id_missing_lane", result);
      }

      await processRollbackQueue();
      await saveState(state);
    }

    if (!state.stopReason) {
      state.stopReason = "time_budget_exhausted";
      await appendLedger({ event: "supervisor_time_budget_exhausted", runHours: RUN_HOURS });
    }
    await saveState(state);
  } finally {
    await appendLedger({
      event: "supervisor_finished",
      stopReason: state.stopReason,
      mismatchStatus: state.lanes.mismatch_lane.status,
      wave3Status: state.lanes.wave3_lane.status,
      unitMissingStatus: state.lanes.unit_missing_lane.status,
      ingredientIdMissingStatus: state.lanes.ingredient_id_missing_lane.status,
    });
    await releaseLock();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  supervisorRun().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await appendLedger({ event: "supervisor_crashed", error: message }).catch(() => undefined);
    await releaseLock().catch(() => undefined);
    console.error("[supervisor] failed:", message);
    process.exit(1);
  });
}
