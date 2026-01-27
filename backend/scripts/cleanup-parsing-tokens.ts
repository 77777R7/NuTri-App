import { supabase } from "../src/supabase.js";

const TOKENS = [
  "chelate",
  "chelated",
  "glycinate",
  "bisglycinate",
];

const run = async () => {
  const normalized = TOKENS.map((token) => token.toLowerCase());

  const { error: aliasError } = await supabase
    .from("token_aliases")
    .delete()
    .in("token_normalized", normalized)
    .is("ingredient_id", null);
  if (aliasError) throw aliasError;

  const { error: genericError } = await supabase
    .from("generic_form_tokens")
    .delete()
    .in("token_normalized", normalized);
  if (genericError) throw genericError;

  console.log(
    JSON.stringify(
      {
        removedTokens: normalized,
        tables: ["token_aliases", "generic_form_tokens"],
      },
      null,
      2,
    ),
  );
};

run().catch((err) => {
  console.error("[cleanup-parsing-tokens] failed:", err);
  process.exit(1);
});
