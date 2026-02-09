import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ScoreSource = "dsld" | "lnhpd";

type InvalidSourceRow = {
  source: string | null;
  source_id: string | null;
  reason: string | null;
  created_at: string | null;
};

type DsldFactsRow = {
  dsld_label_id: number | null;
  facts_json: unknown | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const SOURCE = (getArg("source") ?? "dsld").toLowerCase() as ScoreSource;
const SOURCE_IDS_FILE = getArg("source-ids-file");
const SCORES_TABLE = getArg("scores-table") ?? "product_scores";
const OUTPUT_VALID_IDS = getArg("output-valid-ids");
const OUTPUT_SKIPPED_IDS = getArg("output-skipped-ids");
const OUTPUT_SKIPPED_REASONS = getArg("output-skipped-reasons");
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "500"));
const DSLD_REQUIRE_NONEMPTY_FACTS = hasFlag("dsld-require-nonempty-facts");
const MIN_UPDATED_AT_RAW = getArg("min-updated-at");
const MIN_UPDATED_AT = MIN_UPDATED_AT_RAW ? new Date(MIN_UPDATED_AT_RAW) : null;

const ensureDirForFile = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeId = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const ids = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as any).sourceIds))
      ? (parsed as any).sourceIds
      : parsed;
  if (!Array.isArray(ids)) {
    throw new Error(
      `[valid-pool] --source-ids-file must be a JSON array or { sourceIds: [] }: ${filePath}`,
    );
  }
  return ids
    .map((value) => normalizeId(value))
    .filter((value): value is string => Boolean(value));
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const sortIdsStable = (ids: string[]): string[] =>
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

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/;|•/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const extractDsldFactsSummary = (factsJson: unknown): { empty: boolean; activeCount: number; inactiveCount: number; blendCount: number } => {
  if (!factsJson || typeof factsJson !== "object") {
    return { empty: true, activeCount: 0, inactiveCount: 0, blendCount: 0 };
  }
  const record = factsJson as Record<string, unknown>;
  const activesRaw = Array.isArray(record.actives) ? record.actives : [];
  const actives = activesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as any).name === "string" ? String((item as any).name).trim() : "";
      return name ? name : null;
    })
    .filter(Boolean);
  const inactive = normalizeStringList(record.inactive);
  const blendsRaw = Array.isArray(record.proprietaryBlends) ? record.proprietaryBlends : [];
  const blends = blendsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as any).name === "string" ? String((item as any).name).trim() : "";
      return name ? name : null;
    })
    .filter(Boolean);
  const empty = actives.length === 0 && inactive.length === 0 && blends.length === 0;
  return { empty, activeCount: actives.length, inactiveCount: inactive.length, blendCount: blends.length };
};

type ScoreMetaRow = { source_id: string | null; updated_at?: string | null };

type ScoreMetaRowWithVersion = ScoreMetaRow & { score_version?: string | null };

const SCORE_VERSION = getArg("score-version");

const loadScoreMeta = async (source: ScoreSource, ids: string[]): Promise<Map<string, ScoreMetaRowWithVersion>> => {
  const present = new Map<string, ScoreMetaRowWithVersion>();
  for (const chunk of chunkArray(ids, CHUNK_SIZE)) {
    let query = supabase
      .from(SCORES_TABLE)
      .select("source_id,updated_at,score_version")
      .eq("source", source)
      .in("source_id", chunk);
    if (SCORE_VERSION) {
      query = query.eq("score_version", SCORE_VERSION);
    }
    const { data, error } = await withRetry<ScoreMetaRowWithVersion[]>(() => query);
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[valid-pool] ${SCORES_TABLE} query failed: ${meta.message ?? "unknown error"}`);
    }
    (data ?? []).forEach((row) => {
      if (row?.source_id) present.set(String(row.source_id), row);
    });
  }
  return present;
};

const loadInvalidReasons = async (
  source: ScoreSource,
  ids: string[],
): Promise<Map<string, InvalidSourceRow>> => {
  const map = new Map<string, InvalidSourceRow>();
  if (!ids.length) return map;
  for (const chunk of chunkArray(ids, CHUNK_SIZE)) {
    const { data, error } = await withRetry<InvalidSourceRow[]>(() =>
      supabase
        .from("invalid_source_ids")
        .select("source,source_id,reason,created_at")
        .eq("source", source)
        .in("source_id", chunk),
    );
    if (error) {
      // If the table doesn't exist in some envs, treat as "no reasons" instead of failing.
      const meta = extractErrorMeta(error);
      console.warn(`[valid-pool] invalid_source_ids query failed: ${meta.message ?? "unknown error"}`);
      return map;
    }
    (data ?? []).forEach((row) => {
      const sourceId = row?.source_id ? String(row.source_id) : null;
      if (sourceId) map.set(sourceId, row);
    });
  }
  return map;
};

const loadDsldFactsRows = async (ids: string[]): Promise<Map<string, DsldFactsRow>> => {
  const map = new Map<string, DsldFactsRow>();
  const numericIds = ids
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  for (const chunk of chunkArray(numericIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry<DsldFactsRow[]>(() =>
      supabase
        .from("dsld_label_facts")
        .select("dsld_label_id,facts_json")
        .in("dsld_label_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[valid-pool] dsld_label_facts query failed: ${meta.message ?? "unknown error"}`);
    }
    (data ?? []).forEach((row) => {
      const key = row?.dsld_label_id == null ? null : String(row.dsld_label_id);
      if (!key) return;
      map.set(key, row);
    });
  }
  return map;
};

const run = async () => {
  if (!SOURCE_IDS_FILE) {
    throw new Error("[valid-pool] missing --source-ids-file");
  }
  if (!OUTPUT_VALID_IDS || !OUTPUT_SKIPPED_IDS || !OUTPUT_SKIPPED_REASONS) {
    throw new Error(
      "[valid-pool] required: --output-valid-ids, --output-skipped-ids, --output-skipped-reasons",
    );
  }

  if (MIN_UPDATED_AT_RAW && (MIN_UPDATED_AT == null || Number.isNaN(MIN_UPDATED_AT.getTime()))) {
    throw new Error(`[valid-pool] invalid --min-updated-at: ${MIN_UPDATED_AT_RAW}`);
  }

  const inputIds = await loadSourceIds(SOURCE_IDS_FILE);
  const scoreMeta = await loadScoreMeta(SOURCE, inputIds);

  const isNumericId = (value: string) => /^\d+$/.test(value) && String(Number(value)) === value;
  const numericIds = inputIds.filter(isNumericId);

  const dsldFactsById =
    SOURCE === "dsld" && DSLD_REQUIRE_NONEMPTY_FACTS ? await loadDsldFactsRows(numericIds) : new Map();
  const missingFacts = new Set<string>();
  const emptyFacts = new Set<string>();
  if (SOURCE === "dsld" && DSLD_REQUIRE_NONEMPTY_FACTS) {
    numericIds.forEach((id) => {
      const row = dsldFactsById.get(id);
      if (!row) {
        missingFacts.add(id);
        return;
      }
      const summary = extractDsldFactsSummary(row.facts_json);
      if (summary.empty) emptyFacts.add(id);
    });
  }

  const validIds = inputIds.filter((id) => {
    const meta = scoreMeta.get(id) ?? null;
    if (!meta) return false;
    if (MIN_UPDATED_AT && meta.updated_at) {
      const updatedAt = new Date(meta.updated_at);
      if (Number.isNaN(updatedAt.getTime()) || updatedAt < MIN_UPDATED_AT) return false;
    } else if (MIN_UPDATED_AT && !meta.updated_at) {
      return false;
    }
    if (SOURCE === "dsld" && DSLD_REQUIRE_NONEMPTY_FACTS) {
      if (!isNumericId(id)) return false;
      if (missingFacts.has(id)) return false;
      if (emptyFacts.has(id)) return false;
    }
    return true;
  });

  const validSet = new Set(validIds);
  const skippedIds = inputIds.filter((id) => !validSet.has(id));

  const invalidReasons = await loadInvalidReasons(SOURCE, skippedIds);
  const skippedFactsById =
    SOURCE === "dsld" ? await loadDsldFactsRows(skippedIds.filter((id) => /^\d+$/.test(id))) : new Map();

  const skipped = skippedIds.map((sourceId) => {
    const invalid = invalidReasons.get(sourceId) ?? null;
    if (SOURCE === "dsld") {
      if (!isNumericId(sourceId)) {
        return {
          sourceId,
          reason: invalid?.reason ?? "invalid_label_id",
          invalidRow: invalid,
          facts: null,
        };
      }
      if (invalid?.reason) {
        return { sourceId, reason: invalid.reason, invalidRow: invalid, facts: null };
      }
      if (DSLD_REQUIRE_NONEMPTY_FACTS) {
        if (missingFacts.has(sourceId)) {
          return { sourceId, reason: "facts_not_found", invalidRow: invalid, facts: null };
        }
        const factsRow = dsldFactsById.get(sourceId) ?? null;
        const summary = factsRow ? extractDsldFactsSummary(factsRow.facts_json) : null;
        if (emptyFacts.has(sourceId)) {
          return { sourceId, reason: "empty_label_facts", invalidRow: invalid, facts: summary };
        }
        const meta = scoreMeta.get(sourceId) ?? null;
        if (!meta) {
          return { sourceId, reason: "missing_score_row", invalidRow: invalid, facts: summary };
        }
        if (MIN_UPDATED_AT) {
          const updatedAt = meta.updated_at ? new Date(meta.updated_at) : null;
          if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt < MIN_UPDATED_AT) {
            return {
              sourceId,
              reason: "stale_score_row",
              invalidRow: invalid,
              facts: summary,
              scoreUpdatedAt: meta.updated_at ?? null,
            };
          }
        }
        return { sourceId, reason: "filtered_out", invalidRow: invalid, facts: summary };
      }
      const meta = scoreMeta.get(sourceId) ?? null;
      if (!meta) {
        const factsRow = skippedFactsById.get(sourceId) ?? null;
        const facts = factsRow ? extractDsldFactsSummary(factsRow.facts_json) : null;
        if (facts?.empty) {
          return { sourceId, reason: "empty_label_facts", invalidRow: invalid, facts };
        }
        return { sourceId, reason: "missing_score_row", invalidRow: invalid, facts };
      }
      if (MIN_UPDATED_AT) {
        const updatedAt = meta.updated_at ? new Date(meta.updated_at) : null;
        if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt < MIN_UPDATED_AT) {
          return {
            sourceId,
            reason: "stale_score_row",
            invalidRow: invalid,
            facts: null,
            scoreUpdatedAt: meta.updated_at ?? null,
          };
        }
      }
      return { sourceId, reason: "filtered_out", invalidRow: invalid, facts: null };
    }

    if (invalid?.reason) {
      return { sourceId, reason: invalid.reason, invalidRow: invalid, facts: null };
    }
    const meta = scoreMeta.get(sourceId) ?? null;
    if (!meta) {
      return { sourceId, reason: "missing_score_row", invalidRow: invalid, facts: null };
    }
    if (MIN_UPDATED_AT) {
      const updatedAt = meta.updated_at ? new Date(meta.updated_at) : null;
      if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt < MIN_UPDATED_AT) {
        return {
          sourceId,
          reason: "stale_score_row",
          invalidRow: invalid,
          facts: null,
          scoreUpdatedAt: meta.updated_at ?? null,
        };
      }
    }
    return { sourceId, reason: "filtered_out", invalidRow: invalid, facts: null };
  });

  const payload = {
    source: SOURCE,
    scoresTable: SCORES_TABLE,
    scoreVersion: SCORE_VERSION ?? null,
    sourceIdsFile: SOURCE_IDS_FILE,
    minUpdatedAt: MIN_UPDATED_AT_RAW ?? null,
    inputCount: inputIds.length,
    validCount: validIds.length,
    skippedCount: skippedIds.length,
    generatedAt: new Date().toISOString(),
    skipped,
  };

  const validSorted = sortIdsStable(validIds);
  const skippedSorted = sortIdsStable(skippedIds);

  await ensureDirForFile(OUTPUT_VALID_IDS);
  await ensureDirForFile(OUTPUT_SKIPPED_IDS);
  await ensureDirForFile(OUTPUT_SKIPPED_REASONS);

  await writeFile(OUTPUT_VALID_IDS, JSON.stringify(validSorted, null, 2), "utf8");
  await writeFile(OUTPUT_SKIPPED_IDS, JSON.stringify(skippedSorted, null, 2), "utf8");
  await writeFile(OUTPUT_SKIPPED_REASONS, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        source: SOURCE,
        inputCount: inputIds.length,
        validCount: validIds.length,
        skippedCount: skippedIds.length,
        outputValidIds: OUTPUT_VALID_IDS,
        outputSkippedIds: OUTPUT_SKIPPED_IDS,
        outputSkippedReasons: OUTPUT_SKIPPED_REASONS,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[valid-pool] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
