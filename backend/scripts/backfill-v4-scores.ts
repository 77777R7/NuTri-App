import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { upsertProductIngredientsFromLabelFacts } from "../src/productIngredients.js";
import { loadDatasetCache, type DatasetCache } from "../src/scoring/v4DatasetCache.js";
import {
  computeDailyMultiplierFromLnhpdFacts,
  computeScoreBundleV4,
  computeScoreBundleV4Cached,
  computeV4InputsHash,
  computeV4InputsHashFromRows,
  createDefaultDailyMultiplier,
  type DailyMultiplierResult,
  type ProductIngredientRow,
  V4_SCORE_VERSION,
} from "../src/scoring/v4ScoreEngine.js";
import { extractErrorMeta, type RetryErrorMeta, withRetry } from "../src/supabaseRetry.js";
import type { ScoreBundleV4, ScoreSource } from "../src/types.js";

type LabelFactsInput = {
  actives: {
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
    lnhpdMeta?: {
      sourceMaterial?: string | null;
      extractTypeDesc?: string | null;
      ratioNumerator?: string | number | null;
      ratioDenominator?: string | number | null;
      potencyConstituent?: string | null;
      potencyAmount?: string | number | null;
      potencyUnit?: string | null;
      driedHerbEquivalent?: string | number | null;
      ingredientName?: string | null;
      properName?: string | null;
    } | null;
  }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
};

type DsldFactsRow = {
  dsld_label_id: number | string | null;
  facts_json: unknown;
};

type LnhpdFactsRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  facts_json: unknown;
};

type FailureEntry = {
  timestamp: string;
  source: ScoreSource;
  sourceId: string;
  canonicalSourceId?: string | null;
  stage: string;
  status: number | null;
  rayId: string | null;
  message: string | null;
  errorCode?: string | null;
  errorDetails?: string | null;
  errorHint?: string | null;
  payloadSummary?: {
    ingredientId: string | null;
    nameKey: string;
    unit: string | null;
    amount: number | null;
    amountNormalized: number | null;
    basis: string | null;
    unitKind: string | null;
    dailyMultiplier: number | null;
  } | null;
  overflowFields?: Record<string, number> | null;
};

type UpsertResult = {
  success: boolean;
  error?: RetryErrorMeta | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const failuresFile =
  getArg("failures-file") ?? process.env.BACKFILL_FAILURES_FILE ?? "backfill-failures.jsonl";
const failuresInput = getArg("failures-input") ?? process.env.BACKFILL_FAILURES_INPUT ?? null;
const failuresForce = hasFlag("failures-force");
const checkpointFile = getArg("checkpoint-file") ?? process.env.BACKFILL_CHECKPOINT_FILE ?? null;
const summaryJson = getArg("summary-json") ?? process.env.BACKFILL_SUMMARY_JSON ?? null;

const failureTracker = {
  baseLines: 0,
  baseBytes: 0,
  lines: 0,
  bytes: 0,
};

let datasetCache: DatasetCache | null = null;
const getDatasetCache = async (): Promise<DatasetCache> => {
  if (!datasetCache) {
    datasetCache = await loadDatasetCache();
  }
  return datasetCache;
};

const ensureFileDir = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const writeJsonFile = async (filePath: string, payload: unknown): Promise<void> => {
  await ensureFileDir(filePath);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
};

const initFailureTracker = async () => {
  if (!failuresFile) return;
  try {
    const content = await readFile(failuresFile, "utf8");
    failureTracker.baseLines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;
    failureTracker.baseBytes = Buffer.byteLength(content, "utf8");
  } catch {
    failureTracker.baseLines = 0;
    failureTracker.baseBytes = 0;
  }
};

const recordFailure = async (entry: FailureEntry): Promise<void> => {
  if (!failuresFile) return;
  const line = `${JSON.stringify(entry)}\n`;
  failureTracker.lines += 1;
  failureTracker.bytes += Buffer.byteLength(line, "utf8");
  await appendFile(failuresFile, line);
};

const loadFailureEntries = async (filePath: string): Promise<FailureEntry[]> => {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as FailureEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is FailureEntry => Boolean(entry?.source && entry?.sourceId));
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith("mcg") ||
    normalized.startsWith("ug") ||
    normalized.startsWith("\u00b5g") ||
    normalized.startsWith("\u03bcg") ||
    normalized.startsWith("microgram")
  ) {
    return "mcg";
  }
  if (normalized.startsWith("mg") || normalized.startsWith("milligram")) return "mg";
  if (normalized.startsWith("g") || normalized.startsWith("gram")) return "g";
  if (normalized.startsWith("iu") || normalized.startsWith("i.u")) return "iu";
  if (normalized.startsWith("ml") || normalized.startsWith("milliliter") || normalized.startsWith("millilitre")) {
    return "ml";
  }
  if (normalized.includes("cfu") || normalized.includes("ufc")) return "cfu";
  if (normalized.startsWith("kcal")) return "kcal";
  if (normalized.startsWith("cal")) return "cal";
  if (normalized.startsWith("%") || normalized.includes("percent")) return "%";
  return normalized;
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes("cfu") && !unitLower.includes("ufc")) return null;
  if (unitLower.includes("trillion")) return 1_000_000_000_000;
  if (unitLower.includes("billion")) return 1_000_000_000;
  if (unitLower.includes("million")) return 1_000_000;
  return 1;
};

const normalizeAmountAndUnit = (
  amount: number | null,
  unitRaw?: string | null,
): { amount: number | null; unit: string | null } => {
  if (!unitRaw) return { amount, unit: null };
  const normalizedUnit = normalizeUnitLabel(unitRaw) ?? unitRaw.trim();
  if (amount == null) return { amount, unit: normalizedUnit };
  const unitLower = unitRaw.trim().toLowerCase();
  const cfuMultiplier = parseCfuMultiplier(unitLower);
  if (cfuMultiplier) {
    return { amount: amount * cfuMultiplier, unit: "cfu" };
  }
  return { amount, unit: normalizedUnit };
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const fetchProductIngredientRows = async (
  source: ScoreSource,
  sourceId: string,
): Promise<
  | { rows: ProductIngredientRow[]; sourceIdForWrite: string; canonicalSourceId: string | null }
  | { error: RetryErrorMeta }
  | null
> => {
  const selectColumns =
    "source_id,canonical_source_id,ingredient_id,name_raw,name_key,amount,unit,amount_normalized,unit_normalized,unit_kind,amount_unknown,is_active,is_proprietary_blend,parse_confidence,basis,form_raw";

  const directResult = await withRetry<ProductIngredientRow[]>(() =>
    supabase
      .from("product_ingredients")
      .select(selectColumns)
      .eq("source", source)
      .eq("source_id", sourceId),
  );
  if (directResult.error) {
    return { error: extractErrorMeta(directResult.error, directResult.status, directResult.rayId) };
  }
  if (directResult.data && directResult.data.length > 0) {
    const sourceIdForWrite = directResult.data[0]?.source_id ?? sourceId;
    const canonicalSourceId = directResult.data[0]?.canonical_source_id ?? null;
    return {
      rows: directResult.data as ProductIngredientRow[],
      sourceIdForWrite,
      canonicalSourceId,
    };
  }

  const canonicalResult = await withRetry<ProductIngredientRow[]>(() =>
    supabase
      .from("product_ingredients")
      .select(selectColumns)
      .eq("source", source)
      .eq("canonical_source_id", sourceId),
  );
  if (canonicalResult.error) {
    return {
      error: extractErrorMeta(canonicalResult.error, canonicalResult.status, canonicalResult.rayId),
    };
  }
  if (canonicalResult.data && canonicalResult.data.length > 0) {
    const sourceIdForWrite = canonicalResult.data[0]?.source_id ?? sourceId;
    const canonicalSourceId = canonicalResult.data[0]?.canonical_source_id ?? null;
    return {
      rows: canonicalResult.data as ProductIngredientRow[],
      sourceIdForWrite,
      canonicalSourceId,
    };
  }

  return null;
};

const computeDailyMultiplierForLnhpdRow = (
  row: LnhpdFactsRow,
  canonicalSourceId: string | null,
): DailyMultiplierResult => {
  if (!canonicalSourceId) {
    return {
      multiplier: 1,
      source: "default_missing_canonical",
      reliability: "default",
      lnhpdIdUsedForDoseLookup: null,
      doseRowsFound: 0,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: "missing_canonical_id",
    };
  }
  if (!row.facts_json || typeof row.facts_json !== "object") {
    return {
      multiplier: 1,
      source: "default_no_dosing_info",
      reliability: "default",
      lnhpdIdUsedForDoseLookup: canonicalSourceId,
      doseRowsFound: 0,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: "missing_facts",
    };
  }
  const computed = computeDailyMultiplierFromLnhpdFacts(row.facts_json as Record<string, unknown>);
  return {
    ...computed,
    lnhpdIdUsedForDoseLookup: canonicalSourceId,
  };
};

const pickStringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const pickNameField = (record: Record<string, unknown>, keys: string[]): string | null => {
  const direct = pickStringField(record, keys);
  if (direct) return direct;
  for (const [key, value] of Object.entries(record)) {
    if (!key.toLowerCase().includes("name")) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const pickNumberField = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const parsed = parseNumber(record[key]);
    if (parsed != null) return parsed;
  }
  return null;
};

const pickScalarField = (
  record: Record<string, unknown>,
  keys: string[],
): string | number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
};

const extractTextList = (payload: unknown, nameKeys: string[]): string[] => {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  payload.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const name = pickNameField(item as Record<string, unknown>, nameKeys);
    if (!name) return;
    const normalized = normalizeNameKey(name);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(name);
  });
  return output;
};

const extractLnhpdIngredients = (payload: unknown, options: {
  nameKeys: string[];
  amountKeys: string[];
  unitKeys: string[];
}): { name: string; amount: number | null; unit: string | null; lnhpdMeta?: LabelFactsInput["actives"][number]["lnhpdMeta"] }[] => {
  if (!Array.isArray(payload)) return [];
  const map = new Map<string, { name: string; amount: number | null; unit: string | null; lnhpdMeta?: LabelFactsInput["actives"][number]["lnhpdMeta"] }>();
  const scoreLnhpdMeta = (meta?: LabelFactsInput["actives"][number]["lnhpdMeta"] | null): number => {
    if (!meta) return 0;
    let score = 0;
    if (meta.sourceMaterial) score += 3;
    if (meta.properName) score += 2;
    if (meta.extractTypeDesc) score += 2;
    if (meta.ratioNumerator != null && meta.ratioDenominator != null) score += 2;
    if (meta.potencyConstituent) score += 2;
    if (meta.potencyAmount != null) score += 1;
    if (meta.potencyUnit) score += 1;
    if (meta.driedHerbEquivalent != null) score += 1;
    if (meta.ingredientName) score += 1;
    return score;
  };
  const pickLnhpdMeta = (
    current?: LabelFactsInput["actives"][number]["lnhpdMeta"] | null,
    candidate?: LabelFactsInput["actives"][number]["lnhpdMeta"] | null,
  ): LabelFactsInput["actives"][number]["lnhpdMeta"] | null => {
    if (!candidate) return current ?? null;
    if (!current) return candidate;
    return scoreLnhpdMeta(candidate) > scoreLnhpdMeta(current) ? candidate : current;
  };
  payload.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const name = pickNameField(record, options.nameKeys);
    if (!name) return;
    const amount = pickNumberField(record, options.amountKeys);
    const unitRaw = pickStringField(record, options.unitKeys);
    const { amount: normalizedAmount, unit } = normalizeAmountAndUnit(amount, unitRaw);
    const key = normalizeNameKey(name);
    if (!key) return;
    const existing = map.get(key);
    const lnhpdMeta = (() => {
      const ingredientName = pickStringField(record, [
        "ingredient_name",
        "ingredient_name_en",
        "medicinal_ingredient_name",
        "medicinal_ingredient_name_en",
      ]);
      const properName = pickStringField(record, ["proper_name"]);
      const sourceMaterial = pickStringField(record, LNHPD_SOURCE_MATERIAL_KEYS);
      const extractTypeDesc = pickStringField(record, LNHPD_EXTRACT_TYPE_KEYS);
      const ratioNumerator = pickScalarField(record, LNHPD_RATIO_NUMERATOR_KEYS);
      const ratioDenominator = pickScalarField(record, LNHPD_RATIO_DENOMINATOR_KEYS);
      const potencyConstituent = pickStringField(record, LNHPD_POTENCY_CONSTITUENT_KEYS);
      const potencyAmount = pickScalarField(record, LNHPD_POTENCY_AMOUNT_KEYS);
      const potencyUnit = pickStringField(record, LNHPD_POTENCY_UNIT_KEYS);
      const driedHerbEquivalent = pickScalarField(record, LNHPD_DHE_KEYS);
      const hasValue =
        sourceMaterial ||
        extractTypeDesc ||
        ratioNumerator != null ||
        ratioDenominator != null ||
        potencyConstituent ||
        potencyAmount != null ||
        potencyUnit ||
        driedHerbEquivalent != null ||
        ingredientName ||
        properName;
      if (!hasValue) return null;
      return {
        sourceMaterial,
        extractTypeDesc,
        ratioNumerator,
        ratioDenominator,
        potencyConstituent,
        potencyAmount,
        potencyUnit,
        driedHerbEquivalent,
        ingredientName,
        properName,
      };
    })();
    const candidate = {
      name,
      amount: normalizedAmount ?? null,
      unit: unit ?? null,
      lnhpdMeta,
    };
    if (!existing) {
      map.set(key, candidate);
      return;
    }
    const nextMeta = pickLnhpdMeta(existing.lnhpdMeta ?? null, candidate.lnhpdMeta ?? null);
    if (nextMeta && nextMeta !== existing.lnhpdMeta) {
      existing.lnhpdMeta = nextMeta;
    }
    if (existing.amount == null && candidate.amount != null) {
      existing.amount = candidate.amount;
      existing.unit = candidate.unit;
    } else if (!existing.unit && candidate.unit) {
      existing.unit = candidate.unit;
    }
  });
  return Array.from(map.values());
};

const LNHPD_MEDICINAL_NAME_KEYS = [
  "medicinal_ingredient_name",
  "ingredient_name",
  "medicinal_ingredient_name_en",
  "ingredient_name_en",
  "proper_name",
  "substance_name",
  "name",
];

const LNHPD_NON_MEDICINAL_NAME_KEYS = [
  "nonmedicinal_ingredient_name",
  "non_medicinal_ingredient_name",
  "ingredient_name",
  "name",
];

const LNHPD_AMOUNT_KEYS = [
  "quantity",
  "quantity_value",
  "quantity_amount",
  "strength",
  "strength_value",
  "amount",
  "dose",
  "dosage",
];

const LNHPD_UNIT_KEYS = [
  "quantity_unit",
  "quantity_unit_of_measure",
  "unit",
  "unit_of_measure",
  "strength_unit",
  "dose_unit",
  "dosage_unit",
];

const LNHPD_SOURCE_MATERIAL_KEYS = [
  "source_material",
  "source_material_desc",
  "source_material_name",
  "source_material_en",
];
const LNHPD_EXTRACT_TYPE_KEYS = ["extract_type_desc", "extract_type", "extract_type_en"];
const LNHPD_RATIO_NUMERATOR_KEYS = ["ratio_numerator", "ratio_numerator_value"];
const LNHPD_RATIO_DENOMINATOR_KEYS = ["ratio_denominator", "ratio_denominator_value"];
const LNHPD_POTENCY_CONSTITUENT_KEYS = ["potency_constituent", "potency_constituent_desc"];
const LNHPD_POTENCY_AMOUNT_KEYS = ["potency_amount", "potency_amount_value"];
const LNHPD_POTENCY_UNIT_KEYS = ["potency_unit", "potency_unit_of_measure", "potency_uom"];
const LNHPD_DHE_KEYS = ["dried_herb_equivalent", "dried_herb_equivalent_value"];

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/;|•/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const buildDsldLabelFacts = (factsJson: unknown): LabelFactsInput | null => {
  if (!factsJson || typeof factsJson !== "object") return null;
  const record = factsJson as Record<string, unknown>;
  const activesRaw = Array.isArray(record.actives) ? record.actives : [];
  const actives = activesRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as { name?: unknown }).name === "string" ? String((item as { name?: unknown }).name).trim() : "";
      if (!name) return null;
      const amount = parseNumber((item as { amount?: unknown }).amount);
      const unit = typeof (item as { unit?: unknown }).unit === "string" ? String((item as { unit?: unknown }).unit).trim() : null;
      return { name, amount, unit };
    })
    .filter((item): item is { name: string; amount: number | null; unit: string | null } => Boolean(item));

  const inactive = normalizeStringList(record.inactive);

  const blendsRaw = Array.isArray(record.proprietaryBlends) ? record.proprietaryBlends : [];
  const proprietaryBlends = blendsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof (item as { name?: unknown }).name === "string" ? String((item as { name?: unknown }).name).trim() : "";
      if (!name) return null;
      const totalAmount = parseNumber((item as { totalAmount?: unknown }).totalAmount);
      const unit = typeof (item as { unit?: unknown }).unit === "string" ? String((item as { unit?: unknown }).unit).trim() : null;
      const ingredients = normalizeStringList((item as { ingredients?: unknown }).ingredients);
      return {
        name,
        totalAmount,
        unit,
        ingredients: ingredients.length ? ingredients : null,
      };
    })
    .filter((item): item is LabelFactsInput["proprietaryBlends"][number] => Boolean(item));

  return {
    actives,
    inactive,
    proprietaryBlends,
  };
};

const buildLnhpdLabelFacts = (factsJson: unknown): LabelFactsInput | null => {
  if (!factsJson || typeof factsJson !== "object") return null;
  const record = factsJson as Record<string, unknown>;
  const actives = extractLnhpdIngredients(record.medicinalIngredients, {
    nameKeys: LNHPD_MEDICINAL_NAME_KEYS,
    amountKeys: LNHPD_AMOUNT_KEYS,
    unitKeys: LNHPD_UNIT_KEYS,
  });
  const inactive = extractTextList(record.nonMedicinalIngredients, LNHPD_NON_MEDICINAL_NAME_KEYS);

  return {
    actives,
    inactive,
    proprietaryBlends: [],
  };
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
};

type BackfillStats = {
  processed: number;
  writtenIngredients: number;
  writtenScores: number;
  skipped: number;
  skippedExisting: number;
  failed: number;
  ingredientUpsertFailed: number;
  scoreUpsertFailed: number;
  computeScoreFailed: number;
};

const reportFailure = async (params: {
  source: ScoreSource;
  sourceId: string;
  canonicalSourceId?: string | null;
  stage: string;
  error?: RetryErrorMeta | null;
  message?: string | null;
  payloadSummary?: FailureEntry["payloadSummary"] | null;
  overflowFields?: FailureEntry["overflowFields"] | null;
}) => {
  const meta = params.error ?? null;
  await recordFailure({
    timestamp: new Date().toISOString(),
    source: params.source,
    sourceId: params.sourceId,
    canonicalSourceId: params.canonicalSourceId ?? null,
    stage: params.stage,
    status: meta?.status ?? null,
    rayId: meta?.rayId ?? null,
    message: meta?.message ?? params.message ?? null,
    errorCode: meta?.code ?? null,
    errorDetails: meta?.details ?? null,
    errorHint: meta?.hint ?? null,
    payloadSummary: params.payloadSummary ?? null,
    overflowFields: params.overflowFields ?? null,
  });
};

const handleDsldRow = async (
  row: DsldFactsRow,
  stats: BackfillStats,
  options?: { forceRunAll?: boolean; forceScores?: boolean },
): Promise<void> => {
  const forceRunAll = options?.forceRunAll ?? false;
  const forceScores = options?.forceScores ?? false;
  const effectiveDryRun = dryRun && !forceRunAll;
  const runIngredients = !effectiveDryRun && (!skipIngredients || forceRunAll);
  const runScores = !skipScores || forceRunAll;
  const labelId = parseNumber(row.dsld_label_id);
  if (!labelId) {
    stats.skipped += 1;
    return;
  }

  const labelFacts = buildDsldLabelFacts(row.facts_json);
  if (!labelFacts || (!labelFacts.actives.length && !labelFacts.inactive.length && !labelFacts.proprietaryBlends.length)) {
    stats.skipped += 1;
    return;
  }

  const sourceId = String(labelId);
  const canonicalSourceId = sourceId;

  if (runIngredients) {
    const ingredientResult = await upsertProductIngredientsFromLabelFacts({
      source: "dsld",
      sourceId,
      canonicalSourceId,
      labelFacts,
      basis: "label_serving",
      parseConfidence: 0.9,
    });
    if (!ingredientResult.success) {
      stats.failed += 1;
      stats.ingredientUpsertFailed += 1;
      await reportFailure({
        source: "dsld",
        sourceId,
        canonicalSourceId,
        stage: "product_ingredients_upsert",
        error: ingredientResult.error ?? null,
        payloadSummary: ingredientResult.errorContext?.payloadSummary ?? null,
        overflowFields: ingredientResult.errorContext?.overflowFields ?? null,
      });
      return;
    }
    stats.writtenIngredients += 1;
  }

  if (!runScores) return;
  const ingredientRowsResult = await fetchProductIngredientRows("dsld", sourceId);
  if (!ingredientRowsResult) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "dsld",
      sourceId,
      canonicalSourceId,
      stage: "product_ingredients_fetch",
      message: "product_ingredients not found",
    });
    return;
  }
  if ("error" in ingredientRowsResult) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "dsld",
      sourceId,
      canonicalSourceId,
      stage: "product_ingredients_fetch",
      error: ingredientRowsResult.error,
    });
    return;
  }

  const { rows: ingredientRows, sourceIdForWrite, canonicalSourceId: resolvedCanonical } =
    ingredientRowsResult;
  const cache = await getDatasetCache();
  const dailyMultiplier = createDefaultDailyMultiplier();
  const currentHash = computeV4InputsHashFromRows(ingredientRows, {
    dailyMultiplier: dailyMultiplier.multiplier,
    dailyMultiplierSource: dailyMultiplier.source,
    datasetVersion: cache.datasetVersion,
  });

  if (!force && !forceScores && (await shouldSkipExistingScore("dsld", sourceId, currentHash))) {
    stats.skippedExisting += 1;
    return;
  }
  if (effectiveDryRun) {
    stats.writtenScores += 1;
    return;
  }

  let computed: Awaited<ReturnType<typeof computeScoreBundleV4Cached>>;
  try {
    computed = await computeScoreBundleV4Cached({
      rows: ingredientRows,
      source: "dsld",
      sourceId,
      sourceIdForWrite,
      canonicalSourceId: resolvedCanonical ?? canonicalSourceId,
      dailyMultiplier,
      cache,
    });
  } catch (error) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "dsld",
      sourceId,
      canonicalSourceId,
      stage: "compute_score",
      message: (error as { message?: string })?.message ?? "score computation failed",
    });
    return;
  }

  const scoreResult = await upsertScoreBundle({
    source: "dsld",
    sourceIdForWrite: computed.sourceIdForWrite,
    canonicalSourceId: computed.canonicalSourceId,
    bundle: computed.bundle,
    inputsHash: computed.inputsHash,
  });
  if (!scoreResult.success) {
    stats.failed += 1;
    stats.scoreUpsertFailed += 1;
    await reportFailure({
      source: "dsld",
      sourceId,
      canonicalSourceId,
      stage: "product_scores_upsert",
      error: scoreResult.error ?? null,
    });
    return;
  }
  stats.writtenScores += 1;
};

const handleLnhpdRow = async (
  row: LnhpdFactsRow,
  stats: BackfillStats,
  options?: { forceRunAll?: boolean; forceScores?: boolean },
): Promise<void> => {
  const forceRunAll = options?.forceRunAll ?? false;
  const forceScores = options?.forceScores ?? false;
  const effectiveDryRun = dryRun && !forceRunAll;
  const runIngredients = !effectiveDryRun && (!skipIngredients || forceRunAll);
  const runScores = !skipScores || forceRunAll;
  const lnhpdId = parseNumber(row.lnhpd_id);
  if (!lnhpdId) {
    stats.skipped += 1;
    return;
  }
  const labelFacts = buildLnhpdLabelFacts(row.facts_json);
  if (!labelFacts || (!labelFacts.actives.length && !labelFacts.inactive.length)) {
    stats.skipped += 1;
    return;
  }

  const sourceId = row.npn?.trim() || String(lnhpdId);
  const canonicalSourceId = String(lnhpdId);

  if (runIngredients) {
    const ingredientResult = await upsertProductIngredientsFromLabelFacts({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      labelFacts,
      basis: "label_serving",
      parseConfidence: 0.95,
    });
    if (!ingredientResult.success) {
      stats.failed += 1;
      stats.ingredientUpsertFailed += 1;
      await reportFailure({
        source: "lnhpd",
        sourceId,
        canonicalSourceId,
        stage: "product_ingredients_upsert",
        error: ingredientResult.error ?? null,
        payloadSummary: ingredientResult.errorContext?.payloadSummary ?? null,
        overflowFields: ingredientResult.errorContext?.overflowFields ?? null,
      });
      return;
    }
    stats.writtenIngredients += 1;
  }

  if (!runScores) return;
  const ingredientRowsResult = await fetchProductIngredientRows("lnhpd", sourceId);
  if (!ingredientRowsResult) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      stage: "product_ingredients_fetch",
      message: "product_ingredients not found",
    });
    return;
  }
  if ("error" in ingredientRowsResult) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      stage: "product_ingredients_fetch",
      error: ingredientRowsResult.error,
    });
    return;
  }

  const { rows: ingredientRows, sourceIdForWrite, canonicalSourceId: resolvedCanonical } =
    ingredientRowsResult;
  const cache = await getDatasetCache();
  const dailyMultiplier = computeDailyMultiplierForLnhpdRow(
    row,
    resolvedCanonical ?? canonicalSourceId,
  );
  const currentHash = computeV4InputsHashFromRows(ingredientRows, {
    dailyMultiplier: dailyMultiplier.multiplier,
    dailyMultiplierSource: dailyMultiplier.source,
    datasetVersion: cache.datasetVersion,
  });

  if (!force && !forceScores && (await shouldSkipExistingScore("lnhpd", sourceId, currentHash))) {
    stats.skippedExisting += 1;
    return;
  }
  if (effectiveDryRun) {
    stats.writtenScores += 1;
    return;
  }

  let computed: Awaited<ReturnType<typeof computeScoreBundleV4Cached>>;
  try {
    computed = await computeScoreBundleV4Cached({
      rows: ingredientRows,
      source: "lnhpd",
      sourceId,
      sourceIdForWrite,
      canonicalSourceId: resolvedCanonical ?? canonicalSourceId,
      dailyMultiplier,
      cache,
    });
  } catch (error) {
    stats.failed += 1;
    stats.computeScoreFailed += 1;
    await reportFailure({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      stage: "compute_score",
      message: (error as { message?: string })?.message ?? "score computation failed",
    });
    return;
  }

  const scoreResult = await upsertScoreBundle({
    source: "lnhpd",
    sourceIdForWrite: computed.sourceIdForWrite,
    canonicalSourceId: computed.canonicalSourceId,
    bundle: computed.bundle,
    inputsHash: computed.inputsHash,
  });
  if (!scoreResult.success) {
    stats.failed += 1;
    stats.scoreUpsertFailed += 1;
    await reportFailure({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      stage: "product_scores_upsert",
      error: scoreResult.error ?? null,
    });
    return;
  }
  stats.writtenScores += 1;
};

const upsertScoreBundle = async (params: {
  source: ScoreSource;
  sourceIdForWrite: string;
  canonicalSourceId: string | null;
  bundle: ScoreBundleV4;
  inputsHash: string;
}): Promise<UpsertResult> => {
  const payload = {
    source: params.source,
    source_id: params.sourceIdForWrite,
    canonical_source_id: params.canonicalSourceId,
    score_version: V4_SCORE_VERSION,
    overall_score: params.bundle.overallScore,
    effectiveness_score: params.bundle.pillars.effectiveness,
    safety_score: params.bundle.pillars.safety,
    integrity_score: params.bundle.pillars.integrity,
    confidence: params.bundle.confidence,
    best_fit_goals: params.bundle.bestFitGoals,
    flags_json: params.bundle.flags,
    highlights_json: params.bundle.highlights,
    explain_json: params.bundle.explain,
    inputs_hash: params.inputsHash,
    computed_at: params.bundle.provenance.computedAt,
  };
  const { error, status, rayId } = await withRetry(() =>
    supabase.from("product_scores").upsert(payload, { onConflict: "source,source_id" }),
  );
  if (error) {
    return { success: false, error: extractErrorMeta(error, status, rayId) };
  }
  return { success: true };
};

const shouldSkipExistingScore = async (
  source: ScoreSource,
  sourceId: string,
  currentHash?: string | null,
): Promise<boolean> => {
  const { data, error } = await supabase
    .from("product_scores")
    .select("id,score_version,inputs_hash")
    .eq("source", source)
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error || !data) return false;
  if (data.score_version !== V4_SCORE_VERSION || !data.inputs_hash) return false;
  const hashValue =
    currentHash ?? (await computeV4InputsHash({ source, sourceId }));
  if (!hashValue) return false;
  return data.inputs_hash === hashValue;
};

const batchSize = Math.max(1, Number(getArg("batch") ?? process.env.BACKFILL_BATCH_SIZE ?? "100"));
const limit = Math.max(0, Number(getArg("limit") ?? process.env.BACKFILL_LIMIT ?? "0"));
const concurrency = Math.max(1, Number(getArg("concurrency") ?? process.env.BACKFILL_CONCURRENCY ?? "2"));
const sourceArg = (getArg("source") ?? "all").toLowerCase();
const startId = Number(getArg("start-id") ?? "0");
const startDsldId = Number(getArg("start-dsld-id") ?? String(startId ?? 0));
const startLnhpdId = Number(getArg("start-lnhpd-id") ?? String(startId ?? 0));
const endDsldId = parseNumber(getArg("end-dsld-id")) ?? null;
const endLnhpdId = parseNumber(getArg("end-lnhpd-id")) ?? null;
const timeBudgetSeconds = Math.max(
  0,
  Number(getArg("time-budget-seconds") ?? process.env.BACKFILL_TIME_BUDGET_SECONDS ?? "0"),
);
const dryRun = hasFlag("dry-run");
const skipScores = hasFlag("skip-scores");
const skipIngredients = hasFlag("skip-ingredients");
const force = hasFlag("force");
const compareCached = hasFlag("compare-cached");
const compareLimit = Math.max(1, Number(getArg("compare-limit") ?? "10"));

const targetSources: ScoreSource[] = sourceArg === "all"
  ? ["dsld", "lnhpd"]
  : sourceArg === "dsld"
    ? ["dsld"]
    : sourceArg === "lnhpd"
      ? ["lnhpd"]
      : [];

if (targetSources.length === 0) {
  console.error(`[backfill] invalid source: ${sourceArg}`);
  process.exit(1);
}

const timeBudgetMs = timeBudgetSeconds > 0 ? timeBudgetSeconds * 1000 : 0;

const reachedTimeBudget = (startTime: number): boolean =>
  timeBudgetMs > 0 && Date.now() - startTime >= timeBudgetMs;

const summarizeStats = (stats: BackfillStats) => ({
  processed: stats.processed,
  scores: stats.writtenScores,
  existing: stats.skippedExisting,
  skipped: stats.skipped,
  failed: stats.failed,
  ingredientUpsertFailed: stats.ingredientUpsertFailed,
  scoreUpsertFailed: stats.scoreUpsertFailed,
  computeScoreFailed: stats.computeScoreFailed,
});

const writeCheckpoint = async (payload: {
  source: ScoreSource;
  startId: number;
  endId: number | null;
  nextStart: number | null;
  lastId: number | null;
  stats: BackfillStats;
}) => {
  if (!checkpointFile) return;
  const existing = (await readJsonFile<Record<string, unknown>>(checkpointFile)) ?? {};
  const updated = {
    ...existing,
    [payload.source]: {
      scoreVersion: V4_SCORE_VERSION,
      startId: payload.startId,
      endId: payload.endId,
      lastId: payload.lastId,
      nextStart: payload.nextStart,
      updatedAt: new Date().toISOString(),
      stats: summarizeStats(payload.stats),
    },
  };
  await writeJsonFile(checkpointFile, updated);
};

const writeSummary = async (payload: {
  source: ScoreSource;
  startId: number;
  endId: number | null;
  lastId: number | null;
  nextStart: number | null;
  stats: BackfillStats;
  elapsedMs: number;
}) => {
  if (!summaryJson) return;
  const summary = {
    mode: "batch",
    source: payload.source,
    scoreVersion: V4_SCORE_VERSION,
    startId: payload.startId || null,
    endId: payload.endId ?? null,
    limit: limit > 0 ? limit : null,
    ...summarizeStats(payload.stats),
    failuresFile: failuresFile ?? null,
    failuresLines: failureTracker.baseLines + failureTracker.lines,
    lastId: payload.lastId,
    nextStart: payload.nextStart,
    elapsedMs: payload.elapsedMs,
  };
  await writeJsonFile(summaryJson, summary);
};

const writeFailuresSummary = async (payload: {
  failuresInput: string;
  stats: BackfillStats;
  elapsedMs: number;
}) => {
  if (!summaryJson) return;
  const summary = {
    mode: "failures-input",
    failuresInput: payload.failuresInput,
    scoreVersion: V4_SCORE_VERSION,
    processed: payload.stats.processed,
    scores: payload.stats.writtenScores,
    failed: payload.stats.failed,
    ingredientUpsertFailed: payload.stats.ingredientUpsertFailed,
    scoreUpsertFailed: payload.stats.scoreUpsertFailed,
    computeScoreFailed: payload.stats.computeScoreFailed,
    failuresFile: failuresFile ?? null,
    failuresLines: failureTracker.baseLines + failureTracker.lines,
    elapsedMs: payload.elapsedMs,
  };
  await writeJsonFile(summaryJson, summary);
};

const backfillDsld = async () => {
  const stats: BackfillStats = {
    processed: 0,
    writtenIngredients: 0,
    writtenScores: 0,
    skipped: 0,
    skippedExisting: 0,
    failed: 0,
    ingredientUpsertFailed: 0,
    scoreUpsertFailed: 0,
    computeScoreFailed: 0,
  };
  const startTime = Date.now();
  let lastId = startDsldId;
  let useGte = startDsldId > 0;
  let batch = 0;
  let nextStart: number | null = startDsldId > 0 ? startDsldId : null;

  while (true) {
    if (reachedTimeBudget(startTime)) break;
    if (endDsldId != null && endDsldId > 0 && lastId > endDsldId) break;
    let query = supabase
      .from("dsld_label_facts")
      .select("dsld_label_id,facts_json")
      .order("dsld_label_id", { ascending: true })
      .limit(batchSize);

    if (useGte) {
      query = query.gte("dsld_label_id", lastId);
    } else if (lastId > 0) {
      query = query.gt("dsld_label_id", lastId);
    }
    if (endDsldId != null && endDsldId > 0) {
      query = query.lte("dsld_label_id", endDsldId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`dsld_label_facts read failed: ${error.message}`);
    }

    const rows = (data ?? []) as DsldFactsRow[];
    if (rows.length === 0) break;

    batch += 1;
    stats.processed += rows.length;
    lastId = parseNumber(rows[rows.length - 1]?.dsld_label_id) ?? lastId;
    useGte = false;
    nextStart = lastId > 0 ? lastId + 1 : nextStart;

    await runWithConcurrency(rows, concurrency, async (row) => {
      await handleDsldRow(row, stats);
    });

    console.log(
      `[backfill:dsld] batch=${batch} processed=${stats.processed} ingredients=${stats.writtenIngredients} scores=${stats.writtenScores} existing=${stats.skippedExisting} skipped=${stats.skipped} failed=${stats.failed} ingredientUpsertFailed=${stats.ingredientUpsertFailed} scoreUpsertFailed=${stats.scoreUpsertFailed} computeScoreFailed=${stats.computeScoreFailed} failuresLines=${failureTracker.baseLines + failureTracker.lines} failuresBytes=${failureTracker.baseBytes + failureTracker.bytes}`,
    );

    await writeCheckpoint({
      source: "dsld",
      startId: startDsldId,
      endId: endDsldId,
      nextStart,
      lastId: lastId || null,
      stats,
    });

    if (limit > 0 && stats.processed >= limit) break;
    if (endDsldId != null && endDsldId > 0 && lastId >= endDsldId) break;
    if (reachedTimeBudget(startTime)) break;
  }

  await writeSummary({
    source: "dsld",
    startId: startDsldId,
    endId: endDsldId,
    lastId: stats.processed > 0 ? lastId : null,
    nextStart: stats.processed > 0 ? nextStart : startDsldId || null,
    stats,
    elapsedMs: Date.now() - startTime,
  });

  console.log(
    `[backfill:dsld] done processed=${stats.processed} ingredients=${stats.writtenIngredients} scores=${stats.writtenScores} existing=${stats.skippedExisting} skipped=${stats.skipped} failed=${stats.failed} ingredientUpsertFailed=${stats.ingredientUpsertFailed} scoreUpsertFailed=${stats.scoreUpsertFailed} computeScoreFailed=${stats.computeScoreFailed} failuresLines=${failureTracker.baseLines + failureTracker.lines} failuresBytes=${failureTracker.baseBytes + failureTracker.bytes}`,
  );
};

const resolveLnhpdTable = async (): Promise<string> => {
  const { data, error } = await supabase
    .from("lnhpd_facts_complete")
    .select("lnhpd_id")
    .limit(1);
  if (!error && data) return "lnhpd_facts_complete";
  return "lnhpd_facts";
};

const backfillLnhpd = async () => {
  const stats: BackfillStats = {
    processed: 0,
    writtenIngredients: 0,
    writtenScores: 0,
    skipped: 0,
    skippedExisting: 0,
    failed: 0,
    ingredientUpsertFailed: 0,
    scoreUpsertFailed: 0,
    computeScoreFailed: 0,
  };
  const startTime = Date.now();
  let lastId = startLnhpdId;
  let useGte = startLnhpdId > 0;
  let batch = 0;
  const table = await resolveLnhpdTable();
  let nextStart: number | null = startLnhpdId > 0 ? startLnhpdId : null;

  while (true) {
    if (reachedTimeBudget(startTime)) break;
    if (endLnhpdId != null && endLnhpdId > 0 && lastId > endLnhpdId) break;
    let query = supabase
      .from(table)
      .select("lnhpd_id,npn,facts_json")
      .order("lnhpd_id", { ascending: true })
      .limit(batchSize);

    if (useGte) {
      query = query.gte("lnhpd_id", lastId);
    } else if (lastId > 0) {
      query = query.gt("lnhpd_id", lastId);
    }
    if (endLnhpdId != null && endLnhpdId > 0) {
      query = query.lte("lnhpd_id", endLnhpdId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`${table} read failed: ${error.message}`);
    }

    const rows = (data ?? []) as LnhpdFactsRow[];
    if (rows.length === 0) break;

    batch += 1;
    stats.processed += rows.length;
    lastId = parseNumber(rows[rows.length - 1]?.lnhpd_id) ?? lastId;
    useGte = false;
    nextStart = lastId > 0 ? lastId + 1 : nextStart;

    await runWithConcurrency(rows, concurrency, async (row) => {
      await handleLnhpdRow(row, stats);
    });

    console.log(
      `[backfill:lnhpd] batch=${batch} processed=${stats.processed} ingredients=${stats.writtenIngredients} scores=${stats.writtenScores} existing=${stats.skippedExisting} skipped=${stats.skipped} failed=${stats.failed} ingredientUpsertFailed=${stats.ingredientUpsertFailed} scoreUpsertFailed=${stats.scoreUpsertFailed} computeScoreFailed=${stats.computeScoreFailed} failuresLines=${failureTracker.baseLines + failureTracker.lines} failuresBytes=${failureTracker.baseBytes + failureTracker.bytes}`,
    );

    await writeCheckpoint({
      source: "lnhpd",
      startId: startLnhpdId,
      endId: endLnhpdId,
      nextStart,
      lastId: lastId || null,
      stats,
    });

    if (limit > 0 && stats.processed >= limit) break;
    if (endLnhpdId != null && endLnhpdId > 0 && lastId >= endLnhpdId) break;
    if (reachedTimeBudget(startTime)) break;
  }

  await writeSummary({
    source: "lnhpd",
    startId: startLnhpdId,
    endId: endLnhpdId,
    lastId: stats.processed > 0 ? lastId : null,
    nextStart: stats.processed > 0 ? nextStart : startLnhpdId || null,
    stats,
    elapsedMs: Date.now() - startTime,
  });

  console.log(
    `[backfill:lnhpd] done processed=${stats.processed} ingredients=${stats.writtenIngredients} scores=${stats.writtenScores} existing=${stats.skippedExisting} skipped=${stats.skipped} failed=${stats.failed} ingredientUpsertFailed=${stats.ingredientUpsertFailed} scoreUpsertFailed=${stats.scoreUpsertFailed} computeScoreFailed=${stats.computeScoreFailed} failuresLines=${failureTracker.baseLines + failureTracker.lines} failuresBytes=${failureTracker.baseBytes + failureTracker.bytes}`,
  );
};

const fetchDsldRowById = async (labelId: number): Promise<DsldFactsRow | null> => {
  const { data, error } = await supabase
    .from("dsld_label_facts")
    .select("dsld_label_id,facts_json")
    .eq("dsld_label_id", labelId)
    .maybeSingle();
  if (error || !data) return null;
  return data as DsldFactsRow;
};

const fetchLnhpdRowByIdOrNpn = async (
  table: string,
  lnhpdId: number | null,
  npn: string | null,
): Promise<LnhpdFactsRow | null> => {
  if (lnhpdId != null) {
    const { data, error } = await supabase
      .from(table)
      .select("lnhpd_id,npn,facts_json")
      .eq("lnhpd_id", lnhpdId)
      .maybeSingle();
    if (!error && data) return data as LnhpdFactsRow;
  }
  if (npn) {
    const { data, error } = await supabase
      .from(table)
      .select("lnhpd_id,npn,facts_json")
      .eq("npn", npn)
      .maybeSingle();
    if (!error && data) return data as LnhpdFactsRow;
  }
  return null;
};

const backfillFailures = async (filePath: string) => {
  const startTime = Date.now();
  const entries = await loadFailureEntries(filePath);
  const deduped = new Map<string, FailureEntry>();
  entries.forEach((entry) => {
    const key = `${entry.source}:${entry.sourceId}`;
    if (!deduped.has(key)) deduped.set(key, entry);
  });
  const items = Array.from(deduped.values());
  if (!items.length) {
    console.log(`[backfill:failures] no entries to retry from ${filePath}`);
    await writeFailuresSummary({
      failuresInput: filePath,
      stats: {
        processed: 0,
        writtenIngredients: 0,
        writtenScores: 0,
        skipped: 0,
        skippedExisting: 0,
        failed: 0,
        ingredientUpsertFailed: 0,
        scoreUpsertFailed: 0,
        computeScoreFailed: 0,
      },
      elapsedMs: Date.now() - startTime,
    });
    return;
  }

  const stats: BackfillStats = {
    processed: 0,
    writtenIngredients: 0,
    writtenScores: 0,
    skipped: 0,
    skippedExisting: 0,
    failed: 0,
    ingredientUpsertFailed: 0,
    scoreUpsertFailed: 0,
    computeScoreFailed: 0,
  };
  const lnhpdTable = await resolveLnhpdTable();

  await runWithConcurrency(items, concurrency, async (entry) => {
    stats.processed += 1;
    if (entry.source === "dsld") {
      const labelId = parseNumber(entry.canonicalSourceId ?? entry.sourceId);
      if (!labelId) {
        stats.failed += 1;
        await reportFailure({
          source: "dsld",
          sourceId: entry.sourceId,
          canonicalSourceId: entry.canonicalSourceId ?? null,
          stage: "retry_fetch",
          message: "invalid dsld label id",
        });
        return;
      }
      const row = await fetchDsldRowById(labelId);
      if (!row) {
        stats.failed += 1;
        await reportFailure({
          source: "dsld",
          sourceId: entry.sourceId,
          canonicalSourceId: entry.canonicalSourceId ?? null,
          stage: "retry_fetch",
          message: "dsld_label_facts not found",
        });
        return;
      }
      await handleDsldRow(row, stats, { forceRunAll: true, forceScores: failuresForce });
      return;
    }

    if (entry.source === "lnhpd") {
      const lnhpdId = parseNumber(entry.canonicalSourceId ?? entry.sourceId);
      const npn = entry.sourceId ?? null;
      const row = await fetchLnhpdRowByIdOrNpn(lnhpdTable, lnhpdId, npn);
      if (!row) {
        stats.failed += 1;
        await reportFailure({
          source: "lnhpd",
          sourceId: entry.sourceId,
          canonicalSourceId: entry.canonicalSourceId ?? null,
          stage: "retry_fetch",
          message: "lnhpd facts not found",
        });
        return;
      }
      await handleLnhpdRow(row, stats, { forceRunAll: true, forceScores: failuresForce });
    }
  });

  console.log(
    `[backfill:failures] processed=${stats.processed} ingredients=${stats.writtenIngredients} scores=${stats.writtenScores} existing=${stats.skippedExisting} skipped=${stats.skipped} failed=${stats.failed} ingredientUpsertFailed=${stats.ingredientUpsertFailed} scoreUpsertFailed=${stats.scoreUpsertFailed} computeScoreFailed=${stats.computeScoreFailed} failuresLines=${failureTracker.baseLines + failureTracker.lines} failuresBytes=${failureTracker.baseBytes + failureTracker.bytes}`,
  );
  await writeFailuresSummary({
    failuresInput: filePath,
    stats,
    elapsedMs: Date.now() - startTime,
  });
};

const fetchSampleSourceIds = async (source: ScoreSource, limitCount: number): Promise<string[]> => {
  const { data, error } = await withRetry<{ source_id: string | null }[]>(() =>
    supabase
      .from("product_ingredients")
      .select("source_id")
      .eq("source", source)
      .order("source_id", { ascending: true })
      .limit(limitCount * 20),
  );
  if (error || !data) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  data.forEach((row) => {
    const value = typeof row?.source_id === "string" ? row.source_id : null;
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
  });
  return ids.slice(0, limitCount);
};

const buildDailyMultiplierFromAssumptions = (assumptions: Record<string, unknown> | null): DailyMultiplierResult => {
  const multiplier =
    typeof assumptions?.dailyMultiplier === "number" && Number.isFinite(assumptions.dailyMultiplier)
      ? assumptions.dailyMultiplier
      : 1;
  const source =
    typeof assumptions?.dailyMultiplierSource === "string" && assumptions.dailyMultiplierSource.trim()
      ? assumptions.dailyMultiplierSource
      : "default_no_dosing_info";
  const reliability =
    assumptions?.dailyMultiplierReliability === "reliable" ||
    assumptions?.dailyMultiplierReliability === "unreliable"
      ? assumptions.dailyMultiplierReliability
      : "default";
  return {
    multiplier,
    source,
    reliability,
    lnhpdIdUsedForDoseLookup:
      typeof assumptions?.lnhpdIdUsedForDoseLookup === "string"
        ? assumptions.lnhpdIdUsedForDoseLookup
        : null,
    doseRowsFound:
      typeof assumptions?.doseRowsFound === "number" && Number.isFinite(assumptions.doseRowsFound)
        ? assumptions.doseRowsFound
        : null,
    selectedDosePop:
      typeof assumptions?.selectedDosePop === "string" ? assumptions.selectedDosePop : null,
    frequencyUnit:
      typeof assumptions?.doseFrequencyUnit === "string" ? assumptions.doseFrequencyUnit : null,
    penaltyReason:
      typeof assumptions?.dailyMultiplierPenaltyReason === "string"
        ? assumptions.dailyMultiplierPenaltyReason
        : null,
  };
};

const compareCachedVsBaseline = async (sources: ScoreSource[]): Promise<void> => {
  const cache = await getDatasetCache();
  let mismatches = 0;

  for (const source of sources) {
    const sampleIds = await fetchSampleSourceIds(source, compareLimit);
    if (!sampleIds.length) {
      console.log(`[compare-cached] source=${source} no samples available`);
      continue;
    }
    for (const sourceId of sampleIds) {
      const baseline = await computeScoreBundleV4({ source, sourceId });
      if (!baseline) {
        console.warn(`[compare-cached] source=${source} sourceId=${sourceId} baseline missing`);
        continue;
      }
      const ingredientRowsResult = await fetchProductIngredientRows(source, sourceId);
      if (!ingredientRowsResult || "error" in ingredientRowsResult) {
        console.warn(`[compare-cached] source=${source} sourceId=${sourceId} missing ingredients`);
        continue;
      }
      const assumptions =
        (baseline.bundle.explain as { assumptions?: Record<string, unknown> } | undefined)
          ?.assumptions ?? null;
      const dailyMultiplier = buildDailyMultiplierFromAssumptions(assumptions);
      const cached = await computeScoreBundleV4Cached({
        rows: ingredientRowsResult.rows,
        source,
        sourceId,
        sourceIdForWrite: ingredientRowsResult.sourceIdForWrite,
        canonicalSourceId: ingredientRowsResult.canonicalSourceId,
        dailyMultiplier,
        cache,
      });

      const matchesInputs = baseline.inputsHash === cached.inputsHash;
      const matchesOverall = baseline.bundle.overallScore === cached.bundle.overallScore;
      const matchesConfidence = baseline.bundle.confidence === cached.bundle.confidence;
      const matchesPillars =
        baseline.bundle.pillars.effectiveness === cached.bundle.pillars.effectiveness &&
        baseline.bundle.pillars.safety === cached.bundle.pillars.safety &&
        baseline.bundle.pillars.integrity === cached.bundle.pillars.integrity;

      if (!matchesInputs || !matchesOverall || !matchesConfidence || !matchesPillars) {
        mismatches += 1;
        console.error(
          `[compare-cached] mismatch source=${source} sourceId=${sourceId} inputsHash=${matchesInputs} overall=${matchesOverall} confidence=${matchesConfidence} pillars=${matchesPillars}`,
        );
      }
    }
  }

  if (mismatches > 0) {
    throw new Error(`[compare-cached] failed with mismatches=${mismatches}`);
  }
  console.log("[compare-cached] cached vs baseline outputs match");
};

const main = async () => {
  await initFailureTracker();
  console.log(
    `[backfill] source=${sourceArg} batch=${batchSize} concurrency=${concurrency} limit=${limit || "none"} timeBudgetSeconds=${timeBudgetSeconds || "none"} dryRun=${dryRun} failuresFile=${failuresFile} failuresForce=${failuresForce} checkpointFile=${checkpointFile ?? "none"} summaryJson=${summaryJson ?? "none"}`,
  );
  if (compareCached) {
    await compareCachedVsBaseline(targetSources);
    return;
  }
  if (failuresInput) {
    console.log(`[backfill] retrying failures from ${failuresInput}`);
    await backfillFailures(failuresInput);
    return;
  }
  if (targetSources.includes("dsld")) {
    await backfillDsld();
  }
  if (targetSources.includes("lnhpd")) {
    await backfillLnhpd();
  }
};

main().catch((error) => {
  console.error("[backfill] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
