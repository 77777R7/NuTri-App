import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ProductIngredientRow = {
  source_id: string | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const startIdRaw = getArg("start-dsld-id");
const limitRaw = getArg("limit");
const requireActive = hasFlag("require-active");
const output = getArg("output") ?? "output/diagnostics/dsld_scoreable_source_ids.json";

const startId = startIdRaw ? Number(startIdRaw) : 1;
const limit = Math.max(1, Number(limitRaw ?? "100000"));

const PAGE_SIZE = 1000;

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const parseNumeric = (value: string): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const main = async () => {
  const unique = new Set<string>();
  const rawIds: string[] = [];

  let cursor: string | null = null; // lexicographic cursor on source_id (text column)
  let pages = 0;
  let rawRows = 0;
  let skippedNonNumeric = 0;
  let skippedBelowStart = 0;
  let maxNumericId: number | null = null;

  while (unique.size < limit) {
    pages += 1;

    const { data, error, status, rayId } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("source_id")
        .eq("source", "dsld")
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);

      if (requireActive) {
        query = query.eq("is_active", true);
      }

      if (cursor) {
        query = query.gt("source_id", cursor);
      }

      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      const msg = meta.message ?? (error instanceof Error ? error.message : String(error));
      throw new Error(
        `[dsld-scoreable-ids] product_ingredients read failed status=${meta.status ?? "?"} ray=${meta.rayId ?? "?"}: ${msg}`,
      );
    }

    const rows = (data ?? []) as ProductIngredientRow[];
    if (rows.length === 0) break;

    rawRows += rows.length;

    for (const row of rows) {
      const id = row.source_id == null ? "" : String(row.source_id).trim();
      if (!id) continue;
      const numeric = parseNumeric(id);
      if (numeric == null) {
        skippedNonNumeric += 1;
        continue;
      }
      if (numeric < startId) {
        skippedBelowStart += 1;
        continue;
      }
      if (!unique.has(id)) {
        unique.add(id);
        rawIds.push(id);
        if (maxNumericId == null || numeric > maxNumericId) maxNumericId = numeric;
        if (unique.size >= limit) break;
      }
    }

    const lastRowId = rows[rows.length - 1]?.source_id;
    cursor = lastRowId == null ? cursor : String(lastRowId);

    if (rows.length < PAGE_SIZE) break;
  }

  // Stable numeric ordering for downstream splits/windows.
  const sourceIds = Array.from(unique).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
  });

  const payload = {
    source: "dsld",
    pool: requireActive ? "product_ingredients_active" : "product_ingredients",
    startId,
    limit,
    count: sourceIds.length,
    lastId: maxNumericId,
    pages,
    rawRows,
    skippedNonNumeric,
    skippedBelowStart,
    timestamp: new Date().toISOString(),
    sourceIds,
  };

  await ensureDir(output);
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify(payload, null, 2));
};

await main();

