import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PatchIngredient = {
  ingredient_id?: string;
};

type PatchPayload = {
  ingredients?: PatchIngredient[];
};

type IngredientRow = {
  id: string;
  canonical_key: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const formsPatch = getArg("forms") ?? "output/runs/phaseD/forms_promotion_patch.json";
const evidencePatch = getArg("evidence") ?? "output/runs/phaseD/evidence_promotion_patch.json";
const output =
  getArg("output") ??
  "output/ingredient-forms/promotion_rebackfill_source_ids.json";
const summary =
  getArg("summary") ??
  "output/ingredient-forms/promotion_rebackfill_summary.json";

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readPatchIngredients = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as PatchPayload;
  const items = Array.isArray(payload.ingredients) ? payload.ingredients : [];
  return items
    .map((item) => item.ingredient_id?.trim() ?? "")
    .filter((value) => value.length > 0);
};

const run = async () => {
  const ingredientKeys = new Set<string>();
  for (const key of await readPatchIngredients(formsPatch)) ingredientKeys.add(key);
  for (const key of await readPatchIngredients(evidencePatch)) ingredientKeys.add(key);

  const keys = Array.from(ingredientKeys);
  if (!keys.length) {
    throw new Error("[promotion-rebackfill] no ingredient keys found in patches");
  }

  const ingredientIds = new Set<string>();
  for (const group of chunk(keys, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,canonical_key")
      .in("canonical_key", group);
    if (error) {
      throw new Error(`[promotion-rebackfill] ingredient lookup failed: ${error.message}`);
    }
    (data ?? []).forEach((row: IngredientRow) => {
      if (row?.id) ingredientIds.add(row.id);
    });
  }

  if (!ingredientIds.size) {
    throw new Error("[promotion-rebackfill] no ingredient ids resolved from canonical keys");
  }

  const sourceIds = new Set<string>();
  for (const group of chunk(Array.from(ingredientIds), 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,canonical_source_id")
      .eq("source", "lnhpd")
      .in("ingredient_id", group);
    if (error) {
      throw new Error(`[promotion-rebackfill] product_ingredients lookup failed: ${error.message}`);
    }
    (data ?? []).forEach((row: { source_id?: string | null; canonical_source_id?: string | null }) => {
      const canonical = row.canonical_source_id?.trim();
      if (canonical) sourceIds.add(canonical);
      else if (row.source_id) sourceIds.add(row.source_id.trim());
    });
  }

  const payload = {
    source: "lnhpd",
    ingredientKeys: keys,
    ingredientKeyCount: keys.length,
    ingredientIds: Array.from(ingredientIds),
    ingredientIdCount: ingredientIds.size,
    sourceIds: Array.from(sourceIds),
    sourceIdCount: sourceIds.size,
    timestamp: new Date().toISOString(),
  };

  const summaryPayload = {
    source: "lnhpd",
    formsPatch,
    evidencePatch,
    ingredientKeyCount: keys.length,
    ingredientIdCount: ingredientIds.size,
    sourceIdCount: sourceIds.size,
    timestamp: payload.timestamp,
  };

  await ensureDir(output);
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  await ensureDir(summary);
  await writeFile(summary, JSON.stringify(summaryPayload, null, 2), "utf8");
  console.log(`[promotion-rebackfill] sourceIds=${sourceIds.size} output=${output}`);
};

run().catch((error) => {
  console.error("[promotion-rebackfill] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
