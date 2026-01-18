import fs from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductScoreRow = {
  source_id: string;
  canonical_source_id: string | null;
};

type ProductIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  form_raw: string | null;
  is_active: boolean;
};

type IngredientFormRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
};

type FormAliasRow = {
  alias_text: string;
  alias_norm: string | null;
  form_key: string;
  ingredient_id: string | null;
};

type MatchAttempt = {
  candidateText: string;
  candidateNormalized: string;
  candidateSource: "form_raw" | "name_raw";
  matchedFormKeys: string[];
  aliasMatches: Array<{
    aliasText: string;
    aliasNorm: string | null;
    formKey: string;
  }>;
  aliasMatchedFormKeys: string[];
  aliasMatchesForms: boolean;
  formsAvailable: Array<{
    formKey: string;
    formLabel: string;
  }>;
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

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isValidToken = (value: string): boolean => {
  if (!value) return false;
  if (value.length <= 1) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
};

const extractFormToken = (nameRaw: string): string | null => {
  const trimmed = nameRaw.trim();
  if (!trimmed) return null;
  const parenMatch = trimmed.match(/\((?:as|from)\s+([^)]+)\)/i);
  if (parenMatch?.[1]) return normalizeText(parenMatch[1]);
  const asMatch = trimmed.match(/\b(?:as|from)\s+([a-z0-9][a-z0-9\s\-\/+]+)$/i);
  if (asMatch?.[1]) return normalizeText(asMatch[1]);
  return null;
};

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

const parseSourceIds = (values: unknown[]): string[] =>
  values
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number") return String(value);
      return "";
    })
    .filter((value) => value.length > 0);

const loadSourceIds = async (
  source: ScoreSource,
  limit: number,
  idColumn: "source_id" | "canonical_source_id",
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("source_id,canonical_source_id")
    .eq("source", source)
    .eq("score_version", V4_SCORE_VERSION)
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as ProductScoreRow[];
  return rows
    .map((row) =>
      idColumn === "canonical_source_id"
        ? row.canonical_source_id ?? ""
        : row.source_id,
    )
    .filter(Boolean);
};

const fetchIngredients = async (
  source: ScoreSource,
  sourceIds: string[],
  idColumn: "source_id" | "canonical_source_id",
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,canonical_source_id,ingredient_id,name_raw,form_raw,is_active")
      .eq("source", source)
      .in(idColumn, chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductIngredientRow[]));
  }
  return rows;
};

const fetchIngredientForms = async (ingredientIds: string[]): Promise<IngredientFormRow[]> => {
  const rows: IngredientFormRow[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key,form_label")
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

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const limit = Math.max(1, Number(getArg("limit") ?? "1000"));
const outDir = getArg("out-dir") ?? "output/form-taxonomy";
const topN = Math.max(1, Number(getArg("top-n") ?? "50"));
const sourceIdsFile = getArg("source-ids-file");
const idColumnArg = (getArg("id-column") ?? "source_id").toLowerCase();
const idColumn =
  idColumnArg === "canonical_source_id" ? "canonical_source_id" : "source_id";

const sources: ScoreSource[] =
  sourceArg === "all"
    ? ["dsld", "lnhpd"]
    : sourceArg === "dsld"
      ? ["dsld"]
      : sourceArg === "lnhpd"
        ? ["lnhpd"]
        : [];

if (!sources.length) {
  console.error(`[diagnose] invalid source: ${sourceArg}`);
  process.exit(1);
}

const runForSource = async (source: ScoreSource) => {
  let sourceIds: string[];
  if (sourceIdsFile) {
    const raw = await fs.readFile(sourceIdsFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    let ids: unknown = parsed;
    if (!Array.isArray(parsed) && parsed && typeof parsed === "object") {
      ids = (parsed as { sourceIds?: unknown }).sourceIds ?? parsed;
    }
    if (!Array.isArray(ids)) {
      throw new Error("source-ids-file must be a JSON array or { sourceIds: [] }");
    }
    sourceIds = parseSourceIds(ids);
  } else {
    sourceIds = await loadSourceIds(source, limit, idColumn);
  }

  const ingredients = await fetchIngredients(source, sourceIds, idColumn);
  const activeRows = ingredients.filter((row) => row.is_active);

  const ingredientIds = Array.from(
    new Set(activeRows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
  );

  const [forms, aliases] = await Promise.all([
    fetchIngredientForms(ingredientIds),
    fetchAliases(ingredientIds),
  ]);

  const formsByIngredient = new Map<string, IngredientFormRow[]>();
  forms.forEach((row) => {
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

  const tokenCounts = new Map<string, number>();
  const examples: string[] = [];
  const counts = {
    activeRows: activeRows.length,
    ingredientIdMissing: 0,
    ingredientFormsMissing: 0,
    formRawMissing: 0,
    taxonomyMismatch: 0,
    formRawNoMatch: 0,
    matched: 0,
  };

  activeRows.forEach((row) => {
    if (!row.ingredient_id) {
      counts.ingredientIdMissing += 1;
      return;
    }

    const formsForIngredient = formsByIngredient.get(row.ingredient_id) ?? [];
    if (!formsForIngredient.length) {
      counts.ingredientFormsMissing += 1;
    }

    if (!row.form_raw || !row.form_raw.trim()) {
      counts.formRawMissing += 1;
    }

    const candidateSource = row.form_raw && row.form_raw.trim() ? "form_raw" : "name_raw";
    const candidateText =
      candidateSource === "form_raw"
        ? row.form_raw!.trim()
        : extractFormToken(row.name_raw) ?? "";

    if (!candidateText) return;

    const candidateNormalized = normalizeText(candidateText);
    if (!candidateNormalized) return;

    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ];

    const matchedForms = formsForIngredient.filter((form) =>
      formMatchesCandidate(candidateNormalized, form),
    );
    const matchedFormKeys = matchedForms.map((form) => form.form_key);

    const aliasMatches = aliasList.filter((alias) =>
      aliasMatchesCandidate(candidateNormalized, alias),
    );
    const aliasMatchedFormKeys = aliasMatches.map((alias) => alias.form_key);
    const hasAliasMatch = aliasMatchedFormKeys.length > 0;
    const aliasMatchesForms = aliasMatchedFormKeys.some((key) =>
      formsForIngredient.some((form) => form.form_key === key),
    );

    const matched = matchedFormKeys.length > 0 || aliasMatchesForms;
    if (matched) {
      counts.matched += 1;
      return;
    }

    if (hasAliasMatch && !aliasMatchesForms) {
      counts.taxonomyMismatch += 1;
      const tokens = candidateNormalized
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => isValidToken(token));

      tokens.forEach((token) =>
        tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1),
      );

      const matchAttempt: MatchAttempt = {
        candidateText,
        candidateNormalized,
        candidateSource,
        matchedFormKeys,
        aliasMatches: aliasMatches.map((alias) => ({
          aliasText: alias.alias_text,
          aliasNorm: alias.alias_norm ?? null,
          formKey: alias.form_key,
        })),
        aliasMatchedFormKeys,
        aliasMatchesForms,
        formsAvailable: formsForIngredient.map((form) => ({
          formKey: form.form_key,
          formLabel: form.form_label,
        })),
      };

      examples.push(
        JSON.stringify({
          source,
          sourceId:
            idColumn === "canonical_source_id"
              ? row.canonical_source_id ?? row.source_id
              : row.source_id,
          canonicalSourceId: row.canonical_source_id ?? null,
          ingredientId: row.ingredient_id,
          nameRaw: row.name_raw,
          formRaw: row.form_raw,
          tokens,
          matchAttempt,
        }),
      );
      return;
    }

    if (row.form_raw && row.form_raw.trim() && formsForIngredient.length > 0) {
      counts.formRawNoMatch += 1;
    }
  });

  const resolvedRows = counts.activeRows - counts.ingredientIdMissing;
  const mismatchRatio = resolvedRows ? counts.taxonomyMismatch / resolvedRows : 0;
  const formRawMissingAmongResolved = resolvedRows ? counts.formRawMissing / resolvedRows : 0;
  const formRawNoMatchRatio = resolvedRows ? counts.formRawNoMatch / resolvedRows : 0;

  const summary = {
    source,
    timestamp: new Date().toISOString(),
    sampleSize: sourceIds.length,
    activeRows: counts.activeRows,
    resolvedRows,
    counts,
    ratios: {
      ingredientIdMissing: counts.activeRows
        ? Number((counts.ingredientIdMissing / counts.activeRows).toFixed(4))
        : 0,
      taxonomyMismatchAmongResolved: Number(mismatchRatio.toFixed(4)),
      taxonomyMismatchAmongActive: counts.activeRows
        ? Number((counts.taxonomyMismatch / counts.activeRows).toFixed(4))
        : 0,
      formRawMissingAmongResolved: Number(formRawMissingAmongResolved.toFixed(4)),
      formRawNoMatchAmongResolved: Number(formRawNoMatchRatio.toFixed(4)),
    },
    options: {
      limit: sourceIdsFile ? null : limit,
      topN,
      sourceIdsFile: sourceIdsFile ?? null,
      idColumn,
    },
  };

  const topTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([token, count]) => ({ token, count }));

  await ensureDir(outDir);

  const summaryPath = path.join(outDir, `mismatch_summary_${source}.json`);
  const tokensPath = path.join(outDir, `mismatch_top_tokens_${source}.json`);
  const examplesPath = path.join(outDir, `mismatch_examples_${source}.jsonl`);

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(
    tokensPath,
    JSON.stringify(
      {
        source,
        topN,
        totalMismatches: counts.taxonomyMismatch,
        tokens: topTokens,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(examplesPath, examples.join("\n"), "utf8");

  return { summaryPath, tokensPath, examplesPath };
};

Promise.all(sources.map((source) => runForSource(source)))
  .then((results) => {
    console.log(JSON.stringify(results, null, 2));
  })
  .catch((error) => {
    console.error("[diagnose] failed:", error);
    process.exit(1);
  });
