import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ScoreSource = "dsld" | "lnhpd";
type IdColumn = "source_id" | "canonical_source_id";

type MissingIngredientSnapshotRow = {
  id: string;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  match_method: string | null;
  match_confidence: number | null;
};

type RefreshSummary = {
  source: ScoreSource;
  idColumn: IdColumn;
  sourceIds: number;
  fetchedMissingRows: number;
  excludedRows: number;
  attemptedRows: number;
  resolvedRows: number;
  updatedRows: number;
  unresolvedRows: number;
  skippedLowConfidenceTrgm: number;
  updateErrors: number;
  byMatchMethod: Record<string, number>;
  generatedAt: string;
};

type BackfillSummary = {
  mode?: string;
  source?: string;
  processed?: number;
  scores?: number;
  existing?: number;
  skipped?: number;
  failed?: number;
  ingredientUpsertFailed?: number;
  scoreUpsertFailed?: number;
  computeScoreFailed?: number;
};

type SupabaseClient = Awaited<typeof import("../src/supabase.js")>["supabase"];

let supabaseClient: SupabaseClient | null = null;
const getSupabase = async (): Promise<SupabaseClient> => {
  if (!supabaseClient) {
    const mod = await import("../src/supabase.js");
    supabaseClient = mod.supabase;
  }
  return supabaseClient;
};

const APPLY_ACK = "I_UNDERSTAND_PROD_WRITE_2026_02_20";
const args = process.argv.slice(2);

const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((arg) => arg.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(backendDir, "..");

const refreshScriptPath = path.resolve(scriptDir, "refresh-missing-ingredient-ids.ts");
const backfillScriptPath = path.resolve(scriptDir, "backfill-v4-scores.ts");

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const source: ScoreSource = sourceArg === "dsld" ? "dsld" : "lnhpd";
const idColumnArg = (getArg("id-column") ?? "source_id").toLowerCase();
const idColumn: IdColumn =
  idColumnArg === "canonical_source_id" ? "canonical_source_id" : "source_id";
const sourceIdsFile = getArg("source-ids-file");
const sampleLimit = Math.max(1, Number(getArg("sample-limit") ?? "5000"));
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const refreshConcurrency = Math.max(1, Number(getArg("concurrency") ?? "6"));
const trgmMinConfidence = Math.min(
  1,
  Math.max(0, Number(getArg("trgm-min-confidence") ?? "0.85")),
);
const applyRequested = hasFlag("apply");
const confirmProd = getArg("confirm-prod") ?? "";
const envAck = process.env.P1D_APPLY_ACK ?? "";

const outDir = path.resolve(
  repoRoot,
  getArg("out-dir") ?? `output/p1d/ingredient-id-backfill-${Date.now()}`,
);

const summaryPath = path.join(outDir, "summary.json");
const sourceIdsPath = path.join(outDir, "source_ids.json");
const beforeAfterPath = path.join(outDir, "before_after.json");
const applySummaryPath = path.join(outDir, "apply_summary.json");
const refreshDryRunPath = path.join(outDir, "refresh_dry_run.json");
const refreshApplyPath = path.join(outDir, "refresh_apply.json");
const backfillSummaryPath = path.join(outDir, "backfill_summary.json");
const rollbackSqlPath = path.join(outDir, "rollback.sql");
const beforeSnapshotPath = path.join(outDir, "before_apply_snapshot.json");

const usage = () => {
  console.log(
    [
      "Usage: node --import tsx backend/scripts/p1d-force-ingredient-id-backfill.ts [options]",
      "",
      "Options:",
      "  --source <lnhpd|dsld>                 Data source (default: lnhpd)",
      "  --id-column <source_id|canonical_source_id>",
      "                                        Source ID column to target (default: source_id)",
      "  --source-ids-file <path>              Existing JSON list of source IDs",
      "  --sample-limit <n>                    Auto-sample size when source-ids-file omitted (default: 5000)",
      "  --page-size <n>                       Sampling page size (default: 1000)",
      "  --concurrency <n>                     refresh-missing-ingredient-ids worker count (default: 6)",
      "  --trgm-min-confidence <0-1>           Trigram minimum confidence (default: 0.85)",
      "  --out-dir <path>                      Output directory",
      "  --apply                               Execute DB writes",
      `  --confirm-prod ${APPLY_ACK}  Required with --apply`,
      "",
      "Required env when --apply:",
      `  P1D_APPLY_ACK=${APPLY_ACK}`,
    ].join("\n"),
  );
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const normalizeSourceIds = (payload: unknown): string[] => {
  const candidate =
    Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { sourceIds?: unknown } | null | undefined)?.sourceIds)
        ? (payload as { sourceIds: unknown[] }).sourceIds
        : Array.isArray((payload as { ids?: unknown } | null | undefined)?.ids)
          ? (payload as { ids: unknown[] }).ids
          : [];

  return Array.from(
    new Set(
      candidate
        .map((value) => {
          if (typeof value === "string") return value.trim();
          if (typeof value === "number") return String(value);
          return "";
        })
        .filter(Boolean),
    ),
  );
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJsonFile = async (filePath: string, payload: unknown) => {
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
};

const sqlLiteral = (value: unknown): string => {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = String(value).replace(/'/g, "''");
  return `'${text}'`;
};

const runTsScript = async (label: string, scriptPath: string, scriptArgs: string[]) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, ...scriptArgs],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", (error) => reject(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed (exit=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
      );
    });
  });
};

const loadSourceIds = async (supabase: SupabaseClient): Promise<string[]> => {
  if (sourceIdsFile) {
    const raw = await readFile(path.resolve(repoRoot, sourceIdsFile), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `[p1d-force-ingredient-id-backfill] invalid JSON in --source-ids-file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const ids = normalizeSourceIds(parsed);
    if (!ids.length) {
      throw new Error(
        "[p1d-force-ingredient-id-backfill] --source-ids-file resolved to empty sourceIds",
      );
    }
    return ids;
  }

  const sourceIds = new Set<string>();
  let cursor: string | null = null;

  while (sourceIds.size < sampleLimit) {
    let query = supabase
      .from("product_ingredients")
      .select("source_id,canonical_source_id")
      .eq("source", source)
      .eq("is_active", true)
      .is("ingredient_id", null)
      .order("source_id", { ascending: true })
      .limit(pageSize);

    if (cursor) {
      query = query.gt("source_id", cursor);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `[p1d-force-ingredient-id-backfill] source ID sampling failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<{
      source_id: string | null;
      canonical_source_id: string | null;
    }>;
    if (!rows.length) break;

    for (const row of rows) {
      const picked =
        idColumn === "canonical_source_id"
          ? row.canonical_source_id?.trim() || row.source_id?.trim() || ""
          : row.source_id?.trim() || "";
      if (!picked) continue;
      sourceIds.add(picked);
      if (sourceIds.size >= sampleLimit) break;
    }

    cursor = rows[rows.length - 1]?.source_id ?? cursor;
    if (rows.length < pageSize) break;
  }

  return Array.from(sourceIds);
};

const countMissingRowsForSourceIds = async (
  supabase: SupabaseClient,
  sourceIds: string[],
) => {
  if (!sourceIds.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { count, error } = await supabase
      .from("product_ingredients")
      .select("id", { head: true, count: "exact" })
      .eq("source", source)
      .eq("is_active", true)
      .is("ingredient_id", null)
      .in(idColumn, chunk);

    if (error) {
      throw new Error(
        `[p1d-force-ingredient-id-backfill] missing row count failed: ${error.message}`,
      );
    }

    total += count ?? 0;
  }
  return total;
};

const loadMissingSnapshotRows = async (
  supabase: SupabaseClient,
  sourceIds: string[],
): Promise<MissingIngredientSnapshotRow[]> => {
  const rows: MissingIngredientSnapshotRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select(
        "id,source_id,canonical_source_id,ingredient_id,match_method,match_confidence",
      )
      .eq("source", source)
      .eq("is_active", true)
      .is("ingredient_id", null)
      .in(idColumn, chunk);

    if (error) {
      throw new Error(
        `[p1d-force-ingredient-id-backfill] snapshot query failed: ${error.message}`,
      );
    }
    rows.push(...((data ?? []) as MissingIngredientSnapshotRow[]));
  }
  return rows;
};

const buildRollbackSql = (rows: MissingIngredientSnapshotRow[]): string => {
  const lines: string[] = [
    "-- Rollback for p1d-force-ingredient-id-backfill",
    "-- Generated automatically before apply",
    "BEGIN;",
  ];
  for (const row of rows) {
    lines.push(
      `UPDATE product_ingredients SET ingredient_id = ${sqlLiteral(
        row.ingredient_id,
      )}, match_method = ${sqlLiteral(
        row.match_method,
      )}, match_confidence = ${sqlLiteral(row.match_confidence)} WHERE id = ${sqlLiteral(
        row.id,
      )};`,
    );
  }
  lines.push("COMMIT;");
  lines.push("");
  return lines.join("\n");
};

const buildFailureReasonTop = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

const main = async () => {
  if (hasFlag("help")) {
    usage();
    return;
  }

  await mkdir(outDir, { recursive: true });

  const supabase = await getSupabase();
  const sourceIds = await loadSourceIds(supabase);
  if (!sourceIds.length) {
    throw new Error("[p1d-force-ingredient-id-backfill] no source IDs to process");
  }

  await writeJsonFile(sourceIdsPath, {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    sourceIds,
  });

  const missingBefore = await countMissingRowsForSourceIds(supabase, sourceIds);
  const missingSnapshotRows = await loadMissingSnapshotRows(supabase, sourceIds);
  await writeJsonFile(beforeSnapshotPath, {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    rowCount: missingSnapshotRows.length,
    rows: missingSnapshotRows,
  });
  await writeFile(rollbackSqlPath, buildRollbackSql(missingSnapshotRows), "utf8");

  await runTsScript(
    "refresh-missing-ingredient-ids (dry-run)",
    refreshScriptPath,
    [
      "--source",
      source,
      "--id-column",
      idColumn,
      "--source-ids-file",
      sourceIdsPath,
      "--out",
      refreshDryRunPath,
      "--concurrency",
      String(refreshConcurrency),
      "--trgm-min-confidence",
      String(trgmMinConfidence),
      "--dry-run",
    ],
  );

  const refreshDryRunPayload = await readJsonFile<{ summary?: RefreshSummary }>(
    refreshDryRunPath,
  );
  const refreshDryRunSummary = refreshDryRunPayload?.summary ?? null;
  if (!refreshDryRunSummary) {
    throw new Error(
      "[p1d-force-ingredient-id-backfill] missing refresh dry-run summary payload",
    );
  }

  const estimatedUpdatedRows = Math.max(
    0,
    (refreshDryRunSummary.resolvedRows ?? 0) -
      (refreshDryRunSummary.skippedLowConfidenceTrgm ?? 0),
  );
  const estimatedRemainingMissingRows = Math.max(0, missingBefore - estimatedUpdatedRows);
  const beforeAfterPayload = {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    before: {
      sourceIds: sourceIds.length,
      missingRows: missingBefore,
    },
    dryRun: {
      attemptedRows: refreshDryRunSummary.attemptedRows,
      resolvedRows: refreshDryRunSummary.resolvedRows,
      unresolvedRows: refreshDryRunSummary.unresolvedRows,
      skippedLowConfidenceTrgm: refreshDryRunSummary.skippedLowConfidenceTrgm,
    },
    estimate: {
      estimatedUpdatedRows,
      estimatedRemainingMissingRows,
    },
  };
  await writeJsonFile(beforeAfterPath, beforeAfterPayload);

  const applyConfirmed =
    applyRequested && confirmProd === APPLY_ACK && envAck === APPLY_ACK;
  const applyBlocked = applyRequested && !applyConfirmed;

  let refreshApplySummary: RefreshSummary | null = null;
  let backfillSummary: BackfillSummary | null = null;
  let applyExecuted = false;

  if (applyConfirmed) {
    applyExecuted = true;
    await runTsScript(
      "refresh-missing-ingredient-ids (apply)",
      refreshScriptPath,
      [
        "--source",
        source,
        "--id-column",
        idColumn,
        "--source-ids-file",
        sourceIdsPath,
        "--out",
        refreshApplyPath,
        "--concurrency",
        String(refreshConcurrency),
        "--trgm-min-confidence",
        String(trgmMinConfidence),
      ],
    );

    const refreshApplyPayload = await readJsonFile<{ summary?: RefreshSummary }>(
      refreshApplyPath,
    );
    refreshApplySummary = refreshApplyPayload?.summary ?? null;
    if (!refreshApplySummary) {
      throw new Error(
        "[p1d-force-ingredient-id-backfill] missing refresh apply summary payload",
      );
    }

    await runTsScript("backfill-v4-scores (apply)", backfillScriptPath, [
      "--source",
      source,
      "--source-ids-file",
      sourceIdsPath,
      "--summary-json",
      backfillSummaryPath,
    ]);
    backfillSummary = await readJsonFile<BackfillSummary>(backfillSummaryPath);
  }

  const failureReasons: Record<string, number> = {};
  if (refreshApplySummary?.updateErrors) {
    failureReasons.refresh_update_errors = refreshApplySummary.updateErrors;
  }
  if (Number(backfillSummary?.failed ?? 0) > 0) {
    failureReasons.backfill_failed = Number(backfillSummary?.failed ?? 0);
  }
  if (Number(backfillSummary?.ingredientUpsertFailed ?? 0) > 0) {
    failureReasons.backfill_ingredient_upsert_failed = Number(
      backfillSummary?.ingredientUpsertFailed ?? 0,
    );
  }
  if (Number(backfillSummary?.scoreUpsertFailed ?? 0) > 0) {
    failureReasons.backfill_score_upsert_failed = Number(
      backfillSummary?.scoreUpsertFailed ?? 0,
    );
  }
  if (Number(backfillSummary?.computeScoreFailed ?? 0) > 0) {
    failureReasons.backfill_compute_score_failed = Number(
      backfillSummary?.computeScoreFailed ?? 0,
    );
  }

  const applySummaryPayload = {
    generatedAt: new Date().toISOString(),
    applyRequested,
    applyExecuted,
    readOnlyEnforced: !applyExecuted,
    confirm: {
      requiredToken: APPLY_ACK,
      confirmProd,
      envAckPresent: envAck.length > 0,
      envAckMatches: envAck === APPLY_ACK,
      passed: applyConfirmed,
    },
    successCount: applyExecuted
      ? (refreshApplySummary?.updatedRows ?? 0) + Number(backfillSummary?.scores ?? 0)
      : 0,
    failedCount: applyExecuted
      ? (refreshApplySummary?.updateErrors ?? 0) + Number(backfillSummary?.failed ?? 0)
      : 0,
    skippedCount: applyExecuted
      ? (refreshApplySummary?.unresolvedRows ?? 0) +
        (refreshApplySummary?.skippedLowConfidenceTrgm ?? 0) +
        Number(backfillSummary?.existing ?? 0) +
        Number(backfillSummary?.skipped ?? 0)
      : refreshDryRunSummary.unresolvedRows + refreshDryRunSummary.skippedLowConfidenceTrgm,
    failureReasonTop: buildFailureReasonTop(failureReasons),
    rollbackFile: rollbackSqlPath,
    artifacts: {
      sourceIds: sourceIdsPath,
      beforeAfter: beforeAfterPath,
      refreshDryRun: refreshDryRunPath,
      refreshApply: refreshApplyPath,
      backfillSummary: backfillSummaryPath,
      beforeApplySnapshot: beforeSnapshotPath,
      rollbackSql: rollbackSqlPath,
    },
  };
  await writeJsonFile(applySummaryPath, applySummaryPayload);

  await writeJsonFile(summaryPath, {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    outDir,
    status: applyExecuted
      ? "apply_complete"
      : applyBlocked
        ? "apply_blocked_read_only"
        : "dry_run_complete",
    message: applyExecuted
      ? "Dry-run and apply flow completed."
      : applyBlocked
        ? "Apply was requested but confirmation guardrails failed; read-only outputs generated."
        : "Dry-run flow completed (no writes executed).",
    sourceIds: sourceIds.length,
    artifacts: {
      summary: summaryPath,
      sourceIds: sourceIdsPath,
      beforeAfter: beforeAfterPath,
      applySummary: applySummaryPath,
      refreshDryRun: refreshDryRunPath,
      refreshApply: refreshApplyPath,
      backfillSummary: backfillSummaryPath,
      beforeApplySnapshot: beforeSnapshotPath,
      rollbackSql: rollbackSqlPath,
    },
  });

  if (applyBlocked) {
    process.exitCode = 2;
    console.error(
      `[p1d-force-ingredient-id-backfill] apply blocked: require --confirm-prod ${APPLY_ACK} and P1D_APPLY_ACK=${APPLY_ACK}`,
    );
  } else {
    console.log(
      `[p1d-force-ingredient-id-backfill] completed -> ${summaryPath}`,
    );
  }
};

main().catch((error) => {
  console.error(
    `[p1d-force-ingredient-id-backfill] fatal: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
