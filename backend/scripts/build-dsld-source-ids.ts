import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type DsldRow = {
  dsld_label_id: number | string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const startIdRaw = getArg("start-dsld-id");
const limitRaw = getArg("limit");
const OUTPUT = getArg("output") ?? "output/diagnostics/dsld_source_ids.json";

const START_ID = startIdRaw ? Number(startIdRaw) : null;
const LIMIT = Math.max(1, Number(limitRaw ?? "1000"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeSourceId = (row: DsldRow): string | null => {
  if (row.dsld_label_id == null) return null;
  return String(row.dsld_label_id);
};

const PAGE_SIZE = 1000;

const fetchRowsPage = async (
  table: string,
  startId: number,
  pageLimit: number,
): Promise<DsldRow[]> => {
  const { data, error, status, rayId } = await withRetry(() =>
    supabase
      .from(table)
      .select("dsld_label_id")
      .order("dsld_label_id", { ascending: true })
      .gte("dsld_label_id", startId)
      .limit(pageLimit),
  );
  if (error) {
    const meta = extractErrorMeta(error, status, rayId ?? null);
    const errorMessage =
      meta.message ?? (error instanceof Error ? error.message : String(error));
    throw new Error(`[dsld-source-ids] query failed: ${errorMessage}`);
  }
  return (data ?? []) as DsldRow[];
};

const fetchRows = async (table: string): Promise<DsldRow[]> => {
  const rows: DsldRow[] = [];
  let remaining = LIMIT;
  let cursor = START_ID;

  while (remaining > 0 && cursor != null) {
    const pageLimit = Math.min(PAGE_SIZE, remaining);
    const page = await fetchRowsPage(table, cursor, pageLimit);
    if (!page.length) break;
    rows.push(...page);

    const lastId = page[page.length - 1]?.dsld_label_id;
    if (lastId == null) break;
    const lastNumeric = Number(lastId);
    if (!Number.isFinite(lastNumeric)) break;
    cursor = lastNumeric + 1;
    remaining -= page.length;

    if (page.length < pageLimit) break;
  }

  return rows;
};

const run = async () => {
  if (!START_ID || !Number.isFinite(START_ID)) {
    throw new Error("[dsld-source-ids] --start-dsld-id is required");
  }

  const rows = await fetchRows("dsld_label_facts");

  const sourceIds: string[] = [];
  const dsldLabelIds: string[] = [];
  rows.forEach((row) => {
    if (row.dsld_label_id == null) return;
    const sourceId = normalizeSourceId(row);
    if (!sourceId) return;
    dsldLabelIds.push(String(row.dsld_label_id));
    sourceIds.push(sourceId);
  });

  const lastId = rows.length
    ? Number(rows[rows.length - 1]?.dsld_label_id ?? null) || null
    : null;

  const payload = {
    source: "dsld",
    startId: START_ID,
    limit: LIMIT,
    count: sourceIds.length,
    lastId,
    sourceIds,
    dsldLabelIds,
    timestamp: new Date().toISOString(),
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error("[dsld-source-ids] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
