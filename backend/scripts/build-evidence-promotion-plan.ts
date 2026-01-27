import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type IngredientMeta = {
  id: string;
  name: string | null;
  canonical_key: string | null;
  category: string | null;
  unit: string | null;
};

type EvidenceRow = {
  id: string;
  ingredient_id: string;
  goal: string;
  min_effective_dose: number | null;
  optimal_dose_range: string | null;
  evidence_grade: string | null;
  audit_status: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const idColumn = (getArg("id-column") ?? "source_id").toLowerCase();
const topN = Math.max(1, Number(getArg("top-n") ?? "20"));
const output =
  getArg("output") ??
  "output/ingredient-evidence/evidence_promotion_plan_top20.json";

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

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { sourceIds?: unknown };
    if (Array.isArray(record.sourceIds)) {
      return record.sourceIds.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
};

const fetchIngredientCounts = async (
  sourceIds: string[],
  column: "source_id" | "canonical_source_id",
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("ingredient_id")
      .eq("source", source)
      .eq("is_active", true)
      .not("ingredient_id", "is", null)
      .in(column, chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.ingredient_id) return;
      counts.set(row.ingredient_id, (counts.get(row.ingredient_id) ?? 0) + 1);
    });
  }
  return counts;
};

const fetchIngredientMeta = async (ingredientIds: string[]): Promise<Map<string, IngredientMeta>> => {
  const meta = new Map<string, IngredientMeta>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,name,canonical_key,category,unit")
      .in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      meta.set(row.id, row as IngredientMeta);
    });
  }
  return meta;
};

const fetchEvidence = async (ingredientIds: string[]): Promise<EvidenceRow[]> => {
  const rows: EvidenceRow[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_evidence")
      .select(
        "id,ingredient_id,goal,min_effective_dose,optimal_dose_range,evidence_grade,audit_status",
      )
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as EvidenceRow[]));
  }
  return rows;
};

const fetchEvidenceCitationCounts = async (evidenceIds: string[]): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const chunk of chunkArray(evidenceIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_evidence_citations")
      .select("evidence_id")
      .in("evidence_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.evidence_id) return;
      counts.set(row.evidence_id, (counts.get(row.evidence_id) ?? 0) + 1);
    });
  }
  return counts;
};

const run = async () => {
  if (!sourceIdsFile) {
    throw new Error("[evidence-promotion] --source-ids-file is required");
  }
  if (!["source_id", "canonical_source_id"].includes(idColumn)) {
    throw new Error(`[evidence-promotion] invalid --id-column: ${idColumn}`);
  }

  const sourceIds = await readSourceIds(sourceIdsFile);
  if (!sourceIds.length) {
    throw new Error("[evidence-promotion] source ids file is empty");
  }

  const counts = await fetchIngredientCounts(
    sourceIds,
    idColumn as "source_id" | "canonical_source_id",
  );
  const ingredientIds = Array.from(counts.keys());
  if (!ingredientIds.length) {
    throw new Error("[evidence-promotion] no ingredient ids found");
  }

  const [metaMap, evidenceRows] = await Promise.all([
    fetchIngredientMeta(ingredientIds),
    fetchEvidence(ingredientIds),
  ]);

  const candidates = evidenceRows.filter(
    (row) => (row.audit_status ?? "needs_review") !== "verified",
  );

  const citationCounts = await fetchEvidenceCitationCounts(
    candidates.map((row) => row.id),
  );

  const ranked = candidates
    .map((row) => {
      const meta = metaMap.get(row.ingredient_id);
      const occurrence = counts.get(row.ingredient_id) ?? 0;
      const citations = citationCounts.get(row.id) ?? 0;
      return {
        evidence_id: row.id,
        ingredient_id: row.ingredient_id,
        ingredient_name: meta?.name ?? null,
        canonical_key: meta?.canonical_key ?? null,
        category: meta?.category ?? null,
        unit: meta?.unit ?? null,
        goal: row.goal,
        min_effective_dose: row.min_effective_dose,
        optimal_dose_range: row.optimal_dose_range,
        evidence_grade: row.evidence_grade ?? null,
        audit_status: row.audit_status ?? "needs_review",
        occurrence_count: occurrence,
        citations_count: citations,
        has_citations: citations > 0,
      };
    })
    .sort((a, b) => {
      if (a.has_citations !== b.has_citations) {
        return a.has_citations ? -1 : 1;
      }
      if (b.occurrence_count !== a.occurrence_count) {
        return b.occurrence_count - a.occurrence_count;
      }
      return (a.goal ?? "").localeCompare(b.goal ?? "");
    });

  const selected = ranked.slice(0, topN);
  const summary = {
    source,
    idColumn,
    sourceIdsFile,
    totalCandidates: ranked.length,
    selectedCount: selected.length,
    topN,
    generatedAt: new Date().toISOString(),
  };

  await ensureDir(output);
  await writeFile(
    output,
    JSON.stringify({ summary, candidates: selected }, null, 2),
    "utf8",
  );

  console.log(
    `[evidence-promotion] selected=${selected.length} total=${ranked.length} output=${output}`,
  );
};

run().catch((error) => {
  console.error("[evidence-promotion] failed:", error);
  process.exit(1);
});
