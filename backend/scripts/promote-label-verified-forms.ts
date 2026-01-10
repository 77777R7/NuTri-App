import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type IngredientFormRow = {
  id: string;
  ingredient_id: string;
  form_key: string;
  form_label: string;
  audit_status: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const source = (getArg("source") ?? "lnhpd").toLowerCase();
const apply = hasFlag("apply");
const limit = Math.max(1, Number(getArg("limit") ?? "5000"));
const output =
  getArg("output") ??
  "output/ingredient-forms/label_verified_forms_rebackfill.jsonl";

const LABEL_VERIFIED_TOKENS = new Set([
  "root",
  "leaf",
  "seed",
  "flower",
  "bark",
  "stem",
  "whole",
  "plant",
  "fruit",
  "berry",
  "peel",
  "extract",
  "powder",
  "std",
  "standardized",
  "fresh",
  "dry",
  "herb",
]);

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isLabelVerifiedFormKey = (formKey: string): boolean => {
  const normalized = normalizeText(formKey);
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((token) => {
    if (!token || token.length <= 1) return false;
    if (/^\d+$/.test(token)) return false;
    return LABEL_VERIFIED_TOKENS.has(token);
  });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const fetchDerivedForms = async (): Promise<IngredientFormRow[]> => {
  const rows: IngredientFormRow[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (rows.length < limit) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("id,ingredient_id,form_key,form_label,audit_status")
      .eq("audit_status", "derived")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as IngredientFormRow[];
    if (!batch.length) break;
    rows.push(...batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }
  return rows.slice(0, limit);
};

const buildRebackfillRunlist = async (
  ingredientIds: string[],
): Promise<Array<{ source: string; sourceId: string }>> => {
  const result = new Map<string, { source: string; sourceId: string }>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source,source_id")
      .eq("source", source)
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
      stage: "label_verified_forms",
      status: null,
      rayId: null,
      message: null,
    }),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const run = async () => {
  if (source !== "lnhpd") {
    throw new Error("[label-verified] only lnhpd source is supported for now");
  }

  const derivedForms = await fetchDerivedForms();
  const candidates = derivedForms.filter((row) => isLabelVerifiedFormKey(row.form_key));

  if (!apply) {
    console.log(
      `[label-verified] dry-run: derived=${derivedForms.length} candidates=${candidates.length}`,
    );
    return;
  }

  if (!candidates.length) {
    console.log("[label-verified] no candidate forms to promote");
    await ensureDir(output);
    await writeRebackfillFile(output, []);
    return;
  }

  const candidateIds = candidates.map((row) => row.id);
  for (const chunk of chunkArray(candidateIds, 200)) {
    const { error } = await supabase
      .from("ingredient_forms")
      .update({
        audit_status: "verified",
        evidence_grade: "D",
        confidence: 0.7,
        relative_factor: 1,
      })
      .in("id", chunk);
    if (error) throw error;
  }

  const ingredientIds = Array.from(new Set(candidates.map((row) => row.ingredient_id)));
  const rebackfillItems = await buildRebackfillRunlist(ingredientIds);
  await ensureDir(output);
  await writeRebackfillFile(output, rebackfillItems);

  const summary = {
    timestamp: new Date().toISOString(),
    source,
    derivedChecked: derivedForms.length,
    promoted: candidates.length,
    rebackfillTargets: rebackfillItems.length,
    rebackfillOutput: output,
  };
  const summaryPath = path.join(path.dirname(output), "label_verified_forms_summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[label-verified] promoted=${candidates.length} rebackfillTargets=${rebackfillItems.length} summary=${summaryPath}`,
  );
};

run().catch((error) => {
  console.error("[label-verified] failed:", error);
  process.exit(1);
});
