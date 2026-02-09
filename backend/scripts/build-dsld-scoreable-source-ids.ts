import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type IngredientRow = {
  source_id: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const startIdRaw = getArg("start-dsld-id");
const limitRaw = getArg("limit");
const outputPath =
  getArg("output") ?? "output/diagnostics/dsld_scoreable_source_ids.json";

const START_ID = startIdRaw ? Number(startIdRaw) : 1;
const LIMIT = Math.max(1, Number(limitRaw ?? "1000"));

// Defaults chosen to match our scale gates:
// - `--require-active` ensures each id has at least one active ingredient row
//   so scores-only coverage and missing/mismatch denominators are meaningful.
const REQUIRE_ACTIVE = hasFlag("require-active") || !hasFlag("include-inactive");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeId = (value: unknown): string | null => {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str;
};

const isNumericId = (value: string): boolean => /^\d+$/.test(value);

const sortIdsStableNumericFirst = (ids: string[]): string[] =>
  [...ids].sort((a, b) => {
    const aNum = Number(a);
    const bNum = Number(b);
    const aIsNum = Number.isFinite(aNum) && String(aNum) === a;
    const bIsNum = Number.isFinite(bNum) && String(bNum) === b;
    if (aIsNum && bIsNum) return aNum - bNum;
    if (aIsNum) return -1;
    if (bIsNum) return 1;
    return a.localeCompare(b);
  });

const PAGE_SIZE = 10_000;

const fetchPage = async (cursor: string | null, pageSize: number): Promise<IngredientRow[]> => {
  let query = supabase
    .from("product_ingredients")
    .select("source_id")
    .eq("source", "dsld")
    .order("source_id", { ascending: true });

  if (REQUIRE_ACTIVE) query = query.eq("is_active", true);
  if (cursor) query = query.gt("source_id", cursor);

  const { data, error, status, rayId } = await withRetry(() =>
    query.limit(pageSize),
  );

  if (error) {
    const meta = extractErrorMeta(error, status, rayId ?? null);
    const message =
      meta.message ?? (error instanceof Error ? error.message : String(error));
    throw new Error(`[dsld-scoreable-ids] query failed: ${message}`);
  }

  return (data ?? []) as IngredientRow[];
};

const run = async () => {
  if (!Number.isFinite(START_ID) || START_ID <= 0) {
    throw new Error("[dsld-scoreable-ids] --start-dsld-id must be a positive number");
  }

  const seen = new Set<string>();
  const collected: string[] = [];

  // Use keyset pagination on (text) source_id for efficient scanning. We'll
  // still filter/sort numerically client-side to keep output stable.
  let cursor: string | null = null;
  let pages = 0;
  let rawRows = 0;
  let skippedNonNumeric = 0;
  let skippedBelowStart = 0;

  while (collected.length < LIMIT) {
    pages += 1;
    const page = await fetchPage(cursor, PAGE_SIZE);
    if (!page.length) break;
    rawRows += page.length;

    for (const row of page) {
      const sourceId = normalizeId(row.source_id);
      if (!sourceId) continue;
      if (!isNumericId(sourceId)) {
        skippedNonNumeric += 1;
        continue;
      }
      const numeric = Number(sourceId);
      if (!Number.isFinite(numeric) || numeric < START_ID) {
        skippedBelowStart += 1;
        continue;
      }
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      collected.push(sourceId);
      if (collected.length >= LIMIT) break;
    }

    cursor = normalizeId(page[page.length - 1]?.source_id);
    if (!cursor) break;
  }

  const sorted = sortIdsStableNumericFirst(collected);
  const lastId = sorted.length ? Number(sorted[sorted.length - 1]) : null;

  const payload = {
    source: "dsld",
    pool: REQUIRE_ACTIVE ? "product_ingredients_active" : "product_ingredients_any",
    startId: START_ID,
    limit: LIMIT,
    count: sorted.length,
    lastId,
    pages,
    rawRows,
    skippedNonNumeric,
    skippedBelowStart,
    timestamp: new Date().toISOString(),
    sourceIds: sorted,
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        output: outputPath,
        source: payload.source,
        pool: payload.pool,
        startId: payload.startId,
        limit: payload.limit,
        count: payload.count,
        firstId: payload.sourceIds[0] ?? null,
        lastId: payload.sourceIds[payload.sourceIds.length - 1] ?? null,
        pages: payload.pages,
        rawRows: payload.rawRows,
        skippedNonNumeric: payload.skippedNonNumeric,
        skippedBelowStart: payload.skippedBelowStart,
        timestamp: payload.timestamp,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(
    "[dsld-scoreable-ids] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});

