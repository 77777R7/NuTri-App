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

type FormRow = {
  id: string;
  ingredient_id: string;
  form_key: string;
  form_label: string;
  audit_status: string | null;
  evidence_grade: string | null;
  confidence: number | null;
  relative_factor: number | null;
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
  "output/ingredient-forms/forms_promotion_plan_top20.json";

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

const fetchForms = async (ingredientIds: string[]): Promise<FormRow[]> => {
  const rows: FormRow[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select(
        "id,ingredient_id,form_key,form_label,audit_status,evidence_grade,confidence,relative_factor",
      )
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as FormRow[]));
  }
  return rows;
};

const fetchFormCitationCounts = async (formIds: string[]): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const chunk of chunkArray(formIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_citations")
      .select("form_id")
      .in("form_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.form_id) return;
      counts.set(row.form_id, (counts.get(row.form_id) ?? 0) + 1);
    });
  }
  return counts;
};

const run = async () => {
  if (!sourceIdsFile) {
    throw new Error("[forms-promotion] --source-ids-file is required");
  }
  if (!["source_id", "canonical_source_id"].includes(idColumn)) {
    throw new Error(`[forms-promotion] invalid --id-column: ${idColumn}`);
  }

  const sourceIds = await readSourceIds(sourceIdsFile);
  if (!sourceIds.length) {
    throw new Error("[forms-promotion] source ids file is empty");
  }

  const counts = await fetchIngredientCounts(
    sourceIds,
    idColumn as "source_id" | "canonical_source_id",
  );
  const ingredientIds = Array.from(counts.keys());
  if (!ingredientIds.length) {
    throw new Error("[forms-promotion] no ingredient ids found");
  }

  const [metaMap, forms] = await Promise.all([
    fetchIngredientMeta(ingredientIds),
    fetchForms(ingredientIds),
  ]);

  const candidateForms = forms.filter(
    (form) => (form.audit_status ?? "needs_review") !== "verified",
  );

  const citationCounts = await fetchFormCitationCounts(
    candidateForms.map((form) => form.id),
  );

  const ranked = candidateForms
    .map((form) => {
      const meta = metaMap.get(form.ingredient_id);
      const occurrence = counts.get(form.ingredient_id) ?? 0;
      const citations = citationCounts.get(form.id) ?? 0;
      return {
        ingredient_id: form.ingredient_id,
        ingredient_name: meta?.name ?? null,
        canonical_key: meta?.canonical_key ?? null,
        category: meta?.category ?? null,
        unit: meta?.unit ?? null,
        form_id: form.id,
        form_key: form.form_key,
        form_label: form.form_label,
        audit_status: form.audit_status ?? "needs_review",
        evidence_grade: form.evidence_grade ?? null,
        confidence: form.confidence ?? null,
        relative_factor: form.relative_factor ?? null,
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
      return (a.form_key ?? "").localeCompare(b.form_key ?? "");
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
    `[forms-promotion] selected=${selected.length} total=${ranked.length} output=${output}`,
  );
};

run().catch((error) => {
  console.error("[forms-promotion] failed:", error);
  process.exit(1);
});
