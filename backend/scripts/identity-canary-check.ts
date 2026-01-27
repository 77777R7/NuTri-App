import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type MissingEntry = {
  nameKey: string;
  nameRawSamples?: string[];
  sourceIdSamples?: string[];
};

type MissingPayload = {
  topMissing?: MissingEntry[];
};

type CanaryCase = {
  nameKey: string;
  nameRaw: string;
  sourceId: string;
  expectedCanonicalKeys: string[];
};

type IngredientRow = {
  id: string;
  name: string | null;
  canonical_key: string | null;
};

type SynonymRow = {
  ingredient_id: string;
  synonym: string;
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const missingFile =
  getArg("missing-file") ??
  "output/ingredient-identity/cohort_5k_top500/sample/ingredient_id_missing_after_5k.json";
const nameKeysArg =
  getArg("name-keys") ?? "fish oil,phosphorus,3 pyridinecarboxamide";
const outputPath =
  getArg("output") ?? "output/ingredient-identity/identity_canary_check.json";

const CANONICAL_KEY_HINTS: Record<string, string[]> = {
  "fish oil": ["fish_oil"],
  phosphorus: ["phosphorus"],
  "3 pyridinecarboxamide": ["nicotinamide", "niacinamide"],
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const readMissing = async (): Promise<MissingPayload | null> => {
  try {
    const raw = await readFile(missingFile, "utf8");
    return JSON.parse(raw) as MissingPayload;
  } catch {
    return null;
  }
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const buildCases = async (): Promise<CanaryCase[]> => {
  const missing = await readMissing();
  const wanted = nameKeysArg
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const cases: CanaryCase[] = [];

  for (const nameKey of wanted) {
    const entry =
      missing?.topMissing?.find((item) => item.nameKey === nameKey) ?? null;
    const nameRaw = entry?.nameRawSamples?.[0] ?? nameKey;
    const sourceId = entry?.sourceIdSamples?.[0] ?? "";
    if (!sourceId) {
      console.warn(
        `[identity-canary] missing sourceId sample for ${nameKey} (check ${missingFile})`,
      );
    }
    cases.push({
      nameKey,
      nameRaw,
      sourceId,
      expectedCanonicalKeys: CANONICAL_KEY_HINTS[nameKey] ?? [],
    });
  }

  return cases;
};

const fetchIngredientsByCanonicalKey = async (
  keys: string[],
): Promise<IngredientRow[]> => {
  if (!keys.length) return [];
  const { data, error } = await supabase
    .from("ingredients")
    .select("id,name,canonical_key")
    .in("canonical_key", keys);
  if (error) throw error;
  return (data ?? []) as IngredientRow[];
};

const fetchSynonymMatches = async (
  nameRaw: string,
  nameKey: string,
): Promise<SynonymRow[]> => {
  const variants = Array.from(new Set([nameRaw, nameKey])).filter(Boolean);
  const matches: SynonymRow[] = [];
  for (const variant of variants) {
    const { data, error } = await supabase
      .from("ingredient_synonyms")
      .select("ingredient_id,synonym")
      .ilike("synonym", variant)
      .limit(5);
    if (error) throw error;
    matches.push(...((data ?? []) as SynonymRow[]));
  }
  return matches;
};

const resolveViaRpc = async (query: string) => {
  const { data, error } = await supabase.rpc("resolve_ingredient_lookup", {
    query_text: query,
  });
  if (error) {
    return { error: error.message ?? "rpc_error" };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row
    ? {
        ingredient_id: row.ingredient_id ?? null,
        match_method: row.match_method ?? null,
        match_confidence: row.match_confidence ?? null,
      }
    : null;
};

const resolveViaExact = async (nameRaw: string) => {
  const { data, error } = await supabase
    .from("ingredients")
    .select("id,name,canonical_key")
    .ilike("name", nameRaw)
    .maybeSingle();
  if (error) return null;
  return data as IngredientRow | null;
};

const resolveViaSynonym = async (nameRaw: string) => {
  const { data, error } = await supabase
    .from("ingredient_synonyms")
    .select("ingredient_id,synonym")
    .ilike("synonym", nameRaw)
    .maybeSingle();
  if (error || !data?.ingredient_id) return null;
  const { data: ingredient, error: ingredientError } = await supabase
    .from("ingredients")
    .select("id,name,canonical_key")
    .eq("id", data.ingredient_id)
    .maybeSingle();
  if (ingredientError) return null;
  return ingredient as IngredientRow | null;
};

const fetchProductIngredientRows = async (
  sourceId: string,
  nameKey: string,
) => {
  if (!sourceId) return [];
  const normalizedKey = normalizeNameKey(nameKey);

  const baseQuery = supabase
    .from("product_ingredients")
    .select(
      "id,source_id,canonical_source_id,name_raw,name_key,ingredient_id,updated_at",
    )
    .eq("source", "lnhpd");

  const { data: bySource, error: bySourceError } = await baseQuery.eq(
    "source_id",
    sourceId,
  );
  if (bySourceError) throw bySourceError;

  const { data: byCanonical, error: byCanonicalError } = await baseQuery.eq(
    "canonical_source_id",
    sourceId,
  );
  if (byCanonicalError) throw byCanonicalError;

  const rows = [...(bySource ?? []), ...(byCanonical ?? [])];
  const deduped = new Map<string, typeof rows[number]>();
  rows.forEach((row) => {
    if (row?.id) deduped.set(row.id as string, row);
  });

  const matches = Array.from(deduped.values()).filter((row) => {
    const rowKey = row.name_key ?? normalizeNameKey(row.name_raw ?? "");
    return rowKey === normalizedKey;
  });

  return {
    totalRows: deduped.size,
    matchedRowsCount: matches.length,
    matchedRows: matches,
  };
};

const run = async () => {
  const cases = await buildCases();
  const results = [];

  for (const item of cases) {
    const expectedKeys = item.expectedCanonicalKeys;
    const ingredients = await fetchIngredientsByCanonicalKey(expectedKeys);
    const synonyms = await fetchSynonymMatches(item.nameRaw, item.nameKey);
    const exact = await resolveViaExact(item.nameRaw);
    const synonymMatch = await resolveViaSynonym(item.nameRaw);
    const rpc = await resolveViaRpc(item.nameRaw);
    const productRows = await fetchProductIngredientRows(
      item.sourceId,
      item.nameKey,
    );

    results.push({
      nameKey: item.nameKey,
      nameRaw: item.nameRaw,
      sourceId: item.sourceId,
      expectedCanonicalKeys: expectedKeys,
      ingredientsFound: ingredients,
      synonymMatches: synonyms,
      resolver: {
        exact,
        synonym: synonymMatch,
        rpc,
      },
      productIngredients: productRows,
    });
  }

  const payload = {
    missingFile,
    generatedAt: new Date().toISOString(),
    cases: results,
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[identity-canary] wrote ${outputPath}`);
};

run().catch((error) => {
  console.error("[identity-canary] failed", error);
  process.exit(1);
});
