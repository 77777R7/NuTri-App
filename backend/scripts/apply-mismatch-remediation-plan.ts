import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanFormRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
};

type PlanAliasRow = {
  ingredient_id: string;
  alias_text: string;
  alias_norm: string;
  form_key: string;
};

type PlanReviewRow = {
  ingredient_id: string;
  candidate_normalized: string;
  reason: string;
};

type PlanFile = {
  source?: string;
  forms?: PlanFormRow[];
  aliases?: PlanAliasRow[];
  review_queue?: PlanReviewRow[];
};

type InsertedFormRow = {
  id: string;
  ingredient_id: string;
  form_key: string;
};

type InsertedAliasRow = {
  id: string;
  ingredient_id: string | null;
  alias_norm: string | null;
  form_key: string;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((arg) => arg.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sqlLiteral = (value: unknown): string => {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const planPath = getArg("plan");
if (!planPath) {
  console.error("[mismatch-apply] --plan is required");
  process.exit(1);
}

const apply = hasFlag("apply");
const outDir = getArg("out-dir") ?? path.dirname(path.resolve(planPath));
const summaryPath = getArg("summary") ?? path.join(outDir, "mismatch_apply_summary.json");
const rollbackPath = getArg("rollback") ?? path.join(outDir, "rollback.sql");

const buildRollbackSql = (forms: InsertedFormRow[], aliases: InsertedAliasRow[]): string => {
  const lines: string[] = [
    "-- Rollback for apply-mismatch-remediation-plan",
    `-- generated_at=${new Date().toISOString()}`,
    "BEGIN;",
  ];

  for (const row of aliases) {
    lines.push(
      `DELETE FROM ingredient_form_aliases WHERE id = ${sqlLiteral(row.id)};`,
    );
  }
  for (const row of forms) {
    lines.push(
      `DELETE FROM ingredient_forms WHERE id = ${sqlLiteral(row.id)};`,
    );
  }

  lines.push("COMMIT;");
  lines.push("");
  return lines.join("\n");
};

const fetchExistingForms = async (rows: PlanFormRow[]): Promise<Set<string>> => {
  const existing = new Set<string>();
  const ingredientIds = Array.from(new Set(rows.map((row) => row.ingredient_id)));
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key")
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      const ingredientId = (row as { ingredient_id?: string }).ingredient_id ?? "";
      const formKey = normalizeText((row as { form_key?: string }).form_key ?? "");
      if (!ingredientId || !formKey) return;
      existing.add(`${ingredientId}\u0001${formKey}`);
    });
  }
  return existing;
};

const fetchExistingScopedAliases = async (rows: PlanAliasRow[]): Promise<Set<string>> => {
  const existing = new Set<string>();
  const ingredientIds = Array.from(new Set(rows.map((row) => row.ingredient_id)));
  const aliasNorms = Array.from(new Set(rows.map((row) => normalizeText(row.alias_norm))));
  if (!ingredientIds.length || !aliasNorms.length) return existing;

  for (const ingredientChunk of chunkArray(ingredientIds, 100)) {
    for (const normChunk of chunkArray(aliasNorms, 100)) {
      const { data, error } = await supabase
        .from("ingredient_form_aliases")
        .select("ingredient_id,alias_norm,form_key")
        .in("ingredient_id", ingredientChunk)
        .in("alias_norm", normChunk);
      if (error) throw error;
      (data ?? []).forEach((row) => {
        const ingredientId = (row as { ingredient_id?: string | null }).ingredient_id ?? "";
        const aliasNorm = normalizeText((row as { alias_norm?: string | null }).alias_norm ?? "");
        const formKey = normalizeText((row as { form_key?: string }).form_key ?? "");
        if (!ingredientId || !aliasNorm || !formKey) return;
        existing.add(`${ingredientId}\u0001${aliasNorm}\u0001${formKey}`);
      });
    }
  }

  return existing;
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const plan = JSON.parse(raw) as PlanFile;
  const formRows = (plan.forms ?? []).filter(
    (row) => row.ingredient_id && row.form_key && row.form_label,
  );
  const aliasRows = (plan.aliases ?? []).filter(
    (row) =>
      row.ingredient_id &&
      row.alias_text &&
      row.alias_norm &&
      row.form_key,
  );
  const reviewQueue = plan.review_queue ?? [];

  const scopedAliasOnly = aliasRows.filter((row) => Boolean(row.ingredient_id));
  if (scopedAliasOnly.length !== aliasRows.length) {
    throw new Error("[mismatch-apply] alias plan contains non-scoped rows");
  }

  const existingForms = await fetchExistingForms(formRows);
  const formsToInsert = formRows.filter((row) => {
    const key = `${row.ingredient_id}\u0001${normalizeText(row.form_key)}`;
    return !existingForms.has(key);
  });

  const existingScopedAliases = await fetchExistingScopedAliases(scopedAliasOnly);
  const aliasesToInsert = scopedAliasOnly.filter((row) => {
    const key = `${row.ingredient_id}\u0001${normalizeText(row.alias_norm)}\u0001${normalizeText(row.form_key)}`;
    return !existingScopedAliases.has(key);
  });

  const insertedForms: InsertedFormRow[] = [];
  const insertedAliases: InsertedAliasRow[] = [];

  if (apply) {
    for (const chunk of chunkArray(formsToInsert, 200)) {
      const payload = chunk.map((row) => ({
        ingredient_id: row.ingredient_id,
        form_key: normalizeText(row.form_key),
        form_label: row.form_label.trim(),
        relative_factor: 1,
        confidence: 0.85,
        evidence_grade: "D",
        audit_status: "verified",
      }));
      const { data, error } = await supabase
        .from("ingredient_forms")
        .insert(payload)
        .select("id,ingredient_id,form_key");
      if (error) throw error;
      insertedForms.push(...((data ?? []) as InsertedFormRow[]));
    }

    for (const chunk of chunkArray(aliasesToInsert, 200)) {
      const payload = chunk.map((row) => ({
        ingredient_id: row.ingredient_id,
        alias_text: row.alias_text.trim(),
        alias_norm: normalizeText(row.alias_norm),
        form_key: normalizeText(row.form_key),
        confidence: 0.8,
        audit_status: "verified",
        source: "mismatch_remediation",
      }));
      const { data, error } = await supabase
        .from("ingredient_form_aliases")
        .insert(payload)
        .select("id,ingredient_id,alias_norm,form_key");
      if (error) throw error;
      insertedAliases.push(...((data ?? []) as InsertedAliasRow[]));
    }
  }

  const rollbackSql = buildRollbackSql(insertedForms, insertedAliases);
  await ensureDir(rollbackPath);
  await writeFile(rollbackPath, rollbackSql, "utf8");

  const summary = {
    source: plan.source ?? null,
    plan: path.resolve(planPath),
    apply,
    generatedAt: new Date().toISOString(),
    rules: {
      scope: "ingredient_id_scoped_only",
      formKeyPriorityOverAlias: true,
    },
    counts: {
      formsInPlan: formRows.length,
      aliasesInPlan: aliasRows.length,
      reviewQueue: reviewQueue.length,
      formsToInsert: formsToInsert.length,
      aliasesToInsert: aliasesToInsert.length,
      insertedForms: insertedForms.length,
      insertedAliases: insertedAliases.length,
    },
    touchedIngredientIds: Array.from(
      new Set([...formsToInsert.map((row) => row.ingredient_id), ...aliasesToInsert.map((row) => row.ingredient_id)]),
    ).sort(),
    rollbackSql: path.resolve(rollbackPath),
    review_queue_preview: reviewQueue.slice(0, 50),
  };

  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[mismatch-apply] wrote ${summaryPath}`);
};

run().catch((error) => {
  console.error(
    "[mismatch-apply] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
