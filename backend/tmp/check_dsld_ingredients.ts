import { readFileSync } from "node:fs";
import { supabase } from "../src/supabase.js";

const top = JSON.parse(readFileSync("output/runs/20260128_dsld_phaseD_run1/identity_sprint/ingredient_id_missing_union_topK_v2.json", "utf8"));
const keys = top.topMissing.slice(0, 30).map((x: any) => x.nameKey);
const normalized = keys.map((k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
const unique = Array.from(new Set(normalized));
const canonicalKeys = unique.map((k) => k.replace(/\s+/g, "_"));

const { data, error } = await supabase
  .from("ingredients")
  .select("id,canonical_key,name")
  .in("canonical_key", canonicalKeys);
if (error) throw error;
const map = new Map((data ?? []).map((row: any) => [row.canonical_key, row]));

for (const k of unique) {
  const key = k.replace(/\s+/g, "_");
  const row = map.get(key);
  console.log(k, row ? `MATCH ${row.canonical_key}` : "NO");
}
