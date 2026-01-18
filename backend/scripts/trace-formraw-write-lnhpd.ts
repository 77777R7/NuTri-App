import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type YieldPreviewRow = {
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  nameRaw?: string | null;
  formRawBefore?: string | null;
  winnerTokens?: string[] | null;
  recognizedTokens?: string[] | null;
  tokensNormalizedBySource?: Record<string, string[]>;
};

type IngredientRow = {
  id: string | null;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  name_key: string | null;
  basis: string | null;
  form_raw: string | null;
};

type IngredientFormRow = {
  form_key: string | null;
};

type IngredientAliasRow = {
  alias_norm: string | null;
  form_key: string | null;
  ingredient_id: string | null;
};

type TraceResult = {
  sourceId: string | null;
  canonicalSourceId: string | null;
  ingredientId: string | null;
  ingredientName: string | null;
  nameRaw: string | null;
  nameKey: string | null;
  formRawBefore: string | null;
  tokensNormalized: Record<string, string[]>;
  winnerTokens: string[];
  winnerToken: string | null;
  mapsToFormKey: string | null;
  expectedFormRaw: string | null;
  matchedRowsCount: number;
  updateWhere: Record<string, string | null>;
  updateSqlWhere: string | null;
  updateAttempted: boolean;
  updateAffectedRows: number;
  updateError: string | null;
  formRawAfter: string | null;
  reasonCode: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const YIELD_INPUT = getArg("yield-input");
const OUTPUT =
  getArg("output") ?? "output/formraw/formraw_write_trace.json";
const ID_COLUMN = (getArg("id-column") ?? "canonical_source_id").trim();
const LIMIT = Math.max(1, Number(getArg("limit") ?? "1"));
const REQUIRE_RECOGNIZED = args.includes("--require-recognized");
const DRY_RUN = args.includes("--dry-run");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const buildNameKey = (value: string): string => {
  const normalized = normalizeNameKey(value);
  return normalized || value.trim().toLowerCase();
};

const normalizeToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9_]+/g, " ").trim();

const isEmpty = (value?: string | null) => !value || !value.trim();

const normalizeList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

const fetchIngredientName = async (ingredientId: string | null): Promise<string | null> => {
  if (!ingredientId) return null;
  const { data, error } = await withRetry(() =>
    supabase.from("ingredients").select("name").eq("id", ingredientId).maybeSingle(),
  );
  if (error) return null;
  return typeof data?.name === "string" ? data.name : null;
};

const fetchIngredientForms = async (ingredientId: string): Promise<Set<string>> => {
  const set = new Set<string>();
  const { data, error } = await withRetry(() =>
    supabase
      .from("ingredient_forms")
      .select("form_key")
      .eq("ingredient_id", ingredientId),
  );
  if (error) return set;
  (data ?? []).forEach((row) => {
    const key = typeof row?.form_key === "string" ? row.form_key.trim() : "";
    if (key) set.add(key.toLowerCase());
  });
  return set;
};

const fetchIngredientAliases = async (
  ingredientId: string,
  tokens: string[],
): Promise<IngredientAliasRow[]> => {
  if (!tokens.length) return [];
  const { data, error } = await withRetry(() =>
    supabase
      .from("ingredient_form_aliases")
      .select("alias_norm,form_key,ingredient_id")
      .in("alias_norm", tokens),
  );
  if (error) return [];
  return (data ?? []) as IngredientAliasRow[];
};

const fetchProductRows = async (
  sourceId: string,
  nameKey: string,
  idColumn: string,
): Promise<IngredientRow[]> => {
  const { data, error } = await withRetry(() =>
    supabase
      .from("product_ingredients")
      .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,basis,form_raw")
      .eq("source", "lnhpd")
      .eq(idColumn, sourceId)
      .eq("name_key", nameKey),
  );
  if (error || !data) return [];
  return data as IngredientRow[];
};

const buildUpdateWhere = (row: IngredientRow) => ({
  source: "lnhpd",
  source_id: row.source_id ?? null,
  basis: row.basis ?? null,
  name_key: row.name_key ?? null,
  ingredient_id: row.ingredient_id ?? null,
});

const formatUpdateWhere = (where: Record<string, string | null>) =>
  Object.entries(where)
    .map(([key, value]) => `${key}=${value ?? "NULL"}`)
    .join(" AND ");

const applyUpdate = async (
  row: IngredientRow,
  formRaw: string,
  updateWhere: Record<string, string | null>,
): Promise<{
  affectedRows: number;
  error: string | null;
  formRawAfter: string | null;
}> => {
  if (DRY_RUN) {
    return { affectedRows: 0, error: null, formRawAfter: row.form_raw ?? null };
  }
  const { data, error } = await withRetry(() =>
    supabase
      .from("product_ingredients")
      .update({ form_raw: formRaw })
      .eq("source", "lnhpd")
      .eq("source_id", updateWhere.source_id ?? "")
      .eq("basis", updateWhere.basis ?? "")
      .eq("name_key", updateWhere.name_key ?? "")
      .eq("ingredient_id", updateWhere.ingredient_id ?? "")
      .or("form_raw.is.null,form_raw.eq.")
      .select("id,form_raw"),
  );
  if (error) {
    const meta = extractErrorMeta(error);
    return { affectedRows: 0, error: meta.message ?? error.message, formRawAfter: null };
  }
  const affectedRows = data?.length ?? 0;
  const formRawAfter = affectedRows ? (data?.[0]?.form_raw ?? null) : null;
  return { affectedRows, error: null, formRawAfter };
};

const fetchRowById = async (id: string | null): Promise<IngredientRow | null> => {
  if (!id) return null;
  const { data, error } = await withRetry(() =>
    supabase
      .from("product_ingredients")
      .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,basis,form_raw")
      .eq("id", id)
      .maybeSingle(),
  );
  if (error || !data) return null;
  return data as IngredientRow;
};

const run = async () => {
  if (!YIELD_INPUT) {
    throw new Error("[formraw-trace] --yield-input is required");
  }
  if (!["source_id", "canonical_source_id"].includes(ID_COLUMN)) {
    throw new Error(`[formraw-trace] invalid --id-column: ${ID_COLUMN}`);
  }

  const raw = await readFile(YIELD_INPUT, "utf8");
  const parsed = JSON.parse(raw) as { previewRows?: YieldPreviewRow[] };
  const previewRows = Array.isArray(parsed?.previewRows) ? parsed.previewRows : [];
  if (!previewRows.length) {
    throw new Error(`[formraw-trace] previewRows missing in ${YIELD_INPUT}`);
  }

  const results: TraceResult[] = [];
  for (const row of previewRows) {
    if (!isEmpty(row.formRawBefore)) continue;
    const sourceId =
      (ID_COLUMN === "canonical_source_id"
        ? row.canonicalSourceId
        : row.sourceId) ?? null;
    if (!sourceId || !row.nameRaw) continue;

    const winnerTokens = normalizeList(row.winnerTokens);
    const recognizedTokens = normalizeList(row.recognizedTokens);
    if (REQUIRE_RECOGNIZED && !recognizedTokens.length) continue;
    if (!winnerTokens.length) continue;

    const nameKey = buildNameKey(row.nameRaw);
    const productRows = await fetchProductRows(sourceId, nameKey, ID_COLUMN);
    const matchedRowsCount = productRows.length;
    const productRow = matchedRowsCount === 1 ? productRows[0] : null;

    if (!productRow) {
      const reasonCode = matchedRowsCount === 0 ? "ROW_NOT_FOUND" : "ROW_NOT_UNIQUE";
      results.push({
        sourceId: row.sourceId ?? null,
        canonicalSourceId: row.canonicalSourceId ?? null,
        ingredientId: null,
        ingredientName: null,
        nameRaw: row.nameRaw ?? null,
        nameKey,
        formRawBefore: row.formRawBefore ?? null,
        tokensNormalized: row.tokensNormalizedBySource ?? {},
        winnerTokens,
        winnerToken: winnerTokens[0] ?? null,
        mapsToFormKey: null,
        expectedFormRaw: winnerTokens.join(" "),
        matchedRowsCount,
        updateWhere: {
          source: "lnhpd",
          source_id: row.sourceId ?? null,
          canonical_source_id: row.canonicalSourceId ?? null,
          basis: null,
          name_key: nameKey,
          ingredient_id: null,
        },
        updateSqlWhere: null,
        updateAttempted: false,
        updateAffectedRows: 0,
        updateError: null,
        formRawAfter: null,
        reasonCode,
      });
      if (results.length >= LIMIT) break;
      continue;
    }

    const ingredientId = productRow.ingredient_id ?? null;
    const ingredientName = await fetchIngredientName(ingredientId);
    if (!ingredientId) {
      results.push({
        sourceId: productRow.source_id ?? row.sourceId ?? null,
        canonicalSourceId: productRow.canonical_source_id ?? row.canonicalSourceId ?? null,
        ingredientId: null,
        ingredientName: null,
        nameRaw: productRow.name_raw ?? row.nameRaw ?? null,
        nameKey: productRow.name_key ?? nameKey,
        formRawBefore: productRow.form_raw ?? null,
        tokensNormalized: row.tokensNormalizedBySource ?? {},
        winnerTokens,
        winnerToken: winnerTokens[0] ?? null,
        mapsToFormKey: null,
        expectedFormRaw: winnerTokens.join(" ") || null,
        matchedRowsCount,
        updateWhere: buildUpdateWhere(productRow),
        updateSqlWhere: formatUpdateWhere(buildUpdateWhere(productRow)),
        updateAttempted: false,
        updateAffectedRows: 0,
        updateError: null,
        formRawAfter: null,
        reasonCode: "SKIP_MISSING_INGREDIENT_ID",
      });
      if (results.length >= LIMIT) break;
      continue;
    }
    const formKeys =
      ingredientId ? await fetchIngredientForms(ingredientId) : new Set<string>();
    const normalizedTokens = winnerTokens.map((token) => normalizeToken(token));
    const aliases =
      ingredientId ? await fetchIngredientAliases(ingredientId, normalizedTokens) : [];

    const aliasByToken = new Map<string, string>();
    aliases.forEach((alias) => {
      const aliasNorm = typeof alias.alias_norm === "string" ? alias.alias_norm : "";
      const formKey = typeof alias.form_key === "string" ? alias.form_key : "";
      if (!aliasNorm || !formKey) return;
      if (alias.ingredient_id && alias.ingredient_id !== ingredientId) return;
      if (aliasByToken.has(aliasNorm) && !alias.ingredient_id) return;
      aliasByToken.set(aliasNorm, formKey.toLowerCase());
    });

    let winnerToken: string | null = null;
    let mapsToFormKey: string | null = null;
    let taxonomyConflict = false;
    if (winnerTokens.length) {
      winnerToken = winnerTokens[0];
      const normalizedWinner = normalizeToken(winnerToken);
      if (formKeys.has(normalizedWinner)) {
        mapsToFormKey = normalizedWinner;
      } else if (aliasByToken.has(normalizedWinner)) {
        mapsToFormKey = aliasByToken.get(normalizedWinner) ?? null;
        if (mapsToFormKey && formKeys.size && !formKeys.has(mapsToFormKey)) {
          taxonomyConflict = true;
        }
      }
    }

    const expectedFormRaw = winnerTokens.join(" ");
    const updateWhere = buildUpdateWhere(productRow);
    const updateSqlWhere = formatUpdateWhere(updateWhere);

    let reasonCode = "UPDATED";
    let updateAttempted = false;
    let updateAffectedRows = 0;
    let updateError: string | null = null;
    let formRawAfter: string | null = null;

    if (!isEmpty(productRow.form_raw)) {
      reasonCode = "SKIP_ALREADY_NONEMPTY";
    } else if (!winnerTokens.length) {
      reasonCode = "SKIP_NO_TOKENS";
    } else if (!mapsToFormKey) {
      reasonCode = "SKIP_NO_MAP_TO_FORM_KEY";
    } else if (taxonomyConflict) {
      reasonCode = "SKIP_TAXONOMY_CONFLICT";
    } else if (winnerTokens.length > 1) {
      reasonCode = "SKIP_AMBIGUOUS_TOKENS";
    } else {
      updateAttempted = true;
      const updateResult = await applyUpdate(productRow, expectedFormRaw, updateWhere);
      updateAffectedRows = updateResult.affectedRows;
      updateError = updateResult.error;
      formRawAfter = updateResult.formRawAfter;
      if (DRY_RUN) {
        reasonCode = "SKIP_DRY_RUN";
      } else if (updateError) {
        reasonCode = "SKIP_DB_ERROR";
      } else if (updateAffectedRows === 0) {
        reasonCode = "SKIP_DB_CONFLICT_OR_NOOP";
      }
    }

    const reselected = await fetchRowById(productRow.id ?? null);
    if (reselected) {
      formRawAfter = reselected.form_raw ?? formRawAfter;
      if (
        reasonCode === "SKIP_DB_CONFLICT_OR_NOOP" &&
        isEmpty(productRow.form_raw) &&
        !isEmpty(formRawAfter)
      ) {
        reasonCode = "SKIP_ALREADY_NONEMPTY";
      }
    }

    results.push({
      sourceId: productRow.source_id ?? row.sourceId ?? null,
      canonicalSourceId: productRow.canonical_source_id ?? row.canonicalSourceId ?? null,
      ingredientId,
      ingredientName,
      nameRaw: productRow.name_raw ?? row.nameRaw ?? null,
      nameKey: productRow.name_key ?? nameKey,
      formRawBefore: productRow.form_raw ?? null,
      tokensNormalized: row.tokensNormalizedBySource ?? {},
      winnerTokens,
      winnerToken,
      mapsToFormKey,
      expectedFormRaw: expectedFormRaw || null,
      matchedRowsCount,
      updateWhere,
      updateSqlWhere,
      updateAttempted,
      updateAffectedRows,
      updateError,
      formRawAfter,
      reasonCode,
    });

    if (results.length >= LIMIT) break;
  }

  if (!results.length) {
    throw new Error("[formraw-trace] no eligible rows found in previewRows");
  }

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify({ traces: results }, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, traces: results.length }, null, 2));
};

run().catch((error) => {
  console.error("[formraw-trace] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
