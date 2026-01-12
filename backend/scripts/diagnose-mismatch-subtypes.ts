import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "lnhpd" | "dsld" | "ocr" | "manual";

type ScoreRow = {
  source_id: string | null;
  explain_json: {
    evidence?: {
      formCoverageRatio?: number;
    };
  } | null;
};

type IngredientRow = {
  source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
  unit: string | null;
  unit_normalized: string | null;
  unit_kind: string | null;
  is_active: boolean | null;
};

type IngredientMeta = {
  id: string;
  unit: string | null;
};

type IngredientForm = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
  audit_status: string | null;
};

type FormAlias = {
  alias_text: string;
  alias_norm: string | null;
  form_key: string;
  ingredient_id: string | null;
};

type ProductReasonStats = {
  ingredientIdMissing: number;
  unitMissing: number;
  unitMismatch: number;
  missingVerified: number;
  mismatch: number;
};

type MismatchRow = {
  ingredientId: string;
  ingredientName: string;
  formRaw: string | null;
  formRawTokens: string[];
  verifiedFormKeys: string[];
  verifiedAliasesSample: string[];
  subtype: "form_raw_missing" | "taxonomy_mismatch";
};

type ProductSummary = {
  sourceId: string;
  primaryReason: string;
  counts: ProductReasonStats;
  mismatchFormRawMissing: number;
  mismatchTaxonomy: number;
  mismatchRows: MismatchRow[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE = (getArg("source") ?? "lnhpd").toLowerCase() as ScoreSource;
const SOURCE_IDS_FILE = getArg("source-ids-file");
const LIMIT = Math.max(1, Number(getArg("limit") ?? "1000"));
const OUTPUT =
  getArg("output") ??
  `output/diagnostics/${SOURCE}_mismatch_subtypes.json`;
const TOP_N = Math.max(1, Number(getArg("top-n") ?? "20"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const isRecognizedUnit = (unit?: string | null, unitKind?: string | null): boolean => {
  if (unitKind) return ["mass", "volume", "iu", "cfu"].includes(unitKind);
  if (!unit) return false;
  return ["mcg", "ug", "mg", "g", "iu", "ml", "cfu"].includes(unit.trim().toLowerCase());
};

const formMatchesCandidate = (candidateNormalized: string, form: IngredientForm): boolean => {
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

const aliasMatchesCandidate = (candidateNormalized: string, alias: FormAlias): boolean => {
  const aliasNorm = normalizeText(alias.alias_norm || alias.alias_text || "");
  if (!aliasNorm) return false;
  if (candidateNormalized === aliasNorm) return true;
  if (candidateNormalized.includes(aliasNorm)) return true;
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));
  const aliasTokens = aliasNorm.split(/\s+/).filter(Boolean);
  if (aliasTokens.length && aliasTokens.every((token) => candidateTokens.has(token))) return true;
  return aliasTokens.some((token) => candidateTokens.has(token));
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchSourceIdsFromFile = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((value) => typeof value === "string" && value.length > 0);
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds.filter((value: unknown) => typeof value === "string" && value.length > 0);
  }
  return [];
};

const loadSourceIds = async (): Promise<string[]> => {
  if (SOURCE_IDS_FILE) return fetchSourceIdsFromFile(SOURCE_IDS_FILE);
  const { data, error } = await supabase
    .from("product_scores")
    .select("source_id")
    .eq("source", SOURCE)
    .eq("score_version", V4_SCORE_VERSION)
    .order("computed_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data ?? [])
    .map((row) => (row as { source_id: string | null }).source_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
};

const fetchScores = async (sourceIds: string[]): Promise<ScoreRow[]> => {
  const rows: ScoreRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_scores")
      .select("source_id,explain_json")
      .eq("source", SOURCE)
      .eq("score_version", V4_SCORE_VERSION)
      .in("source_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as ScoreRow[]));
  }
  return rows;
};

const fetchIngredients = async (sourceIds: string[]): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("source_id,ingredient_id,name_raw,form_raw,unit,unit_normalized,unit_kind,is_active")
      .eq("source", SOURCE)
      .in("source_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const fetchIngredientMeta = async (ingredientIds: string[]): Promise<Map<string, IngredientMeta>> => {
  const metaMap = new Map<string, IngredientMeta>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,unit")
      .in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      metaMap.set(row.id as string, {
        id: row.id as string,
        unit: row.unit ?? null,
      });
    });
  }
  return metaMap;
};

const fetchIngredientForms = async (ingredientIds: string[]): Promise<IngredientForm[]> => {
  const rows: IngredientForm[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key,form_label,audit_status")
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as IngredientForm[]));
  }
  return rows;
};

const fetchAliases = async (ingredientIds: string[]): Promise<FormAlias[]> => {
  const rows: FormAlias[] = [];
  const { data: globalAliases, error: globalError } = await supabase
    .from("ingredient_form_aliases")
    .select("alias_text,alias_norm,form_key,ingredient_id")
    .is("ingredient_id", null);
  if (globalError) throw globalError;
  rows.push(...((globalAliases ?? []) as FormAlias[]));

  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_form_aliases")
      .select("alias_text,alias_norm,form_key,ingredient_id")
      .in("ingredient_id", chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as FormAlias[]));
  }
  return rows;
};

const resolvePrimaryReason = (counts: ProductReasonStats): string => {
  if (counts.ingredientIdMissing > 0) return "ingredient_id_missing";
  if (counts.unitMissing > 0) return "unit_missing";
  if (counts.unitMismatch > 0) return "unit_mismatch";
  if (counts.missingVerified > 0) return "missingVerified";
  if (counts.mismatch > 0) return "mismatch";
  return "unknown";
};

const run = async () => {
  if (!SOURCE) throw new Error("Missing --source");

  const sampleIds = await loadSourceIds();
  if (!sampleIds.length) {
    throw new Error("Provide --source-ids-file or valid --limit.");
  }

  const scores = await fetchScores(sampleIds);
  const zeroCoverageIds = scores
    .filter((row) => {
      const ratio = row.explain_json?.evidence?.formCoverageRatio;
      return typeof ratio === "number" && ratio <= 0;
    })
    .map((row) => row.source_id)
    .filter((value): value is string => typeof value === "string");

  const zeroCoverageSet = new Set(zeroCoverageIds);
  const ingredients = await fetchIngredients(zeroCoverageIds);
  const activeRows = ingredients.filter((row) => row.is_active);
  const ingredientIds = Array.from(
    new Set(
      activeRows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id)),
    ),
  );

  const [metaMap, formRows, aliases] = await Promise.all([
    fetchIngredientMeta(ingredientIds),
    fetchIngredientForms(ingredientIds),
    fetchAliases(ingredientIds),
  ]);

  const formsByIngredient = new Map<string, IngredientForm[]>();
  formRows
    .filter((row) => (row.audit_status ?? "").toLowerCase() === "verified")
    .forEach((row) => {
      const bucket = formsByIngredient.get(row.ingredient_id) ?? [];
      bucket.push(row);
      formsByIngredient.set(row.ingredient_id, bucket);
    });

  const globalAliases = aliases.filter((alias) => !alias.ingredient_id);
  const aliasesByIngredient = new Map<string, FormAlias[]>();
  aliases.forEach((alias) => {
    if (!alias.ingredient_id) return;
    const bucket = aliasesByIngredient.get(alias.ingredient_id) ?? [];
    bucket.push(alias);
    aliasesByIngredient.set(alias.ingredient_id, bucket);
  });

  const productMap = new Map<string, ProductSummary>();
  activeRows.forEach((row) => {
    const sourceId = row.source_id;
    if (!sourceId || !zeroCoverageSet.has(sourceId)) return;
    if (!productMap.has(sourceId)) {
      productMap.set(sourceId, {
        sourceId,
        primaryReason: "unknown",
        counts: {
          ingredientIdMissing: 0,
          unitMissing: 0,
          unitMismatch: 0,
          missingVerified: 0,
          mismatch: 0,
        },
        mismatchFormRawMissing: 0,
        mismatchTaxonomy: 0,
        mismatchRows: [],
      });
    }
    const product = productMap.get(sourceId)!;
    const ingredientName = row.name_raw ?? "Unknown";

    if (!row.ingredient_id) {
      product.counts.ingredientIdMissing += 1;
      return;
    }

    const unitValue = row.unit_normalized ?? row.unit;
    const unitKind = row.unit_kind ?? null;
    if (!unitValue || !isRecognizedUnit(unitValue, unitKind)) {
      product.counts.unitMissing += 1;
    }

    const metaUnit = metaMap.get(row.ingredient_id)?.unit ?? null;
    if (metaUnit && unitValue && unitValue !== metaUnit) {
      product.counts.unitMismatch += 1;
    }

    const verifiedForms = formsByIngredient.get(row.ingredient_id) ?? [];
    if (!verifiedForms.length) {
      product.counts.missingVerified += 1;
      return;
    }

    const formRaw = row.form_raw?.trim() ?? "";
    const candidateNormalized = normalizeText(formRaw);
    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ];
    const verifiedFormKeys = verifiedForms.map((form) => form.form_key).slice(0, 10);
    const verifiedAliasesSample = aliasList
      .map((alias) => alias.alias_norm || alias.alias_text)
      .filter((value): value is string => Boolean(value))
      .slice(0, 10);

    if (!formRaw || !candidateNormalized) {
      product.counts.mismatch += 1;
      product.mismatchFormRawMissing += 1;
      product.mismatchRows.push({
        ingredientId: row.ingredient_id,
        ingredientName,
        formRaw: row.form_raw ?? null,
        formRawTokens: candidateNormalized ? candidateNormalized.split(/\s+/).filter(Boolean) : [],
        verifiedFormKeys,
        verifiedAliasesSample,
        subtype: "form_raw_missing",
      });
      return;
    }

    const formMatch = verifiedForms.some((form) =>
      formMatchesCandidate(candidateNormalized, form),
    );
    const aliasMatch = aliasList.some((alias) =>
      aliasMatchesCandidate(candidateNormalized, alias),
    );
    if (formMatch || aliasMatch) return;

    product.counts.mismatch += 1;
    product.mismatchTaxonomy += 1;
    product.mismatchRows.push({
      ingredientId: row.ingredient_id,
      ingredientName,
      formRaw: row.form_raw ?? null,
      formRawTokens: candidateNormalized.split(/\s+/).filter(Boolean),
      verifiedFormKeys,
      verifiedAliasesSample,
      subtype: "taxonomy_mismatch",
    });
  });

  const products = Array.from(productMap.values()).map((product) => ({
    ...product,
    primaryReason: resolvePrimaryReason(product.counts),
  }));

  const mismatchProducts = products.filter((product) => product.primaryReason === "mismatch");
  const mismatchSubtypeCounts = {
    form_raw_missing: 0,
    taxonomy_mismatch: 0,
  };
  const topIngredientsBySubtype: Record<string, Map<string, number>> = {
    form_raw_missing: new Map<string, number>(),
    taxonomy_mismatch: new Map<string, number>(),
  };

  const examples: Record<string, unknown>[] = [];
  const mismatchSourceIds: string[] = [];
  const taxonomyMismatchSourceIds: string[] = [];
  const formRawMissingSourceIds: string[] = [];

  mismatchProducts.forEach((product) => {
    const subtype =
      product.mismatchFormRawMissing > 0 ? "form_raw_missing" : "taxonomy_mismatch";
    mismatchSubtypeCounts[subtype] += 1;
    mismatchSourceIds.push(product.sourceId);
    if (subtype === "form_raw_missing") {
      formRawMissingSourceIds.push(product.sourceId);
    } else {
      taxonomyMismatchSourceIds.push(product.sourceId);
    }

    product.mismatchRows
      .filter((row) => row.subtype === subtype)
      .forEach((row) => {
        const current = topIngredientsBySubtype[subtype].get(row.ingredientName) ?? 0;
        topIngredientsBySubtype[subtype].set(row.ingredientName, current + 1);
        if (examples.length < 200) {
          examples.push({
            sourceId: product.sourceId,
            ingredientName: row.ingredientName,
            resolvedIngredientId: row.ingredientId,
            mismatchSubtype: row.subtype,
            formRaw: row.formRaw,
            formRawTokens: row.formRawTokens,
            verifiedFormKeys: row.verifiedFormKeys,
            verifiedAliasesSample: row.verifiedAliasesSample,
          });
        }
      });
  });

  const toTopList = (map: Map<string, number>) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([ingredientName, count]) => ({ ingredientName, count }));

  const output = {
    source: SOURCE,
    sampleSize: sampleIds.length,
    zeroCoverageCount: products.length,
    mismatchCount: mismatchProducts.length,
    mismatchSubtypeCounts,
    topIngredientsBySubtype: {
      form_raw_missing: toTopList(topIngredientsBySubtype.form_raw_missing),
      taxonomy_mismatch: toTopList(topIngredientsBySubtype.taxonomy_mismatch),
    },
    examples: examples.slice(0, Math.max(50, examples.length)),
    mismatchSourceIds,
    taxonomyMismatchSourceIds,
    formRawMissingSourceIds,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
