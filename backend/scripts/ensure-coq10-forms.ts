import { supabase } from "../src/supabase.js";

const COQ10_CANONICAL_KEY = "coenzyme_q10";
const COQ10_NAME_FALLBACK = "%coenzyme%q10%";

const normalizeAlias = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const loadCoq10IngredientId = async (): Promise<string> => {
  const { data: canonicalRow, error: canonicalError } = await supabase
    .from("ingredients")
    .select("id,canonical_key,name")
    .eq("canonical_key", COQ10_CANONICAL_KEY)
    .maybeSingle();
  if (canonicalError) throw canonicalError;
  if (canonicalRow?.id) return canonicalRow.id as string;

  const { data: nameRow, error: nameError } = await supabase
    .from("ingredients")
    .select("id,canonical_key,name")
    .ilike("name", COQ10_NAME_FALLBACK)
    .limit(1)
    .maybeSingle();
  if (nameError) throw nameError;
  if (nameRow?.id) return nameRow.id as string;

  throw new Error("CoQ10 ingredient not found (canonical_key or name).");
};

const run = async () => {
  const ingredientId = await loadCoq10IngredientId();

  const { data: existingForms, error: formsError } = await supabase
    .from("ingredient_forms")
    .select("form_key")
    .eq("ingredient_id", ingredientId);
  if (formsError) throw formsError;
  const existingFormKeys = new Set(
    (existingForms ?? []).map((row) => String(row?.form_key ?? "")),
  );

  const desiredForms = [
    { form_key: "ubiquinone", form_label: "Ubiquinone" },
    { form_key: "ubiquinol", form_label: "Ubiquinol" },
  ];

  const missingForms = desiredForms.filter((form) => !existingFormKeys.has(form.form_key));
  if (missingForms.length) {
    const { error: insertError } = await supabase.from("ingredient_forms").insert(
      missingForms.map((form) => ({
        ingredient_id: ingredientId,
        form_key: form.form_key,
        form_label: form.form_label,
        relative_factor: 1,
        confidence: 0.7,
        evidence_grade: "D",
        audit_status: "verified",
      })),
    );
    if (insertError) throw insertError;
  }

  const { data: existingAliases, error: aliasError } = await supabase
    .from("ingredient_form_aliases")
    .select("alias_norm,form_key")
    .eq("ingredient_id", ingredientId);
  if (aliasError) throw aliasError;
  const aliasKeySet = new Set(
    (existingAliases ?? []).map((row) => {
      const aliasNorm = normalizeAlias(String(row?.alias_norm ?? ""));
      const formKey = String(row?.form_key ?? "");
      return `${aliasNorm}:${formKey}`;
    }),
  );

  const desiredAliases = [
    { alias_text: "coq10", form_key: "ubiquinone" },
    { alias_text: "coenzyme q10", form_key: "ubiquinone" },
    { alias_text: "ubidecarenone", form_key: "ubiquinone" },
    { alias_text: "ubiquinol", form_key: "ubiquinol" },
  ];

  const missingAliases = desiredAliases.filter((alias) => {
    const norm = normalizeAlias(alias.alias_text);
    return norm && !aliasKeySet.has(`${norm}:${alias.form_key}`);
  });

  if (missingAliases.length) {
    const { error: insertError } = await supabase.from("ingredient_form_aliases").insert(
      missingAliases.map((alias) => ({
        alias_text: alias.alias_text,
        alias_norm: normalizeAlias(alias.alias_text),
        form_key: alias.form_key,
        ingredient_id: ingredientId,
        confidence: 0.7,
        audit_status: "verified",
        source: "label_verified",
      })),
    );
    if (insertError) throw insertError;
  }

  console.log(
    JSON.stringify(
      {
        ingredientId,
        formsInserted: missingForms.length,
        aliasesInserted: missingAliases.length,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
