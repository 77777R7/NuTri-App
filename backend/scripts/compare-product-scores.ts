import { readFile, writeFile } from "node:fs/promises";

import { supabase } from "../src/supabase.js";
import { computeV4FactsHashFromRows } from "../src/scoring/v4ScoreEngine.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ScoreRow = {
  source_id: string;
  overall_score: number | null;
  effectiveness_score: number | null;
  safety_score: number | null;
  integrity_score: number | null;
  confidence: number | null;
  explain_json?: unknown;
  flags_json?: unknown;
};

type DeltaRow = {
  sourceId: string;
  overallDelta: number | null;
  effectivenessDelta: number | null;
  safetyDelta: number | null;
  integrityDelta: number | null;
  confidenceDelta: number | null;
};

type IngredientFactsRow = {
  source_id: string;
  name_raw: string;
  name_key: string | null;
  ingredient_id: string | null;
  amount: number | null;
  unit: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  unit_kind: string | null;
  amount_unknown: boolean | null;
  parse_confidence: number | null;
  is_active: boolean | null;
  is_proprietary_blend: boolean | null;
  basis: string | null;
  form_raw: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const tableA = getArg("table-a") ?? "product_scores";
const tableB = getArg("table-b") ?? "product_scores_shadow";
const scoreVersionA = getArg("score-version-a");
const scoreVersionB = getArg("score-version-b");
const output = getArg("output") ?? "product_scores_compare.json";
const batchSize = Math.max(1, Number(getArg("batch") ?? "500"));
const topN = Math.max(1, Number(getArg("top-n") ?? "50"));
const outliersGt20Path = getArg("outliers-gt20-jsonl");
const outliersGt10Path = getArg("outliers-gt10-jsonl");
const includeExplainDiff = hasFlag("include-explain-diff");
const checkFactsHash = hasFlag("check-facts-hash");
const factsHashFromIngredients = hasFlag("facts-hash-from-ingredients");
const factsHashMismatchPath = getArg("facts-hash-mismatch-jsonl");
const factsHashBreakdownPath = getArg("facts-hash-breakdown-json");

if (!sourceIdsFile) {
  console.error("[compare-product-scores] missing --source-ids-file");
  process.exit(1);
}

const readIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const ids = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sourceIds)
      ? parsed.sourceIds
      : Array.isArray(parsed?.lnhpdIds)
        ? parsed.lnhpdIds
        : Array.isArray(parsed?.dsldIds)
          ? parsed.dsldIds
          : Array.isArray(parsed?.ids)
            ? parsed.ids
            : [];
  return ids
    .filter((item: unknown): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const loadScores = async (ids: string[], table: string, scoreVersion?: string | null) => {
  const rows = new Map<string, ScoreRow>();
  const factsChunkSize = Math.min(batchSize, 100);
  for (let i = 0; i < ids.length; i += factsChunkSize) {
    const chunk = ids.slice(i, i + factsChunkSize);
    let query = supabase
      .from(table)
      .select(
        "source_id,overall_score,effectiveness_score,safety_score,integrity_score,confidence",
      )
      .eq("source", source)
      .in("source_id", chunk);
    if (scoreVersion) {
      query = query.eq("score_version", scoreVersion);
    }
    const { data, error } = await withRetry(() => query);
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(
        `[compare-product-scores] query failed: ${meta.message ?? "unknown error"} (status=${meta.status ?? "?"} rayId=${meta.rayId ?? "?"})`,
      );
    }
    (data ?? []).forEach((row) => {
      rows.set(row.source_id as string, row as ScoreRow);
    });
  }
  return rows;
};

const loadExplainRows = async (
  ids: string[],
  table: string,
  scoreVersion?: string | null,
) => {
  const rows = new Map<string, ScoreRow>();
  const ingredientChunkSize = Math.min(50, batchSize);
  const factsPageSize = 1000;
  for (let i = 0; i < ids.length; i += ingredientChunkSize) {
    const chunk = ids.slice(i, i + ingredientChunkSize);
    let query = supabase
      .from(table)
      .select("source_id,explain_json,flags_json")
      .eq("source", source)
      .in("source_id", chunk);
    if (scoreVersion) {
      query = query.eq("score_version", scoreVersion);
    }
    const { data, error } = await withRetry(() => query);
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(
        `[compare-product-scores] explain query failed: ${meta.message ?? "unknown error"} (status=${meta.status ?? "?"} rayId=${meta.rayId ?? "?"})`,
      );
    }
    (data ?? []).forEach((row) => {
      if (!row?.source_id) return;
      rows.set(row.source_id as string, row as ScoreRow);
    });
  }
  return rows;
};

const loadIngredientFacts = async (ids: string[]) => {
  const rowsBySourceId = new Map<string, IngredientFactsRow[]>();
  const idSet = new Set(ids);
  const isNumericId = (value: string) => /^\d+$/.test(value) && String(Number(value)) === value;
  const addRow = (row: IngredientFactsRow) => {
    const keys = [row.source_id, (row as any).canonical_source_id]
      .map((value) => (value == null ? null : String(value).trim()))
      .filter((value): value is string => Boolean(value));
    keys.forEach((key) => {
      if (!idSet.has(key)) return;
      const list = rowsBySourceId.get(key) ?? [];
      list.push(row);
      rowsBySourceId.set(key, list);
    });
  };
  const ingredientChunkSize = Math.min(50, batchSize);
  const factsPageSize = 1000;
  for (let i = 0; i < ids.length; i += ingredientChunkSize) {
    const chunk = ids.slice(i, i + ingredientChunkSize);
    const numericIds = chunk.filter(isNumericId).map((value) => Number(value));
    const stringIds = chunk;
    const selectFields =
      "source_id,canonical_source_id,name_raw,name_key,ingredient_id,amount,unit,amount_normalized,unit_normalized,unit_kind,amount_unknown,parse_confidence,is_active,is_proprietary_blend,basis,form_raw";
    const queryByColumn = async (column: "source_id" | "canonical_source_id", values: unknown[]) => {
      if (!values.length) return;
      let offset = 0;
      while (true) {
        const query = supabase
          .from("product_ingredients")
          .select(selectFields)
          .eq("source", source)
          .in(column, values)
          .range(offset, offset + factsPageSize - 1);
        const { data, error } = await withRetry(() => query);
        if (error) {
          const meta = extractErrorMeta(error);
          throw new Error(
            `[compare-product-scores] product_ingredients ${column} query failed: ${meta.message ?? "unknown error"} (status=${meta.status ?? "?"} rayId=${meta.rayId ?? "?"})`,
          );
        }
        const rows = data ?? [];
        rows.forEach((row) => addRow(row as IngredientFactsRow));
        if (rows.length < factsPageSize) break;
        offset += factsPageSize;
      }
    };

    await queryByColumn("source_id", stringIds);
    await queryByColumn("canonical_source_id", stringIds);
    await queryByColumn("source_id", numericIds);
    await queryByColumn("canonical_source_id", numericIds);
  }
  return rowsBySourceId;
};

const extractTriggered = (explain: unknown) => {
  const audit = (explain as any)?.evidence?.audit ?? {};
  const verifiedForms = Array.isArray(audit.verifiedForms)
    ? audit.verifiedForms.map((form: any) => ({
        ingredientId: form?.ingredientId ?? null,
        ingredientName: form?.ingredientName ?? null,
        formKey: form?.formKey ?? null,
        formLabel: form?.formLabel ?? null,
        refIds: form?.refIds ?? [],
        evidenceGrade: form?.evidenceGrade ?? null,
        effectiveFactor: form?.effectiveFactor ?? null,
      }))
    : [];
  const verifiedEvidence = Array.isArray(audit.verifiedEvidence)
    ? audit.verifiedEvidence.map((ev: any) => ({
        ingredientId: ev?.ingredientId ?? null,
        ingredientName: ev?.ingredientName ?? null,
        goal: ev?.goal ?? null,
        refIds: ev?.refIds ?? [],
        evidenceGrade: ev?.evidenceGrade ?? null,
      }))
    : [];
  return { verifiedForms, verifiedEvidence };
};

const extractFactsHash = (explain: unknown): string | null => {
  if (!explain || typeof explain !== "object") return null;
  const direct = (explain as any)?.factsHash;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = (explain as any)?.assumptions?.factsHash;
  return typeof nested === "string" && nested.trim() ? nested : null;
};

const toNumber = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const buildDelta = (a: ScoreRow | undefined, b: ScoreRow | undefined): DeltaRow | null => {
  if (!a || !b) return null;
  return {
    sourceId: a.source_id,
    overallDelta:
      toNumber(b.overall_score) != null && toNumber(a.overall_score) != null
        ? (b.overall_score as number) - (a.overall_score as number)
        : null,
    effectivenessDelta:
      toNumber(b.effectiveness_score) != null && toNumber(a.effectiveness_score) != null
        ? (b.effectiveness_score as number) - (a.effectiveness_score as number)
        : null,
    safetyDelta:
      toNumber(b.safety_score) != null && toNumber(a.safety_score) != null
        ? (b.safety_score as number) - (a.safety_score as number)
        : null,
    integrityDelta:
      toNumber(b.integrity_score) != null && toNumber(a.integrity_score) != null
        ? (b.integrity_score as number) - (a.integrity_score as number)
        : null,
    confidenceDelta:
      toNumber(b.confidence) != null && toNumber(a.confidence) != null
        ? (b.confidence as number) - (a.confidence as number)
        : null,
  };
};

const summarize = (values: number[]) => {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p90: null, p99: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Number(mean.toFixed(4)),
    p50: pick(0.5),
    p90: pick(0.9),
    p99: pick(0.99),
  };
};

const run = async () => {
  const ids = await readIds(sourceIdsFile);
  if (!ids.length) {
    throw new Error(`[compare-product-scores] no ids loaded from ${sourceIdsFile}`);
  }

  const scoresA = await loadScores(ids, tableA, scoreVersionA);
  const scoresB = await loadScores(ids, tableB, scoreVersionB);

  const shouldCheckFactsHash =
    checkFactsHash ||
    Boolean(factsHashMismatchPath) ||
    factsHashFromIngredients ||
    Boolean(factsHashBreakdownPath);
  const explainRowsA = shouldCheckFactsHash
    ? await loadExplainRows(ids, tableA, scoreVersionA)
    : new Map();
  const explainRowsB = shouldCheckFactsHash
    ? await loadExplainRows(ids, tableB, scoreVersionB)
    : new Map();
  const ingredientFacts = factsHashFromIngredients
    ? await loadIngredientFacts(ids)
    : new Map<string, IngredientFactsRow[]>();

  const deltas: DeltaRow[] = [];
  const missingA: string[] = [];
  const missingB: string[] = [];

  ids.forEach((id) => {
    const a = scoresA.get(id);
    const b = scoresB.get(id);
    if (!a) missingA.push(id);
    if (!b) missingB.push(id);
    const delta = buildDelta(a, b);
    if (delta) deltas.push(delta);
  });

  const overallDeltas = deltas
    .map((row) => row.overallDelta)
    .filter((v): v is number => typeof v === "number");

  const confidenceDeltas = deltas
    .map((row) => row.confidenceDelta)
    .filter((v): v is number => typeof v === "number");

  const bigOverall = overallDeltas.filter((v) => Math.abs(v) > 20).length;
  const mediumOverall = overallDeltas.filter((v) => Math.abs(v) > 10).length;

  const topOverall = [...deltas]
    .filter((row) => typeof row.overallDelta === "number")
    .sort((a, b) => Math.abs((b.overallDelta as number) ?? 0) - Math.abs((a.overallDelta as number) ?? 0))
    .slice(0, topN);

  let factsHashMismatchCount = 0;
  let factsHashCompared = 0;
  let factsHashMissingA = 0;
  let factsHashMissingB = 0;
  let factsHashExplainMissingA = 0;
  let factsHashExplainMissingB = 0;
  let factsHashDerivedA = 0;
  let factsHashDerivedB = 0;
  let factsHashMissingIngredients = 0;
  const factsHashMismatches: { sourceId: string; hashA: string; hashB: string }[] = [];

  if (shouldCheckFactsHash) {
    ids.forEach((id) => {
      const aExplain = explainRowsA.get(id)?.explain_json ?? null;
      const bExplain = explainRowsB.get(id)?.explain_json ?? null;
      let hashA = extractFactsHash(aExplain);
      let hashB = extractFactsHash(bExplain);
      if (!hashA) factsHashExplainMissingA += 1;
      if (!hashB) factsHashExplainMissingB += 1;
      if (factsHashFromIngredients) {
        const rows = ingredientFacts.get(id) ?? [];
        if (rows.length === 0) {
          factsHashMissingIngredients += 1;
        } else {
          const derived = computeV4FactsHashFromRows(rows as any);
          hashA = derived;
          hashB = derived;
          factsHashDerivedA += 1;
          factsHashDerivedB += 1;
        }
      } else if (!hashA || !hashB) {
        const rows = ingredientFacts.get(id) ?? [];
        if (rows.length === 0) {
          factsHashMissingIngredients += 1;
        }
        if (!hashA && rows.length > 0) {
          hashA = computeV4FactsHashFromRows(rows as any);
          factsHashDerivedA += 1;
        }
        if (!hashB && rows.length > 0) {
          hashB = computeV4FactsHashFromRows(rows as any);
          factsHashDerivedB += 1;
        }
      }
      if (!hashA) factsHashMissingA += 1;
      if (!hashB) factsHashMissingB += 1;
      if (hashA && hashB) {
        factsHashCompared += 1;
        if (hashA !== hashB) {
          factsHashMismatchCount += 1;
          if (factsHashMismatchPath) {
            factsHashMismatches.push({ sourceId: id, hashA, hashB });
          }
        }
      }
    });
  }

  const payload = {
    source,
    tableA,
    tableB,
    scoreVersionA: scoreVersionA ?? null,
    scoreVersionB: scoreVersionB ?? null,
    sourceIdsFile,
    totalIds: ids.length,
    matchedBoth: deltas.length,
    missingA: missingA.length,
    missingB: missingB.length,
    overallDeltaSummary: summarize(overallDeltas),
    confidenceDeltaSummary: summarize(confidenceDeltas),
    overallDeltaThresholds: {
      gt10: mediumOverall,
      gt20: bigOverall,
      gt10Ratio: overallDeltas.length ? Number((mediumOverall / overallDeltas.length).toFixed(4)) : 0,
      gt20Ratio: overallDeltas.length ? Number((bigOverall / overallDeltas.length).toFixed(4)) : 0,
    },
    factsHash: shouldCheckFactsHash
      ? {
          compared: factsHashCompared,
          mismatches: factsHashMismatchCount,
          mismatchRatio: factsHashCompared
            ? Number((factsHashMismatchCount / factsHashCompared).toFixed(4))
            : 0,
          coverage: ids.length ? Number((factsHashCompared / ids.length).toFixed(4)) : 0,
          missingA: factsHashMissingA,
          missingB: factsHashMissingB,
          explainMissingA: factsHashExplainMissingA,
          explainMissingB: factsHashExplainMissingB,
          derivedA: factsHashDerivedA,
          derivedB: factsHashDerivedB,
          missingIngredients: factsHashMissingIngredients,
        }
      : null,
    topOverallDeltas: topOverall,
    timestamp: new Date().toISOString(),
  };

  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[compare-product-scores] wrote ${output}`);

  if (factsHashMismatchPath && factsHashMismatches.length) {
    await writeFile(
      factsHashMismatchPath,
      factsHashMismatches.map((row) => JSON.stringify(row)).join("\n"),
      "utf8",
    );
    console.log(`[compare-product-scores] wrote ${factsHashMismatchPath}`);
  }

  if (factsHashBreakdownPath && shouldCheckFactsHash) {
    const breakdown = {
      totalIds: ids.length,
      compared: factsHashCompared,
      mismatches: factsHashMismatchCount,
      missingA: factsHashMissingA,
      missingB: factsHashMissingB,
      explainMissingA: factsHashExplainMissingA,
      explainMissingB: factsHashExplainMissingB,
      derivedA: factsHashDerivedA,
      derivedB: factsHashDerivedB,
      missingIngredients: factsHashMissingIngredients,
    };
    await writeFile(factsHashBreakdownPath, JSON.stringify(breakdown, null, 2), "utf8");
    console.log(`[compare-product-scores] wrote ${factsHashBreakdownPath}`);
  }

  if (outliersGt20Path || outliersGt10Path) {
    const outlierGt20 = deltas.filter(
      (row) => typeof row.overallDelta === "number" && Math.abs(row.overallDelta) > 20,
    );
    const outlierGt10 = deltas.filter(
      (row) => typeof row.overallDelta === "number" && Math.abs(row.overallDelta) > 10,
    );

    const outlierIds = Array.from(
      new Set(
        [
          ...(outliersGt20Path ? outlierGt20 : []),
          ...(outliersGt10Path ? outlierGt10 : []),
        ].map((row) => row.sourceId),
      ),
    );

    const explainA = includeExplainDiff
      ? await loadExplainRows(outlierIds, tableA, scoreVersionA)
      : new Map();
    const explainB = includeExplainDiff
      ? await loadExplainRows(outlierIds, tableB, scoreVersionB)
      : new Map();

    const writeOutliers = async (rows: DeltaRow[], path: string) => {
      const lines = rows.map((row) => {
        const base = scoresA.get(row.sourceId);
        const shadow = scoresB.get(row.sourceId);
        const baseExplain = includeExplainDiff ? explainA.get(row.sourceId)?.explain_json : null;
        const shadowExplain = includeExplainDiff ? explainB.get(row.sourceId)?.explain_json : null;
        const baseFlags = includeExplainDiff ? explainA.get(row.sourceId)?.flags_json : null;
        const shadowFlags = includeExplainDiff ? explainB.get(row.sourceId)?.flags_json : null;
        return {
          sourceId: row.sourceId,
          overallDelta: row.overallDelta,
          effectivenessDelta: row.effectivenessDelta,
          safetyDelta: row.safetyDelta,
          integrityDelta: row.integrityDelta,
          confidenceDelta: row.confidenceDelta,
          baseline: base
            ? {
                overall: base.overall_score,
                effectiveness: base.effectiveness_score,
                safety: base.safety_score,
                integrity: base.integrity_score,
                confidence: base.confidence,
              }
            : null,
          shadow: shadow
            ? {
                overall: shadow.overall_score,
                effectiveness: shadow.effectiveness_score,
                safety: shadow.safety_score,
                integrity: shadow.integrity_score,
                confidence: shadow.confidence,
              }
            : null,
          triggered: includeExplainDiff
            ? {
                ...extractTriggered(shadowExplain),
                flags: Array.isArray(shadowFlags) ? shadowFlags : [],
              }
            : null,
          baselineTriggered: includeExplainDiff
            ? {
                ...extractTriggered(baseExplain),
                flags: Array.isArray(baseFlags) ? baseFlags : [],
              }
            : null,
        };
      });
      await writeFile(path, lines.map((row) => JSON.stringify(row)).join("\n"), "utf8");
      console.log(`[compare-product-scores] wrote ${path}`);
    };

    if (outliersGt20Path) {
      await writeOutliers(outlierGt20, outliersGt20Path);
    }
    if (outliersGt10Path) {
      await writeOutliers(outlierGt10, outliersGt10Path);
    }
  }
};

run().catch((error) => {
  console.error(`[compare-product-scores] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
