import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type LnhpdRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const startIdRaw = getArg("start-lnhpd-id");
const limitRaw = getArg("limit");
const OUTPUT = getArg("output") ?? "output/diagnostics/lnhpd_source_ids.json";

const START_ID = startIdRaw ? Number(startIdRaw) : null;
const LIMIT = Math.max(1, Number(limitRaw ?? "1000"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeSourceId = (row: LnhpdRow): string | null => {
  const npn = typeof row.npn === "string" ? row.npn.trim() : "";
  if (npn) return npn;
  if (row.lnhpd_id == null) return null;
  return String(row.lnhpd_id);
};

const run = async () => {
  if (!START_ID || !Number.isFinite(START_ID)) {
    throw new Error("[lnhpd-source-ids] --start-lnhpd-id is required");
  }

  const fetchRows = async (table: string): Promise<LnhpdRow[]> => {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from(table)
        .select("lnhpd_id,npn")
        .order("lnhpd_id", { ascending: true })
        .gte("lnhpd_id", START_ID)
        .limit(LIMIT),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      const errorMessage =
        meta.message ?? (error instanceof Error ? error.message : String(error));
      throw new Error(`[lnhpd-source-ids] query failed: ${errorMessage}`);
    }
    return (data ?? []) as LnhpdRow[];
  };

  let rows = await fetchRows("lnhpd_facts_complete");
  if (!rows?.length) {
    rows = await fetchRows("lnhpd_facts");
  }

  const sourceIds: string[] = [];
  const lnhpdIds: string[] = [];
  rows.forEach((row) => {
    if (row.lnhpd_id == null) return;
    const sourceId = normalizeSourceId(row);
    if (!sourceId) return;
    lnhpdIds.push(String(row.lnhpd_id));
    sourceIds.push(sourceId);
  });

  const lastId = rows.length
    ? Number(rows[rows.length - 1]?.lnhpd_id ?? null) || null
    : null;

  const payload = {
    source: "lnhpd",
    startId: START_ID,
    limit: LIMIT,
    count: sourceIds.length,
    lastId,
    sourceIds,
    lnhpdIds,
    timestamp: new Date().toISOString(),
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error("[lnhpd-source-ids] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
