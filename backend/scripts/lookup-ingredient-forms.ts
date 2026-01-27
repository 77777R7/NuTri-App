import { supabase } from "../src/supabase.js";

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.error("Usage: npx tsx scripts/lookup-ingredient-forms.ts <uuid> [uuid...]");
  process.exit(1);
}

const run = async () => {
  const { data, error } = await supabase
    .from("ingredient_forms")
    .select("ingredient_id,form_key,form_label,audit_status")
    .in("ingredient_id", ids);
  if (error) throw error;
  console.log(JSON.stringify(data ?? [], null, 2));
};

run().catch((err) => {
  console.error("[lookup-forms] failed:", err);
  process.exit(1);
});
