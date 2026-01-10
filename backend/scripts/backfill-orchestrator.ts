import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type Source = "dsld" | "lnhpd";
type Mode = "alternate" | "dsld-only" | "lnhpd-only";

type Summary = {
  source: Source;
  scoreVersion: string;
  startId: number | null;
  endId?: number | null;
  limit: number | null;
  processed: number;
  scores: number;
  existing: number;
  skipped: number;
  failed: number;
  ingredientUpsertFailed: number;
  scoreUpsertFailed: number;
  computeScoreFailed: number;
  failuresFile: string | null;
  failuresLines: number;
  lastId: number | null;
  nextStart: number | null;
  elapsedMs: number;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const parseIntSafe = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJson = async (file: string, data: unknown) => {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
};

const statBytes = async (file: string): Promise<number> => {
  try {
    const stat = await fs.stat(file);
    return stat.size;
  } catch {
    return 0;
  }
};

const runBackfillOnce = async (params: {
  source: Source;
  startId: number;
  endId?: number | null;
  limit: number;
  batch?: number;
  concurrency?: number;
  timeBudgetSeconds: number;
  failuresFile: string;
  failuresForce: boolean;
  checkpointFile: string;
  summaryJson: string;
  force?: boolean;
}) => {
  const scriptArgs: string[] = [
    "tsx",
    "scripts/backfill-v4-scores.ts",
    "--source",
    params.source,
  ];

  if (params.source === "dsld") {
    scriptArgs.push("--start-dsld-id", String(params.startId));
    if (params.endId != null) scriptArgs.push("--end-dsld-id", String(params.endId));
  } else {
    scriptArgs.push("--start-lnhpd-id", String(params.startId));
    if (params.endId != null) scriptArgs.push("--end-lnhpd-id", String(params.endId));
  }

  scriptArgs.push("--limit", String(params.limit));
  scriptArgs.push("--time-budget-seconds", String(params.timeBudgetSeconds));
  scriptArgs.push("--checkpoint-file", params.checkpointFile);
  scriptArgs.push("--summary-json", params.summaryJson);
  scriptArgs.push("--failures-file", params.failuresFile);

  if (params.batch != null) scriptArgs.push("--batch", String(params.batch));
  if (params.concurrency != null) scriptArgs.push("--concurrency", String(params.concurrency));
  if (params.force) scriptArgs.push("--force");
  if (params.failuresForce) scriptArgs.push("--failures-force");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", scriptArgs, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`backfill exit code=${code}`));
    });
  });

  const summary = await readJson<Summary>(params.summaryJson);
  if (!summary) {
    throw new Error(
      `Missing summary JSON at ${params.summaryJson}. Ensure backfill-v4-scores.ts writes it.`,
    );
  }
  return summary;
};

const replayFailuresIfAny = async (file: string, failuresForce: boolean) => {
  const beforeBytes = await statBytes(file);
  if (beforeBytes === 0) return;

  const replayArgs = ["tsx", "scripts/backfill-v4-scores.ts", "--failures-input", file];
  if (failuresForce) replayArgs.push("--failures-force");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", replayArgs, { stdio: "inherit", env: process.env });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`replay exit code=${code}`)),
    );
  });
};

async function main() {
  const mode = (getArg("mode") as Mode | null) ?? "alternate";
  const dsldStart = parseIntSafe(getArg("dsld-start")) ?? 1;
  const lnhpdStart = parseIntSafe(getArg("lnhpd-start")) ?? 1;

  const dsldEnd = parseIntSafe(getArg("dsld-end"));
  const lnhpdEnd = parseIntSafe(getArg("lnhpd-end"));

  const dsldLimit = parseIntSafe(getArg("dsld-limit")) ?? 500;
  const lnhpdLimit = parseIntSafe(getArg("lnhpd-limit")) ?? 1000;

  const timeBudgetSeconds = parseIntSafe(getArg("time-budget-seconds")) ?? 720;
  const batch = parseIntSafe(getArg("batch")) ?? 100;
  const concurrency = parseIntSafe(getArg("concurrency")) ?? 2;
  const maxCycles = parseIntSafe(getArg("max-cycles"));
  const maxRuns = parseIntSafe(getArg("max-runs"));

  const outDir = getArg("out-dir") ?? "output/backfill-orchestrator";
  const checkpointFile = path.join(outDir, "checkpoints.json");
  const failuresFile = path.join(outDir, "failures.jsonl");
  const failuresForce = hasFlag("failures-force");
  const force = hasFlag("force");

  await ensureDir(outDir);

  const checkpoint = (await readJson<Record<string, { nextStart?: number }>>(checkpointFile)) ?? {};
  let nextDsld = checkpoint.dsld?.nextStart ?? dsldStart;
  let nextLnhpd = checkpoint.lnhpd?.nextStart ?? lnhpdStart;
  let cycles = 0;
  let runs = 0;

  const runOne = async (source: Source) => {
    const startId = source === "dsld" ? nextDsld : nextLnhpd;
    const endId = source === "dsld" ? dsldEnd : lnhpdEnd;
    const limit = source === "dsld" ? dsldLimit : lnhpdLimit;
    const summaryJson = path.join(outDir, `last-summary-${source}.json`);

    const failuresBeforeBytes = await statBytes(failuresFile);
    const summary = await runBackfillOnce({
      source,
      startId,
      endId: endId ?? undefined,
      limit,
      batch,
      concurrency,
      timeBudgetSeconds,
      failuresFile,
      failuresForce,
      checkpointFile,
      summaryJson,
      force,
    });

    const nextStart = summary.nextStart ?? startId;
    if (source === "dsld") nextDsld = Number(nextStart);
    else nextLnhpd = Number(nextStart);

    runs += 1;

    checkpoint[source] = { nextStart };
    await writeJson(checkpointFile, checkpoint);

    const failuresAfterBytes = await statBytes(failuresFile);
    if (failuresAfterBytes > failuresBeforeBytes) {
      await replayFailuresIfAny(failuresFile, failuresForce);
    }
  };

  while (true) {
    if (maxRuns != null && runs >= maxRuns) break;
    if (mode === "dsld-only") {
      if (dsldEnd != null && nextDsld > dsldEnd) break;
      await runOne("dsld");
      continue;
    }
    if (mode === "lnhpd-only") {
      if (lnhpdEnd != null && nextLnhpd > lnhpdEnd) break;
      await runOne("lnhpd");
      continue;
    }

    if (maxCycles != null && cycles >= maxCycles) break;
    if (dsldEnd != null && nextDsld > dsldEnd && lnhpdEnd != null && nextLnhpd > lnhpdEnd) {
      break;
    }
    let didRun = false;
    if (dsldEnd == null || nextDsld <= dsldEnd) {
      await runOne("dsld");
      didRun = true;
      if (maxRuns != null && runs >= maxRuns) break;
    }
    if (lnhpdEnd == null || nextLnhpd <= lnhpdEnd) {
      await runOne("lnhpd");
      didRun = true;
    }
    if (!didRun) break;
    cycles += 1;
  }

  console.log(`[orchestrator] done. checkpoints=${checkpointFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
