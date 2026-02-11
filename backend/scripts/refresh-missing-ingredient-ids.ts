import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductIngredientRow = {
  id: string;
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string | null;
  is_active: boolean;
  match_method: string | null;
  match_confidence: number | null;
};

type IngredientLookupRpcRow = {
  ingredient_id: string | null;
  base_unit?: string | null;
  match_method?: string | null;
  match_confidence?: number | string | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const sourceArg = (getArg("source") ?? "dsld").toLowerCase();
const idColumn = (getArg("id-column") ?? "source_id").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const outPath = getArg("out") ?? null;
const dryRun = hasFlag("dry-run");
const concurrency = Math.max(1, Number(getArg("concurrency") ?? "6"));
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const trgmMinConfidence = Math.min(
  1,
  Math.max(0, Number(getArg("trgm-min-confidence") ?? "0.85")),
);

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Keep this conservative: we only skip obvious headings/marketing labels.
// (If we mapped these to real ingredients, we'd risk affecting scoring.)
const DSLD_EXCLUDED_KEY_PATTERNS: RegExp[] = [
  /\bproprietary\b/,
  /\bblend\b/,
  /\bcomplex\b/,
  /\bmatrix\b/,
  /\bformula\b/,
  /\bingredients?\b/,
  /\bflavou?r(ing)?\b/,
  /\bpatent\s+pending\b/,
  /\b(amino\s+acid\s+profile|fatty\s+acid\s+composition)\b/,
  /\b(distilled\s+water|water)\b/,
  /\b(electrolyte\s+blend|food\s+blend|protein\s+blend)\b/,
  /\bfatty\s+acids?\b/,
  /\bweight\s+loss\b/,
  /\bfat\s+burner\b/,
  /\bthermogenic\b/,
  /\bcarb\s+controller\b/,
  // Section headings / marketing labels (not a single ingredient)
  /\binfusions?\b/,
  /\bagents?\b/,
  /\bergogenics?\b/,
  /\bintensifier\b/,
  /\bmaximizer\b/,
  /\bmodule\b/,
  /\bbioaccelerators\b/,
  // More section-heading tokens (not ingredients)
  /\bsystem\b/,
  /\bstack\b/,
  /\bamplifier\b/,
  /\bactivator\b/,
  /\bhydrator\b/,
  /\bsupport\b/,
  /\blegend\b/,
];

const isDsldExcludedKey = (key: string): boolean =>
  DSLD_EXCLUDED_KEY_PATTERNS.some((pattern) => pattern.test(key));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string").map((v) => v.trim()).filter(Boolean);
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { sourceIds?: unknown };
    if (Array.isArray(record.sourceIds)) {
      return record.sourceIds.filter((item): item is string => typeof item === "string").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const fetchMissingRows = async (
  source: ScoreSource,
  column: "source_id" | "canonical_source_id",
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,is_active,match_method,match_confidence")
        .eq("source", source)
        .eq("is_active", true)
        .is("ingredient_id", null)
        .in(column, chunk)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as ProductIngredientRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  return rows;
};

const resolveLookup = async (
  query: string,
  cache: Map<string, IngredientLookupRpcRow | null>,
): Promise<IngredientLookupRpcRow | null> => {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const { data, error } = await withRetry(() =>
    supabase.rpc("resolve_ingredient_lookup", { query_text: query }),
  );

  if (error) {
    const meta = extractErrorMeta(error);
    console.warn(`[refresh-missing-ingredient-ids] lookup failed query=${JSON.stringify(query)}`, meta);
    cache.set(key, null);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as IngredientLookupRpcRow | null;
  cache.set(key, row ?? null);
  return row ?? null;
};

const updateRow = async (params: {
  id: string;
  ingredientId: string;
  matchMethod: string | null;
  matchConfidence: number | null;
}): Promise<{ ok: true } | { ok: false; error: unknown }> => {
  const { error } = await withRetry(() =>
    supabase
      .from("product_ingredients")
      .update({
        ingredient_id: params.ingredientId,
        match_method: params.matchMethod,
        match_confidence: params.matchConfidence,
      })
      .eq("id", params.id),
  );
  if (error) return { ok: false, error };
  return { ok: true };
};

const runWithConcurrency = async <T>(
  items: T[],
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const run = async () => {
  const source: ScoreSource = sourceArg === "lnhpd" ? "lnhpd" : "dsld";
  const column = idColumn === "canonical_source_id" ? "canonical_source_id" : "source_id";
  if (!sourceIdsFile) {
    throw new Error("[refresh-missing-ingredient-ids] --source-ids-file is required");
  }

  const sourceIds = await readSourceIds(sourceIdsFile);
  if (!sourceIds.length) {
    throw new Error(`[refresh-missing-ingredient-ids] no source IDs found in: ${sourceIdsFile}`);
  }

  console.log(
    `[refresh-missing-ingredient-ids] source=${source} idColumn=${column} sourceIds=${sourceIds.length} concurrency=${concurrency} dryRun=${dryRun} trgmMinConfidence=${trgmMinConfidence}`,
  );

  const missingRows = await fetchMissingRows(source, column, sourceIds);
  const lookupCache = new Map<string, IngredientLookupRpcRow | null>();

  const stats = {
    source,
    idColumn: column,
    sourceIds: sourceIds.length,
    fetchedMissingRows: missingRows.length,
    excludedRows: 0,
    attemptedRows: 0,
    resolvedRows: 0,
    updatedRows: 0,
    unresolvedRows: 0,
    skippedLowConfidenceTrgm: 0,
    updateErrors: 0,
    byMatchMethod: {} as Record<string, number>,
    generatedAt: new Date().toISOString(),
  };

  const actionable = missingRows.filter((row) => {
    if (!row.is_active || row.ingredient_id) return false;
    if (source === "dsld") {
      const key = normalizeNameKey(row.name_key ?? row.name_raw);
      if (key && isDsldExcludedKey(key)) {
        stats.excludedRows += 1;
        return false;
      }
    }
    return true;
  });

  await runWithConcurrency(actionable, async (row) => {
    stats.attemptedRows += 1;
    const query = row.name_raw?.trim();
    if (!query) {
      stats.unresolvedRows += 1;
      return;
    }

    const lookup = await resolveLookup(query, lookupCache);
    const ingredientId = lookup?.ingredient_id ?? null;
    if (!ingredientId) {
      stats.unresolvedRows += 1;
      return;
    }

    stats.resolvedRows += 1;
    const matchMethod = lookup?.match_method ?? null;
    const rawConfidence = lookup?.match_confidence ?? null;
    const parsedConfidence =
      typeof rawConfidence === "number"
        ? rawConfidence
        : typeof rawConfidence === "string"
          ? Number(rawConfidence)
          : null;
    const matchConfidence = Number.isFinite(parsedConfidence as number) ? (parsedConfidence as number) : null;

    const bucket = matchMethod ?? "unknown";
    stats.byMatchMethod[bucket] = (stats.byMatchMethod[bucket] ?? 0) + 1;

    if (matchMethod === "trgm") {
      if (matchConfidence == null || matchConfidence < trgmMinConfidence) {
        stats.skippedLowConfidenceTrgm += 1;
        stats.unresolvedRows += 1;
        return;
      }
    }

    if (dryRun) return;

    const result = await updateRow({
      id: row.id,
      ingredientId,
      matchMethod,
      matchConfidence,
    });
    if (!result.ok) {
      stats.updateErrors += 1;
      const meta = extractErrorMeta(result.error);
      console.warn(
        `[refresh-missing-ingredient-ids] update failed id=${row.id} source_id=${row.source_id} name_raw=${JSON.stringify(row.name_raw)}`,
        meta,
      );
      return;
    }
    stats.updatedRows += 1;
  });

  if (outPath) {
    await ensureDir(outPath);
    await writeFile(outPath, JSON.stringify({ summary: stats }, null, 2), "utf8");
    console.log(`[refresh-missing-ingredient-ids] wrote summary -> ${outPath}`);
  } else {
    console.log(JSON.stringify({ summary: stats }, null, 2));
  }
};

run().catch((err) => {
  console.error("[refresh-missing-ingredient-ids] fatal", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
