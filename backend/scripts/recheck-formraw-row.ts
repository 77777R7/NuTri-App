import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type TraceResult = {
  updateWhere?: Record<string, string | null>;
  expectedFormRaw?: string | null;
  productIngredientId?: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const TRACE_PATH =
  getArg("trace") ??
  "output/orchestrator/20260113_canary_explicit_200_v7/formraw_write_trace.json";
const OUTPUT =
  getArg("output") ??
  "output/orchestrator/20260113_canary_explicit_200_v7/formraw_write_recheck.json";
const FORM_RAW_OVERRIDE = getArg("form-raw");
const FORCE_UPDATE = args.includes("--force-update");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const classifyEmptyType = (value: string | null | undefined) => {
  if (value === null || value === undefined) return "null";
  if (value === "") return "empty_string";
  if (value.trim().length === 0) return "whitespace";
  return "non_empty";
};

const run = async () => {
  const traceRaw = await readFile(TRACE_PATH, "utf8");
  const traceJson = JSON.parse(traceRaw) as { traces?: TraceResult[] };
  const trace = traceJson?.traces?.[0];
  if (!trace?.updateWhere) {
    throw new Error(`[formraw-recheck] updateWhere missing in ${TRACE_PATH}`);
  }

  const updateWhere = trace.updateWhere;
  const expectedFormRaw = FORM_RAW_OVERRIDE ?? trace.expectedFormRaw ?? null;

  let rows: Array<Record<string, unknown>> = [];
  let error: { message?: string } | null = null;
  if (trace.productIngredientId) {
    const result = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,form_raw,updated_at,match_method,match_confidence")
        .eq("id", trace.productIngredientId ?? ""),
    );
    rows = (result.data ?? []) as Array<Record<string, unknown>>;
    error = result.error as { message?: string } | null;
  } else {
    const result = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,form_raw,updated_at,match_method,match_confidence")
        .eq("source", "lnhpd")
        .eq("source_id", updateWhere.source_id ?? "")
        .eq("basis", updateWhere.basis ?? "")
        .eq("name_key", updateWhere.name_key ?? "")
        .eq("ingredient_id", updateWhere.ingredient_id ?? ""),
    );
    rows = (result.data ?? []) as Array<Record<string, unknown>>;
    error = result.error as { message?: string } | null;
  }
  if (error) {
    const meta = extractErrorMeta(error);
    throw new Error(meta.message ?? error.message);
  }

  const matchedRows = rows;
  const matchedRowsCount = matchedRows.length;
  const rowId = matchedRowsCount === 1 ? (matchedRows[0]?.id as string | undefined) : null;
  const formRawBefore = matchedRowsCount === 1 ? (matchedRows[0]?.form_raw as string | null | undefined) : null;

  let updateResult: Record<string, unknown> | null = null;
  if (FORCE_UPDATE && rowId && expectedFormRaw) {
    const { data: updated, error: updateError } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .update({ form_raw: expectedFormRaw })
        .eq("id", rowId)
        .or("form_raw.is.null,form_raw.eq.")
        .select("id,form_raw"),
    );
    updateResult = {
      attempted: true,
      id: rowId,
      affectedRows: updated?.length ?? 0,
      error: updateError ? extractErrorMeta(updateError).message ?? updateError.message : null,
      returned: updated ?? [],
    };
  } else {
    updateResult = {
      attempted: false,
      reason: FORCE_UPDATE ? "missing_row_or_expected_form_raw" : "force_update_not_set",
    };
  }

  let rowAfter: Record<string, unknown> | null = null;
  if (rowId) {
    const { data: afterRow } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,form_raw,updated_at,match_method,match_confidence")
        .eq("id", rowId)
        .maybeSingle(),
    );
    rowAfter = afterRow ?? null;
  }

  const payload = {
    tracePath: TRACE_PATH,
    updateWhere,
    expectedFormRaw,
    matchedRowsCount,
    matchedRows,
    formRawBefore,
    formRawBeforeEmptyType: classifyEmptyType(formRawBefore as string | null | undefined),
    updateById: updateResult,
    rowAfter,
    formRawAfterEmptyType: classifyEmptyType((rowAfter as Record<string, unknown> | null)?.form_raw as string | null | undefined),
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT }, null, 2));
};

run().catch((error) => {
  console.error("[formraw-recheck] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
