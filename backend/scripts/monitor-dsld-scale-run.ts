import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

type PartStatus = "DONE" | "RUNNING" | "INCOMPLETE" | "NOT_STARTED";

type CheckpointPayload = {
  dsld?: {
    processedIndex?: number;
    total?: number;
    updatedAt?: string;
    stats?: {
      processed?: number;
      scores?: number;
      existing?: number;
      skipped?: number;
      failed?: number;
    };
  };
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const RUN_DIR = getArg("run-dir");
const STALE_MINUTES = Math.max(1, Number(getArg("stale-minutes") ?? "90"));
const PRINT_JSON = hasFlag("json");

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
};

const extractPartId = (fileName: string): string | null => {
  const match = fileName.match(/^ids_part_(\d+)\.json$/);
  return match?.[1] ?? null;
};

const minutesAgo = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 1000 / 60;
};

const run = async () => {
  if (!RUN_DIR) {
    console.error("Usage: tsx backend/scripts/monitor-dsld-scale-run.ts --run-dir <path> [--stale-minutes 90] [--json]");
    process.exit(1);
  }

  const runDirAbs = path.resolve(RUN_DIR);
  const partsDir = path.join(runDirAbs, "parts");
  const logsDir = path.join(runDirAbs, "logs");

  const entries = await readdir(partsDir);
  const idsFiles = entries
    .filter((name) => name.startsWith("ids_part_") && name.endsWith(".json"))
    .sort();

  // Try to surface the latest log tail if present (helps explain why some parts
  // have no checkpoint yet in sequential runners).
  const logPath = path.join(logsDir, "run_scale_100k.nohup.out");
  const logTail = (await fileExists(logPath))
    ? (await readFile(logPath, "utf8")).split("\n").slice(-25).join("\n")
    : null;
  let currentPartFromLog: string | null = null;
  if (logTail) {
    const lines = logTail.split("\n").reverse();
    for (const line of lines) {
      const match = line.match(/\bpart=(\d{3})\b/);
      if (match?.[1]) {
        currentPartFromLog = match[1];
        break;
      }
    }
  }

  const parts: Array<{
    partId: string;
    status: PartStatus;
    processed?: number | null;
    total?: number | null;
    pct?: number | null;
    updatedAt?: string | null;
    staleMinutes?: number | null;
    missingFiles?: string[];
  }> = [];

  for (const idsFileName of idsFiles) {
    const partId = extractPartId(idsFileName);
    if (!partId) continue;

    const partDir = path.join(partsDir, `part_${partId}`);
    const checkpointPath = path.join(partDir, "backfill_checkpoint.json");
    const backfillSummaryPath = path.join(partDir, "backfill_summary.json");
    const validIdsPath = path.join(partDir, "valid_ids.json");
    const missingPath = path.join(partDir, "ingredient_id_missing.json");
    const mismatchPath = path.join(partDir, "taxonomy", "mismatch_summary_dsld.json");
    const nonemptyDiffPath = path.join(partDir, "nonempty_diff.json");

    const required = [
      backfillSummaryPath,
      validIdsPath,
      missingPath,
      mismatchPath,
      nonemptyDiffPath,
    ];

    const missingFiles: string[] = [];
    for (const p of required) {
      if (!(await fileExists(p))) missingFiles.push(p);
    }

    if (missingFiles.length === 0) {
      parts.push({ partId, status: "DONE" });
      continue;
    }

    const checkpoint = await readJson<CheckpointPayload>(checkpointPath);
    const state = checkpoint?.dsld ?? null;
    if (state) {
      const processed = state.processedIndex ?? state.stats?.processed ?? null;
      const total = state.total ?? null;
      const pct = processed != null && total ? processed / total : null;
      const updatedAt = state.updatedAt ?? null;
      const stale = minutesAgo(updatedAt);
      parts.push({
        partId,
        status: "RUNNING",
        processed,
        total,
        pct,
        updatedAt,
        staleMinutes: stale,
        missingFiles,
      });
    } else {
      parts.push({ partId, status: "NOT_STARTED", missingFiles });
    }
  }

  // If the runner is sequential, only one part will have a checkpoint at a time.
  // Use the log to mark the currently running part as RUNNING even if its
  // checkpoint hasn't been created yet (e.g. still snapshotting).
  if (currentPartFromLog) {
    const entry = parts.find((p) => p.partId === currentPartFromLog);
    if (entry && entry.status === "NOT_STARTED") {
      entry.status = "RUNNING";
      entry.updatedAt = entry.updatedAt ?? null;
    }
  }

  const done = parts.filter((p) => p.status === "DONE").length;
  const running = parts.filter((p) => p.status === "RUNNING").length;
  const notStarted = parts.filter((p) => p.status === "NOT_STARTED").length;

  const staleRunning = parts
    .filter((p) => p.status === "RUNNING")
    .filter((p) => (p.staleMinutes ?? 0) >= STALE_MINUTES)
    .map((p) => p.partId);

  const summary = {
    runDir: runDirAbs,
    counts: { totalParts: parts.length, done, running, notStarted },
    staleMinutesThreshold: STALE_MINUTES,
    staleRunningParts: staleRunning,
    parts,
    log: {
      path: (await fileExists(logPath)) ? logPath : null,
      tail: logTail,
      currentPart: currentPartFromLog,
    },
    generatedAt: new Date().toISOString(),
  };

  if (PRINT_JSON) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`[monitor-scale] runDir=${runDirAbs}`);
  console.log(`[monitor-scale] parts total=${parts.length} done=${done} running=${running} notStarted=${notStarted}`);
  if (staleRunning.length) {
    console.log(`[monitor-scale] stale running parts (>=${STALE_MINUTES}m): ${staleRunning.join(", ")}`);
  }
  const runningParts = parts.filter((p) => p.status === "RUNNING");
  runningParts
    .sort((a, b) => (a.partId < b.partId ? -1 : 1))
    .forEach((p) => {
      const pct = p.pct == null ? "?" : `${Math.round(p.pct * 100)}%`;
      const stale = p.staleMinutes == null ? "?" : `${Math.round(p.staleMinutes)}m`;
      console.log(
        `[monitor-scale] part_${p.partId} RUNNING processed=${p.processed ?? "?"}/${p.total ?? "?"} (${pct}) updatedAt=${p.updatedAt ?? "?"} stale=${stale}`,
      );
    });
  if (logTail) {
    console.log("");
    console.log("[monitor-scale] log tail:");
    console.log(logTail);
  }
};

run().catch((err) => {
  console.error("[monitor-scale] failed:", err);
  process.exit(1);
});
