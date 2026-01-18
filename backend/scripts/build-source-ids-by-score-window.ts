import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "dsld" | "lnhpd";

type ScoreRow = {
  source_id: string | null;
  computed_at: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE = (getArg("source") ?? "lnhpd").toLowerCase();
const SINCE = getArg("since");
const UNTIL = getArg("until");
const OUTPUT = getArg("output") ?? "output/orchestrator/source_ids_window.json";
const SCORE_VERSION = getArg("score-version") ?? V4_SCORE_VERSION;

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const assertIso = (value: string | null, name: string) => {
  if (!value) throw new Error(`[score-window] --${name} is required`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[score-window] --${name} must be ISO timestamp, got ${value}`);
  }
};

const run = async () => {
  if (SOURCE !== "lnhpd" && SOURCE !== "dsld") {
    throw new Error(`[score-window] invalid --source ${SOURCE}`);
  }
  assertIso(SINCE, "since");
  if (UNTIL) assertIso(UNTIL, "until");

  const source = SOURCE as ScoreSource;
  const sourceIds = new Set<string>();
  let earliest: string | null = null;
  let latest: string | null = null;
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await withRetry(() => {
      let query = supabase
        .from("product_scores")
        .select("source_id,computed_at")
        .eq("source", source)
        .eq("score_version", SCORE_VERSION)
        .gte("computed_at", SINCE!)
        .order("computed_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (UNTIL) query = query.lt("computed_at", UNTIL);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[score-window] query failed: ${meta.message ?? "unknown"}`);
    }

    const rows = (data ?? []) as ScoreRow[];
    if (!rows.length) break;

    rows.forEach((row) => {
      const id = typeof row.source_id === "string" ? row.source_id.trim() : "";
      if (id) sourceIds.add(id);
      if (row.computed_at) {
        if (!earliest || row.computed_at < earliest) earliest = row.computed_at;
        if (!latest || row.computed_at > latest) latest = row.computed_at;
      }
    });

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  const sorted = Array.from(sourceIds.values()).sort();
  const payload = {
    source,
    since: SINCE,
    until: UNTIL ?? null,
    scoreVersion: SCORE_VERSION,
    count: sorted.length,
    earliestComputedAt: earliest,
    latestComputedAt: latest,
    sourceIds: sorted,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, count: sorted.length }, null, 2));
};

run().catch((error) => {
  console.error("[score-window] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
