import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type PlanEntry = {
  canonicalName: string;
  canonicalKey?: string | null;
  category?: string | null;
  baseUnit?: string | null;
  synonyms?: string[];
  rawSamples?: string[];
  approved?: boolean;
  excludeReasons?: string[];
  action?: "create" | "synonym_only" | null;
};

type PlanFile = {
  source?: string | null;
  timestamp?: string | null;
  candidates?: PlanEntry[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const planPath =
  getArg("plan") ?? "output/ingredient-resolution/canonical_create_plan.json";
const rebackfillOutput =
  getArg("rebackfill-output") ??
  "output/ingredient-resolution/canonical_create_rebackfill.jsonl";
const apply = hasFlag("apply");
const datasetVersionArg = getArg("dataset-version");
const sourceOverride = getArg("source");

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const nowStamp = () => new Date().toISOString();

const getDatasetVersion = async (): Promise<string | null> => {
  const { data } = await supabase
    .from("scoring_dataset_state")
    .select("version")
    .eq("key", "ingredient_dataset")
    .maybeSingle();
  const value = data?.version;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const updateDatasetVersion = async (version: string) => {
  const { error } = await supabase
    .from("scoring_dataset_state")
    .upsert({ key: "ingredient_dataset", version });
  if (error) {
    throw new Error(`[canonical-plan] failed to update dataset version: ${error.message}`);
  }
};

const findIngredientByKey = async (canonicalKey: string, name: string) => {
  const { data } = await supabase
    .from("ingredients")
    .select("id,canonical_key,name")
    .or(`canonical_key.eq.${canonicalKey},name.eq.${name}`)
    .limit(1);
  return data?.[0] ?? null;
};

const findIngredientByCanonicalKey = async (canonicalKey: string) => {
  const { data } = await supabase
    .from("ingredients")
    .select("id,canonical_key,name")
    .eq("canonical_key", canonicalKey)
    .limit(1);
  return data?.[0] ?? null;
};

const insertIngredient = async (entry: PlanEntry) => {
  const canonicalKey = entry.canonicalKey?.trim() || normalizeKey(entry.canonicalName);
  const name = entry.canonicalName.trim();
  const category = entry.category ?? null;
  const unit = entry.baseUnit ?? null;

  const existing = await findIngredientByKey(canonicalKey, name);
  if (existing?.id) {
    return { id: existing.id as string, created: false };
  }

  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      name,
      canonical_key: canonicalKey,
      category,
      unit,
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    throw new Error(`[canonical-plan] failed to insert ingredient ${name}: ${error?.message}`);
  }
  return { id: data.id as string, created: true };
};

const insertSynonyms = async (ingredientId: string, synonyms: string[], aliasType: string) => {
  if (!synonyms.length) return 0;
  let inserted = 0;
  const seen = new Set<string>();

  for (const synonym of synonyms) {
    const trimmed = synonym.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const { data } = await supabase
      .from("ingredient_synonyms")
      .select("id")
      .eq("ingredient_id", ingredientId)
      .ilike("synonym", trimmed)
      .limit(1);
    if (data && data.length > 0) continue;

    const { error } = await supabase
      .from("ingredient_synonyms")
      .insert({
        ingredient_id: ingredientId,
        synonym: trimmed,
        alias_type: aliasType,
        confidence: 0.9,
        source: "canonical_create_plan",
      });
    if (error) {
      throw new Error(
        `[canonical-plan] failed to insert synonym "${trimmed}": ${error.message}`,
      );
    }
    inserted += 1;
  }
  return inserted;
};

const buildRebackfillRunlist = async (
  source: string,
  nameKeys: string[],
): Promise<Array<{ source: string; sourceId: string }>> => {
  const uniqueKeys = Array.from(new Set(nameKeys.filter(Boolean)));
  const result = new Map<string, { source: string; sourceId: string }>();
  const chunkSize = 150;

  for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
    const chunk = uniqueKeys.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source,source_id")
      .eq("source", source)
      .eq("is_active", true)
      .is("ingredient_id", null)
      .in("name_key", chunk);
    if (error) {
      throw new Error(`[canonical-plan] rebackfill query failed: ${error.message}`);
    }
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
      timestamp: nowStamp(),
      source: item.source,
      sourceId: item.sourceId,
      stage: "canonical_create_plan",
      status: null,
      rayId: null,
      message: null,
    }),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const run = async () => {
  const raw = await readFile(planPath, "utf8");
  const payload = JSON.parse(raw) as PlanFile;
  const source = sourceOverride ?? payload.source ?? "lnhpd";
  const candidates = payload.candidates ?? [];
  const approved = candidates.filter(
    (entry) => entry.approved === true || entry.action === "create",
  );

  if (!approved.length) {
    console.log("[canonical-plan] no approved entries; nothing to apply");
    return;
  }

  const summary = {
    totalApproved: approved.length,
    ingredientsCreated: 0,
    ingredientsExisting: 0,
    synonymsInserted: 0,
    synonymsOnlyApplied: 0,
    rebackfillTargets: 0,
  };

  const nameKeys: string[] = [];

  if (!apply) {
    console.log(
      `[canonical-plan] dry-run: ${approved.length} approved entries. Use --apply to write.`,
    );
    return;
  }

  for (const entry of approved) {
    const action = (entry.action ?? "create").toLowerCase();
    const synonyms = Array.from(
      new Set([...(entry.synonyms ?? []), ...(entry.rawSamples ?? [])].filter(Boolean)),
    );
    if (entry.canonicalName) {
      synonyms.push(entry.canonicalName);
    }

    if (action === "synonym_only") {
      const canonicalKey = entry.canonicalKey?.trim() || normalizeKey(entry.canonicalName);
      const existing = await findIngredientByCanonicalKey(canonicalKey);
      if (!existing?.id) {
        throw new Error(
          `[canonical-plan] synonym_only target missing for ${canonicalKey} (${entry.canonicalName})`,
        );
      }
      summary.synonymsOnlyApplied += 1;
      const inserted = await insertSynonyms(existing.id as string, synonyms, "canonical_create_plan");
      summary.synonymsInserted += inserted;
    } else {
      const { id, created } = await insertIngredient(entry);
      if (created) summary.ingredientsCreated += 1;
      else summary.ingredientsExisting += 1;

      const inserted = await insertSynonyms(id, synonyms, "canonical_create_plan");
      summary.synonymsInserted += inserted;
    }

    synonyms.forEach((synonym) => {
      const nameKey = normalizeNameKey(synonym);
      if (nameKey) nameKeys.push(nameKey);
    });
  }

  const didWrite = summary.ingredientsCreated > 0 || summary.synonymsInserted > 0;
  let datasetVersion: string | null = await getDatasetVersion();

  if (didWrite) {
    const rebackfillItems = await buildRebackfillRunlist(source, nameKeys);
    summary.rebackfillTargets = rebackfillItems.length;
    await writeRebackfillFile(rebackfillOutput, rebackfillItems);

    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
    const nextVersion =
      datasetVersionArg ??
      (datasetVersion ? `${datasetVersion}-canonical-${suffix}` : `canonical-${suffix}`);
    await updateDatasetVersion(nextVersion);
    datasetVersion = nextVersion;
  } else {
    summary.rebackfillTargets = 0;
    await writeRebackfillFile(rebackfillOutput, []);
  }

  await writeFile(
    path.join(path.dirname(rebackfillOutput), "canonical_create_apply_summary.json"),
    JSON.stringify(
      {
        timestamp: nowStamp(),
        source,
        datasetVersion,
        plan: planPath,
        summary,
        rebackfillOutput,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `[canonical-plan] applied ingredientsCreated=${summary.ingredientsCreated} synonymsInserted=${summary.synonymsInserted} rebackfillTargets=${summary.rebackfillTargets} datasetVersion=${datasetVersion ?? "unchanged"}`,
  );
};

run().catch((error) => {
  console.error("[canonical-plan] failed:", error);
  process.exit(1);
});
