import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "lnhpd" | "dsld" | "ocr" | "manual";

type ScoreRow = {
  source_id: string | null;
  explain_json: Record<string, unknown> | null;
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

type ProductSummary = {
  sourceId: string;
  canonicalSourceId: string | null;
  primaryReason: string;
  counts: ProductReasonStats;
  ingredientNames: string[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE = (getArg("source") ?? "lnhpd").toLowerCase() as ScoreSource;
const SOURCE_IDS_FILE = getArg("source-ids-file");
const SOURCE_IDS_OUTPUT = getArg("source-ids-output");
const POOL_IDS_FILE = getArg("pool-ids-file");
const POOL_IDS_OUTPUT = getArg("pool-ids-output");
const LIMIT = Math.max(1, Number(getArg("limit") ?? "1000"));
const RANDOM_SAMPLE = args.includes("--random-sample");
const SEED = Number(getArg("seed") ?? "12345");
const SAMPLE_POOL = Math.max(LIMIT * 5, Number(getArg("sample-pool") ?? "5000"));
const OUTPUT =
  getArg("output") ??
  `output/diagnostics/${SOURCE}_zero_coverage_root_causes.json`;
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

const createSeededRng = (seed: number) => {
  let state = Number.isFinite(seed) ? seed : 12345;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const shuffle = <T>(items: T[], seed: number): T[] => {
  const result = [...items];
  const rng = createSeededRng(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const sortUniqueIds = (ids: string[]): string[] =>
  Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));

const computePoolDigest = (ids: string[]): string =>
  createHash("sha256").update(ids.join("\n")).digest("hex");

const fetchPoolSourceIdsFromDb = async (): Promise<string[]> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("source_id")
    .eq("source", SOURCE)
    .eq("score_version", V4_SCORE_VERSION)
    .order("source_id", { ascending: true })
    .limit(SAMPLE_POOL);
  if (error) throw error;

  return sortUniqueIds(
    (data ?? [])
      .map((row) => row?.source_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
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

const buildStats = (products: ProductSummary[]) => {
  const total = products.length;
  const counts: Record<string, number> = {};
  products.forEach((product) => {
    counts[product.primaryReason] = (counts[product.primaryReason] ?? 0) + 1;
  });
  const ratios: Record<string, number> = {};
  Object.entries(counts).forEach(([reason, count]) => {
    ratios[reason] = total > 0 ? Number((count / total).toFixed(4)) : 0;
  });

  const top20 = products
    .slice()
    .sort((a, b) => {
      const aTotal = Object.values(a.counts).reduce((sum, value) => sum + value, 0);
      const bTotal = Object.values(b.counts).reduce((sum, value) => sum + value, 0);
      return bTotal - aTotal;
    })
    .slice(0, TOP_N);

  const top20ByReason: Record<string, ProductSummary[]> = {};
  ["ingredient_id_missing", "unit_missing", "unit_mismatch", "missingVerified", "mismatch"].forEach(
    (reason) => {
      const items = products
        .filter((product) => product.primaryReason === reason)
        .slice(0, TOP_N);
      if (items.length) top20ByReason[reason] = items;
    },
  );

  return { total, counts, ratios, top20, top20ByReason };
};

const run = async () => {
  if (!SOURCE) throw new Error("Missing --source");

  const sourceIds = SOURCE_IDS_FILE ? await fetchSourceIdsFromFile(SOURCE_IDS_FILE) : [];
  let sampleIds = sourceIds.length ? sourceIds : [];
  let poolIds: string[] = [];
  let poolDigest: string | null = null;
  let poolIdsFile: string | null = null;

  if (!sampleIds.length) {
    if (!RANDOM_SAMPLE) {
      throw new Error("Provide --source-ids-file or pass --random-sample.");
    }

    if (POOL_IDS_FILE) {
      poolIds = sortUniqueIds(await fetchSourceIdsFromFile(POOL_IDS_FILE));
      poolIdsFile = POOL_IDS_FILE;
    } else {
      poolIds = await fetchPoolSourceIdsFromDb();
      if (POOL_IDS_OUTPUT) {
        await ensureDir(POOL_IDS_OUTPUT);
        await writeFile(POOL_IDS_OUTPUT, JSON.stringify(poolIds, null, 2), "utf8");
        poolIdsFile = POOL_IDS_OUTPUT;
      }
    }

    if (!poolIds.length) {
      throw new Error("Pool is empty. Provide --pool-ids-file or check source data.");
    }

    poolDigest = computePoolDigest(poolIds);
    sampleIds = shuffle(poolIds, SEED).slice(0, LIMIT);
    if (SOURCE_IDS_OUTPUT) {
      await ensureDir(SOURCE_IDS_OUTPUT);
      await writeFile(SOURCE_IDS_OUTPUT, JSON.stringify(sampleIds, null, 2), "utf8");
    }
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
        canonicalSourceId: null,
        primaryReason: "unknown",
        counts: {
          ingredientIdMissing: 0,
          unitMissing: 0,
          unitMismatch: 0,
          missingVerified: 0,
          mismatch: 0,
        },
        ingredientNames: [],
      });
    }
    const product = productMap.get(sourceId)!;
    if (row.name_raw) product.ingredientNames.push(row.name_raw);

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
    if (!formRaw) {
      product.counts.mismatch += 1;
      return;
    }

    const candidateNormalized = normalizeText(formRaw);
    if (!candidateNormalized) {
      product.counts.mismatch += 1;
      return;
    }

    const formMatch = verifiedForms.some((form) =>
      formMatchesCandidate(candidateNormalized, form),
    );
    if (formMatch) return;

    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ];
    const aliasMatch = aliasList.some((alias) =>
      aliasMatchesCandidate(candidateNormalized, alias),
    );
    if (!aliasMatch) {
      product.counts.mismatch += 1;
      return;
    }

    product.counts.mismatch += 1;
  });

  const products = Array.from(productMap.values()).map((product) => ({
    ...product,
    primaryReason: resolvePrimaryReason(product.counts),
    ingredientNames: Array.from(new Set(product.ingredientNames)).slice(0, 10),
  }));

  const summary = buildStats(products);

  const payload = {
    source: SOURCE,
    timestamp: new Date().toISOString(),
    sample: {
      mode: SOURCE_IDS_FILE ? "fixed" : "random_sample",
      seed: SOURCE_IDS_FILE ? null : SEED,
      count: sampleIds.length,
      poolSize: SOURCE_IDS_FILE ? null : poolIds.length,
      poolDigest: SOURCE_IDS_FILE ? null : poolDigest,
      poolIdsFile: SOURCE_IDS_FILE ? null : poolIdsFile,
      sourceIdsFile: SOURCE_IDS_FILE ?? SOURCE_IDS_OUTPUT ?? null,
    },
    zeroCoverageCount: products.length,
    summary,
    products,
    definitions: {
      ingredient_id_missing: "At least one active row missing ingredient_id.",
      unit_missing: "At least one active row missing a recognizable unit.",
      unit_mismatch: "At least one active row with unit not matching canonical unit.",
      missingVerified: "Active rows have no verified forms for their ingredient_id.",
      mismatch: "Form raw missing or does not match verified forms/aliases.",
      primaryReason:
        "Primary reason is assigned by precedence: ingredient_id_missing > unit_missing > unit_mismatch > missingVerified > mismatch.",
    },
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, zeroCoverageCount: products.length, summary }, null, 2));
};

run().catch((error) => {
  console.error("[zero-coverage] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
