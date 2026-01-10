import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanEntry = {
  ingredientId: string;
  canonicalKey: string | null;
  ingredientName: string | null;
  category: string | null;
  unit: string | null;
  count: number;
  recommendedFormKey: string | null;
  recommendedFormLabel: string | null;
};

type PlanFile = {
  source?: string | null;
  generatedAt?: string | null;
  topN?: number | null;
  candidates?: PlanEntry[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const planPath =
  getArg("plan") ?? "output/ingredient-forms/missing-ingredient-forms-plan-lnhpd.json";
const apply = hasFlag("apply");
const source = (getArg("source") ?? "lnhpd").toLowerCase();
const topN = Math.max(1, Number(getArg("top-n") ?? "20"));
const rebackfillOutput =
  getArg("rebackfill-output") ??
  "output/ingredient-forms/ingredient-forms-derived-rebackfill.jsonl";

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

const fetchExistingForms = async (ingredientIds: string[]) => {
  const existing = new Set<string>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key")
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.ingredient_id || !row?.form_key) return;
      existing.add(`${row.ingredient_id}:${row.form_key}`);
    });
  }
  return existing;
};

const buildRebackfillRunlist = async (
  sourceValue: string,
  ingredientIds: string[],
): Promise<Array<{ source: string; sourceId: string }>> => {
  const result = new Map<string, { source: string; sourceId: string }>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source,source_id")
      .eq("source", sourceValue)
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.source_id || !row?.source) return;
      const key = `${row.source}:${row.source_id}`;
      if (!result.has(key)) {
        result.set(key, { source: row.source, sourceId: row.source_id });
      }
    });
  }
  return Array.from(result.values());
};

const writeRebackfillFile = async (
  filePath: string,
  items: Array<{ source: string; sourceId: string }>,
) => {
  if (!items.length) {
    await writeFile(filePath, "", "utf8");
    return;
  }
  const lines = items.map((item) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      source: item.source,
      sourceId: item.sourceId,
      stage: "ingredient_forms_derived",
      status: null,
      rayId: null,
      message: null,
    }),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanFile;
  const candidates = payload.candidates ?? [];
  const applicable = candidates
    .filter((entry) => entry.recommendedFormKey && entry.recommendedFormLabel)
    .slice(0, topN);

  if (!applicable.length) {
    console.log("[ingredient-forms] no candidates with recommended form keys");
    await ensureDir(rebackfillOutput);
    await writeRebackfillFile(rebackfillOutput, []);
    return;
  }

  if (!apply) {
    console.log(
      `[ingredient-forms] dry-run: ${applicable.length} candidates. Use --apply to write.`,
    );
    return;
  }

  const ingredientIds = applicable.map((entry) => entry.ingredientId);
  const existing = await fetchExistingForms(ingredientIds);

  const insertRows = applicable
    .filter((entry) => {
      const formKey = entry.recommendedFormKey ?? "";
      return !existing.has(`${entry.ingredientId}:${formKey}`);
    })
    .map((entry) => ({
      ingredient_id: entry.ingredientId,
      form_key: entry.recommendedFormKey,
      form_label: entry.recommendedFormLabel,
      relative_factor: 1,
      confidence: 0.3,
      evidence_grade: null,
      audit_status: "derived",
    }));

  if (!insertRows.length) {
    console.log("[ingredient-forms] all candidate forms already exist; no inserts");
    await ensureDir(rebackfillOutput);
    await writeRebackfillFile(rebackfillOutput, []);
    return;
  }

  const { error } = await supabase
    .from("ingredient_forms")
    .upsert(insertRows, { onConflict: "ingredient_id,form_key" });
  if (error) {
    throw new Error(`[ingredient-forms] upsert failed: ${error.message}`);
  }

  const rebackfillItems = await buildRebackfillRunlist(source, ingredientIds);
  await ensureDir(rebackfillOutput);
  await writeRebackfillFile(rebackfillOutput, rebackfillItems);

  const summary = {
    timestamp: new Date().toISOString(),
    source,
    plan: planPath,
    appliedCount: insertRows.length,
    candidateCount: applicable.length,
    rebackfillTargets: rebackfillItems.length,
    rebackfillOutput,
  };

  const summaryPath = path.join(path.dirname(rebackfillOutput), "ingredient_forms_derived_summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[ingredient-forms] applied=${insertRows.length} rebackfillTargets=${rebackfillItems.length} summary=${summaryPath}`,
  );
};

run().catch((error) => {
  console.error("[ingredient-forms] failed:", error);
  process.exit(1);
});
