import { readFile, writeFile } from "node:fs/promises";

import { supabase } from "../src/supabase.js";

type ScoreRow = {
  source_id: string;
  overall_score: number | null;
  effectiveness_score: number | null;
  safety_score: number | null;
  integrity_score: number | null;
  confidence: number | null;
};

type DeltaRow = {
  sourceId: string;
  overallDelta: number | null;
  effectivenessDelta: number | null;
  safetyDelta: number | null;
  integrityDelta: number | null;
  confidenceDelta: number | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const scoreVersionA = getArg("score-version-a");
const scoreVersionB = getArg("score-version-b");
const output = getArg("output") ?? "score_version_compare.json";
const batchSize = Math.max(1, Number(getArg("batch") ?? "500"));
const topN = Math.max(1, Number(getArg("top-n") ?? "50"));

if (!sourceIdsFile || !scoreVersionA || !scoreVersionB) {
  console.error(
    "[compare-score-versions] missing required args: --source-ids-file --score-version-a --score-version-b",
  );
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

const loadScores = async (ids: string[], scoreVersion: string) => {
  const rows = new Map<string, ScoreRow>();
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from("product_scores")
      .select(
        "source_id,overall_score,effectiveness_score,safety_score,integrity_score,confidence",
      )
      .eq("source", source)
      .eq("score_version", scoreVersion)
      .in("source_id", chunk);
    if (error) {
      throw new Error(`[compare-score-versions] query failed: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      rows.set(row.source_id as string, row as ScoreRow);
    });
  }
  return rows;
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
  if (ids.length === 0) {
    throw new Error(`[compare-score-versions] no ids loaded from ${sourceIdsFile}`);
  }

  const scoresA = await loadScores(ids, scoreVersionA);
  const scoresB = await loadScores(ids, scoreVersionB);

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

  const payload = {
    source,
    scoreVersionA,
    scoreVersionB,
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
    topOverallDeltas: topOverall,
    timestamp: new Date().toISOString(),
  };

  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[compare-score-versions] wrote ${output}`);
};

run().catch((error) => {
  console.error(`[compare-score-versions] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
