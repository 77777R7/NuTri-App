import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DiagnoseSummary = {
  source: string;
  counts?: {
    taxonomyMismatch?: number;
    activeRows?: number;
    resolvedRows?: number;
  };
  ratios?: {
    taxonomyMismatchAmongResolved?: number;
    taxonomyMismatchAmongActive?: number;
  };
};

type DiagnoseExample = {
  source?: string;
  sourceId?: string;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  matchAttempt?: {
    aliasMatches?: Array<{
      aliasText?: string;
      aliasNorm?: string | null;
      formKey?: string;
    }>;
  };
};

type IngredientFormAliasRow = {
  id: string | number;
  alias_text: string;
  alias_norm: string | null;
  form_key: string;
  ingredient_id: string | null;
};

type AliasCandidate = {
  aliasText: string;
  formKey: string;
  ingredientIds: Set<string>;
  sourceIds: Set<string>;
  canonicalSourceIds: Set<string>;
  evidenceCount: number;
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

const diagnoseScriptPath = path.resolve(scriptDir, "diagnose-form-taxonomy-mismatch.ts");
const buildFormrawScriptPath = path.resolve(scriptDir, "build-formraw-rebackfill-lnhpd.ts");
const backfillScriptPath = path.resolve(scriptDir, "backfill-v4-scores.ts");

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const source = sourceArg === "lnhpd" ? "lnhpd" : sourceArg;
const idColumnArg = (getArg("id-column") ?? "source_id").toLowerCase();
const idColumn = idColumnArg === "canonical_source_id" ? "canonical_source_id" : "source_id";
const limit = Math.max(1, Number(getArg("limit") ?? "5000"));
const topN = Math.max(1, Number(getArg("top-n") ?? "200"));
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const sourceIdsFile = getArg("source-ids-file");
const applyRequested = hasFlag("apply");
const confirmProd = getArg("confirm-prod") ?? "";
const envAck = process.env.P1D_APPLY_ACK ?? "";

const outDir = path.resolve(
  repoRoot,
  getArg("out-dir") ?? `output/p1d/taxonomy-alias-mismatch-${Date.now()}`,
);

const diagnoseBeforeDir = path.join(outDir, "diagnose_before");
const diagnoseAfterDir = path.join(outDir, "diagnose_after");
const deletePlanPath = path.join(outDir, "delete_plan.json");
const snapshotPath = path.join(outDir, "alias_delete_snapshot.json");
const rollbackSqlPath = path.join(outDir, "rollback.sql");
const sourceIdsPath = path.join(outDir, "source_ids.json");
const rebackfillJsonlPath = path.join(outDir, "taxonomy_mismatch_rebackfill.jsonl");
const backfillSummaryPath = path.join(outDir, "backfill_summary.json");
const deltaAfterApplyPath = path.join(outDir, "delta_after_apply.json");
const applySummaryPath = path.join(outDir, "apply_summary.json");
const summaryPath = path.join(outDir, "summary.json");

const usage = () => {
  console.log(
    [
      "Usage: node --import tsx backend/scripts/p1d-clean-taxonomy-alias-mismatch.ts [options]",
      "",
      "Options:",
      "  --source lnhpd                          Source (fixed to lnhpd for P1-D cleanup)",
      "  --id-column <source_id|canonical_source_id>",
      "                                         Diagnose ID column (default: source_id)",
      "  --source-ids-file <path>               Optional scoped source IDs (JSON)",
      "  --limit <n>                            Diagnose sample limit (default: 5000)",
      "  --top-n <n>                            Diagnose token top N (default: 200)",
      "  --page-size <n>                        Diagnose page size (default: 1000)",
      "  --out-dir <path>                       Output directory",
      "  --apply                                Execute alias delete + backfill writes",
      `  --confirm-prod ${APPLY_ACK}   Required with --apply`,
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

const aliasKey = (aliasText: string, formKey: string) => `${aliasText}\u0001${formKey}`;

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

const readJsonl = async <T>(filePath: string): Promise<T[]> => {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is T => Boolean(entry));
};

const runDiagnose = async (targetDir: string) => {
  await mkdir(targetDir, { recursive: true });

  const scriptArgs = [
    "--source",
    source,
    "--out-dir",
    targetDir,
    "--limit",
    String(limit),
    "--top-n",
    String(topN),
    "--id-column",
    idColumn,
    "--page-size",
    String(pageSize),
  ];
  if (sourceIdsFile) {
    scriptArgs.push("--source-ids-file", path.resolve(repoRoot, sourceIdsFile));
  }

  await runTsScript("diagnose-form-taxonomy-mismatch", diagnoseScriptPath, scriptArgs);

  const summaryPath = path.join(targetDir, `mismatch_summary_${source}.json`);
  const tokensPath = path.join(targetDir, `mismatch_top_tokens_${source}.json`);
  const examplesPath = path.join(targetDir, `mismatch_examples_${source}.jsonl`);
  const summary = await readJsonFile<DiagnoseSummary>(summaryPath);
  const examples = await readJsonl<DiagnoseExample>(examplesPath);

  return {
    summaryPath,
    tokensPath,
    examplesPath,
    summary,
    examples,
  };
};

const buildAliasCandidates = (examples: DiagnoseExample[]) => {
  const map = new Map<string, AliasCandidate>();
  for (const example of examples) {
    const sourceId = typeof example.sourceId === "string" ? example.sourceId.trim() : "";
    const canonicalSourceId =
      typeof example.canonicalSourceId === "string"
        ? example.canonicalSourceId.trim()
        : "";
    const ingredientId =
      typeof example.ingredientId === "string" ? example.ingredientId.trim() : "";
    const aliasMatches = example.matchAttempt?.aliasMatches ?? [];

    for (const alias of aliasMatches) {
      const aliasText =
        typeof alias.aliasText === "string" ? alias.aliasText.trim() : "";
      const formKey = typeof alias.formKey === "string" ? alias.formKey.trim() : "";
      if (!aliasText || !formKey) continue;

      const key = aliasKey(aliasText, formKey);
      const existing = map.get(key) ?? {
        aliasText,
        formKey,
        ingredientIds: new Set<string>(),
        sourceIds: new Set<string>(),
        canonicalSourceIds: new Set<string>(),
        evidenceCount: 0,
      };

      if (ingredientId) existing.ingredientIds.add(ingredientId);
      if (sourceId) existing.sourceIds.add(sourceId);
      if (canonicalSourceId) existing.canonicalSourceIds.add(canonicalSourceId);
      existing.evidenceCount += 1;
      map.set(key, existing);
    }
  }
  return map;
};

const resolveAliasRowsFromCandidates = async (
  supabase: SupabaseClient,
  candidates: Map<string, AliasCandidate>,
): Promise<IngredientFormAliasRow[]> => {
  const aliasTexts = Array.from(
    new Set(
      Array.from(candidates.values())
        .map((item) => item.aliasText.trim())
        .filter(Boolean),
    ),
  );

  if (!aliasTexts.length) return [];

  const rowsById = new Map<string, IngredientFormAliasRow>();
  for (const chunk of chunkArray(aliasTexts, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_aliases")
      .select("id,alias_text,alias_norm,form_key,ingredient_id")
      .in("alias_text", chunk);

    if (error) {
      throw new Error(
        `[p1d-clean-taxonomy-alias-mismatch] alias lookup failed: ${error.message}`,
      );
    }

    for (const row of (data ?? []) as IngredientFormAliasRow[]) {
      const key = aliasKey(row.alias_text, row.form_key);
      const candidate = candidates.get(key);
      if (!candidate) continue;
      if (row.ingredient_id && !candidate.ingredientIds.has(row.ingredient_id)) continue;
      rowsById.set(String(row.id), row);
    }
  }
  return Array.from(rowsById.values());
};

const buildDeletePlanRows = (
  aliasRows: IngredientFormAliasRow[],
  candidates: Map<string, AliasCandidate>,
) => {
  const rows = aliasRows
    .map((row) => {
      const candidate = candidates.get(aliasKey(row.alias_text, row.form_key));
      const impactedSourceIds = Array.from(candidate?.sourceIds ?? []).sort();
      const impactedCanonicalSourceIds = Array.from(
        candidate?.canonicalSourceIds ?? [],
      ).sort();
      return {
        id: String(row.id),
        aliasText: row.alias_text,
        aliasNorm: row.alias_norm ?? null,
        formKey: row.form_key,
        ingredientId: row.ingredient_id ?? null,
        impactedSourceCount: impactedSourceIds.length,
        impactedSourceIds,
        impactedCanonicalSourceIds,
        evidenceCount: candidate?.evidenceCount ?? 0,
        reason: "aliasMatchesForms=false",
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return rows;
};

const buildRollbackSql = (
  rows: Array<{
    id: string;
    aliasText: string;
    aliasNorm: string | null;
    formKey: string;
    ingredientId: string | null;
  }>,
): string => {
  const lines: string[] = [
    "-- Rollback for p1d-clean-taxonomy-alias-mismatch",
    "-- Generated automatically before alias deletion",
    "BEGIN;",
  ];
  for (const row of rows) {
    lines.push(
      `INSERT INTO ingredient_form_aliases (id, alias_text, alias_norm, form_key, ingredient_id) VALUES (${sqlLiteral(
        row.id,
      )}, ${sqlLiteral(row.aliasText)}, ${sqlLiteral(row.aliasNorm)}, ${sqlLiteral(
        row.formKey,
      )}, ${sqlLiteral(row.ingredientId)}) ON CONFLICT (id) DO NOTHING;`,
    );
  }
  lines.push("COMMIT;");
  lines.push("");
  return lines.join("\n");
};

const deleteAliasRows = async (
  supabase: SupabaseClient,
  rows: Array<{ id: string }>,
  failureReasons: Record<string, number>,
) => {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const chunk of chunkArray(rows.map((row) => row.id), 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_aliases")
      .delete()
      .in("id", chunk)
      .select("id");

    if (error) {
      failed += chunk.length;
      const reason = `delete_error:${error.message}`;
      failureReasons[reason] = (failureReasons[reason] ?? 0) + chunk.length;
      continue;
    }

    const deletedIds = new Set(
      ((data ?? []) as Array<{ id: string | number }>).map((item) => String(item.id)),
    );
    success += deletedIds.size;
    if (deletedIds.size < chunk.length) {
      const missed = chunk.length - deletedIds.size;
      skipped += missed;
      failureReasons.delete_not_found_or_already_deleted =
        (failureReasons.delete_not_found_or_already_deleted ?? 0) + missed;
    }
  }

  return { success, failed, skipped };
};

const loadRebackfillSourceIds = async (filePath: string): Promise<string[]> => {
  const entries = await readJsonl<{ sourceId?: string }>(filePath);
  return Array.from(
    new Set(
      entries
        .map((entry) =>
          typeof entry.sourceId === "string" ? entry.sourceId.trim() : "",
        )
        .filter(Boolean),
    ),
  );
};

const buildFailureReasonTop = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

const numberOrZero = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
};

const main = async () => {
  if (hasFlag("help")) {
    usage();
    return;
  }
  if (source !== "lnhpd") {
    throw new Error(
      "[p1d-clean-taxonomy-alias-mismatch] only --source lnhpd is supported",
    );
  }

  await mkdir(outDir, { recursive: true });

  const beforeDiagnose = await runDiagnose(diagnoseBeforeDir);
  const supabase = await getSupabase();
  const candidates = buildAliasCandidates(beforeDiagnose.examples);
  const aliasRows = await resolveAliasRowsFromCandidates(supabase, candidates);
  const deletePlanRows = buildDeletePlanRows(aliasRows, candidates);

  const deletePlanPayload = {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    candidateAliasKeys: candidates.size,
    rowsPlanned: deletePlanRows.length,
    rows: deletePlanRows,
  };
  await writeJsonFile(deletePlanPath, deletePlanPayload);

  await writeJsonFile(snapshotPath, {
    generatedAt: new Date().toISOString(),
    source,
    table: "ingredient_form_aliases",
    rowCount: deletePlanRows.length,
    rows: deletePlanRows,
  });
  await writeFile(rollbackSqlPath, buildRollbackSql(deletePlanRows), "utf8");

  const applyConfirmed =
    applyRequested && confirmProd === APPLY_ACK && envAck === APPLY_ACK;
  const applyBlocked = applyRequested && !applyConfirmed;

  const failureReasons: Record<string, number> = {};
  const deleteResult = {
    planned: deletePlanRows.length,
    attempted: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let applyExecuted = false;
  if (applyConfirmed && deletePlanRows.length > 0) {
    applyExecuted = true;
    deleteResult.attempted = deletePlanRows.length;
    const deleted = await deleteAliasRows(supabase, deletePlanRows, failureReasons);
    deleteResult.success = deleted.success;
    deleteResult.failed = deleted.failed;
    deleteResult.skipped = deleted.skipped;
  }

  await runTsScript(
    "build-formraw-rebackfill-lnhpd (taxonomy-mismatch)",
    buildFormrawScriptPath,
    [
      "--mode",
      "taxonomy-mismatch",
      "--mismatch-examples",
      beforeDiagnose.examplesPath,
      "--output",
      rebackfillJsonlPath,
    ],
  );

  const rebackfillSourceIds = await loadRebackfillSourceIds(rebackfillJsonlPath);
  await writeJsonFile(sourceIdsPath, {
    generatedAt: new Date().toISOString(),
    source: "lnhpd",
    sourceIds: rebackfillSourceIds,
  });

  let backfillSummary: BackfillSummary = {
    mode: applyConfirmed ? "source-ids-file" : "source-ids-file-dry-run",
    source: "lnhpd",
    processed: 0,
    scores: 0,
    existing: 0,
    skipped: 0,
    failed: 0,
    ingredientUpsertFailed: 0,
    scoreUpsertFailed: 0,
    computeScoreFailed: 0,
  };

  if (rebackfillSourceIds.length > 0) {
    const backfillArgs = [
      "--source",
      "lnhpd",
      "--source-ids-file",
      sourceIdsPath,
      "--summary-json",
      backfillSummaryPath,
    ];
    if (!applyConfirmed) {
      backfillArgs.push("--dry-run");
    } else {
      applyExecuted = true;
    }

    await runTsScript("backfill-v4-scores", backfillScriptPath, backfillArgs);
    backfillSummary = (await readJsonFile<BackfillSummary>(backfillSummaryPath)) ?? backfillSummary;
  } else {
    await writeJsonFile(backfillSummaryPath, backfillSummary);
  }

  if (numberOrZero(backfillSummary.failed) > 0) {
    failureReasons.backfill_failed = numberOrZero(backfillSummary.failed);
  }
  if (numberOrZero(backfillSummary.ingredientUpsertFailed) > 0) {
    failureReasons.backfill_ingredient_upsert_failed = numberOrZero(
      backfillSummary.ingredientUpsertFailed,
    );
  }
  if (numberOrZero(backfillSummary.scoreUpsertFailed) > 0) {
    failureReasons.backfill_score_upsert_failed = numberOrZero(
      backfillSummary.scoreUpsertFailed,
    );
  }
  if (numberOrZero(backfillSummary.computeScoreFailed) > 0) {
    failureReasons.backfill_compute_score_failed = numberOrZero(
      backfillSummary.computeScoreFailed,
    );
  }

  const afterDiagnose = await runDiagnose(diagnoseAfterDir);
  const beforeMismatch = numberOrZero(beforeDiagnose.summary?.counts?.taxonomyMismatch);
  const afterMismatch = numberOrZero(afterDiagnose.summary?.counts?.taxonomyMismatch);
  const beforeRatio = numberOrZero(
    beforeDiagnose.summary?.ratios?.taxonomyMismatchAmongResolved,
  );
  const afterRatio = numberOrZero(
    afterDiagnose.summary?.ratios?.taxonomyMismatchAmongResolved,
  );

  const deltaPayload = {
    generatedAt: new Date().toISOString(),
    applyRequested,
    applyExecuted,
    readOnlyEnforced: !applyExecuted,
    before: {
      summaryPath: beforeDiagnose.summaryPath,
      mismatchCount: beforeMismatch,
      mismatchRatioAmongResolved: beforeRatio,
    },
    after: {
      summaryPath: afterDiagnose.summaryPath,
      mismatchCount: afterMismatch,
      mismatchRatioAmongResolved: afterRatio,
    },
    delta: {
      mismatchCount: afterMismatch - beforeMismatch,
      mismatchRatioAmongResolved: Number((afterRatio - beforeRatio).toFixed(6)),
    },
  };
  await writeJsonFile(deltaAfterApplyPath, deltaPayload);

  const failedCount =
    deleteResult.failed + numberOrZero(backfillSummary.failed);
  const skippedCount =
    deleteResult.skipped +
    numberOrZero(backfillSummary.skipped) +
    numberOrZero(backfillSummary.existing);
  const successCount =
    deleteResult.success + numberOrZero(backfillSummary.scores);

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
    successCount,
    failedCount,
    skippedCount,
    failureReasonTop: buildFailureReasonTop(failureReasons),
    rollbackFile: rollbackSqlPath,
    delete: deleteResult,
    backfillSummary,
    artifacts: {
      deletePlan: deletePlanPath,
      aliasDeleteSnapshot: snapshotPath,
      rollbackSql: rollbackSqlPath,
      rebackfillJsonl: rebackfillJsonlPath,
      sourceIds: sourceIdsPath,
      backfillSummary: backfillSummaryPath,
      deltaAfterApply: deltaAfterApplyPath,
      diagnoseBeforeSummary: beforeDiagnose.summaryPath,
      diagnoseAfterSummary: afterDiagnose.summaryPath,
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
      ? "Alias cleanup apply flow completed."
      : applyBlocked
        ? "Apply was requested but confirmation guardrails failed; read-only flow completed."
        : "Dry-run flow completed (no writes executed).",
    artifacts: {
      summary: summaryPath,
      applySummary: applySummaryPath,
      deletePlan: deletePlanPath,
      aliasDeleteSnapshot: snapshotPath,
      rollbackSql: rollbackSqlPath,
      sourceIds: sourceIdsPath,
      backfillSummary: backfillSummaryPath,
      deltaAfterApply: deltaAfterApplyPath,
      diagnoseBeforeSummary: beforeDiagnose.summaryPath,
      diagnoseAfterSummary: afterDiagnose.summaryPath,
    },
  });

  if (applyBlocked) {
    process.exitCode = 2;
    console.error(
      `[p1d-clean-taxonomy-alias-mismatch] apply blocked: require --confirm-prod ${APPLY_ACK} and P1D_APPLY_ACK=${APPLY_ACK}`,
    );
  } else {
    console.log(`[p1d-clean-taxonomy-alias-mismatch] completed -> ${summaryPath}`);
  }
};

main().catch((error) => {
  console.error(
    `[p1d-clean-taxonomy-alias-mismatch] fatal: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
