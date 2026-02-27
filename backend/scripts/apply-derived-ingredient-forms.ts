import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanEntry = {
  ingredientId: string;
  canonicalKey: string | null;
  ingredientName: string | null;
  category: string | null;
  unit: string | null;
  count: number;
  recommendedFormKey: string | null;
  recommendedFormLabel: string | null;
};

type PlanFile = {
  source?: string | null;
  generatedAt?: string | null;
  topN?: number | null;
  candidates?: PlanEntry[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const planPath =
  getArg("plan") ?? "output/ingredient-forms/missing-ingredient-forms-plan-lnhpd.json";
const apply = hasFlag("apply");
const source = (getArg("source") ?? "lnhpd").toLowerCase();
const topN = Math.max(1, Number(getArg("top-n") ?? "20"));
const rebackfillOutput =
  getArg("rebackfill-output") ??
  "output/ingredient-forms/ingredient-forms-derived-rebackfill.jsonl";
const existingLookupChunkSize = Math.max(1, Number(getArg("existing-lookup-chunk-size") ?? "100"));
const ingredientChunkSize = Math.max(1, Number(getArg("ingredient-chunk-size") ?? "50"));
const productIngredientsPageSize = Math.max(1, Number(getArg("product-ingredients-page-size") ?? "250"));
const upsertBatchSize = Math.max(1, Number(getArg("upsert-batch-size") ?? "100"));
const statementTimeoutRetryCount = Math.max(0, Number(getArg("statement-timeout-retries") ?? "3"));
const statementTimeoutBackoffMs = Math.max(50, Number(getArg("statement-timeout-backoff-ms") ?? "250"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const sleep = async (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isStatementTimeoutError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const payload = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  if (typeof payload.code === "string" && payload.code.trim() === "57014") {
    return true;
  }
  const text = `${payload.message ?? ""} ${payload.details ?? ""} ${payload.hint ?? ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("canceling statement due to statement timeout");
};

const runWithStatementTimeoutRetry = async <T>(params: {
  label: string;
  run: () => Promise<{ data: T; error: unknown }>;
}): Promise<{ data: T; error: unknown }> => {
  let attempt = 0;
  while (true) {
    const result = await params.run();
    if (!result.error) return result;
    if (!isStatementTimeoutError(result.error) || attempt >= statementTimeoutRetryCount) {
      return result;
    }
    const delay =
      statementTimeoutBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * Math.max(50, statementTimeoutBackoffMs));
    console.warn(
      `[ingredient-forms] ${params.label} statement timeout (attempt ${attempt + 1}/${statementTimeoutRetryCount + 1}); retrying in ${delay}ms`,
    );
    await sleep(delay);
    attempt += 1;
  }
};

const fetchExistingForms = async (ingredientIds: string[]) => {
  const existing = new Set<string>();
  for (const [chunkIndex, chunk] of chunkArray(ingredientIds, existingLookupChunkSize).entries()) {
    const { data, error } = await runWithStatementTimeoutRetry({
      label: `fetchExistingForms chunk ${chunkIndex + 1}`,
      run: () =>
        supabase
          .from("ingredient_forms")
          .select("ingredient_id,form_key")
          .in("ingredient_id", chunk),
    });
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.ingredient_id || !row?.form_key) return;
      existing.add(`${row.ingredient_id}:${row.form_key}`);
    });
  }
  return existing;
};

const buildRebackfillRunlist = async (
  sourceValue: string,
  ingredientIds: string[],
): Promise<Array<{ source: string; sourceId: string }>> => {
  const result = new Map<string, { source: string; sourceId: string }>();
  for (const [chunkIndex, chunk] of chunkArray(ingredientIds, ingredientChunkSize).entries()) {
    let cursorId: string | number | null = null;
    while (true) {
      const { data, error } = await runWithStatementTimeoutRetry({
        label: `buildRebackfillRunlist chunk ${chunkIndex + 1}`,
        run: () => {
          let query = supabase
            .from("product_ingredients")
            .select("id,source,source_id")
            .eq("source", sourceValue)
            .in("ingredient_id", chunk)
            // Keyset pagination avoids large OFFSET scans.
            .order("id", { ascending: true })
            .limit(productIngredientsPageSize);
          if (cursorId != null) {
            query = query.gt("id", cursorId as never);
          }
          return query;
        },
      });
      if (error) throw error;
      const rows = data ?? [];
      rows.forEach((row) => {
        if (!row?.source_id || !row?.source) return;
        const key = `${row.source}:${row.source_id}`;
        if (!result.has(key)) {
          result.set(key, { source: row.source, sourceId: row.source_id });
        }
      });
      if (rows.length < productIngredientsPageSize) break;
      const nextCursor = rows[rows.length - 1]?.id;
      if (nextCursor == null) break;
      if (cursorId != null && String(cursorId) === String(nextCursor)) break;
      cursorId = nextCursor;
    }
  }
  return Array.from(result.values());
};

const writeRebackfillFile = async (
  filePath: string,
  items: Array<{ source: string; sourceId: string }>,
) => {
  if (!items.length) {
    await writeFile(filePath, "", "utf8");
    return;
  }
  const lines = items.map((item) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      source: item.source,
      sourceId: item.sourceId,
      stage: "ingredient_forms_derived",
      status: null,
      rayId: null,
      message: null,
    }),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanFile;
  const candidates = payload.candidates ?? [];
  const applicable = candidates
    .filter((entry) => entry.recommendedFormKey && entry.recommendedFormLabel)
    .slice(0, topN);

  if (!applicable.length) {
    console.log("[ingredient-forms] no candidates with recommended form keys");
    await ensureDir(rebackfillOutput);
    await writeRebackfillFile(rebackfillOutput, []);
    return;
  }

  if (!apply) {
    console.log(
      `[ingredient-forms] dry-run: ${applicable.length} candidates. Use --apply to write.`,
    );
    return;
  }

  const ingredientIds = applicable.map((entry) => entry.ingredientId);
  const existing = await fetchExistingForms(ingredientIds);

  const insertRows = applicable
    .filter((entry) => {
      const formKey = entry.recommendedFormKey ?? "";
      return !existing.has(`${entry.ingredientId}:${formKey}`);
    })
    .map((entry) => ({
      ingredient_id: entry.ingredientId,
      form_key: entry.recommendedFormKey,
      form_label: entry.recommendedFormLabel,
      relative_factor: 1,
      confidence: 0.3,
      evidence_grade: null,
      audit_status: "derived",
    }));

  if (!insertRows.length) {
    console.log("[ingredient-forms] all candidate forms already exist; no inserts");
    await ensureDir(rebackfillOutput);
    await writeRebackfillFile(rebackfillOutput, []);
    return;
  }

  const insertBatches = chunkArray(insertRows, upsertBatchSize);
  for (const [batchIndex, batch] of insertBatches.entries()) {
    console.log(
      `[ingredient-forms] upsert batch ${batchIndex + 1}/${insertBatches.length} rows=${batch.length}`,
    );
    const { error } = await runWithStatementTimeoutRetry({
      label: `upsert batch ${batchIndex + 1}/${insertBatches.length}`,
      run: () =>
        supabase
          .from("ingredient_forms")
          .upsert(batch, { onConflict: "ingredient_id,form_key" }),
    });
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[ingredient-forms] upsert failed: ${message}`);
    }
  }

  const rebackfillItems = await buildRebackfillRunlist(source, ingredientIds);
  await ensureDir(rebackfillOutput);
  await writeRebackfillFile(rebackfillOutput, rebackfillItems);

  const summary = {
    timestamp: new Date().toISOString(),
    source,
    plan: planPath,
    appliedCount: insertRows.length,
    candidateCount: applicable.length,
    insertBatchSize: upsertBatchSize,
    insertBatchCount: insertBatches.length,
    existingLookupChunkSize,
    ingredientChunkSize,
    productIngredientsPageSize,
    statementTimeoutRetryCount,
    rebackfillTargets: rebackfillItems.length,
    rebackfillOutput,
  };

  const summaryPath = path.join(path.dirname(rebackfillOutput), "ingredient_forms_derived_summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[ingredient-forms] applied=${insertRows.length} rebackfillTargets=${rebackfillItems.length} summary=${summaryPath}`,
  );
};

run().catch((error) => {
  console.error("[ingredient-forms] failed:", error);
  process.exit(1);
});
