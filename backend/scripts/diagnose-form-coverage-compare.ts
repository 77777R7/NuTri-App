import fs from "node:fs/promises";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "dsld" | "lnhpd";

type ProductScoreRow = {
  source_id: string;
  explain_json: {
    evidence?: {
      formCoverageRatio?: number;
    };
  } | null;
};

type ProductIngredientRow = {
  source_id: string;
  ingredient_id: string | null;
  name_raw: string;
  form_raw: string | null;
  is_active: boolean;
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
  confidence: number | null;
  audit_status: string | null;
};

type CoverageSnapshot = {
  source: ScoreSource;
  timestamp: string;
  sampleSize: number;
  sourceIds: string[];
  zeroCoverageCount: number;
  zeroCoverageRatio: number;
  counts: {
    activeRows: number;
    rowsWithIngredientId: number;
    ingredientIdMissing: number;
    ingredientFormsMissingAny: number;
    ingredientFormsMissingVerified: number;
    formRawMissing: number;
    taxonomyMismatch: number;
    formRawNoMatch: number;
    matched: number;
  };
  ratios: {
    ingredientIdMissing: number;
    ingredientIdResolved: number;
    ingredientFormsMissingAny: number;
    ingredientFormsMissingVerified: number;
    formRawMissing: number;
    formRawMissingAmongResolved: number;
    taxonomyMismatch: number;
    formRawNoMatch: number;
    matched: number;
  };
  topTokens: Array<{ token: string; count: number }>;
  definitions: {
    formRawMissing: string;
  };
};

type CoverageComparison = {
  baseline: CoverageSnapshot;
  current: CoverageSnapshot;
  idMismatchCount: number;
  deltas: Record<string, number>;
  interpretation: string;
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

const formMatchesCandidate = (
  candidateNormalized: string,
  form: IngredientFormRow,
): boolean => {
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

const readJson = async <T>(path: string): Promise<T> => {
  const raw = await fs.readFile(path, "utf8");
  return JSON.parse(raw) as T;
};

const writeJson = async (path: string, payload: unknown) => {
  await fs.mkdir(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(path, JSON.stringify(payload, null, 2), "utf8");
};

const fetchSampleSourceIds = async (
  source: ScoreSource,
  limit: number,
): Promise<string[]> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("source_id")
    .eq("source", source)
    .eq("score_version", V4_SCORE_VERSION)
    .order("computed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? [])
    .map((row) => row?.source_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

const fetchScoresByIds = async (
  source: ScoreSource,
  sourceIds: string[],
): Promise<ProductScoreRow[]> => {
  const rows: ProductScoreRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_scores")
      .select("source_id,explain_json")
      .eq("source", source)
      .eq("score_version", V4_SCORE_VERSION)
      .in("source_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ProductScoreRow[]));
  }
  return rows;
};

const fetchIngredients = async (
  source: ScoreSource,
  sourceIds: string[],
): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,ingredient_id,name_raw,form_raw,is_active")
      .eq("source", source)
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
    .select("alias_text,alias_norm,form_key,ingredient_id,confidence,audit_status")
    .is("ingredient_id", null);
  if (globalError) throw globalError;
  rows.push(...((globalAliases ?? []) as FormAliasRow[]));

  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_aliases")
      .select("alias_text,alias_norm,form_key,ingredient_id,confidence,audit_status")
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as FormAliasRow[]));
  }
  return rows;
};

const buildSnapshot = async (
  source: ScoreSource,
  sourceIds: string[],
): Promise<CoverageSnapshot> => {
  const scores = await fetchScoresByIds(source, sourceIds);
  const scoreMap = new Map(scores.map((row) => [row.source_id, row]));
  const zeroCoverageIds = sourceIds.filter((sourceId) => {
    const row = scoreMap.get(sourceId);
    const ratio = row?.explain_json?.evidence?.formCoverageRatio;
    return typeof ratio === "number" && ratio <= 0;
  });

  if (!zeroCoverageIds.length) {
    return {
      source,
      timestamp: new Date().toISOString(),
      sampleSize: sourceIds.length,
      sourceIds,
      zeroCoverageCount: 0,
      zeroCoverageRatio: 0,
      counts: {
        activeRows: 0,
        rowsWithIngredientId: 0,
        ingredientIdMissing: 0,
        ingredientFormsMissingAny: 0,
        ingredientFormsMissingVerified: 0,
        formRawMissing: 0,
        taxonomyMismatch: 0,
        formRawNoMatch: 0,
        matched: 0,
      },
      ratios: {
        ingredientIdMissing: 0,
        ingredientIdResolved: 0,
        ingredientFormsMissingAny: 0,
        ingredientFormsMissingVerified: 0,
        formRawMissing: 0,
        formRawMissingAmongResolved: 0,
        taxonomyMismatch: 0,
        formRawNoMatch: 0,
        matched: 0,
      },
      topTokens: [],
      definitions: {
        formRawMissing:
          "formRawMissing counts active rows with ingredient_id present and no form_raw; ratio divides by activeRows in zeroCoverage subset.",
      },
    };
  }

  const ingredients = await fetchIngredients(source, zeroCoverageIds);
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
  const counts = {
    activeRows: activeRows.length,
    ingredientIdMissing: 0,
    ingredientFormsMissingAny: 0,
    ingredientFormsMissingVerified: 0,
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
    const verifiedForms = formsForIngredient.filter(
      (form) => (form.audit_status ?? "").toLowerCase() === "verified",
    );
    if (!formsForIngredient.length) {
      counts.ingredientFormsMissingAny += 1;
    }
    if (!verifiedForms.length) {
      counts.ingredientFormsMissingVerified += 1;
    }

    if (!row.form_raw || !row.form_raw.trim()) {
      counts.formRawMissing += 1;
    }

    const candidateText = row.form_raw?.trim() || row.name_raw;
    const candidateNormalized = normalizeText(candidateText);
    if (!candidateNormalized) return;

    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ];

    const matchedForms = formsForIngredient.some((form) =>
      formMatchesCandidate(candidateNormalized, form),
    );
    const matchedAliasFormKeys = aliasList
      .filter((alias) => aliasMatchesCandidate(candidateNormalized, alias))
      .map((alias) => alias.form_key);
    const hasAliasMatch = matchedAliasFormKeys.length > 0;
    const aliasMatchesForms = matchedAliasFormKeys.some((key) =>
      formsForIngredient.some((form) => form.form_key === key),
    );

    const matched = matchedForms || aliasMatchesForms;
    if (matched) {
      counts.matched += 1;
      return;
    }

    const token = row.form_raw
      ? normalizeText(row.form_raw)
      : extractFormToken(row.name_raw);
    if (token) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }

    if (hasAliasMatch && !aliasMatchesForms) {
      counts.taxonomyMismatch += 1;
    } else if (row.form_raw && row.form_raw.trim() && formsForIngredient.length > 0) {
      counts.formRawNoMatch += 1;
    }
  });

  const denominator = counts.activeRows || 1;
  const rowsWithIngredientId = Math.max(0, counts.activeRows - counts.ingredientIdMissing);
  const formRawMissingAmongResolved = rowsWithIngredientId
    ? counts.formRawMissing / rowsWithIngredientId
    : 0;

  const ratios = {
    ingredientIdMissing: Number((counts.ingredientIdMissing / denominator).toFixed(4)),
    ingredientIdResolved: Number((rowsWithIngredientId / denominator).toFixed(4)),
    ingredientFormsMissingAny: Number(
      (counts.ingredientFormsMissingAny / denominator).toFixed(4),
    ),
    ingredientFormsMissingVerified: Number(
      (counts.ingredientFormsMissingVerified / denominator).toFixed(4),
    ),
    formRawMissing: Number((counts.formRawMissing / denominator).toFixed(4)),
    formRawMissingAmongResolved: Number(formRawMissingAmongResolved.toFixed(4)),
    taxonomyMismatch: Number((counts.taxonomyMismatch / denominator).toFixed(4)),
    formRawNoMatch: Number((counts.formRawNoMatch / denominator).toFixed(4)),
    matched: Number((counts.matched / denominator).toFixed(4)),
  };

  const topTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, count]) => ({ token, count }));

  return {
    source,
    timestamp: new Date().toISOString(),
    sampleSize: sourceIds.length,
    sourceIds,
    zeroCoverageCount: zeroCoverageIds.length,
    zeroCoverageRatio: Number((zeroCoverageIds.length / sourceIds.length).toFixed(4)),
    counts: {
      ...counts,
      rowsWithIngredientId,
    },
    ratios,
    topTokens,
    definitions: {
      formRawMissing:
        "formRawMissing counts active rows with ingredient_id present and no form_raw; ratio divides by activeRows in zeroCoverage subset.",
    },
  };
};

const buildComparison = (baseline: CoverageSnapshot, current: CoverageSnapshot): CoverageComparison => {
  const baselineIds = new Set(baseline.sourceIds);
  const currentIds = new Set(current.sourceIds);
  let idMismatchCount = 0;
  baselineIds.forEach((id) => {
    if (!currentIds.has(id)) idMismatchCount += 1;
  });
  currentIds.forEach((id) => {
    if (!baselineIds.has(id)) idMismatchCount += 1;
  });
  const deltas: Record<string, number> = {
    zeroCoverageRatio: Number((current.zeroCoverageRatio - baseline.zeroCoverageRatio).toFixed(4)),
    ingredientIdMissing: Number((current.ratios.ingredientIdMissing - baseline.ratios.ingredientIdMissing).toFixed(4)),
    ingredientIdResolved: Number((current.ratios.ingredientIdResolved - baseline.ratios.ingredientIdResolved).toFixed(4)),
    ingredientFormsMissingAny: Number(
      (current.ratios.ingredientFormsMissingAny - baseline.ratios.ingredientFormsMissingAny).toFixed(4),
    ),
    ingredientFormsMissingVerified: Number(
      (current.ratios.ingredientFormsMissingVerified - baseline.ratios.ingredientFormsMissingVerified).toFixed(4),
    ),
    formRawMissing: Number((current.ratios.formRawMissing - baseline.ratios.formRawMissing).toFixed(4)),
    formRawMissingAmongResolved: Number(
      (current.ratios.formRawMissingAmongResolved - baseline.ratios.formRawMissingAmongResolved).toFixed(4),
    ),
  };

  let interpretation = "No significant ratio shift detected.";
  if (idMismatchCount > 0) {
    interpretation =
      "Source ID sets differ; run compare with the same sourceIds file to avoid selection drift.";
  } else if (deltas.formRawMissing > 0 && deltas.ingredientIdMissing < 0) {
    interpretation =
      "formRawMissing ratio can rise when ingredientIdMissing falls, because more resolved rows with empty form_raw enter the numerator while the denominator (activeRows) stays the same.";
  }

  return { baseline, current, idMismatchCount, deltas, interpretation };
};

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const limit = Math.max(1, Number(getArg("limit") ?? "1000"));
const sourceIdsFile = getArg("source-ids-file");
const sourceIdsOutput = getArg("source-ids-output");
const outputPath = getArg("output");
const comparePath = getArg("compare");
const compareOutput = getArg("compare-output");

const source: ScoreSource = sourceArg === "dsld" ? "dsld" : "lnhpd";

const main = async () => {
  const sourceIds = sourceIdsFile
    ? (() => {
        const payload = readJson<{ sourceIds: string[] } | string[]>(sourceIdsFile);
        return payload.then((data) =>
          Array.isArray(data) ? data : Array.isArray(data?.sourceIds) ? data.sourceIds : [],
        );
      })()
    : fetchSampleSourceIds(source, limit);

  const resolvedSourceIds = await sourceIds;
  if (!resolvedSourceIds.length) {
    throw new Error(`[compare] no source IDs found for ${source}.`);
  }

  if (sourceIdsOutput) {
    await writeJson(sourceIdsOutput, {
      source,
      timestamp: new Date().toISOString(),
      sourceIds: resolvedSourceIds,
    });
  }

  const snapshot = await buildSnapshot(source, resolvedSourceIds);
  if (outputPath) {
    await writeJson(outputPath, snapshot);
  }

  console.log(JSON.stringify(snapshot, null, 2));

  if (comparePath) {
    const baseline = await readJson<CoverageSnapshot>(comparePath);
    const comparison = buildComparison(baseline, snapshot);
    if (compareOutput) {
      await writeJson(compareOutput, comparison);
    }
    console.log(JSON.stringify(comparison, null, 2));
  }
};

main().catch((error) => {
  console.error("[compare] failed:", error);
  process.exit(1);
});
