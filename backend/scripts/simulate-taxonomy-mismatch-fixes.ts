import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type ScoreSource = "lnhpd" | "dsld";

type ProductIngredientRow = {
  source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
  is_active: boolean | null;
};

type IngredientFormRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
  audit_status: string | null;
};

type FormAliasRow = {
  alias_text: string;
  alias_norm: string | null;
  form_key: string;
  ingredient_id: string | null;
};

type MismatchSubtypeReport = {
  source: string;
  taxonomyMismatchSourceIds?: string[];
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const SOURCE = (getArg("source") ?? "lnhpd").toLowerCase() as ScoreSource;
const SOURCE_IDS_FILE = getArg("source-ids-file");
const MISMATCH_SUBTYPES = getArg("mismatch-subtypes");
const OUTPUT =
  getArg("output") ??
  `output/diagnostics/${SOURCE}_taxonomy_mismatch_simulation.json`;
const TOP_N = Math.max(1, Number(getArg("top-n") ?? "20"));

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const aliasMatchesCandidate = (candidateNormalized: string, alias: FormAliasRow): boolean => {
  const aliasNorm = normalizeText(alias.alias_norm || alias.alias_text || "");
  if (!aliasNorm) return false;
  if (candidateNormalized === aliasNorm) return true;
  if (candidateNormalized.includes(aliasNorm)) return true;
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));
  const aliasTokens = aliasNorm.split(/\s+/).filter(Boolean);
  if (aliasTokens.length && aliasTokens.every((token) => candidateTokens.has(token))) return true;
  return aliasTokens.some((token) => candidateTokens.has(token));
};

const formMatchesCandidate = (candidateNormalized: string, form: IngredientFormRow): boolean => {
  const keyNormalized = normalizeText(form.form_key);
  const labelNormalized = normalizeText(form.form_label);
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));

  if (keyNormalized && candidateNormalized.includes(keyNormalized)) return true;
  const keyTokens = keyNormalized.split(/\s+/).filter(Boolean);
  if (keyTokens.length && keyTokens.every((token) => candidateTokens.has(token))) return true;
  const labelTokens = labelNormalized.split(/\s+/).filter(Boolean);
  if (labelTokens.length && labelTokens.every((token) => candidateTokens.has(token))) return true;
  return labelTokens.some((token) => candidateTokens.has(token));
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

const loadSourceIds = async (): Promise<string[]> => {
  if (!SOURCE_IDS_FILE) return [];
  const raw = await readFile(SOURCE_IDS_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  let ids: unknown = parsed;
  if (!Array.isArray(parsed) && parsed && typeof parsed === "object") {
    ids = (parsed as { sourceIds?: unknown }).sourceIds ?? parsed;
  }
  if (!Array.isArray(ids)) return [];
  return ids
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
};

const loadMismatchSubtypes = async (): Promise<MismatchSubtypeReport | null> => {
  if (!MISMATCH_SUBTYPES) return null;
  const raw = await readFile(MISMATCH_SUBTYPES, "utf8");
  return JSON.parse(raw) as MismatchSubtypeReport;
};

const fetchIngredients = async (
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,ingredient_id,name_raw,form_raw,is_active")
      .eq("source", SOURCE)
      .in("source_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductIngredientRow[]));
  }
  return rows;
};

const fetchIngredientForms = async (
  ingredientIds: string[],
): Promise<IngredientFormRow[]> => {
  const rows: IngredientFormRow[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key,form_label,audit_status")
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as IngredientFormRow[]));
  }
  return rows;
};

const fetchAliases = async (ingredientIds: string[]): Promise<FormAliasRow[]> => {
  const rows: FormAliasRow[] = [];
  const { data: globalAliases, error: globalError } = await supabase
    .from("ingredient_form_aliases")
    .select("alias_text,alias_norm,form_key,ingredient_id")
    .is("ingredient_id", null);
  if (globalError) throw globalError;
  rows.push(...((globalAliases ?? []) as FormAliasRow[]));

  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_aliases")
      .select("alias_text,alias_norm,form_key,ingredient_id")
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as FormAliasRow[]));
  }
  return rows;
};

const STOPWORDS = new Set([
  "acid",
  "acids",
  "fatty",
  "free",
  "ester",
  "esters",
  "sterol",
  "sterols",
  "alpha",
  "beta",
  "and",
  "gla",
  "linoleic",
  "oleic",
  "linolenic",
  "dhe",
]);

const dosagePattern = /^\d+(?:mg|mcg|g|iu|ml|cfu)$/;
const omegaPattern = /^omega\d*$/;

const isStopwordToken = (token: string): boolean => {
  if (!token) return true;
  if (STOPWORDS.has(token)) return true;
  if (omegaPattern.test(token)) return true;
  if (dosagePattern.test(token)) return true;
  if (/^\d+$/.test(token)) return true;
  return false;
};

const run = async () => {
  const mismatchReport = await loadMismatchSubtypes();
  const sampleIds = await loadSourceIds();
  if (!sampleIds.length) {
    throw new Error("Provide --source-ids-file with fixed sample ids.");
  }

  const taxonomyMismatchSourceIds =
    mismatchReport?.taxonomyMismatchSourceIds ??
    [];
  if (!taxonomyMismatchSourceIds.length) {
    throw new Error(
      "mismatch-subtypes file must include taxonomyMismatchSourceIds.",
    );
  }

  const ingredients = await fetchIngredients(taxonomyMismatchSourceIds);
  const activeRows = ingredients.filter((row) => row.is_active);
  const ingredientIds = Array.from(
    new Set(
      activeRows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id)),
    ),
  );

  const [forms, aliases] = await Promise.all([
    fetchIngredientForms(ingredientIds),
    fetchAliases(ingredientIds),
  ]);

  const formsByIngredient = new Map<string, IngredientFormRow[]>();
  forms
    .filter((row) => (row.audit_status ?? "").toLowerCase() === "verified")
    .forEach((row) => {
      const bucket = formsByIngredient.get(row.ingredient_id) ?? [];
      bucket.push(row);
      formsByIngredient.set(row.ingredient_id, bucket);
    });

  const globalAliases = aliases.filter((alias) => !alias.ingredient_id);
  const aliasesByIngredient = new Map<string, FormAliasRow[]>();
  aliases.forEach((alias) => {
    if (!alias.ingredient_id) return;
    const bucket = aliasesByIngredient.get(alias.ingredient_id) ?? [];
    bucket.push(alias);
    aliasesByIngredient.set(alias.ingredient_id, bucket);
  });

  const taxonomyMismatchBefore = new Set<string>();
  const taxonomyMismatchAfter = new Set<string>();
  const resolvedByStopwords = new Set<string>();
  const stillMismatchTokenCounts = new Map<string, number>();
  const examplesResolved: Record<string, unknown>[] = [];
  const examplesStillMismatch: Record<string, unknown>[] = [];

  const perProductStillMismatch = new Map<string, boolean>();

  activeRows.forEach((row) => {
    const sourceId = row.source_id;
    if (!sourceId || !taxonomyMismatchSourceIds.includes(sourceId)) return;
    if (!row.ingredient_id) return;

    const verifiedForms = formsByIngredient.get(row.ingredient_id) ?? [];
    if (!verifiedForms.length) return;

    const formRaw = row.form_raw?.trim() ?? "";
    if (!formRaw) return;

    const candidateNormalized = normalizeText(formRaw);
    if (!candidateNormalized) return;

    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ];

    const formMatch = verifiedForms.some((form) =>
      formMatchesCandidate(candidateNormalized, form),
    );
    const aliasMatch = aliasList.some((alias) =>
      aliasMatchesCandidate(candidateNormalized, alias),
    );
    if (formMatch || aliasMatch) return;

    taxonomyMismatchBefore.add(sourceId);

    const beforeTokens = candidateNormalized.split(/\s+/).filter(Boolean);
    const afterTokens = beforeTokens.filter((token) => !isStopwordToken(token));
    const afterNormalized = afterTokens.join(" ");

    let resolved = false;
    let matchedFormKey: string | null = null;
    if (afterTokens.length) {
      const formHit = verifiedForms.find((form) =>
        formMatchesCandidate(afterNormalized, form),
      );
      if (formHit) {
        resolved = true;
        matchedFormKey = formHit.form_key;
      } else {
        const aliasHit = aliasList.find((alias) =>
          aliasMatchesCandidate(afterNormalized, alias),
        );
        if (aliasHit) {
          resolved = true;
          matchedFormKey = aliasHit.form_key;
        }
      }
    }

    if (resolved) {
      resolvedByStopwords.add(sourceId);
      if (examplesResolved.length < 50) {
        examplesResolved.push({
          sourceId,
          ingredientName: row.name_raw ?? "Unknown",
          beforeTokens,
          afterTokens,
          matchedFormKey,
        });
      }
    } else {
      perProductStillMismatch.set(sourceId, true);
      afterTokens.forEach((token) => {
        const current = stillMismatchTokenCounts.get(token) ?? 0;
        stillMismatchTokenCounts.set(token, current + 1);
      });
      if (examplesStillMismatch.length < 50) {
        examplesStillMismatch.push({
          sourceId,
          ingredientName: row.name_raw ?? "Unknown",
          tokens: afterTokens,
        });
      }
    }
  });

  taxonomyMismatchBefore.forEach((sourceId) => {
    if (perProductStillMismatch.get(sourceId)) {
      taxonomyMismatchAfter.add(sourceId);
    }
  });

  const stillMismatchTopTokens = Array.from(stillMismatchTokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([token, count]) => ({ token, count }));

  const output = {
    source: SOURCE,
    taxonomyMismatchCountBefore: taxonomyMismatchBefore.size,
    taxonomyMismatchCountAfter: taxonomyMismatchAfter.size,
    resolvedByStopwords: Math.max(0, taxonomyMismatchBefore.size - taxonomyMismatchAfter.size),
    stillMismatchTopTokens,
    examplesResolved,
    examplesStillMismatch,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
