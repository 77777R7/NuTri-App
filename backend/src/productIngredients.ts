import { supabase } from './supabase.js';
import { extractErrorMeta, type RetryErrorMeta, withRetry } from './supabaseRetry.js';
import type { LabelDraft } from './labelAnalysis.js';
import { canonicalizeLnhpdFormTokens, collectExplicitFormTokens } from './formTaxonomy/lnhpdFormTokenMap.js';

type Basis = 'label_serving' | 'recommended_daily' | 'assumed_daily';

type LabelFactsInput = {
  actives: {
    name: string;
    amount: number | null;
    unit: string | null;
    formRaw?: string | null;
    lnhpdMeta?: LnhpdIngredientMeta | null;
  }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
};

type IngredientLookup = {
  id: string;
  baseUnit: string | null;
  matchMethod: 'exact' | 'synonym' | 'trgm' | 'manual' | null;
  matchConfidence: number | null;
};

type LnhpdIngredientMeta = {
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
};

const scoreLnhpdMeta = (meta?: LnhpdIngredientMeta | null): number => {
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
  current?: LnhpdIngredientMeta | null,
  candidate?: LnhpdIngredientMeta | null,
): LnhpdIngredientMeta | null => {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  return scoreLnhpdMeta(candidate) > scoreLnhpdMeta(current) ? candidate : current;
};

type UnitKind = 'mass' | 'volume' | 'iu' | 'cfu' | 'percent' | 'homeopathic' | 'unknown';

type ProductIngredientRow = {
  source: 'dsld' | 'lnhpd' | 'ocr' | 'manual';
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string;
  amount: number | null;
  unit: string | null;
  unit_raw: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  unit_kind: UnitKind | null;
  basis: Basis;
  is_active: boolean;
  is_proprietary_blend: boolean;
  amount_unknown: boolean;
  form_raw: string | null;
  parse_confidence: number | null;
  match_method: IngredientLookup['matchMethod'];
  match_confidence: number | null;
};

type UpsertErrorContext = {
  payloadSummary?: {
    ingredientId: string | null;
    nameKey: string;
    unit: string | null;
    amount: number | null;
    amountNormalized: number | null;
    basis: Basis;
    unitKind: UnitKind | null;
    dailyMultiplier: number | null;
  } | null;
  overflowFields?: Record<string, number> | null;
};

type UpsertResult = {
  success: boolean;
  error?: RetryErrorMeta | null;
  errorContext?: UpsertErrorContext | null;
  overflowRows?: number;
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const buildNameKey = (value: string): string => {
  const normalized = normalizeNameKey(value);
  if (normalized) return normalized;
  return value.trim().toLowerCase();
};

const normalizeFormText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const normalizeFormToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9_:%]+/g, ' ').trim();

const FORM_RAW_TOKENS = [
  'bisglycinate',
  'diglycinate',
  'di glycinate',
  'glycinate',
  'picolinate',
  'citrate malate',
  'citrate',
  'malate',
  'gluconate',
  'sulfate',
  'sulphate',
  'chloride',
  'carbonate',
  'nitrate',
  'phosphate',
  'threonate',
  'hcl',
  'hydrochloride',
  'ethyl ester',
  'triglyceride',
  'phospholipid',
  'phosphatidylcholine',
  'free fatty acid',
  'free acid',
  'liposomal',
  'liposome',
  'phytosome',
  'micellar',
  'micellized',
  'emulsified',
  'microencapsulated',
  'micronized',
  'solid lipid particles',
  'solid lipid',
  'monohydrate',
  'dihydrate',
  'anhydrous',
  'enteric',
  'delayed release',
  'extended release',
  'slow release',
  'sustained release',
  'beadlet',
  'buffered',
  'with piperine',
  'magtein',
  'optizinc',
  'traacs',
  'albion',
  'ksm 66',
  'sensoril',
  'suntheanine',
  'pharmagaba',
  'carnosyn',
  'egb 761',
  'bacognize',
  'shr5',
  'silexan',
  'meriva',
  'quercefit',
  'curqfen',
  'bcm 95',
  'cavacurmin',
  'longvida',
  'theracurmin',
  'novasol',
  'emiq',
  'isoquercetin',
  'rtg',
  're esterified',
  'reesterified',
].map(normalizeFormText);

const FORM_RAW_TOKENS_SORTED = [...FORM_RAW_TOKENS].sort((a, b) => b.length - a.length);

const matchFormToken = (value: string): string | null => {
  const normalized = normalizeFormText(value);
  if (!normalized) return null;
  for (const token of FORM_RAW_TOKENS_SORTED) {
    if (token && normalized.includes(token)) return token;
  }
  return null;
};

const extractFormRaw = (nameRaw: string): string | null => {
  const trimmed = nameRaw.trim();
  if (!trimmed) return null;

  const parenMatch = trimmed.match(/\((?:as|from)\s+([^)]+)\)/i);
  if (parenMatch?.[1]) {
    const token = matchFormToken(parenMatch[1]);
    if (token) return token;
  }

  const asMatch = trimmed.match(/\b(?:as|from)\s+([a-z0-9][a-z0-9\s\-\/+]+)$/i);
  if (asMatch?.[1]) {
    const token = matchFormToken(asMatch[1]);
    if (token) return token;
  }

  const token = matchFormToken(trimmed);
  if (token) return token;

  return null;
};

const LNHPD_SOURCE_MATERIAL_BLOCKLIST = [
  /\b(ethanol|ethyl alcohol|aqua|water|purified water|glycerin|glycerine)\b/,
  /\b(rabbit|porcine|sus scrofa|bovine|bos taurus|ovine|capra hircus|oryctolagus cuniculus)\b/,
  /\b(homeopathic|homeopathy|natrum muriaticum|kali muriaticum|apis mellifica|mercurius|arnica|nux vomica|coffea cruda|silicea)\b/,
];

const LNHPD_PLANT_PART_PATTERNS: { pattern: RegExp; token: string }[] = [
  { pattern: /\broot(s)?\b|\bradix\b/, token: 'root' },
  { pattern: /\brhizome(s)?\b/, token: 'rhizome' },
  { pattern: /\bseed(s)?\b|\bkernel\b/, token: 'seed' },
  { pattern: /\bbark\b/, token: 'bark' },
  { pattern: /\bleaf\b/, token: 'leaf' },
  { pattern: /\bflower\b|\bflos\b/, token: 'flower' },
  { pattern: /\baerial\b/, token: 'aerial' },
  { pattern: /\bfruit\b/, token: 'fruit' },
  { pattern: /\bberry\b/, token: 'berry' },
  { pattern: /\bstem\b/, token: 'stem' },
  { pattern: /\bbulb\b/, token: 'bulb' },
  { pattern: /\btuber\b/, token: 'tuber' },
  { pattern: /\bresin\b/, token: 'resin' },
  { pattern: /\bpeel\b/, token: 'peel' },
  { pattern: /\bshoot\b/, token: 'shoot' },
  { pattern: /\btwig\b/, token: 'twig' },
  { pattern: /\bwhole plant\b|\bwhole herb\b|\bwhole\b/, token: 'whole' },
];

const isNoiseToken = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 1) return true;
  if (/^\d+$/.test(trimmed)) return true;
  return false;
};

const shouldSkipSourceMaterial = (value?: string | null): boolean => {
  if (!value) return false;
  const normalized = normalizeFormToken(value);
  if (!normalized) return false;
  return LNHPD_SOURCE_MATERIAL_BLOCKLIST.some((pattern) => pattern.test(normalized));
};

const pickScalarToken = (value: string | number | null | undefined): string | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return null;
};

const buildRatioToken = (
  numerator?: string | number | null,
  denominator?: string | number | null,
): string | null => {
  const num = pickScalarToken(numerator);
  const den = pickScalarToken(denominator);
  if (!num || !den) return null;
  if (!/\d/.test(num) || !/\d/.test(den)) return null;
  return `${num}:${den}`;
};

const buildPotencyAmountToken = (
  amount?: string | number | null,
  unit?: string | null,
): string | null => {
  const value = pickScalarToken(amount);
  if (!value || !/\d/.test(value)) return null;
  const normalizedUnit = normalizeUnitLabel(unit ?? '') ?? '';
  if (!normalizedUnit) return null;
  if (normalizedUnit === '%') return `${value}%`;
  return `${value}${normalizedUnit}`;
};

const extractLnhpdFormRaw = (meta?: LnhpdIngredientMeta | null): string | null => {
  if (!meta) return null;
  if (shouldSkipSourceMaterial(meta.sourceMaterial ?? null)) return null;

  const tokens: string[] = [];
  const addToken = (token: string | null) => {
    if (!token) return;
    const normalized = normalizeFormToken(token);
    if (!normalized || isNoiseToken(normalized)) return;
    normalized.split(/\s+/).forEach((part) => {
      if (!part || isNoiseToken(part)) return;
      tokens.push(part);
    });
  };

  const explicitTokens = collectExplicitFormTokens([
    meta.ingredientName ?? null,
    meta.properName ?? null,
    meta.sourceMaterial ?? null,
    meta.potencyConstituent ?? null,
  ]);
  explicitTokens.forEach((token) => addToken(token));

  if (meta.sourceMaterial) {
    const normalizedMaterial = normalizeFormToken(meta.sourceMaterial);
    if (normalizedMaterial) {
      LNHPD_PLANT_PART_PATTERNS.forEach(({ pattern, token }) => {
        if (pattern.test(normalizedMaterial)) addToken(token);
      });
    }
  }

  if (meta.extractTypeDesc) {
    const normalizedExtract = normalizeFormToken(meta.extractTypeDesc);
    if (normalizedExtract.includes('fresh')) addToken('fresh');
    if (normalizedExtract.includes('dry')) addToken('dry');
  }

  const ratioToken = buildRatioToken(meta.ratioNumerator, meta.ratioDenominator);
  if (ratioToken) {
    addToken('extract');
    addToken(ratioToken);
  }

  if (meta.potencyConstituent) {
    addToken(meta.potencyConstituent);
  }
  const potencyToken = buildPotencyAmountToken(meta.potencyAmount, meta.potencyUnit ?? null);
  if (potencyToken) addToken(potencyToken);

  if (meta.driedHerbEquivalent != null) {
    addToken('dhe');
  }

  const unique = Array.from(new Set(tokens));
  const canonical = canonicalizeLnhpdFormTokens(unique);
  return canonical.length ? canonical.join(' ') : null;
};

const extractLnhpdFallbackFormTokens = (
  nameRaw: string,
  meta?: LnhpdIngredientMeta | null,
): string[] => {
  const sources = [
    nameRaw,
    meta?.ingredientName ?? null,
    meta?.properName ?? null,
    meta?.sourceMaterial ?? null,
  ].filter((value): value is string => Boolean(value && value.trim()));
  if (!sources.length) return [];
  if (meta?.sourceMaterial && shouldSkipSourceMaterial(meta.sourceMaterial)) return [];
  return collectExplicitFormTokens(sources);
};

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith('mcg') ||
    normalized.startsWith('ug') ||
    normalized.startsWith('\u00b5g') ||
    normalized.startsWith('\u03bcg') ||
    normalized.startsWith('microgram')
  ) {
    return 'mcg';
  }
  if (normalized.startsWith('mg') || normalized.startsWith('milligram')) return 'mg';
  if (normalized.startsWith('g') || normalized.startsWith('gram')) return 'g';
  if (normalized.startsWith('iu') || normalized.startsWith('i.u')) return 'iu';
  if (
    normalized.startsWith('ml') ||
    normalized.startsWith('milliliter') ||
    normalized.startsWith('millilitre')
  ) {
    return 'ml';
  }
  if (normalized.includes('cfu') || normalized.includes('ufc')) return 'cfu';
  if (normalized.startsWith('kcal')) return 'kcal';
  if (normalized.startsWith('cal')) return 'cal';
  if (normalized.startsWith('%') || normalized.includes('percent')) return '%';
  return normalized;
};

const MASS_UNITS = new Set(['mcg', 'ug', 'mg', 'g']);
const VOLUME_UNITS = new Set(['ml']);
const IU_UNITS = new Set(['iu']);
const CFU_UNITS = new Set(['cfu']);
const HOMEOPATHIC_UNITS = new Set(['x', 'c', 'ch', 'd', 'dh', 'lm', 'mk', 'ck', 'mt']);

const classifyUnitKind = (unitRaw?: string | null): UnitKind => {
  if (!unitRaw) return 'unknown';
  const normalized = normalizeUnitLabel(unitRaw) ?? unitRaw.trim().toLowerCase();
  const unit = normalized.trim().toLowerCase();
  if (!unit) return 'unknown';
  if (unit.includes('%') || unit.includes('percent') || unit.includes('dv')) return 'percent';
  if (HOMEOPATHIC_UNITS.has(unit)) return 'homeopathic';
  if (MASS_UNITS.has(unit)) return 'mass';
  if (VOLUME_UNITS.has(unit)) return 'volume';
  if (IU_UNITS.has(unit)) return 'iu';
  if (CFU_UNITS.has(unit)) return 'cfu';
  return 'unknown';
};

const isDoseUnitKind = (unitKind: UnitKind): boolean =>
  unitKind === 'mass' || unitKind === 'volume' || unitKind === 'iu' || unitKind === 'cfu';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const MAX_NUMERIC_18_6 = 999_999_999_999.999999;

const clampNumeric18_6 = (value: number | null): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (Math.abs(value) > MAX_NUMERIC_18_6) return null;
  return value;
};

const isNumericOverflowError = (meta?: RetryErrorMeta | null): boolean => {
  const code = meta?.code?.toLowerCase() ?? '';
  const message = meta?.message?.toLowerCase() ?? '';
  const details = meta?.details?.toLowerCase() ?? '';
  if (code === '22003') return true;
  if (message.includes('numeric field overflow')) return true;
  return details.includes('numeric field overflow');
};

const buildPayloadSummary = (row: ProductIngredientRow): UpsertErrorContext['payloadSummary'] => ({
  ingredientId: row.ingredient_id ?? null,
  nameKey: row.name_key || buildNameKey(row.name_raw),
  unit: row.unit ?? null,
  amount: row.amount ?? null,
  amountNormalized: row.amount_normalized ?? null,
  basis: row.basis,
  unitKind: row.unit_kind ?? null,
  dailyMultiplier: null,
});

const collectNumericOverflowFields = (row: ProductIngredientRow): Record<string, number> => {
  const fields: Record<string, number> = {};
  if (typeof row.amount === 'number' && Number.isFinite(row.amount)) {
    if (Math.abs(row.amount) > MAX_NUMERIC_18_6) fields.amount = row.amount;
  }
  if (typeof row.amount_normalized === 'number' && Number.isFinite(row.amount_normalized)) {
    if (Math.abs(row.amount_normalized) > MAX_NUMERIC_18_6) {
      fields.amount_normalized = row.amount_normalized;
    }
  }
  if (typeof row.parse_confidence === 'number' && Number.isFinite(row.parse_confidence)) {
    if (row.parse_confidence < 0 || row.parse_confidence > 1) {
      fields.parse_confidence = row.parse_confidence;
    }
  }
  if (typeof row.match_confidence === 'number' && Number.isFinite(row.match_confidence)) {
    if (row.match_confidence < 0 || row.match_confidence > 1) {
      fields.match_confidence = row.match_confidence;
    }
  }
  return fields;
};

const sanitizeOverflowRow = (
  row: ProductIngredientRow,
  overflowFields: Record<string, number>,
): ProductIngredientRow => {
  const sanitized: ProductIngredientRow = { ...row };
  const overflowKeys = Object.keys(overflowFields);
  const hasAmountOverflow = overflowKeys.includes('amount');
  const hasNormalizedOverflow = overflowKeys.includes('amount_normalized');
  const hasConfidenceOverflow =
    overflowKeys.includes('parse_confidence') || overflowKeys.includes('match_confidence');

  if (hasAmountOverflow || overflowKeys.length === 0) {
    sanitized.amount = null;
  }
  if (hasNormalizedOverflow || overflowKeys.length === 0) {
    sanitized.amount_normalized = null;
  }
  if (hasConfidenceOverflow) {
    if (overflowKeys.includes('parse_confidence')) sanitized.parse_confidence = null;
    if (overflowKeys.includes('match_confidence')) sanitized.match_confidence = null;
  }
  if (sanitized.amount == null || sanitized.amount_normalized == null) {
    sanitized.amount_unknown = true;
  }
  return sanitized;
};

const computeRowParseConfidence = (
  baseConfidence: number | null | undefined,
  params: { amountMissing: boolean; unitKind: UnitKind; hasUnit: boolean },
): number | null => {
  if (typeof baseConfidence !== 'number' || !Number.isFinite(baseConfidence)) return null;
  let score = baseConfidence;
  if (params.amountMissing) score -= 0.15;
  if (!params.hasUnit || !isDoseUnitKind(params.unitKind)) score -= 0.15;
  if (params.unitKind === 'homeopathic') score -= 0.25;
  return clamp(score, 0.05, 0.99);
};

const isRpcMissing = (error?: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return (error.message ?? '').toLowerCase().includes('could not find the function');
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes('cfu') && !unitLower.includes('ufc')) return null;
  if (unitLower.includes('trillion')) return 1_000_000_000_000;
  if (unitLower.includes('billion')) return 1_000_000_000;
  if (unitLower.includes('million')) return 1_000_000;
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
    const scaled = clampNumeric18_6(amount * cfuMultiplier);
    return { amount: scaled, unit: 'cfu' };
  }
  return { amount: clampNumeric18_6(amount), unit: normalizedUnit };
};

const resolveIngredientLookup = async (
  name: string,
  cache: Map<string, IngredientLookup | null>,
): Promise<IngredientLookup | null> => {
  const key = normalizeNameKey(name);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const { data: ingredient, error } = await supabase
      .from('ingredients')
      .select('id,unit')
      .ilike('name', name)
      .maybeSingle();
    if (!error && ingredient?.id) {
      const lookup: IngredientLookup = {
        id: ingredient.id as string,
        baseUnit: ingredient.unit ?? null,
        matchMethod: 'exact',
        matchConfidence: 1,
      };
      cache.set(key, lookup);
      return lookup;
    }
  } catch {
    // Ignore lookup failures and fall through to synonyms.
  }

  try {
    const { data: synonym, error } = await supabase
      .from('ingredient_synonyms')
      .select('ingredient_id')
      .ilike('synonym', name)
      .maybeSingle();
    if (!error && synonym?.ingredient_id) {
      const { data: ingredient, error: ingredientError } = await supabase
        .from('ingredients')
        .select('id,unit')
        .eq('id', synonym.ingredient_id)
        .maybeSingle();
      if (!ingredientError && ingredient?.id) {
        const lookup: IngredientLookup = {
          id: ingredient.id as string,
          baseUnit: ingredient.unit ?? null,
          matchMethod: 'synonym',
          matchConfidence: 0.97,
        };
        cache.set(key, lookup);
        return lookup;
      }
    }
  } catch {
    // Ignore lookup failures and fall through to fuzzy.
  }

  try {
    const { data, error } = await withRetry(() =>
      supabase.rpc('resolve_ingredient_lookup', {
        query_text: name,
      }),
    );
    if (error) {
      if (!isRpcMissing(error)) {
        const meta = extractErrorMeta(error);
        console.warn('[ProductIngredients] Ingredient lookup RPC failed', meta);
      }
      cache.set(key, null);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.ingredient_id) {
      const matchConfidence =
        typeof row.match_confidence === 'number'
          ? row.match_confidence
          : Number(row.match_confidence);
      const lookup: IngredientLookup = {
        id: row.ingredient_id as string,
        baseUnit: row.base_unit ?? null,
        matchMethod: row.match_method ?? 'trgm',
        matchConfidence: Number.isFinite(matchConfidence) ? matchConfidence : null,
      };
      cache.set(key, lookup);
      return lookup;
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) {
      console.warn('[ProductIngredients] Ingredient lookup RPC error', (error as Error).message);
    }
  }

  cache.set(key, null);
  return null;
};

const resolveConversionFactor = async (
  ingredientId: string,
  fromUnit: string,
  toUnit: string,
  cache: Map<string, number | null>,
): Promise<number | null> => {
  const key = `${ingredientId}:${fromUnit}:${toUnit}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const { data, error } = await supabase
      .from('ingredient_unit_conversions')
      .select('factor')
      .eq('ingredient_id', ingredientId)
      .eq('from_unit', fromUnit)
      .eq('to_unit', toUnit)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) {
      cache.set(key, null);
      return null;
    }
    const factor = Number(data[0]?.factor);
    const resolved = Number.isFinite(factor) ? factor : null;
    cache.set(key, resolved);
    return resolved;
  } catch {
    cache.set(key, null);
    return null;
  }
};

const hydrateRowsWithLookups = async (
  rows: ProductIngredientRow[],
  lnhpdMetaByNameKey?: Map<string, LnhpdIngredientMeta | null> | null,
): Promise<void> => {
  const ingredientCache = new Map<string, IngredientLookup | null>();
  const conversionCache = new Map<string, number | null>();

  for (const row of rows) {
    const lookup = await resolveIngredientLookup(row.name_raw, ingredientCache);
    row.ingredient_id = lookup?.id ?? null;
    row.match_method = lookup?.matchMethod ?? null;
    row.match_confidence = lookup?.matchConfidence ?? null;

    if (
      row.source === 'lnhpd' &&
      row.ingredient_id &&
      (!row.form_raw || !row.form_raw.trim())
    ) {
      const nameKey = row.name_key || buildNameKey(row.name_raw);
      const meta = lnhpdMetaByNameKey?.get(nameKey) ?? null;
      const tokens = extractLnhpdFallbackFormTokens(row.name_raw, meta);
      if (tokens.length) {
        row.form_raw = tokens.join(' ');
      }
    }

    if (row.amount == null || !row.unit || !lookup?.baseUnit) {
      row.amount = clampNumeric18_6(row.amount);
      if (row.amount == null) row.amount_unknown = true;
      continue;
    }

    if (row.unit === lookup.baseUnit) {
      row.amount_normalized = clampNumeric18_6(row.amount);
      row.unit_normalized = lookup.baseUnit;
      if (row.amount_normalized == null) row.amount_unknown = true;
      continue;
    }

    const factor = await resolveConversionFactor(
      lookup.id,
      row.unit,
      lookup.baseUnit,
      conversionCache,
    );
    if (factor != null) {
      row.amount_normalized = clampNumeric18_6(row.amount * factor);
      row.unit_normalized = lookup.baseUnit;
      if (row.amount_normalized == null) row.amount_unknown = true;
    } else {
      row.amount_unknown = true;
      if (row.unit_kind && isDoseUnitKind(row.unit_kind)) {
        row.unit_kind = 'unknown';
      }
    }

    if (row.parse_confidence != null) {
      if (!Number.isFinite(row.parse_confidence)) row.parse_confidence = null;
      if (row.parse_confidence != null && (row.parse_confidence < 0 || row.parse_confidence > 1)) {
        row.parse_confidence = null;
      }
    }

    if (row.match_confidence != null) {
      if (!Number.isFinite(row.match_confidence)) row.match_confidence = null;
      if (row.match_confidence != null && (row.match_confidence < 0 || row.match_confidence > 1)) {
        row.match_confidence = null;
      }
    }
  }
};

const dedupeProductIngredientRows = (rows: ProductIngredientRow[]): ProductIngredientRow[] => {
  const map = new Map<string, ProductIngredientRow>();
  for (const row of rows) {
    const nameKey = row.name_key || buildNameKey(row.name_raw);
    const key = `${row.source}:${row.source_id}:${row.basis}:${nameKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, name_key: nameKey });
      continue;
    }
    const merged: ProductIngredientRow = { ...existing };
    merged.canonical_source_id = existing.canonical_source_id ?? row.canonical_source_id ?? null;
    merged.ingredient_id = existing.ingredient_id ?? row.ingredient_id ?? null;
    merged.name_key = existing.name_key || row.name_key || nameKey;
    merged.unit_kind = existing.unit_kind ?? row.unit_kind ?? null;
    merged.form_raw = row.form_raw ?? existing.form_raw;
    merged.is_active = existing.is_active || row.is_active;
    merged.is_proprietary_blend = existing.is_proprietary_blend || row.is_proprietary_blend;

    if (existing.amount == null && row.amount != null) {
      merged.amount = row.amount;
      merged.unit = row.unit;
      merged.unit_raw = row.unit_raw;
    } else {
      merged.amount = existing.amount ?? row.amount ?? null;
      merged.unit = existing.unit ?? row.unit;
      merged.unit_raw = existing.unit_raw ?? row.unit_raw;
    }

    merged.amount_normalized = existing.amount_normalized ?? row.amount_normalized ?? null;
    merged.unit_normalized = existing.unit_normalized ?? row.unit_normalized ?? null;
    merged.amount_unknown = Boolean(
      existing.amount_unknown || row.amount_unknown || merged.amount == null,
    );

    const parseValues = [existing.parse_confidence, row.parse_confidence].filter(
      (value): value is number => typeof value === 'number',
    );
    merged.parse_confidence = parseValues.length ? Math.max(...parseValues) : null;

    const existingMatch = existing.match_confidence ?? -1;
    const nextMatch = row.match_confidence ?? -1;
    if (nextMatch > existingMatch) {
      merged.match_confidence = row.match_confidence ?? null;
      merged.match_method = row.match_method ?? null;
    } else {
      merged.match_confidence = existing.match_confidence ?? null;
      merged.match_method = existing.match_method ?? null;
    }

    map.set(key, merged);
  }
  return Array.from(map.values());
};

const upsertRowsWithOverflowGuard = async (
  rows: ProductIngredientRow[],
): Promise<UpsertResult> => {
  let overflowRows = 0;

  for (const row of rows) {
    const { error, status, rayId } = await withRetry(() =>
      supabase.from('product_ingredients').upsert([row], {
        onConflict: 'source,source_id,basis,name_key',
      }),
    );
    if (!error) continue;

    const meta = extractErrorMeta(error, status, rayId);
    if (!isNumericOverflowError(meta)) {
      return {
        success: false,
        error: meta,
        errorContext: {
          payloadSummary: buildPayloadSummary(row),
        },
      };
    }

    const overflowFields = collectNumericOverflowFields(row);
    const sanitized = sanitizeOverflowRow(row, overflowFields);
    const retry = await withRetry(() =>
      supabase.from('product_ingredients').upsert([sanitized], {
        onConflict: 'source,source_id,basis,name_key',
      }),
    );
    if (retry.error) {
      const retryMeta = extractErrorMeta(retry.error, retry.status, retry.rayId);
      return {
        success: false,
        error: retryMeta,
        errorContext: {
          payloadSummary: buildPayloadSummary(row),
          overflowFields: Object.keys(overflowFields).length ? overflowFields : null,
        },
      };
    }
    overflowRows += 1;
  }

  return { success: true, overflowRows };
};

const upsertProductIngredientRows = async (
  rows: ProductIngredientRow[],
  lnhpdMetaByNameKey?: Map<string, LnhpdIngredientMeta | null> | null,
): Promise<UpsertResult> => {
  const dedupedRows = dedupeProductIngredientRows(rows);
  if (!dedupedRows.length) return { success: true };
  try {
    await hydrateRowsWithLookups(dedupedRows, lnhpdMetaByNameKey);
    const { error, status, rayId } = await withRetry(() =>
      supabase
        .from('product_ingredients')
        .upsert(dedupedRows, { onConflict: 'source,source_id,basis,name_key' }),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId);
      console.warn('[ProductIngredients] Upsert failed', meta);
      if (isNumericOverflowError(meta)) {
        return upsertRowsWithOverflowGuard(dedupedRows);
      }
      return { success: false, error: meta };
    }
  } catch (error) {
    const meta = extractErrorMeta(error);
    console.warn('[ProductIngredients] Upsert error', meta);
    return { success: false, error: meta };
  }
  return { success: true };
};

export async function upsertProductIngredientsFromLabelFacts(params: {
  source: 'dsld' | 'lnhpd';
  sourceId: string;
  canonicalSourceId?: string | null;
  labelFacts: LabelFactsInput;
  basis?: Basis;
  parseConfidence?: number | null;
}): Promise<UpsertResult> {
  const basis = params.basis ?? 'label_serving';
  const rows: ProductIngredientRow[] = [];
  const lnhpdMetaByNameKey =
    params.source === 'lnhpd' ? new Map<string, LnhpdIngredientMeta | null>() : null;

  params.labelFacts.actives.forEach((item) => {
    if (!item.name) return;
    const normalized = normalizeAmountAndUnit(item.amount ?? null, item.unit ?? null);
    const unitKind = classifyUnitKind(item.unit ?? normalized.unit);
    const amountMissing = normalized.amount == null;
    const amountUnknown = amountMissing || !isDoseUnitKind(unitKind);
    const nameKey = buildNameKey(item.name);
    const lnhpdFormRaw =
      params.source === 'lnhpd' ? extractLnhpdFormRaw(item.lnhpdMeta ?? null) : null;
    let formRaw = lnhpdFormRaw ?? item.formRaw ?? extractFormRaw(item.name);
    if (params.source === 'lnhpd' && formRaw) {
      formRaw = canonicalizeLnhpdFormTokens(formRaw.split(/\s+/)).join(' ');
    }
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: item.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: item.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: normalized.unit != null,
      }),
      match_method: null,
      match_confidence: null,
    });
    if (lnhpdMetaByNameKey && item.lnhpdMeta) {
      const existingMeta = lnhpdMetaByNameKey.get(nameKey) ?? null;
      const nextMeta = pickLnhpdMeta(existingMeta, item.lnhpdMeta);
      if (nextMeta) {
        lnhpdMetaByNameKey.set(nameKey, nextMeta);
      }
    }
  });

  params.labelFacts.proprietaryBlends.forEach((blend) => {
    if (!blend.name) return;
    const normalized = normalizeAmountAndUnit(blend.totalAmount ?? null, blend.unit ?? null);
    const unitKind = classifyUnitKind(blend.unit ?? normalized.unit);
    const amountMissing = normalized.amount == null;
    const amountUnknown = amountMissing || !isDoseUnitKind(unitKind);
    const nameKey = buildNameKey(blend.name);
    const formRaw = extractFormRaw(blend.name);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: blend.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: blend.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: true,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: normalized.unit != null,
      }),
      match_method: null,
      match_confidence: null,
    });
  });

  params.labelFacts.inactive.forEach((name) => {
    if (!name) return;
    const unitKind = classifyUnitKind(null);
    const amountMissing = true;
    const amountUnknown = true;
    const nameKey = buildNameKey(name);
    const formRaw = extractFormRaw(name);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: name,
      name_key: nameKey,
      amount: null,
      unit: null,
      unit_raw: null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: false,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: false,
      }),
      match_method: null,
      match_confidence: null,
    });
  });

  return upsertProductIngredientRows(rows, lnhpdMetaByNameKey);
}

export async function upsertProductIngredientsFromDraft(params: {
  sourceId: string;
  draft: LabelDraft;
  basis?: Basis;
}): Promise<void> {
  const basis = params.basis ?? 'label_serving';
  const rows: ProductIngredientRow[] = params.draft.ingredients.map((ingredient) => {
    const normalized = normalizeAmountAndUnit(
      ingredient.amount ?? null,
      ingredient.unit ?? null,
    );
    const unitKind = classifyUnitKind(ingredient.unit ?? normalized.unit);
    const nameKey = buildNameKey(ingredient.name);
    const formRaw = extractFormRaw(ingredient.name);
    const amountUnknown =
      normalized.amount == null && ingredient.dvPercent == null
        ? true
        : !isDoseUnitKind(unitKind);
    return {
      source: 'ocr',
      source_id: params.sourceId,
      canonical_source_id: null,
      ingredient_id: null,
      name_raw: ingredient.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: ingredient.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: ingredient.confidence ?? params.draft.confidenceScore ?? null,
      match_method: null,
      match_confidence: null,
    };
  });

  await upsertProductIngredientRows(rows);
}
