import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductScoreRow = {
  source_id: string | null;
};

type InvalidSourceIdRow = {
  source: string;
  source_id: string;
  reason: string | null;
  created_at: string | null;
};

type DsldFactsRow = {
  dsld_label_id: number | string | null;
  facts_json: unknown;
};

type FactsCounts = {
  empty: boolean;
  activeCount: number;
  inactiveCount: number;
  blendCount: number;
};

type SkippedReasonCode = "empty_label_facts" | "missing_score_row" | "facts_not_found";

type SkippedEntry = {
  sourceId: string;
  reason: SkippedReasonCode;
  invalidRow: InvalidSourceIdRow | null;
  facts: FactsCounts | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const source = ((getArg("source") ?? "dsld").toLowerCase() as ScoreSource) ?? "dsld";
const scoresTable = getArg("scores-table") ?? "product_scores";
const scoreVersion = getArg("score-version") ?? V4_SCORE_VERSION;
const sourceIdsFile = getArg("source-ids-file");
const minUpdatedAt = getArg("min-updated-at");

const dsldRequireNonemptyFacts = hasFlag("dsld-require-nonempty-facts");

const outputValidIds = getArg("output-valid-ids") ?? "output/valid_ids.json";
const outputSkippedIds = getArg("output-skipped-ids") ?? "output/skipped_ids.json";
const outputSkippedReasons = getArg("output-skipped-reasons") ?? "output/skipped_reasons.json";

if (!sourceIdsFile) {
  throw new Error(`[valid-pool] missing required --source-ids-file`);
}

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const normalizeSourceIdList = (value: unknown): string[] => {
  const parsed =
    Array.isArray(value)
      ? value
      : Array.isArray((value as { sourceIds?: unknown })?.sourceIds)
        ? (value as { sourceIds?: unknown }).sourceIds
        : Array.isArray((value as { lnhpdIds?: unknown })?.lnhpdIds)
          ? (value as { lnhpdIds?: unknown }).lnhpdIds
          : Array.isArray((value as { dsldIds?: unknown })?.dsldIds)
            ? (value as { dsldIds?: unknown }).dsldIds
            : Array.isArray((value as { ids?: unknown })?.ids)
              ? (value as { ids?: unknown }).ids
              : [];

  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `[valid-pool] source-ids-file invalid JSON: ${filePath} (${error instanceof Error ? error.message : "parse error"})`,
    );
  }
  return normalizeSourceIdList(parsed);
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
};

const extractFactsCounts = (factsJson: unknown): FactsCounts => {
  if (!factsJson || typeof factsJson !== "object") {
    return { empty: true, activeCount: 0, inactiveCount: 0, blendCount: 0 };
  }
  const record = factsJson as {
    actives?: unknown;
    inactive?: unknown;
    proprietaryBlends?: unknown;
  };
  const activeCount = Array.isArray(record.actives) ? record.actives.length : 0;
  const inactiveCount = Array.isArray(record.inactive) ? record.inactive.length : 0;
  const blendCount = Array.isArray(record.proprietaryBlends)
    ? record.proprietaryBlends.length
    : 0;
  return {
    empty: activeCount === 0 && inactiveCount === 0 && blendCount === 0,
    activeCount,
    inactiveCount,
    blendCount,
  };
};

const fetchScoreRows = async (sourceIds: string[]): Promise<Set<string>> => {
  const scored = new Set<string>();

  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error, status, rayId } = await withRetry(() => {
      let query = supabase
        .from(scoresTable)
        .select("source_id")
        .eq("source", source)
        .eq("score_version", scoreVersion)
        .in("source_id", chunk)
        .limit(chunk.length);

      if (minUpdatedAt) {
        query = query.gte("computed_at", minUpdatedAt);
      }

      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      const msg = meta.message ?? (error instanceof Error ? error.message : String(error));
      throw new Error(
        `[valid-pool] scores query failed table=${scoresTable} status=${meta.status ?? "?"} ray=${meta.rayId ?? "?"}: ${msg}`,
      );
    }

    ((data ?? []) as ProductScoreRow[]).forEach((row) => {
      const id = row.source_id ? String(row.source_id) : "";
      if (id) scored.add(id);
    });
  }

  return scored;
};

const fetchInvalidRows = async (sourceIds: string[]): Promise<Map<string, InvalidSourceIdRow>> => {
  const map = new Map<string, InvalidSourceIdRow>();
  if (sourceIds.length === 0) return map;

  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("invalid_source_ids")
        .select("source,source_id,reason,created_at")
        .eq("source", source)
        .in("source_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      const msg = meta.message ?? (error instanceof Error ? error.message : String(error));
      console.warn(
        `[valid-pool] invalid_source_ids read failed (non-fatal) status=${meta.status ?? "?"} ray=${meta.rayId ?? "?"}: ${msg}`,
      );
      continue;
    }
    ((data ?? []) as InvalidSourceIdRow[]).forEach((row) => {
      if (!row?.source_id) return;
      map.set(String(row.source_id), row);
    });
  }

  return map;
};

const fetchDsldFacts = async (sourceIds: string[]): Promise<Map<string, FactsCounts | null>> => {
  const map = new Map<string, FactsCounts | null>();
  if (sourceIds.length === 0) return map;

  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("dsld_label_facts")
        .select("dsld_label_id,facts_json")
        .in("dsld_label_id", chunk),
    );

    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      const msg = meta.message ?? (error instanceof Error ? error.message : String(error));
      throw new Error(
        `[valid-pool] dsld_label_facts read failed status=${meta.status ?? "?"} ray=${meta.rayId ?? "?"}: ${msg}`,
      );
    }

    ((data ?? []) as DsldFactsRow[]).forEach((row) => {
      if (row.dsld_label_id == null) return;
      map.set(String(row.dsld_label_id), extractFactsCounts(row.facts_json));
    });
  }

  // Fill in missing ids explicitly so callers can distinguish "missing row".
  sourceIds.forEach((id) => {
    if (!map.has(id)) map.set(id, null);
  });

  return map;
};

const main = async () => {
  const sourceIds = await readSourceIds(sourceIdsFile);
  const inputCount = sourceIds.length;
  if (!inputCount) {
    await writeJson(outputValidIds, []);
    await writeJson(outputSkippedIds, []);
    await writeJson(outputSkippedReasons, {
      source,
      scoresTable,
      scoreVersion,
      sourceIdsFile,
      minUpdatedAt: minUpdatedAt ?? null,
      inputCount: 0,
      validCount: 0,
      skippedCount: 0,
      generatedAt: new Date().toISOString(),
      skipped: [],
    });
    console.log(
      JSON.stringify(
        {
          source,
          inputCount: 0,
          validCount: 0,
          skippedCount: 0,
          outputValidIds,
          outputSkippedIds,
          outputSkippedReasons,
        },
        null,
        2,
      ),
    );
    return;
  }

  const scored = await fetchScoreRows(sourceIds);
  const validIds: string[] = [];
  const skippedIds: string[] = [];

  sourceIds.forEach((id) => {
    if (scored.has(id)) validIds.push(id);
    else skippedIds.push(id);
  });

  const invalidMap = await fetchInvalidRows(skippedIds);
  const factsMap =
    source === "dsld" && dsldRequireNonemptyFacts ? await fetchDsldFacts(skippedIds) : new Map();

  const skipped: SkippedEntry[] = skippedIds.map((id) => {
    const invalidRow = invalidMap.get(id) ?? null;
    const facts = (factsMap.get(id) ?? null) as FactsCounts | null;

    if (source === "dsld" && dsldRequireNonemptyFacts) {
      if (facts == null) {
        return { sourceId: id, reason: "facts_not_found", invalidRow, facts: null };
      }
      return {
        sourceId: id,
        reason: facts.empty ? "empty_label_facts" : "missing_score_row",
        invalidRow,
        facts,
      };
    }

    return { sourceId: id, reason: "missing_score_row", invalidRow, facts: null };
  });

  await writeJson(outputValidIds, validIds);
  await writeJson(outputSkippedIds, skippedIds);
  await writeJson(outputSkippedReasons, {
    source,
    scoresTable,
    scoreVersion,
    sourceIdsFile,
    minUpdatedAt: minUpdatedAt ?? null,
    inputCount,
    validCount: validIds.length,
    skippedCount: skippedIds.length,
    generatedAt: new Date().toISOString(),
    skipped,
  });

  console.log(
    JSON.stringify(
      {
        source,
        inputCount,
        validCount: validIds.length,
        skippedCount: skippedIds.length,
        outputValidIds,
        outputSkippedIds,
        outputSkippedReasons,
      },
      null,
      2,
    ),
  );
};

await main();

