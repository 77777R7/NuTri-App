import { readFile, writeFile } from "node:fs/promises";

import { supabase } from "../src/supabase.js";

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const input = getArg("input");
const output = getArg("output");
const invalidOutput = getArg("invalid-output");
const requireIngredients =
  hasFlag("require-ingredients") || hasFlag("require-product-ingredients");

if (!input || !output) {
  console.error(
    "[filter-source-ids-lnhpd-facts-exist] usage: --input <json> --output <json> [--invalid-output <json>]",
  );
  process.exit(1);
}

const normalizeIds = (value: unknown): string[] => {
  const parsed =
    Array.isArray(value)
      ? value
      : Array.isArray((value as { sourceIds?: unknown })?.sourceIds)
        ? (value as { sourceIds?: unknown }).sourceIds
        : Array.isArray((value as { lnhpdIds?: unknown })?.lnhpdIds)
          ? (value as { lnhpdIds?: unknown }).lnhpdIds
          : Array.isArray((value as { ids?: unknown })?.ids)
            ? (value as { ids?: unknown }).ids
            : [];
  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseNumber = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveLnhpdTables = async (): Promise<string[]> => {
  const { data, error } = await supabase
    .from("lnhpd_facts_complete")
    .select("lnhpd_id")
    .limit(1);
  if (!error && data) {
    return ["lnhpd_facts_complete", "lnhpd_facts"];
  }
  return ["lnhpd_facts"];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const run = async () => {
  const raw = await readFile(input, "utf8");
  const parsed = JSON.parse(raw);
  const ids = normalizeIds(parsed);
  if (!ids.length) {
    console.error(`[filter-source-ids-lnhpd-facts-exist] no ids found in ${input}`);
    await writeFile(output, JSON.stringify([], null, 2), "utf8");
    if (invalidOutput) {
      await writeFile(invalidOutput, JSON.stringify([], null, 2), "utf8");
    }
    return;
  }

  const tables = await resolveLnhpdTables();
  const numericIds = ids
    .map((id) => ({ id, numeric: parseNumber(id) }))
    .filter((item) => item.numeric != null);
  const stringIds = ids;

  const found = new Set<string>();

  for (const table of tables) {
    const numericChunks = chunk(numericIds.map((item) => item.numeric as number), 500);
    for (const group of numericChunks) {
      const { data, error } = await supabase
        .from(table)
        .select("lnhpd_id")
        .in("lnhpd_id", group);
      if (error) {
        throw new Error(`[filter-source-ids-lnhpd-facts-exist] ${table} query failed: ${error.message}`);
      }
      (data ?? []).forEach((row: { lnhpd_id?: number | null }) => {
        if (row?.lnhpd_id != null) found.add(String(row.lnhpd_id));
      });
    }

    const stringChunks = chunk(stringIds, 500);
    for (const group of stringChunks) {
      const { data, error } = await supabase
        .from(table)
        .select("npn")
        .in("npn", group);
      if (error) {
        throw new Error(`[filter-source-ids-lnhpd-facts-exist] ${table} query failed: ${error.message}`);
      }
      (data ?? []).forEach((row: { npn?: string | null }) => {
        if (row?.npn) found.add(row.npn.trim());
      });
    }
  }

  let valid = ids.filter((id) => found.has(id));
  let invalid = ids.filter((id) => !found.has(id));

  if (requireIngredients && valid.length) {
    const ingredientFound = new Set<string>();
    const ingredientChunkSize = 100;
    const ingredientChunks = chunk(valid, ingredientChunkSize);
    for (const group of ingredientChunks) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id")
        .eq("source", "lnhpd")
        .in("source_id", group);
      if (error) {
        throw new Error(
          `[filter-source-ids-lnhpd-facts-exist] product_ingredients query failed: ${error.message}`,
        );
      }
      (data ?? []).forEach((row: { source_id?: string | null; canonical_source_id?: string | null }) => {
        if (row?.source_id) ingredientFound.add(row.source_id.trim());
        if (row?.canonical_source_id) ingredientFound.add(row.canonical_source_id.trim());
      });
    }

    const canonicalChunks = chunk(valid, ingredientChunkSize);
    for (const group of canonicalChunks) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id")
        .eq("source", "lnhpd")
        .in("canonical_source_id", group);
      if (error) {
        throw new Error(
          `[filter-source-ids-lnhpd-facts-exist] product_ingredients canonical query failed: ${error.message}`,
        );
      }
      (data ?? []).forEach((row: { source_id?: string | null; canonical_source_id?: string | null }) => {
        if (row?.source_id) ingredientFound.add(row.source_id.trim());
        if (row?.canonical_source_id) ingredientFound.add(row.canonical_source_id.trim());
      });
    }

    const validAfterIngredients = valid.filter((id) => ingredientFound.has(id));
    const invalidAfterIngredients = valid.filter((id) => !ingredientFound.has(id));
    valid = validAfterIngredients;
    invalid = invalid.concat(invalidAfterIngredients);
  }

  await writeFile(output, JSON.stringify(valid, null, 2), "utf8");
  if (invalidOutput) {
    await writeFile(invalidOutput, JSON.stringify(invalid, null, 2), "utf8");
  }

  console.log(
    `[filter-source-ids-lnhpd-facts-exist] tables=${tables.join(",")} input=${ids.length} valid=${valid.length} invalid=${invalid.length} requireIngredients=${requireIngredients}`,
  );
};

run().catch((error) => {
  console.error(
    `[filter-source-ids-lnhpd-facts-exist] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
