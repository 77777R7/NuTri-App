import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type ScoreRow = {
  source_id: string;
  canonical_source_id: string | null;
  score_version: string;
  overall_score: number | null;
  effectiveness_score: number | null;
  safety_score: number | null;
  integrity_score: number | null;
  confidence: number | null;
  inputs_hash: string | null;
  computed_at: string | null;
  flags_json: unknown;
  highlights_json: unknown;
  explain_json: unknown;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const table = getArg("table") ?? "product_scores";
const scoreVersion = getArg("score-version");
const output = getArg("output") ?? "product_scores_export.jsonl";
const batchSize = Math.max(1, Number(getArg("batch") ?? "500"));

if (!sourceIdsFile) {
  console.error("[export-product-scores] missing --source-ids-file");
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

const run = async () => {
  const ids = await readIds(sourceIdsFile);
  if (!ids.length) {
    throw new Error(`[export-product-scores] no ids loaded from ${sourceIdsFile}`);
  }

  const lines: string[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    let query = supabase
      .from(table)
      .select(
        "source_id,canonical_source_id,score_version,overall_score,effectiveness_score,safety_score,integrity_score,confidence,inputs_hash,computed_at,flags_json,highlights_json,explain_json",
      )
      .eq("source", source)
      .in("source_id", chunk);
    if (scoreVersion) {
      query = query.eq("score_version", scoreVersion);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`[export-product-scores] query failed: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      lines.push(JSON.stringify(row));
    });
  }

  const outDir = path.dirname(output);
  if (outDir && outDir !== ".") {
    await writeFile(outDir + "/.keep", "", "utf8").catch(() => {});
  }
  await writeFile(output, lines.join("\n") + "\n", "utf8");
  console.log(`[export-product-scores] wrote ${output} (${lines.length} rows)`);
};

run().catch((error) => {
  console.error(`[export-product-scores] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
