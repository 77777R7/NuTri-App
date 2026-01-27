import { supabase } from "../src/supabase.js";

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.error("Usage: npx tsx scripts/lookup-ingredient-ids.ts <uuid> [uuid...]");
  process.exit(1);
}

const run = async () => {
  const { data, error } = await supabase
    .from("ingredients")
    .select("id,name,canonical_key,unit")
    .in("id", ids);
  if (error) throw error;
  console.log(JSON.stringify(data ?? [], null, 2));
};

run().catch((err) => {
  console.error("[lookup] failed:", err);
  process.exit(1);
});
