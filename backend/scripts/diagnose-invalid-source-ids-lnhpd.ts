import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const input = getArg("input") ?? getArg("source-ids-file");
const outputDir = getArg("output-dir") ?? "output/diagnostics/invalid_source_ids";

if (!input) {
  console.error("[diagnose-invalid-source-ids] missing --input/--source-ids-file");
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

const ensureDir = async (dir: string) => {
  await mkdir(dir, { recursive: true });
};

const run = async () => {
  const raw = await readFile(input, "utf8");
  const parsed = JSON.parse(raw);
  const ids = normalizeIds(parsed);
  if (!ids.length) {
    throw new Error(`[diagnose-invalid-source-ids] no ids found in ${input}`);
  }

  await ensureDir(outputDir);

  const tables = await resolveLnhpdTables();
  const numericIds = ids
    .map((id) => ({ id, numeric: parseNumber(id) }))
    .filter((item) => item.numeric != null);
  const stringIds = ids;

  const factsFound = new Set<string>();

  for (const table of tables) {
    for (const group of chunk(numericIds.map((item) => item.numeric as number), 500)) {
      const { data, error } = await supabase.from(table).select("lnhpd_id").in("lnhpd_id", group);
      if (error) {
        throw new Error(`[diagnose-invalid-source-ids] ${table} query failed: ${error.message}`);
      }
      (data ?? []).forEach((row: { lnhpd_id?: number | null }) => {
        if (row?.lnhpd_id != null) factsFound.add(String(row.lnhpd_id));
      });
    }

    for (const group of chunk(stringIds, 500)) {
      const { data, error } = await supabase.from(table).select("npn").in("npn", group);
      if (error) {
        throw new Error(`[diagnose-invalid-source-ids] ${table} query failed: ${error.message}`);
      }
      (data ?? []).forEach((row: { npn?: string | null }) => {
        if (row?.npn) factsFound.add(row.npn.trim());
      });
    }
  }

  const missingFacts = ids.filter((id) => !factsFound.has(id));
  const idsWithFacts = ids.filter((id) => factsFound.has(id));

  const ingredientStats = new Map<string, { total: number; active: number }>();
  const idSet = new Set(idsWithFacts);
  const isNumericId = (value: string) => /^\d+$/.test(value) && String(Number(value)) === value;
  const addRow = (row: { source_id?: string | null; canonical_source_id?: string | number | null; is_active?: boolean | null }) => {
    const keys = [row.source_id, row.canonical_source_id]
      .map((value) => (value == null ? null : String(value).trim()))
      .filter((value): value is string => Boolean(value));
    keys.forEach((key) => {
      if (!idSet.has(key)) return;
      const current = ingredientStats.get(key) ?? { total: 0, active: 0 };
      current.total += 1;
      if (row.is_active) current.active += 1;
      ingredientStats.set(key, current);
    });
  };
  const ingredientChunkSize = 100;
  for (const group of chunk(idsWithFacts, ingredientChunkSize)) {
    const numericIds = group.filter(isNumericId).map((value) => Number(value));
    const stringIds = group;
    const queryByColumn = async (column: "source_id" | "canonical_source_id", values: unknown[]) => {
      if (!values.length) return;
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,is_active")
        .eq("source", "lnhpd")
        .in(column, values);
      if (error) {
        throw new Error(
          `[diagnose-invalid-source-ids] product_ingredients ${column} query failed: ${error.message}`,
        );
      }
      (data ?? []).forEach((row) => addRow(row as any));
    };

    await queryByColumn("source_id", stringIds);
    await queryByColumn("canonical_source_id", stringIds);
    await queryByColumn("source_id", numericIds);
    await queryByColumn("canonical_source_id", numericIds);
  }

  const missingIngredients: string[] = [];
  const emptyIngredients: string[] = [];
  const validIds: string[] = [];
  const otherInvalid: string[] = [];

  idsWithFacts.forEach((id) => {
    const stats = ingredientStats.get(id);
    if (!stats) {
      missingIngredients.push(id);
      return;
    }
    if (stats.active === 0) {
      emptyIngredients.push(id);
      return;
    }
    validIds.push(id);
  });

  const breakdown = {
    inputCount: ids.length,
    factsTables: tables,
    missingFacts: missingFacts.length,
    missingIngredients: missingIngredients.length,
    emptyIngredients: emptyIngredients.length,
    otherInvalid: otherInvalid.length,
    valid: validIds.length,
  };

  await writeFile(
    path.join(outputDir, "invalid_breakdown.json"),
    JSON.stringify(breakdown, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "invalid_missing_facts.json"),
    JSON.stringify(missingFacts, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "invalid_missing_ingredients.json"),
    JSON.stringify(missingIngredients, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "invalid_empty_ingredients.json"),
    JSON.stringify(emptyIngredients, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "invalid_other.json"),
    JSON.stringify(otherInvalid, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "valid_ids.json"),
    JSON.stringify(validIds, null, 2),
    "utf8",
  );

  console.log(JSON.stringify(breakdown, null, 2));
};

run().catch((error) => {
  console.error(
    `[diagnose-invalid-source-ids] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
