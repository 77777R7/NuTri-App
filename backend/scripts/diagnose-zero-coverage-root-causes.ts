import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type ScoreSource = "lnhpd" | "dsld" | "ocr" | "manual";

type ScoreRow = {
  source_id: string | null;
  canonical_source_id: string | null;
  explain_json: Record<string, unknown> | null;
};

type IngredientRow = {
  source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
  amount: number | null;
  amount_normalized: number | null;
  amount_unknown: boolean | null;
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
  amountMissing: number;
  missingVerified: number;
  mismatch: number;
};

type ProductRowStats = {
  totalRows: number;
  activeRows: number;
  inactiveRows: number;
  activeRowsWithIngredientId: number;
  activeRowsWithoutIngredientId: number;
  activeRowsKnownDose: number;
  activeRowsAmountMissing: number;
  activeRowsAmountUnknownFlag: number;
  activeRowsFormRawMissing: number;
  activeRowsFormRawPresent: number;
};

type UnknownSubtype =
  | "no_active_rows"
  | "amount_missing_only"
  | "zero_known_dose_unclassified"
  | "unclassified";

type ProductSummary = {
  sourceId: string;
  canonicalSourceId: string | null;
  primaryReason: string;
  unknownSubtype: UnknownSubtype | null;
  counts: ProductReasonStats;
  rowStats: ProductRowStats;
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
const PAGE_SIZE = 1000;

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

const ratio = (count: number, total: number): number =>
  total > 0 ? Number((count / total).toFixed(4)) : 0;

const fetchPoolSourceIdsFromDb = async (): Promise<string[]> => {
  const collected: string[] = [];
  let cursor: string | null = null;

  while (collected.length < SAMPLE_POOL) {
    const remaining = SAMPLE_POOL - collected.length;
    const batchSize = Math.max(1, Math.min(PAGE_SIZE, remaining));
    const baseQuery = supabase
      .from("product_scores")
      .select("source_id")
      .eq("source", SOURCE)
      .eq("score_version", V4_SCORE_VERSION)
      .order("source_id", { ascending: true })
      .limit(batchSize);
    const { data, error } = cursor
      ? await baseQuery.gt("source_id", cursor)
      : await baseQuery;
    if (error) throw error;

    const batch = sortUniqueIds(
      (data ?? [])
        .map((row) => row?.source_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    );
    if (!batch.length) break;

    for (const id of batch) {
      if (collected.length >= SAMPLE_POOL) break;
      if (collected[collected.length - 1] === id) continue;
      collected.push(id);
    }

    cursor = batch[batch.length - 1] ?? cursor;
    if (batch.length < batchSize) break;
  }

  return collected;
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
      .select("source_id,canonical_source_id,explain_json")
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
    // PostgREST enforces `max_rows` (1000). For popular IDs we can exceed that limit,
    // which silently truncates results and creates false `no_ingredient_rows` diagnoses.
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select(
          "id,source_id,ingredient_id,name_raw,form_raw,amount,amount_normalized,amount_unknown,unit,unit_normalized,unit_kind,is_active",
        )
        .eq("source", SOURCE)
        .in("source_id", chunk)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as IngredientRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
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

const resolvePrimaryReason = (product: Pick<ProductSummary, "counts" | "rowStats">): string => {
  if (product.rowStats.totalRows === 0) return "no_ingredient_rows";
  const counts = product.counts;
  if (counts.ingredientIdMissing > 0) return "ingredient_id_missing";
  if (counts.unitMissing > 0) return "unit_missing";
  if (counts.unitMismatch > 0) return "unit_mismatch";
  if (counts.amountMissing > 0) return "amount_missing";
  if (counts.missingVerified > 0) return "missingVerified";
  if (counts.mismatch > 0) return "mismatch";
  return "unknown";
};

const resolveUnknownSubtype = (product: ProductSummary): UnknownSubtype | null => {
  if (product.primaryReason !== "unknown") return null;
  const { rowStats, counts } = product;
  if (rowStats.activeRows === 0) return "no_active_rows";

  if (
    counts.amountMissing > 0 &&
    counts.ingredientIdMissing === 0 &&
    counts.unitMissing === 0 &&
    counts.unitMismatch === 0 &&
    counts.missingVerified === 0 &&
    counts.mismatch === 0
  ) {
    return "amount_missing_only";
  }

  if (rowStats.activeRowsKnownDose === 0) {
    return "zero_known_dose_unclassified";
  }
  return "unclassified";
};

const buildStats = (products: ProductSummary[]) => {
  const total = products.length;
  const reasonOrder = [
    "no_ingredient_rows",
    "ingredient_id_missing",
    "unit_missing",
    "unit_mismatch",
    "amount_missing",
    "missingVerified",
    "mismatch",
    "unknown",
  ];
  const counts: Record<string, number> = {};
  products.forEach((product) => {
    counts[product.primaryReason] = (counts[product.primaryReason] ?? 0) + 1;
  });
  const ratios: Record<string, number> = {};
  Object.entries(counts).forEach(([reason, count]) => {
    ratios[reason] = ratio(count, total);
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
  reasonOrder.forEach((reason) => {
    const items = products
      .filter((product) => product.primaryReason === reason)
      .slice(0, TOP_N);
    if (items.length) top20ByReason[reason] = items;
  });

  const aggregate = products.reduce(
    (acc, product) => {
      acc.totalRows += product.rowStats.totalRows;
      acc.activeRows += product.rowStats.activeRows;
      acc.inactiveRows += product.rowStats.inactiveRows;
      acc.activeRowsKnownDose += product.rowStats.activeRowsKnownDose;
      acc.activeRowsAmountMissing += product.rowStats.activeRowsAmountMissing;
      acc.activeRowsAmountUnknownFlag += product.rowStats.activeRowsAmountUnknownFlag;
      if (product.rowStats.totalRows === 0) acc.productsWithNoRows += 1;
      if (product.rowStats.activeRows === 0) acc.productsWithNoActiveRows += 1;
      if (product.rowStats.activeRows > 0 && product.rowStats.activeRowsKnownDose === 0) {
        acc.productsWithZeroKnownDose += 1;
      }
      return acc;
    },
    {
      totalRows: 0,
      activeRows: 0,
      inactiveRows: 0,
      activeRowsKnownDose: 0,
      activeRowsAmountMissing: 0,
      activeRowsAmountUnknownFlag: 0,
      productsWithNoRows: 0,
      productsWithNoActiveRows: 0,
      productsWithZeroKnownDose: 0,
    },
  );

  const unknownProducts = products.filter((product) => product.primaryReason === "unknown");
  const unknownSubtypeCounts: Record<string, number> = {};
  const unknownSubtypeRatios: Record<string, number> = {};
  const unknownTopBySubtype: Record<
    string,
    Array<Pick<ProductSummary, "sourceId" | "canonicalSourceId" | "counts" | "rowStats" | "ingredientNames">>
  > = {};

  unknownProducts.forEach((product) => {
    const subtype = product.unknownSubtype ?? "unclassified";
    unknownSubtypeCounts[subtype] = (unknownSubtypeCounts[subtype] ?? 0) + 1;
    if (!unknownTopBySubtype[subtype]) {
      unknownTopBySubtype[subtype] = [];
    }
    if (unknownTopBySubtype[subtype].length < TOP_N) {
      unknownTopBySubtype[subtype].push({
        sourceId: product.sourceId,
        canonicalSourceId: product.canonicalSourceId,
        counts: product.counts,
        rowStats: product.rowStats,
        ingredientNames: product.ingredientNames,
      });
    }
  });

  Object.entries(unknownSubtypeCounts).forEach(([subtype, count]) => {
    unknownSubtypeRatios[subtype] = ratio(count, unknownProducts.length);
  });

  return {
    total,
    counts,
    ratios,
    top20,
    top20ByReason,
    rowCoverage: {
      totalRows: aggregate.totalRows,
      activeRows: aggregate.activeRows,
      inactiveRows: aggregate.inactiveRows,
      activeRowRate: ratio(aggregate.activeRows, aggregate.totalRows),
      knownDoseActiveRate: ratio(aggregate.activeRowsKnownDose, aggregate.activeRows),
      amountMissingActiveRate: ratio(aggregate.activeRowsAmountMissing, aggregate.activeRows),
      amountUnknownFlagRate: ratio(aggregate.activeRowsAmountUnknownFlag, aggregate.activeRows),
      productsWithNoRows: aggregate.productsWithNoRows,
      productsWithNoActiveRows: aggregate.productsWithNoActiveRows,
      productsWithZeroKnownDose: aggregate.productsWithZeroKnownDose,
    },
    unknownExplainability: {
      unknownCount: unknownProducts.length,
      subtypeCounts: unknownSubtypeCounts,
      subtypeRatios: unknownSubtypeRatios,
      topBySubtype: unknownTopBySubtype,
    },
  };
};

const run = async () => {
  if (!SOURCE) throw new Error("Missing --source");

  const sourceIds = SOURCE_IDS_FILE
    ? sortUniqueIds(await fetchSourceIdsFromFile(SOURCE_IDS_FILE))
    : [];
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
  const zeroCoverageIds = sortUniqueIds(
    scores
      .filter((row) => {
        const coverageRatio = row.explain_json?.evidence?.formCoverageRatio;
        return typeof coverageRatio === "number" && coverageRatio <= 0;
      })
      .map((row) => row.source_id)
      .filter((value): value is string => typeof value === "string"),
  );

  const scoreBySourceId = new Map<string, ScoreRow>();
  scores.forEach((row) => {
    if (!row.source_id) return;
    scoreBySourceId.set(row.source_id, row);
  });

  const productMap = new Map<string, ProductSummary>();
  zeroCoverageIds.forEach((sourceId) => {
    productMap.set(sourceId, {
      sourceId,
      canonicalSourceId: scoreBySourceId.get(sourceId)?.canonical_source_id ?? null,
      primaryReason: "unknown",
      unknownSubtype: null,
      counts: {
        ingredientIdMissing: 0,
        unitMissing: 0,
        unitMismatch: 0,
        amountMissing: 0,
        missingVerified: 0,
        mismatch: 0,
      },
      rowStats: {
        totalRows: 0,
        activeRows: 0,
        inactiveRows: 0,
        activeRowsWithIngredientId: 0,
        activeRowsWithoutIngredientId: 0,
        activeRowsKnownDose: 0,
        activeRowsAmountMissing: 0,
        activeRowsAmountUnknownFlag: 0,
        activeRowsFormRawMissing: 0,
        activeRowsFormRawPresent: 0,
      },
      ingredientNames: [],
    })
  });

  const zeroCoverageSet = new Set(zeroCoverageIds);
  const ingredients = await fetchIngredients(zeroCoverageIds);
  const activeRows = ingredients.filter((row) => row.is_active === true);
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

  ingredients.forEach((row) => {
    const sourceId = row.source_id;
    if (!sourceId || !zeroCoverageSet.has(sourceId)) return;
    if (!productMap.has(sourceId)) {
      productMap.set(sourceId, {
        sourceId,
        canonicalSourceId: scoreBySourceId.get(sourceId)?.canonical_source_id ?? null,
        primaryReason: "unknown",
        unknownSubtype: null,
        counts: {
          ingredientIdMissing: 0,
          unitMissing: 0,
          unitMismatch: 0,
          amountMissing: 0,
          missingVerified: 0,
          mismatch: 0,
        },
        rowStats: {
          totalRows: 0,
          activeRows: 0,
          inactiveRows: 0,
          activeRowsWithIngredientId: 0,
          activeRowsWithoutIngredientId: 0,
          activeRowsKnownDose: 0,
          activeRowsAmountMissing: 0,
          activeRowsAmountUnknownFlag: 0,
          activeRowsFormRawMissing: 0,
          activeRowsFormRawPresent: 0,
        },
        ingredientNames: [],
      });
    }
    const product = productMap.get(sourceId)!;
    product.rowStats.totalRows += 1;
    if (row.name_raw) {
      product.ingredientNames.push(row.name_raw);
    }

    if (row.is_active !== true) {
      product.rowStats.inactiveRows += 1;
      return;
    }

    product.rowStats.activeRows += 1;
    const formRaw = row.form_raw?.trim() ?? "";
    if (formRaw) {
      product.rowStats.activeRowsFormRawPresent += 1;
    } else {
      product.rowStats.activeRowsFormRawMissing += 1;
    }

    const amountMissing = row.amount == null || row.amount_unknown === true;
    if (row.amount_unknown === true) {
      product.rowStats.activeRowsAmountUnknownFlag += 1;
    }
    if (amountMissing) {
      product.counts.amountMissing += 1;
      product.rowStats.activeRowsAmountMissing += 1;
    }

    if (!row.ingredient_id) {
      product.counts.ingredientIdMissing += 1;
      product.rowStats.activeRowsWithoutIngredientId += 1;
      return;
    }
    product.rowStats.activeRowsWithIngredientId += 1;

    const unitValue = row.unit_normalized ?? row.unit;
    const unitKind = row.unit_kind ?? null;
    const recognizedUnit = isRecognizedUnit(unitValue, unitKind);
    if (!unitValue || !recognizedUnit) {
      product.counts.unitMissing += 1;
    }

    const metaUnit = metaMap.get(row.ingredient_id)?.unit ?? null;
    const unitMatchesMeta = !metaUnit || Boolean(unitValue && unitValue === metaUnit);
    if (metaUnit && unitValue && unitValue !== metaUnit) {
      product.counts.unitMismatch += 1;
    }
    if (!amountMissing && recognizedUnit && unitMatchesMeta) {
      product.rowStats.activeRowsKnownDose += 1;
    }

    const verifiedForms = formsByIngredient.get(row.ingredient_id) ?? [];
    if (!verifiedForms.length) {
      product.counts.missingVerified += 1;
      return;
    }

    const candidateTexts = Array.from(
      new Set([formRaw, row.name_raw?.trim() ?? ""]).values(),
    ).filter((value) => value.length > 0);
    if (!candidateTexts.length) {
      product.counts.mismatch += 1;
      return;
    }

    const candidateNormalizedList = candidateTexts
      .map((candidate) => normalizeText(candidate))
      .filter((candidate) => candidate.length > 0);
    if (!candidateNormalizedList.length) {
      product.counts.mismatch += 1;
      return;
    }

    const formMatch = candidateNormalizedList.some((candidateNormalized) =>
      verifiedForms.some((form) =>
        formMatchesCandidate(candidateNormalized, form),
      ),
    );
    if (formMatch) return;

    const verifiedFormKeys = new Set(verifiedForms.map((form) => form.form_key));
    const aliasList = [
      ...globalAliases,
      ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
    ].filter((alias) => verifiedFormKeys.has(alias.form_key));
    const aliasMatch = candidateNormalizedList.some((candidateNormalized) =>
      aliasList.some((alias) =>
        aliasMatchesCandidate(candidateNormalized, alias),
      ),
    );
    if (!aliasMatch) {
      product.counts.mismatch += 1;
    }
  });

  const products = Array.from(productMap.values()).map((product) => ({
    ...product,
    primaryReason: resolvePrimaryReason(product),
    unknownSubtype: null as UnknownSubtype | null,
    ingredientNames: Array.from(new Set(product.ingredientNames)).slice(0, 10),
  }));
  products.forEach((product) => {
    product.unknownSubtype = resolveUnknownSubtype(product);
  });

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
      no_ingredient_rows:
        "No rows exist in product_ingredients for this product/source_id.",
      ingredient_id_missing: "At least one active row missing ingredient_id.",
      unit_missing: "At least one active row missing a recognizable unit.",
      unit_mismatch: "At least one active row with unit not matching canonical unit.",
      amount_missing:
        "At least one active row has amount missing or amount_unknown=true (known dose cannot be computed).",
      missingVerified: "Active rows have no verified forms for their ingredient_id.",
      mismatch: "Form raw missing or does not match verified forms/aliases.",
      unknown_subtypes: {
        no_active_rows: "Ingredient rows exist but none are active.",
        amount_missing_only:
          "No higher-priority blockers; active rows mainly blocked by missing/unknown amount.",
        zero_known_dose_unclassified:
          "Active rows exist but none qualifies as known dose after unit + amount checks.",
        unclassified: "Unknown after heuristics; inspect product rows directly.",
      },
      primaryReason:
        "Primary reason precedence: no_ingredient_rows > ingredient_id_missing > unit_missing > unit_mismatch > amount_missing > missingVerified > mismatch > unknown.",
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
