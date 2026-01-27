import { readFile } from "node:fs/promises";

import { supabase } from "../src/supabase.js";

type PatchIngredient = {
  ingredient_id?: string | null;
  forms?: { form_key?: string | null }[];
  evidence_by_goal?: { goal?: string | null }[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const formsPath = getArg("forms");
const evidencePath = getArg("evidence");
const dryRun = hasFlag("dry-run");

if (!formsPath && !evidencePath) {
  console.error(
    "[demote-verified-promotions] usage: --forms <json> --evidence <json> [--dry-run]",
  );
  process.exit(1);
}

const readPatch = async (path: string | null): Promise<PatchIngredient[]> => {
  if (!path) return [];
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.ingredients)) return [];
  return parsed.ingredients as PatchIngredient[];
};

const run = async () => {
  const formsPatch = await readPatch(formsPath);
  const evidencePatch = await readPatch(evidencePath);

  const canonicalKeys = new Set<string>();
  const formPairs: Array<{ canonicalKey: string; formKey: string }> = [];
  const evidencePairs: Array<{ canonicalKey: string; goal: string }> = [];

  for (const entry of formsPatch) {
    const canonicalKey = entry.ingredient_id?.trim();
    if (!canonicalKey) continue;
    canonicalKeys.add(canonicalKey);
    (entry.forms ?? []).forEach((form) => {
      const formKey = form?.form_key?.trim();
      if (!formKey) return;
      formPairs.push({ canonicalKey, formKey });
    });
  }

  for (const entry of evidencePatch) {
    const canonicalKey = entry.ingredient_id?.trim();
    if (!canonicalKey) continue;
    canonicalKeys.add(canonicalKey);
    (entry.evidence_by_goal ?? []).forEach((evidence) => {
      const goal = evidence?.goal?.trim();
      if (!goal) return;
      evidencePairs.push({ canonicalKey, goal });
    });
  }

  if (!canonicalKeys.size) {
    console.log("[demote-verified-promotions] no canonical keys found.");
    return;
  }

  const { data, error } = await supabase
    .from("ingredients")
    .select("id,canonical_key")
    .in("canonical_key", Array.from(canonicalKeys));
  if (error) throw new Error(`[demote-verified-promotions] ingredient lookup failed: ${error.message}`);
  const idMap = new Map<string, string>();
  (data ?? []).forEach((row: { id: string; canonical_key: string }) => {
    idMap.set(row.canonical_key, row.id);
  });

  const resolvedForms = formPairs
    .map((pair) => {
      const ingredientId = idMap.get(pair.canonicalKey);
      if (!ingredientId) return null;
      return { ingredientId, formKey: pair.formKey };
    })
    .filter(Boolean) as Array<{ ingredientId: string; formKey: string }>;

  const resolvedEvidence = evidencePairs
    .map((pair) => {
      const ingredientId = idMap.get(pair.canonicalKey);
      if (!ingredientId) return null;
      return { ingredientId, goal: pair.goal };
    })
    .filter(Boolean) as Array<{ ingredientId: string; goal: string }>;

  console.log(
    `[demote-verified-promotions] forms=${resolvedForms.length} evidence=${resolvedEvidence.length} dryRun=${dryRun}`,
  );

  if (dryRun) return;

  for (const entry of resolvedForms) {
    const { error: updateError } = await supabase
      .from("ingredient_forms")
      .update({ audit_status: "needs_review" })
      .eq("ingredient_id", entry.ingredientId)
      .eq("form_key", entry.formKey);
    if (updateError) {
      throw new Error(
        `[demote-verified-promotions] form demotion failed for ${entry.ingredientId} ${entry.formKey}: ${updateError.message}`,
      );
    }
  }

  for (const entry of resolvedEvidence) {
    const { error: updateError } = await supabase
      .from("ingredient_evidence")
      .update({ audit_status: "needs_review" })
      .eq("ingredient_id", entry.ingredientId)
      .eq("goal", entry.goal);
    if (updateError) {
      throw new Error(
        `[demote-verified-promotions] evidence demotion failed for ${entry.ingredientId} ${entry.goal}: ${updateError.message}`,
      );
    }
  }
};

run().catch((error) => {
  console.error(
    `[demote-verified-promotions] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
