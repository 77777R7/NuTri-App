import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PatchIngredient = {
  ingredient_id: string;
  ingredient: string;
  synonyms?: string[];
};

type PatchPayload = {
  ingredients?: PatchIngredient[];
};

type ProductIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  name_key: string | null;
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

const patchPath =
  getArg("patch") ??
  "output/ingredient-identity/fish_oil_canonical/identity_top20_import_patch.json";
const outputPath =
  getArg("output") ??
  "output/ingredient-identity/identity_patch_rebackfill_source_ids.json";
const summaryPath =
  getArg("summary") ??
  "output/ingredient-identity/identity_patch_rebackfill_summary.json";
const chunkSize = Math.max(1, Number(getArg("chunk-size") ?? "50"));
const sourceIdsFile = getArg("source-ids-file");
const idColumn = (getArg("id-column") ?? "canonical_source_id").toLowerCase();

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readPatch = async (filePath: string): Promise<PatchIngredient[]> => {
  const raw = await readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as PatchPayload;
  return Array.isArray(payload.ingredients) ? payload.ingredients : [];
};

const buildNameKeys = (records: PatchIngredient[]): string[] => {
  const keys = new Set<string>();
  records.forEach((record) => {
    if (record.ingredient) {
      const normalized = normalizeKey(record.ingredient);
      if (normalized) keys.add(normalized);
    }
    (record.synonyms ?? []).forEach((syn) => {
      const normalized = normalizeKey(syn);
      if (normalized) keys.add(normalized);
    });
  });
  return Array.from(keys);
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { sourceIds?: unknown };
    if (Array.isArray(record.sourceIds)) {
      return record.sourceIds.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
};

const fetchRowsForKeys = async (
  keys: string[],
  sourceIds?: string[],
  sourceColumn?: "source_id" | "canonical_source_id",
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  const nameKeyChunks = chunkArray(keys, chunkSize);

  if (sourceIds && sourceIds.length && sourceColumn) {
    for (const sourceChunk of chunkArray(sourceIds, 200)) {
      for (const keyChunk of nameKeyChunks) {
        const { data, error } = await supabase
          .from("product_ingredients")
          .select("source_id,canonical_source_id,name_key")
          .eq("source", "lnhpd")
          .is("ingredient_id", null)
          .eq("is_active", true)
          .in("name_key", keyChunk)
          .in(sourceColumn, sourceChunk);
        if (error) throw error;
        rows.push(...((data ?? []) as ProductIngredientRow[]));
      }
    }
  } else {
    for (const chunk of nameKeyChunks) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,name_key")
        .eq("source", "lnhpd")
        .is("ingredient_id", null)
        .eq("is_active", true)
        .in("name_key", chunk);
      if (error) throw error;
      rows.push(...((data ?? []) as ProductIngredientRow[]));
    }
  }
  return rows;
};

const run = async () => {
  const records = await readPatch(patchPath);
  if (!records.length) {
    throw new Error(`[identity-rebackfill] no ingredients found in ${patchPath}`);
  }

  const nameKeys = buildNameKeys(records);
  if (!nameKeys.length) {
    throw new Error("[identity-rebackfill] no name keys resolved from patch");
  }

  const sourceIdList = sourceIdsFile ? await readSourceIds(sourceIdsFile) : [];
  const sourceColumn =
    idColumn === "source_id" ? "source_id" : ("canonical_source_id" as const);
  const rows = await fetchRowsForKeys(
    nameKeys,
    sourceIdList.length ? sourceIdList : undefined,
    sourceIdList.length ? sourceColumn : undefined,
  );
  const sourceIds = new Set<string>();
  const countsByKey = new Map<string, number>();

  rows.forEach((row) => {
    const sourceId = row.canonical_source_id ?? row.source_id;
    if (sourceId) sourceIds.add(sourceId);
    const key = row.name_key ?? "";
    if (key) countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
  });

  const payload = {
    source: "lnhpd",
    nameKeyCount: nameKeys.length,
    matchedRows: rows.length,
    uniqueSourceIds: sourceIds.size,
    sourceIds: Array.from(sourceIds),
    timestamp: new Date().toISOString(),
  };

  const summary = {
    source: "lnhpd",
    patch: patchPath,
    nameKeyCount: nameKeys.length,
    matchedRows: rows.length,
    uniqueSourceIds: sourceIds.size,
    sourceIdsFile: sourceIdsFile ?? null,
    idColumn: sourceColumn,
    topNameKeys: Array.from(countsByKey.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([nameKey, count]) => ({ nameKey, count })),
    timestamp: payload.timestamp,
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[identity-rebackfill] nameKeys=${nameKeys.length} matchedRows=${rows.length} sourceIds=${sourceIds.size} output=${outputPath}`,
  );
};

run().catch((error) => {
  console.error("[identity-rebackfill] failed:", error);
  process.exit(1);
});
