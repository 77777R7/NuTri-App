import { readFileSync, writeFileSync } from "node:fs";
import { supabase } from "../src/supabase.js";

const patchPath = "output/runs/20260128_dsld_phaseD_run1/identity_sprint/identity_top120_import_patch_v5.json";
const outPath = "output/runs/20260128_dsld_phaseD_run1/identity_sprint/rebackfill_ids_5kA5kB_v5.json";

const patch = JSON.parse(readFileSync(patchPath, "utf8"));
const synonyms: string[] = [];
for (const ing of patch.ingredients ?? []) {
  if (ing.ingredient) synonyms.push(ing.ingredient);
  for (const syn of ing.synonyms ?? []) synonyms.push(syn);
}
const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const nameKeys = Array.from(new Set(synonyms.map(normalize).filter(Boolean)));

const chunks: string[][] = [];
for (let i = 0; i < nameKeys.length; i += 200) chunks.push(nameKeys.slice(i, i + 200));

const sourceIds = new Set<string>();
for (const chunk of chunks) {
  const { data, error } = await supabase
    .from("product_ingredients")
    .select("source_id")
    .eq("source", "dsld")
    .in("name_key", chunk);
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.source_id) sourceIds.add(String(row.source_id));
  }
}

const output = Array.from(sourceIds);
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`[rebackfill-ids] nameKeys=${nameKeys.length} sourceIds=${output.length} -> ${outPath}`);
